/**
 * create_part and open_assembly stay on the working copy.
 * Listing vault names for a missing open is a read inside the existing
 * list handler. These host functions must not commit, enqueue, or flush.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { createdPartFromDocs, scriptRequestsRun } from '../src/agent/state/createPart.js';
import { resolveAssemblyOpenName } from '../src/agent/state/openAssemblyName.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = APP.indexOf(startNeedle);
  const end = APP.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing ${startNeedle}`);
  return APP.slice(start, end);
}

const WRITE = /flushGitOps|flushSyncQueue|enqueueGit|enqueueAssemblySave|prepareAssemblySurfWrite|commitFiles|commitWorkspace|handleGitCommit|handleAddToRepo|ensureGitVault\(\{\s*create:\s*true\s*\}\)/;

test('agentCreatePart and agentOpenAssembly do not call git', () => {
  const create = sliceFn('async agentCreatePart(', 'async agentOpenAssembly(');
  const open = sliceFn('async agentOpenAssembly(', 'async agentOpenPart(');
  assert.equal(WRITE.test(create), false, create);
  assert.equal(WRITE.test(open), false, open);
  assert.equal(/ensureGitVault|gitAdapter|commitFiles/.test(create), false);
  assert.match(create, /createdPartFromDocs\(before, after\)/);
  assert.match(create, /if \(doc\.activeId !== created\.id\)/);
  assert.match(create, /activeId: created\.id/);
  assert.match(create, /rememberCadPart\(created\.id\)/);
  assert.match(create, /if \(!runScript\) return \{ result: \{ partId, partCount \} \}/);
  assert.match(create, /agentRunOutcome\(text\)/);
  assert.match(APP, /bodyCount: finishedRunBodyCount\(run, bodyCountOfWorkerMesh\(run\.mesh\)\)/);
  assert.equal(/geom\.bodyCount === 0/.test(APP), false);
  assert.match(open, /resolveAssemblyOpenName\(requested, names\)/);
  assert.match(open, /if \(decision\?\.error\) return \{ error: decision\.error \}/);
  assert.match(
    open,
    /const opened = await handleOpenVaultAssembly\(openName\);\s*if \(opened\?\.status === 'error'\) \{\s*return \{ error:/,
  );
  const createIdx = create.indexOf('agentRunOutcome(text)');
  const earlyReturn = create.indexOf('if (!runScript) return');
  assert.ok(earlyReturn >= 0 && earlyReturn < createIdx);
});

test('picking a new part and resolving a missing name do not call the git adapter', async () => {
  const gh = createMockGithubAdapter({ login: 'agent-host' });
  const before = gh._log.length;
  const created = createdPartFromDocs(
    { activeId: 'old', parts: [{ id: 'old' }] },
    { activeId: 'old', parts: [{ id: 'old' }, { id: 'new-part' }] },
  );
  assert.equal(created.id, 'new-part');
  assert.equal(scriptRequestsRun('return 1;\n'), true);
  const missing = resolveAssemblyOpenName('does-not-exist', ['Bracket']);
  assert.equal(missing.error.code, 'not_found');
  const ambiguous = resolveAssemblyOpenName('WIDGET', ['Widget', 'widget']);
  assert.equal(ambiguous.error.code, 'ambiguous');
  assert.equal(gh._log.length, before);
  assert.equal(gh._log.some((row) => row.op === 'commitFiles' || row.op === 'createRepo'), false);
});
