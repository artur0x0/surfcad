import assert from 'node:assert/strict';
import test from 'node:test';
import { contourFromRectangle, solveContour } from './contourSolve.js';
import { emitSolveContour, parseSolveContour } from './contourScript.js';
import { specFromSolved } from './contourGesture.js';
import { projectReference, REF_DEGENERATE_MM } from './contourRef.js';

const XY = {
  center: [0, 0, 0],
  normal: [0, 0, 1],
  x: [1, 0, 0],
  y: [0, 1, 0],
};

function at(solved, id) {
  return solved.points.find((p) => p.id === id).at;
}

function circleSamples(radius, tilt) {
  const pts = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = (i / 24) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([
      radius * c,
      radius * s * Math.cos(tilt),
      radius * s * Math.sin(tilt),
    ]);
  }
  return pts;
}

test('a straight edge projects to a line, and a normal edge is broken', () => {
  const flat = projectReference(XY, [[0, 0, 0], [10, 0, 0]]);
  assert.equal(flat.broken, false);
  assert.equal(flat.geom.kind, 'line');
  assert.ok(Math.hypot(flat.geom.b[0] - flat.geom.a[0], flat.geom.b[1] - flat.geom.a[1]) > 9.9);

  const tilted = projectReference(XY, [[0, 0, 0], [10, 0, 10]]);
  assert.equal(tilted.geom.kind, 'line');
  const span = Math.hypot(tilted.geom.b[0] - tilted.geom.a[0], tilted.geom.b[1] - tilted.geom.a[1]);
  assert.ok(Math.abs(span - 10) < 1e-6, `projected length ${span}`);

  const normal = projectReference(XY, [[0, 0, 0], [0, 0, 10]]);
  assert.equal(normal.broken, true);
  assert.equal(normal.geom, null);

  const stub = projectReference(XY, [[0, 0, 0], [REF_DEGENERATE_MM * 0.4, 0, 8]]);
  assert.equal(stub.broken, true);
});

test('a vertex is a point, a circle in the plane is an arc, a tilted circle is not', () => {
  const vertex = projectReference(XY, [[3, 4, 5]]);
  assert.equal(vertex.broken, false);
  assert.equal(vertex.geom.kind, 'point');
  assert.ok(Math.abs(vertex.geom.at[0] - 3) < 1e-9);
  assert.ok(Math.abs(vertex.geom.at[1] - 4) < 1e-9);

  const flat = projectReference(XY, circleSamples(10, 0));
  assert.equal(flat.geom.kind, 'arc');
  assert.equal(flat.geom.full, true);
  assert.ok(Math.abs(flat.geom.radius - 10) < 1e-6, flat.geom.radius);

  const edgeOn = projectReference(XY, circleSamples(10, Math.PI / 2));
  assert.equal(edgeOn.geom.kind, 'line');

  const tilted = projectReference(XY, circleSamples(10, Math.PI / 4));
  assert.equal(tilted.broken, false);
  assert.equal(tilted.geom.kind, 'polyline');
  assert.ok(tilted.geom.points.length > 4);
});

test('a face loop that is not a line or a circle stays a polyline', () => {
  const loop = projectReference(XY, [
    [0, 0, 0],
    [12, 0, 1],
    [12, 8, 1],
    [0, 8, 0],
    [0, 0, 0],
  ]);
  assert.equal(loop.broken, false);
  assert.equal(loop.geom.kind, 'polyline');
});

test('refs emit and parse, and an old call has an empty list', () => {
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [4, 0] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [],
    constraints: [],
    refs: [{
      id: 'r0',
      kind: 'face',
      faceA: 2,
      faceB: 5,
      faceId: 7,
      mid: [1, 2, 3],
      boundary: { faceA: 2, faceB: 5, mid: [1, 2, 3] },
      geom: { kind: 'line', a: [0, 0], b: [4, 0] },
    }, {
      id: 'r1',
      kind: 'vertex',
      faceA: 2,
      faceB: 5,
      end: 0,
      mid: [0, 0, 0],
      geom: { kind: 'point', at: [0, 0] },
    }],
  };
  const text = emitSolveContour(spec);
  assert.match(text, /refs:/);
  const parsed = parseSolveContour(text);
  assert.equal(parsed.refs[0].kind, 'face');
  assert.equal(parsed.refs[0].faceA, 2);
  assert.equal(parsed.refs[0].faceB, 5);
  assert.equal(parsed.refs[0].faceId, 7);
  assert.deepEqual(parsed.refs[0].mid, [1, 2, 3]);
  assert.deepEqual(parsed.refs[0].boundary.mid, [1, 2, 3]);
  assert.equal(parsed.refs[0].geom.kind, 'line');
  assert.equal(parsed.refs[1].kind, 'vertex');
  assert.equal(parsed.refs[1].end, 0);
  assert.equal(parsed.refs[1].geom.kind, 'point');
  const again = emitSolveContour(specFromSolved(solveContour(parsed)));
  assert.equal(parseSolveContour(again).refs.length, 2);
  assert.equal(parseSolveContour(again).refs[0].geom.kind, 'line');

  const bare = parseSolveContour('solveContour({ points: [], lines: [], arcs: [], dimensions: [], constraints: [] })');
  assert.deepEqual(bare.refs, []);
  assert.equal(emitSolveContour({
    points: [], lines: [], arcs: [], dimensions: [], constraints: [],
  }).includes('refs:'), false);
});

test('on-edge uses the segment, and distance uses the infinite line', () => {
  const segment = { kind: 'line', a: [0, 0], b: [1, 0] };
  const onEdge = solveContour({
    points: [{ id: 'p0', at: [2, 5] }],
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'coincident', items: ['p0', 'r0'] }],
    refs: [{ id: 'r0', kind: 'edge', faceA: 1, faceB: 2, mid: [0.5, 0, 0], geom: segment }],
  });
  const landed = at(onEdge, 'p0');
  assert.ok(landed[0] >= -1e-3 && landed[0] <= 1 + 1e-3, `on-edge stays on the segment ${landed}`);
  assert.ok(Math.abs(landed[1]) < 1e-3, `on-edge v ${landed}`);

  const gap = solveContour({
    points: [{ id: 'p0', at: [2, 5] }],
    lines: [],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'r0', value: 0 }],
    constraints: [],
    refs: [{ id: 'r0', kind: 'edge', geom: segment }],
  });
  const along = at(gap, 'p0');
  assert.ok(Math.abs(along[0] - 2) < 1e-3, `distance keeps u ${along}`);
  assert.ok(Math.abs(along[1]) < 1e-3, `distance drops v ${along}`);
});

test('parallel, perpendicular, point distance, and tangent use a fixed reference', () => {
  const axis = { kind: 'line', a: [0, 0], b: [10, 0] };
  const parallel = solveContour({
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [2, 2] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'parallel', items: ['e0', 'r0'] }],
    refs: [{ id: 'r0', kind: 'edge', geom: axis }],
  });
  const p0 = at(parallel, 'p0');
  const p1 = at(parallel, 'p1');
  assert.ok(Math.abs(p0[1] - p1[1]) < 1e-3, `parallel ${p0} ${p1}`);
  assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1);

  const perpendicular = solveContour({
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [4, 0.5] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'length', edge: 'e0', value: 4 }],
    constraints: [
      { id: 'kFix', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
      { id: 'k0', kind: 'perpendicular', items: ['e0', 'r0'] },
    ],
    refs: [{ id: 'r0', kind: 'edge', geom: axis }],
  });
  const q0 = at(perpendicular, 'p0');
  const q1 = at(perpendicular, 'p1');
  assert.ok(Math.abs(q0[0]) < 1e-3 && Math.abs(q0[1]) < 1e-3, `perpendicular anchor ${q0}`);
  assert.ok(Math.abs(q1[0]) < 1e-2, `perpendicular ${q1}`);
  assert.ok(Math.abs(Math.abs(q1[1]) - 4) < 1e-2, `perpendicular length ${q1}`);

  const spaced = solveContour({
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [0, 1] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p1', b: 'r0', value: 4 }],
    constraints: [
      { id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
      { id: 'k1', kind: 'vertical', items: ['e0'] },
    ],
    refs: [{ id: 'r0', kind: 'vertex', geom: { kind: 'point', at: [0, 10] } }],
  });
  const s = at(spaced, 'p1');
  assert.ok(Math.abs(s[0]) < 1e-3 && Math.abs(Math.abs(s[1]) - 6) < 1e-2, `spaced ${s}`);

  const tangent = solveContour({
    points: [{ id: 'p0', at: [-10, 8] }, { id: 'p1', at: [10, 8] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [],
    constraints: [
      { id: 'k0', kind: 'horizontal', items: ['e0'] },
      { id: 'k1', kind: 'tangent', items: ['e0', 'r0'], side: -1 },
    ],
    refs: [{
      id: 'r0',
      kind: 'edge',
      geom: { kind: 'arc', center: [0, 0], radius: 5, full: true, sweep: 'ccw' },
    }],
  });
  assert.ok(Math.abs(at(tangent, 'p0')[1] - 5) < 1e-3, at(tangent, 'p0'));
  assert.ok(Math.abs(at(tangent, 'p1')[1] - 5) < 1e-3, at(tangent, 'p1'));
});

test('a polyline takes on-edge and distance, and refuses parallel', () => {
  const chain = {
    kind: 'polyline',
    points: [[0, 0], [4, 0], [4, 4]],
  };
  const onEdge = solveContour({
    points: [{ id: 'p0', at: [3, 2] }],
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'coincident', items: ['p0', 'r0'] }],
    refs: [{ id: 'r0', kind: 'edge', geom: chain }],
  });
  const p = at(onEdge, 'p0');
  assert.ok(Math.abs(p[0] - 4) < 1e-3 && Math.abs(p[1] - 2) < 1e-3, `polyline on-edge ${p}`);

  const spaced = solveContour({
    points: [{ id: 'p0', at: [6, 2] }],
    lines: [],
    arcs: [],
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'r0', value: 2 }],
    constraints: [],
    refs: [{ id: 'r0', kind: 'edge', geom: chain }],
  });
  const s = at(spaced, 'p0');
  assert.ok(Math.abs(s[0] - 6) < 1e-3 && Math.abs(s[1] - 2) < 1e-3, `polyline distance ${s}`);

  assert.throws(() => solveContour({
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [1, 1] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'parallel', items: ['e0', 'r0'] }],
    refs: [{ id: 'r0', kind: 'edge', geom: chain }],
  }), /line reference/);
});

test('two references are refused, and a broken reference adds no residual', () => {
  assert.throws(() => solveContour({
    points: [],
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'parallel', items: ['r0', 'r1'] }],
    refs: [
      { id: 'r0', kind: 'edge', geom: { kind: 'line', a: [0, 0], b: [1, 0] } },
      { id: 'r1', kind: 'edge', geom: { kind: 'line', a: [0, 1], b: [1, 1] } },
    ],
  }), /two references/);

  const broken = solveContour({
    points: [{ id: 'p0', at: [0, 5] }],
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'coincident', items: ['p0', 'r0'] }],
    refs: [{
      id: 'r0',
      kind: 'edge',
      broken: true,
      geom: { kind: 'line', a: [0, 0], b: [10, 0] },
    }],
  });
  assert.deepEqual(broken.broken, ['r0']);
  assert.ok(Math.abs(at(broken, 'p0')[1] - 5) < 1e-6);

  const short = solveContour({
    points: [{ id: 'p0', at: [0, 5] }],
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'coincident', items: ['p0', 'r0'] }],
    refs: [{
      id: 'r0',
      kind: 'edge',
      geom: { kind: 'line', a: [0, 0], b: [0.01, 0] },
    }],
  });
  assert.deepEqual(short.broken, ['r0']);
  assert.ok(Math.abs(at(short, 'p0')[1] - 5) < 1e-6);
});

test('a reference is not a profile ring', () => {
  const rect = contourFromRectangle(40, 20, true);
  const plain = solveContour(rect);
  const withRef = solveContour({
    ...rect,
    refs: [{
      id: 'r0',
      kind: 'edge',
      faceA: 0,
      faceB: 1,
      mid: [0, 100, 0],
      geom: { kind: 'line', a: [-100, 100], b: [100, 100] },
    }],
  });
  assert.deepEqual(withRef.contours, plain.contours);
  assert.equal(withRef.refs.length, 1);
  assert.equal(withRef.refs[0].id, 'r0');
  assert.deepEqual(withRef.broken, []);
});
