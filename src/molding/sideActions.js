/**
 * Side actions (injection molding, M2.2).
 *
 * A side action is one block of steel that forms a set of trapped faces and
 * withdraws along one lateral direction before the halves open. Only a true
 * undercut needs one: a wall within `PARTING_ZERO_DRAFT_DEG` of the pull is
 * a vertical wall and belongs to draft analysis.
 *
 * `groupSideActions` picks one direction per set of trapped regions by
 * cover (the direction that frees the most trapped area, then the rest),
 * tests clearance as entering material only, merges every region that
 * shares a direction and a connected reachable surface into one block,
 * and reports each block's face: everything the block reaches within the
 * window of its trapped cells. A slide moves in the parting plane; a lifter
 * is tilted toward the core; what nothing frees is an unresolved undercut.
 * Nothing here builds mould CAD. A messy mesh returns blocks instead of
 * failing.
 */

import { PARTING_ZERO_DRAFT_DEG, partingLegendModel } from './parting.js';

/** Matches `MOLD_REGION_NORMAL_DEG`. Suggested pulls this close share an action. */
export const SIDE_ACTION_ALIGN_DEG = 35;
/** An angled lifter leaves the parting plane by this much, into the core. */
export const SIDE_ACTION_LIFTER_DEG = 20;

const CANDIDATE_COS = Math.cos((15 * Math.PI) / 180);
const ESCAPE_SKIN_MM = 0.05;
/** Same band as the undercut test. A wall this close to vertical is not a side action. */
const VERTICAL_SIN = Math.sin((PARTING_ZERO_DRAFT_DEG * Math.PI) / 180);

/** Discrete skin colours. Not stress, and not a CSS token. */
export const SIDE_ACTION_KIND_RGB = Object.freeze({
  slide: Object.freeze([0.15, 0.55, 0.38]),
  lifter: Object.freeze([0.48, 0.32, 0.70]),
  unresolved: Object.freeze([0.80, 0.30, 0.30]),
});

/** One face colour for every side action on the core/cavity skin. */
export const SIDE_ACTION_FACE_RGB = Object.freeze([0.15, 0.55, 0.38]);
/** Selected group. Same family, light enough to read against the base. */
export const SIDE_ACTION_HIGHLIGHT_RGB = Object.freeze([0.55, 0.92, 0.70]);

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit(v) {
  if (!v) return null;
  const l = len(v);
  if (!(l > 1e-12)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function round(n, places = 6) {
  const f = 10 ** places;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
}

function round3(v) {
  return [round(v[0]), round(v[1]), round(v[2])];
}

function rgbCss(rgb) {
  const [r, g, b] = rgb.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

function basisOf(d) {
  const helper = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = unit(cross(helper, d));
  const v = unit(cross(d, u));
  return { u, v };
}

/**
 * In-plane part of `normal`. Null when the normal is parallel to the pull:
 * that axis is blocked for a true undercut, so it is not an escape.
 */
export function suggestSidePull(normal, pull) {
  const n = unit(normal);
  const d = unit(pull);
  if (!n || !d) return null;
  const along = dot(n, d);
  const lateral = [n[0] - d[0] * along, n[1] - d[1] * along, n[2] - d[2] * along];
  const slide = unit(lateral);
  if (!slide) return null;
  return { kind: 'slide', pull: round3(slide) };
}

function pushUnique(list, raw) {
  const dir = unit(raw);
  if (!dir) return;
  for (const have of list) {
    if (dot(have, dir) > CANDIDATE_COS) return;
  }
  list.push(dir);
}

function boundsOf(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) {
    for (const p of [tri.a, tri.b, tri.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  return { min, max };
}

function rayAabbExit(orig, dir, min, max) {
  let tEnter = -Infinity;
  let tExit = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (orig[k] < min[k] || orig[k] > max[k]) return 0;
      continue;
    }
    const inv = 1 / dir[k];
    let t0 = (min[k] - orig[k]) * inv;
    let t1 = (max[k] - orig[k]) * inv;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > tEnter) tEnter = t0;
    if (t1 < tExit) tExit = t1;
  }
  if (tExit < tEnter || tExit < 0) return 0;
  return tExit;
}

function rayHit(orig, dir, tri) {
  const e1 = sub(tri.b, tri.a);
  const e2 = sub(tri.c, tri.a);
  const pvec = cross(dir, e2);
  const det = dot(e1, pvec);
  if (Math.abs(det) < 1e-8) return null;
  const inv = 1 / det;
  const tvec = sub(orig, tri.a);
  const u = dot(tvec, pvec) * inv;
  if (u < 0 || u > 1) return null;
  const qvec = cross(tvec, e1);
  const v = dot(dir, qvec) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qvec) * inv;
  if (!(t > ESCAPE_SKIN_MM)) return null;
  return t;
}

/**
 * True when translating `triangleIds` along `direction` leaves the part
 * before the ray hits any other triangle. No samples means nothing to block.
 */
export function directionClears(tris, triangleIds, direction) {
  const dir = unit(direction);
  if (!dir || !Array.isArray(tris) || !tris.length) return true;
  const own = new Set(triangleIds || []);
  const bounds = boundsOf(tris);
  const samples = [];
  for (const tri of tris) {
    if (!own.has(tri.t) || !tri.centroid || !tri.n) continue;
    const n = tri.n;
    const c = tri.centroid;
    samples.push([
      c[0] + n[0] * ESCAPE_SKIN_MM,
      c[1] + n[1] * ESCAPE_SKIN_MM,
      c[2] + n[2] * ESCAPE_SKIN_MM,
    ]);
  }
  if (!samples.length) return true;
  return samples.every((origin) => sampleExits(origin, dir, tris, own, bounds));
}

function sampleExits(origin, dir, tris, own, bounds) {
  // A triangle on the bounding box is still the part. Only a ray that
  // leaves that box without a hit is an open escape.
  const limit = rayAabbExit(origin, dir, bounds.min, bounds.max) + ESCAPE_SKIN_MM;
  for (const tri of tris) {
    if (own.has(tri.t)) continue;
    const t = rayHit(origin, dir, tri);
    if (t != null && t <= limit) return false;
  }
  return true;
}

/** Below this a face is parallel to the motion and never blocks it. */
const FACING_SIN = Math.sin((3 * Math.PI) / 180);
/** Lifter tilt toward the core. The first that clears is taken. */
const LIFTER_TILTS_DEG = [15, 20, 25];
/** A stamped face at least this far inside a block's window joins it whole. */
const WHOLE_FACE_FRACTION = 0.8;

function barycentric2(p, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1]];
  const v1 = [c[0] - a[0], c[1] - a[1]];
  const v2 = [p[0] - a[0], p[1] - a[1]];
  const d00 = v0[0] * v0[0] + v0[1] * v0[1];
  const d01 = v0[0] * v1[0] + v0[1] * v1[1];
  const d11 = v1[0] * v1[0] + v1[1] * v1[1];
  const d20 = v2[0] * v0[0] + v2[1] * v0[1];
  const d21 = v2[0] * v1[0] + v2[1] * v1[1];
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-18) return null;
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  const u = 1 - v - w;
  if (u < -1e-9 || v < -1e-9 || w < -1e-9) return null;
  return [u, v, w];
}

/**
 * Blocking along one direction, as a projected height field over the part.
 * A point is blocked when, further along `dir` in its own projected cell, a
 * triangle facing against the motion (normal · dir < −sin 3°) covers it.
 * Faces parallel to the motion never block; a face the ray leaves through
 * never blocks; the point's own triangle (`ignore`) never blocks. That is
 * the test for "this steel can withdraw this way": it blocks on entering
 * material and on nothing else.
 */
export function blockingField(tris, dir) {
  const d = unit(dir);
  const { u, v } = basisOf(d);
  const rows = [];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const tri of tris) {
    if (tri.artifact) continue;
    const nd = dot(tri.nGeom || tri.n, d);
    if (nd >= -FACING_SIN) continue;
    const pa = [dot(tri.a, u), dot(tri.a, v)];
    const pb = [dot(tri.b, u), dot(tri.b, v)];
    const pc = [dot(tri.c, u), dot(tri.c, v)];
    const ha = dot(tri.a, d);
    const hb = dot(tri.b, d);
    const hc = dot(tri.c, d);
    const u0 = Math.min(pa[0], pb[0], pc[0]);
    const u1 = Math.max(pa[0], pb[0], pc[0]);
    const v0 = Math.min(pa[1], pb[1], pc[1]);
    const v1 = Math.max(pa[1], pb[1], pc[1]);
    if (u0 < minU) minU = u0;
    if (u1 > maxU) maxU = u1;
    if (v0 < minV) minV = v0;
    if (v1 > maxV) maxV = v1;
    rows.push({ t: tri.t, pa, pb, pc, ha, hb, hc, u0, u1, v0, v1, hMax: Math.max(ha, hb, hc) });
  }
  const spanU = Math.max(maxU - minU, 0);
  const spanV = Math.max(maxV - minV, 0);
  const span = Math.max(spanU, spanV, 1e-9);
  const cell = Math.max(0.25, span / 48);
  const nU = Math.max(1, Math.min(96, Math.ceil((spanU + 1e-9) / cell)));
  const nV = Math.max(1, Math.min(96, Math.ceil((spanV + 1e-9) / cell)));
  const buckets = Array.from({ length: nU * nV }, () => []);
  const clamp = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  const cellAt = (pu, pv) => clamp(Math.floor((pv - minV) / cell), nV) * nU + clamp(Math.floor((pu - minU) / cell), nU);
  for (const row of rows) {
    const iu0 = clamp(Math.floor((row.u0 - minU) / cell), nU);
    const iu1 = clamp(Math.floor((row.u1 - minU) / cell), nU);
    const iv0 = clamp(Math.floor((row.v0 - minV) / cell), nV);
    const iv1 = clamp(Math.floor((row.v1 - minV) / cell), nV);
    for (let iv = iv0; iv <= iv1; iv++) for (let iu = iu0; iu <= iu1; iu++) buckets[iv * nU + iu].push(row);
  }
  /** Index of the triangle that blocks `pt`, or −1. */
  const blockedBy = (pt, ignore = null) => {
    if (!rows.length) return -1;
    const pu = dot(pt, u);
    const pv = dot(pt, v);
    if (pu < minU || pu > maxU || pv < minV || pv > maxV) return -1;
    const h = dot(pt, d);
    for (const row of buckets[cellAt(pu, pv)]) {
      if (ignore && ignore.has(row.t)) continue;
      if (!(row.hMax > h + 1e-6)) continue;
      const bary = barycentric2([pu, pv], row.pa, row.pb, row.pc);
      if (!bary) continue;
      const hOther = bary[0] * row.ha + bary[1] * row.hb + bary[2] * row.hc;
      if (hOther > h + 1e-6) return row.t;
    }
    return -1;
  };
  const blocked = (pt, ignore = null) => blockedBy(pt, ignore) >= 0;
  return { dir: d, u, v, blocked, blockedBy };
}

/**
 * Connected components of the part surface that is reachable along `dir`:
 * triangles that do not look away from the motion and can move that way
 * without entering material, joined over shared vertices. Returns triangle
 * index → component id. Two trapped features on one such component share a
 * block.
 */
export function reachableComponents(tris, dir, field = null, always = null) {
  const comps = new Map();
  if (!Array.isArray(tris) || !tris.length) return comps;
  const d = unit(dir);
  if (!d) return comps;
  const f = field || blockingField(tris, d);
  const reachable = [];
  for (const tri of tris) {
    if (tri.artifact || !tri.centroid || !tri.n) continue;
    const n = tri.nGeom || tri.n;
    if (always && always.has(tri.t)) {
      reachable.push(tri);
      continue;
    }
    if (dot(n, d) < -0.9) continue;
    if (f.blocked(offsetSample(tri.centroid, n), new Set([tri.t]))) continue;
    reachable.push(tri);
  }
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    return r;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const byVertex = new Map();
  for (const tri of reachable) {
    parent.set(tri.t, tri.t);
    for (const vi of [tri.ia, tri.ib, tri.ic]) {
      if (vi == null) continue;
      const first = byVertex.get(vi);
      if (first == null) byVertex.set(vi, tri.t);
      else unite(first, tri.t);
    }
  }
  for (const tri of reachable) comps.set(tri.t, find(tri.t));
  return comps;
}

/** Skin colour for a group. Later groups of the same kind step lighter. */
export function sideActionRgb(kind, index) {
  const base = SIDE_ACTION_KIND_RGB[kind] || SIDE_ACTION_KIND_RGB.slide;
  const lift = Math.min(Math.max(index, 0), 3) * 0.08;
  return base.map((channel) => Math.min(1, round(channel + lift, 4)));
}

function formatPull(pull) {
  if (!pull) return '';
  const axes = ['X', 'Y', 'Z'];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(pull[i]) <= 0.98) continue;
    let others = 0;
    for (let k = 0; k < 3; k++) if (k !== i) others += Math.abs(pull[k]);
    if (others < 0.15) return `${pull[i] >= 0 ? '+' : '-'}${axes[i]}`;
  }
  return pull.map((n) => n.toFixed(2)).join(' ');
}

function formatArea(area) {
  if (!Number.isFinite(area)) return '';
  const text = Math.abs(area - Math.round(area)) < 0.05
    ? String(Math.round(area))
    : Math.abs(area) >= 10
      ? area.toFixed(1)
      : area.toFixed(2);
  return `${text} mm²`;
}

/** A vertical wall, within half a degree, is not a true undercut. */
function clearsVertical(normal, pull) {
  const n = unit(normal);
  if (!n) return false;
  return Math.abs(dot(n, pull)) > VERTICAL_SIN;
}

function emptyActions() {
  return {
    heuristic: true,
    alignDeg: SIDE_ACTION_ALIGN_DEG,
    lifterDeg: SIDE_ACTION_LIFTER_DEG,
    count: 0,
    slideCount: 0,
    lifterCount: 0,
    unresolvedCount: 0,
    groups: [],
  };
}

function offsetSample(point, normal) {
  return [
    point[0] + normal[0] * ESCAPE_SKIN_MM,
    point[1] + normal[1] * ESCAPE_SKIN_MM,
    point[2] + normal[2] * ESCAPE_SKIN_MM,
  ];
}

const KIND_ORDER = { slide: 0, lifter: 1, unresolved: 2 };
const KIND_LABEL = { slide: 'Slide', lifter: 'Lifter', unresolved: 'Undercut' };

/**
 * Side actions along `pull`.
 *
 * A side action is one block of steel that forms a set of trapped faces and
 * withdraws along one lateral direction. The regions are the trapped faces
 * (`pullDirection.js`). This function answers, in order: which single
 * direction frees a set of them, which of those sets share one block, and
 * what face that block forms.
 *
 * 1. Candidate directions: the in-plane part of each region's normal, the
 *    in-plane part of the stamped normals of the faces the regions lie on
 *    (a wall gives its normal), and the two in-plane axes both ways.
 * 2. A region clears a direction when every one of its cells can move that
 *    way without entering material (`blockingField`); the trapped faces
 *    themselves never block each other.
 * 3. Cover: the direction that frees the most trapped area is taken, those
 *    regions are assigned to it, and the rest are covered again. Ties go to
 *    a wall normal, then to an axis.
 * 4. What no in-plane direction frees is tried tilted toward the core
 *    (`LIFTER_TILTS_DEG`); the first tilt that clears is a lifter. Nothing
 *    clears: the region is reported as an unresolved undercut, never given
 *    a made-up direction.
 * 5. Regions on one direction belong to one block when they lie on the same
 *    connected part surface that is reachable along that direction. One
 *    wall joins everything on it, at any distance; an obstacle the motion
 *    cannot pass splits them. Slides are moving parts, so a toolmaker makes
 *    as few as the geometry allows.
 * 6. The block face: every refined cell reachable along the direction whose
 *    centroid projects into the block's window (the bounds of its trapped
 *    cells in the plane perpendicular to the direction). A stamped face at
 *    least 80% inside, and smaller than the window, comes in whole. That
 *    face is what is painted and what `area` reports; `trappedArea` is the
 *    trapped part of it.
 *
 * `opts.refined` is the sub-triangle list of the chosen pull; `opts.faceInfo`
 * the stamped face table. Without them the block face falls back to the
 * trapped triangles.
 */
export function groupSideActions(regions, pull, tris = null, opts = {}) {
  const d = unit(pull);
  if (!d || !Array.isArray(regions)) return emptyActions();
  const mesh = Array.isArray(tris) && tris.length ? tris : null;
  const members = regions.filter((region) => clearsVertical(region?.normal, d)
    && (region.side === 1 || region.side === -1)
    && ((region.cells && region.cells.length) || (region.triangles && region.triangles.length)));
  if (!members.length) return emptyActions();
  const byIndex = new Map();
  if (mesh) for (const tri of mesh) byIndex.set(tri.t, tri);
  const trapped = new Set();
  for (const region of members) for (const t of region.triangles || []) trapped.add(t);
  const samplesOf = (region) => {
    const out = [];
    if (region.cells?.length) {
      for (const cell of region.cells) out.push(offsetSample(cell.centroid, cell.n));
    } else {
      for (const t of region.triangles || []) {
        const tri = byIndex.get(t);
        if (tri?.centroid && tri.n) out.push(offsetSample(tri.centroid, tri.n));
      }
    }
    return out;
  };
  const sampleCache = new Map();
  const samples = (region) => {
    let list = sampleCache.get(region);
    if (!list) {
      list = samplesOf(region);
      sampleCache.set(region, list);
    }
    return list;
  };
  const fields = new Map();
  const fieldFor = (dir) => {
    const key = round3(dir).join(',');
    let field = fields.get(key);
    if (!field) {
      field = mesh ? blockingField(mesh, dir) : { blocked: () => false };
      fields.set(key, field);
    }
    return field;
  };
  const ownOf = new Map();
  const own = (region) => {
    let set = ownOf.get(region);
    if (!set) {
      set = new Set(region.triangles || []);
      ownOf.set(region, set);
    }
    return set;
  };
  // A region clears a direction when none of its cells enters material that
  // way. Only the region's own triangles are ignored: trapped faces block
  // each other when one overhangs another along the motion (a slot cut
  // with rounded ends narrows toward the outer face and its end walls lip
  // over the slot wall behind them), and steel cannot pull through a lip.
  const clears = (region, dir) => {
    if (!mesh) {
      // No surface to test against: a region clears the direction its own
      // normal points, in the plane, and nothing else.
      const hinted = suggestSidePull(region.normal, d);
      return !!hinted && dot(hinted.pull, dir) > CANDIDATE_COS;
    }
    const field = fieldFor(dir);
    const mine = own(region);
    return samples(region).every((point) => !field.blocked(point, mine));
  };
  const blockedCount = (region, dir) => {
    if (!mesh) return 0;
    const field = fieldFor(dir);
    const mine = own(region);
    let count = 0;
    for (const point of samples(region)) if (field.blocked(point, mine)) count += 1;
    return count;
  };

  // 1. Candidates.
  const { u: axisU, v: axisV } = basisOf(d);
  const candidates = [];
  const wallDirs = [];
  for (const region of members) {
    const hinted = suggestSidePull(region.normal, d);
    if (hinted) pushUnique(candidates, hinted.pull);
  }
  for (const region of members) {
    for (const t of region.triangles || []) {
      const tri = byIndex.get(t);
      const hinted = tri?.n ? suggestSidePull(tri.n, d) : null;
      if (!hinted) continue;
      pushUnique(candidates, hinted.pull);
      pushUnique(wallDirs, hinted.pull);
    }
  }
  const axes = [axisU, axisU.map((n) => -n), axisV, axisV.map((n) => -n)];
  for (const axis of axes) pushUnique(candidates, axis);
  const isNear = (list, dir) => list.some((have) => dot(have, dir) > CANDIDATE_COS);

  // 2 and 3. Cover.
  let remaining = members.slice();
  const assigned = [];
  while (remaining.length) {
    let best = null;
    for (const dir of candidates) {
      const freed = remaining.filter((region) => clears(region, dir));
      if (!freed.length) continue;
      let area = 0;
      for (const region of freed) area += region.area || 0;
      const bonus = (isNear(wallDirs, dir) ? 2 : 0) + (axes.some((axis) => dot(axis, dir) > 0.9999) ? 1 : 0);
      if (!best || area > best.area + 1e-9 || (Math.abs(area - best.area) <= 1e-9 && bonus > best.bonus)) {
        best = { dir, freed, area, bonus };
      }
    }
    if (!best) break;
    for (const region of best.freed) assigned.push({ region, dir: best.dir, kind: 'slide', clear: true });
    remaining = remaining.filter((region) => !best.freed.includes(region));
  }
  // 4. Lifters, or unresolved.
  for (const region of remaining) {
    let found = null;
    for (const deg of LIFTER_TILTS_DEG) {
      const sine = Math.sin((deg * Math.PI) / 180);
      const cosine = Math.cos((deg * Math.PI) / 180);
      for (const dir of candidates) {
        const tilted = unit([
          dir[0] * cosine - d[0] * sine,
          dir[1] * cosine - d[1] * sine,
          dir[2] * cosine - d[2] * sine,
        ]);
        if (tilted && clears(region, tilted)) {
          found = tilted;
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      assigned.push({ region, dir: found, kind: 'lifter', clear: true });
      continue;
    }
    // Nothing frees it. Report the least-blocked in-plane direction so the
    // row still says which way the steel would want to go.
    let leastDir = axisU;
    let least = Infinity;
    for (const dir of candidates) {
      const count = blockedCount(region, dir);
      if (count < least) {
        least = count;
        leastDir = dir;
      }
    }
    assigned.push({ region, dir: leastDir, kind: 'unresolved', clear: false });
  }

  // 4b. A feature is one problem. Trapped regions that touch (shared
  // vertices among their source triangles) form one feature; if any region
  // of a feature is unresolved, no steel can form that feature as modelled,
  // and a lifter on one of its facets would be a fiction. The whole feature
  // is reported as unresolved.
  if (mesh) {
    const regionOfSource = new Map();
    for (const row of assigned) for (const t of row.region.triangles || []) regionOfSource.set(t, row);
    const parent = new Map(assigned.map((row) => [row, row]));
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      return r;
    };
    const byVertex = new Map();
    for (const row of assigned) {
      for (const t of row.region.triangles || []) {
        const tri = byIndex.get(t);
        if (!tri) continue;
        for (const vi of [tri.ia, tri.ib, tri.ic]) {
          if (vi == null) continue;
          const first = byVertex.get(vi);
          if (first == null) byVertex.set(vi, row);
          else if (first !== row) {
            const a = find(first);
            const b = find(row);
            if (a !== b) parent.set(b, a);
          }
        }
      }
    }
    const stuck = new Set();
    for (const row of assigned) if (row.kind === 'unresolved') stuck.add(find(row));
    for (const row of assigned) {
      if (row.kind !== 'unresolved' && stuck.has(find(row))) {
        row.kind = 'unresolved';
        row.clear = false;
      }
    }
  }

  // 5. Blocks: same kind, same direction, same reachable connected surface.
  const componentCache = new Map();
  const componentsAlong = (dir) => {
    const key = round3(dir).join(',');
    let comps = componentCache.get(key);
    if (!comps) {
      comps = mesh ? reachableComponents(mesh, dir, fieldFor(dir), trapped) : new Map();
      componentCache.set(key, comps);
    }
    return comps;
  };
  const componentOf = (region, dir) => {
    // Without a mesh there is no surface to connect through: one direction
    // is one block.
    if (!mesh) return 'all';
    const comps = componentsAlong(dir);
    for (const t of region.triangles || []) {
      const c = comps.get(t);
      if (c != null) return `c${c}`;
    }
    return `r${region.id}`;
  };
  const blocks = new Map();
  for (const row of assigned) {
    // An unresolved undercut has no direction of its own; one connected
    // surface of them is one problem to report.
    const dirKey = row.kind === 'unresolved' ? '' : round3(row.dir).join(',');
    const compDir = row.kind === 'unresolved' ? d : row.dir;
    const key = `${row.kind}|${dirKey}|${componentOf(row.region, compDir)}`;
    let block = blocks.get(key);
    if (!block) {
      block = { kind: row.kind, dir: row.dir, clear: row.clear, rows: [] };
      blocks.set(key, block);
    }
    block.clear = block.clear && row.clear;
    block.rows.push(row);
  }

  // 6. Block faces.
  const refined = Array.isArray(opts.refined) && opts.refined.length ? opts.refined : null;
  const faceInfo = opts.faceInfo && opts.faceInfo.triFace && opts.faceInfo.names ? opts.faceInfo : null;
  const faceOfSource = (t) => {
    if (!faceInfo) return -1;
    const fi = faceInfo.triFace[t];
    return fi == null || fi < 0 ? -1 : fi;
  };
  const groups = [];
  for (const block of blocks.values()) {
    const s = unit(block.dir) || block.dir;
    const { u, v } = basisOf(s);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    let trappedArea = 0;
    const regionIds = [];
    const triangles = new Set();
    const center = [0, 0, 0];
    const freed = new Set();
    for (const row of block.rows) {
      const region = row.region;
      trappedArea += region.area || 0;
      regionIds.push(region.id);
      for (const t of region.triangles || []) {
        triangles.add(t);
        const fi = faceOfSource(t);
        if (fi >= 0) freed.add(faceInfo.names[fi]);
      }
      const at = region.centroid || [0, 0, 0];
      for (let k = 0; k < 3; k++) center[k] += at[k] * (region.area || 0);
      // The window is bounded by trapped cell centroids: a cell is trapped
      // where its centre is, and its corners spill up to one cell past the
      // shadow.
      const pts = region.cells?.length
        ? region.cells.map((cell) => cell.centroid)
        : (region.triangles || []).flatMap((t) => { const tri = byIndex.get(t); return tri ? [tri.a, tri.b, tri.c] : []; });
      for (const p of pts) {
        const pu = dot(p, u);
        const pv = dot(p, v);
        if (pu < u0) u0 = pu;
        if (pu > u1) u1 = pu;
        if (pv < v0) v0 = pv;
        if (pv > v1) v1 = pv;
      }
    }
    const weight = trappedArea || 1;
    const windowArea = Math.max(0, u1 - u0) * Math.max(0, v1 - v0);
    const field = mesh ? fieldFor(s) : null;
    const faceCells = [];
    let faceArea = 0;
    let spanLo = Infinity;
    let spanHi = -Infinity;
    const faceAreas = new Map();
    if (block.kind === 'unresolved') {
      // No steel forms this; paint the trapped faces themselves.
      for (const row of block.rows) {
        for (const cell of row.region.cells || []) {
          faceCells.push(cell);
          faceArea += cell.area;
          const fi = faceOfSource(cell.source);
          const name = fi >= 0 ? faceInfo.names[fi] : null;
          if (name) faceAreas.set(name, (faceAreas.get(name) || 0) + cell.area);
          for (const p of [cell.a, cell.b, cell.c]) {
            const h = dot(p, d);
            if (h < spanLo) spanLo = h;
            if (h > spanHi) spanHi = h;
          }
        }
        if (!row.region.cells?.length) {
          for (const t of row.region.triangles || []) {
            const tri = byIndex.get(t);
            if (!tri) continue;
            faceCells.push(tri);
            faceArea += tri.area || 0;
          }
        }
      }
    } else if (refined && field) {
      const inWindow = (p) => {
        const pu = dot(p, u);
        const pv = dot(p, v);
        return pu >= u0 && pu <= u1 && pv >= v0 && pv <= v1;
      };
      const reachable = (cell) => !cell.artifact
        && dot(cell.nGeom || cell.n, s) >= -0.9
        && !field.blocked(offsetSample(cell.centroid, cell.nGeom || cell.n), new Set([cell.source]));
      // Candidate cells: reachable along the direction and inside the window.
      // The block's face is the part of that surface the block can actually
      // touch: a flood from the trapped faces over adjacent candidate
      // sources. A face that is reachable only through an opening (the far
      // inside wall seen through a slot) is not adjacent to the trapped
      // faces inside the window and stays out.
      const inside = new Map(); // face index → [areaInside, areaTotal]
      const bySource = new Map(); // source → candidate cells
      for (const cell of refined) {
        const fi = faceOfSource(cell.source);
        const isIn = inWindow(cell.centroid);
        if (fi >= 0) {
          let row = inside.get(fi);
          if (!row) {
            row = [0, 0];
            inside.set(fi, row);
          }
          row[1] += cell.area;
          if (isIn) row[0] += cell.area;
        }
        if (isIn && reachable(cell)) {
          let list = bySource.get(cell.source);
          if (!list) {
            list = [];
            bySource.set(cell.source, list);
          }
          list.push(cell);
        }
      }
      const candidateSources = new Set(bySource.keys());
      for (const t of triangles) candidateSources.add(t);
      const sourcesAtVertex = new Map();
      for (const t of candidateSources) {
        const tri = byIndex.get(t);
        if (!tri) continue;
        for (const vi of [tri.ia, tri.ib, tri.ic]) {
          if (vi == null) continue;
          let list = sourcesAtVertex.get(vi);
          if (!list) {
            list = [];
            sourcesAtVertex.set(vi, list);
          }
          list.push(t);
        }
      }
      const flooded = new Set();
      const stack = [...triangles];
      while (stack.length) {
        const t = stack.pop();
        if (flooded.has(t)) continue;
        flooded.add(t);
        const tri = byIndex.get(t);
        if (!tri) continue;
        for (const vi of [tri.ia, tri.ib, tri.ic]) {
          for (const next of sourcesAtVertex.get(vi) || []) if (!flooded.has(next)) stack.push(next);
        }
      }
      const picked = [];
      for (const t of flooded) for (const cell of bySource.get(t) || []) picked.push(cell);
      const whole = new Set();
      const floodedFaces = new Set();
      for (const t of flooded) {
        const fi = faceOfSource(t);
        if (fi >= 0) floodedFaces.add(fi);
      }
      for (const [fi, [areaIn, areaTotal]] of inside) {
        if (!floodedFaces.has(fi)) continue;
        if (areaTotal > 0 && areaIn / areaTotal >= WHOLE_FACE_FRACTION && areaTotal <= windowArea) whole.add(fi);
      }
      if (whole.size) {
        const have = new Set(picked.map((cell) => cell.t));
        for (const cell of refined) {
          if (have.has(cell.t)) continue;
          const fi = faceOfSource(cell.source);
          if (fi >= 0 && whole.has(fi) && reachable(cell)) picked.push(cell);
        }
      }
      for (const cell of picked) {
        faceCells.push(cell);
        faceArea += cell.area;
        const fi = faceOfSource(cell.source);
        const name = fi >= 0 ? faceInfo.names[fi] : null;
        if (name) faceAreas.set(name, (faceAreas.get(name) || 0) + cell.area);
        for (const p of [cell.a, cell.b, cell.c]) {
          const h = dot(p, d);
          if (h < spanLo) spanLo = h;
          if (h > spanHi) spanHi = h;
        }
      }
    } else {
      for (const t of triangles) {
        const tri = byIndex.get(t);
        if (!tri) continue;
        faceCells.push(tri);
        faceArea += tri.area || 0;
        for (const p of [tri.a, tri.b, tri.c]) {
          const h = dot(p, d);
          if (h < spanLo) spanLo = h;
          if (h > spanHi) spanHi = h;
        }
      }
    }
    const positions = new Float32Array(faceCells.length * 9);
    let w = 0;
    for (const cell of faceCells) {
      for (const p of [cell.a, cell.b, cell.c]) {
        positions[w++] = p[0];
        positions[w++] = p[1];
        positions[w++] = p[2];
      }
    }
    const features = new Set();
    const faces = [...faceAreas.entries()].sort((a, b) => b[1] - a[1]).map(([name, area]) => {
      features.add(name.replace(/\[\d+\]$/, '').split('.')[0]);
      return { name, area: round(area, 3), trapped: freed.has(name) };
    });
    groups.push({
      kind: block.kind,
      heuristic: true,
      clear: block.clear,
      pull: round3(s),
      side: block.rows[0].region.side,
      area: round(faceArea || trappedArea, 6),
      trappedArea: round(trappedArea, 6),
      regionIds,
      triangles: [...triangles].sort((a, b) => a - b),
      center: round3(center.map((c) => c / weight)),
      window: { u: round3(u), v: round3(v), min: [round(u0), round(v0)], max: [round(u1), round(v1)] },
      span: Number.isFinite(spanLo) ? [round(spanLo), round(spanHi)] : null,
      features: [...features].sort(),
      frees: [...freed].sort(),
      faces: faces.slice(0, 12),
      face: { triangleCount: faceCells.length, positions },
    });
  }
  groups.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || b.area - a.area
    || a.pull[0] - b.pull[0] || a.pull[1] - b.pull[1] || a.pull[2] - b.pull[2]);
  groups.forEach((group, id) => { group.id = id; });
  let slideCount = 0;
  let lifterCount = 0;
  let unresolvedCount = 0;
  for (const group of groups) {
    if (group.kind === 'slide') slideCount += 1;
    else if (group.kind === 'lifter') lifterCount += 1;
    else unresolvedCount += 1;
  }
  return {
    heuristic: true,
    alignDeg: SIDE_ACTION_ALIGN_DEG,
    lifterDeg: SIDE_ACTION_LIFTER_DEG,
    count: groups.length,
    slideCount,
    lifterCount,
    unresolvedCount,
    groups,
  };
}

/**
 * Core/cavity legend plus one row per slide or lifter. The Side action
 * swatch is inserted only when that count is greater than 0.
 * `partingLegendModel` itself stays the three role rows.
 */
export function splitLegendModel(parting, sideActions = null, selectedId = null) {
  const base = partingLegendModel(parting);
  if (!base) return null;
  const groups = Array.isArray(sideActions?.groups) ? sideActions.groups : [];
  const showSide = (sideActions?.count || 0) > 0 || groups.length > 0;
  const rows = [];
  for (const row of base.rows) {
    if (row.role === 'parting-line' && showSide) {
      rows.push({ role: 'side', label: 'Side action', css: rgbCss(SIDE_ACTION_FACE_RGB) });
    }
    rows.push(row);
  }
  return {
    rows,
    groups: groups.map((group) => ({
      id: group.id,
      kind: group.kind,
      label: KIND_LABEL[group.kind] || 'Slide',
      pull: formatPull(group.pull),
      areaLabel: formatArea(group.area),
      css: rgbCss(sideActionRgb(group.kind, 0)),
      selected: selectedId != null && group.id === selectedId,
    })),
    heuristic: true,
    count: sideActions?.count || 0,
    slideCount: sideActions?.slideCount || 0,
    lifterCount: sideActions?.lifterCount || 0,
    unresolvedCount: sideActions?.unresolvedCount || 0,
  };
}

/** Legend rows. Null without an analysis. Zero groups produce no rows. */
export function sideActionLegendModel(sideActions) {
  if (!sideActions || !Array.isArray(sideActions.groups)) return null;
  const groups = sideActions.groups;
  const rows = groups.slice(0, 4).map((group, index) => ({
    id: group.id,
    kind: group.kind,
    label: KIND_LABEL[group.kind] || 'Slide',
    pull: formatPull(group.pull),
    areaLabel: formatArea(group.area),
    css: rgbCss(sideActionRgb(group.kind, index)),
  }));
  return {
    heuristic: true,
    count: sideActions.count || 0,
    slideCount: sideActions.slideCount || 0,
    lifterCount: sideActions.lifterCount || 0,
    rows,
    more: Math.max(0, groups.length - rows.length),
  };
}
