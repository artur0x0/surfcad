/**
 * Mold draft and ejector hints (injection molding).
 *
 * Draft here is signed against the pull. Positive draft opens along the
 * pull, on an outside wall and on a hole wall. Negative draft closes along
 * the pull: the steel on the outward-normal side cannot pull off.
 *
 * Three classes, against the selected threshold T. Positive draft at or
 * above T is Positive ≥ T and uses the cavity colour. Negative draft at or
 * above T is Negative ≥ T and uses the core colour. Absolute draft below T,
 * either sign, is Below T: a red hatch, the needs-work class. A side wall
 * at 0° is Below T and its sign stays positive. There is no zero-draft
 * class. Every triangle is classified, including tops, bottoms, and
 * fillets. The angle is that triangle's geometric normal. A stamped face
 * normal is one average for the whole face, and using it would drop a
 * curved fillet whose average leaves the side-wall band. Nothing here
 * changes the mesh.
 *
 * The sign uses the part centroid in the plane perpendicular to the pull.
 * A normal that points away from that center is an outside wall, and its
 * lean is flipped. A normal that points toward the center is a hole wall,
 * and its lean is kept. An off-center hole can misread the near wall.
 *
 * Ejector pins and sleeves are a heuristic on the wall field. A thin side
 * wall is a rib, and each connected patch gets a pin at its centroid. A
 * thick face that looks against the pull is a boss end, and each connected
 * patch gets a sleeve. This is not a mold design.
 */

import { PARTING_NEUTRAL_DEG, PARTING_ROLE_RGB } from './parting.js';

/** Default threshold. |draft| at or above this leaves the needs-work class. */
export const MOLD_DRAFT_MIN_DEG = 1;
/** Buttons in the draft section. The agent may pass any angle in (0, 90]. */
export const MOLD_DRAFT_PRESETS = Object.freeze([0.5, 1, 2, 3, 5]);
/** Same band as `PARTING_NEUTRAL_DEG`. Ejector pins use it. Draft does not. */
export const MOLD_DRAFT_NEUTRAL_DEG = PARTING_NEUTRAL_DEG;
/** Matches `MOLD_REGION_NORMAL_DEG`. Triangles this close stay one face. */
export const MOLD_DRAFT_CLUSTER_DEG = 35;

const NEUTRAL_SIN = Math.sin((MOLD_DRAFT_NEUTRAL_DEG * Math.PI) / 180);
const CLUSTER_COS = Math.cos((MOLD_DRAFT_CLUSTER_DEG * Math.PI) / 180);
const SIDE_EPS = 1e-4;

/**
 * Positive ≥ T. The same array as the cavity face in `PARTING_ROLE_RGB`.
 * Negative ≥ T is `PARTING_ROLE_RGB.core`. Neither value is copied.
 */
export const MOLD_DRAFT_POSITIVE_RGB = PARTING_ROLE_RGB.cavity;
export const MOLD_DRAFT_NEGATIVE_RGB = PARTING_ROLE_RGB.core;
/**
 * Needs-work fill for |draft| below the threshold.
 * Same channels as `--mold-draft-needs-work` (red-400, `.feature-failed-ring`).
 * Copied because the skin cannot read a stylesheet.
 */
export const MOLD_DRAFT_NEEDS_WORK_RGB = Object.freeze([248 / 255, 113 / 255, 113 / 255]);
/** Dark stripe on a needs-work face. Matches `--mold-draft-hatch`. */
export const MOLD_DRAFT_HATCH_RGB = Object.freeze([15 / 255, 23 / 255, 42 / 255]);

/** Space-separated channels for the legend swatches. Source is the role colours. */
export function moldDraftSwatchChannels() {
  const channels = (rgb) => rgb.map((channel) => Math.round(channel * 255)).join(' ');
  return {
    positive: channels(MOLD_DRAFT_POSITIVE_RGB),
    negative: channels(MOLD_DRAFT_NEGATIVE_RGB),
  };
}

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

function horizontal(v, d) {
  const along = dot(v, d);
  return [v[0] - d[0] * along, v[1] - d[1] * along, v[2] - d[2] * along];
}

/** Draft angle in degrees between a wall and the pull. 0 is parallel to the pull. */
export function draftAngleDeg(normal, pull) {
  const n = unit(normal);
  const d = unit(pull);
  if (!n || !d) return null;
  const along = Math.min(1, Math.abs(dot(n, d)));
  return round((Math.asin(along) * 180) / Math.PI);
}

/**
 * Accept an angle in (0, 90]. Null means "keep the current threshold".
 * Anything else is `bad_args` and does not change the open tool.
 */
export function parseDraftThreshold(value) {
  if (value == null || value === '') return { threshold: null };
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 90) {
    return {
      error: {
        code: 'bad_args',
        message: 'threshold must be an angle in (0, 90] degrees',
      },
    };
  }
  return { threshold: round(n) };
}

function thresholdOf(value) {
  const parsed = parseDraftThreshold(value);
  return parsed.threshold == null ? MOLD_DRAFT_MIN_DEG : parsed.threshold;
}

function partCenter(tris) {
  const center = [0, 0, 0];
  let weight = 0;
  for (const tri of tris) {
    const w = tri.area > 0 ? tri.area : 1;
    const at = tri.centroid || [0, 0, 0];
    weight += w;
    for (let k = 0; k < 3; k++) center[k] += at[k] * w;
  }
  if (!(weight > 0)) return [0, 0, 0];
  return center.map((c) => c / weight);
}

/**
 * Signed draft in degrees. Positive opens along `pull`. `center` is the
 * part centroid. A lone triangle on that center keeps the raw lean.
 */
export function signedDraftDeg(normal, pull, centroid, center) {
  const n = unit(normal);
  const d = unit(pull);
  if (!n || !d) return null;
  const along = Math.max(-1, Math.min(1, dot(n, d)));
  const lean = (Math.asin(along) * 180) / Math.PI;
  const at = centroid || center || [0, 0, 0];
  const origin = center || [0, 0, 0];
  const offset = [at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]];
  const exterior = dot(horizontal(n, d), horizontal(offset, d)) > SIDE_EPS;
  const signed = exterior ? -lean : lean;
  if (Math.abs(signed) < 1e-4) return 0;
  return round(signed);
}

function stateOf(signed, threshold) {
  if (signed >= threshold) return 'positive';
  if (signed <= -threshold) return 'negative';
  return 'below';
}

/** A wall at 0° stays positive. Only a strict negative closes along the pull. */
function signOf(signed) {
  return signed < 0 ? 'negative' : 'positive';
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

function bucketOf(members) {
  const regions = cluster(members);
  let area = 0;
  for (const member of members) area += member.area || 0;
  return { count: regions.length, area: round(area), regions };
}

function emptyEjectors() {
  return {
    heuristic: true,
    pull: null,
    pinCount: 0,
    sleeveCount: 0,
    pins: [],
    sleeves: [],
  };
}

function emptyBucket() {
  return { count: 0, area: 0, regions: [] };
}

function emptyCount() {
  return { count: 0, area: 0 };
}

function emptyBelow() {
  return { count: 0, area: 0, regions: [], positive: emptyCount(), negative: emptyCount() };
}

function emptyDraft(threshold = MOLD_DRAFT_MIN_DEG) {
  return {
    minDeg: threshold,
    neutralDeg: MOLD_DRAFT_NEUTRAL_DEG,
    positive: emptyBucket(),
    negative: emptyBucket(),
    below: emptyBelow(),
    violationCount: 0,
    triangleCount: 0,
    minDraftDeg: null,
    regions: [],
    triangles: [],
    samples: [],
    ejectors: emptyEjectors(),
  };
}

/**
 * Rebucket a stored signed field. Same `samples` array: a threshold change
 * does not measure the mesh again.
 */
export function classifyMoldDraft(report, threshold = MOLD_DRAFT_MIN_DEG) {
  const minDeg = thresholdOf(threshold);
  const samples = Array.isArray(report?.samples) ? report.samples : [];
  if (!samples.length) {
    const empty = emptyDraft(minDeg);
    empty.ejectors = report?.ejectors || empty.ejectors;
    return empty;
  }
  const positiveMembers = [];
  const negativeMembers = [];
  const belowPositive = [];
  const belowNegative = [];
  const triangles = [];
  let minDraft = null;
  for (const sample of samples) {
    const signed = sample.signedDeg;
    if (minDraft == null || signed < minDraft) minDraft = signed;
    const state = stateOf(signed, minDeg);
    const sign = signOf(signed);
    const member = { ...sample, t: sample.t, draftDeg: signed, state, sign };
    if (state === 'positive') positiveMembers.push(member);
    else if (state === 'negative') negativeMembers.push(member);
    else if (sign === 'negative') belowNegative.push(member);
    else belowPositive.push(member);
    triangles.push({ index: sample.t, signedDeg: signed, state, sign });
  }
  triangles.sort((a, b) => a.index - b.index);
  const positive = bucketOf(positiveMembers);
  const negative = bucketOf(negativeMembers);
  const belowPos = bucketOf(belowPositive);
  const belowNeg = bucketOf(belowNegative);
  const regions = belowPos.regions.concat(belowNeg.regions);
  regions.forEach((region, id) => { region.id = id; });
  let belowArea = 0;
  for (const member of belowPositive) belowArea += member.area || 0;
  for (const member of belowNegative) belowArea += member.area || 0;
  const below = {
    count: belowPos.count + belowNeg.count,
    area: round(belowArea),
    regions,
    positive: { count: belowPos.count, area: belowPos.area },
    negative: { count: belowNeg.count, area: belowNeg.area },
  };
  return {
    minDeg,
    neutralDeg: MOLD_DRAFT_NEUTRAL_DEG,
    positive,
    negative,
    below,
    violationCount: below.count,
    triangleCount: triangles.length,
    minDraftDeg: minDraft == null ? null : round(minDraft),
    regions,
    triangles,
    samples,
    ejectors: report.ejectors || emptyEjectors(),
  };
}

/**
 * Signed draft and ejector candidates along `pull`.
 * A bad pull or an empty mesh is an empty report, not an error.
 * The buckets use the default 1° threshold. `classifyMoldDraft` retargets them.
 * Positive ≥ T, Negative ≥ T, and Below T, with the Below T sign split.
 * Every triangle with a geometric normal is sampled. `nGeom` wins over the
 * stamped face normal in `n`, which is one average and mis-aims a fillet.
 * The 10° band stays on ejector ribs only.
 */
export function analyzeMoldDraft(tris, pull, wall = null) {
  const d = unit(pull);
  if (!d || !Array.isArray(tris) || !tris.length) return emptyDraft();
  const flags = flagOf(wall);
  const center = partCenter(tris);
  const samples = [];
  const ribs = [];
  const bosses = [];
  for (const tri of tris) {
    const n = unit(tri.nGeom || tri.n);
    if (!n) continue;
    const along = dot(n, d);
    const sideWall = Math.abs(along) <= NEUTRAL_SIN;
    const angle = draftAngleDeg(n, d);
    const signed = signedDraftDeg(n, d, tri.centroid, center);
    if (signed != null) {
      samples.push({
        t: tri.t,
        ia: tri.ia,
        ib: tri.ib,
        ic: tri.ic,
        n,
        area: tri.area || 0,
        centroid: tri.centroid || [0, 0, 0],
        signedDeg: signed,
      });
    }
    const flag = flags.get(tri.t);
    if (flag === 'thin' && sideWall) ribs.push({ ...tri, n, draftDeg: angle });
    if (flag === 'thick' && along < -NEUTRAL_SIN) bosses.push({ ...tri, n, draftDeg: angle });
  }
  const pins = places(cluster(ribs), 'pin');
  const sleeves = places(cluster(bosses), 'sleeve');
  const classified = classifyMoldDraft({ samples, ejectors: emptyEjectors() }, MOLD_DRAFT_MIN_DEG);
  classified.ejectors = {
    heuristic: true,
    pull: round3(d),
    pinCount: pins.length,
    sleeveCount: sleeves.length,
    pins,
    sleeves,
  };
  return classified;
}

function packBucket(bucket) {
  return { count: bucket?.count || 0, area: bucket?.area || 0 };
}

/** Counts and areas for the legend, the agent result, and the report line. */
export function moldDraftSummary(moldDraft) {
  if (!moldDraft || moldDraft.positive == null) return null;
  const below = moldDraft.below || emptyBelow();
  return {
    threshold: moldDraft.minDeg,
    positive: packBucket(moldDraft.positive),
    negative: packBucket(moldDraft.negative),
    below: {
      count: below.count || 0,
      area: below.area || 0,
      positive: packBucket(below.positive),
      negative: packBucket(below.negative),
    },
    violations: moldDraft.violationCount,
    minDeg: moldDraft.minDeg,
    minDraftDeg: moldDraft.minDraftDeg,
    pins: moldDraft.ejectors?.pinCount || 0,
    sleeves: moldDraft.ejectors?.sleeveCount || 0,
  };
}

/** Legend rows. Null without a report. */
export function moldDraftLegendModel(moldDraft) {
  const summary = moldDraftSummary(moldDraft);
  if (!summary) return null;
  return {
    heuristic: true,
    minDeg: summary.minDeg,
    presets: MOLD_DRAFT_PRESETS,
    positive: summary.positive,
    negative: summary.negative,
    below: summary.below,
    violations: summary.violations,
    pins: summary.pins,
    sleeves: summary.sleeves,
  };
}
