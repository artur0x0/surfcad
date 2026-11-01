import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySketchAdd,
  composeContourExtrude,
  composeContourProfile,
  enterContourState,
} from './contourMode.js';
import { materializeHoleRectangleCenters } from './holeCard.js';
import { solveContour } from './contourSolve.js';
import {
  classifyExtrudeLoops,
  incomingClosedProfile,
  insetLoopParams,
  loopStrictlyInside,
  loopsFromProfileExpr,
  mergeContourSpecs,
} from './sketchLoops.js';
import { contourFromRectangle } from './contourSolve.js';
import { contourStatements } from './namedContour.js';

const FACE = {
  type: 'planar',
  planeFrame: {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

test('a second rectangle adds a loop instead of replacing the first', () => {
  const sketch = enterContourState('crossSection');
  const first = applySketchAdd(sketch, 'rectangle', { width: 40, height: 24, centered: true });
  assert.equal(first.ok, true);
  assert.equal(first.appended, false);
  assert.equal(first.state.profileSet, true);
  assert.equal(first.state.tool, 'rectangle');
  const second = applySketchAdd(first.state, 'rectangle', { width: 20, height: 12, centered: true });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.appended, true);
  assert.equal(second.loops, 2);
  assert.equal(second.state.tool, 'cursor');
  const solved = solveContour(second.state.params.contour);
  assert.equal(solved.contours.length, 2);
  const [outer, inner] = [...solved.contours].sort((a, b) => {
    const area = (pts) => Math.abs(pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0));
    return area(b) - area(a);
  });
  assert.equal(loopStrictlyInside(inner, outer), true);
  const wrote = composeContourExtrude('', {
    face: FACE,
    tool: second.state.tool,
    params: second.state.params,
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  assert.equal(wrote.ok, true, wrote.message);
  assert.equal((wrote.buffer.match(/makeExtrude\(/g) || []).length, 1);
  assert.match(wrote.buffer, /makeExtrude\(c1\.contours, 10\)/);
  assert.match(wrote.buffer, /solveContour\(/);
  const stmt = contourStatements(wrote.buffer)[0];
  assert.equal(loopsFromProfileExpr(stmt.profileExpr).length, 2);
});

test('the first closed profile still replaces an empty sketch, including the solid default circle', () => {
  const solid = enterContourState('makeExtrude');
  assert.equal(solid.tool, 'circle');
  const next = applySketchAdd(solid, 'rectangle', { width: 20, height: 12, centered: true });
  assert.equal(next.appended, false);
  assert.equal(next.state.tool, 'rectangle');
  assert.equal(next.state.params.width, 20);
  assert.equal(next.state.params.contour, undefined);
});

test('a UI inset click puts the next rectangle inside the first', () => {
  const sketch = enterContourState('crossSection');
  const first = applySketchAdd(sketch, 'rectangle', { width: 20, height: 12, centered: true });
  const second = applySketchAdd(first.state, 'rectangle', { width: 20, height: 12, centered: true }, { inset: true });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.loops, 2);
  const solved = solveContour(second.state.params.contour);
  const areas = solved.contours.map((pts) => Math.abs(pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2);
  areas.sort((a, b) => b - a);
  assert.ok(Math.abs(areas[0] - 240) < 1, String(areas[0]));
  assert.ok(Math.abs(areas[1] - 60) < 1, String(areas[1]));
});

test('a circle then an inset rectangle adds a loop inside the circle', () => {
  const sketch = enterContourState('crossSection');
  const circle = applySketchAdd(sketch, 'circle', { radius: 10, segments: 16 });
  assert.equal(circle.state.profileSet, true);
  const inner = applySketchAdd(
    circle.state,
    'rectangle',
    { width: 20, height: 12, centered: true },
    { inset: true },
  );
  assert.equal(inner.ok, true, inner.message);
  assert.equal(inner.appended, true);
  assert.equal(inner.loops, 2);
});

test('hole sketches and an explicit contour still replace', () => {
  const hole = enterContourState('hole');
  const rect = applySketchAdd(hole, 'rectangle', { width: 30, height: 20, centered: true });
  assert.equal(rect.appended, false);
  assert.equal(rect.state.profileSet, undefined);
  const centres = materializeHoleRectangleCenters(rect.state);
  assert.equal(centres.params.centers, true);
  const replaced = applySketchAdd(centres, 'cursor', {
    contour: { centers: true, points: [{ id: 'p0', at: [1, 2] }] },
  });
  assert.equal(replaced.appended, false);
  assert.equal(replaced.state.params.contour.points.length, 1);
  assert.equal(replaced.state.params.contour.points[0].at[0], 1);
});

test('merged rectangle specs keep distinct ids and two loops', () => {
  const merged = mergeContourSpecs(
    contourFromRectangle(40, 24, true),
    contourFromRectangle(20, 12, true),
  );
  const ids = merged.points.map((point) => point.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(solveContour(merged).contours.length, 2);
  assert.equal(incomingClosedProfile('rectangle', { width: 10, height: 4 }), true);
  assert.equal(incomingClosedProfile('rectangle', { centers: true, width: 10, height: 4 }), false);
  const inset = insetLoopParams('rectangle', {}, { cx: 0, cy: 0, w: 20, h: 12 });
  assert.equal(inset.width, 10);
  assert.equal(inset.height, 6);
});

test('classify nests a hole, unions disjoint outers, and refuses a hole that is not inside', () => {
  const outer = [[-20, -12], [20, -12], [20, 12], [-20, 12]];
  const hole = [[-10, -6], [10, -6], [10, 6], [-10, 6]];
  const beside = [[30, -6], [50, -6], [50, 6], [30, 6]];
  const frame = classifyExtrudeLoops([
    { name: 'c1', role: null, loops: [outer] },
    { name: 'c2', role: null, loops: [hole] },
  ]);
  assert.equal(frame.ok, true, frame.message);
  assert.equal(frame.groups, 1);
  assert.equal(frame.expr, '[].concat(c1.contours, c2.contours)');
  const oneSketch = classifyExtrudeLoops([{ name: 'c1', role: null, loops: [outer, hole] }]);
  assert.equal(oneSketch.expr, 'c1.contours');
  const split = classifyExtrudeLoops([
    { name: 'c1', role: null, loops: [outer, hole] },
    { name: 'c2', role: 'outer', loops: [beside] },
  ]);
  assert.equal(split.ok, true, split.message);
  assert.equal(split.groups, 2);
  assert.match(split.expr, /makeExtrude\(c1\.contours, __H__\)\.add\(makeExtrude\(c2\.contours, __H__\)\)/);
  const marked = classifyExtrudeLoops([
    { name: 'c1', role: 'outer', loops: [outer] },
    { name: 'c2', role: 'hole', loops: [hole] },
  ]);
  assert.equal(marked.roles.c2, 'hole');
  const loose = classifyExtrudeLoops([
    { name: 'c1', role: 'outer', loops: [outer] },
    { name: 'c2', role: 'hole', loops: [beside] },
  ]);
  assert.equal(loose.ok, false);
  const island = classifyExtrudeLoops([{
    name: 'c1',
    role: null,
    loops: [outer, hole, [[-2, -2], [2, -2], [2, 2], [-2, 2]]],
  }]);
  assert.equal(island.ok, false);
});

test('two saved contours on one extrude emit one makeExtrude and round-trip the role', () => {
  const outer = composeContourProfile('', {
    face: FACE,
    tool: 'rectangle',
    params: { width: 40, height: 24, centered: true },
  });
  const inner = composeContourProfile(outer.buffer, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 20, height: 12, centered: true },
  });
  assert.equal(inner.ok, true, inner.message);
  const wrote = composeContourExtrude(inner.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
    profiles: [
      { contourName: 'c1', loopRole: 'outer' },
      { contourName: 'c2', loopRole: 'hole' },
    ],
  });
  assert.equal(wrote.ok, true, wrote.message);
  assert.match(wrote.buffer, /makeExtrude\(\[\]\.concat\(c1\.contours, c2\.contours\), 10\)/);
  assert.match(wrote.buffer, /\/\/ loop-role c1=outer c2=hole/);
  assert.equal((wrote.buffer.match(/makeExtrude\(/g) || []).length, 1);
  const again = composeContourExtrude(wrote.buffer, {
    featureId: wrote.featureId,
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
    profiles: [
      { contourName: 'c1', loopRole: 'auto' },
      { contourName: 'c2', loopRole: 'auto' },
    ],
  });
  assert.equal(again.ok, true, again.message);
  assert.match(again.buffer, /makeExtrude\(\[\]\.concat\(c1\.contours, c2\.contours\), 10\)/);
  assert.doesNotMatch(again.buffer, /loop-role/);
});
