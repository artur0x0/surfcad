/**
 * After a successful v2 Save, dirty chrome and dirty.unsaved go clean.
 * Conflict / refused / pending / failed saves leave that state as-is.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDirtyState } from '../src/agent/state/dirty.js';
import { editedPartIdsSinceSnapshot, snapshotPartScripts } from '../src/agent/state/editedSinceLoad.js';
import { baselineAfterPartSave, firstCommitBaseline } from '../src/utils/git/gitCommit.js';
import { dirtyPartIds, isAssemblyDirty, isPartDirty, isWorkspaceDirty } from '../src/utils/git/gitWorkspace.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { assemblyIdPath, parseIdPath, partIdPath } from '../src/utils/git/idPaths.js';
import { partScriptMatchesCommitted, stampPartScript } from '../src/utils/git/planSave.js';
import {
  executePlanSave,
  executePlanSaveConflictChoice,
} from '../src/utils/git/executePlanSave.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const ASM = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const PART = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'bb02' });
const OTHER = mintSurfId({ now: new Date('2026-10-18T02:50:00.003Z'), rand: 'cc03' });
const REPO = { owner: 'artur', name: 'surfcad-vault' };

function sliceFn(startNeedle, endNeedle) {
  const start = APP.indexOf(startNeedle);
  const end = APP.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing ${startNeedle}`);
  return APP.slice(start, end);
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

function dirtyChrome(doc, scripts, gitBaseline) {
  const baseline = gitBaseline || firstCommitBaseline({});
  return {
    partIds: [...dirtyPartIds(doc, scripts, baseline)].sort(),
    assemblyDirty: isAssemblyDirty(doc, baseline),
    sourceDirty: isWorkspaceDirty(doc, scripts, baseline),
  };
}

function dirtyView({ doc, scripts, snapshot, gitBaseline }) {
  const editedSinceLoad = editedPartIdsSinceSnapshot(snapshot, scripts, {
    partIds: (doc.parts || []).map((row) => row.id),
  });
  const chrome = dirtyChrome(doc, scripts, gitBaseline);
  const agent = buildDirtyState({
    workspaceDirty: chrome.sourceDirty,
    partIds: chrome.partIds,
    assemblyDirty: chrome.assemblyDirty,
    editedSinceLoad,
  });
  return {
    unsaved: agent.unsaved,
    partIds: agent.partIds,
    assemblyDirty: agent.assemblyDirty,
    editedSinceLoad: agent.editedSinceLoad,
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

function committedPartScripts(files) {
  const saved = {};
  for (const file of files || []) {
    if (!file || file.delete || typeof file.content !== 'string') continue;
    const parsed = parseIdPath(file.path);
    if (parsed?.kind === 'part') saved[parsed.id] = file.content;
  }
  return saved;
}

function adoptV2Save(result, { doc, scripts, snapshot, gitBaseline }) {
  if (result.status !== 'committed' && result.status !== 'branched') {
    return { snapshot, gitBaseline };
  }
  const committed = committedPartScripts(result.files);
  const nextSnap = { ...(snapshot || {}) };
  for (const part of doc.parts || []) {
    const liveText = scripts[part.id];
    const committedText = committed[part.id];
    if (typeof committedText !== 'string' || typeof liveText !== 'string') continue;
    if (partScriptMatchesCommitted(liveText, committedText, part.id, part.name)) {
      nextSnap[part.id] = liveText;
    }
  }
  return {
    snapshot: nextSnap,
    gitBaseline: baselineAfterPartSave(gitBaseline, {
      doc,
      saved: committed,
      assemblyPath: assemblyIdPath(doc.id),
      assemblyName: doc.name,
      branch: result.branch || gitBaseline?.branch || 'main',
      headSha: result.sha || gitBaseline?.headSha || null,
      assemblyWritten: (result.files || []).some((file) => (
        file?.path === assemblyIdPath(doc.id) && !file.delete
      )),
    }),
  };
}

function twoPartDoc() {
  return assemblyDoc([
    { id: PART, name: 'Bracket', visible: true, order: 0 },
    { id: OTHER, name: 'Cover', visible: true, order: 1 },
  ]);
}

async function saveDirtyCycle({ opened }) {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const original = 'return 1;\n';
  const other = 'return 2;\n';
  const edited = 'return 9;\n';
  const again = 'return 10;\n';
  const doc = twoPartDoc();
  const originalScripts = { [PART]: original, [OTHER]: other };
  let snapshot = snapshotPartScripts(originalScripts);
  let gitBaseline = null;

  if (opened) {
    const seed = await gitSave(adapter, store, doc, originalScripts, {
      message: 'Open Gearbox',
      create: true,
    });
    assert.equal(seed.status, 'committed', seed.error);
    ({ snapshot, gitBaseline } = adoptV2Save(seed, {
      doc,
      scripts: originalScripts,
      snapshot,
      gitBaseline,
    }));
    assertCleanAfterSave(dirtyView({
      doc,
      scripts: originalScripts,
      snapshot,
      gitBaseline,
    }));
  }

  const editedScripts = { [PART]: edited, [OTHER]: other };
  const before = dirtyView({
    doc,
    scripts: editedScripts,
    snapshot,
    gitBaseline,
  });
  assert.equal(before.unsaved, true);
  assert.equal(before.sourceDirty, true);
  if (opened) {
    assert.deepEqual(before.partIds, [PART]);
    assert.deepEqual(before.chromePartIds, [PART]);
  } else {
    assert.ok(before.partIds.includes(PART));
    assert.ok(before.chromePartIds.includes(PART));
  }

  const saved = await gitSave(adapter, store, doc, editedScripts, {
    message: 'Save Gearbox v2',
    create: !opened,
  });
  assert.equal(saved.status, 'committed', saved.error);

  const stale = dirtyView({
    doc,
    scripts: editedScripts,
    snapshot,
    gitBaseline,
  });
  assert.equal(stale.unsaved, true, 'stale agent snapshot still marks unsaved');

  ({ snapshot, gitBaseline } = adoptV2Save(saved, {
    doc,
    scripts: editedScripts,
    snapshot,
    gitBaseline,
  }));
  const afterSave = dirtyView({
    doc,
    scripts: editedScripts,
    snapshot,
    gitBaseline,
  });
  assertCleanAfterSave(afterSave);

  const afterEdit = dirtyView({
    doc,
    scripts: { [PART]: again, [OTHER]: other },
    snapshot,
    gitBaseline,
  });
  assert.equal(afterEdit.unsaved, true);
  assert.deepEqual(afterEdit.partIds, [PART]);
  assert.deepEqual(afterEdit.chromePartIds, [PART]);
  assert.equal(afterEdit.sourceDirty, true);
  assert.equal(afterEdit.chromeAssembly, false);
}

async function seededEdit() {
  const adapter = createMockGithubAdapter({ login: 'artur' });
  const store = createSyncStore({ persist: false });
  await store.ready();
  const original = 'return 1;\n';
  const other = 'return 2;\n';
  const edited = 'return 9;\n';
  const doc = twoPartDoc();
  const originalScripts = { [PART]: original, [OTHER]: other };
  const seed = await gitSave(adapter, store, doc, originalScripts, {
    message: 'Open Gearbox',
    create: true,
  });
  assert.equal(seed.status, 'committed', seed.error);
  let snapshot = snapshotPartScripts(originalScripts);
  let gitBaseline = null;
  ({ snapshot, gitBaseline } = adoptV2Save(seed, {
    doc,
    scripts: originalScripts,
    snapshot,
    gitBaseline,
  }));
  const editedScripts = { [PART]: edited, [OTHER]: other };
  const before = dirtyView({
    doc,
    scripts: editedScripts,
    snapshot,
    gitBaseline,
  });
  assert.equal(before.unsaved, true);
  return {
    adapter,
    store,
    doc,
    editedScripts,
    snapshot,
    gitBaseline,
    before,
    seedSha: seed.sha,
  };
}

test('adoptV2SaveResult recaptures snapshot after a committed or branched v2 save', () => {
  const adopt = sliceFn('const adoptV2SaveResult', 'const handleV2PlanSave');
  assert.match(
    adopt,
    /if \(result\.status === 'committed' \|\| result\.status === 'branched'\) \{[\s\S]*rememberGitBaseline\(baselineAfterPartSave\([\s\S]*partScriptMatchesCommitted\(/,
  );
  assert.match(adopt, /saved: committed/);
  assert.match(APP, /from '\.\/utils\/git\/planSave'/);
  assert.equal(/rememberGitBaseline\(\{[\s\S]*?headSha: result\.sha/.test(adopt), false);
  const beforeWrite = adopt.slice(0, adopt.indexOf("result.status === 'committed' || result.status === 'branched'"));
  assert.equal(/captureAgentScriptSnapshot/.test(beforeWrite), false);
  assert.equal(/rememberGitBaseline/.test(beforeWrite), false);
  assert.equal(/captureAgentScriptSnapshot\(\)/.test(adopt), false);
});

test('first commit: edit, git_save, dirty.unsaved is false; a later edit is unsaved', async () => {
  await saveDirtyCycle({ opened: false });
});

test('opened assembly: edit, git_save, dirty.unsaved is false; a later edit is unsaved', async () => {
  await saveDirtyCycle({ opened: true });
});

test('branched v2 Save leaves every saved part and the assembly clean', async () => {
  const ctx = await seededEdit();
  await ctx.adapter.commitFiles(REPO, {
    branch: 'main',
    message: 'remote overlap',
    files: [fileWrite(partIdPath(PART), 'return remote;\n')],
    baseSha: ctx.seedSha,
  });
  const blocked = await gitSave(ctx.adapter, ctx.store, ctx.doc, ctx.editedScripts, {
    message: 'Save Gearbox conflict',
  });
  assert.equal(blocked.status, 'conflict', blocked.error);
  const branched = await executePlanSaveConflictChoice({
    action: 'branch',
    adapter: ctx.adapter,
    repo: REPO,
    branch: 'main',
    store: ctx.store,
    workingCopy: {
      doc: ctx.doc,
      scripts: ctx.editedScripts,
      now: 1_700_000_000_001,
      repo: REPO,
      branch: 'main',
      saveTarget: { repo: REPO, branch: 'main' },
    },
    message: 'Save mine',
    paths: blocked.paths,
  });
  assert.equal(branched.status, 'branched', branched.error);
  const adopted = adoptV2Save(branched, {
    doc: ctx.doc,
    scripts: ctx.editedScripts,
    snapshot: ctx.snapshot,
    gitBaseline: ctx.gitBaseline,
  });
  const afterSave = dirtyView({
    doc: ctx.doc,
    scripts: ctx.editedScripts,
    snapshot: adopted.snapshot,
    gitBaseline: adopted.gitBaseline,
  });
  assertCleanAfterSave(afterSave);

  const afterEdit = dirtyView({
    doc: ctx.doc,
    scripts: { ...ctx.editedScripts, [PART]: 'return 10;\n' },
    snapshot: adopted.snapshot,
    gitBaseline: adopted.gitBaseline,
  });
  assert.equal(afterEdit.unsaved, true);
  assert.deepEqual(afterEdit.chromePartIds, [PART]);
});

test('conflict save leaves dirty state unchanged', async () => {
  const ctx = await seededEdit();
  await ctx.adapter.commitFiles(REPO, {
    branch: 'main',
    message: 'remote overlap',
    files: [fileWrite(partIdPath(PART), 'return remote;\n')],
    baseSha: ctx.seedSha,
  });
  const result = await gitSave(ctx.adapter, ctx.store, ctx.doc, ctx.editedScripts, {
    message: 'Save Gearbox conflict',
  });
  assert.equal(result.status, 'conflict', result.error);
  const adopted = adoptV2Save(result, {
    doc: ctx.doc,
    scripts: ctx.editedScripts,
    snapshot: ctx.snapshot,
    gitBaseline: ctx.gitBaseline,
  });
  assert.equal(adopted.snapshot, ctx.snapshot);
  assert.equal(adopted.gitBaseline, ctx.gitBaseline);
  const after = dirtyView({
    doc: ctx.doc,
    scripts: ctx.editedScripts,
    snapshot: adopted.snapshot,
    gitBaseline: adopted.gitBaseline,
  });
  assert.deepEqual(dirtyMarks(after), dirtyMarks(ctx.before));
});

test('pending_save, refused, and failed saves leave dirty state unchanged', async () => {
  const pendingCtx = await seededEdit();
  const pending = await gitSave(
    pendingCtx.adapter,
    pendingCtx.store,
    pendingCtx.doc,
    pendingCtx.editedScripts,
    { message: 'Save Gearbox offline', online: false },
  );
  assert.equal(pending.status, 'pending', pending.error);
  assert.ok(pendingCtx.store.getPendingSave(REPO, 'main'));
  const pendingAdopted = adoptV2Save(pending, {
    doc: pendingCtx.doc,
    scripts: pendingCtx.editedScripts,
    snapshot: pendingCtx.snapshot,
    gitBaseline: pendingCtx.gitBaseline,
  });
  assert.equal(pendingAdopted.snapshot, pendingCtx.snapshot);
  assert.equal(pendingAdopted.gitBaseline, pendingCtx.gitBaseline);
  const afterPending = dirtyView({
    doc: pendingCtx.doc,
    scripts: pendingCtx.editedScripts,
    snapshot: pendingAdopted.snapshot,
    gitBaseline: pendingAdopted.gitBaseline,
  });
  assert.deepEqual(dirtyMarks(afterPending), dirtyMarks(pendingCtx.before));

  const refusedCtx = await seededEdit();
  const refused = await gitSave(
    refusedCtx.adapter,
    refusedCtx.store,
    refusedCtx.doc,
    refusedCtx.editedScripts,
    { message: '' },
  );
  assert.equal(refused.status, 'error');
  const refusedAdopted = adoptV2Save(refused, {
    doc: refusedCtx.doc,
    scripts: refusedCtx.editedScripts,
    snapshot: refusedCtx.snapshot,
    gitBaseline: refusedCtx.gitBaseline,
  });
  assert.equal(refusedAdopted.snapshot, refusedCtx.snapshot);
  assert.equal(refusedAdopted.gitBaseline, refusedCtx.gitBaseline);
  const afterRefused = dirtyView({
    doc: refusedCtx.doc,
    scripts: refusedCtx.editedScripts,
    snapshot: refusedAdopted.snapshot,
    gitBaseline: refusedAdopted.gitBaseline,
  });
  assert.deepEqual(dirtyMarks(afterRefused), dirtyMarks(refusedCtx.before));

  const failedCtx = await seededEdit();
  const orig = failedCtx.adapter.listTree.bind(failedCtx.adapter);
  failedCtx.adapter.listTree = async () => {
    throw new Error('listTree down');
  };
  const failed = await gitSave(
    failedCtx.adapter,
    failedCtx.store,
    failedCtx.doc,
    failedCtx.editedScripts,
    { message: 'Save Gearbox failed' },
  );
  failedCtx.adapter.listTree = orig;
  assert.equal(failed.status, 'error');
  const failedAdopted = adoptV2Save(failed, {
    doc: failedCtx.doc,
    scripts: failedCtx.editedScripts,
    snapshot: failedCtx.snapshot,
    gitBaseline: failedCtx.gitBaseline,
  });
  assert.equal(failedAdopted.snapshot, failedCtx.snapshot);
  assert.equal(failedAdopted.gitBaseline, failedCtx.gitBaseline);
  const afterFailed = dirtyView({
    doc: failedCtx.doc,
    scripts: failedCtx.editedScripts,
    snapshot: failedAdopted.snapshot,
    gitBaseline: failedAdopted.gitBaseline,
  });
  assert.deepEqual(dirtyMarks(afterFailed), dirtyMarks(failedCtx.before));
});

test('unstamped working copy matches Save-stamped committed baseline bytes', () => {
  const original = 'return 1;\n';
  const stamped = stampPartScript(original, PART, 'Bracket');
  assert.notEqual(stamped, original);
  assert.equal(partScriptMatchesCommitted(original, stamped, PART, 'Bracket'), true);
  const doc = assemblyDoc([{ id: PART, name: 'Bracket', visible: true, order: 0 }]);
  const baseline = baselineAfterPartSave(null, {
    doc,
    saved: { [PART]: stamped },
    assemblyPath: assemblyIdPath(ASM),
    assemblyName: 'Gearbox',
    assemblyWritten: true,
  });
  assert.equal(isPartDirty(PART, original, baseline, { name: 'Bracket' }), false);
  assert.equal([...dirtyPartIds(doc, { [PART]: original }, baseline)].length, 0);
});

test('an edit typed while Save is in flight keeps its dirty dot', async () => {
  const ctx = await seededEdit();
  const saved = await gitSave(ctx.adapter, ctx.store, ctx.doc, ctx.editedScripts, {
    message: 'Save Gearbox v2',
  });
  assert.equal(saved.status, 'committed', saved.error);
  const inFlight = { ...ctx.editedScripts, [PART]: 'return 10;\n' };
  const adopted = adoptV2Save(saved, {
    doc: ctx.doc,
    scripts: inFlight,
    snapshot: ctx.snapshot,
    gitBaseline: ctx.gitBaseline,
  });
  const after = dirtyView({
    doc: ctx.doc,
    scripts: inFlight,
    snapshot: adopted.snapshot,
    gitBaseline: adopted.gitBaseline,
  });
  assert.equal(after.unsaved, true);
  assert.deepEqual(after.chromePartIds, [PART]);
  assert.equal(after.sourceDirty, true);
  assert.ok(String(adopted.gitBaseline.scripts[PART] || '').startsWith('// @surf-id '));
  assert.equal(inFlight[PART].startsWith('// @surf-id '), false);
});

