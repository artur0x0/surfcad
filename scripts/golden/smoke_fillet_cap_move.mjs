#!/usr/bin/env node
/**
 * Move Face on the playtest cap offsets both sides of the duplicate-vertex
 * seam. The drawn mesh drops the needle. The highlight outline drops that
 * seam too: one click is that plane with no edge between the fillet side
 * and the main side. The curved fillet stays its own face.
 *
 * The two regions are already one body and one plane. c4MeshData still sees
 * two faces because the vertices are copies about 0.001mm apart. The second
 * decompose component is the keep-both cut; its contact line is not this cap.
 *
 * That cut also leaves a planar cap at the same XY, z=-1.5, normal -Z.
 * A corner of it sits on several wall facets a few degrees apart. Offset 2
 * moves that cap and leaves the bottom cap on the other body.
 *
 * The inner ceiling is one click, but a fillet boolean leaves scraps a few
 * degrees off that plane. Offset 2 on a scrap moves the whole ceiling.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry } from 'three';
import { buildPartGraphPatches } from '../../src/utils/partGraphPatches.js';
import { resolveViewportFaceClick } from '../../src/utils/selectFace.js';
import { dropPlanarFins, highlightBoundaryPositions, isPlanarFin } from '../../src/utils/planarSeam.js';

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

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function distPointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(ax + v * abx - px, ay + v * aby - py, az + v * abz - pz);
  }
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(ax + w * acx - px, ay + w * acy - py, az + w * acz - pz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Math.hypot(bx + w * (cx - bx) - px, by + w * (cy - by) - py, bz + w * (cz - bz) - pz);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return Math.hypot(
    ax + abx * v + acx * w - px,
    ay + aby * v + acy * w - py,
    az + abz * v + acz * w - pz,
  );
}

function indexBoundarySegs(pos, index, triList) {
  const edgeCount = new Map();
  const ends = new Map();
  for (const t of triList) {
    const ids = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const u = ids[k];
      const v = ids[(k + 1) % 3];
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const key = `${lo}-${hi}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      if (!ends.has(key)) ends.set(key, [u, v]);
    }
  }
  const segs = [];
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const [u, v] = ends.get(key);
    segs.push({
      ax: pos[u * 3], ay: pos[u * 3 + 1], az: pos[u * 3 + 2],
      bx: pos[v * 3], by: pos[v * 3 + 1], bz: pos[v * 3 + 2],
    });
  }
  return segs;
}

function segCount(flat) {
  return flat.length / 6;
}
function hasSeg(flat, ax, ay, az, bx, by, bz) {
  for (let i = 0; i < flat.length; i += 6) {
    const d0 = Math.hypot(flat[i] - ax, flat[i + 1] - ay, flat[i + 2] - az);
    const d1 = Math.hypot(flat[i + 3] - bx, flat[i + 4] - by, flat[i + 5] - bz);
    const e0 = Math.hypot(flat[i] - bx, flat[i + 1] - by, flat[i + 2] - bz);
    const e1 = Math.hypot(flat[i + 3] - ax, flat[i + 4] - ay, flat[i + 5] - az);
    if ((d0 < 1e-6 && d1 < 1e-6) || (e0 < 1e-6 && e1 < 1e-6)) return true;
  }
  return false;
}

console.log('highlight outline drops a duplicate-vertex seam');
{
  const positions = new Float32Array([
    0, 0, 0, 4, 0, 0, 0, 4, 0, 4, 4, 0,
    1, 1, 0.001, 3, 1, 0.001, 3, 3, 0.001, 1, 3, 0.001,
  ]);
  const index = new Uint32Array([
    0, 1, 2, 1, 3, 2,
    4, 5, 6, 4, 6, 7,
  ]);
  const quad = highlightBoundaryPositions(positions, index, [0, 1]);
  check('a quad highlight is its four sides', segCount(quad) === 4, `n=${segCount(quad)}`);
  check('the shared diagonal is not an outline', !hasSeg(quad, 4, 0, 0, 0, 4, 0));
  const cap = highlightBoundaryPositions(positions, index, [0, 1, 2, 3]);
  check('the seam square is not an outline', segCount(cap) === 4, `n=${segCount(cap)}`);
  check('the outer edge stays', hasSeg(cap, 0, 0, 0, 4, 0, 0));
  check('an inner seam edge is gone', !hasSeg(cap, 1, 1, 0.001, 3, 1, 0.001));
  const attr = new BufferAttribute(positions, 3);
  const viaAttr = highlightBoundaryPositions(attr, index, [0, 1, 2, 3]);
  check('a buffer attribute gives the same outline', viaAttr.length === cap.length
    && viaAttr.every((v, i) => v === cap[i]));
}

await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  globalThis.__note = null;
  try {
    const msg = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
    return { payload: msg.payload, note: globalThis.__note };
  } catch (e) {
    return { error: e.message, note: globalThis.__note };
  }
}

function triInfo(pos, index, t) {
  const i0 = index[t * 3];
  const i1 = index[t * 3 + 1];
  const i2 = index[t * 3 + 2];
  const ax = pos[i1 * 3] - pos[i0 * 3];
  const ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1];
  const az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
  const bx = pos[i2 * 3] - pos[i0 * 3];
  const by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1];
  const bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const raw = Math.hypot(nx, ny, nz);
  const len = raw || 1;
  const z0 = pos[i0 * 3 + 2];
  const z1 = pos[i1 * 3 + 2];
  const z2 = pos[i2 * 3 + 2];
  return {
    nx: nx / len, ny: ny / len, nz: nz / len, area: 0.5 * raw,
    cx: (pos[i0 * 3] + pos[i1 * 3] + pos[i2 * 3]) / 3,
    cy: (pos[i0 * 3 + 1] + pos[i1 * 3 + 1] + pos[i2 * 3 + 1]) / 3,
    cz: (z0 + z1 + z2) / 3,
    zMin: Math.min(z0, z1, z2),
    zMax: Math.max(z0, z1, z2),
  };
}

console.log('moveFace offsets the whole playtest cap');
{
  const r = await exec(`
let box1 = Manifold.cube([40, 30, 20], true);
let part = box1;
const selEdges = edgesBetween(part, 3, 5);
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 4);
part = hollow(part, 2.5, [{ center: [0, -15, 0], normal: [0, -1, 0] }, { center: [-20, -0.0814, -0.0525], normal: [-1, 0, 0] }, { center: [0, 0, -10], normal: [0, 0, -1] }]);
part = draftFaces(part, [{ center: [0, -1.9752, 10], normal: [0, 0, 1] }, { center: [20, -0.0814, -0.0525], normal: [1, 0, 0] }], 2, { pull: [0, 1, 0], reference: { center: [0, 15, -1.9752], normal: [0, 1, 0] } });
const selEdges2 = [{ a: 75, b: 79, va: [17.500006, -15, 7.500005], vb: [17.500006, 11.048712, 7.500005], length: 26.048712, key: "coh-15-0", n0: [0, 0, -1], n1: [-1, 0, 0], pts: [[17.500006, -15, 7.500005], [17.500006, 11.048712, 7.500005]] }, { a: 79, b: 98, va: [17.500006, 11.048712, 7.500005], vb: [17.500006, 11.548889, 7.396398], length: 0.51254, key: "coh-22-0", n0: [0, -0.062803, -0.998026], n1: [-1, 0, 0], pts: [[17.500006, 11.048712, 7.500005], [17.500006, 11.361927, 7.456096], [17.500006, 11.548889, 7.396398]] }, { a: 98, b: 103, va: [17.500006, 11.548889, 7.396398], vb: [17.500006, 12.060664, 7.060664], length: 0.615859, key: "coh-22-1", n0: [0, -0.528075, -0.849198], n1: [-1, 0, 0], pts: [[17.500006, 11.548889, 7.396398], [17.500006, 11.749999, 7.299045], [17.500006, 11.91315, 7.19003], [17.500006, 12.060664, 7.060664]] }, { a: 103, b: 93, va: [17.500006, 12.060664, 7.060664], vb: [17.500006, 12.345315, 6.663433], length: 0.490383, key: "coh-22-2", n0: [0, -0.729862, -0.683594], n1: [-1, 0, 0], pts: [[17.500006, 12.060664, 7.060664], [17.500006, 12.232179, 6.856119], [17.500006, 12.345315, 6.663433]] }, { a: 93, b: 85, va: [17.500006, 12.345315, 6.663433], vb: [17.500006, 12.500006, 6.048211], length: 0.638427, key: "coh-22-3", n0: [0, -0.975207, -0.221294], n1: [-1, 0, 0], pts: [[17.500006, 12.345315, 6.663433], [17.500006, 12.448895, 6.388229], [17.500006, 12.476648, 6.265923], [17.500006, 12.500006, 6.048211]] }, { a: 77, b: 85, va: [17.500006, 12.500005, -10], vb: [17.500006, 12.500006, 6.048211], length: 16.048211, key: "coh-16-0", n0: [0, -1, 0], n1: [-1, 0, 0], pts: [[17.500006, 12.500005, -10], [17.500006, 12.500006, 6.048211]] }];
const path2 = makeSweepPath(selEdges2);
part = filletAlongPath(part, path2, 4.44, { variableProfile: true });
part = cut(part, { center: [-3.4426, -1.9757, 7.5], normal: [0, 0, -1], offset: 9 });
// The edge at mid [20, 15, -5.75], length 8.5. Face ids follow the
// tessellation (#154 renumbered 76/96 → 84/104), so pick it by position.
const selEdges3 = convexEdges(part).filter((e) => {
  const m = [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
  const L = Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
  return Math.abs(m[0] - 20) < 0.05 && Math.abs(m[1] - 15) < 0.05 && Math.abs(m[2] + 5.75) < 0.3 && Math.abs(L - 8.5) < 0.6;
});
if (selEdges3.length !== 1) throw new Error('cap-move edge pick: ' + selEdges3.length + ' edges at [20, 15, -5.75]');
const path3 = makeSweepPath(selEdges3);
part = filletAlongPath(part, path3, 4.83, { variableProfile: true });
const selEdges4 = [{ a: 467, b: 1207, va: [20, 15, -1.5], vb: [20, 15, 6.049528], length: 7.549528, key: "coh-21-0", n0: [0.999391, 0.034899, 0], n1: [0, 1, 0], pts: [[20, 15, -1.5], [20, 15, 6.049528]] }, { a: 1207, b: 1212, va: [20, 15, 6.049528], vb: [20.007414, 14.787721, 7.285758], length: 1.258735, key: "coh-39-0", n0: [0.999391, 0.034899, -0.000002], n1: [0, 0.995185, 0.098019], pts: [[20, 15, 6.049528], [20.000299, 14.991436, 6.261612], [20.002684, 14.923141, 6.780361], [20.007414, 14.787721, 7.285758]] }, { a: 1212, b: 1226, va: [20.007414, 14.787721, 7.285758], vb: [20.040913, 13.828427, 8.828427], length: 1.830906, key: "coh-39-1", n0: [0.999391, 0.0349, 0.000006], n1: [0, 0.849201, 0.52807], pts: [[20.007414, 14.787721, 7.285758], [20.018715, 14.464102, 8], [20.028866, 14.173413, 8.435045], [20.040913, 13.828427, 8.828427]] }, { a: 1226, b: 1217, va: [20.040913, 13.828427, 8.828427], vb: [20.077904, 12.769155, 9.587491], length: 1.307887, key: "coh-39-2", n0: [0.999391, 0.0349, 0.000006], n1: [0, 0.582477, 0.812847], pts: [[20.040913, 13.828427, 8.828427], [20.062078, 13.222281, 9.325878], [20.077904, 12.769155, 9.587491]] }, { a: 1217, b: 1196, va: [20.077904, 12.769155, 9.587491], vb: [20.137953, 11.049527, 10], length: 1.78219, key: "coh-39-3", n0: [0.999391, 0.0349, 0.000016], n1: [0, 0.162894, 0.986644], pts: [[20.077904, 12.769155, 9.587491], [20.103531, 12.035276, 9.863704], [20.12145, 11.522105, 9.965779], [20.137953, 11.049527, 10]] }, { a: 122, b: 1196, va: [21.047621, -15, 10.909668], vb: [20.137953, 11.049527, 10], length: 26.081274, key: "coh-20-0", n0: [0.999391, 0.034898, -0.000044], n1: [0, 0.034899, 0.999391], pts: [[21.047621, -15, 10.909668], [20.137953, 11.049527, 10]] }];
const path4 = makeSweepPath(selEdges4);
part = filletAlongPath(part, path4, 4.83, { variableProfile: true });
function capCentroid(solid, wantIsland) {
  const mesh = solid.getMesh();
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const np = mesh.numProp || 3;
  let best = null;
  const nTri = tv.length / 3;
  for (let t = 0; t < nTri; t++) {
    const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
    const x0 = vp[i0 * np], y0 = vp[i0 * np + 1], z0 = vp[i0 * np + 2];
    const x1 = vp[i1 * np], y1 = vp[i1 * np + 1], z1 = vp[i1 * np + 2];
    const x2 = vp[i2 * np], y2 = vp[i2 * np + 1], z2 = vp[i2 * np + 2];
    if (Math.abs(z0 + 10) > 0.15 || Math.abs(z1 + 10) > 0.15 || Math.abs(z2 + 10) > 0.15) continue;
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    const nz = ax * by - ay * bx;
    const area = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, nz);
    if (!(area > 0.2) || !(nz < -0.999 * area * 2)) continue;
    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const island = cx > 14 && cy > 8 && cy < 13;
    if (island !== wantIsland) continue;
    if (!best || area > best.area) best = { area, cx, cy };
  }
  if (!best) throw new Error(wantIsland ? 'no fillet-side cap triangle' : 'no main-side cap triangle');
  return [best.cx, best.cy, -10.35];
}
const mainPt = capCentroid(part, false);
const islePt = capCentroid(part, true);
const ballVol = (solid, p) => Manifold.intersection(solid, Manifold.sphere(0.12, 8).translate(p)).volume();
const preN = part.decompose().length;
const preVol = part.volume();
const preLarge = ballVol(part, mainPt);
const preIsland = ballVol(part, islePt);
function planeBand(solid, z0, z1, nzSign) {
  const mesh = solid.getMesh();
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const np = mesh.numProp || 3;
  let area = 0;
  const nTri = tv.length / 3;
  for (let ti = 0; ti < nTri; ti++) {
    const i0 = tv[ti * 3], i1 = tv[ti * 3 + 1], i2 = tv[ti * 3 + 2];
    const zA = vp[i0 * np + 2], zB = vp[i1 * np + 2], zC = vp[i2 * np + 2];
    if (Math.max(zA, zB, zC) < z0 || Math.min(zA, zB, zC) > z1) continue;
    const ax = vp[i1 * np] - vp[i0 * np], ay = vp[i1 * np + 1] - vp[i0 * np + 1], az = zB - zA;
    const bx = vp[i2 * np] - vp[i0 * np], by = vp[i2 * np + 1] - vp[i0 * np + 1], bz = zC - zA;
    const nz = ax * by - ay * bx;
    const ar = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, nz);
    if (nzSign < 0 && !(nz < -0.99 * ar * 2)) continue;
    if (nzSign > 0 && !(nz > 0.99 * ar * 2)) continue;
    area += ar;
  }
  return area;
}
const cutShifted = moveFace(part, [{ center: [8.6429, 6.4902, -1.5], normal: [0, 0, -1] }], 2);
const shifted = moveFace(part, [{ center: [8.6429, 6.4902, -10.0001], normal: [0, 0, -1] }], 2);
const ceiling = moveFace(part, [{ center: [13.2327, -2.4253, 7.4953], normal: [-0.0403, 0, -0.9992] }], 2);
const ceilingFar = moveFace(part, [{ center: [13.1918, 10.3982, 7.4968], normal: [-0.0403, -0.0003, -0.9992] }], 2);
const ceilingSide = moveFace(part, [{ center: [-7.8069, 11.0596, 7.4993], normal: [0, -0.0419, -0.9991] }], 2);
const postLarge = ballVol(shifted, mainPt);
const postIsland = ballVol(shifted, islePt);
globalThis.__note = {
  preN,
  postN: shifted.decompose().length,
  dVol: +(shifted.volume() - preVol).toFixed(3),
  mainPt: mainPt.map((v) => +v.toFixed(3)),
  islePt: islePt.map((v) => +v.toFixed(3)),
  preLarge: +preLarge.toFixed(6),
  postLarge: +postLarge.toFixed(6),
  preIsland: +preIsland.toFixed(6),
  postIsland: +postIsland.toFixed(6),
  cutN: cutShifted.decompose().length,
  cutDVol: +(cutShifted.volume() - preVol).toFixed(3),
  cutBottom: +planeBand(cutShifted, -10.2, -9.8, -1).toFixed(2),
  cutGone: +planeBand(cutShifted, -1.7, -1.3, -1).toFixed(2),
  cutMate: +planeBand(cutShifted, -1.7, -1.3, 1).toFixed(2),
  cutMoved: +planeBand(cutShifted, -3.7, -3.3, -1).toFixed(2),
  ceilN: ceiling.decompose().length,
  ceilDVol: +(ceiling.volume() - preVol).toFixed(3),
  ceilGone: +planeBand(ceiling, 7.35, 7.65, -1).toFixed(2),
  ceilMoved: +planeBand(ceiling, 5.35, 5.65, -1).toFixed(2),
  ceilBottom: +planeBand(ceiling, -10.2, -9.8, -1).toFixed(2),
  ceilFar: +(ceilingFar.volume() - preVol).toFixed(3),
  ceilSide: +(ceilingSide.volume() - preVol).toFixed(3),
};
return shifted;
`);
  check('playtest script runs through the cap move', !r.error, r.error || '');
  const n = r.note;
  if (n) console.log('  note', JSON.stringify(n));
  if (!r.error && n) {
    check('the keep-both cut is still two bodies', n.preN === 2 && n.postN === 2, `pre=${n.preN} post=${n.postN}`);
    check('both sides of the cap moved', n.dVol > 360 && n.dVol < 420, `dVol=${n.dVol}`);
    check('the main side was empty just outside and is solid after', n.preLarge < 1e-6 && n.postLarge > 1e-4,
      `pre=${n.preLarge} post=${n.postLarge}`);
    check('the fillet side was empty just outside and is solid after', n.preIsland < 1e-6 && n.postIsland > 1e-4,
      `pre=${n.preIsland} post=${n.postIsland}`);
    check('the cut cap offsets and stays two bodies', n.cutN === 2 && n.cutDVol > 360 && n.cutDVol < 380,
      `n=${n.cutN} dVol=${n.cutDVol}`);
    check('the cut cap left z=-1.5 and landed 2mm down', n.cutGone < 0.5 && n.cutMoved > 180,
      `gone=${n.cutGone} moved=${n.cutMoved}`);
    check('that offset leaves the bottom cap and the other cut face', n.cutBottom > 180 && n.cutMate > 180,
      `bottom=${n.cutBottom} mate=${n.cutMate}`);
    check('a ceiling scrap offsets the whole plane and stays two bodies',
      n.ceilN === 2 && n.ceilDVol > 1400 && n.ceilDVol < 2600 && n.ceilFar > 1400 && n.ceilSide > 1400,
      `n=${n.ceilN} dVol=${n.ceilDVol} far=${n.ceilFar} side=${n.ceilSide}`);
    check('that ceiling left z=7.5 and the bottom cap stayed',
      n.ceilGone < 30 && n.ceilMoved > 800 && n.ceilBottom > 180,
      `gone=${n.ceilGone} moved=${n.ceilMoved} bottom=${n.ceilBottom}`);
  }

  const mesh = r.payload?.mesh;
  if (!r.error && mesh?.vertProperties && mesh?.triVerts) {
    const np = mesh.numProp || 3;
    const nVert = mesh.vertProperties.length / np;
    const pos = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
      pos[i * 3] = mesh.vertProperties[i * np];
      pos[i * 3 + 1] = mesh.vertProperties[i * np + 1];
      pos[i * 3 + 2] = mesh.vertProperties[i * np + 2];
    }
    const rawIndex = Uint32Array.from(mesh.triVerts);
    const fin = dropPlanarFins(pos, rawIndex, mesh.faceID);
    const keptKey = new Set();
    for (let i = 0; i < fin.indices.length; i += 3) {
      keptKey.add(`${fin.indices[i]},${fin.indices[i + 1]},${fin.indices[i + 2]}`);
    }
    let droppedArea = 0;
    for (let t = 0; t < rawIndex.length / 3; t++) {
      const key = `${rawIndex[t * 3]},${rawIndex[t * 3 + 1]},${rawIndex[t * 3 + 2]}`;
      if (keptKey.has(key)) continue;
      const i0 = rawIndex[t * 3];
      const i1 = rawIndex[t * 3 + 1];
      const i2 = rawIndex[t * 3 + 2];
      const ax = pos[i1 * 3] - pos[i0 * 3];
      const ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1];
      const az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const bx = pos[i2 * 3] - pos[i0 * 3];
      const by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1];
      const bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      droppedArea += 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    }
    check('the needle between the cap copies is dropped', fin.dropped > 0 && droppedArea < 1,
      `dropped=${fin.dropped} area=${droppedArea.toFixed(4)}`);
    const index = fin.indices;
    const numTri = index.length / 3;
    const cosCap = Math.cos((0.5 * Math.PI) / 180);
    const cosFillet = Math.cos((20 * Math.PI) / 180);
    let movedArea = 0;
    let stayedArea = 0;
    let largeTri = -1;
    let islandTri = -1;
    let filletTri = -1;
    let finLeft = 0;
    const infos = new Array(numTri);
    for (let t = 0; t < numTri; t++) {
      const info = triInfo(pos, index, t);
      infos[t] = info;
      const onMoved = info.nz < -cosCap && info.zMax < -11.7 && info.zMin > -12.3;
      const onStayed = info.nz < -cosCap && info.zMax < -9.7 && info.zMin > -10.3;
      if (onMoved && info.area > 1e-6) {
        movedArea += info.area;
        if (info.cx < 0 && (largeTri < 0 || info.area > infos[largeTri].area)) largeTri = t;
        if (info.cx > 14 && info.cy > 8 && info.cy < 13 && (islandTri < 0 || info.area > infos[islandTri].area)) islandTri = t;
      }
      if (onStayed && info.area > 1e-4) stayedArea += info.area;
      if (filletTri < 0 && info.area > 0.2 && -info.nz < cosFillet && info.cz < -8 && info.cz > -12.5) filletTri = t;
      if (isPlanarFin(pos, index, t) && info.zMax < -11.5 && info.zMin > -12.4) finLeft++;
    }
    check('the moved cap is the whole plane', movedArea > 160, `area=${movedArea.toFixed(1)}`);
    check('nothing of that plane stayed at the old height', stayedArea < 0.5, `area=${stayedArea.toFixed(3)}`);
    check('the drawn cap has no needle left on it', finLeft === 0, `n=${finLeft}`);
    check('both sides of the cap are in the moved mesh', largeTri >= 0 && islandTri >= 0,
      `large=${largeTri} island=${islandTri}`);

    if (largeTri >= 0 && islandTri >= 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(pos, 3));
      geometry.setIndex(new BufferAttribute(index, 1));
      const graph = buildPartGraphPatches({
        positions: pos,
        indices: index,
        faceIDs: fin.faceIDs,
      });
      const cap = graph.patches[graph.triPatch[largeTri]];
      const islandPatch = graph.triPatch[islandTri];
      const curvedInCap = cap.tris.some((t) => infos[t].area > 1e-6 && -infos[t].nz < cosFillet);
      check('one planar patch holds both sides',
        cap?.kind === 'planar' && islandPatch === cap.id && !curvedInCap,
        `kind=${cap?.kind} same=${islandPatch === cap?.id} curved=${curvedInCap}`);
      const click = (legacy) => resolveViewportFaceClick({
        geometry,
        seedFaceIndex: largeTri,
        faceNormal: [0, 0, -1],
        clickCount: 1,
        faceIDs: fin.faceIDs,
        legacy,
      });
      for (const legacy of [false, true]) {
        const picked = click(legacy);
        const set = new Set(picked.indices);
        const curved = picked.indices.some((t) => infos[t].area > 1e-6 && -infos[t].nz < cosFillet);
        check(`${legacy ? 'Move Face' : 'default'} one click is the whole cap`,
          picked.kind === 'planar' && set.has(largeTri) && set.has(islandTri) && !curved,
          `n=${picked.indices.length} island=${set.has(islandTri)} curved=${curved}`);
      }
      if (filletTri >= 0) {
        const picked = click(false);
        check('the curved fillet is not in that click', !new Set(picked.indices).has(filletTri));
      } else {
        check('a curved fillet triangle sits beside the cap', false);
      }

      const picked = click(true);
      const flat = highlightBoundaryPositions(pos, index, picked.indices);
      const drawn = [];
      for (let i = 0; i < flat.length; i += 6) {
        drawn.push({
          ax: flat[i], ay: flat[i + 1], az: flat[i + 2],
          bx: flat[i + 3], by: flat[i + 4], bz: flat[i + 5],
        });
      }
      const triDist = (t, x, y, z) => {
        const i0 = index[t * 3];
        const i1 = index[t * 3 + 1];
        const i2 = index[t * 3 + 2];
        return distPointTri(
          x, y, z,
          pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2],
          pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2],
          pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2],
        );
      };
      // A triangle that contains an endpoint is the edge's own face, or the
      // next edge around that vertex. The other copy sits about 0.001mm off
      // and contains neither endpoint.
      const touches = (s, t) => triDist(t, s.ax, s.ay, s.az) < 1e-4 || triDist(t, s.bx, s.by, s.bz) < 1e-4;
      const liesOnOther = (s) => {
        const mx = (s.ax + s.bx) / 2;
        const my = (s.ay + s.by) / 2;
        const mz = (s.az + s.bz) / 2;
        for (const t of picked.indices) {
          if (touches(s, t)) continue;
          if (triDist(t, mx, my, mz) <= 0.01) return true;
        }
        return false;
      };
      let crossing = 0;
      for (const s of drawn) if (liesOnOther(s)) crossing++;
      check('the cap highlight has no edge between the fillet side and the main side',
        crossing === 0, `n=${crossing}`);
      const raw = indexBoundarySegs(pos, index, picked.indices);
      const outline = raw.filter((s) => !liesOnOther(s));
      const nearDrawn = (s) => drawn.some((d) => {
        const dx = (d.ax + d.bx) / 2 - (s.ax + s.bx) / 2;
        const dy = (d.ay + d.by) / 2 - (s.ay + s.by) / 2;
        const dz = (d.az + d.bz) / 2 - (s.az + s.bz) / 2;
        return dx * dx + dy * dy + dz * dz < 1e-4;
      });
      const kept = outline.filter(nearDrawn);
      check('the cap outline is still the highlight',
        outline.length > 0 && kept.length === outline.length,
        `kept=${kept.length} outline=${outline.length} drawn=${drawn.length} raw=${raw.length}`);
      let blend = null;
      for (const p of graph.patches) {
        if (p.kind === 'planar') continue;
        const near = p.tris.some((t) => Math.abs(infos[t].cz + 12) < 4);
        if (near && (!blend || p.area > blend.area)) blend = p;
      }
      if (blend) {
        const blendRaw = indexBoundarySegs(pos, index, blend.tris).length;
        const blendDrawn = segCount(highlightBoundaryPositions(pos, index, blend.tris));
        check('the curved fillet highlight keeps its own outline',
          blend.kind === 'blend' && blendDrawn === blendRaw && blendDrawn > 0,
          `kind=${blend.kind} drawn=${blendDrawn} raw=${blendRaw}`);
      } else {
        check('a curved fillet sits beside the cap', false);
      }
    }
  } else if (!r.error) {
    check('mesh is available', false, 'no mesh');
  }
}

{
  const worker = readFileSync(new URL('../../src/workers/sandboxWorker.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../../src/lib/surfcad/runtime.js', import.meta.url), 'utf8');
  const vp = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
  const fillet = readFileSync(new URL('../../src/utils/filletAlongPath.js', import.meta.url), 'utf8');
  const scraps = worker.match(/scrapVol > 0\.05 \* bestVol && scrapVol > 1e-2/g) || [];
  check('fillet arc stays 24 segments', /export const FILLET_ARC_SEGMENTS = 24;/.test(fillet));
  // Single path, semi-arc batch, and the edge set each keep the same gate.
  check('scrap gate is unchanged', scraps.length === 3, `n=${scraps.length}`);
  check('Move Face still forces the legacy walk',
    /legacy: legacyTap \|\| !!moveFaceModeRef\.current/.test(vp));
  check('moveFace includes the coplanar seam and the plane that scrap was cut from',
    /_c4ExpandSamePlane\(md, _c4ExpandCoplanarSeam\(md, _c4ResolveFaceSelection\(/.test(worker));
  // The pick-mesh build lives in partSolidCache (shared with the other
  // assembly parts so a part switch can reuse it).
  const solidCache = readFileSync(new URL('../../src/utils/partSolidCache.js', import.meta.url), 'utf8');
  check('the drawn mesh drops the needle before the face graph',
    /dropPlanarFins\(vertProperties, srcIndex, srcFaceID\)/.test(solidCache)
    && /cachedSolidGeometry\(solidCacheRef\.current, meshData\)/.test(vp)
    && /warmFaceGraph\(geometry, faceIDsRef\.current\)/.test(vp));
  check('the highlight outline drops a seam that already lies on the face',
    /highlightBoundaryPositions\(positions, index, faceIndices\)/.test(vp));
}

if (failed) {
  console.log(`\n${failed} fillet-cap-move check(s) failed`);
  process.exit(1);
}
console.log('\nfillet-cap-move golden passed');
