import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry } from 'three';
import { FEA_LOAD_HIGHLIGHT_COLOR } from './faceHighlight.js';
import {
  FEA_LOAD_ARROW_NAME,
  LOAD_ARROW_LENGTH_SCALE,
  arrowCountForFace,
  createLoadArrows,
  faceArrowPlacements,
  loadArrowDirection,
} from './loadArrows.js';

function quad() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    10, 0, 0,
    10, 10, 0,
    0, 10, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

test('normal and inward-normal loads draw no arrows; axes and custom do', () => {
  const top = { n: [0, 0, 1] };
  assert.equal(loadArrowDirection({ kind: 'force', direction: 'normal', vector: [0, 0, 5] }, top), null);
  assert.equal(loadArrowDirection({ kind: 'force', direction: '-normal', vector: [0, 0, -5] }, top), null);
  assert.equal(loadArrowDirection({ kind: 'pressure', pressure_MPa: 2, faces: [top] }, top), null);
  assert.deepEqual(
    loadArrowDirection({ kind: 'force', direction: '-z', vector: [0, 0, -5] }, top),
    [0, 0, -1],
  );
  assert.deepEqual(
    loadArrowDirection({ kind: 'force', direction: '+x', vector: [5, 0, 0] }, top),
    [1, 0, 0],
  );
  const custom = loadArrowDirection({ kind: 'force', direction: 'custom', vector: [3, 4, 0] }, top);
  assert.ok(Math.abs(custom[0] - 0.6) < 1e-9);
  assert.ok(Math.abs(custom[1] - 0.8) < 1e-9);
  assert.equal(loadArrowDirection({ kind: 'force', vector: [0, 0, 5] }, top), null);
  assert.deepEqual(loadArrowDirection({ kind: 'force', vector: [0, -4, 0] }, top), [0, -1, 0]);
  assert.deepEqual(
    loadArrowDirection({ kind: 'pressure', direction: '+y', pressure_MPa: 1 }, top),
    [0, 1, 0],
  );
});

test('a coarse face gets 3 to 9 arrows scaled to the part, heads on the surface', () => {
  assert.equal(arrowCountForFace(100, 10), 7);
  assert.equal(arrowCountForFace(1, 100), 3);
  assert.equal(arrowCountForFace(10000, 10), 9);
  const geometry = quad();
  const down = faceArrowPlacements(geometry, [0, 1], [0, 0, -1]);
  assert.ok(down.length >= 3 && down.length <= 9, `count ${down.length}`);
  const length = 10 * LOAD_ARROW_LENGTH_SCALE;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const arrow of down) {
    assert.ok(Math.abs(arrow.tip[2]) < 1e-6);
    assert.ok(Math.abs(arrow.tail[2] - (arrow.tip[2] + length)) < 1e-6);
    assert.deepEqual(arrow.dir, [0, 0, -1]);
    assert.ok(Math.abs(arrow.length - length) < 1e-9);
    minX = Math.min(minX, arrow.tip[0]);
    maxX = Math.max(maxX, arrow.tip[0]);
    minY = Math.min(minY, arrow.tip[1]);
    maxY = Math.max(maxY, arrow.tip[1]);
  }
  assert.ok(maxX - minX > 1 || maxY - minY > 1, 'arrows spread across the face');
  const group = createLoadArrows(down, FEA_LOAD_HIGHLIGHT_COLOR);
  assert.equal(group.name, 'fea-load-arrows');
  assert.equal(group.children.length, down.length);
  assert.equal(group.children[0].name, FEA_LOAD_ARROW_NAME);
  assert.equal(group.children[0].children[0].material.color.getHex(), FEA_LOAD_HIGHLIGHT_COLOR);
  assert.equal(group.children[0].raycast(), undefined);
});
