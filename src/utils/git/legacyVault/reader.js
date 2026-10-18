// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Open a v1 (path-named) vault assembly into the working copy by surf-id.
 * Read-only: never commits, never creates a repo, never writes git.
 */
import { serializeAssembly } from '../../assembly.js';
import { assertGithubAdapter } from '../githubAdapterInterface.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../idPaths.js';
import {
  parseSurfJson,
  pruneDanglingColors,
  pruneDanglingGroupPartIds,
} from '../surfJson.js';
import { pruneDanglingSurfJoints } from '../../jointSchema.js';
import { readMeshBytes } from '../meshSync.js';
import { captureBaseline } from '../gitBaseline.js';
import { collapseWorkingCopyIds } from '../wcIdentity.js';
import { partRepoPath } from '../partIdentity.js';
import { isV2SurfId } from '../surfId.js';
import { vaultSegment } from '../vaultLayout.js';
import { assemblyMetaCandidates, listLegacyAssemblyNames } from './detect.js';

function scriptPathOf(part) {
  if (typeof part?.path === 'string' && part.path.trim()) return part.path;
  const id = String(part?.id || '');
  return id.includes('/') && id.endsWith('.js') ? id : null;
}

function legacyPartName(part) {
  const name = typeof part?.name === 'string' ? part.name.trim() : '';
  if (name && !name.includes('/')) return name;
  const path = typeof part?.path === 'string' ? part.path : '';
  const leaf = path.split('/').pop()?.replace(/\.js$/i, '') || '';
  return leaf || name || 'Part';
}

/** v1 `.surf.json` parse for open. Do not call `parseSurfJson` on a v1 tree outside this folder. */
function parseLegacySurfJson(input) {
  // Defer dangling prune until after collapse: a UUID `parts[].id` with
  // header-keyed groups/colors/joints must remap U→S first or those refs drop.
  const doc = parseSurfJson(input, { allowDuplicatePartIds: true, pruneDangling: false });
  const parts = (doc.parts || []).map((part) => {
    const name = legacyPartName(part);
    return name === part.name ? part : { ...part, name };
  });
  return parts === doc.parts ? doc : { ...doc, parts };
}

/** Drop refs that still don't match a row after collapse remapped U→S. */
function pruneCollapsedRefs(doc) {
  const raw = pruneDanglingSurfJoints(pruneDanglingColors(pruneDanglingGroupPartIds({
    parts: doc?.parts,
    groups: doc?.groups,
    colors: doc?.colors,
    joints: doc?.joints,
  })));
  const next = { ...doc };
  if (raw.groups) next.groups = raw.groups;
  else delete next.groups;
  if (raw.colors) next.colors = raw.colors;
  else delete next.colors;
  if (raw.joints) next.joints = raw.joints;
  else delete next.joints;
  return next;
}

function sidecarMeshPath(scriptPath) {
  if (!scriptPath || !/\.js$/i.test(scriptPath)) return null;
  return scriptPath.replace(/\.js$/i, '.mesh');
}

async function loadSidecarMeshes(adapter, repo, branch, parts) {
  const assets = {};
  if (typeof adapter?.listTree !== 'function') return assets;
  const tree = await adapter.listTree(repo, branch);
  const shaByPath = new Map(
    (tree || []).filter((entry) => entry?.path).map((entry) => [entry.path, entry.sha]),
  );
  for (const part of parts || []) {
    const scriptPath = scriptPathOf(part);
    const mesh = sidecarMeshPath(scriptPath);
    if (!mesh || !shaByPath.has(mesh)) continue;
    const sha = shaByPath.get(mesh);
    let got = null;
    try {
      got = await readMeshBytes(adapter, repo, branch, mesh, sha);
    } catch {
      got = null;
    }
    if (!(got?.bytes instanceof Uint8Array)) continue;
    assets[mesh] = got.bytes;
  }
  return assets;
}

/**
 * Load one v1 assembly: parse path-named `.surf.json`, read each part by
 * path, map rows onto surf-ids. A missing blob is a `missing` row — never
 * an empty script. Sets `vaultLayout: "legacy"`. Does not write git.
 */
export async function openLegacyAssembly(adapter, repo, assemblyName, {
  branch = 'main',
  headSha = null,
  onProgress = null,
  pathIndex = {},
  knownAssemblyId = null,
  assemblyIdIndex = {},
  usedAssemblyIds = null,
  now,
  randFor,
} = {}) {
  assertGithubAdapter(adapter);
  const name = vaultSegment(assemblyName);
  if (!name) throw new Error('Empty assembly name');
  const persistedId = knownAssemblyId || assemblyIdIndex?.[name] || null;
  const usedAsm = new Set(usedAssemblyIds || Object.values(assemblyIdIndex || {}));
  if (persistedId) usedAsm.delete(persistedId);

  let file = null;
  let foundPath = null;
  for (const candidate of assemblyMetaCandidates(name)) {
    file = await adapter.readFile(repo, candidate, branch);
    if (file) {
      foundPath = candidate;
      break;
    }
  }
  if (!file || !foundPath) {
    throw new Error(`Assembly not found: assemblies/${name}/.surf.json`);
  }

  const parsed = parseLegacySurfJson(file.content);
  const rawScripts = {};
  const missingPaths = new Set();
  const partTotal = (parsed.parts || []).length;
  onProgress?.({ index: 0, total: partTotal, phase: 'document' });
  for (let i = 0; i < partTotal; i += 1) {
    const part = parsed.parts[i];
    onProgress?.({ index: i + 1, total: partTotal, phase: 'script', name: parsed.name });
    const path = scriptPathOf(part);
    if (!path) {
      missingPaths.add(part.id);
      continue;
    }
    const got = await adapter.readFile(repo, path, branch);
    if (!got || typeof got.content !== 'string') {
      missingPaths.add(path);
      continue;
    }
    rawScripts[path] = got.content;
    if (part.id && part.id !== path) rawScripts[part.id] = got.content;
  }

  const collapsed = collapseWorkingCopyIds(
    {
      ...parsed,
      source: 'git',
      ...(persistedId ? { id: persistedId } : {}),
    },
    rawScripts,
    { pathIndex, now, randFor, usedAssemblyIds: usedAsm },
  );
  const collapsedDoc = pruneCollapsedRefs(collapsed.doc);
  const parts = (collapsedDoc.parts || []).map((part) => {
    const path = scriptPathOf(part) || partRepoPath(part);
    const missing = part.missing === true
      || missingPaths.has(path)
      || missingPaths.has(part.id)
      || typeof collapsed.scripts[part.id] !== 'string';
    if (!missing) return part;
    return { ...part, missing: true };
  });
  const scripts = { ...collapsed.scripts };
  for (const part of parts) {
    if (part.missing === true) {
      delete scripts[part.id];
      const path = scriptPathOf(part);
      if (path) delete scripts[path];
    }
  }
  const assets = await loadSidecarMeshes(adapter, repo, branch, parts);
  const doc = serializeAssembly({
    ...collapsedDoc,
    source: 'git',
    parts,
    vaultLayout: 'legacy',
  });
  const head = headSha || (await adapter.getBranch(repo, branch))?.sha || null;
  const baseline = captureBaseline({
    assemblyPath: foundPath,
    assemblyName: doc.name,
    doc,
    scripts,
    assets,
    branch,
    headSha: head,
  });
  return {
    doc,
    scripts,
    assets,
    assemblyPath: foundPath,
    rawAssemblyText: file.content ?? '',
    baseline,
    vaultLayout: 'legacy',
    identities: {
      minted: collapsed.minted,
      pairs: collapsed.pairs,
      cached: collapsed.cached,
      assemblyMinted: collapsed.assemblyMinted === true,
    },
  };
}

/** Assembly folder names in a v1 tree, sorted. */
export async function listLegacyAssemblies(adapter, repo, ref = 'main') {
  assertGithubAdapter(adapter);
  const tree = await adapter.listTree(repo, ref);
  return listLegacyAssemblyNames(tree);
}

/**
 * f(id) path → v1 blob path for lastCommit capture. files keys stay f(id);
 * the tree still has folder names. Callers outside this folder must not
 * parse v1 paths themselves.
 */
export function lastCommitBlobSources(opened) {
  const sources = {};
  const assemblyId = opened?.doc?.id;
  const assemblyBlob = typeof opened?.assemblyPath === 'string'
    ? opened.assemblyPath.trim()
    : '';
  if (isV2SurfId(assemblyId) && assemblyBlob) {
    try { sources[assemblyIdPath(assemblyId)] = assemblyBlob; } catch { /* skip */ }
  }
  for (const hit of opened?.identities?.cached || []) {
    const id = hit?.id;
    const blob = typeof hit?.path === 'string' ? hit.path.trim() : '';
    if (!isV2SurfId(id) || !blob) continue;
    try {
      sources[partIdPath(id)] = blob;
      const mesh = sidecarMeshPath(blob);
      if (mesh) sources[partMeshIdPath(id)] = mesh;
    } catch { /* skip */ }
  }
  return sources;
}
