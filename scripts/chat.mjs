import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline/promises';
import { JsonRpcProcess } from '../src/backends/jsonrpc-process.ts';
import { DshBackend } from '../src/backends/dsh.ts';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

let rpc;
let terminal;
let database;
try {
  requireSupportedNode();
  const envFile = join(projectRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('请在项目 .env 中配置 DEEPSEEK_API_KEY，然后重试。不要将密钥发送到聊天或 GitHub。');
  const cli = join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
  if (!existsSync(cli)) throw new Error('请先运行 npm run runtime:install。');
  const name = process.argv[2] ?? 'local';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('会话名限 1–64 位字母、数字、下划线和连字符。');
  mkdirSync(join(projectRoot, 'data'), { recursive: true });
  database = new DatabaseSync(join(projectRoot, 'data/conversations.sqlite'));
  database.exec('CREATE TABLE IF NOT EXISTS local_sessions (name TEXT PRIMARY KEY, session_id TEXT NOT NULL)');
  const saved = database.prepare('SELECT session_id FROM local_sessions WHERE name = ?').get(name);
  const sessionId = saved?.session_id ?? randomUUID();
  rpc = new JsonRpcProcess(process.execPath, [cli, '--profile', 'sdk-minimal', '--patch', join(projectRoot, 'config/companion.patch.yml')], {
    cwd: projectRoot, env: projectEnvironment(), timeoutMs: 180_000,
  });
  const backend = new DshBackend(rpc);
  console.log('正在初始化 DSH（首次启动可能较慢）…');
  await backend.initialize(projectRoot, process.env.DEEPSEEK_MODEL || 'deepseek-flash');
  if (saved) await backend.resume(sessionId);
  console.log(`会话 ${name} 已就绪。输入 /exit 退出。使用另一个会话名可以开始独立对话。`);
  terminal = createInterface({ input: process.stdin, output: process.stdout });
  process.once('SIGINT', () => { terminal?.close(); rpc?.close(); });
  for (;;) {
    let text;
    try { text = await terminal.question('你 > '); } catch { break; }
    if (text.trim() === '/exit') break;
    if (!text.trim()) continue;
    try {
      const answer = await backend.turn(sessionId, text);
      database.prepare('INSERT OR REPLACE INTO local_sessions (name, session_id) VALUES (?, ?)').run(name, sessionId);
      console.log(`伙伴 > ${answer}\n`);
    } catch (error) {
      // An uncertain interval must not be followed by a new prompt in the same process.
      throw new Error(`本轮未完成：${error.message} 请退出后重试；不会自动重发消息。`);
    }
  }
  await rpc.request('shutdown');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  terminal?.close();
  rpc?.close();
  database?.close();
}
