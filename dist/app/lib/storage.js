const MEMORY_BUDGET = 128 * 1024 * 1024;
export class TemporaryStorage {
    mode = 'memory';
    directory = null;
    root = null;
    directoryName = `shelf-tmp-${Date.now()}-${crypto.randomUUID()}`;
    reserved = 0;
    async initialize() {
        try {
            if (!navigator.storage?.getDirectory)
                return;
            this.root = await navigator.storage.getDirectory();
            // A crashed or forcibly closed tab cannot clean up. Remove abandoned directories
            // older than 24 hours on the next visit; never delete another active tab's directory.
            for await (const [name] of this.root.entries()) {
                const match = /^shelf-tmp-(\d+)-/.exec(name);
                if (match && Date.now() - Number(match[1]) > 86400000)
                    await this.root.removeEntry(name, { recursive: true }).catch(() => undefined);
            }
            this.directory = await this.root.getDirectoryHandle(this.directoryName, { create: true });
            const probe = await this.directory.getFileHandle('probe', { create: true });
            const writer = await probe.createWritable();
            await writer.close();
            await this.directory.removeEntry('probe');
            this.mode = 'disk';
        }
        catch {
            this.directory = null;
            this.mode = 'memory';
        }
    }
    get maxFileBytes() { return this.mode === 'disk' ? 2 * 1024 ** 3 : MEMORY_BUDGET; }
    async create(id, size) {
        if (this.mode === 'disk' && this.directory) {
            const estimate = await navigator.storage.estimate().catch(() => ({}));
            // Leave headroom for filesystem overhead and concurrent browser storage.
            if (estimate.quota && size + this.reserved + (estimate.usage || 0) > estimate.quota * 0.9)
                throw new Error('Not enough browser storage. Remove a few shelf items and try again.');
            const directory = this.directory;
            const handle = await directory.getFileHandle(id, { create: true });
            const writer = await handle.createWritable();
            let closed = false;
            let disposed = false;
            this.reserved += size;
            return {
                write: async (bytes) => { if (closed || disposed)
                    throw new Error('This transfer is no longer open.'); await writer.write(bytes); },
                finish: async (mime) => {
                    if (disposed)
                        throw new Error('This transfer was cancelled.');
                    if (!closed) {
                        await writer.close();
                        closed = true;
                    }
                    const file = await handle.getFile();
                    return file.slice(0, file.size, mime);
                },
                dispose: async () => {
                    if (disposed)
                        return;
                    disposed = true;
                    this.reserved -= size;
                    if (!closed) {
                        await writer.abort().catch(() => undefined);
                        closed = true;
                    }
                    await directory.removeEntry(id).catch(() => undefined);
                },
            };
        }
        if (this.reserved + size > MEMORY_BUDGET)
            throw new Error('This browser has a 128 MB temporary-memory limit. Remove completed items or send a smaller file.');
        this.reserved += size;
        let chunks = [];
        let disposed = false;
        return {
            write: async (bytes) => { if (disposed)
                throw new Error('This transfer was cancelled.'); chunks.push(bytes.slice().buffer); },
            finish: async (mime) => { if (disposed)
                throw new Error('This transfer was cancelled.'); const blob = new Blob(chunks, { type: mime }); chunks = []; return blob; },
            dispose: async () => { if (!disposed) {
                disposed = true;
                chunks = [];
                this.reserved -= size;
            } },
        };
    }
    async dispose() { await this.root?.removeEntry(this.directoryName, { recursive: true }).catch(() => undefined); }
}
