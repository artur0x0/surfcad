/**
 * Box-corner picks in Fillet mode.
 *
 * The sweep path (`makeSweepPath` + `filletAlongPath`) needs each picked
 * component to be a simple open chain or a closed loop, so a pick where
 * three edges meet at one vertex (a box corner, or the whole box) used to be
 * refused as a Y/T junction. Those picks are exactly what the planar
 * rolling-ball kernel is for: `filletEdges(part, edges, r, { sphericalCorners:
 * true })` takes any set of straight planar–planar edges and rounds every
 * vertex where three equal fillets meet at right angles with a spherical
 * patch. Accept routes a branched pick there when the pick qualifies, and
 * refuses with a reason when it does not (a junction on curved walls).
 *
 * The check is geometric and needs no toggle: a junction vertex, straight
 * rows, right-angle dihedrals, and, when the part geometry is at hand, flat
 * faces on both sides of every edge (`classifyFilletEdges`).
 */
import {
  classifyFilletEdges,
  FILLET_REASON_TWISTED_WALL,
  FILLET_REASON_VARIABLE_ANGLE,
} from './filletEdgeClass.js';
import { EDGE_BLEND_SIZE_GUARD, edgeDihedralDeg } from './selectEdge.js';

/** Picked endpoints within this distance are one vertex (same as the sweep path). */
export const BOX_CORNER_WELD_MM = 0.05;
/** A box edge's two faces meet at 90° within this (the kernel caps exact corners only). */
export const BOX_CORNER_DIHEDRAL_TOL_DEG = 2;
/** Planar kernel size guard: an edge is skipped when t > 0.45·L, so Accept clamps r under it. */
export const BOX_CORNER_RADIUS_FRAC = EDGE_BLEND_SIZE_GUARD;

export const FILLET_BOX_CORNER_FLAT =
  'Branched picks fillet as box corners between flat faces only — for curved walls pick a simple chain (Tangent on).';
export const FILLET_BOX_CORNER_STRAIGHT =
  'Branched picks fillet as box corners on straight right-angle edges only — otherwise pick a simple chain (Tangent on).';

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Vertex degree over welded endpoints: how many picked edges end at each vertex. */
function junctionCount(list) {
  const n = list.length;
  const parent = new Array(n * 2);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const at = (i) => ((i & 1) === 0 ? list[i >> 1].va : list[i >> 1].vb);
  for (let i = 0; i < parent.length; i++) {
    for (let j = i + 1; j < parent.length; j++) {
      if ((i >> 1) === (j >> 1)) continue;
      if (dist(at(i), at(j)) <= BOX_CORNER_WELD_MM) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const degree = new Map();
  for (let i = 0; i < parent.length; i++) {
    const root = find(i);
    degree.set(root, (degree.get(root) || 0) + 1);
  }
  let junctions = 0;
  for (const d of degree.values()) if (d >= 3) junctions++;
  return junctions;
}

/** A picked row is straight when its dense points (if any) stay on the chord. */
function isStraight(edge) {
  const pts = edge.pts;
  if (!Array.isArray(pts) || pts.length <= 2) return true;
  const a = edge.va;
  const b = edge.vb;
  const L = dist(a, b);
  if (!(L > 1e-9)) return false;
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
  const tol = Math.max(1e-3, 1e-3 * L);
  for (const p of pts) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const v = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const s = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    const off = Math.hypot(v[0] - s * d[0], v[1] - s * d[1], v[2] - s * d[2]);
    if (off > tol) return false;
  }
  return true;
}

/**
 * Largest radius the planar kernel accepts on every picked edge: just under
 * the size guard of the shortest edge (`t = r` at 90°, skipped when
 * `t > 0.45·L`). Also leaves room for two corner caps on that edge (2r < L).
 */
export function boxCornerRadiusMax(edges) {
  let minL = Infinity;
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
    const L = Number.isFinite(Number(e.length)) && Number(e.length) > 0 ? Number(e.length) : dist(e.va, e.vb);
    if (L > 0 && L < minL) minL = L;
  }
  if (!Number.isFinite(minL)) return Infinity;
  return BOX_CORNER_RADIUS_FRAC * minL * (1 - 1e-6);
}

/**
 * Is this pick a box-corner set?
 *
 * @param {object[]} edges picked rows (va, vb, optional n0/n1, pts)
 * @param {{ geometry?: object|null }} [opts] the part geometry, when the caller has it
 * @returns {null | { ok: true, junctions: number } | { ok: false, message: string }}
 *   null when no picked vertex joins three edges (not a box-corner pick:
 *   the chain rules apply), else whether the planar kernel can take it.
 */
export function detectBoxCornerPick(edges, opts = {}) {
  const list = (Array.isArray(edges) ? edges : []).filter((e) => (
    e && Array.isArray(e.va) && e.va.length >= 3 && Array.isArray(e.vb) && e.vb.length >= 3
  ));
  if (list.length < 3) return null;
  const junctions = junctionCount(list);
  if (!junctions) return null;
  for (const e of list) {
    if (!isStraight(e)) return { ok: false, message: FILLET_BOX_CORNER_STRAIGHT };
    if (e.n0 && e.n1) {
      const deg = edgeDihedralDeg(e);
      if (Math.abs(deg - 90) > BOX_CORNER_DIHEDRAL_TOL_DEG) return { ok: false, message: FILLET_BOX_CORNER_STRAIGHT };
    }
  }
  const geometry = opts.geometry || null;
  if (geometry && typeof geometry === 'object') {
    const klass = classifyFilletEdges(list, { geometry });
    for (const chain of klass.chains || []) {
      const flat = Array.isArray(chain.sides) && chain.sides.every((k) => k === 'planar');
      const reasons = chain.reasons || [];
      if (!flat || reasons.includes(FILLET_REASON_TWISTED_WALL) || reasons.includes(FILLET_REASON_VARIABLE_ANGLE)) {
        return { ok: false, message: FILLET_BOX_CORNER_FLAT };
      }
    }
  }
  return { ok: true, junctions };
}
