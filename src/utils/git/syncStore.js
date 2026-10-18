/**
 * Durable git outbox + per-part cache.
 *
 * UI reads and writes the local cache. Every git action is appended here
 * (FIFO per repo and branch) before anything is pushed. IndexedDB is the durable copy;
 * memory is the live copy so a flush in the same turn sees the op.
 * When IndexedDB is missing (goldens, private mode) memory still works.
 */
import { idbWithTimeout, IDB_OP_TIMEOUT_MS } from '../idbWithTimeout.js';
import { isBinaryContent, normalizeOutboxFiles, toUint8Array } from './binaryContent.js';
import { canonicalSurfId, migrateOutboxOp, rewriteVaultFile } from './surfIdMigration.js';

const DB_NAME = 'surfcad-sync';
const DB_VERSION = 1;
const OUTBOX = 'outbox';
const KV = 'kv';

let dbPromise = null;

function idbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDB() {
  if (!idbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      console.warn('[GitSync] indexedDB.open threw:', err);
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
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
      console.warn('[GitSync] indexedDB.open failed:', req.error);
      resolve(null);
    };
    req.onblocked = () => resolve(null);
  });
  return idbWithTimeout(dbPromise, IDB_OP_TIMEOUT_MS, 'GitSync open').catch((err) => {
    console.warn('[GitSync] indexedDB.open timed out:', err?.message || err);
    dbPromise = null;
    return null;
  });
}

function txDone(db, storeName, mode, work) {
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (err) {
      console.warn('[GitSync] transaction failed:', err);
      resolve(null);
      return;
    }
    let out = null;
    const req = work(tx.objectStore(storeName));
    if (req) req.onsuccess = () => { out = req.result; };
    tx.oncomplete = () => resolve(out);
    tx.onabort = () => resolve(null);
    tx.onerror = () => resolve(null);
  });
}

function copyTreeContent(content) {
  if (isBinaryContent(content)) return toUint8Array(content);
  return content ?? '';
}

export function repoKeyOf(repo) {
  if (!repo) return '';
  if (typeof repo === 'string') return repo;
  return `${repo.owner}/${repo.name}`;
}

/** Outbox, part-row state, and lastSyncedSha are scoped per repo and branch. */
export function branchKeyOf(repo, branch = 'main') {
  return `${repoKeyOf(repo)}\0${branch || 'main'}`;
}

export function createSyncStore({ persist = true } = {}) {
  let seq = 1;
  const ops = [];
  const partState = new Map();
  const parts = new Map();
  const aliases = new Map();
  const assemblies = new Map();
  const pathIndex = new Map();
  const trees = new Map();
  const repoSha = new Map();
  const pendingDeletes = new Map();
  const listeners = new Set();
  let persistOn = !!persist && idbAvailable();

  const ready = (async () => {
    if (!persistOn) return;
    const db = await openDB();
    if (!db) {
      persistOn = false;
      return;
    }
    const savedOps = await txDone(db, OUTBOX, 'readonly', (store) => store.getAll());
    const savedKv = await txDone(db, KV, 'readonly', (store) => store.getAll());
    const keys = await txDone(db, KV, 'readonly', (store) => store.getAllKeys());
    for (const op of savedOps || []) {
      if (op.status === 'sending') op.status = 'queued';
      ops.push(op);
      seq = Math.max(seq, Number(op.id) + 1 || seq);
    }
    ops.sort((a, b) => a.seq - b.seq || a.id - b.id);
    (keys || []).forEach((key, i) => {
      const value = savedKv?.[i];
      if (typeof key !== 'string') return;
      if (key.startsWith('sha:')) repoSha.set(key.slice(4), value);
      else if (key.startsWith('state:')) partState.set(key.slice(6), value);
      else if (key.startsWith('part:')) parts.set(key.slice(5), value);
      else if (key.startsWith('alias:')) aliases.set(key.slice(6), value);
      else if (key.startsWith('asm:')) assemblies.set(key.slice(4), value);
      else if (key.startsWith('path:')) pathIndex.set(key.slice(5), value);
      else if (key.startsWith('tree:')) trees.set(key.slice(5), value);
      else if (key.startsWith('del:')) pendingDeletes.set(key.slice(4), Array.isArray(value) ? value : []);
    });
  })();

  function emit() {
    for (const fn of listeners) {
      try { fn(partStates()); } catch { /* listener */ }
    }
  }

  async function persistOp(op) {
    if (!persistOn) return;
    const db = await openDB();
    if (!db) return;
    await txDone(db, OUTBOX, 'readwrite', (store) => store.put(op));
  }

  async function persistKv(key, value) {
    if (!persistOn) return;
    const db = await openDB();
    if (!db) return;
    await txDone(db, KV, 'readwrite', (store) => (
      value == null ? store.delete(key) : store.put(value, key)
    ));
  }

  function partStates() {
    return Object.fromEntries(partState.entries());
  }

  async function enqueue(repo, op, { front = false } = {}) {
    await ready;
    const key = repoKeyOf(repo);
    const branch = op.branch || 'main';
    const rowSeq = front && ops.length
      ? Math.min(...ops.map((item) => item.seq)) - 1
      : seq;
    const row = {
      id: seq,
      seq: rowSeq,
      repoKey: key,
      branch,
      op: op.op,
      status: 'queued',
      message: op.message || '',
      files: await normalizeOutboxFiles(op.files || null),
      partIds: op.partIds || [],
      payload: op.payload || {},
      error: '',
      createdAt: Date.now(),
    };
    seq += 1;
    if (front) ops.unshift(row);
    else ops.push(row);
    for (const id of row.partIds) partState.set(`${key}\0${branch}\0${id}`, 'queued');
    await persistOp(row);
    for (const id of row.partIds) {
      await persistKv(`state:${key}\0${branch}\0${id}`, 'queued');
    }
    emit();
    return row;
  }

  function matchesBranch(op, branch) {
    if (branch == null) return true;
    return (op.branch || 'main') === branch;
  }

  function pending(repo, branch) {
    const key = repoKeyOf(repo);
    return ops
      .filter((op) => op.repoKey === key && matchesBranch(op, branch)
        && (op.status === 'queued' || op.status === 'sending'))
      .sort((a, b) => a.seq - b.seq || a.id - b.id);
  }

  function failed(repo, branch) {
    const key = repoKeyOf(repo);
    return ops.filter((op) => op.repoKey === key && matchesBranch(op, branch) && op.status === 'failed');
  }

  async function setOpStatus(id, status, error = '') {
    const op = ops.find((row) => row.id === id);
    if (!op) return null;
    op.status = status;
    op.error = error || '';
    await persistOp(op);
    emit();
    return op;
  }

  async function setPartsState(repo, partIds, state, branch = 'main') {
    const key = repoKeyOf(repo);
    const on = branch || 'main';
    for (const id of partIds || []) {
      const slot = `${key}\0${on}\0${id}`;
      if (!state || state === 'clean') partState.delete(slot);
      else partState.set(slot, state);
      await persistKv(`state:${slot}`, state && state !== 'clean' ? state : null);
    }
    emit();
  }

  async function requeue(id) {
    const op = await setOpStatus(id, 'queued', '');
    if (op) await setPartsState(op.repoKey, op.partIds, 'queued', op.branch || 'main');
    return op;
  }

  async function drop(id) {
    const idx = ops.findIndex((row) => row.id === id);
    if (idx < 0) return null;
    const [op] = ops.splice(idx, 1);
    await setPartsState(op.repoKey, op.partIds, 'clean', op.branch || 'main');
    if (persistOn) {
      const db = await openDB();
      if (db) await txDone(db, OUTBOX, 'readwrite', (store) => store.delete(id));
    }
    emit();
    return op;
  }

  async function setLastSyncedSha(repo, sha, branch = 'main') {
    await ready;
    const key = branchKeyOf(repo, branch);
    if (sha) repoSha.set(key, sha);
    else repoSha.delete(key);
    await persistKv(`sha:${key}`, sha || null);
  }

  function getLastSyncedSha(repo, branch = 'main') {
    return repoSha.get(branchKeyOf(repo, branch)) || null;
  }

  async function putPart(repo, record) {
    await ready;
    const key = repoKeyOf(repo);
    const surfId = record?.surfId;
    if (!surfId) return;
    const row = {
      surfId,
      path: record.path,
      content: record.content ?? '',
      lastSyncedSha: record.lastSyncedSha ?? null,
      previousPath: record.previousPath || null,
    };
    parts.set(`${key}\0${surfId}`, row);
    await persistKv(`part:${key}\0${surfId}`, row);
    if (row.previousPath) {
      aliases.set(`${key}\0${row.previousPath}`, surfId);
      await persistKv(`alias:${key}\0${row.previousPath}`, surfId);
    }
  }

  function getPartById(repo, surfId) {
    return parts.get(`${repoKeyOf(repo)}\0${surfId}`) || null;
  }

  function getAlias(repo, path) {
    return aliases.get(`${repoKeyOf(repo)}\0${path}`) || null;
  }

  async function putAssembly(repo, path, text) {
    await ready;
    const slot = `${repoKeyOf(repo)}\0${path}`;
    assemblies.set(slot, text);
    await persistKv(`asm:${slot}`, text);
  }

  function getAssembly(repo, path) {
    return assemblies.get(`${repoKeyOf(repo)}\0${path}`) ?? null;
  }

  async function dropAssembly(repo, path) {
    await ready;
    if (!path) return;
    const slot = `${repoKeyOf(repo)}\0${path}`;
    assemblies.delete(slot);
    await persistKv(`asm:${slot}`, null);
  }

  async function rememberPathId(repo, path, surfId) {
    await ready;
    if (!path || !surfId) return;
    const slot = `${repoKeyOf(repo)}\0${path}`;
    pathIndex.set(slot, surfId);
    await persistKv(`path:${slot}`, surfId);
  }

  /**
   * Whole-vault snapshot for one branch. One IndexedDB value, swapped only
   * after `entries` is fully built, so a delete cannot land halfway.
   */
  async function putTree(repo, branch, entries) {
    await ready;
    if (!Array.isArray(entries)) throw new Error('Delete cache needs a full snapshot');
    const built = [];
    for (const entry of entries) {
      if (!entry?.path) throw new Error('Delete cache snapshot has an empty path');
      built.push({ path: entry.path, content: copyTreeContent(entry.content) });
    }
    const slot = branchKeyOf(repo, branch);
    const had = trees.has(slot);
    const prev = trees.get(slot);
    trees.set(slot, built);
    try {
      await persistKv(`tree:${slot}`, built);
    } catch (err) {
      if (!had) trees.delete(slot);
      else trees.set(slot, prev);
      throw err;
    }
    return built;
  }

  function getTree(repo, branch = 'main') {
    const rows = trees.get(branchKeyOf(repo, branch));
    if (!rows) return null;
    return rows.map((entry) => ({ path: entry.path, content: entry.content ?? '' }));
  }

  /**
   * Strip legacy `local-` surf ids in this store: outbox payloads, path-index
   * values, alias values, and `part:` keys. A second call changes nothing.
   */
  async function migrateLocalSurfIds() {
    await ready;
    let changed = false;
    for (const op of ops) {
      const next = migrateOutboxOp(op);
      if (next === op) continue;
      Object.assign(op, next);
      changed = true;
      await persistOp(op);
    }
    for (const [slot, surfId] of [...pathIndex.entries()]) {
      const next = canonicalSurfId(surfId);
      if (next === surfId) continue;
      pathIndex.set(slot, next);
      changed = true;
      await persistKv(`path:${slot}`, next);
    }
    for (const [slot, surfId] of [...aliases.entries()]) {
      const next = canonicalSurfId(surfId);
      if (next === surfId) continue;
      aliases.set(slot, next);
      changed = true;
      await persistKv(`alias:${slot}`, next);
    }
    for (const [slot, row] of [...parts.entries()]) {
      const nextId = canonicalSurfId(row?.surfId);
      const nextContent = typeof row?.content === 'string'
        ? rewriteVaultFile(row.path || 'part.js', row.content)
        : row?.content;
      if (nextId === row?.surfId && nextContent === row?.content) continue;
      const repoKey = slot.split('\0')[0];
      const newSlot = `${repoKey}\0${nextId}`;
      const nextRow = { ...row, surfId: nextId, content: nextContent ?? '' };
      parts.delete(slot);
      parts.set(newSlot, nextRow);
      changed = true;
      await persistKv(`part:${slot}`, null);
      await persistKv(`part:${newSlot}`, nextRow);
    }
    return { changed };
  }

  function rekeySlot(slot, fromKey, toKey) {
    if (slot === fromKey) return toKey;
    const prefix = `${fromKey}\0`;
    if (typeof slot === 'string' && slot.startsWith(prefix)) {
      return `${toKey}\0${slot.slice(prefix.length)}`;
    }
    return null;
  }

  async function rekeyMap(map, fromKey, toKey, persistPrefix) {
    let moved = 0;
    for (const [slot, value] of [...map.entries()]) {
      const next = rekeySlot(slot, fromKey, toKey);
      if (next == null) continue;
      if (!map.has(next)) {
        map.set(next, value);
        if (persistPrefix) await persistKv(`${persistPrefix}${next}`, value);
      }
      map.delete(slot);
      if (persistPrefix) await persistKv(`${persistPrefix}${slot}`, null);
      moved += 1;
    }
    return moved;
  }

  /**
   * Move surfcad-sync rows from one repo key to another. A second call
   * finds nothing to move. Destination keys that already exist are kept.
   */
  async function rekeyRepo(fromRepo, toRepo) {
    await ready;
    const from = repoKeyOf(fromRepo);
    const to = repoKeyOf(toRepo);
    if (!from || !to || from === to) return { moved: 0, from, to };
    let moved = 0;
    for (const op of ops) {
      if (op.repoKey !== from) continue;
      op.repoKey = to;
      moved += 1;
      await persistOp(op);
    }
    moved += await rekeyMap(partState, from, to, 'state:');
    moved += await rekeyMap(repoSha, from, to, 'sha:');
    moved += await rekeyMap(parts, from, to, 'part:');
    moved += await rekeyMap(aliases, from, to, 'alias:');
    moved += await rekeyMap(assemblies, from, to, 'asm:');
    moved += await rekeyMap(pathIndex, from, to, 'path:');
    moved += await rekeyMap(trees, from, to, 'tree:');
    moved += await rekeyMap(pendingDeletes, from, to, 'del:');
    if (moved) emit();
    return { moved, from, to };
  }

  async function dropPathId(repo, path) {
    await ready;
    if (!path) return;
    const slot = `${repoKeyOf(repo)}\0${path}`;
    pathIndex.delete(slot);
    await persistKv(`path:${slot}`, null);
  }

  function deleteSlot(repo, branch, assembly) {
    return `${repoKeyOf(repo)}\0${branch || 'main'}\0${String(assembly || '')}`;
  }

  async function addPendingDeletes(repo, branch, assembly, paths) {
    await ready;
    const slot = deleteSlot(repo, branch, assembly);
    const prev = pendingDeletes.get(slot) || [];
    const seen = new Set(prev);
    const next = [...prev];
    for (const path of paths || []) {
      const text = String(path || '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      next.push(text);
    }
    next.sort();
    pendingDeletes.set(slot, next);
    await persistKv(`del:${slot}`, next);
    return next.slice();
  }

  function getPendingDeletes(repo, branch, assembly) {
    const rows = pendingDeletes.get(deleteSlot(repo, branch, assembly));
    return Array.isArray(rows) ? rows.slice() : [];
  }

  async function clearPendingDeletes(repo, branch, assembly) {
    await ready;
    const slot = deleteSlot(repo, branch, assembly);
    pendingDeletes.delete(slot);
    await persistKv(`del:${slot}`, null);
  }

  function pathIndexFor(repo) {
    const prefix = `${repoKeyOf(repo)}\0`;
    const out = {};
    for (const [slot, surfId] of pathIndex) {
      if (slot.startsWith(prefix)) out[slot.slice(prefix.length)] = surfId;
    }
    return out;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    ready: () => ready,
    enqueue,
    pending,
    failed,
    setOpStatus,
    setPartsState,
    requeue,
    drop,
    setLastSyncedSha,
    getLastSyncedSha,
    putPart,
    getPartById,
    getAlias,
    putAssembly,
    getAssembly,
    dropAssembly,
    rememberPathId,
    dropPathId,
    pathIndexFor,
    putTree,
    getTree,
    addPendingDeletes,
    getPendingDeletes,
    clearPendingDeletes,
    migrateLocalSurfIds,
    rekeyRepo,
    partStates,
    subscribe,
    ops: () => ops.slice(),
  };
}

/** Drop the sync database (Clear local cache). */
export async function clearSyncStore() {
  const db = await openDB();
  if (!db) return false;
  const out = await txDone(db, OUTBOX, 'readwrite', (store) => store.clear());
  const kv = await txDone(db, KV, 'readwrite', (store) => store.clear());
  return out != null || kv != null;
}
