import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyContourPlaneEdit,
  axisPresetFrame,
  composeContourWorkplane,
  enterContourState,
  planeCardCommit,
} from './contourMode.js';

const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

test('workplane Add plane writes the reference, angle, and offset once', () => {
  assert.deepEqual(planeCardCommit('workplane'), {
    label: 'Add plane',
    writes: true,
    rail: false,
  });
  assert.deepEqual(planeCardCommit('crossSection'), {
    label: 'Select plane',
    writes: false,
    rail: true,
  });
  assert.equal(planeCardCommit('hole').rail, true);
  assert.equal(planeCardCommit('hole').writes, false);

  let state = enterContourState('workplane', null);
  state = applyContourPlaneEdit(state, {
    preset: 'x',
    base: axisPresetFrame('x', [0, 0, 10]),
    angles: { x: 0, y: 0, z: 0 },
  });
  state = applyContourPlaneEdit(state, {
    angles: { x: 0, y: 0, z: 90 },
    offset: 12,
    keepAngles: true,
  });
  const frame = state.planeFace.planeFrame;
  assert.ok(Math.abs(frame.center[0]) < 1e-6, frame.center);
  assert.ok(Math.abs(frame.center[1] - 12) < 1e-6, frame.center);
  assert.ok(Math.abs(frame.center[2] - 10) < 1e-6, frame.center);
  assert.ok(Math.abs(frame.normal[1] - 1) < 1e-6, frame.normal);

  const wrote = composeContourWorkplane(STARTER, { face: state.planeFace });
  assert.equal(wrote.ok, true);
  const begin = wrote.buffer.indexOf('workplane begin');
  const ret = wrote.buffer.indexOf('return part');
  assert.ok(begin >= 0 && ret > begin);
  assert.match(wrote.buffer, /center:\s*\[\s*0,\s*12,\s*10\s*\]/);
  assert.match(wrote.buffer, /normal:\s*\[\s*0,\s*1,\s*0\s*\]/);
  assert.equal((wrote.buffer.match(/center:/g) || []).length, 1);
});
