/**
 * open_assembly lists assembly names, then opens. Those two passes must
 * share the tree and the marker read. The lookup adds no extra listTree
 * or surfcad.json read beyond what opening alone already does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileWrite } from '../../utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter } from '../../utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../utils/git/vault.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../../utils/git/idPaths.js';
import { listVaultAssemblies, openVaultAssembly } from '../../utils/git/gitWorkspace.js';
import { resolveAssemblyOpenName } from './openAssemblyName.js';
import { cacheVaultReads } from './vaultReadCache.js';

const GEARBOX = '2026-10-22-05-00-00-0001-aa01';
const HOUSING_ID = '2026-10-22-05-00-00-0002-bb02';
const BRACKET = '2026-10-22-05-00-00-0003-cc03';
const PIN = '2026-10-22-05-00-00-0004-dd04';
const SEED_SCRIPT = 'return Manifold.cube([10,10,10], true);';
const MARKER = `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`;

function assemblyFile(id, name, partId, partName) {
  return `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 2,
    id,
    name,
    activeId: partId,
    parts: [{ id: partId, name: partName, visible: true, order: 0 }],
  }, null, 2)}\n`;
}

function partFile(id, name) {
  return `// @surf-id ${id}\n// @name ${name}\n${SEED_SCRIPT}\n`;
}

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite('surfcad.json', MARKER),
      fileWrite(assemblyIdPath(GEARBOX), assemblyFile(GEARBOX, 'Gearbox', BRACKET, 'Bracket')),
      fileWrite(partIdPath(BRACKET), partFile(BRACKET, 'Bracket')),
      fileWrite(assemblyIdPath(HOUSING_ID), assemblyFile(HOUSING_ID, 'Housing', PIN, 'Pin')),
      fileWrite(partIdPath(PIN), partFile(PIN, 'Pin')),
    ],
  });
  return { gh, repo: vault.repo, seedSha: seed.sha };
}

function countReads(adapter) {
  const counts = { listTree: 0, readFile: 0, surfcad: 0, commitFiles: 0 };
  const wrapped = { ...adapter };
  wrapped.listTree = async (...args) => {
    counts.listTree += 1;
    return adapter.listTree(...args);
  };
  wrapped.readFile = async (...args) => {
    counts.readFile += 1;
    if (args[1] === 'surfcad.json') counts.surfcad += 1;
    return adapter.readFile(...args);
  };
  wrapped.commitFiles = async (...args) => {
    counts.commitFiles += 1;
    return adapter.commitFiles(...args);
  };
  return { wrapped, counts };
}

async function listThenOpen(adapter, repo, headSha) {
  const names = await listVaultAssemblies(adapter, repo, 'main');
  const opened = await openVaultAssembly(adapter, repo, GEARBOX, {
    branch: 'main',
    headSha,
  });
  return { names, opened };
}

test('a cached name lookup adds no tree or marker read beyond the open itself', async () => {
  const openOnly = await seedVault();
  const openCounts = countReads(openOnly.gh);
  await openVaultAssembly(openCounts.wrapped, openOnly.repo, GEARBOX, {
    branch: 'main',
    headSha: openOnly.seedSha,
  });

  const plain = await seedVault();
  const plainCounts = countReads(plain.gh);
  const plainListed = await listThenOpen(plainCounts.wrapped, plain.repo, plain.seedSha);

  const cached = await seedVault();
  const cachedCounts = countReads(cached.gh);
  const wrapped = cacheVaultReads(cachedCounts.wrapped);
  const listed = await listThenOpen(wrapped, cached.repo, cached.seedSha);

  assert.deepEqual(listed.names, ['Gearbox', 'Housing']);
  assert.equal(listed.opened.doc.name, 'Gearbox');
  assert.equal(plainListed.names.length, 2);

  // Uncached lookup reads the marker and the tree once more than the open.
  assert.equal(plainCounts.counts.surfcad, openCounts.counts.surfcad + 1);
  assert.equal(plainCounts.counts.listTree, openCounts.counts.listTree + 1);

  // Cached lookup reuses those reads. It does not add one.
  assert.equal(cachedCounts.counts.surfcad, openCounts.counts.surfcad);
  assert.ok(cachedCounts.counts.listTree <= openCounts.counts.listTree);
  assert.equal(cachedCounts.counts.listTree, 1);
  assert.equal(cachedCounts.counts.surfcad, 1);
  assert.equal(cachedCounts.counts.commitFiles, 0);
  assert.equal(plainCounts.counts.commitFiles, 0);
});

test('a cached lookup still reports not_found and ambiguous without a write', async () => {
  const { gh, repo } = await seedVault();
  const { wrapped, counts } = countReads(gh);
  const names = await listVaultAssemblies(cacheVaultReads(wrapped), repo, 'main');
  const missing = resolveAssemblyOpenName('does-not-exist', names);
  assert.equal(missing.error.code, 'not_found');
  assert.deepEqual(missing.error.details.assemblies, ['Gearbox', 'Housing']);
  const ambiguous = resolveAssemblyOpenName('WIDGET', ['Widget', 'widget']);
  assert.equal(ambiguous.error.code, 'ambiguous');
  assert.deepEqual(ambiguous.error.details.matches, ['Widget', 'widget']);
  assert.equal(counts.commitFiles, 0);
});

test('a failed vault read is not cached and a different ref is a miss', async () => {
  let trees = 0;
  let files = 0;
  const adapter = {
    async listTree(_repo, ref) {
      trees += 1;
      if (trees === 1) throw new Error('tree failed');
      return [{ path: 'assemblies/Gearbox/.surf.json', type: 'blob', sha: ref }];
    },
    async readFile(_repo, path, ref) {
      files += 1;
      if (path === 'missing') return null;
      return { path, content: ref || '', sha: 'abc' };
    },
  };
  const cached = cacheVaultReads(adapter);
  const repo = { owner: 'artur', name: 'surfcad-vault' };
  await assert.rejects(() => cached.listTree(repo, 'main'), /tree failed/);
  const first = await cached.listTree(repo, 'main');
  const second = await cached.listTree(repo, 'main');
  const other = await cached.listTree(repo, 'abc123');
  assert.equal(trees, 3);
  assert.equal(first[0].sha, 'main');
  assert.equal(second[0].sha, 'main');
  assert.equal(other[0].sha, 'abc123');
  assert.notEqual(first, second);

  const missing = await cached.readFile(repo, 'missing', 'main');
  const missingAgain = await cached.readFile(repo, 'missing', 'main');
  const otherRef = await cached.readFile(repo, 'missing', 'other');
  assert.equal(missing, null);
  assert.equal(missingAgain, null);
  assert.equal(otherRef, null);
  assert.equal(files, 2);
});

test('a write through the wrapper drops the cache before it delegates', async () => {
  let trees = 0;
  const adapter = {
    async listTree() {
      trees += 1;
      return [{ path: `p${trees}`, type: 'blob', sha: 's' }];
    },
    async writeFile() { return true; },
    async deleteFile() { return true; },
    async commit() { return true; },
  };
  const cached = cacheVaultReads(adapter);
  const repo = { owner: 'artur', name: 'surfcad-vault' };
  await cached.listTree(repo, 'main');
  await cached.listTree(repo, 'main');
  assert.equal(trees, 1);
  for (const write of ['writeFile', 'deleteFile', 'commit']) {
    await cached[write]();
    const again = await cached.listTree(repo, 'main');
    assert.equal(again[0].path, `p${trees}`);
  }
  assert.equal(trees, 4);

  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const racing = cacheVaultReads({
    async listTree() {
      reads += 1;
      if (reads === 1) await hold;
      return [{ path: `t${reads}`, type: 'blob', sha: 's' }];
    },
    async commitFiles() { return { sha: 'c' }; },
  });
  const pending = racing.listTree(repo, 'main');
  await new Promise((resolve) => setTimeout(resolve, 20));
  await racing.commitFiles(repo, {});
  release();
  const first = await pending;
  const second = await racing.listTree(repo, 'main');
  assert.equal(first[0].path, 't1');
  assert.equal(second[0].path, 't2');
  assert.equal(reads, 2);
});

test('a concurrent save during the open sees fresh reads', async () => {
  const seeded = await seedVault();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let parked = false;
  const live = { ...seeded.gh };
  live.listTree = async (...args) => {
    const result = await seeded.gh.listTree(...args);
    if (!parked) {
      parked = true;
      await hold;
    }
    return result;
  };
  const { wrapped, counts } = countReads(live);
  const cached = cacheVaultReads(wrapped);
  const opening = listThenOpen(cached, seeded.repo, seeded.seedSha);
  const started = Date.now();
  while (!parked) {
    if (Date.now() - started > 2000) throw new Error('open did not reach listTree');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const savedPath = 'assemblies/Gearbox/Saved.js';
  const committed = await seeded.gh.commitFiles(seeded.repo, {
    branch: 'main',
    message: 'user save',
    baseSha: seeded.seedSha,
    files: [fileWrite(savedPath, 'return 2;\n')],
  });
  const saveTree = await seeded.gh.listTree(seeded.repo, 'main');
  const saveFile = await seeded.gh.readFile(seeded.repo, savedPath, 'main');
  assert.equal(saveTree.some((row) => row.path === savedPath), true);
  assert.match(saveFile.content, /return 2/);

  release();
  const opened = await opening;
  assert.equal(opened.opened.doc.name, 'Gearbox');
  assert.equal(counts.listTree, 1);
  assert.equal(counts.surfcad, 1);

  const cachedTree = await cached.listTree(seeded.repo, 'main');
  assert.equal(cachedTree.some((row) => row.path === savedPath), false);
  assert.equal(counts.listTree, 1);

  await cached.commitFiles(seeded.repo, {
    branch: 'main',
    message: 'wrapper write',
    baseSha: committed.sha,
    files: [fileWrite('assemblies/Gearbox/Later.js', 'return 3;\n')],
  });
  const after = await cached.listTree(seeded.repo, 'main');
  assert.equal(after.some((row) => row.path === savedPath), true);
  assert.equal(after.some((row) => row.path === 'assemblies/Gearbox/Later.js'), true);
  assert.equal(counts.listTree, 2);
  assert.equal(counts.commitFiles, 1);
});

test('an unchanged tip adds no tree or marker read', async () => {
  const seeded = await seedVault();
  const { wrapped, counts } = countReads(seeded.gh);
  const tip = (await wrapped.getBranch(seeded.repo, 'main')).sha;
  const cached = cacheVaultReads(wrapped, { branch: 'main', tip });
  await listThenOpen(cached, seeded.repo, tip);
  const again = await cached.getBranch(seeded.repo, 'main');
  assert.equal(again.sha, tip);
  await cached.listTree(seeded.repo, tip);
  await cached.readFile(seeded.repo, 'surfcad.json', tip);
  assert.equal(counts.listTree, 1);
  assert.equal(counts.surfcad, 1);
  assert.equal(counts.commitFiles, 0);
});

test('a tip that moves between the lookup and the open uses the new tree', async () => {
  const seeded = await seedVault();
  const { wrapped, counts } = countReads(seeded.gh);
  const tip = (await wrapped.getBranch(seeded.repo, 'main')).sha;
  const cached = cacheVaultReads(wrapped, { branch: 'main', tip });
  const names = await listVaultAssemblies(cached, seeded.repo, 'main');
  assert.deepEqual(names, ['Gearbox', 'Housing']);
  assert.equal(counts.listTree, 1);

  const meshPath = partMeshIdPath(BRACKET);
  const moved = await seeded.gh.commitFiles(seeded.repo, {
    branch: 'main',
    message: 'push a mesh',
    baseSha: tip,
    files: [
      fileWrite(partIdPath(BRACKET), `// @surf-id ${BRACKET}\n// @name Bracket\nreturn 9;\n`),
      fileWrite(meshPath, Uint8Array.from([1, 2, 3])),
    ],
  });
  const stale = await cached.listTree(seeded.repo, 'main');
  assert.equal(stale.some((row) => row.path === meshPath), false);
  assert.equal(counts.listTree, 1);

  const live = await cached.getBranch(seeded.repo, 'main');
  assert.equal(live.sha, moved.sha);
  assert.notEqual(live.sha, tip);
  const opened = await openVaultAssembly(cached, seeded.repo, GEARBOX, {
    branch: 'main',
    headSha: live.sha,
  });
  assert.ok(Object.values(opened.scripts).some((text) => String(text).includes('return 9')));
  assert.ok(opened.assets[meshPath]?.bytes instanceof Uint8Array);
  assert.equal(counts.listTree, 2);
  assert.equal(counts.surfcad, 2);
});
