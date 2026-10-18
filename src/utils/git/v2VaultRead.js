/**
 * v2 vault list/open by assembly id. Path is f(id) only.
 * Read-only: never commits, never creates a repo.
 */
import { serializeAssembly } from '../assembly.js';
import { assertGithubAdapter } from './githubAdapterInterface.js';
import { assemblyIdPath, parseIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { readMeshBytes } from './meshSync.js';
import { parseSurfJsonV2 } from './surfJsonV2.js';
import { isV2SurfId } from './surfId.js';

function notFoundError(assemblyId) {
  const err = new Error(`Unknown assembly id: ${assemblyId}`);
  err.code = 'unknown_assembly';
  return err;
}

/** [{ id, name }] for v2 assemblies on `ref`. No paths. */
export async function listV2Assemblies(adapter, repo, ref = 'main') {
  assertGithubAdapter(adapter);
  const tree = await adapter.listTree(repo, ref);
  const rows = [];
  const seen = new Set();
  for (const entry of tree || []) {
    const path = typeof entry === 'string' ? entry : entry?.path;
    const parsed = parseIdPath(path);
    if (parsed?.kind !== 'assembly' || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    let name = parsed.id;
    try {
      const file = await adapter.readFile(repo, path, ref);
      if (file?.content != null) {
        const raw = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
        if (typeof raw?.name === 'string' && raw.name.trim()) name = raw.name.trim();
      }
    } catch {
      /* keep id as the label */
    }
    rows.push({ id: parsed.id, name });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return rows;
}

async function loadV2Meshes(adapter, repo, branch, parts) {
  const assets = {};
  if (typeof adapter?.listTree !== 'function') return assets;
  const tree = await adapter.listTree(repo, branch);
  const shaByPath = new Map(
    (tree || []).filter((entry) => entry?.path).map((entry) => [entry.path, entry.sha]),
  );
  for (const part of parts || []) {
    if (!isV2SurfId(part?.id) || part.missing === true) continue;
    let meshPath;
    try { meshPath = partMeshIdPath(part.id); } catch { continue; }
    if (!shaByPath.has(meshPath)) continue;
    try {
      const bytes = await readMeshBytes(adapter, repo, branch, meshPath, shaByPath.get(meshPath));
      if (bytes) assets[meshPath] = bytes;
    } catch {
      /* sidecar optional */
    }
  }
  return assets;
}

/**
 * Open one v2 assembly by surf-id.
 * Missing `parts/<id>.js` → `missing` row, never an empty script.
 */
export async function openV2Assembly(adapter, repo, assemblyId, opts = {}) {
  assertGithubAdapter(adapter);
  const id = typeof assemblyId === 'string' ? assemblyId.trim() : '';
  if (!isV2SurfId(id)) throw notFoundError(assemblyId);
  const branch = opts.branch || 'main';
  const assemblyPath = assemblyIdPath(id);
  const file = await adapter.readFile(repo, assemblyPath, branch);
  if (!file || file.content == null) throw notFoundError(id);

  const parsed = parseSurfJsonV2(file.content);
  const scripts = {};
  const parts = [];
  for (const part of parsed.parts || []) {
    let scriptPath;
    try { scriptPath = partIdPath(part.id); } catch {
      parts.push({ ...part, missing: true });
      continue;
    }
    const got = await adapter.readFile(repo, scriptPath, branch);
    if (!got || typeof got.content !== 'string') {
      parts.push({ ...part, missing: true });
      continue;
    }
    scripts[part.id] = got.content;
    parts.push(part);
  }

  const doc = serializeAssembly({
    ...parsed,
    id,
    source: 'git',
    parts,
    vaultLayout: 'v2',
  });
  const assets = await loadV2Meshes(adapter, repo, branch, parts);
  const head = opts.headSha || (await adapter.getBranch(repo, branch))?.sha || null;
  const baseline = {
    assemblyPath,
    assemblyName: doc.name,
    assemblyText: typeof file.content === 'string' ? file.content : '',
    scripts: { ...scripts },
    assets,
    branch,
    headSha: head,
  };
  return {
    doc,
    scripts,
    assets,
    assemblyPath,
    rawAssemblyText: typeof file.content === 'string' ? file.content : '',
    baseline,
    vaultLayout: 'v2',
    identities: { minted: [], pairs: [], cached: [], assemblyMinted: false },
  };
}

/**
 * Other assemblies on this branch that list `partId`.
 * listTree failure is fail-closed (treat as referenced).
 */
export async function listPartParentAssemblies(adapter, repo, partId, {
  branch = 'main',
  exceptAssemblyId = null,
} = {}) {
  if (!isV2SurfId(partId)) return { ok: false, assemblies: [] };
  try {
    const rows = await listV2Assemblies(adapter, repo, branch);
    const assemblies = [];
    for (const row of rows) {
      if (exceptAssemblyId && row.id === exceptAssemblyId) continue;
      const path = assemblyIdPath(row.id);
      const file = await adapter.readFile(repo, path, branch);
      if (!file || file.content == null) continue;
      let json;
      try {
        json = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
      } catch {
        continue;
      }
      const ids = [
        ...(Array.isArray(json?.parts) ? json.parts.map((part) => part?.id) : []),
        ...(Array.isArray(json?.groups)
          ? json.groups.flatMap((group) => (Array.isArray(group?.partIds) ? group.partIds : []))
          : []),
      ];
      if (ids.includes(partId)) assemblies.push({ id: row.id, name: row.name });
    }
    return { ok: true, assemblies };
  } catch {
    return { ok: false, assemblies: [] };
  }
}
