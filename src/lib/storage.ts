import type { ShelfItem } from './types.js';

/**
 * Browser-local persistence for Shelf.
 *
 * Metadata lives in IndexedDB. File bytes prefer OPFS so large blobs do not
 * need to be materialized in JavaScript memory. IndexedDB Blob storage is the
 * compatibility fallback when OPFS is unavailable.
 */
export interface ReceiveStore {
  readonly offset: number;
  write(bytes: Uint8Array): Promise<void>;
  finish(mime: string): Promise<Blob>;
  pause?(): Promise<void>;
  dispose(): Promise<void>;
}
const MEMORY_BUDGET = 128 * 1024 * 1024;
const DB_NAME = 'shelf-local-v2';
const DB_VERSION = 1;
const FILE_DIR = 'shelf-files-v2';

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error || new Error('Browser storage request failed.'));
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve,reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Browser storage transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('Browser storage transaction was cancelled.'));
  });
}
async function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in globalThis)) return null;
  try {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath:'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath:'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath:'key' });
    };
    return await request(open);
  } catch {
    return null;
  }
}

export class TemporaryStorage {
  mode: 'disk' | 'memory' = 'memory';
  private directory: FileSystemDirectoryHandle | null = null;
  private db: IDBDatabase | null = null;
  private reserved = 0;

  async initialize(): Promise<void> {
    this.db = await openDatabase();
    try {
      if (!navigator.storage?.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      this.directory = await root.getDirectoryHandle(FILE_DIR, { create:true });
      const probe = await this.directory.getFileHandle('.probe', { create:true });
      const writer = await probe.createWritable();
      await writer.close();
      await this.directory.removeEntry('.probe').catch(() => undefined);
      this.mode = 'disk';
    } catch {
      this.directory = null;
      this.mode = 'memory';
    }
  }

  get maxFileBytes(): number { return this.mode === 'disk' ? 2 * 1024 ** 3 : MEMORY_BUDGET; }
  get persistent(): boolean { return !!this.db; }

  private async put(store: string, value: unknown): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await transactionDone(tx);
  }
  private async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    if (!this.db) return undefined;
    const tx = this.db.transaction(store, 'readonly');
    const value = await request(tx.objectStore(store).get(key)) as T | undefined;
    await transactionDone(tx);
    return value;
  }
  private async remove(store: string, key: IDBValidKey): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
  }

  async saveItem(item: ShelfItem): Promise<void> {
    if (!this.db) return;
    const { file: _file, url: _url, ...record } = item;
    await this.put('items', { ...record, speed:0, accepted:false });
  }
  async loadItems(): Promise<ShelfItem[]> {
    if (!this.db) return [];
    const tx = this.db.transaction('items', 'readonly');
    const records = await request(tx.objectStore('items').getAll()) as ShelfItem[];
    await transactionDone(tx);
    return records.map(item => ({ ...item, file:undefined, url:undefined, speed:0, accepted:false }))
      .sort((a,b) => b.createdAt - a.createdAt);
  }
  async removeItem(id: string): Promise<void> {
    await this.remove('items', id);
    await this.removeBlob(id);
  }

  async setMeta<T>(key: string, value: T): Promise<void> { await this.put('meta', { key, value }); }
  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await this.get<{key:string;value:T}>('meta', key);
    return row?.value;
  }
  async removeMeta(key: string): Promise<void> { await this.remove('meta', key); }

  async saveBlob(id: string, blob: Blob): Promise<void> {
    if (this.directory) {
      const handle = await this.directory.getFileHandle(id, { create:true });
      const writer = await handle.createWritable();
      try {
        const reader = blob.stream().getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const copy = new Uint8Array(value.byteLength);
          copy.set(value);
          await writer.write(copy.buffer);
        }
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => undefined);
        throw error;
      }
      await this.remove('blobs', id).catch(() => undefined);
      return;
    }
    if (!this.db) throw new Error('Persistent browser storage is unavailable.');
    await this.put('blobs', { id, blob });
  }

  async loadBlob(id: string): Promise<Blob | null> {
    if (this.directory) {
      try {
        const handle = await this.directory.getFileHandle(id);
        return await handle.getFile();
      } catch { /* Fall through to the IndexedDB compatibility copy. */ }
    }
    const row = await this.get<{id:string;blob:Blob}>('blobs', id);
    return row?.blob || null;
  }

  async removeBlob(id: string): Promise<void> {
    await this.directory?.removeEntry(id).catch(() => undefined);
    await this.remove('blobs', id).catch(() => undefined);
  }

  async create(id: string, size: number, requestedOffset = 0): Promise<ReceiveStore> {
    if (this.mode === 'disk' && this.directory) {
      const estimate = await navigator.storage.estimate().catch(() => ({} as StorageEstimate));
      const handle = await this.directory.getFileHandle(id, { create:true });
      const existing = await handle.getFile();
      const offset = Math.min(Math.max(0, requestedOffset), existing.size, size);
      if (estimate.quota && (size - offset) + this.reserved + (estimate.usage || 0) > estimate.quota * 0.9) {
        throw new Error('Not enough browser storage. Remove a few shelf items and try again.');
      }
      const writer = await handle.createWritable({ keepExistingData: offset > 0 });
      if (offset > 0) {
        await writer.truncate(offset);
        await writer.seek(offset);
      } else {
        await writer.truncate(0);
      }
      let closed = false, disposed = false;
      const reservation = Math.max(0, size - offset);
      this.reserved += reservation;
      const release = () => {
        if (!closed) this.reserved = Math.max(0, this.reserved - reservation);
      };
      const close = async () => {
        if (closed) return;
        release();
        await writer.close();
        closed = true;
      };
      return {
        offset,
        write: async bytes => {
          if (closed || disposed) throw new Error('This transfer is no longer open.');
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          await writer.write(copy.buffer);
        },
        finish: async mime => {
          if (disposed) throw new Error('This transfer was cancelled.');
          await close();
          const file = await handle.getFile();
          return file.slice(0, file.size, mime);
        },
        pause: close,
        dispose: async () => {
          if (disposed) return;
          disposed = true;
          if (!closed) {
            release();
            await writer.abort().catch(() => undefined);
            closed = true;
          }
          await this.directory?.removeEntry(id).catch(() => undefined);
        },
      };
    }

    if (this.reserved + size > MEMORY_BUDGET) {
      throw new Error('This browser has a 128 MB temporary-memory limit. Remove completed items or send a smaller file.');
    }
    this.reserved += size;
    let parts: ArrayBuffer[] = [], disposed = false, closed = false;
    const release = () => {
      if (!closed) {
        this.reserved = Math.max(0, this.reserved - size);
        closed = true;
      }
    };
    return {
      offset:0,
      write: async bytes => {
        if (disposed || closed) throw new Error('This transfer is no longer open.');
        parts.push(bytes.slice().buffer as ArrayBuffer);
      },
      finish: async mime => {
        if (disposed) throw new Error('This transfer was cancelled.');
        release();
        const blob = new Blob(parts, { type:mime });
        parts = [];
        return blob;
      },
      pause: async () => { release(); },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        release();
        parts = [];
      },
    };
  }

  async estimate(): Promise<StorageEstimate> {
    return navigator.storage?.estimate ? navigator.storage.estimate() : {};
  }
  async requestPersistence(): Promise<boolean> {
    try { return !!(navigator.storage?.persist && await navigator.storage.persist()); }
    catch { return false; }
  }
  async dispose(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
