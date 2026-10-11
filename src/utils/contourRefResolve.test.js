import assert from 'node:assert/strict';
import test from 'node:test';
import { emitSolveContour } from './contourScript.js';
import { emitPlaneFrameLiteral } from './helperPaletteSnippets.js';
import {
  matchBoundaryEdge,
  resolveContourScript,
  resolveContourSpec,
} from './contourRefResolve.js';

const plane = { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };

function edge(faceA, faceB, a, b) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return {
    faceA,
    faceB,
    mid,
    segments: [{ a: 0, b: 1, va: a.slice(), vb: b.slice() }],
  };
}

function square(points, lines) {
  return {
    points,
    lines,
    arcs: [],
    dimensions: [],
    constraints: [],
  };
}

const sketch = square(
  [
    { id: 'p0', at: [-8, -6] },
    { id: 'p1', at: [8, -6] },
  ],
  [{ id: 'e0', a: 'p0', b: 'p1' }],
);

test('a unique face pair follows a move and a nearer pair is not a retarget', () => {
  const moved = edge(1, 2, [-20, 18, 10], [20, 18, 10]);
  const nearer = edge(7, 8, [-20, 0.2, 10], [20, 0.2, 10]);
  const spec = {
    ...sketch,
    refs: [{
      id: 'r0',
      kind: 'edge',
      faceA: 1,
      faceB: 2,
      mid: [0, 15, 10],
      geom: { kind: 'line', a: [-20, 15], b: [20, 15] },
    }],
  };
  const outcome = resolveContourSpec(spec, [nearer, moved], plane, { meshReady: true });
  assert.equal(outcome.broken, false);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.spec.refs[0].broken, undefined);
  assert.ok(Math.abs(outcome.spec.refs[0].geom.a[1] - 18) < 1e-6);
  assert.ok(Math.abs(outcome.spec.refs[0].mid[1] - 18) < 1e-6);
  assert.equal(matchBoundaryEdge([nearer, moved], 1, 2, [0, 0.2, 10]), moved);
});

test('two edges of one pair do not retarget past the stored midpoint', () => {
  const left = edge(1, 2, [-20, 0, 10], [-10, 0, 10]);
  const right = edge(1, 2, [10, 0, 10], [20, 0, 10]);
  const spec = {
    ...sketch,
    refs: [{
      id: 'r0',
      kind: 'edge',
      faceA: 1,
      faceB: 2,
      mid: [0, 2, 10],
      geom: { kind: 'line', a: [-1, 2], b: [1, 2] },
    }],
  };
  const outcome = resolveContourSpec(spec, [left, right], plane, { meshReady: true });
  assert.equal(outcome.broken, true);
  assert.equal(outcome.spec.refs[0].broken, true);
  assert.deepEqual(outcome.spec.refs[0].geom, spec.refs[0].geom);
  const exact = resolveContourSpec({
    ...spec,
    refs: [{ ...spec.refs[0], mid: right.mid.slice() }],
  }, [left, right], plane, { meshReady: true });
  assert.equal(exact.broken, false);
  assert.ok(Math.abs(exact.spec.refs[0].mid[0] - right.mid[0]) < 1e-6);
});

test('a missing edge keeps the cached geom', () => {
  const spec = {
    ...sketch,
    refs: [{
      id: 'r0',
      kind: 'edge',
      faceA: 4,
      faceB: 9,
      mid: [0, 15, 10],
      geom: { kind: 'line', a: [-20, 15], b: [20, 15] },
    }],
  };
  const outcome = resolveContourSpec(spec, [edge(1, 2, [-20, 15, 10], [20, 15, 10])], plane, { meshReady: true });
  assert.equal(outcome.broken, true);
  assert.deepEqual(outcome.spec.refs[0].geom, spec.refs[0].geom);
});

test('a vertex follows its edge, and a broken edge breaks the vertex', () => {
  const moved = edge(1, 2, [-20, 18, 10], [20, 18, 10]);
  const spec = {
    ...sketch,
    refs: [{
      id: 'r0',
      kind: 'vertex',
      faceA: 1,
      faceB: 2,
      mid: [0, 15, 10],
      end: 0,
      geom: { kind: 'point', at: [-20, 15] },
    }],
  };
  const outcome = resolveContourSpec(spec, [moved], plane, { meshReady: true });
  assert.equal(outcome.broken, false);
  assert.ok(Math.abs(outcome.spec.refs[0].geom.at[0] - (-20)) < 1e-6);
  assert.ok(Math.abs(outcome.spec.refs[0].geom.at[1] - 18) < 1e-6);
  const gone = resolveContourSpec(spec, [], plane, { meshReady: true });
  assert.equal(gone.broken, true);
  assert.deepEqual(gone.spec.refs[0].geom, spec.refs[0].geom);
});

test('a face with a missing boundary keeps the cached loop', () => {
  const top = [
    edge(1, 4, [-20, -15, 10], [20, -15, 10]),
    edge(2, 4, [20, -15, 10], [20, 15, 10]),
    edge(3, 4, [20, 15, 10], [-20, 15, 10]),
    edge(5, 4, [-20, 15, 10], [-20, -15, 10]),
  ];
  const full = resolveContourSpec({
    ...sketch,
    refs: [{
      id: 'r0',
      kind: 'face',
      faceId: 4,
      boundary: { faceA: 3, faceB: 4, mid: [0, 15, 10] },
      geom: { kind: 'line', a: [-20, 15], b: [20, 15] },
    }],
  }, top, plane, { meshReady: true });
  assert.equal(full.broken, false);
  assert.ok(full.spec.refs[0].loop.length >= 4);
  const cached = full.spec.refs[0];
  const trimmed = top.filter((item) => item.faceA !== 2);
  const outcome = resolveContourSpec({ ...sketch, refs: [cached] }, trimmed, plane, { meshReady: true });
  assert.equal(outcome.broken, true);
  assert.equal(outcome.spec.refs[0].broken, true);
  assert.deepEqual(outcome.spec.refs[0].loop, cached.loop);
  assert.deepEqual(outcome.spec.refs[0].geom, cached.geom);
});

test('no mesh draws the cached geom as broken and does not rewrite the statement', () => {
  const frame = plane;
  const spec = {
    ...sketch,
    dimensions: [{ id: 'd0', kind: 'distance', a: 'p0', b: 'r0', value: 9 }],
    refs: [{
      id: 'r0',
      kind: 'edge',
      faceA: 1,
      faceB: 2,
      mid: [0, 15, 10],
      geom: { kind: 'line', a: [-20, 15], b: [20, 15] },
    }],
  };
  const script = `const box = Manifold.cube([40, 30, 20], true);\nconst c1 = makeCrossSection(${emitPlaneFrameLiteral(frame)}, ${emitSolveContour(spec)}); // @contour id=c1\nreturn box;\n`;
  const pending = resolveContourScript(script, [], { meshReady: false });
  assert.equal(pending.ok, true);
  assert.equal(pending.skipped, true);
  assert.equal(pending.buffer, script);
  assert.equal(pending.displays[0].refs[0].broken, true);
  assert.deepEqual(pending.displays[0].refs[0].geom, spec.refs[0].geom);

  const live = edge(1, 2, [-20, 15, 10], [20, 15, 10]);
  const same = resolveContourScript(script, [live], { meshReady: true });
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.buffer, script);

  const moved = edge(1, 2, [-17, 15, 10], [23, 15, 10]);
  const shift = resolveContourScript(script, [moved], { meshReady: true });
  assert.equal(shift.ok, true);
  assert.equal(shift.changed, true);
  assert.match(shift.buffer, /a: \[-17, 15\]/);
  assert.match(shift.buffer, /kind: 'distance'/);
  assert.match(shift.buffer, /b: 'r0'/);

  const gone = resolveContourScript(script, [edge(8, 9, [0, 0, 10], [1, 0, 10])], { meshReady: true });
  assert.equal(gone.ok, false);
  assert.equal(gone.buffer, script);
  assert.match(gone.message, /c1 reference is broken/);
  assert.match(script, /kind: 'distance'/);
});
