import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SHA256 } from '../dist/app/lib/sha256.js';
import { qrMatrix } from '../dist/app/lib/qr.js';
import { makeFrame, readFrame, parseControl, CHUNK_BYTES, MAX_TEXT_BYTES } from '../dist/app/lib/protocol.js';
import { safeURL, escapeHTML, safeFilename, formatBytes } from '../dist/app/lib/utils.js';

for (const input of ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'a'.repeat(1000000)]) {
  test(`incremental SHA-256 agrees with Node crypto (${input.length} bytes)`, () => {
    const data = new TextEncoder().encode(input); const hash = new SHA256();
    for (let position = 0; position < data.length; position += 61) hash.update(data.slice(position,position+61));
    assert.equal(hash.digest(),createHash('sha256').update(data).digest('hex'));
    assert.throws(()=>hash.digest());assert.throws(()=>hash.update(new Uint8Array()));
  });
}
test('SHA-256 fuzz: randomized binary sizes and chunk boundaries', () => {
  for (const length of [1,7,55,56,63,64,65,128,16360,65536,1048583]) {
    const data=randomBytes(length), hash=new SHA256();
    for(let i=0;i<length;i+=137)hash.update(data.subarray(i,i+137));
    assert.equal(hash.digest(),createHash('sha256').update(data).digest('hex'));
  }
});
const vectors=JSON.parse(await readFile(new URL('./qr-vectors.json',import.meta.url),'utf8'));
for (const [i,vector] of vectors.entries()) test(`QR byte-mode matrix matches independent Python qrcode reference ${i+1}`,()=>{
  const matrix=qrMatrix(vector.text,0);assert.equal(matrix.length,vector.size);
  const value=matrix.flat().map(bit=>bit?'1':'0').join('');
  assert.equal(createHash('sha256').update(value).digest('hex'),vector.hash);
});
test('QR chooses an available mask and rejects oversized input',()=>{
  const auto=qrMatrix('Shelf');assert.ok(auto.flat().some(Boolean));assert.equal(auto.length,21);
  assert.throws(()=>qrMatrix('x'.repeat(500)),/too long/);
});
test('wire framing preserves a UUID, 64-bit offset, and every byte',()=>{
  const id=randomUUID(), data=randomBytes(CHUNK_BYTES);const offset=2**32+57;
  const frame=makeFrame(id,offset,data);assert.equal(frame.byteLength,16384);
  const read=readFrame(frame);assert.equal(read.id,id);assert.equal(read.offset,offset);assert.deepEqual(Buffer.from(read.bytes),data);
});
test('wire framing rejects malformed IDs and oversized packets',()=>{
  assert.throws(()=>makeFrame('invalid',0,new Uint8Array()));
  assert.throws(()=>makeFrame(randomUUID(),-1,new Uint8Array()));
  assert.throws(()=>makeFrame(randomUUID(),0,new Uint8Array(CHUNK_BYTES+1)));
  assert.throws(()=>readFrame(new ArrayBuffer(5)));
  assert.throws(()=>readFrame(new ArrayBuffer(16385)));
});
test('offer validation bounds sizes, content types, and metadata',()=>{
  const offer={type:'offer',id:randomUUID(),name:'hello.txt',mime:'text/plain',size:5,kind:'file'};
  assert.deepEqual(parseControl(JSON.stringify(offer),100),offer);
  for(const patch of [{size:-1},{size:101},{size:Infinity},{name:'x'.repeat(257)},{kind:'script'},{id:'wrong'}])assert.throws(()=>parseControl(JSON.stringify({...offer,...patch}),100));
  assert.throws(()=>parseControl(JSON.stringify({...offer,kind:'text',size:MAX_TEXT_BYTES+1}),1e9));
  assert.throws(()=>parseControl('x'.repeat(8193),1e9));
  assert.throws(()=>parseControl('null',1e9));
});
test('acknowledgements and completion checks require bounded protocol fields',()=>{
  const id=randomUUID();assert.deepEqual(parseControl(JSON.stringify({type:'ack',id,offset:0}),100),{type:'ack',id,offset:0});
  assert.throws(()=>parseControl(JSON.stringify({type:'ack',id,offset:-1}),100));
  assert.throws(()=>parseControl(JSON.stringify({type:'finish',id,digest:'anything'}),100));
  assert.throws(()=>parseControl(JSON.stringify({type:'execute',id}),100));
});
test('links are never executable or credential-bearing URLs',()=>{
  assert.equal(safeURL('https://example.com/a'),'https://example.com/a');
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','https://user:pass@example.com','not a URL'])assert.equal(safeURL(url),null);
});
test('HTML and download names are escaped or sanitized at trust boundaries',()=>{
  assert.equal(escapeHTML('<img onerror="evil">'), '&lt;img onerror=&quot;evil&quot;&gt;');
  assert.equal(safeFilename('../../secret.txt'),'secret.txt');
  assert.equal(safeFilename('..\\file.exe'),'file.exe');
  assert.equal(safeFilename('\u202Ebad?.txt'),'_bad_.txt');
  assert.equal(formatBytes(1024),'1.0 KB');assert.equal(formatBytes(0),'0 B');
});
