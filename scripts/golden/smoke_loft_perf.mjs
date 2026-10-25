#!/usr/bin/env node
/**
 * Saddle-class loft: curvature-adaptive tessellation.
 *
 * The shape is four 32-point ellipses at 0 / 160 / 270 / 285 mm, the
 * stand-in for the Futuristic Bike saddle (that model is not in the repo).
 * The legacy builder is the uniform 128-ray warp. The fine builder places
 * a ring on every authored vertex and every station, with the twist split
 * to 0.01 mm, and is the surface the chordal bound is measured against.
 * The legacy warp's extrude grid does not land on the station planes, so
 * its distance to those planes is its own chord, not the adaptive error.
 *
 * Set LOFT_PERF_SHOTS=1 to write before/after PNGs (same camera).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { deflateSync } from 'node:zlib';
import Module from '../../built/manifold.js';
import { meshToStl, meshToStepBytes } from '../../src/lib/surfcad/export.js';
import { buildSolidGeometry, featureGraphFor } from '../../src/utils/partSolidCache.js';
import { warmFaceGraph } from '../../src/utils/selectFace.js';
import {
  meshSurfaceSamples,
  pointsToMeshDeviation,
} from '../../src/utils/loftDeviation.js';
import {
  buildMakeLoftDenseSolid,
  buildMakeLoftFineSolid,
  buildMakeLoftSolid,
} from '../../src/utils/makeLoft.js';
import {
  adaptiveLoftAngles,
  loftChordToleranceMm,
  maxPolarGap,
} from '../../src/utils/loftTessellation.js';
import { meshPlanarFaces } from '../../src/utils/sheetMetal/stepExport.js';

const TRI_CEILING = 20000;
const VOLUME_REL = 0.005;
const SADDLE_BUILD_BUDGET_MS = 3000;
const SADDLE_GRAPH_BUDGET_MS = 3000;
const LEGACY_BUILD_BUDGET_MS = 15000;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function ellipse(a, b, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([a * Math.cos(t), b * Math.sin(t)]);
  }
  return pts;
}

const PLANE = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const SADDLE = [
  [70, 28, 0],
  [62, 24, 160],
  [36, 16, 270],
  [14, 8, 285],
];

function saddleSections() {
  return SADDLE.map(([a, b, z]) => ({
    plane: { ...PLANE, center: [0, 0, z] },
    contours: [ellipse(a, b)],
    offset: z,
  }));
}

function saddleStations() {
  return SADDLE.map(([a, b, z]) => ({
    plane: { ...PLANE, center: [0, 0, z] },
    contour: ellipse(a, b),
    offset: z,
  }));
}

function stationSamples(stations) {
  const pts = [];
  for (const s of stations) {
    for (const p of s.contour) pts.push([p[0], p[1], s.offset]);
  }
  return pts;
}

function stlTriCount(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
}

function triMesh(tris) {
  const verts = [];
  const idx = [];
  for (const t of tris) {
    for (const p of t) {
      idx.push(verts.length / 3);
      verts.push(p[0], p[1], p[2]);
    }
  }
  return {
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(idx),
  };
}

function timeGraphs(mesh, label) {
  const t0 = performance.now();
  const { geometry, faceIDs } = buildSolidGeometry(mesh);
  const geomMs = performance.now() - t0;
  const t1 = performance.now();
  warmFaceGraph(geometry, faceIDs);
  const faceMs = performance.now() - t1;
  const t2 = performance.now();
  featureGraphFor(geometry, faceIDs);
  const edgeMs = performance.now() - t2;
  const t3 = performance.now();
  const again = featureGraphFor(geometry, faceIDs);
  warmFaceGraph(geometry, faceIDs);
  const cacheMs = performance.now() - t3;
  const total = geomMs + faceMs + edgeMs;
  console.log(
    `  ${label}: geom ${geomMs.toFixed(1)} ms, face ${faceMs.toFixed(1)} ms, `
    + `edge ${edgeMs.toFixed(1)} ms, cache hit ${cacheMs.toFixed(1)} ms, `
    + `cached=${again.cached}`,
  );
  return { geomMs, faceMs, edgeMs, cacheMs, total, cached: again.cached };
}

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection, Mesh } = wasm;
const sections = saddleSections();
const stations = saddleStations();
const eps = loftChordToleranceMm(stations);
console.log(`chordal tolerance ${eps.toFixed(4)} mm`);

const tLegacy = performance.now();
const legacy = buildMakeLoftDenseSolid(Manifold, CrossSection, sections, { resolution: 32 });
const legacyMs = performance.now() - tLegacy;
const legacyMesh = legacy.getMesh();

const tAdapt = performance.now();
const adapt = buildMakeLoftSolid(Manifold, CrossSection, sections, { Mesh });
const adaptMs = performance.now() - tAdapt;
const adaptMesh = adapt.getMesh();

const tFine = performance.now();
const fine = buildMakeLoftFineSolid(Manifold, CrossSection, sections, { Mesh });
const fineMs = performance.now() - tFine;
const fineMesh = fine.getMesh();

const t16 = performance.now();
const adapt16 = buildMakeLoftSolid(Manifold, CrossSection, sections, { Mesh, resolution: 16 });
const ms16 = performance.now() - t16;
const t32 = performance.now();
const adapt32 = buildMakeLoftSolid(Manifold, CrossSection, sections, { Mesh, resolution: 32 });
const ms32 = performance.now() - t32;

const tUnion = performance.now();
const unionSolid = buildMakeLoftSolid(Manifold, CrossSection, sections, {});
const unionMs = performance.now() - tUnion;

console.log(
  `  legacy ${legacyMesh.numTri} tris in ${legacyMs.toFixed(1)} ms, vol ${legacy.volume().toFixed(2)}`,
);
console.log(
  `  adaptive ${adaptMesh.numTri} tris in ${adaptMs.toFixed(1)} ms, vol ${adapt.volume().toFixed(2)}`,
);
console.log(
  `  fine ${fineMesh.numTri} tris in ${fineMs.toFixed(1)} ms, vol ${fine.volume().toFixed(2)}`,
);
console.log(
  `  resolution 16 → ${adapt16.getMesh().numTri} tris in ${ms16.toFixed(1)} ms; `
  + `32 → ${adapt32.getMesh().numTri} tris in ${ms32.toFixed(1)} ms`,
);
console.log(
  `  union fallback ${unionSolid.getMesh().numTri} tris in ${unionMs.toFixed(1)} ms, `
  + `vol ${unionSolid.volume().toFixed(2)}`,
);

check(
  `adaptive saddle under ${TRI_CEILING} triangles`,
  adaptMesh.numTri < TRI_CEILING && adaptMesh.numTri < legacyMesh.numTri / 10,
  `tris=${adaptMesh.numTri} legacy=${legacyMesh.numTri}`,
);
check(
  `adaptive build under ${SADDLE_BUILD_BUDGET_MS} ms`,
  adaptMs < SADDLE_BUILD_BUDGET_MS,
  `${adaptMs.toFixed(1)} ms`,
);
check(
  `legacy build under ${LEGACY_BUILD_BUDGET_MS} ms`,
  legacyMs < LEGACY_BUILD_BUDGET_MS,
  `${legacyMs.toFixed(1)} ms`,
);
check('adaptive is one genus-0 body', adapt.genus() === 0 && adapt.decompose().length === 1);
check('union fallback is one genus-0 body', unionSolid.genus() === 0 && unionSolid.decompose().length === 1);

const volLegacy = Math.abs(adapt.volume() - legacy.volume()) / legacy.volume();
const volFine = Math.abs(adapt.volume() - fine.volume()) / fine.volume();
const volUnion = Math.abs(unionSolid.volume() - adapt.volume()) / adapt.volume();
console.log(
  `  |Δvol| adaptive vs legacy ${(volLegacy * 100).toFixed(4)}%, `
  + `vs fine ${(volFine * 100).toFixed(4)}%, union vs adaptive ${(volUnion * 100).toFixed(4)}%`,
);
console.log(
  `  mass at 1 g/cm³: legacy ${(legacy.volume() / 1000).toFixed(3)} g, `
  + `adaptive ${(adapt.volume() / 1000).toFixed(3)} g`,
);
check(
  'volume and mass within 0.5% of the legacy mesh',
  volLegacy < VOLUME_REL,
  `${(volLegacy * 100).toFixed(4)}%`,
);
check(
  'volume and mass within 0.5% of the station-exact surface',
  volFine < VOLUME_REL,
  `${(volFine * 100).toFixed(4)}%`,
);
check(
  'union fallback volume within 0.5% of the mesh path',
  volUnion < VOLUME_REL,
  `${(volUnion * 100).toFixed(4)}%`,
);

const adaptSamples = meshSurfaceSamples(adaptMesh);
const toFine = pointsToMeshDeviation(adaptSamples, fineMesh, 4);
const fromFine = pointsToMeshDeviation(meshSurfaceSamples(fineMesh, 4), adaptMesh, 4);
const toLegacy = pointsToMeshDeviation(adaptSamples, legacyMesh, 4);
const stationsOnAdapt = pointsToMeshDeviation(stationSamples(stations), adaptMesh, 4);
const stationsOnLegacy = pointsToMeshDeviation(stationSamples(stations), legacyMesh, 4);
console.log(
  `  deviation adaptive → fine max ${toFine.max.toFixed(4)} mm, p95 ${toFine.p95.toFixed(4)} mm (n=${toFine.n})`,
);
console.log(
  `  deviation fine → adaptive max ${fromFine.max.toFixed(4)} mm, p95 ${fromFine.p95.toFixed(4)} mm (n=${fromFine.n})`,
);
console.log(
  `  deviation adaptive → legacy max ${toLegacy.max.toFixed(4)} mm, p95 ${toLegacy.p95.toFixed(4)} mm (n=${toLegacy.n})`,
);
console.log(
  `  station rings → adaptive max ${stationsOnAdapt.max.toFixed(4)} mm; `
  + `→ legacy max ${stationsOnLegacy.max.toFixed(4)} mm p95 ${stationsOnLegacy.p95.toFixed(4)} mm`,
);
check(
  'max deviation from the station-exact surface ≤ chordal tolerance',
  toFine.max <= eps + 1e-3 && fromFine.max <= eps + 1e-3,
  `to=${toFine.max.toFixed(4)} from=${fromFine.max.toFixed(4)} eps=${eps.toFixed(4)}`,
);
check(
  '95th percentile deviation from the station-exact surface ≤ chordal tolerance',
  toFine.p95 <= eps && fromFine.p95 <= eps,
  `p95 ${toFine.p95.toFixed(4)} / ${fromFine.p95.toFixed(4)}`,
);
check(
  'station rings sit closer to the adaptive mesh than to the legacy mesh',
  stationsOnAdapt.max <= eps && stationsOnAdapt.max < stationsOnLegacy.max,
  `adapt=${stationsOnAdapt.max.toFixed(4)} legacy=${stationsOnLegacy.max.toFixed(4)}`,
);

const angles16 = adaptiveLoftAngles(stations, { resolution: 16 }, eps);
const angles32 = adaptiveLoftAngles(stations, { resolution: 32 }, eps);
check(
  'resolution 16 caps the polar gap at 22.5°',
  maxPolarGap(angles16) <= (Math.PI * 2) / 16 + 1e-6,
);
check(
  'resolution 32 caps the polar gap at 11.25°',
  maxPolarGap(angles32) <= (Math.PI * 2) / 32 + 1e-6,
);
check(
  'resolution 16 meshes the saddle with fewer triangles than 32',
  adapt16.getMesh().numTri < adapt32.getMesh().numTri,
  `${adapt16.getMesh().numTri} vs ${adapt32.getMesh().numTri}`,
);

const adaptCopy = {
  numProp: adaptMesh.numProp,
  numTri: adaptMesh.numTri,
  vertProperties: new Float32Array(adaptMesh.vertProperties),
  triVerts: new Uint32Array(adaptMesh.triVerts),
};
const legacyCopy = {
  numProp: legacyMesh.numProp,
  numTri: legacyMesh.numTri,
  vertProperties: new Float32Array(legacyMesh.vertProperties),
  triVerts: new Uint32Array(legacyMesh.triVerts),
};
const stlAdapt = meshToStl(adaptCopy);
const stlLegacy = meshToStl(legacyCopy);
const stepAdapt = meshToStepBytes(adaptCopy);
console.log(
  `  export STL tris adaptive ${stlTriCount(stlAdapt)} (mesh ${adaptMesh.numTri}), `
  + `legacy ${stlTriCount(stlLegacy)} (mesh ${legacyMesh.numTri})`,
);
console.log(`  export STEP faces adaptive ${stepAdapt.faces} (mesh tris ${adaptMesh.numTri})`);
check(
  'STL writes every adaptive triangle',
  stlTriCount(stlAdapt) === adaptMesh.numTri,
);
check(
  'STL writes every legacy triangle',
  stlTriCount(stlLegacy) === legacyMesh.numTri,
);
const flat = meshPlanarFaces(triMesh([
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
]));
const kink = meshPlanarFaces(triMesh([
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  [[1, 0, 0], [1, 1, 0.05], [0, 1, 0]],
]));
check('STEP merges a coplanar pair', flat.faces.length === 1, `faces=${flat.faces.length}`);
check(
  'STEP keeps a 0.05 mm kink (finer than the loft tolerance)',
  kink.faces.length === 2 && 0.05 < eps,
  `faces=${kink.faces.length}`,
);
check(
  'STEP does not collapse the curved saddle into a handful of faces',
  stepAdapt.faces > adaptMesh.numTri * 0.25,
  `faces=${stepAdapt.faces} tris=${adaptMesh.numTri}`,
);

console.log('  post-run graphs');
const saddleGraphs = timeGraphs(adaptCopy, 'saddle adaptive open');
const tMove0 = performance.now();
const moved = adapt.translate([12, 0, 0]);
const moveKernelMs = performance.now() - tMove0;
const movedMesh = moved.getMesh();
const movedCopy = {
  numProp: movedMesh.numProp,
  vertProperties: new Float32Array(movedMesh.vertProperties),
  triVerts: new Uint32Array(movedMesh.triVerts),
};
console.log(`  move kernel ${moveKernelMs.toFixed(1)} ms`);
const moveGraphs = timeGraphs(movedCopy, 'saddle after Move');
check('part-switch graph cache hits', saddleGraphs.cached === true);
check(
  `saddle face+edge graphs under ${SADDLE_GRAPH_BUDGET_MS} ms`,
  saddleGraphs.faceMs + saddleGraphs.edgeMs < SADDLE_GRAPH_BUDGET_MS,
  `${(saddleGraphs.faceMs + saddleGraphs.edgeMs).toFixed(1)} ms`,
);
check(
  'Move rebuild stays under the same graph budget',
  moveGraphs.faceMs + moveGraphs.edgeMs < SADDLE_GRAPH_BUDGET_MS,
  `${(moveGraphs.faceMs + moveGraphs.edgeMs).toFixed(1)} ms`,
);

const frameSegs = 450;
const frame = Manifold.sphere(50, frameSegs);
const frameTris = frame.getMesh().numTri;
const frameMesh = frame.getMesh();
const frameCopy = {
  numProp: frameMesh.numProp,
  vertProperties: new Float32Array(frameMesh.vertProperties),
  triVerts: new Uint32Array(frameMesh.triVerts),
};
console.log(`  frame/fork stand-in: sphere r=50 segments=${frameSegs}, ${frameTris} tris`);
const frameGraphs = timeGraphs(frameCopy, 'frame-scale open');
check(
  'frame-scale graphs finish (coarse 15 s budget)',
  frameGraphs.total < 15000,
  `${frameGraphs.total.toFixed(1)} ms`,
);

if (process.env.LOFT_PERF_SHOTS === '1') {
  const shotDir = process.env.GOLDEN_SHOT_DIR || '/opt/cursor/artifacts';
  mkdirSync(shotDir, { recursive: true });
  const legacyShot = shotMesh(legacyCopy);
  const adaptShot = shotMesh(adaptCopy);
  const cam = cameraFrom(legacyShot);
  const fullLegacy = renderShot(legacyShot, cam, 640, 480);
  const fullAdapt = renderShot(adaptShot, cam, 640, 480);
  const nose = cameraFrom(legacyShot, [0, 0, 276], 40);
  const noseLegacy = renderShot(legacyShot, nose, 640, 480);
  const noseAdapt = renderShot(adaptShot, nose, 640, 480);
  writeFileSync(`${shotDir}/saddle-before-after.png`, encodePng(sideBySide(fullLegacy, fullAdapt)));
  writeFileSync(`${shotDir}/saddle-nose-before-after.png`, encodePng(sideBySide(noseLegacy, noseAdapt)));
  console.log(`  shots ${shotDir}/saddle-before-after.png`);
  console.log(`  shots ${shotDir}/saddle-nose-before-after.png`);
  check('before/after frames show the solid', fullLegacy.lit > 4000 && fullAdapt.lit > 4000);
  check('nose close-ups show the solid', noseLegacy.lit > 2000 && noseAdapt.lit > 2000);
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nloft perf golden: ok');

function shotMesh(mesh) {
  const np = mesh.numProp || 3;
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const nVert = Math.floor(vp.length / np);
  const verts = new Array(nVert);
  for (let i = 0; i < nVert; i++) verts[i] = [vp[i * np], vp[i * np + 1], vp[i * np + 2]];
  const triVerts = Array.from(tv);
  return { verts, triVerts };
}

function cameraFrom(mesh, centerOverride, extOverride) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  const center = centerOverride || [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const ext = extOverride || Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  const eye = [center[0] + ext * 1.15, center[1] - ext * 1.35, center[2] + ext * 0.72];
  return { center, eye, ext };
}

function renderShot(mesh, cam, w, h) {
  const { verts, triVerts } = mesh;
  const { center, eye } = cam;
  const fwd = norm(sub(center, eye));
  const right = norm(cross(fwd, [0, 0, 1]));
  const up = cross(right, fwd);
  const light = norm([0.3, -0.45, 0.84]);
  const camVerts = verts.map((v) => {
    const d = sub(v, eye);
    return [dot(d, right), dot(d, up), dot(d, fwd)];
  });
  let span = 0;
  for (const p of camVerts) span = Math.max(span, Math.abs(p[0]), Math.abs(p[1]));
  const scale = (Math.min(w, h) * 0.42) / (span || 1);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = 236;
    rgb[i * 3 + 1] = 238;
    rgb[i * 3 + 2] = 241;
  }
  const tris = [];
  for (let i = 0; i < triVerts.length; i += 3) {
    const ia = triVerts[i];
    const ib = triVerts[i + 1];
    const ic = triVerts[i + 2];
    const a = camVerts[ia];
    const b = camVerts[ib];
    const c = camVerts[ic];
    const n = cross(sub(verts[ib], verts[ia]), sub(verts[ic], verts[ia]));
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const nd = Math.abs(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl;
    tris.push({ z: (a[2] + b[2] + c[2]) / 3, shade: 0.42 + 0.58 * nd, p: [a, b, c] });
  }
  tris.sort((a, b) => a.z - b.z);
  for (const tri of tris) {
    const pts = tri.p.map((p) => [w / 2 + p[0] * scale, h / 2 - p[1] * scale]);
    fillTri(rgb, w, h, pts, tri.shade);
  }
  let lit = 0;
  for (let i = 0; i < w * h; i++) {
    if (rgb[i * 3] < 230) lit++;
  }
  return { rgb, w, h, lit };
}

function sideBySide(left, right) {
  const gap = 8;
  const w = left.w + gap + right.w;
  const h = left.h;
  const rgb = Buffer.alloc(w * h * 3, 210);
  blit(rgb, w, left.rgb, left.w, left.h, 0, 0);
  blit(rgb, w, right.rgb, right.w, right.h, left.w + gap, 0);
  return { rgb, w, h };
}

function blit(dst, dstW, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    const s0 = y * sw * 3;
    const d0 = ((y + oy) * dstW + ox) * 3;
    src.copy(dst, d0, s0, s0 + sw * 3);
  }
}

function fillTri(rgb, w, h, pts, shade) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const area = edgeFn(pts[0], pts[1], pts[2]);
  if (Math.abs(area) < 1e-6) return;
  const cr = Math.round(70 * shade + 40);
  const cg = Math.round(110 * shade + 50);
  const cb = Math.round(150 * shade + 40);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = [x + 0.5, y + 0.5];
      const w0 = edgeFn(pts[1], pts[2], p) / area;
      const w1 = edgeFn(pts[2], pts[0], p) / area;
      const w2 = edgeFn(pts[0], pts[1], p) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
        const i = (y * w + x) * 3;
        rgb[i] = cr;
        rgb[i + 1] = cg;
        rgb[i + 2] = cb;
      }
    }
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(shot) {
  const { w, h, rgb } = shot;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function edgeFn(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}
