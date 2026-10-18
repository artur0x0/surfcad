/**
 * v2 vault paths are `f(id)` only. Internal to the vault writer/reader.
 * Not an agent/tool lookup — v2 tools take `part_id` / `assembly_id`.
 *
 *   parts/<id>.js
 *   parts/<id>.mesh
 *   assemblies/<id>.surf.json
 *
 * Named `*IdPath` so they cannot be confused with v1 `vaultLayout`
 * helpers (`assemblyFilePath` → `assemblies/<Name>/.surf.json`).
 * Not barrel-exported from `git/index.js`.
 */
import { normalizeRepoPath } from '../assembly.js';
import { ASSEMBLIES_DIR, ASSET_EXT, PART_EXT, SHARED_PARTS_DIR } from './vaultLayout.js';
import { isV2SurfId } from './surfId.js';

function needId(id) {
  const text = String(id ?? '');
  if (!isV2SurfId(text)) throw new Error(`Bad surf id: ${id}`);
  return text;
}

/** `parts/<id>.js` */
export function partIdPath(id) {
  return `${SHARED_PARTS_DIR}/${needId(id)}${PART_EXT}`;
}

/** `parts/<id>.mesh` */
export function partMeshIdPath(id) {
  return `${SHARED_PARTS_DIR}/${needId(id)}${ASSET_EXT}`;
}

/** `assemblies/<id>.surf.json` */
export function assemblyIdPath(id) {
  return `${ASSEMBLIES_DIR}/${needId(id)}.surf.json`;
}

/**
 * Inverse of the v2 path helpers.
 * → `{ kind: 'part' | 'mesh' | 'assembly', id }` or null.
 * Name-based v1 paths and a `local-` stem return null.
 */
export function parseIdPath(path) {
  const p = normalizeRepoPath(path);
  if (!p) return null;
  const segs = p.split('/');
  if (segs.length !== 2) return null;
  if (segs[0] === SHARED_PARTS_DIR) {
    if (segs[1].endsWith(PART_EXT) && segs[1].length > PART_EXT.length) {
      const id = segs[1].slice(0, -PART_EXT.length);
      return isV2SurfId(id) ? { kind: 'part', id } : null;
    }
    if (segs[1].endsWith(ASSET_EXT) && segs[1].length > ASSET_EXT.length) {
      const id = segs[1].slice(0, -ASSET_EXT.length);
      return isV2SurfId(id) ? { kind: 'mesh', id } : null;
    }
    return null;
  }
  if (segs[0] === ASSEMBLIES_DIR && segs[1].endsWith('.surf.json')) {
    const id = segs[1].slice(0, -'.surf.json'.length);
    return isV2SurfId(id) ? { kind: 'assembly', id } : null;
  }
  return null;
}
