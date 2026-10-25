/**
 * ArrayBuffers a mesh payload can hand to postMessage.
 * Only views that own their whole buffer: a shared or sliced view stays
 * cloned, because transferring it would detach the neighbour.
 */

const MESH_KEYS = ['vertProperties', 'triVerts', 'runIndex', 'runOriginalID', 'faceID'];

function pushBuffer(arr, out, seen) {
  const buf = arr && ArrayBuffer.isView(arr) ? arr.buffer : null;
  if (!buf || seen.has(buf)) return;
  if (arr.byteOffset !== 0 || arr.byteLength !== buf.byteLength) return;
  seen.add(buf);
  out.push(buf);
}

/** Buffers of one mesh object, in a stable key order. */
export function meshTransferList(meshData) {
  const out = [];
  const seen = new Set();
  for (const key of MESH_KEYS) pushBuffer(meshData?.[key], out, seen);
  return out;
}

/**
 * Every owned typed-array buffer in a worker result (the mesh, a preview's
 * pieces, a trim). Plain arrays and numbers are left alone.
 */
export function collectTransferBuffers(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (ArrayBuffer.isView(value)) {
    pushBuffer(value, out, seen);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTransferBuffers(item, out, seen);
    return out;
  }
  for (const key of Object.keys(value)) collectTransferBuffers(value[key], out, seen);
  return out;
}

/**
 * A mesh whose typed arrays are copies, plus the transfer list for those
 * copies. The caller's buffers stay attached.
 */
export function copyMeshForTransfer(mesh) {
  if (!mesh || typeof mesh !== 'object') return { mesh, transfers: [] };
  const copy = { ...mesh };
  for (const key of MESH_KEYS) {
    const arr = mesh[key];
    if (!arr || !ArrayBuffer.isView(arr)) continue;
    const Ctor = arr.constructor;
    copy[key] = new Ctor(arr);
  }
  return { mesh: copy, transfers: meshTransferList(copy) };
}
