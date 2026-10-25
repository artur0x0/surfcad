/**
 * Face-graph and edge-graph perf golden.
 *
 * The post-run pick maps. Counts are exact. Time ceilings are about 10× the
 * time measured on a quiet agent VM, so a CI runner can be slower without
 * failing a real regression. Edge time is feature edges + boundary topology
 * + annotation, the same sum the viewport reports as edgeGraphMs.
 */
import { performance } from 'node:perf_hooks';
import Module from '../../built/manifold.js';
import { buildMakeLoftDenseSolid } from '../../src/utils/makeLoft.js';
import { buildSolidGeometry, featureGraphFor } from '../../src/utils/partSolidCache.js';
import { warmFaceGraph } from '../../src/utils/selectFace.js';

function meshOf(solid) {
  const mesh = solid.getMesh();
  return {
    numProp: mesh.numProp,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    faceID: mesh.faceID ? new Uint32Array(mesh.faceID) : null,
    runIndex: mesh.runIndex ? new Uint32Array(mesh.runIndex) : null,
    runOriginalID: mesh.runOriginalID ? new Uint32Array(mesh.runOriginalID) : null,
    numRun: mesh.numRun,
  };
}

function timeGraphs(mesh) {
  const rawTris = mesh.triVerts.length / 3;
  const tGeom = performance.now();
  const { geometry, faceIDs } = buildSolidGeometry(mesh);
  const geomMs = performance.now() - tGeom;
  const tFace = performance.now();
  const face = warmFaceGraph(geometry, faceIDs);
  const faceMs = performance.now() - tFace;
  const tEdge = performance.now();
  const edge = featureGraphFor(geometry, faceIDs);
  const edgeWallMs = performance.now() - tEdge;
  const timing = edge.timing || {};
  const edgeMs = (timing.featureMs || 0) + (timing.topoMs || 0) + (timing.annotateMs || 0);
  geometry.dispose?.();
  return {
    rawTris,
    tris: face.triPatch.length,
    patches: face.patches.length,
    feature: edge.featureEdges.length,
    edges: edge.topo?.edges?.length || 0,
    faceMs,
    edgeMs,
    edgeWallMs,
    geomMs,
  };
}

function ellipse(a, b, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([a * Math.cos(t), b * Math.sin(t)]);
  }
  return pts;
}

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;

const plane = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const saddleSections = [[70, 28, 0], [62, 24, 160], [36, 16, 270], [14, 8, 285]].map(([a, b, z]) => ({
  plane: { ...plane, center: [0, 0, z] },
  contours: [ellipse(a, b)],
  offset: z,
}));

const cases = [
  {
    name: 'sphere102k',
    solid: () => Manifold.sphere(50, 450),
    rawTris: 102152,
    tris: 102152,
    patches: 1,
    feature: 0,
    edges: 0,
    faceMs: 3000,
    edgeMs: 800,
  },
  {
    name: 'sphere300k',
    solid: () => Manifold.sphere(50, 780),
    rawTris: 304200,
    tris: 304200,
    patches: 1,
    feature: 0,
    edges: 0,
    faceMs: 6000,
    edgeMs: 1500,
  },
  {
    name: 'saddle',
    // Uniform 128-ray saddle (buildMakeLoftDenseSolid): the dense mesh in the timing table.
    solid: () => buildMakeLoftDenseSolid(Manifold, CrossSection, saddleSections, {}),
    rawTris: 377708,
    tris: 377564,
    patches: 5,
    feature: 96,
    edges: 16,
    faceMs: 12000,
    edgeMs: 2000,
  },
];

let failed = 0;
for (const spec of cases) {
  const solid = spec.solid();
  const got = timeGraphs(meshOf(solid));
  solid.delete?.();
  const countsOk = got.rawTris === spec.rawTris
    && got.tris === spec.tris
    && got.patches === spec.patches
    && got.feature === spec.feature
    && got.edges === spec.edges;
  const timeOk = got.faceMs < spec.faceMs && got.edgeMs < spec.edgeMs;
  const line = `${spec.name} tris=${got.tris} patches=${got.patches} feature=${got.feature} edges=${got.edges} `
    + `face=${got.faceMs.toFixed(0)}ms edge=${got.edgeMs.toFixed(0)}ms`;
  if (!countsOk || !timeOk) {
    failed += 1;
    console.log(`FAIL ${line} (ceil face<${spec.faceMs} edge<${spec.edgeMs}, raw=${got.rawTris})`);
  } else {
    console.log(line);
  }
}

if (failed) {
  console.log(`graph perf golden: ${failed} failed`);
  process.exit(1);
}
console.log('graph perf golden: ok');
