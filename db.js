// 极简 IndexedDB 封装
const DB_NAME = 'shufang', DB_VER = 3;
let dbp;
function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('xlate')) db.createObjectStore('xlate', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('links')) db.createObjectStore('links', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('事务中止'));
  }));
}
export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, val) => tx(store, 'readwrite', s => s.put(val)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  // 在同一个事务里读-改-写，避免并发更新互相覆盖
  update(store, key, patch) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store);
      let next;
      const r = s.get(key);
      r.onsuccess = () => {
        const cur = r.result; if (!cur) return;
        next = typeof patch === 'function' ? patch(cur) : Object.assign(cur, patch);
        if (next) s.put(next);
      };
      t.oncomplete = () => res(next);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('事务中止'));
    }));
  },
  // 跨表事务。fn 里发起的请求要在事务结束前完成。
  run(stores, fn) {
    return open().then(database => new Promise((res, rej) => {
      const t = database.transaction(stores, 'readwrite');
      try { fn(t); }
      catch (err) { try { t.abort(); } catch {} rej(err); return; }
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('事务中止'));
    }));
  }
};
