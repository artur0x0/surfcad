/**
 * G5/G11: branch view helpers.
 *
 * List / switch / create / delete vault branches. Clean side-branch merges
 * squash onto main via the adapter; conflicts open a GitHub compare URL.
 */
import { assertGithubAdapter, GitAdapterError } from './githubAdapterInterface.js';
import {
  listVaultAssemblies,
  openVaultAssembly,
  seedEmptyVaultAssembly,
} from './gitWorkspace.js';
import { vaultSegment } from './vaultLayout.js';

/** Branches in the vault, sorted; `current` marked when it matches. */
export async function listVaultBranches(adapter, repo, { current = null } = {}) {
  assertGithubAdapter(adapter);
  const branches = await adapter.listBranches(repo);
  const cur = current || null;
  return [...branches]
    .map((b) => ({ name: b.name, sha: b.sha, current: !!cur && b.name === cur }))
    .sort((a, b) => {
      if (a.name === 'main') return -1;
      if (b.name === 'main') return 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Open the named assembly on `branch` (reload working copy + baseline).
 * -> { doc, scripts, assemblyPath, baseline }
 */
export async function switchVaultBranch(adapter, repo, assemblyName, branch, {
  onProgress = null,
  pathIndex = {},
} = {}) {
  assertGithubAdapter(adapter);
  const name = vaultSegment(assemblyName);
  if (!name) throw new Error('Empty assembly name');
  if (!branch) throw new Error('Empty branch name');
  const tip = await adapter.getBranch(repo, branch);
  if (!tip) throw new Error(`Branch not found: ${branch}`);
  try {
    return await openVaultAssembly(adapter, repo, name, {
      branch, headSha: tip.sha, onProgress, pathIndex,
    });
  } catch (err) {
    const msg = err?.message || '';
    if (!/Assembly not found/i.test(msg)) throw err;
  }
  // Named assembly missing on this tip (common after Create on a default
  // "Assembly" that was never committed). Prefer another vault assembly;
  // otherwise seed an empty working copy on this branch — never hard-error.
  const available = await listVaultAssemblies(adapter, repo, branch);
  if (available.length) {
    const pick = available.includes(name) ? name : available[0];
    const opened = await openVaultAssembly(adapter, repo, pick, {
      branch, headSha: tip.sha, onProgress, pathIndex,
    });
    return {
      ...opened,
      fallbackAssembly: pick !== name ? pick : null,
    };
  }
  return seedEmptyVaultAssembly(name, { branch, headSha: tip.sha });
}

/**
 * Create a branch from `fromSha` (default: tip of `fromBranch` or main).
 * -> { name, sha }
 */
export async function createVaultBranch(adapter, repo, branchName, {
  fromBranch = 'main',
  fromSha = null,
} = {}) {
  assertGithubAdapter(adapter);
  const name = String(branchName || '').trim();
  if (!name) throw new GitAdapterError('invalid', 'Branch name required');
  if (name === 'main') throw new GitAdapterError('invalid', 'Cannot recreate main');
  let sha = fromSha;
  if (!sha) {
    const tip = await adapter.getBranch(repo, fromBranch);
    if (!tip?.sha) throw new GitAdapterError('not_found', `Branch ${fromBranch} not found`);
    sha = tip.sha;
  }
  return adapter.createBranch(repo, name, sha);
}

/**
 * Parts Create / `git_branch_create` checkout the new ref when the working
 * copy is clean. A dirty working copy stays on the current branch: switch
 * reloads the tip and would discard unsaved edits. Only Switch confirms
 * that reload (`git_branch_switch` + `confirm: true`).
 */
export function shouldSwitchToCreatedBranch({ dirty = false } = {}) {
  return dirty !== true;
}

/**
 * Delete a branch. Refuses `main` and the current working branch.
 */
export async function deleteVaultBranch(adapter, repo, branchName, {
  current = null,
} = {}) {
  assertGithubAdapter(adapter);
  const name = String(branchName || '').trim();
  if (!name) throw new GitAdapterError('invalid', 'Branch name required');
  if (name === 'main') throw new GitAdapterError('invalid', 'Cannot delete main');
  if (current && name === current) {
    throw new GitAdapterError('invalid', 'Cannot delete the current branch');
  }
  await adapter.deleteBranch(repo, name);
  return { status: 'deleted', branch: name };
}

/**
 * GitHub compare / "Open a pull request" URL for merging `head` into `base`.
 * Opens in the browser — SurfCAD does not merge server-side.
 */
export function githubCompareUrl(repo, { base = 'main', head } = {}) {
  const owner = repo?.owner;
  const name = repo?.name;
  if (!owner || !name || !head) return null;
  const baseEnc = encodeURIComponent(base);
  const headEnc = encodeURIComponent(head);
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${baseEnc}...${headEnc}?expand=1`;
}


/**
 * Squash `head` into `base` (default main) when head is strictly ahead.
 * Diverged / behind → { status: 'conflict' } so the UI can open GitHub.
 * Identical / nothing ahead → { status: 'up-to-date' }.
 * Success → { status: 'merged', sha, base, head }.
 */
export async function squashMergeVaultBranch(adapter, repo, {
  head,
  base = 'main',
  message = null,
} = {}) {
  assertGithubAdapter(adapter);
  const headName = String(head || '').trim();
  const baseName = String(base || 'main').trim() || 'main';
  if (!headName) throw new GitAdapterError('invalid', 'Branch name required');
  if (headName === baseName) {
    throw new GitAdapterError('invalid', 'Cannot merge a branch into itself');
  }
  const cmp = await adapter.compare(repo, baseName, headName);
  if (cmp.status === 'identical' || (cmp.aheadBy === 0 && cmp.behindBy === 0)) {
    return { status: 'up-to-date', base: baseName, head: headName, compare: cmp };
  }
  // Head missing commits that base has → not a clean squash; resolve on GitHub.
  if (cmp.behindBy > 0) {
    return {
      status: 'conflict',
      base: baseName,
      head: headName,
      compare: cmp,
      url: githubCompareUrl(repo, { base: baseName, head: headName }),
    };
  }
  const msg = message || `Squash merge branch '${headName}' into ${baseName}`;
  const res = await adapter.squashMerge(repo, {
    base: baseName,
    head: headName,
    message: msg,
  });
  return {
    status: 'merged',
    sha: res.sha,
    base: baseName,
    head: headName,
    compare: cmp,
  };
}

/** True when a branch may be deleted (not main, not current). */
export function canDeleteVaultBranch(branchName, { current = null } = {}) {
  const name = String(branchName || '');
  if (!name || name === 'main') return false;
  if (current && name === current) return false;
  return true;
}
