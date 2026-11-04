import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {projectRoot} from './project-env.mjs';
export function greetingMessage(settings,id,now=Date.now()){
 return {channel:'qq-onebot',accountId:settings.accountId,senderId:settings.ownerId,conversationId:JSON.stringify(['qq-onebot',settings.accountId,'private',settings.ownerId]),eventId:'panel-test:'+id,source:'proactive',text:'[控制面板测试] 主人点击了测试打招呼按钮。请用你平时对主人的语气发一句简短问候，让主人确认 QQ 已连通。本次必须回复纯文字，不要表情图片。',replyTarget:{kind:'private',id:settings.ownerId},expiresAt:now+180000};
}
export function startGreetingControl({nonce,settings,client,router,store,directory=join(projectRoot,'data')}){
 const request=join(directory,'qq-greeting-request.json'),result=join(directory,'qq-greeting-result.json');let pending;
 const report=(id,state)=>writeFileSync(result,JSON.stringify({id,state,updatedAt:Date.now()}));
 const timer=setInterval(()=>{try{
  if(pending){const row=store.get('panel-test:'+pending);if(row&&!['received','processing','ready','sending'].includes(row.state)){report(pending,row.state);pending=undefined;}}
  if(pending||!existsSync(request))return;
  const value=JSON.parse(readFileSync(request,'utf8'));unlinkSync(request);
  if(!/^[a-f0-9-]{36}$/.test(value.id))return;
  if(value.nonce!==nonce||Date.now()-value.createdAt>15000||!client.ready||!settings){report(value.id,'unavailable');return;}
  if(router.enqueue(greetingMessage(settings,value.id))){pending=value.id;report(value.id,'queued');}else report(value.id,'failed');
 }catch{}},500);
 return ()=>clearInterval(timer);
}
