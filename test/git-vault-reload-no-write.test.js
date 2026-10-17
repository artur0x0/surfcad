/**
 * Load / reload / open must never commit, push, or move vault files.
 * Mock adapter only.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../src/utils/git/syncWorker.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import { stringifySurfJson, parseSurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId, withSurfId } from '../src/utils/git/surfId.js';
import { captureBaseline, dirtyPartIds, isWorkspaceDirty, openVaultAssembly } from '../src/utils/git/gitWorkspace.js';
import { rekeyWorkingCopyToTip } from '../src/utils/git/partIdentity.js';
import { readFileSync } from 'node:fs';
import { retireImplicitVaultWriteOps } from '../src/utils/git/vaultImplicitWrite.js';
import { planLayoutMigration } from '../src/utils/git/layoutMigration.js';

const ASM = 'Kettle-MCP';
const BODY = assemblyPartPath(ASM, 'Kettle Body');
const LID = assemblyPartPath(ASM, 'Kettle Lid');
const BODY_ID = mintSurfId({ now: new Date('2026-10-17T00:00:00.000Z'), rand: 'aaaa' });
const LID_ID = mintSurfId({ now: new Date('2026-10-17T00:00:01.000Z'), rand: 'bbbb' });

function kettleDoc() {
  return {
    source: 'git',
    name: ASM,
    activeId: BODY_ID,
    parts: [
      { id: BODY_ID, path: BODY, name: 'Kettle Body', visible: true, order: 0, surfId: BODY_ID },
      { id: LID_ID, path: LID, name: 'Kettle Lid', visible: true, order: 1, surfId: LID_ID },
    ],
  };
}

function commitsAfterSeed(gh) {
  return gh._log.filter((row) => row.op === 'commitFiles');
}

async function seedKettle(gh) {
  const vault = await findOrCreateVault(gh);
  const seedSha = vault.headSha;
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed kettle',
    baseSha: seedSha,
    files: [
      fileWrite(assemblyFilePath(ASM), stringifySurfJson(kettleDoc())),
      fileWrite(BODY, `// @surf-id ${BODY_ID}\nreturn 1;\n`),
      fileWrite(LID, `// @surf-id ${LID_ID}\nreturn 2;\n`),
    ],
  });
  return { vault, seedSha: committed.sha };
}

test('open and reload do not commit or move assembly-folder parts', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const { vault, seedSha } = await seedKettle(gh);
  const writesBefore = commitsAfterSeed(gh).length;

  const first = await openVaultAssembly(gh, vault.repo, ASM, { branch: 'main', headSha: seedSha });
  const second = await openVaultAssembly(gh, vault.repo, ASM, { branch: 'main', headSha: seedSha });

  assert.equal(commitsAfterSeed(gh).length, writesBefore, 'reload must not commit');
  assert.equal((await gh.getBranch(vault.repo, 'main'))?.sha, seedSha);
  const tree = (await gh.listTree(vault.repo, 'main')).map((entry) => entry.path);
  assert.ok(tree.includes(BODY));
  assert.ok(tree.includes(LID));
  assert.equal(tree.some((path) => path.startsWith('parts/') && path.endsWith('.js')), false);
  assert.equal(first.doc.parts[0].id, BODY_ID);
  assert.equal(second.doc.parts[0].id, BODY_ID);
  assert.equal(first.doc.parts[0].path, BODY);
  assert.equal(second.doc.parts[0].path, BODY);
});

test('queued layout/id migrations are retired and flush writes nothing', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const { vault, seedSha } = await seedKettle(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, seedSha, 'main');
  const entries = [
    { path: assemblyFilePath(ASM), content: stringifySurfJson(kettleDoc()) },
    { path: BODY, content: `// @surf-id ${BODY_ID}\nreturn 1;\n` },
    { path: LID, content: `// @surf-id ${LID_ID}\nreturn 2;\n` },
  ];
  const plan = planLayoutMigration(entries);
  assert.equal(plan.changed, true, 'planner would still move to parts/ if allowed');

  await store.enqueue(vault.repo, {
    op: 'migrate-layout',
    branch: 'main',
    message: 'Move parts into parts/',
    partIds: [],
    files: plan.files,
    payload: { kind: 'parts-layout', moves: plan.moves },
  });
  await store.enqueue(vault.repo, {
    op: 'migrate-ids',
    branch: 'main',
    message: 'Keep part ids',
    partIds: [],
    files: [{ path: assemblyFilePath(ASM), content: stringifySurfJson(kettleDoc()) }],
    payload: { kind: 'surf-id-migration' },
  });

  const retired = await retireImplicitVaultWriteOps(store, vault.repo, 'main');
  assert.equal(retired.length, 2);

  const writesBefore = commitsAfterSeed(gh).length;
  const flushed = await flushSyncQueue({
    store,
    adapter: gh,
    repo: vault.repo,
    branch: 'main',
    online: true,
  });
  assert.equal(flushed.status, 'idle');
  assert.equal(commitsAfterSeed(gh).length, writesBefore);
  const tree = (await gh.listTree(vault.repo, 'main')).map((entry) => entry.path);
  assert.ok(tree.includes(BODY));
  assert.equal(tree.includes('parts/Kettle Body.js'), false);
});

test('path-keyed parse does not mint; two parses keep the same ids', () => {
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: ASM,
    activeId: BODY,
    parts: [
      { path: BODY, name: 'Kettle Body', visible: true, order: 0 },
      { path: LID, name: 'Kettle Lid', visible: true, order: 1 },
    ],
  };
  const first = parseSurfJson(raw);
  const second = parseSurfJson(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(first.parts.map((part) => part.id), [BODY, LID]);
  assert.deepEqual(second.parts.map((part) => part.id), [BODY, LID]);
  assert.deepEqual(first.parts.map((part) => part.path), [BODY, LID]);
});

test('id-less .surf.json opened twice keeps the same ids from @surf-id', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: ASM,
    activeId: BODY,
    parts: [
      { path: BODY, name: 'Kettle Body', visible: true, order: 0 },
      { path: LID, name: 'Kettle Lid', visible: true, order: 1 },
    ],
  };
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'legacy path-keyed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath(ASM), `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(BODY, withSurfId('return 1;\n', BODY_ID)),
      fileWrite(LID, withSurfId('return 2;\n', LID_ID)),
    ],
  });
  const writesBefore = commitsAfterSeed(gh).length;
  const first = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: committed.sha,
  });
  const second = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: committed.sha,
  });
  assert.equal(commitsAfterSeed(gh).length, writesBefore);
  assert.deepEqual(first.doc.parts.map((part) => part.id), [BODY_ID, LID_ID]);
  assert.deepEqual(second.doc.parts.map((part) => part.id), [BODY_ID, LID_ID]);
  const onDisk = JSON.parse((await gh.readFile(vault.repo, assemblyFilePath(ASM), 'main')).content);
  assert.equal(onDisk.parts[0].id, undefined);
});

test('id-less .surf.json without headers reuses a local pathIndex', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: ASM,
    activeId: BODY,
    parts: [
      { path: BODY, name: 'Kettle Body', visible: true, order: 0 },
      { path: LID, name: 'Kettle Lid', visible: true, order: 1 },
    ],
  };
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'legacy path-keyed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath(ASM), `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(BODY, 'return 1;\n'),
      fileWrite(LID, 'return 2;\n'),
    ],
  });
  const writesBefore = commitsAfterSeed(gh).length;
  const first = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: committed.sha,
  });
  const pathIndex = Object.fromEntries(
    (first.identities?.cached || []).map((hit) => [hit.path, hit.id]),
  );
  const second = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: committed.sha,
    pathIndex,
  });
  assert.equal(commitsAfterSeed(gh).length, writesBefore);
  assert.deepEqual(second.doc.parts.map((part) => part.id), first.doc.parts.map((part) => part.id));
  assert.notEqual(first.doc.parts[0].id, BODY);
});

test('reload of an old path-keyed browser doc has zero unsaved parts', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const bodyText = withSurfId('return 1;\n', BODY_ID);
  const lidText = withSurfId('return 2;\n', LID_ID);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: ASM,
    activeId: BODY,
    parts: [
      { path: BODY, name: 'Kettle Body', visible: true, order: 0 },
      { path: LID, name: 'Kettle Lid', visible: true, order: 1 },
    ],
  };
  const committed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'legacy path-keyed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath(ASM), `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(BODY, bodyText),
      fileWrite(LID, lidText),
    ],
  });
  const writesBefore = commitsAfterSeed(gh).length;
  const tip = await openVaultAssembly(gh, vault.repo, ASM, {
    branch: 'main',
    headSha: committed.sha,
  });
  const browserDoc = {
    source: 'git',
    name: ASM,
    activeId: BODY,
    parts: [
      { id: BODY, path: BODY, name: 'Kettle Body', visible: true, order: 0 },
      { id: LID, path: LID, name: 'Kettle Lid', visible: true, order: 1 },
    ],
  };
  const browserScripts = { [BODY]: bodyText, [LID]: lidText };
  const aligned = rekeyWorkingCopyToTip(browserDoc, browserScripts, tip.doc);
  assert.deepEqual(aligned.doc.parts.map((part) => part.id), [BODY_ID, LID_ID]);
  const baseline = captureBaseline({
    assemblyPath: tip.assemblyPath,
    assemblyName: ASM,
    doc: tip.doc,
    scripts: tip.scripts,
    branch: 'main',
    headSha: committed.sha,
  });
  assert.equal(dirtyPartIds(aligned.doc, aligned.scripts, baseline).size, 0);
  assert.equal(isWorkspaceDirty(aligned.doc, aligned.scripts, baseline), false);
  assert.equal(commitsAfterSeed(gh).length, writesBefore);
});

test('leftover migrate ops are skipped even without retire', async () => {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const { vault, seedSha } = await seedKettle(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, seedSha, 'main');
  await store.enqueue(vault.repo, {
    op: 'migrate-layout',
    branch: 'main',
    message: 'Move parts into parts/',
    partIds: [],
    files: [
      { path: BODY, delete: true },
      { path: 'parts/Kettle Body.js', content: `// @surf-id ${BODY_ID}\nreturn 1;\n` },
    ],
  });
  const writesBefore = commitsAfterSeed(gh).length;
  const flushed = await flushSyncQueue({
    store,
    adapter: gh,
    repo: vault.repo,
    branch: 'main',
    online: true,
  });
  assert.equal(flushed.status, 'idle');
  assert.equal(commitsAfterSeed(gh).length, writesBefore);
  assert.ok(await gh.readFile(vault.repo, BODY, 'main'));
  assert.equal(await gh.readFile(vault.repo, 'parts/Kettle Body.js', 'main'), null);
});

test('App open/reload/reseed never enqueue or flush a vault write', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.equal(/queueLayoutMigration|queueSurfIdMigration/.test(app), false);
  assert.equal(/op: 'migrate-layout'|op: 'migrate-ids'/.test(app), false);

  const adoptStart = app.indexOf('const adoptVaultOpening');
  const adoptEnd = app.indexOf('const handleOpenVaultAssembly');
  assert.ok(adoptStart >= 0 && adoptEnd > adoptStart);
  const adopt = app.slice(adoptStart, adoptEnd);
  assert.equal(/flushGitOps|flushSyncQueue/.test(adopt), false);
  assert.match(adopt, /retireImplicitVaultWriteOps/);
  assert.match(adopt, /rekeyWorkingCopyToTip/);

  const reseedStart = app.indexOf('// After reload, baseline is gone');
  const reseedEnd = app.indexOf('handleFlushLocalAssembly');
  assert.ok(reseedStart >= 0 && reseedEnd > reseedStart);
  const reseed = app.slice(reseedStart, reseedEnd);
  assert.equal(/flushGitOps|flushSyncQueue|commitFiles|commitWorkspace/.test(reseed), false);
  assert.match(reseed, /reload never writes git/);
  assert.match(reseed, /rekeyWorkingCopyToTip/);
  assert.match(reseed, /bootResume !== 'reauth'/);

  const addStart = app.indexOf('const handleAddPart');
  const addEnd = app.indexOf('const handleDeletePart');
  assert.ok(addStart >= 0 && addEnd > addStart);
  const add = app.slice(addStart, addEnd);
  assert.equal(/fileWrite\(id,/.test(add), false);
  assert.equal(/flushGitOps|prepareAssemblySurfWrite/.test(add), false);

  assert.equal(/setInterval\([\s\S]{0,200}flushGitOps/.test(app), false);
});
