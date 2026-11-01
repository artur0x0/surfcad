/**
 * App.jsx host wiring for save-model §6 PR 8.
 * Source slices: no git on create/open/rename/delete; git_save is planSave.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = APP.indexOf(startNeedle);
  const end = APP.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing ${startNeedle}`);
  return APP.slice(start, end);
}

const WRITE = /flushGitOps|flushSyncQueue|enqueueGit|enqueueAssemblySave|prepareAssemblySurfWrite|commitFiles|commitWorkspace|handleGitCommit|handleAddToRepo|ensureGitVault\(\{\s*create:\s*true\s*\}\)/;

test('create_assembly is single-flight, optional label, no git write', () => {
  const create = sliceFn('async agentCreateAssembly(', 'agentGetPartTransform(');
  assert.equal(WRITE.test(create), false, create);
  assert.match(create, /createAssemblyInFlightRef/);
  assert.match(create, /seedAgentAssembly\(\{ name \}\)/);
  assert.match(create, /assemblyId: after\?\.id/);
  assert.equal(/nextAssemblyName|handleNewAssembly\(/.test(create), false);
  const seed = sliceFn('const seedAgentAssembly', 'const agentGitReadContext');
  assert.equal(WRITE.test(seed), false, seed);
  assert.match(seed, /raw \|\| DEFAULT_ASSEMBLY_NAME/);
  assert.equal(/nextAssemblyName/.test(seed), false);
});

test('open / insert / list / delete / rename stay on the working copy', () => {
  const open = sliceFn('async agentOpenAssembly(', 'async agentOpenPart(');
  const openPart = sliceFn('async agentOpenPart(', 'async agentInsertPart(');
  const insert = sliceFn('async agentInsertPart(', 'async agentListAssemblies(');
  const list = sliceFn('async agentListAssemblies(', 'async agentDeletePart(');
  const delPart = sliceFn('async agentDeletePart(', 'async agentDeleteAssembly(');
  const delAsm = sliceFn('async agentDeleteAssembly(', 'async agentRenameAssembly(');
  const renameAsm = sliceFn('async agentRenameAssembly(', 'readAgentGitAdapterKind(');
  const renamePart = sliceFn('async agentRenamePart(', 'async agentGitBehindResolve(');
  for (const [label, src] of [
    ['open', open],
    ['openPart', openPart],
    ['insert', insert],
    ['list', list],
    ['delPart', delPart],
    ['delAsm', delAsm],
    ['renameAsm', renameAsm],
    ['renamePart', renamePart],
  ]) {
    assert.equal(WRITE.test(src), false, label);
    assert.equal(/gitAdapterRef\.current\s*=/.test(src), false, label);
  }
  assert.match(open, /\{ assemblyId \}/);
  assert.match(open, /handleOpenV2VaultAssembly\(assemblyId/);
  assert.equal(/resolveAssemblyOpenName/.test(open), false);
  assert.match(insert, /copy: copy === true/);
  const insertRows = sliceFn('const insertReferencedParts', 'const loadVaultPartRows');
  assert.match(insertRows, /copiedFrom: row\.id/);
  // Rows come from assemblyRows: saved v2 ids, the open working copy, legacy names.
  assert.match(list, /assemblies: assemblyRows\(/);
  assert.match(delPart, /scanOtherAssemblyPartUses/);
  assert.match(delPart, /assemblies/);
  assert.equal(/part_still_referenced/.test(delPart), false);
  assert.match(delAsm, /seedAgentAssembly\(\{\}\)/);
  assert.match(renameAsm, /sanitizeAssemblyName\(name\)/);
  assert.match(renamePart, /moved: false/);
  const renameGate = sliceFn('readAgentPartRename(partId)', 'async agentRenamePart');
  assert.match(renameGate, /writesGit: false/);
});

test('git_move_to_repo is v2 first Save and does not re-key rows to vault paths', () => {
  const move = sliceFn('const handleMoveToGit', 'const handleListVaultAssemblies');
  assert.match(move, /handleV2PlanSave\(/);
  assert.match(move, /vaultLayout: 'v2'/);
  assert.match(move, /ensureLocalSurfIds\(/);
  assert.match(move, /collapseWorkingCopyIds\(/);
  assert.match(move, /delete next\.path/);
  assert.match(move, /status: 'moved'/);
  assert.equal(/moveToGit\(/.test(move), false, move);
  assert.equal(/idMap/.test(move), false, move);
  assert.equal(/applyCommittedWorkspace/.test(move), false, move);
  assert.equal(/assemblies\//.test(move), false, move);
});

test('git_branch_switch on v2 opens by assembly id, not leftover folder name', () => {
  const sw = sliceFn('const handleSwitchBranch', 'const handleListVaultBrowse');
  assert.match(sw, /isV2PlanSaveDoc\(doc\)/);
  const v2 = sw.slice(sw.indexOf('isV2PlanSaveDoc'), sw.indexOf('switchVaultBranch'));
  assert.match(v2, /openV2Assembly\(/);
  assert.equal(/openNamedVaultAssembly/.test(v2), false, v2);
  assert.equal(/switchVaultBranch/.test(v2), false, v2);
  assert.match(sw, /ensureGitVault\(\{\s*create:\s*false\s*\}\)/);
  assert.equal(/\bensureGitVault\(\s*\)/.test(sw), false);
});

test('git_branch_switch same-branch is a no-op and does not demand confirm', () => {
  const sw = sliceFn('async agentGitBranchSwitch({ branch, confirm, choice })', 'async agentGitBranchDelete({ branch })');
  assert.match(sw, /target === gitWorkingBranch\(\)/);
  const confirm = sw.slice(sw.indexOf('target === gitWorkingBranch()'), sw.indexOf('sourceDirty'));
  assert.match(confirm, /return handleSwitchBranch\(target\)/);
});

test('git_branch_create copies lastCommit onto the new ref before switch', () => {
  const create = sliceFn('const handleCreateBranch', 'const handleBranchUiClose');
  assert.match(create, /putAssemblyCommit/);
  assert.match(create, /putBranchTip/);
  assert.match(create, /isV2PlanSaveDoc\(doc\)/);
  const beforeSwitch = create.slice(0, create.indexOf('handleSwitchBranch(created.name)'));
  assert.match(beforeSwitch, /putAssemblyCommit/);
});

test('isGitWorkingCopyDirty for v2 uses AssemblyCommit, not path-less first-commit', () => {
  const fn = sliceFn('const isGitWorkingCopyDirty', 'const readAgentGitWriteTarget');
  assert.match(fn, /isV2PlanSaveDoc\(doc\)/);
  assert.match(fn, /compareWorkingCopyToCommit/);
  const v2 = fn.slice(fn.indexOf('isV2PlanSaveDoc'), fn.indexOf('const baseline'));
  assert.equal(/!partRepoPath/.test(v2), false, v2);
});

test('git_save uses handleGitCommit -> handleV2PlanSave -> executePlanSave', () => {
  const save = sliceFn('async agentGitSave({ message })', 'async agentGitUpgradeVault()');
  assert.match(save, /handleGitCommit\(draft\)/);
  assert.match(save, /status: 'pending'/);
  assert.match(save, /code: 'pending_save'/);
  const commit = sliceFn('const handleGitCommit', 'const absorbOverwriteFiles');
  assert.match(commit, /isV2PlanSaveDoc\(doc\)\) return handleV2PlanSave\(message\)/);
  const plan = sliceFn('const handleV2PlanSave', 'const handlePlanSaveConflict');
  assert.match(plan, /executePlanSave\(/);
  assert.match(plan, /writeVaultCommit|executePlanSave/);
});

test('adoptV2SaveResult recaptures snapshot after a committed or branched v2 save', () => {
  const adopt = sliceFn('const adoptV2SaveResult', 'const handleV2PlanSave');
  assert.match(adopt, /if \(result\.status === 'pending'\)/);
  assert.match(adopt, /if \(result\.status === 'conflict'\)/);
  assert.match(
    adopt,
    /if \(result\.status === 'committed' \|\| result\.status === 'branched'\) \{[\s\S]*rememberGitBaseline\(baselineAfterPartSave\([\s\S]*partScriptMatchesCommitted\(/,
  );
  assert.match(adopt, /saved: committed/);
  assert.equal(/rememberGitBaseline\(\{[\s\S]*?headSha: result\.sha/.test(adopt), false);
  const beforeWrite = adopt.slice(0, adopt.indexOf("result.status === 'committed' || result.status === 'branched'"));
  assert.equal(/captureAgentScriptSnapshot/.test(beforeWrite), false);
  assert.equal(/rememberGitBaseline/.test(beforeWrite), false);
  assert.equal(/captureAgentScriptSnapshot\(\)/.test(adopt), false);
});

test('v2WorkingCopy keys scripts by part id, not vault path', () => {
  const wc = sliceFn('const v2WorkingCopy', 'const adoptV2SaveResult');
  assert.match(wc, /scripts\[doc\.activeId\] = live/);
  assert.match(wc, /loadPartAssets\(\(doc\.parts \|\| \[\]\)\.map\(\(part\) => part\.id\)\)/);
  assert.equal(/partRepoPath/.test(wc), false, wc);
  assert.equal(/part\.path/.test(wc), false, wc);
});

test('readDirty compares WC to AssemblyCommit; parts has assemblyId and no path', () => {
  const dirty = sliceFn('readDirty()', 'readToasts()');
  assert.match(dirty, /compareWorkingCopyToCommit/);
  assert.match(dirty, /assemblyCommit/);
  assert.match(dirty, /pendingSave/);
  const parts = sliceFn('readParts()', 'readActivePartSurfId()');
  assert.match(parts, /assemblyId: doc\.id/);
  assert.equal(/path:/.test(parts), false, parts);
});

test('setActivePart / transforms resolve by findPartById', () => {
  const active = sliceFn('setActivePart(partId)', 'async setPartVisible');
  assert.match(active, /findPartById\(doc, partId\)/);
  assert.match(active, /unknownPartError/);
  const get = sliceFn('agentGetPartTransform({ partId })', 'agentSetPartTransform({ partId');
  assert.match(get, /findPartById\(doc, partId\)/);
  const set = sliceFn('agentSetPartTransform({ partId, position, rotation })', 'async agentCreatePart');
  assert.match(set, /findPartById\(doc, partId\)/);
});

test('handleRenamePart looks up by row.id only, not vault path', () => {
  const rename = sliceFn('const handleRenamePart = async (id, name) => {', 'const handleRenameFile');
  assert.match(rename, /row && row\.id === id/);
  assert.equal(/findAssemblyPart/.test(rename), false, rename);
  assert.equal(/part\.path/.test(rename), false, rename);
});
