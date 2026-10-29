import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OneBotClient } from '../src/channels/onebot-client.ts';
import { QqStore } from '../src/core/qq-store.ts';
import { QqRouter } from '../src/core/qq-router.ts';
import { JsonRpcProcess } from '../src/backends/jsonrpc-process.ts';
import { DshBackend } from '../src/backends/dsh.ts';
import { projectRoot, projectEnvironment, requireSupportedNode } from './project-env.mjs';

let client, store, router, activeRpc;
const lockPath=join(projectRoot,'data/qq-bridge.lock.json');
const nonce=randomUUID();
let ownsLock=false;
try {
  requireSupportedNode();
  if(existsSync(join(projectRoot,'.env')))process.loadEnvFile(join(projectRoot,'.env'));
  const config=JSON.parse(readFileSync(join(projectRoot,'config/local.json'),'utf8')).qq;
  if(config.enabled!==true)throw new Error('Enable qq in config/local.json after configuring NapCat.');
  const validIds=value=>Array.isArray(value)&&value.every(id=>typeof id==='string'&&/^[1-9]\d*$/.test(id));
  if(!validIds(config.allowedUsers)||!validIds(config.allowedGroups)||config.allowedUsers.length===0||typeof config.requireMention!=='boolean')throw new Error('Configure explicit QQ contact/group allowlists first.');
  if(!process.env.DEEPSEEK_API_KEY?.trim())throw new Error('Configure DEEPSEEK_API_KEY locally.');
  const cli=join(projectRoot,'.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
  if(!existsSync(cli))throw new Error('Run npm run runtime:install first.');
  mkdirSync(join(projectRoot,'data'),{recursive:true});
  if(existsSync(lockPath)){
    const previous=JSON.parse(readFileSync(lockPath,'utf8'));
    if(!Number.isInteger(previous.pid)||previous.pid<=0)throw new Error('Invalid QQ process lock; review it locally.');
    let active=true;try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')active=false;}
    if(active)throw new Error('Another QQ bridge process is active.');
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath,JSON.stringify({pid:process.pid,nonce}),{flag:'wx'}); ownsLock=true;
  store=new QqStore(join(projectRoot,'data/qq.sqlite'));
  client=new OneBotClient({url:config.url,accountId:config.accountId,token:process.env[config.tokenEnv||'ONEBOT_ACCESS_TOKEN']??''});
  const workspace=join(projectRoot,'data/qq-workspace');mkdirSync(workspace,{recursive:true});
  router=new QqRouter({store,transport:client,policy:config,accountId:config.accountId,
    log:event=>console.log('[QQ] '+event),
    generate:async(conversation,text)=>{
      const rpc=new JsonRpcProcess(process.execPath,[cli,'--profile','sdk-minimal','--patch',join(projectRoot,'config/companion.patch.yml')],{cwd:workspace,env:projectEnvironment(),timeoutMs:180_000});
      activeRpc=rpc;
      try{
        const backend=new DshBackend(rpc);await backend.initialize(workspace,process.env.DEEPSEEK_MODEL||'deepseek-flash');
        if(conversation.resume)await backend.resume(conversation.sessionId);
        const reply=await backend.turn(conversation.sessionId,text);
        await rpc.request('shutdown');return reply;
      }finally{rpc.close();if(activeRpc===rpc)activeRpc=undefined;}
    },
  });
  client.on('ready',()=>{console.log('[QQ] authenticated account verified; ready for allowed contacts');void router.pump();});
  client.on('offline',()=>console.log('[QQ] disconnected; reconnecting unless stopped'));
  client.on('message',event=>router.receive(event));
  await new Promise(resolve=>{
    process.once('SIGINT',resolve);process.once('SIGTERM',resolve);
    client.on('diagnostic',code=>{
      console.log('[QQ] '+code);
      if(code==='account-mismatch'){process.exitCode=1;resolve();}
    });
    client.start();
  });
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  client?.stop();activeRpc?.close();await router?.stop();store?.close();
  if(ownsLock&&existsSync(lockPath)&&JSON.parse(readFileSync(lockPath,'utf8')).nonce===nonce)unlinkSync(lockPath);
}
