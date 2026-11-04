import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {WechatClient} from '../src/wechat/client.mjs';
import {validateArticle,renderContent,articleHash,disclosure} from '../src/wechat/article.mjs';
import {onceOperation,requireApproval} from '../scripts/wechat.mjs';
const article={title:'项目介绍',author:'作者',digest:'摘要',paragraphs:['<script>alert(1)</script>'],sources:[{title:'项目',url:'https://example.com/'}]};
test('public articles escape markup, retain disclosure and validate current field lengths',()=>{
 const value=validateArticle(article);const html=renderContent(value);assert.ok(html.includes(disclosure));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
 assert.throws(()=>validateArticle({...article,title:'字'.repeat(33)}));assert.throws(()=>validateArticle({...article,sources:[{title:'bad',url:'javascript:alert(1)'}]}));
 const approved={reviewed:true,hash:articleHash(value),appid:'app',coverHash:'cover'};requireApproval(value,approved,'app','cover');
 assert.throws(()=>requireApproval({...value,title:'changed'},approved,'app','cover'));assert.throws(()=>requireApproval(value,approved,'other','cover'));assert.throws(()=>requireApproval(value,approved,'app','changed'));
});
test('WeChat uses stable server token, official origins and sends drafts without publishing',async()=>{
 const calls=[];const client=new WechatClient({appid:'test-app',secret:'test-secret',request:async(url,options)=>{calls.push({url:new URL(url),options});return {ok:true,json:async()=>String(url).includes('stable_token')?{access_token:'private-token',expires_in:7200}:String(url).includes('draft/count')?{total_count:2}:{media_id:'draft-id'}};}});
 assert.deepEqual(await client.probe(),{draftCount:2});await client.addDraft({...article,content:'<p>text</p>'},'cover-id');
 assert.equal(calls.length,3);assert.equal(calls[1].options.method,'GET');assert.equal(JSON.parse(calls[0].options.body).force_refresh,false);assert.equal(calls[2].url.searchParams.get('access_token'),'private-token');assert.ok(calls.every(c=>c.url.origin==='https://api.weixin.qq.com'&&c.options.redirect==='error'));assert.ok(calls.every(c=>!c.url.pathname.includes('freepublish')));
});
test('remote errors and network failures redact secrets and never retry mutations',async()=>{
 let calls=0;const client=new WechatClient({appid:'app',secret:'secret',request:async()=>{calls++;return {ok:true,json:async()=>({errcode:40164,errmsg:'sensitive-token'})};}});
 await assert.rejects(client.probe(),e=>e.code===40164&&!e.message.includes('sensitive'));assert.equal(calls,1);
 const unavailable=new WechatClient({appid:'app',secret:'secret',request:async()=>{throw Error('sensitive-token');}});await assert.rejects(unavailable.probe(),e=>e.uncertain&&!e.message.includes('sensitive'));
});
test('durable draft receipts prevent duplicates and quarantine unknown outcomes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wechat-test-'));t.after(()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 let writes=0;const action=async()=>{writes++;return {media_id:'one'};};const path=join(dir,'receipt.json');
 await onceOperation(path,'identity',action);await onceOperation(path,'identity',action);assert.equal(writes,1);await assert.rejects(onceOperation(path,'changed',action));
 const pending=join(dir,'pending.json');writeFileSync(pending,JSON.stringify({identity:'one',state:'pending'}));await assert.rejects(onceOperation(pending,'one',action));assert.equal(writes,1);
});

test('permanent cover upload uses multipart and rejects unsupported files before network access',async()=>{
 const calls=[];const client=new WechatClient({appid:'app',secret:'secret',request:async(url,options)=>{calls.push({url:new URL(url),options});return {ok:true,json:async()=>String(url).includes('stable_token')?{access_token:'token',expires_in:7200}:{media_id:'cover'}};}});
 await assert.rejects(client.uploadCover(Buffer.from('not an image')));assert.equal(calls.length,0);
 await client.uploadCover(Buffer.from([137,80,78,71,13,10,26,10]));assert.equal(calls[1].url.searchParams.get('type'),'image');assert.ok(calls[1].options.body instanceof FormData);assert.equal(calls[1].options.body.get('media').type,'image/png');
});
