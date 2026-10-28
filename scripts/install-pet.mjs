import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';
import { patchPetStorage } from './patch-pet-storage.mjs';

async function run(args) {
  const child = spawn(process.execPath, args, { cwd: projectRoot, env: projectEnvironment(), stdio: 'inherit', windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installer step failed (${code}).`)));
  });
}

try {
  requireSupportedNode();
  const cli = join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
  if (!existsSync(cli)) throw new Error('Install DSH first: npm run runtime:install');
  const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const pnpmManifest = join(projectRoot, '.tools/package-manager/node_modules/pnpm/package.json');
  if (!existsSync(pnpmManifest) || JSON.parse(readFileSync(pnpmManifest, 'utf8')).version !== '11.28.5') {
    await run([npm, 'install', '--prefix', join(projectRoot, '.tools/package-manager'), '--save-exact', 'pnpm@11.28.5', '--ignore-scripts', '--no-audit', '--no-fund']);
  }
  await run([cli, 'plugin', '--profile', 'web', 'add', 'dsh-pet@0.3.8', '--save-exact',
    '--store-dir', join(projectRoot, '.cache/pnpm-store'), '--cache-dir', join(projectRoot, '.cache/pnpm')]);
  patchPetStorage();
  const petHome = join(projectRoot, '.dsh/dsh-pet');
  mkdirSync(petHome, { recursive: true });
  const config = join(petHome, 'main-config.jsonc');
  if (!existsSync(config)) copyFileSync(join(projectRoot, 'config/pet.example.json'), config);
  const electronHome = join(projectRoot, '.dsh/electron');
  const executable = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  if (!existsSync(join(electronHome, executable))) {
    const require = createRequire(join(projectRoot, '.dsh/profiles/web/node_modules/dsh-pet/package.json'));
    const { downloadArtifact } = await import(pathToFileURL(require.resolve('@electron/get')).href);
    const { default: extract } = await import(pathToFileURL(require.resolve('@electron-internal/extract-zip')).href);
    mkdirSync(electronHome, { recursive: true });
    console.log('Downloading Electron 43.3.0 into the project (SHA256 checked by @electron/get)…');
    const zip = await downloadArtifact({
      version: '43.3.0', artifactName: 'electron', cacheRoot: join(projectRoot, '.cache/electron'),
      mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/' },
      downloadOptions: { quiet: true, signal: AbortSignal.timeout(600_000) },
    });
    await extract(zip, { dir: electronHome });
  }
  console.log('Pet installed. Start it with npm run pet. Automatic model chatter is disabled in the initial configuration.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
