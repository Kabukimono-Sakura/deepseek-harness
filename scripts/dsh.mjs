import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

try {
  requireSupportedNode();
  const envFile = join(projectRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const cli = join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
  if (!existsSync(cli)) throw new Error('DSH is not installed. Run npm run runtime:install first.');
  const args = process.argv.slice(2);
  const child = spawn(process.execPath, [cli, ...(args.length ? args : ['web', '--no-open'])], {
    cwd: projectRoot, env: projectEnvironment(), stdio: 'inherit', windowsHide: true,
  });
  child.on('error', () => { console.error('Unable to start the DSH runtime.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
