/**
 * Delete from assembly & repo is recorded, not written, until Save.
 * Mock adapter only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import {
  assembleCommitFiles,
  commitWorkspace,
  firstCommitBaseline,
} from '../src/utils/git/gitCommit.js';
import { removePart } from '../src/utils/assembly.js';
import { partRepoPath } from '../src/utils/git/partIdentity.js';
import { assemblyFilePath, assetPathForScript } from '../src/utils/git/vaultLayout.js';
import {
  deletePathsForCommit,
  emptyWorkingSidecar,
  recordPendingDeletes,
  repoDeletePathsFor,
  sidecarIsDirty,
} from '../src/utils/git/workingSidecar.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';

const A = mintSurfId({ now: new Date('2026-10-18T00:00:00Z'), rand: 'aaaa' });
const B = mintSurfId({ now: new Date('2026-10-18T00:00:00Z'), rand: 'bbbb' });
const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

const seedDoc = {
  source: 'git',
  name: 'Asm',
  activeId: A,
  parts: [
    { id: A, surfId: A, name: 'Keep', visible: true, order: 0, isSynced: false },
    { id: B, surfId: B, name: 'Gone', visible: true, order: 1, isSynced: false },
  ],
};
const seedScripts = { [A]: 'return 1;\n', [B]: 'return 2;\n' };

function commitsOn(gh) {
  return gh._log.filter((row) => row.op === 'commitFiles');
}

test('save -> delete-from-repo -> save deletes the part and mesh', async () => {
  const gh = createMockGithubAdapter({ login: 'x' });
  const vault = await findOrCreateVault(gh);
  const first = await commitWorkspace(gh, vault.repo, {
    doc: seedDoc,
    scripts: seedScripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save 1',
  });
  assert.equal(first.status, 'committed', first.error);
  const goneRow = first.doc.parts.find((p) => p.name === 'Gone');
  const gonePath = partRepoPath(goneRow);
  assert.ok(gonePath);
  const meshPath = assetPathForScript(gonePath);
  const meshBytes = new Uint8Array([1, 2, 3, 4]);
  const meshCommit = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'mesh',
    baseSha: first.sha,
    files: [{ path: meshPath, content: meshBytes }],
  });
  const baseline = { ...first.baseline, headSha: meshCommit.sha };
  const writesAfterSeed = commitsOn(gh).length;

  const after = removePart(first.doc, goneRow.id);
  const scripts = { ...first.scripts };
  delete scripts[goneRow.id];
  const sidecar = recordPendingDeletes(emptyWorkingSidecar(), repoDeletePathsFor(gonePath));
  assert.equal(sidecarIsDirty(sidecar), true);
  assert.deepEqual(sidecar.pendingDeletes, [gonePath, meshPath].sort());
  assert.equal(commitsOn(gh).length, writesAfterSeed, 'delete-from-repo writes nothing');

  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.addPendingDeletes(vault.repo, 'main', 'Asm', sidecar.pendingDeletes);
  assert.deepEqual(store.getPendingDeletes(vault.repo, 'main', 'Asm'), sidecar.pendingDeletes);

  const without = await assembleCommitFiles(gh, vault.repo, {
    doc: after,
    scripts,
    baseline,
    message: 'Save 2',
  });
  assert.equal(
    (without.files || []).some((file) => file.path === gonePath && file.delete),
    false,
    'assembly-only drop does not delete the blob',
  );

  const deletePaths = deletePathsForCommit(sidecar, after);
  const planned = await assembleCommitFiles(gh, vault.repo, {
    doc: after,
    scripts,
    baseline,
    message: 'Save 2',
    deletePaths,
  });
  assert.equal(planned.status, 'ready');
  const gone = planned.files.find((file) => file.path === gonePath);
  const mesh = planned.files.find((file) => file.path === meshPath);
  const surf = planned.files.find((file) => file.path === assemblyFilePath('Asm'));
  assert.equal(gone?.delete, true, `Save deletes ${gonePath}`);
  assert.equal(mesh?.delete, true, `Save deletes ${meshPath}`);
  assert.ok(surf && !surf.delete, 'Save writes .surf.json');

  const reused = {
    ...after,
    parts: [
      ...after.parts,
      { id: B, surfId: B, name: 'Gone', path: gonePath, visible: true, order: 1 },
    ],
  };
  const skipped = deletePathsForCommit(sidecar, reused);
  assert.equal(skipped.includes(gonePath), false, 'skip a path still used by a current part');

  const second = await commitWorkspace(gh, vault.repo, {
    doc: after,
    scripts,
    baseline,
    message: 'Save 2',
    deletePaths,
  });
  assert.equal(second.status, 'committed', second.error);
  assert.equal(commitsOn(gh).length, writesAfterSeed + 1, 'one commit on Save');
  assert.equal(await gh.readFile(vault.repo, gonePath, 'main'), null);
  assert.equal(await gh.readFile(vault.repo, meshPath, 'main'), null);
  assert.ok(await gh.readFile(vault.repo, assemblyFilePath('Asm'), 'main'));
});

test('App records fromRepo deletes and passes deletePaths on Save', () => {
  const delStart = APP.indexOf('const handleDeletePart');
  const delEnd = APP.indexOf('const handleGameRun', delStart);
  const del = APP.slice(delStart, delEnd);
  assert.match(del, /opts\.fromRepo/);
  assert.match(del, /persistPendingDeletes/);
  assert.match(del, /repoDeletePathsFor/);
  assert.equal(/void opts/.test(del), false);

  const save = APP.slice(APP.indexOf('const handleGitCommit'), APP.indexOf('const absorbOverwriteFiles'));
  assert.match(save, /deletePaths/);
  assert.match(save, /clearWorkingCopySidecar/);
  assert.match(save, /SAVE_QUEUED_COPY/);

  const overwrite = APP.slice(APP.indexOf('const handleOverwriteMain'), APP.indexOf('const handleSaveOnNewBranch'));
  assert.match(overwrite, /clearWorkingCopySidecar/);
});
