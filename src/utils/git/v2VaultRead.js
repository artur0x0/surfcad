/**
 * v2 vault list/open by assembly id. Path is f(id) only.
 * Read-only: never commits, never creates a repo.
 */
import { assemblyName, partDefinitionId, serializeAssembly } from '../assembly.js';
import { assertGithubAdapter } from './githubAdapterInterface.js';
import { assemblyIdPath, parseIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { readMeshBytes } from './meshSync.js';
import { parseSurfJsonV2 } from './surfJsonV2.js';
import { isV2SurfId, readSurfName } from './surfId.js';

/** Row title when no `.surf.json` row and no `// @name` header names a part. */
export const UNTITLED_PART_NAME = 'Untitled part';

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

function readJsonLoose(content) {
  if (content == null) return null;
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function byNameThenId(a, b) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Open-dialog index for a v2 tree: every assembly and every part script,
 * by name. Ids stay the key. One read per `assemblies/<id>.surf.json`
 * gives the assembly name and that assembly's part names; a part no
 * assembly lists, or that two assemblies name differently, reads its own
 * `// @name` header. Nothing names it → UNTITLED_PART_NAME. Never the id.
 * An assembly file that cannot be read throws (the dialog shows the error).
 * `tree` is an optional listTree() result so a caller does not list twice.
 * -> { assemblies: [{ kind:'assembly', id, name, label, partIds }],
 *      parts: [{ kind:'part', id, path, name, label, assemblies: [{ id, name }] }] }
 */
export async function listV2BrowseItems(adapter, repo, ref = 'main', { tree = null } = {}) {
  assertGithubAdapter(adapter);
  const entries = tree || (await adapter.listTree(repo, ref));
  const assemblyFiles = [];
  const partFiles = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const path = typeof entry === 'string' ? entry : entry?.path;
    const parsed = parseIdPath(path);
    if (!parsed || seen.has(`${parsed.kind}:${parsed.id}`)) continue;
    if (parsed.kind === 'assembly') {
      seen.add(`assembly:${parsed.id}`);
      assemblyFiles.push({ id: parsed.id, path });
    } else if (parsed.kind === 'part') {
      seen.add(`part:${parsed.id}`);
      partFiles.push({ id: parsed.id, path });
    }
  }

  const assemblies = await Promise.all(assemblyFiles.map(async ({ id, path }) => {
    const file = await adapter.readFile(repo, path, ref);
    const raw = readJsonLoose(file?.content);
    const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
    const rows = Array.isArray(raw?.parts) ? raw.parts : [];
    const partNames = [];
    for (const row of rows) {
      const def = partDefinitionId(row);
      if (!isV2SurfId(def)) continue;
      // An instance row's label is its own; only a primary row names the part.
      const instance = typeof row?.instanceOf === 'string' && row.instanceOf && row.instanceOf !== row.id;
      partNames.push({ id: def, name: !instance && typeof row.name === 'string' ? row.name.trim() : '' });
    }
    return { id, name, partNames };
  }));
  assemblies.sort(byNameThenId);

  // part id → the names its parents store, and those parents by name.
  const parents = new Map();
  for (const asm of assemblies) {
    for (const row of asm.partNames) {
      if (!parents.has(row.id)) parents.set(row.id, { names: new Set(), assemblies: [] });
      const hit = parents.get(row.id);
      if (row.name) hit.names.add(row.name);
      if (!hit.assemblies.some((item) => item.id === asm.id)) {
        hit.assemblies.push({ id: asm.id, name: asm.name });
      }
    }
  }

  const parts = await Promise.all(partFiles.map(async ({ id, path }) => {
    const hit = parents.get(id) || { names: new Set(), assemblies: [] };
    const stored = [...hit.names];
    let name = stored.length === 1 ? stored[0] : '';
    if (!name) {
      // No parent, or parents disagree (a shared part renamed in one of
      // them): the script header is the committed name.
      try {
        const file = await adapter.readFile(repo, path, ref);
        const header = readSurfName(typeof file?.content === 'string' ? file.content : '');
        if (header) name = header;
      } catch {
        /* the name is a label; fall through */
      }
      if (!name && stored.length) [name] = stored;
    }
    name = name || UNTITLED_PART_NAME;
    return { kind: 'part', id, path, name, label: name, assemblies: hit.assemblies };
  }));
  parts.sort(byNameThenId);

  return {
    assemblies: assemblies.map(({ id, name, partNames }) => ({
      kind: 'assembly',
      id,
      name,
      label: name,
      partIds: partNames.map((row) => row.id),
    })),
    parts,
  };
}

/**
 * Open dialog labels for the assembly that is open right now.
 * Committed names update on Save; until then the working-copy labels win
 * for this assembly id and its part ids. Other assemblies stay as committed.
 * Does not write git.
 */
export function overlayWorkingCopyBrowseNames(browse, doc) {
  if (!browse || typeof browse !== 'object') return browse;
  if (!doc || doc.vaultLayout !== 'v2' || !isV2SurfId(doc.id)) return browse;
  const asmName = assemblyName(doc);
  const partNames = new Map();
  for (const row of doc.parts || []) {
    if (!row) continue;
    const instance = typeof row.instanceOf === 'string' && row.instanceOf && row.instanceOf !== row.id;
    if (instance) continue;
    const def = partDefinitionId(row);
    if (!isV2SurfId(def)) continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name) partNames.set(def, name);
  }
  const assemblies = (browse.assemblies || []).map((item) => {
    if (!item || item.id !== doc.id || !asmName) return item;
    return { ...item, name: asmName, label: asmName };
  });
  const parts = (browse.parts || []).map((item) => {
    const name = item && partNames.get(item.id);
    if (!name) return item;
    const parents = (item.assemblies || []).map((parent) => (
      parent && parent.id === doc.id ? { ...parent, name: asmName } : parent
    ));
    return { ...item, name, label: name, assemblies: parents };
  });
  return { ...browse, assemblies, parts };
}

async function loadV2Meshes(adapter, repo, branch, parts) {
  const assets = {};
  if (typeof adapter?.listTree !== 'function') return assets;
  const tree = await adapter.listTree(repo, branch);
  const shaByPath = new Map(
    (tree || []).filter((entry) => entry?.path).map((entry) => [entry.path, entry.sha]),
  );
  for (const part of parts || []) {
    const def = partDefinitionId(part);
    if (!isV2SurfId(def) || part.missing === true) continue;
    let meshPath;
    try { meshPath = partMeshIdPath(def); } catch { continue; }
    if (!shaByPath.has(meshPath) || assets[meshPath]) continue;
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
  const missingDefs = new Set();
  for (const part of parsed.parts || []) {
    // Scripts are per definition: an instance row reads parts/<instanceOf>.js.
    const def = partDefinitionId(part);
    if (typeof scripts[def] === 'string') {
      parts.push(part);
      continue;
    }
    if (missingDefs.has(def)) {
      parts.push({ ...part, missing: true });
      continue;
    }
    let scriptPath;
    try { scriptPath = partIdPath(def); } catch {
      missingDefs.add(def);
      parts.push({ ...part, missing: true });
      continue;
    }
    const got = await adapter.readFile(repo, scriptPath, branch);
    if (!got || typeof got.content !== 'string') {
      missingDefs.add(def);
      parts.push({ ...part, missing: true });
      continue;
    }
    scripts[def] = got.content;
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
