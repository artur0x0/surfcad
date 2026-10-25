/**
 * Assembly Save on an unchanged remote is not a conflict, and it clears
 * every part dot — including instance rows that share a definition.
 * A real overlapping remote edit still returns status conflict and writes
 * nothing until the explicit overwrite choice.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareWorkingCopyToCommit } from '../src/agent/state/workingCopyUnsaved.js';
import { gitCommitDoneMessage } from '../src/utils/git/commitDoneCopy.js';
import {
  executePlanSave,
  executePlanSaveConflictChoice,
} from '../src/utils/git/executePlanSave.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { partIdPath } from '../src/utils/git/idPaths.js';
import { captureLastCommit } from '../src/utils/git/lastCommit.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { mintSurfId, withSurfId, withSurfName } from '../src/utils/git/surfId.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const FEED = readFileSync(new URL('../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const REPO = { owner: 'artur', name: 'surfcad-vault' };
const NOW = 1_700_000_000_000;
const ASM = mintSurfId({ now: new Date('2026-10-24T12:00:00.001Z'), rand: 'aa11' });
const FRAME = mintSurfId({ now: new Date('2026-10-24T12:00:00.002Z'), rand: 'bb22' });
const FRAME_2 = mintSurfId({ now: new Date('2026-10-24T12:00:00.003Z'), rand: 'cc33' });
const FORK = mintSurfId({ now: new Date('2026-10-24T12:00:00.004Z'), rand: 'dd44' });
const BODY = 'return frame;\n';
const FORK_BODY = 'return fork;\n';
const EDITED = 'return frame-edit;\n';

function stamped(script, id, name) {
  return withSurfName(withSurfId(script, id), name);
}

function row(id, name, extra = {}) {
  return { id, name, visible: true, order: extra.order ?? 0, ...extra };
}

function bikeDoc(extra = {}) {
  return {
    id: ASM,
    name: 'Bike',
    source: 'git',
    vaultLayout: 'v2',
    rev: 1,
    activeId: FRAME_2,
    parts: [
      row(FRAME, 'Frame'),
      row(FRAME_2, 'Frame (2)', { order: 1, instanceOf: FRAME, position: [0, 0, 40] }),
      row(FORK, 'Fork', { order: 2 }),
    ],
    ...extra,
  };
}

function workingCopy(doc, scripts, now = NOW) {
  return {
    doc,
    scripts,
    now,
    repo: REPO,
    branch: 'main',
    saveTarget: { repo: REPO, branch: 'main' },
  };
}

async function fresh() {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  return { adapter, store };
}

async function save(adapter, store, doc, scripts, { message = 'Save Bike', now = NOW, create = false, force = false } = {}) {
  return executePlanSave({
    adapter,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: workingCopy(doc, scripts, now),
    message,
    create,
    force,
    now,
  });
}

async function headSha(adapter) {
  const head = await adapter.getBranch(REPO, 'main');
  return head?.sha || null;
}

test('done copy says Overwrote only for an explicit force overwrite', () => {
  const committed = {
    status: 'committed',
    sha: '0947e04abc',
    branch: 'main',
    files: ['assemblies/x.surf.json', 'parts/y.js'],
  };
  assert.equal(
    gitCommitDoneMessage(committed),
    'Committed 2 file(s) to main (0947e04).',
  );
  assert.equal(/Overwrote the conflicting files/.test(gitCommitDoneMessage(committed)), false);
  assert.match(
    gitCommitDoneMessage({ ...committed, overwrote: true }),
    /^Overwrote the conflicting files on main \(0947e04\)\.$/,
  );
  assert.equal(gitCommitDoneMessage({ status: 'clean' }), 'Nothing to commit.');
  assert.match(FEED, /gitCommitDoneMessage\(commitFlow\.result\)/);
  assert.equal(/Overwrote the conflicting files/.test(FEED), false);
  assert.match(APP, /!isV2PlanSaveDoc\(assemblyDoc\)\s*&&\s*showAddToRepo\(row\)/);
  assert.match(APP, /const known = partScriptsRef\.current\[def\]/);
});

test('repeated assembly save on an unchanged remote is clean and clears instance dots', async () => {
  const { adapter, store } = await fresh();
  const doc = bikeDoc();
  // The editor was on the instance row, so the script map has no definition key.
  const scripts = { [FRAME_2]: BODY, [FORK]: FORK_BODY };
  const first = await save(adapter, store, doc, scripts, { message: 'Add bike', create: true });
  assert.equal(first.status, 'committed', first.error);
  assert.equal(first.overwrote, undefined);
  assert.equal(/Overwrote the conflicting files/.test(gitCommitDoneMessage(first)), false);
  assert.match(gitCommitDoneMessage(first), /^Committed \d+ file\(s\) to main \(/);
  const file = await adapter.readFile(REPO, partIdPath(FRAME), 'main');
  assert.equal(file.content, stamped(BODY, FRAME, 'Frame'));
  assert.equal(await adapter.readFile(REPO, partIdPath(FRAME_2), 'main'), null);

  const again = await save(adapter, store, doc, scripts, { message: 'Save again', now: NOW + 1 });
  assert.equal(again.status, 'clean', again.error);
  assert.equal(/Overwrote the conflicting files/.test(gitCommitDoneMessage(again)), false);
  assert.equal(gitCommitDoneMessage(again), 'Nothing to commit.');

  const commit = store.getAssemblyCommit(REPO, 'main', ASM);
  const compared = compareWorkingCopyToCommit({ doc, scripts, assemblyCommit: commit });
  assert.equal(compared.unsaved, false);
  assert.deepEqual(compared.partIds, []);

  // Reload captures tree blob shas. They must still match the working copy.
  const captured = await captureLastCommit({
    adapter,
    repo: REPO,
    branch: 'main',
    store,
    assemblyId: ASM,
    now: NOW + 10_000,
    persistBranchTip: 'if-absent',
  });
  assert.ok(captured.assemblyCommit, captured.skipped || captured.error);
  const reloaded = store.getAssemblyCommit(REPO, 'main', ASM);
  const rowKeyed = { [FRAME]: BODY, [FRAME_2]: BODY, [FORK]: FORK_BODY };
  const afterReload = compareWorkingCopyToCommit({
    doc,
    scripts: rowKeyed,
    assemblyCommit: reloaded,
  });
  assert.equal(afterReload.unsaved, false, JSON.stringify(afterReload));
  assert.deepEqual(afterReload.partIds, []);

  const third = await save(adapter, store, doc, rowKeyed, { message: 'Save after reload', now: NOW + 11_000 });
  assert.equal(third.status, 'clean', third.error);
});

test('editing a definition dirties every instance row; one save clears them', async () => {
  const { adapter, store } = await fresh();
  const doc = bikeDoc();
  const scripts = { [FRAME_2]: BODY, [FORK]: FORK_BODY };
  const first = await save(adapter, store, doc, scripts, { message: 'Add bike', create: true });
  assert.equal(first.status, 'committed', first.error);
  const commit = store.getAssemblyCommit(REPO, 'main', ASM);

  const dirtyScripts = { [FRAME_2]: EDITED, [FORK]: FORK_BODY };
  const dirty = compareWorkingCopyToCommit({ doc, scripts: dirtyScripts, assemblyCommit: commit });
  assert.equal(dirty.partIds.includes(FRAME), true, JSON.stringify(dirty.partIds));
  assert.equal(dirty.partIds.includes(FRAME_2), true, JSON.stringify(dirty.partIds));
  assert.equal(dirty.partIds.includes(FORK), false, JSON.stringify(dirty.partIds));

  const partSave = await save(adapter, store, doc, dirtyScripts, {
    message: 'Add to repo',
    now: NOW + 2,
  });
  assert.equal(partSave.status, 'committed', partSave.error);
  assert.equal(partSave.overwrote, undefined);
  const written = await adapter.readFile(REPO, partIdPath(FRAME), 'main');
  assert.equal(written.content, stamped(EDITED, FRAME, 'Frame'));
  const after = compareWorkingCopyToCommit({
    doc,
    scripts: { [FRAME]: EDITED, [FRAME_2]: EDITED, [FORK]: FORK_BODY },
    assemblyCommit: store.getAssemblyCommit(REPO, 'main', ASM),
  });
  assert.equal(after.unsaved, false, JSON.stringify(after));
  assert.deepEqual(after.partIds, []);
});

test('a real overlapping remote change still raises conflict and does not write', async () => {
  const { adapter, store } = await fresh();
  const doc = bikeDoc();
  const scripts = { [FRAME_2]: BODY, [FORK]: FORK_BODY };
  const first = await save(adapter, store, doc, scripts, { message: 'Add bike', create: true });
  assert.equal(first.status, 'committed', first.error);

  const remoteBody = stamped('return remote-frame;\n', FRAME, 'Frame');
  await adapter.commitFiles(REPO, {
    branch: 'main',
    message: 'remote frame',
    files: [fileWrite(partIdPath(FRAME), remoteBody)],
    baseSha: first.sha,
  });
  const remoteHead = await headSha(adapter);

  const blocked = await save(adapter, store, doc, { [FRAME_2]: EDITED, [FORK]: FORK_BODY }, {
    message: 'Save local frame',
    now: NOW + 3,
  });
  assert.equal(blocked.status, 'conflict', blocked.error);
  assert.equal(blocked.paths.includes(partIdPath(FRAME)), true);
  assert.equal(blocked.overwrote, undefined);
  assert.equal(await headSha(adapter), remoteHead);
  assert.equal((await adapter.readFile(REPO, partIdPath(FRAME), 'main')).content, remoteBody);

  const overwrite = await executePlanSaveConflictChoice({
    action: 'overwrite',
    adapter,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: workingCopy(doc, { [FRAME_2]: EDITED, [FORK]: FORK_BODY }, NOW + 4),
    message: 'Overwrite frame',
    paths: blocked.paths,
    now: NOW + 4,
  });
  assert.equal(overwrite.status, 'committed', overwrite.error);
  assert.equal(overwrite.overwrote, true);
  assert.match(gitCommitDoneMessage(overwrite), /^Overwrote the conflicting files on main \(/);
  assert.equal(
    (await adapter.readFile(REPO, partIdPath(FRAME), 'main')).content,
    stamped(EDITED, FRAME, 'Frame'),
  );
  assert.notEqual(await headSha(adapter), remoteHead);
});
