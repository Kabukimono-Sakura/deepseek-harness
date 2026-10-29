import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { projectRoot } from './project-env.mjs';

// Short-lived local viewer; shows the current QR image without handling login.
const access = randomBytes(24).toString('hex');
const prefix = '/' + access;
const qr = join(projectRoot, 'data/napcat/cache/qrcode.png');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>QQ 扫码登录</title>
<style>body{font:18px system-ui;background:#fff4f8;text-align:center;padding:40px;color:#472b3d}main{max-width:560px;margin:auto;background:white;padding:30px;border-radius:24px}img{width:320px;height:320px;image-rendering:pixelated}p{line-height:1.6}small{color:#775969}</style>
<main><h1>QQ 扫码登录</h1><p>请使用指定的 Agent QQ 账号扫码，并在手机上确认。</p><img id="qr" alt="正在读取 NapCat 二维码"><p id="status">二维码每两秒从本机更新。</p><small>不要分享本页地址或二维码。此页面 15 分钟后自动关闭服务。</small></main>
<script nonce="${access}">async function refresh(){try{const r=await fetch('${prefix}/qr?t='+Date.now());if(!r.ok)throw Error();const blob=await r.blob();const old=document.getElementById('qr').src;document.getElementById('qr').src=URL.createObjectURL(blob);if(old.startsWith('blob:'))URL.revokeObjectURL(old);document.getElementById('status').textContent='当前二维码生成时间：'+new Date(r.headers.get('Last-Modified')).toLocaleTimeString()+'。扫码后请在手机确认。';}catch{document.getElementById('status').textContent='暂时读不到二维码，请确认 NapCat 已启动。';}}refresh();setInterval(refresh,2000);</script></html>`;
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${access}'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; frame-ancestors 'none'`);
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (request.method !== 'GET' || (path !== prefix && path !== prefix + '/qr')) { response.writeHead(404); response.end(); return; }
  try {
    if (path === prefix) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); }
    else { const info = await stat(qr); const image = await readFile(qr); response.setHeader('Content-Type', 'image/png'); response.setHeader('Last-Modified', info.mtime.toUTCString()); response.end(image); }
  } catch { response.writeHead(503); response.end('QR not available'); }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
await writeFile(join(projectRoot, 'tmp/qq-login-url.txt'), `http://127.0.0.1:${server.address().port}${prefix}`);
console.log('Local QR viewer ready. Address saved in tmp/qq-login-url.txt.');
setTimeout(() => { server.close(); server.closeAllConnections(); }, 15 * 60 * 1000);
