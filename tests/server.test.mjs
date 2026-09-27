import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createShelfServer, normalizeCode, cleanName } from '../server/index.mjs';

async function fixture(t, overrides={}) {
  const app=createShelfServer({production:false,allowedOrigins:[],stunUrls:[],turnUrls:[],...overrides});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${app.server.address().port}`;const controllers=[];
  t.after(async()=>{for(const c of controllers)c.abort();await app.close();});
  const post=(path,payload={},session,headers={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(session?{Authorization:`Bearer ${session.token}`} : {}),...headers},body:JSON.stringify(payload)});
  const session=async(name='Test browser')=>{const r=await post('/api/session',{name});assert.equal(r.status,201);return r.json();};
  async function events(client,last=0){
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(origin+'/api/events',{headers:{Authorization:`Bearer ${client.token}`,'Last-Event-ID':String(last)},signal:controller.signal});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-accel-buffering'),'no');
    const reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();
    async function next(type){
      const deadline=Date.now()+3000;
      while(Date.now()<deadline){
        let boundary;
        while((boundary=buffer.indexOf('\n\n'))>=0){const part=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const line=part.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;const message=JSON.parse(line.slice(6));if(!type||message.type===type)return message;}
        const result=await Promise.race([reader.read(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Event timeout')),3000);timer.unref();})]);
        if(result.done)throw new Error('Stream ended unexpectedly');buffer+=decoder.decode(result.value,{stream:true});
      }
      throw new Error('Event timeout');
    }
    return {next,controller};
  }
  async function paired(){
    const a=await session('Desktop'),b=await session('Phone');const ea=await events(a),eb=await events(b);
    await ea.next('snapshot');await eb.next('snapshot');
    assert.equal((await post('/api/join',{code:a.state.code},b)).status,200);
    const sa=await ea.next('snapshot'),sb=await eb.next('snapshot');return {a,b,ea,eb,sa,sb};
  }
  return {app,origin,post,session,events,paired};
}
test('production fails closed without an explicit HTTPS origin or TURN credentials',()=>{
  assert.throws(()=>createShelfServer({production:true,allowedOrigins:[]}),/ALLOWED_ORIGINS/);
  assert.throws(()=>createShelfServer({production:true,allowedOrigins:['http://example.com']}),/HTTPS/);
  assert.throws(()=>createShelfServer({production:false,turnUrls:['turn:example.com'],turnSecret:''}),/TURN_SECRET/);
});
test('sessions use independent credentials, expiring codes, and no content storage endpoint',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();
  assert.notEqual(a.token,b.token);assert.match(a.token,/^[\w-]{43}$/);assert.match(a.state.code,/^[A-HJ-NP-Z2-9]{8}$/);assert.equal(a.state.inviteSecret.length,32);assert.ok(a.state.expiresAt>Date.now());
  const upload=await f.post('/api/upload',{file:'never accepted'},a);assert.equal(upload.status,404);
});
test('state-changing APIs reject cross-origin and originless requests',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post('/api/session',{},undefined,{Origin:'https://evil.example'})).status,403);
  const noOrigin=await fetch(f.origin+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noOrigin.status,403);
});
test('private APIs require the opaque bearer credential',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post('/api/name',{name:'attacker'})).status,401);
  assert.equal((await fetch(f.origin+'/api/events')).status,401);
});
test('JSON request limits, invalid JSON, and method restrictions are enforced',async t=>{
  const f=await fixture(t),a=await f.session();
  assert.equal((await f.post('/api/name',{name:'x'.repeat(70000)},a)).status,413);
  const response=await fetch(f.origin+'/api/name',{method:'POST',headers:{'Content-Type':'application/json',Origin:f.origin,Authorization:`Bearer ${a.token}`},body:'{'});assert.equal(response.status,400);
  assert.equal((await fetch(f.origin+'/api/name',{headers:{Authorization:`Bearer ${a.token}`}})).status,405);
});
test('code pairing connects immediately and both sides receive consistent roles',async t=>{
  const f=await fixture(t);const {a,b,sa,sb}=await f.paired();
  assert.equal(sa.state.peer.id,b.id);assert.equal(sb.state.peer.id,a.id);assert.equal(sa.state.initiator,true);assert.equal(sb.state.initiator,false);assert.equal(sa.state.roomId,sb.state.roomId);
  assert.equal(sa.state.inviteSecret,undefined);assert.equal(sa.state.code,undefined);
});
test('an unrelated browser cannot join a claimed room or signal into it',async t=>{
  const f=await fixture(t),{a}=await f.paired(),c=await f.session();
  assert.equal((await f.post('/api/join',{roomId:a.state.roomId,secret:a.state.inviteSecret},c)).status,404);
  assert.equal((await f.post('/api/signal',{signal:{type:'restart',connectionId:'x'}},c)).status,409);
});
test('full-secret QR pairing works and a wrong secret is rejected',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();const ea=await f.events(a);await ea.next('snapshot');
  assert.equal((await f.post('/api/join',{roomId:a.state.roomId,secret:'x'.repeat(32)},b)).status,404);
  assert.equal((await f.post('/api/join',{roomId:a.state.roomId,secret:a.state.inviteSecret},b)).status,200);
  const state=await ea.next('snapshot');assert.equal(state.state.peer.id,b.id);assert.equal(state.state.code,undefined);
});
test('failed join leaves the browser’s original shelf and invite usable',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();const ea=await f.events(a),eb=await f.events(b);await ea.next('snapshot');await eb.next('snapshot');
  assert.equal((await f.post('/api/join',{code:'NOTVALID'},b)).status,404);
  const response=await f.post('/api/join',{code:b.state.code},a);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.paired,true);assert.equal(result.state.peer.id,b.id);
});
test('invitation rotation invalidates both the old code and secret',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();const ea=await f.events(a);await ea.next('snapshot');
  await f.post('/api/invite',{},a);const update=await ea.next('snapshot');assert.notEqual(update.state.code,a.state.code);assert.notEqual(update.state.inviteSecret,a.state.inviteSecret);
  assert.equal((await f.post('/api/join',{code:a.state.code},b)).status,404);
  assert.equal((await f.post('/api/join',{roomId:a.state.roomId,secret:a.state.inviteSecret},b)).status,404);
});
test('a paired room admits no third browser and consumes its invite',async t=>{
  const f=await fixture(t),{a}=await f.paired(),c=await f.session();
  assert.equal((await f.post('/api/join',{code:a.state.code},c)).status,404);
});
test('signaling stays inside the paired room and strips non-protocol properties',async t=>{
  const f=await fixture(t),{a,eb}=await f.paired();
  const response=await f.post('/api/signal',{signal:{type:'offer',connectionId:'one',sdp:'v=0\r\n',filename:'secret.pdf',text:'private'}},a);assert.equal(response.status,200);
  const message=await eb.next('signal');assert.deepEqual(message.signal,{type:'offer',connectionId:'one',sdp:'v=0\r\n'});
  assert.equal((await f.post('/api/signal',{signal:{type:'anything',connectionId:'one'}},a)).status,400);
});
test('ending a session notifies both browsers and destroys its room',async t=>{
  const f=await fixture(t),{a,b,ea,eb}=await f.paired();await f.post('/api/end',{},a);
  assert.equal((await ea.next('ended')).reason,'ended');assert.equal((await eb.next('ended')).reason,'ended');
  assert.equal((await f.post('/api/signal',{signal:{type:'restart',connectionId:'x'}},b)).status,409);
});
test('server expiration invalidates credentials and broadcasts expiration',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now,sessionTTL:1000}),{a,ea}=await f.paired();now+=1001;f.app.sweep();
  assert.equal((await ea.next('ended')).reason,'expired');assert.equal((await f.post('/api/name',{name:'late'},a)).status,401);
});
test('short-code guessing is limited across sessions on the same address',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();
  for(let i=0;i<8;i++)assert.equal((await f.post('/api/join',{code:'ZZZZZZZZ'},i%2?a:b)).status,404);
  const response=await f.post('/api/join',{code:'ZZZZZZZZ'},b);assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');
});
test('server capacity is bounded',async t=>{
  const f=await fixture(t,{maxSessions:2});await f.session();await f.session();assert.equal((await f.post('/api/session',{name:'third'})).status,503);
});
test('static responses set security headers and do not expose server source or dotfiles',async t=>{
  const f=await fixture(t);const response=await fetch(f.origin+'/');assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  for(const path of ['/.env','/server/index.mjs','/package.json','/%2e%2e/server/index.mjs'])assert.equal((await fetch(f.origin+path)).status,404);
});
test('TURN credentials are expiring, per-session HMAC credentials',async t=>{
  const secret='test-only-secret';const f=await fixture(t,{turnUrls:['turn:relay.example:3478'],turnSecret:secret});const a=await f.session();
  const turn=a.config.iceServers[0];assert.deepEqual(turn.urls,['turn:relay.example:3478']);assert.match(turn.username,new RegExp(`:${a.id}$`));assert.ok(Number(turn.username.split(':')[0])>Date.now()/1000);
  assert.equal(turn.credential,createHmac('sha1',secret).update(turn.username).digest('base64'));
});
test('code and device-name normalization remove control and bidi characters',()=>{
  assert.equal(normalizeCode(' abcd-2345 '),'ABCD2345');assert.equal(cleanName('  Phone\u202E\n  '),'Phone');assert.equal(cleanName('x'.repeat(100)).length,40);
});

test('simultaneous joins are atomic and only one guest claims the invitation',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session(),c=await f.session();const ea=await f.events(a);await ea.next('snapshot');
  const responses=await Promise.all([f.post('/api/join',{code:a.state.code},b),f.post('/api/join',{code:a.state.code},c)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,404]);
  const joined=await (responses.find(r=>r.status===200)).json();assert.equal(joined.paired,true);
  const state=await ea.next('snapshot');assert.ok([b.id,c.id].includes(state.state.peer.id));
});
test('self-pairing is rejected without consuming the code',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();const ea=await f.events(a);await ea.next('snapshot');
  assert.equal((await f.post('/api/join',{code:a.state.code},a)).status,400);
  assert.equal((await f.post('/api/join',{code:a.state.code},b)).status,200);
});
test('offline owner and expired invitations cannot connect automatically',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now,inviteTTL:1000}),a=await f.session(),b=await f.session();
  assert.equal((await f.post('/api/join',{code:a.state.code},b)).status,409);
  const ea=await f.events(a);await ea.next('snapshot');now+=1001;
  assert.equal((await f.post('/api/join',{code:a.state.code},b)).status,404);
});
test('joining consumes the guest’s abandoned invitation as well',async t=>{
  const f=await fixture(t),{b}=await f.paired(),c=await f.session();
  assert.equal((await f.post('/api/join',{code:b.state.code},c)).status,404);
  assert.equal((await f.post('/api/join',{roomId:b.state.roomId,secret:b.state.inviteSecret},c)).status,404);
});
