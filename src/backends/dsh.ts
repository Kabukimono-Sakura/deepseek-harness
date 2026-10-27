import { record } from './jsonrpc-process.ts';
import type { RpcPeer } from './jsonrpc-process.ts';

/** Owns one automation interval per session. Enqueue receipts are not replies. */
export class DshBackend {
  #rpc: RpcPeer;
  #ready = false;
  #tails = new Map<string, Promise<void>>();

  constructor(rpc: RpcPeer) { this.#rpc = rpc; }

  async initialize(cwd: string, model = 'deepseek-flash'): Promise<void> {
    if (this.#ready) throw new Error('Backend already initialized.');
    const result = record(await this.#rpc.request('initialize', {
      cwd, provider: 'deepseek-official', model, maxTokens: 4096,
    }));
    if (record(result.serverInfo).name !== 'deepseek-harness-sdk-runtime') throw new Error('Unexpected runtime identity.');
    this.#ready = true;
  }

  async resume(sessionId: string): Promise<void> {
    if (!this.#ready) throw new Error('Backend is not initialized.');
    await this.#rpc.request('session/resume', { sessionId });
  }

  turn(sessionId: string, text: string): Promise<string> {
    if (!this.#ready) return Promise.reject(new Error('Backend is not initialized.'));
    if (!sessionId || !text.trim() || text.length > 16_000) return Promise.reject(new Error('Invalid conversation input.'));
    const previous = this.#tails.get(sessionId) ?? Promise.resolve();
    const next = previous.then(() => this.#runTurn(sessionId, text));
    const settled = next.then(() => {}, () => {});
    this.#tails.set(sessionId, settled);
    void settled.then(() => { if (this.#tails.get(sessionId) === settled) this.#tails.delete(sessionId); });
    return next;
  }

  async #runTurn(sessionId: string, text: string): Promise<string> {
    let answer = '';
    let terminal = '';
    let failed = false;
    const unsubscribe = this.#rpc.subscribe(({ method, params }) => {
      const notification = record(params);
      if (method !== 'session.event' || notification.sessionId !== sessionId) return;
      const event = record(notification.event);
      const data = record(event.data);
      if (event.type === 'assistant/message') {
        const content = record(data.message).content;
        answer = Array.isArray(content) ? content.map(block => {
          const item = record(block);
          return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
        }).join('') : '';
        if (data.interrupted) failed = true;
      } else if (event.type === 'turn/end') {
        terminal = String(record(data.reason).kind ?? 'unknown');
        if (terminal !== 'completed') failed = true;
      }
    });
    try {
      const receipt = record(await this.#rpc.request('session/prompt', {
        sessionId, contentBlocks: [{ type: 'text', text }],
      }));
      if (typeof receipt.messageId !== 'string' || !receipt.messageId) throw new Error('Missing prompt receipt.');
      await this.#rpc.request('session/wait', { sessionId });
      if (failed || terminal !== 'completed') throw new Error('Model turn did not complete successfully.');
      if (!answer.trim()) throw new Error('Model produced no text reply.');
      return answer;
    } finally { unsubscribe(); }
  }
}
