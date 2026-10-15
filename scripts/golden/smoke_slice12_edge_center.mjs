#!/usr/bin/env node
/**
 * Slice 12 — Edge select + centered-hole fix.
 * - resolveHoleUV Center → u=0,v=0
 * - workplane snap emission
 * - selected-edge fillet compose
 * - selectEdge.js pure helpers (feature edges, dist clamp, toggle copy, pick)
 * - geometric: merged planar face center within epsilon (c4MeshData fix)
 */
import Module from '../../built/manifold.js';
import { BufferGeometry, Float32BufferAttribute, OrthographicCamera, Vector3 } from 'three';
import {
  composeHelperInsert,
  allocateUniqueName,
  HELPER_PALETTE_ITEMS,
} from '../../src/utils/helperPaletteSnippets.js';
import {
  classifySelectedFace,
  resolveHoleUV,
  resolveFaceModal,
  emitFaceWorkplaneLines,
  emitSelectedEdgeLines,
} from '../../src/utils/faceFeaturePlacement.js';
import {
  buildFeatureEdges,
  distPointToSegment,
  distPointToSegment2D,
  pickNearestEdge,
  pickNearestEdgeScreen,
  resolveEdgePickSlopPx,
  EDGE_PICK_SLOP_PX,
  EDGE_PICK_SLOP_COARSE_PX,
  EDGE_BLEND_SIZE_GUARD,
  projectWorldToCanvas,
  toggleEdgeSelection,
  popLastEdgeSelection,
  edgeKey,
  minSelectedEdgeLength,
  edgeBlendHardMax,
  edgeBlendFailsSizeGuard,
} from '../../src/utils/selectEdge.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-12 edge select + centered-hole smoke');

function _n(v) {
  const L = Math.hypot(...v) || 1;
  return v.map((x) => x / L);
}
function _dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function _sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function _mul(s, a) {
  return [s * a[0], s * a[1], s * a[2]];
}
function _cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function _len(v) {
  return Math.hypot(...v);
}

function frameToMatrix(frame) {
  const z = frame.normal;
  const x = frame.x;
  const y = frame.y;
  const c = frame.center;
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    c[0], c[1], c[2], 1,
  ];
}

/** Mirror of sandboxWorker c4MeshData planar merge (slice 12). */
function mergedFaces(m) {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const V = [];
  const nVerts = mesh.vertProperties.length / np;
  for (let i = 0; i < nVerts; i++) {
    V.push([mesh.vertProperties[i * np], mesh.vertProperties[i * np + 1], mesh.vertProperties[i * np + 2]]);
  }
  const faceMap = new Map();
  for (let i = 0; i < mesh.numTri; i++) {
    const fid = mesh.faceID[i];
    if (!faceMap.has(fid)) faceMap.set(fid, []);
    faceMap.get(fid).push(i);
  }
  const faces = [];
  for (const [fid, tris] of faceMap) {
    const cn = [0, 0, 0];
    const c = [0, 0, 0];
    let areaSum = 0;
    for (const t of tris) {
      const v0 = V[mesh.triVerts[t * 3]];
      const v1 = V[mesh.triVerts[t * 3 + 1]];
      const v2 = V[mesh.triVerts[t * 3 + 2]];
      const cxv = _cross(_sub(v1, v0), _sub(v2, v0));
      const area = 0.5 * _len(cxv);
      const tn = _n(cxv);
      cn[0] += tn[0];
      cn[1] += tn[1];
      cn[2] += tn[2];
      const tc = [
        (v0[0] + v1[0] + v2[0]) / 3,
        (v0[1] + v1[1] + v2[1]) / 3,
        (v0[2] + v1[2] + v2[2]) / 3,
      ];
      c[0] += tc[0] * area;
      c[1] += tc[1] * area;
      c[2] += tc[2] * area;
      areaSum += area;
    }
    faces.push({
      id: fid,
      tris,
      normal: _n(cn),
      center: areaSum > 0 ? _mul(1 / areaSum, c) : [0, 0, 0],
    });
  }
  const nF = faces.length;
  const parent = Array.from({ length: nF }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const t2f = new Int32Array(mesh.numTri).fill(-1);
  for (let fi = 0; fi < nF; fi++) for (const t of faces[fi].tris) t2f[t] = fi;
  const cosPlanar = Math.cos((0.1 * Math.PI) / 180); // match sandboxWorker c4MeshData merge
  const edgeMapM = new Map();
  for (let t = 0; t < mesh.numTri; t++) {
    const vs = [mesh.triVerts[t * 3], mesh.triVerts[t * 3 + 1], mesh.triVerts[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const u = vs[k];
      const w = vs[(k + 1) % 3];
      const key = u < w ? u * 1e9 + w : w * 1e9 + u;
      if (!edgeMapM.has(key)) edgeMapM.set(key, []);
      edgeMapM.get(key).push(t);
    }
  }
  for (const trisE of edgeMapM.values()) {
    if (trisE.length !== 2) continue;
    const f0 = t2f[trisE[0]];
    const f1 = t2f[trisE[1]];
    if (f0 < 0 || f1 < 0 || f0 === f1) continue;
    const A = faces[f0];
    const B = faces[f1];
    if (_dot(A.normal, B.normal) < cosPlanar) continue;
    const offA = _dot(A.center, A.normal);
    const offB = _dot(B.center, A.normal);
    if (Math.abs(offA - offB) > 1e-3) continue;
    union(f0, f1);
  }
  const groups = new Map();
  for (let fi = 0; fi < nF; fi++) {
    const r = find(fi);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(fi);
  }
  const merged = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      merged.push(faces[members[0]]);
      continue;
    }
    const cn = [0, 0, 0];
    const c = [0, 0, 0];
    let areaSum = 0;
    const trisSub = [];
    for (const fi of members) {
      for (const t of faces[fi].tris) {
        trisSub.push(t);
        const v0 = V[mesh.triVerts[t * 3]];
        const v1 = V[mesh.triVerts[t * 3 + 1]];
        const v2 = V[mesh.triVerts[t * 3 + 2]];
        const cxv = _cross(_sub(v1, v0), _sub(v2, v0));
        const area = 0.5 * _len(cxv);
        const tn = _n(cxv);
        cn[0] += tn[0];
        cn[1] += tn[1];
        cn[2] += tn[2];
        const tc = [
          (v0[0] + v1[0] + v2[0]) / 3,
          (v0[1] + v1[1] + v2[1]) / 3,
          (v0[2] + v1[2] + v2[2]) / 3,
        ];
        c[0] += tc[0] * area;
        c[1] += tc[1] * area;
        c[2] += tc[2] * area;
        areaSum += area;
      }
    }
    merged.push({
      tris: trisSub,
      normal: _n(cn),
      center: _mul(1 / areaSum, c),
    });
  }
  return merged;
}


const planarFace = {
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

// ── resolveHoleUV ──────────────────────────────────────────────
{
  const face = classifySelectedFace(planarFace);
  const c = resolveHoleUV({ placement: 'center', u: 9, v: 9 }, face);
  check('Center mode forces u=0,v=0', c.mode === 'center' && c.u === 0 && c.v === 0);
  const custom = resolveHoleUV({ placement: 'custom', u: 3, v: -2 }, face);
  check('custom UV respected', custom.mode === 'custom' && custom.u === 3 && custom.v === -2);
  const def = resolveHoleUV({ placement: 'center' }, face);
  check('explicit center placement', def.mode === 'center' && def.u === 0 && def.v === 0);
  const legacy = resolveHoleUV({ u: 4, v: 5 }, face);
  check('legacy u/v without placement', legacy.mode === 'literal' && legacy.u === 4 && legacy.v === 5);
}

// ── Workplane snap emission ────────────────────────────────────
{
  const face = classifySelectedFace(planarFace);
  const names = new Set();
  const { lines } = emitFaceWorkplaneLines('part', face, names, allocateUniqueName);
  const joined = lines.join('\n');
  check('snap uses _pc pick center', /_pc/.test(joined));
  check('snap uses _off (not _d clash)', /_off/.test(joined) && !/const _d = \(_pc/.test(joined));
  check('snap mutates fr.center', /fr\.center\s*=/.test(joined) || /\w+\.center\s*=/.test(joined));
}

// ── Compose Center hole ────────────────────────────────────────
{
  const face = classifySelectedFace(planarFace);
  const buf = composeHelperInsert(
    '',
    'hole',
    null,
    { dia: 6, placement: 'center', through: true },
    face,
  );
  // Slice 63 made Hole emit the typed helper (clearanceHole / tapDrillHole)
  // rather than bare hole(). What this guards is the PLACEMENT: Center → u=0,
  // v=0 — so match any hole-family call, not one signature.
  check('center hole u,v 0,0', /[Hh]ole\(\s*part,\s*fr,\s*0,\s*0,/.test(buf));
  check('center hole has snap _off', /_off/.test(buf));
  check('center hole no illegal top', !/\btop\b/.test(buf));
  check('center hole facesByNormal', /facesByNormal/.test(buf));
}

// ── Edge multi-select fillet ───────────────────────────────────
{
  const edges = [
    { mid: [20, -15, 0], va: [20, -15, -10], vb: [20, -15, 10] },
    { mid: [-20, 15, 0], va: [-20, 15, -10], vb: [-20, 15, 10] },
  ];
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'filletEdges');
  const resolved = resolveFaceModal(item, null, edges);
  check('fillet with edges → params', resolved.mode === 'params');
  check('fillet title mentions edges', /2 edges/.test(resolved.item?.title || ''));

  const refuse = resolveFaceModal(item, null, []);
  check('fillet no edges → refuse', refuse.mode === 'refuse');
  check('refuse mentions Edge pick', /Edge pick/i.test(refuse.message || ''));

  const names = new Set();
  const emitted = emitSelectedEdgeLines('part', edges, names, allocateUniqueName);
  check('emitSelectedEdgeLines ok', emitted.ok);
  check('emit filters convexEdges by mids', /convexEdges/.test(emitted.lines.join('\n')) && /_mids/.test(emitted.lines.join('\n')));

  const buf = composeHelperInsert(
    '',
    'filletEdges',
    null,
    { strategy: 'planar', radius: 2.5, sphericalCorners: true, edgeScope: 'selected' },
    null,
    edges,
  );
  check('fillet snippet uses selEdges', /selEdges/.test(buf));
  check('fillet snippet filletEdges call', /filletEdges\(/.test(buf));
  check('fillet snippet mid literals', /\[20,\s*-15,\s*0\]/.test(buf));
  console.log('\n--- example selected-edge fillet ---\n' + buf + '\n---');
}


// ── selectEdge.js pure helpers ─────────────────────────────────
{
  console.log('\nselectEdge helpers');

  const makeIndexed = (positions, indices) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    return g;
  };
  
  // ── buildFeatureEdges ──────────────────────────────────────────
  {
    // Welded unit cube [-1,1]^3 — 12 convex 90° edges; every edge shared by exactly 2 tris
    const cubePos = [
      -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ];
    const cubeIdx = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      2, 6, 7, 2, 7, 3,
      0, 3, 7, 0, 7, 4,
      1, 5, 6, 1, 6, 2,
    ];
    const cubeEdges = buildFeatureEdges(makeIndexed(cubePos, cubeIdx));
    check('unit cube → 12 feature edges', cubeEdges.length === 12, `got ${cubeEdges.length}`);
    check(
      'cube edges all length 2',
      cubeEdges.every((e) => Math.abs(e.length - 2) < 1e-9),
    );
  
    // Flat subdivided quad: shared diagonal is coplanar seam (dot > cosMin);
    // boundary edges have tris.length !== 2 → dropped
    const quadPos = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0];
    const quadIdx = [0, 1, 2, 0, 2, 3];
    const quadEdges = buildFeatureEdges(makeIndexed(quadPos, quadIdx));
    check(
      'flat-subdivided quad → 0 seams',
      quadEdges.length === 0,
      `got ${quadEdges.length}`,
    );
  
    // 45° crease: n0·n1 = cos45 < cos(2°) → crease kept; outer edges boundary-dropped
    const s45 = Math.SQRT1_2;
    const creasePos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, s45, s45];
    const creaseIdx = [0, 1, 2, 0, 1, 3];
    const creaseEdges = buildFeatureEdges(makeIndexed(creasePos, creaseIdx));
    check('45° crease → the crease', creaseEdges.length === 1, `got ${creaseEdges.length}`);
    check('45° crease is shared edge 0-1', creaseEdges[0]?.key === '0-1');
  
    // Boundary-only mesh: tris.length !== 2 on every edge
    const lone = buildFeatureEdges(makeIndexed([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]));
    check('tris.length !== 2 boundary drop', lone.length === 0, `got ${lone.length}`);
  
    // DEFAULT_FEATURE_DEG = 2° → cosMin = cos(2°); seams with n0·n1 > cosMin drop
    const cosMin = Math.cos((2 * Math.PI) / 180);
    check('DEFAULT_FEATURE_DEG cosMin ≈ cos(2°)', Math.abs(cosMin - 0.999390827) < 1e-6);
    const fold = (deg) => {
      const a = (deg * Math.PI) / 180;
      return makeIndexed(
        [0, 0, 0, 2, 0, 0, 1, 1, 0, 1, Math.cos(a), Math.sin(a)],
        [0, 1, 2, 0, 1, 3],
      );
    };
    check('crease 0.5° (< 2°) filtered as seam', buildFeatureEdges(fold(0.5)).length === 0);
    check('crease 5° (> 2°) kept as feature', buildFeatureEdges(fold(5)).length === 1);
  }
  
  // ── distPointToSegment ─────────────────────────────────────────
  {
    const va = [0, 0, 0];
    const vb = [1, 0, 0];
    check('dist t<0 clamps to endpoint va', Math.abs(distPointToSegment([-1, 0, 0], va, vb) - 1) < 1e-12);
    check('dist t>1 clamps to endpoint vb', Math.abs(distPointToSegment([2, 0, 0], va, vb) - 1) < 1e-12);
    check('dist interior perpendicular', Math.abs(distPointToSegment([0.5, 1, 0], va, vb) - 1) < 1e-12);
    check(
      'dist degenerate segment → |p−va|',
      Math.abs(distPointToSegment([3, 4, 0], [0, 0, 0], [0, 0, 0]) - 5) < 1e-12,
    );
  }
  
  // ── pickNearestEdge ────────────────────────────────────────────
  {
    const sample = [
      {
        key: '0-1',
        a: 0,
        b: 1,
        va: [0, 0, 0],
        vb: [2, 0, 0],
        mid: [1, 0, 0],
        length: 2,
        tangent: [1, 0, 0],
      },
      {
        key: '2-3',
        a: 2,
        b: 3,
        va: [0, 5, 0],
        vb: [2, 5, 0],
        mid: [1, 5, 0],
        length: 2,
        tangent: [1, 0, 0],
      },
    ];
    check('pickNearestEdge within maxDist', pickNearestEdge(sample, [1, 0.1, 0], 0.5)?.key === '0-1');
    check('pickNearestEdge beyond maxDist → null', pickNearestEdge(sample, [1, 0.1, 0], 0.05) === null);
    check('pickNearestEdge empty → null', pickNearestEdge([], [0, 0, 0], 1) === null);
    // d === maxDist uses strict < → null (tie at boundary)
    check(
      'pickNearestEdge ties/maxDist rejection → null',
      pickNearestEdge(sample, [1, 0.5, 0], 0.5) === null,
    );
  }
  
  // ── screen-space pick (hotfix fat hit target) ─────────────────
  {
    check('distPointToSegment2D interior', Math.abs(distPointToSegment2D(0.5, 1, 0, 0, 1, 0) - 1) < 1e-12);
    check('distPointToSegment2D endpoint clamp', Math.abs(distPointToSegment2D(-1, 0, 0, 0, 1, 0) - 1) < 1e-12);
    check('resolveEdgePickSlopPx fine', resolveEdgePickSlopPx({ coarse: false }) === EDGE_PICK_SLOP_PX);
    check('resolveEdgePickSlopPx coarse', resolveEdgePickSlopPx({ coarse: true }) === EDGE_PICK_SLOP_COARSE_PX);
    check('resolveEdgePickSlopPx override', resolveEdgePickSlopPx({ slopPx: 28 }) === 28);
    check('EDGE_PICK_SLOP_PX in 24–40', EDGE_PICK_SLOP_PX >= 24 && EDGE_PICK_SLOP_PX <= 40);
    check('EDGE_PICK_SLOP_COARSE_PX in 24–40', EDGE_PICK_SLOP_COARSE_PX >= 24 && EDGE_PICK_SLOP_COARSE_PX <= 40);

    const cam = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    const W = 200;
    const H = 200;
    // World edge along X at z=0 → projects across canvas horizontal midline.
    const edges = [
      {
        key: '0-1',
        a: 0,
        b: 1,
        va: [-20, 0, 0],
        vb: [20, 0, 0],
        mid: [0, 0, 0],
        length: 40,
        tangent: [1, 0, 0],
      },
      {
        key: '2-3',
        a: 2,
        b: 3,
        va: [-20, 30, 0],
        vb: [20, 30, 0],
        mid: [0, 30, 0],
        length: 40,
        tangent: [1, 0, 0],
      },
    ];

    const mid = projectWorldToCanvas(cam, [0, 0, 0], W, H);
    check('projectWorldToCanvas center on canvas', !!mid && Math.abs(mid.x - 100) < 1 && Math.abs(mid.y - 100) < 1);

    // Pointer 20px above the first edge midline — within 32px slop, far from second edge.
    const hit = pickNearestEdgeScreen(edges, cam, W, H, 100, 100 - 20, 32);
    check('pickNearestEdgeScreen within px slop', hit?.key === '0-1');

    const miss = pickNearestEdgeScreen(edges, cam, W, H, 100, 100 - 20, 10);
    check('pickNearestEdgeScreen beyond px slop → null', miss === null);

    // Empty-space silhouette: pointer not on a mesh face but near projected edge.
    const sil = pickNearestEdgeScreen(edges, cam, W, H, 100, 100 - 28, 32);
    check('pickNearestEdgeScreen silhouette near-miss', sil?.key === '0-1');

    check('pickNearestEdgeScreen empty → null', pickNearestEdgeScreen([], cam, W, H, 100, 100, 32) === null);

    // Cover Vector3 `.project` path (app passes scratch Vector3s from Viewport).
    const hitScratch = pickNearestEdgeScreen(edges, cam, W, H, 100, 100 - 20, 32, {
      projectScratchA: new Vector3(),
      projectScratchB: new Vector3(),
    });
    check('pickNearestEdgeScreen Vector3.project scratch path', hitScratch?.key === '0-1');
  }

  // ── toggleEdgeSelection ────────────────────────────────────────
  {
    const src = {
      key: '0-1',
      a: 0,
      b: 1,
      va: [0, 0, 0],
      vb: [1, 0, 0],
      mid: [0.5, 0, 0],
      length: 1,
      tangent: [1, 0, 0],
    };
    const once = toggleEdgeSelection([], src);
    check('toggle-in length 1', once.length === 1 && edgeKey(once[0]) === '0-1');
    check('toggle-in is copy (not same ref)', once[0] !== src && once[0].va !== src.va);
    once[0].va[0] = 99;
    check('mutating toggled va does not affect source', src.va[0] === 0);
    const back = toggleEdgeSelection(once, src);
    check('toggle-out round-trips to empty', back.length === 0);
    check('toggle-out does not mutate prior list', once.length === 1);
  }
}

// ── Geometric: planar face center after coplanar merge ─────────
{
  console.log('\ngeometric face-center (c4MeshData merge contract)');
  const wasm = await Module();
  wasm.setup();
  const { Manifold } = wasm;

  const cube = Manifold.cube([40, 30, 20], true);
  const faces = mergedFaces(cube);
  check('cube merges to 6 faces', faces.length === 6, `got ${faces.length}`);
  const top = faces.find((f) => f.normal[2] > 0.9);
  check('top face exists', !!top);
  const eps = 1e-6;
  check(
    'top center at [0,0,10] within eps',
    top && Math.hypot(top.center[0], top.center[1]) < eps && Math.abs(top.center[2] - 10) < eps,
    top ? `center=${top.center}` : '',
  );

  const frCenter = top.center;
  const probeR = 1;
  const holeR = 3;
  const frame = { center: frCenter, normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
  const span = 30;
  const w0 = 1 - span / 2;
  const n = frame.normal;
  const c = frame.center;
  const tm = frameToMatrix({
    center: [c[0] + n[0] * w0, c[1] + n[1] * w0, c[2] + n[2] * w0],
    x: frame.x,
    y: frame.y,
    normal: n,
  });
  const cut = Manifold.cylinder(span, holeR, holeR, 32, true).transform(tm);
  const holed = Manifold.difference(cube, cut);
  const probe = Manifold.cylinder(25, probeR, probeR, 16, true);
  const interVol = Manifold.intersection(holed, probe).volume();
  check('hole at face center: probe along axis nearly empty', interVol < 0.5, `vol=${interVol}`);

  const badCut = Manifold.cylinder(span, holeR, holeR, 32, true).transform(
    frameToMatrix({
      center: [-6.6667, -5, 10 + w0],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    }),
  );
  const badHoled = Manifold.difference(Manifold.cube([40, 30, 20], true), badCut);
  const badInter = Manifold.intersection(badHoled, Manifold.cylinder(25, probeR, probeR, 16, true)).volume();
  check('pre-fix triangle-centroid miss leaves probe solid', badInter > 10, `vol=${badInter}`);
}

// ── Fillet and chamfer size is a fixed 2 mm ────────────────────
{
  console.log('\nfillet and chamfer size is 2 mm');
  const L = 40;
  check('hard max under size guard', edgeBlendHardMax(L) < EDGE_BLEND_SIZE_GUARD * L);
  check('r=22.51 fails guard on L=40', edgeBlendFailsSizeGuard(22.51, L));
  check('the 2 mm seed passes the planar guard on L=40', !edgeBlendFailsSizeGuard(2, L));

  const edges = [
    { mid: [0, 0, 0], va: [0, 0, 0], vb: [40, 0, 0], length: 40 },
  ];
  check('minSelectedEdgeLength', minSelectedEdgeLength(edges) === 40);
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'filletEdges');
  const resolved = resolveFaceModal(item, null, edges);
  const radiusParam = resolved.item?.params?.find((p) => p.name === 'radius');
  check('resolveFaceModal seeds 2 mm', radiusParam?.default === 2, `got ${radiusParam?.default}`);
  check('resolveFaceModal slider is 0.5 to 25 mm',
    radiusParam?.min === 0.5 && radiusParam?.max === 25, `min ${radiusParam?.min} max ${radiusParam?.max}`);

  const chamferItem = HELPER_PALETTE_ITEMS.find((h) => h.id === 'chamferEdges');
  const cResolved = resolveFaceModal(chamferItem, null, edges);
  const cParam = cResolved.item?.params?.find((p) => p.name === 'chamfer');
  check('chamfer uses the same 2 mm seed and slider',
    cParam?.default === 2 && cParam?.min === 0.5 && cParam?.max === 25,
    `got ${cParam?.default} ${cParam?.min} ${cParam?.max}`);

  const list = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  check('popLastEdgeSelection drops last', popLastEdgeSelection(list).map((e) => e.key).join(',') === 'a,b');
}

// ── Hotfix: second fillet / hole after fillet stays parseable ─
{
  console.log('\npost-fillet sequential insert');
  const e1 = [{ mid: [20, 15, 10], va: [20, 0, 10], vb: [20, 30, 10], length: 30 }];
  const e2 = [{ mid: [-20, 15, 10], va: [-20, 0, 10], vb: [-20, 30, 10], length: 30 }];
  const face = {
    type: 'planar', center: [0, 0, 10], normal: [0, 0, 1],
    area: 100, triangleCount: 2, selectionMode: 'coplanar',
  };
  let buf = composeHelperInsert('', 'cube', null, { width: 40, depth: 30, height: 20, center: true });
  buf = composeHelperInsert(
    buf, 'filletEdges', null,
    { strategy: 'planar', radius: 3, sphericalCorners: true, edgeScope: 'selected', body: 'part' },
    null, e1,
  );
  const twice = composeHelperInsert(
    buf, 'filletEdges', null,
    { strategy: 'planar', radius: 2, sphericalCorners: true, edgeScope: 'selected', body: 'part' },
    null, e2,
  );
  check('2nd fillet compose ok', typeof twice === 'string');
  check('2nd fillet uses selEdges2 + _mids2', /selEdges2/.test(twice) && /_mids2/.test(twice));
  try {
    new Function(twice);
    check('2nd fillet parseable (Function)', true);
  } catch (e) {
    check('2nd fillet parseable (Function)', false, String(e.message || e));
  }

  const withHole = composeHelperInsert(
    buf, 'hole', null,
    { dia: 6, placement: 'center', through: true, body: 'part' },
    face, null,
  );
  check('fillet→hole compose ok', typeof withHole === 'string' && /[Hh]ole\s*\(/.test(withHole));
  try {
    new Function(withHole);
    check('fillet→hole parseable (Function)', true);
  } catch (e) {
    check('fillet→hole parseable (Function)', false, String(e.message || e));
  }

  check(
    'soft-fail empty edges → null',
    composeHelperInsert(
      buf, 'filletEdges', null,
      { strategy: 'planar', radius: 3, sphericalCorners: true, edgeScope: 'selected', body: 'part' },
      null, [],
    ) === null,
  );
}

if (failed) {
  console.log(`\nFAILED: ${failed}`);
  process.exit(1);
}

console.log('\nAll slice-12 edge + center-hole checks passed.');
