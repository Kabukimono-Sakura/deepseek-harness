import test from 'node:test';
import assert from 'node:assert/strict';
import { PetClient, PetPresenter } from '../src/channels/pet.ts';

function fixture() {
  const calls = [];
  let failBroadcast = false;
  const client = new PetClient('http://127.0.0.1:3847', { fetch: async (url, options) => {
    const path = url.pathname.split('/').at(-1);
    calls.push({ url, options, body: options.body && JSON.parse(options.body) });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (path === 'lock') return Response.json({ ok: true, lockId: 'our-lease' });
    if (path === 'broadcast' && failBroadcast) return Response.json({ ok: false, reason: 'lock-lost' });
    return Response.json({ ok: true });
  } });
  return { client, calls, loseLock: () => { failBroadcast = true; } };
}

test('pet output is restricted to explicit loopback origins', () => {
  for (const origin of ['https://example.com', 'http://localhost:3847', 'http://127.0.0.1/a', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/?x=1']) {
    assert.throws(() => new PetClient(origin), /loopback/);
  }
});

test('reply uses a scoped lock and broadcasts without another model call', async () => {
  const { client, calls } = fixture();
  const presenter = new PetPresenter(client);
  await presenter.thinking();
  await presenter.reply('你好');
  await presenter.close();
  const broadcast = calls.find(call => call.url.pathname.endsWith('/broadcast'));
  assert.equal(broadcast.url.searchParams.get('lock'), 'our-lease');
  assert.equal(broadcast.url.searchParams.get('pet'), 'main');
  assert.equal(broadcast.url.searchParams.get('surface'), 'desktop');
  assert.equal(broadcast.body.text, '你好');
  assert.equal(broadcast.options.redirect, 'error');
  assert.equal(calls.some(call => /\/(chat|whisper)$/.test(call.url.pathname)), false);
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/release')).body, { lockId: 'our-lease' });
});

test('user takeover stops the reply; it does not force release or reacquire', async () => {
  const { client, calls, loseLock } = fixture();
  let warnings = 0;
  const presenter = new PetPresenter(client, () => { warnings++; });
  loseLock();
  await presenter.reply('reply');
  assert.equal(warnings, 1);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/lock')).length, 1);
  assert.equal(calls.some(call => call.body?.force), false);
  await presenter.close();
});

test('an unavailable pet does not reject a completed conversation reply', async () => {
  const client = new PetClient('http://127.0.0.1:3847', { fetch: async () => { throw new Error('offline'); } });
  let warnings = 0;
  const presenter = new PetPresenter(client, () => { warnings++; });
  await presenter.thinking();
  await presenter.reply('still available in the CLI');
  await presenter.close();
  assert.equal(warnings, 2);
});
