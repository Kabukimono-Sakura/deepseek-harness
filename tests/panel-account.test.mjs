import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccount} from '../scripts/qq-account-guard.mjs';
import {greetingMessage} from '../scripts/qq-greeting.mjs';
test('only expected QQ verifies; wrong account is disconnected, failures are visible',async()=>{
 let actual='10001',online=true,stops=0;
 const client={async request(action){return action==='CheckLoginStatus'?{isLogin:online}:{uin:actual};}};
 const stop=async()=>{stops++;};
 assert.equal((await verifyAccount(client,'10001',stop)).verified,true);assert.equal(stops,0);
 actual='10002';const wrong=await verifyAccount(client,'10001',stop);assert.equal(wrong.verified,false);assert.equal(wrong.disconnected,true);assert.equal(stops,1);
 assert.equal((await verifyAccount(client,'10001',async()=>{throw Error();})).disconnected,false);
 actual='';await assert.rejects(verifyAccount(client,'10001',stop));assert.equal(stops,1);
 online=false;assert.equal((await verifyAccount(client,'10001',stop)).verified,false);assert.equal(stops,1);
});
test('panel greetings target owner only and expire instead of sending old tests after login',()=>{
 const message=greetingMessage({accountId:'10001',ownerId:'10002'},'test',1000);
 assert.deepEqual(message.replyTarget,{kind:'private',id:'10002'});assert.equal(message.source,'proactive');assert.equal(message.expiresAt,181000);assert.equal(message.eventId,'panel-test:test');
});
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {startGreetingControl} from '../scripts/qq-greeting.mjs';
test('panel request waits for receipt; stale bridge nonce cannot enqueue a greeting',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'panel-greeting-'));let row,queued=[];
 const stop=startGreetingControl({directory,nonce:'live',settings:{accountId:'10001',ownerId:'10002'},client:{ready:true},router:{enqueue(message){queued.push(message);return true;}},store:{get(){return row;}}});
 t.after(()=>{stop();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});});
 const id='12345678-1234-1234-1234-123456789abc';
 const request=nonce=>writeFileSync(join(directory,'qq-greeting-request.json'),JSON.stringify({id,nonce,createdAt:Date.now()}));
 const wait=async state=>{const end=Date.now()+4000;while(Date.now()<end){try{if(JSON.parse(readFileSync(join(directory,'qq-greeting-result.json'))).state===state)return;}catch{}await new Promise(r=>setTimeout(r,50));}assert.fail('missing '+state);};
 request('old');await wait('unavailable');assert.equal(queued.length,0);
 request('live');await wait('queued');assert.equal(queued.length,1);
 row={state:'sent'};await wait('sent');
});
