/**
 * One production write function for the git vault (§2.8).
 *
 * Every production commit goes through `writeVaultCommit` → `adapter.commitFiles`.
 * First Save may `createRepo` and include the v2 seed (`surfcad.json` version 2,
 * `assemblies/.gitkeep`, `parts/.gitkeep`) in the same commit. No README index.
 * Repo creation is opt-in (`create: true`). Read paths keep `create: false`.
 *
 * User Save / Add to Repo stay on today's callers until PR 7; those sites are
 * routed through this wrapper with `create` off so behaviour matches main
 * when `upgradeVaultEnabled` is off.
 */
import { assertGithubAdapter, GitAdapterError } from './githubAdapterInterface.js';
import { ASSEMBLIES_DIR, SHARED_PARTS_DIR, VAULT_MARKER_PATH } from './vaultLayout.js';
import {
  VAULT_MARKER_KIND,
  isVaultMarker,
  vaultWriteRefusalMessage,
} from './vaultNames.js';

export const SURFCAD_JSON_V2 = `${JSON.stringify({ kind: VAULT_MARKER_KIND, version: 2 }, null, 2)}\n`;

/** Seed files for a new v2 vault. Never includes README.md. */
export function vaultV2SeedFiles() {
  return [
    { path: VAULT_MARKER_PATH, content: SURFCAD_JSON_V2 },
    { path: `${ASSEMBLIES_DIR}/.gitkeep`, content: '' },
    { path: `${SHARED_PARTS_DIR}/.gitkeep`, content: '' },
  ];
}

function filesIncludeVaultMarker(files) {
  for (const file of files || []) {
    if (!file || file.delete) continue;
    if (file.path === VAULT_MARKER_PATH && isVaultMarker(String(file.content ?? ''))) {
      return true;
    }
  }
  return false;
}

function mergeSeedFiles(files) {
  const have = new Set();
  for (const file of files) {
    if (file?.path && !file.delete) have.add(file.path);
  }
  const extra = vaultV2SeedFiles().filter((file) => !have.has(file.path));
  return extra.length ? [...extra, ...files] : files;
}

function canonicalRepo(info, fallback) {
  return {
    owner: info?.owner || fallback.owner,
    name: info?.name || fallback.name,
  };
}

/**
 * -> { presence: 'missing'|'empty'|'marked'|'unmarked', repo }
 */
async function inspectForSeed(adapter, repo, branch) {
  const info = await adapter.getRepo(repo);
  if (!info) return { presence: 'missing', repo };
  const dest = canonicalRepo(info, repo);
  const target = branch || info.defaultBranch || 'main';
  const head = await adapter.getBranch(dest, target);
  if (!head?.sha) return { presence: 'empty', repo: dest };
  const marker = await adapter.readFile(dest, VAULT_MARKER_PATH, target);
  if (marker && isVaultMarker(marker.content)) {
    return { presence: 'marked', repo: dest };
  }
  return { presence: 'unmarked', repo: dest };
}

async function prepareCreateAndSeed(adapter, repo, branch, files) {
  let looked = await inspectForSeed(adapter, repo, branch);
  if (looked.presence === 'missing') {
    let info;
    try {
      info = await adapter.createRepo({
        name: repo.name,
        private: true,
        description: 'SurfCAD vault',
      });
    } catch (err) {
      if (!(err instanceof GitAdapterError) || err.code !== 'name_exists') throw err;
      looked = await inspectForSeed(adapter, repo, branch);
      if (looked.presence === 'missing') throw err;
      info = null;
    }
    if (info) {
      return {
        repo: canonicalRepo(info, repo),
        files: mergeSeedFiles(files),
        seed: true,
      };
    }
  }
  if (looked.presence === 'empty') {
    // Seed retry: createRepo succeeded, the seed commit did not. Do not
    // createRepo again. Marker is missing on the empty repo we created.
    return { repo: looked.repo, files: mergeSeedFiles(files), seed: true };
  }
  if (looked.presence === 'marked') {
    return { repo: looked.repo, files, seed: false };
  }
  throw new GitAdapterError('not_a_vault', vaultWriteRefusalMessage(looked.repo));
}

/**
 * @param {{
 *   adapter: object,
 *   repo: { owner: string, name: string },
 *   branch: string,
 *   baseSha: string | null | undefined,
 *   message: string,
 *   files: object[],
 *   create?: boolean,
 * }} opts
 * @returns {Promise<{ sha: string }>}
 */
export async function writeVaultCommit({
  adapter,
  repo,
  branch,
  baseSha,
  message,
  files,
  create = false,
} = {}) {
  assertGithubAdapter(adapter);
  if (!repo?.owner || !repo?.name) {
    throw new GitAdapterError('invalid', 'writeVaultCommit needs a repo');
  }
  const list = Array.isArray(files) ? files.filter((file) => file && file.path) : [];
  let dest = { owner: repo.owner, name: repo.name };
  let outgoing = list;
  let seed = filesIncludeVaultMarker(list);

  if (create) {
    const prepared = await prepareCreateAndSeed(adapter, dest, branch, list);
    dest = prepared.repo;
    outgoing = prepared.files;
    seed = prepared.seed;
  }

  const opts = { branch, message, files: outgoing, baseSha };
  if (seed) opts.seed = true;
  const committed = await adapter.commitFiles(dest, opts);
  return { sha: committed.sha };
}
