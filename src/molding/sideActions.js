/**
 * Side-action groups (injection molding, M2.2).
 *
 * Only a true undercut becomes a slide or a lifter. A region whose normal
 * lies within `PARTING_ZERO_DRAFT_DEG` of the parting plane is a vertical
 * wall, not a side action. Draft analysis owns that wall. Nothing here
 * names a part or turns a zero-draft wall into a slide.
 *
 * Each remaining region gets an escape direction. Candidates lie in the
 * parting plane: the in-plane part of the region's normal first, then a
 * ring of in-plane samples. The first direction whose faces are not blocked
 * by the rest of the part is a slide. When every lateral move hits the
 * part before it leaves, an angled direction into the core (−pull plus
 * lateral) is a lifter. The split is a heuristic. A true undercut is
 * blocked along ±pull, so the escape is never that axis.
 *
 * Regions of the same kind and the same side whose suggested pulls agree
 * within 35° are one action, including when they sit far apart. Opposite
 * walls disagree in direction, so they stay separate. Nothing here builds
 * mold CAD. A messy mesh returns groups instead of failing.
 */

import { PARTING_ZERO_DRAFT_DEG, partingLegendModel } from './parting.js';

/** Matches `MOLD_REGION_NORMAL_DEG`. Suggested pulls this close share an action. */
export const SIDE_ACTION_ALIGN_DEG = 35;
/** An angled lifter leaves the parting plane by this much, into the core. */
export const SIDE_ACTION_LIFTER_DEG = 20;

const ALIGN_COS = Math.cos((SIDE_ACTION_ALIGN_DEG * Math.PI) / 180);
const CANDIDATE_COS = Math.cos((15 * Math.PI) / 180);
const ESCAPE_SKIN_MM = 0.05;
const SAMPLE_COUNT = 12;
/** Same band as the undercut test. A wall this close to vertical is not a side action. */
const VERTICAL_SIN = Math.sin((PARTING_ZERO_DRAFT_DEG * Math.PI) / 180);

/** Discrete skin colours. Not stress, and not a CSS token. */
export const SIDE_ACTION_KIND_RGB = Object.freeze({
  slide: Object.freeze([0.15, 0.55, 0.38]),
  lifter: Object.freeze([0.48, 0.32, 0.70]),
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

function inPlaneCandidates(normal, pull) {
  const d = unit(pull);
  if (!d) return [];
  const { u, v } = basisOf(d);
  const dirs = [];
  const hinted = suggestSidePull(normal, d);
  if (hinted) {
    pushUnique(dirs, hinted.pull);
    pushUnique(dirs, hinted.pull.map((n) => -n));
  }
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const ang = (i * 2 * Math.PI) / SAMPLE_COUNT;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    pushUnique(dirs, [
      u[0] * c + v[0] * s,
      u[1] * c + v[1] * s,
      u[2] * c + v[2] * s,
    ]);
  }
  return dirs;
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

function samplesOf(region, byIndex) {
  const out = [];
  const ids = Array.isArray(region?.triangles) ? region.triangles : [];
  for (const id of ids) {
    const tri = byIndex.get(id);
    if (!tri?.centroid || !tri.n) continue;
    const n = tri.n;
    const c = tri.centroid;
    out.push([
      c[0] + n[0] * ESCAPE_SKIN_MM,
      c[1] + n[1] * ESCAPE_SKIN_MM,
      c[2] + n[2] * ESCAPE_SKIN_MM,
    ]);
  }
  return out;
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

function clearanceOf(samples, dir, tris, own, bounds) {
  if (!samples.length) return Infinity;
  let nearest = Infinity;
  for (const origin of samples) {
    const limit = rayAabbExit(origin, dir, bounds.min, bounds.max);
    for (const tri of tris) {
      if (own.has(tri.t)) continue;
      const t = rayHit(origin, dir, tri);
      if (t != null && t < limit && t < nearest) nearest = t;
    }
  }
  return nearest;
}

function escapeForRegion(region, pull, tris, byIndex, bounds) {
  const d = unit(pull);
  const candidates = inPlaneCandidates(region?.normal, d);
  const own = new Set(region?.triangles || []);
  const samples = tris ? samplesOf(region, byIndex) : [];
  const exits = (dir) => {
    if (!tris || !samples.length) return true;
    return samples.every((origin) => sampleExits(origin, dir, tris, own, bounds));
  };
  for (const dir of candidates) {
    if (exits(dir)) return { kind: 'slide', pull: round3(dir), clear: true };
  }
  const angled = [];
  const sine = Math.sin((SIDE_ACTION_LIFTER_DEG * Math.PI) / 180);
  const cosine = Math.cos((SIDE_ACTION_LIFTER_DEG * Math.PI) / 180);
  for (const dir of candidates) {
    pushUnique(angled, [
      dir[0] * cosine - d[0] * sine,
      dir[1] * cosine - d[1] * sine,
      dir[2] * cosine - d[2] * sine,
    ]);
  }
  for (const dir of angled) {
    if (exits(dir)) return { kind: 'lifter', pull: round3(dir), clear: true };
  }
  let best = candidates[0] || basisOf(d).u;
  let bestGap = -1;
  for (const dir of candidates) {
    const gap = tris ? clearanceOf(samples, dir, tris, own, bounds) : Infinity;
    if (gap > bestGap) {
      bestGap = gap;
      best = dir;
    }
  }
  const lifter = unit([
    best[0] * cosine - d[0] * sine,
    best[1] * cosine - d[1] * sine,
    best[2] * cosine - d[2] * sine,
  ]) || best;
  return { kind: 'lifter', pull: round3(lifter), clear: false };
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
    groups: [],
  };
}

/**
 * Cluster undercut regions into side actions along `pull`.
 * A bad pull or a missing list is zero groups, not an error.
 */
export function groupSideActions(regions, pull, tris = null) {
  const d = unit(pull);
  if (!d || !Array.isArray(regions)) return emptyActions();
  const mesh = Array.isArray(tris) && tris.length ? tris : null;
  const byIndex = new Map();
  if (mesh) {
    for (const tri of mesh) byIndex.set(tri.t, tri);
  }
  const bounds = mesh ? boundsOf(mesh) : null;
  const members = [];
  for (const region of regions) {
    if (!clearsVertical(region?.normal, d)) continue;
    if (region.side !== 1 && region.side !== -1) continue;
    const escape = escapeForRegion(region, d, mesh, byIndex, bounds);
    if (!escape?.pull) continue;
    members.push({
      region,
      kind: escape.kind,
      pull: escape.pull,
      clear: !!escape.clear,
    });
  }
  const parent = members.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    return x;
  };
  const unite = (i, j) => {
    if (members[i].kind !== members[j].kind) return;
    if (members[i].region.side !== members[j].region.side) return;
    if (dot(members[i].pull, members[j].pull) < ALIGN_COS) return;
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) unite(i, j);
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
    const pullSum = [0, 0, 0];
    const center = [0, 0, 0];
    const regionIds = [];
    const triangles = [];
    for (const member of list) {
      const weight = member.region.area || 0;
      area += weight;
      regionIds.push(member.region.id);
      if (Array.isArray(member.region.triangles)) triangles.push(...member.region.triangles);
      const scale = weight || 1;
      const at = member.region.centroid || [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        pullSum[k] += member.pull[k] * scale;
        center[k] += at[k] * scale;
      }
    }
    const weight = area || list.length;
    const merged = unit(pullSum) || list[0].pull;
    groups.push({
      kind: list[0].kind,
      heuristic: true,
      clear: list.every((member) => member.clear),
      pull: round3(merged),
      side: list[0].region.side,
      area: round(area),
      regionIds,
      triangles: triangles.slice().sort((a, b) => a - b),
      center: round3(center.map((c) => c / weight)),
    });
  }
  groups.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'slide' ? -1 : 1;
    return b.area - a.area || a.pull[0] - b.pull[0] || a.pull[1] - b.pull[1] || a.pull[2] - b.pull[2];
  });
  groups.forEach((group, id) => { group.id = id; });
  let slideCount = 0;
  let lifterCount = 0;
  for (const group of groups) {
    if (group.kind === 'slide') slideCount += 1;
    else lifterCount += 1;
  }
  return {
    heuristic: true,
    alignDeg: SIDE_ACTION_ALIGN_DEG,
    lifterDeg: SIDE_ACTION_LIFTER_DEG,
    count: groups.length,
    slideCount,
    lifterCount,
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
      label: group.kind === 'lifter' ? 'Lifter' : 'Slide',
      pull: formatPull(group.pull),
      areaLabel: formatArea(group.area),
      css: rgbCss(sideActionRgb(group.kind, 0)),
      selected: selectedId != null && group.id === selectedId,
    })),
    heuristic: true,
    count: sideActions?.count || 0,
    slideCount: sideActions?.slideCount || 0,
    lifterCount: sideActions?.lifterCount || 0,
  };
}

/** Legend rows. Null without an analysis. Zero groups produce no rows. */
export function sideActionLegendModel(sideActions) {
  if (!sideActions || !Array.isArray(sideActions.groups)) return null;
  const groups = sideActions.groups;
  const rows = groups.slice(0, 4).map((group, index) => ({
    id: group.id,
    kind: group.kind,
    label: group.kind === 'lifter' ? 'Lifter' : 'Slide',
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
