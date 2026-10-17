/**
 * Delete an assembly in one commit.
 *
 * Without parts (`keep`): delete the assembly folder and `.surf.json`.
 * Files already in `parts/` stay byte for byte. An assembly-local copy
 * moves to `parts/` (`Bracket.js`, then `Bracket (2).js`). Surf ids stay.
 * Refs are rewritten by surf id, then by path when the row has no id.
 *
 * With parts (`drop`): delete a script only when no other assembly
 * references its surf id. An assembly-local copy that is still referenced
 * moves to `parts/` and is not deleted. An unreferenced one is deleted.
 * A reference is another assembly's tip `.surf.json`, the open working
 * copy, or this branch's queued or failed outbox projected onto the tree.
 * It matches `parts[].id`, or `parts[].path` when that id is missing, or
 * `groups[].partIds`. `copiedFrom` is provenance. `groups[].source` is not
 * a part ref.
 *
 * The commit refuses to drop a referenced part file. Groups whose source
 * was the deleted assembly keep their name and `source` becomes null.
 *
 * The local cache is one snapshot. Swap it only after the next tree is
 * fully built, so a failure cannot leave some paths moved and others not.
 */
import { serializeAssembly, DEFAULT_ASSEMBLY_NAME } from '../assembly.js';
import { fileDelete, fileWrite } from './githubAdapterInterface.js';
import {
  assemblyDir,
  assemblyFilePath,
  assetPathForScript,
  legacyAssemblyFilePath,
  listAssemblies,
  parseVaultPath,
  sharedPartPath,
  vaultPartFileStem,
  vaultSegment,
} from './vaultLayout.js';
import { isSurfId, isSurfJsonPath, readSurfId, withSurfId } from './surfId.js';
import { parseSurfJson } from './surfJson.js';
import { buildRenameCommitFiles, projectFiles, renamePlanFromPayload } from './gitRename.js';

const DELETE_MESSAGE = (name) => `Delete assembly ${name}`;

function partLabel(path) {
  const info = parseVaultPath(path);
  return info?.part || String(path || '').split('/').pop()?.replace(/\.js$/i, '') || 'Part';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Next free parts/<Name>.js. `taken` includes paths already claimed. */
export function sharedPathForMove(partName, taken) {
  const base = vaultSegment(partName) || 'Part';
  for (let n = 1; n < 1000; n += 1) {
    const path = sharedPartPath(vaultPartFileStem(base, n));
    if (!taken.has(path)) {
      taken.add(path);
      return path;
    }
  }
  throw new Error(`No free parts/ name for ${base}`);
}

function assemblyPartFiles(entries, name) {
  return (entries || []).filter((entry) => {
    const info = parseVaultPath(entry?.path);
    return info?.kind === 'assembly-part' && info.assembly === name;
  });
}

function otherAssemblyFiles(entries, name) {
  return (entries || []).filter((entry) => {
    const info = parseVaultPath(entry?.path);
    return info?.kind === 'assembly' && info.assembly !== name;
  });
}

/**
 * A part row hits when `parts[].id` equals the surf id.
 * `parts[].path` counts only when that row has no id.
 */
export function refMatchesPart(ref, part) {
  if (!ref || !part) return false;
  if (ref.id && part.surfId && ref.id === part.surfId) return true;
  if (ref.id) return false;
  return !!ref.path && ref.path === part.path;
}

function isScriptPath(path) {
  const kind = parseVaultPath(path)?.kind;
  return kind === 'shared-part' || kind === 'assembly-part';
}

function fileAt(entries, path) {
  if (!path) return null;
  return (entries || []).find((entry) => entry?.path === path && typeof entry.content === 'string') || null;
}

function surfIdForFile(file, entries) {
  const header = readSurfId(file?.content || '');
  if (header && isSurfId(header)) return header;
  for (const entry of entries || []) {
    if (!isSurfJsonPath(entry?.path) || typeof entry.content !== 'string') continue;
    const raw = parseJson(entry.content);
    for (const part of raw?.parts || []) {
      if (part?.path === file?.path && isSurfId(part.id)) return part.id;
    }
  }
  return null;
}

function findOwnedBySurfId(entries, surfId, assemblyName) {
  for (const entry of entries || []) {
    if (!isScriptPath(entry?.path) || typeof entry.content !== 'string') continue;
    const info = parseVaultPath(entry.path);
    const here = info?.kind === 'shared-part'
      || (info?.kind === 'assembly-part' && info.assembly === assemblyName);
    if (!here) continue;
    if (readSurfId(entry.content) === surfId) return entry;
  }
  for (const entry of entries || []) {
    if (!isSurfJsonPath(entry?.path) || typeof entry.content !== 'string') continue;
    const raw = parseJson(entry.content);
    for (const part of raw?.parts || []) {
      if (part?.id !== surfId || !part.path) continue;
      const file = fileAt(entries, part.path);
      const info = parseVaultPath(part.path);
      if (!file || !info) continue;
      if (info.kind === 'shared-part' || (info.kind === 'assembly-part' && info.assembly === assemblyName)) {
        return file;
      }
    }
  }
  return null;
}

function rememberOwned(map, file, entries, assemblyName, rowName) {
  if (!file?.path || typeof file.content !== 'string') return;
  const info = parseVaultPath(file.path);
  const here = info?.kind === 'shared-part'
    || (info?.kind === 'assembly-part' && info.assembly === assemblyName);
  if (!here) return;
  const label = typeof rowName === 'string' ? rowName.trim() : '';
  const existing = map.get(file.path);
  if (existing) {
    if (label && !existing.nameFromRow) existing.nameFromRow = label;
    return;
  }
  map.set(file.path, {
    path: file.path,
    content: file.content,
    surfId: surfIdForFile(file, entries),
    nameFromRow: label,
    local: info.kind === 'assembly-part',
  });
}

function ownFromRaw(map, raw, entries, assemblyName) {
  for (const part of raw?.parts || []) {
    const rowName = typeof part?.name === 'string' ? part.name : '';
    if (typeof part?.path === 'string') {
      rememberOwned(map, fileAt(entries, part.path), entries, assemblyName, rowName);
    }
    if (isSurfId(part?.id)) {
      rememberOwned(map, findOwnedBySurfId(entries, part.id, assemblyName), entries, assemblyName, rowName);
    }
  }
  for (const group of raw?.groups || []) {
    for (const id of group?.partIds || []) {
      if (!isSurfId(id)) continue;
      rememberOwned(map, findOwnedBySurfId(entries, id, assemblyName), entries, assemblyName, '');
    }
  }
}

function rawFromOpenDoc(doc) {
  return {
    name: doc?.name,
    parts: (doc?.parts || []).map((part) => ({
      id: part?.surfId,
      path: part?.id,
      name: part?.name,
    })),
    groups: doc?.groups || [],
  };
}

/** Scripts this assembly will take with it: its folder, plus scripts it cites in parts/. */
function ownedParts(entries, name, openDoc) {
  const map = new Map();
  for (const file of assemblyPartFiles(entries, name)) {
    rememberOwned(map, file, entries, name, '');
  }
  const raw = parseJson((fileAt(entries, assemblyFilePath(name)) || fileAt(entries, legacyAssemblyFilePath(name)))?.content);
  ownFromRaw(map, raw, entries, name);
  if (openDoc && vaultSegment(openDoc.name) === name) ownFromRaw(map, rawFromOpenDoc(openDoc), entries, name);
  return [...map.values()].map((part) => ({
    path: part.path,
    content: part.content,
    surfId: part.surfId,
    local: part.local,
    name: part.nameFromRow || partLabel(part.path),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function refsFromRaw(raw, asm) {
  const refs = [];
  for (const part of raw?.parts || []) {
    refs.push({
      id: isSurfId(part?.id) ? part.id : null,
      path: typeof part?.path === 'string' ? part.path : null,
      assembly: asm,
      via: 'part',
    });
  }
  for (const group of raw?.groups || []) {
    for (const id of group?.partIds || []) {
      if (!isSurfId(id)) continue;
      refs.push({ id, path: null, assembly: asm, via: 'group' });
    }
  }
  return refs;
}

function assemblyLabel(raw, filePath) {
  if (typeof raw?.name === 'string' && raw.name.trim()) return raw.name.trim();
  return parseVaultPath(filePath)?.assembly || '';
}

function refsFromTree(entries, deletedName) {
  const refs = [];
  for (const file of otherAssemblyFiles(entries, deletedName)) {
    const raw = parseJson(file.content);
    if (!raw) continue;
    const asm = assemblyLabel(raw, file.path);
    if (!asm || asm === deletedName) continue;
    refs.push(...refsFromRaw(raw, asm));
  }
  return refs;
}

/**
 * Refs from the projected tree, the tip tree, and the open working copy
 * when that copy is a different assembly. `copiedFrom` and `groups[].source`
 * are not refs.
 */
function externalRefs(entries, name, { openDoc = null, tipEntries = null } = {}) {
  const refs = refsFromTree(entries, name);
  if (tipEntries && tipEntries !== entries) refs.push(...refsFromTree(tipEntries, name));
  const openName = vaultSegment(openDoc?.name);
  if (openDoc && openName && openName !== name) refs.push(...refsFromRaw(rawFromOpenDoc(openDoc), openName));
  return refs;
}

function refHits(ref, part) {
  if (!ref) return false;
  if (ref.via === 'group') return !!(ref.id && part?.surfId && ref.id === part.surfId);
  return refMatchesPart(ref, part);
}

function assembliesFor(part, refs) {
  const names = [];
  for (const ref of refs || []) {
    if (!refHits(ref, part) || !ref.assembly || names.includes(ref.assembly)) continue;
    names.push(ref.assembly);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

function contentForMove(part, scripts) {
  const override = scripts && typeof scripts[part.path] === 'string' ? scripts[part.path] : null;
  let content = override != null ? override : part.content;
  if (part.surfId && !readSurfId(content)) content = withSurfId(content, part.surfId);
  return content;
}

function rewriteSurfForDelete(text, { moves, sourcePaths }) {
  const raw = parseJson(text);
  if (!raw || typeof raw !== 'object') return text;
  const byId = new Map(moves.filter((move) => move.surfId).map((move) => [move.surfId, move]));
  const byPath = new Map(moves.map((move) => [move.from, move]));
  const matchRef = (ref) => {
    if (!ref) return null;
    if (ref.id && byId.has(ref.id)) return byId.get(ref.id);
    if (!ref.id && ref.path && byPath.has(ref.path)) return byPath.get(ref.path);
    return null;
  };
  let changed = false;
  if (Array.isArray(raw.parts)) {
    for (const part of raw.parts) {
      const move = matchRef(part);
      if (move && move.to !== part.path) {
        part.path = move.to;
        changed = true;
      }
    }
  }
  if (typeof raw.activeId === 'string') {
    const move = byPath.get(raw.activeId)
      || moves.find((row) => row.from === raw.activeId);
    if (move && move.to !== raw.activeId) {
      raw.activeId = move.to;
      changed = true;
    }
  }
  if (Array.isArray(raw.groups)) {
    for (const group of raw.groups) {
      if (group && sourcePaths.has(group.source)) {
        group.source = null;
        changed = true;
      }
    }
  }
  if (!changed) return text;
  return `${JSON.stringify(raw, null, 2)}\n`;
}

function partRecord(entry, entries) {
  return {
    path: entry.path,
    content: entry.content ?? '',
    surfId: surfIdForFile(entry, entries),
  };
}

/**
 * Throw when a referenced part script disappears or a `parts/` file is
 * rewritten. An assembly-local copy may move to `parts/` with its bytes
 * and surf id. `mode: 'keep'` also requires every existing `parts/` file
 * to stay byte for byte.
 */
export function assertDeleteKeepsReferenced(before, after, refs, moves = [], { assemblyName = '', mode = 'drop' } = {}) {
  const afterMap = new Map((after || []).map((entry) => [entry.path, entry.content ?? '']));
  const moveByFrom = new Map((moves || []).map((move) => [move.from, move]));
  for (const entry of before || []) {
    if (!isScriptPath(entry?.path) || typeof entry.content !== 'string') continue;
    const part = partRecord(entry, before);
    if (!assembliesFor(part, refs).length) continue;
    if (afterMap.get(part.path) === part.content) continue;
    const move = moveByFrom.get(part.path);
    const dest = move ? afterMap.get(move.to) : undefined;
    const info = parseVaultPath(part.path);
    if (info?.kind === 'shared-part' || typeof dest !== 'string' || dest !== (move.content ?? '')) {
      throw new Error(`Delete assembly lost referenced part ${part.path}`);
    }
    if (part.surfId && readSurfId(dest) !== part.surfId) {
      throw new Error(`Delete assembly changed the surf id of ${part.path}`);
    }
  }
  if (mode === 'keep') {
    for (const entry of before || []) {
      if (parseVaultPath(entry?.path)?.kind !== 'shared-part') continue;
      if (afterMap.get(entry.path) !== (entry.content ?? '')) {
        throw new Error(`Delete assembly changed ${entry.path}`);
      }
    }
  }
  const gone = new Set([
    assemblyName ? assemblyFilePath(assemblyName) : '',
    assemblyName ? legacyAssemblyFilePath(assemblyName) : '',
  ]);
  for (const entry of before || []) {
    if (!isSurfJsonPath(entry?.path) || gone.has(entry.path)) continue;
    if (!afterMap.has(entry.path)) throw new Error(`Delete assembly lost ${entry.path}`);
  }
}

/** The file list must not overwrite a path or delete a referenced script. */
export function assertDeleteCommitSafe(files, before, { assemblyName, refs, mode, moves }) {
  const beforeMap = new Map((before || []).map((entry) => [entry.path, entry.content ?? '']));
  const prefix = `${assemblyDir(assemblyName)}/`;
  const movedFrom = new Set((moves || []).map((move) => move.from));
  for (const file of files || []) {
    if (!file?.path) continue;
    if (!file.delete) {
      const prev = beforeMap.get(file.path);
      const kind = parseVaultPath(file.path)?.kind;
      const script = kind === 'shared-part' || kind === 'assembly-part';
      if (script && typeof prev === 'string' && prev !== (file.content ?? '')) {
        throw new Error(`Delete assembly overwrote ${file.path}`);
      }
      continue;
    }
    if (isSurfJsonPath(file.path) && !file.path.startsWith(prefix)) {
      throw new Error(`Delete assembly refuses to delete ${file.path}`);
    }
    const info = parseVaultPath(file.path);
    if (info?.kind === 'assembly-part' && info.assembly !== assemblyName) {
      throw new Error(`Delete assembly refuses to delete ${file.path}`);
    }
    if (info?.kind !== 'shared-part' && info?.kind !== 'assembly-part') continue;
    const part = partRecord({ path: file.path, content: beforeMap.get(file.path) ?? '' }, before);
    const referenced = assembliesFor(part, refs).length > 0;
    if (info.kind === 'shared-part' && mode === 'keep') {
      throw new Error(`Delete assembly refuses to delete ${file.path}`);
    }
    if (info.kind === 'shared-part' && referenced) {
      throw new Error(`Delete assembly refuses to delete referenced part ${file.path}`);
    }
    if (info.kind === 'assembly-part' && referenced && !movedFrom.has(file.path)) {
      throw new Error(`Delete assembly refuses to delete referenced part ${file.path}`);
    }
  }
}

/**
 * File list for one delete commit.
 * mode 'keep' deletes the folder and leaves `parts/` bytes alone.
 * Assembly-local copies move to `parts/`.
 * mode 'drop' deletes a script only when no other assembly references it.
 * A referenced assembly-local copy still moves.
 * -> { assemblyName, assemblyPath, legacyPath, mode, message, partCount,
 *      referenced, moves, files }
 */
export function planDeleteAssembly(entries, assemblyName, mode = 'keep', {
  scripts = null,
  openDoc = null,
  tipEntries = null,
} = {}) {
  const name = vaultSegment(assemblyName);
  if (!name) throw new Error('Empty assembly name');
  if (mode !== 'keep' && mode !== 'drop') throw new Error(`Unknown delete mode "${mode}"`);
  const list = entries || [];
  const parts = ownedParts(list, name, openDoc);
  const refs = externalRefs(list, name, { openDoc, tipEntries });
  const referenced = parts
    .map((part) => ({
      name: part.name,
      path: part.path,
      surfId: part.surfId,
      assemblies: assembliesFor(part, refs),
    }))
    .filter((part) => part.assemblies.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const referencedPaths = new Set(referenced.map((part) => part.path));
  const taken = new Set(
    list.map((entry) => entry.path).filter((path) => parseVaultPath(path)?.kind === 'shared-part'),
  );
  const moves = [];
  const dropShared = [];
  for (const part of parts) {
    const keep = mode === 'keep' ? part.local : (part.local && referencedPaths.has(part.path));
    if (keep) {
      moves.push({
        from: part.path,
        to: sharedPathForMove(partLabel(part.path), taken),
        surfId: part.surfId,
        name: part.name,
        content: contentForMove(part, scripts),
      });
      continue;
    }
    if (mode === 'drop' && !part.local && !referencedPaths.has(part.path)) dropShared.push(part.path);
  }
  const sourcePaths = new Set([assemblyFilePath(name), legacyAssemblyFilePath(name)]);
  const prefix = `${assemblyDir(name)}/`;
  const writes = new Map();
  const deletes = new Set();
  for (const entry of list) {
    if (typeof entry?.path === 'string' && entry.path.startsWith(prefix)) deletes.add(entry.path);
  }
  for (const path of dropShared) {
    deletes.add(path);
    const mesh = assetPathForScript(path);
    if (mesh && list.some((entry) => entry?.path === mesh)) deletes.add(mesh);
  }
  for (const move of moves) {
    writes.set(move.to, move.content ?? '');
    deletes.add(move.from);
    const fromMesh = assetPathForScript(move.from);
    const toMesh = assetPathForScript(move.to);
    if (!fromMesh || !toMesh || fromMesh === toMesh) continue;
    const mesh = list.find((entry) => entry?.path === fromMesh);
    if (mesh == null || mesh.content == null) continue;
    const dest = list.find((entry) => entry?.path === toMesh);
    if (dest) continue;
    writes.set(toMesh, mesh.content);
    deletes.add(fromMesh);
  }
  for (const file of otherAssemblyFiles(list, name)) {
    const next = rewriteSurfForDelete(file.content || '', { moves, sourcePaths });
    if (next !== (file.content || '')) writes.set(file.path, next);
  }
  for (const path of writes.keys()) deletes.delete(path);
  const files = [
    ...[...writes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, content]) => fileWrite(path, content)),
    ...[...deletes].sort().map((path) => fileDelete(path)),
  ];
  const after = projectFiles(list, files);
  assertDeleteKeepsReferenced(list, after, refs, moves, { assemblyName: name, mode });
  assertDeleteCommitSafe(files, list, { assemblyName: name, refs, mode, moves });
  return {
    assemblyName: name,
    assemblyPath: assemblyFilePath(name),
    legacyPath: legacyAssemblyFilePath(name),
    mode,
    message: DELETE_MESSAGE(name),
    partCount: parts.length,
    referenced,
    moves,
    files,
  };
}

/** Dialog facts: part count and the parts other assemblies still reference. */
export function previewDeleteAssembly(entries, assemblyName, opts) {
  const plan = planDeleteAssembly(entries, assemblyName, 'keep', opts);
  return {
    assemblyName: plan.assemblyName,
    partCount: plan.partCount,
    referenced: plan.referenced,
  };
}

/**
 * Baseline after a delete. A switch or an empty document is the new copy.
 * An in-place update keeps the previous baseline for any file this commit
 * did not write, so an unsaved edit stays dirty.
 */
export function baselineAfterDelete(captured, { kind, files = [], pairs = [], previous = null } = {}) {
  if (kind !== 'update' || !previous || !captured) return captured;
  const wrote = (path) => (files || []).some((file) => file?.path === path && !file.delete);
  const next = {
    ...captured,
    scripts: { ...(captured.scripts || {}) },
  };
  if (!wrote(next.assemblyPath)) next.assemblyText = previous.assemblyText;
  const fromPath = new Map((pairs || []).map((pair) => [pair.to, pair.from]));
  for (const id of Object.keys(next.scripts)) {
    if (wrote(id)) continue;
    const priorPath = fromPath.get(id) || id;
    if (previous.scripts && Object.prototype.hasOwnProperty.call(previous.scripts, priorPath)) {
      next.scripts[id] = previous.scripts[priorPath];
    }
  }
  return next;
}

/**
 * When the open assembly's .surf.json is part of the commit, write the
 * in-memory document so local edits and the baseline match that file.
 * Path-less rows are promoted first; leftovers throw before the caller
 * mutates the working copy.
 * -> { files, doc, scripts, moved }
 */
export async function commitOpenAssemblyText(files, assemblyPath, doc, {
  adapter, repo, scripts = {}, branch = 'main',
} = {}) {
  if (!assemblyPath || !doc) return { files: files || [], doc, scripts, moved: [] };
  if (!adapter || !repo) {
    throw new Error('Git adapter required to write the open assembly');
  }
  // Dynamic import: gitCommit -> partVaultPath -> sharedPathForMove here.
  const { prepareAssemblySurfWrite } = await import('./gitCommit.js');
  const extras = (files || []).filter((file) => file?.path !== assemblyPath || file.delete);
  const prepared = await prepareAssemblySurfWrite(adapter, repo, {
    doc,
    scripts,
    branch,
    extraFiles: extras,
  });
  return {
    files: prepared.files,
    doc: prepared.doc,
    scripts: prepared.scripts,
    moved: prepared.moved,
  };
}

/** Apply queued ops onto a tree so a delete sees renames that are not pushed yet. */
export function projectPendingOps(entries, ops) {
  let current = entries || [];
  for (const op of ops || []) {
    if (!op || op.status === 'done') continue;
    if (op.op === 'rename' && op.payload) {
      const plan = renamePlanFromPayload(op.payload);
      current = projectFiles(current, buildRenameCommitFiles({ entries: current, plan }).files);
    } else if (Array.isArray(op.files) && op.files.length) {
      current = projectFiles(current, op.files);
    }
  }
  return current;
}

function matchMove(part, moves) {
  if (part?.surfId) {
    const byId = moves.find((move) => move.surfId && move.surfId === part.surfId);
    if (byId) return byId;
  }
  return moves.find((move) => move.from === part?.id) || null;
}

/**
 * Open document after another assembly's parts moved.
 * Paths follow the stable id, then the old path. A group whose source was
 * the deleted assembly keeps its name and source becomes null.
 */
export function applyAssemblyDeleteToDoc(doc, scripts, plan) {
  const moves = plan?.moves || [];
  const sourcePaths = new Set([plan?.assemblyPath, plan?.legacyPath].filter(Boolean));
  const parts = (doc?.parts || []).map((part) => {
    const move = matchMove(part, moves);
    if (!move || move.to === part.id) return part;
    return { ...part, id: move.to };
  });
  const active = (doc?.parts || []).find((part) => part.id === doc?.activeId);
  const activeMove = active ? matchMove(active, moves) : null;
  const activeId = activeMove ? activeMove.to : doc?.activeId;
  const groups = (doc?.groups || []).map((group) => (
    sourcePaths.has(group?.source) ? { ...group, source: null } : group
  ));
  const nextScripts = { ...(scripts || {}) };
  const pairs = [];
  for (const move of moves) {
    if (!move?.from || !move?.to || move.from === move.to) continue;
    if (Object.prototype.hasOwnProperty.call(nextScripts, move.from)) {
      if (nextScripts[move.to] == null) nextScripts[move.to] = nextScripts[move.from];
      delete nextScripts[move.from];
      pairs.push({ from: move.from, to: move.to });
    }
  }
  return {
    doc: serializeAssembly({ ...doc, source: 'git', parts, groups, activeId }),
    scripts: nextScripts,
    pairs,
  };
}

/** Load one assembly out of a projected tree. Null when that folder is gone. */
export function assemblyFromEntries(entries, assemblyName) {
  const name = vaultSegment(assemblyName);
  if (!name) return null;
  const path = assemblyFilePath(name);
  const file = (entries || []).find((entry) => entry.path === path);
  if (!file) return null;
  let doc;
  try {
    doc = parseSurfJson(file.content);
  } catch {
    return null;
  }
  const byPath = new Map((entries || []).map((entry) => [entry.path, entry.content ?? '']));
  const scripts = {};
  for (const part of doc.parts || []) scripts[part.id] = byPath.get(part.id) ?? '';
  return { doc, scripts, assemblyPath: path };
}

/**
 * After the open assembly is deleted: the most recently opened remaining
 * assembly, else the first remaining name, else null (empty working copy).
 */
export function chooseAssemblyAfterDelete(names, { deleted, recent = [] } = {}) {
  const rest = [];
  const seen = new Set();
  for (const name of names || []) {
    const seg = vaultSegment(name) || '';
    if (!seg || seg === deleted || seen.has(seg)) continue;
    seen.add(seg);
    rest.push(seg);
  }
  if (!rest.length) return null;
  for (let i = (recent || []).length - 1; i >= 0; i -= 1) {
    const seg = vaultSegment(recent[i]) || '';
    if (seg && seg !== deleted && seen.has(seg)) return seg;
  }
  return rest[0];
}

/** Working copy with no parts, used when the last assembly was deleted. */
export function emptyGitAssembly() {
  return serializeAssembly({
    source: 'git',
    name: DEFAULT_ASSEMBLY_NAME,
    activeId: null,
    parts: [],
  });
}

/**
 * What the open document becomes. `entries` is the tree after the delete.
 * -> { kind: 'switch'|'update'|'empty', doc, scripts, pairs, name? }
 */
export function workingCopyAfterDelete(doc, scripts, entries, plan, { recent = [] } = {}) {
  const openName = vaultSegment(doc?.name);
  if (openName && openName === plan?.assemblyName) {
    const nextName = chooseAssemblyAfterDelete(listAssemblies(entries), {
      deleted: plan.assemblyName,
      recent,
    });
    if (!nextName) {
      return { kind: 'empty', doc: emptyGitAssembly(), scripts: {}, pairs: [] };
    }
    const opened = assemblyFromEntries(entries, nextName);
    if (!opened) {
      return { kind: 'empty', doc: emptyGitAssembly(), scripts: {}, pairs: [] };
    }
    return { kind: 'switch', name: nextName, doc: opened.doc, scripts: opened.scripts, pairs: [], assemblyPath: opened.assemblyPath };
  }
  const applied = applyAssemblyDeleteToDoc(doc, scripts, plan);
  return { kind: 'update', doc: applied.doc, scripts: applied.scripts, pairs: applied.pairs };
}

/**
 * Reload overlay. A queued delete remaps paths in the assembly that is
 * still open. `removed` is set when this document is the deleted assembly.
 */
export function overlayPendingAssemblyDeletes(doc, scripts, ops) {
  let nextDoc = doc;
  let nextScripts = { ...(scripts || {}) };
  let removed = false;
  const pairs = [];
  for (const op of ops || []) {
    if (op?.op !== 'delete-assembly' || op.status === 'done') continue;
    const deleted = op.payload?.name;
    if (deleted && vaultSegment(nextDoc?.name) === deleted) {
      removed = true;
      continue;
    }
    const applied = applyAssemblyDeleteToDoc(nextDoc, nextScripts, {
      moves: op.payload?.moves || [],
      assemblyPath: op.payload?.assemblyPath,
      legacyPath: op.payload?.legacyPath,
    });
    nextDoc = applied.doc;
    nextScripts = applied.scripts;
    pairs.push(...applied.pairs);
  }
  return { doc: nextDoc, scripts: nextScripts, removed, pairs };
}

/** Hide assemblies a queued or failed delete has already removed locally. */
export function hidePendingDeletedAssemblies(browse, ops) {
  const hidden = new Set();
  for (const op of ops || []) {
    if (op?.op !== 'delete-assembly' || op.status === 'done') continue;
    if (op.payload?.name) hidden.add(op.payload.name);
  }
  if (!hidden.size || !browse) return browse;
  return {
    ...browse,
    assemblies: (browse.assemblies || []).filter((item) => !hidden.has(item?.name || item)),
    parts: (browse.parts || []).filter((item) => {
      const info = parseVaultPath(item?.path);
      return !(info?.kind === 'assembly-part' && hidden.has(info.assembly));
    }),
  };
}

/**
 * Replace a cache snapshot in one assignment.
 * Building `next` happens first. A throw before the assignment leaves
 * `cache.entries` as it was.
 */
export function swapDeleteCache(cache, next) {
  if (!cache || typeof cache !== 'object') throw new Error('Delete cache swap needs a cache');
  if (!Array.isArray(next)) throw new Error('Delete cache swap needs a full snapshot');
  const built = [];
  for (const entry of next) {
    if (!entry?.path) throw new Error('Delete cache snapshot has an empty path');
    built.push({ path: entry.path, content: entry.content ?? '' });
  }
  cache.entries = built;
  return cache;
}

export function deleteAssemblyFailureToast(item, err) {
  const label = item?.payload?.name || item?.payload?.label || 'assembly';
  return {
    kind: 'delete-assembly-failed',
    message: `Could not delete assembly ${label}: ${err?.message || 'failed'}`,
    actions: ['retry', 'revert'],
    opId: item?.id ?? null,
    partId: item?.payload?.partId || null,
  };
}
