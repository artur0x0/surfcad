/**
 * IndexedDB cache of part-row thumbnails.
 *
 * Database `surfcad-part-thumbs`, store `thumbs`. The key is the part id
 * plus the script hash (`partThumbnailKey`). A newer script for the same
 * part drops the older bitmaps. Deleting a part drops every bitmap for
 * that id. Memory mirrors the database so a write in this turn is visible
 * before IndexedDB commits, and so a session without IndexedDB still paints.
 */
import { idbWithTimeout, IDB_OP_TIMEOUT_MS } from './idbWithTimeout.js';
import { partThumbnailHash, partThumbnailKey } from './partThumbnailPlan.js';

const DB_NAME = 'surfcad-part-thumbs';
const DB_VERSION = 1;
const STORE = 'thumbs';

const memory = new Map();
const listeners = new Set();
let dbPromise = null;

function idbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (err) {
      console.warn('[partThumb] listener failed:', err?.message || err);
    }
  }
}

export function subscribePartThumbs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function openDB() {
  if (!idbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      console.warn('[partThumb] indexedDB.open threw:', err);
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('byPart', 'partId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try { db.close(); } catch { /* already closing */ }
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      console.warn('[partThumb] indexedDB.open failed:', req.error);
      resolve(null);
    };
    req.onblocked = () => resolve(null);
  });
  return idbWithTimeout(dbPromise, IDB_OP_TIMEOUT_MS, 'Part thumb open').catch((err) => {
    console.warn('[partThumb] indexedDB.open timed out:', err?.message || err);
    dbPromise = null;
    return null;
  });
}

function txDone(db, mode, work) {
  const op = new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch (err) {
      console.warn('[partThumb] transaction failed:', err);
      resolve({ ok: false, value: null });
      return;
    }
    let value = null;
    const req = work(tx.objectStore(STORE));
    if (req) {
      const prior = req.onsuccess;
      req.onsuccess = (event) => {
        value = req.result;
        if (typeof prior === 'function') prior.call(req, event);
      };
    }
    tx.oncomplete = () => resolve({ ok: true, value });
    tx.onabort = () => resolve({ ok: false, value: null });
    tx.onerror = () => resolve({ ok: false, value: null });
  });
  return idbWithTimeout(op, IDB_OP_TIMEOUT_MS, 'Part thumb tx').catch((err) => {
    console.warn('[partThumb] transaction timed out:', err?.message || err);
    return { ok: false, value: null };
  });
}

function isPngUrl(url) {
  return typeof url === 'string' && url.startsWith('data:image/');
}

function remember(record) {
  memory.set(record.key, record);
  for (const [key, row] of memory) {
    if (row.partId === record.partId && key !== record.key) memory.delete(key);
  }
}

function rememberDrop(partId) {
  const id = String(partId);
  for (const [key, row] of memory) {
    if (row.partId === id) memory.delete(key);
  }
}

/** Data URL for this part and script, or null. */
export async function getPartThumbnail(partId, script) {
  const key = partThumbnailKey(partId, script);
  if (!key) return null;
  const hit = memory.get(key);
  if (hit?.png) return hit.png;
  const db = await openDB();
  if (!db) return null;
  const got = await txDone(db, 'readonly', (store) => store.get(key));
  const row = got?.ok ? got.value : null;
  if (!isPngUrl(row?.png) || row.key !== key) return null;
  memory.set(key, row);
  return row.png;
}

/**
 * Store the bitmap for this script and drop other hashes of the same part.
 * Returns false when the URL is not an image data URL.
 */
export async function putPartThumbnail(partId, script, dataUrl) {
  const key = partThumbnailKey(partId, script);
  const hash = partThumbnailHash(script);
  if (!key || !isPngUrl(dataUrl)) return false;
  const id = String(partId);
  const record = { key, partId: id, hash, png: dataUrl, savedAt: Date.now() };
  remember(record);
  emit({ partId: id, hash, url: dataUrl, forgotten: false });
  const db = await openDB();
  if (db) {
    await txDone(db, 'readwrite', (store) => {
      const req = store.index('byPart').getAll(id);
      req.onsuccess = () => {
        for (const row of req.result || []) {
          if (row?.key && row.key !== key) store.delete(row.key);
        }
        store.put(record);
      };
      return req;
    });
  }
  return true;
}

/** Drop every stored bitmap for this part id. */
export async function forgetPartThumbnails(partId) {
  if (partId == null) return false;
  const id = String(partId);
  rememberDrop(id);
  emit({ partId: id, forgotten: true });
  const db = await openDB();
  if (!db) return true;
  await txDone(db, 'readwrite', (store) => {
    const req = store.index('byPart').getAll(id);
    req.onsuccess = () => {
      for (const row of req.result || []) {
        if (row?.key) store.delete(row.key);
      }
    };
    return req;
  });
  return true;
}

/** Wipe the thumbnail database (Clear local cache). */
export async function clearPartThumbnails() {
  memory.clear();
  const db = await openDB();
  if (!db) return false;
  const got = await txDone(db, 'readwrite', (store) => store.clear());
  return !!got?.ok;
}
