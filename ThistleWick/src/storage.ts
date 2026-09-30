/** Where saves live. A save is one JSON text with a timestamp, written to every backend that works and read back from
    the newest one. localStorage is written synchronously so a save started while the page is closing still lands;
    IndexedDB has no size cap worth worrying about, so a big world that no longer fits in localStorage keeps saving.
    Backends are injected so the logic is testable without a browser. */

export interface Stamped { savedAt: number; text: string }
export interface Backend {
  name: string;
  read(): Promise<Stamped | null>;
  /** Must start its write synchronously: pagehide gives an async function no time to get going. */
  write(s: Stamped): Promise<void>;
  remove(): Promise<void>;
}
export interface SaveStore {
  load(): Promise<string | null>;
  /** Resolves true when at least one backend kept the save. */
  save(text: string): Promise<boolean>;
  clear(): Promise<void>;
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))]);

export function createStore(backends: Backend[], opts: { now?: () => number; timeoutMs?: number } = {}): SaveStore {
  const now = opts.now ?? Date.now, timeoutMs = opts.timeoutMs ?? 20000;
  return {
    async load() {
      const found = await Promise.all(backends.map(b => withTimeout(b.read().catch(() => null), timeoutMs, null)));
      let best: Stamped | null = null;
      for (const s of found) if (s && (!best || s.savedAt > best.savedAt)) best = s;
      return best ? best.text : null;
    },
    async save(text) {
      const stamped: Stamped = { savedAt: now(), text };
      const results = backends.map(b => { try { return b.write(stamped).then(() => true, () => false); } catch { return Promise.resolve(false); } });
      return (await Promise.all(results)).some(Boolean);
    },
    async clear() { await Promise.all(backends.map(b => b.remove().catch(() => undefined))); }
  };
}

/** localStorage: the payload under `key` (so saves from before this layer still load) and its timestamp under `key:t`. */
export function localBackend(key: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Backend {
  return {
    name: 'localStorage',
    async read() {
      const text = storage.getItem(key);
      return text === null ? null : { text, savedAt: Number(storage.getItem(key + ':t')) || 0 };
    },
    async write(s) {
      try { storage.setItem(key, s.text); storage.setItem(key + ':t', String(s.savedAt)); }
      catch (e) {
        /* out of room: a stale copy left behind would win over nothing on the next start, so remove it and let the other backends carry the save */
        try { storage.removeItem(key); storage.removeItem(key + ':t'); } catch { /* nothing more to do */ }
        throw e;
      }
    },
    async remove() { storage.removeItem(key); storage.removeItem(key + ':t'); }
  };
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** IndexedDB: one record holding the same stamped text. */
export function idbBackend(factory: IDBFactory, dbName: string, key: string): Backend {
  const STORE = 'saves';
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => opened ??= new Promise<IDBDatabase>((res, rej) => {
    const r = factory.open(dbName, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
  return {
    name: 'indexedDB',
    async read() {
      const db = await open();
      const v = await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
      return v && typeof v.text === 'string' && typeof v.savedAt === 'number' ? { text: v.text, savedAt: v.savedAt } : null;
    },
    write(s) {
      /* the connection is opened at boot, so by save time this resolves without waiting on a callback the closing page may never run */
      return open().then(db => new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ text: s.text, savedAt: s.savedAt }, key);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      }));
    },
    async remove() {
      const db = await open();
      await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
    }
  };
}
