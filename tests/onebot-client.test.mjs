import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { OneBotClient } from '../src/channels/onebot-client.ts';

async function fixture(t, actionHandler, userId='10001') {
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const sockets=[];
  server.on('connection',(socket,request)=>{
    assert.equal(request.headers.authorization,'Bearer test-token');sockets.push(socket);
    socket.on('message',raw=>{
      const frame=JSON.parse(raw);
      if(frame.action==='get_login_info')socket.send(JSON.stringify({status:'ok',retcode:0,echo:frame.echo,data:{user_id:userId}}));
      else actionHandler(socket,frame);
    });
  });
  const client=new OneBotClient({url:`ws://127.0.0.1:${server.address().port}`,token:'test-token',accountId:'10001',timeoutMs:1000,reconnectMs:20});
  t.after(async()=>{client.stop();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
  return {client,sockets};
}

test('OneBot verifies account, binds echo replies, and filters foreign-account events',async t=>{
  const {client,sockets}=await fixture(t,(socket,frame)=>{
    socket.send(JSON.stringify({status:'ok',retcode:0,echo:'unrelated',data:{message_id:999}}));
    socket.send(JSON.stringify({status:'ok',retcode:0,echo:frame.echo,data:{message_id:42}}));
  });
  const ready=once(client,'ready');client.start();await ready;
  const messages=[];client.on('message',event=>messages.push(event));
  sockets[0].send(JSON.stringify({post_type:'message',self_id:999}));
  const received=once(client,'message');sockets[0].send(JSON.stringify({post_type:'message',self_id:10001}));await received;
  assert.equal(messages.length,1);
  assert.deepEqual(await client.request('send_private_msg',{}),{message_id:42});
});

test('wrong logged-in account stops the connection without becoming ready',async t=>{
  const {client}=await fixture(t,()=>{},'99999');
  const result=once(client,'diagnostic');client.start();assert.deepEqual(await result,['account-mismatch']);
  assert.equal(client.ready,false);
  await assert.rejects(client.request('send_private_msg',{}),error=>error.uncertain===false);
});

test('lost receipt is uncertain; reconnect does not replay the send',async t=>{
  let sends=0;
  const {client}=await fixture(t,socket=>{sends++;socket.terminate();});
  let ready=once(client,'ready');client.start();await ready;
  ready=once(client,'ready');
  await assert.rejects(client.request('send_private_msg',{}),error=>error.uncertain===true);
  await ready;
  assert.equal(client.ready,true);assert.equal(sends,1);
});

test('OneBot rejects untrusted destinations and missing credentials',()=>{
  for(const url of ['ws://example.com','ws://127.0.0.1/?access_token=x','ws://user:pass@127.0.0.1','ws://127.0.0.1/api']) {
    assert.throws(()=>new OneBotClient({url,token:'test',accountId:'1'}));
  }
  assert.throws(()=>new OneBotClient({url:'ws://127.0.0.1',token:'',accountId:'1'}));
});

test('a missing API receipt times out without retrying the request',async t=>{
  let sends=0;
  const {client}=await fixture(t,()=>{sends++;});
  const ready=once(client,'ready');client.start();await ready;
  await assert.rejects(client.request('send_private_msg',{}),error=>error.uncertain===true);
  assert.equal(sends,1);assert.equal(client.ready,true);
});
