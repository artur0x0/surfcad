#!/usr/bin/env node
/**
 * Inside corners of a rectangular cutout on a bent sheet.
 *
 * The concave filler is padded past both ends so its cap is not coplanar
 * with the skin, then the whole solid used to be clipped to the part bbox.
 * A flange makes that box taller than the base and wider than a wall, so
 * the pad stayed proud of the local face (the white sliver). The filler is
 * now cut back to each exterior skin before the union.
 *
 * Geometry only — not a screenshot — so there is no 390 / 1280 pass.
 */
import { loadSandbox } from './scs_sandbox.mjs';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const { exec } = await loadSandbox();

const SCRIPT = `
const t = 2;
const radius = 2;
const spec = {
  v: 1, sku: 'TEST', t, r: 1, k: 0.4, plane: 'XY',
  width: 80, height: 50,
  bends: [{ id: 'b1', panel: 'base', edge: 'v+', angle: 90, length: 20, flip: false }],
  tabs: [], holes: [],
};
let part = sheetMetalSolid(spec);
const bb0 = part.boundingBox();
const yOuter = bb0.max[1];
const yInner = yOuter - t;
const baseHole = Manifold.cube([16, 12, t + 4], true).translate([0, 0, t / 2]);
// Up the flange, clear of the bend. A cutout near the bend can hand a
// corner a skin normal, and the fillet then has no frame.
const wallZ = 16;
const wallX = 0;
const wallHole = Manifold.cube([10, t + 4, 6], true).translate([wallX, (yOuter + yInner) / 2, wallZ]);
part = part.subtract(baseHole).subtract(wallHole);
const mid = (e) => [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
const snap = (e) => ({
  a: e.a, b: e.b,
  va: e.va.slice(), vb: e.vb.slice(),
  tangent: e.tangent.slice(),
  length: e.length,
});
const cc = concaveEdges(part);
const baseEdges = cc.filter((e) => {
  const m = mid(e);
  return Math.abs(e.tangent[2]) > 0.9
    && Math.abs(m[0]) <= 8.6 && Math.abs(m[1]) <= 6.6
    && m[2] > -0.3 && m[2] < t + 0.3;
}).map(snap);
const wallEdges = cc.filter((e) => {
  const m = mid(e);
  return Math.abs(e.tangent[1]) > 0.9
    && Math.abs(m[0] - wallX) <= 5.6
    && m[2] > wallZ - 3.6 && m[2] < wallZ + 3.6
    && m[1] > yInner - 0.6 && m[1] < yOuter + 0.6;
}).map(snap);
const vertsOf = (solid) => {
  const mesh = solid.getMesh();
  const vp = mesh.vertProperties;
  const np = mesh.numProp || 3;
  const out = [];
  for (let i = 0; i < vp.length / np; i++) out.push([vp[i * np], vp[i * np + 1], vp[i * np + 2]]);
  return out;
};
const spanOf = (verts, origin, axis, perpMax) => {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const p of verts) {
    const dx = p[0] - origin[0];
    const dy = p[1] - origin[1];
    const dz = p[2] - origin[2];
    const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
    const px = dx - along * axis[0];
    const py = dy - along * axis[1];
    const pz = dz - along * axis[2];
    if (Math.hypot(px, py, pz) > perpMax) continue;
    n++;
    if (along < lo) lo = along;
    if (along > hi) hi = along;
  }
  return { n, min: lo, max: hi, thick: hi - lo };
};
const axisOf = (e) => {
  const d = [e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / L, d[1] / L, d[2] / L];
};
const preVerts = vertsOf(part);
const preVol = part.volume();
const pre = [...baseEdges, ...wallEdges].map((e) => spanOf(preVerts, e.va, axisOf(e), radius + 1));
globalThis.__cutout = {
  t, yOuter, yInner, wallZ,
  bb0: { min: [bb0.min[0], bb0.min[1], bb0.min[2]], max: [bb0.max[0], bb0.max[1], bb0.max[2]] },
  baseN: baseEdges.length,
  wallN: wallEdges.length,
  pre,
  sample: cc.slice(0, 8).map((e) => ({ m: mid(e), tan: e.tangent, a: e.a, b: e.b })),
};
for (const e of [...baseEdges, ...wallEdges]) {
  part = filletAlongPath(part, makeSweepPath([e]), radius);
}
const postVerts = vertsOf(part);
const post = [...baseEdges, ...wallEdges].map((e) => spanOf(postVerts, e.va, axisOf(e), radius + 1));
globalThis.__cutout = {
  t,
  yOuter, yInner, wallZ,
  bb0: { min: [bb0.min[0], bb0.min[1], bb0.min[2]], max: [bb0.max[0], bb0.max[1], bb0.max[2]] },
  baseN: baseEdges.length,
  wallN: wallEdges.length,
  added: part.volume() - preVol,
  pre, post,
  sample: cc.slice(0, 6).map((e) => ({ m: mid(e), tan: e.tangent })),
};
return part;
`;

console.log('sheet cutout fillet — corner thickness matches the sheet');
let r;
try {
  r = await exec(SCRIPT);
} catch (e) {
  r = { error: e.message };
}
const info = globalThis.__cutout;
check('fillet builds', !r.error && r.status === 'NoError', r.error || r.status || '');
if (info) {
  console.log(`      base ${info.baseN} wall ${info.wallN} added ${info.added?.toFixed?.(3)} bbox ${JSON.stringify(info.bb0)}`);
  check('four inside corners on the base', info.baseN === 4, `base=${info.baseN} sample=${JSON.stringify(info.sample)}`);
  check('four inside corners on the flange wall', info.wallN === 4, `wall=${info.wallN}`);
  const exact = 8 * radiusArea(2) * info.t;
  check('fillet adds the eight rounds', info.added > exact * 0.85 && info.added < exact * 1.15,
    `added=${info.added?.toFixed?.(3)} exact=${exact.toFixed(3)}`);
  (info.post || []).forEach((span, i) => {
    const before = info.pre[i];
    const where = i < info.baseN ? `base ${i}` : `wall ${i - info.baseN}`;
    const thickOk = Math.abs(span.thick - info.t) <= 0.02 && Math.abs(span.thick - before.thick) <= 0.02;
    const inside = span.min >= before.min - 0.02 && span.max <= before.max + 0.02;
    check(`${where} corner thickness equals the sheet`, thickOk && span.n > 0,
      `post=${span.thick?.toFixed?.(4)} pre=${before.thick?.toFixed?.(4)} t=${info.t} n=${span.n}`);
    check(`${where} has no geometry outside the sheet faces`, inside,
      `post=[${span.min?.toFixed?.(4)}, ${span.max?.toFixed?.(4)}] pre=[${before.min?.toFixed?.(4)}, ${before.max?.toFixed?.(4)}]`);
  });
} else if (!r.error) {
  check('measurement report', false, 'missing __cutout');
}

function radiusArea(radius) {
  return radius * radius * (1 - Math.PI / 4);
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll sheet-cutout fillet checks passed');
