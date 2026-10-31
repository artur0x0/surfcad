import assert from 'node:assert/strict';
import test from 'node:test';
import { computeWallField } from './wallFieldJob.js';

function plate() {
  const positions = [
    0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0,
    0, 0, 2, 20, 0, 2, 20, 20, 2, 0, 20, 2,
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

function near(actual, expected, eps = 0.15) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
}

test('computeWallField reports the coarse field before the refined plate', () => {
  const seen = [];
  const refined = computeWallField(plate(), {
    onCoarse(coarse) {
      seen.push(coarse.wall.nominal);
      assert.equal(coarse.wall.sampleCount, 12);
    },
  });
  assert.deepEqual(seen, [refined.wall.nominal]);
  near(refined.wall.nominal, 2);
  assert.ok(refined.wall.max < 3.2, `max ${refined.wall.max}`);
  assert.equal(refined.kind, 'mold-analysis');
});

test('computeWallField skips the refined pass when the mesh is empty', () => {
  let coarse = false;
  const out = computeWallField({ positions: [], indices: [] }, {
    onCoarse() { coarse = true; },
  });
  assert.equal(coarse, false);
  assert.equal(out.error.code, 'no_mesh');
});
