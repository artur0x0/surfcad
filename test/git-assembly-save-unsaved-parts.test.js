/**
 * Assembly Save (UI Save and agent git_save) is never blocked by unsaved
 * parts. One commit writes assemblies/<Assembly>/<name>.js plus .surf.json.
 * Mock / fake git only. No dialog, no parts/, no auto-save.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../src/utils/git/syncWorker.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import { parseSurfJson, validateSurfJson } from '../src/utils/git/surfJson.js';
import {
  assembleCommitFiles,
  commitWorkspace,
  firstCommitBaseline,
} from '../src/utils/git/gitCommit.js';
import { gitSaveCommand } from '../src/agent/commands/git.js';

const ASM = 'Kettle-MCP';
const BODY_ID = '5f0c3c1e-0000-4000-8000-000000000001';
const BODY_NAME = 'Kettle Body';
const BODY = assemblyPartPath(ASM, BODY_NAME);
const SURF = assemblyFilePath(ASM);

function unsavedDoc() {
  return {
    source: 'git',
    name: ASM,
    activeId: BODY_ID,
    parts: [{
      id: BODY_ID,
      name: BODY_NAME,
      visible: true,
      order: 0,
      isSynced: false,
    }],
  };
}

function unsavedScripts() {
  return { [BODY_ID]: '// Kettle Body\nreturn Manifold.cube([40, 40, 30], true);\n' };
}

function commitsAfterSeed(gh) {
  return gh._log.filter((row) => row.op === 'commitFiles');
}

function assertSingleAssemblySave(gh, writesBefore, result) {
  assert.equal(result.status, 'committed', result.error);
  const writes = commitsAfterSeed(gh).slice(writesBefore);
  assert.equal(writes.length, 1, JSON.stringify(writes.map((row) => row.sha)));
  const files = (writes[0].paths || writes[0].files || []).map((file) => file.path || file).sort();
  assert.deepEqual(files, [SURF, BODY].sort());
  assert.equal(files.some((path) => path.startsWith('parts/')), false);
}

test('UI Save with a brand-new unsaved part is one assembly-folder commit', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const writesBefore = commitsAfterSeed(gh).length;
  const doc = unsavedDoc();
  const scripts = unsavedScripts();
  const planned = await assembleCommitFiles(gh, vault.repo, {
    doc,
    scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  assert.equal(planned.status, 'ready');
  assert.deepEqual(planned.partIds, [BODY_ID]);
  assert.equal(planned.doc.parts[0].id, BODY_ID);
  assert.equal(planned.doc.parts[0].path, BODY);
  assert.equal(planned.files.some((file) => file.path.startsWith('parts/')), false);

  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, vault.headSha, 'main');
  await store.enqueue(vault.repo, {
    op: 'save',
    branch: 'main',
    message: planned.message,
    partIds: planned.partIds,
    files: planned.files,
  });
  const flushed = await flushSyncQueue({
    store,
    adapter: gh,
    repo: vault.repo,
    branch: 'main',
    online: true,
  });
  assert.equal(flushed.status, 'synced');
  assertSingleAssemblySave(gh, writesBefore, { status: 'committed' });
  assert.deepEqual(flushed.partIds, [BODY_ID]);

  const raw = JSON.parse((await gh.readFile(vault.repo, SURF, 'main')).content);
  assert.equal(validateSurfJson(raw).ok, true, validateSurfJson(raw).errors?.join('; '));
  assert.equal(raw.parts[0].id, BODY_ID);
  assert.equal(raw.parts[0].path, BODY);
  assert.equal((await gh.readFile(vault.repo, BODY, 'main')).content, scripts[BODY_ID]);
});

test('agent git_save after consent is the same one-commit assembly save', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const writesBefore = commitsAfterSeed(gh).length;
  const doc = unsavedDoc();
  const scripts = unsavedScripts();
  let saveCalls = 0;
  const ctx = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitSave: async ({ message }) => {
      saveCalls += 1;
      return commitWorkspace(gh, vault.repo, {
        doc,
        scripts,
        baseline: firstCommitBaseline({ headSha: vault.headSha }),
        message,
      });
    },
  };
  const out = await gitSaveCommand.run(ctx, { message: 'Save Kettle' });
  assert.equal(saveCalls, 1);
  assert.equal(out.result?.status || out.status, 'committed');
  assertSingleAssemblySave(gh, writesBefore, { status: 'committed' });
  const reopened = parseSurfJson((await gh.readFile(vault.repo, SURF, 'main')).content);
  assert.equal(reopened.parts[0].id, BODY_ID);
  assert.equal(reopened.parts[0].path, BODY);
});

test('agent git_save before consent writes nothing', async () => {
  let called = false;
  const out = await gitSaveCommand.run({
    readAgentGitAdapterKind: () => 'real',
    readAgentGitRealOptIn: () => false,
    readAgentGitSessionDenied: () => false,
    readAgentGitWriteTarget: () => ({ repo: 'o/r', branch: 'main' }),
    promptAgentGitWriteConsent: () => 'shown',
    agentGitSave: async () => {
      called = true;
      return { status: 'committed' };
    },
  }, { message: 'Save Kettle' });
  assert.equal(out.error?.code, 'consent_pending');
  assert.equal(called, false);
});

test('Save is not blocked by unsaved parts and shows no extra dialog', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  const commitStart = app.indexOf('const handleGitCommit');
  const commitEnd = app.indexOf('const absorbOverwriteFiles');
  assert.ok(commitStart >= 0 && commitEnd > commitStart);
  const commit = app.slice(commitStart, commitEnd);
  assert.match(commit, /assembleCommitFiles/);
  assert.equal(/PATH_LESS_PARTS/.test(commit), false);
  assert.equal(/unsaved parts|Save parts first|Add to Repo first|runAddStrayToRepo/.test(commit), false);
  assert.equal(/setCommitFlow|setLeaveGuard/.test(commit), false);
  assert.match(app, /async agentGitSave\(\{ message \}\) \{[\s\S]*?return handleGitCommit\(draft\);/);

  assert.match(feed, /data-git-save=""/);
  assert.match(feed, /onClick=\{startCommit\}/);
  assert.match(app, /canCommit=\{assemblyDoc\?\.source === 'git' && !!sourceDirty/);
  assert.equal(
    /unsaved parts|Save parts first|Add parts to the repo before|runAddStrayToRepo/.test(feed),
    false,
  );
});
