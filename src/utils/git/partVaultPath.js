/**
 * Vault part script paths: allocate on create, repair before assembly save.
 */
import {
  DEFAULT_PART_NAME,
  normalizeRepoPath,
  serializeAssembly,
} from '../assembly.js';
import { sharedPathForMove } from './gitDeleteAssembly.js';
import {
  occupancyPathsFromParts,
  partKeepsStableId,
  partRepoPath,
  partRowNeedsVaultPath,
} from './partIdentity.js';
import {
  assemblyPartPath,
  assetPathForScript,
  partPathAllowedFor,
  parseVaultPath,
  vaultPartFileStem,
  vaultSegment,
} from './vaultLayout.js';

export { partRowNeedsVaultPath, partRowVaultPathOk, partRepoPath } from './partIdentity.js';

/**
 * Occupancy for a vault write: a script path and its `.mesh` sibling are
 * the same stem. Seeing either in the tree (or the open document) blocks
 * allocating the other.
 */
export function occupyVaultPath(taken, path) {
  if (typeof path !== 'string' || !path.trim()) return taken;
  const p = path.trim();
  taken.add(p);
  const mesh = assetPathForScript(p);
  if (mesh) taken.add(mesh);
  const info = parseVaultPath(p);
  if (info?.kind === 'asset' && info.script) taken.add(info.script);
  return taken;
}

export function occupancySet(paths = []) {
  const taken = new Set();
  for (const item of paths || []) {
    if (typeof item === 'string') occupyVaultPath(taken, item);
    else {
      occupyVaultPath(taken, partRepoPath(item) || item?.id);
    }
  }
  return taken;
}

export function pathOccupied(taken, path) {
  if (!path) return true;
  if (taken.has(path)) return true;
  const mesh = assetPathForScript(path);
  return !!(mesh && taken.has(mesh));
}

function nextAssemblyFolderPartPath(assemblySeg, partHint, taken) {
  for (let n = 1; n < 1000; n += 1) {
    const stem = vaultPartFileStem(partHint, n);
    const path = assemblyPartPath(assemblySeg, stem);
    if (!pathOccupied(taken, path)) return path;
  }
  return null;
}

/**
 * One repo script path for a new part. Bare names use
 * `assemblies/<Assembly>/<Name>.js` with `-2`, `-3`, … on collision.
 * Full paths are normalized to end in `.js`. `layout: 'shared'` is the
 * leftover `parts/` home and is not used for new writes.
 */
export function allocateVaultPartPath(assemblyName, partName, takenPaths = [], {
  layout = 'assembly-folder',
} = {}) {
  const raw = String(partName ?? '').trim();
  if (!raw) return null;
  const taken = occupancySet(takenPaths);
  if (raw.includes('/') || raw.toLowerCase().endsWith('.js')) {
    const path = normalizeRepoPath(raw.endsWith('.js') ? raw : `${raw}.js`);
    if (!path) return null;
    if (!partPathAllowedFor(assemblyName, path)) return null;
    if (pathOccupied(taken, path)) {
      const info = parseVaultPath(path);
      const base = info?.part || path.split('/').pop()?.replace(/\.js$/i, '') || 'Part';
      if (layout === 'assembly-folder') {
        const asm = vaultSegment(assemblyName);
        if (!asm) return null;
        return nextAssemblyFolderPartPath(asm, base, taken);
      }
      return sharedPathForMove(base, taken);
    }
    return path;
  }
  const asm = vaultSegment(assemblyName);
  if (!asm) return null;
  const base = vaultSegment(raw) || DEFAULT_PART_NAME;
  if (layout === 'shared') {
    try {
      return sharedPathForMove(base, taken);
    } catch {
      return null;
    }
  }
  return nextAssemblyFolderPartPath(asm, base, taken);
}

/**
 * New script path for a renamed vault part. Stays in the same folder
 * (`parts/` or `assemblies/<Assembly>/`); a taken path gets `-2`, `-3`, ….
 * The part's own current path is never counted as taken.
 * -> path | null (not a vault part path, or no usable name)
 */
export function planRenameVaultPartPath(fromPath, newName, takenPaths = []) {
  const info = parseVaultPath(fromPath);
  if (!info || (info.kind !== 'shared-part' && info.kind !== 'assembly-part')) return null;
  const hint = vaultSegment(String(newName ?? '').replace(/\.js$/i, ''));
  if (!hint) return null;
  const taken = [];
  for (const item of takenPaths || []) {
    const path = typeof item === 'string' ? item : (partRepoPath(item) || item?.path || item?.id);
    if (path && path !== fromPath) taken.push(path);
  }
  if (info.kind === 'shared-part') {
    return allocateVaultPartPath(info.assembly || 'Assembly', hint, taken, { layout: 'shared' });
  }
  return allocateVaultPartPath(info.assembly, hint, taken, { layout: 'assembly-folder' });
}

export function resolveNewPartPath(assemblyName, partName, takenPaths = []) {
  return allocateVaultPartPath(assemblyName, partName, takenPaths, { layout: 'assembly-folder' });
}

/**
 * Before an assembly Save, assign every path-less part a vault script path
 * under `assemblies/<Assembly>/<Name>.js`. Collisions get `Name-2`, etc.
 * The row id stays. Scripts stay keyed by id.
 *
 * Already-pathed rows keep their `path` and `isSynced`. Flipping
 * `isSynced: false` on those siblings made the parts-list yellow dot
 * appear on untouched rows after a Save that added a new part, even
 * though git dirty and the assembly Save badge stayed clean.
 * -> { doc, scripts, moved: [{ from, to, id }] }
 */
export function ensureAssemblyVaultPaths(doc, scripts = {}, { remotePaths = [] } = {}) {
  const asm = vaultSegment(doc?.name);
  if (!asm || !doc) return { doc, scripts, moved: [] };
  const needs = (doc.parts || []).filter(partRowNeedsVaultPath);
  if (!needs.length) {
    const withPaths = (doc.parts || []).map((part) => {
      const path = partRepoPath(part);
      return path && part.path !== path ? { ...part, path } : part;
    });
    return { doc: { ...doc, parts: withPaths }, scripts, moved: [] };
  }

  const taken = occupancySet([
    ...occupancyPathsFromParts(doc.parts),
    ...(remotePaths || []),
  ]);

  const pathMap = new Map();
  const moved = [];
  const workScripts = { ...(scripts || {}) };

  for (const part of needs) {
    const fromId = part.id;
    const hint = part.name
      || vaultSegment(String(fromId).replace(/^local[:-]?/i, ''))
      || DEFAULT_PART_NAME;
    const path = allocateVaultPartPath(asm, hint, [...taken], { layout: 'assembly-folder' });
    if (!path) continue;
    occupyVaultPath(taken, path);
    pathMap.set(fromId, path);
    moved.push({ from: fromId, to: path, id: fromId });
  }

  if (!pathMap.size) return { doc, scripts, moved: [] };

  const nextParts = (doc.parts || []).map((part) => {
    const assigned = pathMap.get(part.id);
    if (!assigned) {
      const path = partRepoPath(part);
      return path && part.path !== path ? { ...part, path } : part;
    }
    const leaf = assigned.split('/').pop()?.replace(/\.js$/i, '') || part.name;
    if (partKeepsStableId(part)) {
      return {
        ...part,
        path: assigned,
        name: part.name || leaf,
        isSynced: false,
      };
    }
    const text = workScripts[part.id];
    delete workScripts[part.id];
    workScripts[assigned] = typeof text === 'string' ? text : '';
    return {
      ...part,
      id: assigned,
      path: assigned,
      name: part.name || leaf,
      isSynced: false,
    };
  });
  const nextDoc = serializeAssembly({
    ...doc,
    source: doc.source === 'git' ? 'git' : 'local',
    parts: nextParts,
    activeId: doc.activeId,
  });
  return { doc: nextDoc, scripts: workScripts, moved };
}

export function promoteStrayPartsToAssemblyFolder(doc, scripts, opts) {
  return ensureAssemblyVaultPaths(doc, scripts, opts);
}
