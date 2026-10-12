import assert from 'node:assert/strict';
import test from 'node:test';
import { projectReference } from '../contourRef.js';
import { chainSegments, materializeReference, referenceHitAt } from '../contourRefPick.js';
import { matchBoundaryEdge, resolveContourSpec } from '../contourRefResolve.js';
import { emitSolveContour, parseSolveContour } from '../contourScript.js';
import { solveContour } from '../contourSolve.js';
import { specFromSolved } from '../contourGesture.js';
import { pickNearestEdgeScreen } from '../selectEdge.js';
import { referencePickEdges, sheetContourEdges, sheetSpecInScript } from './sheetContourEdges.js';

const SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 3.81,
  k: 0.38,
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 28.2, flip: true },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 28.2, flip: false },
    { id: 'b3', panel: 'base', edge: 'u+', angle: 90, length: 28.2, flip: true },
    { id: 'b4', panel: 'b3', edge: 'u+', angle: 90, length: 28.2, flip: false },
  ],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 25, depth: 10, centered: true, offset: 37.5 }],
  holes: [{ id: 'h1', panel: 'base', u: -23.93, v: 1.91, d: 5, type: 'hole' }],
};

const PLANE = {
  center: [0, 0, 0],
  normal: [0, 1, 0],
  x: [1, 0, 0],
  y: [0, 0, -1],
};

function project(world) {
  return { x: world[0], y: -world[2] };
}

function chainOf(edge) {
  return chainSegments(edge?.segments || [])[0] || null;
}

function byKey(topo, refKey) {
  return topo.edges.find((edge) => edge.refKey === refKey) || null;
}

function dist2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function geomClose(actual, expected, tol = 0.05) {
  assert.equal(actual?.kind, expected?.kind);
  if (actual.kind === 'line') {
    const direct = dist2(actual.a, expected.a) <= tol && dist2(actual.b, expected.b) <= tol;
    const flip = dist2(actual.a, expected.b) <= tol && dist2(actual.b, expected.a) <= tol;
    assert.equal(direct || flip, true, JSON.stringify({ actual, expected }));
    return;
  }
  if (actual.kind === 'arc') {
    assert.ok(dist2(actual.center, expected.center) <= tol, JSON.stringify(actual.center));
    assert.ok(Math.abs(actual.radius - expected.radius) <= tol);
    return;
  }
  const a0 = actual.points[0];
  const a1 = actual.points[actual.points.length - 1];
  const b0 = expected.points[0];
  const b1 = expected.points[expected.points.length - 1];
  const direct = dist2(a0, b0) <= tol && dist2(a1, b1) <= tol;
  const flip = dist2(a0, b1) <= tol && dist2(a1, b0) <= tol;
  assert.equal(direct || flip, true, JSON.stringify({ a0, a1, b0, b1 }));
}

function tap(topo, world) {
  const hit = referenceHitAt(topo.edges, project, world, 12);
  assert.ok(hit, `no hit at ${world}`);
  const made = materializeReference(PLANE, hit);
  assert.ok(made?.geom, `tap did not project ${hit.refKey || hit.kind}`);
  const edge = byKey(topo, hit.refKey || made.refKey);
  assert.ok(edge, `hit has no sheet edge ${hit.refKey}`);
  const expected = projectReference(PLANE, chainOf(edge));
  assert.equal(expected.broken, false, edge.refKey);
  geomClose(made.geom, expected.geom);
  return { hit, made, edge };
}

test('sheet contour edges name every class and a tap binds that edge', () => {
  const topo = sheetContourEdges(SPEC);
  assert.equal(topo.sheet, true);
  const keys = topo.edges.map((edge) => edge.refKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.some((key) => key.startsWith('loose:') || key.includes('#dup')), false);

  const lower = byKey(topo, 'wall:base:v-:w0');
  assert.ok(lower, 'base lower edge');
  assert.ok(Math.abs(lower.length - 100) < 0.05, lower.length);
  assert.ok(Math.abs(lower.mid[2] + 30) < 0.05 && Math.abs(lower.mid[1]) < 0.05);
  const lowerTap = tap(topo, lower.mid);
  assert.equal(lowerTap.edge.refKey, 'wall:base:v-:w0');
  assert.equal(lowerTap.made.geom.kind, 'line');
  assert.ok(Math.abs(lowerTap.made.geom.a[1] - 30) < 0.05 || Math.abs(lowerTap.made.geom.b[1] - 30) < 0.05);
  assert.ok(dist2(lowerTap.made.geom.a, [-23.93, -1.91]) > 10, 'lower edge landed on the hole');

  const hole = byKey(topo, 'hole:h1:w0');
  assert.equal(hole.role, 'hole');
  const holeTap = tap(topo, [-23.93 - 2.5, 0, 1.91]);
  assert.equal(holeTap.edge.refKey, 'hole:h1:w0');
  assert.equal(holeTap.made.geom.kind, 'arc');
  assert.equal(holeTap.made.geom.full, true);
  assert.ok(Math.abs(holeTap.made.geom.radius - 2.5) < 0.05);
  assert.ok(dist2(holeTap.made.geom.center, [-23.93, -1.91]) < 0.05);

  for (const id of ['b1', 'b2', 'b3', 'b4']) {
    for (const skin of [0, 1]) {
      assert.ok(keys.some((key) => key.startsWith(`bend:${id}:`) && key.endsWith(`:w${skin}`)), id);
    }
  }
  const bend = byKey(topo, 'bend:b1:base:w0');
  const bendTap = tap(topo, bend.mid);
  assert.equal(bendTap.edge.refKey, 'bend:b1:base:w0');
  assert.equal(bendTap.made.geom.kind, 'line');

  const side = byKey(topo, 'wall:b2:v-:w0');
  assert.equal(side.role, 'side');
  const sideTap = tap(topo, side.mid);
  assert.equal(sideTap.edge.refKey, 'wall:b2:v-:w0');

  const lip = byKey(topo, 'wall:b2:u+:w0');
  assert.equal(lip.role, 'outer');
  assert.ok(Math.abs(lip.mid[0] + 89) < 0.2 && Math.abs(lip.mid[1] - 39) < 0.2);
  const lipTap = tap(topo, [-89, 39, 0]);
  assert.equal(lipTap.edge.refKey, 'wall:b2:u+:w0');
  assert.notEqual(lipTap.edge.refKey, 'wall:b4:u+:w0');

  const end = byKey(topo, 'bend:b1:end:q1:in');
  const endTap = tap(topo, end.mid);
  assert.equal(endTap.edge.refKey, 'bend:b1:end:q1:in');
  const endChain = chainOf(end);
  const endA = projectReference(PLANE, [endChain[0]]).geom.at;
  const endB = projectReference(PLANE, [endChain[endChain.length - 1]]).geom.at;
  geomClose(endTap.made.geom, { kind: 'line', a: endA, b: endB });
  const endSpan = dist2(endTap.made.geom.a, endTap.made.geom.b);
  assert.ok(endSpan > 2 && endSpan < 8, `bend end projected span ${endSpan}`);

  const picks = referencePickEdges(topo);
  assert.ok(picks.some((edge) => edge.key === 'wall:base:v-:w0'));
  assert.equal(referencePickEdges({ edges: topo.edges }), null);
});

test('collinear skins, a nearby hole, symmetric flanges, and a tiny bend stay distinct', () => {
  const topo = sheetContourEdges(SPEC);
  const front = tap(topo, [0, 0, -30]);
  const back = tap(topo, [0, -3.175, -30]);
  assert.equal(front.edge.refKey, 'wall:base:v-:w0');
  assert.equal(back.edge.refKey, 'wall:base:v-:w1');
  assert.ok(Math.abs(front.made.geom.a[1] - back.made.geom.a[1]) < 0.05
    || Math.abs(front.made.geom.a[1] - back.made.geom.b[1]) < 0.05);

  const otherLip = tap(topo, [89, 39, 0]);
  assert.equal(otherLip.edge.refKey, 'wall:b4:u+:w0');

  const near = sheetContourEdges({
    ...SPEC,
    holes: [{ id: 'h1', panel: 'base', u: 0, v: -27, d: 4, type: 'hole' }],
  });
  const edgeTap = tap(near, [0, 0, -30]);
  assert.equal(edgeTap.edge.refKey, 'wall:base:v-:w0');
  assert.equal(edgeTap.made.geom.kind, 'line');
  const circleTap = tap(near, [0, 0, -25]);
  assert.equal(circleTap.edge.refKey, 'hole:h1:w0');
  assert.equal(circleTap.made.geom.kind, 'arc');

  const tiny = sheetContourEdges({
    ...SPEC,
    bends: [{ id: 'b1', panel: 'base', edge: 'u-', angle: 1, length: 15, flip: true }],
    tabs: [],
    holes: [],
  });
  assert.ok(byKey(tiny, 'bend:b1:base:w0'));
  assert.equal(tiny.edges.some((edge) => edge.refKey.includes('#dup') || edge.refKey.startsWith('loose:')), false);
  const tinyTap = tap(tiny, byKey(tiny, 'bend:b1:base:w0').mid);
  assert.equal(tinyTap.edge.refKey, 'bend:b1:base:w0');
});

test('a corner notch is its own cutout edge', () => {
  const topo = sheetContourEdges({
    ...SPEC,
    bends: [
      { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 20, flip: true },
      { id: 'b2', panel: 'base', edge: 'v+', angle: 90, length: 20, flip: true },
    ],
    tabs: [],
    holes: [],
  });
  const cutout = topo.edges.find((edge) => edge.role === 'cutout' && edge.refKey.endsWith(':w0'));
  assert.ok(cutout, topo.edges.filter((edge) => edge.role === 'cutout').map((edge) => edge.refKey).join(' '));
  const hit = tap(topo, cutout.mid);
  assert.equal(hit.edge.refKey, cutout.refKey);
  assert.equal(hit.edge.role, 'cutout');
});

test('a flange edit and a hole edit move only their own refKey', () => {
  const before = sheetContourEdges(SPEC);
  const lip = byKey(before, 'wall:b2:u+:w0');
  const lower = byKey(before, 'wall:base:v-:w0');
  const hole = byKey(before, 'hole:h1:w0');
  const lipRef = materializeReference(PLANE, {
    kind: 'edge',
    refKey: lip.refKey,
    faceA: lip.faceA,
    faceB: lip.faceB,
    mid: lip.mid.slice(),
    worldPoints: chainOf(lip),
  });
  const lowerRef = materializeReference(PLANE, {
    kind: 'edge',
    refKey: lower.refKey,
    faceA: lower.faceA,
    faceB: lower.faceB,
    mid: lower.mid.slice(),
    worldPoints: chainOf(lower),
  });
  const holeRef = materializeReference(PLANE, {
    kind: 'edge',
    refKey: hole.refKey,
    faceA: hole.faceA,
    faceB: hole.faceB,
    mid: hole.mid.slice(),
    worldPoints: chainOf(hole),
  });
  const longer = sheetContourEdges({
    ...SPEC,
    bends: SPEC.bends.map((bend) => (bend.id === 'b2' ? { ...bend, length: 40 } : bend)),
  });
  const spec = {
    points: [{ id: 'p0', at: [0, 0] }],
    lines: [],
    arcs: [],
    dimensions: [],
    constraints: [],
    refs: [
      { id: 'r0', kind: 'edge', ...lipRef },
      { id: 'r1', kind: 'edge', ...lowerRef },
      { id: 'r2', kind: 'edge', ...holeRef },
    ],
  };
  const moved = resolveContourSpec(spec, longer.edges, PLANE, { meshReady: true });
  assert.equal(moved.broken, false, moved.spec.refs.map((ref) => ref.refKey).join(' '));
  assert.equal(moved.spec.refs[0].refKey, 'wall:b2:u+:w0');
  assert.equal(moved.spec.refs[0].geom.kind, 'line');
  assert.ok(lipRef.geom.a[0] - moved.spec.refs[0].geom.a[0] > 8, JSON.stringify(moved.spec.refs[0].geom));
  assert.ok(Math.abs(moved.spec.refs[1].geom.a[0] - lowerRef.geom.a[0]) < 0.05);
  assert.ok(dist2(moved.spec.refs[2].geom.center, holeRef.geom.center) < 0.05);

  const shiftedHole = sheetContourEdges({
    ...SPEC,
    holes: [{ ...SPEC.holes[0], u: 10 }],
  });
  const holeOnly = resolveContourSpec(
    { ...spec, refs: [spec.refs[1], spec.refs[2]] },
    shiftedHole.edges,
    PLANE,
    { meshReady: true },
  );
  assert.equal(holeOnly.broken, false);
  assert.ok(Math.abs(holeOnly.spec.refs[0].geom.a[0] - lowerRef.geom.a[0]) < 0.05);
  assert.ok(dist2(holeOnly.spec.refs[1].geom.center, holeRef.geom.center) > 5);

  const missing = longer.edges.filter((edge) => edge.refKey !== 'wall:base:v-:w0');
  const lost = resolveContourSpec(
    { ...spec, refs: [spec.refs[1]] },
    missing,
    PLANE,
    { meshReady: true },
  );
  assert.equal(lost.broken, true);
  assert.equal(lost.spec.refs[0].geom.kind, 'line');
  assert.equal(matchBoundaryEdge(longer.edges, 1, 2, hole.mid), null);
  assert.equal(matchBoundaryEdge(longer.edges, hole.faceA, hole.faceB, lower.mid, 'wall:base:v-:w0').refKey, 'wall:base:v-:w0');

  const text = emitSolveContour(moved.spec);
  const parsed = parseSolveContour(text);
  assert.equal(parsed.refs[0].refKey, 'wall:b2:u+:w0');
  assert.equal(parsed.refs[1].refKey, 'wall:base:v-:w0');

  // Confirm writes solveContour(spec). The copy used to drop refKey, so the
  // saved lip was the right line with no name.
  const solved = specFromSolved(solveContour(spec));
  assert.equal(solved.refs[0].refKey, 'wall:b2:u+:w0');
  assert.equal(solved.refs[1].refKey, 'wall:base:v-:w0');
  assert.equal(solved.refs[2].refKey, 'hole:h1:w0');
  const saved = parseSolveContour(emitSolveContour(solved));
  assert.equal(saved.refs[0].refKey, 'wall:b2:u+:w0');
  assert.equal(saved.refs[2].refKey, 'hole:h1:w0');
});

test('collinear front and back skins break a screen tie toward the face under the finger', () => {
  const scratch = () => ({
    x: 0,
    y: 0,
    z: 0,
    project() {
      const x = this.x;
      const z = this.z;
      this.x = x / 80;
      this.y = -z / 80;
      this.z = 0;
    },
  });
  const front = { key: 'wall:base:v-:w0', va: [-40, 0, -30], vb: [40, 0, -30], mid: [0, 0, -30] };
  const back = { key: 'wall:base:v-:w1', va: [-40, -3.2, -30], vb: [40, -3.2, -30], mid: [0, -3.2, -30] };
  const opts = {
    projectScratchA: scratch(),
    projectScratchB: scratch(),
    cameraPosition: [0, 40, -30],
  };
  const tie = {
    collinearTiePx: 0.75,
    collinearPoint: [0, 0.2, -30],
  };
  const backWins = pickNearestEdgeScreen([back, front], {}, 200, 200, 100, 62.5, 12, opts);
  assert.equal(backWins.key, 'wall:base:v-:w1');
  const frontWins = pickNearestEdgeScreen([back, front], {}, 200, 200, 100, 62.5, 12, {
    ...opts,
    ...tie,
    projectScratchA: scratch(),
    projectScratchB: scratch(),
  });
  assert.equal(frontWins.key, 'wall:base:v-:w0');
  // A clearly closer pixel still wins. The back skin is shifted in Z so its
  // screen line is 2.5 px off the front skin.
  const offsetBack = { key: 'wall:base:v-:w1', va: [-40, -3.2, -32], vb: [40, -3.2, -32], mid: [0, -3.2, -32] };
  const closerPixel = pickNearestEdgeScreen([offsetBack, front], {}, 200, 200, 100, 60, 12, {
    ...opts,
    ...tie,
    projectScratchA: scratch(),
    projectScratchB: scratch(),
  });
  assert.equal(closerPixel.key, 'wall:base:v-:w1');
});

test('a script yields a sheet spec, and a cube script does not', () => {
  assert.equal(sheetContourEdges(null), null);
  assert.equal(sheetContourEdges({ t: 0, width: 10, height: 10 }), null);
  const bare = `const sheetSpec = ${JSON.stringify(SPEC)};\nlet part = sheetMetalSolid(sheetSpec);\n`;
  assert.equal(sheetSpecInScript(bare).width, 100);
  const marked = `// --- sheet-metal begin ---\nconst sheetSpec = ${JSON.stringify({ ...SPEC, width: 80 })};\n// --- sheet-metal end ---\n`;
  assert.equal(sheetSpecInScript(marked).width, 80);
  assert.equal(sheetSpecInScript('let part = Manifold.cube([40, 30, 20], true);\n'), null);
  const folded = sheetContourEdges({
    ...SPEC,
    bends: [{ id: 'b9', panel: 'missing', edge: 'u+', angle: 90, length: 10 }],
    tabs: [],
    holes: [],
  });
  assert.equal(folded.sheet, true);
  assert.equal(folded.edges.length, 0);
});
