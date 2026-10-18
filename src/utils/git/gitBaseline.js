/**
 * Working-copy baseline taken at the last vault open (or explicit reset).
 * Shared so the legacy reader can capture without importing gitWorkspace
 * (openVaultAssembly dispatches into legacyVault).
 */
import { serializeAssembly } from '../assembly.js';
import { gitBlobSha, isBinaryContent, toUint8Array } from './binaryContent.js';
import { rewriteFeaStudyPartIds } from './feaStudyIds.js';
import { isUuidPartId, partRepoPath, partScriptText } from './partIdentity.js';
import { isSurfId, rewriteColorMap, rewriteJointSurfIds } from './surfId.js';
import { stringifySurfJson } from './surfJson.js';
import { assemblyFilePath, assetPathForScript, vaultSegment } from './vaultLayout.js';

function assetShaValue(value) {
  if (value == null) return null;
  if (typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  if (isBinaryContent(value)) return gitBlobSha(toUint8Array(value));
  if (isBinaryContent(value?.bytes)) return value.sha || gitBlobSha(toUint8Array(value.bytes));
  if (typeof value?.sha === 'string' && /^[0-9a-f]{40}$/i.test(value.sha)) return value.sha.toLowerCase();
  return null;
}

function baselineAssetMap(parts, assets) {
  const assetMap = {};
  if (!assets || typeof assets !== 'object') return assetMap;
  for (const part of parts || []) {
    const scriptPath = partRepoPath(part) || part.id;
    const mesh = assetPathForScript(scriptPath);
    if (!mesh) continue;
    const value = Object.prototype.hasOwnProperty.call(assets, mesh)
      ? assets[mesh]
      : (Object.prototype.hasOwnProperty.call(assets, scriptPath) ? assets[scriptPath] : undefined);
    if (value == null) continue;
    const sha = assetShaValue(value);
    if (sha) assetMap[mesh] = sha;
  }
  return assetMap;
}

function pairIdMap(pairs = [], failedFrom = []) {
  const failed = failedFrom instanceof Set ? failedFrom : new Set(failedFrom || []);
  const map = new Map();
  for (const { from, to } of pairs || []) {
    if (!from || !to || from === to || failed.has(from)) continue;
    map.set(String(from), to);
  }
  return map;
}

function tipScriptForPart(part, tipScripts, fromByTo) {
  if (!part || !tipScripts) return undefined;
  const id = part.id;
  if (id && typeof tipScripts[id] === 'string') return tipScripts[id];
  const path = partRepoPath(part);
  if (path && typeof tipScripts[path] === 'string') return tipScripts[path];
  const from = id ? fromByTo.get(id) : undefined;
  if (from && typeof tipScripts[from] === 'string') return tipScripts[from];
  return undefined;
}

function uuidToSurfMap(pairs = []) {
  const map = new Map();
  for (const { from, to } of pairs || []) {
    if (!from || !to || from === to) continue;
    if (isUuidPartId(from) && isSurfId(to)) map.set(from, to);
  }
  return map;
}

/**
 * Baseline script map for open-time study remaps. The reader always runs in
 * UUID→surf-id mode: keep git-tip bytes only when collapse remapped a study
 * id from a non-surf / unsaved UUID to a surf id (the next `.surf.json`
 * rewrite drops that UUID). Empty `pairs` means no such remap — a path-keyed
 * study is rewritten in memory on every open and must not look dirty.
 * App recapture passes `openedScripts` and keeps tip bytes only where the
 * reader already chose them (`tipScripts[id] !== openedScripts[id]`).
 * `tipScripts` may be keyed by collapsed id, repo path, or pre-collapse id.
 * Does not write git.
 */
export function baselineScriptsKeepingTip(parts, wcScripts, tipScripts, opts = {}) {
  const options = Array.isArray(opts) ? { pairs: opts } : (opts || {});
  const pairs = options.pairs || [];
  const openedScripts = options.openedScripts;
  const fromByTo = new Map();
  for (const { from, to } of pairs) {
    if (from && to && from !== to) fromByTo.set(to, from);
  }
  const uuidMap = uuidToSurfMap(pairs);
  const out = { ...(wcScripts || {}) };
  for (const part of parts || []) {
    if (!part?.id || part.missing === true) continue;
    const wc = out[part.id];
    if (typeof wc !== 'string') continue;
    if (openedScripts && typeof openedScripts === 'object') {
      const readerBase = tipScripts?.[part.id];
      const readerWc = openedScripts[part.id];
      if (typeof readerBase === 'string' && typeof readerWc === 'string' && readerBase !== readerWc) {
        out[part.id] = readerBase;
      }
      continue;
    }
    const tip = tipScriptForPart(part, tipScripts, fromByTo);
    if (typeof tip !== 'string' || tip === wc) continue;
    if (!uuidMap.size || rewriteFeaStudyPartIds(tip, uuidMap) === tip) continue;
    out[part.id] = tip;
  }
  return out;
}

function remapGroupIds(groups, map) {
  if (!Array.isArray(groups) || !map.size) return groups;
  const get = (id) => (id != null && map.has(String(id)) ? map.get(String(id)) : id);
  return groups.map((group) => {
    if (!group || typeof group !== 'object') return group;
    const id = get(group.id);
    const partIds = Array.isArray(group.partIds) ? group.partIds.map((partId) => get(partId)) : group.partIds;
    if (id === group.id && (!partIds || partIds.every((partId, i) => partId === group.partIds[i]))) {
      return group;
    }
    return { ...group, id, partIds };
  });
}

/**
 * Tip assembly with part ids mapped through persist pairs. Failed rows keep
 * `from` so the baseline stays aligned with a reverted working-copy row.
 * Assembly text / partIds come from this remapped tip, never from the WC.
 */
export function remapTipDocThroughPairs(tipDoc, pairs = [], failedFrom = []) {
  if (!tipDoc) return tipDoc;
  const map = pairIdMap(pairs, failedFrom);
  const get = (id) => (id != null && map.has(String(id)) ? map.get(String(id)) : id);
  const parts = (tipDoc.parts || []).map((part) => {
    const nextId = get(part.id);
    if (nextId === part.id) return part;
    return { ...part, id: nextId };
  });
  const next = {
    ...tipDoc,
    parts,
    activeId: get(tipDoc.activeId),
  };
  if (Array.isArray(tipDoc.groups)) next.groups = remapGroupIds(tipDoc.groups, map);
  if (tipDoc.colors) next.colors = rewriteColorMap(tipDoc.colors, map);
  if (tipDoc.joints) next.joints = rewriteJointSurfIds(tipDoc.joints, map);
  return next;
}

/** Baseline for a re-keying reload: tip structure, ids mapped, tip script bytes. */
export function captureBaselineFromTip({
  tipDoc,
  tipBaseline,
  pairs = [],
  failedFrom = [],
} = {}) {
  const doc = remapTipDocThroughPairs(tipDoc, pairs, failedFrom);
  return captureBaseline({
    assemblyPath: tipBaseline?.assemblyPath,
    assemblyName: doc?.name || tipBaseline?.assemblyName,
    doc,
    scripts: tipBaseline?.scripts,
    assets: tipBaseline?.assets,
    branch: tipBaseline?.branch || 'main',
    headSha: tipBaseline?.headSha || null,
  });
}

export function captureBaseline({
  assemblyPath,
  assemblyName,
  doc,
  scripts,
  assets = null,
  branch = 'main',
  headSha = null,
} = {}) {
  const clean = serializeAssembly({ ...doc, source: 'git' });
  const scriptMap = {};
  for (const part of clean.parts) {
    const text = partScriptText(part, scripts);
    scriptMap[part.id] = typeof text === 'string' ? text : '';
  }
  return {
    assemblyPath: assemblyPath || assemblyFilePath(assemblyName || clean.name),
    assemblyName: vaultSegment(assemblyName || clean.name),
    assemblyText: stringifySurfJson(clean, { validate: false }),
    scripts: scriptMap,
    assets: baselineAssetMap(clean.parts, assets),
    partIds: clean.parts.map((p) => p.id),
    branch,
    headSha,
  };
}
