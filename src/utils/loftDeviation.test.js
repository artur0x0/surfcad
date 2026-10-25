import assert from 'node:assert/strict';
import test from 'node:test';
import { pointTriangleDistance } from './loftDeviation.js';

test('point-to-triangle distance is zero on the face and the plane offset off it', () => {
  const a = [0, 0, 0];
  const b = [4, 0, 0];
  const c = [0, 4, 0];
  assert.ok(pointTriangleDistance([1, 1, 0], a, b, c) < 1e-9);
  const off = pointTriangleDistance([1, 1, 0.25], a, b, c);
  assert.ok(Math.abs(off - 0.25) < 1e-9, off);
  const corner = pointTriangleDistance([-1, -1, 0], a, b, c);
  assert.ok(Math.abs(corner - Math.SQRT2) < 1e-9, corner);
});
