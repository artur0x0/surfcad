import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyMissingOnBranchCopy, assemblyMissingOnBranchError, findAssemblyOnBranch } from './assemblyOnBranch.js';
import { assemblyIdPath } from './idPaths.js';

const BOX_MAIN = '2026-11-02-13-16-54-0296-d5c6';
const BOX_SIDE = '2026-10-20-09-00-00-0001-aaaa';
const OTHER = '2026-10-21-09-00-00-0002-bbbb';

/** A tiny read-only adapter: files per branch. */
function fakeAdapter(branches) {
  return {
    kind: 'fake',
    async listTree(repo, ref) {
      return Object.keys(branches[ref] || {}).map((path) => ({ path, sha: path }));
    },
    async readFile(repo, path, ref) {
      const content = branches[ref]?.[path];
      return content == null ? null : { content };
    },
    async getBranch() { return { sha: 'x' }; },
    async listBranches() { return Object.keys(branches).map((name) => ({ name })); },
    async createBranch() {},
    async commitFiles() {},
    async writeFile() {},
    async deleteFile() {},
    async getRepo() { return { owner: 'o', name: 'r' }; },
    async getViewer() { return { login: 'o' }; },
    async createRepo() { return { owner: 'o', name: 'r' }; },
    async deleteBranch() {},
    async readBlob() { return null; },
    async compare() { return { aheadBy: 0, behindBy: 0 }; },
    async squashMerge() { return { sha: 'x' }; },
  };
}

const repo = { owner: 'o', name: 'r' };
const doc = (id, name) => JSON.stringify({ id, name, v: 2, parts: [] });

test('an assembly saved under a different id on the branch is found by name', async () => {
  const adapter = fakeAdapter({
    main: { [assemblyIdPath(BOX_MAIN)]: doc(BOX_MAIN, 'Fillet box') },
    side: { [assemblyIdPath(BOX_SIDE)]: doc(BOX_SIDE, 'fillet BOX ') },
  });
  const found = await findAssemblyOnBranch(adapter, repo, { name: 'Fillet box', branch: 'side' });
  assert.deepEqual(found, { id: BOX_SIDE });
});

test('a branch without the assembly reports what it does have, by name', async () => {
  const adapter = fakeAdapter({
    main: { [assemblyIdPath(BOX_MAIN)]: doc(BOX_MAIN, 'Fillet box') },
    side: { [assemblyIdPath(OTHER)]: doc(OTHER, 'Gearbox'), 'parts/2026-10-20-09-00-00-0003-cccc.js': 'return part;' },
    bare: { 'parts/2026-10-20-09-00-00-0003-cccc.js': 'return part;' },
  });
  const onSide = await findAssemblyOnBranch(adapter, repo, { name: 'Fillet box', branch: 'side' });
  assert.deepEqual(onSide, { missing: true, available: ['Gearbox'] });
  const onBare = await findAssemblyOnBranch(adapter, repo, { name: 'Fillet box', branch: 'bare' });
  assert.deepEqual(onBare, { missing: true, available: [] });
});

test('the copy names the assembly and the branch, never an id', () => {
  assert.equal(
    assemblyMissingOnBranchCopy('Fillet box', 'surfcad/fillet-box-2026-11-02', ['Gearbox', 'Cover']),
    'Fillet box is not on surfcad/fillet-box-2026-11-02. That branch has Gearbox, Cover. Stay here, or open one of those.',
  );
  assert.equal(
    assemblyMissingOnBranchCopy('Fillet box', 'old', []),
    'Fillet box is not on old, and that branch has no assemblies. Stay here, or pick another branch.',
  );
  const err = assemblyMissingOnBranchError('Fillet box', 'old', ['Gearbox']);
  assert.equal(err.code, 'assembly_missing_on_branch');
  assert.deepEqual(err.available, ['Gearbox']);
  assert.equal(err.message.includes(BOX_MAIN), false);
});
