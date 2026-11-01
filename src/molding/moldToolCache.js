/**
 * Results for the molding tools, keyed by the part mesh and, for the tools
 * that read it, the shared pull override.
 *
 * Wall thickness does not use the pull, so a pull change keeps that entry.
 * Core and cavity, mold draft, and the report do. A mesh change drops every
 * entry for that mesh. A hit is the stored value; the caller does not recompute.
 */

const PULL_TOOLS = new Set(['parting', 'draft', 'report']);

function arraysOf(mesh) {
  if (!mesh) return null;
  const position = mesh.attributes?.position;
  const pos = position?.array || position || mesh.positions || null;
  if (!pos || typeof pos.length !== 'number' || pos.length < 3) return null;
  const index = mesh.index;
  const idx = index?.array || index || mesh.indices || null;
  return { pos, idx: idx && typeof idx.length === 'number' ? idx : null };
}

function mix(hash, value) {
  const n = Number.isFinite(value) ? Math.round(value * 1e6) : 0;
  let h = (hash ^ n) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Stable content stamp. Two meshes with the same vertices share a stamp. */
export function meshStamp(mesh) {
  const arrays = arraysOf(mesh);
  if (!arrays) return null;
  let hash = 2166136261;
  const { pos, idx } = arrays;
  for (let i = 0; i < pos.length; i += 1) hash = mix(hash, pos[i]);
  hash = mix(hash, pos.length);
  if (idx) {
    for (let i = 0; i < idx.length; i += 1) hash = mix(hash, idx[i]);
    hash = mix(hash, idx.length);
  }
  return `${pos.length}:${idx ? idx.length : 0}:${hash.toString(16)}`;
}

/** `auto` when the tool is searching. A vector is the override. */
export function pullStamp(pull) {
  if (!Array.isArray(pull) || pull.length < 3) return 'auto';
  const parts = [];
  for (let i = 0; i < 3; i += 1) {
    const n = Number(pull[i]);
    parts.push(Number.isFinite(n) ? n.toFixed(6) : '0');
  }
  return parts.join(',');
}

function keyOf(tool, mesh, pull) {
  const stamp = meshStamp(mesh);
  if (!stamp) return null;
  const pullKey = PULL_TOOLS.has(tool) ? pullStamp(pull) : '';
  return `${tool}|${stamp}|${pullKey}`;
}

export function createMoldToolCache() {
  const store = new Map();
  return {
    get(tool, mesh, pull) {
      const key = keyOf(tool, mesh, pull);
      if (!key || !store.has(key)) return { hit: false, value: null };
      return { hit: true, value: store.get(key) };
    },
    set(tool, mesh, pull, value) {
      const key = keyOf(tool, mesh, pull);
      if (!key) return false;
      store.set(key, value);
      return true;
    },
    /** Drop every tool stored for this mesh. Other meshes stay. */
    invalidateMesh(mesh) {
      const stamp = meshStamp(mesh);
      if (!stamp) return 0;
      let dropped = 0;
      for (const key of store.keys()) {
        if (key.split('|')[1] === stamp) {
          store.delete(key);
          dropped += 1;
        }
      }
      return dropped;
    },
    /** Drop core and cavity, mold draft, and the report. Wall thickness stays. */
    invalidatePull() {
      let dropped = 0;
      for (const key of store.keys()) {
        const tool = key.split('|')[0];
        if (PULL_TOOLS.has(tool)) {
          store.delete(key);
          dropped += 1;
        }
      }
      return dropped;
    },
  };
}
