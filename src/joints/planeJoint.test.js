import assert from 'node:assert/strict';
import test from 'node:test';
import { jointPlanesFromScript } from '../utils/jointPlanes.js';
import { partPlacement } from '../utils/jointSchema.js';
import { refreshAssemblyJoints } from './refreshJoints.js';
import { solveJoints } from './solveJoints.js';
import { rotateByQuat } from './rigid.js';

const A = '2026-10-10-03-00-00-0001-aaaa';
const B = '2026-10-10-03-00-00-0002-bbbb';
const J = '2026-10-10-03-00-00-0003-cccc';
const Q0 = [0, 0, 0, 1];

function part(id, t = [0, 0, 0], q = Q0) {
  return { surfId: id, placement: { t: t.slice(), q: q.slice() } };
}

function face(partId, at, n) {
  return { part: partId, kind: 'face', key: { at, n, area: 1 } };
}

function plane(partId, id, at, n) {
  return { part: partId, kind: 'plane', key: { id, at, n } };
}

function world(placement, local) {
  const turned = rotateByQuat(placement.q, local);
  return [
    placement.t[0] + turned[0],
    placement.t[1] + turned[1],
    placement.t[2] + turned[2],
  ];
}

function worldDir(placement, local) {
  return rotateByQuat(placement.q, local);
}

function gap(placementA, atA, nA, placementB, atB) {
  const pa = world(placementA, atA);
  const pb = world(placementB, atB);
  const n = worldDir(placementA, nA);
  return (pb[0] - pa[0]) * n[0] + (pb[1] - pa[1]) * n[1] + (pb[2] - pa[2]) * n[2];
}

function docWith(joints) {
  return {
    version: 1,
    source: 'local',
    name: 'Assembly',
    activeId: 'a.js',
    parts: [
      { id: 'a.js', name: 'Shaft', visible: true, order: 0, surfId: A, position: [0, 0, 0] },
      {
        id: 'b.js',
        name: 'Housing',
        visible: true,
        order: 1,
        surfId: B,
        position: [0, 0, 8],
        placement: { t: [0, 0, 8], q: [0, 0, 0, 1] },
      },
    ],
    joints,
  };
}

const DECK = 'const deck = { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };\n';

test('an origin plane and a face go coincident', () => {
  const solved = solveJoints({
    parts: [part(A), part(B, [4, -2, 8])],
    joints: [{
      id: J,
      name: 'Coincident 1',
      type: 'coincident',
      opposed: true,
      a: plane(A, 'origin:xy', [0, 0, 0], [0, 0, 1]),
      b: face(B, [0, 0, -0.5], [0, 0, -1]),
    }],
  });
  assert.equal(solved.ok, true);
  assert.equal(solved.statuses[J], 'ok');
  const measured = gap(solved.placements[A], [0, 0, 0], [0, 0, 1], solved.placements[B], [0, 0, -0.5]);
  assert.ok(Math.abs(measured) < 1e-3);
  const na = worldDir(solved.placements[A], [0, 0, 1]);
  const nb = worldDir(solved.placements[B], [0, 0, -1]);
  const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
  assert.ok(dot < -1 + 1e-6);
});

test('a workplane stays parallel or perpendicular to a face', () => {
  const parallel = solveJoints({
    parts: [part(A), part(B, [3, 1, 6])],
    joints: [{
      id: 'par',
      name: 'Angle 1',
      type: 'angle',
      value: 0,
      sense: 1,
      a: plane(A, 'workplane:deck', [0, 0, 10], [0, 0, 1]),
      b: face(B, [0, 0, 0.5], [0, 0, 1]),
    }],
  });
  assert.equal(parallel.ok, true);
  const pa = worldDir(parallel.placements[A], [0, 0, 1]);
  const pb = worldDir(parallel.placements[B], [0, 0, 1]);
  const pdot = pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2];
  assert.ok(Math.abs(pdot - 1) < 1e-3);

  const perpendicular = solveJoints({
    parts: [part(A), part(B, [3, 1, 6])],
    joints: [{
      id: 'perp',
      name: 'Angle 2',
      type: 'angle',
      value: 90,
      sense: 1,
      a: plane(A, 'origin:yz', [0, 0, 0], [1, 0, 0]),
      b: face(B, [0, 0, 0.5], [0, 0, 1]),
    }],
  });
  assert.equal(perpendicular.ok, true);
  const qa = worldDir(perpendicular.placements[A], [1, 0, 0]);
  const qb = worldDir(perpendicular.placements[B], [0, 0, 1]);
  const qdot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2];
  assert.ok(Math.abs(qdot) < 1e-3);
});

test('a plane holds a signed distance', () => {
  const solved = solveJoints({
    parts: [part(A), part(B, [1, 2, 4])],
    joints: [{
      id: J,
      name: 'Distance 1',
      type: 'distance',
      value: 12,
      sense: 1,
      a: plane(A, 'origin:xy', [0, 0, 0], [0, 0, 1]),
      b: face(B, [0, 0, 0], [0, 0, 1]),
    }],
  });
  assert.equal(solved.ok, true);
  const measured = gap(solved.placements[A], [0, 0, 0], [0, 0, 1], solved.placements[B], [0, 0, 0]);
  assert.ok(Math.abs(measured - 12) < 1e-3);
});

test('symmetric accepts a plane on one side', () => {
  const solved = solveJoints({
    parts: [part(A), part(B, [0, 0, 9])],
    joints: [
      { id: 'g', name: 'Ground 1', type: 'fixed', a: { part: A } },
      {
        id: J,
        name: 'Symmetric 1',
        type: 'symmetric',
        a: face(A, [0, 0, 2], [0, 0, 1]),
        a2: face(A, [0, 0, -2], [0, 0, -1]),
        b: plane(B, 'origin:xy', [0, 0, 0], [0, 0, 1]),
        b2: face(B, [0, 0, 4], [0, 0, 1]),
      },
    ],
  });
  assert.equal(solved.ok, true, solved.message || '');
  const midA = world(solved.placements[A], [0, 0, 0]);
  const midB = world(solved.placements[B], [0, 0, 2]);
  const n = worldDir(solved.placements[A], [0, 0, 1]);
  const planeGap = (midB[0] - midA[0]) * n[0] + (midB[1] - midA[1]) * n[1] + (midB[2] - midA[2]) * n[2];
  assert.ok(Math.abs(planeGap) < 1e-2, String(planeGap));
  assert.deepEqual(solved.placements[A].t, [0, 0, 0]);
});

test('a missing plane breaks the joint and a moved workplane is solved from its id', () => {
  const stored = plane(A, 'workplane:deck', [0, 0, 0], [0, 0, 1]);
  const joint = {
    id: J,
    name: 'Coincident 1',
    type: 'coincident',
    opposed: true,
    a: stored,
    b: face(B, [0, 0, -0.5], [0, 0, -1]),
  };
  const missing = refreshAssemblyJoints({
    doc: docWith([joint]),
    catalogs: {
      [A]: { planes: jointPlanesFromScript('') },
      [B]: {
        faces: [{ at: [0, 0, -0.5], n: [0, 0, -1], area: 1 }],
        planes: jointPlanesFromScript(''),
      },
    },
  });
  assert.equal(missing.statuses[J], 'broken');
  assert.equal(missing.messages[J], 'Plane not found on Shaft');
  assert.deepEqual(missing.doc.parts[1].placement.t, [0, 0, 8]);
  assert.deepEqual(missing.doc.joints[0].a.key.at, [0, 0, 0]);

  const live = refreshAssemblyJoints({
    doc: docWith([joint]),
    catalogs: {
      [A]: { planes: jointPlanesFromScript(DECK) },
      [B]: {
        faces: [{ at: [0, 0, -0.5], n: [0, 0, -1], area: 1 }],
        planes: jointPlanesFromScript(''),
      },
    },
  });
  assert.equal(live.ok, true);
  assert.equal(live.statuses[J], 'ok');
  assert.deepEqual(live.doc.joints[0].a.key.at, [0, 0, 0]);
  assert.equal(live.doc.joints[0].a.key.id, 'workplane:deck');
  const measured = gap(
    partPlacement(live.doc.parts[0]),
    [0, 0, 10],
    [0, 0, 1],
    partPlacement(live.doc.parts[1]),
    [0, 0, -0.5],
  );
  assert.ok(Math.abs(measured) < 1e-3, `gap ${measured}`);
});
