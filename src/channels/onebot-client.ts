import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { record } from '../backends/jsonrpc-process.ts';

export class OneBotRequestError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain: boolean) { super(message); this.uncertain = uncertain; }
}

/** Authenticated, account-bound OneBot 11 connection. Never retries an API call. */
export class OneBotClient extends EventEmitter {
  #url: string;
  #token: string;
  #accountId: string;
  #socket?: WebSocket;
  #pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #reconnect?: ReturnType<typeof setTimeout>;
  #heartbeat?: ReturnType<typeof setInterval>;
  #stopped = true;
  #ready = false;
  #attempt = 0;
  #timeout: number;
  #reconnectMs: number;
  get ready(): boolean { return this.#ready; }

  constructor(options: { url: string; token: string; accountId: string; timeoutMs?: number; reconnectMs?: number }) {
    super();
    const url = new URL(options.url);
    if (url.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('OneBot requires a loopback ws:// origin.');
    }
    if (!options.token.trim() || /[\r\n]/.test(options.token)) throw new Error('OneBot access token is required.');
    if (!/^[1-9]\d*$/.test(options.accountId)) throw new Error('Expected QQ account ID is required.');
    this.#url = url.href; this.#token = options.token; this.#accountId = options.accountId;
    this.#timeout = options.timeoutMs ?? 10_000;
    this.#reconnectMs = options.reconnectMs ?? 1000;
  }

  start(): void { if (!this.#stopped) return; this.#stopped = false; this.#connect(); }

  #connect(): void {
    if (this.#stopped) return;
    const socket = new WebSocket(this.#url, {
      headers: { Authorization: `Bearer ${this.#token}` },
      handshakeTimeout: this.#timeout, maxPayload: 1024 * 1024, followRedirects: false,
    });
    this.#socket = socket;
    socket.on('error', () => {}); // close handles retry; never log headers or raw server errors.
    socket.on('message', (bytes, binary) => {
      if (this.#socket !== socket || binary) return;
      let data: Record<string, unknown>;
      try { data = record(JSON.parse(bytes.toString())); } catch { socket.close(1007); return; }
      if (typeof data.echo === 'string' && this.#pending.has(data.echo)) {
        const pending = this.#pending.get(data.echo)!;
        this.#pending.delete(data.echo); clearTimeout(pending.timer);
        if (data.status === 'ok' && data.retcode === 0) pending.resolve(data.data);
        else pending.reject(new OneBotRequestError('OneBot API did not confirm success.', true));
      } else if (this.#ready && data.post_type === 'message' && String(data.self_id) === this.#accountId) {
        this.emit('message', data);
      }
    });
    socket.on('open', () => { void this.#verify(socket); });
    socket.on('close', () => {
      if (this.#socket !== socket) return;
      this.#ready = false; clearInterval(this.#heartbeat);
      for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new OneBotRequestError('OneBot connection lost.', true)); }
      this.#pending.clear();
      this.emit('offline');
      if (!this.#stopped) {
        const delay = Math.min(30_000, this.#reconnectMs * 2 ** Math.min(this.#attempt++, 5));
        this.#reconnect = setTimeout(() => this.#connect(), delay);
      }
    });
  }

  async #verify(socket: WebSocket): Promise<void> {
    try {
      const login = record(await this.#request('get_login_info', {}, true));
      if (this.#stopped || this.#socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (String(login.user_id) !== this.#accountId) {
        this.emit('diagnostic', 'account-mismatch'); this.stop(); return;
      }
      this.#ready = true; this.#attempt = 0;
      let alive = true;
      socket.on('pong', () => { alive = true; });
      this.#heartbeat = setInterval(() => {
        if (!alive) { socket.terminate(); return; }
        alive = false; socket.ping();
      }, 20_000);
      this.emit('ready');
    } catch {
      if (!this.#stopped && this.#socket === socket) { this.emit('diagnostic', 'login-check-failed'); socket.terminate(); }
    }
  }

  request(action: string, params: unknown): Promise<unknown> { return this.#request(action, params, false); }

  #request(action: string, params: unknown, handshake: boolean): Promise<unknown> {
    const socket = this.#socket;
    if (this.#stopped || (!handshake && !this.#ready) || !socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new OneBotRequestError('OneBot is not connected.', false));
    }
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(echo);
        reject(new OneBotRequestError('OneBot receipt timed out; do not replay automatically.', true));
      }, this.#timeout);
      this.#pending.set(echo, { resolve, reject, timer });
      socket.send(JSON.stringify({ action, params, echo }), error => {
        if (!error) return;
        const pending = this.#pending.get(echo);
        if (pending) { clearTimeout(timer); this.#pending.delete(echo); reject(new OneBotRequestError('OneBot write outcome is unknown.', true)); }
      });
    });
  }

  stop(): void {
    this.#stopped = true; this.#ready = false;
    clearTimeout(this.#reconnect); clearInterval(this.#heartbeat);
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new OneBotRequestError('OneBot stopped.', true)); }
    this.#pending.clear(); this.#socket?.terminate();
  }
}
