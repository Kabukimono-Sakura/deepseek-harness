import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export type Notification = { method: string; params: unknown };
export interface RpcPeer {
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(listener: (notification: Notification) => void): () => void;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** One private stdio connection. A timeout retires the whole runtime: the DSH
 * protocol has no per-prompt cancel, so a late result must never leak to a new turn. */
export class JsonRpcProcess implements RpcPeer {
  #child: ChildProcessWithoutNullStreams;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #listeners = new Set<(notification: Notification) => void>();
  #nextId = 0;
  #buffer = '';
  #failure: Error | undefined;
  #timeoutMs: number;
  #maxFrameBytes: number;

  constructor(command: string, args: string[], options: {
    cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxFrameBytes?: number;
  }) {
    this.#timeoutMs = options.timeoutMs ?? 180_000;
    this.#maxFrameBytes = options.maxFrameBytes ?? 8 * 1024 * 1024;
    this.#child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: 'pipe', windowsHide: true });
    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk: string) => this.#receive(chunk));
    // Drain diagnostics, but do not expose raw provider errors or environment secrets.
    this.#child.stderr.resume();
    this.#child.on('error', () => this.close(new Error('Runtime could not start.')));
    this.#child.stdin.on('error', () => this.close(new Error('Runtime input closed.')));
    this.#child.on('exit', () => this.close(new Error('Runtime exited.')));
  }

  subscribe(listener: (notification: Notification) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error(`Runtime request timed out: ${method}`)), this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  #receive(chunk: string): void {
    if (this.#failure) return;
    this.#buffer += chunk;
    let newline: number;
    while ((newline = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > this.#maxFrameBytes) {
        this.close(new Error('Runtime frame too large.')); return;
      }
      try {
        const frame = record(JSON.parse(line));
        if (frame.jsonrpc !== '2.0') throw new Error();
        if (typeof frame.id === 'number') {
          const pending = this.#pending.get(frame.id);
          if (!pending) continue;
          this.#pending.delete(frame.id);
          clearTimeout(pending.timer);
          if ('error' in frame) pending.reject(new Error(`Runtime RPC failed (${record(frame.error).code ?? 'unknown'}).`));
          else if ('result' in frame) pending.resolve(frame.result);
          else { pending.reject(new Error('Malformed runtime response.')); throw new Error(); }
        } else if (typeof frame.method === 'string' && !('id' in frame)) {
          for (const listener of this.#listeners) listener({ method: frame.method, params: frame.params });
        } else throw new Error();
      } catch {
        this.close(new Error('Invalid runtime protocol frame.')); return;
      }
    }
    if (Buffer.byteLength(this.#buffer) > this.#maxFrameBytes) this.close(new Error('Runtime frame too large.'));
  }

  close(reason = new Error('Runtime closed.')): void {
    if (this.#failure) return;
    this.#failure = reason;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#listeners.clear();
    this.#child.stdin.destroy();
    this.#child.kill();
  }
}
