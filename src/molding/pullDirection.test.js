import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection, analyzeWallOnly, moldFitScore, MOLD_DIRECTION_DEDUP_DEG } from './pullDirection.js';

function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  return { positions, indices };
}

function appendMesh(dstPos, dstIdx, src, flip) {
  const base = dstPos.length / 3;
  for (let i = 0; i < src.positions.length; i++) dstPos.push(src.positions[i]);
  for (let t = 0; t < src.indices.length; t += 3) {
    const a = src.indices[t] + base;
    const b = src.indices[t + 1] + base;
    const c = src.indices[t + 2] + base;
    if (flip) dstIdx.push(a, c, b);
    else dstIdx.push(a, b, c);
  }
}

function addShelf(positions, indices, x0, x1, y0, y1, z) {
  const base = positions.length / 3;
  positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/**
 * Outer box, a closed inner void, and three horizontal shelves.
 * Sideways pulls see only the void's two caps (fixable). A Z pull also
 * sees each shelf, which crosses into not_a_fit.
 */
function lockedPart() {
  const positions = [];
  const indices = [];
  appendMesh(positions, indices, boxMesh([0, 0, 0], [20, 20, 20]), false);
  appendMesh(positions, indices, boxMesh([8, 8, 8], [12, 12, 12]), true);
  addShelf(positions, indices, 1, 4, 1, 4, 4);
  addShelf(positions, indices, 15, 18, 1, 4, 10);
  addShelf(positions, indices, 1, 4, 15, 18, 16);
  return { positions, indices };
}

test('moldFitScore bands are good, fixable, and not_a_fit', () => {
  assert.equal(moldFitScore(0), 'good');
  assert.equal(moldFitScore(1), 'fixable');
  assert.equal(moldFitScore(4), 'fixable');
  assert.equal(moldFitScore(5), 'not_a_fit');
});

test('wall-only analysis returns thickness and does not score a pull', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const result = analyzeWallOnly(mesh);
  assert.equal(result.kind, 'mold-analysis');
  assert.equal(result.version, 1);
  assert.equal(result.fit, undefined);
  assert.equal(result.pull, undefined);
  assert.equal(result.wall.nominal, 10);
  assert.equal(result.wall.max, 10);
  assert.equal(result.wall.field.length, 12);
  assert.equal(result.sideActions, undefined);
});

test('a box searches to a good fit along +Z', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const result = analyzePullDirection(mesh);
  assert.equal(result.fit, 'good');
  assert.equal(result.undercutCount, 0);
  assert.deepEqual(result.pull, [0, 0, 1]);
  assert.equal(result.pullSource, 'search');
  assert.equal(result.kind, 'mold-analysis');
  assert.equal(result.normals.triangle, 12);
  assert.equal(result.normals.stamped, 0);
  assert.equal(result.sideActions.count, 0);
  assert.equal(result.sideActions.heuristic, true);
  assert.equal(result.sideActions.slideCount, 0);
  assert.equal(result.sideActions.lifterCount, 0);
  assert.ok(result.candidates.some((row) => row.pull[0] === 1 && row.undercutCount === 0));
});

test('a void plus shelves is fixable on the best pull', () => {
  const result = analyzePullDirection(lockedPart());
  assert.equal(result.error, undefined);
  assert.equal(result.fit, 'fixable');
  assert.equal(result.undercutCount, 2);
  assert.deepEqual(result.pull, [0, 1, 0]);
  assert.equal(result.pullSource, 'search');
});

test('an override pull re-scores and can change the fit', () => {
  const mesh = lockedPart();
  const searched = analyzePullDirection(mesh);
  const overridden = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  assert.equal(searched.fit, 'fixable');
  assert.equal(overridden.fit, 'not_a_fit');
  assert.equal(overridden.undercutCount, 5);
  assert.deepEqual(overridden.pull, [0, 0, 1]);
  assert.equal(overridden.pullSource, 'override');
  assert.equal(overridden.candidates.length, 1);
  const flipped = analyzePullDirection({ ...mesh, pull: [0, 0, -2] });
  assert.deepEqual(flipped.pull, [0, 0, -1]);
  assert.equal(flipped.undercutCount, overridden.undercutCount);
  assert.notEqual(overridden.fit, searched.fit);
});

test('a stamped face normal wins, and a cancelled stamp falls back to the triangle', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const triFace = new Int32Array(12).fill(-1);
  triFace[2] = 0;
  triFace[3] = 0;
  const flipped = analyzePullDirection({
    ...mesh,
    pull: [0, 0, 1],
    stamped: { triFace, normals: [[0, 0, -1]] },
  });
  assert.equal(flipped.fit, 'fixable');
  assert.equal(flipped.undercutCount, 1);
  assert.equal(flipped.normals.stamped, 2);
  assert.equal(flipped.normals.triangle, 10);
  const cancelled = analyzePullDirection({
    ...mesh,
    pull: [0, 0, 1],
    stamped: { triFace, normals: [[0, 0, 0]] },
  });
  assert.equal(cancelled.fit, 'good');
  assert.equal(cancelled.undercutCount, 0);
  assert.equal(cancelled.normals.stamped, 0);
  assert.equal(cancelled.normals.triangle, 12);
});

function addLoop(positions, loop, z) {
  const base = positions.length / 3;
  for (const [x, y] of loop) positions.push(x, y, z);
  return base;
}

function capLoop(indices, base, n, up) {
  for (let i = 1; i < n - 1; i++) {
    if (up) indices.push(base, base + i, base + i + 1);
    else indices.push(base, base + i + 1, base + i);
  }
}

function wallLoop(indices, bottom, top, n, out) {
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (out) indices.push(bottom + i, bottom + j, top + j, bottom + i, top + j, top + i);
    else indices.push(bottom + i, top + j, bottom + j, bottom + i, top + i, top + j);
  }
}

function annulus(indices, outer, inner, n, up) {
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) {
      indices.push(outer + i, outer + j, inner + j, outer + i, inner + j, inner + i);
    } else {
      indices.push(outer + i, inner + j, outer + j, outer + i, inner + i, inner + j);
    }
  }
}

/** Solid open tray: 1.85 mm walls, filleted plan, floor, no lid. */
function openTray() {
  const wall = 1.85;
  const height = 8;
  const outer = [
    [3, 0], [17, 0], [20, 3], [20, 13], [17, 16], [3, 16], [0, 13], [0, 3],
  ];
  const inner = [
    [3, wall], [17, wall], [20 - wall, 3], [20 - wall, 13],
    [17, 16 - wall], [3, 16 - wall], [wall, 13], [wall, 3],
  ];
  const positions = [];
  const indices = [];
  const n = outer.length;
  const bottom = addLoop(positions, outer, 0);
  const floor = addLoop(positions, inner, wall);
  const rimOut = addLoop(positions, outer, height);
  const rimIn = addLoop(positions, inner, height);
  capLoop(indices, bottom, n, false);
  capLoop(indices, floor, n, true);
  wallLoop(indices, bottom, rimOut, n, true);
  wallLoop(indices, floor, rimIn, n, false);
  annulus(indices, rimOut, rimIn, n, true);
  return { positions, indices };
}

/** Solid cup, open rim larger than the floor, 1.5 mm walls. */
function draftedCup() {
  const positions = [];
  const indices = [];
  const outerBottom = [[1, 1], [13, 1], [13, 13], [1, 13]];
  const outerTop = [[0, 0], [14, 0], [14, 14], [0, 14]];
  const innerBottom = [[2.5, 2.5], [11.5, 2.5], [11.5, 11.5], [2.5, 11.5]];
  const innerTop = [[1.5, 1.5], [12.5, 1.5], [12.5, 12.5], [1.5, 12.5]];
  const n = 4;
  const ob = addLoop(positions, outerBottom, 0);
  const ib = addLoop(positions, innerBottom, 1.5);
  const ot = addLoop(positions, outerTop, 12);
  const it = addLoop(positions, innerTop, 12);
  capLoop(indices, ob, n, false);
  capLoop(indices, ib, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  annulus(indices, ot, it, n, true);
  return { positions, indices };
}

/** Block with a rectangular through hole along Z. */
function throughHole() {
  const positions = [];
  const indices = [];
  const outer = [[0, 0], [20, 0], [20, 16], [0, 16]];
  const inner = [[6, 4], [14, 4], [14, 12], [6, 12]];
  const n = 4;
  const ob = addLoop(positions, outer, 0);
  const ib = addLoop(positions, inner, 0);
  const ot = addLoop(positions, outer, 12);
  const it = addLoop(positions, inner, 12);
  annulus(indices, ob, ib, n, false);
  annulus(indices, ot, it, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  return { positions, indices };
}

/** Plate with a barb that hooks downward. */
function snapHook() {
  const positions = [];
  const indices = [];
  appendMesh(positions, indices, boxMesh([0, 0, 0], [2, 10, 12]), false);
  appendMesh(positions, indices, boxMesh([2, 3, 8], [8, 7, 10]), false);
  addShelf(positions, indices, 6, 8, 3, 7, 6);
  return { positions, indices };
}

test('icosphere candidates stay between 80 and 320 and 5 degrees apart', () => {
  const result = analyzePullDirection(boxMesh([0, 0, 0], [10, 10, 10]));
  assert.ok(result.candidates.length >= 80, `count ${result.candidates.length}`);
  assert.ok(result.candidates.length <= 320, `count ${result.candidates.length}`);
  const limit = Math.cos((MOLD_DIRECTION_DEDUP_DEG * Math.PI) / 180) + 1e-6;
  for (let i = 0; i < result.candidates.length; i++) {
    for (let j = i + 1; j < result.candidates.length; j++) {
      const a = result.candidates[i].pull;
      const b = result.candidates[j].pull;
      const aligned = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
      assert.ok(aligned <= limit, `${aligned} ${a} ${b}`);
    }
  }
  assert.ok(result.candidates.some((row) => row.pull[0] === 1 && row.pull[1] === 0 && row.pull[2] === 0));
});

test('a flat plate prefers the pull through the large faces', () => {
  const result = analyzePullDirection(boxMesh([0, 0, 0], [20, 20, 2]));
  assert.equal(result.fit, 'good');
  assert.equal(result.undercutArea, 0);
  assert.deepEqual(result.pull, [0, 0, 1]);
  assert.ok(result.draftedArea > 700);
});

test('an open filleted tray pulls straight out the top', () => {
  const result = analyzePullDirection(openTray());
  assert.equal(result.error, undefined);
  assert.equal(result.fit, 'good');
  assert.equal(result.undercutCount, 0);
  assert.deepEqual(result.pull, [0, 0, 1]);
});

test('a drafted cup pulls out the rim', () => {
  const result = analyzePullDirection(draftedCup());
  assert.equal(result.fit, 'good');
  assert.equal(result.undercutCount, 0);
  assert.deepEqual(result.pull, [0, 0, 1]);
});

test('a through hole along Z pulls cleanly out the hole', () => {
  const result = analyzePullDirection(throughHole());
  assert.equal(result.fit, 'good');
  assert.equal(result.undercutCount, 0);
  assert.deepEqual(result.pull, [0, 0, 1]);
});

test('search undercut area is no worse than the Z axis on a snap hook', () => {
  const mesh = snapHook();
  const searched = analyzePullDirection(mesh);
  const alongZ = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  assert.equal(searched.error, undefined);
  assert.ok(alongZ.undercutArea > 0);
  assert.ok(searched.undercutArea <= alongZ.undercutArea + 1e-4);
});

test('a zero pull is bad_args and an empty mesh is no_mesh', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const zero = analyzePullDirection({ ...mesh, pull: [0, 0, 0] });
  assert.equal(zero.error.code, 'bad_args');
  const empty = analyzePullDirection({ positions: [], indices: [] });
  assert.equal(empty.error.code, 'no_mesh');
});
