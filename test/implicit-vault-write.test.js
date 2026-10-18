/**
 * Implicit edits must not commit, push, or create a vault.
 * Save / git_save is the only writer. Mock adapter only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { captureBaseline, isAssemblyDirty } from '../src/utils/git/gitWorkspace.js';
import { stringifySurfJson, toSurfJson, validateSurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import { assembleCommitFiles, commitWorkspace, firstCommitBaseline } from '../src/utils/git/gitCommit.js';
import { assemblyFilePath } from '../src/utils/git/vaultLayout.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing slice ${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function assertNoGitWrite(label, src) {
  assert.equal(/flushGitOps|flushSyncQueue|enqueueGit|enqueueAssemblySave|prepareAssemblySurfWrite|commitFiles|commitWorkspace/.test(src), false, label);
}

const PATHLESS_ID = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'cccc' });
const PATHLESS_DOC = {
  source: 'git',
  name: 'Assembly',
  activeId: PATHLESS_ID,
  parts: [{
    id: PATHLESS_ID,
    name: 'Pi5 Case Base',
    visible: true,
    order: 0,
    surfId: PATHLESS_ID,
    isSynced: false,
  }],
};

test('App implicit edits do not enqueue or flush a vault write', () => {
  const paint = sliceBetween(APP, 'const handleCommitPaint', 'const handleCommitFea');
  assertNoGitWrite('handleCommitPaint', paint);
  assert.match(paint, /rememberAssembly/);

  assertNoGitWrite('handleRenameGroup', sliceBetween(APP, 'const handleRenameGroup', 'const handleUngroup'));
  assertNoGitWrite('handleUngroup', sliceBetween(APP, 'const handleUngroup', 'const handleCopyGroup'));
  assertNoGitWrite('handleCopyGroup', sliceBetween(APP, 'const handleCopyGroup', 'const handleRemoveGroup'));
  assertNoGitWrite('handleRemoveGroup', sliceBetween(APP, 'const handleRemoveGroup', 'const handleRenameRetry'));

  assertNoGitWrite(
    'handleInsertVaultAssemblyParts',
    sliceBetween(APP, 'const handleInsertVaultAssemblyParts', 'const handleOpenVaultPart'),
  );
  assertNoGitWrite(
    'handleOpenVaultPart',
    sliceBetween(APP, 'const handleOpenVaultPart', 'const handleCopyPartToAssembly'),
  );
  assertNoGitWrite(
    'handleCopyPartToAssembly',
    sliceBetween(APP, 'const handleCopyPartToAssembly', 'const handleRenameGroup'),
  );
  assertNoGitWrite('handleDeletePart', sliceBetween(APP, 'const handleDeletePart', 'const handleGameRun'));
  assertNoGitWrite('handleRenamePart', sliceBetween(APP, 'const handleRenamePart', 'const handleRenameFile'));
  assertNoGitWrite('handleRenameAssembly', sliceBetween(APP, 'const handleRenameAssembly', 'const handleAccount'));

  const add = sliceBetween(APP, 'const handleAddPart', 'const handleDeletePart');
  assertNoGitWrite('handleAddPart', add);

  const created = sliceBetween(APP, 'const handleNewAssembly', 'const handleAddPart');
  assert.equal(/ensureGitVault/.test(created), false, 'New Assembly must not create a vault');

  const collect = sliceBetween(APP, 'const collectTakenAssemblyNames', 'const gitSync =');
  assert.equal(/ensureGitVault/.test(collect), false, 'name listing must not create a vault');

  const flip = sliceBetween(APP, '// G10: GitHub token enables vault/git source', '// After reload, baseline is gone');
  assert.equal(/ensureGitVault/.test(flip), false, 'GitHub connect must not seed a vault');

  assert.equal(/addEventListener\(\s*'online'/.test(APP), false, 'online must not flush');

  const toggle = sliceBetween(APP, 'const handleToggleSource', 'const gitDefaultVaultName');
  assert.match(toggle, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.match(toggle, /NO_REPO_YET_COPY/);

  const listAsm = sliceBetween(APP, 'const handleListVaultAssemblies', 'const adoptVaultOpening');
  assert.match(listAsm, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);

  const listBrowse = sliceBetween(APP, 'const handleListVaultBrowse', 'const vaultEntriesForDelete');
  assert.match(listBrowse, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);

  const listBranches = sliceBetween(APP, 'const handleListBranches', 'const handleSwitchBranch');
  assert.match(listBranches, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);

  const delEntries = sliceBetween(APP, 'const vaultEntriesForDelete', 'const showEmptyAssembly');
  assert.match(delEntries, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);

  assert.match(APP, /NO_REPO_YET_COPY/);
  assert.equal(/queuedRename/.test(APP), false);

  const save = sliceBetween(APP, 'const handleGitCommit', 'const absorbOverwriteFiles');
  assert.match(save, /flushGitOps\(\{ surfaceConflict: false \}\)/);
  assert.match(save, /enqueueGit\(vault\.repo/);
  assert.match(save, /deletePaths/);
  assert.match(APP, /async agentGitSave\(\{ message \}\) \{[\s\S]*?return handleGitCommit\(draft\);/);
});

test('path-less working copy serializes for baselines and is dirty until Save', () => {
  assert.throws(
    () => stringifySurfJson(PATHLESS_DOC),
    /path must be a repo-relative path/,
  );
  const working = toSurfJson(PATHLESS_DOC, { validate: false });
  assert.equal(working.parts[0].id, PATHLESS_ID);
  assert.equal(working.parts[0].path, undefined);
  assert.equal(validateSurfJson(working, { allowMissingPaths: true }).ok, true);
  assert.equal(validateSurfJson(working).ok, false);

  const baseline = captureBaseline({
    doc: PATHLESS_DOC,
    scripts: { [PATHLESS_ID]: 'return 1;\n' },
    assemblyName: 'Assembly',
  });
  assert.match(baseline.assemblyText, /Pi5 Case Base/);
  assert.equal(isAssemblyDirty(PATHLESS_DOC, baseline), false);

  const painted = {
    ...PATHLESS_DOC,
    colors: { [PATHLESS_ID]: { part: '#3b82f6' } },
  };
  assert.equal(isAssemblyDirty(painted, baseline), true);
});

test('implicit working-copy snapshot does not call commitFiles; Save still does', async () => {
  const gh = createMockGithubAdapter({ login: 'hotfix' });
  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  captureBaseline({
    doc: PATHLESS_DOC,
    scripts: { [PATHLESS_ID]: 'return 1;\n' },
    assemblyName: 'Assembly',
  });
  isAssemblyDirty(PATHLESS_DOC, captureBaseline({
    doc: PATHLESS_DOC,
    scripts: { [PATHLESS_ID]: 'return 1;\n' },
    assemblyName: 'Assembly',
  }));
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore);

  const vault = await findOrCreateVault(gh);
  const afterCreate = gh._log.filter((row) => row.op === 'commitFiles').length;
  const planned = await assembleCommitFiles(gh, vault.repo, {
    doc: PATHLESS_DOC,
    scripts: { [PATHLESS_ID]: 'return 1;\n' },
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Assembly',
  });
  assert.equal(planned.status, 'ready');
  assert.ok(planned.doc.parts[0].path);
  assert.ok(planned.files.some((file) => file.path === assemblyFilePath('Assembly')));
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, afterCreate);

  const committed = await commitWorkspace(gh, vault.repo, {
    doc: PATHLESS_DOC,
    scripts: { [PATHLESS_ID]: 'return 1;\n' },
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Assembly',
  });
  assert.equal(committed.status, 'committed', committed.error);
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, afterCreate + 1);
});
