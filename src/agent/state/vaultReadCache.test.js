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
import { assemblyFilePath, assemblyPartPath } from '../../utils/git/vaultLayout.js';
import { stringifySurfJson } from '../../utils/git/surfJson.js';
import { listVaultAssemblies, openVaultAssembly } from '../../utils/git/gitWorkspace.js';
import { resolveAssemblyOpenName } from './openAssemblyName.js';
import { cacheVaultReads } from './vaultReadCache.js';

const BRACKET = assemblyPartPath('Gearbox', 'Bracket');
const HOUSING = assemblyPartPath('Housing', 'Pin');
const SEED_SCRIPT = 'return Manifold.cube([10,10,10], true);';

function assemblyDoc(name, partPath, partName) {
  return {
    source: 'git',
    name,
    activeId: partPath,
    parts: [{ id: partPath, name: partName, visible: true, order: 0 }],
  };
}

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(assemblyDoc('Gearbox', BRACKET, 'Bracket'))),
      fileWrite(BRACKET, SEED_SCRIPT),
      fileWrite(assemblyFilePath('Housing'), stringifySurfJson(assemblyDoc('Housing', HOUSING, 'Pin'))),
      fileWrite(HOUSING, SEED_SCRIPT),
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
  const opened = await openVaultAssembly(adapter, repo, 'Gearbox', {
    branch: 'main',
    headSha,
  });
  return { names, opened };
}

test('a cached name lookup adds no tree or marker read beyond the open itself', async () => {
  const openOnly = await seedVault();
  const openCounts = countReads(openOnly.gh);
  await openVaultAssembly(openCounts.wrapped, openOnly.repo, 'Gearbox', {
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

  // Uncached lookup is the pre-fix cost: one marker read and two tree
  // listings on top of the open (detect + the second list).
  assert.equal(plainCounts.counts.surfcad, openCounts.counts.surfcad + 1);
  assert.equal(plainCounts.counts.listTree, openCounts.counts.listTree + 2);

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
