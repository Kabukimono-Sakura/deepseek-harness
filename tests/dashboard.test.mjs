import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeState,desktopEnabled,command} from '../scripts/dashboard.mjs';
import {matchesIdentity} from '../scripts/process-identity.mjs';
import {resolve} from 'node:path';

test('a recycled PID cannot identify an unrelated process as the QQ bridge',()=>{
  const executable=resolve('runtime/node.exe');
  assert.equal(matchesIdentity({ExecutablePath:executable,CommandLine:'node scripts/qq.mjs'},executable,'scripts/qq.mjs'),true);
  assert.equal(matchesIdentity({ExecutablePath:executable,CommandLine:'node scripts/unrelated.mjs'},executable,'scripts/qq.mjs'),false);
  assert.equal(matchesIdentity({ExecutablePath:resolve('other/node.exe'),CommandLine:'node scripts/qq.mjs'},executable,'scripts/qq.mjs'),false);
});

test('panel distinguishes stopped, connecting and verified online QQ without exposing credentials',()=>{
  const lock={pid:12,nonce:'current'},health={pid:12,nonce:'current',connected:true,updatedAt:10000};
  assert.equal(bridgeState(null,health,10001,()=>true),'stopped');
  assert.equal(bridgeState(lock,health,10001,()=>false),'stopped');
  assert.equal(bridgeState(lock,health,10001,()=>true),'connected');
  assert.equal(bridgeState(lock,{...health,connected:false},10001,()=>true),'waiting');
  assert.equal(bridgeState(lock,{...health,nonce:'old'},10001,()=>true),'starting');
  assert.equal(bridgeState(lock,health,40000,()=>true),'starting');
});

test('desktop switch uses only main pet display state; invalid panel commands never execute',async()=>{
  assert.equal(desktopEnabled({main:{pets:[{id:'main',display:'desktop'}]}}),true);
  assert.equal(desktopEnabled({main:{pets:[{id:'main',display:'both'}]}}),true);
  assert.equal(desktopEnabled({main:{pets:[{id:'main',display:'none'}]}}),false);
  assert.equal(desktopEnabled({main:{pets:[{id:'other',display:'desktop'}]}}),false);
  await assert.rejects(command('arbitrary-shell-command'),/未知面板操作/);
});
