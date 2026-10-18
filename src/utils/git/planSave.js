/**
 * Pure save planner (save-model v2 PR 6, docs/git-save-model.md §2.5).
 *
 *   planSave(branchTip, assemblyCommit, workingCopy, remoteTip, compareFiles) →
 *     { files, nextBranchTip, nextAssemblyCommit } | { conflict, paths }
 *
 * No I/O. Compare is an input (file list), not a GitHub call.
 * Paths are f(id) only — no moves. README.md is never planned.
 * Wired into v2 Save by executePlanSave (PR 7).
 *
 * PR 7 required extras on `workingCopy` (or the `{ doc, … }` wrapper):
 *   - `branchAssemblies` — tip `.surf.json` rows for every other assembly
 *     on the **current remote tip**. Required whenever a part-file delete
 *     is planned. Accept `{ id, parts }` or `{ json: { id, parts } }`.
 *     An unidentifiable row refuses the delete (fail closed).
 *   - `branchFiles` — `{ [path]: blobSha | { contentHash } }` from that
 *     same tip. Required to write a shared part when this AssemblyCommit
 *     has no hash for it; missing hash → conflict, never overwrite.
 *   - `repo` + `branch` (or `saveTarget: { repo, branch }`) — the Save
 *     target. When a readable BranchTip is present they must match it.
 *   - `openWorkingCopies` / `otherAssemblyCommits` — extra reference
 *     sources; they do **not** replace `branchAssemblies`.
 */
import { normalizeRepoPath } from '../assembly.js';
import { gitBlobSha, isBinaryContent, toUint8Array } from './binaryContent.js';
import { fileDelete, fileWrite, GITHUB_COMPARE_FILE_LIMIT } from './githubAdapterInterface.js';
import { assemblyIdPath, parseIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import {
  LAST_COMMIT_SCHEMA_VERSION,
  makeAssemblyCommit,
  parseAssemblyCommit,
  parseBranchTip,
} from './lastCommit.js';
import { isV2SurfId, sanitizeSurfName, withSurfId, withSurfName } from './surfId.js';
import { stringifySurfJsonV2, toSurfJsonV2 } from './surfJsonV2.js';
import { ASSEMBLIES_DIR, VAULT_MARKER_PATH, VAULT_README_PATH } from './vaultLayout.js';

const BLOB_SHA = /^[0-9a-f]{40}$/i;
const NEVER_PLAN = new Set([VAULT_README_PATH, VAULT_MARKER_PATH]);

function isBlobSha(value) {
  return typeof value === 'string' && BLOB_SHA.test(value);
}

function shaOf(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  return isBlobSha(text) ? text : null;
}

function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? ''));
}

function contentHash(content) {
  if (typeof content === 'string') return gitBlobSha(utf8Bytes(content));
  return gitBlobSha(toUint8Array(content));
}

export function stampPartScript(script, id, name) {
  const display = sanitizeSurfName(name) || 'Part';
  return withSurfName(withSurfId(typeof script === 'string' ? script : '', id), display);
}

/** Working-copy bytes match committed bytes, including Save-stamped headers. */
export function partScriptMatchesCommitted(text, committed, id, name) {
  if (typeof committed !== 'string' || typeof text !== 'string') return false;
  if (text === committed) return true;
  try {
    const stamped = stampPartScript(text, id, name);
    return stamped !== text && stamped === committed;
  } catch {
    return false;
  }
}

function workingCopyOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('planSave needs a working copy');
  }
  const nested = input.doc && typeof input.doc === 'object' && !Array.isArray(input.doc);
  if (nested && isV2SurfId(input.doc.id)) {
    return {
      ...input.doc,
      scripts: input.scripts ?? input.doc.scripts,
      meshes: input.meshes,
      assets: input.assets ?? input.doc.assets,
      now: input.now ?? input.doc.now,
      branchAssemblies: input.branchAssemblies,
      openWorkingCopies: input.openWorkingCopies,
      otherAssemblyCommits: input.otherAssemblyCommits,
      branchFiles: input.branchFiles ?? input.vaultFiles,
      deleteFromRepo: input.deleteFromRepo ?? input.doc.deleteFromRepo,
      repo: input.repo ?? input.saveTarget?.repo ?? input.doc.repo,
      branch: input.branch ?? input.saveTarget?.branch ?? input.doc.branch,
      saveTarget: input.saveTarget ?? input.doc.saveTarget,
    };
  }
  return input;
}

function scriptOf(wc, partId) {
  const scripts = wc.scripts;
  if (!scripts || typeof scripts !== 'object') return undefined;
  if (typeof scripts[partId] === 'string') return scripts[partId];
  try {
    const path = partIdPath(partId);
    if (typeof scripts[path] === 'string') return scripts[path];
  } catch {
    /* not a v2 id */
  }
  return undefined;
}

function meshOf(wc, partId) {
  const bags = [wc.meshes, wc.assets];
  for (const assets of bags) {
    if (!assets || typeof assets !== 'object') continue;
    try {
      const v2 = partMeshIdPath(partId);
      if (isBinaryContent(assets[v2])) return toUint8Array(assets[v2]);
    } catch {
      /* skip */
    }
    if (isBinaryContent(assets[partId])) return toUint8Array(assets[partId]);
    const rec = assets[partId];
    if (isBinaryContent(rec?.bytes)) return toUint8Array(rec.bytes);
  }
  return null;
}

function knownHash(path, commit, wc) {
  const key = normalizeRepoPath(path);
  if (!key) return null;
  const mine = commit?.files?.[key]?.contentHash;
  if (isBlobSha(mine)) return mine.toLowerCase();
  const branch = wc.branchFiles?.[key]?.contentHash ?? wc.branchFiles?.[key];
  if (isBlobSha(branch)) return String(branch).toLowerCase();
  for (const other of wc.otherAssemblyCommits || []) {
    const parsed = parseAssemblyCommit(other) || other;
    const hash = parsed?.files?.[key]?.contentHash;
    if (isBlobSha(hash)) return hash.toLowerCase();
  }
  return null;
}

function partRowIds(row) {
  const ids = new Set();
  if (!row || typeof row !== 'object') return ids;
  const parts = Array.isArray(row.parts) ? row.parts : (Array.isArray(row.json?.parts) ? row.json.parts : []);
  for (const part of parts) {
    if (isV2SurfId(part?.id)) ids.add(part.id);
  }
  return ids;
}

/** Other assemblies: parts[].id, groups[].partIds, or a flat partIds list. */
function referencedPartIds(row) {
  const ids = partRowIds(row);
  if (!row || typeof row !== 'object') return ids;
  const groups = Array.isArray(row.groups) ? row.groups : (Array.isArray(row.json?.groups) ? row.json.groups : []);
  for (const group of groups) {
    for (const id of Array.isArray(group?.partIds) ? group.partIds : []) {
      if (isV2SurfId(id)) ids.add(id);
    }
  }
  for (const id of Array.isArray(row.partIds) ? row.partIds : []) {
    if (isV2SurfId(id)) ids.add(id);
  }
  return ids;
}

/** This assembly’s lastCommit ownership is parts[] rows only — not groups or files. */
function lastCommitPartIds(commit) {
  return partRowIds(commit?.json);
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

const REFERENCE_KEYS = ['branchAssemblies', 'openWorkingCopies', 'otherAssemblyCommits'];

function listedReferenceInputs(input) {
  const listed = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return listed;
  const sources = [input];
  if (input.doc && typeof input.doc === 'object' && !Array.isArray(input.doc)) {
    sources.push(input.doc);
  }
  for (const src of sources) {
    for (const key of REFERENCE_KEYS) {
      if (hasOwn(src, key)) listed.push({ key, value: src[key] });
    }
  }
  return listed;
}

/** Present keys must be arrays. Empty array counts as a supplied reference set. */
function assertReferenceInputTypes(input) {
  for (const { key, value } of listedReferenceInputs(input)) {
    if (!Array.isArray(value)) {
      throw new Error(`planSave: ${key} must be an array`);
    }
  }
}

/** True when the caller supplied tip `branchAssemblies` (empty array counts). */
function branchAssembliesProvided(input) {
  return listedReferenceInputs(input).some(
    ({ key, value }) => key === 'branchAssemblies' && Array.isArray(value),
  );
}

function rowAssemblyId(row, kind = 'branch') {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
  if (kind === 'open') {
    const doc = row.doc && typeof row.doc === 'object' && !Array.isArray(row.doc) ? row.doc : row;
    const id = doc.id || row.assemblyId || doc.json?.id || row.json?.id;
    return isV2SurfId(id) ? id : '';
  }
  if (kind === 'commit') {
    const parsed = parseAssemblyCommit(row);
    const id = parsed?.assemblyId || row.assemblyId || row.json?.id || row.id;
    return isV2SurfId(id) ? id : '';
  }
  const id = row.id || row.assemblyId || row.json?.id;
  return isV2SurfId(id) ? id : '';
}

function rowAssemblyName(row, kind = 'branch') {
  if (!row || typeof row !== 'object') return '';
  if (kind === 'open') {
    const doc = row.doc && typeof row.doc === 'object' && !Array.isArray(row.doc) ? row.doc : row;
    return doc.name || row.name || doc.json?.name || row.json?.name || '';
  }
  if (kind === 'commit') {
    const parsed = parseAssemblyCommit(row) || row;
    return parsed.json?.name || row.json?.name || row.name || '';
  }
  return row.name || row.json?.name || '';
}

function referenceRowsUnidentifiable(wc) {
  for (const row of wc.branchAssemblies || []) {
    if (!rowAssemblyId(row, 'branch')) return true;
  }
  for (const row of wc.openWorkingCopies || []) {
    if (!rowAssemblyId(row, 'open')) return true;
  }
  for (const row of wc.otherAssemblyCommits || []) {
    if (!rowAssemblyId(row, 'commit')) return true;
  }
  return false;
}

function parentAssemblies(partId, wc, selfId) {
  const found = new Map();
  const consider = (id, name, ids) => {
    if (!isV2SurfId(id) || id === selfId) return;
    if (!ids.has(partId)) return;
    if (!found.has(id)) found.set(id, { id, name: name || id });
  };
  for (const row of wc.branchAssemblies || []) {
    consider(rowAssemblyId(row, 'branch'), rowAssemblyName(row, 'branch'), referencedPartIds(row));
  }
  for (const row of wc.openWorkingCopies || []) {
    const doc = row.doc && typeof row.doc === 'object' && !Array.isArray(row.doc) ? row.doc : row;
    consider(rowAssemblyId(row, 'open'), rowAssemblyName(row, 'open'), referencedPartIds(doc));
  }
  for (const row of wc.otherAssemblyCommits || []) {
    const parsed = parseAssemblyCommit(row) || row;
    consider(
      rowAssemblyId(row, 'commit'),
      rowAssemblyName(row, 'commit'),
      referencedPartIds(parsed.json || parsed),
    );
  }
  return [...found.values()];
}

function wantsDeleteFromRepo(wc, partId) {
  const flag = wc.deleteFromRepo;
  if (flag === true) return true;
  if (typeof flag === 'string') return flag === partId;
  if (Array.isArray(flag)) return flag.includes(partId);
  if (flag instanceof Set) return flag.has(partId);
  return false;
}

function compareRowPaths(row) {
  if (typeof row === 'string') return [row];
  if (!row || typeof row !== 'object') return [];
  return [row.path, row.filename, row.previous_filename];
}

function compareInput(compareFiles) {
  if (compareFiles == null) return { paths: null, truncated: true };
  if (typeof compareFiles !== 'object') return { paths: null, truncated: true };
  if (compareFiles.truncated === true || compareFiles.incomplete === true) {
    return { paths: null, truncated: true };
  }
  const rows = Array.isArray(compareFiles)
    ? compareFiles
    : (Array.isArray(compareFiles.files) ? compareFiles.files : null);
  if (!rows) return { paths: null, truncated: true };
  if (rows.length >= GITHUB_COMPARE_FILE_LIMIT) {
    return { paths: null, truncated: true };
  }
  const paths = new Set();
  for (const row of rows) {
    for (const raw of compareRowPaths(row)) {
      const path = normalizeRepoPath(raw);
      if (path) paths.add(path);
    }
  }
  return { paths, truncated: false };
}

function isAssemblySurfJson(path) {
  const p = normalizeRepoPath(path);
  return !!p && p.startsWith(`${ASSEMBLIES_DIR}/`) && p.endsWith('.surf.json');
}

function readBranchTip(branchTip) {
  if (branchTip == null) return null;
  const parsed = parseBranchTip(branchTip);
  if (!parsed) throw new Error('planSave: branchTip is present but unreadable');
  return parsed;
}

function repoRef(repo) {
  const owner = typeof repo?.owner === 'string' ? repo.owner.trim() : '';
  const name = typeof repo?.name === 'string' ? repo.name.trim() : '';
  if (!owner || !name) return null;
  return { owner, name };
}

function saveTargetOf(wc) {
  const boxed = wc.saveTarget && typeof wc.saveTarget === 'object' && !Array.isArray(wc.saveTarget)
    ? wc.saveTarget
    : null;
  const repo = repoRef(boxed?.repo || wc.repo);
  const branchRaw = boxed?.branch ?? wc.branch;
  const branch = typeof branchRaw === 'string' ? branchRaw.trim() : '';
  if (!repo || !branch) return null;
  return { repo, branch };
}

function assertTipMatchesSaveTarget(tip, wc) {
  if (!tip) return;
  const target = saveTargetOf(wc);
  if (!target) return;
  if (
    target.repo.owner !== tip.repo.owner
    || target.repo.name !== tip.repo.name
    || target.branch !== tip.branch
  ) {
    throw new Error('planSave: BranchTip repo/branch does not match the save target');
  }
}

function claimedAssemblyId(assemblyCommit, parsed) {
  if (parsed?.assemblyId) return parsed.assemblyId;
  if (!assemblyCommit || typeof assemblyCommit !== 'object' || Array.isArray(assemblyCommit)) {
    return '';
  }
  const raw = typeof assemblyCommit.assemblyId === 'string' ? assemblyCommit.assemblyId.trim() : '';
  if (isV2SurfId(raw)) return raw;
  const jsonId = typeof assemblyCommit.json?.id === 'string' ? assemblyCommit.json.id.trim() : '';
  return isV2SurfId(jsonId) ? jsonId : '';
}

function plannedPathOf(entry) {
  return entry.path;
}

function isPlannablePath(path) {
  if (!path || NEVER_PLAN.has(path)) return false;
  if (path.endsWith('/.gitkeep') || path === 'assemblies/.gitkeep' || path === 'parts/.gitkeep') {
    return false;
  }
  return !!parseIdPath(path);
}

function buildAdopt(writes, otherCommits, selfId) {
  const adoptByAsm = new Map();
  for (const write of writes) {
    if (write.delete) continue;
    const parsed = parseIdPath(write.path);
    if (!parsed || (parsed.kind !== 'part' && parsed.kind !== 'mesh')) continue;
    const nextHash = contentHash(write.content);
    for (const other of otherCommits || []) {
      const parsedOther = parseAssemblyCommit(other) || other;
      const assemblyId = parsedOther?.assemblyId;
      if (!isV2SurfId(assemblyId) || assemblyId === selfId) continue;
      const old = parsedOther.files?.[write.path]?.contentHash;
      if (!isBlobSha(old)) continue;
      let row = adoptByAsm.get(assemblyId);
      if (!row) {
        row = { assemblyId, files: {} };
        adoptByAsm.set(assemblyId, row);
      }
      row.files[write.path] = { contentHash: nextHash };
    }
  }
  return [...adoptByAsm.values()];
}

function keepFileHash(nextFiles, path, commit, wc) {
  const hash = knownHash(path, commit, wc);
  if (hash) nextFiles[path] = { contentHash: hash };
}

/**
 * @param {object|null} branchTip BranchTip (§2.4). Present-but-unreadable throws.
 * @param {object|null} assemblyCommit AssemblyCommit (§2.4) for the open assembly
 * @param {object} workingCopy AssemblyDoc + scripts/meshes and planner extras
 *   (`branchAssemblies`, `branchFiles`, `repo`/`branch` or `saveTarget` — see file header)
 * @param {string|null} remoteTip current remote branch tip sha
 * @param {object|Array|null} compareFiles compare result or its `files` list
 * @returns {{ files: object[], nextBranchTip: object|null, nextAssemblyCommit: object, adopt?: object[], partStillReferenced?: object[] } | { conflict: true, paths: string[] }}
 */
export function planSave(branchTip, assemblyCommit, workingCopy, remoteTip, compareFiles) {
  const wc = workingCopyOf(workingCopy);
  const assemblyId = typeof wc.id === 'string' ? wc.id.trim() : '';
  if (!isV2SurfId(assemblyId)) throw new Error('planSave: working copy needs a v2 assembly id');
  assertReferenceInputTypes(workingCopy);

  const tip = readBranchTip(branchTip);
  assertTipMatchesSaveTarget(tip, wc);
  const prev = parseAssemblyCommit(assemblyCommit);
  if (prev && !tip?.tipSha) {
    throw new Error('planSave: AssemblyCommit requires a readable BranchTip with tipSha');
  }
  const claimed = claimedAssemblyId(assemblyCommit, prev);
  if (claimed && claimed !== assemblyId) {
    throw new Error('planSave: assemblyCommit.assemblyId does not match workingCopy.id');
  }
  const json = toSurfJsonV2(wc);
  const jsonText = stringifySurfJsonV2(wc);
  const asmPath = assemblyIdPath(assemblyId);
  const asmHash = contentHash(jsonText);

  const writes = [];
  const deletes = [];
  const nextFiles = {};
  const partStillReferenced = [];
  const unknownHashPaths = [];

  if (knownHash(asmPath, prev, wc) !== asmHash) {
    writes.push({ path: asmPath, content: jsonText });
  }
  nextFiles[asmPath] = { contentHash: asmHash };

  const wcParts = Array.isArray(wc.parts) ? wc.parts : [];
  const wcPartIds = new Set();
  for (const part of wcParts) {
    if (!isV2SurfId(part?.id)) continue;
    wcPartIds.add(part.id);
    const jsPath = partIdPath(part.id);
    const meshPath = partMeshIdPath(part.id);
    const script = scriptOf(wc, part.id);
    const missing = part.missing === true;

    if (typeof script !== 'string') {
      // Missing vault blob: keep the row in .surf.json, never invent a .js.
      keepFileHash(nextFiles, jsPath, prev, wc);
      keepFileHash(nextFiles, meshPath, prev, wc);
      continue;
    }
    if (missing && script.length === 0) {
      keepFileHash(nextFiles, jsPath, prev, wc);
      keepFileHash(nextFiles, meshPath, prev, wc);
      continue;
    }

    const stamped = stampPartScript(script, part.id, part.name);
    const hash = contentHash(stamped);
    const existingJs = knownHash(jsPath, prev, wc);
    if (existingJs !== hash) {
      if (!existingJs && parentAssemblies(part.id, wc, assemblyId).length) {
        unknownHashPaths.push(jsPath);
      } else {
        writes.push({ path: jsPath, content: stamped });
      }
    }
    nextFiles[jsPath] = { contentHash: hash };

    const mesh = meshOf(wc, part.id);
    if (mesh) {
      const meshHash = contentHash(mesh);
      const existingMesh = knownHash(meshPath, prev, wc);
      if (existingMesh !== meshHash) {
        if (!existingMesh && parentAssemblies(part.id, wc, assemblyId).length) {
          unknownHashPaths.push(meshPath);
        } else {
          writes.push({ path: meshPath, content: mesh });
        }
      }
      nextFiles[meshPath] = { contentHash: meshHash };
    } else {
      keepFileHash(nextFiles, meshPath, prev, wc);
    }
  }

  for (const partId of lastCommitPartIds(prev)) {
    if (wcPartIds.has(partId)) continue;
    const jsPath = partIdPath(partId);
    const meshPath = partMeshIdPath(partId);
    const parents = parentAssemblies(partId, wc, assemblyId);
    if (parents.length) {
      if (wantsDeleteFromRepo(wc, partId)) {
        partStillReferenced.push({ partId, assemblies: parents });
      }
      continue;
    }
    if (knownHash(jsPath, prev, wc)) deletes.push(jsPath);
    if (knownHash(meshPath, prev, wc)) deletes.push(meshPath);
  }

  const planned = [];
  for (const write of writes) {
    if (isPlannablePath(write.path)) planned.push(write);
  }
  const plannedDeletes = [];
  for (const path of deletes) {
    if (isPlannablePath(path)) plannedDeletes.push(path);
  }
  if (plannedDeletes.length) {
    if (!branchAssembliesProvided(workingCopy)) {
      throw new Error('planSave: part file delete requires branchAssemblies from the current remote tip');
    }
    if (referenceRowsUnidentifiable(wc)) {
      throw new Error('planSave: part file delete refused: a reference row has no v2 assembly id');
    }
  }
  if (unknownHashPaths.length) {
    return { conflict: true, paths: [...new Set(unknownHashPaths)].sort() };
  }

  const plannedPaths = [
    ...planned.map(plannedPathOf),
    ...plannedDeletes,
  ];

  const tipSha = tip?.tipSha ?? null;
  const remoteSha = shaOf(remoteTip);
  // §2.5: tipSha set and remoteTip !== tipSha → compare. Unknown / invalid
  // remote tip is the same fail-closed refusal as a truncated compare.
  if (tipSha && plannedPaths.length && remoteSha !== tipSha) {
    if (!remoteSha) {
      return { conflict: true, paths: [...plannedPaths].sort() };
    }
    const cmp = compareInput(compareFiles);
    if (cmp.truncated) {
      return { conflict: true, paths: [...plannedPaths].sort() };
    }
    const overlap = plannedPaths.filter((path) => cmp.paths.has(path));
    const assemblyHits = plannedDeletes.length
      ? [...cmp.paths].filter(isAssemblySurfJson)
      : [];
    if (overlap.length || assemblyHits.length) {
      const paths = new Set(overlap);
      if (assemblyHits.length) {
        for (const path of assemblyHits) paths.add(path);
        for (const path of plannedDeletes) paths.add(path);
      }
      return { conflict: true, paths: [...paths].sort() };
    }
  }

  planned.sort((a, b) => a.path.localeCompare(b.path));
  plannedDeletes.sort();
  const files = [
    ...planned.map((file) => fileWrite(file.path, file.content)),
    ...plannedDeletes.map((path) => fileDelete(path)),
  ];

  const nextAssemblyCommit = makeAssemblyCommit({
    assemblyId,
    files: nextFiles,
    json,
    capturedAt: Number.isFinite(Number(wc.now)) ? Number(wc.now) : (prev?.capturedAt ?? 0),
  });
  if (!nextAssemblyCommit) throw new Error('planSave: next AssemblyCommit is invalid');

  const nextBranchTip = tip
    ? parseBranchTip({
      schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
      repo: tip.repo,
      branch: tip.branch,
      tipSha: tip.tipSha,
    })
    : null;

  const result = { files, nextBranchTip, nextAssemblyCommit };
  const adopt = buildAdopt(planned, wc.otherAssemblyCommits, assemblyId);
  if (adopt.length) result.adopt = adopt;
  if (partStillReferenced.length) result.partStillReferenced = partStillReferenced;
  return result;
}
