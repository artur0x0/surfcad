/**
 * Branch switch opens one dialog before anything changes.
 * Go back, Use local, and Use remote do not write git.
 * Save after Use local still uses the save-conflict dialog.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileWrite } from './githubAdapterInterface.js';
import { partIdPath } from './idPaths.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';
import { mintSurfId, withSurfId, withSurfName } from './surfId.js';
import { createSpyGithubAdapter, spyCalls } from './spyGithubAdapter.js';
import { createSyncStore } from './syncStore.js';
import { executePlanSave } from './executePlanSave.js';
import {
  BRANCH_SWITCH_CONFLICT_COPY,
  branchSwitchPopups,
  planBranchSwitchChoice,
  previewV2BranchSwitch,
} from './branchSwitchConflict.js';

const REPO = { owner: 'artur', name: 'surfcad-vault' };
const NOW = 1_700_000_000_000;
const A = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const P = mintSurfId({ now: new Date('2026-10-18T02:50:00.003Z'), rand: 'cc03' });
const BODY = 'return 1;\n';

function stamped(script, id, name) {
  return withSurfName(withSurfId(script, id), name);
}

function assembly() {
  return {
    id: A,
    name: 'Flange',
    source: 'git',
    rev: 1,
    activeId: P,
    parts: [{ id: P, name: 'Plate', visible: true, order: 0 }],
    vaultLayout: 'v2',
  };
}

async function seed() {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const spy = createSpyGithubAdapter(inner);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const doc = assembly();
  const saved = await executePlanSave({
    adapter: spy,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: {
      doc,
      scripts: { [P]: BODY },
      now: NOW,
      repo: REPO,
      branch: 'main',
      saveTarget: { repo: REPO, branch: 'main' },
    },
    message: 'seed',
    create: true,
    now: NOW,
  });
  assert.equal(saved.status, 'committed', saved.error);
  return { inner, spy, store, doc, sha: saved.sha };
}

test('one switch popup; go back is a no-op; choices do not write git; save then conflicts', async () => {
  const { inner, spy, store, doc, sha } = await seed();
  const writes = spyCalls(spy, 'commitFiles').length;
  const branches = spyCalls(spy, 'createBranch').length;
  await inner.commitFiles(REPO, {
    branch: 'main',
    message: 'remote part',
    files: [fileWrite(partIdPath(P), stamped('return 9;\n', P, 'Plate'))],
    baseSha: sha,
  });
  const remoteBefore = (await inner.readFile(REPO, partIdPath(P), 'main')).content;
  const localScripts = { [P]: 'return 3;\n' };
  const preview = await previewV2BranchSwitch({
    adapter: spy,
    repo: REPO,
    doc,
    scripts: localScripts,
    targetBranch: 'main',
    sourceDirty: true,
  });
  assert.equal(preview.conflict, true);
  assert.equal(preview.paths.includes(partIdPath(P)), true);
  const popups = branchSwitchPopups({ preview });
  assert.deepEqual(popups.popups, ['branch-switch']);
  assert.equal(popups.popups.length, 1);
  assert.equal(popups.syncConflict, false);
  assert.equal(popups.planSaveConflict, false);
  assert.equal(BRANCH_SWITCH_CONFLICT_COPY.startsWith('There is a conflict between your local files'), true);

  const baseline = { branch: 'feature', headSha: sha, scripts: { [P]: stamped(BODY, P, 'Plate') } };
  const back = planBranchSwitchChoice('go_back', {
    currentBranch: 'feature',
    targetBranch: 'main',
    localScripts,
    baseline,
    headSha: preview.headSha,
  });
  assert.equal(back.changed, false);
  assert.equal(back.writesGit, false);
  assert.equal(back.loadRemote, false);
  assert.equal(back.branch, 'feature');
  assert.equal(back.scripts, localScripts);
  assert.equal(back.baseline, baseline);

  const useLocal = planBranchSwitchChoice('use_local', {
    currentBranch: 'feature',
    targetBranch: 'main',
    localScripts,
    baseline,
    headSha: preview.headSha,
  });
  assert.equal(useLocal.writesGit, false);
  assert.equal(useLocal.loadRemote, false);
  assert.equal(useLocal.branch, 'main');
  assert.equal(useLocal.scripts, localScripts);
  assert.equal(useLocal.changed, true);

  const useRemote = planBranchSwitchChoice('use_remote', {
    currentBranch: 'feature',
    targetBranch: 'main',
    localScripts,
    remoteScripts: { [P]: remoteBefore },
    baseline,
    headSha: preview.headSha,
  });
  assert.equal(useRemote.writesGit, false);
  assert.equal(useRemote.loadRemote, true);
  assert.equal(useRemote.scripts[P], remoteBefore);

  assert.equal(spyCalls(spy, 'commitFiles').length, writes);
  assert.equal(spyCalls(spy, 'createBranch').length, branches);
  assert.equal((await inner.readFile(REPO, partIdPath(P), 'main')).content, remoteBefore);

  const saved = await executePlanSave({
    adapter: spy,
    repo: REPO,
    branch: useLocal.branch,
    store,
    workingCopy: {
      doc,
      scripts: useLocal.scripts,
      now: NOW,
      repo: REPO,
      branch: 'main',
      saveTarget: { repo: REPO, branch: 'main' },
    },
    message: 'Save',
    now: NOW,
  });
  assert.equal(saved.status, 'conflict');
  assert.equal(saved.model, 'v2');
  assert.notEqual(saved.model, 'branch-switch');
  assert.equal(spyCalls(spy, 'commitFiles').length, writes);
  assert.equal((await inner.readFile(REPO, partIdPath(P), 'main')).content, remoteBefore);
});

test('a clean working copy is not a branch-switch conflict', async () => {
  const { spy, doc } = await seed();
  const writes = spyCalls(spy, 'commitFiles').length;
  const preview = await previewV2BranchSwitch({
    adapter: spy,
    repo: REPO,
    doc,
    scripts: { [P]: 'return 3;\n' },
    targetBranch: 'main',
    sourceDirty: false,
  });
  assert.equal(preview.conflict, false);
  assert.deepEqual(branchSwitchPopups({ preview }).popups, []);
  assert.equal(spyCalls(spy, 'commitFiles').length, writes);
  assert.equal(spyCalls(spy, 'createBranch').length, 0);
});

test('switch does not open the outbox hold or the save-conflict check', () => {
  const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('const handleSwitchBranch');
  const end = app.indexOf('const handleListVaultBrowse');
  assert.ok(start > 0 && end > start);
  const slice = app.slice(start, end);
  assert.equal(/reason:\s*'branch-switch'/.test(slice), false);
  assert.equal((slice.match(/surfaceConflict:\s*false/g) || []).length, 2);
  assert.match(slice, /previewV2BranchSwitch/);
  assert.match(slice, /model: 'branch-switch'/);
  assert.match(slice, /keepLocalBranch\(branchName\)/);
  assert.match(slice, /'use_local'/);
  assert.match(app, /planBranchSwitchChoice\('use_local'/);
  assert.match(app, /surfaceConflict = true/);
  const feed = readFileSync(new URL('../../components/PartFeed.jsx', import.meta.url), 'utf8');
  assert.equal(feed.includes('data-git-branch-pane-toolbar'), false);
  assert.match(feed, /BranchPaneList/);
  assert.match(feed, /BranchSwitchConflictChoices/);
  assert.match(feed, /Stay on branch/);
});
