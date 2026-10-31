import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection, analyzeWallOnly, moldFitScore } from './pullDirection.js';

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

test('a zero pull is bad_args and an empty mesh is no_mesh', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const zero = analyzePullDirection({ ...mesh, pull: [0, 0, 0] });
  assert.equal(zero.error.code, 'bad_args');
  const empty = analyzePullDirection({ positions: [], indices: [] });
  assert.equal(empty.error.code, 'no_mesh');
});
