import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { projectRoot } from './project-env.mjs';

// Local credentials and account identities stay in ignored configuration files.
process.loadEnvFile(join(projectRoot, '.env'));
const config = JSON.parse(readFileSync(join(projectRoot, 'config/local.json'), 'utf8'));
if (!/^[1-9]\d*$/.test(config.qq.accountId)) throw new Error('Configure qq.accountId first.');
const token = process.env[config.qq.tokenEnv || 'ONEBOT_ACCESS_TOKEN'];
if (!token?.trim()) throw new Error('Configure the OneBot token locally first.');
const folder = join(projectRoot, 'data/napcat/config');
mkdirSync(folder, { recursive: true });
const webPath = join(folder, 'webui.json');
const web = existsSync(webPath) ? JSON.parse(readFileSync(webPath, 'utf8')) : {};
Object.assign(web, { host: '127.0.0.1', port: 6099, disableWebUI: false });
if (!web.token) web.token = randomBytes(32).toString('hex');
writeFileSync(webPath, JSON.stringify(web, null, 2));
const onebotPath = join(folder, `onebot11_${config.qq.accountId}.json`);
if (existsSync(onebotPath)) {
  console.log('Existing OneBot configuration preserved; review it in NapCat WebUI.');
} else {
  writeFileSync(onebotPath, JSON.stringify({ network: {
    httpServers: [], httpSseServers: [], httpClients: [], websocketClients: [], plugins: [],
    websocketServers: [{ name: 'local-agent', enable: true, host: '127.0.0.1', port: 3001,
      messagePostFormat: 'array', reportSelfMessage: false, token, enableForcePushEvent: true,
      debug: false, heartInterval: 30000 }],
  }, enableLocalFile2Url: false, parseMultMsg: false }, null, 2));
}
console.log('Local NapCat configuration prepared. WebUI: http://127.0.0.1:6099');
console.log('WebUI token is in data/napcat/config/webui.json; never publish this file.');
