#!/usr/bin/env node
/**
 * Artur playtest — concave variable-profile fillet after multi-face hollow
 * and draft. Fixture is the exact script (selEdges2 points verbatim).
 *
 * The last call is filletAlongPath(..., 4.44, { variableProfile: true }) on
 * the inner corner where the hollow offset of the r=4 fillet (r≈1.5, arc
 * ≈2.4 mm) meets the inner ceiling and the inner +Y wall.
 *
 * The 1.2 mm path floor used to drop that quarter, including the tangency
 * vertex where the arc meets the vertical wall. The sweep then chorded
 * across the corner (≈60° frame jump) and left the shell edge: an ~87°
 * crease where the round meets the ceiling, and a seam on the wall because
 * the centerline was off the wall. This is not an end cap — the 90° edges
 * stay on the open rims (y≈-15, z≈-10).
 *
 * thinSweepPathPoints puts a dropped circular run back at ~15° steps when
 * thinning itself created the kink, so densifySweepArcTurns can refit it to
 * the ≤5° lattice. FILLET_ARC_SEGMENTS stays 24. SWEEP_PATH_MIN_SEG stays
 * 1.2. Same-radius semi-arc split is unchanged (this arc is r≈1.5 ≠ 4.44).
 *
 * Interior tangency, measured on the rebuilt mesh: the fillet meets the
 * inner ceiling and the inner back wall at 2.31° (one 24-segment facet is
 * 3.75°; half of that is 1.875°). A small opposite-wound triangle on the
 * side wall folds the same 2.31° (dihedral 177.69°). Assert the acute fold.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assembleSweepPath, SWEEP_PATH_MIN_SEG } from '../../src/utils/edgeSweepPath.js';
import { FILLET_ARC_SEGMENTS } from '../../src/utils/filletAlongPath.js';
import { FRAME_DENSIFY_MAX_TURN_DEG } from '../../src/utils/edgeTangencyField.js';
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
const full = readFileSync(join(here, 'fixtures', 'playtest_concave_fillet_tangency.txt'), 'utf8');

check('fixture is the playtest script', /filletAlongPath\(part, path2, 4\.44, \{ variableProfile: true \}\)/.test(full));
check('FILLET_ARC_SEGMENTS is 24', FILLET_ARC_SEGMENTS === 24, `segs=${FILLET_ARC_SEGMENTS}`);
check('frame turn limit is 5°', FRAME_DENSIFY_MAX_TURN_DEG === 5, `deg=${FRAME_DENSIFY_MAX_TURN_DEG}`);
check('path floor stays 1.2 mm', Math.abs(SWEEP_PATH_MIN_SEG - 1.2) < 1e-9, `min=${SWEEP_PATH_MIN_SEG}`);

const selStart = full.indexOf('const selEdges2 = ');
const selEnd = full.indexOf(';', selStart);
const selEdges2 = (0, eval)(full.slice(selStart + 'const selEdges2 = '.length, selEnd));
const path2 = assembleSweepPath(selEdges2);
check('makeSweepPath mirror accepts selEdges2', path2.ok === true, path2.message || '');
const pts = path2.ok ? path2.value.points : [];
const hasArcEnd = pts.some((p) => (
  Math.abs(p[0] - 17.500006) < 1e-3
  && Math.abs(p[1] - 12.500006) < 1e-3
  && Math.abs(p[2] - 6.048211) < 1e-3
));
check(
  'thinned path keeps the arc tangency vertex',
  hasArcEnd && pts.length >= 7,
  `n=${pts.length} pts=${pts.map((p) => p.map((x) => x.toFixed(3)).join(',')).join(' | ')}`,
);

function axisFlat(n) {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (az > 0.999 && ax < 0.02 && ay < 0.02) return 'z';
  if (ay > 0.999 && ax < 0.02 && az < 0.02) return 'y';
  if (ax > 0.999 && ay < 0.02 && az < 0.02) return 'x';
  return null;
}

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
    const nL = Math.hypot(cr[0], cr[1], cr[2]) || 1;
    const area = 0.5 * nL;
    const L = Math.max(
      Math.hypot(ab[0], ab[1], ab[2]),
      Math.hypot(ac[0], ac[1], ac[2]),
      Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]),
    );
    const asp = L > 1e-12 ? area / (L * L) : 0;
    if (area < 1e-8) tiny++;
    if ((area < 1e-6 || asp < 1e-4) && L > 1) fins++;
    tris.push({
      ia, ib, ic, area,
      n: [cr[0] / nL, cr[1] / nL, cr[2] / nL],
      cen: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  const emap = new Map();
  const ek = (i, j) => (i < j ? `${i},${j}` : `${j},${i}`);
  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    for (const [i, j] of [[tri.ia, tri.ib], [tri.ib, tri.ic], [tri.ic, tri.ia]]) {
      const k = ek(i, j);
      if (!emap.has(k)) emap.set(k, { i, j, ids: [] });
      emap.get(k).ids.push(ti);
    }
  }
  const buckets = {
    ceiling: [],
    back: [],
    side: [],
    opening: [],
  };
  const seen = { ceiling: new Set(), back: new Set(), side: new Set() };
  const span = { ceiling: 0, back: 0, side: 0 };
  let crease = 0;
  let creaseMax = 0;
  for (const { i: vi, j: vj, ids } of emap.values()) {
    const pa = V[vi];
    const pb = V[vj];
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const edgeLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = tris[ids[i]];
        const B = tris[ids[j]];
        if (A.area < 0.02 || B.area < 0.02) continue;
        const fa = axisFlat(A.n);
        const fb = axisFlat(B.n);
        if (!fa && !fb) continue;
        if (fa && fb && fa === fb) continue;
        const flat = fa ? A : B;
        const other = fa ? B : A;
        const axis = fa || fb;
        if (mid[0] < 12.2 || mid[0] > 18.2) continue;
        if (mid[1] < -15.3 || mid[1] > 13.2) continue;
        if (mid[2] < -10.3 || mid[2] > 8.0) continue;
        const dot = Math.min(1, Math.max(-1,
          A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2]));
        const ang = Math.acos(dot) * 180 / Math.PI;
        const acute = Math.min(ang, 180 - ang);
        const rec = { acute, ang, mid, edgeLen, flatN: flat.n, otherN: other.n };
        const opening = mid[1] < -14.5 || mid[2] < -9.5;
        if (opening) {
          buckets.opening.push(rec);
          continue;
        }
        let kind = null;
        if (axis === 'z' && Math.abs(mid[2] - 7.5) < 0.4) kind = 'ceiling';
        else if (axis === 'y' && Math.abs(mid[1] - 12.5) < 0.4) kind = 'back';
        else if (axis === 'x' && Math.abs(mid[0] - 17.5) < 0.4) kind = 'side';
        if (!kind) continue;
        const ekid = `${vi},${vj}`;
        if (!seen[kind].has(ekid)) {
          seen[kind].add(ekid);
          span[kind] += edgeLen;
          buckets[kind].push(rec);
        }
        if (acute >= 8) {
          crease++;
          if (acute > creaseMax) creaseMax = acute;
        }
      }
    }
  }
  const maxOf = (list) => list.reduce((m, r) => Math.max(m, r.acute), 0);
  const longest = (list) => list.reduce((m, r) => (r.edgeLen > (m?.edgeLen || 0) ? r : m), null);
  const ceilL = longest(buckets.ceiling);
  const backL = longest(buckets.back);
  const sideL = longest(buckets.side);
  return {
    nTri: mesh.triVerts.length / 3,
    tiny,
    fins,
    dirty: isFilletSliverDirty(tiny, mesh.triVerts.length / 3),
    ceilingN: buckets.ceiling.length,
    ceilingMax: maxOf(buckets.ceiling),
    ceilingLen: ceilL?.edgeLen || 0,
    ceilingSpan: span.ceiling,
    backN: buckets.back.length,
    backMax: maxOf(buckets.back),
    backLen: backL?.edgeLen || 0,
    backSpan: span.back,
    sideN: buckets.side.length,
    sideMax: maxOf(buckets.side),
    sideLen: sideL?.edgeLen || 0,
    sideSpan: span.side,
    openingN: buckets.opening.length,
    crease,
    creaseMax,
  };
}

console.log('concave fillet tangency after hollow + draft');

globalThis.__filletVariableProfileMeta = null;
let got = null;
try {
  const p = await exec(full);
  got = { vol: p.volume, status: p.status, ...analyze(p.mesh) };
  const meta = globalThis.__filletVariableProfileMeta;
  got.jump = meta?.maxFrameJumpDeg;
  got.frames = meta?.frameCount;
  got.thetaMin = meta?.thetaMinDeg;
  got.thetaMax = meta?.thetaMaxDeg;
  console.log(
    `      vol=${got.vol.toFixed(3)} tris=${got.nTri} fins=${got.fins} tiny=${got.tiny} `
    + `jump=${got.jump?.toFixed?.(2)} frames=${got.frames} theta=${got.thetaMin?.toFixed?.(1)}/${got.thetaMax?.toFixed?.(1)} `
    + `ceil=${got.ceilingN}/${got.ceilingMax.toFixed(2)}°/${got.ceilingLen.toFixed(1)}mm `
    + `back=${got.backN}/${got.backMax.toFixed(2)}°/${got.backLen.toFixed(1)}mm/span ${got.backSpan.toFixed(1)} `
    + `side=${got.sideN}/${got.sideMax.toFixed(2)}°/${got.sideLen.toFixed(1)}mm opening=${got.openingN} `
    + `crease=${got.crease} creaseMax=${got.creaseMax.toFixed(2)}`,
  );
} catch (e) {
  check('playtest script builds', false, e.message);
}

check('playtest script builds', !!got && got.status === 'NoError' && got.vol > 0, `status=${got?.status} vol=${got?.vol}`);
// Measured after the arc restore: 6812.022 (pre-fillet shell 6630.511); with
// the sweep's legs ending exactly on planar walls, 6810.190 (shell 6628.68).
check('volume stays on the restored fillet', got && Math.abs(got.vol - 6810.190) < 0.05, `vol=${got?.vol}`);
check(
  'frame jump stays inside the 5° lattice',
  got && Number.isFinite(got.jump) && got.jump <= 5,
  `jump=${got?.jump}`,
);
check('variable profile is a 90° inner corner', got && got.thetaMin > 85 && got.thetaMax < 95,
  `theta=${got?.thetaMin}/${got?.thetaMax}`);
// 24-seg quarter is 3.75°/facet. Measured interior fold against the ceiling
// and the back wall is 2.31°. Ceiling 3° leaves that facet and rejects the
// old ~87° crease.
check(
  'ceiling crease is gone (≤3°, measured 2.31°)',
  got && got.ceilingN >= 1 && got.ceilingLen > 10 && got.ceilingMax <= 3,
  `n=${got?.ceilingN} max=${got?.ceilingMax?.toFixed?.(2)} len=${got?.ceilingLen?.toFixed?.(1)}`,
);
check(
  'back-wall seam is gone (≤3°, measured 2.31°)',
  got && got.backN >= 1 && got.backSpan > 8 && got.backMax <= 3,
  `n=${got?.backN} max=${got?.backMax?.toFixed?.(2)} span=${got?.backSpan?.toFixed?.(1)}`,
);
check(
  'side-wall fold is the same facet (≤3° acute)',
  got && got.sideN >= 1 && got.sideMax <= 3,
  `n=${got?.sideN} max=${got?.sideMax?.toFixed?.(2)}`,
);
check(
  'no interior ≥8° crease against the inner shell',
  got && got.crease === 0,
  `crease=${got?.crease} max=${got?.creaseMax?.toFixed?.(2)}`,
);
check('not sliver-dirty', got && !got.dirty, `tiny=${got?.tiny}/${got?.nTri}`);

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll concave-fillet tangency checks passed.');
