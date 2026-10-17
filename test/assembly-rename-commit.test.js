/**
 * Assembly rename commits on its own. Mock adapter, no network.
 * Must stay free of backend-only deps (mongoose and friends).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { encodeGitHubContentsPath } from '../src/utils/git/githubAdapter.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../src/utils/git/syncWorker.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import { captureBaseline, isWorkspaceDirty, takenAssemblyNames } from '../src/utils/git/gitWorkspace.js';
import { parseSurfJson, stringifySurfJson } from '../src/utils/git/surfJson.js';
import { readSurfId, withSurfId } from '../src/utils/git/surfId.js';
import {
  applyAssemblyRenameCache,
  baselineAfterAssemblyRename,
  partRowGitChrome,
  stageAssemblyRename,
} from '../src/utils/git/gitAssemblyRename.js';

const ID_A = '2026-10-07-20-56-31-0423-a3f9';
const ID_COPY = '2026-10-07-20-56-31-0424-b10c';

function docOf(name, activeId, parts) {
  return {
    source: 'git',
    name,
    activeId,
    parts,
  };
}

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const bracket = sharedPartPath('Bracket');
  const shim = assemblyPartPath('Gearbox', 'Shim');
  const bracketBody = withSurfId('return Manifold.cube([10,10,10], true);\n', ID_A);
  const shimBody = withSurfId('return Manifold.cube([1,1,1], true);\n', ID_COPY);
  const gearbox = docOf('Gearbox', bracket, [
    { id: bracket, name: 'Bracket', visible: true, order: 0, surfId: ID_A },
    { id: shim, name: 'Shim', visible: true, order: 1, surfId: ID_COPY },
  ]);
  const cover = docOf('Cover', bracket, [
    { id: bracket, name: 'Bracket', visible: true, order: 0, surfId: ID_A },
  ]);
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(gearbox)),
      fileWrite(assemblyFilePath('Cover'), stringifySurfJson(cover)),
      fileWrite(bracket, bracketBody),
      fileWrite(shim, shimBody),
    ],
  });
  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, seeded.sha, 'main');
  const scripts = { [bracket]: bracketBody, [shim]: shimBody };
  const baseline = captureBaseline({
    assemblyPath: assemblyFilePath('Gearbox'),
    assemblyName: 'Gearbox',
    doc: gearbox,
    scripts,
    branch: 'main',
    headSha: seeded.sha,
  });
  return {
    gh, vault, store, gearbox, cover, scripts, baseline, bracket, shim, shimBody, bracketBody, seeded,
  };
}

function watchCommits(gh) {
  const seen = [];
  const inner = gh.commitFiles.bind(gh);
  gh.commitFiles = async (repo, opts) => {
    seen.push({ message: opts.message, files: opts.files });
    return inner(repo, opts);
  };
  return seen;
}

describe('assembly rename commit', () => {
  test('a synced rename is one commit that moves the folder and updates .surf.json', async () => {
    const world = await seedVault();
    const { gh, vault, store, gearbox, scripts, baseline, shim, bracket } = world;
    const seen = watchCommits(gh);
    const before = gh._log.filter((entry) => entry.op === 'commitFiles').length;
    const staged = await stageAssemblyRename({
      doc: gearbox,
      scripts,
      nextName: 'Transmission',
      taken: ['Gearbox', 'Cover'],
      repo: vault.repo,
      adapter: gh,
      baseline,
    });
    assert.equal(staged.status, 'staged');
    assert.equal(staged.plan.message, 'Rename assembly Gearbox to Transmission');
    await applyAssemblyRenameCache(store, vault.repo, 'main', staged.plan);
    await store.enqueue(vault.repo, { branch: 'main', ...staged.enqueue });
    const flushed = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
    });
    assert.equal(flushed.status, 'synced');
    assert.equal(flushed.assemblyRenameOnly, true);
    const commits = gh._log.filter((entry) => entry.op === 'commitFiles');
    assert.equal(commits.length, before + 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].message, 'Rename assembly Gearbox to Transmission');
    const paths = seen[0].files.map((file) => file.path);
    assert.ok(paths.includes(assemblyFilePath('Transmission')));
    assert.ok(paths.includes(assemblyFilePath('Gearbox')));
    assert.ok(paths.includes(assemblyPartPath('Transmission', 'Shim')));
    assert.ok(paths.includes(shim));
    assert.equal(paths.includes(bracket), false);
    const deleted = new Set(seen[0].files.filter((file) => file.delete).map((file) => file.path));
    assert.equal(deleted.has(assemblyFilePath('Gearbox')), true);
    assert.equal(deleted.has(shim), true);
    const nextText = (await gh.readFile(vault.repo, assemblyFilePath('Transmission'), 'main')).content;
    const parsed = parseSurfJson(nextText);
    assert.equal(parsed.name, 'Transmission');
    const shimRow = parsed.parts.find((part) => part.surfId === ID_COPY || part.id === ID_COPY);
    const bracketRow = parsed.parts.find((part) => part.surfId === ID_A || part.id === ID_A);
    assert.equal(shimRow.id, ID_COPY);
    assert.equal(shimRow.path, assemblyPartPath('Transmission', 'Shim'));
    assert.equal(bracketRow.id, ID_A);
    assert.equal(bracketRow.path, bracket);
    assert.equal(await gh.readFile(vault.repo, assemblyFilePath('Gearbox'), 'main'), null);
    assert.equal(readSurfId((await gh.readFile(vault.repo, assemblyPartPath('Transmission', 'Shim'), 'main')).content), ID_COPY);
    const finished = baselineAfterAssemblyRename(staged.baseline, staged.doc, staged.scripts, {
      headSha: flushed.sha,
      branch: 'main',
    });
    assert.equal(finished.renamePending, undefined);
    assert.equal(isWorkspaceDirty(staged.doc, staged.scripts, finished), false);
    assert.equal(store.pending(vault.repo, 'main').length, 0);
  });

  test('an offline rename stays queued, shows the dot, and flushes once online', async () => {
    const world = await seedVault();
    const { gh, vault, store, gearbox, scripts, baseline } = world;
    const seen = watchCommits(gh);
    const staged = await stageAssemblyRename({
      doc: gearbox,
      scripts,
      nextName: 'Transmission',
      taken: ['Gearbox', 'Cover'],
      repo: vault.repo,
      adapter: gh,
      baseline,
    });
    await applyAssemblyRenameCache(store, vault.repo, 'main', staged.plan);
    await store.enqueue(vault.repo, { branch: 'main', ...staged.enqueue });
    const offline = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: false,
    });
    assert.equal(offline.status, 'offline');
    assert.equal(seen.length, 0);
    assert.equal(store.pending(vault.repo, 'main').length, 1);
    assert.equal(store.pending(vault.repo, 'main')[0].message, 'Rename assembly Gearbox to Transmission');
    assert.equal(store.pending(vault.repo, 'main')[0].status, 'queued');
    assert.deepEqual(partRowGitChrome({ inflight: true, sync: 'queued', renameHeld: true }), {
      pending: true, dirty: false, syncFailed: false,
    });
    assert.deepEqual(partRowGitChrome({ inflight: false, sync: 'queued', renameHeld: true }), {
      pending: false, dirty: true, syncFailed: false,
    });
    assert.equal(isWorkspaceDirty(staged.doc, staged.scripts, staged.baseline), true);
    assert.equal(await gh.readFile(vault.repo, assemblyFilePath('Gearbox'), 'main') != null, true);

    const online = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
    });
    assert.equal(online.status, 'synced');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].message, 'Rename assembly Gearbox to Transmission');
    assert.equal(store.pending(vault.repo, 'main').length, 0);
    const finished = baselineAfterAssemblyRename(staged.baseline, staged.doc, staged.scripts, {
      headSha: online.sha,
      branch: 'main',
    });
    assert.equal(isWorkspaceDirty(staged.doc, staged.scripts, finished), false);
    assert.deepEqual(partRowGitChrome({ inflight: false, sync: null, renameHeld: false }), {
      pending: false, dirty: false, syncFailed: false,
    });
  });

  test('a push failure keeps the op queued for a later flush', async () => {
    const world = await seedVault();
    const { gh, vault, store, gearbox, scripts, baseline } = world;
    const inner = gh.commitFiles.bind(gh);
    let failed = false;
    gh.commitFiles = async (repo, opts) => {
      if (!failed) {
        failed = true;
        throw new Error('network down');
      }
      return inner(repo, opts);
    };
    const staged = await stageAssemblyRename({
      doc: gearbox,
      scripts,
      nextName: 'Transmission',
      taken: ['Gearbox', 'Cover'],
      repo: vault.repo,
      adapter: gh,
      baseline,
    });
    await store.enqueue(vault.repo, { branch: 'main', ...staged.enqueue });
    const first = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
    });
    assert.equal(first.status, 'failed');
    assert.equal(first.code, 'rename-held');
    assert.equal(store.pending(vault.repo, 'main').length, 1);
    assert.equal(store.pending(vault.repo, 'main')[0].status, 'queued');
    assert.equal(partRowGitChrome({ sync: 'queued', renameHeld: true }).dirty, true);
    const second = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
    });
    assert.equal(second.status, 'synced');
    assert.equal(store.pending(vault.repo, 'main').length, 0);
    assert.equal((await gh.readFile(vault.repo, assemblyFilePath('Transmission'), 'main')) != null, true);
  });

  test('a collision becomes Name (2) and the contents path keeps the parentheses', async () => {
    const world = await seedVault();
    const { gh, vault, store, cover, baseline, bracket, bracketBody } = world;
    const scripts = { [bracket]: bracketBody };
    const coverBase = captureBaseline({
      assemblyPath: assemblyFilePath('Cover'),
      assemblyName: 'Cover',
      doc: cover,
      scripts,
      branch: 'main',
      headSha: baseline.headSha,
    });
    const tree = await gh.listTree(vault.repo, 'main');
    const taken = takenAssemblyNames({ tree, except: 'Cover' });
    const staged = await stageAssemblyRename({
      doc: cover,
      scripts,
      nextName: 'Gearbox',
      taken,
      repo: vault.repo,
      adapter: gh,
      baseline: coverBase,
    });
    assert.equal(staged.status, 'staged');
    assert.equal(staged.name, 'Gearbox (2)');
    assert.equal(staged.plan.message, 'Rename assembly Cover to Gearbox (2)');
    const folder = assemblyFilePath('Gearbox (2)');
    assert.equal(folder, 'assemblies/Gearbox (2)/.surf.json');
    assert.equal(encodeGitHubContentsPath(folder), 'assemblies/Gearbox%20(2)/.surf.json');
    assert.equal(encodeGitHubContentsPath(folder).includes('('), true);
    assert.equal(encodeGitHubContentsPath(folder).includes('%28'), false);
    const seen = watchCommits(gh);
    await store.enqueue(vault.repo, { branch: 'main', ...staged.enqueue });
    const flushed = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
    });
    assert.equal(flushed.status, 'synced');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].message, 'Rename assembly Cover to Gearbox (2)');
    const text = (await gh.readFile(vault.repo, folder, 'main')).content;
    assert.equal(parseSurfJson(text).name, 'Gearbox (2)');
    assert.equal(await gh.readFile(vault.repo, assemblyFilePath('Cover'), 'main'), null);
    assert.equal(await gh.readFile(vault.repo, assemblyFilePath('Gearbox'), 'main') != null, true);
  });

  test('cache rows follow the new folder and a reload does not see the old one', async () => {
    const world = await seedVault();
    const { gh, vault, store, gearbox, scripts, baseline, shim, shimBody, bracket, bracketBody } = world;
    await store.putAssembly(vault.repo, assemblyFilePath('Gearbox'), stringifySurfJson(gearbox));
    await store.putPart(vault.repo, {
      surfId: ID_COPY, path: shim, previousPath: null, content: shimBody,
    });
    await store.rememberPathId(vault.repo, shim, ID_COPY);
    await store.putPart(vault.repo, {
      surfId: ID_A, path: bracket, content: bracketBody,
    });
    await store.rememberPathId(vault.repo, bracket, ID_A);
    await store.putTree(vault.repo, 'main', [
      { path: assemblyFilePath('Gearbox'), content: stringifySurfJson(gearbox) },
      { path: shim, content: shimBody },
      { path: bracket, content: bracketBody },
    ]);
    const staged = await stageAssemblyRename({
      doc: gearbox,
      scripts,
      nextName: 'Transmission',
      taken: ['Gearbox'],
      repo: vault.repo,
      adapter: gh,
      baseline,
    });
    await applyAssemblyRenameCache(store, vault.repo, 'main', staged.plan);
    const nextPath = assemblyFilePath('Transmission');
    const nextShim = assemblyPartPath('Transmission', 'Shim');
    assert.equal(store.getAssembly(vault.repo, assemblyFilePath('Gearbox')), null);
    assert.equal(parseSurfJson(store.getAssembly(vault.repo, nextPath)).name, 'Transmission');
    assert.equal(store.pathIndexFor(vault.repo)[shim], undefined);
    assert.equal(store.pathIndexFor(vault.repo)[nextShim], ID_COPY);
    assert.equal(store.pathIndexFor(vault.repo)[bracket], ID_A);
    assert.equal(store.getPartById(vault.repo, ID_COPY).path, nextShim);
    assert.equal(store.getAlias(vault.repo, shim), ID_COPY);
    const tree = store.getTree(vault.repo, 'main');
    assert.equal(tree.some((entry) => entry.path.startsWith('assemblies/Gearbox/')), false);
    assert.equal(tree.some((entry) => entry.path === nextPath), true);
    assert.equal(parseSurfJson(tree.find((entry) => entry.path === nextPath).content).name, 'Transmission');
  });

  test('an unsynced or local-only assembly renames without a commit', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const local = await stageAssemblyRename({
      doc: { source: 'local', name: 'Assembly', parts: [] },
      scripts: {},
      nextName: 'Widget',
      taken: [],
      repo: vault.repo,
      baseline: null,
    });
    assert.equal(local.status, 'local');
    assert.equal(local.commit, false);
    assert.equal(local.doc.name, 'Widget');

    const unsynced = await stageAssemblyRename({
      doc: {
        source: 'git',
        name: 'Assembly',
        parts: [{ id: 'p1', name: 'Part (1)', visible: true, order: 0, isSynced: false }],
      },
      scripts: { p1: 'return 1;\n' },
      nextName: 'Widget',
      taken: [],
      repo: vault.repo,
      baseline: null,
    });
    assert.equal(unsynced.status, 'local');
    assert.equal(unsynced.commit, false);
    assert.equal(unsynced.doc.name, 'Widget');
    const before = gh._log.filter((entry) => entry.op === 'commitFiles').length;
    assert.equal(gh._log.filter((entry) => entry.op === 'commitFiles').length, before);
  });

  test('an unmarked repo is not written', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const repo = gh._seedRepo({ name: 'plain', files: { 'README.md': 'hi\n' } });
    const store = createSyncStore({ persist: false });
    await store.ready();
    const head = (await gh.getBranch(repo, 'main')).sha;
    await store.setLastSyncedSha(repo, head, 'main');
    await store.enqueue(repo, {
      branch: 'main',
      op: 'rename',
      message: 'Rename assembly Gearbox to Transmission',
      partIds: [],
      payload: {
        kind: 'assembly',
        fromName: 'Gearbox',
        toName: 'Transmission',
        assemblyPath: assemblyFilePath('Transmission'),
        assemblyText: '{}\n',
      },
    });
    const before = gh._log.filter((entry) => entry.op === 'commitFiles').length;
    const flushed = await flushSyncQueue({
      store, adapter: gh, repo, branch: 'main', online: true,
    });
    assert.equal(flushed.status, 'failed');
    assert.equal(flushed.code, 'not_a_vault');
    assert.equal(gh._log.filter((entry) => entry.op === 'commitFiles').length, before);
    assert.equal(store.pending(repo, 'main').length, 1);
    assert.equal(store.pending(repo, 'main')[0].status, 'queued');
  });
});
