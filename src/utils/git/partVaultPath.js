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
  PART_EXT,
  assemblyPartPath,
  assetPathForScript,
  isVaultPartPath,
  partPathAllowedFor,
  parseVaultPath,
  vaultPartFileStem,
  vaultSegment,
} from './vaultLayout.js';

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
    occupyVaultPath(taken, typeof item === 'string' ? item : item?.id);
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
 * One repo script path for a new part. Bare names use `parts/<Name>.js` with
 * `-2`, `-3`, … suffixes on collision. Full paths are normalized to end in `.js`.
 * `layout: 'assembly-folder'` lands under `assemblies/<Assembly>/`.
 */
export function allocateVaultPartPath(assemblyName, partName, takenPaths = [], {
  layout = 'shared',
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
    const path = typeof item === 'string' ? item : item?.id;
    if (path && path !== fromPath) taken.push(path);
  }
  if (info.kind === 'shared-part') {
    return allocateVaultPartPath(info.assembly || 'Assembly', hint, taken, { layout: 'shared' });
  }
  return allocateVaultPartPath(info.assembly, hint, taken, { layout: 'assembly-folder' });
}

export function resolveNewPartPath(assemblyName, partName, takenPaths = []) {
  return allocateVaultPartPath(assemblyName, partName, takenPaths, { layout: 'shared' });
}

/** True when a part row id is a vault script path ending in `.js`. */
export function partRowVaultPathOk(id) {
  const text = String(id || '').trim();
  if (!text) return false;
  const path = normalizeRepoPath(text);
  if (!path || path !== text) return false;
  if (!path.endsWith(PART_EXT)) return false;
  return isVaultPartPath(path);
}

export function partRowNeedsVaultPath(part) {
  return !partRowVaultPathOk(part?.id);
}

/**
 * Before an assembly Save, assign every invalid part id a vault script path
 * under `assemblies/<Assembly>/<Name>.js`. Collisions get `Name-2`, etc.
 * -> { doc, scripts, moved: [{ from, to }] }
 */
export function ensureAssemblyVaultPaths(doc, scripts = {}, { remotePaths = [] } = {}) {
  const asm = vaultSegment(doc?.name);
  if (!asm || !doc) return { doc, scripts, moved: [] };
  const needs = (doc.parts || []).filter(partRowNeedsVaultPath);
  if (!needs.length) return { doc, scripts, moved: [] };

  const taken = occupancySet([
    ...(doc.parts || []).filter((part) => partRowVaultPathOk(part.id)).map((part) => part.id),
    ...(remotePaths || []),
  ]);

  const idMap = new Map();
  const moved = [];
  let workScripts = { ...(scripts || {}) };

  for (const part of needs) {
    const fromId = part.id;
    const hint = part.name
      || vaultSegment(String(fromId).replace(/^local[:-]?/i, ''))
      || DEFAULT_PART_NAME;
    const path = allocateVaultPartPath(asm, hint, [...taken], { layout: 'assembly-folder' });
    if (!path) continue;
    occupyVaultPath(taken, path);
    idMap.set(fromId, path);
    moved.push({ from: fromId, to: path });
    const text = workScripts[fromId];
    delete workScripts[fromId];
    workScripts[path] = typeof text === 'string' ? text : '';
  }

  if (!idMap.size) return { doc, scripts, moved: [] };

  const nextParts = (doc.parts || []).map((part) => {
    const to = idMap.get(part.id);
    if (!to) return part;
    const leaf = to.split('/').pop()?.replace(/\.js$/i, '') || part.name;
    return {
      ...part,
      id: to,
      name: part.name || leaf,
      isSynced: false,
    };
  });
  const nextActive = idMap.get(doc.activeId) || doc.activeId;
  const nextDoc = serializeAssembly({
    ...doc,
    source: doc.source === 'git' ? 'git' : 'local',
    parts: nextParts,
    activeId: nextActive,
  });
  return { doc: nextDoc, scripts: workScripts, moved };
}

export function promoteStrayPartsToAssemblyFolder(doc, scripts, opts) {
  return ensureAssemblyVaultPaths(doc, scripts, opts);
}
