/**
 * Assembly document + part script bytes.
 *
 * The document store holds serializeAssembly() output only (ids, names,
 * visibility, order, optional position). Script text lives in the parts
 * store, keyed by the row id: a repo path in git mode, an IndexedDB key
 * in local mode. A separate database from the editor draft so the two
 * schemas do not fight.
 */
import { serializeAssembly } from './assembly.js';
import { LOCAL_ROW_PREFIX, remapLocalColorKeys, stripLocalRowPrefix } from './git/localPartIdMigration.js';
import { emptyWorkingSidecar, normalizeWorkingSidecar } from './git/workingSidecar.js';
import { idbWithTimeout, IDB_OP_TIMEOUT_MS } from './idbWithTimeout.js';
import { forgetPartThumbnails } from './partThumbnailStore.js';

const DB_NAME = 'surfcad-assembly';
const DB_VERSION = 1;
const DOC_STORE = 'assembly';
const PART_STORE = 'parts';
const DOC_KEY = 'current';
const SIDECAR_KEY = 'sidecar';

let dbPromise = null;

function idbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDB() {
  if (!idbAvailable()) return Promise.resolve({ db: null, reason: 'error' });
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      console.warn('[Assembly] indexedDB.open threw:', err);
      resolve({ db: null, reason: 'error' });
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
      if (!db.objectStoreNames.contains(PART_STORE)) db.createObjectStore(PART_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try { db.close(); } catch { /* already closing */ }
        dbPromise = null;
      };
      resolve({ db, reason: '' });
    };
    req.onerror = () => {
      console.warn('[Assembly] indexedDB.open failed:', req.error);
      resolve({ db: null, reason: 'error' });
    };
    req.onblocked = () => resolve({ db: null, reason: 'error' });
  });
  return idbWithTimeout(dbPromise, IDB_OP_TIMEOUT_MS, 'Assembly open').catch((err) => {
    console.warn('[Assembly] indexedDB.open timed out:', err?.message || err);
    dbPromise = null;
    const timed = /timed out/.test(String(err?.message || ''));
    return { db: null, reason: timed ? 'timeout' : 'error' };
  });
}

function runTx(storeName, mode, work) {
  const op = openDB().then(({ db, reason }) => {
    if (!db) return { ok: false, value: null, reason: reason || 'error' };
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(storeName, mode);
      } catch (err) {
        console.warn('[Assembly] transaction failed:', err);
        resolve({ ok: false, value: null, reason: 'error' });
        return;
      }
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      let out;
      const req = work(tx.objectStore(storeName));
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => finish({ ok: true, value: out });
      tx.onabort = () => finish({ ok: false, value: null, reason: 'error' });
      tx.onerror = () => finish({ ok: false, value: null, reason: 'error' });
    });
  }).catch((err) => {
    console.warn('[Assembly] store unavailable:', err);
    return { ok: false, value: null, reason: 'error' };
  });
  return idbWithTimeout(op, IDB_OP_TIMEOUT_MS, 'Assembly tx').catch((err) => {
    console.warn('[Assembly] tx timed out:', err?.message || err);
    const timed = /timed out/.test(String(err?.message || ''));
    return { ok: false, value: null, reason: timed ? 'timeout' : 'error' };
  });
}

async function documentFromStored(value) {
  try {
    // serializeAssembly drops a color key that is not a surf id. Strip a
    // legacy `local:` prefix first so `local:<surfId>` still round-trips.
    // Part ids stay; hydrate rewrites those after scripts are loaded by
    // the key that is stored today.
    const rawDoc = value && typeof value === 'object' ? { ...value } : value;
    let colorsChanged = false;
    if (rawDoc?.colors) {
      const colors = remapLocalColorKeys(rawDoc.colors);
      if (colors !== rawDoc.colors) {
        rawDoc.colors = colors;
        colorsChanged = true;
      }
    }
    const clean = serializeAssembly(rawDoc);
    const rawName = typeof value.name === 'string' ? value.name.trim() : '';
    // Older documents omitted a blank name. Write Assembly back so the next
    // load already has it. A rewritten color key is persisted the same way.
    if ((!rawName && clean.name) || colorsChanged) await saveAssemblyDocument(clean);
    return clean;
  } catch {
    return null;
  }
}

/**
 * `hit` is a stored document. `miss` is an empty store. `timeout` is a slow
 * read — the previous document may still be there, so callers must not
 * write a replacement.
 */
export async function loadAssemblyDocumentStatus() {
  const { ok, value, reason } = await runTx(DOC_STORE, 'readonly', (store) => store.get(DOC_KEY));
  if (reason === 'timeout') return { status: 'timeout', doc: null };
  if (!ok) return { status: 'error', doc: null };
  if (!value) return { status: 'miss', doc: null };
  const doc = await documentFromStored(value);
  return doc ? { status: 'hit', doc } : { status: 'error', doc: null };
}

export async function loadAssemblyDocument() {
  const loaded = await loadAssemblyDocumentStatus();
  return loaded.status === 'hit' ? loaded.doc : null;
}

export async function saveAssemblyDocument(doc) {
  const clean = serializeAssembly(doc);
  const { ok } = await runTx(DOC_STORE, 'readwrite', (store) => store.put(clean, DOC_KEY));
  return ok ? clean : null;
}

/**
 * Working-copy sidecar (pending repo deletes, pre-rename vault name).
 * Same database as the document, a different key — `serializeAssembly`
 * never sees these fields and they never land in `.surf.json`.
 */
export async function loadAssemblySidecar() {
  const { ok, value, reason } = await runTx(DOC_STORE, 'readonly', (store) => store.get(SIDECAR_KEY));
  if (reason === 'timeout' || !ok || !value) return emptyWorkingSidecar();
  return normalizeWorkingSidecar(value);
}

export async function saveAssemblySidecar(sidecar) {
  const clean = normalizeWorkingSidecar(sidecar);
  const { ok } = await runTx(DOC_STORE, 'readwrite', (store) => store.put(clean, SIDECAR_KEY));
  return ok ? clean : null;
}

export async function loadPartRecord(id) {
  if (!id) return null;
  const { ok, value } = await runTx(PART_STORE, 'readonly', (store) => store.get(String(id)));
  if (!ok || !value || typeof value.script !== 'string') return null;
  return value;
}

export async function loadPartScript(id) {
  const record = await loadPartRecord(id);
  if (record) return record.script;
  // A reload strips `local:` and rekeys the script. A file opened afterward
  // may still name the old id, or the other way around. Either key is the
  // same part. Repo paths are never aliased.
  const text = String(id || '');
  if (!text || text.includes('/')) return null;
  const alt = text.startsWith(LOCAL_ROW_PREFIX) ? stripLocalRowPrefix(text) : `${LOCAL_ROW_PREFIX}${text}`;
  if (!alt || alt === text) return null;
  const other = await loadPartRecord(alt);
  return other ? other.script : null;
}

/**
 * `isSynced` is local to this record. Omit it to keep the stored flag.
 * Pass a boolean to set it. Never written to `.surf.json`.
 *
 * `assets` is `{ '<Part>.mesh': gitBlobSha }`. Omit it to keep the stored
 * map. `meshSynced` stays false until a git Save commits that blob.
 */
export async function savePartScript(id, script, opts = {}) {
  if (!id || typeof script !== 'string') return false;
  const existing = await loadPartRecord(id);
  let isSynced = opts.isSynced;
  if (typeof isSynced !== 'boolean' && typeof existing?.isSynced === 'boolean') {
    isSynced = existing.isSynced;
  }
  let assets = opts.assets;
  if (assets === undefined && existing?.assets && typeof existing.assets === 'object') {
    assets = existing.assets;
  }
  let meshSynced = opts.meshSynced;
  if (typeof meshSynced !== 'boolean' && typeof existing?.meshSynced === 'boolean') {
    meshSynced = existing.meshSynced;
  }
  const record = { id: String(id), script, savedAt: Date.now() };
  if (typeof isSynced === 'boolean') record.isSynced = isSynced;
  if (assets && typeof assets === 'object' && !Array.isArray(assets) && Object.keys(assets).length) {
    record.assets = assets;
  }
  if (typeof meshSynced === 'boolean') record.meshSynced = meshSynced;
  const { ok } = await runTx(PART_STORE, 'readwrite', (store) => store.put(record, record.id));
  return ok;
}

/** Row id → `{ assets, meshSynced }` for records that store a mesh map. */
export async function loadPartAssets(ids) {
  const out = {};
  for (const id of ids || []) {
    const record = await loadPartRecord(id);
    if (!record?.assets || typeof record.assets !== 'object' || Array.isArray(record.assets)) continue;
    out[String(id)] = {
      assets: record.assets,
      meshSynced: record.meshSynced === true,
    };
  }
  return out;
}

/** Row id → isSynced for records that store the flag. */
export async function loadPartSyncFlags(ids) {
  const out = {};
  for (const id of ids || []) {
    const record = await loadPartRecord(id);
    if (typeof record?.isSynced === 'boolean') out[String(id)] = record.isSynced;
  }
  return out;
}

export async function deletePartScript(id) {
  if (!id) return false;
  try {
    await forgetPartThumbnails(id);
  } catch (err) {
    console.warn('[Assembly] thumbnail cleanup failed:', err?.message || err);
  }
  const { ok } = await runTx(PART_STORE, 'readwrite', (store) => store.delete(String(id)));
  return ok;
}

export async function loadPartScripts(ids, { onProgress } = {}) {
  const list = ids || [];
  const total = list.length;
  const out = {};
  for (let i = 0; i < list.length; i += 1) {
    const id = list[i];
    onProgress?.({ index: i + 1, total });
    const script = await loadPartScript(id);
    if (typeof script === 'string') out[id] = script;
  }
  return out;
}

/** Wipe assembly document + all part scripts (Clear local cache). */
export async function clearAssemblyStore() {
  const doc = await runTx(DOC_STORE, 'readwrite', (store) => store.clear());
  const parts = await runTx(PART_STORE, 'readwrite', (store) => store.clear());
  return !!(doc.ok && parts.ok);
}
