import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { JsonRpcProcess } from '../src/backends/jsonrpc-process.ts';

function child(mode, options = {}) {
  return new JsonRpcProcess(process.execPath, [fileURLToPath(new URL('./fixtures/rpc-child.mjs', import.meta.url)), mode], {
    cwd: process.cwd(), timeoutMs: 5000, ...options,
  });
}

test('stdio handles partial UTF-8 frames and concurrent request IDs', async t => {
  const rpc = child('ok');
  t.after(() => rpc.close());
  assert.deepEqual(await Promise.all([rpc.request('one'), rpc.request('two')]), ['你好', '你好']);
});

test('provider error details are not exposed', async t => {
  const rpc = child('error');
  t.after(() => rpc.close());
  await assert.rejects(rpc.request('one'), error => error.message === 'Runtime RPC failed (-32000).');
});

test('malformed frames, size limit and process death reject pending work', async () => {
  for (const mode of ['bad', 'large', 'exit']) {
    const rpc = child(mode, { maxFrameBytes: 1024 });
    try {
      const results = await Promise.allSettled([rpc.request('one'), rpc.request('two')]);
      assert.equal(results.every(result => result.status === 'rejected'), true);
      await assert.rejects(rpc.request('after-failure'));
    } finally { rpc.close(); }
  }
});

test('timeout retires the process and rejects future work', async t => {
  const rpc = child('hang', { timeoutMs: 100 });
  t.after(() => rpc.close());
  await assert.rejects(rpc.request('one'), /timed out/);
  await assert.rejects(rpc.request('two'), /timed out/);
});
