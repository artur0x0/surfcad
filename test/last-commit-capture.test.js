/**
 * save-model v2 PR 3: persist BranchTip + AssemblyCommit from open/tip.
 * Capture is read-only. lastCommit is advisory.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import { stringifySurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId } from '../src/utils/git/surfId.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../src/utils/git/idPaths.js';
import { openVaultAssembly } from '../src/utils/git/gitWorkspace.js';
import { lastCommitBlobSources } from '../src/utils/git/legacyVault/index.js';
import {
  createAssemblyOpenController,
  runTrackedAssemblyOpen,
} from '../src/utils/assemblyOpenOverlay.js';
import {
  LAST_COMMIT_SCHEMA_VERSION,
  captureLastCommit,
  lastCommitIsStale,
  lastCommitReloadPlan,
  makeAssemblyCommit,
  makeBranchTip,
  parseAssemblyCommit,
  parseBranchTip,
  scheduleLastCommitAfterAdopt,
  scheduleLastCommitCapture,
  scheduleLastCommitFromApp,
} from '../src/utils/git/lastCommit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASM_ID = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const PART_ID = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'bb02' });
const NOW = 1_700_000_000_000;
const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const WRITE_OPS = ['commitFiles', 'createRepo', 'createBranch', 'deleteBranch', 'squashMerge'];

function v2Json() {
  return {
    format: 'surfcad.assembly',
    version: 2,
    id: ASM_ID,
    name: 'Gearbox',
    activeId: PART_ID,
    parts: [{
      id: PART_ID,
      name: 'Bracket',
      visible: true,
      order: 0,
    }],
  };
}

function v2Text() {
  return `${JSON.stringify(v2Json(), null, 2)}\n`;
}

function v1Doc() {
  const path = assemblyPartPath('Gearbox', 'Bracket');
  return {
    source: 'git',
    name: 'Gearbox',
    activeId: PART_ID,
    parts: [{
      id: PART_ID,
      path,
      name: 'Bracket',
      visible: true,
      order: 0,
      surfId: PART_ID,
    }],
  };
}

function wrapWrites(adapter) {
  const originals = Object.fromEntries(
    WRITE_OPS.map((op) => [op, adapter[op].bind(adapter)]),
  );
  const counts = Object.fromEntries(WRITE_OPS.map((op) => [op, 0]));
  for (const op of WRITE_OPS) {
    adapter[op] = async () => {
      counts[op] += 1;
      throw new Error(`lastCommit capture must not ${op}`);
    };
  }
  counts.restore = () => {
    for (const op of WRITE_OPS) adapter[op] = originals[op];
  };
  return counts;
}

async function shaMap(adapter, repo, ref = 'main') {
  const tree = await adapter.listTree(repo, ref);
  return new Map(tree.map((row) => [row.path, row.sha]));
}

function seedV2(gh) {
  const mesh = new Uint8Array([1, 2, 3, 4]);
  const repo = gh._seedRepo({
    name: 'surfcad-vault',
    files: {
      'surfcad.json': JSON.stringify({ kind: 'surfcad-vault', version: 2 }),
      'README.md': '# leftover\n',
      [assemblyIdPath(ASM_ID)]: v2Text(),
      [partIdPath(PART_ID)]: `// @surf-id ${PART_ID}\n// @name Bracket\nreturn 1;\n`,
      [partMeshIdPath(PART_ID)]: mesh,
    },
  });
  return { repo: { owner: repo.owner, name: repo.name }, mesh };
}

function installFakeIndexedDB() {
  const dbs = new Map();
  function sortedEntries(table) {
    return [...table.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }
  function request(fill) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        fill(req);
        req.onsuccess?.(undefined);
      } catch (err) {
        req.error = err;
        req.onerror?.(undefined);
      }
    });
    return req;
  }
  globalThis.indexedDB = {
    open(name) {
      const req = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        let db = dbs.get(name);
        const upgrade = !db;
        if (!db) {
          db = {
            kv: new Map(),
            outbox: new Map(),
          };
          dbs.set(name, db);
        }
        const tables = {
          kv: db.kv,
          outbox: db.outbox,
        };
        const names = new Set(['kv', 'outbox']);
        req.result = {
          objectStoreNames: { contains: (store) => names.has(store) },
          onversionchange: null,
          close() {},
          createObjectStore(store) { names.add(store); return {}; },
          transaction(storeName) {
            const table = tables[storeName];
            const tx = { oncomplete: null, onabort: null, onerror: null };
            const store = {
              getAll: () => request((r) => { r.result = sortedEntries(table).map((row) => row[1]); }),
              getAllKeys: () => request((r) => { r.result = sortedEntries(table).map((row) => row[0]); }),
              get: (key) => request((r) => { r.result = table.get(key); }),
              put: (value, key) => request(() => {
                if (key === undefined) table.set(value.id, value);
                else table.set(key, value);
              }),
              delete: (key) => request(() => { table.delete(key); }),
              clear: () => request(() => { table.clear(); }),
            };
            tx.objectStore = () => store;
            setTimeout(() => { tx.oncomplete?.(undefined); }, 0);
            return tx;
          },
        };
        if (upgrade) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name) {
      dbs.delete(name);
      const req = { onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

test('source stays read-only: no git writes, no vault create, no v1 parse', () => {
  const src = readFileSync(join(ROOT, 'src/utils/git/lastCommit.js'), 'utf8');
  for (const needle of [
    'adapter.commitFiles',
    'adapter.createRepo',
    'findOrCreateVault(',
    'ensureGitVault(',
    'stringifySurfJson(',
    'parseVaultPath',
    'assemblyFilePathCandidates',
    "from './vaultLayout.js'",
  ]) {
    assert.equal(src.includes(needle), false, `lastCommit.js must not use ${needle}`);
  }
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const openStart = app.indexOf('const handleOpenVaultAssembly =');
  const openEnd = app.indexOf('openVaultAssemblyRef.current = handleOpenVaultAssembly');
  const open = app.slice(openStart, openEnd);
  assert.match(open, /adoptVaultOpening/);
  assert.match(open, /scheduleLastCommitFromApp/);
  assert.equal(/await scheduleLastCommitFromApp/.test(open), false);
  assert.equal(/scheduleLastCommitAfterAdopt/.test(app), false);
  assert.equal(/lastCommitReloadPlan/.test(app), false);
  assert.equal(/lastCommitBlobSources/.test(app), false);
  const adoptAt = open.indexOf('await adoptVaultOpening');
  const captureAt = open.indexOf('scheduleLastCommitFromApp');
  assert.ok(adoptAt >= 0 && captureAt > adoptAt, 'capture runs after adopt, unawaited');
  assert.equal(/assemblyRef\.current\?\.id/.test(open), false);
  assert.equal(/\bsignal\b/.test(open.slice(captureAt, captureAt + 280)), false, 'open must not pass overlay signal');
  const reloadAt = app.indexOf('const workingCopyId = doc.id');
  assert.ok(reloadAt > 0);
  const reloadCall = app.indexOf('scheduleLastCommitFromApp', reloadAt);
  assert.ok(reloadCall > reloadAt);
  assert.match(app.slice(reloadCall, reloadCall + 280), /reload:\s*true/);
});

test('parseBranchTip requires a 40-hex sha; invalid putBranchTip is a no-op', async () => {
  assert.equal(parseBranchTip(null), null);
  assert.equal(parseBranchTip({ schemaVersion: 1 }), null);
  assert.equal(parseBranchTip({
    schemaVersion: 2,
    repo: { owner: 'a', name: 'b' },
    branch: 'main',
    tipSha: null,
  }), null);
  assert.equal(parseBranchTip({
    schemaVersion: 1,
    repo: { owner: 'a', name: 'b' },
    branch: 'main',
    tipSha: 'not-a-sha',
  }), null);
  assert.equal(parseBranchTip({
    schemaVersion: 1,
    repo: { owner: 'a', name: 'b' },
    branch: 'main',
    tipSha: 'abcd',
  }), null);
  assert.deepEqual(parseBranchTip({
    schemaVersion: 1,
    repo: { owner: 'a', name: 'b' },
    branch: 'main',
    tipSha: SHA,
  }), {
    schemaVersion: 1,
    repo: { owner: 'a', name: 'b' },
    branch: 'main',
    tipSha: SHA,
  });
  assert.equal(parseBranchTip({
    schemaVersion: 1,
    repo: { owner: 'a', name: 'b' },
    branch: 'main',
    tipSha: null,
  }).tipSha, null);

  const store = createSyncStore({ persist: false });
  await store.ready();
  const repo = { owner: 'a', name: 'b' };
  const valid = makeBranchTip({ repo, branch: 'main', tipSha: SHA });
  assert.deepEqual(await store.putBranchTip(repo, 'main', valid), valid);
  assert.equal(await store.putBranchTip(repo, 'main', { nope: true }), null);
  assert.deepEqual(store.getBranchTip(repo, 'main'), valid);
  assert.equal(parseAssemblyCommit({
    schemaVersion: 1,
    assemblyId: ASM_ID,
    files: { [partIdPath(PART_ID)]: { contentHash: 'short' } },
    json: null,
    capturedAt: NOW,
  }), null);
  assert.equal(parseAssemblyCommit({
    schemaVersion: 1,
    assemblyId: 'Gearbox',
    files: {},
    json: null,
    capturedAt: NOW,
  }), null);
});

test('capture on a v2 tip stores BranchTip + AssemblyCommit hashes', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  const writes = wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const shas = await shaMap(gh, repo);

  const captured = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: true,
    now: NOW,
  });

  assert.equal(writes.commitFiles, 0);
  assert.equal(writes.createRepo, 0);
  assert.deepEqual(captured.branchTip, {
    schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
    repo: { owner: 'artur', name: 'surfcad-vault' },
    branch: 'main',
    tipSha: tip,
  });
  assert.equal(captured.assemblyCommit.assemblyId, ASM_ID);
  assert.equal(captured.assemblyCommit.capturedAt, NOW);
  assert.equal(captured.assemblyCommit.json.id, ASM_ID);
  assert.equal(captured.assemblyCommit.json.version, 2);
  assert.equal(captured.assemblyCommit.json.parts[0].path, undefined);
  const files = captured.assemblyCommit.files;
  assert.equal(files[assemblyIdPath(ASM_ID)].contentHash, shas.get(assemblyIdPath(ASM_ID)));
  assert.equal(files[partIdPath(PART_ID)].contentHash, shas.get(partIdPath(PART_ID)));
  assert.equal(files[partMeshIdPath(PART_ID)].contentHash, shas.get(partMeshIdPath(PART_ID)));
  assert.equal(files['README.md'], undefined);
  assert.deepEqual(store.getBranchTip(repo, 'main'), captured.branchTip);
  assert.deepEqual(store.getAssemblyCommit(repo, 'main', ASM_ID), captured.assemblyCommit);
});

test('v1 capture keys files by f(id) from lastCommitBlobSources', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const doc = v1Doc();
  const script = `// @surf-id ${PART_ID}\n// @name Bracket\nreturn 1;\n`;
  const asmPath = assemblyFilePath('Gearbox');
  const partPath = assemblyPartPath('Gearbox', 'Bracket');
  const meshPath = partPath.replace(/\.js$/i, '.mesh');
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed gearbox',
    baseSha: vault.headSha,
    files: [
      fileWrite(asmPath, stringifySurfJson(doc)),
      fileWrite(partPath, script),
      fileWrite(meshPath, new Uint8Array([9, 8, 7])),
    ],
  });
  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  const store = createSyncStore({ persist: false });
  await store.ready();
  wrapWrites(gh);

  const opened = await openVaultAssembly(gh, vault.repo, 'Gearbox', { branch: 'main' });
  assert.ok(opened.doc?.id, 'PR 2 mints an assembly id');
  const sources = lastCommitBlobSources(opened);
  assert.equal(sources[assemblyIdPath(opened.doc.id)], opened.assemblyPath);
  assert.equal(sources[partIdPath(PART_ID)], partPath);
  assert.equal(sources[partMeshIdPath(PART_ID)], meshPath);

  const first = await captureLastCommit({
    adapter: gh,
    repo: vault.repo,
    branch: 'main',
    store,
    assemblyId: opened.doc.id,
    headSha: opened.baseline.headSha,
    blobSources: sources,
    persistBranchTip: true,
    now: NOW,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore);
  assert.equal(first.branchTip.tipSha, opened.baseline.headSha);
  assert.equal(first.assemblyCommit.assemblyId, opened.doc.id);
  assert.equal(first.assemblyCommit.json, null, 'v1 committed json is not stored as v2');
  const files = first.assemblyCommit.files;
  assert.equal(files[asmPath], undefined);
  assert.equal(files[partPath], undefined);
  assert.ok(files[assemblyIdPath(opened.doc.id)]?.contentHash);
  assert.ok(files[partIdPath(PART_ID)]?.contentHash);
  assert.ok(files[partMeshIdPath(PART_ID)]?.contentHash);

  const restored = store.getAssemblyCommit(vault.repo, 'main', opened.doc.id);
  assert.deepEqual(restored.files, first.assemblyCommit.files);
});

test('path-less capture does not throw and does not guess the tree', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const out = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: true,
    now: NOW,
  });
  assert.equal(out.assemblyCommit.assemblyId, ASM_ID);
  assert.ok(out.assemblyCommit.files[partIdPath(PART_ID)]);

  const skipped = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: '',
    headSha: tip,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    now: NOW,
  });
  assert.equal(skipped.assemblyCommit, null);
  assert.equal(store.getAssemblyCommit(repo, 'main', ASM_ID).assemblyId, ASM_ID);
});

test('getBranch and listTree failures leave existing records unchanged', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const first = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: true,
    now: NOW,
  });
  const beforeTip = store.getBranchTip(repo, 'main');
  const beforeCommit = store.getAssemblyCommit(repo, 'main', ASM_ID);

  const getBranch = gh.getBranch.bind(gh);
  gh.getBranch = async () => {
    throw new Error('getBranch failed');
  };
  const failedBranch = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    persistBranchTip: true,
    persistAssemblyCommit: true,
    now: NOW + 1,
  });
  assert.equal(failedBranch.skipped, 'getBranch');
  assert.deepEqual(store.getBranchTip(repo, 'main'), beforeTip);
  assert.deepEqual(store.getAssemblyCommit(repo, 'main', ASM_ID), beforeCommit);

  gh.getBranch = getBranch;
  gh.listTree = async () => {
    throw new Error('listTree failed');
  };
  const failedTree = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    persistBranchTip: true,
    persistAssemblyCommit: true,
    now: NOW + 2,
  });
  assert.equal(failedTree.skipped, 'listTree');
  assert.deepEqual(store.getBranchTip(repo, 'main'), beforeTip);
  assert.deepEqual(store.getAssemblyCommit(repo, 'main', ASM_ID), beforeCommit);
  assert.equal(first.branchTip.tipSha, tip);
});

test('opening a second assembly does not move a valid BranchTip', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip1 = (await gh.getBranch(repo, 'main')).sha;
  const writes = wrapWrites(gh);
  await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip1,
    persistBranchTip: 'if-absent',
    now: NOW,
  });
  assert.equal(writes.commitFiles, 0);

  const otherId = mintSurfId({ now: new Date('2026-10-18T02:51:00.000Z'), rand: 'cc03' });
  writes.restore();
  await gh.commitFiles(repo, {
    branch: 'main',
    message: 'unrelated',
    baseSha: tip1,
    files: [fileWrite('README.md', '# moved\n')],
  });
  const tip2 = (await gh.getBranch(repo, 'main')).sha;
  assert.notEqual(tip2, tip1);

  await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: otherId,
    headSha: tip2,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    now: NOW + 10,
  });
  assert.equal(store.getBranchTip(repo, 'main').tipSha, tip1);
});

test('dirty working copy plus moved remote: reload does not advance the tip', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip1 = (await gh.getBranch(repo, 'main')).sha;
  const writes = wrapWrites(gh);
  await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip1,
    persistBranchTip: true,
    now: NOW,
  });
  assert.equal(writes.commitFiles, 0);
  const dirtyWorkingCopy = { id: ASM_ID, name: 'Gearbox', parts: [{ id: PART_ID, name: 'edited' }] };
  writes.restore();
  await gh.commitFiles(repo, {
    branch: 'main',
    message: 'remote moved',
    baseSha: tip1,
    files: [fileWrite('README.md', '# remote\n')],
  });
  const tip2 = (await gh.getBranch(repo, 'main')).sha;
  assert.notEqual(tip2, tip1);

  const plan = lastCommitReloadPlan(store, repo, 'main', dirtyWorkingCopy.id);
  assert.equal(plan.skip, true);
  assert.equal(plan.persistBranchTip, false);
  assert.equal(plan.persistAssemblyCommit, false);

  await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip2,
    persistBranchTip: plan.persistBranchTip,
    persistAssemblyCommit: plan.persistAssemblyCommit,
    now: NOW + 5,
  });
  assert.equal(store.getBranchTip(repo, 'main').tipSha, tip1);
  assert.equal(store.getAssemblyCommit(repo, 'main', ASM_ID).capturedAt, NOW);
});

test('a capture failure leaves open and reload working', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const good = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    persistBranchTip: true,
    now: NOW,
  });

  gh.getBranch = () => new Promise(() => {});
  gh.listTree = () => new Promise(() => {});

  let adopted = false;
  const openResult = await (async () => {
    adopted = true;
    const pending = scheduleLastCommitCapture({
      adapter: gh,
      repo,
      branch: 'main',
      store,
      assemblyId: ASM_ID,
      persistBranchTip: true,
      persistAssemblyCommit: true,
      timeoutMs: 40,
    });
    assert.equal(adopted, true);
    await pending;
    return { status: 'opened', id: ASM_ID };
  })();
  assert.equal(openResult.status, 'opened');
  assert.equal(store.getBranchTip(repo, 'main').tipSha, good.branchTip.tipSha);
  assert.deepEqual(
    store.getAssemblyCommit(repo, 'main', ASM_ID).files,
    good.assemblyCommit.files,
  );

  const cancelled = { stop: false };
  const reload = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    persistBranchTip: true,
    persistAssemblyCommit: true,
    timeoutMs: 40,
    isStale: () => cancelled.stop,
  });
  assert.ok(reload.skipped === 'getBranch' || reload.skipped === 'stale' || reload.error);
  cancelled.stop = true;
  const afterCancel = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    persistBranchTip: true,
    persistAssemblyCommit: true,
    isStale: () => true,
  });
  assert.equal(afterCancel.skipped, 'stale');
  assert.equal(store.getBranchTip(repo, 'main').tipSha, good.branchTip.tipSha);
});

test('rekeyRepo moves lastCommit maps and rewrites BranchTip.repo', async () => {
  const store = createSyncStore({ persist: false });
  await store.ready();
  const from = { owner: 'artur', name: 'surfcad' };
  const to = { owner: 'artur', name: 'surfcad-vault' };
  const tip = makeBranchTip({ repo: from, branch: 'main', tipSha: SHA });
  const commit = makeAssemblyCommit({
    assemblyId: ASM_ID,
    files: { [assemblyIdPath(ASM_ID)]: { contentHash: SHA } },
    json: null,
    capturedAt: NOW,
  });
  await store.putBranchTip(from, 'main', tip);
  await store.putAssemblyCommit(from, 'main', commit);

  const first = await store.rekeyRepo(from, to);
  assert.ok(first.moved > 0);
  assert.equal(store.getBranchTip(from, 'main'), null);
  assert.deepEqual(store.getBranchTip(to, 'main'), {
    ...tip,
    repo: to,
  });
  assert.deepEqual(store.getAssemblyCommit(to, 'main', ASM_ID), commit);
  assert.equal(store.getAssemblyCommit(from, 'main', ASM_ID), null);

  const second = await store.rekeyRepo(from, to);
  assert.equal(second.moved, 0);
  assert.equal(store.getBranchTip(to, 'main').repo.name, 'surfcad-vault');
});

test('reload restores hashes from IndexedDB through a fresh store instance', async () => {
  installFakeIndexedDB();
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  const writes = wrapWrites(gh);
  const writer = createSyncStore({ persist: true });
  await writer.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const captured = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store: writer,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: true,
    now: NOW,
  });
  assert.equal(writes.commitFiles, 0);
  assert.equal(writer.getBranchTip(repo, 'main').tipSha, tip);

  const reader = createSyncStore({ persist: true });
  await reader.ready();
  const restoredTip = reader.getBranchTip(repo, 'main');
  const restoredCommit = reader.getAssemblyCommit(repo, 'main', ASM_ID);
  assert.deepEqual(restoredTip, captured.branchTip);
  assert.deepEqual(restoredCommit.files, captured.assemblyCommit.files);
  assert.equal(restoredCommit.assemblyId, ASM_ID);

  const plan = lastCommitReloadPlan(reader, repo, 'main', ASM_ID);
  assert.equal(plan.skip, true);

  writes.restore();
  await gh.commitFiles(repo, {
    branch: 'main',
    message: 'moved after persist',
    baseSha: tip,
    files: [fileWrite('README.md', '# later\n')],
  });
  assert.equal(plan.skip, true);
  await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store: reader,
    assemblyId: ASM_ID,
    persistBranchTip: plan.persistBranchTip,
    persistAssemblyCommit: plan.persistAssemblyCommit,
  });
  assert.equal(reader.getBranchTip(repo, 'main').tipSha, tip);

  const other = { owner: 'artur', name: 'other-vault' };
  await reader.rekeyRepo(repo, other);
  const afterRekey = createSyncStore({ persist: true });
  await afterRekey.ready();
  assert.equal(afterRekey.getBranchTip(other, 'main').repo.name, 'other-vault');
  assert.equal(afterRekey.getBranchTip(other, 'main').tipSha, tip);
  assert.equal(afterRekey.getAssemblyCommit(other, 'main', ASM_ID).assemblyId, ASM_ID);
});

test('lastCommitIsStale is only a different repo or branch', () => {
  const repo = { owner: 'artur', name: 'surfcad-vault' };
  assert.equal(lastCommitIsStale({ repo, branch: 'main' }, null), false);
  assert.equal(lastCommitIsStale({ repo, branch: 'main' }, { repo, branch: 'main' }), false);
  assert.equal(lastCommitIsStale({ repo, branch: 'main' }, { repo, branch: 'other' }), true);
  assert.equal(lastCommitIsStale(
    { repo, branch: 'main' },
    { repo: { owner: 'artur', name: 'other' }, branch: 'main' },
  ), true);
});

test('in-tree readFile failure stores no AssemblyCommit', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const first = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: true,
    now: NOW,
  });
  assert.ok(first.assemblyCommit);
  const before = store.getAssemblyCommit(repo, 'main', ASM_ID);

  gh.readFile = async () => {
    throw new Error('readFile failed');
  };
  const failed = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    now: NOW + 1,
  });
  assert.equal(failed.skipped, 'readFile');
  assert.equal(failed.assemblyCommit, null);
  assert.deepEqual(store.getAssemblyCommit(repo, 'main', ASM_ID), before);

  const empty = createSyncStore({ persist: false });
  await empty.ready();
  const timed = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store: empty,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    timeoutMs: 20,
  });
  assert.equal(timed.skipped, 'readFile');
  assert.equal(empty.getAssemblyCommit(repo, 'main', ASM_ID), null);
  assert.ok(empty.getBranchTip(repo, 'main'));
});

test('open helper stores records after overlay finish() the way App does', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const ctrl = createAssemblyOpenController({
    showDelayMs: 0,
    safetyMs: 60_000,
    onChange() {},
  });

  let pending = null;
  let overlaySignal = null;
  await runTrackedAssemblyOpen(ctrl, {
    name: 'Gearbox',
    load: async ({ signal }) => {
      overlaySignal = signal;
      assert.equal(signal(), true, 'overlay signal is true while live');
      const opened = { doc: { id: ASM_ID }, baseline: { headSha: tip } };
      const adopted = { saved: { id: ASM_ID } };
      // App: one line after adopt. Overlay signal is not an arg.
      pending = scheduleLastCommitFromApp({
        adapter: gh,
        repo,
        branch: 'main',
        store,
        opened,
        adopted,
        tip,
        liveSession: () => ({ repo, branch: 'main' }),
        now: NOW,
      });
    },
  });
  assert.equal(typeof overlaySignal, 'function');
  assert.equal(overlaySignal(), false, 'finish() bumped generation');
  await pending;
  assert.equal(store.getBranchTip(repo, 'main').tipSha, tip);
  assert.equal(store.getAssemblyCommit(repo, 'main', ASM_ID).assemblyId, ASM_ID);
});

test('reload helper matches App and throws TDZ if assembly id is inner let doc', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;

  // Outer reload effect: `const doc = assemblyRef.current`
  const outerDoc = { id: ASM_ID, source: 'git', name: 'Gearbox', parts: [] };
  const workingCopyId = outerDoc.id || null;
  const opened = { doc: { id: ASM_ID }, baseline: { headSha: tip } };
  let cancelled = false;
  let pending;
  await (async () => {
    if (cancelled) return;
    // App: one line. Assembly id is opened.doc?.id || workingCopyId, never inner `doc`.
    pending = scheduleLastCommitFromApp({
      adapter: gh,
      repo,
      branch: 'main',
      store,
      opened,
      workingCopyId,
      tip,
      reload: true,
      liveSession: () => ({ repo, branch: 'main' }),
      now: NOW,
    });
    cancelled = true;
    assert.throws(() => {
      // Inner `let doc` is still in the TDZ. Reading it for assembly id must fail.
      return doc?.id;
    }, { name: 'ReferenceError' });
    const aligned = { doc: { id: ASM_ID } };
    let doc = aligned.doc;
    assert.equal(doc.id, workingCopyId);
  })();
  await pending;
  assert.equal(store.getBranchTip(repo, 'main').tipSha, tip);
  assert.equal(store.getAssemblyCommit(repo, 'main', ASM_ID).assemblyId, ASM_ID);
});

test('stalled capture does not roll back a newer AssemblyCommit', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  const tip = (await gh.getBranch(repo, 'main')).sha;
  const T1 = NOW;
  const T2 = NOW + 5_000;

  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  let hung;
  const waitHung = new Promise((resolve) => { hung = resolve; });
  const originalList = gh.listTree.bind(gh);
  let listCalls = 0;
  gh.listTree = async (...args) => {
    listCalls += 1;
    if (listCalls === 1) {
      hung();
      await hang;
    }
    return originalList(...args);
  };

  const first = captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    now: T1,
  });
  await waitHung;
  const second = await captureLastCommit({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    headSha: tip,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    now: T2,
  });
  assert.equal(second.assemblyCommit.capturedAt, T2);
  assert.equal(store.getAssemblyCommit(repo, 'main', ASM_ID).capturedAt, T2);
  release();
  await first;
  assert.equal(
    store.getAssemblyCommit(repo, 'main', ASM_ID).capturedAt,
    T2,
    'T1 must not overwrite the T2 record',
  );
});

test('a newer open of a different branch is stale and stores nothing', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const { repo } = seedV2(gh);
  wrapWrites(gh);
  const store = createSyncStore({ persist: false });
  await store.ready();
  let live = { repo, branch: 'main' };
  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  const originalList = gh.listTree.bind(gh);
  gh.listTree = async (...args) => {
    await hang;
    return originalList(...args);
  };
  const pending = scheduleLastCommitAfterAdopt({
    adapter: gh,
    repo,
    branch: 'main',
    store,
    assemblyId: ASM_ID,
    persistBranchTip: 'if-absent',
    persistAssemblyCommit: true,
    liveSession: () => live,
    now: NOW,
  });
  live = { repo, branch: 'other' };
  release();
  const out = await pending;
  assert.equal(out.skipped, 'stale');
  assert.equal(store.getBranchTip(repo, 'main'), null);
  assert.equal(store.getAssemblyCommit(repo, 'main', ASM_ID), null);
});

