/**
 * dirty.unsaved is WC vs AssemblyCommit. Rename / hide / remove count.
 * A cloned commit (reload) still reports unsaved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { gitBlobSha } from '../../utils/git/binaryContent.js';
import { captureBaseline } from '../../utils/git/gitBaseline.js';
import { firstCommitBaseline } from '../../utils/git/gitCommit.js';
import { dirtyPartIds, isAssemblyDirty, isWorkspaceDirty } from '../../utils/git/gitWorkspace.js';
import { fileWrite } from '../../utils/git/githubAdapterInterface.js';
import { assemblyIdPath, partIdPath } from '../../utils/git/idPaths.js';
import { executePlanSave } from '../../utils/git/executePlanSave.js';
import { makeAssemblyCommit } from '../../utils/git/lastCommit.js';
import { createMockGithubAdapter } from '../../utils/git/mockGithubAdapter.js';
import { withSurfId, withSurfName } from '../../utils/git/surfId.js';
import { toSurfJsonV2 } from '../../utils/git/surfJsonV2.js';
import { createSyncStore } from '../../utils/git/syncStore.js';
import { buildDirtyState } from './dirty.js';
import { editedPartIdsSinceSnapshot, snapshotPartScripts } from './editedSinceLoad.js';
import { compareWorkingCopyToCommit } from './workingCopyUnsaved.js';

const ASM = '2026-10-18-02-50-00-0001-aa01';
const PART = '2026-10-18-02-50-00-0001-bb02';
const OTHER = '2026-10-18-02-50-00-0001-cc03';
const SCRIPT = `// @surf-id ${PART}\nreturn 1;\n`;
const OTHER_SCRIPT = `// @surf-id ${OTHER}\nreturn 2;\n`;

function sha(text) {
  return gitBlobSha(new TextEncoder().encode(String(text ?? '')));
}

function assemblyDoc(parts, extra = {}) {
  return {
    id: ASM,
    source: 'git',
    vaultLayout: 'v2',
    name: 'Gearbox',
    activeId: parts[0]?.id ?? null,
    parts,
    ...extra,
  };
}

function seedCommit(doc, scripts) {
  const json = toSurfJsonV2(doc);
  const files = {
    [assemblyIdPath(doc.id)]: { contentHash: sha(`${JSON.stringify(json, null, 2)}\n`) },
  };
  for (const part of doc.parts) {
    files[partIdPath(part.id)] = { contentHash: sha(scripts[part.id]) };
  }
  return makeAssemblyCommit({
    assemblyId: doc.id,
    json,
    files,
    capturedAt: 1,
  });
}

const CLEAN_PARTS = [
  { id: PART, name: 'Bracket', visible: true, order: 0 },
  { id: OTHER, name: 'Cover', visible: true, order: 1 },
];
const CLEAN_SCRIPTS = { [PART]: SCRIPT, [OTHER]: OTHER_SCRIPT };

test('compareWorkingCopyToCommit is clean when WC matches AssemblyCommit', () => {
  const doc = assemblyDoc(CLEAN_PARTS);
  const commit = seedCommit(doc, CLEAN_SCRIPTS);
  const out = compareWorkingCopyToCommit({
    doc,
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
  });
  assert.equal(out.unsaved, false);
  assert.equal(out.assemblyDirty, false);
  assert.deepEqual(out.partIds, []);
});

test('changing activeId is not unsaved', () => {
  const committed = assemblyDoc(CLEAN_PARTS);
  const commit = seedCommit(committed, CLEAN_SCRIPTS);
  const wc = assemblyDoc(CLEAN_PARTS, { activeId: OTHER });
  const out = compareWorkingCopyToCommit({
    doc: wc,
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
  });
  assert.equal(out.unsaved, false);
  assert.equal(out.assemblyDirty, false);
});

test('rename, hide, and remove set unsaved', () => {
  const committed = assemblyDoc(CLEAN_PARTS);
  const commit = seedCommit(committed, CLEAN_SCRIPTS);

  const renamed = compareWorkingCopyToCommit({
    doc: assemblyDoc([
      { id: PART, name: 'Mount', visible: true, order: 0 },
      { id: OTHER, name: 'Cover', visible: true, order: 1 },
    ]),
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
  });
  assert.equal(renamed.unsaved, true);
  assert.equal(renamed.assemblyDirty, true);

  const hidden = compareWorkingCopyToCommit({
    doc: assemblyDoc([
      { id: PART, name: 'Bracket', visible: false, order: 0 },
      { id: OTHER, name: 'Cover', visible: true, order: 1 },
    ]),
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
  });
  assert.equal(hidden.unsaved, true);
  assert.equal(hidden.assemblyDirty, true);

  const removed = compareWorkingCopyToCommit({
    doc: assemblyDoc([{ id: PART, name: 'Bracket', visible: true, order: 0 }]),
    scripts: { [PART]: SCRIPT },
    assemblyCommit: commit,
  });
  assert.equal(removed.unsaved, true);
  assert.equal(removed.assemblyDirty, true);
});

test('a script change dirties that part id', () => {
  const committed = assemblyDoc(CLEAN_PARTS);
  const commit = seedCommit(committed, CLEAN_SCRIPTS);
  const out = compareWorkingCopyToCommit({
    doc: committed,
    scripts: { ...CLEAN_SCRIPTS, [PART]: `${SCRIPT}return 2;\n` },
    assemblyCommit: commit,
  });
  assert.equal(out.unsaved, true);
  assert.deepEqual(out.partIds, [PART]);
});

test('pendingSave is unsaved even when WC matches the commit', () => {
  const doc = assemblyDoc(CLEAN_PARTS);
  const commit = seedCommit(doc, CLEAN_SCRIPTS);
  const out = compareWorkingCopyToCommit({
    doc,
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
    pendingSave: true,
  });
  assert.equal(out.unsaved, true);
  assert.equal(out.pendingSave, true);
});

test('dirty.unsaved survives a reload of the same AssemblyCommit', () => {
  const committed = assemblyDoc(CLEAN_PARTS);
  const commit = seedCommit(committed, CLEAN_SCRIPTS);
  const persisted = JSON.parse(JSON.stringify(commit));
  const wc = assemblyDoc([
    { id: PART, name: 'Mount', visible: true, order: 0 },
    { id: OTHER, name: 'Cover', visible: false, order: 1 },
  ]);
  const before = compareWorkingCopyToCommit({
    doc: wc,
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
  });
  const afterReload = compareWorkingCopyToCommit({
    doc: wc,
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: persisted,
  });
  assert.equal(before.unsaved, true);
  assert.equal(afterReload.unsaved, true);
  assert.equal(afterReload.assemblyDirty, true);
});

test('Save-stamped commit hashes match the unstamped working-copy script', () => {
  const doc = assemblyDoc(CLEAN_PARTS);
  const stamped = {
    [PART]: withSurfName(withSurfId(SCRIPT, PART), 'Bracket'),
    [OTHER]: withSurfName(withSurfId(OTHER_SCRIPT, OTHER), 'Cover'),
  };
  const commit = seedCommit(doc, stamped);
  const out = compareWorkingCopyToCommit({
    doc,
    scripts: CLEAN_SCRIPTS,
    assemblyCommit: commit,
  });
  assert.equal(out.unsaved, false);
  assert.deepEqual(out.partIds, []);
});

function v2AgentDirty({ doc, scripts, assemblyCommit, snapshot, pendingSave = false }) {
  const compared = compareWorkingCopyToCommit({
    doc,
    scripts,
    assemblyCommit,
    pendingSave,
  });
  const editedSinceLoad = editedPartIdsSinceSnapshot(snapshot, scripts, {
    partIds: (doc.parts || []).map((row) => row.id),
  });
  return buildDirtyState({
    partIds: compared.partIds,
    assemblyDirty: compared.assemblyDirty,
    editedSinceLoad,
    pendingSave: compared.pendingSave,
    unsaved: compared.unsaved,
  });
}

/** Amber dots: part rows from dirtyPartIds, assembly from isWorkspaceDirty. */
function dirtyChrome(doc, scripts, gitBaseline) {
  const baseline = gitBaseline || firstCommitBaseline({});
  return {
    partIds: [...dirtyPartIds(doc, scripts, baseline)].sort(),
    assemblyDirty: isAssemblyDirty(doc, baseline),
    sourceDirty: isWorkspaceDirty(doc, scripts, baseline),
  };
}

function dirtyView({ doc, scripts, assemblyCommit, snapshot, gitBaseline, pendingSave = false }) {
  const agent = v2AgentDirty({ doc, scripts, assemblyCommit, snapshot, pendingSave });
  const chrome = dirtyChrome(doc, scripts, gitBaseline);
  return {
    unsaved: agent.unsaved,
    partIds: agent.partIds,
    assemblyDirty: agent.assemblyDirty,
    editedSinceLoad: agent.editedSinceLoad,
    pendingSave: agent.pendingSave,
    chromePartIds: chrome.partIds,
    chromeAssembly: chrome.assemblyDirty,
    sourceDirty: chrome.sourceDirty,
  };
}

function assertCleanAfterSave(view) {
  assert.equal(view.unsaved, false);
  assert.deepEqual(view.partIds, []);
  assert.equal(view.assemblyDirty, false);
  assert.deepEqual(view.editedSinceLoad, []);
  assert.deepEqual(view.chromePartIds, []);
  assert.equal(view.chromeAssembly, false);
  assert.equal(view.sourceDirty, false);
}

function dirtyMarks(view) {
  return {
    unsaved: view.unsaved,
    partIds: view.partIds,
    assemblyDirty: view.assemblyDirty,
    editedSinceLoad: view.editedSinceLoad,
    chromePartIds: view.chromePartIds,
    chromeAssembly: view.chromeAssembly,
    sourceDirty: view.sourceDirty,
  };
}

const REPO = { owner: 'artur', name: 'surfcad-vault' };

async function gitSave(adapter, store, doc, scripts, {
  message,
  create,
  online = true,
} = {}) {
  return executePlanSave({
    adapter,
    repo: REPO,
    branch: 'main',
    store,
    workingCopy: {
      doc,
      scripts,
      now: 1_700_000_000_000,
      repo: REPO,
      branch: 'main',
      saveTarget: { repo: REPO, branch: 'main' },
    },
    message,
    create,
    online,
  });
}

function adoptV2Save(result, { doc, scripts, snapshot, gitBaseline }) {
  if (result.status !== 'committed' && result.status !== 'branched') {
    return { snapshot, gitBaseline };
  }
  return {
    snapshot: snapshotPartScripts(scripts),
    gitBaseline: captureBaseline({
      assemblyPath: assemblyIdPath(doc.id),
      assemblyName: doc.name,
      doc,
      scripts,
      branch: 'main',
      headSha: result.sha || gitBaseline?.headSha || null,
    }),
  };
}

async function saveDirtyCycle({ opened }) {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const original = 'return 1;\n';
  const edited = 'return 9;\n';
  const again = 'return 10;\n';
  const doc = assemblyDoc([{ id: PART, name: 'Bracket', visible: true, order: 0 }]);
  let snapshot = snapshotPartScripts({ [PART]: original });
  let gitBaseline = null;
  let assemblyCommit = null;

  if (opened) {
    const seed = await gitSave(adapter, store, doc, { [PART]: original }, {
      message: 'Open Gearbox',
      create: true,
    });
    assert.equal(seed.status, 'committed', seed.error);
    assemblyCommit = store.getAssemblyCommit(REPO, 'main', ASM);
    ({ snapshot, gitBaseline } = adoptV2Save(seed, {
      doc,
      scripts: { [PART]: original },
      snapshot,
      gitBaseline,
    }));
    assertCleanAfterSave(dirtyView({
      doc,
      scripts: { [PART]: original },
      assemblyCommit,
      snapshot,
      gitBaseline,
    }));
  }

  const before = dirtyView({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
    gitBaseline,
  });
  assert.equal(before.unsaved, true);
  assert.deepEqual(before.partIds, [PART]);
  assert.equal(before.sourceDirty, true);
  assert.deepEqual(before.chromePartIds, [PART]);

  const saved = await gitSave(adapter, store, doc, { [PART]: edited }, {
    message: 'Save Gearbox v2',
    create: !opened,
  });
  assert.equal(saved.status, 'committed', saved.error);
  assemblyCommit = store.getAssemblyCommit(REPO, 'main', ASM);

  const stale = dirtyView({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
    gitBaseline,
  });
  assert.equal(stale.unsaved, true, 'stale agent snapshot still marks unsaved');

  ({ snapshot, gitBaseline } = adoptV2Save(saved, {
    doc,
    scripts: { [PART]: edited },
    snapshot,
    gitBaseline,
  }));
  const afterSave = dirtyView({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
    gitBaseline,
  });
  assertCleanAfterSave(afterSave);

  const afterEdit = dirtyView({
    doc,
    scripts: { [PART]: again },
    assemblyCommit,
    snapshot,
    gitBaseline,
  });
  assert.equal(afterEdit.unsaved, true);
  assert.deepEqual(afterEdit.partIds, [PART]);
  assert.deepEqual(afterEdit.chromePartIds, [PART]);
  assert.equal(afterEdit.sourceDirty, true);
}

async function seededEdit() {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const original = 'return 1;\n';
  const edited = 'return 9;\n';
  const doc = assemblyDoc([{ id: PART, name: 'Bracket', visible: true, order: 0 }]);
  const seed = await gitSave(adapter, store, doc, { [PART]: original }, {
    message: 'Open Gearbox',
    create: true,
  });
  assert.equal(seed.status, 'committed', seed.error);
  let snapshot = snapshotPartScripts({ [PART]: original });
  let gitBaseline = null;
  ({ snapshot, gitBaseline } = adoptV2Save(seed, {
    doc,
    scripts: { [PART]: original },
    snapshot,
    gitBaseline,
  }));
  const assemblyCommit = store.getAssemblyCommit(REPO, 'main', ASM);
  const before = dirtyView({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
    gitBaseline,
  });
  assert.equal(before.unsaved, true);
  return {
    adapter,
    store,
    doc,
    edited,
    snapshot,
    gitBaseline,
    assemblyCommit,
    before,
    seedSha: seed.sha,
  };
}

test('first commit: edit, git_save, dirty.unsaved is false; a later edit is unsaved', async () => {
  await saveDirtyCycle({ opened: false });
});

test('opened assembly: edit, git_save, dirty.unsaved is false; a later edit is unsaved', async () => {
  await saveDirtyCycle({ opened: true });
});

test('conflict save leaves dirty state unchanged', async () => {
  const ctx = await seededEdit();
  await ctx.adapter.commitFiles(REPO, {
    branch: 'main',
    message: 'remote overlap',
    files: [fileWrite(partIdPath(PART), 'return remote;\n')],
    baseSha: ctx.seedSha,
  });
  const result = await gitSave(ctx.adapter, ctx.store, ctx.doc, { [PART]: ctx.edited }, {
    message: 'Save Gearbox conflict',
  });
  assert.equal(result.status, 'conflict', result.error);
  const adopted = adoptV2Save(result, {
    doc: ctx.doc,
    scripts: { [PART]: ctx.edited },
    snapshot: ctx.snapshot,
    gitBaseline: ctx.gitBaseline,
  });
  assert.equal(adopted.snapshot, ctx.snapshot);
  assert.equal(adopted.gitBaseline, ctx.gitBaseline);
  assert.equal(
    storeCommitHash(ctx.store, ctx.doc.id),
    ctx.assemblyCommit?.files?.[partIdPath(PART)]?.contentHash,
  );
  const after = dirtyView({
    doc: ctx.doc,
    scripts: { [PART]: ctx.edited },
    assemblyCommit: ctx.store.getAssemblyCommit(REPO, 'main', ASM),
    snapshot: adopted.snapshot,
    gitBaseline: adopted.gitBaseline,
  });
  assert.deepEqual(dirtyMarks(after), dirtyMarks(ctx.before));
});

test('pending_save and refused saves leave dirty state unchanged', async () => {
  const pendingCtx = await seededEdit();
  const pending = await gitSave(
    pendingCtx.adapter,
    pendingCtx.store,
    pendingCtx.doc,
    { [PART]: pendingCtx.edited },
    { message: 'Save Gearbox offline', online: false },
  );
  assert.equal(pending.status, 'pending', pending.error);
  assert.ok(pendingCtx.store.getPendingSave(REPO, 'main'));
  const pendingAdopted = adoptV2Save(pending, {
    doc: pendingCtx.doc,
    scripts: { [PART]: pendingCtx.edited },
    snapshot: pendingCtx.snapshot,
    gitBaseline: pendingCtx.gitBaseline,
  });
  assert.equal(pendingAdopted.snapshot, pendingCtx.snapshot);
  assert.equal(pendingAdopted.gitBaseline, pendingCtx.gitBaseline);
  const afterPending = dirtyView({
    doc: pendingCtx.doc,
    scripts: { [PART]: pendingCtx.edited },
    assemblyCommit: pendingCtx.store.getAssemblyCommit(REPO, 'main', ASM),
    snapshot: pendingAdopted.snapshot,
    gitBaseline: pendingAdopted.gitBaseline,
    pendingSave: true,
  });
  assert.deepEqual(dirtyMarks(afterPending), dirtyMarks(pendingCtx.before));

  const refusedCtx = await seededEdit();
  const refused = await gitSave(
    refusedCtx.adapter,
    refusedCtx.store,
    refusedCtx.doc,
    { [PART]: refusedCtx.edited },
    { message: '' },
  );
  assert.equal(refused.status, 'error');
  const refusedAdopted = adoptV2Save(refused, {
    doc: refusedCtx.doc,
    scripts: { [PART]: refusedCtx.edited },
    snapshot: refusedCtx.snapshot,
    gitBaseline: refusedCtx.gitBaseline,
  });
  assert.equal(refusedAdopted.snapshot, refusedCtx.snapshot);
  assert.equal(refusedAdopted.gitBaseline, refusedCtx.gitBaseline);
  const afterRefused = dirtyView({
    doc: refusedCtx.doc,
    scripts: { [PART]: refusedCtx.edited },
    assemblyCommit: refusedCtx.store.getAssemblyCommit(REPO, 'main', ASM),
    snapshot: refusedAdopted.snapshot,
    gitBaseline: refusedAdopted.gitBaseline,
  });
  assert.deepEqual(dirtyMarks(afterRefused), dirtyMarks(refusedCtx.before));
});

function storeCommitHash(store, assemblyId) {
  return store.getAssemblyCommit(REPO, 'main', assemblyId)?.files?.[partIdPath(PART)]?.contentHash;
}
