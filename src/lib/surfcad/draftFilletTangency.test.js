/**
 * Draft after a fillet must keep the round and the names it already had.
 *
 * `'sides'` used to take the fillet facets with the walls. Each facet was
 * tilted as its own plane, so the arc sheared, and the rebuild dropped face
 * ids, so the round came back as a few hundred `draft1.fN` faces (about 388
 * grouped edges). The wall now hinges on the fillet tangency and the source
 * face ids are copied through the rebuild.
 *
 * Ground truth: throwaway C in the 2026-11-01 repro (40×40×20, top rim r=4,
 * planar, then 1° sides, pull +z, reference max).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const BOX = `// --- cube begin id=cube1 ---
let box1 = Manifold.cube([40, 40, 20], true);
let part = box1;
// --- cube end id=cube1 ---
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cube1.back~cube1.top", "cube1.front~cube1.top", "cube1.left~cube1.top", "cube1.right~cube1.top");
part = filletEdges(part, selEdges, 4, { sphericalCorners: false });
// --- fillet-mode end id=fillet1 ---`;

const NOTE = `
const names = faceNames(part);
let namedEdges = 0;
try { edgesNamed(part, 'missing~missing'); }
catch (err) {
  const msg = String(err && err.message);
  const more = /… \\((\\d+)\\)/.exec(msg);
  if (more) namedEdges = Number(more[1]);
  else {
    const list = (msg.split('edges on this solid: ')[1] || '').split('. Re-pick')[0];
    namedEdges = list.includes('~') ? list.split('~').length - 1 : 0;
  }
}
const mesh = part.getMesh();
const np = mesh.numProp || 3;
const V = mesh.vertProperties;
const bb = part.boundingBox();
let filletOff = 0;
let filletN = 0;
let cornerOff = Infinity;
for (let i = 0; i < V.length; i += np) {
  const x = V[i], y = V[i + 1], z = V[i + 2];
  // Straight fillets only carry profile vertices on the corner rings.
  if (Math.abs(x - y) < 0.05 && x > 16.2 && x < 19.95 && z > 6.2 && z < 9.9) {
    filletOff = Math.max(filletOff, Math.abs(Math.hypot(x - 16, z - 6) - 4));
    filletN++;
  }
  if (x < -16 && y < -16 && z > 6 && z < 10) {
    const dx = x + 18.828427;
    const dy = y + 18.828427;
    const dz = z - 8.828427;
    cornerOff = Math.min(cornerOff, Math.hypot(dx, dy, dz));
  }
}
globalThis.__note = {
  names,
  namedEdges,
  filletOff,
  filletN,
  cornerOff,
  genus: part.genus(),
  bodies: part.decompose().length,
  vol: part.volume(),
  maxX: bb.max[0],
  maxY: bb.max[1],
  maxZ: bb.max[2],
  minZ: bb.min[2],
};
`;

test('fillet then draft keeps one round and hinges on the tangency', { timeout: 180_000 }, async () => {
  const ran = await runScript(`${BOX}
// --- draft begin id=draft1 ---
part = draftFaces(part, 'sides', 1, { pull: 'z', reference: 'max' });
// --- draft end id=draft1 ---
edgesNamed(part, "cube1.front~cube1.bottom", "fillet1.round~cube1.top");
${NOTE}
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0, `genus ${n.genus}`);
  assert.equal(n.bodies, 1, `bodies ${n.bodies}`);
  assert.ok(n.names.includes('fillet1.round'), `faces: ${n.names.join(', ')}`);
  for (const face of ['cube1.top', 'cube1.bottom', 'cube1.front', 'cube1.back', 'cube1.left', 'cube1.right']) {
    assert.ok(n.names.includes(face), `missing ${face} in ${n.names.join(', ')}`);
  }
  assert.equal(n.names.some((name) => name.startsWith('draft1.')), false, n.names.join(', '));
  assert.ok(n.names.length < 20, `face soup ${n.names.length}: ${n.names.slice(0, 8).join(', ')}`);
  // The repro listed about 388 grouped edges named draft1.f*~draft1.f*.
  assert.ok(n.namedEdges < 40, `named edges ${n.namedEdges}`);
  assert.ok(n.filletN >= 4, `fillet samples ${n.filletN}`);
  assert.ok(n.filletOff < 0.05, `fillet left its circle by ${n.filletOff} mm`);
  assert.ok(n.cornerOff < 0.05, `corner miter moved ${n.cornerOff} mm`);
  const tan = Math.tan((1 * Math.PI) / 180);
  // Tangency is R below the top (z = 6). The bottom flares by tan(1°) times
  // the wall height under that hinge, not the full 20 mm up to the cap.
  const want = 20 + tan * 16;
  assert.ok(Math.abs(n.maxX - want) < 0.03, `maxX ${n.maxX} want ${want}`);
  assert.ok(Math.abs(n.maxY - want) < 0.03, `maxY ${n.maxY} want ${want}`);
  assert.ok(Math.abs(n.maxZ - 10) < 0.02 && Math.abs(n.minZ + 10) < 0.02, `z ${n.minZ}..${n.maxZ}`);
  // Sheared full-height draft measured about 32036. The tangency hinge is 31834.
  assert.ok(Math.abs(n.vol - 31834.22) < 1, `vol ${n.vol}`);
});
