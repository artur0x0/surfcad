/**
 * Working-copy baseline taken at the last vault open (or explicit reset).
 * Shared so the legacy reader can capture without importing gitWorkspace
 * (openVaultAssembly dispatches into legacyVault).
 */
import { serializeAssembly } from '../assembly.js';
import { gitBlobSha, isBinaryContent, toUint8Array } from './binaryContent.js';
import { partRepoPath, partScriptText } from './partIdentity.js';
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
