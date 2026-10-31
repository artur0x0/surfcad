/**
 * Mold draft and ejector hints (injection molding, M2.3).
 *
 * Draft here is the angle a side wall makes with the pull. A wall parallel
 * to the pull has 0°. Core and cavity faces sit outside the 10° band from
 * M2.1 and are left alone. A side wall below 1° is a violation. Nothing
 * here changes the mesh.
 *
 * Ejector pins and sleeves are a heuristic on the wall field. A thin side
 * wall is a rib, and each connected patch gets a pin at its centroid. A
 * thick face that looks against the pull is a boss end, and each connected
 * patch gets a sleeve. The two faces of a rib that do not share a vertex
 * stay two pins. This is not a mold design.
 */

import { PARTING_NEUTRAL_DEG } from './parting.js';

/** Side walls below this draft angle are violations. */
export const MOLD_DRAFT_MIN_DEG = 1;
/** Same band as `PARTING_NEUTRAL_DEG`. Only these walls are checked for draft. */
export const MOLD_DRAFT_NEUTRAL_DEG = PARTING_NEUTRAL_DEG;
/** Matches `MOLD_REGION_NORMAL_DEG`. Violation triangles this close stay one face. */
export const MOLD_DRAFT_CLUSTER_DEG = 35;

const NEUTRAL_SIN = Math.sin((MOLD_DRAFT_NEUTRAL_DEG * Math.PI) / 180);
const CLUSTER_COS = Math.cos((MOLD_DRAFT_CLUSTER_DEG * Math.PI) / 180);

/** Violation colour. Not a CSS token and not the CAD draft chip. */
export const MOLD_DRAFT_RGB = Object.freeze([0.86, 0.52, 0.16]);

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

/** Draft angle in degrees between a wall and the pull. 0 is parallel to the pull. */
export function draftAngleDeg(normal, pull) {
  const n = unit(normal);
  const d = unit(pull);
  if (!n || !d) return null;
  const along = Math.min(1, Math.abs(dot(n, d)));
  return round((Math.asin(along) * 180) / Math.PI);
}

function cluster(members) {
  const parent = members.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    return x;
  };
  const unite = (i, j) => {
    if (members[i].n && members[j].n && dot(members[i].n, members[j].n) < CLUSTER_COS) return;
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  const at = new Map();
  members.forEach((member, i) => {
    for (const v of [member.ia, member.ib, member.ic]) {
      const key = v;
      let list = at.get(key);
      if (!list) {
        list = [];
        at.set(key, list);
      }
      list.push(i);
    }
  });
  for (const list of at.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) unite(list[i], list[j]);
    }
  }
  const buckets = new Map();
  members.forEach((member, i) => {
    const root = find(i);
    let list = buckets.get(root);
    if (!list) {
      list = [];
      buckets.set(root, list);
    }
    list.push(member);
  });
  const groups = [];
  for (const list of buckets.values()) {
    let area = 0;
    const center = [0, 0, 0];
    const normal = [0, 0, 0];
    let draftAcc = 0;
    let minDraft = Infinity;
    const triangles = [];
    for (const member of list) {
      const weight = member.area || 0;
      area += weight;
      const scale = weight || 1;
      const atPoint = member.centroid || [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        center[k] += atPoint[k] * scale;
        normal[k] += (member.n?.[k] || 0) * scale;
      }
      draftAcc += (member.draftDeg || 0) * scale;
      if (member.draftDeg < minDraft) minDraft = member.draftDeg;
      triangles.push(member.t);
    }
    const weight = area || list.length;
    groups.push({
      area: round(area),
      triangleCount: list.length,
      draftDeg: round(draftAcc / weight),
      minDraftDeg: Number.isFinite(minDraft) ? round(minDraft) : null,
      normal: round3(unit(normal) || [0, 0, 0]),
      center: round3(center.map((c) => c / weight)),
      triangles: triangles.slice().sort((a, b) => a - b),
    });
  }
  groups.sort((a, b) => b.area - a.area || a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2]);
  groups.forEach((group, id) => { group.id = id; });
  return groups;
}

function flagOf(wall) {
  const flags = new Map();
  const field = Array.isArray(wall?.field) ? wall.field : [];
  for (const sample of field) {
    if (sample?.index == null) continue;
    flags.set(sample.index, sample.flag);
  }
  return flags;
}

function places(groups, kind) {
  return groups.map((group) => ({
    id: group.id,
    kind,
    center: group.center,
    area: group.area,
    triangleCount: group.triangleCount,
  }));
}

function emptyDraft() {
  return {
    minDeg: MOLD_DRAFT_MIN_DEG,
    neutralDeg: MOLD_DRAFT_NEUTRAL_DEG,
    violationCount: 0,
    triangleCount: 0,
    minDraftDeg: null,
    regions: [],
    triangles: [],
    ejectors: {
      heuristic: true,
      pull: null,
      pinCount: 0,
      sleeveCount: 0,
      pins: [],
      sleeves: [],
    },
  };
}

/**
 * Draft violations and ejector candidates along `pull`.
 * A bad pull or an empty mesh is an empty report, not an error.
 */
export function analyzeMoldDraft(tris, pull, wall = null) {
  const d = unit(pull);
  if (!d || !Array.isArray(tris) || !tris.length) return emptyDraft();
  const flags = flagOf(wall);
  const violations = [];
  const ribs = [];
  const bosses = [];
  for (const tri of tris) {
    const n = unit(tri.n);
    if (!n) continue;
    const along = dot(n, d);
    const angle = draftAngleDeg(n, d);
    const sideWall = Math.abs(along) <= NEUTRAL_SIN;
    if (sideWall && angle != null && angle < MOLD_DRAFT_MIN_DEG) {
      violations.push({ ...tri, n, draftDeg: angle });
    }
    const flag = flags.get(tri.t);
    if (flag === 'thin' && sideWall) ribs.push({ ...tri, n, draftDeg: angle });
    if (flag === 'thick' && along < -NEUTRAL_SIN) bosses.push({ ...tri, n, draftDeg: angle });
  }
  const regions = cluster(violations);
  const pins = places(cluster(ribs), 'pin');
  const sleeves = places(cluster(bosses), 'sleeve');
  let minDraft = null;
  const triangles = [];
  for (const region of regions) {
    if (minDraft == null || region.minDraftDeg < minDraft) minDraft = region.minDraftDeg;
    for (const index of region.triangles) {
      const row = violations.find((tri) => tri.t === index);
      triangles.push({ index, draftDeg: row ? row.draftDeg : region.draftDeg });
    }
  }
  triangles.sort((a, b) => a.index - b.index);
  return {
    minDeg: MOLD_DRAFT_MIN_DEG,
    neutralDeg: MOLD_DRAFT_NEUTRAL_DEG,
    violationCount: regions.length,
    triangleCount: triangles.length,
    minDraftDeg: minDraft,
    regions,
    triangles,
    ejectors: {
      heuristic: true,
      pull: round3(d),
      pinCount: pins.length,
      sleeveCount: sleeves.length,
      pins,
      sleeves,
    },
  };
}

/** Legend rows. Null without a report. */
export function moldDraftLegendModel(moldDraft) {
  if (!moldDraft || moldDraft.violationCount == null) return null;
  return {
    heuristic: true,
    minDeg: moldDraft.minDeg,
    violations: moldDraft.violationCount,
    pins: moldDraft.ejectors?.pinCount || 0,
    sleeves: moldDraft.ejectors?.sleeveCount || 0,
    css: rgbCss(MOLD_DRAFT_RGB),
  };
}
