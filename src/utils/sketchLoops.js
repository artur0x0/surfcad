/**
 * A sketch keeps every closed loop. A later rectangle, circle, polygon, or
 * closed polyline is another loop on the same contour, not a replacement.
 * Extrude classifies those loops by containment: a loop strictly inside
 * another is a hole. An explicit outer/hole role on a saved contour overrides
 * that test. makeExtrude still receives outer-plus-holes; this module only
 * decides which loops share one call.
 */

import { contourFromTool } from './contourGesture.js';
import { parseSolveContour } from './contourScript.js';
import { solveContour } from './contourSolve.js';
import { assignSeq } from './contourStrip.js';
import { buildProfileFromParams } from './crossSectionSubstrate.js';

const ID_FIELDS = ['a', 'b', 'center', 'start', 'end', 'edge', 'arc', 'point'];
const LISTS = [
  ['points', 'p'],
  ['lines', 'e'],
  ['arcs', 'a'],
  ['dimensions', 'd'],
  ['constraints', 'k'],
  ['refs', 'r'],
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapId(id, map) {
  if (!id) return id;
  return map.get(id) || id;
}

function remapItem(item, map) {
  const next = { ...item, id: mapId(item.id, map) };
  for (const key of ID_FIELDS) {
    if (next[key]) next[key] = mapId(next[key], map);
  }
  if (Array.isArray(next.items)) next.items = next.items.map((id) => mapId(id, map));
  if (next.at && typeof next.at === 'object' && !Array.isArray(next.at)) {
    next.at = Object.fromEntries(
      Object.entries(next.at).map(([key, value]) => [mapId(key, map), value]),
    );
  }
  return next;
}

function usedIds(spec) {
  const used = new Set();
  for (const [key] of LISTS) {
    for (const item of spec?.[key] || []) {
      if (item?.id) used.add(item.id);
    }
  }
  return used;
}

function takeId(used, prefix) {
  let n = 0;
  let id = `${prefix}${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  used.add(id);
  return id;
}

function remapSpec(spec, map) {
  const next = {};
  for (const [key] of LISTS) {
    next[key] = (spec?.[key] || []).map((item) => remapItem(item, map));
  }
  if (spec?.polyline) next.polyline = true;
  if (spec?.centers) next.centers = true;
  return next;
}

/** Fresh ids for `extra` wherever they would collide with `base`. */
export function mergeContourSpecs(base, extra) {
  const used = usedIds(base);
  const map = new Map();
  for (const [key, prefix] of LISTS) {
    for (const item of extra?.[key] || []) {
      if (!item?.id) continue;
      const id = used.has(item.id) ? takeId(used, prefix) : item.id;
      used.add(id);
      map.set(item.id, id);
    }
  }
  const incoming = remapSpec(extra, map);
  const merged = {};
  for (const [key] of LISTS) {
    merged[key] = [...(base?.[key] || []), ...(incoming[key] || [])];
  }
  if (base?.polyline && extra?.polyline) merged.polyline = true;
  return assignSeq(merged);
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/** A primitive or a solved contour that closes. Centres sketches do not. */
export function incomingClosedProfile(tool, params) {
  const p = params || {};
  if (p.centers || p.contour?.centers) return false;
  if (p.contour?.points?.length || p.contour?.arcs?.length || p.contour?.lines?.length) {
    try {
      return (solveContour(p.contour).contours || []).length > 0;
    } catch {
      return false;
    }
  }
  if (tool === 'rectangle') return positive(p.width) && positive(p.height);
  if (tool === 'circle') return positive(p.radius);
  if (tool === 'polygon') return positive(p.radius);
  if (tool === 'polyline' || tool === 'cursor') {
    return Array.isArray(p.points) && p.points.length >= 3;
  }
  return false;
}

function specOfState(state) {
  const contour = state?.params?.contour;
  if (contour && !contour.centers && (contour.points?.length || contour.arcs?.length || contour.lines?.length)) {
    return contour;
  }
  return contourFromTool(state.tool, state.params || {});
}

function boundsOf(spec) {
  const pts = spec?.points || [];
  if (!pts.length) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const point of pts) {
    const u = num(point?.at?.[0]);
    const v = num(point?.at?.[1]);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(minU) || maxU - minU < 1e-6 || maxV - minV < 1e-6) return null;
  return {
    cx: (minU + maxU) / 2,
    cy: (minV + maxV) / 2,
    w: maxU - minU,
    h: maxV - minV,
  };
}

/** Half the current bounds, centered, so a tool click lands as an inner loop. */
export function insetLoopParams(tool, params, bounds) {
  const w = Math.max(bounds.w, 0.2);
  const h = Math.max(bounds.h, 0.2);
  const origin = [bounds.cx, bounds.cy];
  const radius = Math.min(w, h) / 4;
  if (tool === 'rectangle') {
    return { width: w / 2, height: h / 2, centered: true, origin };
  }
  if (tool === 'circle') {
    return { radius, segments: params?.segments || 64, origin };
  }
  if (tool === 'polygon') {
    return { polygonPreset: params?.polygonPreset || 'hexagon', radius, origin };
  }
  return params || {};
}

/**
 * Add one closed profile to the sketch. The stored model is the merged
 * solver spec (points, lines, arcs, dimensions, constraints).
 */
export function appendSketchLoop(state, tool, params, { inset = false } = {}) {
  let base;
  try {
    base = specOfState(state);
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
  let nextParams = params || {};
  if (inset) {
    const bounds = boundsOf(base);
    if (!bounds) return { ok: false, message: 'Sketch has no closed profile to add a loop to' };
    nextParams = insetLoopParams(tool, params, bounds);
  }
  let extra;
  try {
    extra = contourFromTool(tool, nextParams);
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
  const merged = mergeContourSpecs(base, extra);
  let solved;
  try {
    solved = solveContour(merged);
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
  const loops = solved.contours || [];
  if (loops.length < 2) {
    return { ok: false, message: 'sketch_add did not add a loop' };
  }
  return {
    ok: true,
    loops: loops.length,
    state: {
      ...state,
      tool: 'cursor',
      params: { contour: merged },
      profileSet: true,
      gesture: null,
      picks: [],
      tagId: null,
      gestureNote: null,
      dimensionLive: null,
      entityCard: null,
      pickedContourId: null,
    },
  };
}

function loopArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const yi = poly[i][1];
    const yj = poly[j][1];
    if ((yi > p[1]) === (yj > p[1])) continue;
    const x = ((poly[j][0] - poly[i][0]) * (p[1] - yi)) / (yj - yi) + poly[i][0];
    if (p[0] < x) inside = !inside;
  }
  return inside;
}

/** Every vertex of `inner` sits inside `outer`, and `inner` has less area. */
export function loopStrictlyInside(inner, outer) {
  if (!inner?.length || !outer?.length) return false;
  if (!(loopArea(inner) + 1e-6 < loopArea(outer))) return false;
  return inner.every((pt) => pointInPoly(pt, outer));
}

function sameIndexSet(indexes, count) {
  if (indexes.length !== count) return false;
  const sorted = indexes.slice().sort((a, b) => a - b);
  for (let i = 0; i < count; i += 1) {
    if (sorted[i] !== i) return false;
  }
  return true;
}

/**
 * One makeExtrude argument. A contour whose loops are all in the group is
 * named (`c1.contours`). Several whole contours concatenate. A split contour
 * is indexed.
 */
function groupExpr(pieces) {
  const whole = [];
  const indexed = [];
  for (const piece of pieces) {
    if (sameIndexSet(piece.indexes, piece.count)) whole.push(piece.name);
    else {
      const sorted = piece.indexes.slice().sort((a, b) => a - b);
      for (const index of sorted) indexed.push(`${piece.name}.contours[${index}]`);
    }
  }
  if (!indexed.length && whole.length === 1) return `${whole[0]}.contours`;
  if (!indexed.length) return `[].concat(${whole.map((name) => `${name}.contours`).join(', ')})`;
  const parts = [
    ...whole.map((name) => `${name}.contours`),
    ...indexed,
  ];
  if (parts.length === 1) return parts[0];
  return `[].concat(${parts.join(', ')})`;
}

/**
 * Classify loops for one extrude.
 * `contours` is `{ name, role, loops }`. `role` is `outer`, `hole`, or null
 * (containment). A hole that is not strictly inside an outer is refused.
 * A hole inside another hole is refused: makeExtrude treats every non-largest
 * loop as a hole, so an island would be cut away.
 *
 * @returns {{ ok: true, expr: string, ordered: number[][][], roles: Record<string, string> } | { ok: false, message: string }}
 */
export function classifyExtrudeLoops(contours) {
  const records = [];
  for (const contour of contours || []) {
    const loops = contour.loops || [];
    const role = contour.role === 'outer' || contour.role === 'hole' ? contour.role : null;
    loops.forEach((points, index) => {
      records.push({
        name: contour.name,
        index,
        count: loops.length,
        points,
        role,
        area: loopArea(points),
      });
    });
  }
  if (!records.length) return { ok: false, message: 'Extrude needs a contour' };

  const containedBy = records.map(() => []);
  for (let i = 0; i < records.length; i += 1) {
    for (let j = 0; j < records.length; j += 1) {
      if (i === j) continue;
      if (loopStrictlyInside(records[i].points, records[j].points)) containedBy[i].push(j);
    }
  }

  const isHole = records.map((row, i) => {
    if (row.role === 'hole') return true;
    if (row.role === 'outer') return false;
    return containedBy[i].length > 0;
  });

  const outers = [];
  records.forEach((row, i) => {
    if (!isHole[i]) outers.push(i);
  });
  if (!outers.length) {
    return { ok: false, message: 'Extrude needs an outer contour' };
  }

  const holes = [];
  for (let i = 0; i < records.length; i += 1) {
    if (!isHole[i]) continue;
    const hosts = containedBy[i].filter((j) => !isHole[j]);
    if (!hosts.length) {
      return {
        ok: false,
        message: `Contour ${records[i].name} is a hole but is not inside an outer contour`,
      };
    }
    hosts.sort((a, b) => records[a].area - records[b].area);
    const host = hosts[0];
    const insideHole = containedBy[i].some((j) => isHole[j] && containedBy[j].includes(host));
    if (insideHole) {
      return {
        ok: false,
        message: `Contour ${records[i].name} nests inside another hole. makeExtrude would cut it instead of leaving an island`,
      };
    }
    holes.push({ index: i, host });
  }

  const groups = new Map();
  for (const outer of outers) {
    groups.set(outer, []);
  }
  for (const hole of holes) {
    groups.get(hole.host).push(hole.index);
  }

  const piecesOf = (indexes) => {
    const byName = new Map();
    for (const index of indexes) {
      const row = records[index];
      if (!byName.has(row.name)) byName.set(row.name, { name: row.name, count: row.count, indexes: [] });
      byName.get(row.name).indexes.push(row.index);
    }
    return [...byName.values()];
  };

  const exprs = [];
  const solids = [];
  let frameName = null;
  for (const outer of outers) {
    if (!frameName) frameName = records[outer].name;
    const members = [outer, ...groups.get(outer)];
    solids.push(members.map((index) => records[index].points));
    exprs.push(groupExpr(piecesOf(members)));
  }

  const roles = {};
  for (const contour of contours || []) {
    if (contour.role === 'outer' || contour.role === 'hole') roles[contour.name] = contour.role;
  }

  // One group is the contours expression makeExtrude wraps.
  // Several groups are already makeExtrude calls joined with .add; __H__ is the distance.
  const expr = exprs.length === 1
    ? exprs[0]
    : exprs.map((part) => `makeExtrude(${part}, __H__)`).reduce((acc, part) => `${acc}.add(${part})`);

  return { ok: true, expr, ordered: solids[0], solids, roles, groups: exprs.length, frameName };
}

/** Point loops for a saved profile expression. Null when it is not a closed profile. */
export function loopsFromProfileExpr(expr) {
  const t = String(expr || '').trim();
  let match = t.match(/^profileCircle\(\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*\)$/);
  if (match) {
    return buildProfileFromParams({
      profileType: 'circle',
      radius: Number(match[1]),
      segments: Number(match[2]),
    }).contours;
  }
  match = t.match(/^profileRectangle\(\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*,\s*(true|false)\s*\)$/);
  if (match) {
    return buildProfileFromParams({
      profileType: 'rectangle',
      width: Number(match[1]),
      height: Number(match[2]),
      centered: match[3] === 'true',
    }).contours;
  }
  match = t.match(/^profilePolygon\(\s*(\[[\s\S]*\])\s*\)$/);
  if (match) {
    let pts;
    try {
      pts = JSON.parse(match[1]);
    } catch {
      return null;
    }
    if (!Array.isArray(pts) || pts.length < 3) return null;
    return [pts.map((pt) => [Number(pt[0]), Number(pt[1])])];
  }
  if (/^solveContour\s*\(/.test(t)) {
    try {
      return solveContour(parseSolveContour(t)).contours || [];
    } catch {
      return null;
    }
  }
  return null;
}
