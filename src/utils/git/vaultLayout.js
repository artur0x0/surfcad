/**
 * Vault / repo layout (one private repo per user, default `surfcad-vault`):
 *
 *   surfcad.json                                  vault marker
 *   README.md
 *   assemblies/<name>/.surf.json                  assembly metadata (nameless)
 *   assemblies/<name>/<part>.js                   Copy to this assembly only (new id)
 *   assemblies/<name>/<part>.mesh                 mesh asset for that assembly copy
 *   parts/<part>.js                               part scripts, referenced by path
 *   parts/<part>.mesh                             mesh asset for that shared part
 *
 * Legacy (read-compat only; writes always use the layout above):
 *   assemblies/<name>/<name>.surf.json
 *   assemblies/<name>/parts/<part>.js
 *
 * Every path here is repo-relative, forward-slash, no leading slash.
 * Part rows in a .surf.json reference scripts by these full repo paths.
 * Local IndexedDB uses a bare id (no `local:` prefix). A load-time migration
 * strips a legacy prefix. Local→Git / Add to Repo map into this same contract.
 */
import { normalizeRepoPath } from '../assembly.js';

export const VAULT_MARKER_PATH = 'surfcad.json';
export const VAULT_README_PATH = 'README.md';
export const ASSEMBLIES_DIR = 'assemblies';
export const SHARED_PARTS_DIR = 'parts';
/** Nameless assembly metadata filename inside the assembly folder. */
export const ASSEMBLY_META_FILE = '.surf.json';
/** @deprecated use ASSEMBLY_META_FILE — kept as alias for older imports. */
export const ASSEMBLY_EXT = ASSEMBLY_META_FILE;
export const PART_EXT = '.js';
/** Mesh stored beside a part script. Not a script and not assembly metadata. */
export const ASSET_EXT = '.mesh';

/**
 * One path segment from an assembly or part name: no path or
 * Windows-illegal characters, no control characters, whitespace collapsed,
 * no leading/trailing dots, at most 60 characters. '' when nothing is left.
 */
export function vaultSegment(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 60)
    .trim();
}

function need(name, what) {
  const seg = vaultSegment(name);
  if (!seg) throw new Error(`Empty ${what} name`);
  return seg;
}

export function assemblyDir(assemblyName) {
  return `${ASSEMBLIES_DIR}/${need(assemblyName, 'assembly')}`;
}

/** Current layout: assemblies/<Name>/.surf.json */
export function assemblyFilePath(assemblyName) {
  return `${assemblyDir(assemblyName)}/${ASSEMBLY_META_FILE}`;
}

/** Legacy named metadata: assemblies/<Name>/<Name>.surf.json */
export function legacyAssemblyFilePath(assemblyName) {
  const seg = need(assemblyName, 'assembly');
  return `${ASSEMBLIES_DIR}/${seg}/${seg}.surf.json`;
}

/**
 * Candidate paths to read for an assembly (current first, then legacy).
 * Prefer the first that exists in the tree / on disk.
 */
export function assemblyFilePathCandidates(assemblyName) {
  return [assemblyFilePath(assemblyName), legacyAssemblyFilePath(assemblyName)];
}

/**
 * Assembly folder itself — parts live here next to `.surf.json`
 * (not under a nested parts/ subfolder).
 * @deprecated name kept for older call sites; equals assemblyDir.
 */
export function assemblyPartsDir(assemblyName) {
  return assemblyDir(assemblyName);
}

/** Strip a trailing `.js` so `Bracket` and `Bracket.js` name the same file. */
function partBase(partName) {
  return String(partName ?? '').replace(/\.js$/i, '');
}

/**
 * Filename stem for a vault part script: `Bracket`, then `Bracket-2`, `Bracket-3`, …
 * Uses {@link vaultSegment} rules; `ordinal` is 1 for the first name, 2+ for collisions.
 */
export function vaultPartFileStem(partName, ordinal = 1) {
  const seg = vaultSegment(partBase(partName));
  if (!seg) return '';
  const n = Number(ordinal);
  if (!Number.isInteger(n) || n < 2) return seg;
  return `${seg}-${n}`;
}

/** Current layout: assemblies/<Name>/<Part>.js */
export function assemblyPartPath(assemblyName, partName) {
  return `${assemblyDir(assemblyName)}/${need(partBase(partName), 'part')}${PART_EXT}`;
}

/** Legacy: assemblies/<Name>/parts/<Part>.js */
export function legacyAssemblyPartPath(assemblyName, partName) {
  return `${assemblyDir(assemblyName)}/${SHARED_PARTS_DIR}/${need(partBase(partName), 'part')}${PART_EXT}`;
}

export function sharedPartPath(partName) {
  return `${SHARED_PARTS_DIR}/${need(partBase(partName), 'part')}${PART_EXT}`;
}

function assetRecord(part, assembly, legacy) {
  const script = assembly
    ? (legacy
      ? `${ASSEMBLIES_DIR}/${assembly}/${SHARED_PARTS_DIR}/${part}${PART_EXT}`
      : `${ASSEMBLIES_DIR}/${assembly}/${part}${PART_EXT}`)
    : `${SHARED_PARTS_DIR}/${part}${PART_EXT}`;
  const info = { kind: 'asset', part, script };
  if (assembly) info.assembly = assembly;
  if (legacy) info.legacy = true;
  return info;
}

function isMeshLeaf(leaf) {
  return typeof leaf === 'string' && leaf.endsWith(ASSET_EXT) && leaf.length > ASSET_EXT.length;
}

/**
 * `<Part>.mesh` beside a part script.
 * Shared: `parts/<Part>.mesh`. Assembly copy: `assemblies/<Name>/<Part>.mesh`.
 * Legacy nested: `assemblies/<Name>/parts/<Part>.mesh`.
 */
export function assetPathForScript(scriptPath) {
  const info = parseVaultPath(scriptPath);
  if (!info) return null;
  if (info.kind === 'asset') return normalizeRepoPath(scriptPath);
  if (info.kind === 'shared-part') return `${SHARED_PARTS_DIR}/${info.part}${ASSET_EXT}`;
  if (info.kind === 'assembly-part' && info.legacy) {
    return `${ASSEMBLIES_DIR}/${info.assembly}/${SHARED_PARTS_DIR}/${info.part}${ASSET_EXT}`;
  }
  if (info.kind === 'assembly-part') return `${ASSEMBLIES_DIR}/${info.assembly}/${info.part}${ASSET_EXT}`;
  return null;
}

/**
 * Classify a repo path:
 *   { kind: 'marker' }
 *   { kind: 'assembly', assembly, legacy?: true }
 *   { kind: 'assembly-part', assembly, part, legacy?: true }
 *   { kind: 'shared-part', part }
 *   { kind: 'asset', part, script, assembly?, legacy?: true }
 *   { kind: 'other' }
 * null for a path normalizeRepoPath rejects.
 */
export function parseVaultPath(path) {
  const p = normalizeRepoPath(path);
  if (!p) return null;
  if (p === VAULT_MARKER_PATH) return { kind: 'marker' };
  const seg = p.split('/');
  if (seg.length === 2 && seg[0] === SHARED_PARTS_DIR && seg[1].endsWith(PART_EXT) && seg[1].length > PART_EXT.length) {
    return { kind: 'shared-part', part: seg[1].slice(0, -PART_EXT.length) };
  }
  if (seg.length === 2 && seg[0] === SHARED_PARTS_DIR && isMeshLeaf(seg[1])) {
    return assetRecord(seg[1].slice(0, -ASSET_EXT.length), null, false);
  }
  if (seg[0] === ASSEMBLIES_DIR && seg.length === 3) {
    const asm = seg[1];
    const leaf = seg[2];
    // Current: assemblies/<Name>/.surf.json
    if (leaf === ASSEMBLY_META_FILE) {
      return { kind: 'assembly', assembly: asm };
    }
    // Legacy: assemblies/<Name>/<Name>.surf.json
    if (leaf === `${asm}.surf.json`) {
      return { kind: 'assembly', assembly: asm, legacy: true };
    }
    // Current parts: assemblies/<Name>/<Part>.js (not the meta file)
    if (leaf.endsWith(PART_EXT) && leaf.length > PART_EXT.length && leaf !== ASSEMBLY_META_FILE) {
      return { kind: 'assembly-part', assembly: asm, part: leaf.slice(0, -PART_EXT.length) };
    }
    if (isMeshLeaf(leaf)) {
      return assetRecord(leaf.slice(0, -ASSET_EXT.length), asm, false);
    }
  }
  // Legacy parts: assemblies/<Name>/parts/<Part>.js
  if (seg[0] === ASSEMBLIES_DIR && seg.length === 4 && seg[2] === SHARED_PARTS_DIR
    && seg[3].endsWith(PART_EXT) && seg[3].length > PART_EXT.length) {
    return { kind: 'assembly-part', assembly: seg[1], part: seg[3].slice(0, -PART_EXT.length), legacy: true };
  }
  // Legacy mesh beside a nested part: assemblies/<Name>/parts/<Part>.mesh
  if (seg[0] === ASSEMBLIES_DIR && seg.length === 4 && seg[2] === SHARED_PARTS_DIR && isMeshLeaf(seg[3])) {
    return assetRecord(seg[3].slice(0, -ASSET_EXT.length), seg[1], true);
  }
  return { kind: 'other' };
}

export function isAssemblyFile(path) {
  return parseVaultPath(path)?.kind === 'assembly';
}

export function isPartScript(path) {
  const k = parseVaultPath(path)?.kind;
  return k === 'assembly-part' || k === 'shared-part';
}

/**
 * May a *new* part be created at `path` for this assembly? Own folder
 * (current or legacy) and shared `parts/` only. Another assembly's file is
 * not a create target — Open Part links it instead.
 */
export function partPathAllowedFor(assemblyName, path) {
  const info = parseVaultPath(path);
  if (!info) return false;
  if (info.kind === 'shared-part') return true;
  return info.kind === 'assembly-part' && info.assembly === vaultSegment(assemblyName);
}

/** True for any vault part script (own, legacy, shared, or another assembly). */
export function isVaultPartPath(path) {
  const info = parseVaultPath(path);
  return info?.kind === 'assembly-part' || info?.kind === 'shared-part';
}

/**
 * Referenced file lives in another assembly's folder. `parts/` is the
 * normal home and is not external. The row shows the external caution
 * until the user copies that file into this assembly.
 */
export function isExternalPartPath(assemblyName, path) {
  const info = parseVaultPath(path);
  if (!info) return false;
  return info.kind === 'assembly-part' && info.assembly !== vaultSegment(assemblyName);
}

/**
 * Remap a part path onto the current (non-legacy) layout for `assemblyName`.
 * Shared paths stay. Returns null when the path is not allowed for this assembly.
 */
export function canonicalPartPath(assemblyName, path) {
  const info = parseVaultPath(path);
  if (!info) return null;
  if (info.kind === 'shared-part') return sharedPartPath(info.part);
  if (info.kind === 'assembly-part' && info.assembly === vaultSegment(assemblyName)) {
    return assemblyPartPath(assemblyName, info.part);
  }
  return null;
}

/**
 * Remap an in-app git document's part ids from legacy nested paths onto the
 * current flat assembly-folder layout. Shared paths stay.
 * -> { doc, scripts, moved: [{ from, to }], changed }
 */
export function migrateDocToCurrentLayout(doc, scripts = {}) {
  const name = vaultSegment(doc?.name);
  const moved = [];
  const nextScripts = {};
  const nextParts = [];
  for (const part of doc?.parts || []) {
    const from = part.id;
    const to = canonicalPartPath(name, from) || from;
    if (to !== from) moved.push({ from, to });
    nextParts.push({ ...part, id: to });
    const text = scripts?.[from];
    nextScripts[to] = typeof text === 'string' ? text : (scripts?.[to] ?? '');
  }
  let activeId = doc?.activeId;
  const hit = moved.find((m) => m.from === activeId);
  if (hit) activeId = hit.to;
  return {
    doc: { ...doc, parts: nextParts, activeId },
    scripts: nextScripts,
    moved,
    changed: moved.length > 0,
  };
}

/**
 * Legacy blob paths under an assembly folder that should be deleted when
 * rewriting to the current layout (named .surf.json + nested parts/).
 */
export function legacyCleanupPaths(assemblyName, tree) {
  const name = vaultSegment(assemblyName);
  if (!name) return [];
  const out = [];
  const legacyMeta = legacyAssemblyFilePath(name);
  const nestedPrefix = `${assemblyDir(name)}/${SHARED_PARTS_DIR}/`;
  for (const entry of tree || []) {
    const path = entry?.path ?? entry;
    if (path === legacyMeta) out.push(path);
    else if (typeof path === 'string' && path.startsWith(nestedPrefix)
      && (path.endsWith(PART_EXT) || path.endsWith(ASSET_EXT))) {
      out.push(path);
    }
  }
  return [...new Set(out)].sort();
}

/** Assembly names found in a listTree() result, sorted. */
export function listAssemblies(tree) {
  const out = [];
  for (const entry of tree || []) {
    const info = parseVaultPath(entry?.path ?? entry);
    if (info?.kind === 'assembly') out.push(info.assembly);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

/** Part script paths in a listTree() result: { shared: [], byAssembly: { A: [] } }. */
export function listPartScripts(tree) {
  const shared = [];
  const byAssembly = {};
  for (const entry of tree || []) {
    const path = entry?.path ?? entry;
    const info = parseVaultPath(path);
    if (info?.kind === 'shared-part') shared.push(path);
    else if (info?.kind === 'assembly-part') (byAssembly[info.assembly] ||= []).push(path);
  }
  shared.sort();
  for (const k of Object.keys(byAssembly)) byAssembly[k].sort();
  return { shared, byAssembly };
}
