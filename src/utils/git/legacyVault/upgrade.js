// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Upgrade vault: one commit of remote / tip bytes from v1 → v2, plus deletes.
 * Never folds working-copy edits into that commit. Never createRepo.
 *
 * PR 7 replaces planWorkingCopyFollowup (the second commit) with planSave
 * + writeVaultCommit. Until then the follow-up lives in this file, marked.
 */
import { bytesEqual, isBinaryContent, toUint8Array } from '../binaryContent.js';
import {
  assertGithubAdapter,
  fileDelete,
  fileWrite,
  GitAdapterError,
} from '../githubAdapterInterface.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../idPaths.js';
import { captureLastCommit } from '../lastCommit.js';
import {
  isSurfId,
  isV2SurfId,
  mintSurfId,
  promoteSurfId,
  readSurfId,
  readSurfName,
  rewriteColorMap,
  rewriteJointSurfIds,
  sanitizeSurfName,
  withSurfId,
  withSurfName,
} from '../surfId.js';
import { pruneDanglingColors, pruneDanglingGroupPartIds } from '../surfJson.js';
import { stringifySurfJsonV2 } from '../surfJsonV2.js';
import { pruneDanglingSurfJoints } from '../../jointSchema.js';
import { VAULT_MARKER_KIND, VAULT_MARKER_PATH } from '../vaultNames.js';
import { VAULT_README_PATH } from '../vaultLayout.js';
import {
  detectVaultLayout,
  normalizeLegacyPath,
  parseLegacyVaultPath,
} from './detect.js';
import { isKnownReadmeSeed } from './knownReadmeSeeds.js';

export const UPGRADE_COMMIT_MESSAGE = 'Upgrade vault to v2 layout';
export const UPGRADE_FOLLOWUP_MESSAGE = 'Save after vault upgrade';
export const SURFCAD_JSON_V2 = `${JSON.stringify({ kind: VAULT_MARKER_KIND, version: 2 }, null, 2)}\n`;

function sidecarMeshPath(scriptPath) {
  if (!scriptPath || !/\.js$/i.test(scriptPath)) return null;
  return scriptPath.replace(/\.js$/i, '.mesh');
}

function scriptPathOf(part) {
  if (typeof part?.path === 'string' && part.path.trim()) return part.path;
  const id = String(part?.id || '');
  return id.includes('/') && id.endsWith('.js') ? id : null;
}

function stemName(path) {
  const p = String(path || '').replace(/\\/g, '/');
  const leaf = p.split('/').pop() || '';
  return leaf.replace(/\.js$/i, '') || 'Part';
}

function mintUnused(used, { now, rand } = {}) {
  let id = mintSurfId({ now, rand });
  if (!used.has(id)) return id;
  const parsed = Number.parseInt(String(rand ?? '0'), 16);
  const start = Number.isFinite(parsed) ? parsed : 0;
  for (let n = 1; n < 0x10000; n += 1) {
    id = mintSurfId({
      now,
      rand: ((start + n) & 0xffff).toString(16).padStart(4, '0'),
    });
    if (!used.has(id)) return id;
  }
  return mintSurfId({ now });
}

function asV2Id(value) {
  if (!isSurfId(value)) return null;
  const id = promoteSurfId(value);
  return isV2SurfId(id) ? id : null;
}

/**
 * Row `parts[].id` wins. A copy file may still carry the original's
 * `// @surf-id` (PinCopy.js naming Pin); restamp to the row id.
 * Header is used only when the row has no id. Duplicate ids in one
 * `.surf.json` mint a copy with `copiedFrom`. The same id in two
 * assemblies is a shared reference when it is the same file.
 */
function pickPartId(part, script, pathIndex, used, seenInAssembly, mintOpts) {
  const path = scriptPathOf(part);
  const rowId = asV2Id(part?.id);
  const header = asV2Id(readSurfId(script || ''));
  const cached = path ? asV2Id(pathIndex[path]) : null;

  const keep = (id, restamp) => {
    if (!id) return null;
    if (seenInAssembly.has(id)) return null;
    if (used.has(id) && cached !== id) return null;
    return { id, minted: false, restamp: !!restamp };
  };

  if (rowId) {
    const hit = keep(rowId, header != null && header !== rowId);
    if (hit) return hit;
    return {
      id: mintUnused(used, mintOpts),
      minted: true,
      copiedFrom: rowId,
      restamp: true,
    };
  }
  const fromHeader = keep(header, false);
  if (fromHeader) return fromHeader;
  const fromCache = keep(cached, header != null && cached != null && header !== cached);
  if (fromCache) return fromCache;
  return {
    id: mintUnused(used, mintOpts),
    minted: true,
    restamp: true,
    copiedFrom: header && (seenInAssembly.has(header) || used.has(header)) ? header : null,
  };
}

function folderFromGroupSource(source) {
  const p = normalizeLegacyPath(source) || String(source || '').trim();
  if (!p) return null;
  const info = parseLegacyVaultPath(p);
  if (info?.kind === 'assembly-meta' || info?.kind === 'assembly-part') return info.assembly;
  if (p.startsWith('assemblies/')) {
    const seg = p.split('/')[1];
    return seg || null;
  }
  if (!p.includes('/')) return p;
  return null;
}

function mapGroupSource(source, folderToId) {
  if (source == null) return null;
  if (isV2SurfId(source) && folderToId && Object.values(folderToId).includes(source)) {
    return source;
  }
  const folder = folderFromGroupSource(source);
  if (!folder || !folderToId) return null;
  if (folderToId[folder]) return folderToId[folder];
  const key = folder.toLowerCase();
  for (const [name, id] of Object.entries(folderToId)) {
    if (name.toLowerCase() === key) return id;
  }
  return null;
}

function rewriteIds(list, map) {
  if (!Array.isArray(list)) return list;
  return list.map((id) => map.get(id) || id);
}

function stampScript(script, id, name) {
  const display = sanitizeSurfName(name) || 'Part';
  return withSurfName(withSurfId(typeof script === 'string' ? script : '', id), display);
}

function displayNameFor(part, script, path) {
  return sanitizeSurfName(readSurfName(script) || part?.name || stemName(path)) || 'Part';
}

/**
 * Remote v1 bytes, including files the strict v1 validator rejects
 * (duplicate `parts[].id`). Do not run `parseSurfJson` here — that
 * remaps missing ids to paths and throws on duplicates.
 */
function parseLegacyJson(content) {
  if (content == null || isBinaryContent(content)) return null;
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.version === 2) return null;
    if (!Array.isArray(parsed.parts)) return null;
    return pruneDanglingSurfJoints(pruneDanglingColors(pruneDanglingGroupPartIds(parsed)));
  } catch {
    return null;
  }
}

function isLegacyTreePath(path) {
  const info = parseLegacyVaultPath(path);
  if (!info) return false;
  if (info.kind === 'assembly-meta' || info.kind === 'assembly-part' || info.kind === 'shared-part') {
    return true;
  }
  const p = normalizeLegacyPath(path);
  if (!p) return false;
  if (p === 'assemblies/.gitkeep' || p === 'parts/.gitkeep') return true;
  if (p.endsWith('.mesh')) {
    const js = p.slice(0, -'.mesh'.length) + '.js';
    const jsInfo = parseLegacyVaultPath(js);
    return jsInfo?.kind === 'assembly-part' || jsInfo?.kind === 'shared-part';
  }
  const segs = p.split('/');
  if (segs[0] === 'assemblies' && segs.length >= 3) return true;
  return false;
}

function filePayload(path, content) {
  if (isBinaryContent(content)) return fileWrite(path, toUint8Array(content));
  return fileWrite(path, content);
}

function contentsEqual(a, b) {
  if (isBinaryContent(a) || isBinaryContent(b)) {
    const left = isBinaryContent(a) ? toUint8Array(a) : null;
    const right = isBinaryContent(b) ? toUint8Array(b) : null;
    return !!(left && right && bytesEqual(left, right));
  }
  return String(a ?? '') === String(b ?? '');
}

function meshBytesOf(assets, partId) {
  if (!assets || typeof assets !== 'object') return null;
  try {
    const v2 = partMeshIdPath(partId);
    if (isBinaryContent(assets[v2])) return toUint8Array(assets[v2]);
  } catch { /* skip */ }
  if (isBinaryContent(assets[partId])) return toUint8Array(assets[partId]);
  const rec = assets[partId];
  if (isBinaryContent(rec?.bytes)) return toUint8Array(rec.bytes);
  if (isBinaryContent(rec)) return toUint8Array(rec);
  for (const [key, val] of Object.entries(assets)) {
    if (!key.includes(partId)) continue;
    if (isBinaryContent(val)) return toUint8Array(val);
    if (isBinaryContent(val?.bytes)) return toUint8Array(val.bytes);
  }
  return null;
}

/**
 * Pure planner. `files` is path → UTF-8 string or Uint8Array from the tip.
 * Ids: `.surf.json` `parts[].id` wins over a stale blob header (copies);
 * fall back to `// @surf-id` when the row has no id; mint when neither
 * is usable. Duplicate ids in one file become a copy + `copiedFrom`.
 * One assembly id per legacy folder (reuse `assemblyIdByFolder`).
 */
export function planUpgrade({
  tree = [],
  files = {},
  baseSha = null,
  assemblyIdByFolder = {},
  pathIndex = {},
  repoName = null,
  now,
  randFor,
} = {}) {
  const paths = (tree || []).map((entry) => entry?.path ?? entry).filter(Boolean);
  const usedPart = new Set();
  const usedAsm = new Set(Object.values(assemblyIdByFolder || {}).filter((id) => isV2SurfId(id)));
  const partIdByPath = { ...(pathIndex || {}) };
  const partBindings = [];
  const mintedPartIds = [];
  const keptPartIds = [];
  const folderToId = { ...(assemblyIdByFolder || {}) };
  const mintedAssemblyIds = [];
  const assemblies = [];
  const writes = {};
  const writeFiles = [];

  const mintOptsFor = (token, index) => ({
    now,
    rand: typeof randFor === 'function' ? randFor(token, index) : undefined,
  });

  const bindPart = (part, index, seenInAssembly) => {
    const path = scriptPathOf(part);
    const script = path && typeof files[path] === 'string' ? files[path] : '';
    const picked = pickPartId(
      part,
      script,
      partIdByPath,
      usedPart,
      seenInAssembly,
      mintOptsFor(part, index),
    );
    usedPart.add(picked.id);
    seenInAssembly.add(picked.id);
    const rowId = asV2Id(part?.id);
    if (rowId) seenInAssembly.add(rowId);
    if (path) partIdByPath[path] = picked.id;
    partBindings.push({ path, id: picked.id, minted: picked.minted, copiedFrom: picked.copiedFrom || null });
    if (picked.minted) mintedPartIds.push(picked.id);
    else keptPartIds.push(picked.id);
    return {
      id: picked.id,
      path,
      script,
      minted: picked.minted,
      copiedFrom: picked.copiedFrom || null,
    };
  };

  const metaPaths = [];
  const seenFolder = new Set();
  for (const path of paths) {
    const info = parseLegacyVaultPath(path);
    if (info?.kind !== 'assembly-meta') continue;
    const key = String(info.assembly || '').toLowerCase();
    if (!key || seenFolder.has(key)) continue;
    seenFolder.add(key);
    metaPaths.push({ folder: info.assembly, path });
  }
  metaPaths.sort((a, b) => a.folder.localeCompare(b.folder));

  for (const { folder } of metaPaths) {
    if (!folderToId[folder] || !isV2SurfId(folderToId[folder])) {
      const id = mintUnused(usedAsm, mintOptsFor({ id: '$assembly', name: folder }, -1));
      usedAsm.add(id);
      folderToId[folder] = id;
      mintedAssemblyIds.push(id);
    } else {
      usedAsm.add(folderToId[folder]);
    }
  }

  for (const { folder, path: metaPath } of metaPaths) {
    const parsed = parseLegacyJson(files[metaPath]);
    if (!parsed) continue;
    const assemblyId = folderToId[folder];
    const idMap = new Map();
    const nextParts = [];
    const seenInAssembly = new Set();
    (parsed.parts || []).forEach((part, i) => {
      const bound = bindPart(part, i, seenInAssembly);
      if (part?.id && part.id !== bound.id && !nextParts.some((row) => row.id === asV2Id(part.id))) {
        idMap.set(part.id, bound.id);
      }
      if (bound.path) idMap.set(bound.path, bound.id);
      const name = displayNameFor(part, bound.script, bound.path);
      const row = {
        id: bound.id,
        name,
        visible: part.visible !== false,
        order: Number.isInteger(part.order) ? part.order : i,
      };
      if (part.position) row.position = part.position;
      if (part.placement) row.placement = part.placement;
      if (part.sheetMetal) row.sheetMetal = part.sheetMetal;
      const copied = bound.copiedFrom || asV2Id(part.copiedFrom);
      if (copied && copied !== bound.id) row.copiedFrom = copied;
      nextParts.push(row);

      if (typeof bound.script === 'string' && bound.script.length) {
        const dest = partIdPath(bound.id);
        writes[dest] = stampScript(bound.script, bound.id, name);
      }
      const meshPath = sidecarMeshPath(bound.path);
      if (meshPath && isBinaryContent(files[meshPath])) {
        writes[partMeshIdPath(bound.id)] = toUint8Array(files[meshPath]);
      }
    });

    let activeId = parsed.activeId == null ? null : parsed.activeId;
    if (activeId && idMap.has(activeId)) activeId = idMap.get(activeId);
    if (activeId && !nextParts.some((p) => p.id === activeId)) {
      const hit = nextParts.find((p) => p.id === asV2Id(activeId));
      activeId = hit ? hit.id : (nextParts[0]?.id || null);
    }
    if (activeId && !isV2SurfId(activeId)) activeId = nextParts[0]?.id || null;

    const groups = Array.isArray(parsed.groups)
      ? parsed.groups.map((group, gi) => {
        const existing = asV2Id(group?.id);
        const taken = existing && (
          usedAsm.has(existing)
          || usedPart.has(existing)
          || nextParts.some((p) => p.id === existing)
        );
        const gid = existing && !taken
          ? existing
          : mintUnused(usedAsm, mintOptsFor({ id: '$group', name: group?.name }, gi));
        usedAsm.add(gid);
        return {
          id: gid,
          name: sanitizeSurfName(group?.name) || 'Group',
          source: mapGroupSource(group?.source, folderToId),
          partIds: [...new Set(rewriteIds(group?.partIds, idMap).filter((id) => isV2SurfId(id)))],
        };
      }).filter((group) => group.partIds.length)
      : undefined;

    const colors = parsed.colors ? rewriteColorMap(parsed.colors, idMap) : undefined;
    const joints = parsed.joints ? rewriteJointSurfIds(parsed.joints, idMap) : undefined;
    const jsonText = stringifySurfJsonV2({
      id: assemblyId,
      name: sanitizeSurfName(parsed.name) || folder,
      activeId,
      parts: nextParts,
      groups,
      colors,
      joints,
    });
    const jsonPath = assemblyIdPath(assemblyId);
    writes[jsonPath] = jsonText;
    assemblies.push({
      id: assemblyId,
      folder,
      name: sanitizeSurfName(parsed.name) || folder,
      jsonPath,
      jsonText,
    });
  }

  for (const path of paths) {
    const info = parseLegacyVaultPath(path);
    if (info?.kind !== 'shared-part' && info?.kind !== 'assembly-part') continue;
    if (partIdByPath[path]) {
      const id = partIdByPath[path];
      const dest = partIdPath(id);
      if (writes[dest]) continue;
      const script = typeof files[path] === 'string' ? files[path] : '';
      if (!script) continue;
      usedPart.add(id);
      writes[dest] = stampScript(script, id, displayNameFor({ name: stemName(path) }, script, path));
      const meshPath = sidecarMeshPath(path);
      if (meshPath && isBinaryContent(files[meshPath])) {
        writes[partMeshIdPath(id)] = toUint8Array(files[meshPath]);
      }
      continue;
    }
    const script = typeof files[path] === 'string' ? files[path] : '';
    if (!script) continue;
    const picked = pickPartId(
      { path, name: stemName(path) },
      script,
      partIdByPath,
      usedPart,
      usedPart,
      mintOptsFor({ path }, 0),
    );
    usedPart.add(picked.id);
    partIdByPath[path] = picked.id;
    partBindings.push({ path, id: picked.id, minted: picked.minted });
    if (picked.minted) mintedPartIds.push(picked.id);
    else keptPartIds.push(picked.id);
    writes[partIdPath(picked.id)] = stampScript(
      script,
      picked.id,
      displayNameFor({ name: stemName(path) }, script, path),
    );
    const meshPath = sidecarMeshPath(path);
    if (meshPath && isBinaryContent(files[meshPath])) {
      writes[partMeshIdPath(picked.id)] = toUint8Array(files[meshPath]);
    }
  }

  writes[VAULT_MARKER_PATH] = SURFCAD_JSON_V2;

  const writePaths = new Set(Object.keys(writes));
  const deletes = [];
  let readmeDeleted = false;
  let readmeKept = false;
  for (const path of paths) {
    if (writePaths.has(path)) continue;
    if (path === VAULT_README_PATH) {
      if (isKnownReadmeSeed(files[path], repoName)) {
        deletes.push(path);
        readmeDeleted = true;
      } else if (files[path] != null) {
        readmeKept = true;
      }
      continue;
    }
    if (isLegacyTreePath(path)) deletes.push(path);
  }

  for (const path of [...writePaths].sort()) {
    writeFiles.push(filePayload(path, writes[path]));
  }
  deletes.sort();
  const filesOut = [
    ...writeFiles,
    ...deletes.map((path) => fileDelete(path)),
  ];

  return {
    alreadyUpgraded: false,
    baseSha: baseSha || null,
    files: filesOut,
    writes,
    deletes,
    assemblies,
    partBindings,
    folderToId,
    partIdByPath,
    mintedPartIds,
    mintedAssemblyIds,
    keptPartIds,
    readmeDeleted,
    readmeKept,
  };
}

/**
 * TEMPORARY: PR 7 replaces this with planSave against AssemblyCommit.
 * Second commit only: WC edits relative to the v2 bytes from commit 1.
 * Never used for the Upgrade commit.
 */
export function planWorkingCopyFollowup(plan, workingCopy) {
  if (!workingCopy?.dirty || !workingCopy?.doc || !plan?.writes) return [];
  const doc = workingCopy.doc;
  const assemblyId = asV2Id(doc.id);
  if (!assemblyId) return [];
  const scripts = workingCopy.scripts || {};
  const folderToId = plan.folderToId || {};
  const parts = (doc.parts || []).map((part, i) => {
    const id = asV2Id(part.id);
    if (!id) return null;
    const script = typeof scripts[id] === 'string' ? scripts[id] : '';
    const name = sanitizeSurfName(part.name) || displayNameFor(part, script, part.path);
    const row = {
      id,
      name,
      visible: part.visible !== false,
      order: Number.isInteger(part.order) ? part.order : i,
    };
    if (part.position) row.position = part.position;
    if (part.placement) row.placement = part.placement;
    if (part.sheetMetal) row.sheetMetal = part.sheetMetal;
    const copied = asV2Id(part.copiedFrom);
    if (copied) row.copiedFrom = copied;
    return row;
  }).filter(Boolean);

  const groups = Array.isArray(doc.groups)
    ? doc.groups.map((group) => ({
      id: asV2Id(group.id) || group.id,
      name: sanitizeSurfName(group.name) || 'Group',
      source: mapGroupSource(group.source, folderToId),
      partIds: (group.partIds || []).map((id) => asV2Id(id) || id).filter((id) => isV2SurfId(id)),
    })).filter((group) => isV2SurfId(group.id) && group.partIds.length)
    : undefined;

  let activeId = asV2Id(doc.activeId);
  if (activeId && !parts.some((p) => p.id === activeId)) activeId = parts[0]?.id || null;

  const jsonText = stringifySurfJsonV2({
    id: assemblyId,
    name: sanitizeSurfName(doc.name) || 'Assembly',
    activeId,
    parts,
    groups,
    colors: doc.colors,
    joints: doc.joints,
  });

  const out = [];
  const asmPath = assemblyIdPath(assemblyId);
  if (jsonText !== plan.writes[asmPath]) out.push(fileWrite(asmPath, jsonText));

  for (const part of parts) {
    const script = scripts[part.id];
    if (typeof script !== 'string') continue;
    const stamped = stampScript(script, part.id, part.name);
    const dest = partIdPath(part.id);
    if (stamped !== plan.writes[dest]) out.push(fileWrite(dest, stamped));
    const mesh = meshBytesOf(workingCopy.assets, part.id);
    if (mesh) {
      const meshPath = partMeshIdPath(part.id);
      const prev = plan.writes[meshPath];
      if (!prev || !contentsEqual(prev, mesh)) out.push(fileWrite(meshPath, mesh));
    }
  }
  return out;
}

function overlapPaths(planned, compareFiles) {
  const want = new Set((planned || []).map((f) => f.path));
  const hit = [];
  for (const row of compareFiles || []) {
    const path = row?.path;
    if (path && want.has(path)) hit.push(path);
  }
  return hit.sort();
}

async function loadTreeContents(adapter, repo, ref, tree) {
  const files = {};
  for (const entry of tree || []) {
    const path = entry?.path;
    if (!path) continue;
    if (/\.mesh$/i.test(path) && entry.sha) {
      const bytes = await adapter.readBlob(repo, entry.sha);
      if (bytes instanceof Uint8Array) files[path] = bytes;
      continue;
    }
    const got = await adapter.readFile(repo, path, ref);
    if (got && got.content != null) files[path] = got.content;
  }
  return files;
}

async function persistPlanIds(store, repo, plan) {
  if (!store) return;
  for (const row of plan.assemblies || []) {
    if (row.folder && row.id && typeof store.rememberAssemblyId === 'function') {
      await store.rememberAssemblyId(repo, row.folder, row.id);
    }
  }
  if (typeof store.rememberPathId === 'function') {
    for (const row of plan.partBindings || []) {
      if (row.path && row.id) await store.rememberPathId(repo, row.path, row.id);
    }
  }
}

async function captureAllLastCommit({
  adapter, repo, branch, store, sha, assemblies, now,
}) {
  const rows = assemblies || [];
  if (!rows.length) {
    return [await captureLastCommit({
      adapter,
      repo,
      branch,
      store,
      headSha: sha,
      persistBranchTip: true,
      persistAssemblyCommit: false,
      now,
    })];
  }
  const commits = [];
  let first = true;
  for (const row of rows) {
    const captured = await captureLastCommit({
      adapter,
      repo,
      branch,
      store,
      assemblyId: row.id,
      headSha: sha,
      persistBranchTip: first,
      persistAssemblyCommit: true,
      now,
    });
    first = false;
    commits.push(captured);
  }
  return commits;
}

function hostError(code, message, hint, extra = {}) {
  return {
    status: code === 'conflict' ? 'conflict' : 'error',
    code,
    error: message,
    message,
    hint,
    ...extra,
  };
}

/**
 * Execute Upgrade against the remote tip. One commit of remote bytes.
 * Dirty WC → a second commit (PR 7 replacement) under the same call.
 * createRepo is never called. Partial failure does not write lastCommit.
 */
export async function executeUpgrade({
  adapter,
  repo,
  branch = 'main',
  store = null,
  workingCopy = null,
  now,
  randFor,
  followupOverwrite = false,
} = {}) {
  assertGithubAdapter(adapter);
  const ref = repo;
  const clock = now instanceof Date || typeof now === 'number' ? now : new Date();
  const capturedAt = clock instanceof Date ? clock.getTime() : clock;
  const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
  const detected = await detectVaultLayout(adapter, ref, branchName);
  if (detected.layout === 'v2') {
    return { status: 'already_upgraded', layout: 'v2' };
  }

  const head = await adapter.getBranch(ref, branchName);
  const baseSha = head?.sha || null;
  if (!baseSha) {
    return hostError(
      'git_error',
      'No branch tip to upgrade',
      'Open a vault with commits, then retry Upgrade vault.',
    );
  }

  const tree = await adapter.listTree(ref, baseSha);
  const files = await loadTreeContents(adapter, ref, baseSha, tree);
  const plan = planUpgrade({
    tree,
    files,
    baseSha,
    assemblyIdByFolder: store?.assemblyIdIndexFor?.(ref) || {},
    pathIndex: store?.pathIndexFor?.(ref) || {},
    repoName: ref?.name,
    now: clock,
    randFor,
  });

  await persistPlanIds(store, ref, plan);

  let upgradeSha = null;
  try {
    const committed = await adapter.commitFiles(ref, {
      branch: branchName,
      message: UPGRADE_COMMIT_MESSAGE,
      files: plan.files,
      baseSha,
    });
    upgradeSha = committed.sha;
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return hostError(
        'conflict',
        'Remote tip moved since the upgrade plan. Nothing was written.',
        'Retry Upgrade vault to re-plan against the current tip.',
        { phase: 'upgrade', paths: [] },
      );
    }
    return hostError(
      err?.code || 'git_error',
      err?.message || 'Upgrade commit failed',
      'The vault is still v1. Retry Upgrade vault (idempotent).',
    );
  }

  try {
    await captureAllLastCommit({
      adapter,
      repo: ref,
      branch: branchName,
      store,
      sha: upgradeSha,
      assemblies: plan.assemblies,
      now: capturedAt,
    });
  } catch (err) {
    console.warn('[git] lastCommit after Upgrade skipped', err?.message || err);
  }

  const followup = planWorkingCopyFollowup(plan, workingCopy);
  if (!followup.length) {
    return {
      status: 'upgraded',
      sha: upgradeSha,
      branch: branchName,
      files: plan.files.map((f) => f.path),
      plan,
      commits: 1,
    };
  }

  const after = await adapter.getBranch(ref, branchName);
  const remoteSha = after?.sha || upgradeSha;
  if (!followupOverwrite && remoteSha !== upgradeSha) {
    let compare;
    try {
      compare = await adapter.compare(ref, upgradeSha, remoteSha);
    } catch {
      return hostError(
        'conflict',
        'Remote tip moved after Upgrade. The follow-up Save was not written.',
        'Overwrite, Get latest, Save mine to a new branch, or Dismiss.',
        {
          phase: 'save',
          paths: followup.map((f) => f.path),
          files: followup,
          upgradeSha,
          remoteSha,
        },
      );
    }
    const overlap = overlapPaths(followup, compare.files);
    if (overlap.length) {
      return hostError(
        'conflict',
        'The follow-up Save overlaps files changed on the remote after Upgrade.',
        'Overwrite, Get latest, Save mine to a new branch, or Dismiss.',
        {
          phase: 'save',
          paths: overlap,
          files: followup,
          upgradeSha,
          remoteSha,
        },
      );
    }
  }

  try {
    const saved = await adapter.commitFiles(ref, {
      branch: branchName,
      message: (typeof workingCopy?.message === 'string' && workingCopy.message.trim())
        ? workingCopy.message.trim()
        : UPGRADE_FOLLOWUP_MESSAGE,
      files: followup,
      baseSha: remoteSha,
    });
    try {
      const openId = asV2Id(workingCopy?.doc?.id);
      const rows = openId
        ? plan.assemblies.filter((row) => row.id === openId)
        : plan.assemblies;
      await captureAllLastCommit({
        adapter,
        repo: ref,
        branch: branchName,
        store,
        sha: saved.sha,
        assemblies: rows.length ? rows : plan.assemblies,
        now: capturedAt,
      });
    } catch (err) {
      console.warn('[git] lastCommit after Upgrade Save skipped', err?.message || err);
    }
    return {
      status: 'upgraded_and_saved',
      sha: saved.sha,
      upgradeSha,
      branch: branchName,
      files: followup.map((f) => f.path),
      upgradeFiles: plan.files.map((f) => f.path),
      plan,
      commits: 2,
    };
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return hostError(
        'conflict',
        'The follow-up Save could not land; the vault is already v2.',
        'Overwrite, Get latest, Save mine to a new branch, or Dismiss.',
        {
          phase: 'save',
          paths: followup.map((f) => f.path),
          files: followup,
          upgradeSha,
        },
      );
    }
    return hostError(
      err?.code || 'git_error',
      err?.message || 'Follow-up Save failed',
      'The vault is v2. Retry Save, or Overwrite / Get latest / Save mine to a new branch / Dismiss.',
      { phase: 'save', upgradeSha, files: followup },
    );
  }
}

/** Overwrite the follow-up Save against the current remote tip (§2.9). */
export async function executeUpgradeFollowup({
  adapter,
  repo,
  branch = 'main',
  files,
  message,
  store = null,
  assemblyId = null,
  now,
} = {}) {
  assertGithubAdapter(adapter);
  if (!Array.isArray(files) || !files.length) {
    return { status: 'clean' };
  }
  const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
  const head = await adapter.getBranch(repo, branchName);
  const committed = await adapter.commitFiles(repo, {
    branch: branchName,
    message: (typeof message === 'string' && message.trim()) ? message.trim() : UPGRADE_FOLLOWUP_MESSAGE,
    files,
    baseSha: head?.sha || null,
  });
  if (assemblyId && store) {
    await captureLastCommit({
      adapter,
      repo,
      branch: branchName,
      store,
      assemblyId,
      headSha: committed.sha,
      persistBranchTip: true,
      persistAssemblyCommit: true,
      now,
    });
  }
  return { status: 'committed', sha: committed.sha, branch: branchName, files: files.map((f) => f.path) };
}

/**
 * TEMPORARY: §2.9 on the follow-up Save only. PR 7 replaces this with the
 * shared conflict dialog + planSave. Get latest never writes git.
 */
export async function executeUpgradeConflictChoice({
  action,
  adapter,
  repo,
  branch = 'main',
  files,
  message,
  store = null,
  assemblyId = null,
  now,
} = {}) {
  if (action === 'overwrite') {
    return executeUpgradeFollowup({
      adapter, repo, branch, files, message, store, assemblyId, now,
    });
  }
  if (action === 'reload') {
    assertGithubAdapter(adapter);
    const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
    const head = await adapter.getBranch(repo, branchName);
    const headSha = head?.sha || null;
    const contents = {};
    for (const row of files || []) {
      const path = row?.path;
      if (!path) continue;
      if (/\.mesh$/i.test(path)) {
        if (!headSha) continue;
        const tree = await adapter.listTree(repo, headSha);
        const entry = (tree || []).find((item) => item?.path === path);
        if (entry?.sha) {
          const bytes = await adapter.readBlob(repo, entry.sha);
          if (bytes instanceof Uint8Array) contents[path] = bytes;
        }
        continue;
      }
      const got = await adapter.readFile(repo, path, headSha || branchName);
      if (got?.content != null) contents[path] = got.content;
    }
    if (store && headSha) {
      await captureLastCommit({
        adapter,
        repo,
        branch: branchName,
        store,
        assemblyId,
        headSha,
        persistBranchTip: true,
        persistAssemblyCommit: !!assemblyId,
        now,
      });
    }
    return {
      status: 'reloaded',
      files: Object.keys(contents).sort(),
      contents,
    };
  }
  if (action === 'branch') {
    assertGithubAdapter(adapter);
    if (!Array.isArray(files) || !files.length) {
      return { status: 'clean' };
    }
    const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
    const head = await adapter.getBranch(repo, branchName);
    const fromSha = head?.sha || null;
    const stamp = typeof now === 'number' ? now : Date.now();
    const next = `save-after-upgrade-${stamp.toString(36)}`;
    const created = await adapter.createBranch(repo, next, fromSha);
    const committed = await adapter.commitFiles(repo, {
      branch: next,
      message: (typeof message === 'string' && message.trim()) ? message.trim() : UPGRADE_FOLLOWUP_MESSAGE,
      files,
      baseSha: created?.sha || fromSha,
    });
    if (assemblyId && store) {
      await captureLastCommit({
        adapter,
        repo,
        branch: next,
        store,
        assemblyId,
        headSha: committed.sha,
        persistBranchTip: true,
        persistAssemblyCommit: true,
        now,
      });
    }
    return {
      status: 'branched',
      branch: next,
      sha: committed.sha,
      files: files.map((f) => f.path),
    };
  }
  return hostError(
    'bad_args',
    'Unknown conflict action',
    'Overwrite, Get latest, Save mine to a new branch, or Dismiss.',
  );
}
