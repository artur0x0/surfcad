/**
 * hollow after a dense fillet. The cavity is a vertex warp; a flat met by a
 * fillet used to end up half a micron off plane at the tangency, the sweep's
 * leg nudge kinked the sail's first facet, and once arc chords dropped under
 * ~0.05 mm the warp reordered the near-collinear vertices of the flat's long
 * slivers and folded them: pairs of ~1 mm² triangles wound against each
 * other, which flipped crease signs and broke moveFace. Now a flat's
 * tangency vertices move purely along the flat's normal, every closed vertex
 * on a real flat is projected onto its exact offset plane, any sliver the
 * warp still flips gets its diagonal swapped, and the fillet's legs sit
 * exactly on the faces. The cavity must come out with no fold at any density.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const OPENING = "[{ center: [0, -15, 0], normal: [0, -1, 0] }, { center: [-20, 0, 0], normal: [-1, 0, 0] }, { center: [0, 0, -10], normal: [0, 0, -1] }]";
const MEASURE = `
const mesh = part.getMesh(); const np = mesh.numProp || 3; const V = mesh.vertProperties; const T = mesh.triVerts;
const nrm = []; const em = new Map();
for (let t = 0; t < T.length / 3; t++) {
  const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
  const A = [V[a*np], V[a*np+1], V[a*np+2]], B = [V[b*np], V[b*np+1], V[b*np+2]], C = [V[c*np], V[c*np+1], V[c*np+2]];
  const u = [B[0]-A[0], B[1]-A[1], B[2]-A[2]], w = [C[0]-A[0], C[1]-A[1], C[2]-A[2]];
  const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1;
  nrm[t] = [n[0]/l, n[1]/l, n[2]/l];
  for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? p * 1e9 + q : q * 1e9 + p; if (!em.has(k)) em.set(k, []); em.get(k).push(t); }
}
let folds = 0;
for (const l of em.values()) if (l.length === 2 && nrm[l[0]][0]*nrm[l[1]][0] + nrm[l[0]][1]*nrm[l[1]][1] + nrm[l[0]][2]*nrm[l[1]][2] < -0.9) folds++;
// Inner surface near the inner corner: the arc (rho 1.5 about y=11, z=6) and the flats y=12.5 / z=7.5.
let arcMax = 0, planeMax = 0, arcN = 0;
for (let i = 0; i < V.length / np; i++) {
  const x = V[i*np], y = V[i*np+1], z = V[i*np+2];
  if (x < -19.9 || x > 17.6 || y < 10.9 || y > 12.6 || z < 5.9 || z > 7.6) continue;
  const dArc = Math.abs(Math.hypot(y - 11, z - 6) - 1.5);
  const dPlane = Math.min(Math.abs(y - 12.5), Math.abs(z - 7.5));
  if (dArc < dPlane) { arcN++; arcMax = Math.max(arcMax, dArc); } else planeMax = Math.max(planeMax, dPlane);
}
globalThis.__note = { folds, arcN, arcMax, planeMax, tris: T.length / 3 };`;

for (const segs of [24, 48, 96]) {
  test(`hollow after a ${segs}-step fillet: no fold pair, exact inner flats, the arc on the offset cylinder`, { timeout: 120_000 }, async () => {
    const ran = await runScript(`let part = Manifold.cube([40, 30, 20], true);
const e = convexEdges(part).filter((e) => Math.abs(e.va[1] - 15) < 1e-6 && Math.abs(e.va[2] - 10) < 1e-6 && Math.abs(e.vb[1] - 15) < 1e-6)[0];
part = filletAlongPath(part, makeSweepPath([e]), 4, { segments: ${segs} });
part = hollow(part, 2.5, ${OPENING});
${MEASURE}
return part;`);
    assert.equal(ran.status, 'NoError', ran.status);
    const n = globalThis.__note;
    assert.equal(n.folds, 0, `fold pairs ${n.folds}`);
    assert.ok(n.arcN >= segs - 2, `inner arc vertices ${n.arcN}`);
    assert.ok(n.arcMax < 2e-3, `inner arc off the offset cylinder by ${n.arcMax}`);
    assert.ok(n.planeMax < 1e-6, `inner flat off plane by ${n.planeMax}`);
  });
}

test('the planar kernel at its own density hollows without a fold too', { timeout: 120_000 }, async () => {
  const ran = await runScript(`let part = Manifold.cube([40, 30, 20], true);
const e = convexEdges(part).filter((e) => Math.abs(e.va[1] - 15) < 1e-6 && Math.abs(e.va[2] - 10) < 1e-6 && Math.abs(e.vb[1] - 15) < 1e-6)[0];
part = filletEdges(part, [e], 4);
part = hollow(part, 2.5, ${OPENING});
${MEASURE}
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(globalThis.__note.folds, 0);
  assert.ok(globalThis.__note.planeMax < 1e-6);
});

test('an open-rim corner lands exactly in its walls, so the rim keeps no fan vertices', { timeout: 120_000 }, async () => {
  // Bottom opening only. The inner -x wall is a fan from its bottom corner to
  // the fillet's arc; that corner carries the open push and used to keep the
  // LS solve's 5 µm plane error while every other wall vertex was projected
  // exactly, so Manifold saw 26 faces instead of one and the boolean left two
  // dozen collinear vertices along the open rim.
  const ran = await runScript(`let part = Manifold.cube([40, 30, 20], true);
const e = convexEdges(part).filter((e) => Math.abs(e.va[1] - 15) < 1e-6 && Math.abs(e.va[2] - 10) < 1e-6 && Math.abs(e.vb[1] - 15) < 1e-6)[0];
part = filletAlongPath(part, makeSweepPath([e]), 4);
part = hollow(part, 2.5, { center: [0, 0, -10], normal: [0, 0, -1] });
const mesh = part.getMesh(); const np = mesh.numProp || 3; const V = mesh.vertProperties;
let rim = 0, wall = 0;
for (let i = 0; i < V.length / np; i++) {
  if (Math.abs(V[i*np] + 17.5) > 1e-4) continue;
  wall++;
  if (Math.abs(V[i*np+2] + 10) < 1e-4) rim++;
}
globalThis.__note = { rim, wall };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.ok(globalThis.__note.rim <= 3, `rim vertices on the inner -x wall ${globalThis.__note.rim}`);
  assert.ok(globalThis.__note.wall <= 30, `inner -x wall vertices ${globalThis.__note.wall}`);
});
