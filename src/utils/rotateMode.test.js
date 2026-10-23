import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeRotateCommit,
  emptyRotateState,
  parseLastRotate,
  resolveRotateBodyAt,
  rotateBodyWorldAt,
  rotatePreviewMap,
  rotationMatrix,
  rotatePoint,
  seedRotateFromLastRotate,
  stripRotateBlock,
  validateRotateAccept,
} from './rotateMode.js';
import { ROTATE_BEGIN, ROTATE_END } from './helperPaletteSnippets.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-9) => a.length === 3 && b.length === 3 && a.every((v, i) => near(v, b[i], eps));

test('confirm needs a body, an axis, and a finite angle', () => {
  const noBody = validateRotateAccept({ ...emptyRotateState(), angle: 30 });
  assert.equal(noBody.ok, false);
  assert.match(noBody.message, /Double-click a body/);
  const noFace = validateRotateAccept({ ...emptyRotateState(), target: { at: [0, 0, 0] }, axis: 'face', angle: 30 });
  assert.equal(noFace.ok, false);
  assert.match(noFace.message, /face/);
  const zeroAxis = validateRotateAccept({ ...emptyRotateState(), target: { at: [0, 0, 0] }, axis: 'custom', axisVec: [0, 0, 0], angle: 30 });
  assert.equal(zeroAxis.ok, false);
  const badAngle = validateRotateAccept({ ...emptyRotateState(), target: { at: [0, 0, 0] }, angle: 'x' });
  assert.equal(badAngle.ok, false);
  const badCenter = validateRotateAccept({ ...emptyRotateState(), target: { at: [0, 0, 0] }, angle: 30, centerMode: 'custom', center: [1, 'q', 3] });
  assert.equal(badCenter.ok, false);
  const zero = validateRotateAccept({ ...emptyRotateState(), target: { at: [0, 0, 0] }, angle: 0 });
  assert.equal(zero.ok, true, 'a zero angle is a real rotate, like a zero move');
});

test('composeRotateCommit writes one named-body rotateAbout and replaces its block', () => {
  const first = composeRotateCommit('let part = Manifold.cube([10, 10, 10], true);', {
    ...emptyRotateState(), target: { at: [1, 2, 3] }, axis: 'z', angle: 30,
  });
  assert.equal(first.ok, true, first.message);
  assert.ok(first.buffer.includes("part = rotateAbout(part, 'z', 30, null, { bodies: [{ at: [1, 2, 3] }] });"), first.buffer);
  assert.ok(first.buffer.includes(ROTATE_BEGIN) && first.buffer.includes(ROTATE_END));
  assert.equal((first.buffer.match(/\brotateAbout\s*\(/g) || []).length, 1);

  const again = composeRotateCommit(first.buffer, {
    ...emptyRotateState(), target: { at: [1, 2, 3], minTri: 7 }, axis: 'custom', axisVec: [1, 1, 0], angle: -45,
    centerMode: 'custom', center: [10, 0, 0],
  });
  assert.equal(again.ok, true, again.message);
  assert.equal((again.buffer.match(/\brotateAbout\s*\(/g) || []).length, 1);
  assert.equal((again.buffer.match(/rotate begin/g) || []).length, 1);
  assert.ok(again.buffer.includes('rotateAbout(part, [0.7071, 0.7071, 0], -45, [10, 0, 0], { bodies: [{ at: [1, 2, 3], tri: 7 }] });'), again.buffer);
  assert.ok(!again.buffer.includes("'z', 30"));

  const faced = composeRotateCommit('let part = Manifold.cube([10, 10, 10], true);', {
    ...emptyRotateState(), target: { at: [0, 0, 0] }, axis: 'face', faceNormal: [0, 2, 0], angle: 90,
  });
  assert.equal(faced.ok, true, faced.message);
  assert.ok(faced.buffer.includes('rotateAbout(part, [0, 1, 0], 90, null,'), faced.buffer);
});

test('parseLastRotate reads the block back and stripRotateBlock removes it', () => {
  const buf = composeRotateCommit('let part = Manifold.cube([10, 10, 10], true);', {
    ...emptyRotateState(), target: { at: [1, 2, 3] }, axis: 'x', angle: 15, centerMode: 'custom', center: [0, 5, 0],
  }).buffer;
  const prev = parseLastRotate(buf);
  assert.deepEqual(prev, { axis: 'x', angle: 15, center: [0, 5, 0], at: [1, 2, 3], tri: null });
  const stripped = stripRotateBlock(buf);
  assert.ok(!stripped.includes('rotateAbout'));
  assert.ok(stripped.includes('Manifold.cube'));
  assert.equal(parseLastRotate('let part = 1;'), null);
  const vec = parseLastRotate(`${ROTATE_BEGIN}\npart = rotateAbout(part, [0, 0, 1], 90, null, { bodies: [{ at: [4, 5, 6], tri: 12 }] });\n${ROTATE_END}`);
  assert.deepEqual(vec, { axis: [0, 0, 1], angle: 90, center: null, at: [4, 5, 6], tri: 12 });
});

test('rotationMatrix turns right-handed and rotatePoint pivots about the center', () => {
  const R = rotationMatrix([0, 0, 1], 90);
  assert.ok(vecNear(rotatePoint(R, [1, 0, 0], [0, 0, 0]), [0, 1, 0]));
  assert.ok(vecNear(rotatePoint(R, [2, 0, 0], [1, 0, 0]), [1, 1, 0]));
  const Rx = rotationMatrix([1, 0, 0], 90);
  assert.ok(vecNear(rotatePoint(Rx, [0, 1, 0], [0, 0, 0]), [0, 0, 1]));
});

test('a body turned about another point keeps its pre-rotate anchor for the next confirm', () => {
  const buf = `${ROTATE_BEGIN}\npart = rotateAbout(part, 'z', 90, [0, 0, 0], { bodies: [{ at: [10, 0, 0] }] });\n${ROTATE_END}\nreturn part;\n`;
  const world = rotateBodyWorldAt([10, 0, 0], buf);
  assert.ok(vecNear(world, [0, 10, 0]), JSON.stringify(world));
  const resolved = resolveRotateBodyAt([0, 10, 0], [[0, 10, 0]], buf);
  assert.ok(vecNear(resolved, [10, 0, 0]), JSON.stringify(resolved));
  const other = resolveRotateBodyAt([40, 0, 0], [[0, 10, 0], [40, 0, 0]], buf);
  assert.ok(vecNear(other, [40, 0, 0]));
  const seeded = seedRotateFromLastRotate(emptyRotateState(), buf, [10, 0, 0]);
  assert.equal(seeded.angle, 90);
  assert.equal(seeded.axis, 'z');
  assert.equal(seeded.centerMode, 'custom');
  assert.deepEqual(seeded.center, [0, 0, 0]);
  const touched = seedRotateFromLastRotate({ ...emptyRotateState(), angle: 10 }, buf, [10, 0, 0]);
  assert.equal(touched.angle, 10, 'a card the user already changed is not reseeded');
});

test('rotatePreviewMap is the difference from the committed block', () => {
  const state = { ...emptyRotateState(), target: { at: [0, 0, 0] }, axis: 'z', angle: 0 };
  assert.equal(rotatePreviewMap(state, ''), null, 'zero angle and no previous rotate: nothing to show');
  const fresh = rotatePreviewMap({ ...state, angle: 90 }, '');
  assert.ok(vecNear(fresh([1, 0, 0]), [0, 1, 0]));
  const committed = composeRotateCommit('let part = Manifold.cube([10, 10, 10], true);', { ...state, angle: 90 }).buffer;
  assert.equal(rotatePreviewMap({ ...state, angle: 90 }, committed), null, 'same values as the block: no ghost');
  const more = rotatePreviewMap({ ...state, angle: 180 }, committed);
  // The mesh already sits at +90; the ghost shows only the extra quarter turn.
  assert.ok(vecNear(more([0, 1, 0]), [-1, 0, 0]), JSON.stringify(more([0, 1, 0])));
  const other = rotatePreviewMap({ ...state, axis: 'x', angle: 90 }, committed);
  // Undo the z turn (the +Y point goes back to +X), then turn about x: +X stays.
  assert.ok(vecNear(other([0, 1, 0]), [1, 0, 0]), JSON.stringify(other([0, 1, 0])));
});
