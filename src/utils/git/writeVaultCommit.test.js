/**
 * save-model v2 PR 5: writeVaultCommit. Mock GitHub only — no network.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitAdapterError, fileWrite } from './githubAdapterInterface.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';
import { createSpyGithubAdapter, spyCalls } from './spyGithubAdapter.js';
import { findOrCreateVault } from './vault.js';
import { listVaultBranches } from './gitBranch.js';
import { checkRemoteBehind, reloadFromRemote } from './gitPull.js';
import { openVaultAssembly } from './gitWorkspace.js';
import { captureLastCommit } from './lastCommit.js';
import { createSyncStore } from './syncStore.js';
import { flushSyncQueue } from './syncWorker.js';
import { assemblyFilePath, assemblyPartPath } from './vaultLayout.js';
import { stringifySurfJson } from './surfJson.js';
import {
  SURFCAD_JSON_V2,
  vaultV2SeedFiles,
  writeVaultCommit,
} from './writeVaultCommit.js';

const REPO = { owner: 'artur', name: 'surfcad-vault' };
const ASM = 'Gearbox';
const ASM_PATH = assemblyFilePath(ASM);
const PART_PATH = assemblyPartPath(ASM, 'Bracket');
const SEED_SCRIPT = 'return Manifold.cube([10,10,10], true);';

function userFiles() {
  return [{ path: 'parts/2026-10-18-00-00-00-0001-aa01.js', content: 'return 1;' }];
}

test('vault v2 seed has no README and writes version 2', () => {
  const paths = vaultV2SeedFiles().map((file) => file.path);
  assert.deepEqual(paths, ['surfcad.json', 'assemblies/.gitkeep', 'parts/.gitkeep']);
  assert.equal(paths.includes('README.md'), false);
  assert.equal(vaultV2SeedFiles()[0].content, SURFCAD_JSON_V2);
  assert.match(SURFCAD_JSON_V2, /"kind": "surfcad-vault"/);
  assert.match(SURFCAD_JSON_V2, /"version": 2/);
});

test('writeVaultCommit passes baseSha and branch through', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const spy = createSpyGithubAdapter(inner);
  const result = await writeVaultCommit({
    adapter: spy,
    repo: vault.repo,
    branch: vault.defaultBranch,
    baseSha: vault.headSha,
    message: 'Save bracket',
    files: userFiles(),
  });
  assert.equal(typeof result.sha, 'string');
  assert.equal(result.sha.length, 40);
  const commits = spyCalls(spy, 'commitFiles');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].opts.branch, vault.defaultBranch);
  assert.equal(commits[0].opts.baseSha, vault.headSha);
  assert.equal(commits[0].opts.message, 'Save bracket');
  assert.deepEqual(commits[0].opts.files.map((file) => file.path), userFiles().map((file) => file.path));
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
});

test('seed retry: createRepo ok, commit fails, retry is one seed and no duplicate', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  let failOnce = true;
  const spy = createSpyGithubAdapter(inner, {
    commitFiles: async (repo, opts, base) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('seed commit failed');
      }
      return base.commitFiles(repo, opts);
    },
  });

  await assert.rejects(
    () => writeVaultCommit({
      adapter: spy,
      repo: REPO,
      branch: 'main',
      baseSha: null,
      message: 'Save',
      files: userFiles(),
      create: true,
    }),
    /seed commit failed/,
  );

  assert.equal(spyCalls(spy, 'createRepo').length, 1);
  assert.equal(spyCalls(spy, 'commitFiles').length, 1);
  assert.equal(await inner.getRepo(REPO) != null, true);
  assert.equal(await inner.getBranch(REPO, 'main'), null);

  const result = await writeVaultCommit({
    adapter: spy,
    repo: REPO,
    branch: 'main',
    baseSha: null,
    message: 'Save',
    files: userFiles(),
    create: true,
  });

  assert.equal(spyCalls(spy, 'createRepo').length, 1);
  const commits = spyCalls(spy, 'commitFiles');
  assert.equal(commits.length, 2);
  const seeded = commits[1].opts.files;
  const paths = seeded.map((file) => file.path);
  assert.equal(paths.filter((path) => path === 'surfcad.json').length, 1);
  assert.equal(paths.filter((path) => path === 'assemblies/.gitkeep').length, 1);
  assert.equal(paths.filter((path) => path === 'parts/.gitkeep').length, 1);
  assert.equal(paths.includes('README.md'), false);
  assert.ok(paths.includes(userFiles()[0].path));
  assert.equal(seeded.filter((file) => file.path === 'surfcad.json')[0].content, SURFCAD_JSON_V2);
  assert.equal(typeof result.sha, 'string');

  const tree = await inner.listTree(REPO, 'main');
  const treePaths = tree.map((entry) => entry.path).sort();
  assert.equal(treePaths.includes('README.md'), false);
  assert.ok(treePaths.includes('surfcad.json'));
  assert.ok(treePaths.includes('assemblies/.gitkeep'));
  assert.ok(treePaths.includes('parts/.gitkeep'));
  const marker = await inner.readFile(REPO, 'surfcad.json', 'main');
  assert.equal(marker.content, SURFCAD_JSON_V2);
});

test('first Save seeds v2 files in the same commit as the assembly files', async () => {
  const spy = createSpyGithubAdapter(createMockGithubAdapter({ login: 'artur' }));
  const result = await writeVaultCommit({
    adapter: spy,
    repo: REPO,
    branch: 'main',
    baseSha: null,
    message: 'Save Gearbox',
    files: userFiles(),
    create: true,
  });
  assert.equal(spyCalls(spy, 'createRepo').length, 1);
  const commits = spyCalls(spy, 'commitFiles');
  assert.equal(commits.length, 1);
  assert.deepEqual(
    commits[0].opts.files.map((file) => file.path),
    ['surfcad.json', 'assemblies/.gitkeep', 'parts/.gitkeep', userFiles()[0].path],
  );
  assert.equal(commits[0].opts.seed, true);
  assert.equal(commits[0].opts.branch, 'main');
  assert.equal(commits[0].opts.baseSha, null);
  assert.equal(typeof result.sha, 'string');
});

test('create:false never createRepo and does not add seed files', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const spy = createSpyGithubAdapter(inner);
  await writeVaultCommit({
    adapter: spy,
    repo: vault.repo,
    branch: vault.defaultBranch,
    baseSha: vault.headSha,
    message: 'Add part',
    files: userFiles(),
  });
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
  const commit = spyCalls(spy, 'commitFiles')[0];
  assert.equal(commit.opts.branch, vault.defaultBranch);
  assert.equal(commit.opts.baseSha, vault.headSha);
  assert.deepEqual(commit.opts.files.map((file) => file.path), [userFiles()[0].path]);
  assert.equal(commit.opts.seed, undefined);
});

test('marker present: retry does not recreate or reseed', async () => {
  const spy = createSpyGithubAdapter(createMockGithubAdapter({ login: 'artur' }));
  const first = await writeVaultCommit({
    adapter: spy,
    repo: REPO,
    branch: 'main',
    baseSha: null,
    message: 'Save',
    files: userFiles(),
    create: true,
  });
  const again = await writeVaultCommit({
    adapter: spy,
    repo: REPO,
    branch: 'main',
    baseSha: first.sha,
    message: 'Save again',
    files: [{ path: 'parts/extra.js', content: '2' }],
    create: true,
  });
  assert.equal(spyCalls(spy, 'createRepo').length, 1);
  const commits = spyCalls(spy, 'commitFiles');
  assert.equal(commits.length, 2);
  assert.equal(commits[1].opts.baseSha, first.sha);
  assert.deepEqual(commits[1].opts.files.map((file) => file.path), ['parts/extra.js']);
  assert.equal(typeof again.sha, 'string');
  assert.ok(commits[0].opts.files.some((file) => file.path === 'surfcad.json'));
});

test('spy adapter records compare', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const spy = createSpyGithubAdapter(inner);
  const compared = await spy.compare(vault.repo, vault.headSha, vault.headSha);
  assert.equal(compared.status, 'identical');
  const rows = spyCalls(spy, 'compare');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].base, vault.headSha);
  assert.equal(rows[0].head, vault.headSha);
});

test('create:false on an empty repo does not seed (main refusal stays)', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  await inner.createRepo({ name: 'empty-vault', private: true, description: 'leftover' });
  const repo = { owner: 'artur', name: 'empty-vault' };
  const looked = await findOrCreateVault(inner, { name: 'empty-vault', create: false });
  assert.equal(looked.status, 'not-a-vault');

  const spy = createSpyGithubAdapter(inner);
  await writeVaultCommit({
    adapter: spy,
    repo,
    branch: 'main',
    baseSha: null,
    message: 'Save',
    files: userFiles(),
  });
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
  const commit = spyCalls(spy, 'commitFiles')[0];
  assert.deepEqual(commit.opts.files.map((file) => file.path), [userFiles()[0].path]);
  assert.equal(commit.opts.seed, undefined);
});

test('create:true on a whole-empty repo seeds without createRepo', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  await inner.createRepo({ name: 'empty-vault', private: true, description: 'leftover' });
  const repo = { owner: 'artur', name: 'empty-vault' };
  const spy = createSpyGithubAdapter(inner);
  const result = await writeVaultCommit({
    adapter: spy,
    repo,
    branch: 'main',
    baseSha: null,
    message: 'Save',
    files: userFiles(),
    create: true,
  });
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
  const commits = spyCalls(spy, 'commitFiles');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].opts.seed, true);
  assert.deepEqual(
    commits[0].opts.files.map((file) => file.path),
    ['surfcad.json', 'assemblies/.gitkeep', 'parts/.gitkeep', userFiles()[0].path],
  );
  assert.equal(typeof result.sha, 'string');
});

test('marked default + missing target throws and does not seed', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const spy = createSpyGithubAdapter(inner);
  await assert.rejects(
    () => writeVaultCommit({
      adapter: spy,
      repo: vault.repo,
      branch: 'feature',
      baseSha: null,
      message: 'Save',
      files: userFiles(),
      create: true,
    }),
    (err) => {
      assert.ok(err instanceof GitAdapterError);
      assert.equal(err.code, 'invalid');
      assert.match(err.message, /Branch feature is missing/);
      assert.match(err.message, /Refusing to seed/);
      return true;
    },
  );
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
  assert.equal(spyCalls(spy, 'commitFiles').length, 0);
  const marker = await inner.readFile(vault.repo, 'surfcad.json', 'main');
  assert.ok(marker);
  assert.match(marker.content, /"version": 1/);
});

test('createRepo refuses when repo.owner is not the signed-in user', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const spy = createSpyGithubAdapter(inner);
  await assert.rejects(
    () => writeVaultCommit({
      adapter: spy,
      repo: { owner: 'someone-else', name: 'surfcad-vault' },
      branch: 'main',
      baseSha: null,
      message: 'Save',
      files: userFiles(),
      create: true,
    }),
    (err) => {
      assert.ok(err instanceof GitAdapterError);
      assert.equal(err.code, 'invalid');
      assert.match(err.message, /signed-in user \(artur\)/);
      return true;
    },
  );
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
  assert.equal(spyCalls(spy, 'commitFiles').length, 0);
  assert.equal(await inner.getRepo({ owner: 'someone-else', name: 'surfcad-vault' }), null);
  assert.equal(await inner.getRepo(REPO), null);
});

test('createRepo owner check is case-insensitive', async () => {
  const spy = createSpyGithubAdapter(createMockGithubAdapter({ login: 'artur' }));
  const result = await writeVaultCommit({
    adapter: spy,
    repo: { owner: 'ArTur', name: 'Case-Vault' },
    branch: 'main',
    baseSha: null,
    message: 'Save',
    files: userFiles(),
    create: true,
  });
  assert.equal(spyCalls(spy, 'createRepo').length, 1);
  assert.equal(spyCalls(spy, 'createRepo')[0].opts.name, 'Case-Vault');
  assert.equal(typeof result.sha, 'string');
});

test('create:false does not turn seed on just because files include the marker', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const spy = createSpyGithubAdapter(inner);
  await writeVaultCommit({
    adapter: spy,
    repo: vault.repo,
    branch: vault.defaultBranch,
    baseSha: vault.headSha,
    message: 'Add marker',
    files: [{ path: 'surfcad.json', content: SURFCAD_JSON_V2 }, ...userFiles()],
  });
  const commit = spyCalls(spy, 'commitFiles')[0];
  assert.equal(commit.opts.seed, undefined);
  assert.deepEqual(
    commit.opts.files.map((file) => file.path),
    ['surfcad.json', userFiles()[0].path],
  );
});

test('explicit seed:true without create passes the flag and does not merge v2 seed', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const spy = createSpyGithubAdapter(inner);
  await writeVaultCommit({
    adapter: spy,
    repo: vault.repo,
    branch: vault.defaultBranch,
    baseSha: vault.headSha,
    message: 'Create SurfCAD vault',
    files: userFiles(),
    seed: true,
  });
  const commit = spyCalls(spy, 'commitFiles')[0];
  assert.equal(commit.opts.seed, true);
  assert.deepEqual(commit.opts.files.map((file) => file.path), [userFiles()[0].path]);
});

test('load, reload, online, and connect paths do not commitFiles or createRepo', async () => {
  const inner = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(inner);
  const seeded = await inner.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed gearbox',
    baseSha: vault.headSha,
    files: [
      fileWrite(ASM_PATH, stringifySurfJson({
        source: 'git',
        name: ASM,
        activeId: PART_PATH,
        parts: [{ id: PART_PATH, name: 'Bracket', visible: true, order: 0 }],
      })),
      fileWrite(PART_PATH, SEED_SCRIPT),
    ],
  });
  const spy = createSpyGithubAdapter(inner);

  const loaded = await findOrCreateVault(spy, { create: false });
  assert.equal(loaded.status, 'found');
  const opened = await openVaultAssembly(spy, vault.repo, ASM, {
    branch: 'main',
    headSha: seeded.sha,
  });
  await reloadFromRemote(spy, vault.repo, {
    path: opened.assemblyPath || ASM_PATH,
    kind: 'assembly',
    branch: 'main',
    scripts: opened.scripts,
    baseline: opened.baseline,
  });
  const store = createSyncStore({ persist: false });
  const flushed = await flushSyncQueue({
    store,
    adapter: spy,
    repo: vault.repo,
    branch: 'main',
    online: true,
  });
  assert.equal(flushed.status, 'idle');
  await captureLastCommit({
    adapter: spy,
    repo: vault.repo,
    branch: 'main',
    headSha: seeded.sha,
  });
  await checkRemoteBehind(spy, vault.repo, {
    branch: 'main',
    baselineSha: seeded.sha,
    assemblyPath: ASM_PATH,
  });
  await listVaultBranches(spy, vault.repo, { current: 'main' });

  assert.equal(spyCalls(spy, 'commitFiles').length, 0);
  assert.equal(spyCalls(spy, 'createRepo').length, 0);
});
