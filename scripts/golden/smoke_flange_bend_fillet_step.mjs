#!/usr/bin/env node
/**
 * Outer corner of the SST316 bracket, the part from the 9:04 playtest.
 *
 * golden:flange-outer-fillet picks the long flange straight and probes the
 * middle of the arc. That passes while this part still steps: the bend is a
 * chain of facets, a pick can start on one, and the arc ends on the base
 * corner. This golden fillets that real sheet at r = 3, 3.3, and 3.7, from
 * the straight and from the first outer facet. Through the bend the bisector
 * is empty, then solid, once — no skin, no second sheet. The base corner
 * stays sharp. One manifold body.
 */
import { filletWedgeArea } from '../../src/utils/filletAlongPath.js';
import { countDegenerateTriangles } from '../../src/utils/filletEdgeClass.js';
import { runScript } from '../../src/lib/surfcad/index.js';
import { buildSolidGeometry } from '../../src/utils/partSolidCache.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const T = 3.175;
const BEND_R = 3.81;
const RO = T + BEND_R;
const AXIS_Y = 30;
const AXIS_Z = T + BEND_R;
const STRAIGHT = 28.2;
const ARC = (Math.PI / 2) * RO;
const RADII = [3, 3.3, 3.7];

function src(radius, which) {
  return `
const spec = {"v":1,"sku":"SST316-125","t":3.175,"r":3.81,"k":0.38,"plane":"XY","width":100,"height":60,"bends":[{"id":"b1","panel":"base","edge":"v+","angle":90,"length":28.2,"flip":false}],"tabs":[],"holes":[]};
const sheet = sheetMetalSolid(spec);
const pre = sheet.volume();
const edgeLen = (e) => Math.hypot(e.vb[0]-e.va[0], e.vb[1]-e.va[1], e.vb[2]-e.va[2]);
const mid = (e) => [(e.va[0]+e.vb[0])/2,(e.va[1]+e.vb[1])/2,(e.va[2]+e.vb[2])/2];
const conv = convexEdges(sheet);
const straight = conv.find((e) => mid(e)[0] > 49 && mid(e)[1] > 36.5 && edgeLen(e) > 20);
if (!straight) throw new Error('outer straight missing');
const end = straight.va[2] < straight.vb[2] ? straight.va : straight.vb;
const chord = conv.find((e) => {
  const m = mid(e);
  if (m[0] < 49 || m[1] < 36 || edgeLen(e) > 2 || edgeLen(e) < 0.2) return false;
  const da = Math.hypot(e.va[0]-end[0], e.va[1]-end[1], e.va[2]-end[2]);
  const db = Math.hypot(e.vb[0]-end[0], e.vb[1]-end[1], e.vb[2]-end[2]);
  return Math.min(da, db) < 0.05;
});
if (!chord) throw new Error('outer bend facet missing');
const part = filletAlongPath(sheet, makeSweepPath([${which}]), ${radius});
const probe = (c, s) => Manifold.intersection(part, Manifold.cube(s, true).translate(c)).volume();
const cube = 0.22;
const stations = [];
function station(deg) {
  const a = deg * Math.PI / 180;
  const N = [0, Math.cos(a), -Math.sin(a)];
  const P = [50, ${AXIS_Y} + ${RO} * Math.cos(a), ${AXIS_Z} - ${RO} * Math.sin(a)];
  const bv = [-1, -N[1], -N[2]];
  const L = Math.hypot(bv[0], bv[1], bv[2]);
  const B = [bv[0] / L, bv[1] / L, bv[2] / L];
  const at = (d) => [P[0] + B[0] * d, P[1] + B[1] * d, P[2] + B[2] * d];
  let bits = '';
  let prev = 0;
  let flips = 0;
  for (let i = 1; i <= 22; i++) {
    const bit = probe(at(i * 0.1), [cube, cube, cube]) > 1e-5 ? 1 : 0;
    if (bit < prev) flips++;
    prev = bit;
    bits += bit;
  }
  const boundary = ${radius} * (Math.SQRT2 - 1);
  stations.push({
    deg,
    flips,
    bits,
    empty: probe(at(boundary * 0.45), [cube, cube, cube]),
    solid: probe(at(boundary * 1.7), [cube, cube, cube]),
    first: bits[0],
  });
}
for (const deg of [0, 15, 30, 45, 60, 75, 85, 90]) station(deg);
const bodies = part.decompose();
globalThis.__bendStep = {
  pre,
  removed: pre - part.volume(),
  bodies: bodies.length,
  stations,
  cube: cube * cube * cube,
};
return part;
`;
}

function clusters(mesh, radius) {
  const geom = buildSolidGeometry(mesh);
  const pos = geom.geometry.attributes.position.array;
  const bins = new Map();
  const nV = pos.length / 3;
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (x < 42 || x > 50.2) continue;
    const ang = Math.atan2(AXIS_Z - z, y - AXIS_Y);
    if (ang < -8 * Math.PI / 180 || ang > 80 * Math.PI / 180) continue;
    const rad = Math.hypot(y - AXIS_Y, AXIS_Z - z);
    if (rad < RO - 1.2 || rad > RO + 0.35) continue;
    const bin = Math.round((ang * 180) / Math.PI / 15) * 15;
    const ca = (bin * Math.PI) / 180;
    const N = [0, Math.cos(ca), -Math.sin(ca)];
    const P = [50, AXIS_Y + RO * Math.cos(ca), AXIS_Z - RO * Math.sin(ca)];
    const C = [P[0] - radius, P[1] - radius * N[1], P[2] - radius * N[2]];
    const d = Math.hypot(x - C[0], y - C[1], z - C[2]);
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(d);
  }
  const split = [];
  for (const [bin, arr] of bins) {
    const s = [...arr].sort((a, b) => a - b);
    const groups = [];
    for (const v of s) {
      const g = groups[groups.length - 1];
      if (!g || v - g[g.length - 1] > 0.2) groups.push([v]);
      else g.push(v);
    }
    const real = groups.filter((g) => g.length >= 3);
    if (real.length > 1) split.push(`${bin}° ${real.map((g) => g[0].toFixed(2)).join('+')}`);
  }
  return { split, degen: countDegenerateTriangles(geom.geometry) };
}

for (const which of ['straight', 'chord']) {
  for (const radius of RADII) {
    console.log(`\n${which} r=${radius}`);
    const run = await runScript(src(radius, which));
    const info = globalThis.__bendStep;
    check('fillet runs', run.status === 'NoError' && !run.featureSkip, run.status || run.error || '');
    if (!info) {
      check('report', false, 'missing fillet result');
      continue;
    }
    check('one body', info.bodies === 1, `bodies ${info.bodies}`);
    const surface = clusters(run.mesh, radius);
    check('one sheet along the bend', surface.split.length === 0, surface.split.join(', '));
    // A visible step is a face with some altitude. The tangency can still
    // carry a zero-area needle; that is not a second sheet.
    check('no stepped face', surface.degen <= (radius <= 3 ? 32 : 8), `degen ${surface.degen}`);
    const box = info.cube;
    for (const s of info.stations) {
      if (s.deg === 90) {
        check('base corner stays sharp, no skin', s.flips === 0 && s.first === '1', s.bits);
        continue;
      }
      check(
        `${s.deg}° one transition`,
        s.flips === 0 && s.bits.includes('0') && s.bits.includes('1'),
        s.bits,
      );
      check(`${s.deg}° empty in the wedge`, s.empty < 0.08 * box, s.empty.toFixed(4));
      check(`${s.deg}° solid inside the radius`, s.solid > 0.75 * box, s.solid.toFixed(4));
    }
    if (which === 'straight') {
      const expect = filletWedgeArea(radius) * (STRAIGHT + ARC);
      const ratio = info.removed / expect;
      check(
        `volume ${info.removed.toFixed(1)} vs section×edge ${expect.toFixed(1)}`,
        ratio > 0.85 && ratio < 1.1,
        `ratio ${ratio.toFixed(3)}`,
      );
    }
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall checks passed');
