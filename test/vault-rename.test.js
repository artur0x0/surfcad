/**
 * Vault rename guards. Mock fetch / in-memory adapter only — no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  defaultVaultName,
  existingUserVaultRecord,
  newUserVaultRecord,
  rememberResolvedVaultName,
} from '../backend/db/vaultNameDefaults.js';
import { deleteResolvedGithubVault } from '../backend/services/githubVaultDelete.js';
import {
  confirmAndRememberVaultName,
  rememberResolvedVaultName as rememberFromService,
  resolveGithubVault,
  storedVaultNameFromUser,
} from '../backend/services/vaultName.js';
import { createGithubAdapter } from '../src/utils/git/githubAdapter.js';
import { GitAdapterError } from '../src/utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../src/utils/git/syncWorker.js';
import {
  DEFAULT_VAULT_NAME,
  findOrCreateVault,
  vaultMarkerContent,
} from '../src/utils/git/vault.js';

const MARKER = vaultMarkerContent();

function sortedPaths(tree) {
  return (tree || []).map((entry) => entry.path).sort();
}

describe('schema default and backfill', () => {
  test('schema default is surfcad-vault for new users only', () => {
    const fresh = newUserVaultRecord({ email: 'new@example.com' });
    assert.equal(typeof defaultVaultName, 'function');
    assert.equal(defaultVaultName.call({ isNew: true }), 'surfcad-vault');
    assert.equal(defaultVaultName.call({ isNew: false }), undefined);
    assert.equal(fresh.vaultName, 'surfcad-vault');
    assert.equal(storedVaultNameFromUser(fresh), 'surfcad-vault');
    assert.equal(rememberFromService, rememberResolvedVaultName);
    const userSrc = readFileSync(new URL('../backend/db/models/User.js', import.meta.url), 'utf8');
    assert.match(userSrc, /import \{ defaultVaultName \} from '\.\.\/vaultNameDefaults\.js'/);
    assert.match(userSrc, /default:\s*defaultVaultName/);
    for (const rel of [
      '../backend/db/vaultNameDefaults.js',
      '../backend/services/vaultName.js',
      '../backend/services/githubVaultDelete.js',
    ]) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /from ['"](?:mongoose|express|bcrypt|connect-mongo)['"]/);
    }
  });

  test('existing users stay unset and backfill does not create a vault', async () => {
    const existing = existingUserVaultRecord({
      _id: '507f1f77bcf86cd799439011',
      email: 'old@example.com',
      authProvider: 'github',
      githubId: '9',
    });
    assert.equal(existing.isNew, false);
    assert.equal(Object.prototype.hasOwnProperty.call(existing, 'vaultName'), false);
    assert.equal(storedVaultNameFromUser(existing), null);

    const stub = githubStub({
      surfcad: { marker: MARKER },
    });
    const resolved = await resolveGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: storedVaultNameFromUser(existing),
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(resolved.action, 'adopt');
    assert.equal(resolved.repo.name, 'surfcad');
    assert.equal(stub.calls.some((call) => call.method === 'POST' || call.method === 'DELETE'), false);

    const first = rememberResolvedVaultName(existing, resolved.repo.name);
    assert.equal(first.changed, true);
    assert.equal(existing.vaultName, 'surfcad');
    const second = rememberResolvedVaultName(existing, resolved.repo.name);
    assert.equal(second.changed, false);
    assert.equal(storedVaultNameFromUser(existing), 'surfcad');

    const again = await resolveGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: storedVaultNameFromUser(existing),
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(again.action, 'adopt');
    assert.equal(again.repo.name, 'surfcad');
    assert.equal(stub.calls.some((call) => call.method === 'POST'), false);
  });

  test('nothing to adopt leaves the field unset and creates nothing', async () => {
    const existing = existingUserVaultRecord({
      _id: '507f1f77bcf86cd799439012',
      email: 'empty@example.com',
      authProvider: 'local',
    });
    const stub = githubStub({});
    const resolved = await resolveGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: storedVaultNameFromUser(existing),
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(resolved.action, 'missing');
    const remembered = rememberResolvedVaultName(existing, '');
    assert.equal(remembered.changed, false);
    assert.equal(storedVaultNameFromUser(existing), null);
    assert.equal(stub.calls.some((call) => call.method !== 'GET'), false);
  });
});

describe('resolution order and write-back', () => {
  test('stored unmarked name falls through to a marked surfcad-vault and is written back', async () => {
    const user = existingUserVaultRecord({
      _id: '507f1f77bcf86cd799439013',
      email: 'stored@example.com',
      authProvider: 'github',
      githubId: '3',
      vaultName: 'widgets',
    });
    const vault = { marker: MARKER, actualName: 'SurfCAD-Vault' };
    const stub = githubStub({
      widgets: { marker: null },
      'surfcad-vault': vault,
      'SurfCAD-Vault': vault,
    });
    const resolved = await resolveGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: storedVaultNameFromUser(user),
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(resolved.action, 'adopt');
    assert.equal(resolved.repo.name, 'SurfCAD-Vault');
    const saved = await confirmAndRememberVaultName(user, {
      accessToken: 'tok',
      owner: 'artur',
      vaultName: resolved.repo.name,
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.changed, true);
    assert.equal(saved.vaultName, 'SurfCAD-Vault');
    const again = rememberResolvedVaultName(user, 'SurfCAD-Vault');
    assert.equal(again.changed, false);
    assert.equal(stub.calls.some((call) => call.method === 'POST' || call.method === 'DELETE'), false);
  });

  test('missing stored name falls through to a marked legacy repo', async () => {
    const stub = githubStub({ surfcad: { marker: MARKER } });
    const resolved = await resolveGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: 'gone-vault',
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(resolved.action, 'adopt');
    assert.equal(resolved.repo.name, 'surfcad');
    assert.equal(stub.calls.some((call) => call.method === 'POST'), false);
  });

  test('unmarked client target is not stored', async () => {
    const user = existingUserVaultRecord({
      _id: '507f1f77bcf86cd799439014',
      email: 'keep@example.com',
      authProvider: 'github',
      githubId: '4',
    });
    const stub = githubStub({ surfcad: { marker: null, commits: true } });
    const saved = await confirmAndRememberVaultName(user, {
      accessToken: 'tok',
      owner: 'artur',
      vaultName: 'surfcad',
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(saved.ok, false);
    assert.equal(saved.code, 'not_a_vault');
    assert.equal(storedVaultNameFromUser(user), null);
  });
});

describe('find-or-create', () => {
  test('the new name exists', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    gh._seedRepo({ name: 'surfcad-vault', files: { 'surfcad.json': MARKER, 'README.md': 'v' } });
    const found = await findOrCreateVault(gh);
    assert.equal(found.status, 'found');
    assert.equal(found.repo.name, 'surfcad-vault');
    assert.equal(gh._log.filter((entry) => entry.op === 'createRepo').length, 0);
  });

  test('only a marked legacy repo exists: adopt, no create', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    gh._seedRepo({ name: 'surfcad', files: { 'surfcad.json': MARKER } });
    const found = await findOrCreateVault(gh);
    assert.equal(found.status, 'found');
    assert.equal(found.repo.name, 'surfcad');
    assert.equal(await gh.getRepo({ owner: 'artur', name: 'surfcad-vault' }), null);
    assert.equal(gh._log.filter((entry) => entry.op === 'createRepo').length, 0);
  });

  test('unmarked legacy repo is not a vault: no seed, no create', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    gh._seedRepo({ name: 'surfcad', files: { 'README.md': '# app', 'src/main.js': 'app' } });
    const found = await findOrCreateVault(gh);
    assert.equal(found.status, 'not-a-vault');
    assert.equal(found.repo.name, 'surfcad');
    assert.deepEqual(sortedPaths(await gh.listTree(found.repo, 'main')), ['README.md', 'src/main.js']);
    assert.equal(gh._log.filter((entry) => entry.op === 'createRepo' || entry.op === 'commitFiles').length, 0);
  });

  test('neither exists: create surfcad-vault', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const created = await findOrCreateVault(gh);
    assert.equal(created.status, 'created');
    assert.equal(created.repo.name, DEFAULT_VAULT_NAME);
    assert.equal((await gh.readFile(created.repo, 'surfcad.json')).content, MARKER);
    assert.equal(gh._log.filter((entry) => entry.op === 'createRepo').length, 1);
  });

  test('handle uses the repo name GitHub returned', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    gh._seedRepo({ name: 'SurfCAD-Vault', files: { 'surfcad.json': MARKER } });
    const realGetRepo = gh.getRepo.bind(gh);
    gh.getRepo = async (repo) => {
      if (repo.name === 'surfcad-vault') return realGetRepo({ ...repo, name: 'SurfCAD-Vault' });
      return realGetRepo(repo);
    };
    const found = await findOrCreateVault(gh);
    assert.equal(found.status, 'found');
    assert.equal(found.repo.name, 'SurfCAD-Vault');
  });

  test('pre-existing empty repo is not seeded', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    gh._seedRepo({ name: 'notes' });
    const found = await findOrCreateVault(gh, { name: 'notes' });
    assert.equal(found.status, 'not-a-vault');
    await assert.rejects(
      () => gh.listTree({ owner: 'artur', name: 'notes' }, 'main'),
      (err) => err.code === 'not_found',
    );
    assert.equal(gh._log.filter((entry) => entry.op === 'commitFiles').length, 0);
  });
});

describe('marker guard on write and flush', () => {
  test('commitFiles refuses an unmarked repo and writes nothing', async () => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ method, url });
      if (method === 'GET' && /\/repos\/artur\/surfcad$/.test(url)) {
        return json(200, { name: 'surfcad', owner: { login: 'artur' }, default_branch: 'main', size: 12 });
      }
      if (method === 'GET' && /\/branches\/main$/.test(url)) {
        return json(200, { name: 'main', commit: { sha: 'a'.repeat(40) } });
      }
      if (method === 'GET' && /surfcad\.json/.test(url)) {
        return json(404, { message: 'Not Found' });
      }
      if (method === 'GET' && /\/branches\?/.test(url)) return json(200, [{ name: 'main' }]);
      return json(500, { message: `unexpected ${method} ${url}` });
    };
    const adapter = createGithubAdapter({
      token: 'tok', fetchImpl, apiBase: 'https://api.github.com',
    });
    await assert.rejects(
      () => adapter.commitFiles(
        { owner: 'artur', name: 'surfcad' },
        { branch: 'main', message: 'oops', files: [{ path: 'parts/A.js', content: 'x' }], baseSha: 'a'.repeat(40) },
      ),
      (err) => err instanceof GitAdapterError && err.code === 'not_a_vault',
    );
    assert.equal(calls.some((call) => call.method !== 'GET'), false);
  });

  test('flush of a stale unmarked handle keeps the outbox queued', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    gh._seedRepo({ name: 'surfcad', files: { 'README.md': '# app' } });
    const store = createSyncStore({ persist: false });
    await store.ready();
    const repo = { owner: 'artur', name: 'surfcad' };
    await store.enqueue(repo, {
      op: 'commit',
      message: 'Update bracket',
      files: [{ path: 'parts/A.js', content: 'return 1;' }],
      partIds: ['parts/A.js'],
      branch: 'main',
    });
    const result = await flushSyncQueue({
      store, adapter: gh, repo, branch: 'main', online: true,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'not_a_vault');
    assert.match(result.error, /not a SurfCAD vault/i);
    assert.equal(store.pending(repo, 'main').length, 1);
    assert.equal(store.pending(repo, 'main')[0].status, 'queued');
    assert.equal(gh._log.filter((entry) => entry.op === 'commitFiles').length, 0);
    assert.equal((await gh.readFile(repo, 'README.md', 'main')).content, '# app');
  });
});

describe('outbox rekey', () => {
  test('moves owner/surfcad rows and is idempotent', async () => {
    const store = createSyncStore({ persist: false });
    await store.ready();
    const from = { owner: 'artur', name: 'surfcad' };
    const to = { owner: 'artur', name: 'surfcad-vault' };
    await store.enqueue(from, {
      op: 'commit',
      message: 'queued',
      files: [{ path: 'parts/A.js', content: '1' }],
      partIds: ['parts/A.js'],
      branch: 'main',
    });
    await store.setLastSyncedSha(from, 'abc', 'main');
    await store.putPart(from, {
      surfId: 'id1', path: 'parts/A.js', content: 'c', previousPath: 'old.js',
    });
    await store.putAssembly(from, 'assemblies/G/.surf.json', '{}');
    await store.rememberPathId(from, 'parts/A.js', 'id1');
    await store.putTree(from, 'main', [{ path: 'parts/A.js', content: 'c' }]);

    const first = await store.rekeyRepo(from, to);
    assert.ok(first.moved > 0);
    assert.equal(store.pending(to, 'main').length, 1);
    assert.equal(store.pending(from, 'main').length, 0);
    assert.equal(store.getLastSyncedSha(to, 'main'), 'abc');
    assert.equal(store.getLastSyncedSha(from, 'main'), null);
    assert.equal(store.getPartById(to, 'id1').content, 'c');
    assert.equal(store.getAlias(to, 'old.js'), 'id1');
    assert.equal(store.getAssembly(to, 'assemblies/G/.surf.json'), '{}');
    assert.equal(store.getTree(to, 'main')[0].path, 'parts/A.js');
    assert.equal(store.pathIndexFor(to)['parts/A.js'], 'id1');

    const second = await store.rekeyRepo(from, to);
    assert.equal(second.moved, 0);
    assert.equal(store.pending(to, 'main').length, 1);
    assert.equal(store.getPartById(to, 'id1').content, 'c');
  });
});

describe('delete account', () => {
  test('refuses to delete an unmarked surfcad that has commits', async () => {
    const stub = githubStub({
      surfcad: { marker: null, commits: true },
    });
    const result = await deleteResolvedGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: null,
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.deleted, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not-a-vault');
    assert.equal(result.repo, 'artur/surfcad');
    assert.equal(stub.calls.some((call) => call.method === 'DELETE'), false);
    assert.equal(stub.repos.surfcad.deleted, undefined);
  });

  test('deletes a marked surfcad-vault and treats lookup 404 as gone', async () => {
    const marked = githubStub({ 'surfcad-vault': { marker: MARKER } });
    const deleted = await deleteResolvedGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: 'surfcad-vault',
      fetchImpl: marked.fetchImpl,
    });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.repo, 'artur/surfcad-vault');
    assert.equal(marked.repos['surfcad-vault'].deleted, true);

    const missing = githubStub({});
    const gone = await deleteResolvedGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: null,
      fetchImpl: missing.fetchImpl,
    });
    assert.equal(gone.ok, true);
    assert.equal(gone.deleted, false);
    assert.equal(gone.gone, true);
    assert.equal(missing.calls.some((call) => call.method === 'DELETE'), false);
  });

  test('stored marked vault is deleted even if the other name is an unmarked surfcad', async () => {
    const stub = githubStub({
      'surfcad-vault': { marker: MARKER },
      surfcad: { marker: null, commits: true },
    });
    const result = await deleteResolvedGithubVault({
      accessToken: 'tok',
      owner: 'artur',
      storedName: 'surfcad-vault',
      fetchImpl: stub.fetchImpl,
    });
    assert.equal(result.deleted, true);
    assert.equal(result.repo, 'artur/surfcad-vault');
    assert.equal(stub.repos.surfcad.deleted, undefined);
    assert.equal(stub.calls.filter((call) => call.method === 'DELETE').length, 1);
  });
});

function json(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  };
}

function githubStub(repos) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url });
    const marker = url.match(/\/repos\/([^/]+)\/([^/]+)\/contents\/surfcad\.json/);
    if (method === 'GET' && marker) {
      const name = decodeURIComponent(marker[2]);
      const repo = repos[name];
      if (!repo || !repo.marker) return json(404, { message: 'Not Found' });
      return json(200, {
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(repo.marker, 'utf8').toString('base64'),
      });
    }
    const repoHit = url.match(/\/repos\/([^/]+)\/([^/?]+)(?:\?|$)/);
    if (method === 'GET' && repoHit && !url.includes('/contents/')) {
      const name = decodeURIComponent(repoHit[2]);
      const repo = repos[name];
      if (!repo) return json(404, { message: 'Not Found' });
      return json(200, {
        name: repo.actualName || name,
        owner: { login: 'artur' },
        default_branch: 'main',
        size: repo.commits ? 20 : 1,
      });
    }
    if (method === 'DELETE' && repoHit) {
      const name = decodeURIComponent(repoHit[2]);
      const repo = repos[name];
      if (!repo) return json(404, { message: 'Not Found' });
      repo.deleted = true;
      return { status: 204, ok: true, json: async () => ({}), text: async () => '', headers: { get: () => null } };
    }
    return json(500, { message: `unexpected ${method} ${url}` });
  };
  return { fetchImpl, calls, repos };
}
