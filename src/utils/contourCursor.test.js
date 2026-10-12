import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPolylineSegmentInsert,
  dragContourPoint,
  isPolylineDot,
  isPolylineDoubleTap,
  planPolylinePointRemoval,
  POLYLINE_CLOSE_MIN,
  POLYLINE_DOUBLE_TAP_MS,
  POLYLINE_SAME_TAP_MS,
  projectUvOnSegment,
  sketchHandles,
  sketchSegments,
} from './contourDrag.js';
import {
  contourToolAddsPoints,
  enterContourState,
  switchContourTool,
  toolToProfileParams,
} from './contourMode.js';
import { contourFromPolyline, contourFromRectangle, solveContour } from './contourSolve.js';

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

test('cursor drags a point and does not add points', () => {
  assert.equal(contourToolAddsPoints('cursor'), false);
  assert.equal(contourToolAddsPoints('polyline'), true);

  const started = enterContourState('crossSection', null);
  assert.equal(started.tool, 'cursor');
  assert.equal(started.params.radius, 5);
  const cursor = switchContourTool(started, 'cursor');
  assert.equal(cursor.tool, 'cursor');
  assert.equal(cursor.params.radius, started.params.radius);
  assert.equal(toolToProfileParams('cursor', cursor.params).profileType, 'circle');

  const spec = { ...freeQuad(), polyline: true };
  const dragged = dragContourPoint(spec, 'p1', [14, 3]);
  assert.equal(dragged.moved, true);
  assert.equal(dragged.spec.polyline, true);
  const at = Object.fromEntries(dragged.spec.points.map((p) => [p.id, p.at]));
  assert.deepEqual(at.p0, [0, 0]);
  assert.ok(Math.hypot(at.p1[0] - 10, at.p1[1]) > 1);
  assert.deepEqual(at.p2, [10, 8]);
  assert.deepEqual(at.p3, [0, 8]);
  assert.equal(dragged.spec.points.length, spec.points.length);
  assert.equal(dragged.spec.lines.length, spec.lines.length);

  const rect = contourFromRectangle(40, 30, true);
  assert.equal(rect.polyline, undefined);
  const held = dragContourPoint(rect, 'p0', [4, 0]);
  assert.equal(held.moved, false);
  assert.equal(held.spec.polyline, undefined);
});

test('a segment tap inserts one point and a fast double-tap is the removal window', () => {
  const points = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const state = { tool: 'polyline', params: { points }, entry: 'crossSection' };
  const segments = sketchSegments(state);
  assert.equal(segments.length, 4);
  assert.equal(segments[1].indexA, 1);
  assert.equal(segments[1].indexB, 2);
  const inserted = applyPolylineSegmentInsert(state, segments[0], [5, 0.4], {
    uv: [5, 0],
    target: { kind: 'line', id: 'e0' },
  });
  assert.equal(inserted.params.contour, undefined);
  assert.equal(inserted.params.points.length, 5);
  assert.deepEqual(points, [[0, 0], [10, 0], [10, 8], [0, 8]]);
  const mid = inserted.params.points[1];
  assert.ok(Math.abs(mid[0] - 5) < 1e-6 && Math.abs(mid[1]) < 1e-6);

  const spec = contourFromPolyline(points);
  const promoted = {
    tool: 'polyline',
    entry: 'crossSection',
    params: { contour: spec, points: spec.points.map((p) => p.at.slice()) },
  };
  const segment = sketchSegments(promoted).find((item) => item.id === 'e0');
  const split = applyPolylineSegmentInsert(promoted, segment, [5, 1], {
    uv: [5, 0],
    target: { kind: 'line', id: 'e0' },
  });
  assert.equal(split.params.contour.polyline, true);
  assert.equal(split.params.contour.points.length, 5);
  assert.equal(split.params.contour.constraints.length, 0);
  assert.notEqual(solveContour(split.params.contour).status, 'conflict');
  const dragged = dragContourPoint(split.params.contour, 'p1', [12, 3]);
  assert.equal(dragged.spec.polyline, true);

  const external = applyPolylineSegmentInsert(promoted, segment, [5, 0], {
    uv: [10, 8],
    target: { kind: 'point', id: 'p2' },
  });
  assert.equal(external.params.contour.polyline, true);
  assert.equal(external.params.contour.points.length, 5);
  assert.ok(external.params.contour.constraints.some((item) => item.kind === 'coincident'));

  const onSegment = projectUvOnSegment([5, 4], [0, 0], [10, 0]);
  assert.ok(Math.abs(onSegment[0] - 5) < 1e-6 && Math.abs(onSegment[1]) < 1e-6);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0 }, 'p1', POLYLINE_SAME_TAP_MS), false);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0, source: 'mouse' }, 'p1', 0, 'mouse'), true);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0, source: 'touch' }, 'p1', 20, 'mouse'), false);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0 }, 'p1', 20), false);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0 }, 'p1', 80), true);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0 }, 'p1', POLYLINE_DOUBLE_TAP_MS), true);
  assert.equal(isPolylineDoubleTap({ id: 'p1', at: 0 }, 'p1', POLYLINE_DOUBLE_TAP_MS + 1), false);
  assert.equal(isPolylineDoubleTap({ id: 'p0', at: 0 }, 'p1', 80), false);
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
