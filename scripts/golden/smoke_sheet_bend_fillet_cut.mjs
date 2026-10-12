#!/usr/bin/env node
/**
 * Three bend-adjacent failures on a 100×60 SST316 bracket (bend b1, v+, 90°,
 * flange 28.2).
 *
 * 1. An inside corner sitting on the flat/bend boundary used to be split into
 *    a convex cutter and a concave filler, leaving a sheared sliver. It is
 *    one filler, flush with the sheet thickness.
 * 2. A contour cut drawn on the inner flange face and extruded 10 mm into the
 *    wall stopped on that plane. The bend arc sits on the other side, so a
 *    skin remained. A sheet subtract now spans both ways past the arc.
 * 3. A cutout corner that runs up through the bend into the flange solved
 *    with no error and stayed sharp, because end knots bound a neighbouring
 *    seam and the wedge was subtracted. The corner rounds, and nothing is
 *    left outside the bend.
 */
import { composeContourExtrude } from '../../src/utils/contourMode.js';
import { composeSheetMetalCommit } from '../../src/utils/sheetMetal/sheetMetalScript.js';
import { loadSandbox } from './scs_sandbox.mjs';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const SPEC = {
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

const { exec } = await loadSandbox();

const FILLET = `
const t = 3.175;
const radius = 3;
const spec = {
  v: 1, sku: 'SST316-125', t, r: 3.81, k: 0.38, plane: 'XY',
  width: 100, height: 60,
  bends: [{ id: 'b1', panel: 'base', edge: 'v+', angle: 90, length: 28.2, flip: false }],
  tabs: [], holes: [],
};
const sheet = sheetMetalSolid(spec);
const mid = (e) => [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
const elen = (e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
const snap = (e) => ({
  a: e.a, b: e.b, va: e.va.slice(), vb: e.vb.slice(),
  tangent: e.tangent.slice(), length: elen(e),
});
function filletAll(solid, pred) {
  const edges = concaveEdges(solid).filter(pred).map(snap);
  const errors = [];
  let added = 0;
  for (const e of edges) {
    const before = solid.volume();
    try {
      solid = filletAlongPath(solid, makeSweepPath([e]), radius);
      added += solid.volume() - before;
    } catch (err) {
      errors.push(String(err && err.message || err));
    }
  }
  return { solid, added, n: edges.length, errors };
}
function probe(solid, center, size) {
  return Manifold.intersection(solid, Manifold.cube(size, true).translate(center)).volume();
}
function proudCount(solid) {
  const mesh = solid.getMesh();
  const vp = mesh.vertProperties;
  const np = mesh.numProp || 3;
  let n = 0;
  for (let i = 0; i < vp.length / np; i++) {
    const x = vp[i * np], y = vp[i * np + 1], z = vp[i * np + 2];
    if (Math.abs(x) < 22 && y > 24 && y < 30.4 && (z > t + 0.08 || z < -0.08)) n++;
  }
  return n;
}

// Corner on the flat/bend boundary (y = 30).
const onBend = sheet.subtract(Manifold.cube([36, 20, t + 8], true).translate([0, 20, t / 2]));
const volOn = onBend.volume();
const bent = filletAll(onBend, (e) => Math.abs(e.tangent[2]) > 0.85 && mid(e)[1] > 28);
const bendBox = [50, 14, 16];
const bendAt = [0, 33, 6];
const extraOn = probe(bent.solid, bendAt, bendBox) - probe(sheet, bendAt, bendBox);

// Corner running through the bend into the flange.
const crossed = sheet.subtract(Manifold.cube([36, 30, t + 8], true).translate([0, 19, t / 2]));
const leftSharp = () => concaveEdges(crossed).filter((e) => (
  Math.abs(e.tangent[2]) > 0.8 && mid(e)[0] < -10 && mid(e)[1] > 30 && elen(e) > 4
));
const sharpBefore = leftSharp().length;
const through = filletAll(crossed, (e) => Math.abs(e.tangent[2]) > 0.8 && mid(e)[0] < -10 && mid(e)[1] > 30);
const sharpAfter = concaveEdges(through.solid).filter((e) => (
  Math.abs(e.tangent[2]) > 0.8 && mid(e)[0] < -10 && mid(e)[1] > 30 && elen(e) > 4
)).length;
const outside = probe(through.solid, [-18, 34.35, 0.85], [1.2, 0.7, 0.8]);
const round = probe(through.solid, [-17.3, 33.3, 4.2], [0.6, 0.6, 1.2]);

globalThis.__bend = {
  onN: bent.n,
  onAdded: bent.added,
  onErr: bent.errors,
  proud: proudCount(bent.solid),
  extraOn,
  sharpBefore,
  throughN: through.n,
  throughAdded: through.added,
  throughErr: through.errors,
  sharpAfter,
  outside,
  round,
  volOn,
};
return bent.solid;
`;

console.log('sheet bend — corner on the boundary, corner through the bend, cut across the arc');
let fillet;
try {
  fillet = await exec(FILLET);
} catch (e) {
  fillet = { error: e.message };
}
const info = globalThis.__bend;
check('fillets build', !fillet.error && fillet.status === 'NoError', fillet.error || fillet.status || '');
if (info) {
  const one = 3 * 3 * (1 - Math.PI / 4) * 3.175;
  check('both corners on the bend boundary fillet', info.onN === 2 && info.onErr.length === 0,
    `n=${info.onN} err=${info.onErr.join('; ')}`);
  check('boundary fillet adds the two rounds', info.onAdded > one * 1.7 && info.onAdded < one * 2.4,
    `added=${info.onAdded.toFixed(3)} one=${one.toFixed(3)}`);
  check('boundary fillet stays inside the sheet faces', info.proud === 0, `proud=${info.proud}`);
  check('boundary fillet leaves no sliver on the bend', info.extraOn < 0.2,
    `extra=${info.extraOn.toFixed(3)}`);
  check('flange corner was a long sharp edge', info.sharpBefore === 1, `before=${info.sharpBefore}`);
  check('flange corner fillets without error', info.throughN === 1 && info.throughErr.length === 0,
    `n=${info.throughN} err=${info.throughErr.join('; ')}`);
  check('flange corner gains the round instead of losing metal', info.throughAdded > 8 && info.throughAdded < 30,
    `added=${info.throughAdded.toFixed(3)}`);
  check('flange corner is no longer a sharp edge', info.sharpAfter === 0, `after=${info.sharpAfter}`);
  check('flange round sits in the corner', info.round > 0.1, `round=${info.round.toFixed(4)}`);
  check('flange fillet does not stick out of the bend', info.outside < 0.05,
    `outside=${info.outside.toFixed(4)}`);
} else if (!fillet.error) {
  check('fillet report', false, 'missing __bend');
}

const cz = 21.085;
const sheet = composeSheetMetalCommit('', SPEC);
check('sheet script', sheet.ok, sheet.message || '');
const cut = sheet.ok ? composeContourExtrude(sheet.buffer, {
  face: {
    type: 'planar',
    center: [0, 33.81, cz],
    normal: [0, -1, 0],
    planeFrame: {
      center: [0, 33.81, cz],
      normal: [0, -1, 0],
      x: [1, 0, 0],
      y: [0, 0, 1],
    },
  },
  tool: 'polyline',
  params: {
    points: [
      [-8, 30 - cz],
      [8, 30 - cz],
      [8, 10 - cz],
      [3, 10 - cz],
      [3, -1 - cz],
      [-8, -1 - cz],
    ],
  },
  extrude: { distance: 10, direction: 'normal', sense: 'negative' },
  combine: 'subtract',
}) : { ok: false, message: 'no sheet' };
check('cut composes', cut.ok, cut.message || '');
if (cut.ok) {
  check('cut spans both ways past the bend',
    /makeExtrude\(c1\.contours, 20\)/.test(cut.buffer) && /\[0, 0, -10\]/.test(cut.buffer),
    cut.buffer.slice(cut.buffer.indexOf('makeExtrude'), cut.buffer.indexOf('makeExtrude') + 120));
}

const CUT = `${cut.ok ? cut.buffer.replace(/return part;\s*$/, '') : 'throw new Error("no cut");'}
function probe(solid, center, size) {
  return Manifold.intersection(solid, Manifold.cube(size, true).translate(center)).volume();
}
const skin = probe(part, [-4, 33.1, 4.2], [6, 1.2, 2.2]);
const kept = probe(part, [20, 33.1, 4.2], [6, 1.2, 2.2]);
const opened = probe(part, [0, 35.4, 20], [6, 2, 6]);
globalThis.__cutInfo = { skin, kept, opened, vol: part.volume() };
return part;
`;

let cutRes;
try {
  cutRes = cut.ok ? await exec(CUT) : { error: 'compose failed' };
} catch (e) {
  cutRes = { error: e.message };
}
const cutInfo = globalThis.__cutInfo;
check('cut builds', !cutRes.error && cutRes.status === 'NoError', cutRes.error || cutRes.status || '');
if (cutInfo) {
  check('cut clears the bend skin', cutInfo.skin < 0.05, `skin=${cutInfo.skin.toFixed(3)}`);
  check('cut leaves the bend outside the profile', cutInfo.kept > 5, `kept=${cutInfo.kept.toFixed(3)}`);
  check('cut goes through the flange', cutInfo.opened < 0.05, `opened=${cutInfo.opened.toFixed(3)}`);
  check('cut leaves a part', cutInfo.vol > 10000, `vol=${cutInfo.vol.toFixed(1)}`);
} else if (!cutRes.error) {
  check('cut report', false, 'missing __cutInfo');
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll sheet-bend fillet and cut checks passed');
