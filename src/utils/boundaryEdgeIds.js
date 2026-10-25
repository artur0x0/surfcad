/**
 * Face / boundary-edge ids for Fillet mode (edge-spec A).
 *
 * Ids are assigned from the current mesh:
 * - A face id is the minimum Manifold `faceID` in a coplanar connected
 *   group (0.1° / same plane — same gate as c4MeshData's planar merge).
 * - A boundary-edge id groups triangle segments that share one unordered
 *   face pair and connect through vertices. Collinear tessellation of one
 *   CAD edge is one id; a curved rim (each facet its own face) stays many.
 *
 * Manifold faceID is provenance, not an eternal CAD edge. Booleans can
 * merge or split faces, so a later script run that no longer has the same
 * ids fails loud ("re-pick edges") instead of guessing.
 *
 * Pick / overlay candidates are design edges only. A boundary is dropped when
 * the dihedral is shallower than BOUNDARY_SHALLOW_DEG (fillet-arc steps,
 * smooth loft seams) or the smaller face is below BOUNDARY_SMALL_FACE_FRAC
 * of the largest face (blend facets and their end-cap chords). Sharp edges
 * between substantial faces stay, and ids are assigned only to that set.
 *
 * Contour references on a box use a second pass (`indexContourBoundaries`).
 * That pass keeps the run ordinal in the face id, because a boolean restarts
 * Manifold face ids, and it keeps a sharp edge whose mate is thin. Sheet
 * metal contour edges do not come from here. A flange edge can be one naked
 * triangle this pass never lists, and `sheetContourEdges` names the edges
 * from the sheet model instead. Fillet keeps using this pass.
 */

import { sameLocalSegment } from './activePartOverlay.js';
import { meshFrames } from './meshTopology.js';

const PLANAR_COS = Math.cos((0.1 * Math.PI) / 180);
const FEATURE_COS = Math.cos((2 * Math.PI) / 180);

/** Tessellation seam / fillet-arc step. 90° box corners stay; ~4–11° facets do not. */
export const BOUNDARY_SHALLOW_DEG = 15;
/**
 * Smaller adjacent face vs the largest face on the solid.
 * A 12-seg fillet facet on a 40×30 box is ~3% of the big face; loft wall
 * facets on a circle–circle loft are ~13%. 5% drops the blend, keeps the rim.
 */
export const BOUNDARY_SMALL_FACE_FRAC = 0.05;
/** Hard cap so Fillet mode cannot allocate a sprite per micro-triangle. */
export const FILLET_OVERLAY_LABEL_CAP = 240;
/**
 * Contour face ids on a multi-run solid are `runOrdinal * stride + minFaceId`.
 * A single-run solid keeps the minimum Manifold face id, so a box reference
 * stays the same number. Face ids on a real mesh sit far below this stride.
 */
export const CONTOUR_FACE_RUN_STRIDE = 1 << 20;

function contourRunOrdinals(triSource, triRaw, numTri, encode) {
  if (!encode || !triSource || triSource.length < numTri) return null;
  let maxRaw = 0;
  for (let t = 0; t < numTri; t++) {
    const raw = triRaw[t];
    if (raw > maxRaw) maxRaw = raw;
  }
  if (!(maxRaw < CONTOUR_FACE_RUN_STRIDE)) return null;
  const map = new Map();
  const out = new Int32Array(numTri);
  let next = 0;
  for (let t = 0; t < numTri; t++) {
    const raw = triSource[t];
    let ord = map.get(raw);
    if (ord === undefined) {
      ord = next;
      next += 1;
      map.set(raw, ord);
    }
    out[t] = ord;
  }
  return next > 1 ? out : null;
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
function norm(v) {
  const L = len(v) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

function findOf(parent) {
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
  return { find, union };
}

/**
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number>, faceIDs: ArrayLike<number> }} mesh
 * @returns {{ faces: object[], edges: object[] }}
 */
export function indexBoundaryEdges(mesh, opts = {}) {
  const options = opts || {};
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  const faceIDs = mesh?.faceIDs;
  if (!positions || !indices || !faceIDs) return { faces: [], edges: [] };
  const numTri = Math.floor(indices.length / 3);
  if (faceIDs.length < numTri || numTri < 1) return { faces: [], edges: [] };

  const posAt = (i) => {
    const o = i * 3;
    return [positions[o], positions[o + 1], positions[o + 2]];
  };

  const frames = meshFrames(positions, indices, 3);
  const triNx = frames.bnx;
  const triNy = frames.bny;
  const triNz = frames.bnz;
  const triArea = frames.area;
  const triCx = frames.cx;
  const triCy = frames.cy;
  const triCz = frames.cz;
  const nxOf = (t) => triNx[t];
  const nyOf = (t) => triNy[t];
  const nzOf = (t) => triNz[t];
  const triRaw = new Float64Array(numTri);
  for (let t = 0; t < numTri; t++) {
    const raw = Number(faceIDs[t]);
    triRaw[t] = Number.isFinite(raw) ? raw : t;
  }
  const ordinals = contourRunOrdinals(mesh?.triSource, triRaw, numTri, options.encodeRuns === true);
  const keepThin = options.keepThin === true;

  const parent = new Array(numTri);
  for (let i = 0; i < numTri; i++) parent[i] = i;
  const { find, union } = findOf(parent);
  const { pairN, pairTri0, pairTri1 } = frames;
  for (let p = 0; p < pairN; p++) {
    const i0 = pairTri0[p];
    const i1 = pairTri1[p];
    const n0x = nxOf(i0);
    const n0y = nyOf(i0);
    const n0z = nzOf(i0);
    const ndp = n0x * nxOf(i1) + n0y * nyOf(i1) + n0z * nzOf(i1);
    if (ndp < PLANAR_COS) continue;
    const v0 = indices[i0 * 3] * 3;
    const v1 = indices[i1 * 3] * 3;
    const offA = positions[v0] * n0x + positions[v0 + 1] * n0y + positions[v0 + 2] * n0z;
    const offB = positions[v1] * n0x + positions[v1 + 1] * n0y + positions[v1 + 2] * n0z;
    if (Math.abs(offA - offB) > 1e-3) continue;
    union(i0, i1);
  }

  const faceOfTri = new Int32Array(numTri);
  const rootFi = new Int32Array(numTri);
  rootFi.fill(-1);
  let faceCount = 0;
  for (let i = 0; i < numTri; i++) {
    const r = find(i);
    let fi = rootFi[r];
    if (fi < 0) {
      fi = faceCount;
      faceCount += 1;
      rootFi[r] = fi;
    }
    faceOfTri[i] = fi;
  }
  const areaSum = new Float64Array(faceCount);
  const cxS = new Float64Array(faceCount);
  const cyS = new Float64Array(faceCount);
  const czS = new Float64Array(faceCount);
  const nsx = new Float64Array(faceCount);
  const nsy = new Float64Array(faceCount);
  const nsz = new Float64Array(faceCount);
  const minRaw = new Float64Array(faceCount);
  minRaw.fill(Infinity);
  const runOf = new Int32Array(faceCount);
  const firstTri = new Int32Array(faceCount);
  firstTri.fill(-1);
  for (let i = 0; i < numTri; i++) {
    const fi = faceOfTri[i];
    if (firstTri[fi] < 0) firstTri[fi] = i;
    const raw = triRaw[i];
    if (raw < minRaw[fi]) {
      minRaw[fi] = raw;
      runOf[fi] = ordinals ? ordinals[i] : 0;
    }
    const area = triArea[i];
    areaSum[fi] += area;
    cxS[fi] += triCx[i] * area;
    cyS[fi] += triCy[i] * area;
    czS[fi] += triCz[i] * area;
    nsx[fi] += nxOf(i) * area;
    nsy[fi] += nyOf(i) * area;
    nsz[fi] += nzOf(i) * area;
  }
  const faces = new Array(faceCount);
  for (let fi = 0; fi < faceCount; fi++) {
    const nLen = Math.hypot(nsx[fi], nsy[fi], nsz[fi]) || 1;
    let localId = minRaw[fi];
    if (!Number.isFinite(localId)) localId = 0;
    const area = areaSum[fi];
    const seed = firstTri[fi];
    faces[fi] = {
      id: ordinals && localId < CONTOUR_FACE_RUN_STRIDE
        ? runOf[fi] * CONTOUR_FACE_RUN_STRIDE + localId
        : localId,
      area,
      center: area > 1e-18
        ? [cxS[fi] / area, cyS[fi] / area, czS[fi] / area]
        : [triCx[seed], triCy[seed], triCz[seed]],
      normal: [nsx[fi] / nLen, nsy[fi] / nLen, nsz[fi] / nLen],
    };
  }

  let maxAreaPre = 0;
  for (let fi = 0; fi < faces.length; fi++) {
    const a = Number(faces[fi].area) || 0;
    if (a > maxAreaPre) maxAreaPre = a;
  }
  const smallLimitPre = BOUNDARY_SMALL_FACE_FRAC * maxAreaPre;
  const cosBoundary = Math.cos((BOUNDARY_SHALLOW_DEG * Math.PI) / 180);
  const segments = [];
  const { pairLo, pairHi } = frames;
  for (let p = 0; p < pairN; p++) {
    const i0 = pairTri0[p];
    const i1 = pairTri1[p];
    const f0 = faceOfTri[i0];
    const f1 = faceOfTri[i1];
    if (f0 === f1) continue;
    const tdot = nxOf(i0) * nxOf(i1) + nyOf(i0) * nyOf(i1) + nzOf(i0) * nzOf(i1);
    if (tdot > FEATURE_COS) continue;
    const nA = faces[f0].normal;
    const nB = faces[f1].normal;
    const nd = Math.min(1, Math.max(-1, nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]));
    // acos is decreasing, so dihedral >= 15° is exactly nd <= cos(15°).
    if (nd > cosBoundary) continue;
    const minFaceArea = Math.min(faces[f0].area || 0, faces[f1].area || 0);
    if (!keepThin && maxAreaPre > 0 && minFaceArea < smallLimitPre) continue;
    const dihedralDeg = Math.acos(nd) * 180 / Math.PI;
    const ia = pairLo[p];
    const ib = pairHi[p];
    const va = posAt(ia);
    const vb = posAt(ib);
    const L = Math.hypot(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]);
    if (!(L > 1e-9)) continue;
    const faceA = faces[f0].id;
    const faceB = faces[f1].id;
    segments.push({
      key: `${ia}-${ib}`,
      a: ia,
      b: ib,
      va,
      vb,
      length: L,
      mid: [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2],
      faceA,
      faceB,
      pairKey: faceA < faceB ? `${faceA}:${faceB}` : `${faceB}:${faceA}`,
      dihedralDeg,
      minFaceArea,
      n0: nA.slice(),
      n1: nB.slice(),
    });
  }

  const byPair = new Map();
  for (const seg of segments) {
    if (!byPair.has(seg.pairKey)) byPair.set(seg.pairKey, []);
    byPair.get(seg.pairKey).push(seg);
  }

  const boundaries = [];
  for (const group of byPair.values()) {
    const p = group.map((_, i) => i);
    const uf = findOf(p);
    const vertTo = new Map();
    group.forEach((seg, i) => {
      for (const v of [seg.a, seg.b]) {
        if (!vertTo.has(v)) vertTo.set(v, []);
        vertTo.get(v).push(i);
      }
    });
    for (const list of vertTo.values()) {
      for (let k = 1; k < list.length; k++) uf.union(list[0], list[k]);
    }
    const comps = new Map();
    group.forEach((seg, i) => {
      const r = uf.find(i);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(seg);
    });
    for (const segs of comps.values()) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let total = 0;
      for (const seg of segs) {
        cx += seg.mid[0] * seg.length;
        cy += seg.mid[1] * seg.length;
        cz += seg.mid[2] * seg.length;
        total += seg.length;
      }
      boundaries.push({
        faceA: segs[0].faceA,
        faceB: segs[0].faceB,
        length: total,
        dihedralDeg: segs[0].dihedralDeg,
        minFaceArea: segs[0].minFaceArea,
        n0: segs[0].n0,
        n1: segs[0].n1,
        mid: total > 0
          ? [cx / total, cy / total, cz / total]
          : segs[0].mid.slice(),
        segments: segs.map((seg) => ({
          key: seg.key,
          a: seg.a,
          b: seg.b,
          va: seg.va.slice(),
          vb: seg.vb.slice(),
          length: seg.length,
          mid: seg.mid.slice(),
        })),
      });
    }
  }

  const maxArea = faces.reduce((m, f) => Math.max(m, Number(f.area) || 0), 0);
  const smallLimit = BOUNDARY_SMALL_FACE_FRAC * maxArea;
  const eligible = boundaries.filter((edge) => {
    if (!(edge.dihedralDeg >= BOUNDARY_SHALLOW_DEG)) return false;
    if (keepThin) return true;
    if (!(maxArea > 0)) return true;
    return edge.minFaceArea >= smallLimit;
  });

  eligible.sort((a, b) => {
    const a0 = Math.min(a.faceA, a.faceB);
    const b0 = Math.min(b.faceA, b.faceB);
    if (a0 !== b0) return a0 - b0;
    const a1 = Math.max(a.faceA, a.faceB);
    const b1 = Math.max(b.faceA, b.faceB);
    if (a1 !== b1) return a1 - b1;
    for (let k = 0; k < 3; k++) {
      const d = a.mid[k] - b.mid[k];
      if (Math.abs(d) > 1e-6) return d;
    }
    return 0;
  });
  eligible.forEach((edge, i) => {
    edge.id = i;
  });

  const pairCounts = new Map();
  for (const edge of eligible) {
    const pk = edge.faceA < edge.faceB
      ? `${edge.faceA}:${edge.faceB}`
      : `${edge.faceB}:${edge.faceA}`;
    pairCounts.set(pk, (pairCounts.get(pk) || 0) + 1);
    edge.pairCount = 0;
    edge._pairKey = pk;
  }
  for (const edge of eligible) {
    edge.pairCount = pairCounts.get(edge._pairKey) || 1;
    delete edge._pairKey;
  }

  const result = { faces, edges: eligible };
  if (options.triFace) {
    const triFace = new Int32Array(numTri);
    for (let t = 0; t < numTri; t++) triFace[t] = faces[faceOfTri[t]].id;
    result.triFace = triFace;
  }
  return result;
}

/**
 * Boundary edges a contour may reference.
 *
 * Fillet mode drops a sharp edge when the thinner face is a blend crumb.
 * A sheet's thickness is that thin next to the flange, so the same gate
 * removes every edge of Sheet Metallica. This pass keeps those edges.
 * Face ids restart on each flange and bend, so a multi-run solid encodes
 * the run ordinal into the face id. One run (a box, a flat blank) does not.
 *
 * @param {object} geometry
 * @param {ArrayLike<number>|null} faceIDs
 */
export function indexContourBoundaries(geometry, faceIDs) {
  const pos = geometry?.attributes?.position?.array;
  const index = geometry?.index?.array;
  if (!pos || !index || !faceIDs?.length) return { faces: [], edges: [], triFace: null };
  return indexBoundaryEdges({
    positions: pos,
    indices: index,
    faceIDs,
    triSource: geometry.userData?.triSource || null,
  }, { keepThin: true, encodeRuns: true, triFace: true });
}

/**
 * Read a three.js BufferGeometry (position + index) plus a per-triangle faceID list.
 * @param {object} geometry
 * @param {ArrayLike<number>|null} faceIDs
 */
export function indexBoundaryEdgesFromGeometry(geometry, faceIDs) {
  const pos = geometry?.attributes?.position?.array;
  const index = geometry?.index?.array;
  if (!pos || !index || !faceIDs) return { faces: [], edges: [] };
  return indexBoundaryEdges({ positions: pos, indices: index, faceIDs });
}

/**
 * Attach boundaryId / faceA / faceB / pairCount onto feature edges (same vertex keys).
 * @param {object[]} featureEdges
 * @param {{ edges: object[] }} topo
 */
export function annotateFeatureEdges(featureEdges, topo) {
  const byKey = new Map();
  for (const edge of topo?.edges || []) {
    for (const seg of edge.segments) {
      byKey.set(seg.key, {
        boundaryId: edge.id,
        faceA: edge.faceA,
        faceB: edge.faceB,
        pairCount: edge.pairCount,
      });
    }
  }
  return (featureEdges || []).map((edge) => {
    const a = edge.a;
    const b = edge.b;
    const key = edge.key || (a < b ? `${a}-${b}` : `${b}-${a}`);
    const info = byKey.get(key);
    return info ? { ...edge, ...info } : edge;
  });
}

/**
 * Copy boundary ids from freshly annotated feature edges onto a selection.
 * Returns the same array when nothing changed.
 * @param {object[]} selected
 * @param {object[]} featureEdges
 */
export function stampBoundaryOnSelection(selected, featureEdges) {
  const list = Array.isArray(selected) ? selected : [];
  if (!list.length || !featureEdges?.length) return list;
  const byKey = new Map();
  for (const edge of featureEdges) {
    if (!Number.isFinite(edge.boundaryId)) continue;
    const a = edge.a;
    const b = edge.b;
    const key = edge.key || (a < b ? `${a}-${b}` : `${b}-${a}`);
    byKey.set(key, edge);
  }
  let changed = false;
  const next = list.map((edge) => {
    const a = edge.a;
    const b = edge.b;
    const key = edge.key || (Number.isFinite(a) && Number.isFinite(b)
      ? (a < b ? `${a}-${b}` : `${b}-${a}`)
      : '');
    const src = byKey.get(key);
    // A pick kept on another part (Fillet / Chamfer across parts) keeps its
    // own ids: this graph is the active part's mesh, not that one.
    if (src && edge.partId != null && edge.partId !== '' && src.partId != null && src.partId !== ''
      && String(edge.partId) !== String(src.partId)) return edge;
    // Vertex indices collide across parts. Only copy ids when this is the
    // same segment on the active mesh, so a previous solid's edge cannot
    // inherit the other body's face pair.
    if (!src || !sameLocalSegment(edge, src)) return edge;
    if (edge.boundaryId === src.boundaryId
      && edge.faceA === src.faceA
      && edge.faceB === src.faceB
      && edge.pairCount === src.pairCount) {
      return edge;
    }
    changed = true;
    return {
      ...edge,
      boundaryId: src.boundaryId,
      faceA: src.faceA,
      faceB: src.faceB,
      pairCount: src.pairCount,
    };
  });
  return changed ? next : list;
}

/**
 * Pickable feature edges for Fillet mode: one entry per candidate boundary
 * segment, carrying the boundary id so Accept can emit edge() / edgesBetween.
 * Blend strips are already absent from topo.edges.
 * @param {{ faces?: object[], edges?: object[] }} topo
 */
export function featureEdgesFromBoundary(topo) {
  const out = [];
  for (const edge of topo?.edges || []) {
    const n0 = Array.isArray(edge.n0) ? edge.n0 : null;
    const n1 = Array.isArray(edge.n1) ? edge.n1 : null;
    for (const seg of edge.segments || []) {
      if (!Array.isArray(seg.va) || !Array.isArray(seg.vb)) continue;
      const delta = sub(seg.vb, seg.va);
      if (!(Math.hypot(delta[0], delta[1], delta[2]) > 1e-9)) continue;
      out.push({
        key: seg.key,
        a: seg.a,
        b: seg.b,
        va: seg.va.slice(),
        vb: seg.vb.slice(),
        mid: seg.mid.slice(),
        length: seg.length,
        tangent: norm(delta),
        n0: n0 ? n0.slice() : undefined,
        n1: n1 ? n1.slice() : undefined,
        faceA: edge.faceA,
        faceB: edge.faceB,
        boundaryId: edge.id,
        pairCount: edge.pairCount,
      });
    }
  }
  return out;
}

/**
 * Faces and edges worth a Fillet-mode label. Small faces (blend facets,
 * loft micro-triangles) are omitted. The label count is capped so a dense
 * mesh cannot allocate thousands of canvases.
 * @param {{ faces?: object[], edges?: object[] }} topo
 * @param {{ maxLabels?: number }} [opts]
 * @returns {{ faces: object[], edges: object[], truncated: boolean }}
 */
export function filletOverlayTargets(topo, opts = {}) {
  const cap = Number.isFinite(opts.maxLabels) && opts.maxLabels > 0
    ? Math.round(opts.maxLabels)
    : FILLET_OVERLAY_LABEL_CAP;
  const faces = Array.isArray(topo?.faces) ? topo.faces : [];
  const edges = Array.isArray(topo?.edges) ? topo.edges : [];
  const maxArea = faces.reduce((m, f) => Math.max(m, Number(f.area) || 0), 0);
  const floor = BOUNDARY_SMALL_FACE_FRAC * maxArea;
  const labelFaces = maxArea > 0
    ? faces.filter((f) => (Number(f.area) || 0) >= floor)
    : [];
  if (labelFaces.length + edges.length <= cap) {
    return { faces: labelFaces, edges, truncated: false };
  }
  const edgeBudget = Math.min(edges.length, Math.max(1, cap - 8));
  const faceBudget = Math.max(0, cap - edgeBudget);
  const biggest = labelFaces.slice().sort((a, b) => (b.area || 0) - (a.area || 0));
  return {
    faces: biggest.slice(0, faceBudget),
    edges: edges.slice(0, edgeBudget),
    truncated: true,
  };
}
