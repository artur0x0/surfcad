import assert from 'node:assert/strict';
import test from 'node:test';
import { holeCentresSketch } from './holeCard.js';
import {
  composeHoleOnContour,
  readCentersContour,
  rewriteCentersContour,
} from './holeContour.js';
import {
  applyContourPlaneEdit,
  axisPresetFrame,
  composeContourProfile,
  contourPlaneOffsetFrame,
  enterContourState,
} from './contourMode.js';
import { applySavedContour, listSavedContours } from './savedContours.js';

const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

const FACE = {
  center: [1, 2, 3],
  normal: [0, 0.6, 0.8],
  x: [1, 0, 0],
  y: [0, 0.8, -0.6],
};

function near(a, b, eps = 1e-6) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.ok(Math.abs(a[i] - b[i]) < eps, `${a} vs ${b}`);
  }
}

test('offset moves the frame center along the normal', () => {
  const shifted = contourPlaneOffsetFrame(FACE, 5);
  near(shifted.center, [1, 5, 7]);
  near(shifted.normal, FACE.normal);
  near(shifted.x, FACE.x);
  near(contourPlaneOffsetFrame(shifted, -5).center, FACE.center);
  near(contourPlaneOffsetFrame(FACE, 0).center, FACE.center);
  const back = contourPlaneOffsetFrame(FACE, -2);
  near(back.center, [1, 0.8, 1.4]);
});

test('X Y Z and a face preset bake the same offset', () => {
  const fresh = enterContourState('crossSection', null);
  const x = applyContourPlaneEdit(fresh, {
    preset: 'x',
    base: axisPresetFrame('x', [0, 0, 0]),
    offset: 4,
    angles: { x: 0, y: 0, z: 0 },
  });
  near(x.planeFace.center, [4, 0, 0]);
  near(x.planeFace.normal, [1, 0, 0]);
  const y = applyContourPlaneEdit(fresh, {
    preset: 'y',
    base: axisPresetFrame('y', [1, 2, 3]),
    offset: -3,
    angles: { x: 0, y: 0, z: 0 },
  });
  near(y.planeFace.center, [1, -1, 3]);
  const face = applyContourPlaneEdit(fresh, {
    preset: 'face',
    base: FACE,
    offset: 5,
    angles: { x: 0, y: 0, z: 0 },
    keepAngles: true,
  });
  near(face.planeFace.planeFrame.center, [1, 5, 7]);
  assert.equal(face.planeOffset, 5);
  assert.equal(face.planePreset, 'face');
});

test('a saved contour reopens on the same offset and does not apply it twice', () => {
  let state = enterContourState('crossSection', null);
  state = applyContourPlaneEdit(state, {
    preset: 'z',
    base: { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    offset: 12,
    angles: { x: 0, y: 0, z: 0 },
    keepAngles: true,
  });
  const wrote = composeContourProfile(STARTER, {
    face: state.planeFace,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
    planeOffset: state.planeOffset,
  });
  assert.equal(wrote.ok, true, wrote.message || '');
  assert.match(wrote.buffer, /center: \[0, 0, 22\]/);
  assert.match(wrote.buffer, /\/\/ @contour id=c1 offset=12/);
  assert.ok(wrote.buffer.indexOf('makeCrossSection') < wrote.buffer.indexOf('return part'));
  const listed = listSavedContours(wrote.buffer);
  assert.equal(listed[0].planeOffset, 12);
  const restored = applySavedContour(enterContourState('crossSection', null), listed[0]);
  assert.equal(restored.planeOffset, 12);
  near(restored.planeFace.center, [0, 0, 22]);
  near(restored.planeBase.center, [0, 0, 10]);
  const same = applyContourPlaneEdit(restored, { offset: 12, keepAngles: true });
  near(same.planeFace.center, [0, 0, 22]);
  const moved = applyContourPlaneEdit(restored, { offset: 4, keepAngles: true });
  near(moved.planeFace.center, [0, 0, 14]);
  assert.equal(moved.planeOffset, 4);
  const cleared = composeContourProfile(wrote.buffer, {
    face: moved.planeFace,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
    contourId: 'c1',
    planeOffset: 0,
  });
  assert.match(cleared.buffer, /center: \[0, 0, 14\]/);
  assert.doesNotMatch(cleared.buffer, /offset=/);
  assert.equal(listSavedContours(cleared.buffer)[0].planeOffset, 0);
});

test('a hole centres sketch keeps the offset and a rewrite does not drop it', () => {
  const frame = { center: [0, 0, 18], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
  const wrote = composeHoleOnContour(STARTER, {
    frame,
    planeOffset: 8,
    contour: { points: [{ id: 'p0', at: [0, 0] }], lines: [] },
    spec: { dia: 4, depth: 6, side: 1 },
  });
  assert.equal(wrote.ok, true, wrote.message || '');
  assert.match(wrote.buffer, /role=centers offset=8/);
  assert.match(wrote.buffer, /center: \[0, 0, 18\]/);
  assert.ok(wrote.buffer.indexOf('role=centers') < wrote.buffer.indexOf('return part'));
  const kept = rewriteCentersContour(wrote.buffer, {
    contourId: wrote.contourId,
    contour: { points: [{ id: 'p0', at: [1, 2] }], lines: [] },
  });
  assert.equal(kept.ok, true, kept.message || '');
  assert.match(kept.buffer, /offset=8/);
  const read = readCentersContour(kept.buffer, wrote.contourId);
  assert.equal(read.planeOffset, 8);
  const sketch = holeCentresSketch(enterContourState('hole', null), read);
  assert.equal(sketch.entry, 'hole');
  assert.equal(sketch.planeOffset, 8);
  near(sketch.planeFace.planeFrame.center, [0, 0, 18]);
  near(sketch.planeBase.center, [0, 0, 10]);
  const shifted = applyContourPlaneEdit(sketch, { offset: 3, keepAngles: true });
  near(shifted.planeFace.center, [0, 0, 13]);
  const updated = rewriteCentersContour(kept.buffer, {
    contourId: wrote.contourId,
    contour: sketch.params.contour,
    frame: shifted.planeFace.planeFrame,
    planeOffset: shifted.planeOffset,
  });
  assert.match(updated.buffer, /center: \[0, 0, 13\]/);
  assert.match(updated.buffer, /offset=3/);
});
