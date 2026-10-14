import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contourShapeDragAllowed,
  dragContourShape,
  dragSketchParam,
  dragSketchShape,
  sketchHandles,
  sketchShapeAt,
} from './contourDrag.js';
import { contourFromTool } from './contourGesture.js';
import { toolToProfileParams } from './contourMode.js';
import { buildProfileFromParams } from './crossSectionSubstrate.js';
import { emitProfileExprFromParams } from './helperPaletteSnippets.js';
import { contourFromPolygon, contourFromRectangle, solveContour } from './contourSolve.js';

function quad() {
  return {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [10, 6] },
      { id: 'p3', at: [0, 6] },
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

function shiftOf(before, after) {
  return before.points.map((point) => {
    const next = after.points.find((item) => item.id === point.id);
    return [next.at[0] - point.at[0], next.at[1] - point.at[1]];
  });
}

test('a free quad translates rigidly', () => {
  const spec = quad();
  assert.equal(contourShapeDragAllowed(spec), true);
  const moved = dragContourShape(spec, [4, -3]);
  assert.equal(moved.moved, true);
  const shifts = shiftOf(spec, moved.spec);
  for (const [du, dv] of shifts) {
    assert.ok(Math.abs(du - 4) < 1e-4, JSON.stringify(shifts));
    assert.ok(Math.abs(dv + 3) < 1e-4, JSON.stringify(shifts));
  }
  assert.equal(spec.points[0].at[0], 0);
});

test('a fully locked rectangle does not move', () => {
  const spec = contourFromRectangle(20, 12, true);
  assert.equal(contourShapeDragAllowed(spec), false);
  const stayed = dragContourShape(spec, [6, 5]);
  assert.equal(stayed.moved, false);
  for (const point of spec.points) {
    const next = stayed.spec.points.find((item) => item.id === point.id);
    assert.ok(Math.hypot(next.at[0] - point.at[0], next.at[1] - point.at[1]) < 1e-6);
  }
});

test('a promoted hexagon keeps its fixed center and moves only the free vertices', () => {
  const spec = contourFromPolygon('hexagon', 8);
  assert.equal(contourShapeDragAllowed(spec), true);
  const moved = dragContourShape(spec, [3, 2]);
  assert.equal(moved.moved, true);
  const p0 = moved.spec.points.find((point) => point.id === 'p0').at;
  const p1 = moved.spec.points.find((point) => point.id === 'p1').at;
  assert.ok(Math.hypot(p0[0], p0[1]) < 1e-3, JSON.stringify(p0));
  assert.ok(Math.abs(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) - 8) < 1e-3);
  const sides = [];
  for (let i = 0; i < 6; i += 1) {
    const a = moved.spec.points.find((point) => point.id === `p${i + 1}`).at;
    const b = moved.spec.points.find((point) => point.id === `p${((i + 1) % 6) + 1}`).at;
    sides.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  for (const length of sides) assert.ok(Math.abs(length - sides[0]) < 1e-3, JSON.stringify(sides));
  const travel = spec.points.reduce((max, point) => {
    const next = moved.spec.points.find((item) => item.id === point.id);
    return Math.max(max, Math.hypot(next.at[0] - point.at[0], next.at[1] - point.at[1]));
  }, 0);
  assert.ok(travel > 1, String(travel));
});

test('dropping the corner fix lets the rectangle translate and keeps its size', () => {
  const spec = contourFromRectangle(20, 12, true);
  spec.constraints = spec.constraints.filter((item) => item.kind !== 'fix');
  assert.equal(contourShapeDragAllowed(spec), true);
  const moved = dragContourShape(spec, [5, -3]);
  assert.equal(moved.moved, true);
  const shifts = shiftOf(spec, moved.spec);
  for (const [du, dv] of shifts) {
    assert.ok(Math.abs(du - 5) < 1e-3, JSON.stringify(shifts));
    assert.ok(Math.abs(dv + 3) < 1e-3, JSON.stringify(shifts));
  }
  const width = Math.hypot(
    moved.spec.points[1].at[0] - moved.spec.points[0].at[0],
    moved.spec.points[1].at[1] - moved.spec.points[0].at[1],
  );
  const height = Math.hypot(
    moved.spec.points[2].at[0] - moved.spec.points[1].at[0],
    moved.spec.points[2].at[1] - moved.spec.points[1].at[1],
  );
  assert.ok(Math.abs(width - 20) < 1e-3, String(width));
  assert.ok(Math.abs(height - 12) < 1e-3, String(height));
});

test('a distance between two points translates and holds the gap', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'length', edge: 'e0', value: 10 }],
    constraints: [],
  };
  const moved = dragContourShape(spec, [3, 4]);
  assert.equal(moved.moved, true);
  const shifts = shiftOf(spec, moved.spec);
  for (const [du, dv] of shifts) {
    assert.ok(Math.abs(du - 3) < 1e-3, JSON.stringify(shifts));
    assert.ok(Math.abs(dv - 4) < 1e-3, JSON.stringify(shifts));
  }
  const gap = Math.hypot(
    moved.spec.points[1].at[0] - moved.spec.points[0].at[0],
    moved.spec.points[1].at[1] - moved.spec.points[0].at[1],
  );
  assert.ok(Math.abs(gap - 10) < 1e-3, String(gap));
});

test('a fixed point plus a length slides the free point on that circle', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'length', edge: 'e0', value: 10 }],
    constraints: [{ id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } }],
  };
  const moved = dragContourShape(spec, [0, 4]);
  assert.equal(moved.moved, true);
  const p0 = moved.spec.points.find((point) => point.id === 'p0').at;
  const p1 = moved.spec.points.find((point) => point.id === 'p1').at;
  assert.ok(Math.hypot(p0[0], p0[1]) < 1e-3, JSON.stringify(p0));
  const gap = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  assert.ok(Math.abs(gap - 10) < 1e-3, String(gap));
  assert.ok(p1[1] > 1, JSON.stringify(p1));
  assert.ok(Math.hypot(p1[0] - 10, p1[1] - 4) > 0.2, JSON.stringify(p1));
});

test('unpromoted shapes store a translation and keep their size', () => {
  const circle = dragSketchShape('circle', { radius: 5, segments: 64 }, [3, -2]);
  assert.deepEqual(circle.params.origin, [3, -2]);
  assert.equal(circle.params.radius, undefined);
  const hex = dragSketchShape('polygon', { polygonPreset: 'hexagon', radius: 8 }, [1, 2]);
  assert.deepEqual(hex.params.origin, [1, 2]);
  assert.equal(hex.handles.length, 6);
  assert.ok(Math.abs(hex.handles[0].at[0] - 1) < 1e-9);
  assert.ok(Math.abs(hex.handles[0].at[1] - (2 - 8)) < 1e-9);
  const rect = dragSketchShape('rectangle', { width: 20, height: 12, centered: true }, [-4, 5]);
  assert.deepEqual(rect.params.origin, [-4, 5]);
  assert.equal(rect.handles.length, 4);
  const line = dragSketchShape('polyline', { points: [[0, 0], [4, 0], [4, 2]] }, [2, 3]);
  assert.deepEqual(line.params.points, [[2, 3], [6, 3], [6, 5]]);
});

test('a point drag still measures size from the shape origin', () => {
  const circle = dragSketchParam('circle', { radius: 5, segments: 64, origin: [2, 0] }, 0, [11, 0]);
  assert.ok(Math.abs(circle.params.radius - 9) < 1e-9);
  const poly = dragSketchParam('polygon', { polygonPreset: 'hexagon', radius: 8, origin: [1, 2] }, 0, [1, 16]);
  assert.ok(Math.abs(poly.params.radius - 14) < 1e-9);
  const rect = dragSketchParam('rectangle', { width: 20, height: 12, centered: true, origin: [1, 1] }, 2, [16, 10]);
  assert.ok(Math.abs(rect.params.width - 30) < 1e-9);
  assert.ok(Math.abs(rect.params.height - 18) < 1e-9);
});

test('cursor keeps polygon handles, and edge or interior is the whole shape', () => {
  const state = { tool: 'cursor', params: { polygonPreset: 'hexagon', radius: 8 } };
  assert.equal(sketchHandles(state).length, 6);
  assert.equal(sketchShapeAt(state, [0, 0], 0.4).hit, 'interior');
  const edge = sketchShapeAt(state, [3.464, -6], 0.4);
  assert.equal(edge.hit, 'edge');
  assert.equal(sketchShapeAt(state, [0, -20], 0.4), null);

  const circle = { tool: 'cursor', params: { radius: 5, segments: 64, origin: [1, 2] } };
  assert.equal(sketchShapeAt(circle, [1, 2], 0.2).hit, 'interior');
  assert.equal(sketchShapeAt(circle, [6, 2], 0.2).hit, 'edge');
  assert.equal(sketchShapeAt(circle, [12, 2], 0.2), null);

  const rect = { tool: 'cursor', params: { width: 20, height: 12, centered: true } };
  assert.equal(sketchShapeAt(rect, [0, 0], 0.2).hit, 'interior');
  assert.equal(sketchShapeAt(rect, [0, -6], 0.2).hit, 'edge');
  assert.equal(sketchShapeAt(rect, [0, -20], 0.2), null);

  const line = { tool: 'cursor', params: { points: [[0, 0], [8, 0], [8, 4], [0, 4]] } };
  assert.equal(sketchShapeAt(line, [4, 2], 0.2).hit, 'interior');
  assert.equal(sketchShapeAt(line, [4, 0], 0.2).hit, 'edge');
  const open = { tool: 'polyline', params: { points: [[0, 0], [8, 0]] } };
  assert.equal(sketchShapeAt(open, [4, 1], 0.2), null);
  assert.equal(sketchShapeAt(open, [4, 0], 0.2).hit, 'edge');
});

test('promotion and preview keep a nonzero origin, and a zero origin emits the old call', () => {
  const built = contourFromTool('circle', { radius: 5, segments: 64, origin: [4, -2] });
  const center = built.points.find((point) => point.id === 'p0').at;
  assert.ok(Math.abs(center[0] - 4) < 1e-9 && Math.abs(center[1] + 2) < 1e-9);
  const fix = built.constraints.find((item) => item.kind === 'fix');
  assert.ok(Math.abs(fix.at.p0[0] - 4) < 1e-9 && Math.abs(fix.at.p0[1] + 2) < 1e-9);
  const solved = solveContour(built);
  assert.notEqual(solved.status, 'conflict');
  assert.ok(Math.hypot(solved.points[0].at[0] - 4, solved.points[0].at[1] + 2) < 1e-3);

  const home = emitProfileExprFromParams({ profileType: 'circle', radius: 5, segments: 64 });
  assert.equal(home, 'profileCircle(5, 64)');
  const shifted = emitProfileExprFromParams({
    profileType: 'circle', radius: 5, segments: 8, origin: [4, -2],
  });
  assert.ok(shifted.startsWith('profilePolygon(['), shifted);
  assert.ok(shifted.includes('[9, -2]'), shifted);

  const rectHome = emitProfileExprFromParams({ profileType: 'rectangle', width: 20, height: 12, centered: true });
  assert.equal(rectHome, 'profileRectangle(20, 12, true)');
  const contours = buildProfileFromParams(toolToProfileParams('cursor', {
    polygonPreset: 'hexagon', radius: 8, origin: [3, 1],
  })).contours[0];
  assert.ok(Math.abs(contours[0][0] - 3) < 1e-6);
  assert.ok(Math.abs(contours[0][1] - (1 - 8)) < 1e-6);
});
