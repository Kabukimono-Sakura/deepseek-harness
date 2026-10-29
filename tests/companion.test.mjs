import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {QqStore} from '../src/core/qq-store.ts';
import {QqRouter} from '../src/core/qq-router.ts';
import {OneBotRequestError} from '../src/channels/onebot-client.ts';
import {parseOneBotMessage} from '../src/channels/onebot.ts';
import {parseReplyPlan,activeTime,nextWake,requestsAvatar} from '../src/core/companion.ts';
import {applyAvatar} from '../src/core/qq-avatar.ts';
import {qqImageUrl,describeQqImages} from '../src/channels/qq-images.ts';
import {startWakeups} from '../scripts/companion-runtime.mjs';
import {validImageUrl,validDisplayUrl} from '../scripts/companion-stickers.mjs';
const policy={allowedUsers:['10002'],allowedGroups:[],requireMention:true};
const event=id=>({post_type:'message',message_type:'private',sub_type:'friend',self_id:10001,user_id:10002,message_id:id,message:[{type:'text',data:{text:'hello '+id}}]});
const parsed=id=>parseOneBotMessage(event(id),policy).message;
function database(t){const path=mkdtempSync(join(tmpdir(),'companion-'));let store=new QqStore(join(path,'db'));t.after(()=>{store.close();assert.equal(dirname(resolve(path)),resolve(tmpdir()));rmSync(path,{recursive:true,force:true});});return {get store(){return store;},restart(){store.close();store=new QqStore(join(path,'db'));}};}

test('plans reject unknown images and malformed output; only proactive turns can remain silent',()=>{
  const ids=new Set(['known']);
  assert.deepEqual(parseReplyPlan('{"messages":[{"text":"好呀"},{"stickerId":"known"}]}',ids).bubbles,[{text:'好呀'},{stickerId:'known'}]);
  for(const raw of ['hello','{"messages":[]}','{"messages":[{"stickerId":"https://evil.example"}]}','{"messages":[{"text":"x","stickerId":"known"}]}'])assert.throws(()=>parseReplyPlan(raw,ids));
  assert.equal(parseReplyPlan('{"messages":[]}',ids,true).bubbles.length,0);
});

test('avatar plans require explicit authorization and known image sources',()=>{
  const raw='{"messages":[],"avatar":{"stickerId":"known"}}';
  assert.throws(()=>parseReplyPlan(raw,new Set(['known']),false));
  assert.deepEqual(parseReplyPlan(raw,new Set(['known']),false,true).avatar,{stickerId:'known'});
  assert.throws(()=>parseReplyPlan('{"messages":[],"avatar":{"imageIndex":4}}',new Set(),false,true,1));
  assert.deepEqual(parseReplyPlan('{"messages":[],"avatar":{"imageIndex":0}}',new Set(),false,true,1).avatar,{imageIndex:0});
  assert.equal(requestsAvatar('记得给自己换个头像'),true);assert.equal(requestsAvatar('把这张设为头像'),true);
  assert.equal(requestsAvatar('不要换头像'),false);assert.equal(requestsAvatar('你头像好可爱'),false);
  assert.equal(validDisplayUrl('https://xn--pssy23gqgbz2d718b.com/submissions/large/deepseek/x.webp'),true);
  assert.equal(validDisplayUrl('https://evil.test/submissions/large/deepseek/x.webp'),false);
});

test('avatar executes once and only reports the actual receipt; crash recovery never retries it',async t=>{
  const db=database(t);let calls=0;
  const options={authorized:true,eventId:'avatar1',choice:{stickerId:'known'},store:db.store,imageFile:async()=> 'file:///known-image.png',request:async(action,params)=>{calls++;assert.equal(action,'set_qq_avatar');assert.equal(params.file,'file:///known-image.png');return null;}};
  await assert.rejects(()=>applyAvatar({...options,authorized:false}));assert.equal(calls,0);
  assert.match(await applyAvatar(options),/接口确认成功/);assert.equal(calls,1);
  await applyAvatar(options);assert.equal(calls,1);
  assert.match(await applyAvatar({...options,eventId:'avatar2',request:async()=>{calls++;throw new Error('lost receipt');}}),/不能说换好了/);
  const before=calls;db.restart();await applyAvatar({...options,store:db.store,eventId:'avatar2'});assert.equal(calls,before);
  assert.match(await applyAvatar({...options,store:db.store,eventId:'avatar3',choice:{imageIndex:0},images:[{url:'file:///private.txt'}]}),/没有可用/);assert.equal(calls,before);
});

test('multi-bubble reconnect resumes at unsent bubble and never regenerates',async t=>{
  const db=database(t),sent=[];let generate=0;
  const transport={ready:true,async request(_,params){sent.push(params.message[0].data.text);if(sent.length===1)this.ready=false;return {message_id:sent.length};}};
  let router=new QqRouter({store:db.store,transport,policy,accountId:'10001',generate:async()=>{generate++;return {bubbles:[{text:'first'},{text:'second'},{text:'third'}]};}});
  router.receive(event(1));await router.pump();assert.deepEqual(sent,['first']);
  db.restart();transport.ready=true;
  router=new QqRouter({store:db.store,transport,policy,accountId:'10001',generate:async()=>{throw new Error('no regeneration');}});
  await router.pump();assert.deepEqual(sent,['first','second','third']);assert.equal(generate,1);
});

test('uncertain bubble stops the remaining series and is excluded from delivered memory',async t=>{
  const db=database(t);let count=0;
  const router=new QqRouter({store:db.store,transport:{ready:true,async request(){if(++count===2)throw new OneBotRequestError('lost',true);return {message_id:count};}},policy,accountId:'10001',generate:async()=>({bubbles:[{text:'delivered'},{text:'maybe delivered'},{text:'never sent'}]})});
  router.receive(event(1));await router.pump();assert.equal(count,2);
  const memory=JSON.parse(db.store.memory(parsed(1).conversationId,''));
  assert.equal(memory.history[0].delivered,'delivered');assert.equal(memory.history[0].deliveryState,'uncertain');
  db.restart();assert.equal(db.store.next(),undefined);
});

test('failed sticker preparation cannot wedge reconnect or be recorded as delivered',async t=>{
  const {store}=database(t),sent=[];
  const transport={ready:true,async request(_,params){sent.push(params.message[0].data.text);return {message_id:1};}};
  const router=new QqRouter({store,transport,policy,accountId:'10001',generate:async()=>({bubbles:[{stickerId:'missing'},{text:'still here'}]}),imageFile:async()=>{transport.ready=false;throw new Error('download failed');}});
  router.receive(event(1));await router.pump();assert.equal(sent.length,0);
  transport.ready=true;await router.pump();assert.deepEqual(sent,['still here']);assert.equal(store.get(parsed(1).eventId).state,'failed');
  const history=JSON.parse(store.memory(parsed(1).conversationId,'')).history;
  assert.equal(history[0].delivered,'still here');
});

test('new input interrupts remaining bubbles; debounced input remains in memory',async t=>{
  const db=database(t),sent=[];let router;
  router=new QqRouter({store:db.store,transport:{ready:true,async request(_,params){sent.push(params.message[0].data.text);if(sent.length===1)router.receive(event(2));return {message_id:sent.length};}},policy,accountId:'10001',yieldToNewMessages:true,
    generate:async(_,text)=>({bubbles:text==='hello 1'?[{text:'first'},{text:'stale'}]:[{text:'new response'}]})});
  router.receive(event(1));await router.pump();assert.deepEqual(sent,['first','new response']);
  assert.equal(db.store.get(parsed(1).eventId).state,'superseded');
  const other=database(t),generated=[];
  const debounced=new QqRouter({store:other.store,transport:{ready:true,async request(){return {message_id:1};}},policy,accountId:'10001',settleMs:5,yieldToNewMessages:true,generate:async(_,text)=>{generated.push(text);return 'yes';}});
  debounced.receive(event(3));debounced.receive(event(4));await debounced.pump();assert.deepEqual(generated,['hello 4']);
  assert.ok(other.store.memory(parsed(3).conversationId,'').includes('hello 3'));
});

test('archive retrieves older Chinese facts and isolates contacts and unsent content',t=>{
  const {store}=database(t);const old=parsed(1);old.text='我的测试词是粉色气泡';store.accept(old);store.saveReply(old.eventId,'知道了');store.setState(old.eventId,'sent');
  // Mark actual delivery; an outbox with no receipt must not be represented as sent.
  store.bubbleState(old.eventId,0,'sent','1');
  for(let i=2;i<40;i++){const m=parsed(i);store.accept(m);store.saveReply(m.eventId,'ordinary '+i);store.setState(m.eventId,'sent');store.bubbleState(m.eventId,0,'sent',String(i));}
  const foreign={...parsed(90),eventId:'foreign',conversationId:'other-contact',text:'private secret'};store.accept(foreign);store.saveReply(foreign.eventId,'secret reply');store.setState(foreign.eventId,'sent');
  const memory=store.memory(old.conversationId,'粉色气泡');assert.ok(memory.includes('我的测试词是粉色气泡'));assert.ok(!memory.includes('private secret'));assert.ok(!memory.includes('secret reply'));
});

test('proactive schedule stays in Shanghai daytime without a daily hard cap',()=>{
  for(let h=0;h<24;h++)for(const random of [0,0.5,0.999]){
    const now=Date.parse(`2026-10-29T${String(h).padStart(2,'0')}:55:00+08:00`);const due=nextWake(now,()=>random);
    assert.ok(due>now);assert.ok(activeTime(due));
  }
  assert.equal(activeTime(Date.parse('2026-10-29T07:59:59+08:00')),false);
  assert.equal(activeTime(Date.parse('2026-10-29T08:00:00+08:00')),true);
  assert.equal(activeTime(Date.parse('2026-10-30T00:00:00+08:00')),false);
});

test('scheduler claims one wakeup, skips restart backlog and postpones active conversation',t=>{
  const now=Date.parse('2026-10-29T12:00:00+08:00');t.mock.timers.enable({apis:['Date','setInterval'],now});
  const {store}=database(t),messages=[];const settings={accountId:'10001',ownerId:'10002',proactive:true};const id=parsed(1).conversationId;
  store.setWake(id,now-3600000);
  const stop=startWakeups({settings,store,router:{enqueue:message=>messages.push(message)},client:{ready:true}});t.after(stop);
  assert.ok(store.wakeDue(id,0)>now);t.mock.timers.tick(15000);assert.equal(messages.length,0);
  store.setWake(id,Date.now());t.mock.timers.tick(15000);assert.equal(messages.length,1);
  assert.equal(messages[0].source,'proactive');assert.equal(messages[0].replyTarget.id,'10002');assert.ok(messages[0].expiresAt>Date.now());
  t.mock.timers.tick(15000);assert.equal(messages.length,1);
  store.accept(parsed(10));store.setWake(id,Date.now());t.mock.timers.tick(15000);assert.equal(messages.length,1);assert.ok(store.wakeDue(id,0)>Date.now());
});

test('expired proactive work never calls the model or sends messages',async t=>{
  const {store}=database(t);store.accept({...parsed(1),source:'proactive',expiresAt:Date.now()-1});
  const router=new QqRouter({store,policy,accountId:'10001',transport:{ready:true,async request(){assert.fail('expired send');}},generate:async()=>{assert.fail('expired model call');}});
  await router.pump();assert.equal(store.get(parsed(1).eventId).state,'skipped');
});

test('QQ images stay opt-in; only trusted CDN URLs reach vision and failures do not invent captions',async()=>{
  const e=event(1);e.message=[{type:'image',data:{file:'file-id',url:'https://gchat.qpic.cn/image.png',summary:'[动画表情]'}}];
  assert.equal(parseOneBotMessage(e,policy).accepted,false);
  const message=parseOneBotMessage(e,{...policy,acceptImages:true}).message;assert.equal(message.images[0].url,e.message[0].data.url);assert.ok(!message.text.includes('https://'));
  for(const url of ['http://gchat.qpic.cn/x','https://127.0.0.1/x','file:///private','https://gchat.qpic.cn.evil.test/x','https://u:p@gchat.qpic.cn/x'])assert.equal(qqImageUrl(url),undefined);
  let called=0;
  const text=await describeQqImages(message.images,'test-key',async(url,options)=>{called++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(options.body);assert.equal(body.messages[1].content[1].image_url.url,e.message[0].data.url);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'一条蓝色小鱼'}}]}));});
  assert.equal(called,1);assert.ok(text.includes('一条蓝色小鱼'));
  assert.ok((await describeQqImages(message.images,'test-key',async()=>new Response('',{status:500}))).includes('识别失败'));
  assert.ok((await describeQqImages([{summary:'unknown',url:'http://localhost/private'}],'test-key',async()=>assert.fail('invalid URL fetched'))).includes('没有可用'));
  assert.equal(validImageUrl('https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/x.png'),true);
  assert.equal(validImageUrl('https://raw.githubusercontent.com/evil/repo/main/x.png'),false);
});
