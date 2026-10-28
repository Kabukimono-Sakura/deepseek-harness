import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './project-env.mjs';

export function patchPetStorage() {
  const packageRoot = join(projectRoot, '.dsh/profiles/web/node_modules/dsh-pet');
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== '0.3.8') throw new Error('Storage patch supports dsh-pet 0.3.8 only.');
  const path = join(packageRoot, 'runtime/electron-helper/main.js');
  const source = readFileSync(path, 'utf8');
  const marker = '// Deepseek Companion: project-local Electron storage.';
  const insertion = `
${marker}
if (process.env.DSH_HOME && path.isAbsolute(process.env.DSH_HOME)) {
  const companionRoot = path.join(process.env.DSH_HOME, 'dsh-pet', 'electron-data');
  const companionPaths = { userData: 'profile', sessionData: 'session', crashDumps: 'crashes' };
  for (const [key, subdir] of Object.entries(companionPaths)) {
    const target = path.join(companionRoot, subdir);
    require('node:fs').mkdirSync(target, { recursive: true });
    app.setPath(key, target);
  }
  app.setAppLogsPath(path.join(companionRoot, 'logs'));
}
`;
  const anchor = "app.setName('dsh-pet-electron-helper');";
  const original = source.includes(marker) ? source.replace(insertion, '') : source;
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest !== '82446ade7388da6d09a1de655156ebd458657844dbffa3df22ed235672774ab0') {
    throw new Error('Upstream helper changed. Review it before applying the storage patch.');
  }
  if (source.includes(marker)) return;
  // Replace atomically, so a pnpm hard link never edits the shared package store.
  writeFileSync(path + '.companion-tmp', source.replace(anchor, anchor + insertion));
  renameSync(path + '.companion-tmp', path);
}
