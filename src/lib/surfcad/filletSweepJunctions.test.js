/**
 * Spherical corners inside a sweep edge set. Where three chains of one
 * filletAlongPath call end at a right-angle vertex, the chains stop at the
 * junction planes and one mesh-built pocket holds the sphere octant, with
 * the chains' own end rings as its boundary. The whole box through the sweep
 * kernel is the planar kernel's rounded box: eight corner faces, one face per
 * sail, no needle triangles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';
import { buildSolidGeometry } from '../../utils/partSolidCache.js';
import { fingerprintsFromGeometry } from '../../utils/facePaint.js';
import { stampedFaceTable, stampedNameForTriangles } from '../../utils/faceIdentity.js';
import { countDegenerateTriangles } from '../../utils/filletEdgeClass.js';

const R = 5;
const ROUNDED = 30 * 20 * 10 + 2 * R * (600 + 200 + 300) + Math.PI * R * R * (30 + 20 + 10) + (4 / 3) * Math.PI * R ** 3;
const BOX = `// --- cube begin id=seed ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
`;

async function run(body) {
  const ran = await runScript(`${BOX}${body}return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const table = stampedFaceTable(geometry, faceIDs);
  const patches = fingerprintsFromGeometry(geometry, faceIDs);
  const perName = new Map();
  for (const p of patches) {
    const name = stampedNameForTriangles(table, p.tris)?.name || '(none)';
    perName.set(name, (perName.get(name) || 0) + 1);
  }
  return { volume: ran.volume, table, patches, perName, needles: countDegenerateTriangles(geometry), tris: ran.mesh.triVerts.length / 3 };
}

test('the whole box through one sweep set: eight spherical corners, one face per sail, no needles', { timeout: 120_000 }, async () => {
  const out = await run(`// --- fillet-mode begin id=f1 ---
part = filletAlongPath(part, makeSweepPath(convexEdges(part)), ${R});
// --- fillet-mode end ---
`);
  assert.ok(Math.abs(out.volume - ROUNDED) < 6, `volume ${out.volume} vs ${ROUNDED}`);
  const corners = out.table.faces.filter((f) => f.role === 'corner');
  assert.equal(corners.length, 8, corners.map((f) => f.name).join(' '));
  for (const c of corners) {
    assert.match(c.name, /^f1\.corner\[[0-7]\]$/);
    assert.ok(Math.abs(c.area - 39.27) < 1.5, `${c.name} area ${c.area}`);
    assert.equal(out.perName.get(c.name), 1, `${c.name} is one patch`);
  }
  assert.equal(out.perName.get('f1.round'), 12, 'one patch per sail');
  assert.equal(out.patches.length, 26);
  assert.equal(out.needles, 0, 'no needle triangles');
  assert.ok(out.tris < 8000, `triangles ${out.tris}`);
});

test('four verticals plus the top rim in one set: the four top corners are spheres, the planar kernel agrees', { timeout: 120_000 }, async () => {
  const sweep = await run(`// --- fillet-mode begin id=f1 ---
part = filletAlongPath(part, makeSweepPath(convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99 || (e.va[2] > 9.9 && e.vb[2] > 9.9))), ${R});
// --- fillet-mode end ---
`);
  const planar = await run(`// --- fillet-mode begin id=p1 ---
part = filletEdges(part, convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99 || (e.va[2] > 9.9 && e.vb[2] > 9.9)), ${R}, { sphericalCorners: true });
// --- fillet-mode end ---
`);
  assert.ok(Math.abs(sweep.volume - planar.volume) < 4, `sweep ${sweep.volume} planar ${planar.volume}`);
  assert.equal(sweep.table.faces.filter((f) => f.role === 'corner').length, 4);
  assert.equal(sweep.perName.get('f1.round'), 8, 'eight sails, one patch each');
  // The bottom ends of the verticals are plain open ends: the pocket only
  // applies where three chains meet.
  assert.equal(sweep.table.faces.filter((f) => f.role === 'corner' && f.name.startsWith('f1')).length, 4);
});

test('a chamfer set and an unequal junction keep the cusp (no pocket)', { timeout: 120_000 }, async () => {
  const chamfer = await run(`// --- chamfer-mode begin id=c1 ---
part = filletAlongPath(part, makeSweepPath(convexEdges(part)), 2, { profile: 'chamfer' });
// --- chamfer-mode end ---
`);
  assert.equal(chamfer.table.faces.filter((f) => f.role === 'corner').length, 0);
  assert.ok(chamfer.volume < 24000 && chamfer.volume > 23000, `volume ${chamfer.volume}`);
  // Three edges at a vertex where one is not a right angle: a wedge. Its
  // junctions have two 90° faces and one 60°, so no pocket is built.
  const wedge = await run(`// --- extrude begin id=w ---
part = Manifold.extrude([[0, 0], [30, 0], [15, 26]], 20).translate([-15, -10, -10]);
// --- extrude end ---
// --- fillet-mode begin id=f1 ---
part = filletAlongPath(part, makeSweepPath(convexEdges(part)), 2);
// --- fillet-mode end ---
`);
  assert.equal(wedge.table.faces.filter((f) => f.role === 'corner').length, 0);
});
