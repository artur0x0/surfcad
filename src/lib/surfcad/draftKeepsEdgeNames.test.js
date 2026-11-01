/**
 * A draft inserted upstream of a fillet must not rename the edges that
 * fillet names.
 *
 * Draft used to rebuild the mesh without face ids, so cube1.back~cube1.right
 * came back as draft1.f0~draft1.f1 and the fillet threw unknown_edge.
 * The rebuild now keeps the source face ids (#833). This locks the edge
 * the session fillet actually named.
 *
 * Ground truth: throwaway B in the 2026-11-01 repro (40×40×20, then 1°
 * sides, pull +z, reference max, volume about 32561.81), with the fillet
 * on cube1.back~cube1.right.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const SCRIPT = `// --- cube begin id=cube1 ---
let box1 = Manifold.cube([40, 40, 20], true);
let part = box1;
// --- cube end id=cube1 ---
// --- draft begin id=draft1 ---
part = draftFaces(part, 'sides', 1, { pull: 'z', reference: 'max' });
// --- draft end id=draft1 ---
const names = faceNames(part);
const backRight = edgesNamed(part, "cube1.back~cube1.right");
const volDraft = part.volume();
// --- fillet-mode begin id=fillet1 ---
part = filletEdges(part, edgesNamed(part, "cube1.back~cube1.right"), 4, { sphericalCorners: false });
// --- fillet-mode end id=fillet1 ---
globalThis.__note = {
  names,
  edgeSegs: backRight.length,
  facesAfterFillet: faceNames(part),
  genus: part.genus(),
  bodies: part.decompose().length,
  volDraft,
  vol: part.volume(),
};
return part;`;

test('a draft upstream of a fillet on cube1.back~cube1.right still resolves', { timeout: 120_000 }, async () => {
  const ran = await runScript(SCRIPT);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0, `genus ${n.genus}`);
  assert.equal(n.bodies, 1, `bodies ${n.bodies}`);
  for (const face of ['cube1.top', 'cube1.bottom', 'cube1.front', 'cube1.back', 'cube1.left', 'cube1.right']) {
    assert.ok(n.names.includes(face), `missing ${face} in ${n.names.join(', ')}`);
  }
  assert.equal(n.names.some((name) => name.startsWith('draft1.')), false, n.names.join(', '));
  assert.ok(n.edgeSegs >= 1, `cube1.back~cube1.right segments ${n.edgeSegs}`);
  assert.ok(n.facesAfterFillet.includes('fillet1.round'), n.facesAfterFillet.join(', '));
  assert.ok(n.facesAfterFillet.includes('cube1.back'), n.facesAfterFillet.join(', '));
  assert.ok(n.facesAfterFillet.includes('cube1.right'), n.facesAfterFillet.join(', '));
  // The drafted sharp cube from the repro. The vertical edge is ~20 mm and
  // still nearly 90°, so an r=4 fillet removes about (1−π/4)·16·20 mm³.
  const quarter = (1 - Math.PI / 4) * 16 * 20;
  assert.ok(Math.abs(n.volDraft - 32561.81) < 0.5, `draft vol ${n.volDraft}`);
  assert.ok(Math.abs((n.volDraft - n.vol) - quarter) < 2, `fillet removed ${n.volDraft - n.vol}, want ~${quarter}`);
});
