#!/usr/bin/env node
/**
 * Bend-root fillet keeps the picked concave edge.
 *
 * The root line y=30, z=0 carries two feature edges: the concave facet edge
 * and the convex bottom edge. makeSweepPath used to drop n0/n1, and the
 * re-probe took the convex twin (a bottom groove; at r=3.29 a scrap body).
 * The path now carries the picked walls. The round sits under the sheet,
 * outside the pre-fillet box, and the added volume stays near the 90°
 * section times the edge length.
 *
 * Also: the same solid-inside / empty-past probes on a plain base cutout,
 * and the reconstructed Bracket's six fillets stay on the analytic section.
 */
import { filletWedgeArea } from '../../src/utils/filletAlongPath.js';
import { runScript } from '../../src/lib/surfcad/index.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const SHEET = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 3.81,
  k: 0.38,
  plane: 'XY',
  width: 100,
  height: 60,
  bends: [{ id: 'b1', panel: 'base', edge: 'v+', angle: 90, length: 28.2, flip: false }],
  tabs: [],
  holes: [],
};

// Empty-side angle the kernel reports for this root (face angle 86.25°).
const ROOT_THETA = (93.75 * Math.PI) / 180;

function rootCenter(radius) {
  const setback = radius / Math.tan(ROOT_THETA / 2);
  return { y: 30 + radius, z: -setback, setback };
}

/** Point on the corner-to-center line, `dist` from the arc center. */
function alongRoot(radius, dist) {
  const c = rootCenter(radius);
  const corner = { y: 30, z: 0 };
  const dy = corner.y - c.y;
  const dz = corner.z - c.z;
  const L = Math.hypot(dy, dz) || 1;
  return [0, c.y + (dist * dy) / L, c.z + (dist * dz) / L];
}

const ROOT_SRC = `
const spec = ${JSON.stringify(SHEET)};
let sheet = sheetMetalSolid(spec);
const pre = sheet.volume();
const edgeLen = (e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
const mid = (e) => [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
const root = concaveEdges(sheet).find((e) => {
  const m = mid(e);
  return edgeLen(e) > 80 && Math.abs(m[1] - 30) < 0.2 && Math.abs(m[2]) < 0.2;
});
if (!root) throw new Error('bend-root concave edge missing');
// Accept writes va/vb and n0/n1. Face ids are not in the literal.
const literal = [{
  a: root.a, b: root.b,
  va: root.va.slice(), vb: root.vb.slice(),
  n0: root.n0.slice(), n1: root.n1.slice(),
}];
const path = makeSweepPath(literal);
const carried = path.edges && path.edges[0];
const probe = (solid, c, s) => Manifold.intersection(solid, Manifold.cube(s, true).translate(c)).volume();
const radii = [2, 3, 3.29];
const rows = [];
for (const radius of radii) {
  const fil = filletAlongPath(sheet, path, radius);
  const bb = fil.boundingBox();
  const meta = globalThis.__filletVariableProfileMeta;
  rows.push({
    radius,
    added: fil.volume() - pre,
    bbMin: [bb.min[0], bb.min[1], bb.min[2]],
    bbMax: [bb.max[0], bb.max[1], bb.max[2]],
    concaveRuns: meta && meta.concaveRuns,
    convexRuns: meta && meta.convexRuns,
    groove: probe(fil, [0, 29, 0.55], [6, 1, 0.5]),
    lip: probe(fil, [0, 29.2, -0.45], [6, 0.5, 0.4]),
    arcIn: probe(fil, globalThis.__rootIn[radius], [0.28, 0.28, 0.28]),
    arcOut: probe(fil, globalThis.__rootOut[radius], [0.28, 0.28, 0.28]),
  });
}
globalThis.__bendRootReport = {
  carried: carried && { n0: carried.n0, n1: carried.n1, convex: carried.convex },
  rows,
};
return sheet;
`;

const rootIn = {};
const rootOut = {};
for (const radius of [2, 3, 3.29]) {
  rootIn[radius] = alongRoot(radius, radius + 0.35);
  rootOut[radius] = alongRoot(radius, radius - 0.45);
}
globalThis.__rootIn = rootIn;
globalThis.__rootOut = rootOut;

console.log('bend root');
const rootRun = await runScript(ROOT_SRC);
check('root run', rootRun.status === 'NoError' && !rootRun.featureSkip, rootRun.status);
const report = globalThis.__bendRootReport;
const carried = report && report.carried;
check(
  'path keeps picked normals',
  carried && Math.abs(carried.n0[1] - 1) < 1e-6 && carried.n1[2] < -0.9,
  JSON.stringify(carried),
);
const cube = 0.28 ** 3;
for (const row of report.rows) {
  const expect = filletWedgeArea(row.radius) * 100;
  const ratio = row.added / expect;
  check(
    `r=${row.radius} volume ${row.added.toFixed(1)} vs section×L ${expect.toFixed(1)}`,
    ratio > 0.75 && ratio < 1.25,
    `ratio ${ratio.toFixed(3)}`,
  );
  check(
    `r=${row.radius} concave filler, not the convex twin`,
    row.concaveRuns === 1 && row.convexRuns === 0,
    `cx ${row.convexRuns} cv ${row.concaveRuns}`,
  );
  check(
    `r=${row.radius} solid inside the radius`,
    row.arcIn > 0.85 * cube,
    `probe ${row.arcIn.toFixed(4)} / ${cube.toFixed(4)}`,
  );
  check(
    `r=${row.radius} empty past the radius`,
    row.arcOut < 0.05 * cube,
    `probe ${row.arcOut.toFixed(4)}`,
  );
  check(
    `r=${row.radius} no bottom groove`,
    row.groove > 0.95 * 3,
    `probe ${row.groove.toFixed(3)}`,
  );
  check(
    `r=${row.radius} no lip under the base`,
    row.lip < 0.02,
    `probe ${row.lip.toFixed(4)}`,
  );
  check(
    `r=${row.radius} round leaves the sheet, end pad does not`,
    row.bbMin[2] < -0.6 * rootCenter(row.radius).setback && row.bbMax[0] < 50.2 && row.bbMin[0] > -50.2,
    `bb z ${row.bbMin[2].toFixed(3)} x ${row.bbMin[0].toFixed(3)}..${row.bbMax[0].toFixed(3)}`,
  );
}

const CUT_SRC = `
const t = 3.175;
const radius = 3;
const spec = { v: 1, sku: 'TEST', t, r: 1, k: 0.4, plane: 'XY', width: 80, height: 50, bends: [], tabs: [], holes: [] };
let sheet = sheetMetalSolid(spec);
const opening = Manifold.cube([24, 18, t + 4], true).translate([0, 0, t / 2]);
sheet = sheet.subtract(opening);
const cutVol = sheet.volume();
const edgeLen = (e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
const mid = (e) => [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
const corners = concaveEdges(sheet).filter((e) => {
  const m = mid(e);
  return Math.abs(e.tangent[2]) > 0.9 && edgeLen(e) > 2 && edgeLen(e) < 5
    && Math.abs(Math.abs(m[0]) - 12) < 0.4 && Math.abs(Math.abs(m[1]) - 9) < 0.4;
});
if (corners.length !== 4) throw new Error('plain cutout corners ' + corners.length);
for (const e of corners) {
  const path = makeSweepPath([e]);
  sheet = filletAlongPath(sheet, path, radius);
}
const probe = (solid, c, s) => Manifold.intersection(solid, Manifold.cube(s, true).translate(c)).volume();
const t2 = t / 2;
const inset = radius - 0.45;
const samples = [];
for (const x of [12, -12]) {
  for (const y of [9, -9]) {
    const sx = x > 0 ? -1 : 1;
    const sy = y > 0 ? -1 : 1;
    samples.push({
      in: probe(sheet, [x + sx * 0.35, y + sy * 0.35, t2], [0.5, 0.5, t * 0.5]),
      out: probe(sheet, [x + sx * inset, y + sy * inset, t2], [0.5, 0.5, t * 0.5]),
    });
  }
}
const bb = sheet.boundingBox();
globalThis.__cutoutReport = {
  added: sheet.volume() - cutVol,
  samples,
  zMin: bb.min[2],
  zMax: bb.max[2],
  n: corners.length,
};
return sheet;
`;

console.log('plain base cutout');
const cutRun = await runScript(CUT_SRC);
check('cutout run', cutRun.status === 'NoError' && !cutRun.featureSkip, cutRun.status);
const cut = globalThis.__cutoutReport;
const cutExpect = 4 * filletWedgeArea(3) * 3.175;
const cutCube = 0.5 * 0.5 * (3.175 * 0.5);
check(
  `cutout volume ${cut.added.toFixed(2)} vs section×L ${cutExpect.toFixed(2)}`,
  cut.added > 0.75 * cutExpect && cut.added < 1.25 * cutExpect,
  `ratio ${(cut.added / cutExpect).toFixed(3)}`,
);
check('cutout four corners', cut.n === 4 && cut.samples.length === 4);
cut.samples.forEach((s, i) => {
  check(`cutout corner ${i} solid inside`, s.in > 0.85 * cutCube, `probe ${s.in.toFixed(4)}`);
  check(`cutout corner ${i} empty past`, s.out < 0.05 * cutCube, `probe ${s.out.toFixed(4)}`);
});
check(
  'cutout stays within the sheet faces',
  cut.zMin > -0.05 && cut.zMax < 3.175 + 0.05,
  `z ${cut.zMin.toFixed(3)}..${cut.zMax.toFixed(3)}`,
);

const BRACKET = `
const sheetSpec = {"v":1,"sku":"SST316-125","material":"Stainless Steel (316 Series)","t":3.175,"r":3.81,"k":0.38,"plane":"XY","width":100,"height":60,"bends":[{"id":"b1","panel":"base","edge":"v+","angle":90,"length":28.2,"flip":false}],"tabs":[],"holes":[]};
let part = sheetMetalSolid(sheetSpec);
const c1 = makeCrossSection({ center: [0, 0, 3.175], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profilePolygon([[-10, 6], [10, 6], [10, 24], [-10, 24]]));
part = part.subtract(placeInFrame(c1.plane, makeExtrude(c1.contours, 20), [0, 0, -10]));
const selEdges = [{ a: 42, b: 43, va: [10, 24, 0], vb: [10, 24, 3.175], length: 3.175, key: "42-43", n0: [0, -1, 0], n1: [-1, 0, 0] }];
const selEdges2 = [{ a: 40, b: 41, va: [10, 6, 0], vb: [10, 6, 3.175], length: 3.175, key: "40-41", n0: [-1, 0, 0], n1: [0, 1, 0] }];
const selEdges3 = [{ a: 34, b: 35, va: [-10, 24, 0], vb: [-10, 24, 3.175], length: 3.175, key: "34-35", n0: [0, -1, 0], n1: [1, 0, 0] }];
const selEdges4 = [{ a: 32, b: 33, va: [-10, 6, 0], vb: [-10, 6, 3.175], length: 3.175, key: "32-33", n0: [1, 0, 0], n1: [0, 1, 0] }];
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 3.29);
const path2 = makeSweepPath(selEdges2);
part = filletAlongPath(part, path2, 3.29);
const path3 = makeSweepPath(selEdges3);
part = filletAlongPath(part, path3, 3.29);
const path4 = makeSweepPath(selEdges4);
part = filletAlongPath(part, path4, 3.29);
const c2 = makeCrossSection({ center: [0, 33.81, 21.085], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, profilePolygon([[-8, 8.915], [8, 8.915], [8, -11.085], [3, -11.085], [3, -22.085], [-8, -22.085]]));
part = part.subtract(placeInFrame(c2.plane, makeExtrude(c2.contours, 20), [0, 0, -10]));
const selEdges5 = [{ a: 398, b: 399, va: [8, 33.810001, 30], vb: [8, 36.985001, 30], length: 3.174999, key: "398-399", n0: [-1, 0, 0], n1: [0, 0, -1] }];
const selEdges6 = [{ a: 366, b: 367, va: [8, 33.810001, 10], vb: [8, 36.985001, 10], length: 3.174999, key: "366-367", n0: [-1, 0, 0], n1: [0, 0, 1] }];
const path5 = makeSweepPath(selEdges5);
part = filletAlongPath(part, path5, 3.29);
const path6 = makeSweepPath(selEdges6);
part = filletAlongPath(part, path6, 3.29);
return part;
`;

const BRACKET_BARE = BRACKET.replace(/part = filletAlongPath\(part, path\d?, 3\.29\);\n/g, '');

console.log('reconstructed bracket');
const bare = await runScript(BRACKET_BARE);
const full = await runScript(BRACKET);
check('bracket run', full.status === 'NoError' && !full.featureSkip, full.status);
const added = full.volume - bare.volume;
const six = 6 * filletWedgeArea(3.29) * 3.175;
check(
  `bracket six fillets ${added.toFixed(2)} vs analytic ${six.toFixed(2)}`,
  Math.abs(added - six) / six < 0.1,
  `ratio ${(added / six).toFixed(3)}`,
);

const T = 3.175;
const R = 3.29;
const { getManifoldModule } = await import('../../src/lib/surfcad/runtime.js');
const { Manifold } = getManifoldModule();
function boxVol(size) {
  return size[0] * size[1] * size[2];
}
function probe(solid, center, size) {
  return Manifold.intersection(solid, Manifold.cube(size, true).translate(center)).volume();
}
const baseSize = [0.7, 0.7, T * 0.5];
const flangeSize = [0.7, 2.2, 0.7];
const baseCorners = [[10, 24], [10, 6], [-10, 24], [-10, 6]];
for (const [x, y] of baseCorners) {
  const sx = x > 0 ? -1 : 1;
  const sy = y > 15 ? -1 : 1;
  const inside = probe(full.manifold, [x + sx * 0.35, y + sy * 0.35, T / 2], baseSize);
  const past = probe(full.manifold, [x + sx * (R - 0.45), y + sy * (R - 0.45), T / 2], baseSize);
  check(`bracket base (${x},${y}) solid inside`, inside > 0.9 * boxVol(baseSize), inside.toFixed(3));
  check(`bracket base (${x},${y}) empty past`, past < 0.05 * boxVol(baseSize), past.toFixed(3));
}
const flangeCorners = [[30, -1], [10, 1]];
for (const [z, sz] of flangeCorners) {
  const inside = probe(full.manifold, [8 - 0.35, 35.4, z + sz * 0.35], flangeSize);
  const past = probe(full.manifold, [8 - (R - 0.45), 35.4, z + sz * (R - 0.45)], flangeSize);
  check(`bracket flange z=${z} solid inside`, inside > 0.9 * boxVol(flangeSize), inside.toFixed(3));
  check(`bracket flange z=${z} empty past`, past < 0.05 * boxVol(flangeSize), past.toFixed(3));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall checks passed');
