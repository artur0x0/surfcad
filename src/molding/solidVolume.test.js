import assert from 'node:assert/strict';
import test from 'node:test';
import { solidVolumeCm3 } from './solidVolume.js';

/**
 * 20×10×5 box, 1 cm³. Vertices 0 (x0,y0,z0) through 7 (x1,y1,z1).
 * Bottom −Z, top +Z, then ±X and ±Y.
 */
function box20() {
  const positions = [
    0, 0, 0, 20, 0, 0, 20, 10, 0, 0, 10, 0,
    0, 0, 5, 20, 0, 5, 20, 10, 5, 0, 10, 5,
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

test('a 20×10×5 box is 1 cm³ either winding', () => {
  const { positions, indices } = box20();
  assert.equal(solidVolumeCm3(positions, indices), 1);
  const flipped = indices.map((value, i) => (i % 3 === 1 ? indices[i + 1] : i % 3 === 2 ? indices[i - 1] : value));
  assert.equal(solidVolumeCm3(positions, flipped), 1);
});

test('an empty mesh has no volume', () => {
  assert.equal(solidVolumeCm3([]), null);
  assert.equal(solidVolumeCm3([0, 0, 0, 1, 0, 0, 0, 1, 0]), null);
});
