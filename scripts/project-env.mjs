import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function projectEnvironment() {
  const temporary = join(projectRoot, 'tmp');
  mkdirSync(temporary, { recursive: true });
  return {
    ...process.env,
    PATH: dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? ''),
    DSH_HOME: join(projectRoot, '.dsh'),
    npm_config_cache: join(projectRoot, '.cache', 'npm'),
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
