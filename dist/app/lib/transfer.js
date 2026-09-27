import { SHA256 } from './sha256.js';
import { CHUNK_BYTES, WINDOW_BYTES, MAX_ITEMS, MAX_TEXT_BYTES, makeFrame, readFrame, parseControl } from './protocol.js';
import { errorMessage, safeURL, sleep } from './utils.js';
const FINISHED = new Set(['complete', 'declined', 'cancelled', 'error']);
export class TransferEngine {
    storage;
    maxBytes;
    changed;
    notice;
    completed;
    items = [];
    outgoing = new Map();
    incoming = new Map();
    channel = null;
    epoch = 0;
    readQueue = Promise.resolve();
    queuedReadBytes = 0;
    queuedReadMessages = 0;
    writeRunning = false;
    timer = null;
    lastNotify = 0;
    destroyed = false;
    constructor(storage, maxBytes, changed, notice, completed) {
        this.storage = storage;
        this.maxBytes = maxBytes;
        this.changed = changed;
        this.notice = notice;
        this.completed = completed;
    }
    get limit() { return Math.min(this.maxBytes, this.storage.maxFileBytes); }
    get connected() { return this.channel?.readyState === 'open'; }
    get active() { return this.items.some(i => ['sending', 'receiving', 'preparing', 'verifying'].includes(i.state)); }
    notify(immediate = false) {
        if (this.destroyed)
            return;
        if (immediate || Date.now() - this.lastNotify > 160) {
            if (this.timer)
                clearTimeout(this.timer);
            this.timer = null;
            this.lastNotify = Date.now();
            this.changed();
        }
        else if (!this.timer)
            this.timer = setTimeout(() => { this.timer = null; this.lastNotify = Date.now(); this.changed(); }, 160);
    }
    setChannel(channel) {
        if (this.channel === channel)
            return;
        if (this.channel)
            this.channel.onmessage = null;
        this.channel = channel;
        this.epoch++;
        for (const item of this.items)
            if (!FINISHED.has(item.state) && !['queued', 'incoming'].includes(item.state))
                item.state = 'paused';
        if (channel) {
            channel.bufferedAmountLowThreshold = WINDOW_BYTES / 2;
            channel.onmessage = event => {
                // A hostile approved peer must not create an unbounded disk-write queue.
                const size = typeof event.data === 'string' ? event.data.length * 2 : event.data instanceof ArrayBuffer ? event.data.byteLength : 0;
                if (!size || this.queuedReadBytes + size > 1048576 || this.queuedReadMessages >= 256) {
                    channel.onmessage = null;
                    channel.close();
                    this.notice('The transfer connection exceeded its safety limits. Reconnect and retry.');
                    return;
                }
                this.queuedReadBytes += size;
                this.queuedReadMessages++;
                // Serialize writes and finalization. A finish message cannot overtake a disk write.
                const epoch = this.epoch;
                this.readQueue = this.readQueue.then(async () => {
                    if (epoch !== this.epoch || this.destroyed)
                        return;
                    if (typeof event.data === 'string')
                        await this.control(parseControl(event.data, this.maxBytes));
                    else if (event.data instanceof ArrayBuffer)
                        await this.chunk(event.data);
                    else
                        throw new Error('Unsupported transfer message.');
                }).catch(error => {
                    this.notice(errorMessage(error));
                    // Protocol violations end this channel instead of accepting unknown payloads.
                    if (this.channel === channel) {
                        channel.onmessage = null;
                        channel.close();
                    }
                }).finally(() => { this.queuedReadBytes -= size; this.queuedReadMessages--; });
            };
            for (const outgoing of this.outgoing.values()) {
                if (!FINISHED.has(outgoing.item.state)) {
                    outgoing.item.accepted = false;
                    this.offer(outgoing);
                }
            }
        }
        this.notify(true);
    }
    send(message) { if (this.connected)
        this.channel.send(JSON.stringify(message)); }
    addFiles(files) {
        for (const file of files) {
            if (file.size > this.maxBytes) {
                this.notice(`${file.name}: the configured file-size limit was exceeded.`);
                continue;
            }
            this.add(file, file.webkitRelativePath || file.name, file.type || 'application/octet-stream', 'file');
        }
    }
    addText(text) {
        const value = text.trim();
        if (!value)
            return;
        const blob = new Blob([value], { type: 'text/plain;charset=utf-8' });
        if (blob.size > MAX_TEXT_BYTES)
            throw new Error('Text is limited to 128 KB. Save longer text as a file.');
        const url = safeURL(value);
        const item = this.add(blob, url ? new URL(url).hostname : 'Text snippet', 'text/plain', url ? 'link' : 'text');
        if (item) {
            item.text = value;
            this.notify(true);
        }
    }
    add(blob, name, mime, kind) {
        if (this.items.length >= MAX_ITEMS) {
            this.notice('Your shelf is full. Remove a few items before adding more.');
            return null;
        }
        const item = { id: crypto.randomUUID(), name: name.slice(0, 256), mime: mime.slice(0, 120), size: blob.size, kind, direction: 'sent', state: 'queued', createdAt: Date.now(), bytes: 0, speed: 0, progress: 0, accepted: false, file: blob };
        if (kind === 'file' && /^(image\/(png|jpeg|webp|gif|avif))$/.test(mime))
            item.url = URL.createObjectURL(blob);
        const outgoing = { item, blob, acked: 0, sent: 0, running: false, lastAck: Date.now() };
        this.outgoing.set(item.id, outgoing);
        this.items.unshift(item);
        if (this.connected)
            this.offer(outgoing);
        this.notify(true);
        return item;
    }
    offer(outgoing) {
        const { item } = outgoing;
        this.send({ type: 'offer', id: item.id, name: item.name, mime: item.mime, size: item.size, kind: item.kind });
        item.state = 'offered';
    }
    async accept(id) {
        const incoming = this.incoming.get(id);
        if (!incoming || incoming.item.state !== 'incoming' || !this.connected)
            return;
        incoming.item.state = 'preparing';
        this.notify(true);
        try {
            incoming.store = await this.storage.create(id, incoming.meta.size);
            if (incoming.item.state === 'cancelled' || this.destroyed) {
                await incoming.store.dispose();
                return;
            }
            incoming.item.accepted = true;
            incoming.item.state = 'receiving';
            incoming.started = Date.now();
            this.send({ type: 'accept', id, offset: incoming.received });
            this.notify(true);
        }
        catch (error) {
            this.failIncoming(incoming, errorMessage(error));
        }
    }
    decline(id) {
        const incoming = this.incoming.get(id);
        if (!incoming || incoming.item.state !== 'incoming')
            return;
        incoming.item.state = 'declined';
        this.send({ type: 'decline', id });
        this.notify(true);
    }
    async cancel(id) {
        const item = this.items.find(i => i.id === id);
        if (!item || FINISHED.has(item.state))
            return;
        item.state = 'cancelled';
        item.accepted = false;
        this.send({ type: 'cancel', id });
        await this.incoming.get(id)?.store?.dispose();
        this.notify(true);
    }
    retry(id) {
        const outgoing = this.outgoing.get(id);
        if (!outgoing || !['error', 'cancelled', 'declined'].includes(outgoing.item.state))
            return;
        const original = outgoing.item;
        const copy = this.add(outgoing.blob, original.name, original.mime, original.kind);
        if (copy) {
            copy.text = original.text;
            void this.remove(id);
        }
        this.notify(true);
    }
    async remove(id) {
        const item = this.items.find(i => i.id === id);
        if (!item)
            return;
        if (!FINISHED.has(item.state))
            await this.cancel(id);
        if (item.url)
            URL.revokeObjectURL(item.url);
        await this.incoming.get(id)?.store?.dispose();
        this.outgoing.delete(id);
        this.incoming.delete(id);
        const index = this.items.indexOf(item);
        if (index >= 0)
            this.items.splice(index, 1);
        this.notify(true);
    }
    async clearFinished() { for (const item of [...this.items])
        if (FINISHED.has(item.state))
            await this.remove(item.id); }
    async control(message) {
        if (message.type === 'offer') {
            if (message.size > this.limit) {
                this.send({ type: 'error', id: message.id, message: 'This file is larger than the receiving browser supports. Try a smaller file or another browser.' });
                return;
            }
            let incoming = this.incoming.get(message.id);
            if (incoming) {
                if (message.size !== incoming.meta.size || message.name !== incoming.meta.name || message.mime !== incoming.meta.mime || message.kind !== incoming.meta.kind)
                    throw new Error('The transfer changed unexpectedly.');
                if (incoming.item.state === 'complete') {
                    this.send({ type: 'complete', id: message.id, digest: incoming.item.digest });
                    return;
                }
                if (incoming.item.state === 'declined') {
                    this.send({ type: 'decline', id: message.id });
                    return;
                }
                if (['cancelled', 'error'].includes(incoming.item.state)) {
                    this.send({ type: 'cancel', id: message.id });
                    return;
                }
                if (incoming.item.accepted && incoming.store) {
                    incoming.item.state = 'receiving';
                    this.send({ type: 'accept', id: message.id, offset: incoming.received });
                }
                this.notify(true);
                return;
            }
            if (this.items.length >= MAX_ITEMS) {
                this.send({ type: 'error', id: message.id, message: 'The receiving shelf is full.' });
                return;
            }
            const item = { id: message.id, name: message.name, mime: message.mime, size: message.size, kind: message.kind, direction: 'received', state: 'incoming', createdAt: Date.now(), bytes: 0, speed: 0, progress: 0, accepted: false };
            incoming = { item, meta: message, hash: new SHA256(), received: 0, ackAt: 0, started: Date.now() };
            this.incoming.set(item.id, incoming);
            this.items.unshift(item);
            this.notice('An item is ready to receive.');
            this.notify(true);
            return;
        }
        if (message.type === 'accept') {
            const outgoing = this.outgoing.get(message.id);
            if (!outgoing || FINISHED.has(outgoing.item.state))
                return;
            if (message.offset > outgoing.blob.size)
                throw new Error('Invalid resume position.');
            // Do not restart a currently running sender on a duplicate acceptance.
            if (outgoing.running)
                return;
            outgoing.acked = outgoing.sent = message.offset;
            outgoing.lastAck = Date.now();
            outgoing.item.accepted = true;
            outgoing.item.state = 'preparing';
            this.notify(true);
            void this.pumpNext();
            return;
        }
        if (message.type === 'ack') {
            const outgoing = this.outgoing.get(message.id);
            if (!outgoing)
                return;
            if (message.offset < outgoing.acked || message.offset > outgoing.sent)
                throw new Error('Invalid transfer acknowledgement.');
            outgoing.acked = message.offset;
            outgoing.lastAck = Date.now();
            outgoing.item.bytes = message.offset;
            outgoing.item.progress = outgoing.blob.size ? message.offset / outgoing.blob.size : 0;
            this.notify();
            return;
        }
        if (message.type === 'finish') {
            const incoming = this.incoming.get(message.id);
            if (!incoming || !incoming.item.accepted || !incoming.store || FINISHED.has(incoming.item.state))
                return;
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
                if (!incoming.item.accepted || this.destroyed)
                    return;
                incoming.item.file = blob;
                incoming.item.digest = digest;
                incoming.item.bytes = blob.size;
                incoming.item.progress = 1;
                if (incoming.meta.kind !== 'file') {
                    incoming.item.text = await blob.text();
                    if (incoming.meta.kind === 'link' && !safeURL(incoming.item.text))
                        incoming.item.kind = 'text';
                }
                else
                    incoming.item.url = URL.createObjectURL(blob);
                incoming.item.state = 'complete';
                this.send({ type: 'complete', id: message.id, digest });
                this.notify(true);
                this.completed();
            }
            catch (error) {
                this.failIncoming(incoming, errorMessage(error));
            }
            return;
        }
        if (message.type === 'complete') {
            const outgoing = this.outgoing.get(message.id);
            if (!outgoing)
                return;
            if (!outgoing.digest || outgoing.digest !== message.digest) {
                outgoing.item.state = 'error';
                outgoing.item.error = 'The delivery could not be verified. Retry this item.';
            }
            else {
                outgoing.item.digest = message.digest;
                outgoing.item.bytes = outgoing.blob.size;
                outgoing.item.progress = 1;
                outgoing.item.state = 'complete';
                this.completed();
            }
            this.notify(true);
            return;
        }
        const item = this.items.find(i => i.id === message.id);
        if (!item || item.state === 'complete')
            return;
        if (message.type === 'decline')
            item.state = 'declined';
        else if (message.type === 'cancel') {
            item.state = 'cancelled';
            item.accepted = false;
            await this.incoming.get(message.id)?.store?.dispose();
        }
        else if (message.type === 'error') {
            item.state = 'error';
            item.error = message.message;
            item.accepted = false;
            await this.incoming.get(message.id)?.store?.dispose();
        }
        this.notify(true);
    }
    async chunk(buffer) {
        const { id, offset, bytes } = readFrame(buffer);
        const incoming = this.incoming.get(id);
        if (!incoming || !incoming.item.accepted || !incoming.store)
            return; // Late in-flight packets after cancellation are harmless.
        if (FINISHED.has(incoming.item.state))
            return;
        if (offset < incoming.received) {
            this.send({ type: 'ack', id, offset: incoming.received });
            return;
        }
        if (offset !== incoming.received || offset + bytes.length > incoming.meta.size)
            throw new Error('The transfer data is out of sequence.');
        try {
            await incoming.store.write(bytes);
        }
        catch (error) {
            this.failIncoming(incoming, errorMessage(error));
            return;
        }
        if (!incoming.item.accepted)
            return;
        incoming.hash.update(bytes);
        incoming.received += bytes.length;
        incoming.item.bytes = incoming.received;
        incoming.item.progress = incoming.meta.size ? incoming.received / incoming.meta.size : 0;
        incoming.item.speed = incoming.received / Math.max(1, (Date.now() - incoming.started) / 1000);
        incoming.item.state = 'receiving';
        if (incoming.received - incoming.ackAt >= 65536 || incoming.received === incoming.meta.size) {
            incoming.ackAt = incoming.received;
            this.send({ type: 'ack', id, offset: incoming.received });
        }
        this.notify();
    }
    failIncoming(incoming, message) {
        incoming.item.state = 'error';
        incoming.item.error = message;
        incoming.item.accepted = false;
        this.send({ type: 'error', id: incoming.item.id, message: message.slice(0, 200) });
        void incoming.store?.dispose();
        this.notify(true);
    }
    async pumpNext() {
        if (this.writeRunning || !this.connected || this.destroyed)
            return;
        const outgoing = [...this.outgoing.values()].find(o => o.item.accepted && !o.running && !FINISHED.has(o.item.state));
        if (!outgoing)
            return;
        this.writeRunning = true;
        outgoing.running = true;
        const epoch = this.epoch;
        try {
            await this.pump(outgoing, epoch);
        }
        catch (error) {
            if (!FINISHED.has(outgoing.item.state)) {
                if (epoch !== this.epoch || !this.connected) {
                    outgoing.item.state = 'paused';
                    outgoing.item.accepted = false;
                }
                else {
                    outgoing.item.state = 'error';
                    outgoing.item.error = errorMessage(error);
                    outgoing.item.accepted = false;
                    this.send({ type: 'error', id: outgoing.item.id, message: 'The sender could not finish this transfer. Please retry.' });
                }
            }
        }
        finally {
            outgoing.running = false;
            this.writeRunning = false;
            this.notify(true);
            // A new channel may have offered this item while the old pump was unwinding.
            if (this.connected && epoch !== this.epoch && !FINISHED.has(outgoing.item.state)) {
                outgoing.item.accepted = false;
                this.offer(outgoing);
            }
            void this.pumpNext();
        }
    }
    async pump(outgoing, epoch) {
        const { item, blob } = outgoing;
        const hash = new SHA256();
        const channel = this.channel;
        const check = () => { if (epoch !== this.epoch || channel.readyState !== 'open' || !item.accepted || FINISHED.has(item.state))
            throw new Error('Transfer interrupted.'); };
        // Rebuild the digest locally on resume. No already-acknowledged bytes are retransmitted.
        for (let position = 0; position < outgoing.acked; position += 1048576) {
            check();
            hash.update(new Uint8Array(await blob.slice(position, Math.min(outgoing.acked, position + 1048576)).arrayBuffer()));
        }
        item.state = 'sending';
        this.notify(true);
        const started = Date.now(), base = outgoing.acked;
        const negotiated = CHUNK_BYTES; // Total frames stay at or below 16 KB.
        for (let position = outgoing.acked; position < blob.size;) {
            check();
            while (channel.bufferedAmount > WINDOW_BYTES || outgoing.sent - outgoing.acked >= WINDOW_BYTES) {
                check();
                if (Date.now() - outgoing.lastAck > 45000)
                    throw new Error('The other device stopped responding. Keep both tabs open and retry.');
                await sleep(12);
            }
            const data = new Uint8Array(await blob.slice(position, Math.min(blob.size, position + negotiated)).arrayBuffer());
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
        this.send({ type: 'finish', id: item.id, digest: outgoing.digest });
        this.notify(true);
        const deadline = Date.now() + 60000;
        while (!FINISHED.has(item.state)) {
            check();
            if (Date.now() > deadline)
                throw new Error('The receiver has not confirmed delivery. Retry to verify it.');
            await sleep(50);
        }
    }
    async destroy() {
        this.destroyed = true;
        this.epoch++;
        if (this.timer)
            clearTimeout(this.timer);
        if (this.channel)
            this.channel.onmessage = null;
        this.channel = null;
        for (const item of this.items) {
            item.accepted = false;
            if (item.url)
                URL.revokeObjectURL(item.url);
        }
        for (const incoming of this.incoming.values())
            await incoming.store?.dispose();
        this.items.length = 0;
        this.incoming.clear();
        this.outgoing.clear();
        await this.storage.dispose();
    }
}
