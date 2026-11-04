import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveLoginState,NapcatLoginClient} from '../scripts/napcat-login-client.mjs';
import {createLoginViewer} from '../scripts/qq-login.mjs';
import {conversationPersona} from '../src/core/companion-persona.ts';
import {FriendApprover} from '../src/core/qq-friends.ts';
import {QqStore} from '../src/core/qq-store.ts';
import {OneBotRequestError} from '../src/channels/onebot-client.ts';

test('login generates fresh QR on entry, expiry and manual refresh but preserves phone confirmation',async()=>{
 let now=10000,refreshes=0,phase='waiting_qrcode',logged=false,url='old';
 const client={async request(action){if(action==='RefreshQRcode'){refreshes++;url='qr-'+refreshes;}return {isLogin:logged,qrcodeurl:url,loginPhase:phase,qrLoginAccepted:phase==='initializing'};}};
 const state=new LiveLoginState(client,{now:()=>now});
 const first=await state.snapshot();assert.equal(refreshes,1);assert.equal(state.qrUrl,'qr-1');
 await state.snapshot();assert.equal(refreshes,1);
 now+=91000;assert.notEqual((await state.snapshot()).version,first.version);assert.equal(refreshes,2);
 phase='initializing';now+=91000;assert.equal((await state.snapshot()).phase,'confirm');assert.equal(refreshes,2);
 await state.snapshot(true);assert.equal(refreshes,3);
 logged=true;now+=2000;assert.equal((await state.snapshot(true)).phase,'logged-in');assert.equal(state.qrUrl,'');assert.equal(refreshes,3);
});
test('login service failures clear cached QR and credentials stay server-side',async()=>{
 let calls=[],fail=false;
 const client=new NapcatLoginClient({token:async()=>'private-token',request:async(url,options)=>{calls.push({url,options});if(fail)throw Error('offline');return {ok:true,json:async()=>({code:0,data:url.endsWith('auth/login')?{Credential:'private-credential'}:{isLogin:false,qrcodeurl:'private-qr',loginPhase:'waiting_qrcode'}})};}});
 let now=10000;const state=new LiveLoginState(client,{now:()=>now});const snapshot=await state.snapshot();
 assert.equal(calls.filter(c=>c.url.endsWith('auth/login')).length,1);assert.equal(calls[1].options.headers.Authorization,'Bearer private-credential');assert.ok(!JSON.stringify(snapshot).includes('private-'));
 fail=true;now+=2000;await assert.rejects(state.snapshot());assert.equal(state.qrUrl,'');
});
test('viewer serves changing SVG without cached images and protects refresh endpoint',async t=>{
 let version='one';const state={qrUrl:'qr-one',async snapshot(force){if(force){version='two';this.qrUrl='qr-two';}return {phase:'waiting',version};}};
 const viewer=await createLoginViewer({state});t.after(()=>viewer.close());
 const root=await fetch(viewer.url);assert.match(root.headers.get('cache-control'),/no-store/);assert.match(await root.text(),/重新生成二维码/);
 const before=await (await fetch(viewer.url+'/qr')).text();assert.match(before,/<svg/);
 assert.equal((await fetch(viewer.url+'/refresh',{method:'POST'})).status,405);
 await fetch(viewer.url+'/refresh',{method:'POST',headers:{'X-Login-Refresh':'1'}});
 assert.notEqual(await (await fetch(viewer.url+'/qr')).text(),before);
 assert.equal((await fetch(viewer.url+'/missing')).status,404);
});
test('only authenticated private owner receives private persona',()=>{
 const settings={accountId:'10001',ownerId:'10002'},secret='private-owner-persona';
 assert.match(conversationPersona(JSON.stringify(['qq-onebot','10001','private','10002']),settings,secret),/private-owner-persona/);
 for(const id of [JSON.stringify(['qq-onebot','10001','private','10003']),JSON.stringify(['qq-onebot','10001','group','10002'])]){const persona=conversationPersona(id,settings,secret);assert.ok(!persona.includes(secret));assert.match(persona,/先生／女士/);assert.match(persona,/不称当前联系人为主人/);}
});
test('friend requests require allowlist/account/type and are accepted once',async t=>{
 const store=new QqStore(':memory:');t.after(()=>store.close());const calls=[];
 const approver=new FriendApprover({store,accountId:'10001',allowedUsers:['10002'],enabled:true,transport:{ready:true,async request(action,params){calls.push({action,params});}}});
 const event={post_type:'request',request_type:'friend',self_id:10001,user_id:10002,flag:'test-flag'};
 for(const patch of [{self_id:10009},{request_type:'group'},{flag:''}])approver.receive({...event,...patch});
 await approver.pump();assert.equal(calls.length,0);
 approver.receive(event);approver.receive(event);await approver.pump();assert.deepEqual(calls,[{action:'set_friend_add_request',params:{flag:'test-flag',approve:true}}]);
 approver.receive(event);await approver.pump();assert.equal(calls.length,1);await approver.stop();
});
test('queued friend requests recheck allowlist and uncertain approvals never replay',async t=>{
 const store=new QqStore(':memory:');t.after(()=>store.close());let sends=0;
 store.queueFriend('10001','10003','removed');store.queueFriend('10001','10002','allowed');
 const approver=new FriendApprover({store,accountId:'10001',allowedUsers:['10002'],enabled:true,transport:{ready:true,async request(){sends++;throw new OneBotRequestError('lost receipt',true);}}});
 await approver.pump();await approver.pump();assert.equal(sends,2);assert.equal(store.nextFriend(),undefined);await approver.stop();
});

test('outsiders and removed contacts are explicitly rejected; disabled policy does nothing',async t=>{
 const store=new QqStore(':memory:');t.after(()=>store.close());const calls=[];
 const transport={ready:false,async request(action,params){calls.push({action,params});}};
 const allowedUsers=['10002'];const options={store,accountId:'10001',allowedUsers,enabled:true,transport};
 const event={post_type:'request',request_type:'friend',self_id:10001,user_id:10003,flag:'outsider'};
 const disabled=new FriendApprover({...options,enabled:false});disabled.receive(event);assert.equal(store.nextFriend(),undefined);await disabled.stop();
 const approver=new FriendApprover(options);approver.receive(event);approver.receive({...event,user_id:10002,flag:'removed'});await approver.pump();assert.equal(calls.length,0);
 allowedUsers.length=0;transport.ready=true;await approver.pump();
 assert.deepEqual(calls,[{action:'set_friend_add_request',params:{flag:'outsider',approve:false}},{action:'set_friend_add_request',params:{flag:'removed',approve:false}}]);
 approver.receive(event);await approver.pump();assert.equal(calls.length,2);await approver.stop();
});
