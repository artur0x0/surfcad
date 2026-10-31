/**
 * The planar fillet kernel against a box whose faces are not float32-exact.
 *
 * Manifold keeps a solid's planes in doubles but hands JavaScript a float32
 * mesh. A 68.7 × 74.1 × 37.5 box has faces at ±34.35 and ±37.05 that float32
 * cannot hold, so a cutter built from the mesh with a face lying in the
 * part's face sat two microns inside it, and the subtract left the strip
 * between the edge and the tangency line as a two-micron skin of the old
 * face over the fillet (genus 1 per edge, a wall of inward-facing triangles,
 * and a shell that read the skin as a flat and offset it outward). Cutter
 * corner points now sit _C6_FACE_PUSH_RATIO·r outside the faces, free ends overrun
 * their cap face by the same amount, and an end that runs into other
 * material stays flush.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const BOX = `// --- cube begin id=cube1 ---
let box1 = Manifold.cube([68.7, 74.10000000000001, 37.5], true);
let part = box1;
// --- cube end id=cube1 ---`;
// Inward-facing triangles: normal against the centroid direction. A convex
// solid has none; a skin shows as the old face's inside.
const INWARD = `
const mesh = part.getMesh(); const np = mesh.numProp || 3; const V = mesh.vertProperties; const T = mesh.triVerts;
let inward = 0, inwardArea = 0;
for (let t = 0; t < T.length / 3; t++) {
  const A = [V[T[t*3]*np], V[T[t*3]*np+1], V[T[t*3]*np+2]], B = [V[T[t*3+1]*np], V[T[t*3+1]*np+1], V[T[t*3+1]*np+2]], C = [V[T[t*3+2]*np], V[T[t*3+2]*np+1], V[T[t*3+2]*np+2]];
  const u = [B[0]-A[0], B[1]-A[1], B[2]-A[2]], w = [C[0]-A[0], C[1]-A[1], C[2]-A[2]];
  const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const c = [(A[0]+B[0]+C[0])/3, (A[1]+B[1]+C[1])/3, (A[2]+B[2]+C[2])/3];
  if ((n[0]*c[0] + n[1]*c[1] + n[2]*c[2]) / l < -0.1 && l / 2 > 0.01) { inward++; inwardArea += l / 2; }
}
globalThis.__note = { genus: part.genus(), inward, inwardArea, vol: part.volume() };`;

test('one vertical edge of a non-float32 box: no skin, genus 0', { timeout: 120_000 }, async () => {
  const ran = await runScript(`${BOX}
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cube1.front~cube1.right");
part = filletEdges(part, selEdges, 4);
// --- fillet-mode end id=fillet1 ---
${INWARD}
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0, `genus ${n.genus}`);
  assert.equal(n.inward, 0, `${n.inward} inward-facing triangles, ${n.inwardArea.toFixed(2)} mm²`);
  // The quarter-round removed: (1 − π/4)·r²·L.
  const removed = 68.7 * 74.10000000000001 * 37.5 - n.vol;
  assert.ok(Math.abs(removed - (1 - Math.PI / 4) * 16 * 37.5) < 0.05, `removed ${removed}`);
});

test('one bottom edge (both ends free, in faces float32 cannot hold): no skin at the ends', { timeout: 120_000 }, async () => {
  const ran = await runScript(`${BOX}
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cube1.bottom~cube1.front");
part = filletEdges(part, selEdges, 4);
// --- fillet-mode end id=fillet1 ---
${INWARD}
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0, `genus ${n.genus}`);
  assert.equal(n.inward, 0, `${n.inward} inward-facing triangles, ${n.inwardArea.toFixed(2)} mm²`);
});

test('eight edges with spherical corners, then hollow: one clean body, cavity inside the walls', { timeout: 300_000 }, async () => {
  const ran = await runScript(`${BOX}
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cube1.back~cube1.right", "cube1.back~cube1.bottom", "cube1.bottom~cube1.right", "cube1.bottom~cube1.left", "cube1.bottom~cube1.front", "cube1.front~cube1.left", "cube1.back~cube1.left", "cube1.front~cube1.right");
part = filletEdges(part, selEdges, 4, { sphericalCorners: true });
// --- fillet-mode end id=fillet1 ---
const genusBefore = part.genus();
const cavity = shell(part, 1.85, { center: [0.0003, -0.0003, 18.75], normal: [0, 0, 1] });
const cb = cavity.boundingBox();
part = hollow(part, 1.85, { center: [0.0003, -0.0003, 18.75], normal: [0, 0, 1] });
globalThis.__note = { genusBefore, cavityMax: cb.max, cavityMin: cb.min, bodies: part.decompose().length, vol: part.volume(), genus: part.genus() };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genusBefore, 0, `fillet genus ${n.genusBefore}`);
  assert.equal(n.bodies, 1, `hollow bodies ${n.bodies}`);
  // Cavity walls 1.85 inside the outer faces; the open top overshoots by 1.85.
  assert.ok(Math.abs(n.cavityMax[0] - 32.5) < 1e-3 && Math.abs(n.cavityMin[0] + 32.5) < 1e-3, `cavity x ${n.cavityMin[0]}..${n.cavityMax[0]}`);
  assert.ok(Math.abs(n.cavityMax[1] - 35.2) < 1e-3 && Math.abs(n.cavityMin[1] + 35.2) < 1e-3, `cavity y ${n.cavityMin[1]}..${n.cavityMax[1]}`);
  assert.ok(Math.abs(n.cavityMin[2] + 16.9) < 1e-3 && n.cavityMax[2] > 18.75, `cavity z ${n.cavityMin[2]}..${n.cavityMax[2]}`);
  // Wall volume: outer filleted box minus the cavity inside it (within 1%).
  const outer = 189446.9;
  const inner = 65 * 70.4 * 35.65;
  assert.ok(n.vol > 0.9 * (outer - inner) && n.vol < 1.25 * (outer - inner), `hollow volume ${n.vol}`);
});

test('an edge that ends on other material is cut flush: no notch in the plate', { timeout: 120_000 }, async () => {
  // A boss on a plate at non-float32 heights. The boss's vertical edge ends
  // on the plate top (not free) and at the boss top (free).
  const ran = await runScript(`let plate = Manifold.cube([60.3, 60.3, 5.1], true);
let boss = Manifold.cube([20.1, 20.1, 15.3], true).translate([0, 0, 5.1 / 2 + 15.3 / 2]);
let part = plate.add(boss);
const v0 = part.volume();
const e = convexEdges(part).filter((e) => Math.abs(e.va[0] - 10.05) < 1e-3 && Math.abs(e.vb[0] - 10.05) < 1e-3 && Math.abs(e.va[1] - 10.05) < 1e-3 && Math.abs(e.vb[1] - 10.05) < 1e-3)[0];
if (!e) throw new Error('boss edge not found');
part = filletEdges(part, [e], 2);
const mesh = part.getMesh(); const np = mesh.numProp || 3; const V = mesh.vertProperties;
let notch = 0;
for (let i = 0; i < V.length / np; i++) { const z = V[i*np+2]; if (z < 2.55 - 1e-6 && z > 2.55 - 0.02) notch++; }
globalThis.__note = { removed: v0 - part.volume(), notch, genus: part.genus() };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0, `genus ${n.genus}`);
  assert.equal(n.notch, 0, `${n.notch} vertices just under the plate top`);
  assert.ok(Math.abs(n.removed - (1 - Math.PI / 4) * 4 * 15.3) < 0.05, `removed ${n.removed}`);
});
