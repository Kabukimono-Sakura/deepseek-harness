import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './project-env.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const meetsDshFloor = major > 24 || (major === 24 && minor >= 9);
const manifest = join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/package.json');
let dshVersion = null;
if (existsSync(manifest)) dshVersion = JSON.parse(readFileSync(manifest, 'utf8')).version;
console.log(JSON.stringify({
  node: process.versions.node,
  nodeExecutable: process.execPath,
  meetsResearchedDshNodeFloor: meetsDshFloor,
  projectRoot,
  localDshPackageVersion: dshVersion,
  localConfigExists: existsSync(join(projectRoot, 'config/local.json')),
  envFileExists: existsSync(join(projectRoot, '.env')),
  scope: 'Environment inspection only; no network, credentials or platform connectivity checks.',
}, null, 2));
process.exitCode = meetsDshFloor ? 0 : 1;
