import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function projectEnvironment() {
  const temporary = join(projectRoot, 'tmp');
  mkdirSync(temporary, { recursive: true });
  return {
    ...process.env,
    PATH: [dirname(process.execPath), join(projectRoot, '.tools/package-manager/node_modules/.bin'), process.env.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':'),
    DSH_HOME: join(projectRoot, '.dsh'),
    npm_config_cache: join(projectRoot, '.cache', 'npm'),
    npm_config_store_dir: join(projectRoot, '.cache', 'pnpm-store'),
    npm_config_cache_dir: join(projectRoot, '.cache', 'pnpm'),
    npm_config_state_dir: join(projectRoot, '.cache', 'pnpm-state'),
    electron_config_cache: join(projectRoot, '.cache', 'electron'),
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
  };
}

export function requireSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 9)) {
    throw new Error('Node >=24.9 is required. On this Windows machine use scripts/dev.ps1.');
  }
}
