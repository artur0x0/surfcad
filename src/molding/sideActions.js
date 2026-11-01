/**
 * Side-action groups (injection molding, M2.2).
 *
 * Only a true undercut becomes a slide or a lifter. A region whose normal
 * lies within `PARTING_ZERO_DRAFT_DEG` of the parting plane is a vertical
 * wall, not a side action. Draft analysis owns that wall. Nothing here
 * names a part or turns a zero-draft wall into a slide.
 *
 * Each remaining region gets a release direction from its own normal.
 * A normal within 45° of the main pull is a lifter, and its pull is that
 * normal (the way the steel leaves the plastic). A normal closer to the
 * parting plane is a slide, and its pull is the part of the normal that
 * lies in the parting plane. The split is a heuristic.
 *
 * Regions of the same kind and the same side whose suggested pulls agree
 * within 35° are one action, including when they sit far apart. Opposite
 * walls disagree in direction, so they stay separate. Nothing here builds
 * mold CAD. A messy mesh returns groups instead of failing.
 */

import { PARTING_ZERO_DRAFT_DEG } from './parting.js';

/** Matches `MOLD_REGION_NORMAL_DEG`. Suggested pulls this close share an action. */
export const SIDE_ACTION_ALIGN_DEG = 35;
/** A normal within this angle of the main pull is called a lifter. Heuristic. */
export const SIDE_ACTION_LIFTER_DEG = 45;

const ALIGN_COS = Math.cos((SIDE_ACTION_ALIGN_DEG * Math.PI) / 180);
const LIFTER_COS = Math.cos((SIDE_ACTION_LIFTER_DEG * Math.PI) / 180);
/** Same band as the undercut test. A wall this close to vertical is not a side action. */
const VERTICAL_SIN = Math.sin((PARTING_ZERO_DRAFT_DEG * Math.PI) / 180);

/** Discrete skin colours. Not stress, and not a CSS token. */
export const SIDE_ACTION_KIND_RGB = Object.freeze({
  slide: Object.freeze([0.15, 0.55, 0.38]),
  lifter: Object.freeze([0.48, 0.32, 0.70]),
});

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

/**
 * Heuristic pull for one undercut region. `lifter` when the normal is
 * within 45° of the main pull; otherwise `slide` in the parting plane.
 * Returns null when either vector is zero.
 */
export function suggestSidePull(normal, pull) {
  const n = unit(normal);
  const d = unit(pull);
  if (!n || !d) return null;
  const along = dot(n, d);
  const lateral = [n[0] - d[0] * along, n[1] - d[1] * along, n[2] - d[2] * along];
  if (Math.abs(along) >= LIFTER_COS || !(len(lateral) > 1e-8)) {
    return { kind: 'lifter', pull: round3(n) };
  }
  const slide = unit(lateral);
  if (!slide) return { kind: 'lifter', pull: round3(n) };
  return { kind: 'slide', pull: round3(slide) };
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
export function groupSideActions(regions, pull) {
  const d = unit(pull);
  if (!d || !Array.isArray(regions)) return emptyActions();
  const members = [];
  for (const region of regions) {
    if (!clearsVertical(region?.normal, d)) continue;
    const suggested = suggestSidePull(region?.normal, d);
    if (!suggested || (region.side !== 1 && region.side !== -1)) continue;
    members.push({ region, kind: suggested.kind, pull: suggested.pull });
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

/** Legend rows. Null without an analysis. Zero groups still produce a chip. */
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
