import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonRpcProcess } from '../src/backends/jsonrpc-process.ts';
import { DshBackend } from '../src/backends/dsh.ts';
import { PetClient, PetPresenter } from '../src/channels/pet.ts';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

// Explicit live-account acceptance command. Never called by CI.
requireSupportedNode();
if (existsSync(join(projectRoot, '.env'))) process.loadEnvFile(join(projectRoot, '.env'));
if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('Configure DEEPSEEK_API_KEY locally first.');
const workspace = join(projectRoot, 'data/live-check');
mkdirSync(workspace, { recursive: true });
const sessionId = randomUUID();
const marker = 'DSH-' + randomUUID().slice(0, 8);
let rpc;
let pet;
async function connect() {
  rpc = new JsonRpcProcess(process.execPath, [join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 'sdk-minimal', '--patch', join(projectRoot, 'config/companion.patch.yml')], {
    cwd: workspace, env: projectEnvironment(), timeoutMs: 180_000,
  });
  const backend = new DshBackend(rpc);
  await backend.initialize(workspace, process.env.DEEPSEEK_MODEL || 'deepseek-flash');
  return backend;
}
try {
  let backend = await connect();
  const first = await backend.turn(sessionId, `这是接入验收。记住测试标记 ${marker}，仅回复该标记。`);
  if (!first.includes(marker)) throw new Error('First live reply did not contain the acceptance marker.');
  await rpc.request('shutdown'); rpc.close();
  backend = await connect();
  await backend.resume(sessionId);
  const second = await backend.turn(sessionId, '上一条消息要求你记住的测试标记是什么？只回复标记。');
  if (!second.includes(marker)) throw new Error('Restarted conversation did not retain the acceptance marker.');
  await rpc.request('shutdown');
  if (process.argv.includes('--pet')) {
    pet = new PetPresenter(new PetClient(process.env.DSH_PET_URL || 'http://127.0.0.1:3847'), () => {
      console.warn('Live model passed, but pet display was unavailable.');
    });
    await pet.reply('DeepSeek 真实对话和重启记忆验收通过。');
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  writeFileSync(join(workspace, 'last-result.json'), JSON.stringify({ time: new Date().toISOString(), model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', sessionId, liveReply: true, restartMemory: true }, null, 2));
  console.log('Live DeepSeek acceptance passed: real response and retained history after process restart.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rpc?.close(); await pet?.close(); }
