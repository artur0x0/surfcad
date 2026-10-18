/**
 * G3: Commit / push in Git mode.
 *
 * `assembleCommitFiles` builds the changed part scripts plus the assembly
 * `.surf.json` for one commit. The Parts Save button enqueues that list;
 * the sync worker is the only writer. `commitWorkspace` remains for callers
 * that already hold a matching baseline (move-to-git follow-ups, goldens):
 * it commits with `baseSha` and, on `non_fast_forward`, returns `conflict`
 * without writing. It does not open a side branch. `forceMergeCommit` is
 * the explicit Overwrite main write: the same files land on the current tip.
 *
 * When the assembly was renamed, the same commit moves the `.surf.json`
 * and assembly-owned parts to the new folder (deletes the old paths);
 * shared `parts/…` stay. Orphan blobs under the old assembly folder are
 * cleared via listTree.
 *
 * Mock adapter only for now; nothing here talks to the network.
 */
import { assemblyName, nextAssemblyName, renamePart, serializeAssembly } from '../assembly.js';
import { gitBlobSha, isBinaryContent, toUint8Array } from './binaryContent.js';
import { GitAdapterError, assertGithubAdapter, fileWrite, fileDelete } from './githubAdapterInterface.js';
import { captureBaseline, dirtyPartIds } from './gitWorkspace.js';
import { applyPartPathChange, rewriteSurfText } from './gitRename.js';
import {
  ensureAssemblyVaultPaths,
  partRowNeedsVaultPath,
  planRenameVaultPartPath,
} from './partVaultPath.js';
import {
  findAssemblyPart,
  isStablePartId,
  partKeepsStableId,
  partRepoPath,
  partRowVaultPathOk,
  partScriptText,
  occupancyPathsFromParts,
} from './partIdentity.js';
import {
  ASSEMBLIES_DIR,
  assemblyFilePath,
  assemblyPartPath,
  assetPathForScript,
  legacyCleanupPaths,
  parseVaultPath,
  vaultSegment,
} from './vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from './surfJson.js';
import { isSurfId, partSurfId, readSurfId, stampPartHeaders } from './surfId.js';

/** Missing rows never become an empty git blob. */
function partFileContent(part, text) {
  if (part?.missing === true && !(typeof text === 'string' && text.length > 0)) {
    return null;
  }
  return typeof text === 'string' ? text : '';
}

export const COMMIT_BRANCH_PREFIX = 'surfcad/';

/** Commit refused: working copy has parts without a vault path. */
export const NO_REPO_PATH = 'no_repo_path';

/** Save aborted: the vault tree could not be listed, so occupancy is unknown. */
export const VAULT_TREE_UNAVAILABLE = 'vault_tree_unavailable';
export const VAULT_TREE_UNAVAILABLE_MESSAGE = 'Could not list the vault tree. Save aborted so existing files are not overwritten.';

function treeUnavailableError(cause) {
  const err = new Error(VAULT_TREE_UNAVAILABLE_MESSAGE);
  err.code = VAULT_TREE_UNAVAILABLE;
  if (cause) err.cause = cause;
  return err;
}

/** listTree, or VAULT_TREE_UNAVAILABLE. Never treat a failed listing as empty occupancy. */
export async function listVaultTree(adapter, repo, ref, opts = {}) {
  let tree;
  try {
    tree = await adapter.listTree(repo, ref, opts);
  } catch (err) {
    throw treeUnavailableError(err);
  }
  if (!Array.isArray(tree)) throw treeUnavailableError();
  return tree;
}

export async function listVaultTreePaths(adapter, repo, ref) {
  const tree = await listVaultTree(adapter, repo, ref);
  return tree.map((entry) => entry?.path ?? entry).filter((path) => typeof path === 'string');
}

/** Writer refused: a part still has no vault path after promotion. */
export const PATH_LESS_PARTS = 'path_less_parts';
export const PATH_LESS_PARTS_MESSAGE = 'Assembly has parts without a vault path. Write aborted so the working copy is unchanged.';

function pathLessError(leftovers) {
  const err = new Error(PATH_LESS_PARTS_MESSAGE);
  err.code = PATH_LESS_PARTS;
  err.parts = (leftovers || []).map((part) => part?.id).filter(Boolean);
  return err;
}

/**
 * Promote path-less rows (assembly-folder, Name-2 on collision) and stringify
 * the assembly for a git write. Lists occupancy only when a row still needs
 * a vault path, so paint/group stay fast when every id is already a path.
 * Leftover invalid ids throw path_less_parts. Callers must not mutate the
 * working copy until this returns.
 * -> { status:'ready', doc, scripts, files, moved, assemblyPath, assemblyText }
 */
export async function prepareAssemblySurfWrite(adapter, repo, {
  doc,
  scripts = {},
  branch = 'main',
  extraFiles = [],
  remotePaths = null,
} = {}) {
  assertGithubAdapter(adapter);
  if (!doc || doc.source !== 'git') {
    throw new Error('Not in Git mode');
  }
  let workDoc = { ...doc, source: 'git' };
  let workScripts = { ...(scripts || {}) };
  let moved = [];
  const needs = (workDoc.parts || []).filter(partRowNeedsVaultPath);
  if (needs.length) {
    const occupancy = Array.isArray(remotePaths)
      ? remotePaths
      : await listVaultTreePaths(adapter, repo, branch);
    const promoted = ensureAssemblyVaultPaths(workDoc, workScripts, { remotePaths: occupancy });
    workDoc = { ...promoted.doc, source: 'git' };
    workScripts = promoted.scripts;
    moved = promoted.moved || [];
  }
  const leftovers = (workDoc.parts || []).filter(partRowNeedsVaultPath);
  if (leftovers.length) throw pathLessError(leftovers);

  const assemblyText = stringifySurfJson(workDoc);
  const assemblyPath = assemblyFilePath(vaultSegment(workDoc.name) || workDoc.name);
    const files = [
    ...moved.map((move) => {
      const part = (workDoc.parts || []).find((row) => row.id === move.id || row.id === move.from);
      const text = workScripts[move.id] ?? workScripts[move.from] ?? workScripts[move.to];
      const body = partFileContent(part, text);
      if (body == null) return null;
      return fileWrite(move.to, body);
    }).filter(Boolean),
    ...(extraFiles || []),
    fileWrite(assemblyPath, assemblyText),
  ];
  return {
    status: 'ready',
    doc: workDoc,
    scripts: workScripts,
    files,
    moved,
    assemblyPath,
    assemblyText,
  };
}

/**
 * Occupancy listing + path plan for a vault part rename. Always lists the
 * tree (never falls back to document ids). On a listTree failure returns
 * VAULT_TREE_UNAVAILABLE and does not produce a working-copy mutation.
 * planRenameVaultPartPath only — no planPartPath fallback.
 *
 * Mutates only that part's path and name in the working copy. Does not
 * stringify the live assembly or promote path-less siblings: those stay
 * for Save. The rename commit is built later from the tip tree.
 */
export async function prepareVaultPartRename(adapter, repo, {
  doc,
  scripts = {},
  from,
  nextName,
  branch = 'main',
} = {}) {
  assertGithubAdapter(adapter);
  if (!doc || doc.source !== 'git') {
    return { status: 'error', error: 'Not in Git mode' };
  }
  let remotePaths;
  try {
    remotePaths = await listVaultTreePaths(adapter, repo, branch);
  } catch (err) {
    return {
      status: 'error',
      error: err?.message || VAULT_TREE_UNAVAILABLE_MESSAGE,
      code: err?.code || VAULT_TREE_UNAVAILABLE,
    };
  }
  const fromPart = findAssemblyPart(doc, from);
  const fromPath = partRepoPath(fromPart) || from;
  const to = planRenameVaultPartPath(fromPath, nextName, [
    ...occupancyPathsFromParts(doc.parts),
    ...remotePaths,
  ]);
  if (!to) {
    return { status: 'error', code: 'bad_args', error: 'Could not plan a vault path for this rename' };
  }
  const workScripts = { ...(scripts || {}) };
  const movedLocal = to === fromPath
    ? { doc: renamePart(doc, fromPart?.id || from, nextName), scripts: workScripts }
    : applyPartPathChange(doc, workScripts, from, to, nextName);
  const nextDoc = serializeAssembly({ ...movedLocal.doc, source: 'git' });
  const leaf = to.split('/').pop()?.replace(/\.js$/i, '') || nextName;
  return {
    status: 'ready',
    from: fromPath,
    fromId: fromPart?.id || from,
    to,
    name: leaf,
    doc: nextDoc,
    scripts: movedLocal.scripts,
  };
}

/** True when a part rename should enqueue a git commit (vault file exists). */
export function partRenameNeedsCommit({ doc, part, repo } = {}) {
  if (!doc || doc.source !== 'git') return false;
  if (!repo?.owner || !repo?.name) return false;
  if (!part || partRowNeedsVaultPath(part)) return false;
  return true;
}

/**
 * Baseline after a part rename commit: `.surf.json` is the previous tip with
 * only that part's path and name rewritten. Script baselines stay at the tip
 * bytes (not the live buffer), so a pending edit and placement stay dirty.
 */
export function baselineAfterPartRename(baseline, {
  from = null,
  to = null,
  name = null,
  surfId = null,
  headSha = null,
  branch = null,
} = {}) {
  if (!baseline) return baseline;
  const next = {
    ...baseline,
    headSha: headSha || baseline.headSha,
    branch: branch || baseline.branch,
  };
  if (typeof baseline.assemblyText === 'string' && (from || surfId)) {
    next.assemblyText = rewriteSurfText(baseline.assemblyText, {
      surfId,
      from,
      to,
      name,
    });
  }
  const fromMesh = from ? assetPathForScript(from) : null;
  const toMesh = to ? assetPathForScript(to) : null;
  if (
    fromMesh && toMesh && fromMesh !== toMesh
    && baseline.assets
    && Object.prototype.hasOwnProperty.call(baseline.assets, fromMesh)
  ) {
    const assets = { ...baseline.assets };
    assets[toMesh] = assets[fromMesh];
    delete assets[fromMesh];
    next.assets = assets;
  }
  return next;
}

/**
 * Shared UI / agent path: plan the vault move and the outbox payload.
 * The payload has no live script and no live `.surf.json` — flush reads the
 * tip tree. Path-less parts return `local` (no commit).
 */
export async function stagePartRename({
  adapter = null,
  repo = null,
  doc,
  scripts = {},
  from,
  nextName,
  branch = 'main',
} = {}) {
  const fromPart = findAssemblyPart(doc, from);
  if (!fromPart) {
    return { status: 'error', code: 'unknown_part', error: `Unknown part id: ${from}` };
  }
  if (!partRenameNeedsCommit({ doc, part: fromPart, repo })) {
    return {
      status: 'local',
      commit: false,
      fromId: fromPart.id,
      name: nextName,
      doc,
      scripts,
    };
  }
  if (!adapter) {
    return { status: 'error', error: 'Git adapter required to rename a vault part' };
  }
  const prepared = await prepareVaultPartRename(adapter, repo, {
    doc,
    scripts,
    from,
    nextName,
    branch,
  });
  if (prepared.status === 'error') return prepared;
  const surfId = partSurfId(fromPart) || (isStablePartId(fromPart.id) ? fromPart.id : null);
  const payload = {
    kind: 'part',
    surfId,
    from: prepared.from,
    to: prepared.to,
    name: prepared.name,
    label: prepared.name,
    partId: prepared.fromId,
    before: { doc, scripts },
  };
  return {
    status: 'staged',
    commit: true,
    from: prepared.from,
    fromId: prepared.fromId,
    to: prepared.to,
    name: prepared.name,
    doc: prepared.doc,
    scripts: prepared.scripts,
    payload,
    enqueue: {
      op: 'rename',
      message: `Rename ${fromPart.name} to ${prepared.name}`,
      partIds: [prepared.fromId],
      payload,
    },
  };
}

/** Scripts with the live editor text folded in for the active part. */
export function effectiveScripts(scripts, { liveId = null, liveScript = null } = {}) {
  const out = { ...(scripts || {}) };
  if (liveId && typeof liveScript === 'string') out[liveId] = liveScript;
  return out;
}

/**
 * Copy of an assembly under the next free name.
 * The source name is always taken (the original stays). A free preferred
 * name is not reused: `Gearbox` copies to `Gearbox (2)`, then `Gearbox (3)`,
 * the same parenthesis rule as a part copy. Assembly-local part paths move
 * into `assemblies/<new>/`. Shared `parts/` paths stay. Surf ids stay; this
 * does not rewrite stored assemblies.
 * -> { name, doc, scripts, moved }
 */
export function planDuplicateAssembly(doc, scripts = {}, taken = []) {
  const current = assemblyName(doc);
  const pool = [];
  const seen = new Set();
  const add = (name) => {
    const seg = vaultSegment(name);
    if (!seg) return;
    const key = seg.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(seg);
  };
  for (const name of taken || []) add(name);
  add(current);
  const name = vaultSegment(nextAssemblyName(pool, { preferred: current })) || current;
  const oldSeg = vaultSegment(doc?.name);
  const remapped = oldSeg && name && oldSeg.toLowerCase() !== name.toLowerCase()
    ? remapAssemblyPaths({ ...doc, name }, scripts, oldSeg, name)
    : { doc: { ...doc, name }, scripts: { ...(scripts || {}) }, moved: [] };
  const nextDoc = serializeAssembly({
    ...remapped.doc,
    name,
    source: doc?.source === 'git' ? 'git' : 'local',
  });
  return {
    name: nextDoc.name,
    doc: nextDoc,
    scripts: remapped.scripts,
    moved: remapped.moved || [],
  };
}

/**
 * Remap assembly-owned part paths when the assembly was renamed.
 * Shared `parts/…` stay put. Returns { doc, scripts, moved: [{ from, to }] }.
 */
export function remapAssemblyPaths(doc, scripts, oldName, newName) {
  const oldSeg = vaultSegment(oldName);
  const newSeg = vaultSegment(newName);
  const moved = [];
  const nextScripts = {};
  const nextParts = [];
  for (const part of doc?.parts || []) {
    const path = partRepoPath(part) || part.id;
    const info = parseVaultPath(path);
    let nextPath = path;
    if (info?.kind === 'assembly-part' && info.assembly === oldSeg && oldSeg !== newSeg) {
      nextPath = assemblyPartPath(newSeg, info.part);
      if (nextPath !== path) moved.push({ from: path, to: nextPath, id: part.id });
    }
    if (partKeepsStableId(part)) {
      nextParts.push({ ...part, path: nextPath });
      const text = partScriptText(part, scripts);
      if (typeof text === 'string') nextScripts[part.id] = text;
      else if (typeof scripts?.[nextPath] === 'string') nextScripts[part.id] = scripts[nextPath];
      else if (part?.missing !== true) nextScripts[part.id] = '';
    } else {
      nextParts.push({ ...part, id: nextPath, path: nextPath });
      const text = scripts?.[part.id];
      if (typeof text === 'string') nextScripts[nextPath] = text;
      else if (typeof scripts?.[nextPath] === 'string') nextScripts[nextPath] = scripts[nextPath];
      else if (part?.missing !== true) nextScripts[nextPath] = '';
    }
  }
  let activeId = doc?.activeId;
  const hit = moved.find((m) => m.from === activeId || m.id === activeId);
  if (hit && !partKeepsStableId({ id: activeId })) activeId = hit.to;
  return {
    doc: { ...doc, parts: nextParts, activeId },
    scripts: nextScripts,
    moved,
  };
}

/**
 * Files for one commit: every dirty part still in the document (script
 * changed or added) plus the assembly `.surf.json`. Parts removed from the
 * document are NOT deleted from git (the file may be shared or reused).
 *
 * When the assembly was renamed since the baseline Open, the commit also
 * moves to the new path in the same commit: write the new `.surf.json` and
 * remapped assembly-owned parts, and delete the old assembly file (plus old
 * part paths that moved). Shared `parts/…` stay. Orphan files left under the
 * old `assemblies/<old>/` tree are deleted by `commitWorkspace` via listTree.
 *
 * `opts.deletePaths` is an explicit list of repo paths to delete (a part
 * dropped from the assembly *and* the repo). Paths still used by a current
 * part are skipped. A removed part with no entry here stays in git.
 * -> { files, partPaths, assemblyPath, scripts, doc, renamed, oldName, moved }
 */
export function buildCommitFiles(doc, scripts, baseline, opts = {}) {
  const empty = {
    files: [], partPaths: [], assemblyPath: null, scripts: {},
    doc: doc || null, renamed: false, oldName: null, moved: [],
  };
  if (!doc || !baseline) return empty;
  const eff = effectiveScripts(scripts, opts);
  const newName = vaultSegment(doc.name) || baseline.assemblyName || '';
  const oldName = baseline.assemblyName || '';
  const renaming = !!(baseline.assemblyPath && oldName && newName && oldName !== newName);

  let workDoc = { ...doc, source: 'git' };
  let workScripts = eff;
  let moved = [...(opts.moved || [])];
  if (renaming) {
    const remapped = remapAssemblyPaths(doc, eff, oldName, newName);
    workDoc = { ...remapped.doc, source: 'git' };
    workScripts = remapped.scripts;
    moved = [...moved, ...remapped.moved];
  }

  const inDocOrig = new Set((doc.parts || []).map((p) => p.id));
  const dirty = dirtyPartIds(doc, eff, baseline);
  const movedFrom = new Map(moved.map((m) => [m.from, m.to]));
  const writes = new Map(); // path -> content
  const deletes = new Set();

  for (const { from, to, id } of moved) {
    const part = (workDoc.parts || []).find((row) => row.id === id || row.id === from);
    const body = partFileContent(
      part,
      partScriptText(part, workScripts) ?? workScripts[from] ?? workScripts[to],
    );
    if (body == null) {
      console.warn(`[git] skipping missing part ${id || from} (refusing empty blob)`);
      continue;
    }
    writes.set(to, body);
    if (from && from !== to && partRowVaultPathOk(from)) deletes.add(from);
  }

  const partPaths = [];
  for (const id of [...dirty].sort()) {
    if (!inDocOrig.has(id)) continue; // removed from doc — do not delete from git
    const part = (workDoc.parts || []).find((row) => row.id === id);
    const dest = partRepoPath(part) || movedFrom.get(id) || id;
    const body = partFileContent(
      part,
      partScriptText(part, workScripts) ?? workScripts[dest] ?? eff[id],
    );
    if (body == null) continue;
    writes.set(dest, body);
    partPaths.push(dest);
  }

  if (opts.assets) {
    const fromOf = new Map(moved.map((m) => [m.to, m.from]));
    for (const part of workDoc.parts || []) {
      const dest = partRepoPath(part) || part.id;
      const from = fromOf.get(dest) || dest;
      attachPartAsset(writes, deletes, partPaths, opts.assets, baseline, from, dest);
    }
  }

  const livePaths = new Set();
  for (const part of workDoc.parts || []) {
    const dest = partRepoPath(part) || movedFrom.get(part.id);
    if (dest) livePaths.add(dest);
    if (part?.id) livePaths.add(part.id);
    const mesh = dest ? assetPathForScript(dest) : null;
    if (mesh) livePaths.add(mesh);
  }
  for (const raw of Array.isArray(opts.deletePaths) ? opts.deletePaths : []) {
    const path = String(raw || '').trim();
    if (!path || livePaths.has(path) || writes.has(path)) continue;
    deletes.add(path);
  }

  const assemblyText = stringifySurfJson(workDoc);
  const assemblyPath = assemblyFilePath(newName || baseline.assemblyName);
  const assemblyChanged = (
    assemblyText !== baseline.assemblyText
    || assemblyPath !== baseline.assemblyPath
    || renaming
  );
  const anyRemoved = [...dirty].some((id) => !inDocOrig.has(id));
  // Always include the assembly whenever anything is committed (same as G3),
  // so a part-only edit still refreshes `.surf.json` in the same commit.
  const needAssembly = assemblyChanged || writes.size > 0 || deletes.size > 0 || anyRemoved;
  if (needAssembly) {
    writes.set(assemblyPath, assemblyText);
    if (renaming && baseline.assemblyPath && baseline.assemblyPath !== assemblyPath) {
      deletes.add(baseline.assemblyPath);
    }
  }

  if (!writes.size && !deletes.size) {
    return {
      files: [], partPaths: [], assemblyPath, scripts: workScripts,
      doc: workDoc, renamed: renaming, oldName: renaming ? oldName : null, moved,
    };
  }

  for (const part of workDoc.parts || []) {
    const stampId = partSurfId(part);
    if (!stampId || !isSurfId(stampId) || part?.missing === true) continue;
    const dest = partRepoPath(part) || movedFrom.get(part.id) || part.id;
    const info = parseVaultPath(dest);
    if (!info || (info.kind !== 'assembly-part' && info.kind !== 'shared-part')) continue;
    const had = writes.has(dest);
    const text = had
      ? writes.get(dest)
      : partFileContent(
        part,
        partScriptText(part, workScripts) ?? workScripts[dest] ?? eff[part.id],
      );
    if (typeof text !== 'string') continue;
    const stamped = stampPartHeaders(text, { id: stampId, name: part.name });
    if (stamped === text) continue;
    if (!had) {
      // A file whose @surf-id line differs from this part's id (including a
      // non-surf `// @surf-id bogus`) goes out with this Save. Do not newly
      // stamp headerless files that were not otherwise dirty.
      const header = readSurfId(text);
      if (!String(text).startsWith('// @surf-id ')) continue;
      if (header === stampId) continue;
    }
    writes.set(dest, stamped);
    workScripts[part.id] = stamped;
    if (dest !== part.id) workScripts[dest] = stamped;
  }

  for (const path of [...deletes]) {
    if (writes.has(path)) deletes.delete(path);
  }

  // Parts (sorted), then assembly, then deletes — matches G3 golden order.
  const partWritePaths = [...writes.keys()].filter((path) => path !== assemblyPath).sort();
  const files = [
    ...partWritePaths.map((path) => fileWrite(path, writes.get(path))),
    ...(writes.has(assemblyPath) ? [fileWrite(assemblyPath, writes.get(assemblyPath))] : []),
    ...[...deletes].sort().map((path) => fileDelete(path)),
  ];
    return {
    files,
    partPaths: [...new Set(partPaths)].sort(),
    assemblyPath,
    scripts: workScripts,
    doc: workDoc,
    renamed: renaming,
    oldName: renaming ? oldName : null,
    moved,
  };
}

/**
 * Baseline for an assembly that has never been in the vault (Git mode
 * without an Open): nothing committed yet, so every part and the assembly
 * are new. `headSha` is the vault branch head the first commit builds on.
 */
export function firstCommitBaseline({ branch = 'main', headSha = null } = {}) {
  return {
    assemblyPath: null,
    assemblyName: '',
    assemblyText: '',
    scripts: {},
    partIds: [],
    branch,
    headSha,
  };
}

/**
 * Baseline after a commit that wrote some part scripts.
 *
 * Only `saved` paths move forward. Every other part still in the document
 * keeps its previous baseline script, so an unsaved edit stays dirty and a
 * clean part stays clean. A part added since open and not listed in `saved`
 * is left out of the script map: `isPartDirty` treats a missing entry as
 * dirty. Filling the map from the whole working copy (what `captureBaseline`
 * does with that map) cleared every other row's dot even though those files
 * were not in the commit.
 *
 * Part ids are the current document when the assembly file was written with
 * it. A row that file no longer lists is not kept as a pending removal.
 * `removed` drops a path that this commit deleted or remapped away.
 */
export function baselineAfterPartSave(baseline, {
  doc,
  saved = {},
  removed = [],
  assemblyPath = null,
  assemblyName = null,
  branch = null,
  headSha = null,
  assets = null,
  assemblyWritten = true,
} = {}) {
  const prev = baseline || {};
  const asmName = vaultSegment(assemblyName || doc?.name) || prev.assemblyName || 'Assembly';
  const path = assemblyPath || prev.assemblyPath || assemblyFilePath(asmName);
  const captured = captureBaseline({
    assemblyPath: path,
    assemblyName: asmName,
    doc: doc || { name: asmName, source: 'git', parts: [] },
    scripts: {},
    assets: assets ?? prev.assets ?? null,
    branch: branch || prev.branch || 'main',
    headSha: headSha ?? prev.headSha ?? null,
  });
  const removedSet = new Set((removed || []).filter(Boolean).map(String));
  const prevScripts = prev.scripts || {};
  const scriptMap = {};
  const partIds = [];
  for (const id of captured.partIds) {
    if (removedSet.has(id)) continue;
    partIds.push(id);
    if (Object.prototype.hasOwnProperty.call(saved, id)) {
      const text = saved[id];
      scriptMap[id] = typeof text === 'string' ? text : '';
    } else if (Object.prototype.hasOwnProperty.call(prevScripts, id)) {
      scriptMap[id] = prevScripts[id];
    }
  }
  captured.scripts = scriptMap;
  captured.partIds = partIds;
  if (!assemblyWritten && typeof prev.assemblyText === 'string') {
    captured.assemblyText = prev.assemblyText;
    if (prev.assemblyPath) captured.assemblyPath = prev.assemblyPath;
    if (prev.assemblyName) captured.assemblyName = prev.assemblyName;
  }
  return captured;
}

/**
 * Instantly commit one part (plus the assembly `.surf.json`) to the working
 * branch. Used by Parts "Add to Repo" for local content not yet in the vault.
 * Every row without a vault path is pathed by `ensureAssemblyVaultPaths`
 * (assembly-folder, `Name-2` on collision) and written in this same commit,
 * so `.surf.json` never references a file the commit did not write.
 * `toSurfJson` stays pure and rejects leftover invalid ids.
 * -> { status: 'committed'|'clean'|'repo-moved'|'error', ... }
 * `repo-moved` is a stale base (`non_fast_forward`). Nothing was written.
 */
export async function commitPartToRepo(adapter, repo, {
  doc,
  scripts,
  baseline,
  partId,
  message = null,
  liveId = null,
  liveScript = null,
} = {}) {
  assertGithubAdapter(adapter);
  if (!doc || doc.source !== 'git') {
    return { status: 'error', error: 'Not in Git mode' };
  }
  const id = String(partId || '');
  if (!id) return { status: 'error', error: 'Part required' };

  const row = (doc.parts || []).find((p) => p.id === id);
  if (!row) return { status: 'error', error: 'Part not in assembly' };

  const asmName = vaultSegment(doc.name) || baseline?.assemblyName || 'Assembly';
  const base = baseline || firstCommitBaseline({
    branch: baseline?.branch || 'main',
    headSha: baseline?.headSha || null,
  });
  const branch = base.branch || 'main';
  let workDoc = { ...doc, source: 'git' };
  let workScripts = effectiveScripts(scripts, { liveId, liveScript });

  let remotePaths;
  try {
    remotePaths = await listVaultTreePaths(adapter, repo, branch);
  } catch (err) {
    return {
      status: 'error',
      error: err?.message || VAULT_TREE_UNAVAILABLE_MESSAGE,
      code: err?.code || VAULT_TREE_UNAVAILABLE,
    };
  }

  // Promote every stray — including the clicked row — so a per-row Save
  // cannot leave sibling `local:` ids rewritten in JSON without blobs.
  const promoted = ensureAssemblyVaultPaths(workDoc, workScripts, { remotePaths });
  workDoc = { ...promoted.doc, source: 'git' };
  workScripts = promoted.scripts;
  const destPath = promoted.moved.find((move) => move.from === id || move.id === id)?.to
    || partRepoPath((workDoc.parts || []).find((p) => p.id === id))
    || id;
  const siblings = promoted.moved.filter((move) => move.from !== id && move.id !== id);
  if ((workDoc.parts || []).some(partRowNeedsVaultPath)) {
    return { status: 'error', error: PATH_LESS_PARTS_MESSAGE, code: PATH_LESS_PARTS };
  }

  const destRow = (workDoc.parts || []).find((p) => p.id === id);
  let content = partScriptText(destRow, workScripts);
  if (destRow?.missing === true && !(typeof content === 'string' && content.length > 0)) {
    return { status: 'error', error: 'Refusing empty write for missing part', code: 'missing_part' };
  }
  if (typeof content !== 'string') {
    content = '';
    workScripts = { ...workScripts, [id]: content };
  }

  const assemblyPath = assemblyFilePath(asmName);
  const assemblyText = stringifySurfJson(workDoc);
  const written = new Set();
  const files = [];
  const addWrite = (path, text) => {
    if (!path || written.has(path)) return;
    written.add(path);
    files.push(fileWrite(path, text));
  };
  addWrite(destPath, content);
  for (const move of siblings) {
    const sibling = (workDoc.parts || []).find((p) => p.id === move.id || p.id === move.from);
    const siblingText = partScriptText(sibling, workScripts) ?? workScripts[move.from] ?? workScripts[move.to];
    const siblingBody = partFileContent(sibling, siblingText);
    if (siblingBody == null) {
      console.warn(`[git] skipping missing part ${move.id || move.from} (refusing empty blob)`);
      continue;
    }
    addWrite(move.to, siblingBody);
  }
  addWrite(assemblyPath, assemblyText);
  // Skip no-op when baseline already has identical content.
  if (
    base.scripts
    && Object.prototype.hasOwnProperty.call(base.scripts, id)
    && base.scripts[id] === content
    && base.assemblyText === assemblyText
  ) {
    return { status: 'clean', partId: id, path: destPath, doc: workDoc, scripts: workScripts };
  }

  const msg = String(message || '').trim()
    || `Add ${vaultSegment(row.name) || destPath.split('/').pop() || 'part'}`;

  let expectedBase = base.headSha || null;
  if (!expectedBase) {
    const tip = await adapter.getBranch(repo, branch);
    expectedBase = tip?.sha || null;
  }

  const pushContent = partScriptText(destRow, workScripts) ?? content;
  try {
    const res = await adapter.commitFiles(repo, {
      branch,
      message: msg,
      files,
      baseSha: expectedBase,
    });
    const saved = { [id]: pushContent };
    for (const move of siblings) {
      const sibling = (workDoc.parts || []).find((p) => p.id === move.id || p.id === move.from);
      saved[move.id || move.from] = partScriptText(sibling, workScripts) ?? workScripts[move.from] ?? '';
    }
    const next = baselineAfterPartSave(base, {
      doc: workDoc,
      saved,
      removed: [],
      assemblyPath,
      assemblyName: asmName,
      assets: base.assets,
      branch,
      headSha: res.sha,
    });
    return {
      status: 'committed',
      sha: res.sha,
      branch,
      partId: id,
      path: destPath,
      fromId: null,
      siblings,
      files: files.map((f) => f.path),
      baseline: next,
      doc: workDoc,
      scripts: workScripts,
      promoted: {},
    };
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return {
        status: 'repo-moved',
        code: 'non_fast_forward',
        branch,
        baseSha: expectedBase,
        files,
        message: msg,
        doc: workDoc,
        scripts: workScripts,
        partId: id,
        path: destPath,
        fromId: null,
        siblings,
      };
    }
    return { status: 'error', error: err?.message || 'Add to Repo failed' };
  }
}

/**
 * Delete a part script from the vault and write the assembly without that row.
 * Caller has already removed the part from the local working copy.
 * -> { status: 'committed'|'error', ... }
 */
export async function deletePartFromRepo(adapter, repo, {
  doc,
  scripts = {},
  baseline,
  partPath,
  message = null,
} = {}) {
  assertGithubAdapter(adapter);
  if (!doc || doc.source !== 'git') {
    return { status: 'error', error: 'Not in Git mode' };
  }
  const path = String(partPath || '');
  if (!path || path.startsWith('local:')) {
    return { status: 'error', error: 'Part is not in the repo' };
  }
  const info = parseVaultPath(path);
  if (!info || (info.kind !== 'assembly-part' && info.kind !== 'shared-part')) {
    return { status: 'error', error: 'Not a vault part path' };
  }
  // Refusing if the part is still listed (caller must remove first).
  if ((doc.parts || []).some((p) => p.id === path)) {
    return { status: 'error', error: 'Part still in assembly — remove it first' };
  }

  const asmName = vaultSegment(doc.name) || baseline?.assemblyName || 'Assembly';
  const base = baseline || {
    branch: 'main',
    headSha: null,
    scripts: {},
    assemblyText: '',
  };
  const branch = base.branch || 'main';
  const mesh = assetPathForScript(path);
  let prepared;
  try {
    prepared = await prepareAssemblySurfWrite(adapter, repo, {
      doc,
      scripts,
      branch,
      extraFiles: [
        fileDelete(path),
        ...(mesh ? [fileDelete(mesh)] : []),
      ],
    });
  } catch (err) {
    return { status: 'error', error: err?.message || 'Delete from repo failed', code: err?.code };
  }
  const files = prepared.files;
  const assemblyPath = prepared.assemblyPath;
  const workDoc = prepared.doc;
  const leaf = path.split('/').pop()?.replace(/\.js$/i, '') || 'part';
  const msg = String(message || '').trim() || `Delete ${leaf}`;

  let expectedBase = base.headSha || null;
  if (!expectedBase) {
    const tip = await adapter.getBranch(repo, branch);
    expectedBase = tip?.sha || null;
  }

  try {
    const res = await adapter.commitFiles(repo, {
      branch,
      message: msg,
      files,
      baseSha: expectedBase,
    });
    const next = baselineAfterPartSave(base, {
      doc: workDoc,
      removed: [path],
      assemblyPath,
      assemblyName: asmName,
      assets: base.assets,
      branch,
      headSha: res.sha,
    });
    return {
      status: 'committed',
      sha: res.sha,
      branch,
      partPath: path,
      files: files.map((f) => f.path),
      baseline: next,
    };
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return {
        status: 'repo-moved',
        code: 'non_fast_forward',
        branch,
        baseSha: expectedBase,
        files,
        message: msg,
      };
    }
    return { status: 'error', error: err?.message || 'Delete from repo failed' };
  }
}


function hasOwn(obj, key) {
  return !!obj && !!key && Object.prototype.hasOwnProperty.call(obj, key);
}

function assetValue(assets, mesh, scriptPath) {
  if (hasOwn(assets, mesh)) return assets[mesh];
  if (hasOwn(assets, scriptPath)) return assets[scriptPath];
  return undefined;
}

/**
 * Write or delete `<Part>.mesh` in the same commit as its script.
 * `assets` is keyed by mesh path (or the script path). A Uint8Array is the
 * new bytes. `null` deletes a mesh the baseline still has. A matching git
 * blob sha is left untouched.
 */
function attachPartAsset(writes, deletes, partPaths, assets, baseline, from, dest) {
  const mesh = assetPathForScript(dest);
  if (!mesh) return;
  const fromMesh = from === dest ? mesh : assetPathForScript(from);
  const direct = assetValue(assets, mesh, dest);
  const prior = fromMesh && fromMesh !== mesh ? assetValue(assets, fromMesh, from) : undefined;
  const value = direct !== undefined ? direct : prior;
  const remember = () => {
    if (!partPaths.includes(dest)) partPaths.push(dest);
  };
  if (fromMesh && fromMesh !== mesh) {
    if (isBinaryContent(value)) {
      writes.set(mesh, toUint8Array(value));
      deletes.add(fromMesh);
      remember();
    }
    return;
  }
  if (value === undefined) return;
  if (value == null) {
    if (baseline?.assets?.[mesh]) {
      deletes.add(mesh);
      remember();
    }
    return;
  }
  if (!isBinaryContent(value)) return;
  const bytes = toUint8Array(value);
  if (gitBlobSha(bytes) !== (baseline?.assets?.[mesh] || null)) {
    writes.set(mesh, bytes);
    remember();
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Shown when a Save finds the working ref has moved. Not an Upload Error. */
export const REPO_MOVED_WARNING = 'Repo moved. Nothing was overwritten.';

/** Success toast after Make a new branch lands the local save. */
export function repoSavedMessage(branch) {
  return `Saved to ${branch}`;
}

/** First free branch name: base, base-2, base-3 … */
export async function freeBranchName(adapter, repo, base) {
  const taken = new Set((await adapter.listBranches(repo)).map((b) => b.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const name = `${base}-${n}`;
    if (!taken.has(name)) return name;
  }
  throw new GitAdapterError('name_exists', `No free branch name for ${base}`);
}

/**
 * Cut a branch from the local baseline and commit `files` there.
 * The branch that moved (usually main) is not written.
 * -> { status: 'committed', branch, sha, baseline, files, doc, scripts }
 *  | { status: 'error', error }
 */
export async function saveLocalOnNewBranch(adapter, repo, {
  doc,
  scripts,
  baseline,
  files,
  message = '',
  now = new Date(),
} = {}) {
  assertGithubAdapter(adapter);
  const baseSha = baseline?.headSha || null;
  if (!baseSha) return { status: 'error', error: 'No local commit to branch from' };
  const list = Array.isArray(files) ? files.filter((file) => file?.path) : [];
  if (!list.length) return { status: 'error', error: 'Nothing to save' };
  const preferred = commitBranchName(doc?.name || baseline?.assemblyName || 'assembly', now);
  const branch = await freeBranchName(adapter, repo, preferred);
  await adapter.createBranch(repo, branch, baseSha);
  const msg = String(message || '').trim()
    || `Update ${vaultSegment(doc?.name) || baseline?.assemblyName || 'assembly'}`;
  const res = await adapter.commitFiles(repo, {
    branch,
    message: msg,
    files: list,
    baseSha,
  });
  const asmName = vaultSegment(doc?.name) || baseline?.assemblyName || 'Assembly';
  const assemblyPath = assemblyFilePath(asmName);
  const saved = {};
  const removed = [];
  let assemblyWritten = false;
  for (const file of list) {
    if (!file?.path) continue;
    if (file.path === assemblyPath || (baseline?.assemblyPath && file.path === baseline.assemblyPath)) {
      if (!file.delete) assemblyWritten = true;
      continue;
    }
    const info = parseVaultPath(file.path);
    const isPart = info && (info.kind === 'assembly-part' || info.kind === 'shared-part');
    if (!isPart) continue;
    if (file.delete) removed.push(file.path);
    else if (typeof file.content === 'string') saved[file.path] = file.content;
  }
  const next = baselineAfterPartSave(baseline, {
    doc: doc || { name: asmName, source: 'git', parts: [] },
    saved,
    removed,
    assemblyPath,
    assemblyName: asmName,
    assets: baseline?.assets,
    branch,
    headSha: res.sha,
    assemblyWritten,
  });
  return {
    status: 'committed',
    sha: res.sha,
    branch,
    baseSha,
    files: list.map((file) => file.path),
    baseline: next,
    doc,
    scripts,
  };
}

/** `surfcad/<assembly-slug>-YYYY-MM-DD` (git-ref safe). */
export function commitBranchName(assemblyName, date = new Date()) {
  const slug = vaultSegment(assemblyName)
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\]\\@{}'"`]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\.lock$/i, '')
    .replace(/^[-.]+|[-.]+$/g, '') || 'assembly';
  const d = date instanceof Date ? date : new Date(date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${COMMIT_BRANCH_PREFIX}${slug}-${stamp}`;
}

/**
 * Detect the base for a stale commit: the merge base of our baseline head
 * and main. Falls back to main's head when the baseline commit is gone.
 * -> { baseSha, mainSha, behindBy, remoteFiles: [{ path, status }] }
 */
export async function detectCommitBase(adapter, repo, { branch = 'main', baselineSha = null } = {}) {
  const main = await adapter.getBranch(repo, branch);
  const mainSha = main?.sha || null;
  if (!baselineSha || !mainSha) {
    return { baseSha: mainSha, mainSha, behindBy: 0, remoteFiles: [] };
  }
  try {
    const cmp = await adapter.compare(repo, baselineSha, mainSha);
    return {
      baseSha: cmp.mergeBaseSha || mainSha,
      mainSha,
      behindBy: cmp.aheadBy, // main is ahead of our base by this many commits
      remoteFiles: cmp.files || [],
    };
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'not_found') {
      return { baseSha: mainSha, mainSha, behindBy: 0, remoteFiles: [] };
    }
    throw err;
  }
}

function nextBaseline(doc, scripts, baseline, assemblyPath, branch, headSha) {
  return captureBaseline({
    assemblyPath,
    assemblyName: vaultSegment(doc.name) || baseline.assemblyName,
    doc,
    scripts,
    assets: baseline.assets,
    branch,
    headSha,
  });
}

/**
 * Files for one Save, without writing git.
 * -> { status: 'clean' }
 *  | { status: 'ready', files, doc, scripts, message, branch, assemblyPath,
 *      renamed, moved, partIds }
 */
export async function assembleCommitFiles(adapter, repo, {
  doc,
  scripts,
  baseline,
  message = '',
  liveId = null,
  liveScript = null,
  assets = null,
  remotePaths = null,
  deletePaths = null,
} = {}) {
  assertGithubAdapter(adapter);
  if (!baseline) throw new Error('Open an assembly from the vault before committing');
  const branch = baseline.branch || 'main';
  const occupancy = Array.isArray(remotePaths)
    ? remotePaths
    : await listVaultTreePaths(adapter, repo, branch);
  const promoted = ensureAssemblyVaultPaths(doc, scripts, { remotePaths: occupancy });
  const workDoc = promoted.doc;
  if ((workDoc.parts || []).some(partRowNeedsVaultPath)) {
    throw pathLessError((workDoc.parts || []).filter(partRowNeedsVaultPath));
  }
  const workScripts = effectiveScripts(promoted.scripts, { liveId, liveScript });
  const built = buildCommitFiles(workDoc, workScripts, baseline, {
    liveId,
    liveScript,
    assets,
    moved: promoted.moved,
    deletePaths,
  });
  const mergedMoved = built.moved || [];
  const workDocOut = built.doc || workDoc;
  // Rename move: delete any leftover blobs under the old assemblies/<old>/ tree
  // (Spare.js etc.) so the old folder does not linger after the move.
  if (built.renamed && built.oldName) {
    const ref = baseline.branch || 'main';
    const prefix = `${ASSEMBLIES_DIR}/${built.oldName}/`;
    const tree = await listVaultTree(adapter, repo, ref, { prefix });
    const scheduled = new Set(built.files.map((f) => f.path));
    for (const entry of tree) {
      const p = entry?.path;
      if (!p || scheduled.has(p)) continue;
      built.files.push(fileDelete(p));
      scheduled.add(p);
    }
  }
  // One-shot rewrite: drop legacy named .surf.json + nested parts/ when the
  // working copy already uses the flat nameless layout.
  if (baseline.legacyCleanup) {
    const ref = baseline.branch || 'main';
    const asmName = vaultSegment(workDocOut.name) || baseline.assemblyName;
    const tree = await listVaultTree(adapter, repo, ref);
    const scheduled = new Set(built.files.map((f) => f.path));
    const toDelete = legacyCleanupPaths(asmName, tree);
    if (baseline.legacyAssemblyPath) toDelete.push(baseline.legacyAssemblyPath);
    for (const path of [...new Set(toDelete)].sort()) {
      if (!path || scheduled.has(path)) continue;
      // Never delete the current assembly metadata or current part paths.
      if (path === built.assemblyPath) continue;
      if ((workDocOut.parts || []).some((part) => partRepoPath(part) === path || part.id === path)) continue;
      built.files.push(fileDelete(path));
      scheduled.add(path);
    }
    // Ensure the current .surf.json is written even when only cleanup remains.
    if (built.assemblyPath && !scheduled.has(built.assemblyPath)) {
      built.files.push(fileWrite(built.assemblyPath, stringifySurfJson(workDocOut)));
      scheduled.add(built.assemblyPath);
    }
  }
  if (!built.files.length) return { status: 'clean' };
  const msg = String(message || '').trim() || `Update ${vaultSegment(workDocOut.name) || 'assembly'}`;
  const destToId = new Map(
    (workDocOut.parts || []).map((part) => [partRepoPath(part) || part.id, part.id]),
  );
  const partIds = [...new Set(
    (built.partPaths || []).map((path) => destToId.get(path) || path),
  )];
  return {
    status: 'ready',
    files: built.files,
    doc: workDocOut,
    scripts: built.scripts,
    message: msg,
    branch,
    assemblyPath: built.assemblyPath,
    renamed: built.renamed,
    moved: mergedMoved,
    partIds,
  };
}

/**
 * Commit a prepared workspace when the baseline still matches the tip.
 * On `non_fast_forward` this returns `conflict` and writes nothing.
 * Save in the app does not call this — it enqueues `assembleCommitFiles`.
 * -> { status: 'clean' | 'committed' | 'conflict', ... }
 */
export async function commitWorkspace(adapter, repo, opts = {}) {
  const assembled = await assembleCommitFiles(adapter, repo, opts);
  if (assembled.status === 'clean') return assembled;
  const { branch } = assembled;
  let expectedBase = opts.baseline?.headSha || null;
  if (!expectedBase) {
    const tip = await adapter.getBranch(repo, branch);
    expectedBase = tip?.sha || null;
  }
  try {
    const res = await adapter.commitFiles(repo, {
      branch,
      message: assembled.message,
      files: assembled.files,
      baseSha: expectedBase,
    });
    return {
      status: 'committed',
      sha: res.sha,
      branch,
      files: assembled.files.map((file) => file.path),
      baseline: nextBaseline(assembled.doc, assembled.scripts, opts.baseline, assembled.assemblyPath, branch, res.sha),
      doc: assembled.doc,
      scripts: assembled.scripts,
      renamed: assembled.renamed,
      moved: assembled.moved,
      promoted: {},
    };
  } catch (err) {
    if (!(err instanceof GitAdapterError) || err.code !== 'non_fast_forward') throw err;
    return {
      status: 'conflict',
      syncHold: true,
      branch,
      baseSha: expectedBase,
      warning: 'The repo moved since the last sync. Nothing was overwritten.',
    };
  }
}

/** The automatic sync wrote nothing. Overwrite main is a separate explicit write. */
export function forceMergeWarning() {
  return 'The repo moved since the last sync. Nothing was overwritten.';
}

/**
 * Fold an overwrite commit into the open working copy so the screen matches
 * main. Part scripts take the written text. The open assembly's `.surf.json`
 * replaces that document. Other remote files are not in `files` and stay.
 */
export function applyOverwriteFiles(doc, scripts, files) {
  const nextScripts = { ...(scripts || {}) };
  let nextDoc = doc;
  let changed = false;
  for (const file of files || []) {
    const path = file?.path;
    if (!path) continue;
    if (file.delete) {
      if (Object.prototype.hasOwnProperty.call(nextScripts, path)) {
        delete nextScripts[path];
        changed = true;
      }
      continue;
    }
    if (typeof file.content !== 'string') continue;
    if (String(path).endsWith('.surf.json')) {
      if (!doc) continue;
      try {
        const parsed = parseSurfJson(file.content);
        const parsedName = vaultSegment(parsed?.name);
        const openName = vaultSegment(doc.name);
        if (!parsedName || !openName || parsedName !== openName) continue;
        nextDoc = { ...parsed, source: 'git' };
        changed = true;
      } catch {
        /* leave the open document when the assembly file cannot be read */
      }
      continue;
    }
    if (nextScripts[path] !== file.content) {
      nextScripts[path] = file.content;
      changed = true;
    }
  }
  for (const part of nextDoc?.parts || []) {
    const dest = partRepoPath(part);
    if (!dest || !Object.prototype.hasOwnProperty.call(nextScripts, dest)) continue;
    if (nextScripts[part.id] === nextScripts[dest]) continue;
    nextScripts[part.id] = nextScripts[dest];
    changed = true;
  }
  return { doc: nextDoc, scripts: nextScripts, changed };
}

/**
 * Write local files on top of the current branch tip.
 * Overwrite main is the user's explicit choice: these paths take the local
 * bytes and every other remote file stays. `baseSha` is the current tip,
 * so the moved-tip guard does not refuse the write. A document plus a
 * baseline and no file list assembles the save first.
 * -> { status: 'committed', sha, branch, files, written, baseline?, doc?, scripts? }
 *  | { status: 'clean' | 'error', ... }
 */
export async function forceMergeCommit(adapter, repo, {
  branch = 'main',
  message = 'Overwrite main',
  files = null,
  doc = null,
  scripts = null,
  baseline = null,
  deletePaths = null,
} = {}) {
  assertGithubAdapter(adapter);
  let list = Array.isArray(files) ? files.filter((file) => file?.path) : [];
  let workDoc = doc;
  let workScripts = scripts;
  let asmPath = baseline?.assemblyPath || null;
  let msg = String(message || '').trim() || 'Overwrite main';
  if (!list.length && doc && baseline) {
    const assembled = await assembleCommitFiles(adapter, repo, {
      doc,
      scripts,
      baseline,
      message: msg,
      deletePaths,
    });
    if (assembled.status === 'clean') return assembled;
    list = assembled.files;
    workDoc = assembled.doc;
    workScripts = assembled.scripts;
    branch = assembled.branch || branch;
    msg = assembled.message || msg;
    asmPath = assembled.assemblyPath || asmPath;
  }
  if (!list.length) return { status: 'error', error: 'Nothing to overwrite' };
  const tip = await adapter.getBranch(repo, branch);
  const head = tip?.sha || null;
  const res = await adapter.commitFiles(repo, {
    branch,
    message: msg,
    files: list,
    baseSha: head,
  });
  const next = workDoc
    ? nextBaseline(
      workDoc,
      workScripts || {},
      baseline || {},
      asmPath || assemblyFilePath(vaultSegment(workDoc.name) || 'assembly'),
      branch,
      res.sha,
    )
    : null;
  return {
    status: 'committed',
    sha: res.sha,
    branch,
    files: list.map((file) => file.path),
    written: list,
    baseline: next,
    doc: workDoc,
    scripts: workScripts,
  };
}
