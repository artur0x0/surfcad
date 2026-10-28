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
  // readFile(assembly) 1, then the part scripts in parallel, listTree 1 for
  // the mesh shas, one readBlob per mesh in parallel (PR 1 pinned
  // listTree + readBlob per mesh), then getBranch for the tip.
  const PARTS = 3;
  const MESHES = 3;
  assert.deepEqual(s.byMethod, {
    readFile: { n: 1 + PARTS, ms: s.byMethod.readFile.ms, failed: 0 },
    listTree: { n: 1, ms: s.byMethod.listTree.ms, failed: 0 },
    readBlob: { n: MESHES, ms: s.byMethod.readBlob.ms, failed: 0 },
    getBranch: { n: 1, ms: s.byMethod.getBranch.ms, failed: 0 },
  });
  assert.equal(s.calls, 3 + PARTS + MESHES);
  assert.equal(s.calls, 9, 'PR 1 pinned 12');
  assert.equal(peak, 3, 'the three scripts (and the three meshes) are read at the same time');
});

test('pin: a one-part Save after a seed commit is 6 adapter calls on the mock (planSave reads back every tip file); the seed is 5', async () => {
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
  // getBranch (tip), listTree (tip tree), then one read per file on the
  // tip: readFile(assembly), readFile(part), readBlob(mesh); then the
  // commit. compare is skipped because the stored tip equals the remote.
  assert.deepEqual(s.byMethod, {
    getBranch: { n: 1, ms: s.byMethod.getBranch.ms, failed: 0 },
    listTree: { n: 1, ms: s.byMethod.listTree.ms, failed: 0 },
    readFile: { n: 2, ms: s.byMethod.readFile.ms, failed: 0 },
    readBlob: { n: 1, ms: s.byMethod.readBlob.ms, failed: 0 },
    commitFiles: { n: 1, ms: s.byMethod.commitFiles.ms, failed: 0 },
  });
  assert.equal(s.calls, 6);
  assert.deepEqual(s.rows.map((r) => r.method), ['getBranch', 'listTree', 'readFile', 'readFile', 'readBlob', 'commitFiles']);
  // One mock commitFiles is a dozen HTTP calls on the real adapter; that is
  // what the HTTP counter is for. Here there is none.
  assert.equal(s.http, 0);
});
