import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Module from '../../built/manifold.js';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry, featureGraphFor } from './partSolidCache.js';
import { warmFaceGraph } from './selectFace.js';

/**
 * Digests of the face graph and the edge graph from before the typed-array
 * rewrite. A change in patch ids, edge ids, grouping, or the floats those
 * ids are built from fails the hash.
 */
const EXPECTED = {
  cube: 'dafaae3785c041068687d04bd6f3978015f2b55d09e95f3ddbd43406232fdaa1',
  cyl: '1ae256a2dd33e89dfc4b811397f0be14bc7974690663147da0a2bf04b155e58a',
  sphere32: '8f075b90032cfc438a2c2a0682fe1cb52c1acb4928bfdcc8eb71f816d4c10b28',
  // Re-pinned 2026-10-27: the face graph no longer joins a fillet's facets to
  // the named flats it is tangent to (stamped-face wall in the curved pass),
  // and again the same day: the corner balls are their own stamped faces
  // (`.corner[k]`), so the ball/sail junctions are walls too.
  fillet: 'cf08805ebfb8c0c08fe13dbc8066e9f66f1bdf7cce3d27b0afe450abbb00b253',
  two: '1153cc70086e9c52eb9da22710ce67d2a56a3f59fee5bcbb26f7b60d9f25beb1',
  sphere450: '412d496a2c5f01fe0624f6f29d9a230070046401f22fa0ed1dff17635b212ae3',
};

function digest(mesh) {
  const { geometry, faceIDs } = buildSolidGeometry(mesh);
  const face = warmFaceGraph(geometry, faceIDs);
  const edge = featureGraphFor(geometry, faceIDs);
  const payload = {
    triPatch: Array.from(face.triPatch),
    patches: face.patches.map((p) => ({
      id: p.id,
      kind: p.kind,
      tris: p.tris,
      faceIds: p.faceIds,
      normal: p.normal,
      center: p.center,
      area: p.area,
      atomCount: p.atomCount,
      curvature: p.curvature,
    })),
    atomCount: face.atomCount,
    version: face.version,
    feat: (edge.featureEdges || []).map((e) => ({
      key: e.key,
      a: e.a,
      b: e.b,
      length: e.length,
      mid: e.mid,
      tangent: e.tangent,
      n0: e.n0,
      n1: e.n1,
      tri0: e.tri0,
      tri1: e.tri1,
      bodyId: e.bodyId,
      boundaryId: e.boundaryId,
      faceA: e.faceA,
      faceB: e.faceB,
      pairCount: e.pairCount,
      chainId: e.chainId,
    })),
    topo: (edge.topo?.edges || []).map((e) => ({
      id: e.id,
      faceA: e.faceA,
      faceB: e.faceB,
      length: e.length,
      dihedralDeg: e.dihedralDeg,
      minFaceArea: e.minFaceArea,
      mid: e.mid,
      n0: e.n0,
      n1: e.n1,
      pairCount: e.pairCount,
      segments: (e.segments || []).map((s) => ({
        key: s.key, a: s.a, b: s.b, length: s.length, mid: s.mid, va: s.va, vb: s.vb,
      })),
    })),
    faces: (edge.topo?.faces || []).map((f) => ({
      id: f.id, area: f.area, center: f.center, normal: f.normal,
    })),
    triCount: face.triPatch.length,
    patchCount: face.patches.length,
  };
  geometry.dispose?.();
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function meshFromSolid(solid) {
  const mesh = solid.getMesh();
  return {
    numProp: mesh.numProp,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    faceID: mesh.faceID ? new Uint32Array(mesh.faceID) : null,
    runIndex: mesh.runIndex ? new Uint32Array(mesh.runIndex) : null,
    runOriginalID: mesh.runOriginalID ? new Uint32Array(mesh.runOriginalID) : null,
    numRun: mesh.numRun,
  };
}

test('face and edge graphs match the previous output', { timeout: 180_000 }, async () => {
  const wasm = await Module();
  wasm.setup();
  const { Manifold } = wasm;
  const solids = [
    ['cube', Manifold.cube([10, 20, 30], true)],
    ['cyl', Manifold.cylinder(30, 5, 5, 64, false)],
    ['sphere32', Manifold.sphere(20, 32)],
    ['sphere450', Manifold.sphere(50, 450)],
  ];
  for (const [name, solid] of solids) {
    const hash = digest(meshFromSolid(solid));
    solid.delete?.();
    assert.equal(hash, EXPECTED[name], name);
  }
  const fillet = await runScript(`let part = Manifold.cube([40, 30, 20], true);
part = filletEdges(part, convexEdges(part), 3, { sphericalCorners: true });
return part;`, { manifold: wasm });
  assert.equal(digest(fillet.mesh), EXPECTED.fillet, 'fillet');
  fillet.manifold?.delete?.();
  const two = await runScript(`const a = Manifold.cube([10, 10, 10], true);
const b = Manifold.cube([10, 10, 10], true).translate([30, 0, 0]);
return Manifold.compose([a, b]);`, { manifold: wasm });
  assert.equal(digest(two.mesh), EXPECTED.two, 'two');
  two.manifold?.delete?.();
});
