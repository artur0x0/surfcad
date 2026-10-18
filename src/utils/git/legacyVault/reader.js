// TEMPORARY: remove after Artur's vault is upgraded
/**
 * Open a v1 (path-named) vault assembly into the working copy by surf-id.
 * Read-only: never commits, never creates a repo, never writes git.
 */
import { serializeAssembly } from '../../assembly.js';
import { assertGithubAdapter } from '../githubAdapterInterface.js';
import { parseSurfJson } from '../surfJson.js';
import { readMeshBytes } from '../meshSync.js';
import { captureBaseline } from '../gitBaseline.js';
import { collapseWorkingCopyIds } from '../wcIdentity.js';
import { partRepoPath } from '../partIdentity.js';
import { vaultSegment } from '../vaultLayout.js';
import { assemblyMetaCandidates, listLegacyAssemblyNames } from './detect.js';

function scriptPathOf(part) {
  if (typeof part?.path === 'string' && part.path.trim()) return part.path;
  const id = String(part?.id || '');
  return id.includes('/') && id.endsWith('.js') ? id : null;
}

/** v1 `.surf.json` parse for open. Do not call `parseSurfJson` on a v1 tree outside this folder. */
function parseLegacySurfJson(input) {
  return parseSurfJson(input);
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
  const parts = (collapsed.doc.parts || []).map((part) => {
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
    ...collapsed.doc,
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
