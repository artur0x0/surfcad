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
import { pruneDanglingColors, pruneDanglingGroupPartIds } from '../surfJson.js';
import { parseSurfJsonV2, stringifySurfJsonV2 } from '../surfJsonV2.js';
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
    const hasFile = !!(path && hasOwn(files, path) && typeof files[path] === 'string');
    const script = hasFile ? files[path] : '';
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
      hasFile,
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
    const hasFile = hasOwn(files, path) && typeof files[path] === 'string';
    if (partIdByPath[path]) {
      const id = partIdByPath[path];
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

/**
 * Map a dirty WC onto the upgrade plan's ids via the plan's legacy-path
 * map (not WC header ids). Rekeys in memory only — callers persist IDB.
 * Ambiguous / unmapped parts refuse the follow-up.
 */
export function mapWorkingCopyToPlan(plan, workingCopy) {
  if (!workingCopy?.doc) {
    return { ok: true, doc: null, scripts: {}, pairs: [], assets: workingCopy?.assets || null };
  }
  const pathToId = plan?.partIdByPath || {};
  const planIds = planIdsOf(plan);
  const folderToId = plan?.folderToId || {};
  const parts = workingCopy.doc.parts || [];
  const claimed = new Map();
  const unmapped = [];
  const ambiguous = [];

  const resolve = (part) => {
    const path = scriptPathOf(part);
    const fromPath = path ? pathToId[path] : null;
    const fromId = asV2Id(part?.id);
    if (fromPath && isV2SurfId(fromPath)) return fromPath;
    if (fromId && planIds.has(fromId) && !path) return fromId;
    return null;
  };

  for (const part of parts) {
    const planId = resolve(part);
    const label = part?.name || part?.id || scriptPathOf(part) || '(unnamed)';
    if (!planId) {
      unmapped.push(label);
      continue;
    }
    if (claimed.has(planId)) {
      ambiguous.push(label);
      continue;
    }
    claimed.set(planId, part);
  }

  if (unmapped.length || ambiguous.length) {
    const why = ambiguous.length
      ? `more than one working-copy part maps to the same upgraded id (${ambiguous.join(', ')})`
      : `working-copy part(s) have no unique path on the upgrade plan (${unmapped.join(', ')})`;
    return {
      ok: false,
      code: 'working_copy_unmapped',
      message: `Cannot save the working copy after Upgrade: ${why}. The vault is v2; the follow-up was not written.`,
      hint: 'Re-open the assembly from the upgraded vault, then Save. Local edits stay in IndexedDB.',
      unmapped,
      ambiguous,
    };
  }

  const pairs = [];
  const nextScripts = {};
  const scripts = workingCopy.scripts || {};
  const nextParts = parts.map((part) => {
    const planId = resolve(part);
    if (part?.id && part.id !== planId) pairs.push({ from: part.id, to: planId });
    const script = wcScriptOf(part, scripts);
    if (typeof script === 'string') nextScripts[planId] = script;
    const next = { ...part, id: planId };
    return next;
  });

  const idMap = new Map(pairs.map((row) => [row.from, row.to]));
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

  const assemblyId = asV2Id(workingCopy.doc.id)
    || folderToId[workingCopy.doc.name]
    || folderToId[Object.keys(folderToId).find((name) => name.toLowerCase() === String(workingCopy.doc.name || '').toLowerCase())]
    || null;

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
    ? { ...workingCopy.assets }
    : workingCopy.assets;

  return {
    ok: true,
    doc: nextDoc,
    scripts: nextScripts,
    pairs,
    assets,
  };
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

  const fromWcGroups = Array.isArray(doc.groups)
    ? doc.groups.map((group) => ({
      id: asV2Id(group.id) || group.id,
      name: sanitizeSurfName(group.name) || 'Group',
      source: mapGroupSource(group.source, folderToId),
      partIds: (group.partIds || []).map((id) => asV2Id(id) || id).filter((id) => isV2SurfId(id)),
    })).filter((group) => isV2SurfId(group.id) && group.partIds.length)
    : null;
  const groups = fromWcGroups && fromWcGroups.length ? fromWcGroups : prevJson?.groups;

  let activeId = asV2Id(doc.activeId);
  if (activeId && !parts.some((p) => p.id === activeId)) activeId = parts[0]?.id || null;

  const jsonText = stringifySurfJsonV2({
    id: assemblyId,
    name: sanitizeSurfName(doc.name) || prevJson?.name || 'Assembly',
    activeId,
    parts,
    groups,
    colors: doc.colors !== undefined ? doc.colors : prevJson?.colors,
    joints: doc.joints !== undefined ? doc.joints : prevJson?.joints,
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

async function loadCaptureLastCommit() {
  const mod = await import('../lastCommit.js');
  return mod.captureLastCommit;
}

async function captureAllLastCommit({
  adapter, repo, branch, store, sha, assemblies, now,
}) {
  const captureLastCommit = await loadCaptureLastCommit();
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

  const mapped = workingCopy?.dirty ? mapWorkingCopyToPlan(plan, workingCopy) : { ok: true, doc: workingCopy?.doc, scripts: workingCopy?.scripts, pairs: [], assets: workingCopy?.assets };
  if (workingCopy?.dirty && !mapped.ok) {
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
    const captureLastCommit = await loadCaptureLastCommit();
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
 * Save mine to a new branch starts from tipSha (the Upgrade commit), not
 * the moved remote head.
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
  tipSha = null,
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
    if (headSha) {
      const tree = await adapter.listTree(repo, headSha);
      const shaByPath = new Map((tree || []).filter((item) => item?.path).map((item) => [item.path, item.sha]));
      for (const row of files || []) {
        const path = row?.path;
        if (!path) continue;
        const sha = shaByPath.get(path);
        if (!sha) continue;
        const bytes = await adapter.readBlob(repo, sha);
        if (bytes == null) continue;
        const u8 = bytes instanceof Uint8Array ? bytes : toUint8Array(bytes);
        contents[path] = /\.mesh$/i.test(path) ? u8 : utf8FromBytes(u8);
      }
    }
    if (store && headSha) {
      const captureLastCommit = await loadCaptureLastCommit();
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
      const captureLastCommit = await loadCaptureLastCommit();
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
