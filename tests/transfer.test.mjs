import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TransferEngine } from '../dist/app/lib/transfer.js';
import { makeFrame } from '../dist/app/lib/protocol.js';
import { SHA256 } from '../dist/app/lib/sha256.js';

class MemoryTestStorage {
  maxFileBytes = 1024 * 1024;
  disposed = 0;
  async create() {
    const parts = [];
    return {
      write: async bytes => parts.push(bytes.slice()),
      finish: async mime => new Blob(parts, { type: mime }),
      dispose: async () => { this.disposed++; parts.length = 0; },
    };
  }
  async dispose() {}
}
function harness(t, limit = 2 * 1024 * 1024) {
  const storage = new MemoryTestStorage(), notices = [], sent = [];
  const channel = {
    readyState: 'open', bufferedAmount: 0, onmessage: null,
    send: data => sent.push(typeof data === 'string' ? JSON.parse(data) : data),
    close() { this.readyState = 'closed'; },
  };
  const engine = new TransferEngine(storage, limit, () => {}, message => notices.push(message), () => {});
  engine.setChannel(channel);
  t.after(() => engine.destroy());
  const inject = data => channel.onmessage?.({ data: typeof data === 'object' && !(data instanceof ArrayBuffer) ? JSON.stringify(data) : data });
  const flush = async () => { await engine.readQueue; };
  const offer = (size = 3) => ({ type: 'offer', id: randomUUID(), name: 'example.txt', mime: 'text/plain', size, kind: 'file' });
  return { engine, storage, channel, notices, sent, inject, flush, offer };
}

test('receiver never writes or delivers unaccepted file bytes', async t => {
  const h = harness(t), meta = h.offer();
  h.inject(meta); h.inject(makeFrame(meta.id, 0, new Uint8Array([1, 2, 3]))); await h.flush();
  assert.equal(h.engine.items[0].state, 'incoming');
  assert.equal(h.engine.items[0].bytes, 0);
  assert.equal(h.sent.length, 0);
});

test('receiver verifies size and SHA-256 before confirming delivery', async t => {
  const h = harness(t), meta = h.offer(), bytes = new Uint8Array([1, 2, 3]);
  h.inject(meta); await h.flush(); await h.engine.accept(meta.id);
  assert.equal(h.sent[0].type, 'accept');
  h.inject(makeFrame(meta.id, 0, bytes));
  h.inject({ type: 'finish', id: meta.id, digest: new SHA256().update(bytes).digest() });
  await h.flush();
  assert.equal(h.engine.items[0].state, 'complete');
  assert.deepEqual(new Uint8Array(await h.engine.items[0].file.arrayBuffer()), bytes);
  assert.equal(h.sent.at(-1).type, 'complete');
});

test('corrupted payload cannot be reported as successfully delivered', async t => {
  const h = harness(t), meta = h.offer();
  h.inject(meta); await h.flush(); await h.engine.accept(meta.id);
  h.inject(makeFrame(meta.id, 0, new Uint8Array([1, 2, 3])));
  h.inject({ type: 'finish', id: meta.id, digest: '0'.repeat(64) }); await h.flush();
  assert.equal(h.engine.items[0].state, 'error');
  assert.match(h.engine.items[0].error, /Integrity/);
  assert.equal(h.sent.some(message => message.type === 'complete'), false);
});

test('out-of-sequence data closes the offending channel', async t => {
  const h = harness(t), meta = h.offer(6);
  h.inject(meta); await h.flush(); await h.engine.accept(meta.id);
  h.inject(makeFrame(meta.id, 3, new Uint8Array([1, 2, 3]))); await h.flush();
  assert.equal(h.channel.readyState, 'closed');
  assert.match(h.notices.at(-1), /out of sequence/);
});

test('file beyond receiver capacity gets an item error, not an accepted transfer', async t => {
  const h = harness(t), meta = h.offer(1024 * 1024 + 1);
  h.inject(meta); await h.flush();
  assert.equal(h.engine.items.length, 0);
  assert.equal(h.sent.at(-1).type, 'error');
  assert.equal(h.channel.readyState, 'open');
});

test('malicious peer cannot grow the pending application receive queue without bound', async t => {
  const h = harness(t), id = randomUUID();
  for (let n = 0; n < 100; n++) h.inject(makeFrame(id, 0, new Uint8Array(16360)));
  assert.equal(h.channel.readyState, 'closed');
  assert.ok(h.engine.queuedReadBytes <= 1048576);
  await h.flush();
  assert.equal(h.engine.queuedReadBytes, 0);
  assert.match(h.notices.at(-1), /safety limits/);
});

test('cancelled incoming items ignore late finish and data messages', async t => {
  const h = harness(t), meta = h.offer(), bytes = new Uint8Array([1, 2, 3]);
  h.inject(meta); await h.flush(); await h.engine.accept(meta.id); await h.engine.cancel(meta.id);
  h.inject(makeFrame(meta.id, 0, bytes));
  h.inject({ type: 'finish', id: meta.id, digest: new SHA256().update(bytes).digest() }); await h.flush();
  assert.equal(h.engine.items[0].state, 'cancelled');
  assert.equal(h.sent.some(message => message.type === 'complete'), false);
});
