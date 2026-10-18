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
import { assemblyIdPath, parseIdPath, partIdPath, partMeshIdPath } from '../idPaths.js';
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
import { rewriteFeaStudyPartIds } from '../feaStudyIds.js';
import { pruneDanglingColors, pruneDanglingGroupPartIds } from '../surfJson.js';
import { parseSurfJsonV2, stringifySurfJsonV2 } from '../surfJsonV2.js';
import { jointedSurfIds, poseFieldsForPart, pruneDanglingSurfJoints } from '../../jointSchema.js';
import { VAULT_MARKER_KIND, VAULT_MARKER_PATH } from '../vaultNames.js';
import { captureLastCommit } from '../lastCommit.js';
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

function isSelfCopiedFrom(part) {
  const rowId = asV2Id(part?.id);
  const copied = asV2Id(part?.copiedFrom);
  return !!(rowId && copied && copied === rowId);
}

function ensureClaim(byId, id) {
  if (!byId.has(id)) {
    byId.set(id, {
      referencedHeaderPaths: new Set(),
      rowClaims: [],
    });
  }
  return byId.get(id);
}

function headerIdOf(files, path) {
  if (!hasOwn(files, path) || typeof files[path] !== 'string') return null;
  return asV2Id(readSurfId(files[path]));
}

/**
 * Claimants follow v1 refs: groups/colors/joints name row ids, so an
 * explicit row id says which file owns that id. Header-only claims apply
 * only when no row carries the id, and only for files some row references.
 * Unreferenced files never claim an id.
 */
function collectIdClaimants(parsedMeta, files) {
  const byId = new Map();
  const referencedPaths = new Set();
  for (const { folder, parsed } of parsedMeta || []) {
    (parsed?.parts || []).forEach((part, index) => {
      const path = scriptPathOf(part);
      if (path) referencedPaths.add(path);
      const rowId = asV2Id(part?.id);
      if (!rowId || !path) return;
      ensureClaim(byId, rowId).rowClaims.push({
        path,
        folder,
        index,
        selfCopiedFrom: isSelfCopiedFrom(part),
      });
    });
  }
  for (const path of referencedPaths) {
    const header = headerIdOf(files, path);
    if (header) ensureClaim(byId, header).referencedHeaderPaths.add(path);
  }
  return { byId, referencedPaths };
}

function isSharedPartPath(path) {
  return parseLegacyVaultPath(path)?.kind === 'shared-part';
}

function sortRowClaims(rows) {
  return rows.slice().sort((a, b) => {
    const folderCmp = String(a.folder || '').localeCompare(String(b.folder || ''));
    if (folderCmp) return folderCmp;
    if (a.index !== b.index) return a.index - b.index;
    return String(a.path).localeCompare(String(b.path));
  });
}

function pickAmongRowPaths(id, poolRows, files) {
  let candidates = [...new Set(poolRows.map((row) => row.path))];
  if (candidates.length === 1) return { path: candidates[0], rank: 0 };

  const withHeader = candidates.filter((path) => headerIdOf(files, path) === id);
  if (withHeader.length === 1) return { path: withHeader[0], rank: 1 };
  if (withHeader.length > 1) candidates = withHeader;

  const shared = candidates.filter(isSharedPartPath);
  if (shared.length === 1) return { path: shared[0], rank: 2 };
  if (shared.length > 1) candidates = shared;

  const rows = sortRowClaims(poolRows.filter((row) => candidates.includes(row.path)));
  if (rows[0]) return { path: rows[0].path, rank: 3 };
  candidates.sort((a, b) => a.localeCompare(b));
  return { path: candidates[0], rank: 3 };
}

function chooseOwnerPath(id, claim, files) {
  const rows = claim?.rowClaims || [];
  if (rows.length) {
    const paths = [...new Set(rows.map((row) => row.path))];
    if (paths.length === 1) return { path: paths[0], rank: 0 };
    const live = rows.filter((row) => !row.selfCopiedFrom);
    return pickAmongRowPaths(id, live.length ? live : rows, files);
  }

  const headers = [...(claim?.referencedHeaderPaths || [])];
  if (!headers.length) return null;
  const shared = headers.filter(isSharedPartPath);
  const pool = (shared.length ? shared : headers).slice().sort((a, b) => a.localeCompare(b));
  return { path: pool[0], rank: 10 };
}

function isRowClaimRank(rank) {
  return rank < 10;
}

/**
 * One owner path per id, decided before any mint. A path that wins two
 * ids keeps the explicit row-id claim over a header-only claim. Header
 * match only breaks ties between two row-id claims.
 */
function resolvePathOwners(claimants, files) {
  const ownerPathById = new Map();
  const ownerIdByPath = new Map();
  const rankByPath = new Map();
  const take = (id, path, rank) => {
    ownerPathById.set(id, path);
    ownerIdByPath.set(path, id);
    rankByPath.set(path, rank);
  };
  for (const id of [...(claimants?.keys?.() || [])].sort()) {
    const chosen = chooseOwnerPath(id, claimants.get(id), files);
    if (!chosen) continue;
    const prevId = ownerIdByPath.get(chosen.path);
    if (!prevId) {
      take(id, chosen.path, chosen.rank);
      continue;
    }
    const prevRank = rankByPath.get(chosen.path);
    const nowRow = isRowClaimRank(chosen.rank);
    const prevRow = isRowClaimRank(prevRank);
    let steal = false;
    if (nowRow && !prevRow) steal = true;
    else if (!nowRow && prevRow) steal = false;
    else if (nowRow && prevRow) {
      const headerNow = headerIdOf(files, chosen.path) === id;
      const headerPrev = headerIdOf(files, chosen.path) === prevId;
      if (headerNow && !headerPrev) steal = true;
      else if (headerNow === headerPrev && chosen.rank < prevRank) steal = true;
      else if (headerNow === headerPrev && chosen.rank === prevRank && id < prevId) steal = true;
    } else if (chosen.rank < prevRank || (chosen.rank === prevRank && id < prevId)) {
      steal = true;
    }
    if (steal) {
      ownerPathById.delete(prevId);
      take(id, chosen.path, chosen.rank);
    }
  }
  return { ownerPathById, ownerIdByPath };
}

/**
 * One final id per legacy path. Owner paths keep their id; every other
 * referenced path mints once and reuses that id in every assembly.
 */
function assignAllPathIds({
  referencedPaths,
  ownerIdByPath,
  ownerPathById,
  pathIndex,
  usedPart,
  mintOptsFor,
}) {
  const pathToId = {};
  const mintedPaths = new Set();
  for (const [path, id] of ownerIdByPath.entries()) {
    pathToId[path] = id;
    usedPart.add(id);
  }
  for (const path of [...referencedPaths].sort((a, b) => a.localeCompare(b))) {
    if (pathToId[path]) continue;
    const cached = asV2Id(pathIndex[path]);
    const cacheOwner = cached ? ownerPathById.get(cached) : null;
    if (cached && !usedPart.has(cached) && (!cacheOwner || cacheOwner === path)) {
      pathToId[path] = cached;
    } else {
      pathToId[path] = mintUnused(usedPart, mintOptsFor({ path }, 0));
      mintedPaths.add(path);
    }
    usedPart.add(pathToId[path]);
  }
  return { pathToId, mintedPaths };
}

/**
 * Old v1 row id → this path's final id. Live finals map to themselves
 * so a copiedFrom that already names a surviving part stays. A later
 * duplicate-id copy row must not overwrite that mapping. A row id that
 * folded into another file's id remaps; an id that never owned a path
 * is omitted (deleted part).
 */
function foldMapForCopiedFrom(parsedMeta, pathToId) {
  const fold = new Map();
  for (const id of Object.values(pathToId || {})) {
    if (id) fold.set(id, id);
  }
  for (const { parsed } of parsedMeta || []) {
    for (const part of parsed?.parts || []) {
      const rowId = asV2Id(part?.id);
      const path = scriptPathOf(part);
      const finalId = path ? pathToId[path] : null;
      if (rowId && finalId && !fold.has(rowId)) fold.set(rowId, finalId);
    }
  }
  return fold;
}

/**
 * `copiedFrom` only from the v1 row (remapped through the fold), or from
 * an explicit row id this path lost to a DIFFERENT file (a true duplicate).
 * Folding a row id into the same file's final id does not set copiedFrom —
 * that id is not a live part. A remapped v1 copiedFrom that lands on this
 * row's own final id is dropped. A v1 copiedFrom that names a deleted
 * part is kept. Header-only losers mint with none.
 */
function copiedFromForRow(part, finalId, pathToId, foldMap) {
  const existing = asV2Id(part?.copiedFrom);
  if (existing) {
    const remapped = foldMap?.has(existing) ? foldMap.get(existing) : existing;
    if (remapped && remapped !== finalId) return remapped;
  }
  const rowId = asV2Id(part?.id);
  if (!rowId || rowId === finalId) return null;
  const thisPath = scriptPathOf(part);
  for (const [path, id] of Object.entries(pathToId || {})) {
    if (id === rowId && path !== thisPath) return rowId;
  }
  return null;
}

function assignLeftoverPathId(path, files, pathIndex, usedPart, ownerPathById, mintOpts) {
  const cached = asV2Id(pathIndex[path]);
  if (cached && !usedPart.has(cached) && !ownerPathById.has(cached)) {
    return { id: cached, minted: false };
  }
  const header = headerIdOf(files, path);
  if (header && !usedPart.has(header) && !ownerPathById.has(header)) {
    return { id: header, minted: false };
  }
  return { id: mintUnused(usedPart, mintOpts), minted: true };
}

function applyPoseFields(parts, joints) {
  const jointed = jointedSurfIds(joints);
  return (parts || []).map((part) => {
    const pose = poseFieldsForPart(part, jointed.has(part.id), part.position);
    const row = { ...part };
    delete row.position;
    delete row.placement;
    if (pose.position) row.position = pose.position;
    if (pose.placement) row.placement = pose.placement;
    return row;
  });
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

function headerLineBreak(text) {
  const cr = text.indexOf('\r');
  const lf = text.indexOf('\n');
  if (cr < 0 && lf < 0) return { index: text.length, ending: '' };
  if (cr >= 0 && (lf < 0 || cr < lf)) {
    return lf === cr + 1
      ? { index: cr, ending: '\r\n' }
      : { index: cr, ending: '\r' };
  }
  return { index: lf, ending: '\n' };
}

function isSurfIdCommentStart(text) {
  if (!text.startsWith('// @surf-id')) return false;
  const next = text.slice('// @surf-id'.length);
  return !next || next[0] === ' ' || next[0] === '\t' || next[0] === '\n' || next[0] === '\r';
}

/**
 * Upgrade-only. Rewrite an invalid or bare `// @surf-id` line and keep any
 * extra text on that line. Valid headers go through `withSurfId` (which
 * stacks when the first line is not a valid header).
 */
function rewriteUpgradeSurfIdHeader(script, id) {
  const text = String(script ?? '');
  if (readSurfId(text)) return withSurfId(text, id);
  if (!isSurfIdCommentStart(text)) return withSurfId(text, id);
  const br = headerLineBreak(text);
  const firstLine = text.slice(0, br.index);
  const rest = br.ending ? text.slice(br.index + br.ending.length) : '';
  const after = firstLine.slice('// @surf-id'.length);
  const extraMatch = after.match(/^([ \t]*)(\S*)(.*)$/);
  const extra = extraMatch ? extraMatch[3] : '';
  const line = `// @surf-id ${id}${extra}`;
  return br.ending ? `${line}${br.ending}${rest}` : line;
}

function stampScript(script, id, name) {
  const display = sanitizeSurfName(name) || 'Part';
  return withSurfName(rewriteUpgradeSurfIdHeader(typeof script === 'string' ? script : '', id), display);
}

function displayNameFor(part, script, path) {
  return sanitizeSurfName(readSurfName(script) || part?.name || stemName(path)) || 'Part';
}

function utf8FromBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return '';
  if (bytes.byteLength === 0) return '';
  return new TextDecoder('utf-8').decode(bytes);
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function isPresentEmpty(content) {
  if (typeof content === 'string') return content.length === 0;
  if (isBinaryContent(content)) return toUint8Array(content).byteLength === 0;
  return false;
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

/** Legacy SurfCAD paths Upgrade may delete. Images/notes under the folder stay. */
function isDeletedLegacyPath(path) {
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
  return false;
}

function shouldLoadForUpgrade(path) {
  if (path === VAULT_README_PATH || path === VAULT_MARKER_PATH) return true;
  return isDeletedLegacyPath(path);
}

function filePayload(path, content) {
  if (isBinaryContent(content)) return fileWrite(path, toUint8Array(content));
  return fileWrite(path, content);
}

function contentsEqual(a, b) {
  if (isBinaryContent(a) || isBinaryContent(b)) {
    const left = isBinaryContent(a) ? toUint8Array(a) : (typeof a === 'string' ? new TextEncoder().encode(a) : null);
    const right = isBinaryContent(b) ? toUint8Array(b) : (typeof b === 'string' ? new TextEncoder().encode(b) : null);
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

function writeScript(writes, dest, script, id, name) {
  if (typeof script !== 'string') return;
  writes[dest] = script.length ? stampScript(script, id, name) : '';
}

function expectedScriptBytes(script, id, name) {
  if (typeof script !== 'string') return null;
  return script.length ? stampScript(script, id, name) : '';
}

function assertCopiedBytes(plan, files) {
  const missing = [];
  const mismatched = [];
  for (const path of plan.deletes || []) {
    if (!/\.(js|mesh)$/i.test(path)) continue;
    if (!hasOwn(files, path)) continue;
    const source = files[path];
    const jsPath = /\.mesh$/i.test(path) ? path.replace(/\.mesh$/i, '.js') : path;
    const id = plan.partIdByPath?.[jsPath];
    if (!id) {
      if (!isPresentEmpty(source)) missing.push(path);
      continue;
    }
    const dest = /\.mesh$/i.test(path) ? partMeshIdPath(id) : partIdPath(id);
    if (!hasOwn(plan.writes, dest)) {
      missing.push(path);
      continue;
    }
    if (/\.mesh$/i.test(path)) {
      if (!contentsEqual(source, plan.writes[dest])) mismatched.push(`${path} -> ${dest}`);
      continue;
    }
    const destText = plan.writes[dest];
    if (typeof destText !== 'string') {
      mismatched.push(`${path} -> ${dest}`);
      continue;
    }
    if (isPresentEmpty(source)) {
      if (destText.length !== 0) mismatched.push(`${path} -> ${dest}`);
      continue;
    }
    const expected = expectedScriptBytes(
      source,
      id,
      readSurfName(destText) || displayNameFor({ name: stemName(path) }, source, path),
    );
    if (destText !== expected) mismatched.push(`${path} -> ${dest}`);
  }
  if (!missing.length && !mismatched.length) return;
  const bits = [];
  if (missing.length) bits.push(`missing v2 copy of ${missing.join(', ')}`);
  if (mismatched.length) bits.push(`byte mismatch ${mismatched.join(', ')}`);
  const err = new Error(`Upgrade copy check failed: ${bits.join('; ')}. Nothing was written.`);
  err.code = 'upgrade_copy_mismatch';
  throw err;
}

/**
 * Pure planner. `files` is path → UTF-8 string or Uint8Array from the tip.
 * Ids follow v1 refs: groups/colors/joints name row ids, so an explicit
 * row id says which file owns that id. Header-only claims apply only
 * when no row carries the id, and only for files some row references.
 * One final id per legacy path is minted once and reused in every
 * assembly. `copiedFrom` is the v1 value remapped through the fold, or
 * an explicit row id the path lost to a different file (a true duplicate).
 * A header-only loser mints with none. Collapse tags from a working copy
 * are not inputs to this planner. One assembly id per legacy folder
 * (reuse `assemblyIdByFolder`).
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

  const unreadable = [];
  const parsedMeta = [];
  for (const row of metaPaths) {
    const parsed = parseLegacyJson(files[row.path]);
    if (!parsed) unreadable.push(row.path);
    else parsedMeta.push({ ...row, parsed });
  }
  if (unreadable.length) {
    const list = unreadable.join(', ');
    return {
      error: {
        code: 'unreadable_legacy_json',
        message: `Cannot parse legacy assembly file${unreadable.length > 1 ? 's' : ''}: ${list}. Upgrade aborted; nothing was written.`,
        hint: 'Fix or remove the unreadable .surf.json, then retry Upgrade vault.',
        paths: unreadable,
      },
    };
  }

  const { byId, referencedPaths } = collectIdClaimants(parsedMeta, files);
  const { ownerPathById, ownerIdByPath } = resolvePathOwners(byId, files);
  const { pathToId, mintedPaths } = assignAllPathIds({
    referencedPaths,
    ownerIdByPath,
    ownerPathById,
    pathIndex: partIdByPath,
    usedPart,
    mintOptsFor,
  });
  Object.assign(partIdByPath, pathToId);
  const foldMap = foldMapForCopiedFrom(parsedMeta, pathToId);

  const bindPart = (part, index, seenInAssembly) => {
    const path = scriptPathOf(part);
    const hasFile = !!(path && hasOwn(files, path) && typeof files[path] === 'string');
    const script = hasFile ? files[path] : '';
    const assigned = path ? pathToId[path] : null;
    let id = assigned;
    let minted = !!(path && mintedPaths.has(path));
    if (!id || seenInAssembly.has(id)) {
      const fallbackCopied = assigned && seenInAssembly.has(assigned) ? assigned : null;
      id = mintUnused(usedPart, mintOptsFor(part, index));
      minted = true;
      usedPart.add(id);
      const copiedFrom = copiedFromForRow(part, id, pathToId, foldMap) || fallbackCopied;
      seenInAssembly.add(id);
      if (path && !partIdByPath[path]) partIdByPath[path] = id;
      partBindings.push({ path, id, minted, copiedFrom: copiedFrom || null });
      mintedPartIds.push(id);
      return {
        id,
        path,
        script,
        hasFile,
        minted,
        copiedFrom: copiedFrom && copiedFrom !== id ? copiedFrom : null,
      };
    }
    usedPart.add(id);
    seenInAssembly.add(id);
    const copiedFrom = copiedFromForRow(part, id, pathToId, foldMap);
    partBindings.push({ path, id, minted, copiedFrom });
    if (minted) mintedPartIds.push(id);
    else keptPartIds.push(id);
    return {
      id,
      path,
      script,
      hasFile,
      minted,
      copiedFrom,
    };
  };

  for (const { folder } of parsedMeta) {
    if (!folderToId[folder] || !isV2SurfId(folderToId[folder])) {
      const id = mintUnused(usedAsm, mintOptsFor({ id: '$assembly', name: folder }, -1));
      usedAsm.add(id);
      folderToId[folder] = id;
      mintedAssemblyIds.push(id);
    } else {
      usedAsm.add(folderToId[folder]);
    }
  }

  for (const { folder, parsed } of parsedMeta) {
    const assemblyId = folderToId[folder];
    const idMap = new Map();
    const nextParts = [];
    const seenInAssembly = new Set();
    (parsed.parts || []).forEach((part, i) => {
      const bound = bindPart(part, i, seenInAssembly);
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
      const copied = bound.copiedFrom || copiedFromForRow(part, bound.id, pathToId, foldMap);
      if (copied && copied !== bound.id) row.copiedFrom = copied;
      nextParts.push(row);

      if (bound.hasFile) {
        writeScript(writes, partIdPath(bound.id), bound.script, bound.id, name);
      }
      const meshPath = sidecarMeshPath(bound.path);
      if (meshPath && hasOwn(files, meshPath) && isBinaryContent(files[meshPath])) {
        writes[partMeshIdPath(bound.id)] = toUint8Array(files[meshPath]);
      } else if (meshPath && hasOwn(files, meshPath) && isPresentEmpty(files[meshPath])) {
        writes[partMeshIdPath(bound.id)] = new Uint8Array(0);
      }
    });
    const keptIds = new Set(nextParts.map((row) => row.id));
    (parsed.parts || []).forEach((part, i) => {
      const rowId = asV2Id(part?.id);
      const boundId = nextParts[i]?.id;
      if (rowId && boundId && rowId !== boundId && !keptIds.has(rowId) && !idMap.has(rowId)) {
        idMap.set(rowId, boundId);
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
      parts: applyPoseFields(nextParts, joints),
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
    const hasFile = hasOwn(files, path) && typeof files[path] === 'string';
    if (pathToId[path]) {
      const id = pathToId[path];
      const dest = partIdPath(id);
      if (writes[dest] !== undefined) continue;
      if (!hasFile) continue;
      const script = files[path];
      usedPart.add(id);
      writeScript(writes, dest, script, id, displayNameFor({ name: stemName(path) }, script, path));
      const meshPath = sidecarMeshPath(path);
      if (meshPath && hasOwn(files, meshPath) && isBinaryContent(files[meshPath])) {
        writes[partMeshIdPath(id)] = toUint8Array(files[meshPath]);
      } else if (meshPath && hasOwn(files, meshPath) && isPresentEmpty(files[meshPath])) {
        writes[partMeshIdPath(id)] = new Uint8Array(0);
      }
      continue;
    }
    if (!hasFile) continue;
    const script = files[path];
    const picked = assignLeftoverPathId(
      path,
      files,
      pathIndex,
      usedPart,
      ownerPathById,
      mintOptsFor({ path }, 0),
    );
    usedPart.add(picked.id);
    partIdByPath[path] = picked.id;
    partBindings.push({ path, id: picked.id, minted: picked.minted });
    if (picked.minted) mintedPartIds.push(picked.id);
    else keptPartIds.push(picked.id);
    writeScript(
      writes,
      partIdPath(picked.id),
      script,
      picked.id,
      displayNameFor({ name: stemName(path) }, script, path),
    );
    const meshPath = sidecarMeshPath(path);
    if (meshPath && hasOwn(files, meshPath) && isBinaryContent(files[meshPath])) {
      writes[partMeshIdPath(picked.id)] = toUint8Array(files[meshPath]);
    } else if (meshPath && hasOwn(files, meshPath) && isPresentEmpty(files[meshPath])) {
      writes[partMeshIdPath(picked.id)] = new Uint8Array(0);
    }
  }

  writes[VAULT_MARKER_PATH] = SURFCAD_JSON_V2;

  const writePaths = new Set(Object.keys(writes));
  const deletes = [];
  const leftoverFiles = [];
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
        leftoverFiles.push(path);
      }
      continue;
    }
    if (isDeletedLegacyPath(path)) deletes.push(path);
    else leftoverFiles.push(path);
  }

  for (const path of [...writePaths].sort()) {
    writeFiles.push(filePayload(path, writes[path]));
  }
  deletes.sort();
  leftoverFiles.sort();
  const filesOut = [
    ...writeFiles,
    ...deletes.map((path) => fileDelete(path)),
  ];

  const plan = {
    alreadyUpgraded: false,
    baseSha: baseSha || null,
    files: filesOut,
    writes,
    deletes,
    leftoverFiles,
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
  assertCopiedBytes(plan, files);
  return plan;
}

function planIdsOf(plan) {
  const ids = new Set();
  for (const id of Object.values(plan?.partIdByPath || {})) {
    if (isV2SurfId(id)) ids.add(id);
  }
  for (const id of plan?.keptPartIds || []) ids.add(id);
  for (const id of plan?.mintedPartIds || []) ids.add(id);
  for (const row of plan?.partBindings || []) {
    if (isV2SurfId(row?.id)) ids.add(row.id);
  }
  return ids;
}

function wcScriptOf(part, scripts) {
  if (!scripts) return undefined;
  if (typeof scripts[part?.id] === 'string') return scripts[part.id];
  const path = scriptPathOf(part);
  if (path && typeof scripts[path] === 'string') return scripts[path];
  return undefined;
}

function remapAssetKeys(assets, idMap) {
  if (!assets || typeof assets !== 'object') return assets;
  const next = {};
  for (const [id, value] of Object.entries(assets)) {
    next[idMap.get(id) || id] = value;
  }
  return next;
}

/**
 * Map a WC onto the upgrade plan's ids via the plan's legacy-path map
 * (not WC header ids). Clean and dirty callers both use this. Rekeys in
 * memory only — callers persist IDB. Studies and `copiedFrom` follow the
 * plan. A WC part whose id is not in the plan and that has no mapped
 * legacy path is an add (`parts/<id>.js`). Refuse only true ambiguity:
 * two WC rows mapping to one plan id.
 */
export function mapWorkingCopyToPlan(plan, workingCopy, { allowMint = true } = {}) {
  if (!workingCopy?.doc) {
    return { ok: true, doc: null, scripts: {}, pairs: [], assets: workingCopy?.assets || null };
  }
  const pathToId = plan?.partIdByPath || {};
  const planIds = planIdsOf(plan);
  const folderToId = plan?.folderToId || {};
  const parts = workingCopy.doc.parts || [];
  const claimed = new Map();
  const ambiguous = [];
  const used = new Set(planIds);
  const assemblyId = asV2Id(workingCopy.doc.id)
    || folderToId[workingCopy.doc.name]
    || folderToId[Object.keys(folderToId).find((name) => name.toLowerCase() === String(workingCopy.doc.name || '').toLowerCase())]
    || null;
  const planJson = assemblyJsonFromPlan(plan, assemblyId);

  const resolve = (part) => {
    const path = scriptPathOf(part);
    const fromPath = path ? pathToId[path] : null;
    const fromId = asV2Id(part?.id);
    if (fromPath && isV2SurfId(fromPath)) return fromPath;
    if (fromId && planIds.has(fromId)) return fromId;
    if (fromId) return fromId;
    if (allowMint === false) return part?.id || null;
    return mintUnused(used);
  };

  const resolvedIds = parts.map((part) => {
    const id = resolve(part);
    used.add(id);
    return id;
  });

  parts.forEach((part, i) => {
    const planId = resolvedIds[i];
    const label = part?.name || part?.id || scriptPathOf(part) || '(unnamed)';
    if (claimed.has(planId)) {
      ambiguous.push(label);
      return;
    }
    claimed.set(planId, part);
  });

  if (ambiguous.length) {
    return {
      ok: false,
      code: 'working_copy_unmapped',
      message: `Cannot save the working copy after Upgrade: more than one working-copy part maps to the same upgraded id (${ambiguous.join(', ')}). The vault is v2; the follow-up was not written.`,
      hint: 'Give each working-copy part its own id, then retry Save. Local edits stay in IndexedDB.',
      unmapped: [],
      ambiguous,
    };
  }

  const pairs = [];
  const nextScripts = {};
  const scripts = workingCopy.scripts || {};
  const nextParts = parts.map((part, i) => {
    const planId = resolvedIds[i] || part?.id;
    if (part?.id && planId && part.id !== planId) pairs.push({ from: part.id, to: planId });
    const script = wcScriptOf(part, scripts);
    const name = sanitizeSurfName(part.name) || displayNameFor(part, script, part.path);
    if (typeof script === 'string' && planId) {
      nextScripts[planId] = isSurfId(planId) ? stampScript(script, planId, name) : script;
    }
    const planRow = Array.isArray(planJson?.parts)
      ? planJson.parts.find((row) => row?.id === planId)
      : null;
    const copied = planRow ? asV2Id(planRow.copiedFrom) : asV2Id(part?.copiedFrom);
    const next = { ...part, id: planId };
    if (copied && copied !== planId) next.copiedFrom = copied;
    else delete next.copiedFrom;
    return next;
  });

  const idMap = new Map(pairs.map((row) => [row.from, row.to]));
  if (idMap.size) {
    for (const [id, text] of Object.entries(nextScripts)) {
      nextScripts[id] = rewriteFeaStudyPartIds(text, idMap);
    }
  }
  let activeId = asV2Id(workingCopy.doc.activeId);
  if (activeId && idMap.has(activeId)) activeId = idMap.get(activeId);
  if (activeId && !nextParts.some((p) => p.id === activeId)) activeId = nextParts[0]?.id || null;

  const groups = Array.isArray(workingCopy.doc.groups)
    ? workingCopy.doc.groups.map((group) => ({
      ...group,
      source: mapGroupSource(group.source, folderToId),
      partIds: (group.partIds || []).map((id) => idMap.get(id) || asV2Id(id) || id).filter((id) => isV2SurfId(id)),
    }))
    : undefined;

  const nextDoc = {
    ...workingCopy.doc,
    id: assemblyId || workingCopy.doc.id,
    activeId,
    parts: nextParts,
    groups,
    colors: workingCopy.doc.colors ? rewriteColorMap(workingCopy.doc.colors, idMap) : workingCopy.doc.colors,
    joints: workingCopy.doc.joints ? rewriteJointSurfIds(workingCopy.doc.joints, idMap) : workingCopy.doc.joints,
  };

  const assets = workingCopy.assets && typeof workingCopy.assets === 'object'
    ? remapAssetKeys(workingCopy.assets, idMap)
    : workingCopy.assets;

  return {
    ok: true,
    doc: nextDoc,
    scripts: nextScripts,
    pairs,
    assets,
  };
}

/** Retry re-keys leftover WC ids onto the v2 vault. It does not write git. */
export const WORKING_COPY_UNPERSISTED_HINT = 'The vault is already v2. Retry Upgrade vault to re-key the working copy onto the vault ids. That retry does not write git.';

export function workingCopyUnpersistedResult({ sha, upgradeSha } = {}) {
  const message = 'Could not save the upgraded working copy. The previous working copy was kept.';
  const out = {
    status: 'error',
    code: 'working_copy_unpersisted',
    error: message,
    message,
    hint: WORKING_COPY_UNPERSISTED_HINT,
  };
  if (typeof sha === 'string' && sha) out.sha = sha;
  if (typeof upgradeSha === 'string' && upgradeSha) out.upgradeSha = upgradeSha;
  else if (out.sha) out.upgradeSha = out.sha;
  return out;
}

export function workingCopyIdsMatchVault(wcDoc, vaultDoc) {
  const wc = new Set((wcDoc?.parts || []).map((part) => part?.id).filter(Boolean));
  const vault = new Set((vaultDoc?.parts || []).map((part) => part?.id).filter(Boolean));
  if (wc.size !== vault.size) return false;
  for (const id of wc) {
    if (!vault.has(id)) return false;
  }
  return true;
}

export function upgradePersistIncomplete(persisted) {
  if (!persisted || persisted.docSaved === false) return true;
  const failed = persisted.failedFrom;
  if (!failed) return false;
  if (typeof failed.size === 'number') return failed.size > 0;
  if (Array.isArray(failed)) return failed.length > 0;
  return false;
}

/** New `to` keys written before a failed saveDoc, not referenced by the old WC. */
export function orphanUpgradeScriptIds(persisted, sourceDoc) {
  if (!persisted || persisted.docSaved !== false) return [];
  const sourceIds = new Set((sourceDoc?.parts || []).map((part) => part?.id).filter(Boolean));
  const saved = persisted.saved instanceof Set
    ? [...persisted.saved]
    : (Array.isArray(persisted.saved) ? persisted.saved : []);
  return saved.filter((id) => id && !sourceIds.has(id));
}

function pathIndexWithJournal(pathIndex, workingCopy, journalPairs) {
  const next = { ...(pathIndex || {}) };
  if (!Array.isArray(journalPairs) || !journalPairs.length) return next;
  const toByFrom = new Map();
  for (const row of journalPairs) {
    if (row?.from && row?.to && row.from !== row.to) toByFrom.set(row.from, row.to);
  }
  for (const part of workingCopy?.doc?.parts || []) {
    const to = toByFrom.get(part?.id);
    if (!to || !isV2SurfId(to)) continue;
    const path = scriptPathOf(part);
    if (path && !next[path]) next[path] = to;
    if (part?.id && String(part.id).includes('/') && !next[part.id]) next[part.id] = to;
  }
  return next;
}

function fileTextOf(content) {
  if (typeof content === 'string') return content;
  if (content instanceof Uint8Array) return utf8FromBytes(content);
  return null;
}

/**
 * Read-only: map a leftover v1 WC onto the v2 tip via `parts[]`, `@surf-id`
 * headers, the persisted legacy path index, and optional replay pairs.
 * Zero git writes. Does not mint.
 */
export async function mapWorkingCopyToV2Tip({
  adapter,
  repo,
  branch = 'main',
  store = null,
  workingCopy = null,
  journalPairs = [],
} = {}) {
  if (!workingCopy?.doc) {
    return { ok: true, doc: null, scripts: {}, pairs: [], assets: workingCopy?.assets || null };
  }
  assertGithubAdapter(adapter);
  const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
  const tree = await adapter.listTree(repo, branchName);
  const writes = {};
  const keptPartIds = [];
  const partBindings = [];
  for (const entry of tree || []) {
    const path = entry?.path;
    const parsed = parseIdPath(path);
    if (!parsed || (parsed.kind !== 'assembly' && parsed.kind !== 'part')) continue;
    let text = null;
    try {
      const got = await adapter.readFile(repo, path, branchName);
      text = fileTextOf(got?.content);
    } catch {
      text = null;
    }
    if (typeof text !== 'string') continue;
    if (parsed.kind === 'assembly') {
      writes[path] = text;
      try {
        const json = JSON.parse(text);
        for (const part of json?.parts || []) {
          if (isV2SurfId(part?.id)) {
            keptPartIds.push(part.id);
            partBindings.push({ id: part.id, path: null });
          }
        }
      } catch { /* skip unreadable assembly json */ }
    } else {
      const header = readSurfId(text);
      const id = (header && isV2SurfId(header)) ? header : parsed.id;
      if (isV2SurfId(id)) {
        keptPartIds.push(id);
        partBindings.push({ id, path: null });
      }
    }
  }
  const pathToId = pathIndexWithJournal(
    store?.pathIndexFor?.(repo) || {},
    workingCopy,
    journalPairs,
  );
  for (const id of Object.values(pathToId)) {
    if (isV2SurfId(id)) keptPartIds.push(id);
  }
  const mintedPartIds = [];
  for (const row of journalPairs || []) {
    if (row?.to && isV2SurfId(row.to)) mintedPartIds.push(row.to);
  }
  const plan = {
    partIdByPath: pathToId,
    keptPartIds,
    mintedPartIds,
    partBindings,
    folderToId: store?.assemblyIdIndexFor?.(repo) || {},
    writes,
  };
  return mapWorkingCopyToPlan(plan, workingCopy, { allowMint: false });
}

function overlayJournalPairs(mapped, journalPairs) {
  if (!mapped || typeof mapped !== 'object') return mapped;
  const pairs = [...(mapped.pairs || [])];
  const froms = new Set(pairs.map((row) => row?.from).filter(Boolean));
  for (const row of journalPairs || []) {
    if (!row?.from || !row?.to || row.from === row.to || froms.has(row.from)) continue;
    pairs.push({ from: row.from, to: row.to });
    froms.add(row.from);
  }
  return { ...mapped, pairs };
}

function rekeyNeedsPersist(workingCopy, mapped) {
  if (!mapped?.ok || !mapped.doc) return false;
  if ((mapped.pairs || []).some((row) => row?.from && row?.to && row.from !== row.to)) return true;
  return !workingCopyIdsMatchVault(workingCopy?.doc, mapped.doc);
}

/**
 * Persist the Upgrade WC re-key. On `already_upgraded`, remap leftover ids
 * through the v2 tip + path index (no git writes). Treat a failed put
 * (`failedFrom`) like a failed saveDoc.
 */
export async function adoptUpgradeWorkingCopy({
  result,
  workingCopy,
  adapter,
  repo,
  branch = 'main',
  store = null,
  persist,
  sourceDoc,
  journalPairs = [],
  removeOrphans,
} = {}) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', result: workingCopyUnpersistedResult() };
  }
  const adopted = result.status === 'upgraded'
    || result.status === 'upgraded_and_saved'
    || (result.status === 'conflict' && result.phase === 'save');
  let rekey = result.rekey || null;
  if (result.status === 'already_upgraded') {
    if (!workingCopy?.doc) return { status: 'ok', result, persisted: null };
    let mapped = rekey;
    if (!mapped?.doc) {
      mapped = await mapWorkingCopyToV2Tip({
        adapter,
        repo,
        branch,
        store,
        workingCopy,
        journalPairs,
      });
    }
    if (!mapped?.ok) {
      return {
        status: 'error',
        result: {
          status: 'error',
          code: mapped?.code || 'working_copy_unmapped',
          error: mapped?.message || 'Cannot map the working copy onto the upgraded vault',
          message: mapped?.message || 'Cannot map the working copy onto the upgraded vault',
          hint: mapped?.hint || WORKING_COPY_UNPERSISTED_HINT,
        },
      };
    }
    mapped = overlayJournalPairs(mapped, journalPairs);
    if (!rekeyNeedsPersist(workingCopy, mapped)) {
      return { status: 'ok', result, persisted: null, rekey: mapped };
    }
    rekey = mapped;
  } else if (!adopted || !rekey?.doc) {
    return { status: 'ok', result, persisted: null };
  }

  if (typeof persist !== 'function') {
    return { status: 'error', result: workingCopyUnpersistedResult({ sha: result.sha, upgradeSha: result.upgradeSha || result.sha }) };
  }

  let persisted;
  try {
    persisted = await persist({
      nextDoc: { ...rekey.doc, source: 'git', vaultLayout: 'v2' },
      nextScripts: rekey.scripts || {},
      pairs: rekey.pairs || [],
      assets: rekey.assets,
    });
  } catch (err) {
    if (err?.name === 'PersistCrash') {
      return {
        status: 'error',
        result: workingCopyUnpersistedResult({
          sha: result.sha,
          upgradeSha: result.upgradeSha || result.sha,
        }),
      };
    }
    throw err;
  }

  if (upgradePersistIncomplete(persisted)) {
    const orphans = orphanUpgradeScriptIds(persisted, sourceDoc);
    if (orphans.length && typeof removeOrphans === 'function') {
      await removeOrphans(orphans);
    }
    return {
      status: 'error',
      result: workingCopyUnpersistedResult({
        sha: result.sha,
        upgradeSha: result.upgradeSha || result.sha,
      }),
      persisted,
    };
  }
  return { status: 'ok', result, persisted, rekey };
}

function jsonWithoutPartCopiedFrom(text) {
  if (typeof text !== 'string') return text;
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj?.parts)) {
      for (const part of obj.parts) {
        if (part && typeof part === 'object') delete part.copiedFrom;
      }
    }
    return JSON.stringify(obj);
  } catch {
    return text;
  }
}

function assemblyJsonFromPlan(plan, assemblyId) {
  if (!assemblyId) return null;
  try {
    const text = plan?.writes?.[assemblyIdPath(assemblyId)];
    if (typeof text !== 'string') return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * TEMPORARY: PR 7 replaces this with planSave against AssemblyCommit.
 * Second commit only: WC edits relative to the v2 bytes from commit 1.
 * Never used for the Upgrade commit. Writes only files whose bytes differ.
 * `copiedFrom`-only differences in `.surf.json` are ignored so a collapse
 * tag does not rewrite the assembly on commit 2. Mapped parts take
 * `copiedFrom` from the plan's commit-1 row; only parts new in the
 * working copy keep the WC value.
 */
export function planWorkingCopyFollowup(plan, workingCopy) {
  if (!workingCopy?.dirty || !workingCopy?.doc || !plan?.writes) return [];
  const mapped = mapWorkingCopyToPlan(plan, workingCopy);
  if (!mapped.ok) return [];
  const doc = mapped.doc;
  const assemblyId = asV2Id(doc.id);
  if (!assemblyId) return [];
  const scripts = mapped.scripts || {};
  const folderToId = plan.folderToId || {};
  const prevJson = assemblyJsonFromPlan(plan, assemblyId);
  const planParts = prevJson?.parts || [];
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
    const planRow = planParts.find((p) => p.id === id);
    const copied = planRow ? asV2Id(planRow.copiedFrom) : asV2Id(part.copiedFrom);
    if (copied && copied !== id) row.copiedFrom = copied;
    return row;
  }).filter(Boolean);

  const fromWcGroups = Array.isArray(doc.groups)
    ? doc.groups.map((group) => ({
      id: asV2Id(group.id) || group.id,
      name: sanitizeSurfName(group.name) || 'Group',
      source: mapGroupSource(group.source, folderToId),
      partIds: (group.partIds || []).map((id) => asV2Id(id) || id).filter((id) => isV2SurfId(id)),
    })).filter((group) => isV2SurfId(group.id) && group.partIds.length)
    : null;
  // Explicit `groups: []` means the WC removed them. Only fall back to the
  // upgrade plan when the WC omitted the field.
  const groups = Array.isArray(doc.groups) ? fromWcGroups : prevJson?.groups;

  let activeId = asV2Id(doc.activeId);
  if (activeId && !parts.some((p) => p.id === activeId)) activeId = parts[0]?.id || null;

  const joints = doc.joints !== undefined ? doc.joints : prevJson?.joints;
  const jsonText = stringifySurfJsonV2({
    id: assemblyId,
    name: sanitizeSurfName(doc.name) || prevJson?.name || 'Assembly',
    activeId,
    parts: applyPoseFields(parts, joints),
    groups,
    colors: doc.colors !== undefined ? doc.colors : prevJson?.colors,
    joints,
  });

  const out = [];
  const asmPath = assemblyIdPath(assemblyId);
  const prevText = plan.writes[asmPath];
  if (jsonWithoutPartCopiedFrom(jsonText) !== jsonWithoutPartCopiedFrom(prevText)) {
    out.push(fileWrite(asmPath, jsonText));
  }

  for (const part of parts) {
    const script = scripts[part.id];
    if (typeof script !== 'string') continue;
    const stamped = stampScript(script, part.id, part.name);
    const dest = partIdPath(part.id);
    if (stamped !== plan.writes[dest]) out.push(fileWrite(dest, stamped));
    const mesh = meshBytesOf(mapped.assets || workingCopy.assets, part.id);
    if (mesh) {
      const meshPath = partMeshIdPath(part.id);
      const prev = plan.writes[meshPath];
      if (!prev || !contentsEqual(prev, mesh)) out.push(fileWrite(meshPath, mesh));
    }
  }
  return out;
}

/**
 * Apply Get-latest contents (v2 paths) onto the open working copy.
 * Does not write git.
 */
export function applyUpgradeReload(doc, scripts, contents) {
  let nextDoc = doc;
  const nextScripts = { ...(scripts || {}) };
  for (const [path, content] of Object.entries(contents || {})) {
    const parsed = parseIdPath(path);
    if (!parsed) continue;
    if (parsed.kind === 'part' && typeof content === 'string') {
      nextScripts[parsed.id] = content;
      continue;
    }
    if (parsed.kind === 'assembly' && typeof content === 'string') {
      try {
        const loaded = parseSurfJsonV2(content);
        if (!doc?.id || loaded.id === doc.id) {
          nextDoc = { ...loaded, source: 'git', vaultLayout: 'v2' };
        }
      } catch { /* keep the open document */ }
    }
  }
  return { doc: nextDoc, scripts: nextScripts };
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

async function loadTreeContents(adapter, repo, tree) {
  const files = {};
  const failed = [];
  for (const entry of tree || []) {
    const path = entry?.path;
    if (!path || !shouldLoadForUpgrade(path)) continue;
    if (!entry.sha) {
      failed.push(path);
      continue;
    }
    let bytes;
    try {
      bytes = await adapter.readBlob(repo, entry.sha);
    } catch (err) {
      const wrapped = new Error(`Failed to read ${path}: ${err?.message || err}`);
      wrapped.code = 'git_error';
      wrapped.path = path;
      throw wrapped;
    }
    if (bytes == null) {
      failed.push(path);
      continue;
    }
    const u8 = bytes instanceof Uint8Array ? bytes : toUint8Array(bytes);
    if (/\.mesh$/i.test(path)) files[path] = u8;
    else files[path] = utf8FromBytes(u8);
  }
  if (failed.length) {
    const err = new Error(`Could not read vault file${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}. Upgrade aborted; nothing was written.`);
    err.code = 'git_error';
    err.paths = failed;
    throw err;
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

  let tree;
  let files;
  try {
    tree = await adapter.listTree(ref, baseSha);
    files = await loadTreeContents(adapter, ref, tree);
  } catch (err) {
    return hostError(
      err?.code || 'git_error',
      err?.message || 'Could not read the vault tree',
      'Upgrade aborted; nothing was written. Retry Upgrade vault.',
      { paths: err?.paths || (err?.path ? [err.path] : []) },
    );
  }

  let plan;
  try {
    plan = planUpgrade({
      tree,
      files,
      baseSha,
      assemblyIdByFolder: store?.assemblyIdIndexFor?.(ref) || {},
      pathIndex: store?.pathIndexFor?.(ref) || {},
      repoName: ref?.name,
      now: clock,
      randFor,
    });
  } catch (err) {
    return hostError(
      err?.code || 'git_error',
      err?.message || 'Upgrade plan failed',
      'Upgrade aborted; nothing was written.',
    );
  }
  if (plan.error) {
    return hostError(
      plan.error.code || 'git_error',
      plan.error.message,
      plan.error.hint,
      { paths: plan.error.paths || [] },
    );
  }

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

  const mapped = workingCopy?.doc
    ? mapWorkingCopyToPlan(plan, workingCopy)
    : { ok: true, doc: workingCopy?.doc, scripts: workingCopy?.scripts || {}, pairs: [], assets: workingCopy?.assets };
  if (workingCopy?.doc && !mapped.ok) {
    return hostError(
      mapped.code || 'working_copy_unmapped',
      mapped.message,
      mapped.hint,
      {
        phase: 'save',
        sha: upgradeSha,
        upgradeSha,
        commits: 1,
        leftoverFiles: plan.leftoverFiles,
        plan,
        unmapped: mapped.unmapped,
        ambiguous: mapped.ambiguous,
      },
    );
  }
  const followupWc = workingCopy?.dirty
    ? { ...workingCopy, doc: mapped.doc, scripts: mapped.scripts, assets: mapped.assets }
    : workingCopy;
  const followup = planWorkingCopyFollowup(plan, followupWc);
  const rekey = {
    doc: mapped.doc,
    scripts: mapped.scripts,
    pairs: mapped.pairs || [],
  };
  if (!followup.length) {
    return {
      status: 'upgraded',
      sha: upgradeSha,
      branch: branchName,
      files: plan.files.map((f) => f.path),
      leftoverFiles: plan.leftoverFiles,
      plan,
      commits: 1,
      rekey,
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
          tipSha: upgradeSha,
          leftoverFiles: plan.leftoverFiles,
          rekey,
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
          tipSha: upgradeSha,
          leftoverFiles: plan.leftoverFiles,
          rekey,
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
      const openId = asV2Id(followupWc?.doc?.id);
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
      leftoverFiles: plan.leftoverFiles,
      plan,
      commits: 2,
      rekey,
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
          tipSha: upgradeSha,
          leftoverFiles: plan.leftoverFiles,
          rekey,
        },
      );
    }
    return hostError(
      err?.code || 'git_error',
      err?.message || 'Follow-up Save failed',
      'The vault is v2. Retry Save, or Overwrite / Get latest / Save mine to a new branch / Dismiss.',
      { phase: 'save', upgradeSha, files: followup, leftoverFiles: plan.leftoverFiles, rekey },
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

function conflictReloadPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter((path) => typeof path === 'string' && path);
}

/**
 * TEMPORARY: §2.9 on the follow-up Save only. PR 7 replaces this with the
 * shared conflict dialog + planSave. Get latest never writes git.
 * Save mine to a new branch starts from tipSha (the Upgrade commit), not
 * the moved remote head.
 */
export async function executeUpgradeConflictChoice({
  action,
  adapter,
  repo,
  branch = 'main',
  files,
  paths,
  message,
  store = null,
  assemblyId = null,
  now,
  tipSha = null,
} = {}) {
  if (action === 'overwrite') {
    return executeUpgradeFollowup({
      adapter, repo, branch, files, message, store, assemblyId, now,
    });
  }
  if (action === 'reload') {
    const want = conflictReloadPaths(paths);
    if (!want.length) {
      return hostError(
        'bad_args',
        'Get latest needs the conflicting paths.',
        'Retry Get latest from the Upgrade conflict dialog. Other local edits were not touched.',
      );
    }
    assertGithubAdapter(adapter);
    const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
    const head = await adapter.getBranch(repo, branchName);
    const headSha = head?.sha || null;
    const contents = {};
    if (headSha) {
      const tree = await adapter.listTree(repo, headSha);
      const shaByPath = new Map((tree || []).filter((item) => item?.path).map((item) => [item.path, item.sha]));
      for (const path of want) {
        const sha = shaByPath.get(path);
        if (!sha) continue;
        const bytes = await adapter.readBlob(repo, sha);
        if (bytes == null) continue;
        const u8 = bytes instanceof Uint8Array ? bytes : toUint8Array(bytes);
        contents[path] = /\.mesh$/i.test(path) ? u8 : utf8FromBytes(u8);
      }
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
    const fromSha = tipSha || head?.sha || null;
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
      switched: true,
      fromSha,
    };
  }
  return hostError(
    'bad_args',
    'Unknown conflict action',
    'Overwrite, Get latest, Save mine to a new branch, or Dismiss.',
  );
}
