/**
 * Vault round-trip for `importMesh` uploads.
 *
 * Save passes cached bytes into `assembleCommitFiles` as
 * `assets: { [meshPath]: Uint8Array }`. Open reads the asset cache by blob
 * sha first, then `readVaultAsset`. A shared `parts/<Part>.mesh` that is
 * already in the vault is not replaced.
 */
import { numberedName } from '../assembly.js';
import { checkStoredMesh, meshAssetNames } from '../meshAssets.js';
import { getAssetBytes, putAsset } from './assetCache.js';
import { gitBlobSha, VaultFileTooLargeError } from './binaryContent.js';
import { readVaultAsset } from './githubAdapter.js';
import {
  assemblyPartPath,
  assetPathForScript,
  parseVaultPath,
  vaultSegment,
} from './vaultLayout.js';

/** Git Save may commit meshes only when the vault is writable. */
export function meshVaultSaveAllowed({
  source, readOnly, githubConnected, adapterKind,
} = {}) {
  if (source !== 'git') return false;
  if (adapterKind === 'mock') return true;
  if (readOnly === true) return false;
  return githubConnected === true;
}

function isSharedMesh(meshPath) {
  const info = parseVaultPath(meshPath);
  return info?.kind === 'asset' && !info.assembly;
}

/**
 * A local row whose script calls `importMesh` gets an assembly-folder path
 * (`assemblies/<Name>/<Part>.js`) so its mesh can sit beside the script.
 * A taken script or mesh path uses `Name (2)`. Shared `parts/` files are
 * not chosen here.
 * -> { doc, scripts, moved: [{ from, to, name }] }
 */
export function placeLocalMeshParts(doc, scripts, { occupied = [] } = {}) {
  const taken = new Set((occupied || []).filter((path) => typeof path === 'string'));
  for (const part of doc?.parts || []) {
    if (part?.id) taken.add(part.id);
  }
  const asm = vaultSegment(doc?.name) || 'Assembly';
  const moved = [];
  const parts = [];
  const nextScripts = { ...(scripts || {}) };
  let activeId = doc?.activeId;
  for (const part of doc?.parts || []) {
    const info = parseVaultPath(part.id);
    const inVault = info?.kind === 'assembly-part' || info?.kind === 'shared-part';
    const text = nextScripts[part.id] ?? '';
    if (inVault || !meshAssetNames(text).length) {
      parts.push(part);
      continue;
    }
    const base = vaultSegment(part.name) || 'Part';
    let dest = null;
    let leaf = base;
    for (let n = 0; n < 1000; n += 1) {
      leaf = n === 0 ? base : numberedName(base, n + 1);
      let scriptPath;
      try {
        scriptPath = assemblyPartPath(asm, leaf);
      } catch {
        continue;
      }
      const meshPath = assetPathForScript(scriptPath);
      if (taken.has(scriptPath) || (meshPath && taken.has(meshPath))) continue;
      dest = scriptPath;
      taken.add(scriptPath);
      if (meshPath) taken.add(meshPath);
      break;
    }
    if (!dest) {
      const err = new Error(`No free vault path for ${base}`);
      err.code = 'no_mesh_path';
      throw err;
    }
    delete nextScripts[part.id];
    nextScripts[dest] = text;
    if (activeId === part.id) activeId = dest;
    moved.push({ from: part.id, to: dest, name: leaf });
    parts.push({ ...part, id: dest, name: leaf });
  }
  return {
    doc: { ...(doc || {}), parts, activeId },
    scripts: nextScripts,
    moved,
  };
}

/** Move `{ assets, meshSynced }` records onto the paths Save will commit. */
export function remapMeshRecords(records, moved) {
  const next = { ...(records || {}) };
  for (const { from, to } of moved || []) {
    if (!from || !to || !Object.prototype.hasOwnProperty.call(next, from)) continue;
    next[to] = next[from];
    delete next[from];
  }
  return next;
}

function shaForName(record, names, leaf) {
  const assets = record?.assets;
  if (!assets || typeof assets !== 'object') return { name: null, sha: null };
  if (leaf && assets[leaf]) return { name: leaf, sha: assets[leaf] };
  for (const name of names || []) {
    if (assets[name]) return { name, sha: assets[name] };
  }
  return { name: null, sha: null };
}

/**
 * Unsynced meshes for one Save.
 * `tree` is a listTree result (`{ path, sha }`).
 * Throws `VaultFileTooLargeError` (with `toast`) over 40 MiB.
 * -> { assets, marks, warnings, skipped }
 * `assets` is `{ [meshPath]: Uint8Array }` for `assembleCommitFiles`.
 * `marks` are the rows that become `meshSynced` once the commit lands.
 * An adopted mark is already the vault blob and does not need a write.
 */
export async function collectMeshCommitAssets({
  doc,
  scripts,
  records = {},
  baseline = null,
  tree = [],
  readBytes = getAssetBytes,
} = {}) {
  const treeSha = new Map();
  for (const entry of tree || []) {
    const path = entry?.path ?? (typeof entry === 'string' ? entry : '');
    if (!path) continue;
    treeSha.set(path, typeof entry?.sha === 'string' ? entry.sha : null);
  }
  const assets = {};
  const marks = [];
  const warnings = [];
  const skipped = [];
  for (const part of doc?.parts || []) {
    const text = scripts?.[part.id] ?? '';
    const names = meshAssetNames(text);
    if (!names.length) continue;
    const meshPath = assetPathForScript(part.id);
    if (!meshPath) continue;
    const record = records?.[part.id];
    if (record?.meshSynced === true) continue;
    const leaf = meshPath.split('/').pop();
    const found = shaForName(record, names, leaf);
    if (!found.sha) continue;
    let bytes = null;
    try {
      bytes = await readBytes(found.sha);
    } catch {
      bytes = null;
    }
    if (!(bytes instanceof Uint8Array)) {
      skipped.push({
        partId: part.id,
        meshPath,
        message: `${meshPath} is still only on this device, and its bytes were not available to commit.`,
      });
      continue;
    }
    const cap = checkStoredMesh(bytes.byteLength);
    if (!cap.ok) {
      const err = new VaultFileTooLargeError(meshPath, bytes.byteLength);
      err.toast = cap.message;
      err.partId = part.id;
      throw err;
    }
    if (cap.warn) warnings.push({ path: meshPath, partId: part.id, message: cap.message });
    const ours = gitBlobSha(bytes);
    const remoteSha = baseline?.assets?.[meshPath] || treeSha.get(meshPath) || null;
    const inTree = treeSha.has(meshPath) || !!baseline?.assets?.[meshPath];
    if (isSharedMesh(meshPath) && inTree && remoteSha !== ours) {
      skipped.push({
        partId: part.id,
        meshPath,
        message: `${meshPath} is already in the vault and was left unchanged.`,
      });
      continue;
    }
    const mark = {
      partId: part.id,
      assetName: found.name,
      sha: ours,
      meshPath,
      adopted: remoteSha === ours,
    };
    if (mark.adopted) {
      marks.push(mark);
      continue;
    }
    assets[meshPath] = bytes;
    marks.push(mark);
  }
  return { assets, marks, warnings, skipped };
}

/**
 * Part-record map for a vault open. The script's `importMesh` name points
 * at the sibling blob sha. `meshSynced` is true because the bytes are in
 * the vault. No `importMesh` call means no record.
 */
export function partMeshRecordsFromBaseline(doc, scripts, baselineAssets) {
  const out = {};
  const shas = baselineAssets || {};
  for (const part of doc?.parts || []) {
    const meshPath = assetPathForScript(part.id);
    const sha = meshPath ? shas[meshPath] : null;
    if (!sha) continue;
    const names = meshAssetNames(scripts?.[part.id] || '');
    if (!names.length) continue;
    const leaf = meshPath.split('/').pop();
    const name = names.includes(leaf) ? leaf : names[0];
    out[part.id] = { assets: { [name]: sha }, meshSynced: true };
  }
  return out;
}

/**
 * Cache by blob sha, then `readVaultAsset` (tree sha + readBlob).
 * A fetched blob is stored with `putAsset`.
 * -> { sha, bytes, source: 'cache'|'vault' } | null
 */
export async function readMeshBytes(adapter, repo, ref, meshPath, sha) {
  if (sha) {
    try {
      const cached = await getAssetBytes(sha);
      if (cached instanceof Uint8Array) return { sha, bytes: cached, source: 'cache' };
    } catch {
      /* cache miss falls through to the vault */
    }
  }
  const got = await readVaultAsset(adapter, repo, meshPath, ref);
  if (!(got?.bytes instanceof Uint8Array)) return null;
  let stored = got.sha || sha || null;
  try {
    stored = await putAsset(got.bytes);
  } catch {
    /* the caller still receives the bytes */
  }
  return { sha: stored || got.sha, bytes: got.bytes, source: 'vault' };
}
