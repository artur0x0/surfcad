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

function sameOwner(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

async function assertViewerOwnsRepo(adapter, repo) {
  const { login } = await adapter.getViewer();
  if (sameOwner(repo.owner, login)) return;
  throw new GitAdapterError(
    'invalid',
    `Refusing to create ${repo.owner}/${repo.name}: createRepo can only create a repo under the signed-in user (${login}).`,
  );
}

/**
 * -> { presence: 'missing'|'empty'|'marked'|'unmarked'|'target-missing', repo, defaultBranch?, target? }
 *
 * `empty` means the whole repo has no commits (no branches, or the default
 * branch has no commit). A missing *target* branch on a repo that already
 * has a default-branch tip is not empty.
 */
async function inspectForSeed(adapter, repo, branch) {
  const info = await adapter.getRepo(repo);
  if (!info) return { presence: 'missing', repo };
  const dest = canonicalRepo(info, repo);
  const defaultBranch = info.defaultBranch || 'main';
  const target = branch || defaultBranch;
  const branches = await adapter.listBranches(dest);
  const defaultHead = await adapter.getBranch(dest, defaultBranch);
  const wholeRepoEmpty = branches.length === 0 || !defaultHead?.sha;
  if (wholeRepoEmpty) {
    return { presence: 'empty', repo: dest, defaultBranch, target };
  }

  const targetHead = target === defaultBranch
    ? defaultHead
    : await adapter.getBranch(dest, target);
  if (!targetHead?.sha) {
    const marker = await adapter.readFile(dest, VAULT_MARKER_PATH, defaultBranch);
    if (marker && isVaultMarker(marker.content)) {
      return { presence: 'target-missing', repo: dest, defaultBranch, target };
    }
    return { presence: 'unmarked', repo: dest, defaultBranch, target };
  }

  const marker = await adapter.readFile(dest, VAULT_MARKER_PATH, target);
  if (marker && isVaultMarker(marker.content)) {
    return { presence: 'marked', repo: dest, defaultBranch, target };
  }
  return { presence: 'unmarked', repo: dest, defaultBranch, target };
}

function targetMissingError(looked) {
  return new GitAdapterError(
    'invalid',
    `Branch ${looked.target} is missing on ${looked.repo.owner}/${looked.repo.name}; `
    + `default branch ${looked.defaultBranch} is already a SurfCAD vault. Refusing to seed.`,
  );
}

async function prepareCreateAndSeed(adapter, repo, branch, files) {
  let looked = await inspectForSeed(adapter, repo, branch);
  if (looked.presence === 'missing') {
    await assertViewerOwnsRepo(adapter, repo);
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
    // Whole repo is empty: seed-retry after createRepo, or create:true on an
    // empty repo. Do not createRepo again.
    return { repo: looked.repo, files: mergeSeedFiles(files), seed: true };
  }
  if (looked.presence === 'marked') {
    return { repo: looked.repo, files, seed: false };
  }
  if (looked.presence === 'target-missing') {
    throw targetMissingError(looked);
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
 *   seed?: boolean,
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
  seed: seedOpt = false,
} = {}) {
  assertGithubAdapter(adapter);
  if (!repo?.owner || !repo?.name) {
    throw new GitAdapterError('invalid', 'writeVaultCommit needs a repo');
  }
  const list = Array.isArray(files) ? files.filter((file) => file && file.path) : [];
  let dest = { owner: repo.owner, name: repo.name };
  let outgoing = list;
  let seed = seedOpt === true;

  if (create) {
    const prepared = await prepareCreateAndSeed(adapter, dest, branch, list);
    dest = prepared.repo;
    outgoing = prepared.files;
    if (prepared.seed) seed = true;
  }

  const opts = { branch, message, files: outgoing, baseSha };
  if (seed) opts.seed = true;
  const committed = await adapter.commitFiles(dest, opts);
  return { sha: committed.sha };
}
