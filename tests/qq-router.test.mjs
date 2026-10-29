import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { QqStore } from '../src/core/qq-store.ts';
import { QqRouter } from '../src/core/qq-router.ts';
import { OneBotRequestError } from '../src/channels/onebot-client.ts';
import { parseOneBotMessage } from '../src/channels/onebot.ts';

const policy={allowedUsers:['10002'],allowedGroups:['30001'],requireMention:true};
const event=(id=1)=>({post_type:'message',message_type:'private',sub_type:'friend',self_id:10001,user_id:10002,message_id:id,message:[{type:'text',data:{text:'hello '+id}}]});
function db(t,close){const folder=mkdtempSync(join(tmpdir(),'qq-store-'));t.after(()=>{close();assert.equal(dirname(resolve(folder)),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});});return join(folder,'state.sqlite');}

test('duplicate events generate/send once; FIFO conversation reuses its session',async t=>{
  const store=new QqStore(db(t,()=>store.close()));
  const sent=[],generated=[];
  const transport={ready:true,async request(action,params){sent.push({action,params});return {message_id:sent.length};}};
  const router=new QqRouter({store,transport,policy,accountId:'10001',generate:async(conversation,text)=>{generated.push({conversation,text});await new Promise(resolve=>setTimeout(resolve,5));return 'reply '+text;}});
  router.receive(event());router.receive(event());router.receive(event(2));await router.pump();
  assert.equal(generated.length,2);assert.equal(sent.length,2);
  assert.equal(generated[0].conversation.resume,false);assert.equal(generated[1].conversation.resume,true);
  assert.equal(generated[0].conversation.sessionId,generated[1].conversation.sessionId);
  assert.equal(sent[0].params.user_id,'10002');
  assert.equal(sent[1].params.message[0].data.text,'reply hello 2');
});

test('reply survives reconnect without rerunning the model',async t=>{
  const store=new QqStore(db(t,()=>store.close()));let calls=0,sends=0;
  const transport={ready:true,async request(){sends++;return {message_id:1};}};
  const router=new QqRouter({store,transport,policy,accountId:'10001',generate:async()=>{calls++;transport.ready=false;return 'saved reply';}});
  router.receive(event());await router.pump();assert.equal(sends,0);
  transport.ready=true;await router.pump();assert.equal(sends,1);assert.equal(calls,1);
});

test('an uncertain send is never automatically repeated, including after restart',async t=>{
  const path=db(t,()=>store.close());let store=new QqStore(path),sends=0;
  let router=new QqRouter({store,transport:{ready:true,async request(){sends++;throw new OneBotRequestError('lost receipt',true);}},policy,accountId:'10001',generate:async()=>'reply'});
  router.receive(event());await router.pump();store.close();store=new QqStore(path);
  router=new QqRouter({store,transport:{ready:true,async request(){sends++;return {message_id:2};}},policy,accountId:'10001',generate:async()=>{throw new Error('must not regenerate');}});
  router.receive(event());await router.pump();assert.equal(sends,1);
  assert.equal(store.get(parseOneBotMessage(event(),policy).message.eventId).state,'uncertain');
});

test('crash recovery quarantines interrupted generation and delivery',t=>{
  const path=db(t,()=>store.close());let store=new QqStore(path);
  const first=parseOneBotMessage(event(),policy).message;
  const second=parseOneBotMessage(event(2),policy).message;
  store.accept(first);store.accept(second);store.conversation(first.conversationId);
  store.setState(first.eventId,'processing');store.setState(second.eventId,'sending');store.close();
  store=new QqStore(path);
  assert.equal(store.get(first.eventId).state,'uncertain');assert.equal(store.get(second.eventId).state,'uncertain');
  assert.equal(store.conversation(first.conversationId).blocked,1);assert.equal(store.next(),undefined);
});

test('removed sender is checked again before a persisted reply is sent',async t=>{
  const store=new QqStore(db(t,()=>store.close()));
  const message=parseOneBotMessage(event(),policy).message;store.accept(message);store.saveReply(message.eventId,'private');
  let sends=0;
  const router=new QqRouter({store,transport:{ready:true,async request(){sends++;}},policy:{...policy,allowedUsers:[]},accountId:'10001',generate:async()=>''});
  await router.pump();assert.equal(sends,0);assert.equal(store.get(message.eventId).state,'failed');
});

test('generation failure blocks later prompts rather than silently losing context',async t=>{
  const store=new QqStore(db(t,()=>store.close()));let calls=0;
  const router=new QqRouter({store,transport:{ready:true,async request(){throw new Error('must not send');}},policy,accountId:'10001',generate:async()=>{calls++;throw new Error('runtime died');}});
  router.receive(event());router.receive(event(2));await router.pump();assert.equal(calls,1);
  assert.equal(store.get(parseOneBotMessage(event(2),policy).message.eventId).state,'failed');
});

test('stopping during generation preserves the completed reply without sending it',async t=>{
  const store=new QqStore(db(t,()=>store.close()));let finish,sends=0;
  const generated=new Promise(resolve=>{finish=resolve;});
  const router=new QqRouter({store,transport:{ready:true,async request(){sends++;return {message_id:1};}},policy,accountId:'10001',generate:()=>generated});
  router.receive(event());
  const stopped=router.stop();finish('completed after stop');await stopped;
  assert.equal(sends,0);
  const row=store.get(parseOneBotMessage(event(),policy).message.eventId);
  assert.equal(row.state,'ready');assert.equal(row.reply,'completed after stop');
});
