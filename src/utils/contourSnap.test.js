import assert from 'node:assert/strict';
import test from 'node:test';
import { contourFromPolyline } from './contourSolve.js';
import {
  CONTOUR_SNAP_PX,
  applyContourSnap,
  chooseContourSnap,
  contourSnapAllowed,
  placeSnappedContourPoint,
  snapContourPoint,
} from './contourSnap.js';

const projectUv = (uv) => ({ x: uv[0], y: uv[1] });

function rect() {
  return contourFromPolyline([[0, 0], [40, 0], [40, 40], [0, 40]]);
}

function edgeRef(over = {}) {
  return {
    kind: 'edge',
    faceA: 1,
    faceB: 2,
    mid: [0, 15, 0],
    refKey: 'wall:base:v-:w0',
    geom: { kind: 'line', a: [-20, 15], b: [20, 15] },
    bias: 10,
    ...over,
  };
}

test('an endpoint inside the radius beats a closer edge', () => {
  const snap = chooseContourSnap({
    x: 0,
    y: 3,
    endpoints: [{ x: 0, y: 12, uv: [0, 12], target: { kind: 'point', id: 'p9' } }],
    curves: [{
      samples: [{ x: -20, y: 0, uv: [-20, 0] }, { x: 20, y: 0, uv: [20, 0] }],
      target: { kind: 'line', id: 'e0' },
    }],
  });
  assert.equal(snap.role, 'endpoint');
  assert.equal(snap.target.id, 'p9');
  assert.ok(snap.distance > 3);
});

test('outside the radius snaps to nothing', () => {
  const snap = chooseContourSnap({
    x: 0,
    y: CONTOUR_SNAP_PX + 2,
    curves: [{
      samples: [{ x: -20, y: 0, uv: [-20, 0] }, { x: 20, y: 0, uv: [20, 0] }],
      target: { kind: 'line', id: 'e0' },
    }],
  });
  assert.equal(snap, null);
});

test('a nearer collinear skin wins a screen tie', () => {
  const curve = (bias, key) => ({
    bias,
    samples: [{ x: -10, y: 0, uv: [-10, bias] }, { x: 10, y: 0, uv: [10, bias] }],
    target: { kind: 'ref', ref: { refKey: key, kind: 'edge' } },
  });
  const snap = chooseContourSnap({
    x: 0,
    y: 0,
    curves: [curve(30, 'wall:base:v-:w1'), curve(8, 'wall:base:v-:w0')],
  });
  assert.equal(snap.target.ref.refKey, 'wall:base:v-:w0');
});

test('a clearly closer pixel still beats the nearer skin', () => {
  const snap = chooseContourSnap({
    x: 0,
    y: 4,
    curves: [
      {
        bias: 8,
        samples: [{ x: -10, y: 0, uv: [-10, 0] }, { x: 10, y: 0, uv: [10, 0] }],
        target: { kind: 'ref', ref: { refKey: 'front' } },
      },
      {
        bias: 40,
        samples: [{ x: -10, y: 4, uv: [-10, 4] }, { x: 10, y: 4, uv: [10, 4] }],
        target: { kind: 'ref', ref: { refKey: 'back' } },
      },
    ],
  });
  assert.equal(snap.target.ref.refKey, 'back');
});

test('snap targets a sketch line, a sketch arc, and a part edge', () => {
  const model = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [30, 0] },
      { id: 'c0', at: [0, 40] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [{ id: 'a0', center: 'c0', radius: 20, full: true }],
  };
  const line = snapContourPoint({
    x: 12,
    y: 4,
    model,
    projectUv,
  });
  assert.equal(line.role, 'edge');
  assert.equal(line.target.kind, 'line');
  assert.ok(Math.abs(line.uv[1]) < 1e-6);

  const arc = snapContourPoint({
    x: 20,
    y: 40,
    model,
    projectUv,
  });
  assert.equal(arc.role, 'edge');
  assert.equal(arc.target.id, 'a0');

  const part = snapContourPoint({
    x: 0,
    y: 12,
    model: { points: [], lines: [], arcs: [] },
    references: [edgeRef()],
    projectUv,
  });
  assert.equal(part.role, 'edge');
  assert.equal(part.key, 'wall:base:v-:w0');
  assert.ok(Math.abs(part.uv[1] - 15) < 1e-6);
});

test('a part-edge endpoint beats the edge', () => {
  const snap = snapContourPoint({
    x: 18,
    y: 12,
    model: { points: [], lines: [], arcs: [] },
    references: [edgeRef()],
    projectUv,
  });
  assert.equal(snap.role, 'endpoint');
  assert.equal(snap.target.ref.kind, 'vertex');
  assert.equal(snap.target.ref.geom.kind, 'point');
  assert.equal(snap.key, 'wall:base:v-:w0#1');
});

test('a closed reference has no endpoint', () => {
  const snap = snapContourPoint({
    x: 10,
    y: 0,
    model: { points: [], lines: [], arcs: [] },
    references: [{
      kind: 'edge',
      faceA: 3,
      faceB: 4,
      mid: [0, 0, 0],
      refKey: 'hole:h1:w0',
      geom: { kind: 'arc', center: [0, 0], radius: 10, full: true },
    }],
    projectUv,
  });
  assert.equal(snap.role, 'edge');
  assert.equal(snap.key, 'hole:h1:w0');
});

test('the dragged point and its own line are not snap targets', () => {
  const model = rect();
  const snap = snapContourPoint({
    x: 0,
    y: 2,
    model,
    projectUv,
    excludePointId: 'p0',
  });
  assert.equal(snap, null);
  const other = snapContourPoint({
    x: 40,
    y: 2,
    model,
    projectUv,
    excludePointId: 'p0',
  });
  assert.equal(other.role, 'endpoint');
  assert.equal(other.target.id, 'p1');
});

test('drawing onto a part edge does not split a distant sketch line', () => {
  const spec = contourFromPolyline([[0, 0], [10, 0]]);
  const snap = snapContourPoint({
    x: 4,
    y: 15,
    model: spec,
    references: [edgeRef()],
    projectUv,
  });
  const placed = placeSnappedContourPoint(spec, snap.uv, snap);
  assert.equal(placed.spec.lines.length, 2);
  assert.equal(placed.spec.lines[0].b, 'p1');
  assert.equal(placed.spec.lines[1].a, 'p1');
  assert.equal(placed.spec.lines[1].b, placed.pointId);
  const applied = applyContourSnap(placed.spec, placed.pointId, snap);
  assert.equal(applied.added, true);
  assert.equal(applied.constraint.kind, 'coincident');
  assert.equal(applied.constraint.items.length, 2);
  assert.ok(applied.constraint.items.includes(placed.pointId));
  const ref = applied.spec.refs.find((item) => item.refKey === 'wall:base:v-:w0');
  assert.ok(ref);
  assert.ok(applied.constraint.items.includes(ref.id));
  const at = applied.spec.points.find((p) => p.id === placed.pointId).at;
  assert.ok(Math.abs(at[1] - 15) < 0.05);
  assert.ok(at[0] >= -20 && at[0] <= 20);
});

test('an endpoint snap stores a two-point coincident', () => {
  const spec = contourFromPolyline([[0, 0], [10, 0], [10, 8]]);
  const snap = snapContourPoint({ x: 1, y: 1, model: spec, projectUv, excludePointId: 'p2' });
  assert.equal(snap.role, 'endpoint');
  assert.equal(snap.target.id, 'p0');
  const applied = applyContourSnap(spec, 'p2', snap);
  assert.equal(applied.added, true);
  assert.deepEqual(applied.constraint.items.slice().sort(), ['p0', 'p2']);
  const at = applied.spec.points.find((p) => p.id === 'p2').at;
  assert.ok(Math.abs(at[0]) < 0.05 && Math.abs(at[1]) < 0.05);
});

test('a vertex snap stores a point reference', () => {
  const spec = contourFromPolyline([[0, 0], [4, 0]]);
  const snap = snapContourPoint({
    x: 19,
    y: 14,
    model: spec,
    references: [edgeRef()],
    projectUv,
    excludePointId: 'p0',
  });
  assert.equal(snap.role, 'endpoint');
  const applied = applyContourSnap(spec, 'p1', snap);
  const ref = applied.spec.refs[0];
  assert.equal(ref.kind, 'vertex');
  assert.equal(ref.geom.kind, 'point');
  assert.equal(ref.refKey, 'wall:base:v-:w0');
  assert.equal(applied.constraint.items.length, 2);
  assert.ok(applied.constraint.items.includes('p1'));
  assert.ok(applied.constraint.items.includes(ref.id));
});

test('the same coincident is not added twice', () => {
  const spec = contourFromPolyline([[0, 0], [10, 0]]);
  const snap = snapContourPoint({
    x: 3,
    y: 14,
    model: spec,
    references: [edgeRef()],
    projectUv,
  });
  const once = applyContourSnap(spec, 'p1', snap);
  const twice = applyContourSnap(once.spec, 'p1', snap);
  assert.equal(twice.duplicate, true);
  assert.equal(twice.spec.constraints.filter((con) => con.kind === 'coincident').length, 1);
});

test('a sketch-line snap splits that line and locks the point to it', () => {
  const spec = contourFromPolyline([[0, 0], [40, 0]]);
  const snap = snapContourPoint({
    x: 20,
    y: 4,
    model: spec,
    projectUv,
  });
  assert.equal(snap.target.id, 'e0');
  const placed = placeSnappedContourPoint(spec, snap.uv, snap);
  assert.equal(placed.spec.lines.find((line) => line.id === 'e0').b, placed.pointId);
  const applied = applyContourSnap(placed.spec, placed.pointId, snap);
  assert.equal(applied.constraint.items.length, 2);
  assert.ok(applied.constraint.items.includes('e0'));
});

test('a sketch-arc snap is a point-arc coincident', () => {
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'c0', at: [0, 20] }],
    lines: [],
    arcs: [{ id: 'a0', center: 'c0', radius: 20, full: true, sweep: 'ccw' }],
    dimensions: [],
    constraints: [],
  };
  const snap = snapContourPoint({ x: 20, y: 20, model: spec, projectUv, excludePointId: 'p0' });
  assert.equal(snap.target.kind, 'arc');
  const applied = applyContourSnap(spec, 'p0', snap);
  assert.deepEqual(applied.constraint.items.slice().sort(), ['a0', 'p0']);
  const at = applied.spec.points.find((p) => p.id === 'p0').at;
  const radius = Math.hypot(at[0] - 0, at[1] - 20);
  assert.ok(Math.abs(radius - 20) < 0.05);
});

test('dimension, constrain, arc, and cursor do not snap', () => {
  assert.equal(contourSnapAllowed({ tool: 'polyline', gesture: null }), true);
  assert.equal(contourSnapAllowed({ tool: 'polyline', gesture: 'dimension' }), false);
  assert.equal(contourSnapAllowed({ tool: 'polyline', gesture: 'constraints' }), false);
  assert.equal(contourSnapAllowed({ tool: 'polyline', gesture: 'arc' }), false);
  assert.equal(contourSnapAllowed({ tool: 'cursor', gesture: null }), false);
  assert.equal(contourSnapAllowed(null), false);
});
