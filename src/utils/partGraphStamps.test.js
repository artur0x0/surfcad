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
import { countDegenerateTriangles } from './filletEdgeClass.js';

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

  // Two helper-named faces share a patch only across a true coplanar seam:
  // the rolling-ball cutter's legs lie on the flats, so a flat's patch may
  // carry a few thin strips stamped with the blend's name. A curved patch
  // never spans two names.
  const walls = wallTriFace(geometry.userData.faceIdentity.pieceOfTri, geometry.userData.faceIdentity.pieces);
  for (const face of faces) {
    const named = new Set(face.tris.map((t) => walls[t]).filter((p) => p >= 0));
    if (face.kind !== 'planar') assert.ok(named.size <= 1, `patch ${face.id} spans ${named.size} named faces`);
  }
  // Every triangle has a name: the cap booleans split each sail cylinder
  // into several runs, and the stamp covers all of them.
  const pieceOfTri = geometry.userData.faceIdentity.pieceOfTri;
  let unstamped = 0;
  for (let t = 0; t < pieceOfTri.length; t++) if (pieceOfTri[t] < 0) unstamped++;
  assert.equal(unstamped, 0, 'unstamped triangles');
  for (const face of faces) assert.ok(stampedNameForTriangles(table, face.tris)?.name, `patch ${face.id} has no name`);
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
  // The eight corner balls are their own named faces, one eighth of a
  // sphere each (4π·25/8 = 39.3 mm²), and the top names its own patch by
  // area even though the strips in its plane outnumber its two triangles.
  const corners = table.faces.filter((f) => f.role === 'corner');
  assert.equal(corners.length, 8, corners.map((f) => f.name).join(' '));
  for (const corner of corners) {
    assert.match(corner.name, /^rim\.corner\[[0-7]\]$/);
    assert.ok(Math.abs(corner.area - 39.27) < 1.5, `${corner.name} area ${corner.area}`);
    const patch = byName.get(corner.name);
    assert.ok(patch && patch.kind !== 'planar', `${corner.name} is a catalog row of its own`);
    assert.ok(Math.abs(patch.area - corner.area) < 2, `${corner.name} patch area ${patch.area}`);
  }
  assert.equal(stampedNameForTriangles(table, top.tris).name, 'seed.top');
  assert.ok(top.tris.length > 2, 'the top patch carries the strips the cutter left in its plane');
  assert.equal(table.byName.get('seed.top').tris.length, 2);

  // The joint catalog applies the same boundaries.
  const joint = catalogFromMeshData(ran.mesh);
  assert.equal(joint?.faces?.length, faces.length, 'viewport and joint catalogs have the same patches');

  // The corner is built as a mesh that shares its ring vertices with the
  // sails, so nothing is cut between tangent surfaces: every sail is one
  // patch per edge (16 edges on this two-box part: twelve of the seed and
  // the four the second box adds that are not merged), each corner is one
  // patch, and there is no needle anywhere. The v1 ball cut left 1390
  // needles and 226 `rim.round` patches on a plain 40×30×20 box.
  const patchesByName = new Map();
  for (const face of faces) {
    const name = stampedNameForTriangles(table, face.tris)?.name;
    patchesByName.set(name, (patchesByName.get(name) || 0) + 1);
  }
  for (const corner of corners) assert.equal(patchesByName.get(corner.name), 1, `${corner.name} is one patch`);
  const sails = table.byName.get('rim.round');
  assert.ok(sails, 'the sail face exists');
  assert.ok(patchesByName.get('rim.round') <= 20, `rim.round splits into ${patchesByName.get('rim.round')} patches`);
  assert.equal(countDegenerateTriangles(geometry), 0, 'no needle triangles');
});

test('a mesh with no stamps keeps the geometric grouping', async () => {
  const ran = await runScript('return Manifold.cube([10, 10, 10], true);\n');
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const faces = fingerprintsFromGeometry(geometry, faceIDs);
  assert.equal(faces.length, 6);
});
