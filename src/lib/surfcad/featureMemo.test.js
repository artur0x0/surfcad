import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topLevelDeclarations, planMemo, memoKey, FeatureMemo, featureMemoBudgetBytes, MEMO_CAPTURE, MEMO_RESTORE } from './featureMemo.js';
import { runScript, clearFeatureMemo, featureMemoStats, configureFeatureMemo } from './index.js';
import { instrumentFeatureBlocks } from '../../utils/featureFailure.js';

// ─── scanner ────────────────────────────────────────────────────────────────

test('topLevelDeclarations: top-level names only, nesting and literals skipped', () => {
  const src = [
    '// let shadow = 1',
    'const a = 1, b = f(1, 2), c = "let d = 2";',
    'let part = Manifold.cube([1, 1, 1]).translate([0, 0, 1])',
    '  .translate([1, 0, 0]);',
    'const mk = (x) => { let inner = x; return inner; };',
    'function helper(q) { const local = q; return local; }',
    'const tpl = `a ${ (() => { let t = 1; return t; })() } b`;',
    'const re = /let notme/g;',
    'for (let i = 0; i < 2; i += 1) { part = part.add(mk(i)); }',
    'var late;',
    'return part;',
  ].join('\n');
  const { decls, unsupported } = topLevelDeclarations(src);
  assert.deepEqual(decls.map((d) => [d.name, d.kind]), [
    ['a', 'const'], ['b', 'const'], ['c', 'const'], ['part', 'let'], ['mk', 'const'],
    ['helper', 'function'], ['tpl', 'const'], ['re', 'const'], ['late', 'var'],
  ]);
  assert.deepEqual(unsupported, []);
});

test('topLevelDeclarations: destructuring, class and a nested var are reported, not guessed', () => {
  const { decls, unsupported } = topLevelDeclarations('const { a, b } = o;\nclass K {}\nif (x) { var y = 1; }\nlet z = 2;');
  assert.deepEqual(decls.map((d) => d.name), ['z']);
  assert.deepEqual(unsupported.map((u) => u.reason), ['destructuring', 'class declaration', 'var below top level']);
});

// ─── planning ───────────────────────────────────────────────────────────────

const THREE = [
  '// @surf-id abc',
  'const extra = [];',
  '// --- cube begin id=cube1 ---',
  'let part = Manifold.cube([10, 10, 10], true);',
  '// --- cube end ---',
  '// --- cylinder begin id=cyl1 ---',
  'const post = Manifold.cylinder(30, 1, 1, 12, true);',
  'extra.push(2);',
  'part = part.add(post);',
  '// --- cylinder end ---',
  '// --- cube begin id=cube2 ---',
  'part = part.add(Manifold.cube([4, 4, 4], true).translate([extra[0] * 10, 0, 0]));',
  '// --- cube end ---',
  'return part;',
  '',
].join('\n');

test('planMemo: a cold plan captures every block on its end-marker line and keeps the line count', () => {
  const plan = planMemo(THREE, { lookup: () => null });
  assert.equal(plan.hits, 0);
  assert.equal(plan.blocks.length, 3);
  assert.ok(plan.blocks.every((b) => b.cacheable), JSON.stringify(plan.blocks.map((b) => b.reason)));
  assert.equal(plan.text.split('\n').length, THREE.split('\n').length);
  assert.match(plan.text, new RegExp(`;${MEMO_CAPTURE}\\(0,\\(\\)=>\\(\\{extra:extra,part:part\\}\\)\\);// --- cube end ---`));
  assert.match(plan.text, new RegExp(`;${MEMO_CAPTURE}\\(1,\\(\\)=>\\(\\{extra:extra,part:part,post:post\\}\\)\\);// --- cylinder end ---`));
  // The copy still instruments: ids and markers are untouched.
  const traced = instrumentFeatureBlocks(plan.text);
  assert.deepEqual(traced.features.map((f) => f.id), ['cube1', 'cyl1', 'cube2']);
  assert.notEqual(plan.blocks[0].key, plan.blocks[1].key);
  assert.equal(plan.blocks[0].key, memoKey(THREE.slice(0, plan.blocks[0].end), ''));
});

test('planMemo: hits replace the interior with a restore stub, relax outer const, capture the rest', () => {
  const cold = planMemo(THREE, { lookup: () => null });
  const fakeEntry = (b) => ({ blockIndex: b.index, names: b.names.map((row) => ({ ...row, restore: true })) });
  const entries = new Map(cold.blocks.slice(0, 2).map((b) => [b.key, fakeEntry(b)]));
  const warm = planMemo(THREE, { lookup: (k) => entries.get(k) || null });
  assert.equal(warm.hits, 2);
  const lines = warm.text.split('\n');
  assert.equal(lines.length, THREE.split('\n').length);
  assert.equal(lines[1], 'let   extra = [];');
  assert.equal(lines[3], `const __memo0 = ${MEMO_RESTORE}(0); extra = __memo0.extra; let part = __memo0.part;`);
  assert.equal(lines[6], `const __memo1 = ${MEMO_RESTORE}(1); extra = __memo1.extra; part = __memo1.part; let post = __memo1.post;`);
  assert.equal(lines[7], '');
  assert.equal(lines[8], '');
  assert.match(lines[12], new RegExp(`^;${MEMO_CAPTURE}\\(2,`));
  // Only the executed block captures.
  assert.equal((warm.text.match(new RegExp(MEMO_CAPTURE, 'g')) || []).length, 1);
});

test('planMemo: an impure block and everything after it are not cacheable; a function in a block stops there', () => {
  const impure = THREE.replace('extra.push(2);', 'extra.push(Math.random());');
  const plan = planMemo(impure, { lookup: () => null });
  assert.deepEqual(plan.blocks.map((b) => b.cacheable), [true, false, false]);
  assert.match(plan.blocks[1].reason, /clock, randomness/);
  const fn = THREE.replace('extra.push(2);', 'function bump() { return 2; }\nextra.push(bump());');
  const plan2 = planMemo(fn, { lookup: () => null });
  assert.deepEqual(plan2.blocks.map((b) => b.cacheable), [true, false, false]);
});

test('featureMemoBudgetBytes follows deviceMemory within 64..512 MiB', () => {
  const MIB = 1024 * 1024;
  assert.equal(featureMemoBudgetBytes({}), 128 * MIB);
  assert.equal(featureMemoBudgetBytes({ deviceMemory: 0.5 }), 64 * MIB);
  assert.equal(featureMemoBudgetBytes({ deviceMemory: 4 }), 256 * MIB);
  assert.equal(featureMemoBudgetBytes({ deviceMemory: 32 }), 512 * MIB);
});

test('FeatureMemo: LRU eviction frees the oldest entries first and a run over budget stores nothing', () => {
  const freed = [];
  const fakeHandle = (n) => ({ n, delete() { freed.push(n); this.dead = true; }, isDeleted() { return !!this.dead; }, clone() { return fakeHandle(`${n}'`); }, numTri() { return 100; }, numVert() { return 100; } });
  const memo = new FeatureMemo({ budgetBytes: 10_000 });
  const mk = (key, i) => memo.capture({ key, blockIndex: i, names: [{ name: 'part', inBlock: true, here: true }], values: { part: fakeHandle(key) }, state: {} });
  memo.commit([mk('a0', 0), mk('a1', 1)]);
  const per = memo.bytes / 2;
  assert.ok(per > 1000 && per < 5000, String(per));
  memo.lookup('a0'); // a0 is now the most recent
  memo.commit([mk('b0', 0), mk('b1', 1), mk('b2', 2)]);
  assert.ok(memo.bytes <= 10_000);
  assert.ok(!memo.entries.has('a1'), 'a1 evicted first');
  assert.ok(freed.some((n) => String(n).startsWith('a1')));
  const tiny = new FeatureMemo({ budgetBytes: 10 });
  const res = tiny.commit([mk('c0', 0)]);
  assert.equal(res.reason, 'over_budget');
  assert.equal(tiny.entries.size, 0);
});

// ─── the real kernel ────────────────────────────────────────────────────────

/** Mesh and side tables in a form two runs can be compared in: originalIDs are relabelled by first appearance. */
function canon(run) {
  const mesh = run.mesh;
  const map = new Map();
  const label = (id) => {
    if (id < 0) return id;
    if (!map.has(id)) map.set(id, map.size);
    return map.get(id);
  };
  const runOriginalID = mesh.runOriginalID.map(label);
  return {
    volume: Math.round(run.volume * 1e6) / 1e6,
    numProp: mesh.numProp,
    vertProperties: Array.from(mesh.vertProperties),
    triVerts: Array.from(mesh.triVerts),
    runIndex: Array.from(mesh.runIndex),
    faceID: mesh.faceID ? Array.from(mesh.faceID) : null,
    runOriginalID,
    runFeature: mesh.runFeature.map((k) => (k < 0 ? k : label(k))),
    featureTessellation: mesh.featureTessellation.map((row) => ({ ...row, source: row.source < 0 ? row.source : label(row.source) })),
    faceStamps: mesh.faceStamps.map((row) => ({ ...row, originalID: label(row.originalID) })),
  };
}

const PART = [
  '// @surf-id memo-test',
  'const bosses = [];',
  '// --- cube begin id=base ---',
  'let part = Manifold.cube([40, 30, 10], true);',
  '// --- cube end ---',
  '// --- cylinder begin id=boss ---',
  'const boss = Manifold.cylinder(14, 6, 6, 32, true).translate([10, 0, 7]);',
  'bosses.push([10, 0]);',
  'part = part.add(boss);',
  '// --- cylinder end ---',
  '// --- hole begin id=h1 ---',
  'part = part.subtract(Manifold.cylinder(20, 2.5, 2.5, 24, true).translate([bosses[0][0], bosses[0][1], 10]));',
  '// --- hole end ---',
  '// --- chamfer-mode begin id=ch1 ---',
  'part = chamferEdges(part, edgesOf(part, "base.top"), 1.5);',
  '// --- chamfer-mode end ---',
  '// --- cube begin id=tab ---',
  'part = part.add(Manifold.cube([6, 6, 6], true).translate([-23, 0, 0]));',
  '// --- cube end ---',
  'return part;',
  '',
].join('\n');

test('kernel: a rerun with nothing changed executes no block and returns the same mesh', async () => {
  clearFeatureMemo();
  const cold = await runScript(PART, { partId: 'p1' });
  assert.equal(cold.featureCache.hits, 0);
  assert.equal(cold.featureCache.stored, 5, JSON.stringify(cold.featureCache));
  assert.ok(cold.featureTimings.every((row) => row.cached !== true));
  const warm = await runScript(PART, { partId: 'p1' });
  assert.equal(warm.featureCache.hits, 5, JSON.stringify(warm.featureCache));
  assert.deepEqual(warm.featureTimings.map((row) => [row.id, row.cached === true, row.ms]), [
    ['base', true, 0], ['boss', true, 0], ['h1', true, 0], ['ch1', true, 0], ['tab', true, 0],
  ]);
  assert.deepEqual(canon(warm), canon(cold));
  assert.ok(warm.mesh.faceStamps.some((row) => row.feature === 'base'), 'face names survive a cache hit');
  cold.manifold?.delete?.();
  warm.manifold?.delete?.();
});

test('kernel: changing block k re-runs k and after; the result equals a cold run of the new script', async () => {
  clearFeatureMemo();
  const first = await runScript(PART, { partId: 'p2' });
  const edited = PART.replace('2.5, 2.5, 24', '3, 3, 24');
  const warm = await runScript(edited, { partId: 'p2' });
  assert.equal(warm.featureCache.hits, 2, JSON.stringify(warm.featureCache));
  assert.deepEqual(warm.featureTimings.map((row) => row.cached === true), [true, true, false, false, false]);
  clearFeatureMemo();
  const cold = await runScript(edited, { partId: 'p2' });
  assert.equal(cold.featureCache.hits, 0);
  assert.deepEqual(canon(warm), canon(cold));
  assert.notDeepEqual(canon(first).volume, canon(cold).volume);
  first.manifold?.delete?.();
  warm.manifold?.delete?.();
  cold.manifold?.delete?.();
});

test('kernel: an edit to the first block re-runs everything; undo of the edit hits the old entries', async () => {
  clearFeatureMemo();
  const a = await runScript(PART, { partId: 'p3' });
  const edited = PART.replace('[40, 30, 10]', '[42, 30, 10]');
  const b = await runScript(edited, { partId: 'p3' });
  assert.equal(b.featureCache.hits, 0);
  const c = await runScript(PART, { partId: 'p3' });
  assert.equal(c.featureCache.hits, 5, 'the entries of the original script are still there');
  assert.deepEqual(canon(c), canon(a));
  for (const r of [a, b, c]) r.manifold?.delete?.();
});

test('kernel: a block that throws is not cached, the blocks before it are, and the fixed script hits them', async () => {
  clearFeatureMemo();
  const broken = PART.replace('Manifold.cylinder(20, 2.5, 2.5, 24, true)', 'noSuchTool');
  const run = await runScript(broken, { partId: 'p4' });
  assert.equal(run.featureSkip?.featureId, 'h1');
  const stats = featureMemoStats();
  assert.ok(stats.entries >= 2, JSON.stringify(stats));
  const fixed = await runScript(PART, { partId: 'p4' });
  assert.equal(fixed.featureCache.hits, 2, JSON.stringify(fixed.featureCache));
  clearFeatureMemo();
  const cold = await runScript(PART, { partId: 'p4' });
  assert.deepEqual(canon(fixed), canon(cold));
  for (const r of [run, fixed, cold]) r.manifold?.delete?.();
});

test('kernel: rollback_to replays the prefix from the cache', async () => {
  clearFeatureMemo();
  const full = await runScript(PART, { partId: 'p5' });
  const rolled = await runScript(PART, { partId: 'p5', rollbackAnchor: 'boss' });
  assert.deepEqual(rolled.rolledBack, ['h1', 'ch1', 'tab']);
  assert.equal(rolled.featureCache.hits, 2, JSON.stringify(rolled.featureCache));
  clearFeatureMemo();
  const cold = await runScript(PART, { partId: 'p5', rollbackAnchor: 'boss' });
  assert.deepEqual(canon(rolled), canon(cold));
  for (const r of [full, rolled, cold]) r.manifold?.delete?.();
});

test('kernel: an impure block runs every time and is reported; eviction only costs time', async () => {
  clearFeatureMemo();
  const impure = PART.replace('bosses.push([10, 0]);', 'bosses.push([10, Math.round(Math.random() * 0)]);');
  const a = await runScript(impure, { partId: 'p6' });
  assert.equal(a.featureCache.uncacheable?.id, 'boss');
  const b = await runScript(impure, { partId: 'p6' });
  assert.equal(b.featureCache.hits, 1);
  assert.deepEqual(canon(b), canon(a));
  configureFeatureMemo({ budgetBytes: 1 });
  clearFeatureMemo();
  const c = await runScript(PART, { partId: 'p7' });
  assert.equal(c.featureCache.dropped, 'over_budget');
  assert.equal(featureMemoStats().entries, 0);
  configureFeatureMemo({ budgetBytes: 128 * 1024 * 1024 });
  clearFeatureMemo();
  const d = await runScript(PART, { partId: 'p7' });
  assert.deepEqual(canon(d), canon(c));
  for (const r of [a, b, c, d]) r.manifold?.delete?.();
});
