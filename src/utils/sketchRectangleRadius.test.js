import assert from 'node:assert/strict';
import test from 'node:test';
import { sketchAddCommand } from '../agent/commands/sketchAdd.js';
import { listSketchEntities } from '../agent/sketchEntityAgent.js';
import { promoteContourState } from './contourGesture.js';
import {
  applySketchAdd,
  composeContourProfile,
  enterContourState,
} from './contourMode.js';
import { solveContour } from './contourSolve.js';

const FACE = {
  type: 'planar',
  planeFrame: {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

function loopArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function addRectangle(args) {
  const sketch = enterContourState('crossSection');
  let applied = null;
  const out = sketchAddCommand.run({
    sketchAdd({ tool, params }) {
      applied = applySketchAdd(sketch, tool, params);
      if (!applied.ok) {
        return { error: { code: 'invalid_profile', message: applied.message } };
      }
      return { result: { appended: !!applied.appended } };
    },
  }, args);
  return { out, applied };
}

test('sketch_add rectangle radius 6 on 30 by 20 is four lines and four arcs', () => {
  const { out, applied } = addRectangle({
    tool: 'rectangle',
    width: 30,
    height: 20,
    centered: true,
    radius: 6,
    params: { cornerRadius: 6, radius: 6 },
  });
  assert.equal(out.error, undefined);
  assert.equal(out.result.appended, false);
  assert.equal(applied.ok, true, applied.message);
  const listed = listSketchEntities(applied.state);
  assert.equal(listed.lines.length, 4);
  assert.equal(listed.arcs.length, 4);
  assert.equal(listed.arcs.every((arc) => Math.abs(arc.radius - 6) < 1e-3), true);
  const promoted = promoteContourState(applied.state).params.contour;
  const solved = solveContour(promoted);
  assert.equal(solved.conflict, null);
  assert.notEqual(solved.status, 'conflict');
  assert.equal(solved.contours.length, 1);
  const area = loopArea(solved.contours[0]);
  const expected = 30 * 20 - (4 - Math.PI) * 36;
  // Arc tessellation chords sit just inside the true quarter circles.
  assert.ok(Math.abs(area - expected) < 1.5, `area ${area} expected ${expected}`);
  const xs = solved.contours[0].map((p) => p[0]);
  const ys = solved.contours[0].map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - 15) < 0.05);
  assert.ok(Math.abs(Math.min(...xs) + 15) < 0.05);
  assert.ok(Math.abs(Math.max(...ys) - 10) < 0.05);
  assert.ok(Math.abs(Math.min(...ys) + 10) < 0.05);
  const center = [9, -4];
  const near = solved.contours[0].some((p) => {
    const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
    return d < 6.05 && d > 5.7 && p[0] > 12 && p[1] < -6;
  });
  assert.equal(near, true);
  const wrote = composeContourProfile('', {
    face: FACE,
    tool: applied.state.tool,
    params: applied.state.params,
  });
  assert.equal(wrote.ok, true, wrote.message);
  assert.match(wrote.buffer, /solveContour/);
  assert.doesNotMatch(wrote.buffer, /profileRectangle/);
  assert.match(wrote.buffer, /radius: 6/);
});

test('a rectangle corner radius past half the shorter side is refused', () => {
  const { out, applied } = addRectangle({
    tool: 'rectangle',
    width: 30,
    height: 20,
    centered: true,
    radius: 11,
  });
  assert.equal(applied.ok, false);
  assert.match(applied.message, /half the shorter side/);
  assert.equal(out.error.code, 'invalid_profile');
  assert.match(out.error.message, /half the shorter side \(10\)/);
});

test('rectangle radius and cornerRadius must agree', () => {
  const { applied } = addRectangle({
    tool: 'rectangle',
    width: 30,
    height: 20,
    centered: true,
    radius: 6,
    params: { cornerRadius: 4 },
  });
  assert.equal(applied.ok, false);
  assert.match(applied.message, /disagree/);
});

test('a sharp rectangle is unchanged when no corner radius is set', () => {
  const { applied } = addRectangle({
    tool: 'rectangle',
    width: 30,
    height: 20,
    centered: true,
  });
  assert.equal(applied.ok, true, applied.message);
  assert.equal(applied.state.params.contour, undefined);
  const listed = listSketchEntities(applied.state);
  assert.equal(listed.lines.length, 4);
  assert.equal(listed.arcs.length, 0);
  assert.equal(listed.points.length, 4);
});
