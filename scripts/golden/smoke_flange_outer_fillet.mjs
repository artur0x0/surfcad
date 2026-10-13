#!/usr/bin/env node
/**
 * Outer corner of a bent flange.
 *
 * The straight on the flange and the outer bend arc are one convex edge.
 * They meet at the tangent plane and do not share a vertex index, so the
 * cutter used to stop on that plane: the flat was rounded and the bend,
 * including the thickness along it, stayed sharp. A sheet fillet now
 * spans that whole edge. Probes along the straight and the arc, and
 * through the thickness, are empty in the wedge and solid inside the
 * radius. The base the arc becomes tangent to stays sharp.
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

const T = 3.175;
const BEND_R = 3.81;
const RO = T + BEND_R;
const R = 3;
const AXIS_Y = 30;
const AXIS_Z = T + BEND_R;
const STRAIGHT = 28.2;
const ARC = (Math.PI / 2) * RO;

const SRC = `
const spec = {"v":1,"sku":"SST316-125","t":3.175,"r":3.81,"k":0.38,"plane":"XY","width":100,"height":60,"bends":[{"id":"b1","panel":"base","edge":"v+","angle":90,"length":28.2,"flip":false}],"tabs":[],"holes":[]};
const sheet = sheetMetalSolid(spec);
const pre = sheet.volume();
const edgeLen = (e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
const mid = (e) => [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
const conv = convexEdges(sheet);
function outerStraight(sign) {
  return conv.find((e) => {
    const m = mid(e);
    return Math.abs(m[0] - sign * 50) < 0.3 && m[1] > 36.5 && edgeLen(e) > 20 && Math.abs(e.tangent[2]) > 0.9;
  });
}
function firstArc(sign, straight) {
  const end = straight.va[2] < straight.vb[2] ? straight.va : straight.vb;
  return conv.find((e) => {
    const m = mid(e);
    if (Math.abs(m[0] - sign * 50) > 0.3 || m[1] < 36) return false;
    if (edgeLen(e) > 2 || edgeLen(e) < 0.2) return false;
    const da = Math.hypot(e.va[0] - end[0], e.va[1] - end[1], e.va[2] - end[2]);
    const db = Math.hypot(e.vb[0] - end[0], e.vb[1] - end[1], e.vb[2] - end[2]);
    return Math.min(da, db) < 0.05;
  });
}
const right = outerStraight(1);
const left = outerStraight(-1);
if (!right || !left) throw new Error('outer straights missing');
const arc = firstArc(1, right);
if (!arc) throw new Error('outer arc chord missing');
const joined = makeSweepPath([right, arc]);
let part = sheet;
for (const e of [right, left]) {
  part = filletAlongPath(part, makeSweepPath([e]), ${R});
}
const probe = (solid, c, s) => Manifold.intersection(solid, Manifold.cube(s, true).translate(c)).volume();
globalThis.__flange = {
  pre,
  removed: pre - part.volume(),
  joined: joined.length,
  joinedN: joined.points.length,
};
globalThis.__probe = probe;
globalThis.__part = part;
return part;
`;

console.log('flange outer corner');
const run = await runScript(SRC);
check('fillet runs', run.status === 'NoError' && !run.featureSkip, run.status || run.error || '');
const info = globalThis.__flange;
const part = globalThis.__part;
const probe = globalThis.__probe;
if (!info || !part || !probe) {
  check('report', false, 'missing fillet result');
} else {
  const fullLen = STRAIGHT + ARC;
  const expect = 2 * filletWedgeArea(R) * fullLen;
  const ratio = info.removed / expect;
  check(
    `volume ${info.removed.toFixed(2)} vs section×full edge ${expect.toFixed(2)}`,
    ratio > 0.9 && ratio < 1.1,
    `ratio ${ratio.toFixed(3)} joinedPath ${info.joined.toFixed(2)}`,
  );
  check(
    'straight and arc stay one chain',
    info.joined > STRAIGHT + 0.5 && info.joinedN >= 3,
    `len ${info.joined.toFixed(2)} pts ${info.joinedN}`,
  );

  const cube = 0.28;
  const box = cube * cube * cube;
  const bis = (n) => {
    const x = -1;
    const y = -n[1];
    const z = -n[2];
    const L = Math.hypot(x, y, z) || 1;
    return [x / L, y / L, z / L];
  };
  const stations = [];
  for (const z of [32, 20, 10]) {
    stations.push({
      name: `straight z=${z}`,
      p: [50, AXIS_Y + RO, z],
      n: [0, 1, 0],
    });
  }
  for (const deg of [20, 45, 70]) {
    const a = (deg * Math.PI) / 180;
    const y = AXIS_Y + RO * Math.cos(a);
    const z = AXIS_Z - RO * Math.sin(a);
    stations.push({
      name: `bend ${deg}°`,
      p: [50, y, z],
      n: [0, Math.cos(a), -Math.sin(a)],
    });
  }
  for (const s of stations) {
    const b = bis(s.n);
    const at = (dist) => [
      s.p[0] + b[0] * dist,
      s.p[1] + b[1] * dist,
      s.p[2] + b[2] * dist,
    ];
    const depth = [
      s.p[0] - 0.35,
      s.p[1] - s.n[1] * 1.3,
      s.p[2] - s.n[2] * 1.3,
    ];
    const empty = probe(part, at(0.45), [cube, cube, cube]);
    const solid = probe(part, at(2.0), [cube, cube, cube]);
    const through = probe(part, depth, [cube, cube, cube]);
    check(`${s.name} empty in the wedge`, empty < 0.05 * box, empty.toFixed(4));
    check(`${s.name} solid inside the radius`, solid > 0.85 * box, solid.toFixed(4));
    check(`${s.name} round reaches through the thickness`, through < 0.05 * box, through.toFixed(4));
  }

  const base = probe(part, [49.7, 10, 0.3], [cube, cube, cube]);
  check('base edge past the bend stays sharp', base > 0.85 * box, base.toFixed(4));
  const inner = probe(part, [49.55, 34.15, 20], [cube, cube, cube]);
  check('inner skin stays solid', inner > 0.85 * box, inner.toFixed(4));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall checks passed');
