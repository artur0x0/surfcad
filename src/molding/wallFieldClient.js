/**
 * Wall-thickness heatmap off the main thread.
 *
 * The viewport copies the mesh and posts it. Replies are a coarse centroid
 * field, then the refined field. `dropWallJobs` abandons replies when the
 * map is turned off. The worker stays up: terminating it would drop the
 * caller's promise.
 */

import { computeWallField } from './wallFieldJob.js';

let worker = null;
let nextId = 1;
/** @type {Map<number, { resolve: (value: object) => void, onCoarse?: (result: object) => void }>} */
const pending = new Map();

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
  }
  return copied;
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
    if (data.phase === 'coarse') {
      if (!data.result?.error && typeof slot.onCoarse === 'function') slot.onCoarse(data.result);
      return;
    }
    pending.delete(data.id);
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

export function requestWallField({ positions, indices, stamped, onCoarse } = {}) {
  if (!positions || !indices || indices.length < 3) {
    return Promise.resolve({ error: { code: 'no_mesh', message: 'No mesh for that part' } });
  }
  const mesh = copyWallMesh(positions, indices, stamped);
  const thread = ensureWorker();
  if (!thread) {
    return Promise.resolve().then(() => computeWallField(mesh, { onCoarse }));
  }
  const id = nextId;
  nextId += 1;
  return new Promise((resolve) => {
    pending.set(id, { resolve, onCoarse });
    const transfer = [mesh.positions.buffer, mesh.indices.buffer];
    if (mesh.stamped?.triFace) transfer.push(mesh.stamped.triFace.buffer);
    thread.postMessage({ id, positions: mesh.positions, indices: mesh.indices, stamped: mesh.stamped }, transfer);
  });
}

/** Resolve every in-flight request as dropped. The worker keeps running. */
export function dropWallJobs() {
  for (const [id, slot] of pending) {
    pending.delete(id);
    slot.resolve({ dropped: true });
  }
}

/** Test hook. Production turns the map off with `dropWallJobs`. */
export function resetWallFieldClientForTests() {
  if (worker && typeof worker.terminate === 'function') {
    try { worker.terminate(); } catch { /* already gone */ }
  }
  worker = null;
  pending.clear();
  nextId = 1;
}
