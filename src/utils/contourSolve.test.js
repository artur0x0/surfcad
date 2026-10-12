import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeContour } from './contourSolve.js';
import { contourPointDragAllowed, dragContourPoint, pointFreedom } from './contourDrag.js';
import { CONTOUR_STATUS_COLOR, contourEntityColor } from './contourStatus.js';
import { armContourGesture, enterContourState } from './contourMode.js';
import { liveDimension } from './contourGesture.js';

const BLUE = CONTOUR_STATUS_COLOR.under;

function gap(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function at(solved, id) {
  return solved.points.find((p) => p.id === id).at;
}

function freedoms(solved) {
  const free = {};
  solved.points.forEach((p, i) => {
    free[p.id] = pointFreedom(solved.nullspace, i).length;
  });
  return free;
}

function study(spec) {
  const solved = analyzeContour(spec);
  return { solved, free: freedoms(solved) };
}

test('a length locks the length and leaves both endpoints free', () => {
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'length', edge: 'e0', value: 10 }],
    constraints: [],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 3, `dof ${solved.dof}`);
  assert.equal(solved.status, 'under');
  assert.deepEqual(free, { p0: 2, p1: 2 });
  assert.equal(solved.entities.points.p0, 'under');
  assert.equal(solved.entities.points.p1, 'under');
  assert.equal(contourEntityColor(solved.entities.points.p0), BLUE);
  assert.equal(contourPointDragAllowed(spec, 'p0'), true);
  assert.ok(Math.abs(gap(at(solved, 'p0'), at(solved, 'p1')) - 10) < 1e-4);
});

test('a point distance locks one degree of freedom even when the edit anchor is stored', () => {
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{
      id: 'd0',
      kind: 'distance',
      a: 'p0',
      b: 'p1',
      value: 10,
      at: { p0: [0, 0] },
    }],
    constraints: [],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 3, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 2, p1: 2 });
  assert.equal(solved.entities.points.p0, 'under');
  assert.equal(solved.entities.points.p1, 'under');
  assert.equal(contourEntityColor('under'), 0x22d3ee);
  assert.equal(contourPointDragAllowed(spec, 'p0'), true);
  assert.equal(contourPointDragAllowed(spec, 'p1'), true);
  assert.ok(Math.abs(gap(at(solved, 'p0'), at(solved, 'p1')) - 10) < 1e-4);
});

test('dragging one point of a distance moves the other and keeps the gap', () => {
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'p1', value: 10 }],
    constraints: [],
  };
  const moved = dragContourPoint(spec, 'p0', [0, 8]);
  const a = moved.spec.points.find((p) => p.id === 'p0').at;
  const b = moved.spec.points.find((p) => p.id === 'p1').at;
  assert.equal(moved.moved, true);
  assert.ok(Math.hypot(a[0], a[1] - 8) < 0.05, JSON.stringify(a));
  assert.ok(Math.hypot(b[0] - 10, b[1]) > 1, JSON.stringify(b));
  assert.ok(Math.abs(gap(a, b) - 10) < 1e-3, JSON.stringify([a, b]));
  const again = study(moved.spec);
  assert.equal(again.solved.dof, 3);
  assert.equal(again.solved.entities.points.p0, 'under');
  assert.equal(again.solved.entities.points.p1, 'under');
});

test('a line distance locks the gap and the parallel, and leaves the endpoints free', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [12, 0] },
      { id: 'p2', at: [1, 4] },
      { id: 'p3', at: [11, 4] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p2', b: 'p3' },
    ],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'e0', b: 'e1', value: 4 }],
    constraints: [],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 6, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 2, p1: 2, p2: 2, p3: 2 });
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    assert.equal(solved.entities.points[id], 'under');
  }
  const a = at(solved, 'p0');
  const b = at(solved, 'p1');
  const c = at(solved, 'p2');
  const dir = [b[0] - a[0], b[1] - a[1]];
  const other = [at(solved, 'p3')[0] - c[0], at(solved, 'p3')[1] - c[1]];
  const cross = dir[0] * other[1] - dir[1] * other[0];
  const L = Math.hypot(dir[0], dir[1]) || 1;
  const otherL = Math.hypot(other[0], other[1]) || 1;
  const signed = ((c[0] - a[0]) * (-dir[1]) + (c[1] - a[1]) * dir[0]) / L;
  assert.ok(Math.abs(cross) / (L * otherL) < 1e-4, `parallel ${cross}`);
  assert.ok(Math.abs(Math.abs(signed) - 4) < 1e-3, `gap ${signed}`);
});

test('an angle locks the angle and leaves every point free', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [0, 10] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p0', b: 'p2' },
    ],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'angle', a: 'e0', b: 'e1', value: 90, sense: 1 }],
    constraints: [],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 5, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 2, p1: 2, p2: 2 });
  assert.equal(solved.entities.points.p0, 'under');
  assert.equal(solved.entities.points.p1, 'under');
  assert.equal(solved.entities.points.p2, 'under');
  const d1 = [at(solved, 'p1')[0] - at(solved, 'p0')[0], at(solved, 'p1')[1] - at(solved, 'p0')[1]];
  const d2 = [at(solved, 'p2')[0] - at(solved, 'p0')[0], at(solved, 'p2')[1] - at(solved, 'p0')[1]];
  const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]) * 180 / Math.PI;
  assert.ok(Math.abs(Math.abs(turn) - 90) < 0.05, String(turn));
});

test('an offset locks the point-to-line gap and leaves the point free to slide', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [20, 0] },
      { id: 'p2', at: [6, 5] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'offset', point: 'p2', edge: 'e0', value: 5 }],
    constraints: [],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 5, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 2, p1: 2, p2: 2 });
  assert.equal(solved.entities.points.p2, 'under');
  assert.ok(Math.abs(at(solved, 'p2')[1] - 5) < 1e-3, JSON.stringify(at(solved, 'p2')));
});

test('a radius locks the radius and leaves the center free', () => {
  const spec = {
    points: [{ id: 'p0', at: [3, 4] }],
    lines: [],
    arcs: [{ id: 'a0', center: 'p0', radius: 8, full: true, sweep: 'ccw', segments: 16 }],
    dimensions: [{ id: 'd0', kind: 'radius', arc: 'a0', value: 8 }],
    constraints: [],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 2, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 2 });
  assert.equal(solved.entities.points.p0, 'under');
  assert.equal(solved.entities.arcs.a0, 'under');
  assert.ok(Math.abs(solved.arcs[0].radius - 8) < 1e-6);
  const radiusIndex = spec.points.length * 2;
  let radiusFree = 0;
  for (const vec of solved.nullspace) radiusFree += (vec[radiusIndex] || 0) ** 2;
  assert.ok(Math.sqrt(radiusFree) < 1e-6, `radius still free ${radiusFree}`);
});

test('a point-to-reference-edge distance leaves the point free to slide along the edge', () => {
  const spec = {
    points: [{ id: 'p0', at: [5, 3] }],
    lines: [],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'r0', value: 3 }],
    constraints: [],
    refs: [{
      id: 'r0',
      kind: 'edge',
      geom: { kind: 'line', a: [0, 0], b: [10, 0] },
    }],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 1, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 1 });
  assert.equal(solved.entities.points.p0, 'under');
  assert.equal(contourEntityColor(solved.entities.points.p0), BLUE);
  assert.equal(contourPointDragAllowed(spec, 'p0'), true);
  assert.ok(Math.abs(at(solved, 'p0')[1] - 3) < 1e-3, JSON.stringify(at(solved, 'p0')));

  const slid = dragContourPoint(spec, 'p0', [12, 9]);
  const uv = slid.spec.points[0].at;
  assert.ok(Math.abs(uv[0] - 12) < 0.05, JSON.stringify(uv));
  assert.ok(Math.abs(uv[1] - 3) < 1e-3, JSON.stringify(uv));
});

test('a fix still removes both coordinates, and a distance then leaves one', () => {
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'p1', value: 10 }],
    constraints: [{ id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } }],
  };
  const { solved, free } = study(spec);
  assert.equal(solved.dof, 1, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.deepEqual(free, { p0: 0, p1: 1 });
  assert.equal(solved.entities.points.p0, 'full');
  assert.equal(solved.entities.points.p1, 'under');
  assert.equal(contourEntityColor('full'), 0x000000);
  assert.equal(contourPointDragAllowed(spec, 'p0'), false);
  assert.equal(contourPointDragAllowed(spec, 'p1'), true);
});

test('typing a point distance pins the first point for that solve and then drops the pin', () => {
  const armed = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [10, 0]] },
  }, 'dimension');
  const state = liveDimension({
    ...armed,
    picks: [{ id: 'p0', kind: 'point' }, { id: 'p1', kind: 'point' }],
  }, { kind: 'distance', valueMm: 30 }).state;
  const contour = state.params.contour;
  const p0 = contour.points.find((p) => p.id === 'p0').at;
  const p1 = contour.points.find((p) => p.id === 'p1').at;
  assert.ok(Math.hypot(p0[0], p0[1]) < 1e-3, JSON.stringify(p0));
  assert.ok(Math.abs(gap(p0, p1) - 30) < 1e-3, JSON.stringify(p1));
  assert.equal((contour.constraints || []).some((item) => item.id === '__contourDrivePin'), false);
  const { solved, free } = study(contour);
  assert.equal(solved.dof, 3, `dof ${solved.dof} free ${JSON.stringify(free)}`);
  assert.equal(solved.entities.points.p0, 'under');
  assert.equal(solved.entities.points.p1, 'under');
});
