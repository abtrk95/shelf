import { SHA256 } from './sha256.js';
import { CHUNK_BYTES, WINDOW_BYTES, MAX_ITEMS, MAX_TEXT_BYTES, makeFrame, readFrame, parseControl } from './protocol.js';
import { TemporaryStorage, type ReceiveStore } from './storage.js';
import type { ShelfItem, Offer, Control, ContentKind } from './types.js';
import { errorMessage, safeURL, sleep } from './utils.js';

interface Outgoing {
  item: ShelfItem; blob: Blob; acked: number; sent: number; running: boolean;
  lastAck: number; persistedAt: number; digest?: string;
}
interface Incoming {
  item: ShelfItem; meta: Offer; store?: ReceiveStore; hash: SHA256;
  received: number; ackAt: number; started: number; persistedAt: number;
}
interface PeerIdentity { deviceId: string; name: string }
const FINISHED = new Set(['complete', 'declined', 'cancelled', 'error']);
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKPOINT_BYTES = 1024 * 1024;

export class TransferEngine {
  readonly items: ShelfItem[] = [];
  private outgoing = new Map<string, Outgoing>();
  private incoming = new Map<string, Incoming>();
  private channel: RTCDataChannel | null = null;
  private peer: PeerIdentity | null = null;
  private epoch = 0;
  private readQueue: Promise<void> = Promise.resolve();
  private queuedReadBytes = 0;
  private queuedReadMessages = 0;
  private writeRunning = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastNotify = 0;
  private destroyed = false;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistenceWarning = false;

  constructor(
    readonly storage: TemporaryStorage,
    private maxBytes: number,
    private changed: () => void,
    private notice: (message: string) => void,
    private completed: (item: ShelfItem) => void,
  ) {}

  get limit(): number { return Math.min(this.maxBytes, this.storage.maxFileBytes); }
  get connected(): boolean { return this.channel?.readyState === 'open'; }
  get active(): boolean { return this.items.some(i => ['sending','receiving','preparing','verifying'].includes(i.state)); }

  setPeer(peer: PeerIdentity | null): void {
    this.peer = peer;
    if (peer && this.connected) {
      for (const outgoing of this.outgoing.values()) {
        if (!FINISHED.has(outgoing.item.state) && !outgoing.running) this.offer(outgoing);
      }
    }
  }

  private async writeItem(item: ShelfItem): Promise<void> {
    await this.storage.saveItem(item);
  }
  private queueItem(item: ShelfItem): void {
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(() => this.writeItem(item))
      .catch(error => {
        if (!this.persistenceWarning) {
          this.persistenceWarning = true;
          this.notice('Shelf could not save an item locally. Keep this tab open until the transfer finishes. ' + errorMessage(error));
        }
      });
  }
  async flushPersistence(): Promise<void> { await this.persistenceQueue.catch(() => undefined); }

  private notify(immediate = false): void {
    if (this.destroyed) return;
    if (immediate || Date.now() - this.lastNotify > 160) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.lastNotify = Date.now();
      this.changed();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.lastNotify = Date.now();
        this.changed();
      }, 160);
    }
  }

  private async blobFor(item: ShelfItem): Promise<Blob | null> {
    if (item.kind !== 'file' && item.text !== undefined) return new Blob([item.text], { type:item.mime || 'text/plain' });
    return await this.storage.loadBlob(item.id) || item.file || null;
  }

  private async hashPrefix(blob: Blob, length: number): Promise<SHA256> {
    const hash = new SHA256();
    for (let position = 0; position < length; position += 1048576) {
      hash.update(new Uint8Array(await blob.slice(position, Math.min(length, position + 1048576)).arrayBuffer()));
    }
    return hash;
  }

  async restore(): Promise<void> {
    const saved = await this.storage.loadItems();
    for (const item of saved.slice(0, MAX_ITEMS)) {
      if (!item.pinned && Date.now() - item.createdAt > RETENTION_MS) {
        await this.storage.removeItem(item.id).catch(() => undefined);
        continue;
      }
      item.speed = 0;
      item.accepted = false;
      item.url = undefined;
      item.file = undefined;

      if (item.direction === 'sent') {
        const blob = await this.blobFor(item);
        if (blob) {
          item.file = blob;
          if (item.kind === 'file' && /^image\/(png|jpeg|webp|gif|avif)$/.test(item.mime)) item.url = URL.createObjectURL(blob);
        }
        if (!FINISHED.has(item.state)) {
          if (!blob) {
            item.state = 'error';
            item.error = 'The original file is no longer available in this browser.';
          } else {
            item.state = 'queued';
            item.accepted = false;
            this.outgoing.set(item.id, {
              item, blob, acked:0, sent:0, running:false, lastAck:Date.now(), persistedAt:item.bytes || 0,
            });
          }
        }
        this.items.push(item);
        continue;
      }

      const persistedBlob = await this.blobFor(item);
      if (item.state === 'complete') {
        if (persistedBlob) {
          item.file = persistedBlob;
          if (item.kind !== 'file' && item.text === undefined) item.text = await persistedBlob.text();
          if (item.kind === 'file' && /^image\/(png|jpeg|webp|gif|avif)$/.test(item.mime)) item.url = URL.createObjectURL(persistedBlob);
        } else {
          item.state = 'error';
          item.error = 'This received file is no longer available in browser storage.';
        }
        this.items.push(item);
        if (item.digest) {
          this.incoming.set(item.id, {
            item,
            meta:{ type:'offer', id:item.id, name:item.name, mime:item.mime, size:item.size, kind:item.kind },
            hash:new SHA256(), received:item.size, ackAt:item.size, started:Date.now(), persistedAt:item.size,
          });
        }
        continue;
      }

      if (!FINISHED.has(item.state)) {
        let received = 0;
        let hash = new SHA256();
        let store: ReceiveStore | undefined;
        if (this.storage.mode === 'disk' && persistedBlob) {
          received = Math.min(item.bytes || 0, persistedBlob.size, item.size);
          if (received > 0) hash = await this.hashPrefix(persistedBlob, received);
          store = await this.storage.create(item.id, item.size, received);
          received = store.offset;
          if (received === 0) hash = new SHA256();
        }
        item.bytes = received;
        item.progress = item.size ? received / item.size : 0;
        item.state = 'incoming';
        item.accepted = false;
        this.incoming.set(item.id, {
          item,
          meta:{ type:'offer', id:item.id, name:item.name, mime:item.mime, size:item.size, kind:item.kind },
          store, hash, received, ackAt:received, started:Date.now(), persistedAt:received,
        });
      }
      this.items.push(item);
    }
    this.notify(true);
  }

  setChannel(channel: RTCDataChannel | null): void {
    if (this.channel === channel) return;
    if (this.channel) this.channel.onmessage = null;
    this.channel = channel;
    this.epoch++;

    if (!channel) {
      for (const item of this.items) {
        if (!FINISHED.has(item.state) && !['queued','incoming'].includes(item.state)) {
          item.state = 'paused';
          item.accepted = false;
          this.queueItem(item);
        }
      }
      this.notify(true);
      return;
    }

    channel.bufferedAmountLowThreshold = WINDOW_BYTES / 2;
    channel.onmessage = event => {
      const size = typeof event.data === 'string' ? event.data.length * 2 : event.data instanceof ArrayBuffer ? event.data.byteLength : 0;
      if (!size || this.queuedReadBytes + size > 1048576 || this.queuedReadMessages >= 256) {
        channel.onmessage = null;
        channel.close();
        this.notice('The transfer connection exceeded its safety limits. Reconnect and retry.');
        return;
      }
      this.queuedReadBytes += size;
      this.queuedReadMessages++;
      const epoch = this.epoch;
      this.readQueue = this.readQueue.then(async () => {
        if (epoch !== this.epoch || this.destroyed) return;
        if (typeof event.data === 'string') await this.control(parseControl(event.data, this.maxBytes));
        else if (event.data instanceof ArrayBuffer) await this.chunk(event.data);
        else throw new Error('Unsupported transfer message.');
      }).catch(error => {
        this.notice(errorMessage(error));
        if (this.channel === channel) {
          channel.onmessage = null;
          channel.close();
        }
      }).finally(() => {
        this.queuedReadBytes -= size;
        this.queuedReadMessages--;
      });
    };

    for (const outgoing of this.outgoing.values()) {
      if (!FINISHED.has(outgoing.item.state)) {
        outgoing.item.accepted = false;
        this.offer(outgoing);
      }
    }
    this.notify(true);
  }

  private send(message: Control): void {
    if (this.connected) this.channel!.send(JSON.stringify(message));
  }

  addFiles(files: File[]): void {
    for (const file of files) {
      if (file.size > this.maxBytes) {
        this.notice(file.name + ': the configured file-size limit was exceeded.');
        continue;
      }
      this.add(file, file.webkitRelativePath || file.name, file.type || 'application/octet-stream', 'file', true);
    }
  }

  addText(text: string): void {
    if (!text.trim()) return;
    const value = text;
    const blob = new Blob([value], { type:'text/plain;charset=utf-8' });
    if (blob.size > MAX_TEXT_BYTES) throw new Error('Text is limited to 128 KB. Save longer text as a file.');
    const url = safeURL(value);
    this.add(blob, url ? new URL(url).hostname : 'Text snippet', 'text/plain', url ? 'link' : 'text', false, value);
  }

  private add(blob: Blob, name: string, mime: string, kind: ContentKind, persistBlob: boolean, text?: string): ShelfItem | null {
    if (this.items.length >= MAX_ITEMS) {
      this.notice('Your shelf is full. Remove a few items before adding more.');
      return null;
    }
    const item: ShelfItem = {
      id:crypto.randomUUID(), name:name.slice(0,256), mime:mime.slice(0,120), size:blob.size, kind,
      direction:'sent', state:persistBlob ? 'preparing' : 'queued', createdAt:Date.now(),
      bytes:0, speed:0, progress:0, accepted:false, file:blob, text,
      targetDeviceId:this.peer?.deviceId, targetDeviceName:this.peer?.name,
    };
    if (kind === 'file' && /^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) item.url = URL.createObjectURL(blob);
    const outgoing: Outgoing = { item, blob, acked:0, sent:0, running:false, lastAck:Date.now(), persistedAt:0 };
    this.items.unshift(item);

    if (persistBlob) {
      void this.prepareOutgoing(outgoing);
    } else {
      this.outgoing.set(item.id, outgoing);
      this.queueItem(item);
      if (this.connected) this.offer(outgoing);
    }
    this.notify(true);
    return item;
  }

  private async prepareOutgoing(outgoing: Outgoing): Promise<void> {
    try {
      await this.storage.saveBlob(outgoing.item.id, outgoing.blob);
      if (['cancelled','declined'].includes(outgoing.item.state)) {
        await this.storage.removeBlob(outgoing.item.id).catch(() => undefined);
        return;
      }
      this.outgoing.set(outgoing.item.id, outgoing);
      outgoing.item.state = 'queued';
      await this.writeItem(outgoing.item);
      if (this.connected) this.offer(outgoing);
    } catch (error) {
      outgoing.item.state = 'error';
      outgoing.item.error = 'Could not save this item in browser storage. ' + errorMessage(error);
      this.queueItem(outgoing.item);
    }
    this.notify(true);
  }

  private offer(outgoing: Outgoing): void {
    if (!this.peer || !this.connected || FINISHED.has(outgoing.item.state)) return;
    const item = outgoing.item;
    if (item.targetDeviceId && item.targetDeviceId !== this.peer.deviceId) {
      item.state = 'paused';
      this.queueItem(item);
      return;
    }
    if (!item.targetDeviceId) {
      item.targetDeviceId = this.peer.deviceId;
      item.targetDeviceName = this.peer.name;
    }
    this.send({ type:'offer', id:item.id, name:item.name, mime:item.mime, size:item.size, kind:item.kind });
    item.state = 'offered';
    this.queueItem(item);
  }

  async accept(id: string): Promise<void> {
    const incoming = this.incoming.get(id);
    if (!incoming || incoming.item.state !== 'incoming' || !this.connected) return;
    incoming.item.state = 'preparing';
    this.notify(true);
    try {
      if (!incoming.store) incoming.store = await this.storage.create(id, incoming.meta.size, incoming.received);
      if (incoming.store.offset !== incoming.received) {
        incoming.received = incoming.store.offset;
        const partial = await this.storage.loadBlob(id);
        incoming.hash = incoming.received && partial ? await this.hashPrefix(partial, incoming.received) : new SHA256();
      }
      if (incoming.item.state as string === 'cancelled' || this.destroyed) {
        await incoming.store.dispose();
        return;
      }
      incoming.item.accepted = true;
      incoming.item.state = 'receiving';
      incoming.started = Date.now();
      incoming.item.bytes = incoming.received;
      incoming.item.progress = incoming.meta.size ? incoming.received / incoming.meta.size : 0;
      this.send({ type:'accept', id, offset:incoming.received });
      this.queueItem(incoming.item);
      this.notify(true);
    } catch (error) {
      this.failIncoming(incoming, errorMessage(error));
    }
  }

  decline(id: string): void {
    const incoming = this.incoming.get(id);
    if (!incoming || incoming.item.state !== 'incoming') return;
    incoming.item.state = 'declined';
    this.send({ type:'decline', id });
    this.queueItem(incoming.item);
    this.notify(true);
  }

  async cancel(id: string): Promise<void> {
    const item = this.items.find(i => i.id === id);
    if (!item || FINISHED.has(item.state)) return;
    item.state = 'cancelled';
    item.accepted = false;
    this.send({ type:'cancel', id });
    await this.incoming.get(id)?.store?.dispose();
    this.queueItem(item);
    this.notify(true);
  }

  retry(id: string): void {
    const outgoing = this.outgoing.get(id);
    if (!outgoing || !['error','cancelled','declined'].includes(outgoing.item.state)) return;
    outgoing.acked = outgoing.sent = 0;
    outgoing.running = false;
    outgoing.lastAck = Date.now();
    outgoing.digest = undefined;
    outgoing.item.state = 'queued';
    outgoing.item.error = undefined;
    outgoing.item.bytes = 0;
    outgoing.item.progress = 0;
    outgoing.item.accepted = false;
    this.queueItem(outgoing.item);
    if (this.connected) this.offer(outgoing);
    this.notify(true);
  }

  async remove(id: string): Promise<void> {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    if (!FINISHED.has(item.state)) await this.cancel(id);
    if (item.url) URL.revokeObjectURL(item.url);
    await this.incoming.get(id)?.store?.dispose();
    this.outgoing.delete(id);
    this.incoming.delete(id);
    const index = this.items.indexOf(item);
    if (index >= 0) this.items.splice(index,1);
    await this.storage.removeItem(id);
    this.notify(true);
  }

  async clearFinished(): Promise<void> {
    for (const item of [...this.items]) if (FINISHED.has(item.state)) await this.remove(item.id);
  }

  private async control(message: Control): Promise<void> {
    if (message.type === 'offer') {
      if (message.size > this.limit) {
        this.send({ type:'error', id:message.id, message:'This file is larger than the receiving browser supports. Try a smaller file or another browser.' });
        return;
      }
      let incoming = this.incoming.get(message.id);
      if (incoming) {
        if (message.size !== incoming.meta.size || message.name !== incoming.meta.name || message.mime !== incoming.meta.mime || message.kind !== incoming.meta.kind) {
          throw new Error('The transfer changed unexpectedly.');
        }
        if (incoming.item.sourceDeviceId && this.peer && incoming.item.sourceDeviceId !== this.peer.deviceId) throw new Error('The transfer source changed unexpectedly.');
        if (incoming.item.state === 'complete') {
          this.send({ type:'complete', id:message.id, digest:incoming.item.digest! });
          return;
        }
        if (incoming.item.state === 'declined') {
          this.send({ type:'decline', id:message.id });
          return;
        }
        if (['cancelled','error'].includes(incoming.item.state)) {
          this.send({ type:'cancel', id:message.id });
          return;
        }
        incoming.item.state = 'incoming';
        incoming.item.accepted = false;
        await this.accept(message.id);
        return;
      }

      if (this.items.length >= MAX_ITEMS) {
        this.send({ type:'error', id:message.id, message:'The receiving shelf is full.' });
        return;
      }
      if (this.outgoing.has(message.id)) throw new Error('The transfer identifier is already in use.');
      const reserved = this.items
        .filter(i => i.direction === 'received' && !['error','cancelled','declined'].includes(i.state))
        .reduce((sum,i) => sum + i.size, 0);
      if (reserved + message.size > this.storage.maxFileBytes) {
        this.send({ type:'error', id:message.id, message:'The receiving shelf is full. Remove received items to free browser storage.' });
        return;
      }

      const item: ShelfItem = {
        id:message.id, name:message.name, mime:message.mime, size:message.size, kind:message.kind,
        direction:'received', state:'incoming', createdAt:Date.now(), bytes:0, speed:0, progress:0, accepted:false,
        sourceDeviceId:this.peer?.deviceId, sourceDeviceName:this.peer?.name,
      };
      incoming = {
        item, meta:message, hash:new SHA256(), received:0, ackAt:0, started:Date.now(), persistedAt:0,
      };
      this.incoming.set(item.id, incoming);
      this.items.unshift(item);
      await this.writeItem(item);
      await this.accept(item.id);
      return;
    }

    if (message.type === 'accept') {
      const outgoing = this.outgoing.get(message.id);
      if (!outgoing || FINISHED.has(outgoing.item.state)) return;
      if (message.offset > outgoing.blob.size) throw new Error('Invalid resume position.');
      if (outgoing.running) return;
      outgoing.acked = outgoing.sent = message.offset;
      outgoing.lastAck = Date.now();
      outgoing.item.accepted = true;
      outgoing.item.state = 'preparing';
      outgoing.item.bytes = message.offset;
      outgoing.item.progress = outgoing.blob.size ? message.offset / outgoing.blob.size : 0;
      this.queueItem(outgoing.item);
      this.notify(true);
      void this.pumpNext();
      return;
    }

    if (message.type === 'ack') {
      const outgoing = this.outgoing.get(message.id);
      if (!outgoing) return;
      if (message.offset < outgoing.acked || message.offset > outgoing.sent) throw new Error('Invalid transfer acknowledgement.');
      outgoing.acked = message.offset;
      outgoing.lastAck = Date.now();
      outgoing.item.bytes = message.offset;
      outgoing.item.progress = outgoing.blob.size ? message.offset / outgoing.blob.size : 0;
      if (message.offset - outgoing.persistedAt >= CHECKPOINT_BYTES || message.offset === outgoing.blob.size) {
        outgoing.persistedAt = message.offset;
        this.queueItem(outgoing.item);
      }
      this.notify();
      return;
    }

    if (message.type === 'finish') {
      const incoming = this.incoming.get(message.id);
      if (!incoming || !incoming.item.accepted || !incoming.store || FINISHED.has(incoming.item.state)) return;
      if (incoming.received !== incoming.meta.size) {
        this.failIncoming(incoming, 'The file was incomplete. Please send it again.');
        return;
      }
      incoming.item.state = 'verifying';
      this.notify(true);
      const digest = incoming.hash.digest();
      if (digest !== message.digest) {
        this.failIncoming(incoming, 'Integrity verification failed. Please send the item again.');
        return;
      }
      try {
        const blob = await incoming.store.finish(incoming.meta.mime);
        if (!incoming.item.accepted || this.destroyed) return;
        if (this.storage.mode !== 'disk') await this.storage.saveBlob(incoming.item.id, blob);
        incoming.item.file = blob;
        incoming.item.digest = digest;
        incoming.item.bytes = blob.size;
        incoming.item.progress = 1;
        if (incoming.meta.kind !== 'file') {
          incoming.item.text = await blob.text();
          if (incoming.meta.kind === 'link' && !safeURL(incoming.item.text)) incoming.item.kind = 'text';
        } else if (/^image\/(png|jpeg|webp|gif|avif)$/.test(incoming.item.mime)) {
          incoming.item.url = URL.createObjectURL(blob);
        }
        incoming.item.state = 'complete';
        await this.writeItem(incoming.item);
        this.send({ type:'complete', id:message.id, digest });
        this.notify(true);
        this.completed(incoming.item);
      } catch (error) {
        this.failIncoming(incoming, errorMessage(error));
      }
      return;
    }

    if (message.type === 'complete') {
      const outgoing = this.outgoing.get(message.id);
      if (!outgoing) return;
      if (!outgoing.digest || outgoing.digest !== message.digest) {
        outgoing.item.state = 'error';
        outgoing.item.error = 'The delivery could not be verified. Retry this item.';
      } else {
        outgoing.item.digest = message.digest;
        outgoing.item.bytes = outgoing.blob.size;
        outgoing.item.progress = 1;
        outgoing.item.state = 'complete';
        this.completed(outgoing.item);
      }
      await this.writeItem(outgoing.item);
      this.notify(true);
      return;
    }

    const item = this.items.find(i => i.id === message.id);
    if (!item || item.state === 'complete') return;
    if (message.type === 'decline') item.state = 'declined';
    else if (message.type === 'cancel') {
      item.state = 'cancelled';
      item.accepted = false;
      await this.incoming.get(message.id)?.store?.dispose();
    } else if (message.type === 'error') {
      item.state = 'error';
      item.error = message.message;
      item.accepted = false;
      await this.incoming.get(message.id)?.store?.dispose();
    }
    this.queueItem(item);
    this.notify(true);
  }

  private async chunk(buffer: ArrayBuffer): Promise<void> {
    const { id, offset, bytes } = readFrame(buffer);
    const incoming = this.incoming.get(id);
    if (!incoming || !incoming.item.accepted || !incoming.store) return;
    if (FINISHED.has(incoming.item.state)) return;
    if (offset < incoming.received) {
      this.send({ type:'ack', id, offset:incoming.received });
      return;
    }
    if (offset !== incoming.received || offset + bytes.length > incoming.meta.size) throw new Error('The transfer data is out of sequence.');
    try {
      await incoming.store.write(bytes);
    } catch (error) {
      this.failIncoming(incoming, errorMessage(error));
      return;
    }
    if (!incoming.item.accepted) return;
    incoming.hash.update(bytes);
    incoming.received += bytes.length;
    incoming.item.bytes = incoming.received;
    incoming.item.progress = incoming.meta.size ? incoming.received / incoming.meta.size : 0;
    incoming.item.speed = incoming.received / Math.max(1, (Date.now() - incoming.started) / 1000);
    incoming.item.state = 'receiving';
    if (incoming.received - incoming.ackAt >= 65536 || incoming.received === incoming.meta.size) {
      incoming.ackAt = incoming.received;
      this.send({ type:'ack', id, offset:incoming.received });
    }
    if (incoming.received - incoming.persistedAt >= CHECKPOINT_BYTES || incoming.received === incoming.meta.size) {
      incoming.persistedAt = incoming.received;
      this.queueItem(incoming.item);
    }
    this.notify();
  }

  private failIncoming(incoming: Incoming, message: string): void {
    incoming.item.state = 'error';
    incoming.item.error = message;
    incoming.item.accepted = false;
    this.send({ type:'error', id:incoming.item.id, message:message.slice(0,200) });
    void incoming.store?.dispose();
    this.queueItem(incoming.item);
    this.notify(true);
  }

  private async pumpNext(): Promise<void> {
    if (this.writeRunning || !this.connected || this.destroyed) return;
    const outgoing = [...this.outgoing.values()].find(o => o.item.accepted && !o.running && !FINISHED.has(o.item.state));
    if (!outgoing) return;
    this.writeRunning = true;
    outgoing.running = true;
    const epoch = this.epoch;
    try {
      await this.pump(outgoing, epoch);
    } catch (error) {
      if (!FINISHED.has(outgoing.item.state)) {
        if (epoch !== this.epoch || !this.connected) {
          outgoing.item.state = 'paused';
          outgoing.item.accepted = false;
        } else {
          outgoing.item.state = 'error';
          outgoing.item.error = errorMessage(error);
          outgoing.item.accepted = false;
          this.send({ type:'error', id:outgoing.item.id, message:'The sender could not finish this transfer. Please retry.' });
        }
        this.queueItem(outgoing.item);
      }
    } finally {
      outgoing.running = false;
      this.writeRunning = false;
      this.notify(true);
      if (this.connected && epoch !== this.epoch && !FINISHED.has(outgoing.item.state)) {
        outgoing.item.accepted = false;
        this.offer(outgoing);
      }
      void this.pumpNext();
    }
  }

  private async pump(outgoing: Outgoing, epoch: number): Promise<void> {
    const { item, blob } = outgoing;
    const hash = new SHA256();
    const channel = this.channel!;
    const check = () => {
      if (epoch !== this.epoch || channel.readyState !== 'open' || !item.accepted || FINISHED.has(item.state)) {
        throw new Error('Transfer interrupted.');
      }
    };
    for (let position = 0; position < outgoing.acked; position += 1048576) {
      check();
      hash.update(new Uint8Array(await blob.slice(position, Math.min(outgoing.acked, position + 1048576)).arrayBuffer()));
    }
    item.state = 'sending';
    this.queueItem(item);
    this.notify(true);
    const started = Date.now(), base = outgoing.acked;
    for (let position = outgoing.acked; position < blob.size;) {
      check();
      while (channel.bufferedAmount > WINDOW_BYTES || outgoing.sent - outgoing.acked >= WINDOW_BYTES) {
        check();
        if (Date.now() - outgoing.lastAck > 45000) throw new Error('The other device stopped responding. Keep both tabs open and retry.');
        await sleep(12);
      }
      const data = new Uint8Array(await blob.slice(position, Math.min(blob.size, position + CHUNK_BYTES)).arrayBuffer());
      check();
      hash.update(data);
      channel.send(makeFrame(item.id, position, data));
      position += data.length;
      outgoing.sent = position;
      item.speed = (outgoing.acked - base) / Math.max(1, (Date.now() - started) / 1000);
      this.notify();
    }
    outgoing.digest = hash.digest();
    check();
    item.state = 'verifying';
    this.queueItem(item);
    this.send({ type:'finish', id:item.id, digest:outgoing.digest });
    this.notify(true);
    const deadline = Date.now() + 60000;
    while (!FINISHED.has(item.state)) {
      check();
      if (Date.now() > deadline) throw new Error('The receiver has not confirmed delivery. Retry to verify it.');
      await sleep(50);
    }
  }

  async suspend(): Promise<void> {
    for (const item of this.items) {
      if (!FINISHED.has(item.state) && !['queued','incoming'].includes(item.state)) {
        item.state = item.direction === 'sent' ? 'paused' : 'incoming';
        item.accepted = false;
      }
      this.queueItem(item);
    }
    for (const incoming of this.incoming.values()) {
      if (incoming.store?.pause) await incoming.store.pause().catch(() => undefined);
    }
    await this.flushPersistence();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    await this.suspend();
    this.destroyed = true;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    if (this.channel) this.channel.onmessage = null;
    this.channel = null;
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
    this.items.length = 0;
    this.incoming.clear();
    this.outgoing.clear();
    await this.storage.dispose();
  }
}
