import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeContour,
  contourFromPolyline,
  contourFromRectangle,
  roundContourCorner,
} from './contourSolve.js';
import { contourPointDragAllowed, dragContourPoint, pointFreedom } from './contourDrag.js';
import { CONTOUR_STATUS_COLOR, contourEntityColor } from './contourStatus.js';
import { armContourGesture, enterContourState, saveContourConstraint, saveContourDimension } from './contourMode.js';
import { constraintAnchor } from './contourPick.js';
import { liveDimension } from './contourGesture.js';

const BLUE = CONTOUR_STATUS_COLOR.under;

function gap(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function segmentAngle(solved, aId, bId) {
  const pa = Object.fromEntries(solved.points.map((p) => [p.id, p.at]));
  const la = solved.lines.find((l) => l.id === aId);
  const lb = solved.lines.find((l) => l.id === bId);
  const d1 = [pa[la.b][0] - pa[la.a][0], pa[la.b][1] - pa[la.a][1]];
  const d2 = [pa[lb.b][0] - pa[lb.a][0], pa[lb.b][1] - pa[lb.a][1]];
  const dot = d1[0] * d2[0] + d1[1] * d2[1];
  const n = Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]);
  return Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180 / Math.PI;
}

function at(solved, id) {
  return solved.points.find((p) => p.id === id).at;
}

function lineLengths(solved) {
  const pa = Object.fromEntries(solved.points.map((p) => [p.id, p.at]));
  const out = {};
  for (const line of solved.lines) out[line.id] = gap(pa[line.a], pa[line.b]);
  return out;
}

function drawnLengths(uvs) {
  const out = {};
  for (let i = 0; i < uvs.length; i += 1) {
    const a = uvs[i];
    const b = uvs[(i + 1) % uvs.length];
    out[`e${i}`] = Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return out;
}

function assertLengthHeld(got, drawn, label) {
  const tol = Math.max(2.5, drawn * 0.08);
  assert.ok(Math.abs(got - drawn) <= tol, `${label} length ${got} vs ${drawn}`);
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

test('a perpendicular on two polyline segments is one real constraint', () => {
  const armed = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [40, 2], [46, 28], [4, 24]] },
  }, 'constraints');
  const saved = saveContourConstraint({
    ...armed,
    picks: [{ id: 'e0', kind: 'line' }, { id: 'e1', kind: 'line' }],
  }, { kind: 'perpendicular', side: 1 });
  assert.equal(saved.error, null);
  assert.equal(saved.state.gestureNote, null);
  assert.deepEqual(saved.state.picks, []);
  const contour = saved.state.params.contour;
  assert.equal(contour.polyline, true);
  assert.equal(contour.constraints.length, 1);
  const solved = analyzeContour(contour);
  assert.equal(solved.status, 'under');
  assert.equal(solved.dof, 7, `dof ${solved.dof}`);
  assert.deepEqual(solved.repeated, []);
  assert.equal(solved.conflict, null);
  assert.equal(solved.entities.lines.e0, 'under');
  assert.equal(solved.entities.lines.e1, 'under');
  assert.equal(contourEntityColor(solved.entities.lines.e0), BLUE);
  assert.notEqual(contourEntityColor(solved.entities.lines.e0), 0xfbbf24);
  assert.notEqual(contourEntityColor(solved.entities.lines.e0), CONTOUR_STATUS_COLOR.conflict);
  assert.ok(Math.abs(segmentAngle(solved, 'e0', 'e1') - 90) < 0.05);
});

function copyStep(item) {
  if (Array.isArray(item)) return item.slice();
  const copy = { ...item };
  if (Array.isArray(item.items)) copy.items = item.items.slice();
  return copy;
}

function permutations(items) {
  if (items.length <= 1) return [items.map(copyStep)];
  const out = [];
  items.forEach((item, index) => {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    for (const tail of permutations(rest)) out.push([copyStep(item), ...tail]);
  });
  return out;
}

function addPerpendiculars(uvs, order) {
  let state = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: uvs.map((p) => p.slice()) },
  }, 'constraints');
  for (const [a, b] of order) {
    const saved = saveContourConstraint({
      ...state,
      picks: [{ id: a, kind: 'line' }, { id: b, kind: 'line' }],
    }, { kind: 'perpendicular', side: 1 });
    assert.equal(saved.error, null, `${order.map((pair) => pair.join('')).join('>')} ${saved.error}`);
    state = saved.state;
  }
  return state;
}

test('perpendiculars on one polyline match in every add order', () => {
  const uvs = [[0, 0], [40, 2], [46, 28], [4, 24]];
  const sets = [
    [['e0', 'e1'], ['e2', 'e3']],
    [['e0', 'e1'], ['e1', 'e2'], ['e2', 'e3']],
  ];
  for (const pairs of sets) {
    const runs = permutations(pairs).map((order) => {
      const state = addPerpendiculars(uvs, order);
      const contour = state.params.contour;
      const solved = analyzeContour(contour);
      return { order, contour, solved };
    });
    const reference = runs[0];
    for (const run of runs) {
      const label = run.order.map((pair) => pair.join('')).join('>');
      assert.equal(run.solved.status, 'under', label);
      assert.equal(run.solved.conflict, null, label);
      assert.deepEqual(run.solved.repeated, [], label);
      assert.equal(run.solved.dof, reference.solved.dof, label);
      for (const [a, b] of pairs) {
        assert.ok(Math.abs(segmentAngle(run.solved, a, b) - 90) < 0.05, `${label} ${a} ${b}`);
      }
      for (const line of run.solved.lines) {
        assert.equal(run.solved.entities.lines[line.id], 'under', `${label} ${line.id}`);
        const color = contourEntityColor(run.solved.entities.lines[line.id]);
        assert.notEqual(color, 0xfbbf24, label);
        assert.notEqual(color, CONTOUR_STATUS_COLOR.conflict, label);
      }
      const drawn = drawnLengths(uvs);
      const lengths = lineLengths(run.solved);
      for (const [id, length] of Object.entries(drawn)) {
        assertLengthHeld(lengths[id], length, `${label} ${id}`);
      }
      run.contour.points.forEach((point, index) => {
        assert.ok(Math.hypot(point.seed[0] - uvs[index][0], point.seed[1] - uvs[index][1]) < 1e-4, label);
      });
    }
  }
});

const INCH = 25.4;

function addSketchSteps(uvs, steps) {
  let state = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: uvs.map((p) => p.slice()) },
  }, 'constraints');
  for (const step of steps) {
    const saved = step.kind === 'length'
      ? saveContourDimension({
        ...state,
        gesture: 'dimension',
        picks: [{ id: step.edge, kind: 'line' }],
      }, { kind: 'length', valueMm: step.value })
      : saveContourConstraint({
        ...state,
        gesture: 'constraints',
        picks: step.items.map((id) => ({ id, kind: 'line' })),
      }, { kind: 'perpendicular', side: 1 });
    assert.equal(saved.error, null, `${JSON.stringify(step)} ${saved.error}`);
    state = saved.state;
  }
  return state;
}

test('a 1.5 in side and the two corner perpendiculars match in every order', () => {
  // The working phone sketch: a free quad, a 1.5000 in width, and two
  // perpendiculars whose pluses sit side by side. Each plus is the average
  // of the two edge midpoints, so the pair is the two corners of one edge.
  const uvs = [[0, 0], [34, 3], [38, 78], [2, 74]];
  const width = 1.5 * INCH;
  const sets = [
    [
      { kind: 'length', edge: 'e0', value: width },
      { kind: 'perpendicular', items: ['e3', 'e0'] },
      { kind: 'perpendicular', items: ['e0', 'e1'] },
    ],
    [
      { kind: 'length', edge: 'e0', value: width },
      { kind: 'perpendicular', items: ['e1', 'e2'] },
      { kind: 'perpendicular', items: ['e2', 'e3'] },
    ],
  ];
  for (const steps of sets) {
    const perps = steps.filter((step) => step.kind === 'perpendicular');
    const runs = permutations(steps).map((order) => {
      const state = addSketchSteps(uvs, order);
      const solved = analyzeContour(state.params.contour);
      return { order, solved };
    });
    const reference = runs[0].solved;
    for (const run of runs) {
      const label = run.order.map((step) => (
        step.kind === 'length' ? `L${step.edge}` : step.items.join('')
      )).join('>');
      assert.equal(run.solved.status, 'under', label);
      assert.equal(run.solved.conflict, null, label);
      assert.deepEqual(run.solved.repeated, [], label);
      assert.equal(run.solved.dof, reference.dof, label);
      const edge = run.solved.lines.find((line) => line.id === 'e0');
      const pa = Object.fromEntries(run.solved.points.map((p) => [p.id, p.at]));
      assert.ok(Math.abs(gap(pa[edge.a], pa[edge.b]) - width) < 1e-3, label);
      for (const step of perps) {
        assert.ok(Math.abs(segmentAngle(run.solved, step.items[0], step.items[1]) - 90) < 0.05, label);
      }
      for (const line of run.solved.lines) {
        assert.equal(run.solved.entities.lines[line.id], 'under', `${label} ${line.id}`);
        const color = contourEntityColor(run.solved.entities.lines[line.id]);
        assert.equal(color, BLUE, label);
      }
      const anchors = run.solved.constraints
        .filter((con) => con.kind === 'perpendicular')
        .map((con) => constraintAnchor(run.solved, con));
      assert.equal(anchors.length, 2, label);
      assert.ok(Math.abs(anchors[0][1] - anchors[1][1]) < 2, `${label} pluses share a row`);
      assert.ok(Math.abs(anchors[0][0] - anchors[1][0]) > 8, `${label} pluses sit apart`);
      const drawn = drawnLengths(uvs);
      const lengths = lineLengths(run.solved);
      for (const [id, length] of Object.entries(drawn)) {
        if (id === 'e0') continue;
        assertLengthHeld(lengths[id], length, `${label} ${id}`);
      }
    }
  }
});

test('parallel and perpendicular keep every line length in every order', () => {
  const uvs = [[0, 0], [40, 2], [46, 28], [4, 24]];
  const drawn = drawnLengths(uvs);
  const sets = [
    [
      { kind: 'parallel', items: ['e0', 'e1'] },
      { kind: 'parallel', items: ['e2', 'e3'] },
    ],
    [
      { kind: 'parallel', items: ['e0', 'e2'] },
      { kind: 'parallel', items: ['e1', 'e3'] },
    ],
    [
      { kind: 'perpendicular', items: ['e0', 'e1'] },
      { kind: 'perpendicular', items: ['e2', 'e3'] },
    ],
    [
      { kind: 'parallel', items: ['e0', 'e2'] },
      { kind: 'perpendicular', items: ['e0', 'e1'] },
    ],
  ];
  for (const steps of sets) {
    for (const order of permutations(steps)) {
      let state = armContourGesture({
        ...enterContourState('crossSection', null),
        tool: 'polyline',
        params: { points: uvs.map((p) => p.slice()) },
      }, 'constraints');
      const label = order.map((step) => `${step.kind}:${step.items.join('')}`).join('>');
      let before = drawn;
      for (const step of order) {
        const saved = saveContourConstraint({
          ...state,
          picks: step.items.map((id) => ({ id, kind: 'line' })),
        }, { kind: step.kind, side: 1 });
        assert.equal(saved.error, null, `${label} ${saved.error}`);
        state = saved.state;
        const solved = analyzeContour(state.params.contour);
        assert.equal(solved.status, 'under', label);
        assert.equal(solved.conflict, null, label);
        assert.deepEqual(solved.repeated, [], label);
        const turn = segmentAngle(solved, step.items[0], step.items[1]);
        if (step.kind === 'perpendicular') {
          assert.ok(Math.abs(turn - 90) < 0.05, `${label} ${turn}`);
        } else {
          assert.ok(turn < 0.05 || turn > 179.95, `${label} ${turn}`);
        }
        const lengths = lineLengths(solved);
        for (const [id, length] of Object.entries(before)) {
          assertLengthHeld(lengths[id], length, `${label} after ${step.kind} ${id}`);
          assert.ok(lengths[id] < length * 2 + 1, `${label} ${id} exploded ${lengths[id]}`);
        }
        for (const line of solved.lines) {
          assert.equal(solved.entities.lines[line.id], 'under', `${label} ${line.id}`);
          const color = contourEntityColor(solved.entities.lines[line.id]);
          assert.equal(color, BLUE, label);
        }
        before = lengths;
      }
    }
  }
});

test('a corner arc plus a perpendicular does not mark a real tangent repeated', () => {
  const rounded = roundContourCorner(
    contourFromPolyline([[0, 0], [40, 0], [50, 8], [5, 10]]),
    ['e0', 'e1'],
    2,
  );
  rounded.constraints.push({ id: 'kp', kind: 'perpendicular', items: ['e0', 'e1'] });
  const solved = analyzeContour(rounded);
  assert.equal(solved.status, 'under');
  assert.equal(solved.conflict, null);
  assert.deepEqual(solved.repeated, []);
  assert.equal(solved.entities.lines.e0, 'under');
  assert.equal(solved.entities.lines.e1, 'under');
  assert.ok(Math.abs(segmentAngle(solved, 'e0', 'e1') - 90) < 0.05);
});

test('an endpoint coincident on its own segment stays repeated, and the perpendicular does not', () => {
  const spec = contourFromPolyline([[0, 0], [40, 2], [46, 28], [4, 24]]);
  spec.constraints.push(
    { id: 'c0', kind: 'coincident', items: ['p0', 'e0'] },
    { id: 'c1', kind: 'coincident', items: ['p1', 'e1'] },
    { id: 'kp', kind: 'perpendicular', items: ['e0', 'e1'] },
  );
  const solved = analyzeContour(spec);
  assert.equal(solved.status, 'under');
  assert.equal(solved.conflict, null);
  assert.ok(solved.repeated.some((item) => item.id === 'c0' && item.warning === 'repeated'));
  assert.ok(solved.repeated.some((item) => item.id === 'c1' && item.warning === 'repeated'));
  assert.equal(solved.repeated.some((item) => item.id === 'kp'), false);
  assert.equal(solved.entities.lines.e0, 'under');
  assert.ok(Math.abs(segmentAngle(solved, 'e0', 'e1') - 90) < 0.05);
});

test('a perpendicular already implied by horizontal and vertical stays repeated', () => {
  const spec = contourFromPolyline([[0, 0], [30, 0], [28, 20], [2, 22]]);
  spec.constraints.push(
    { id: 'kh', kind: 'horizontal', items: ['e0'] },
    { id: 'kv', kind: 'vertical', items: ['e1'] },
    { id: 'kp', kind: 'perpendicular', items: ['e0', 'e1'] },
  );
  const solved = analyzeContour(spec);
  assert.equal(solved.status, 'under');
  assert.equal(solved.conflict, null);
  assert.deepEqual(solved.repeated, [{ id: 'kp', warning: 'repeated' }]);
  assert.ok(Math.abs(segmentAngle(solved, 'e0', 'e1') - 90) < 0.05);
  assert.equal(solved.entities.lines.e0, 'under');
});

test('parallel and perpendicular on the same pair stays a conflict', () => {
  const spec = contourFromRectangle(40, 20, true);
  spec.dimensions = [];
  spec.constraints = [
    { id: 'k0', kind: 'parallel', items: ['e0', 'e1'] },
    { id: 'k1', kind: 'perpendicular', items: ['e0', 'e1'] },
  ];
  const solved = analyzeContour(spec);
  assert.equal(solved.status, 'conflict');
  assert.deepEqual(solved.repeated, []);
  assert.equal(solved.entities.lines.e0, 'conflict');
  assert.equal(solved.entities.lines.e1, 'conflict');
  assert.equal(contourEntityColor(solved.entities.lines.e0), CONTOUR_STATUS_COLOR.conflict);
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
