import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createQqEditor} from '../scripts/qq-wechat-editor.mjs';
import {approvesCurrentDraft} from '../scripts/qq-editor-intent.mjs';
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

test('natural conversation retains briefs and binds edits and approvals to a delivered review', async t=>{
 const root=mkdtempSync(join(tmpdir(),'qq-natural-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'assets/wechat'),{recursive:true});
 writeFileSync(join(root,'assets/wechat/qq-cover.png'),'cover');
 const settings={accountId:'10001',ownerId:'10002'};
 const owner=JSON.stringify(['qq-onebot','10001','private','10002']);
 const briefs=[],uploads=[],delivered=new Set();
 let intent,ctx;
 const options={settings,root,config:()=>({enabled:true,accountName:'test'}),appid:()=>'app',
  classify:async (_,state)=>{ctx=state;return intent;},delivered:id=>delivered.has(id),
  run:async ([op,id,file])=>{
   if(op==='generate'){
    briefs.push(JSON.parse(readFileSync(file)));
    writeFileSync(join(root,'data/wechat/articles',id,'article.json'),JSON.stringify({
     title:'第'+briefs.length+'版',author:'鱼',digest:'导读',paragraphs:['正文'],sources:[]
    }));
   }
   if(op==='upload'){uploads.push(id);return {media_id:'ok'};}
  }};
 let editor=createQqEditor(options), sequence=0;
 const say=async(text,action,code)=>{intent={action,code};return editor.handle({id:owner,eventId:String(++sequence)},text);};
 const peek=reply=>reply.bubbles[0].text;
 assert.match(await say('鱼鱼，想请你写个推文，短一点','askTopic'),/主题/);
 assert.match(peek(await say('就说说整理书桌','create')),/第1版/);
 assert.equal(ctx.awaitingTopic,true);assert.match(briefs[0].topic,/短一点[\s\S]*整理书桌/);
 editor=createQqEditor(options);
 assert.match(peek(await say('第一段读着有点端，换个开头','revise')),/第2版/);
 assert.equal(briefs[1].previousArticle.title,'第1版');
 assert.equal(await say('你今天吃了什么','chat'),null);
 assert.match(peek(await say('这版放进草稿箱吧','upload')),/第2版/);
 assert.equal(uploads.length,0); // Prior preview had no delivery receipt.
 delivered.add(String(sequence));
 assert.match(await say('这版放进草稿箱吧','upload'),/已存入/);
 assert.match(await say('那篇再给我看看','choose'),/回我序号/);
 assert.match(peek(await say('2')),/第1版/);delivered.add(String(sequence));
 assert.match(await say('放进草稿箱是什么意思？','upload'),/是要现在/);
 assert.equal(uploads.length,1);delivered.add(String(sequence));
 await say('先别放','chat');
 assert.equal(await say('好','chat'),null);assert.equal(uploads.length,1);
 await say('我已经审好了，可以替我安排进微信草稿箱啦','upload');delivered.add(String(sequence));
 assert.match(await say('好'),/已存入/);assert.equal(uploads.length,2);
 assert.notEqual(uploads[0],uploads[1]);
});

test('immediate natural approvals require an affirmative instruction to file the draft',()=>{
 for(const msg of ['这版放进草稿箱吧','好了，把这篇存到公众号草稿箱里','直接传到微信草稿箱！'])
  assert.ok(approvesCurrentDraft(msg),msg);
 for(const msg of ['好','你能放到草稿箱吗','如果改好了就放进草稿箱吧','先不要放进草稿箱','他说“这版放进草稿箱吧”'])
  assert.equal(approvesCurrentDraft(msg),false,msg);
});
