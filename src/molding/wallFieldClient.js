/**
 * Wall heatmap and mold analysis off the main thread.
 *
 * The viewport copies the mesh and posts it. Wall replies are progress, a
 * coarse centroid field, then the refined field. Analysis replies are
 * progress, then one mold-analysis result. `dropWallJobs` and
 * `dropMoldJobs` abandon replies when that tool is turned off. The worker
 * stays up: terminating it would drop the caller's promise.
 */

import { runAnalysisJob, runWallJob } from './wallFieldJob.js';

let worker = null;
let nextId = 1;
/** @type {Map<number, { resolve: (value: object) => void, onCoarse?: (result: object) => void, onProgress?: (info: object) => void, kind: string }>} */
const pending = new Map();
const localCancel = new Set();

function copyArray(source, Ctor) {
  if (source instanceof Ctor) return new Ctor(source);
  return Ctor.from(source);
}

export function copyWallMesh(positions, indices, stamped) {
  const copied = {
    positions: copyArray(positions, Float64Array),
    indices: copyArray(indices, Uint32Array),
    stamped: null,
  };
  if (stamped?.triFace && stamped?.normals) {
    copied.stamped = {
      triFace: copyArray(stamped.triFace, Int32Array),
      normals: Array.from(stamped.normals, (normal) => (
        normal ? [Number(normal[0]), Number(normal[1]), Number(normal[2])] : null
      )),
    };
    if (Array.isArray(stamped.names)) {
      copied.stamped.names = stamped.names.map((name) => (name == null ? null : String(name)));
    }
  }
  return copied;
}

/** Plain patch rows. The PartGraph tris arrays stay on the main thread. */
export function copyMoldPatches(patches) {
  if (!Array.isArray(patches)) return null;
  const rows = [];
  for (const patch of patches) {
    const normal = patch?.normal;
    rows.push({
      kind: patch?.kind,
      area: Number(patch?.area) || 0,
      normal: normal && normal.length >= 3
        ? [Number(normal[0]), Number(normal[1]), Number(normal[2])]
        : null,
    });
  }
  return rows;
}

function failPending(message) {
  for (const [id, slot] of pending) {
    pending.delete(id);
    slot.resolve({ error: { code: 'internal', message } });
  }
}

function ensureWorker() {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  worker = new Worker(new URL('./wallFieldWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const data = event?.data || {};
    const slot = pending.get(data.id);
    if (!slot) return;
    if (data.phase === 'progress') {
      if (typeof slot.onProgress === 'function') {
        slot.onProgress({ stage: data.stage, percent: data.percent });
      }
      return;
    }
    if (data.phase === 'coarse') {
      if (!data.result?.error && typeof slot.onCoarse === 'function') slot.onCoarse(data.result);
      return;
    }
    pending.delete(data.id);
    if (data.phase === 'dropped') {
      slot.resolve({ dropped: true });
      return;
    }
    if (data.phase === 'error' || data.error) {
      slot.resolve({ error: data.error || { code: 'internal', message: 'Wall field failed' } });
      return;
    }
    slot.resolve(data.result);
  };
  worker.onerror = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    failPending(event?.message || 'Wall field worker failed');
  };
  return worker;
}

function dropKind(kind) {
  const thread = worker;
  for (const [id, slot] of pending) {
    if (slot.kind !== kind) continue;
    pending.delete(id);
    localCancel.add(id);
    slot.resolve({ dropped: true });
    if (thread) thread.postMessage({ cancel: id });
  }
}

function postJob(kind, payload, { onCoarse, onProgress, run }) {
  const id = nextId;
  nextId += 1;
  const thread = ensureWorker();
  if (!thread) {
    return new Promise((resolve) => {
      pending.set(id, { resolve, onCoarse, onProgress, kind });
      run(payload, {
        cancelled: () => localCancel.has(id) || !pending.has(id),
        post(message) {
          const slot = pending.get(id);
          if (!slot) return;
          if (message.phase === 'progress') {
            if (typeof slot.onProgress === 'function') {
              slot.onProgress({ stage: message.stage, percent: message.percent });
            }
            return;
          }
          if (message.phase === 'coarse') {
            if (!message.result?.error && typeof slot.onCoarse === 'function') slot.onCoarse(message.result);
            return;
          }
          pending.delete(id);
          if (message.phase === 'dropped') {
            slot.resolve({ dropped: true });
            return;
          }
          if (message.phase === 'error' || message.error) {
            slot.resolve({ error: message.error || { code: 'internal', message: 'Mold analysis failed' } });
            return;
          }
          slot.resolve(message.result);
        },
      }).catch((err) => {
        const slot = pending.get(id);
        if (!slot) return;
        pending.delete(id);
        slot.resolve({ error: { code: 'internal', message: String(err?.message || err) } });
      });
    });
  }
  return new Promise((resolve) => {
    pending.set(id, { resolve, onCoarse, onProgress, kind });
    const transfer = [payload.positions.buffer, payload.indices.buffer];
    if (payload.stamped?.triFace) transfer.push(payload.stamped.triFace.buffer);
    thread.postMessage({ id, kind, ...payload }, transfer);
  });
}

export function requestWallField({ positions, indices, stamped, onCoarse, onProgress } = {}) {
  if (!positions || !indices || indices.length < 3) {
    return Promise.resolve({ error: { code: 'no_mesh', message: 'No mesh for that part' } });
  }
  dropKind('wall');
  const mesh = copyWallMesh(positions, indices, stamped);
  return postJob('wall', mesh, { onCoarse, onProgress, run: runWallJob });
}

/**
 * Pull, parting, side actions, mold draft, and the DFM summary for one
 * mesh. `pull` scores that axis; omit it to search. A later analysis
 * request does not cancel this one — the viewport drops stale jobs when
 * the pull or the tool changes.
 */
export function requestMoldAnalysis({
  positions,
  indices,
  stamped,
  patches,
  pull = null,
  wall = null,
  onProgress,
} = {}) {
  if (!positions || !indices || indices.length < 3) {
    return Promise.resolve({ error: { code: 'no_mesh', message: 'No mesh for that part' } });
  }
  const mesh = copyWallMesh(positions, indices, stamped);
  const payload = {
    ...mesh,
    patches: copyMoldPatches(patches),
    pull,
    wall,
  };
  return postJob('analysis', payload, { onProgress, run: runAnalysisJob });
}

/** Resolve in-flight wall requests as dropped. The worker keeps running. */
export function dropWallJobs() {
  dropKind('wall');
}

/** Resolve in-flight mold-analysis requests as dropped. The worker keeps running. */
export function dropMoldJobs() {
  dropKind('analysis');
}

/** Test hook. Production turns the map off with `dropWallJobs`. */
export function resetWallFieldClientForTests() {
  if (worker && typeof worker.terminate === 'function') {
    try { worker.terminate(); } catch { /* already gone */ }
  }
  worker = null;
  pending.clear();
  localCancel.clear();
  nextId = 1;
}
