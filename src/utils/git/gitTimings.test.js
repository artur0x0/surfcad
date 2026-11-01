/**
 * B17 PR 1: the git cost model is the round-trip count, so the count of
 * adapter calls an Open and a one-part Save make is pinned here. A later PR
 * that lowers it moves these numbers in the same change, with the reason.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGitTimings, endpointLabel } from './gitTimings.js';
import { createGithubAdapter } from './githubAdapter.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';
import { executePlanSave } from './executePlanSave.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { openV2Assembly } from './v2VaultRead.js';
import { mintSurfId, withSurfId, withSurfName } from './surfId.js';
import { createSyncStore } from './syncStore.js';

const MARKER = JSON.stringify({ kind: 'surfcad-vault', version: 2 });
const REPO = { owner: 'artur', name: 'surfcad-vault' };
const NOW = 1_700_000_000_000;
const A = mintSurfId({ now: new Date('2026-10-27T10:00:00.001Z'), rand: 'aa01' });
const P = mintSurfId({ now: new Date('2026-10-27T10:00:00.002Z'), rand: 'bb02' });
const Q = mintSurfId({ now: new Date('2026-10-27T10:00:00.003Z'), rand: 'cc03' });
const R = mintSurfId({ now: new Date('2026-10-27T10:00:00.004Z'), rand: 'dd04' });
const MESH = new Uint8Array([77, 69, 83, 72, 1, 0, 0, 0]);

function fakeClock() {
  let t = 0;
  return { now: () => { t += 10; return t; }, lines: [] };
}

function recorder() {
  const clock = fakeClock();
  const timings = createGitTimings({ now: clock.now, log: (line) => clock.lines.push(line), on: () => true });
  return { timings, lines: clock.lines };
}

function assemblyJson(parts) {
  return `${JSON.stringify({
    format: 'surfcad.assembly', version: 2, id: A, name: 'Rig', activeId: parts[0],
    parts: parts.map((id, i) => ({ id, name: `Part ${i + 1}`, visible: true, order: i })),
  }, null, 2)}\n`;
}

const script = (id, name) => withSurfName(withSurfId('return Manifold.cube([10, 10, 10], true);\n', id), name);

test('wrapAdapter counts every adapter call inside a span and leaves the adapter alone', async () => {
  const { timings, lines } = recorder();
  const gh = createMockGithubAdapter({ login: 'artur' });
  gh._seedRepo({ name: REPO.name, files: { 'surfcad.json': MARKER, 'parts/a.js': 'x' } });
  const timed = timings.wrapAdapter(gh);
  assert.equal(timed.kind, gh.kind, 'other properties pass through');
  assert.equal(timings.wrapAdapter(timed), timed, 'wrapping twice is a no-op');
  const end = timings.begin('probe');
  await timed.getBranch(REPO, 'main');
  await timed.listTree(REPO, 'main');
  await timed.readFile(REPO, 'parts/a.js', 'main').then((f) => assert.equal(f.content, 'x'));
  await assert.rejects(() => timed.listTree(REPO, 'no-such-branch'), /not found/i);
  const summary = end();
  assert.equal(summary.op, 'probe');
  assert.equal(summary.calls, 4);
  assert.equal(summary.http, 0, 'the mock makes no HTTP calls');
  assert.deepEqual(Object.keys(summary.byMethod).sort(), ['getBranch', 'listTree', 'readFile']);
  assert.equal(summary.byMethod.listTree.n, 2);
  assert.equal(summary.byMethod.listTree.failed, 1, 'a throw is counted as a failed call');
  assert.equal(summary.rows.length, 4);
  assert.equal(summary.rows[3].ok, false);
  assert.ok(summary.ms > 0);
  assert.equal(timings.last(), summary);
  assert.match(lines.at(-1), /^\[git\] probe: 4 adapter calls, [\d.]+ s$/);
  assert.match(lines[0], /^\[git\] getBranch [\d.]+ ms$/);
  // Calls outside a span are counted, not attributed.
  await timed.getBranch(REPO, 'main');
  assert.equal(timings.snapshot().unscoped.calls, 1);
  assert.equal(timings.snapshot().history.length, 1);
  assert.equal('rows' in timings.snapshot().history[0], false);
});

test('wrapFetch labels GitHub endpoints by shape; listTree on the real adapter is three round trips by branch, two by sha', async () => {
  assert.equal(endpointLabel('get', 'https://api.github.com/repos/o/r/git/trees/0123456789abcdef0123456789abcdef01234567?recursive=1'), 'GET git/trees/:sha');
  assert.equal(endpointLabel('GET', 'https://api.github.com/repos/o/r/contents/parts/x.js?ref=main'), 'GET contents/:path');
  assert.equal(endpointLabel('GET', 'https://api.github.com/repos/o/r/branches/main'), 'GET branches/:path');
  assert.equal(endpointLabel('PATCH', 'https://api.github.com/repos/o/r/git/refs/heads/main'), 'PATCH git/refs/heads/main');
  assert.equal(endpointLabel('GET', 'https://api.github.com/user'), 'GET user');

  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const TREE = 'fedcba9876543210fedcba9876543210fedcba98';
  const fakeFetch = async (url) => {
    const body = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/branches/main')) return body(200, { name: 'main', commit: { sha: SHA } });
    if (url.includes(`/branches/${SHA}`)) return body(404, { message: 'Branch not found' });
    if (url.includes(`/git/commits/${SHA}`)) return body(200, { sha: SHA, tree: { sha: TREE } });
    if (url.includes(`/git/trees/${TREE}`)) return body(200, { tree: [{ path: 'surfcad.json', type: 'blob', sha: TREE }], truncated: false });
    return body(404, { message: `unexpected ${url}` });
  };
  const { timings } = recorder();
  const gh = timings.wrapAdapter(createGithubAdapter({ token: 'test-token', fetchImpl: timings.wrapFetch(fakeFetch) }));

  let end = timings.begin('tree-by-branch');
  await gh.listTree(REPO, 'main');
  let s = end();
  assert.equal(s.calls, 1);
  assert.equal(s.http, 3, 'resolve the branch, read the commit, read the tree');
  assert.deepEqual(Object.keys(s.byEndpoint), ['GET branches/:path', 'GET git/commits/:sha', 'GET git/trees/:sha']);

  end = timings.begin('tree-by-sha');
  await gh.listTree(REPO, SHA);
  s = end();
  assert.equal(s.http, 2, 'a 40-hex ref is a sha: commit and tree, no /branches lookup');
  assert.deepEqual(Object.keys(s.byEndpoint), ['GET git/commits/:sha', 'GET git/trees/:sha']);
});

test('pin: opening a three-part assembly with three meshes on the mock is 3 + parts + meshes adapter calls, scripts and meshes in parallel', async () => {
  const { timings } = recorder();
  const gh = createMockGithubAdapter({ login: 'artur' });
  const seeded = gh._seedRepo({
    name: REPO.name,
    files: {
      'surfcad.json': MARKER,
      [assemblyIdPath(A)]: assemblyJson([P, Q, R]),
      [partIdPath(P)]: script(P, 'Part 1'),
      [partIdPath(Q)]: script(Q, 'Part 2'),
      [partIdPath(R)]: script(R, 'Part 3'),
      [partMeshIdPath(P)]: MESH,
      [partMeshIdPath(Q)]: MESH.map((b) => b ^ 1),
      [partMeshIdPath(R)]: MESH.map((b) => b ^ 2),
    },
  });
  const repo = { owner: seeded.owner, name: seeded.name };
  // Overlap: a call that starts before the previous one ended.
  let inFlight = 0;
  let peak = 0;
  const slow = new Proxy(gh, {
    get(target, key) {
      if (key !== 'readFile' && key !== 'readBlob') return target[key];
      return async (...args) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        try { return await target[key](...args); } finally { inFlight -= 1; }
      };
    },
  });
  const timed = timings.wrapAdapter(slow);
  const opened = await timings.measure('open', () => openV2Assembly(timed, repo, A));
  assert.equal(Object.keys(opened.scripts).length, 3);
  assert.equal(Object.keys(opened.assets).length, 3);
  assert.deepEqual(opened.doc.parts.map((p) => p.id), [P, Q, R], 'rows keep their order');
  const s = timings.last();
  assert.equal(s.op, 'open');
  assert.equal(s.ok, true);
  // readFile(marker) for the version check, readFile(assembly), then the
  // part scripts in parallel, listTree 1 for the mesh shas, one readBlob
  // per mesh in parallel, then getBranch for the tip.
  const PARTS = 3;
  const MESHES = 3;
  assert.deepEqual(s.byMethod, {
    readFile: { n: 2 + PARTS, ms: s.byMethod.readFile.ms, failed: 0 },
    listTree: { n: 1, ms: s.byMethod.listTree.ms, failed: 0 },
    readBlob: { n: MESHES, ms: s.byMethod.readBlob.ms, failed: 0 },
    getBranch: { n: 1, ms: s.byMethod.getBranch.ms, failed: 0 },
  });
  assert.equal(s.calls, 4 + PARTS + MESHES);
  assert.equal(s.calls, 10, 'version check reads the marker; the open itself was pinned at 9');
  assert.equal(peak, 3, 'the three scripts (and the three meshes) are read at the same time');
});

test('pin: a one-part Save after a seed commit is 3 adapter calls on the mock (the tree listing carries every hash); the seed is 5', async () => {
  const { timings } = recorder();
  const gh = timings.wrapAdapter(createMockGithubAdapter({ login: 'artur' }));
  const store = createSyncStore({ persist: false });
  await store.ready();
  const doc = {
    id: A, name: 'Rig', source: 'git', rev: 1, activeId: P, vaultLayout: 'v2',
    parts: [{ id: P, name: 'Part 1', visible: true, order: 0 }],
  };
  const wc = (body) => ({
    doc, scripts: { [P]: body }, meshes: { [P]: MESH }, now: NOW, repo: REPO, branch: 'main',
    saveTarget: { repo: REPO, branch: 'main' },
  });
  const seeded = await timings.measure('seed', () => executePlanSave({
    adapter: gh, repo: REPO, branch: 'main', store, workingCopy: wc('return 1;\n'), message: 'seed', create: true, online: true, now: NOW,
  }));
  assert.equal(seeded.status, 'committed', seeded.error);
  // create: getBranch (not found), getRepo, getViewer, createRepo, commitFiles.
  assert.deepEqual(timings.last().rows.map((r) => r.method + (r.ok ? '' : '!')), ['getBranch!', 'getRepo', 'getViewer', 'createRepo', 'commitFiles']);
  assert.equal(timings.last().calls, 5);

  const saved = await timings.measure('save', () => executePlanSave({
    adapter: gh, repo: REPO, branch: 'main', store, workingCopy: wc('return 2;\n'), message: 'edit', online: true, now: NOW + 1000,
  }));
  assert.equal(saved.status, 'committed', saved.error);
  const s = timings.last();
  // getBranch (tip), listTree (tip tree: every entry's sha is its blob
  // hash, so no tip file is read back; PR 1 pinned a readFile per script
  // and assembly and a readBlob per mesh), then the commit. compare is
  // skipped because the stored tip equals the remote.
  assert.deepEqual(s.byMethod, {
    getBranch: { n: 1, ms: s.byMethod.getBranch.ms, failed: 0 },
    listTree: { n: 1, ms: s.byMethod.listTree.ms, failed: 0 },
    commitFiles: { n: 1, ms: s.byMethod.commitFiles.ms, failed: 0 },
  });
  assert.equal(s.calls, 3, 'PR 1 pinned 6');
  assert.deepEqual(s.rows.map((r) => r.method), ['getBranch', 'listTree', 'commitFiles']);
  // One mock commitFiles is a dozen HTTP calls on the real adapter; that is
  // what the HTTP counter is for. Here there is none.
  assert.equal(s.http, 0);
});

test('pin: commitFiles of a script and its mesh on the real adapter is 8 HTTP round trips, the two blobs in flight together', async () => {
  const HEAD = '1111111111111111111111111111111111111111';
  const TREE = '2222222222222222222222222222222222222222';
  const MARKER_TEXT = globalThis.btoa(MARKER);
  let blobs = 0;
  let inFlight = 0;
  let peak = 0;
  const body = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fakeFetch = async (url, init) => {
    const method = init?.method || 'GET';
    const path = new URL(url).pathname;
    if (method === 'GET' && path === '/repos/artur/surfcad-vault') return body(200, { name: 'surfcad-vault', owner: { login: 'artur' }, default_branch: 'main', private: true, size: 1 });
    if (method === 'GET' && path.endsWith('/branches/main')) {
      // GitHub embeds the head commit, tree sha included.
      return body(200, { name: 'main', commit: { sha: HEAD, commit: { tree: { sha: TREE } } } });
    }
    if (method === 'GET' && path.includes('/contents/surfcad.json')) return body(200, { type: 'file', content: MARKER_TEXT, encoding: 'base64', sha: 'm' });
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      blobs += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return body(201, { sha: `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${blobs}` });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      assert.equal(init.body.includes('"base_tree":"' + TREE + '"'), true, 'adds and edits build on base_tree without downloading the parent tree');
      return body(201, { sha: '3333333333333333333333333333333333333333' });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) return body(201, { sha: '4444444444444444444444444444444444444444' });
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) return body(200, { object: { sha: '4444444444444444444444444444444444444444' } });
    return body(404, { message: `unexpected ${method} ${path}` });
  };
  const { timings } = recorder();
  const gh = timings.wrapAdapter(createGithubAdapter({ token: 'test-token', fetchImpl: timings.wrapFetch(fakeFetch) }));
  const end = timings.begin('commit');
  const out = await gh.commitFiles(REPO, {
    branch: 'main',
    message: 'edit',
    baseSha: HEAD,
    files: [
      { path: partIdPath(P), content: 'return 2;\n' },
      { path: partMeshIdPath(P), content: MESH, binary: true },
    ],
  });
  const s = end();
  assert.equal(out.sha, '4444444444444444444444444444444444444444');
  // repo, branch (with the tree sha), marker, two blobs, tree, commit, ref.
  assert.deepEqual(Object.keys(s.byEndpoint), [
    'GET /', 'GET branches/:path', 'GET contents/:path', 'POST git/blobs', 'POST git/trees', 'POST git/commits', 'PATCH git/refs/heads/main',
  ]);
  assert.equal(s.http, 8);
  assert.equal(s.byEndpoint['POST git/blobs'].n, 2);
  assert.equal(peak, 2, 'the two blobs upload at the same time');
  assert.equal('GET git/commits/:sha' in s.byEndpoint, false, 'the parent commit is not fetched when the branch row carried its tree');
  assert.equal('GET git/trees/:sha' in s.byEndpoint, false, 'the parent tree is downloaded only for a delete');
});
