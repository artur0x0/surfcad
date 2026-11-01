/**
 * Binary vault plumbing: base64 blob round-trip, size guards, mesh path
 * classification, outbox bytes, and git blob sha. No mongoose, no network.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { clearAssetCache, getAssetBytes, putAsset } from '../src/utils/git/assetCache.js';
import {
  VAULT_FILE_MAX_BYTES,
  VAULT_FILE_WARN_BYTES,
  VaultFileTooLargeError,
  assertVaultFileSize,
  decodeBase64,
  encodeBase64,
  gitBlobSha,
  normalizeOutboxFiles,
} from '../src/utils/git/binaryContent.js';
import { createGithubAdapter } from '../src/utils/git/githubAdapter.js';
import { readVaultAsset } from '../src/utils/git/githubAdapter.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { deletePartFromRepo } from '../src/utils/git/gitCommit.js';
import { behindPathsFromFiles } from '../src/utils/git/gitPull.js';
import { buildRenameCommitFiles, readRenameEntries } from '../src/utils/git/gitRename.js';
import { planDeleteAssembly } from '../src/utils/git/gitDeleteAssembly.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { openVaultAssembly } from '../src/utils/git/gitWorkspace.js';
import { stringifySurfJson } from '../src/utils/git/surfJson.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../src/utils/git/idPaths.js';
import { vaultMarkerContent } from '../src/utils/git/vault.js';
import {
  assemblyFilePath,
  assemblyPartPath,
  assetPathForScript,
  parseVaultPath,
  sharedPartPath,
} from '../src/utils/git/vaultLayout.js';

const MARKER = vaultMarkerContent();

function sameBytes(a, b) {
  assert.ok(a instanceof Uint8Array);
  assert.ok(b instanceof Uint8Array);
  assert.deepEqual(Array.from(a), Array.from(b));
}

function nodeBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8');
  return createHash('sha1').update(header).update(Buffer.from(bytes)).digest('hex');
}

describe('base64 and git blob sha', () => {
  test('base64 round-trips bytes that are not valid utf-8', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 10, 13]);
    const encoded = encodeBase64(bytes);
    assert.equal(typeof encoded, 'string');
    assert.equal(encoded.includes(','), false);
    sameBytes(decodeBase64(encoded), bytes);
    sameBytes(decodeBase64(encoded.match(/.{1,60}/g).join('\n')), bytes);
    sameBytes(decodeBase64(encodeBase64(new Uint8Array())), new Uint8Array());
  });

  test('git blob sha matches sha1(blob header + bytes)', () => {
    const empty = new Uint8Array();
    assert.equal(gitBlobSha(empty), nodeBlobSha(empty));
    assert.equal(gitBlobSha(empty), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    const mesh = Uint8Array.from([0, 255, 10, 65, 0, 1]);
    assert.equal(gitBlobSha(mesh), nodeBlobSha(mesh));
    const copy = mesh.buffer.slice(mesh.byteOffset, mesh.byteOffset + mesh.byteLength);
    assert.equal(gitBlobSha(copy), gitBlobSha(mesh));
  });
});

describe('size guards', () => {
  test('40 MiB is allowed and one byte over throws', () => {
    assert.equal(assertVaultFileSize('parts/A.mesh', VAULT_FILE_MAX_BYTES), VAULT_FILE_MAX_BYTES);
    assert.throws(
      () => assertVaultFileSize('parts/A.mesh', VAULT_FILE_MAX_BYTES + 1),
      (err) => err instanceof VaultFileTooLargeError
        && err.code === 'file_too_large'
        && err.bytes === VAULT_FILE_MAX_BYTES + 1
        && err.limit === VAULT_FILE_MAX_BYTES,
    );
  });

  test('fileWrite and commitFiles reject over 40 MiB and warn over 20 MiB', async () => {
    const huge = new Uint8Array(VAULT_FILE_MAX_BYTES + 1);
    assert.throws(() => fileWrite('parts/Huge.mesh', huge), VaultFileTooLargeError);
    const gh = createMockGithubAdapter({ login: 'artur' });
    const repo = { owner: 'artur', name: 'vault' };
    await gh.createRepo({ name: 'vault' });
    await assert.rejects(
      () => gh.commitFiles(repo, { branch: 'main', message: 'too big', files: [{ path: 'parts/Huge.mesh', content: huge }] }),
      VaultFileTooLargeError,
    );
    assert.equal(await gh.getBranch(repo, 'main'), null);

    const warn = huge.subarray(0, VAULT_FILE_WARN_BYTES + 1);
    const file = fileWrite('parts/Big.mesh', warn);
    assert.equal(file.large, true);
    assert.equal(file.encoding, 'base64');
    assert.equal(file.content.byteLength, VAULT_FILE_WARN_BYTES + 1);
    const seen = [];
    const committed = await gh.commitFiles(repo, {
      branch: 'main',
      message: 'warn',
      files: [fileWrite('surfcad.json', MARKER), file],
      onLargeFile: (item) => seen.push(item),
    });
    assert.deepEqual(committed.largeFiles, [{ path: 'parts/Big.mesh', bytes: VAULT_FILE_WARN_BYTES + 1 }]);
    assert.deepEqual(seen, committed.largeFiles);
    const exact = fileWrite('a.txt', 'hello');
    assert.deepEqual(exact, { path: 'a.txt', content: 'hello' });
    assert.equal(exact.large, undefined);
  });
});

describe('mesh path classification', () => {
  test('<Part>.mesh beside a part is an asset, not other', () => {
    assert.deepEqual(parseVaultPath('parts/Bracket.mesh'), {
      kind: 'asset',
      part: 'Bracket',
      script: 'parts/Bracket.js',
    });
    assert.deepEqual(parseVaultPath('assemblies/Gearbox/Bracket.mesh'), {
      kind: 'asset',
      part: 'Bracket',
      script: 'assemblies/Gearbox/Bracket.js',
      assembly: 'Gearbox',
    });
    assert.deepEqual(parseVaultPath('assemblies/Gearbox/parts/Bracket.mesh'), {
      kind: 'asset',
      part: 'Bracket',
      script: 'assemblies/Gearbox/parts/Bracket.js',
      assembly: 'Gearbox',
      legacy: true,
    });
    assert.equal(assetPathForScript(sharedPartPath('Bracket')), 'parts/Bracket.mesh');
    assert.equal(assetPathForScript(assemblyPartPath('Gearbox', 'Bracket')), 'assemblies/Gearbox/Bracket.mesh');
    assert.equal(assetPathForScript('assemblies/Gearbox/parts/Bracket.js'), 'assemblies/Gearbox/parts/Bracket.mesh');
    assert.equal(parseVaultPath('parts/sub/x.mesh').kind, 'other');
    assert.equal(parseVaultPath('README.mesh').kind, 'other');
    assert.equal(parseVaultPath('assemblies/Gearbox/.surf.json').kind, 'assembly');
    assert.equal(parseVaultPath('parts/Bracket.js').kind, 'shared-part');
    assert.equal(parseVaultPath('assemblies/Gearbox/Bracket.js').kind, 'assembly-part');
  });
});

describe('outbox binary round-trip', () => {
  test('normalize + structured clone keeps Uint8Array and Blob bytes', async () => {
    const bytes = Uint8Array.from([0, 255, 7, 8]);
    const blob = new globalThis.Blob([bytes]);
    const stored = await normalizeOutboxFiles([
      fileWrite('parts/Bracket.mesh', bytes),
      fileWrite('parts/FromBlob.mesh', blob),
      fileWrite('parts/Bracket.js', 'return 1;\n'),
    ]);
    const cloned = globalThis.structuredClone(stored);
    assert.equal(typeof cloned[0].content, 'object');
    assert.ok(!(typeof cloned[0].content === 'string'));
    sameBytes(cloned[0].content, bytes);
    sameBytes(cloned[1].content, bytes);
    assert.equal(cloned[2].content, 'return 1;\n');
    assert.notEqual(String(bytes), 'return 1;\n');
    assert.ok(String(bytes).includes(','));

    const store = createSyncStore({ persist: false });
    const repo = { owner: 'artur', name: 'vault' };
    await store.enqueue(repo, {
      op: 'save',
      branch: 'main',
      message: 'mesh',
      files: [fileWrite('parts/Bracket.mesh', bytes)],
      partIds: ['parts/Bracket.js'],
    });
    const pending = store.pending(repo, 'main');
    sameBytes(pending[0].files[0].content, bytes);
    assert.equal(pending[0].files[0].encoding, 'base64');
  });
});

describe('asset cache', () => {
  test('putAsset returns the git blob sha and getAssetBytes reads it back', async () => {
    await clearAssetCache();
    const bytes = Uint8Array.from([1, 2, 3, 4, 255]);
    const sha = await putAsset(bytes);
    assert.equal(sha, gitBlobSha(bytes));
    assert.equal(sha, nodeBlobSha(bytes));
    sameBytes(await getAssetBytes(sha), bytes);
    assert.equal(await getAssetBytes('deadbeef'), null);
    bytes[0] = 9;
    sameBytes(await getAssetBytes(sha), Uint8Array.from([1, 2, 3, 4, 255]));
  });
});

function meshDoc(partPath) {
  return {
    name: 'Gearbox',
    source: 'git',
    activeId: partPath,
    parts: [{ id: partPath, name: 'Bracket', visible: true, order: 0 }],
  };
}

describe('commit, pull, rename, and delete carry the mesh', () => {
  test('mock commit and open keep mesh bytes and the cache key matches the tree sha', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const repo = { owner: 'artur', name: 'vault' };
    await gh.createRepo({ name: 'vault' });
    const part = '2026-10-22-05-00-00-0003-cc03';
    const assembly = '2026-10-22-05-00-00-0001-aa01';
    const meshPath = partMeshIdPath(part);
    const mesh = Uint8Array.from([0, 1, 2, 255]);
    const marker = `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`;
    await gh.commitFiles(repo, {
      branch: 'main',
      message: 'seed',
      files: [
        fileWrite('surfcad.json', marker),
        fileWrite(assemblyIdPath(assembly), `${JSON.stringify({
          format: 'surfcad.assembly',
          version: 2,
          id: assembly,
          name: 'Gearbox',
          activeId: part,
          parts: [{ id: part, name: 'Bracket', visible: true, order: 0 }],
        }, null, 2)}\n`),
        fileWrite(partIdPath(part), `// @surf-id ${part}\n// @name Bracket\nreturn 1;\n`),
        fileWrite(meshPath, mesh),
      ],
    });
    const treeSha = (await gh.listTree(repo, 'main')).find((entry) => entry.path === meshPath).sha;
    assert.equal(treeSha, gitBlobSha(mesh));
    sameBytes(await gh.readBlob(repo, treeSha), mesh);
    assert.equal(
      (await gh.readFile(repo, partIdPath(part), 'main')).content,
      `// @surf-id ${part}\n// @name Bracket\nreturn 1;\n`,
    );

    await clearAssetCache();
    const opened = await openVaultAssembly(gh, repo, assembly);
    const meshGot = opened.assets[meshPath];
    sameBytes(meshGot.bytes, mesh);
    assert.equal(meshGot.sha, gitBlobSha(mesh));
    sameBytes(await getAssetBytes(meshGot.sha), mesh);

    const next = Uint8Array.from([9, 8, 7]);
    await gh.commitFiles(repo, {
      branch: 'main',
      message: 'Update mesh',
      files: [fileWrite(meshPath, next)],
    });
    const movedSha = (await gh.listTree(repo, 'main')).find((entry) => entry.path === meshPath).sha;
    assert.equal(movedSha, gitBlobSha(next));
    sameBytes(await gh.readBlob(repo, movedSha), next);

    const scoped = behindPathsFromFiles(
      [{ path: meshPath, status: 'modified' }],
      { assemblyPath: assemblyIdPath(assembly), partIds: [partIdPath(part)] },
    );
    assert.deepEqual(scoped.partIds, [partIdPath(part)]);
  });

  test('rename and delete move the mesh with the script', async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const repo = { owner: 'artur', name: 'vault' };
    await gh.createRepo({ name: 'vault' });
    const part = assemblyPartPath('Gearbox', 'Bracket');
    const meshPath = assetPathForScript(part);
    const mesh = Uint8Array.from([4, 5, 6]);
    const script = 'return 1;\n';
    await gh.commitFiles(repo, {
      branch: 'main',
      message: 'seed',
      files: [
        fileWrite('surfcad.json', MARKER),
        fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(meshDoc(part))),
        fileWrite(part, script),
        fileWrite(meshPath, mesh),
      ],
    });
    const entries = await readRenameEntries(gh, repo, 'main');
    sameBytes(entries.find((entry) => entry.path === meshPath).content, mesh);
    const plate = assemblyPartPath('Gearbox', 'Plate');
    const plateMesh = assetPathForScript(plate);
    const renamed = buildRenameCommitFiles({
      entries,
      plan: { kind: 'part', from: part, to: plate, content: script },
    });
    sameBytes(renamed.files.find((file) => file.path === plateMesh).content, mesh);
    assert.equal(renamed.files.some((file) => file.path === meshPath && file.delete), true);

    const removed = await deletePartFromRepo(gh, repo, {
      doc: { ...meshDoc(part), parts: [], activeId: null },
      scripts: {},
      baseline: { branch: 'main', headSha: (await gh.getBranch(repo, 'main')).sha, scripts: {}, assets: {} },
      partPath: part,
    });
    assert.equal(removed.status, 'committed');
    assert.equal((await gh.listTree(repo, 'main')).some((entry) => entry.path === meshPath), false);
    assert.equal((await gh.listTree(repo, 'main')).some((entry) => entry.path === part), false);
  });

  test('deleting an assembly moves an assembly-local mesh with the script', () => {
    const part = assemblyPartPath('Gearbox', 'Bracket');
    const meshPath = assetPathForScript(part);
    const mesh = Uint8Array.from([1, 1, 1]);
    const doc = meshDoc(part);
    const plan = planDeleteAssembly([
      { path: assemblyFilePath('Gearbox'), content: stringifySurfJson(doc) },
      { path: part, content: 'return 1;\n' },
      { path: meshPath, content: mesh },
    ], 'Gearbox', 'keep');
    const dest = plan.files.find((file) => file.path === 'parts/Bracket.mesh');
    sameBytes(dest.content, mesh);
    assert.equal(plan.files.some((file) => file.path === meshPath && file.delete), true);
  });
});

function jsonResponse(status, data) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async text() { return data == null ? '' : JSON.stringify(data); },
  };
}

/**
 * Tiny GitHub stand-in. Stores blob bytes. Text blob posts stay utf-8 strings
 * in the request body; binary posts are base64.
 */
function makeBinaryGithub() {
  const repos = new Map();
  const calls = [];
  let n = 1;
  const nextSha = () => (n++).toString(16).padStart(40, '0');

  function ensure(owner, name) {
    const key = `${owner}/${name}`;
    if (!repos.has(key)) {
      repos.set(key, {
        owner,
        name,
        private: true,
        default_branch: 'main',
        size: 0,
        branches: new Map(),
        commits: new Map(),
        trees: new Map(),
        blobs: new Map(),
      });
    }
    return repos.get(key);
  }

  function blobBytes(body) {
    if (body?.encoding === 'base64') return decodeBase64(body.content || '');
    return new TextEncoder().encode(String(body?.content ?? ''));
  }

  async function fetchImpl(url, opts = {}) {
    const method = opts.method || 'GET';
    const u = new URL(url);
    const path = u.pathname;
    let body = null;
    if (opts.body) body = JSON.parse(opts.body);
    calls.push({ method, path, body, search: u.search });
    const parts = path.split('/').filter(Boolean);

    if (method === 'POST' && path === '/user/repos') {
      const state = ensure('octo', body.name);
      state.private = body.private !== false;
      return jsonResponse(201, {
        owner: { login: 'octo' },
        name: body.name,
        private: state.private,
        default_branch: 'main',
        size: 0,
      });
    }

    if (parts[0] !== 'repos' || parts.length < 3) return jsonResponse(404, { message: 'nope' });
    const owner = decodeURIComponent(parts[1]);
    const name = decodeURIComponent(parts[2]);
    const state = repos.get(`${owner}/${name}`);
    if (!state) return jsonResponse(404, { message: 'Not Found' });
    const rest = parts.slice(3).map((seg) => decodeURIComponent(seg));

    if (rest.length === 0 && method === 'GET') {
      return jsonResponse(200, {
        owner: { login: state.owner },
        name: state.name,
        private: state.private,
        default_branch: state.default_branch,
        size: state.size,
      });
    }
    if (rest[0] === 'branches' && rest.length === 1 && method === 'GET') {
      return jsonResponse(200, [...state.branches.entries()].map(([branch, sha]) => ({
        name: branch,
        commit: { sha },
      })));
    }
    if (rest[0] === 'branches' && rest.length === 2 && method === 'GET') {
      const sha = state.branches.get(rest[1]);
      if (!sha) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(200, { name: rest[1], commit: { sha } });
    }
    if (rest[0] === 'contents' && method === 'GET') {
      const filePath = rest.slice(1).join('/');
      const ref = u.searchParams.get('ref') || state.default_branch;
      const commitSha = state.branches.get(ref);
      const commit = commitSha ? state.commits.get(commitSha) : null;
      const entry = commit && state.trees.get(commit.treeSha)?.find((item) => item.path === filePath);
      if (!entry) return jsonResponse(404, { message: 'Not Found' });
      const bytes = state.blobs.get(entry.sha);
      return jsonResponse(200, {
        type: 'file',
        encoding: 'base64',
        content: encodeBase64(bytes),
        sha: entry.sha,
      });
    }
    if (rest[0] === 'contents' && method === 'PUT') {
      const filePath = rest.slice(1).join('/');
      const bytes = decodeBase64(body.content || '');
      const blobSha = nextSha();
      const treeSha = nextSha();
      const commitSha = nextSha();
      state.blobs.set(blobSha, bytes);
      state.trees.set(treeSha, [{ path: filePath, mode: '100644', type: 'blob', sha: blobSha }]);
      state.commits.set(commitSha, { treeSha, parents: [], message: body.message || '' });
      state.branches.set(body.branch || 'main', commitSha);
      state.size = 1;
      return jsonResponse(201, { content: { sha: blobSha }, commit: { sha: commitSha } });
    }
    if (rest[0] === 'git' && rest[1] === 'blobs' && method === 'POST') {
      if (state.branches.size === 0) return jsonResponse(409, { message: 'Git Repository is empty.' });
      const blobSha = nextSha();
      state.blobs.set(blobSha, blobBytes(body));
      return jsonResponse(201, { sha: blobSha });
    }
    if (rest[0] === 'git' && rest[1] === 'blobs' && method === 'GET') {
      const bytes = state.blobs.get(rest[2]);
      if (!bytes) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(200, {
        sha: rest[2],
        size: bytes.byteLength,
        encoding: 'base64',
        content: encodeBase64(bytes),
      });
    }
    if (rest[0] === 'git' && rest[1] === 'trees' && method === 'POST') {
      let entries = body.tree || [];
      if (body.base_tree) {
        const base = state.trees.get(body.base_tree) || [];
        const map = new Map(base.map((entry) => [entry.path, entry]));
        for (const entry of body.tree || []) map.set(entry.path, entry);
        entries = [...map.values()];
      }
      const treeSha = nextSha();
      state.trees.set(treeSha, entries);
      state._pending = treeSha;
      return jsonResponse(201, { sha: treeSha });
    }
    if (rest[0] === 'git' && rest[1] === 'trees' && method === 'GET') {
      const tree = state.trees.get(rest[2]);
      if (!tree) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(200, { sha: rest[2], tree });
    }
    if (rest[0] === 'git' && rest[1] === 'commits' && method === 'POST') {
      const commitSha = nextSha();
      state.commits.set(commitSha, {
        treeSha: body.tree,
        parents: body.parents || [],
        message: body.message || '',
      });
      return jsonResponse(201, { sha: commitSha, tree: { sha: body.tree } });
    }
    if (rest[0] === 'git' && rest[1] === 'commits' && method === 'GET') {
      const commit = state.commits.get(rest[2]);
      if (!commit) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(200, {
        sha: rest[2],
        tree: { sha: commit.treeSha },
        parents: (commit.parents || []).map((parent) => ({ sha: parent })),
      });
    }
    if (rest[0] === 'git' && rest[1] === 'refs' && rest[2] === 'heads' && method === 'PATCH') {
      state.branches.set(rest[3], body.sha);
      state.size = 1;
      return jsonResponse(200, { object: { sha: body.sha } });
    }
    return jsonResponse(404, { message: `unhandled ${method} ${path}` });
  }

  return { fetchImpl, calls };
}

describe('real adapter binary blobs', () => {
  test('text stays utf-8, binary is base64, and assets are not read with Contents GET', async () => {
    const fake = makeBinaryGithub();
    const gh = createGithubAdapter({
      token: 'tok',
      fetchImpl: fake.fetchImpl,
      apiBase: 'https://api.github.com',
    });
    const repo = { owner: 'octo', name: 'vault' };
    await gh.createRepo({ name: 'vault', private: true });
    const part = sharedPartPath('Bracket');
    const meshPath = assetPathForScript(part);
    const mesh = Uint8Array.from([0, 255, 10, 13, 128]);
    const first = await gh.commitFiles(repo, {
      branch: 'main',
      message: 'seed',
      baseSha: null,
      seed: true,
      files: [
        fileWrite('surfcad.json', MARKER),
        fileWrite(part, 'return 1;\n'),
        fileWrite(meshPath, mesh),
      ],
    });
    assert.equal(first.parents.length, 0);
    const posts = fake.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'));
    const textPost = posts.find((call) => call.body.encoding === 'utf-8' && call.body.content === 'return 1;\n');
    const binPost = posts.find((call) => call.body.encoding === 'base64');
    assert.ok(textPost);
    assert.ok(binPost);
    sameBytes(decodeBase64(binPost.body.content), mesh);
    const put = fake.calls.find((call) => call.method === 'PUT' && call.path.includes('/contents/'));
    assert.equal(put.body.content, encodeBase64(new TextEncoder().encode(MARKER)));

    fake.calls.length = 0;
    const got = await readVaultAsset(gh, repo, meshPath, 'main');
    sameBytes(got.bytes, mesh);
    assert.equal(gitBlobSha(got.bytes), gitBlobSha(mesh));
    assert.equal(fake.calls.some((call) => call.path.includes('/contents/')), false);
    assert.ok(fake.calls.some((call) => call.method === 'GET' && call.path.includes('/git/blobs/')));
    sameBytes(await gh.readBlob(repo, got.sha), mesh);
    assert.equal((await gh.readFile(repo, part, 'main')).content, 'return 1;\n');
  });
});
