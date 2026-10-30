#!/usr/bin/env node
/**
 * Artur playtest — fillet AFTER hollow (r=1.75 on the open shell).
 *
 * Fixture `fixtures/artur_playtest_fillet_after_hollow.txt` is the exact
 * script: cube → straight fillet r=4 → variable-profile wrap r=4.83 →
 * hollow 2.5 open toward -Z → fillet r=1.75 on edgesBetween faces 2 and 31.
 *
 * That edge is the cavity's inner vertical corner (concave), not the wrap.
 * On #114 main the filler wedge stops on the open face, so its end cap is
 * coplanar with z=-10 and the sharp corner survives as a triangular fan in
 * the cavity (measured pie=14, pieArea≈0.51). r=1.75 < wall 2.5, so it is a
 * leftover fin, not a punch-through.
 *
 * #115: extend a concave end that leaves the pre-fillet bbox by the
 * cutter-expand pad, then clip. That removed the open-face fan.
 *
 * The inner end (z≈7.5, where the two walls meet the inner ceiling) sits
 * inside the bbox, so #115 left its cap coplanar with the ceiling: a shallow
 * lip, measured as 42 edges creased ≥8° (max 90°) along that junction.
 * Both concave ends are now padded the same way. Convex sweeps and shell
 * offset are unchanged.
 *
 * Asserts: open-face fan still gone, and no lip crease at the wall-ceiling
 * junction. The +X corner's interior stray triangle (a facet bridging the
 * inner r=1.5 cylinder and the outer r=4 fillet) must also stay 0.
 * Lattice-aligned wrap chords shifted that cavity edge's face id 34 → 35;
 * the #136 draft-tear kernel work shifted it again 35 → 31 (same edge:
 * mid [-17.5, -12.5, -1.25], length 17.5). selEdges2 is unchanged.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isFilletSliverDirty } from '../../src/utils/filletSliverGuard.js';

register('./manifold-resolve-hook.mjs', import.meta.url);

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'err'));
    else w.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

await import('../../src/workers/sandboxWorker.js');
await send('init');
const exec = async (s) =>
  (await send('execute', { script: s, importedModels: {}, memoryLimitMB: 512 })).payload;

const here = dirname(fileURLToPath(import.meta.url));
const full = readFileSync(join(here, 'fixtures', 'artur_playtest_fillet_after_hollow.txt'), 'utf8');
const hollowOnly = full.replace(
  /const selEdges3 = [\s\S]*return part;/,
  'return part;',
);

/** Inner corner of the cavity at the -X/-Y wall, open face at z=-10. */
const CORNER = [-17.5, -12.5];

function analyze(mesh) {
  const np = mesh.numProp || 3;
  const V = [];
  for (let i = 0; i < mesh.vertProperties.length / np; i++) {
    V.push([
      mesh.vertProperties[i * np],
      mesh.vertProperties[i * np + 1],
      mesh.vertProperties[i * np + 2],
    ]);
  }
  let tiny = 0;
  let fins = 0;
  let inwardVis = 0;
  let openCorner = 0;
  let sharpEdge = 0;
  let arcVerts = 0;
  const tris = [];
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    const ia = mesh.triVerts[t];
    const ib = mesh.triVerts[t + 1];
    const ic = mesh.triVerts[t + 2];
    const a = V[ia];
    const b = V[ib];
    const c = V[ic];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const nL = Math.hypot(...cr) || 1;
    const area = 0.5 * nL;
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const L = Math.max(
      Math.hypot(...ab),
      Math.hypot(...ac),
      Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]),
    );
    const asp = L > 1e-12 ? area / (L * L) : 0;
    if (area < 1e-8) tiny++;
    if ((area < 1e-6 || asp < 1e-4) && L > 1) fins++;
    const nd = (cr[0] * cen[0] + cr[1] * cen[1] + cr[2] * cen[2]) / nL / (Math.hypot(...cen) || 1);
    if (nd < -0.35 && area > 0.5) inwardVis++;
    tris.push({
      ia, ib, ic, a, b, c, area,
      n: [cr[0] / nL, cr[1] / nL, cr[2] / nL],
      cen,
    });
  }
  for (const p of V) {
    const onCorner = Math.abs(p[0] - CORNER[0]) < 0.12 && Math.abs(p[1] - CORNER[1]) < 0.12;
    if (onCorner && Math.abs(p[2] + 10) < 0.2) openCorner++;
    if (onCorner && p[2] > -9.5 && p[2] < 7.0) sharpEdge++;
    // Quarter-round of the concave fillet: center inset r along both inner walls.
    const cx = CORNER[0] + 1.75;
    const cy = CORNER[1] + 1.75;
    const d = Math.hypot(p[0] - cx, p[1] - cy);
    // The whole height, rims included: once the cavity walls are single planes
    // the arc strip needs no row between its two ends (24 segments → 50 verts).
    if (Math.abs(d - 1.75) < 0.2 && p[2] > -10.01 && p[2] < 7.51 && p[0] < -15.5 && p[1] < -10.5) arcVerts++;
  }
  // Triangular fan on the open face: a triangle in the z=-10 plane that still
  // touches the sharp inner corner and reaches into the cavity.
  let pie = 0;
  let pieArea = 0;
  for (const t of tris) {
    const pts = [t.a, t.b, t.c];
    if (!pts.every((p) => Math.abs(p[2] + 10) < 0.25)) continue;
    const sharp = pts.filter((p) => Math.abs(p[0] - CORNER[0]) < 0.12 && Math.abs(p[1] - CORNER[1]) < 0.12);
    if (!sharp.length) continue;
    const others = pts.filter((p) => sharp.indexOf(p) < 0);
    if (others.some((p) => p[0] > CORNER[0] + 0.05 && p[1] > CORNER[1] + 0.05)) {
      pie++;
      pieArea += t.area;
    }
  }
  // Lip: coplanar filler cap where the vertical fillet meets the inner ceiling
  // (wall-floor junction in the interior view). #115 main: 42 edges, max 90°.
  const emap = new Map();
  const ek = (i, j) => (i < j ? `${i},${j}` : `${j},${i}`);
  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    for (const [i, j] of [[tri.ia, tri.ib], [tri.ib, tri.ic], [tri.ic, tri.ia]]) {
      const k = ek(i, j);
      if (!emap.has(k)) emap.set(k, []);
      emap.get(k).push(ti);
    }
  }
  let lip = 0;
  let lipMax = 0;
  for (const ids of emap.values()) {
    if (ids.length !== 2) continue;
    const A = tris[ids[0]];
    const B = tris[ids[1]];
    if (A.area < 0.02 || B.area < 0.02) continue;
    const mid = [
      (A.cen[0] + B.cen[0]) / 2,
      (A.cen[1] + B.cen[1]) / 2,
      (A.cen[2] + B.cen[2]) / 2,
    ];
    if (mid[2] < 7.15 || mid[2] > 7.85) continue;
    if (mid[0] < -17.8 || mid[0] > -15.5 || mid[1] < -12.8 || mid[1] > -10.5) continue;
    const dot = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2];
    const d = Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
    if (d < 25) continue;
    lip++;
    if (d > lipMax) lipMax = d;
  }
  // Interior stray triangle at the +X/+Y r=4 fillet, seen from inside the
  // shell. The corner sweep used to sample that quarter at ~4.92° while the
  // horizontal fillet's rulings are every 3.75°, so a facet bridges the inner
  // offset cylinder (r=1.5) and the outer fillet (r=4) instead of stopping on
  // a shared ruling. #116 lip probe stays 0 on that mesh — this is not that bug.
  // Measured on #116 main: stray=5. After the lattice snap: stray=0.
  const AXIS = [11, 6];
  let stray = 0;
  for (const t of tris) {
    const pts = [t.a, t.b, t.c];
    const rs = pts.map((q) => Math.hypot(q[1] - AXIS[0], q[2] - AXIS[1]));
    const onIn = rs.some((r) => Math.abs(r - 1.5) < 0.25);
    const onOut = rs.some((r) => Math.abs(r - 4) < 0.25);
    if (!onIn || !onOut) continue;
    if (t.cen[0] < 12) continue;
    stray++;
  }
  const nTri = mesh.triVerts.length / 3;
  return {
    nTri,
    tiny,
    fins,
    inwardVis,
    openCorner,
    sharpEdge,
    arcVerts,
    pie,
    pieArea,
    lip,
    lipMax,
    stray,
    dirty: isFilletSliverDirty(tiny, nTri),
  };
}

console.log('Artur playtest — fillet after hollow (inner corner r=1.75)');

// Solid-body control: convex fillet must stay metrically the same (no pad).
{
  const solid = await exec(`
    let part = Manifold.cube([40, 30, 20], true);
    part = filletAlongPath(part, makeSweepPath(edgesBetween(part, 3, 5)), 4);
    return part;
  `);
  check('solid fillet still builds', solid.status === 'NoError' && solid.volume > 20000,
    `status=${solid.status} vol=${solid.volume}`);
  // Measured on #114 main (no open-end pad on a convex edge): 23862.313
  check('solid fillet volume unchanged', Math.abs(solid.volume - 23862.313) < 0.05,
    `vol=${solid.volume}`);
}

let hollow;
let got;
try {
  hollow = await exec(hollowOnly);
  check('hollow-only builds', hollow.status === 'NoError' && hollow.volume > 5000,
    `status=${hollow.status} vol=${hollow.volume}`);
} catch (e) {
  check('hollow-only builds', false, e.message);
}
try {
  const p = await exec(full);
  got = { vol: p.volume, bb: p.boundingBox, status: p.status, ...analyze(p.mesh) };
  console.log(
    `      fillet-after-hollow vol=${got.vol.toFixed(3)} tris=${got.nTri} fins=${got.fins} `
    + `inwardVis=${got.inwardVis} pie=${got.pie} pieArea=${got.pieArea.toFixed(4)} `
    + `openCorner=${got.openCorner} sharpEdge=${got.sharpEdge} arcVerts=${got.arcVerts} `
    + `lip=${got.lip} lipMax=${got.lipMax.toFixed(1)} stray=${got.stray}`,
  );
} catch (e) {
  check('fillet after hollow builds', false, e.message);
}

check('fillet after hollow builds', !!got && got.status === 'NoError' && got.vol > 0, `vol=${got?.vol}`);
const added = got && hollow ? got.vol - hollow.volume : NaN;
check(
  'fillet adds the inner round (not a punch-through)',
  got && hollow && added > 8 && added < 25,
  `added=${added} hollow=${hollow?.volume} final=${got?.vol}`,
);
check(
  'outer shell bbox still reaches the -X/-Y/-Z skin',
  got && got.bb.min[0] <= -19.9 && got.bb.min[1] <= -14.9 && got.bb.min[2] <= -9.99
    && got.bb.max[2] >= 9.9,
  JSON.stringify(got?.bb),
);
check('open-face inner corner fan is gone', got && got.pie === 0, `pie=${got?.pie} area=${got?.pieArea}`);
check(
  'wall-ceiling lip is gone',
  got && got.lip === 0,
  `lip=${got?.lip} lipMax=${got?.lipMax?.toFixed?.(1)}`,
);
check(
  'interior stray triangle at the r=4 corner is gone',
  got && got.stray === 0,
  `stray=${got?.stray}`,
);
check('sharp inner corner vertex is gone off the open rim', got && got.openCorner === 0 && got.sharpEdge === 0,
  `openCorner=${got?.openCorner} sharpEdge=${got?.sharpEdge}`);
check('concave fillet arc is present inside the cavity', got && got.arcVerts >= 8, `arcVerts=${got?.arcVerts}`);
check('not sliver-dirty', got && !got.dirty, `tiny=${got?.tiny}/${got?.nTri}`);
// Cavity walls point toward the origin, so a radial inward test is not zero on a
// shell. #115 open-end pad: 336 (ceiling 338). Inner-end pad retessellates
// those same cavity faces: measured 358. The #136/#154 kernels retessellate
// again: 360 inward-visible of 5432 tris (was 358 of 5710; fins 62 → 29).
// Exact offset planes (open-rim corners included) keep each cavity wall one
// plane, so the hollow boolean no longer fans it: 303 of 2996 tris.
// Not the lip (that probe is `lip`).
check('inward-visible count does not rise', got && got.inwardVis <= 303, `inwardVis=${got?.inwardVis}`);
// Pre-fix fins=39 (the fan). Open-end pad: 41. Quarter-arc lattice
// (3.75° instead of ~4.92°) adds zero-area slivers along the r=4 cylinder:
// measured fins=62. Not the interior stray triangle (that probe is `stray`).
check('long-fin count stays at the measured ceiling', got && got.fins <= 62, `fins=${got?.fins}`);

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll fillet-after-hollow checks passed.');
