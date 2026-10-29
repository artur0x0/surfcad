#!/usr/bin/env node
/**
 * Wrap fillet that finishes onto a 12° drafted face.
 *
 * A two-edge wrap used to stay one varying-profile tube through the 90°
 * corner. On the drafted face that shredded the mesh (~2300 tris) and left
 * the crease, so the drafted-wall contours broke into short fragments.
 * The 15° / 28° gates are not the fix. Corner split is.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BufferAttribute, BufferGeometry } from 'three';
import { buildCoherentEdges, buildFeatureEdges, edgePolyline } from '../../src/utils/selectEdge.js';
import { isFilletSliverDirty } from '../../src/utils/filletSliverGuard.js';

const __here = dirname(fileURLToPath(import.meta.url));
const readRepo = (rel) => readFileSync(join(__here, '../..', rel), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('wrap onto a drafted face — source pins');
{
  const w = readRepo('src/workers/sandboxWorker.js') + '\n' + readRepo('src/lib/surfcad/runtime.js');
  const field = readRepo('src/utils/edgeTangencyField.js');
  const fillet = readRepo('src/utils/filletAlongPath.js');
  check('varying-profile cutter splits runs at corners',
    /const splitRuns = \[\]/.test(w) && /_s23SplitRunsAtCorners\(\[run\.segs\]\)/.test(w));
  check('a rounded run extends only its back end',
    /_s23RunRounded\(segs\) \? \['end'\]/.test(w));
  check('FRAME_DENSIFY_MAX_TURN_DEG stays 5', /FRAME_DENSIFY_MAX_TURN_DEG = 5/.test(field));
  check('FILLET_ARC_SEGMENTS floor stays 24', /FILLET_ARC_SEGMENTS = 24/.test(fillet));
  check('coherent gate stays 15°', /minDeg = typeof opts\.minDeg === 'number' \? opts\.minDeg : 15/.test(
    readRepo('src/utils/selectEdge.js'),
  ));
}

register('./manifold-resolve-hook.mjs', import.meta.url);
const pending = new Map();
let msgId = 0;
globalThis.self = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'worker error'));
    else w.resolve(msg);
  },
};
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => globalThis.self.onmessage({ data: { type, payload, id } }));
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  try { return (await send('execute', { script, importedModels: {}, memoryLimitMB: 512 })).payload; }
  catch (e) { return { error: e.message }; }
}

function geometryFromMesh(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return geometry;
}

function polyLen(edge) {
  const pts = edgePolyline(edge);
  if (!pts || pts.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return L;
}

console.log('');
console.log('wrap onto a drafted face');
{
  const r = await exec(`
const box = Manifold.cube([40, 30, 20], true);
const drafted = draftFaces(
  box,
  facesByNormal(box, [1, 0, 0], 8),
  12,
  { pull: [0, 0, 1], reference: { center: [0, 0, -10], normal: [0, 0, 1] } },
);
const edges = convexEdges(drafted);
const edgeLen = (e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
const mid = (e) => [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
const yTop = edges.find((e) => {
  const m = mid(e);
  return edgeLen(e) > 20 && Math.abs(m[1] + 15) < 0.4 && Math.abs(m[2] - 10) < 0.4
    && Math.abs(e.va[2] - e.vb[2]) < 0.4;
});
const xTop = edges.find((e) => {
  const m = mid(e);
  return edgeLen(e) > 20 && m[0] > 14 && Math.abs(m[2] - 10) < 0.4
    && Math.abs(e.va[0] - e.vb[0]) < 0.8;
});
if (!yTop || !xTop) throw new Error('drafted wrap edges missing');
const out = filletAlongPath(drafted, makeSweepPath([yTop, xTop]), 3, { variableProfile: true });
const parts = out.decompose();
const mesh = out.getMesh();
const np = mesh.numProp || 3;
const vp = mesh.vertProperties;
let onCrease = 0;
for (let i = 0; i < vp.length / np; i++) {
  const x = vp[i * np];
  const y = vp[i * np + 1];
  const z = vp[i * np + 2];
  if (Math.abs(x - 15.75) < 0.2 && Math.abs(z - 10) < 0.2 && Math.abs(y) < 10) onCrease++;
}
let gapVol = -1;
let wallVol = -1;
try {
  gapVol = Manifold.intersection(out, Manifold.sphere(0.025, 6).translate([15.915, -14.92, 8.45])).volume();
  wallVol = Manifold.intersection(out, Manifold.sphere(0.025, 6).translate([15.78, -14.92, 7.4])).volume();
} catch (e) { /* recorded as -1 */ }
globalThis.__note = { n: parts.length, onCrease, base: drafted.volume(), out: out.volume(), gapVol, wallVol };
return out;`);
  check('wrap onto the drafted face succeeds', !r.error, r.error || '');
  const note = globalThis.__note;
  const meta = globalThis.__filletVariableProfileMeta;
  if (!r.error && note) {
    check('wrap stays one body', note.n === 1, `n=${note.n}`);
    const np = r.mesh.numProp || 3;
    const V = r.mesh.vertProperties;
    const T = r.mesh.triVerts;
    let tiny = 0;
    for (let ti = 0; ti < T.length / 3; ti++) {
      const i0 = T[ti * 3] * np;
      const i1 = T[ti * 3 + 1] * np;
      const i2 = T[ti * 3 + 2] * np;
      const ax = V[i1] - V[i0];
      const ay = V[i1 + 1] - V[i0 + 1];
      const az = V[i1 + 2] - V[i0 + 2];
      const bx = V[i2] - V[i0];
      const by = V[i2 + 1] - V[i0 + 1];
      const bz = V[i2 + 2] - V[i0 + 2];
      const area = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      if (area < 1e-8) tiny++;
    }
    // The drafted face keeps a denser boolean tessellation than an axis-aligned
    // cube (about 7000 tris at the 96-step arc; 2000 at the old 24). The shred
    // left the crease and broke the side contours; those are the gates above
    // and below. A blow-up past twice the measured count still fails this cap.
    check('wrap mesh is not scrap-sheet dirty',
      r.tris > 40 && r.tris < 14000 && !isFilletSliverDirty(tiny, r.tris),
      `tris=${r.tris} tiny=${tiny}`);
    check('no vertices left on the open drafted crease',
      note.onCrease === 0,
      `onCrease=${note.onCrease}`);
    const removed = note.base - note.out;
    check('wrap removes material along both legs',
      removed > 20 && removed < 400,
      `removed=${removed}`);
    check('corner split made two cutter runs',
      !!meta && meta.runCount === 2 && meta.singleRunCutter === false,
      meta ? JSON.stringify(meta) : 'meta missing');
    // r·tan(12°) is the profile clearance through the drafted plane (~0.64 at
    // r=3). The cutter must extend at least that far, pad included.
    check('cutter extends past the end on the drafted face',
      !!meta && meta.endExtend > 0.6 && meta.endExtend < 2 * 3 + 1.2,
      meta ? `endExtend=${meta.endExtend}` : 'meta missing');
    // This point sits past the old end plane, inside the front fillet's
    // profile, and still inside the drafted face. Without the extension it
    // stays solid. The wall below the fillet must stay solid.
    check('extended cutter covers that drafted-face end',
      note.gapVol >= 0 && note.gapVol < 1e-8,
      `gapVol=${note.gapVol}`);
    check('extension does not eat the wall below the fillet',
      note.wallVol > 1e-6,
      `wallVol=${note.wallVol}`);
    const chains = buildCoherentEdges(buildFeatureEdges(geometryFromMesh(r.mesh)));
    const sideLens = chains.map((e) => {
      const pts = edgePolyline(e) || [];
      if (!pts.length) return 0;
      const ys = pts.map((p) => p[1]);
      const y0 = ys[0];
      const alongSide = ys.every((y) => Math.abs(Math.abs(y) - 15) < 1.2) && Math.abs(Math.abs(y0) - 15) < 1.2;
      return alongSide ? polyLen(e) : 0;
    });
    const maxSide = sideLens.reduce((m, v) => Math.max(m, v), 0);
    check('drafted-wall side contour stays long', maxSide > 12, `maxSide=${maxSide.toFixed(2)} chains=${chains.length}`);
  }
}

if (failed) {
  console.log(`❌ fillet-wrap-draft golden FAILED (${failed} checks)`);
  process.exit(1);
}
console.log('fillet-wrap-draft golden passed');
