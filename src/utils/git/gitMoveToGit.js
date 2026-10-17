/**
 * G6: Local → Git ("Move to Git").
 *
 * Takes the Local-mode working copy (assembly document + IndexedDB part
 * scripts, live editor text folded in), find-or-creates the vault (default
 * `surfcad`, rename field cleaned by `sanitizeVaultName`), writes the
 * assembly into the vault layout as ONE commit and hands back the git-mode
 * document, scripts keyed by repo path, and a clean baseline so the app can
 * switch to Git mode with no dirty badges.
 *
 *   assemblies/<asm>/.surf.json             nameless assembly metadata
 *   assemblies/<asm>/<part>.js              every new part
 *
 * Row ids stay. A path that already fits this assembly's folder is kept;
 * anything else lands at `assemblies/<asm>/<Name>.js`.
 * Name collisions get ` (2)`, ` (3)`… (case-insensitive, so the vault also
 * works on case-insensitive checkouts). An existing assembly-folder path
 * stays (a copy, or a part the layout migration has not moved yet).
 *
 * The move never overwrites vault content: when the assembly already
 * exists in the vault, or a planned part path exists with different
 * content, it returns `conflict` and writes nothing. Mock adapter only;
 * nothing here talks to the network.
 */
import { normalizeRepoPath, numberedName, serializeAssembly } from '../assembly.js';
import { assertGithubAdapter, fileWrite } from './githubAdapterInterface.js';
import { captureBaseline } from './gitWorkspace.js';
import { effectiveScripts } from './gitCommit.js';
import { stringifySurfJson } from './surfJson.js';
import { isStablePartId, partRepoPath } from './partIdentity.js';
import { DEFAULT_VAULT_NAME, findOrCreateVault, sanitizeVaultName } from './vault.js';
import {
  assemblyFilePath,
  assemblyPartPath,
  parseVaultPath,
  vaultSegment,
} from './vaultLayout.js';

const FALLBACK_PART = 'Part';

/** Part file base for a row: its name, else the old path's basename, else Part. */
function partBaseFor(row) {
  const fromName = vaultSegment(String(row?.name ?? '').replace(/\.js$/i, ''));
  if (fromName) return fromName;
  const info = parseVaultPath(row?.id);
  if (info?.part) return vaultSegment(info.part) || FALLBACK_PART;
  return FALLBACK_PART;
}

/**
 * Plan the move without touching the vault.
 * `sharedIds` — row ids the user wants under the top-level `parts/`.
 * -> { assemblyName, assemblyPath, doc, scripts, idMap: [{ from, to, shared }],
 *      files, missing: [path] }
 * `missing` lists rows with no script text (no file is written for them;
 * the row shows Find in repo in Git mode).
 */
export function planMoveToGit(doc, scripts, {
  sharedIds = [],
  liveId = null,
  liveScript = null,
} = {}) {
  const clean = serializeAssembly(doc || {});
  const assemblyName = vaultSegment(clean.name) || 'Assembly';
  const assemblyPath = assemblyFilePath(assemblyName);
  const eff = effectiveScripts(scripts, { liveId, liveScript });
  const wantShared = new Set((sharedIds || []).map(String));
  const taken = new Set(); // lower-cased paths
  const idMap = [];
  const nextScripts = {};
  const missing = [];
  const files = [];

  const claim = (makePath, base) => {
    for (let n = 1; n < 1000; n += 1) {
      const path = makePath(n === 1 ? base : numberedName(base, n));
      if (!taken.has(path.toLowerCase())) {
        taken.add(path.toLowerCase());
        return path;
      }
    }
    throw new Error(`No free path for ${base}`);
  };

  const parts = clean.parts.map((row) => {
    const existing = partRepoPath(row) || normalizeRepoPath(row.id);
    const info = existing ? parseVaultPath(existing) : null;
    let to = null;
    if (info?.kind === 'assembly-part' && info.assembly === assemblyName
      && !wantShared.has(row.id) && !taken.has(existing.toLowerCase())) to = existing;
    if (info?.kind === 'shared-part' && !taken.has(existing.toLowerCase())) to = existing;
    if (to) taken.add(to.toLowerCase());
    else {
      const base = partBaseFor(row);
      to = claim((b) => assemblyPartPath(assemblyName, b), base);
    }
    const destShared = parseVaultPath(to)?.kind === 'shared-part';
    idMap.push({ from: row.id, to, shared: destShared });
    const keepId = isStablePartId(row.id) || !existing || existing !== row.id;
    const nextId = keepId ? row.id : to;
    const text = eff[row.id];
    if (typeof text === 'string') {
      nextScripts[nextId] = text;
      files.push(fileWrite(to, text));
    } else {
      missing.push(to);
    }
    return { ...row, id: nextId, path: to, surfId: row.surfId || (isStablePartId(nextId) ? nextId : undefined) };
  });

  const nextDoc = serializeAssembly({
    ...clean,
    source: 'git',
    name: assemblyName,
    activeId: parts.find((part) => part.id === clean.activeId)?.id || parts[0]?.id || null,
    parts,
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files.push(fileWrite(assemblyPath, stringifySurfJson(nextDoc)));
  return {
    assemblyName,
    assemblyPath,
    doc: nextDoc,
    scripts: nextScripts,
    idMap,
    files,
    missing,
  };
}

/**
 * Move the Local working copy into the vault and return the Git-mode
 * working copy.
 * -> { status: 'moved', vault: { repo, defaultBranch, headSha, private, status },
 *      sha, doc, scripts, baseline, idMap, files, missing }
 *  | { status: 'invalid-name' | 'not-a-vault', vaultName, repo? }
 *  | { status: 'conflict', vault, paths: [path], assemblyExists }
 *  | { status: 'empty' }                          (no parts to move)
 */
export async function moveToGit(adapter, {
  vaultName = DEFAULT_VAULT_NAME,
  storedName = null,
  doc,
  scripts,
  sharedIds = [],
  liveId = null,
  liveScript = null,
  message = '',
} = {}) {
  assertGithubAdapter(adapter);
  if (!doc?.parts?.length) return { status: 'empty' };
  const name = sanitizeVaultName(vaultName);
  if (!name) return { status: 'invalid-name', vaultName };
  // Plan first so a bad document fails before a repo is created.
  const plan = planMoveToGit(doc, scripts, { sharedIds, liveId, liveScript });

  const found = await findOrCreateVault(adapter, { name, storedName });
  if (found.status === 'invalid-name' || found.status === 'not-a-vault' || found.status === 'missing') {
    return { status: found.status, vaultName: name, repo: found.repo || null };
  }
  const vault = {
    repo: found.repo,
    defaultBranch: found.defaultBranch || 'main',
    headSha: found.headSha || null,
    private: found.private !== false,
    status: found.status,
  };
  const branch = vault.defaultBranch;

  // Never overwrite: assembly exists, or a part path holds different text.
  const conflicts = [];
  const writes = [];
  let assemblyExists = false;
  for (const f of plan.files) {
    const have = await adapter.readFile(vault.repo, f.path, branch);
    if (!have) { writes.push(f); continue; }
    if (f.path === plan.assemblyPath) { assemblyExists = true; conflicts.push(f.path); continue; }
    if (have.content !== f.content) conflicts.push(f.path);
    // identical file already in the vault (e.g. a shared part): skip the write.
  }
  if (conflicts.length) return { status: 'conflict', vault, paths: conflicts, assemblyExists };

  const commit = await adapter.commitFiles(vault.repo, {
    branch,
    message: message || `Move ${plan.assemblyName} to Git`,
    files: writes,
    baseSha: vault.headSha,
  });
  const baseline = captureBaseline({
    assemblyPath: plan.assemblyPath,
    assemblyName: plan.assemblyName,
    doc: plan.doc,
    // Missing rows are '' in the baseline, matching openVaultAssembly.
    scripts: plan.scripts,
    branch,
    headSha: commit.sha,
  });
  return {
    status: 'moved',
    vault: { ...vault, headSha: commit.sha },
    sha: commit.sha,
    doc: plan.doc,
    scripts: plan.scripts,
    baseline,
    idMap: plan.idMap,
    files: writes.map((f) => f.path),
    missing: plan.missing,
  };
}
