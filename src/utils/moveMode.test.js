import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachMoveTargetMesh,
  composeMoveCommit,
  findMeshBodyForMoveAnchor,
  movePreviewOffset,
} from './moveMode.js';

const committed = composeMoveCommit('', { body: 'part', target: { at: [0, 0, 0] }, dx: 0, dy: 0, dz: 3 }).buffer;

test('a body that already carries a committed move matches its script anchor', () => {
  // The script says move(part, [0,0,3], { bodies: [{ at: [0,0,0] }] }); the
  // mesh body therefore sits at [0,0,3]. Re-opening the Move card resolves
  // the script anchor [0,0,0] to that body.
  const bodies = [{ at: [0, 0, 3], minTri: 0, triangles: [0, 1, 2] }];
  const hit = findMeshBodyForMoveAnchor(bodies, [0, 0, 0], [[0, 0, 3]], committed);
  assert.ok(hit, 'the moved body is the target');
  assert.deepEqual(hit.triangles, [0, 1, 2]);
  const target = attachMoveTargetMesh({ at: [0, 0, 0] }, bodies, [[0, 0, 3]], committed);
  assert.deepEqual(target.at, [0, 0, 0], 'the target keeps the pre-move anchor the script names');
  assert.deepEqual(target.triangles, [0, 1, 2]);
});

test('the ghost offset for a re-opened move is the change, not the whole move', () => {
  const bodies = [{ at: [0, 0, 3], minTri: 0, triangles: [0, 1, 2] }];
  const target = attachMoveTargetMesh({ at: [0, 0, 0] }, bodies, [[0, 0, 3]], committed);
  const seeded = { direction: 'xyz', target, dx: 0, dy: 0, dz: 3 };
  assert.equal(movePreviewOffset(seeded, committed).every((v) => v === 0), true, 'no ghost until a delta changes');
  const typed = { ...seeded, dx: 10 };
  assert.deepEqual(movePreviewOffset(typed, committed), [10, 0, 0]);
});

test('a body with no committed move still matches by its centroid', () => {
  const bodies = [{ at: [5, 0, 0], minTri: 0, triangles: [3] }];
  const hit = findMeshBodyForMoveAnchor(bodies, [5, 0, 0], [[5, 0, 0]], '');
  assert.ok(hit);
  assert.deepEqual(hit.triangles, [3]);
});

test('a tapped (post-move) anchor still finds the moved body', () => {
  const bodies = [{ at: [0, 0, 3], minTri: 0, triangles: [0] }];
  const hit = findMeshBodyForMoveAnchor(bodies, [0, 0, 3], [[0, 0, 3]], committed);
  assert.ok(hit);
});

test('a far body is not the target', () => {
  const bodies = [{ at: [40, 0, 0], minTri: 9, triangles: [9] }];
  assert.equal(findMeshBodyForMoveAnchor(bodies, [0, 0, 0], [[40, 0, 0]], committed), null);
  assert.equal(findMeshBodyForMoveAnchor(bodies, [0, 0, 0], [[40, 0, 0]], ''), null);
});
