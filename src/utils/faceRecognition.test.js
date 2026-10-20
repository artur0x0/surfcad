/**
 * Face recognition on large and combined bodies (bike joints acceptance,
 * PR 1). Minimal equivalents of the Hubless Bike frame and fork: hubless
 * bearing rings (r300 / r260) unioned with tilted tubes and rods, then
 * classified the way `list_faces` and `joint_pick` do.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { agentFaceCatalog, jointPickForFace, realizeAgentFaceCatalog } from '../agent/faceCatalog.js';

const HELPERS = `
const DEG = 180 / Math.PI;
function at(o, u, t) { return [o[0] + u[0] * t, o[1] + u[1] * t, o[2] + u[2] * t]; }
function rodAB(a, b, r, seg) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  const th = Math.atan2(Math.hypot(dx, dy), dz) * DEG, ph = Math.atan2(dy, dx) * DEG;
  return Manifold.cylinder(L, r, r, seg || 32, false).rotate([0, th, ph]).translate(a);
}
function ringAxis(o, dir, rOut, rIn, t0, t1, seg) {
  const n = Math.hypot(dir[0], dir[1], dir[2]);
  const u = [dir[0] / n, dir[1] / n, dir[2] / n];
  const th = Math.atan2(Math.hypot(u[0], u[1]), u[2]) * DEG, ph = Math.atan2(u[1], u[0]) * DEG;
  const L = t1 - t0, sg = seg || 64;
  let m = Manifold.cylinder(L, rOut, rOut, sg, false);
  if (rIn > 0) m = m.subtract(Manifold.cylinder(L + 2, rIn, rIn, sg, false).translate([0, 0, -1]));
  return m.translate([0, 0, t0]).rotate([0, th, ph]).translate(o);
}
const H = [830, 0, 700], dH = [-0.30902, 0, 0.95106];
const BB = [440, 0, 300], sT = [-0.29237, 0, 0.95630];
const RW = [0, 0, 350];
`;

/** The bike3 frame: hubless rear housings, BB shell, head tube, seat tube, tubes, stays. */
const FRAME = `${HELPERS}
let solid = ringAxis(RW, [0, 1, 0], 300, 0, 15, 40, 128).add(ringAxis(RW, [0, 1, 0], 300, 0, -40, -15, 128));
solid = solid.add(ringAxis(BB, [0, 1, 0], 22, 0, -35, 35, 48));
solid = solid.add(ringAxis(H, dH, 22, 0, 0, 150, 48));
solid = solid.add(ringAxis(BB, sT, 18, 0, 0, 480, 48));
solid = solid.add(rodAB(at(BB, sT, 430), at(H, dH, 120), 15));
solid = solid.add(rodAB(BB, at(H, dH, 25), 19));
for (const y of [27.5, -27.5]) {
  solid = solid.add(rodAB([288, y, 317], [425, y * 0.8, 302], 10));
  const st = at(BB, sT, 455);
  solid = solid.add(rodAB([183.5, y, 574.8], [st[0], y * 0.5, st[2]], 9));
}
solid = solid.subtract(ringAxis(RW, [0, 1, 0], 260, 0, -60, 60, 128));
solid = solid.subtract(ringAxis(BB, [0, 1, 0], 15, 0, -50, 50, 48));
solid = solid.subtract(ringAxis(H, dH, 17, 0, -10, 160, 48));
solid = solid.subtract(ringAxis(BB, sT, 14, 0, 30, 500, 48));
let part = solid;
return part;
`;

async function catalogOf(source) {
  const ran = await runScript(source);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.manifold.getMesh());
  return realizeAgentFaceCatalog(agentFaceCatalog(geometry, faceIDs));
}

function axisDistance(point, at, dir) {
  const d = [point[0] - at[0], point[1] - at[1], point[2] - at[2]];
  const along = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
  return Math.hypot(d[0] - dir[0] * along, d[1] - dir[1] * along, d[2] - dir[2] * along);
}

function absDot(a, b) {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

function cylinders(rows, radius, tol = 0.5) {
  return rows.filter((row) => row.axis && Math.abs(row.axis.radius - radius) <= tol);
}

test('frame: flat tube ends far from the big rings read as planar faces with the right normal', async () => {
  const rows = await catalogOf(FRAME);
  const dH = [-0.30902, 0, 0.95106];
  const sT = [-0.29237, 0, 0.95630];
  // Head tube ends (annulus r22/r17, about 613 mm²) and the seat tube top (r18/r14, about 402 mm²).
  const ends = rows.filter((row) => row.area > 350 && row.area < 700
    && (absDot(row.n, dH) > 0.999 || absDot(row.n, sT) > 0.999));
  assert.ok(ends.length >= 3, `expected the tilted tube ends, found ${ends.length}`);
  for (const row of ends) {
    assert.equal(row.type, 'planar', `${row.faceId} area ${row.area.toFixed(0)} read as ${row.type}`);
    const pick = jointPickForFace(row);
    assert.equal(pick.kind, 'face', `${row.faceId}: ${JSON.stringify(pick)}`);
    assert.equal(pick.planar, true);
  }
  // The bearing housing end faces are the large flats; they stay planar too.
  const housingEnds = rows.filter((row) => row.area > 70000 && row.area < 71000);
  assert.equal(housingEnds.length, 4);
  for (const row of housingEnds) assert.equal(row.type, 'planar');
});

test('frame: the r300 rings cut by tubes fit the true radius and axis', async () => {
  const rows = await catalogOf(FRAME);
  const outer = cylinders(rows, 300, 5);
  assert.equal(outer.length, 2, `expected two r300 walls, got ${outer.map((r) => r.axis.radius.toFixed(1)).join(', ')}`);
  for (const row of outer) {
    assert.ok(Math.abs(row.axis.radius - 300) < 0.05, `radius ${row.axis.radius}`);
    assert.ok(absDot(row.axis.dir, [0, 1, 0]) > 0.9999);
    const off = axisDistance(row.axis.at, [0, 0, 350], [0, 1, 0]);
    assert.ok(off < 0.1, `axis off by ${off.toFixed(2)} mm`);
    assert.equal(jointPickForFace(row).kind, 'axis');
  }
  const bores = cylinders(rows, 260, 5);
  assert.equal(bores.length, 2);
  for (const row of bores) {
    assert.ok(Math.abs(row.axis.radius - 260) < 0.05, `radius ${row.axis.radius}`);
    assert.ok(axisDistance(row.axis.at, [0, 0, 350], [0, 1, 0]) < 0.1);
  }
});

test('frame: a tube wall and a bore through unioned bodies are one cylindrical face each', async () => {
  const rows = await catalogOf(FRAME);
  const seatWall = cylinders(rows, 18, 0.5);
  assert.equal(seatWall.length, 1, `seat tube wall in ${seatWall.length} fragments`);
  const seatBore = cylinders(rows, 14, 0.5);
  assert.equal(seatBore.length, 1, `seat bore in ${seatBore.length} fragments`);
  const headBore = cylinders(rows, 17, 0.5);
  assert.equal(headBore.length, 1, `head bore in ${headBore.length} fragments`);
  const bbBore = cylinders(rows, 15, 0.5).filter((row) => absDot(row.axis.dir, [0, 1, 0]) > 0.999);
  assert.equal(bbBore.length, 1, `bottom bracket bore in ${bbBore.length} fragments`);
  const sT = [-0.29237, 0, 0.95630];
  assert.ok(absDot(seatWall[0].axis.dir, sT) > 0.9999);
  assert.ok(axisDistance(seatWall[0].axis.at, [440, 0, 300], sT) < 0.05);
  assert.equal(jointPickForFace(seatWall[0]).kind, 'axis');
  assert.equal(jointPickForFace(seatBore[0]).kind, 'axis');
});

test('fork: r300 housings around a far-off wheel centre fit on axis', async () => {
  const rows = await catalogOf(`${HELPERS}
const FW = [1050, 0, 350];
let f = ringAxis(H, dH, 14.3, 0, -30, 200, 48);
f = f.add(ringAxis(H, dH, 20, 0, 150, 160, 48));
f = f.add(Manifold.cube([60, 110, 30], true).rotate([0, -18, 0]).translate(at(H, dH, -15)));
const cb = at(H, dH, -30);
for (const y of [28, -28]) f = f.add(rodAB([cb[0], y, cb[2]], [893.8, y, 588.3], 12));
f = f.add(ringAxis(FW, [0, 1, 0], 300, 260, 15, 40, 128)).add(ringAxis(FW, [0, 1, 0], 300, 260, -40, -15, 128));
let part = f;
return part;
`);
  const outer = cylinders(rows, 300, 5);
  assert.equal(outer.length, 2);
  for (const row of outer) {
    assert.ok(Math.abs(row.axis.radius - 300) < 0.05, `radius ${row.axis.radius}`);
    assert.ok(axisDistance(row.axis.at, [1050, 0, 350], [0, 1, 0]) < 0.1);
  }
  const steerer = cylinders(rows, 14.3, 0.3);
  assert.ok(steerer.length >= 1);
  const top = rows.filter((row) => row.area > 600 && row.area < 700 && absDot(row.n, [-0.30902, 0, 0.95106]) > 0.999);
  assert.ok(top.length >= 1, 'steerer top annulus');
  for (const row of top) assert.equal(row.type, 'planar');
});

test('a 24-segment cylinder is one cylindrical face with its axis', async () => {
  for (const segments of [24, 32, 48]) {
    const rows = await catalogOf(`let part = Manifold.cylinder(50, 10, 10, ${segments}, false).translate([300, -200, 90]); return part;`);
    assert.equal(rows.length, 3, `${segments} segments listed ${rows.length} faces`);
    const wall = rows.filter((row) => row.axis);
    assert.equal(wall.length, 1);
    assert.ok(Math.abs(wall[0].axis.radius - 10) < 1e-3);
    assert.ok(absDot(wall[0].axis.dir, [0, 0, 1]) > 0.9999);
    assert.ok(axisDistance(wall[0].axis.at, [300, -200, 90], [0, 0, 1]) < 1e-3);
    assert.equal(jointPickForFace(wall[0]).kind, 'axis');
    assert.equal(rows.filter((row) => row.type === 'planar').length, 2);
  }
});
