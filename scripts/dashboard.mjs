import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConnection} from 'node:net';
import {projectRoot,projectEnvironment} from './project-env.mjs';
import {isExpectedProcess} from './process-identity.mjs';
const exec=promisify(execFile);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const local=name=>join(projectRoot,name);
function json(path){try{return JSON.parse(readFileSync(local(path),'utf8'));}catch{return null;}}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}}
export function bridgeState(lock,health,now=Date.now(),isAlive=alive){
  if(!lock||!isAlive(lock.pid))return 'stopped';
  if(!health||health.nonce!==lock.nonce||health.pid!==lock.pid||now-health.updatedAt>15000)return 'starting';
  return health.connected?'connected':'waiting';
}
export function desktopEnabled(config){return Object.values(config??{}).some(entry=>Array.isArray(entry?.pets)&&entry.pets.some(pet=>pet.id==='main'&&['desktop','both'].includes(pet.display)));}
function portOpen(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(700,()=>finish(false));});}
async function petRequest(path,body){
  const response=await fetch('http://127.0.0.1:3847/dsh-pet-7340/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(3500)});
  if(!response.ok)throw new Error('桌宠服务暂时不可用');
  const value=await response.json();if(value.ok===false)throw new Error('桌宠设置未成功，请查看日志');return value;
}
function launch(script,args=[],name='dashboard-child'){
  mkdirSync(local('tmp'),{recursive:true});
  const out=openSync(local('tmp/'+name+'.stdout.log'),'a'),err=openSync(local('tmp/'+name+'.stderr.log'),'a');
  try{const child=spawn(process.execPath,[local(script),...args],{cwd:projectRoot,env:projectEnvironment(),detached:true,windowsHide:true,stdio:['ignore',out,err]});child.on('error',()=>{});child.unref();return child.pid;}
  finally{closeSync(out);closeSync(err);}
}
async function until(condition,timeout){const end=Date.now()+timeout;while(Date.now()<end){if(await condition())return true;await delay(250);}return false;}
export async function status(){
  const lock=json('data/qq-bridge.lock.json'),health=json('data/qq-health.json');
  const [napcat,pet]=await Promise.all([portOpen(6099),petRequest('config').catch(()=>null)]);
  let qq=bridgeState(lock,health);
  if(qq==='starting'&&await isExpectedProcess(lock.pid,process.execPath,'scripts/qq.mjs')===false)qq='stopped';
  return {qq,napcat,pet:pet?(desktopEnabled(pet)?'shown':'hidden'):'stopped',root:projectRoot};
}
async function ensureNapcat(){
  if(await portOpen(6099))return;
  try{await exec(process.execPath,[local('scripts/napcat-start.mjs')],{cwd:projectRoot,env:projectEnvironment(),windowsHide:true,timeout:20000});}
  catch{throw new Error('NapCat 未能启动，请查看 tmp 中的 NapCat 日志。');}
  if(!await until(()=>portOpen(6099),25000))throw new Error('NapCat 仍在启动，请稍后重试。');
}
async function qqStart(){
  await ensureNapcat();
  const lock=json('data/qq-bridge.lock.json');
  if(!lock||!alive(lock.pid)||await isExpectedProcess(lock.pid,process.execPath,'scripts/qq.mjs')===false){
    const pid=launch('scripts/qq.mjs',[],'qq');writeFileSync(local('tmp/qq-host.pid'),String(pid));
    if(!await until(()=>{const current=json('data/qq-bridge.lock.json');return current?.pid===pid&&alive(pid);},10000))throw new Error('QQ 聊天服务未能启动，请查看日志。');
  }
  return 'QQ 聊天已启用；若尚未登录，请点击扫码登录。';
}
async function qqStop(){
  const lock=json('data/qq-bridge.lock.json');
  if(!lock||!alive(lock.pid)||await isExpectedProcess(lock.pid,process.execPath,'scripts/qq.mjs')===false)return 'QQ 聊天已经停用。';
  writeFileSync(local('data/qq-stop.json'),JSON.stringify({nonce:lock.nonce}));
  if(!await until(()=>!existsSync(local('data/qq-bridge.lock.json'))||!alive(lock.pid),210000))throw new Error('当前回复还在收尾，请稍后重试；没有强制结束进程。');
  return 'QQ 聊天已停用，登录状态保留。';
}
async function petStart(){
  if(!await portOpen(3847)){
    const pid=launch('scripts/dsh.mjs',['web','--no-open','--host','127.0.0.1','--port','3847'],'pet');writeFileSync(local('tmp/pet-host.pid'),String(pid));
    if(!await until(async()=>Boolean(await petRequest('config').catch(()=>null)),45000))throw new Error('桌宠还未启动成功，请查看桌宠日志。');
  }
  const config=await petRequest('pet-display',{id:'main',display:'desktop'});
  if(!desktopEnabled(config))throw new Error('桌宠没有切换到桌面显示。');
  return '桌宠已打开。';
}
async function petStop(){
  if(!await portOpen(3847))return '桌宠已经关闭。';
  const config=await petRequest('pet-display',{id:'main',display:'none'});
  if(desktopEnabled(config))throw new Error('桌宠尚未关闭。');
  return '桌宠已关闭，显示服务在后台待机。';
}
async function login(){
  await ensureNapcat();
  launch('scripts/qq-login.mjs',[],'qq-login');
  if(!await until(async()=>{
    try{const url=readFileSync(local('tmp/qq-login-url.txt'),'utf8').trim();const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.protocol!=='http:')return false;return (await fetch(url,{signal:AbortSignal.timeout(1000),redirect:'error'})).ok;}catch{return false;}
  },10000))throw new Error('扫码页面未准备好，请稍后重试。');
  return {message:'已打开实时扫码页，使用 Agent QQ 扫码并在手机确认。',url:readFileSync(local('tmp/qq-login-url.txt'),'utf8').trim()};
}
export async function command(action){
  switch(action){
    case 'status':return {ok:true,...await status()};
    case 'qq-start':return {ok:true,message:await qqStart()};
    case 'qq-stop':return {ok:true,message:await qqStop()};
    case 'pet-start':return {ok:true,message:await petStart()};
    case 'pet-stop':return {ok:true,message:await petStop()};
    case 'login':return {ok:true,...await login()};
    case 'all-start':await qqStart();await petStart();return {ok:true,message:'QQ 聊天和桌宠已启用。'};
    case 'all-stop':await qqStop();await petStop();return {ok:true,message:'QQ 聊天和桌宠已停用，QQ 登录保留。'};
    default:throw new Error('未知面板操作');
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{console.log(JSON.stringify(await command(process.argv[2]??'status')));}
  catch(error){console.log(JSON.stringify({ok:false,message:error.message}));process.exitCode=1;}
}
