/**
 * G2: open / save in Git mode (working copy).
 *
 * IndexedDB remains the intermittent autosave. Opening a vault assembly
 * loads `.surf.json` + every part script by path into that working copy and
 * captures a baseline. Dirty = working copy differs from that baseline.
 * Commit (G3) is the only write back to git; this module never commits.
 */
import {
  DEFAULT_ASSEMBLY_NAME,
  DEFAULT_PART_NAME,
  nextAssemblyName,
  normalizeRepoPath,
  numberedName,
  sanitizeAssemblyName,
  sanitizePartName,
  serializeAssembly,
} from '../assembly.js';
import { gitBlobSha, isBinaryContent, toUint8Array } from './binaryContent.js';
import { assertGithubAdapter } from './githubAdapterInterface.js';
import {
  assemblyFilePath,
  assetPathForScript,
  isExternalPartPath,
  listAssemblies,
  listPartScripts,
  partPathAllowedFor,
  sharedPartPath,
  vaultSegment,
} from './vaultLayout.js';
import { allocateVaultPartPath } from './partVaultPath.js';
import { partRepoPath, partScriptText } from './partIdentity.js';
export {
  allocateVaultPartPath,
  ensureAssemblyVaultPaths,
  occupancySet,
  occupyVaultPath,
  partRowNeedsVaultPath,
  partRowVaultPathOk,
  pathOccupied,
  planRenameVaultPartPath,
  promoteStrayPartsToAssemblyFolder,
  resolveNewPartPath,
} from './partVaultPath.js';
export {
  assignVaultPartIdentities,
  findAssemblyPart,
  isStablePartId,
  partRepoPath,
  rekeyWorkingCopyToTip,
} from './partIdentity.js';
import { stringifySurfJson } from './surfJson.js';
import { mintSurfId, partSurfId, readSurfId, stripSurfId, withSurfId } from './surfId.js';
import {
  detectVaultLayout,
  listLegacyAssemblies,
  openLegacyAssembly,
  UnsupportedVaultLayoutError,
} from './legacyVault/index.js';
import { captureBaseline, captureBaselineFromTip, remapTipDocThroughPairs } from './gitBaseline.js';
export { captureBaseline, captureBaselineFromTip, remapTipDocThroughPairs };

function assemblyTextIgnoringActive(text) {
  const obj = JSON.parse(text);
  obj.activeId = null;
  return JSON.stringify(obj);
}

/**
 * True when rows / order / name / joints / colors changed.
 * Which part is open (`activeId` in `.surf.json`) is view state — switching
 * parts after a clean reload must not badge the assembly.
 */
export function isAssemblyDirty(doc, baseline) {
  if (!baseline) return false;
  try {
    const text = stringifySurfJson({ ...doc, source: 'git' }, { validate: false });
    if (text === baseline.assemblyText) return false;
    return assemblyTextIgnoringActive(text) !== assemblyTextIgnoringActive(baseline.assemblyText);
  } catch {
    return true;
  }
}

/**
 * Live editor text folded into git dirty checks.
 *
 * App's `currentScript` starts as `''`. After reload, part history already
 * has the boot script, so Monaco's seed skips `onExecute` and never replaces
 * that empty string. Passing it as `liveScript` marks the active part dirty
 * even when the editor buffer matches git. Only fold the live buffer in after
 * the editor has reported a real one.
 */
export function gitDirtyLiveScript({
  source = null,
  activeId = null,
  highlightId = null,
  editorLive = false,
  script = null,
} = {}) {
  if (source !== 'git') return null;
  if (editorLive !== true) return null;
  if (activeId == null || highlightId == null) return null;
  if (String(activeId) !== String(highlightId)) return null;
  if (typeof script !== 'string') return null;
  return script;
}

/** True when one part's script differs from the baseline (missing = dirty). */
export function isPartDirty(path, script, baseline) {
  if (!baseline) return false;
  const id = String(path || '');
  if (!id) return false;
  const had = Object.prototype.hasOwnProperty.call(baseline.scripts, id);
  if (!had) return true; // added since open
  const base = baseline.scripts[id] ?? '';
  return String(script ?? '') !== base;
}

/**
 * Part ids that are dirty: script change, newly added, or removed from the
 * working document (removed ids are returned too so the UI can warn).
 */
export function dirtyPartIds(doc, scripts, baseline, { liveId = null, liveScript = null, assets = null } = {}) {
  const out = new Set();
  if (!baseline) return out;
  const parts = doc?.parts || [];
  const seen = new Set();
  for (const part of parts) {
    const id = part.id;
    seen.add(id);
    let text = partScriptText(part, scripts);
    if (liveId && (id === liveId || partRepoPath(part) === liveId) && typeof liveScript === 'string') {
      text = liveScript;
    }
    if (isPartDirty(id, text, baseline)) out.add(id);
  }
  for (const id of baseline.partIds || []) {
    if (!seen.has(id)) out.add(id);
  }
  if (assets) {
    for (const part of parts) {
      if (isAssetDirty(partRepoPath(part) || part.id, assets, baseline)) out.add(part.id);
    }
  }
  return out;
}

function isAssetDirty(scriptPath, assets, baseline) {
  const mesh = assetPathForScript(scriptPath);
  if (!mesh || !assets) return false;
  const hasMesh = Object.prototype.hasOwnProperty.call(assets, mesh);
  const hasScript = Object.prototype.hasOwnProperty.call(assets, scriptPath);
  if (!hasMesh && !hasScript) return false;
  const value = hasMesh ? assets[mesh] : assets[scriptPath];
  const prev = baseline?.assets?.[mesh] || null;
  if (value == null) return !!prev;
  if (!isBinaryContent(value)) return false;
  return gitBlobSha(toUint8Array(value)) !== prev;
}

/**
 * Assembly and/or any part dirty (or awaiting legacy-layout rewrite).
 * `renamePending` is an assembly rename that is queued but not on the tip
 * yet: the name already matches the working copy, and the yellow dot stays
 * until that commit lands.
 */
export function isWorkspaceDirty(doc, scripts, baseline, opts) {
  if (!baseline) return false;
  if (baseline.legacyCleanup) return true;
  if (baseline.renamePending) return true;
  if (isAssemblyDirty(doc, baseline)) return true;
  return dirtyPartIds(doc, scripts, baseline, opts).size > 0;
}

/** Assembly names in the vault on `ref` (default branch). */
export async function listVaultAssemblies(adapter, repo, ref) {
  assertGithubAdapter(adapter);
  const detected = await detectVaultLayout(adapter, repo, ref || 'main');
  if (detected.layout === 'legacy') {
    return listLegacyAssemblies(adapter, repo, ref);
  }
  throw new UnsupportedVaultLayoutError(detected.layout);
}

/**
 * Folder names a new assembly write must not reuse.
 * `tree` is a listTree() result (repo folders). `local` is the open
 * document, a baseline, or names opened this session. `except` is this
 * assembly's own folder (a rename) and is not a collision.
 * Comparison is case-insensitive. Saved documents are not renamed here.
 */
export function takenAssemblyNames({ tree = [], local = [], except = '' } = {}) {
  const skip = vaultSegment(except).toLowerCase();
  const seen = new Set();
  const out = [];
  const add = (name) => {
    const seg = vaultSegment(name);
    if (!seg) return;
    const key = seg.toLowerCase();
    if (skip && key === skip) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(seg);
  };
  for (const name of listAssemblies(tree || [])) add(name);
  for (const name of local || []) add(name);
  return out;
}

/**
 * Folder to store for a rename. A free name is kept. A collision becomes
 * `Name (2)`, `Name (3)`, … (`nextAssemblyName`, the part rename rule).
 * When that folder is still taken (a 60-character segment ate the suffix),
 * `{ ok: false }` so the caller blocks, the same way a part path collision
 * blocks. The assembly's own folder (`except`) is not a collision.
 */
export function resolveAssemblyFolderName(requested, taken, { except = '' } = {}) {
  const clean = sanitizeAssemblyName(requested);
  if (!clean) return { ok: false, reason: 'blank' };
  const self = vaultSegment(except);
  const seg = vaultSegment(clean);
  if (!seg) return { ok: false, reason: 'blank' };
  if (self && seg.toLowerCase() === self.toLowerCase()) {
    return { ok: true, name: self, unchanged: true };
  }
  const others = takenAssemblyNames({ local: taken, except });
  const collides = (name) => others.some((item) => item.toLowerCase() === String(name || '').toLowerCase());
  let name = seg;
  if (collides(name)) {
    name = vaultSegment(nextAssemblyName(others, { preferred: seg })) || '';
  }
  if (!name || collides(name)) return { ok: false, reason: 'taken', name: name || seg };
  return { ok: true, name, numbered: name.toLowerCase() !== seg.toLowerCase() };
}

/**
 * Empty git working copy for a branch tip that has no `.surf.json` yet.
 * Used when switching onto a new branch before the default Assembly is
 * committed — avoids hard-erroring on assemblies/Assembly/.surf.json.
 * -> { doc, scripts, assemblyPath, baseline, seeded: true }
 */
export function seedEmptyVaultAssembly(assemblyName, {
  branch = 'main',
  headSha = null,
} = {}) {
  const name = vaultSegment(assemblyName) || DEFAULT_ASSEMBLY_NAME;
  const partId = sharedPartPath(DEFAULT_PART_NAME);
  const doc = serializeAssembly({
    source: 'git',
    name,
    activeId: partId,
    parts: [{ id: partId, name: DEFAULT_PART_NAME, visible: true, order: 0 }],
  });
  const scripts = { [partId]: '' };
  const assemblyPath = assemblyFilePath(name);
  const baseline = captureBaseline({
    assemblyPath,
    assemblyName: name,
    doc,
    scripts,
    branch,
    headSha,
  });
  return { doc, scripts, assemblyPath, baseline, seeded: true };
}

/**
 * Open one vault assembly. v1 trees go through the isolated legacy reader
 * (missing blob → `missing` row, never ''). v2 open is not in this PR.
 */
export async function openVaultAssembly(adapter, repo, assemblyName, opts = {}) {
  assertGithubAdapter(adapter);
  const branch = opts.branch || 'main';
  const detected = await detectVaultLayout(adapter, repo, branch);
  if (detected.layout === 'legacy') {
    return openLegacyAssembly(adapter, repo, assemblyName, opts);
  }
  throw new UnsupportedVaultLayoutError(detected.layout);
}

/** Suggest `parts/Part (n).js` for the next empty slot. */
export function suggestNewPartPath(assemblyName, existingParts = [], takenPaths = null) {
  const used = new Set(
    takenPaths
      || (existingParts || []).map((part) => (
        typeof part === 'string' ? part : (partRepoPath(part) || part?.id)
      )),
  );
  for (let n = 1; n < 1000; n += 1) {
    const path = allocateVaultPartPath(assemblyName, numberedName('Part', n), [...used], {
      layout: 'assembly-folder',
    });
    if (path && !used.has(path)) return path;
  }
  return allocateVaultPartPath(assemblyName, numberedName('Part', Date.now()), [...used], {
    layout: 'assembly-folder',
  });
}

/**
 * Vault part scripts the assembly may add: this assembly's folder plus
 * shared parts/, minus paths already in the document.
 * -> [{ path, kind: 'assembly-part'|'shared-part', label }]
 */
export async function listAddableVaultParts(adapter, repo, assemblyName, {
  branch = 'main',
  existingIds = [],
} = {}) {
  assertGithubAdapter(adapter);
  const name = vaultSegment(assemblyName);
  const tree = await adapter.listTree(repo, branch);
  const { shared, byAssembly } = listPartScripts(tree);
  const have = new Set(
    (existingIds || []).flatMap((item) => {
      if (typeof item === 'string') return [item];
      const path = partRepoPath(item);
      return [item?.id, item?.path, path].filter(Boolean);
    }),
  );
  const out = [];
  for (const path of byAssembly[name] || []) {
    if (have.has(path)) continue;
    out.push({ path, kind: 'assembly-part', label: path.split('/').pop() });
  }
  for (const path of shared) {
    if (have.has(path)) continue;
    out.push({ path, kind: 'shared-part', label: path });
  }
  return out;
}

/** Read one part script from the vault, or null when missing. */
export async function readVaultPart(adapter, repo, path, ref = 'main') {
  assertGithubAdapter(adapter);
  const id = normalizeRepoPath(path);
  if (!id) return null;
  const file = await adapter.readFile(repo, id, ref);
  return file ? { path: id, content: file.content } : null;
}

/**
 * G11: browse vault for Open — assemblies and part scripts on `ref`.
 * -> { assemblies: [{ kind:'assembly', name, label }], parts: [{ kind:'part', path, label, scope }] }
 */
export async function listVaultBrowseItems(adapter, repo, ref) {
  assertGithubAdapter(adapter);
  const tree = await adapter.listTree(repo, ref);
  const assemblies = listAssemblies(tree).map((name) => ({
    kind: 'assembly',
    name,
    label: name,
  }));
  const { shared, byAssembly } = listPartScripts(tree);
  const parts = [];
  for (const path of shared) {
    parts.push({
      kind: 'part',
      path,
      label: path.split('/').pop() || path,
      scope: 'shared',
    });
  }
  for (const [asm, paths] of Object.entries(byAssembly)) {
    for (const path of paths) {
      parts.push({
        kind: 'part',
        path,
        label: path.split('/').pop() || path,
        scope: asm,
      });
    }
  }
  parts.sort((a, b) => a.path.localeCompare(b.path));
  return { assemblies, parts };
}

/** Group heading for parts in the shared `parts/` folder (no assembly). */
export const LOOSE_PARTS_LABEL = 'Loose parts';

/** Fields a live Open search matches. Shared `parts/` also match "loose". */
function vaultPartSearchHay(item) {
  return [
    item?.path, item?.label, item?.name, item?.kind, item?.scope, item?.source,
    item?.scope === 'shared' || item?.source === LOOSE_PARTS_LABEL ? LOOSE_PARTS_LABEL : '',
  ];
}

/**
 * Client-side live filter for the git Open pane index (assemblies + parts).
 * Empty / whitespace query returns the full index. Matching is case-insensitive
 * substring on assembly name/label and part path/label/name/scope/source
 * (including the "Loose parts" heading) — no network.
 * Open Part passes already-grouped rows; Open Assembly passes assemblies only.
 */
export function filterVaultOpenIndex(index, query) {
  const assemblies = Array.isArray(index?.assemblies) ? index.assemblies : [];
  const parts = Array.isArray(index?.parts) ? index.parts : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { assemblies, parts };
  const hit = (...vals) => vals.some((v) => String(v || '').toLowerCase().includes(q));
  return {
    assemblies: assemblies.filter((item) => {
      if (typeof item === 'string') return hit(item);
      return hit(item?.name, item?.label);
    }),
    parts: parts.filter((item) => hit(...vaultPartSearchHay(item))),
  };
}

/**
 * Same live filter for a bare part array (Open Part rows). Matches path,
 * label, kind, source assembly (`scope`) and its display label (`source`).
 */
export function filterVaultPartItems(items, query) {
  const list = Array.isArray(items) ? items : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((item) => (
    vaultPartSearchHay(item).some((v) => String(v || '').toLowerCase().includes(q))
  ));
}

/**
 * Open Part rows: every part script in the repo (every assembly's folder,
 * legacy nested paths included, plus loose `parts/`). Each row carries
 * `name` (file name without `.js`), `source` (assembly name or
 * LOOSE_PARTS_LABEL), `inDoc` (already in the open document), `foreign`
 * (belongs to another assembly: opening links it; it is not copied) and
 * `sameName` (another part in the repo has the same name).
 */
export function vaultOpenPartRows(parts, { currentAssembly = '', inDoc = [] } = {}) {
  const list = Array.isArray(parts) ? parts : [];
  const cur = vaultSegment(currentAssembly || '') || String(currentAssembly || '');
  const have = new Set(inDoc || []);
  const counts = new Map();
  const rows = list.map((item) => {
    const name = String(item?.label || item?.path || '').replace(/\.js$/i, '');
    counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) || 0) + 1);
    const loose = item?.scope === 'shared';
    return {
      ...item,
      name,
      source: loose ? LOOSE_PARTS_LABEL : String(item?.scope || ''),
      inDoc: have.has(item?.path),
      foreign: !loose && !!cur && item?.scope !== cur,
    };
  });
  for (const row of rows) row.sameName = (counts.get(row.name.toLowerCase()) || 0) > 1;
  return rows;
}

/**
 * Group Open Part rows by source: the current assembly, other assemblies
 * A→Z, then loose parts. -> [{ key, label, current, loose, parts }]
 */
export function groupVaultOpenPartRows(rows, { currentAssembly = '' } = {}) {
  const cur = vaultSegment(currentAssembly || '') || String(currentAssembly || '');
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const loose = row.scope === 'shared';
    const key = loose ? '\u0000loose' : `asm:${row.scope}`;
    if (!groups.has(key)) {
      groups.set(key, { key, label: row.source, current: !loose && row.scope === cur, loose, parts: [] });
    }
    groups.get(key).parts.push(row);
  }
  const out = [...groups.values()];
  for (const g of out) g.parts.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const rank = (g) => (g.current ? 0 : g.loose ? 2 : 1);
  out.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  return out;
}

/** Open Part index, grouped (rows + groups in one call). */
export function groupVaultOpenParts(parts, opts = {}) {
  return groupVaultOpenPartRows(vaultOpenPartRows(parts, opts), opts);
}

/**
 * Open Part into the current assembly. Every vault part joins by reference
 * (same path, same surf id). A part that lives in another assembly's folder
 * is a linked external reference — it is not copied. `parts/` is not
 * external. Copy is explicit (`planCopyToAssembly`).
 * -> { id, mode: 'focus' | 'reference' | 'link' }
 */
export function planOpenVaultPart(doc, path, content, scripts = {}) {
  void content;
  void scripts;
  const from = normalizeRepoPath(path);
  if (!from) throw new Error('Bad part path');
  const have = new Set((doc?.parts || []).map((p) => p.id));
  if (have.has(from)) return { id: from, mode: 'focus' };
  if (isExternalPartPath(doc?.name, from)) return { id: from, mode: 'link' };
  return { id: from, mode: 'reference' };
}

/**
 * Copy an external (or any) part into this assembly.
 * New surf id, `copiedFrom` records the source id, the reference repoints
 * at the new row. The repo path is assigned on Save (`ensureAssemblyVaultPaths`),
 * not here. The source file is left in place. Colors stay keyed by surf id
 * on the assembly, so this new id starts uncolored. The old key is dropped
 * on save because that surf id left the document.
 * -> { fromPath, path, id, surfId, copiedFrom, content, name, isSynced }
 */
export function planCopyToAssembly(doc, part, script, { now, rand } = {}) {
  const asm = vaultSegment(doc?.name);
  if (!asm) throw new Error('Empty assembly name');
  const surfId = mintSurfId({ now, rand });
  const sourceId = partSurfId(part) || readSurfId(script);
  const content = withSurfId(stripSurfId(script || ''), surfId);
  const name = sanitizePartName(part?.name || DEFAULT_PART_NAME) || DEFAULT_PART_NAME;
  return {
    fromPath: partRepoPath(part) || part?.id || null,
    path: null,
    id: surfId,
    surfId,
    copiedFrom: sourceId || null,
    content,
    name,
    isSynced: false,
  };
}

/** Open Assembly index: assemblies only (parts are Open Part's list). */
export function vaultOpenAssemblies(browse) {
  const list = Array.isArray(browse?.assemblies) ? browse.assemblies : [];
  return list.map((item) => (typeof item === 'string' ? { kind: 'assembly', name: item, label: item } : item));
}

/**
 * Insert another assembly's parts into the current document as links.
 * Shared paths, this assembly's paths, and other assemblies' paths all keep
 * their repo path (no silent copy). A path already in the document is skipped.
 * -> { additions: [{ id, name, content, fromPath, linked }] }
 */
export async function planInsertVaultAssemblyParts(adapter, repo, sourceAssembly, targetDoc, {
  branch = 'main',
} = {}) {
  assertGithubAdapter(adapter);
  const source = vaultSegment(sourceAssembly);
  const target = vaultSegment(targetDoc?.name);
  if (!source) throw new Error('Empty source assembly');
  if (!target) throw new Error('Empty target assembly');
  const opened = await openVaultAssembly(adapter, repo, source, { branch });
  const existing = new Set((targetDoc.parts || []).map((p) => partRepoPath(p) || p.id));
  const taken = new Set(existing);
  const additions = [];
  for (const part of opened.doc.parts || []) {
    const fromPath = partRepoPath(part) || part.id;
    const missing = part.missing === true;
    const content = missing ? null : (partScriptText(part, opened.scripts) ?? null);
    if (taken.has(fromPath)) continue;
    taken.add(fromPath);
    additions.push({
      id: part.id,
      name: part.name || fromPath.split('/').pop()?.replace(/\.js$/i, '') || fromPath,
      content,
      fromPath,
      surfId: partSurfId(part) || (typeof content === 'string' ? readSurfId(content) : null) || null,
      missing,
      linked: isExternalPartPath(target, fromPath) || !partPathAllowedFor(target, fromPath),
    });
  }
  return {
    additions,
    sourceName: source,
    sourcePath: assemblyFilePath(source),
    scripts: opened.scripts,
  };
}
