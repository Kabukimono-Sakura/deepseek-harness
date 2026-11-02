import {createServer} from 'node:http';
import {writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import QRCode from 'qrcode';
import {projectRoot} from './project-env.mjs';
import {NapcatLoginClient,LiveLoginState} from './napcat-login-client.mjs';

export async function createLoginViewer({state=new LiveLoginState(new NapcatLoginClient()),idleMs=30*60_000}={}){
  const access=randomBytes(24).toString('hex'),prefix='/'+access;let touched=Date.now();
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>QQ 实时扫码登录</title>
<style>body{font:18px system-ui;background:#fff4f8;text-align:center;padding:35px;color:#472b3d}main{max-width:560px;margin:auto;background:white;padding:28px;border-radius:24px}img{width:320px;height:320px}button{padding:12px 25px;border:0;border-radius:9px;background:#c35384;color:white;font-size:16px;cursor:pointer}p{line-height:1.6}small{color:#775969}</style>
<main><h1>QQ 实时扫码登录</h1><p>使用 Agent QQ 扫码，并在手机上确认。</p><img id="qr" hidden alt="等待生成二维码"><p id="status">正在连接 NapCat…</p><button id="refresh">重新生成二维码</button><p><small>二维码到期前自动更新；打开此页面时会持续同步登录状态。</small></p></main>
<script nonce="${access}">
const qr=document.getElementById('qr'),status=document.getElementById('status'),button=document.getElementById('refresh');let busy=false,version='';
async function update(force=false){if(busy)return;busy=true;button.disabled=true;try{if(force)status.textContent='正在重新生成…';const response=await fetch('${prefix}/'+(force?'refresh':'state'),{method:force?'POST':'GET',cache:'no-store',headers:force?{'X-Login-Refresh':'1'}:{}});if(!response.ok)throw Error();const data=await response.json();if(data.phase==='logged-in'){qr.hidden=true;status.textContent='已登录成功，可以返回控制面板。';button.hidden=true;return;}button.hidden=false;if(data.version&&version!==data.version){version=data.version;qr.src='${prefix}/qr?v='+version+'&t='+Date.now();}qr.hidden=!data.version;status.textContent=data.phase==='confirm'?'已扫码，请在手机 QQ 上确认。若已失效，可点击重新生成。':data.phase==='waiting'?'请扫码。二维码更新时间：'+new Date(data.refreshedAt).toLocaleTimeString():'正在等待 NapCat 生成新二维码…';}catch{qr.hidden=true;version='';status.textContent='暂时无法获取有效二维码，请稍后重试；不会显示旧图片。';}finally{busy=false;button.disabled=false;}}
button.addEventListener('click',()=>update(true));qr.addEventListener('error',()=>{qr.hidden=true;version='';});update();setInterval(update,2000);
</script></html>`;
  const server=createServer(async(request,response)=>{
    response.setHeader('X-Login-Viewer','2');
    response.setHeader('Cache-Control','no-store, max-age=0');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${access}'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'`);
    const path=new URL(request.url,'http://127.0.0.1').pathname;
    if(![prefix,prefix+'/state',prefix+'/qr',prefix+'/refresh'].includes(path)){response.writeHead(404);response.end();return;}
    const refresh=path===prefix+'/refresh';
    if(refresh?(request.method!=='POST'||request.headers['x-login-refresh']!=='1'):request.method!=='GET'){response.writeHead(405);response.end();return;}
    touched=Date.now();
    try{
      if(path===prefix){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;}
      const snapshot=await state.snapshot(refresh);
      if(path===prefix+'/qr'){
        if(!snapshot.version||!state.qrUrl){response.writeHead(409);response.end();return;}
        response.setHeader('Content-Type','image/svg+xml');response.end(await QRCode.toString(state.qrUrl,{type:'svg',margin:2,errorCorrectionLevel:'M'}));
      }else{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(snapshot));}
    }catch{response.writeHead(503);response.end('Login service temporarily unavailable');}
  });
  server.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const close=()=>{clearInterval(timer);server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
  const timer=setInterval(()=>{if(Date.now()-touched>idleMs)void close();},10000);timer.unref();
  return {url:`http://127.0.0.1:${server.address().port}${prefix}`,close};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const viewer=await createLoginViewer();const instance=process.argv[2]??randomBytes(12).toString('hex');
  await mkdir(join(projectRoot,'tmp'),{recursive:true});
  await writeFile(join(projectRoot,'tmp/qq-login-url.txt'),viewer.url);
  await writeFile(join(projectRoot,'tmp/qq-login-viewer.json'),JSON.stringify({version:2,instance,pid:process.pid,url:viewer.url}));
  console.log('Live NapCat login viewer ready.');
}
