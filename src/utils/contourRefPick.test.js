import assert from 'node:assert/strict';
import test from 'node:test';
import { emitSolveContour } from './contourScript.js';
import { saveContourConstraint, saveContourDimension } from './contourMode.js';
import { suggestContourConstraint, suggestContourDimension, toggleContourPick } from './contourGesture.js';
import { CONTOUR_PICK_COLOR } from './contourStatus.js';
import { dimensionEndpoints } from './contourDimensionDraw.js';
import {
  CONTOUR_REF_BROKEN_COLOR,
  CONTOUR_REF_COLOR,
  edgeHit,
  faceOutlineHit,
  materializeReference,
  pickReferenceScreen,
  referenceEdgesForPart,
  referencePaintSegments,
  referencePickAllowed,
  vertexHit,
} from './contourRefPick.js';

const PLANE = {
  center: [0, 0, 0],
  normal: [0, 0, 1],
  x: [1, 0, 0],
  y: [0, 1, 0],
};

function edge(faceA, faceB, ax, ay, bx, by) {
  return {
    id: `${faceA}-${faceB}`,
    faceA,
    faceB,
    mid: [(ax + bx) / 2, (ay + by) / 2, 0],
    segments: [{
      key: `${ax}-${bx}`,
      a: 1,
      b: 2,
      va: [ax, ay, 0],
      vb: [bx, by, 0],
    }],
  };
}

function project(world) {
  return { x: world[0], y: world[1] };
}

const square = {
  points: [
    { id: 'p0', at: [-8, -6] },
    { id: 'p1', at: [8, -6] },
    { id: 'p2', at: [8, 6] },
    { id: 'p3', at: [-8, 6] },
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

test('vertices win inside 12 px, then edges', () => {
  const edges = [edge(1, 2, 0, 0, 10, 0)];
  assert.equal(referencePickAllowed('dimension'), true);
  assert.equal(referencePickAllowed('constraints'), true);
  assert.equal(referencePickAllowed('arc'), false);
  assert.equal(referencePickAllowed(null), false);

  const nearVertex = pickReferenceScreen(edges, project, 0, 8, 12);
  assert.equal(nearVertex.kind, 'vertex');
  assert.equal(nearVertex.end, 0);

  const onEdge = pickReferenceScreen(edges, project, 5, 11, 12);
  assert.equal(onEdge.kind, 'edge');
  assert.equal(vertexHit(edges, project, 5, 11, 12), null);
  assert.equal(edgeHit(edges, project, 5, 11, 12).kind, 'edge');

  assert.equal(pickReferenceScreen(edges, project, 5, 20, 12), null);
});

test('a face outline binds the edge under the cursor', () => {
  const bottom = edge(4, 1, 0, 0, 10, 0);
  const right = {
    ...edge(4, 2, 10, 0, 10, 8),
    segments: [{ key: 'r', a: 2, b: 3, va: [10, 0, 0], vb: [10, 8, 0] }],
  };
  const top = {
    ...edge(4, 3, 10, 8, 0, 8),
    segments: [{ key: 't', a: 3, b: 4, va: [10, 8, 0], vb: [0, 8, 0] }],
  };
  const left = {
    ...edge(4, 5, 0, 8, 0, 0),
    segments: [{ key: 'l', a: 4, b: 1, va: [0, 8, 0], vb: [0, 0, 0] }],
  };
  const hit = faceOutlineHit([bottom, right, top, left], 4, project, 5, 1);
  assert.equal(hit.kind, 'face');
  assert.equal(hit.faceId, 4);
  assert.equal(hit.faceA, bottom.faceA);
  assert.ok(hit.loopWorld.length >= 4);
  const made = materializeReference(PLANE, hit);
  assert.equal(made.kind, 'face');
  assert.equal(made.geom.kind, 'line');
  assert.equal(made.boundary.faceA, 4);
  assert.ok(made.loop.length >= 4);
});

test('an edge-on edge is not a reference, and another part is ignored', () => {
  const normal = materializeReference(PLANE, {
    kind: 'edge',
    faceA: 1,
    faceB: 2,
    mid: [0, 0, 5],
    worldPoints: [[0, 0, 0], [0, 0, 10]],
  });
  assert.equal(normal, null);
  const flat = materializeReference(PLANE, {
    kind: 'edge',
    faceA: 1,
    faceB: 2,
    mid: [5, 0, 0],
    worldPoints: [[0, 0, 0], [10, 0, 0]],
  });
  assert.equal(flat.geom.kind, 'line');
  const kept = referenceEdgesForPart([
    { key: 'a', partId: 'p1' },
    { key: 'b', partId: 'p2' },
    { key: 'c' },
  ], 'p1');
  assert.deepEqual(kept.map((edge) => edge.key), ['a', 'c']);
});

test('a pick writes the reference, and distance and parallel name it', () => {
  const armed = {
    gesture: 'dimension',
    params: { contour: square },
    picks: [],
  };
  const ref = materializeReference(PLANE, {
    kind: 'edge',
    faceA: 1,
    faceB: 2,
    mid: [0, -15, 0],
    worldPoints: [[-20, -15, 0], [20, -15, 0]],
  });
  ref.tap = [-8, -6];
  const picked = toggleContourPick(armed, { kind: 'reference', ref });
  assert.equal(picked.picks.length, 1);
  assert.equal(picked.picks[0].kind, 'ref');
  assert.equal(picked.params.contour.refs.length, 1);
  const point = toggleContourPick(picked, { kind: 'point', id: 'p0', label: 'p0' });
  const offer = suggestContourDimension(point.params.contour, point.picks);
  assert.equal(offer.kind, 'distance');
  assert.ok(Math.abs(Math.abs(offer.value) - 9) < 1e-6, String(offer.value));
  const saved = saveContourDimension(point, { kind: 'distance', valueMm: offer.value, side: 1, sense: 1 });
  assert.equal(saved.error, null);
  const text = emitSolveContour(saved.state.params.contour);
  assert.match(text, /kind: 'distance'/);
  assert.match(text, /refs:/);
  assert.match(text, /r0/);
  const ends = dimensionEndpoints(saved.state.params.contour, saved.state.params.contour.dimensions[0]);
  assert.ok(ends && Math.abs(ends.b[1] + 15) < 1e-6, JSON.stringify(ends));

  const again = toggleContourPick({
    ...saved.state,
    gesture: 'constraints',
    picks: [{ kind: 'line', id: 'e0', label: 'e0' }],
  }, { kind: 'reference', ref });
  const constraint = suggestContourConstraint(again.params.contour, again.picks);
  assert.equal(constraint.kind, 'parallel');
  assert.ok(!constraint.kinds.includes('equal'), constraint.kinds.join(','));
  const locked = saveContourConstraint(again, { kind: 'parallel', side: 1 });
  assert.equal(locked.error, null);
  const written = emitSolveContour(locked.state.params.contour);
  assert.match(written, /kind: 'parallel'/);
  assert.match(written, /'e0'/);
  assert.match(written, /'r0'/);

  const both = suggestContourConstraint(again.params.contour, [
    { kind: 'ref', id: 'r0', geomKind: 'line' },
    { kind: 'ref', id: 'r1', geomKind: 'line' },
  ]);
  assert.match(both.note, /two references/);
});

test('a picked reference is dashed in the picked colour, and the face loop stays muted', () => {
  const segs = referencePaintSegments({
    refs: [
      {
        id: 'r0',
        kind: 'edge',
        geom: { kind: 'line', a: [0, 0], b: [4, 0] },
      },
      {
        id: 'r1',
        kind: 'face',
        loop: [[0, 0], [4, 0], [4, 3], [0, 0]],
        geom: { kind: 'line', a: [0, 0], b: [4, 0] },
      },
    ],
  }, [{ kind: 'ref', id: 'r0' }, { kind: 'ref', id: 'r1' }]);
  const edgeSeg = segs.find((seg) => seg.id === 'r0');
  assert.equal(edgeSeg.picked, true);
  assert.equal(edgeSeg.color, CONTOUR_PICK_COLOR);
  const loop = segs.find((seg) => seg.id === 'r1' && !seg.picked);
  const bound = segs.find((seg) => seg.id === 'r1' && seg.picked);
  assert.equal(loop.color, CONTOUR_REF_COLOR);
  assert.ok(loop.uvs.length >= 4);
  assert.equal(bound.color, CONTOUR_PICK_COLOR);
  const broken = referencePaintSegments({
    refs: [{
      id: 'r2',
      kind: 'edge',
      broken: true,
      geom: { kind: 'line', a: [0, 0], b: [4, 0] },
    }],
  }, [{ kind: 'ref', id: 'r2' }]);
  assert.equal(broken[0].color, CONTOUR_REF_BROKEN_COLOR);
  assert.equal(broken[0].broken, true);
  assert.equal(broken[0].picked, false);
});

test('a polyline reference refuses parallel', () => {
  const model = {
    ...square,
    refs: [{
      id: 'r0',
      kind: 'edge',
      geom: { kind: 'polyline', points: [[0, 0], [4, 0], [4, 4]] },
    }],
  };
  const offer = suggestContourConstraint(model, [
    { kind: 'line', id: 'e0' },
    { kind: 'ref', id: 'r0', geomKind: 'polyline' },
  ]);
  assert.equal(offer.ok, false);
  assert.match(offer.note, /line reference/);
});
