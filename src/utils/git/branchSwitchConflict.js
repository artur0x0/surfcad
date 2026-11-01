/**
 * Branch-switch conflict (docs/git-save-model.md).
 *
 * A dirty working copy whose files differ from the branch being switched to
 * opens one dialog before the branch or the working copy changes. Go back,
 * Use local, and Use remote do not commit or push. The save-conflict dialog
 * (Create a new branch / Overwrite) stays on Save.
 *
 * Switch used to open two dialogs on the same popup: adoptVaultOpening's
 * outbox hold (Stay on branch / Open on GitHub / Overwrite main) and
 * checkGitRemoteBehind's main-moved check (Dismiss / Get latest / Save mine
 * / Overwrite). The second effect replaced the first. Neither runs on switch.
 */
import { definitionStampName, partDefinitionId } from '../assembly.js';
import { assemblyIdPath, partIdPath } from './idPaths.js';
import { partScriptMatchesCommitted } from './planSave.js';
import { isV2SurfId } from './surfId.js';
import { stringifySurfJsonV2 } from './surfJsonV2.js';
import { openV2Assembly } from './v2VaultRead.js';

export const BRANCH_SWITCH_CONFLICT_COPY = 'There is a conflict between your local files and files in the repository on the branch you are switching to. What would you like to do?';

export const BRANCH_SWITCH_CHOICES = Object.freeze(['go_back', 'use_local', 'use_remote']);

function comparableAssembly(doc) {
  try {
    const text = stringifySurfJsonV2(doc);
    const obj = JSON.parse(text);
    obj.activeId = null;
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

function partBytesDiffer(id, name, local, remote) {
  if (typeof local !== 'string') return false;
  if (typeof remote !== 'string') return true;
  if (local === remote) return false;
  if (partScriptMatchesCommitted(local, remote, id, name)) return false;
  if (partScriptMatchesCommitted(remote, local, id, name)) return false;
  return true;
}

/**
 * Paths where the open working copy differs from the target branch.
 * Active-part view state is not a conflict. Equal header stamps are not.
 */
export function branchSwitchConflictPaths(localDoc, localScripts, remoteDoc, remoteScripts) {
  const paths = [];
  if (!localDoc || !isV2SurfId(localDoc.id)) return paths;
  let asmPath = '';
  try { asmPath = assemblyIdPath(localDoc.id); } catch { return paths; }
  const localAsm = comparableAssembly(localDoc);
  const remoteAsm = remoteDoc ? comparableAssembly(remoteDoc) : null;
  if (localAsm != null && remoteAsm != null && localAsm !== remoteAsm) paths.push(asmPath);

  const ids = new Set();
  for (const part of localDoc.parts || []) {
    const id = partDefinitionId(part);
    if (isV2SurfId(id)) ids.add(id);
  }
  for (const id of ids) {
    let path = '';
    try { path = partIdPath(id); } catch { continue; }
    const name = definitionStampName(localDoc.parts, id);
    if (partBytesDiffer(id, name, localScripts?.[id], remoteScripts?.[id])) paths.push(path);
  }
  return [...new Set(paths)].sort();
}

/**
 * Read the target branch and compare. A clean working copy is not a conflict:
 * switching just loads that branch. No git write.
 */
export async function previewV2BranchSwitch({
  adapter,
  repo,
  doc,
  scripts,
  targetBranch,
  sourceDirty = false,
} = {}) {
  if (sourceDirty !== true || !doc || doc.vaultLayout !== 'v2' || !isV2SurfId(doc?.id)) {
    return { conflict: false, paths: [] };
  }
  const branch = String(targetBranch || '').trim();
  if (!branch || !adapter || !repo) return { conflict: false, paths: [] };
  let opened = null;
  try {
    const tip = (await adapter.getBranch(repo, branch))?.sha || null;
    if (!tip) return { conflict: false, paths: [], missing: true };
    opened = await openV2Assembly(adapter, repo, doc.id, { branch, headSha: tip });
  } catch {
    return { conflict: false, paths: [], missing: true };
  }
  const paths = branchSwitchConflictPaths(doc, scripts, opened.doc, opened.scripts);
  return {
    conflict: paths.length > 0,
    paths,
    headSha: opened.baseline?.headSha || null,
  };
}

/**
 * One switch shows one popup. The outbox hold and the save-conflict check
 * must not also open.
 */
export function branchSwitchPopups({ preview } = {}) {
  if (preview?.conflict === true) {
    return {
      popups: ['branch-switch'],
      syncConflict: false,
      planSaveConflict: false,
    };
  }
  return { popups: [], syncConflict: false, planSaveConflict: false };
}

/**
 * Go back changes nothing. Use local keeps the working-copy scripts and
 * points the session at the target branch. Use remote loads that branch.
 * None of the three commit or push.
 */
export function planBranchSwitchChoice(choice, {
  currentBranch,
  targetBranch,
  localScripts,
  remoteScripts = null,
  baseline = null,
  headSha = null,
} = {}) {
  const target = String(targetBranch || '').trim();
  const current = currentBranch || 'main';
  if (choice == null || choice === '' || choice === 'go_back') {
    return {
      choice: 'go_back',
      branch: current,
      scripts: localScripts,
      baseline,
      loadRemote: false,
      writesGit: false,
      changed: false,
    };
  }
  if (choice === 'use_local') {
    const nextHead = headSha || baseline?.headSha || null;
    const nextBaseline = baseline
      ? { ...baseline, branch: target, headSha: nextHead }
      : { branch: target, headSha: nextHead, scripts: localScripts };
    return {
      choice: 'use_local',
      branch: target,
      scripts: localScripts,
      baseline: nextBaseline,
      loadRemote: false,
      writesGit: false,
      changed: true,
    };
  }
  if (choice === 'use_remote') {
    return {
      choice: 'use_remote',
      branch: target,
      scripts: remoteScripts,
      baseline: null,
      loadRemote: true,
      writesGit: false,
      changed: true,
    };
  }
  return {
    choice: null,
    error: 'Unknown branch switch choice',
    branch: current,
    scripts: localScripts,
    baseline,
    loadRemote: false,
    writesGit: false,
    changed: false,
  };
}
