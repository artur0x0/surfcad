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
  assert.match(list, /assemblies: rows/);
  assert.match(delPart, /part_still_referenced/);
  assert.match(delPart, /listPartParentAssemblies/);
  assert.match(delAsm, /seedAgentAssembly\(\{\}\)/);
  assert.match(renameAsm, /sanitizeAssemblyName\(name\)/);
  assert.match(renamePart, /moved: false/);
  const renameGate = sliceFn('readAgentPartRename(partId)', 'async agentRenamePart');
  assert.match(renameGate, /writesGit: false/);
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
