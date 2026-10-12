import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contourLineDragAllowed,
  dragContourLine,
  isPolylineDot,
  planPolylinePointRemoval,
  POLYLINE_CLOSE_MIN,
  sketchHandles,
  sketchSegments,
  translatePolylineSegment,
} from './contourDrag.js';
import {
  contourToolAddsPoints,
  enterContourState,
  switchContourTool,
  toolToProfileParams,
} from './contourMode.js';
import { contourFromRectangle, solveContour } from './contourSolve.js';

function freeQuad() {
  return {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [10, 8] },
      { id: 'p3', at: [0, 8] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p1', b: 'p2' },
      { id: 'e2', a: 'p2', b: 'p3' },
      { id: 'e3', a: 'p3', b: 'p0' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
}

test('cursor drags a line by the same delta and does not add points', () => {
  assert.equal(contourToolAddsPoints('cursor'), false);
  assert.equal(contourToolAddsPoints('polyline'), true);

  const started = enterContourState('crossSection', null);
  const cursor = switchContourTool(started, 'cursor');
  assert.equal(cursor.tool, 'cursor');
  assert.equal(cursor.params.radius, started.params.radius);
  assert.equal(toolToProfileParams('cursor', cursor.params).profileType, 'circle');

  const spec = freeQuad();
  assert.equal(contourLineDragAllowed(spec, 'e0'), true);
  const dragged = dragContourLine(spec, 'e0', [3, -2]);
  assert.equal(dragged.moved, true);
  const at = Object.fromEntries(dragged.spec.points.map((p) => [p.id, p.at]));
  assert.ok(Math.abs(at.p0[0] - 3) < 1e-6 && Math.abs(at.p0[1] + 2) < 1e-6);
  assert.ok(Math.abs(at.p1[0] - 13) < 1e-6 && Math.abs(at.p1[1] + 2) < 1e-6);
  assert.deepEqual(at.p2, [10, 8]);
  assert.deepEqual(at.p3, [0, 8]);
  assert.equal(dragged.spec.points.length, spec.points.length);
  assert.equal(dragged.spec.lines.length, spec.lines.length);

  const rect = contourFromRectangle(40, 30, true);
  assert.equal(contourLineDragAllowed(rect, 'e0'), false);
  const held = dragContourLine(rect, 'e0', [4, 0]);
  assert.equal(held.moved, false);
  assert.deepEqual(held.spec.points.find((p) => p.id === 'p0').at, rect.points.find((p) => p.id === 'p0').at);
  assert.deepEqual(held.spec.points.find((p) => p.id === 'p1').at, rect.points.find((p) => p.id === 'p1').at);
});

test('an unpromoted segment translates both ends and leaves the other points', () => {
  const points = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const next = translatePolylineSegment(points, 1, 2, [2, 3]);
  assert.deepEqual(next[0], [0, 0]);
  assert.deepEqual(next[1], [12, 3]);
  assert.deepEqual(next[2], [12, 11]);
  assert.deepEqual(next[3], [0, 8]);
  assert.deepEqual(points[1], [10, 0]);
  const state = { tool: 'cursor', params: { points }, entry: 'crossSection' };
  const segments = sketchSegments(state);
  assert.equal(segments.length, 4);
  assert.equal(segments[1].indexA, 1);
  assert.equal(segments[1].indexB, 2);
});

test('double-tap removes one polyline dot and marks a constraint that named it broken', () => {
  const spec = freeQuad();
  spec.constraints = [{ id: 'kBad', kind: 'coincident', items: ['p1', 'p2'] }];
  const state = {
    tool: 'polyline',
    entry: 'crossSection',
    contourId: 'c1',
    params: { contour: spec, points: spec.points.map((p) => p.at.slice()) },
  };
  assert.equal(isPolylineDot(state, sketchHandles(state).find((h) => h.id === 'p1')), true);
  const removed = planPolylinePointRemoval(state, 'p1');
  assert.equal(removed.action, 'remove');
  const next = removed.state.params.contour;
  assert.equal(next.points.some((p) => p.id === 'p1'), false);
  assert.equal(next.points.length, 3);
  const kept = next.constraints.find((item) => item.id === 'kBad');
  assert.ok(kept);
  assert.deepEqual(kept.items, ['p1', 'p2']);
  assert.equal(kept.broken, true);
  const solved = solveContour(next);
  assert.equal(solved.constraints.find((item) => item.id === 'kBad').broken, true);
  assert.ok(solved.contours.length >= 1);

  const again = planPolylinePointRemoval(removed.state, 'p0');
  assert.equal(again.action, 'delete-shape');
  assert.equal(again.contourId, 'c1');
  assert.deepEqual(again.state.params.points, []);
  assert.equal(again.state.params.contour, undefined);
  assert.equal(POLYLINE_CLOSE_MIN, 3);
});

test('a draft under the auto-closed minimum deletes the shape instead of refusing', () => {
  const state = {
    tool: 'polyline',
    entry: 'crossSection',
    params: { points: [[0, 0], [4, 0], [4, 3]] },
  };
  const gone = planPolylinePointRemoval(state, 'p2');
  assert.equal(gone.action, 'delete-shape');
  assert.equal(gone.contourId, null);
  assert.deepEqual(gone.state.params.points, []);

  const open = planPolylinePointRemoval({
    tool: 'polyline',
    entry: 'crossSection',
    params: { points: [[0, 0], [4, 0], [4, 3], [0, 3]] },
  }, 'p3');
  assert.equal(open.action, 'remove');
  assert.equal(open.state.params.points.length, 3);
});
