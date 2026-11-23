// Almacenamiento local (IndexedDB). Todo se guarda en el móvil; la nube es opcional.
const DB_NAME = 'familia';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const meta = {
  get: k => tx('meta', 'readonly', s => reqP(s.get(k))),
  set: (k, v) => tx('meta', 'readwrite', s => { s.put(v, k); }),
};

export async function allItems() {
  return tx('items', 'readonly', s => reqP(s.getAll()));
}

export async function getItem(id) {
  return tx('items', 'readonly', s => reqP(s.get(id)));
}

export async function putItems(list) {
  return tx('items', 'readwrite', s => { list.forEach(i => s.put(i)); });
}

export async function clearAll() {
  await tx('items', 'readwrite', s => { s.clear(); });
  await tx('meta', 'readwrite', s => { s.clear(); });
}

export function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}
