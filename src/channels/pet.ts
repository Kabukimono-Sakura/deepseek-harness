import { record } from '../backends/jsonrpc-process.ts';

/** Display-only client: never invokes dsh-pet's independent model/chat endpoints. */
export class PetClient {
  #origin: string;
  #petId: string;
  #surface: 'desktop' | 'web';
  #fetch: typeof fetch;

  constructor(origin: string, options: { petId?: string; surface?: 'desktop' | 'web'; fetch?: typeof fetch } = {}) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Pet endpoint must be a loopback HTTP origin.');
    }
    this.#origin = url.origin;
    this.#petId = options.petId ?? 'main';
    this.#surface = options.surface ?? 'desktop';
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(path: string, method: string, body?: unknown, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const url = new URL('/dsh-pet-7340/' + path, this.#origin);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await this.#fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(3000),
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Pet HTTP request failed (${response.status}).`);
    if (response.status === 204) return {};
    const data = record(await response.json());
    if (data.ok === false) {
      const reason = typeof data.reason === 'string' && /^[a-z-]{1,40}$/.test(data.reason) ? data.reason : 'rejected';
      throw new Error(`Pet request rejected: ${reason}`);
    }
    return data;
  }

  async setStatus(state: 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error', task = ''): Promise<void> {
    if (Array.from(task).length > 40) throw new Error('Pet task label exceeds 40 characters.');
    await this.#request('work-status', 'POST', { state, task });
  }

  async clearStatus(): Promise<void> { await this.#request('work-status', 'DELETE'); }

  async acquire(ttl = 15_000): Promise<string> {
    const data = await this.#request('lock', 'POST', { ttl }, { pet: this.#petId, surface: this.#surface });
    if (data.ok !== true || typeof data.lockId !== 'string' || !data.lockId) throw new Error('Pet lock receipt is missing.');
    return data.lockId;
  }

  async broadcast(lockId: string, text: string, duration = 10_000): Promise<void> {
    if (!lockId || !text.trim() || text.length > 16_000) throw new Error('Invalid pet reply.');
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60_000) throw new Error('Invalid pet display duration.');
    const result = await this.#request('broadcast', 'POST', { text, duration, anim: true }, {
      pet: this.#petId, surface: this.#surface, lock: lockId,
    });
    if (result.ok !== true) throw new Error('Pet broadcast receipt is missing.');
  }

  async release(lockId: string): Promise<void> {
    // Never force release: dragging the pet revokes our lease and gives the user control.
    if (!lockId) throw new Error('Missing pet lock.');
    await this.#request('lock/release', 'POST', { lockId }, { pet: this.#petId, surface: this.#surface });
  }
}

/** One local chat process owns the external status slot. UI failures never retry a model turn. */
export class PetPresenter {
  #client: PetClient;
  #lock: string | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #warn: () => void;
  constructor(client: PetClient, warn = () => {}) { this.#client = client; this.#warn = warn; }

  async #release(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const lock = this.#lock;
    this.#lock = undefined;
    if (lock) await this.#client.release(lock).catch(() => {});
  }

  async thinking(): Promise<void> {
    await this.#release();
    await this.#client.setStatus('thinking', '正在回复').catch(this.#warn);
  }

  async reply(text: string): Promise<void> {
    await this.#release();
    try {
      await this.#client.clearStatus();
      this.#lock = await this.#client.acquire();
      await this.#client.broadcast(this.#lock, text);
      this.#timer = setTimeout(() => { void this.#release(); }, 10_000);
      this.#timer.unref();
    } catch {
      await this.#release();
      this.#warn();
    }
  }

  async close(): Promise<void> {
    await this.#release();
    await this.#client.clearStatus().catch(() => {});
  }
}
