/**
 * A spherical corner on a drafted box is the sphere at distance r from each
 * face. The old center was r times the sum of the inward normals, which is
 * right only when those normals are orthogonal. On a 1° draft at r=2 that
 * put |O−P| at 3.4239 instead of 2√3 = 3.4641 and threw. The tolerance on
 * the orthogonal check is unchanged; this corner is not orthogonal.
 *
 * Planar r=4 (sphericalCorners false) on the same solid still fillets.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const BOX = `// --- cube begin id=cube1 ---
let box1 = Manifold.cube([40, 40, 20], true);
let part = box1;
// --- cube end id=cube1 ---
// --- draft begin id=draft1 ---
part = draftFaces(part, 'sides', 1, { pull: 'z', reference: 'max' });
// --- draft end id=draft1 ---`;

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Incenter of the +X/+Y top corner: distance r inside the three drafted planes. */
function expectedIncenter(r) {
  const t = Math.tan(Math.PI / 180);
  const dx = 20 * t;
  const P = [20, 20, 10];
  const m = [
    norm([-20, 0, -dx]),
    norm([0, -20, -dx]),
    [0, 0, -1],
  ];
  const c0 = cross(m[1], m[2]);
  const c1 = cross(m[2], m[0]);
  const c2 = cross(m[0], m[1]);
  const det = dot(m[0], c0);
  const s = r / det;
  return [
    P[0] + s * (c0[0] + c1[0] + c2[0]),
    P[1] + s * (c0[1] + c1[1] + c2[1]),
    P[2] + s * (c0[2] + c1[2] + c2[2]),
  ];
}

test('spherical corners on a 1° drafted box sit on the face-distance sphere', { timeout: 120_000 }, async () => {
  const r = 2;
  const ran = await runScript(`${BOX}
// --- fillet-mode begin id=fillet1 ---
part = filletEdges(part, convexEdges(part), ${r}, { sphericalCorners: true });
// --- fillet-mode end id=fillet1 ---
const corners = facesNamed(part, 'fillet1.corner*');
let best = null;
let bestD = Infinity;
for (const face of corners) {
  const c = face.center;
  const d = (c[0] - 20) ** 2 + (c[1] - 20) ** 2 + (c[2] - 10) ** 2;
  if (d < bestD) { bestD = d; best = face; }
}
globalThis.__note = {
  statusReady: true,
  genus: part.genus(),
  bodies: part.decompose().length,
  cornerCount: corners.length,
  verts: best.verts,
};
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0, `genus ${n.genus}`);
  assert.equal(n.bodies, 1, `bodies ${n.bodies}`);
  assert.ok(n.cornerCount >= 1, 'no spherical corner faces');
  const O = expectedIncenter(r);
  // The corner run also carries the flat faces of the pocket, which are not
  // on the sphere. The octant grid is: a real share of the vertices must
  // sit on the plane-distance sphere. The old center was ~0.07 mm off this
  // one and would miss a 0.02 mm band.
  let onSphere = 0;
  let best = Infinity;
  for (const v of n.verts) {
    const err = Math.abs(Math.hypot(v[0] - O[0], v[1] - O[1], v[2] - O[2]) - r);
    if (err < best) best = err;
    if (err < 0.02) onSphere += 1;
  }
  assert.ok(onSphere >= 10 && best < 0.02,
    `${onSphere}/${n.verts.length} verts on the r=${r} sphere at ${O}, closest ${best}`);
  assert.ok(Math.abs(Math.hypot(O[0] - 20, O[1] - 20, O[2] - 10) - r * Math.sqrt(3)) > 0.03,
    'this drafted corner is not the orthogonal incenter');
});

test('planar r=4 still fillets the drafted box', { timeout: 120_000 }, async () => {
  const ran = await runScript(`${BOX}
// --- fillet-mode begin id=fillet1 ---
part = filletEdges(part, edgesNamed(part, "cube1.back~cube1.right"), 4, { sphericalCorners: false });
// --- fillet-mode end id=fillet1 ---
globalThis.__note = { names: faceNames(part), genus: part.genus(), bodies: part.decompose().length };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.equal(n.genus, 0);
  assert.equal(n.bodies, 1);
  assert.ok(n.names.includes('fillet1.round'), n.names.join(', '));
  assert.equal(n.names.some((name) => name.startsWith('fillet1.corner')), false);
});
