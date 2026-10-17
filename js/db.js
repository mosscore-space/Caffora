// IndexedDB wrapper. Stores: beans, brews, grinders (by id) and kv (key/value).
const DB_NAME = 'caffora';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['beans', 'brews', 'grinders']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let out;
    Promise.resolve(fn(os)).then(v => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  all: (store) => tx(store, 'readonly', os => wrap(os.getAll())),
  put: (store, obj) => tx(store, 'readwrite', os => { os.put(obj); }),
  putMany: (store, objs) => tx(store, 'readwrite', os => { objs.forEach(o => os.put(o)); }),
  del: (store, id) => tx(store, 'readwrite', os => { os.delete(id); }),
  delMany: (store, ids) => tx(store, 'readwrite', os => { ids.forEach(i => os.delete(i)); }),
  kvGet: (key) => tx('kv', 'readonly', os => wrap(os.get(key))),
  kvSet: (key, val) => tx('kv', 'readwrite', os => { os.put(val, key); }),
};

/** Close our connection (needed before the database can be deleted). */
export async function closeDb() { if (dbp) { try { (await dbp).close(); } catch { /* ignore */ } dbp = null; } }

/** Ask the browser not to evict our data. */
export async function persistStorage() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}
