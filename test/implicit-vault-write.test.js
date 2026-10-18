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
import { isSurfId, mintSurfId } from '../src/utils/git/surfId.js';
import { stampMissingSurfIds } from '../src/utils/git/partIdentity.js';
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

  const ensure = sliceBetween(APP, 'const ensureLocalSurfIds = async', 'const historyKey =');
  assert.match(ensure, /stampMissingSurfIds/);
  assert.equal(/source\s*===\s*'git'/.test(ensure), false, 'ensureLocalSurfIds must stamp git path-less rows');

  const stampThenGit = /await ensureLocalSurfIds\(\);[\s\S]*?rememberAssembly\(\{\s*\.\.\.\w+,\s*source:\s*'git'\s*\}\)/;

  const flip = sliceBetween(APP, '// G10: GitHub token enables vault/git source', '// After reload, baseline is gone');
  assert.equal(/ensureGitVault/.test(flip), false, 'GitHub connect must not seed a vault');
  assert.match(flip, stampThenGit, 'G10 must stamp surf ids before flipping to git');

  assert.equal(/addEventListener\(\s*'online'/.test(APP), false, 'online must not flush');

  const toggle = sliceBetween(APP, 'const handleToggleSource', 'const gitDefaultVaultName');
  assert.match(toggle, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.match(toggle, /NO_REPO_YET_COPY/);
  assert.match(toggle, stampThenGit, 'toggle must stamp surf ids before flipping to git');

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

test('local→git switch stamps surfIds on legacy path-less parts with 0 adapter writes', async () => {
  const gh = createMockGithubAdapter({ login: 'hotfix' });
  const writes = () => gh._log.filter((row) => (
    row.op === 'commitFiles' || row.op === 'createRepo' || row.op === 'createBranch'
  )).length;
  assert.equal(writes(), 0);

  // mcp-demo seed after local: prefix strip: id part1, no surfId, no path.
  const localDoc = {
    source: 'local',
    name: 'mcp-demo',
    activeId: 'part1',
    parts: [
      { id: 'part1', name: 'Part (1)', visible: true, order: 0 },
      { id: 'part2', name: 'Part (2)', visible: true, order: 1 },
    ],
  };
  const scripts = {
    part1: 'return Manifold.cube([10, 10, 10], true);\n',
    part2: 'return Manifold.cube([6, 6, 6], true);\n',
  };
  const stamped = stampMissingSurfIds(localDoc, scripts, {
    now: new Date('2026-10-18T03:00:00.000Z'),
    randFor: (_row, index) => (index === 0 ? 'aaaa' : 'bbbb'),
  });
  assert.equal(stamped.changed, true);
  assert.ok(stamped.doc.parts.every((part) => isSurfId(part.surfId)));
  assert.equal(stamped.doc.parts[0].id, 'part1');
  assert.equal(stamped.doc.parts[1].id, 'part2');
  assert.equal(stamped.doc.parts[0].path, undefined);
  assert.equal(stamped.doc.parts[1].path, undefined);
  assert.match(stamped.scripts.part1, /^\/\/ @surf-id 2026-10-18-03-00-00-0000-aaaa\n/);
  assert.match(stamped.scripts.part2, /^\/\/ @surf-id 2026-10-18-03-00-00-0000-bbbb\n/);

  const switched = { ...stamped.doc, source: 'git' };
  assert.equal(switched.source, 'git');
  assert.ok(switched.parts.every((part) => isSurfId(part.surfId)));
  assert.equal(switched.parts.every((part) => !part.path), true);

  // G10 used to flip first; ensureLocalSurfIds must still stamp a git doc.
  const alreadyGit = { ...localDoc, source: 'git' };
  const stampedGit = stampMissingSurfIds(alreadyGit, scripts, {
    now: new Date('2026-10-18T03:00:00.000Z'),
    randFor: (_row, index) => (index === 0 ? 'aaaa' : 'bbbb'),
  });
  assert.ok(stampedGit.doc.parts.every((part) => isSurfId(part.surfId)));
  assert.equal(stampedGit.doc.parts.every((part) => !part.path), true);

  // Vault-path rows wait for Open / Save — no surfId, no path rewrite.
  const withPath = {
    source: 'git',
    name: 'Assembly',
    parts: [{
      id: 'part1',
      name: 'Has Path',
      path: 'assemblies/Assembly/Has Path.js',
    }],
  };
  const skipped = stampMissingSurfIds(withPath, {});
  assert.equal(skipped.changed, false);
  assert.equal(skipped.doc.parts[0].surfId, undefined);
  assert.equal(skipped.doc.parts[0].path, 'assemblies/Assembly/Has Path.js');

  assert.equal(writes(), 0);
  assert.equal(gh._log.length, 0);
});
