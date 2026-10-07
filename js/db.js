// Phone storage (IndexedDB). Everything the game keeps lives here.
//   kv     - small named values: settings, request counter
//   worlds - one save slot per world (added in stage 1)
//   images - generated or attached pictures (stage 7)

const DB_NAME = 'living-world';
const DB_VERSION = 1;
const STORES = ['kv', 'worlds', 'images'];

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  put: (store, key, value) => run(store, 'readwrite', (s) => { s.put(value, key); }),
  delete: (store, key) => run(store, 'readwrite', (s) => { s.delete(key); }),
  keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
};

/** Ask the browser not to clear our data when the phone is low on space. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* not supported */ }
  return false;
}
