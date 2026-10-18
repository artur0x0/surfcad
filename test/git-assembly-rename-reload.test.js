/**
 * Assembly rename, then reload, keeps the old vault name so Save moves.
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
import { openVaultAssembly } from '../src/utils/git/gitWorkspace.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import {
  emptyWorkingSidecar,
  recordRenameFrom,
  sidecarIsDirty,
} from '../src/utils/git/workingSidecar.js';

const A = mintSurfId({ now: new Date('2026-10-18T00:00:00Z'), rand: 'aaaa' });
const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const seedDoc = {
  source: 'git',
  name: 'Asm',
  activeId: A,
  parts: [{ id: A, surfId: A, name: 'Keep', visible: true, order: 0, isSynced: false }],
};

function commitsOn(gh) {
  return gh._log.filter((row) => row.op === 'commitFiles');
}

test('assembly rename, then reload (no baseline), then Save moves once', async () => {
  const gh = createMockGithubAdapter({ login: 'x' });
  const vault = await findOrCreateVault(gh);
  const first = await commitWorkspace(gh, vault.repo, {
    doc: seedDoc,
    scripts: { [A]: 'return 1;\n' },
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save 1',
  });
  assert.equal(first.status, 'committed', first.error);
  const writesAfterSave = commitsOn(gh).length;
  const renamed = { ...first.doc, name: 'Asm2' };
  const sidecar = recordRenameFrom(emptyWorkingSidecar(), first.baseline.assemblyName);
  assert.equal(sidecar.renameFrom, 'Asm');
  assert.equal(sidecarIsDirty(sidecar), true);
  assert.equal(
    recordRenameFrom(sidecar, 'Asm2').renameFrom,
    'Asm',
    'a second rename keeps the original vault name',
  );

  const inSession = await assembleCommitFiles(gh, vault.repo, {
    doc: renamed,
    scripts: first.scripts,
    baseline: first.baseline,
  });
  assert.equal(inSession.status, 'ready');
  assert.ok(inSession.files.some((file) => file.path === assemblyFilePath('Asm2') && !file.delete));
  assert.ok(inSession.files.some((file) => file.path === assemblyFilePath('Asm') && file.delete));

  await assert.rejects(
    () => openVaultAssembly(gh, vault.repo, 'Asm2', { branch: 'main' }),
    /Assembly not found/,
  );
  const opened = await openVaultAssembly(gh, vault.repo, sidecar.renameFrom, { branch: 'main' });
  assert.equal(opened.baseline.assemblyName, 'Asm');
  assert.equal(commitsOn(gh).length, writesAfterSave, 'reload writes nothing');

  const head = (await gh.getBranch(vault.repo, 'main')).sha;
  const broken = await assembleCommitFiles(gh, vault.repo, {
    doc: renamed,
    scripts: first.scripts,
    baseline: firstCommitBaseline({ headSha: head }),
  });
  assert.equal(
    (broken.files || []).some((file) => file.path === assemblyFilePath('Asm') && file.delete),
    false,
    'first-commit baseline after a rename leaves the old assembly',
  );

  const planned = await assembleCommitFiles(gh, vault.repo, {
    doc: renamed,
    scripts: first.scripts,
    baseline: opened.baseline,
    message: 'Save 2',
  });
  assert.equal(planned.status, 'ready');
  assert.ok(planned.files.some((file) => file.path === assemblyFilePath('Asm2') && !file.delete));
  assert.ok(planned.files.some((file) => file.path === assemblyPartPath('Asm2', 'Keep') && !file.delete));
  assert.ok(planned.files.some((file) => file.path === assemblyFilePath('Asm') && file.delete));
  assert.ok(planned.files.some((file) => file.path === assemblyPartPath('Asm', 'Keep') && file.delete));

  const second = await commitWorkspace(gh, vault.repo, {
    doc: renamed,
    scripts: first.scripts,
    baseline: opened.baseline,
    message: 'Save 2',
  });
  assert.equal(second.status, 'committed', second.error);
  assert.equal(commitsOn(gh).length, writesAfterSave + 1, 'one commit on Save');
  assert.ok(await gh.readFile(vault.repo, assemblyFilePath('Asm2'), 'main'));
  assert.equal(await gh.readFile(vault.repo, assemblyFilePath('Asm'), 'main'), null);
});

test('App stores renameFrom and reseeds by the old vault name', () => {
  const rename = APP.slice(APP.indexOf('const handleRenameAssembly'), APP.indexOf('const handleAccount'));
  assert.match(rename, /recordRenameFrom/);
  assert.match(rename, /rememberSidecar/);

  const reseed = APP.slice(
    APP.indexOf('// After reload, baseline is gone'),
    APP.indexOf('const handleFlushLocalAssembly'),
  );
  assert.equal(/queuedRename/.test(reseed), false, 'queuedRename branch is gone');
  assert.match(reseed, /renameFrom/);
  assert.match(reseed, /openName/);
});
