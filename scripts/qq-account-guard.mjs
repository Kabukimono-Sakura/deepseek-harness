import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {projectRoot} from './project-env.mjs';
import {NapcatLoginClient} from './napcat-login-client.mjs';
import {isExpectedProcess} from './process-identity.mjs';
const exec=promisify(execFile);
export async function verifyAccount(client,expected,disconnect){
 const state=await client.request('CheckLoginStatus');
 if(!state.isLogin)return {verified:false,expected};
 const info=await client.request('GetQQLoginInfo');const actual=String(info.uin??'');
 if(!/^[1-9]\d*$/.test(actual))throw Error('无法核验登录账号');
 if(actual===expected)return {verified:true,expected,actual};
 let disconnected=false;try{await disconnect();disconnected=true;}catch{}
 return {verified:false,expected,actual,mismatch:true,disconnected};
}
export async function checkAccount(){
 const expected=JSON.parse(readFileSync(join(projectRoot,'config/local.json'),'utf8')).qq.accountId;
 const result=await verifyAccount(new NapcatLoginClient(),expected,async()=>{
  const pid=Number(readFileSync(join(projectRoot,'tmp/napcat-node.pid'),'utf8'));
  const executable=join(projectRoot,'.runtime/napcat-node-v4.18.41/node.exe');
  if(await isExpectedProcess(pid,executable)!==true)throw Error('无法确认登录进程');
  await exec('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10000});
 });
 if(result.mismatch||result.verified){mkdirSync(join(projectRoot,'data'),{recursive:true});writeFileSync(join(projectRoot,'data/qq-account-status.json'),JSON.stringify({...result,updatedAt:Date.now()}));}
 return result;
}
