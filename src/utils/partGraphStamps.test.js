/**
 * Face identity in the face graph: a patch never crosses a stamped face
 * boundary. A spherical-corner fillet is tangent to every flat it meets, so
 * the curvature pass used to merge the whole box into one patch named after
 * the fillet, and list_faces had no row for `seed.top`. The joint catalog
 * runs the same rule, so a joint face key names the patch a click does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { fingerprintsFromGeometry } from './facePaint.js';
import { stampedFaceTable, stampedNameForTriangles, wallTriFace } from './faceIdentity.js';
import { catalogFromMeshData } from './jointResolve.js';

const FILLETED_BOX = `// --- cube begin id=seed ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- cube begin ---
let box1 = Manifold.cube([40, 30, 10], true);
part = part.add(box1);
// --- cube end ---
// --- fillet-mode begin id=rim ---
part = filletEdges(part, convexEdges(part), 5, { sphericalCorners: true });
// --- fillet-mode end id=rim ---
return part;
`;

test('a tangent fillet does not merge the flats it meets: every stamped face is its own patch', async () => {
  const ran = await runScript(FILLETED_BOX);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const table = stampedFaceTable(geometry, faceIDs);
  const faces = fingerprintsFromGeometry(geometry, faceIDs);
  assert.ok(faces.length > 7, `patches ${faces.length}`);

  // Named faces only: an unnamed sliver the fillet op left on a flat's plane
  // may join that flat, but two helper-named faces never share a patch.
  const walls = wallTriFace(geometry.userData.faceIdentity.pieceOfTri, geometry.userData.faceIdentity.pieces);
  for (const face of faces) {
    const named = new Set(face.tris.map((t) => walls[t]).filter((p) => p >= 0));
    assert.ok(named.size <= 1, `patch ${face.id} spans ${named.size} named faces`);
  }
  // The largest patch per stamped name: a one-triangle sliver the curvature
  // rules split off a blend carries the blend's name too.
  const byName = new Map();
  for (const face of faces) {
    const named = stampedNameForTriangles(table, face.tris);
    if (named?.name && (byName.get(named.name)?.area ?? -1) < face.area) byName.set(named.name, face);
  }
  // 40×30 top less the 5 mm fillet band on every side: 30×20.
  const top = byName.get('seed.top');
  assert.ok(top, [...byName.keys()].join(' '));
  assert.equal(top.kind, 'planar');
  assert.ok(Math.abs(top.area - 600) < 15, `seed.top area ${top.area}`);
  for (const name of ['seed.bottom', 'seed.front', 'seed.back', 'seed.left', 'seed.right']) {
    assert.ok(byName.get(name)?.kind === 'planar', `${name} is a planar patch of its own`);
  }
  const round = byName.get('rim.round');
  assert.ok(round && round.kind !== 'planar', `the fillet surface is its own blend patch: ${JSON.stringify(round)}`);
  assert.ok(round.area < 1000, `the blend patch is the fillet alone, not the box: ${round.area}`);

  // The joint catalog applies the same boundaries.
  const joint = catalogFromMeshData(ran.mesh);
  assert.equal(joint?.faces?.length, faces.length, 'viewport and joint catalogs have the same patches');
});

test('a mesh with no stamps keeps the geometric grouping', async () => {
  const ran = await runScript('return Manifold.cube([10, 10, 10], true);\n');
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const faces = fingerprintsFromGeometry(geometry, faceIDs);
  assert.equal(faces.length, 6);
});
