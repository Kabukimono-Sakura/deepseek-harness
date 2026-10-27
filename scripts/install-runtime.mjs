import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

try {
  requireSupportedNode();
  const destination = join(projectRoot, '.runtime/dsh');
  mkdirSync(destination, { recursive: true });
  copyFileSync(join(projectRoot, 'config/dsh-runtime.package.json'), join(destination, 'package.json'));
  copyFileSync(join(projectRoot, 'config/dsh-runtime.lock.json'), join(destination, 'package-lock.json'));
  const localNpm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const npmCli = process.env.npm_execpath ?? (existsSync(localNpm) ? localNpm : null);
  if (!npmCli) throw new Error('Run this installer via npm run runtime:install.');
  const result = spawnSync(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], {
    cwd: destination, env: projectEnvironment(), stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw new Error('Unable to start npm.');
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
