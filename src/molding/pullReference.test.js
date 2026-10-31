import assert from 'node:assert/strict';
import test from 'node:test';
import { MOLD_PULL_PLANES, sharedPullVector, unitPull } from './pullReference.js';

test('origin planes are the positive axes', () => {
  assert.deepEqual(MOLD_PULL_PLANES.top.normal, [0, 0, 1]);
  assert.deepEqual(MOLD_PULL_PLANES.front.normal, [0, 1, 0]);
  assert.deepEqual(MOLD_PULL_PLANES.right.normal, [1, 0, 0]);
});

test('shared pull searches in auto and keeps a face normal', () => {
  assert.equal(sharedPullVector({ mode: 'auto', pull: [0, 0, 1] }), null);
  assert.equal(sharedPullVector(null), null);
  assert.deepEqual(sharedPullVector({ mode: 'face', pull: [0, 0, 2] }), [0, 0, 1]);
  assert.equal(unitPull([0, 0, 0]), null);
});
