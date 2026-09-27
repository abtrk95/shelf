from pathlib import Path
r=Path('.');p=r/'tests/server.test.mjs';s=p.read_text()
s=s.replace("    const request=await ea.next('pair-request');\n    assert.equal((await post('/api/pair/decision',{requestId:request.request.id,accept:true},a)).status,200);\n",'')
s=s.replace('pairing waits for owner consent; both sides receive consistent roles','code pairing connects immediately and both sides receive consistent roles')
a=s.index("test('an unrelated browser cannot approve");b=s.index("test('full-secret QR pairing",a)
s=s[:a]+'''test('an unrelated browser cannot join a claimed room or signal into it',async t=>{
  const f=await fixture(t),{a}=await f.paired(),c=await f.session();
  assert.equal((await f.post('/api/join',{roomId:a.state.roomId,secret:a.state.inviteSecret},c)).status,404);
  assert.equal((await f.post('/api/signal',{signal:{type:'restart',connectionId:'x'}},c)).status,409);
});
'''+s[b:]
s=s.replace("  const request=await ea.next('pair-request');assert.ok(request.request.id);", "  const state=await ea.next('snapshot');assert.equal(state.state.peer.id,b.id);assert.equal(state.state.code,undefined);")
a=s.index("test('declined and cancelled requests");b=s.index("test('invitation rotation",a)
s=s[:a]+'''test('failed join leaves the browser’s original shelf and invite usable',async t=>{
  const f=await fixture(t),a=await f.session(),b=await f.session();const ea=await f.events(a),eb=await f.events(b);await ea.next('snapshot');await eb.next('snapshot');
  assert.equal((await f.post('/api/join',{code:'NOTVALID'},b)).status,404);
  const response=await f.post('/api/join',{code:b.state.code},a);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.paired,true);assert.equal(result.state.peer.id,b.id);
});
'''+s[b:]
s=s.replace('inside the approved room','inside the paired room')
s+='''
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
'''
p.write_text(s)
p=r/'tests/transfer.test.mjs';s=p.read_text()
a=s.index("test('receiver never writes");b=s.index("test('receiver verifies",a)
s=s[:a]+'''test('valid offers are automatically accepted without a receive action', async t => {
  const h = harness(t), meta = h.offer();
  h.inject(meta); await h.flush();
  assert.equal(h.engine.items[0].state, 'receiving');
  assert.equal(h.engine.items[0].accepted, true);
  assert.deepEqual(h.sent[0], {type:'accept',id:meta.id,offset:0});
});
test('unsolicited file bytes without an offer are never stored', async t => {
  const h = harness(t), meta = h.offer();
  h.inject(makeFrame(meta.id,0,new Uint8Array([1,2,3]))); await h.flush();
  assert.equal(h.engine.items.length,0);assert.equal(h.sent.length,0);
});

'''+s[b:]
s=s.replace(' await h.engine.accept(meta.id);','')
s+='''
test('automatic receiving has a cumulative storage budget', async t => {
  const h=harness(t),first=h.offer(700000),second=h.offer(700000);
  h.inject(first);await h.flush();h.inject(second);await h.flush();
  assert.equal(h.engine.items.length,1);assert.equal(h.sent.at(-1).type,'error');
  assert.match(h.sent.at(-1).message,/shelf is full/);
  await h.engine.remove(first.id);h.inject(second);await h.flush();
  assert.equal(h.engine.items[0].id,second.id);assert.equal(h.sent.at(-1).type,'accept');
});
test('storage failure is visible and never acknowledged as an accepted transfer', async t => {
  const h=harness(t),meta=h.offer();h.storage.create=async()=>{throw new Error('Storage is full.');};
  h.inject(meta);await h.flush();assert.equal(h.engine.items[0].state,'error');
  assert.equal(h.sent.some(m=>m.type==='accept'),false);assert.equal(h.sent.at(-1).type,'error');
});
test('duplicate offers do not allocate or duplicate a receiving item', async t => {
  const h=harness(t),meta=h.offer();let allocations=0;const create=h.storage.create.bind(h.storage);
  h.storage.create=async(...args)=>{allocations++;return create(...args);};
  h.inject(meta);await h.flush();h.inject(meta);await h.flush();
  assert.equal(h.engine.items.length,1);assert.equal(allocations,1);
});
test('text preserves leading whitespace, line breaks, and trailing whitespace', async t => {
  const h=harness(t);const text='  Heading\\n\\nمرحبا 🌿\\n  ';
  h.engine.addText(text);assert.equal(h.engine.items[0].text,text);
  assert.equal(await h.engine.items[0].file.text(),text);
});
test('a peer cannot reuse the identifier of an outgoing item', async t => {
  const h=harness(t);h.engine.addText('Local note');const id=h.engine.items[0].id;
  h.inject({...h.offer(),id});await h.flush();assert.equal(h.channel.readyState,'closed');
  assert.equal(h.engine.items.length,1);
});
'''
p.write_text(s)
