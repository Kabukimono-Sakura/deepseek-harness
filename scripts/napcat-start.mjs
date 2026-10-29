import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { projectRoot, projectEnvironment } from './project-env.mjs';
import {isExpectedProcess} from './process-identity.mjs';

if (process.platform !== 'win32') throw new Error('This launcher supports Windows only.');
const runtime = join(projectRoot, '.runtime/napcat-node-v4.18.41');
const executable = join(runtime, 'node.exe');
if (!existsSync(executable)) throw new Error('Install the verified NapCat.Shell.Windows.Node v4.18.41 package first.');
const pidFile = join(projectRoot, 'tmp/napcat-node.pid');
if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid NapCat process record; review locally.');
  let active = true;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
  if(active&&await isExpectedProcess(pid,executable)===false)active=false;
  if (active) throw new Error('Recorded NapCat process is still running.');
}
const listening = await new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port: 6099 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
});
if (listening) throw new Error('Port 6099 is already in use; inspect the existing host first.');
await import('./napcat-configure.mjs');
const profile = join(projectRoot, 'data/napcat/profile');
const roaming = join(profile, 'AppData/Roaming');
const local = join(profile, 'AppData/Local');
for (const path of [profile, roaming, local, join(projectRoot, 'tmp')]) mkdirSync(path, { recursive: true });
const stdout = openSync(join(projectRoot, 'tmp/napcat.stdout.log'), 'a');
const stderr = openSync(join(projectRoot, 'tmp/napcat.stderr.log'), 'a');
// Keep this child profile local; never change the user's global Windows settings.
const env = { ...projectEnvironment(), USERPROFILE: profile, APPDATA: roaming, LOCALAPPDATA: local,
  NAPCAT_WORKDIR: join(projectRoot, 'data/napcat') };
// The platform process does not need model-provider credentials.
delete env.DEEPSEEK_API_KEY;
delete env.ONEBOT_ACCESS_TOKEN;
try {
  const child = spawn(executable, [join(runtime, 'index.js')], { cwd: runtime, env,
    windowsHide: true, detached: true, stdio: ['ignore', stdout, stderr] });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  writeFileSync(pidFile, String(child.pid)); child.unref();
} finally { closeSync(stdout); closeSync(stderr); }
console.log('NapCat launch requested. Complete QQ authentication in its local WebUI.');
