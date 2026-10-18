/**
 * dirty.unsaved is WC vs AssemblyCommit. Rename / hide / remove count.
 * A cloned commit (reload) still reports unsaved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { gitBlobSha } from '../../utils/git/binaryContent.js';
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

const REPO = { owner: 'artur', name: 'surfcad-vault' };

async function gitSave(adapter, store, doc, scripts, { message, create }) {
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
  });
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
  let assemblyCommit = null;

  if (opened) {
    const seed = await gitSave(adapter, store, doc, { [PART]: original }, {
      message: 'Open Gearbox',
      create: true,
    });
    assert.equal(seed.status, 'committed', seed.error);
    assemblyCommit = store.getAssemblyCommit(REPO, 'main', ASM);
    snapshot = snapshotPartScripts({ [PART]: original });
    assert.equal(v2AgentDirty({
      doc,
      scripts: { [PART]: original },
      assemblyCommit,
      snapshot,
    }).unsaved, false);
  }

  const before = v2AgentDirty({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
  });
  assert.equal(before.unsaved, true);

  const saved = await gitSave(adapter, store, doc, { [PART]: edited }, {
    message: 'Save Gearbox v2',
    create: !opened,
  });
  assert.equal(saved.status, 'committed', saved.error);
  assemblyCommit = store.getAssemblyCommit(REPO, 'main', ASM);

  const stale = v2AgentDirty({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
  });
  assert.equal(stale.unsaved, true, 'stale agent snapshot still marks unsaved');

  snapshot = snapshotPartScripts({ [PART]: edited });
  const afterSave = v2AgentDirty({
    doc,
    scripts: { [PART]: edited },
    assemblyCommit,
    snapshot,
  });
  assert.equal(afterSave.unsaved, false);
  assert.deepEqual(afterSave.partIds, []);
  assert.deepEqual(afterSave.editedSinceLoad, []);

  const afterEdit = v2AgentDirty({
    doc,
    scripts: { [PART]: again },
    assemblyCommit,
    snapshot,
  });
  assert.equal(afterEdit.unsaved, true);
  assert.deepEqual(afterEdit.partIds, [PART]);
}

test('first commit: edit, git_save, dirty.unsaved is false; a later edit is unsaved', async () => {
  await saveDirtyCycle({ opened: false });
});

test('opened assembly: edit, git_save, dirty.unsaved is false; a later edit is unsaved', async () => {
  await saveDirtyCycle({ opened: true });
});
