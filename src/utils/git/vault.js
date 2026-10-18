/**
 * Find-or-create the user's vault.
 *
 * Default resolution (no custom rename): stored `user.vaultName` when set,
 * then `surfcad-vault`, then legacy `surfcad` only when its marker matches.
 * A marked legacy repo is adopted and `surfcad-vault` is not created.
 * An unmarked legacy repo is `not-a-vault` and is never seeded or created over.
 * An unmarked stored name falls through. Nothing is seeded except an empty
 * repo this call just created. The handle uses GitHub's `name`, not the
 * string we asked for.
 *
 * Emptiness is "default branch has no commit" via getBranch. Never trust
 * GitHub `size === 0` alone.
 */
import { assertGithubAdapter, GitAdapterError } from './githubAdapterInterface.js';
import { ASSEMBLIES_DIR, SHARED_PARTS_DIR, VAULT_MARKER_PATH, VAULT_README_PATH } from './vaultLayout.js';
import { writeVaultCommit } from './writeVaultCommit.js';
import {
  DEFAULT_VAULT_NAME,
  LEGACY_VAULT_NAME,
  VAULT_MARKER_KIND,
  VAULT_MARKER_VERSION,
  decideVaultCandidate,
  isVaultMarker,
  sanitizeVaultName,
  storedVaultNameFromUser,
  vaultMarkerContent,
  vaultNameCandidates,
  vaultWriteRefusalMessage,
  walkVaultCandidates,
} from './vaultNames.js';

export {
  DEFAULT_VAULT_NAME,
  LEGACY_VAULT_NAME,
  VAULT_MARKER_KIND,
  VAULT_MARKER_VERSION,
  decideVaultCandidate,
  isVaultMarker,
  sanitizeVaultName,
  storedVaultNameFromUser,
  vaultMarkerContent,
  vaultNameCandidates,
  vaultWriteRefusalMessage,
  walkVaultCandidates,
};

export function isVaultWriteRefusal(err) {
  return !!err && err.code === 'not_a_vault';
}

/** Files of the first vault commit. `.gitkeep` holds the two top-level folders. */
export function vaultSeedFiles(name) {
  return [
    { path: VAULT_MARKER_PATH, content: vaultMarkerContent() },
    {
      path: VAULT_README_PATH,
      content: `# ${name}\n\nSurfCAD vault.\n\n- \`${ASSEMBLIES_DIR}/<name>/.surf.json\` assembly metadata\n- \`${SHARED_PARTS_DIR}/<part>.js\` part scripts, referenced by path\n- \`${ASSEMBLIES_DIR}/<name>/<part>.js\` only a Copy to this assembly\n`,
    },
    { path: `${ASSEMBLIES_DIR}/.gitkeep`, content: '' },
    { path: `${SHARED_PARTS_DIR}/.gitkeep`, content: '' },
  ];
}

function canonicalRepo(login, info, fallbackName) {
  return {
    owner: info?.owner || login,
    name: info?.name || fallbackName,
  };
}

/**
 * -> { presence: 'missing'|'marked'|'unmarked', repo, defaultBranch?, headSha?, private? }
 */
async function inspectRepo(adapter, login, repoName) {
  const requested = { owner: login, name: repoName };
  const info = await adapter.getRepo(requested);
  if (!info) return { presence: 'missing', repo: requested };
  const repo = canonicalRepo(login, info, repoName);
  const branch = info.defaultBranch || 'main';
  const head = await adapter.getBranch(repo, branch);
  if (!head?.sha) {
    return { presence: 'unmarked', repo, empty: true, defaultBranch: branch, private: info.private };
  }
  const marker = await adapter.readFile(repo, VAULT_MARKER_PATH, branch);
  if (!marker || !isVaultMarker(marker.content)) {
    return { presence: 'unmarked', repo, defaultBranch: branch, headSha: head.sha, private: info.private };
  }
  return {
    presence: 'marked',
    repo,
    defaultBranch: branch,
    headSha: head.sha,
    private: info.private,
  };
}

function foundFrom(looked) {
  return {
    status: 'found',
    repo: looked.repo,
    defaultBranch: looked.defaultBranch,
    headSha: looked.headSha,
    private: looked.private,
  };
}

async function createAndSeed(adapter, login, repoName, storedName) {
  let info;
  try {
    info = await adapter.createRepo({ name: repoName, private: true, description: 'SurfCAD vault' });
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'name_exists') {
      return findOrCreateVault(adapter, { name: repoName, storedName, create: false });
    }
    throw err;
  }
  const repo = canonicalRepo(login, info, repoName);
  const branch = info.defaultBranch || 'main';
  try {
    const commit = await writeVaultCommit({
      adapter,
      repo,
      branch,
      message: 'Create SurfCAD vault',
      files: vaultSeedFiles(repo.name),
      baseSha: null,
      seed: true,
    });
    return {
      status: 'created',
      repo,
      defaultBranch: branch,
      headSha: commit.sha,
      private: info.private !== false,
    };
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      const again = await inspectRepo(adapter, login, repo.name);
      if (again.presence === 'marked') return foundFrom(again);
      if (again.presence === 'unmarked') return { status: 'not-a-vault', repo: again.repo };
    }
    throw err;
  }
}

async function resolveExplicit(adapter, login, repoName, { create }) {
  const looked = await inspectRepo(adapter, login, repoName);
  if (looked.presence === 'marked') return foundFrom(looked);
  if (looked.presence === 'unmarked') return { status: 'not-a-vault', repo: looked.repo };
  if (!create) return { status: 'missing', repo: looked.repo };
  return createAndSeed(adapter, login, repoName, null);
}

/**
 * -> { status: 'found' | 'created', repo: { owner, name }, defaultBranch, headSha, private }
 *  | { status: 'not-a-vault', repo }
 *  | { status: 'invalid-name', name }
 *  | { status: 'missing', repo }   (`create: false` and nothing to adopt)
 *
 * `name` set to something other than the default or legacy name is a custom
 * vault (Move to Git rename field): that repo only, same seed rules.
 * Omit `name` (or pass the default / legacy name) to run stored → surfcad-vault
 * → marked legacy. Pass `storedName` from the signed-in user when you have it.
 */
export async function findOrCreateVault(adapter, {
  name,
  storedName = null,
  create = true,
} = {}) {
  assertGithubAdapter(adapter);
  const explicit = name == null || String(name).trim() === '' ? null : sanitizeVaultName(name);
  if (name != null && String(name).trim() !== '' && !explicit) {
    return { status: 'invalid-name', name };
  }
  const { login } = await adapter.getViewer();
  const custom = explicit
    && explicit !== DEFAULT_VAULT_NAME
    && explicit !== LEGACY_VAULT_NAME;
  if (custom) return resolveExplicit(adapter, login, explicit, { create });

  const walked = await walkVaultCandidates(storedName, (candidate) => (
    inspectRepo(adapter, login, candidate)
  ));
  if (walked.action === 'adopt') return foundFrom(walked.looked);
  if (walked.action === 'refuse') {
    return { status: 'not-a-vault', repo: walked.looked?.repo || { owner: login, name: walked.candidate } };
  }
  if (!create) {
    return { status: 'missing', repo: { owner: login, name: DEFAULT_VAULT_NAME } };
  }
  return createAndSeed(adapter, login, DEFAULT_VAULT_NAME, storedName);
}

/**
 * Re-read the marker on the repo a flush or write is about to touch.
 * -> { ok: true, repo } | { ok: false, missing?, unmarked?, empty?, repo? }
 */
export async function repoHasVaultMarker(adapter, repo, branch) {
  if (!repo?.owner || !repo?.name) return { ok: false, missing: true, repo: repo || null };
  const info = await adapter.getRepo(repo);
  if (!info) return { ok: false, missing: true, repo };
  const canonical = canonicalRepo(repo.owner, info, repo.name);
  const target = branch || info.defaultBranch || 'main';
  let ref = target;
  let head = await adapter.getBranch(canonical, ref);
  if (!head?.sha && ref !== (info.defaultBranch || 'main')) {
    ref = info.defaultBranch || 'main';
    head = await adapter.getBranch(canonical, ref);
  }
  if (!head?.sha) return { ok: false, empty: true, repo: canonical };
  const marker = await adapter.readFile(canonical, VAULT_MARKER_PATH, ref);
  if (!marker || !isVaultMarker(marker.content)) {
    return { ok: false, unmarked: true, repo: canonical };
  }
  return { ok: true, repo: canonical };
}
