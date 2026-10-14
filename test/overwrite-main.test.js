/**
 * Overwrite main writes the queued local files onto a moved tip.
 * A normal flush still refuses. Mock adapter, no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../src/utils/git/syncWorker.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import { captureBaseline, isWorkspaceDirty } from '../src/utils/git/gitWorkspace.js';
import { stringifySurfJson } from '../src/utils/git/surfJson.js';
import { applyOverwriteFiles, forceMergeCommit } from '../src/utils/git/gitCommit.js';
import { partRowGitChrome } from '../src/utils/git/gitAssemblyRename.js';

const BRACKET = assemblyPartPath('Gearbox', 'Bracket');
const BOLT = sharedPartPath('M3 bolt');
const LOCAL = 'return Manifold.cube([12,12,12], true); // local\n';
const REMOTE_BRACKET = 'return Manifold.cube([1,1,1], true); // remote\n';
const REMOTE_BOLT = 'return Manifold.cylinder(8, 1.5, 1.5, 24); // remote bolt\n';
const SEED_BRACKET = 'return Manifold.cube([10,10,10], true);\n';
const SEED_BOLT = 'return Manifold.cylinder(6, 1.5, 1.5, 24);\n';

describe('Overwrite main', () => {
  test('a conflict, then Overwrite main, then main contains the local content', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const doc = {
      source: 'git',
      name: 'Gearbox',
      activeId: BRACKET,
      parts: [
        { id: BRACKET, name: 'Bracket', visible: true, order: 0 },
        { id: BOLT, name: 'M3 bolt', visible: true, order: 1 },
      ],
    };
    const seeded = await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: 'seed',
      baseSha: vault.headSha,
      files: [
        fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(doc)),
        fileWrite(BRACKET, SEED_BRACKET),
        fileWrite(BOLT, SEED_BOLT),
      ],
    });
    const store = createSyncStore({ persist: false });
    await store.ready();
    await store.setLastSyncedSha(vault.repo, seeded.sha, 'main');
    await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: 'remote edit',
      baseSha: seeded.sha,
      files: [
        fileWrite(BRACKET, REMOTE_BRACKET),
        fileWrite(BOLT, REMOTE_BOLT),
      ],
    });
    await store.enqueue(vault.repo, {
      op: 'save',
      branch: 'main',
      message: 'local bracket',
      partIds: [BRACKET],
      files: [fileWrite(BRACKET, LOCAL)],
    });

    const conflict = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
    });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.syncHold, true);
    assert.equal((await gh.readFile(vault.repo, BRACKET, 'main')).content, REMOTE_BRACKET);
    assert.equal((await gh.readFile(vault.repo, BOLT, 'main')).content, REMOTE_BOLT);
    assert.equal(store.pending(vault.repo, 'main').length, 1);

    const overwritten = await flushSyncQueue({
      store, adapter: gh, repo: vault.repo, branch: 'main', online: true, force: true,
    });
    assert.equal(overwritten.status, 'synced');
    assert.equal((await gh.readFile(vault.repo, BRACKET, 'main')).content, LOCAL);
    assert.equal((await gh.readFile(vault.repo, BOLT, 'main')).content, REMOTE_BOLT);
    assert.equal(store.pending(vault.repo, 'main').length, 0);
    assert.equal(store.getLastSyncedSha(vault.repo, 'main'), overwritten.sha);
    const slot = `${vault.repo.owner}/${vault.repo.name}\0main\0${BRACKET}`;
    assert.equal(store.partStates()[slot], undefined);

    const applied = applyOverwriteFiles(
      doc,
      { [BRACKET]: REMOTE_BRACKET, [BOLT]: REMOTE_BOLT },
      overwritten.files,
    );
    assert.equal(applied.scripts[BRACKET], LOCAL);
    assert.equal(applied.scripts[BOLT], REMOTE_BOLT);
    const baseline = captureBaseline({
      assemblyPath: assemblyFilePath('Gearbox'),
      assemblyName: 'Gearbox',
      doc: applied.doc,
      scripts: applied.scripts,
      branch: 'main',
      headSha: overwritten.sha,
    });
    assert.equal(isWorkspaceDirty(applied.doc, applied.scripts, baseline), false);
    assert.equal(partRowGitChrome({
      sync: store.partStates()[slot] || null,
      contentDirty: false,
    }).dirty, false);

    const direct = await forceMergeCommit(gh, vault.repo, {
      branch: 'main',
      message: 'overwrite again',
      doc,
      scripts: { [BRACKET]: `${LOCAL}// again\n`, [BOLT]: REMOTE_BOLT },
      baseline,
    });
    assert.equal(direct.status, 'committed');
    assert.equal((await gh.readFile(vault.repo, BRACKET, 'main')).content, `${LOCAL}// again\n`);
    assert.equal((await gh.readFile(vault.repo, BOLT, 'main')).content, REMOTE_BOLT);

    const feed = readFileSync(new URL('../src/components/PartFeed.jsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.match(feed, /onOverwriteMain\?\.?\(/);
    assert.match(feed, /data-git-conflict-overwrite/);
    assert.doesNotMatch(feed, /Sync will not overwrite the remote repo/);
    assert.match(app, /force:\s*true/);
    assert.match(app, /onOverwriteMain=\{handleOverwriteMain\}/);
  });
});
