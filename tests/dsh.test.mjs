import test from 'node:test';
import assert from 'node:assert/strict';
import { DshBackend } from '../src/backends/dsh.ts';

class FakePeer {
  listeners = new Set();
  calls = [];
  active = new Map();
  outcomes = new Map();
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(sessionId, type, data) {
    for (const fn of this.listeners) fn({ method: 'session.event', params: { sessionId, event: { type, data } } });
  }
  async request(method, params) {
    this.calls.push([method, params]);
    if (method === 'initialize') return { serverInfo: { name: 'deepseek-harness-sdk-runtime' } };
    if (method === 'session/resume') return {};
    if (method === 'session/prompt') {
      assert.equal(this.active.has(params.sessionId), false, 'overlapping prompts in one session');
      this.active.set(params.sessionId, params.contentBlocks[0].text);
      return { messageId: 'receipt-only' };
    }
    if (method === 'session/wait') {
      await new Promise(resolve => setTimeout(resolve, 10));
      const session = params.sessionId;
      this.emit('unrelated-child', 'assistant/message', { message: { content: [{ type: 'text', text: 'secret-child-output' }] } });
      this.emit(session, 'assistant/message', { message: { content: [
        { type: 'thinking', text: 'private-reasoning' }, { type: 'text', text: this.active.get(session) },
      ] } });
      this.emit(session, 'turn/end', { reason: { kind: this.outcomes.get(session) ?? 'completed' } });
      this.active.delete(session);
      return {};
    }
    throw new Error('unexpected method');
  }
}

test('handshake gates prompts and rejects the wrong server', async () => {
  const peer = new FakePeer();
  const backend = new DshBackend(peer);
  await assert.rejects(backend.turn('a', 'hi'), /not initialized/);
  peer.request = async () => ({ serverInfo: { name: 'wrong' } });
  await assert.rejects(backend.initialize('/workspace'), /identity/);
});

test('same-session turns serialize; different sessions and child output stay isolated', async () => {
  const peer = new FakePeer();
  const backend = new DshBackend(peer);
  await backend.initialize('/workspace');
  const outputs = await Promise.all([backend.turn('a', 'first'), backend.turn('a', 'second'), backend.turn('b', 'other')]);
  assert.deepEqual(outputs, ['first', 'second', 'other']);
  assert.equal(peer.listeners.size, 0);
  assert.equal(peer.calls.filter(([method]) => method === 'session/wait').length, 3);
});

test('resume restores an identity without enqueuing a user prompt', async () => {
  const peer = new FakePeer();
  const backend = new DshBackend(peer);
  await backend.initialize('/workspace');
  await backend.resume('existing');
  assert.equal(peer.calls.at(-1)[0], 'session/resume');
  assert.equal(peer.calls.some(([method]) => method === 'session/prompt'), false);
});

test('failed, cancelled, blocked and truncated turns never become successful replies', async () => {
  for (const outcome of ['error', 'aborted', 'blocked', 'max-tokens']) {
    const peer = new FakePeer();
    peer.outcomes.set('a', outcome);
    const backend = new DshBackend(peer);
    await backend.initialize('/workspace');
    await assert.rejects(backend.turn('a', 'partial answer'), /did not complete/);
    assert.equal(peer.listeners.size, 0);
  }
});

test('idle without a terminal event is not evidence of a successful turn', async () => {
  const peer = new FakePeer();
  const original = peer.request.bind(peer);
  peer.request = (method, params) => method === 'session/wait' ? Promise.resolve({}) : original(method, params);
  const backend = new DshBackend(peer);
  await backend.initialize('/workspace');
  await assert.rejects(backend.turn('a', 'hello'), /did not complete/);
  assert.equal(peer.listeners.size, 0);
});
