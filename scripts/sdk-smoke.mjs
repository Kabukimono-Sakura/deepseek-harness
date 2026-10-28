import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonRpcProcess } from '../src/backends/jsonrpc-process.ts';
import { DshBackend } from '../src/backends/dsh.ts';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

// Real DSH process and persistence, local simulated model only. Never loads .env.
requireSupportedNode();
const env = projectEnvironment();
const scratch = mkdtempSync(join(projectRoot, 'tmp/sdk-smoke-'));
const workspace = join(scratch, 'workspace');
mkdirSync(workspace);
const requests = [];
let serverFailure;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/anthropic/v1/messages');
    assert.equal(request.headers['x-api-key'], 'integration-test-key');
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    assert.equal(payload.stream, true);
    assert.equal(payload.tools?.length ?? 0, 0, 'companion must expose no coding tools');
    requests.push(payload);
    const reply = requests.length === 1 ? 'first-response' : 'resumed-response';
    const events = [
      { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  } catch (error) {
    serverFailure = error;
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Local test assertion failed.' } }));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const sessionId = randomUUID();
let rpc;
async function connect() {
  rpc = new JsonRpcProcess(process.execPath, [
    join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 'sdk-minimal', '--patch', join(projectRoot, 'config/companion.patch.yml'),
  ], {
    cwd: workspace,
    env: { ...env, DSH_HOME: join(scratch, 'home'), DEEPSEEK_API_KEY: 'integration-test-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}/anthropic` },
    timeoutMs: 180_000,
  });
  const backend = new DshBackend(rpc);
  await backend.initialize(workspace);
  return backend;
}
try {
  let backend = await connect();
  assert.equal(await backend.turn(sessionId, 'first-input'), 'first-response');
  await rpc.request('shutdown');
  rpc.close();
  backend = await connect();
  await backend.resume(sessionId);
  assert.equal(await backend.turn(sessionId, 'second-input'), 'resumed-response');
  assert.equal(requests.length, 2);
  const resumedHistory = JSON.stringify(requests[1].messages);
  assert.ok(resumedHistory.includes('first-input'));
  assert.ok(resumedHistory.includes('first-response'));
  assert.ok(resumedHistory.includes('second-input'));
  await rpc.request('shutdown');
  console.log('DSH SDK smoke passed: real runtime, text reply, no coding tools, process restart and retained history. Model service was a local fixture.');
} catch (error) {
  console.error(serverFailure?.message ?? error.message);
  process.exitCode = 1;
} finally {
  rpc?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Verify the absolute deletion target before recursive cleanup on Windows.
  assert.equal(dirname(resolve(scratch)), resolve(projectRoot, 'tmp'));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
