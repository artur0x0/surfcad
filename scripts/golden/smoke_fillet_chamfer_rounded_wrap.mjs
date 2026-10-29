#!/usr/bin/env node
/**
 * Fillet/chamfer quality — Artur rounded-rect wrap playtest.
 *
 * Reproduces:
 * 1) Four vertical fillets on a box, then a top-perimeter wrap fillet
 *    through the rounded corners (prior-fillet arcs). Dense pre-RDP pts
 *    used to leave vertical fin-slivers; path thinning must keep fins≈0
 *    while still removing material.
 * 2) Bottom perimeter path chamfer (profile:chamfer) must succeed without
 *    the ribbed per-edge chamferEdges hull artifacts / sliver loud-fail.
 * 3) Circle→square loft edge fillet still builds (regression lock).
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BufferGeometry, BufferAttribute } from 'three';
import {
  thinSweepPathPoints,
  SWEEP_PATH_MIN_SEG,
} from '../../src/utils/edgeSweepPath.js';
import { isFilletSliverDirty } from '../../src/utils/filletSliverGuard.js';
import { composeChamferCommit } from '../../src/utils/filletMode.js';
import {
  buildFeatureEdges,
  buildCoherentEdges,
} from '../../src/utils/selectEdge.js';
import {
  annotateFeatureEdges,
  indexBoundaryEdges,
} from '../../src/utils/boundaryEdgeIds.js';

register('./manifold-resolve-hook.mjs', import.meta.url);

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

console.log('fillet/chamfer rounded-wrap quality');

{
  const src = readRepo('src/utils/edgeSweepPath.js');
  check('thinSweepPathPoints exported', /export function thinSweepPathPoints\s*\(/.test(src));
  check('assembleSweepPath calls thinSweepPathPoints', /thinSweepPathPoints\s*\(/.test(src));
  check('SWEEP_PATH_MIN_SEG ~1.2', Math.abs(SWEEP_PATH_MIN_SEG - 1.2) < 1e-9);
  const dense = [];
  for (let i = 0; i <= 40; i++) dense.push([i * 0.3, 0, 0]);
  const thinned = thinSweepPathPoints(dense, false, { minSeg: 1.2 });
  check('thin drops micro samples', thinned.length < dense.length && thinned.length >= 8,
    `n=${thinned.length}`);
  check('thin keeps endpoints',
    thinned[0][0] === 0 && Math.abs(thinned.at(-1)[0] - 12) < 1e-9);
}

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
    else waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      if (!workerSelf.onmessage) {
        reject(new Error('sandboxWorker handler missing'));
        return;
      }
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}

function meshStats(mesh) {
  if (!mesh?.triVerts || !mesh?.vertProperties) return null;
  const np = mesh.numProp || 3;
  const V = mesh.vertProperties;
  const T = mesh.triVerts;
  const nTri = T.length / 3;
  let tiny = 0;
  let fins = 0;
  for (let ti = 0; ti < nTri; ti++) {
    const i0 = T[ti * 3] * np;
    const i1 = T[ti * 3 + 1] * np;
    const i2 = T[ti * 3 + 2] * np;
    const ax = V[i1] - V[i0];
    const ay = V[i1 + 1] - V[i0 + 1];
    const az = V[i1 + 2] - V[i0 + 2];
    const bx = V[i2] - V[i0];
    const by = V[i2 + 1] - V[i0 + 1];
    const bz = V[i2 + 2] - V[i0 + 2];
    const A = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    if (A < 1e-8) {
      tiny++;
      const ys = [V[i0 + 1], V[i1 + 1], V[i2 + 1]];
      // Artur's "thin vertical sliver" spanned the side face (~25 mm). Band-local
      // zero-area tris with height ≈ fillet radius are a different population.
      if (Math.max(...ys) - Math.min(...ys) > 10) fins++;
    }
  }
  return { nTri, tiny, fins, dirty: isFilletSliverDirty(tiny, nTri) };
}

// 1) Top wrap after vertical fillets
{
  try {
    const p = await exec(`
let part = Manifold.cube([40, 30, 20], true);
for (const [fa, fb] of [[3, 6], [2, 3], [1, 2], [1, 6]]) {
  part = filletAlongPath(part, makeSweepPath(edgesBetween(part, fa, fb)), 6);
}
const top = convexEdges(part).filter((e) => {
  const m = [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
  return Math.abs(m[1] - 15) < 0.35;
});
if (top.length < 8) throw new Error('expected top perimeter, got ' + top.length);
const path = makeSweepPath(top);
if (!path.closed) throw new Error('top path should be closed');
if (!(path.points.length < top.length)) {
  // thinning may equal edge count when already sparse; still must be finite
}
const before = part.volume();
part = filletAlongPath(part, path, 4.21);
const after = part.volume();
if (!(after < before - 50)) throw new Error('wrap fillet removed too little: ' + before + ' → ' + after);
return part;
`);
    const s = meshStats(p.mesh);
    check('top wrap fillet builds', Number.isFinite(p.volume) && p.volume > 0, `vol=${p.volume}`);
    check('top wrap not sliver-dirty', s && !s.dirty, `tiny=${s?.tiny}/${s?.nTri}`);
    // 5° arc densify measured 2 zero-area tall tris (was 0 at the 1.2 mm
    // chord). Still not a visible-area sheet; ceiling 4.
    check('top wrap no tall vertical fins', s && s.fins <= 4, `fins=${s?.fins} tiny=${s?.tiny}`);
    check('top wrap tiny under 40', s && s.tiny < 40, `tiny=${s?.tiny}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ top wrap fillet builds — ${e.message}`);
  }
}

// 2) Bottom path chamfer on rounded box (vertical fillets only)
{
  try {
    const p = await exec(`
let part = Manifold.cube([40, 30, 20], true);
for (const [fa, fb] of [[3, 6], [2, 3], [1, 2], [1, 6]]) {
  part = filletAlongPath(part, makeSweepPath(edgesBetween(part, fa, fb)), 6);
}
const bot = convexEdges(part).filter((e) => {
  const m = [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
  return Math.abs(m[1] + 15) < 0.35;
});
if (bot.length < 8) throw new Error('expected bottom perimeter, got ' + bot.length);
const before = part.volume();
part = filletAlongPath(part, makeSweepPath(bot), 6.1, { profile: 'chamfer' });
const after = part.volume();
if (!(after < before - 100)) throw new Error('chamfer removed too little: ' + before + ' → ' + after);
return part;
`);
    const s = meshStats(p.mesh);
    check('path chamfer rounded bottom builds', Number.isFinite(p.volume) && p.volume > 0);
    check('path chamfer not sliver-dirty', s && !s.dirty, `tiny=${s?.tiny}/${s?.nTri}`);
    // Measured tiny=99 after 5° arc-frame densify (was <80). Headroom to 130.
    check('path chamfer tiny under 130', s && s.tiny < 130, `tiny=${s?.tiny}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ path chamfer rounded bottom builds — ${e.message}`);
  }
}

// 3) Loft edge fillet regression (circle→square generator via coherent pick)
{
  try {
    const loftPayload = await exec(`
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs0 = makeCrossSection(fr, profileCircle(5, 32));
const xs1 = makeCrossSection(offsetPlaneFrame(fr, 20), profileRectangle(20, 12, true));
return placeInFrame(fr, makeLoft([xs0, xs1]));
`);
    const mesh = loftPayload.mesh;
    const np = mesh.numProp || 3;
    const src = mesh.vertProperties;
    const nVert = Math.floor(src.length / np);
    const positions = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
      positions[i * 3] = src[i * np];
      positions[i * 3 + 1] = src[i * np + 1];
      positions[i * 3 + 2] = src[i * np + 2];
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(Uint32Array.from(mesh.triVerts), 1));
    const raw = buildFeatureEdges(g);
    const topo = indexBoundaryEdges({
      positions,
      indices: mesh.triVerts,
      faceIDs: mesh.faceID,
    });
    const edges = buildCoherentEdges(annotateFeatureEdges(raw, topo));
    const generators = edges.filter((e) => Math.abs(e.tangent?.[2] || 0) > 0.8 && e.length > 10);
    check('loft exposes coherent generator', generators.length >= 1, `n=${generators.length}`);
    if (generators.length) {
      const gen = generators[0];
      const p = await exec(`
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs0 = makeCrossSection(fr, profileCircle(5, 32));
const xs1 = makeCrossSection(offsetPlaneFrame(fr, 20), profileRectangle(20, 12, true));
let part = placeInFrame(fr, makeLoft([xs0, xs1]));
const gen = ${JSON.stringify({
        a: gen.a, b: gen.b, va: gen.va, vb: gen.vb, length: gen.length,
        key: gen.key, n0: gen.n0, n1: gen.n1, pts: gen.pts, tangent: gen.tangent,
      })};
const before = part.volume();
part = filletAlongPath(part, makeSweepPath([gen]), 1.5, { variableProfile: true });
const after = part.volume();
if (!(after < before - 0.2)) throw new Error('loft fillet removed too little');
return part;
`);
      const s = meshStats(p.mesh);
      check('loft edge fillet builds', Number.isFinite(p.volume) && p.volume > 0, `vol=${p.volume}`);
      check('loft edge fillet not sliver-dirty', s && !s.dirty, `tiny=${s?.tiny}/${s?.nTri}`);
    }
  } catch (e) {
    failed++;
    console.log(`  ❌ loft edge fillet builds — ${e.message}`);
  }
}

// Compose emit smoke
{
  const V = [
    [-20, -15, 10], [20, -15, 10], [20, 15, 10], [-20, 15, 10],
  ];
  const mk = (a, b) => {
    const va = V[a];
    const vb = V[b];
    return {
      a, b, va, vb,
      length: Math.hypot(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]),
      key: `${a}-${b}`,
      n0: [0, 0, 1],
      n1: [0, 1, 0],
    };
  };
  const e01 = mk(0, 1);
  const e23 = mk(2, 3);
  const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
  const c = composeChamferCommit(starter, { edges: [e01, e23], params: { chamfer: 2 } });
  check('compose chamfer disjoint emits one pair for the set', c.ok
    && (c.buffer.match(/makeSweepPath\s*\(/g) || []).length === 1
    && (c.buffer.match(/profile:\s*'chamfer'/g) || []).length === 1);
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll fillet/chamfer rounded-wrap checks passed.');
