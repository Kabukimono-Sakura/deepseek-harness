import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

requireSupportedNode();
const cli = join(projectRoot, '.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
const child = spawn(process.execPath, [cli, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
  cwd: projectRoot, env: projectEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
// Keep bootstrap tokens in process memory. Neither stdout nor CI artifacts contain them.
child.stderr.resume();
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Web startup exceeded 240 seconds.')), 240_000);
    const fail = () => { clearTimeout(timer); reject(new Error('Web exited before readiness.')); };
    child.once('error', fail);
    child.once('exit', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-64_000);
      const found = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);
      if (found) {
        clearTimeout(timer);
        child.off('exit', fail);
        resolve(new URL(found[1]));
      }
    });
  });
  const anonymous = await fetch(url.origin, { signal: AbortSignal.timeout(10_000) });
  if (anonymous.status !== 401) throw new Error(`Unexpected anonymous HTTP status: ${anonymous.status}`);
  const bootstrap = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  let page = bootstrap;
  if ([302, 303, 307].includes(bootstrap.status)) {
    const destination = new URL(bootstrap.headers.get('location'), url);
    if (destination.origin !== url.origin) throw new Error('Unexpected bootstrap redirect.');
    const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    page = await fetch(destination, { headers: { cookie }, signal: AbortSignal.timeout(10_000) });
  }
  if (page.status !== 200 || !(page.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error(`Authenticated UI unavailable (${page.status}).`);
  }
  const html = await page.text();
  if (!html.includes('<html')) throw new Error('UI did not return an HTML document.');
  console.log('DSH Web smoke passed: loopback binding, anonymous 401, authenticated HTML 200. No model request made.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { child.kill(); }
