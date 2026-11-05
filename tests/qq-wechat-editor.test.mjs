import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createQqEditor} from '../scripts/qq-wechat-editor.mjs';
import {QqRouter} from '../src/core/qq-router.ts';
import {QqStore} from '../src/core/qq-store.ts';

test('authenticated QQ events route through full review, revision and version-specific confirmation',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qq-wechat-'));
 mkdirSync(join(root,'assets/wechat'),{recursive:true});writeFileSync(join(root,'assets/wechat/qq-cover.png'),'cover');
 const settings={accountId:'10001',ownerId:'10002'};
 const calls=[],sent=[],store=new QqStore(':memory:');
 const editor=createQqEditor({settings,root,config:()=>({enabled:true,accountName:'Test'}),appid:()=>'test-app',run:async ([action,id,file])=>{
  calls.push([action,id]);
  if(action==='generate'){
   const brief=JSON.parse(readFileSync(file));const article={title:brief.topic,author:'作者',digest:'导读',paragraphs:['文章正文'],sources:[]};
   writeFileSync(join(root,'data/wechat/articles',id,'article.json'),JSON.stringify(article));
  }
  if(action==='upload')return {media_id:'receipt'};
 }});
 const router=new QqRouter({accountId:settings.accountId,policy:{allowedUsers:['10002','10003'],allowedGroups:[],requireMention:true},
  store,transport:{ready:true,async request(_,params){sent.push(params);return {message_id:sent.length};}},
  imageFile:async key=>editor.imageFile(key),generate:async(c,text)=>await editor.handle(c,text)??'ordinary chat',
  yieldToNewMessages:true,preserveReply:message=>editor.handles(message)});
 t.after(async()=>{await router.stop();store.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});});
 const event=(id,text,user=10002)=>({post_type:'message',message_type:'private',sub_type:'friend',user_id:user,self_id:10001,message_id:id,message:[{type:'text',data:{text}}]});
 const send=async (...args)=>{router.receive(event(...args));await router.pump();};
 await send(1,'公众号写稿：测试选题',10003);assert.equal(calls.length,0);
 const first=event(2,'公众号写稿：测试选题');router.receive(first);router.receive(first);await router.pump();
 assert.deepEqual(calls.map(x=>x[0]),['generate']);
 const code=()=>sent.at(-1).message[0].data.text.match(/稿号 ([0-9a-f]{12})/)[1];
 const old=code();assert.ok(sent.some(p=>p.message[0].type==='image'));
 await send(3,'公众号改稿 '+old+' 修改标题');const revision=code();assert.notEqual(revision,old);
 await send(4,'确认入草稿箱 '+revision,10003);assert.equal(calls.length,2);
 assert.equal(await editor.handle({id:JSON.stringify(['qq-onebot','10001','group','10002'])},'确认入草稿箱 '+revision),null);
 await send(5,'确认入草稿箱 '+revision);assert.deepEqual(calls.slice(-3).map(x=>x[0]),['probe','approve','upload']);assert.equal(calls.at(-1)[1],calls[1][1]);
 writeFileSync(join(root,'data/wechat/articles',calls[0][1],'cover.png'),'changed');await send(6,'确认入草稿箱 '+old);assert.equal(calls.length,5);assert.match(sent.at(-1).message[0].data.text,/变化/);
});
