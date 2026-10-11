/**
 * Contour constraint solver.
 *
 * Plane UV, millimetres. Angles in the contour are degrees. This file is the
 * contour solver only: joints keep their own solver and this module does not
 * pack a rigid body. Nothing here reads the display unit; a length on a
 * contour is already millimetres.
 *
 * A `refs` entry is fixed geometry in this same UV frame. It is not a
 * degree of freedom and it is not tessellated into the profile.
 *
 * `solveContour` is the script helper. `analyzeContour` is the same solve
 * plus per-entity status and the nullspace, for the viewport. Neither throws
 * on an under-defined contour or on a conflict. A conflict comes back as
 * status `conflict` with the least-squares shape. A repeated constraint is
 * a warning, not an error and not a red state.
 */

import { referenceGeomLive } from './contourRef.js';

export const CONTOUR_POINT_CAP = 128;

const SOLVE_TOL = 1e-6;
const CONSISTENT_TOL = 1e-4;
const RANK_REL = 1e-8;
const RANK_ABS = 1e-9;
const NULL_EPS = 1e-6;
const MAX_ITER = 40;
const FD_STEP = 1e-6;
const DEG = Math.PI / 180;

const CONSTRAINT_KINDS = new Set([
  'horizontal', 'vertical', 'parallel', 'perpendicular',
  'tangent', 'equal', 'coincident', 'fix',
]);
const DIMENSION_KINDS = new Set(['length', 'angle', 'distance', 'offset', 'radius']);

function fail(message) {
  throw new Error(`solveContour: ${message}`);
}

function num(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${what} must be a finite number`);
  return n;
}

function cloneSpec(spec) {
  if (!spec || typeof spec !== 'object') fail('expected a contour');
  const points = (spec.points || []).map((p) => {
    if (!p?.id || !Array.isArray(p.at)) fail('a point needs an id and at');
    return { id: String(p.id), at: [num(p.at[0], `point ${p.id} u`), num(p.at[1], `point ${p.id} v`)] };
  });
  const lines = (spec.lines || []).map((l) => {
    if (!l?.id || !l.a || !l.b) fail('a line needs id, a, and b');
    return { id: String(l.id), a: String(l.a), b: String(l.b) };
  });
  const arcs = (spec.arcs || []).map((a) => {
    if (!a?.id || !a.center) fail('an arc needs an id and a center');
    const full = !!a.full;
    const arc = {
      id: String(a.id),
      center: String(a.center),
      radius: num(a.radius, `arc ${a.id} radius`),
      full,
      sweep: a.sweep === 'cw' ? 'cw' : 'ccw',
    };
    if (!full) {
      if (!a.start || !a.end) fail(`arc ${a.id} needs a start and an end`);
      arc.start = String(a.start);
      arc.end = String(a.end);
    }
    if (a.segments != null) arc.segments = Math.max(3, Math.round(num(a.segments, 'segments')));
    return arc;
  });
  const dimensions = (spec.dimensions || []).map((d) => copyItem(d, 'dimension'));
  const constraints = (spec.constraints || []).map((c) => copyItem(c, 'constraint'));
  const refs = (spec.refs || []).map(copyRef);
  return { points, lines, arcs, dimensions, constraints, refs };
}

function uv2(uv, what) {
  if (!Array.isArray(uv) || uv.length < 2) fail(`${what} must be [u, v]`);
  return [num(uv[0], `${what} u`), num(uv[1], `${what} v`)];
}

function copyGeom(geom) {
  if (!geom || typeof geom !== 'object') fail('a reference geom must be an object');
  if (geom.kind === 'point') return { kind: 'point', at: uv2(geom.at, 'reference point') };
  if (geom.kind === 'line') {
    return { kind: 'line', a: uv2(geom.a, 'reference line'), b: uv2(geom.b, 'reference line') };
  }
  if (geom.kind === 'polyline') {
    if (!Array.isArray(geom.points) || geom.points.length < 2) {
      fail('a polyline reference needs at least 2 points');
    }
    return {
      kind: 'polyline',
      points: geom.points.map((p, i) => uv2(p, `polyline reference ${i}`)),
    };
  }
  if (geom.kind === 'arc') {
    const arc = {
      kind: 'arc',
      center: uv2(geom.center, 'reference arc'),
      radius: num(geom.radius, 'reference arc radius'),
      sweep: geom.sweep === 'cw' ? 'cw' : 'ccw',
    };
    if (!(arc.radius > 0)) fail('a reference arc radius must be > 0');
    if (geom.full) arc.full = true;
    else {
      if (geom.start != null) arc.start = num(geom.start, 'reference arc start');
      if (geom.end != null) arc.end = num(geom.end, 'reference arc end');
    }
    return arc;
  }
  fail(`unknown reference geom ${geom.kind}`);
}

function copyRef(ref) {
  if (!ref?.id || !ref.kind) fail('a reference needs an id and a kind');
  if (ref.kind !== 'edge' && ref.kind !== 'vertex' && ref.kind !== 'face') {
    fail(`unknown reference ${ref.kind}`);
  }
  const copy = { id: String(ref.id), kind: String(ref.kind) };
  if (ref.faceA != null) copy.faceA = num(ref.faceA, 'faceA');
  if (ref.faceB != null) copy.faceB = num(ref.faceB, 'faceB');
  if (ref.faceId != null) copy.faceId = num(ref.faceId, 'faceId');
  if (ref.end != null) copy.end = Math.round(num(ref.end, 'end'));
  if (Array.isArray(ref.mid)) {
    if (ref.mid.length < 3) fail('a reference midpoint must be [x, y, z]');
    copy.mid = [0, 1, 2].map((i) => num(ref.mid[i], `mid ${i}`));
  }
  if (ref.boundary) {
    const b = ref.boundary;
    if (!Array.isArray(b.mid) || b.mid.length < 3) fail('a face boundary needs a midpoint');
    copy.boundary = {
      faceA: num(b.faceA, 'boundary faceA'),
      faceB: num(b.faceB, 'boundary faceB'),
      mid: [0, 1, 2].map((i) => num(b.mid[i], `boundary mid ${i}`)),
    };
  }
  if (ref.broken) copy.broken = true;
  if (ref.geom) copy.geom = copyGeom(ref.geom);
  return copy;
}

function copyItem(item, label) {
  if (!item?.id || !item.kind) fail(`a ${label} needs an id and a kind`);
  const copy = { id: String(item.id), kind: String(item.kind) };
  if (item.edge) copy.edge = String(item.edge);
  if (item.arc) copy.arc = String(item.arc);
  if (item.point) copy.point = String(item.point);
  if (item.a) copy.a = String(item.a);
  if (item.b) copy.b = String(item.b);
  if (Array.isArray(item.items)) copy.items = item.items.map(String);
  if (item.name != null && String(item.name) !== '') copy.name = String(item.name);
  if (item.value != null) copy.value = num(item.value, `${label} ${item.id} value`);
  if (item.side != null) copy.side = item.side < 0 ? -1 : 1;
  if (item.sense != null) copy.sense = item.sense < 0 ? -1 : 1;
  // Where the two taps sat on a line-line distance. The figure starts there.
  // Dropping this is what put the first extension on the edge midpoint.
  if (Array.isArray(item.anchors)) {
    copy.anchors = item.anchors.map((uv, i) => {
      if (!Array.isArray(uv) || uv.length < 2) fail(`dimension ${item.id} anchor ${i} must be [u, v]`);
      return [num(uv[0], 'anchor u'), num(uv[1], 'anchor v')];
    });
  }
  if (item.at && typeof item.at === 'object') {
    copy.at = {};
    for (const [id, uv] of Object.entries(item.at)) {
      if (!Array.isArray(uv)) fail(`fix ${item.id} lock for ${id} must be [u, v] or a radius`);
      copy.at[id] = uv.length >= 2
        ? [num(uv[0], 'lock u'), num(uv[1], 'lock v')]
        : [num(uv[0], 'lock')];
    }
  }
  return copy;
}

function indexById(list) {
  const map = new Map();
  for (const item of list) {
    if (map.has(item.id)) fail(`duplicate id ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

function requireId(map, id, what) {
  if (!map.has(id)) fail(`${what} ${id} is not on this contour`);
  return map.get(id);
}

function nextId(lists, prefix) {
  let max = -1;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const list of lists) {
    for (const item of list) {
      const m = String(item.id).match(re);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return prefix + (max + 1);
}

function round4(n) {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Polyline UV. Three or more points close: the last line joins the last
 * point back to the first. Fewer than three stays an open chain.
 */
export function contourFromPolyline(uvs) {
  if (!Array.isArray(uvs) || !uvs.length) fail('a polyline needs a point');
  const points = uvs.map((p, i) => ({
    id: `p${i}`,
    at: [num(p?.[0], 'polyline u'), num(p?.[1], 'polyline v')],
  }));
  const lines = [];
  const closed = points.length >= 3;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    lines.push({
      id: `e${i}`,
      a: points[i].id,
      b: points[(i + 1) % points.length].id,
    });
  }
  return { points, lines, arcs: [], dimensions: [], constraints: [] };
}

/** Axis-aligned rectangle in UV. Centered uses the origin. Fully defined. */
export function contourFromRectangle(width, height, centered = true) {
  const w = num(width, 'width');
  const h = num(height, 'height');
  if (!(w > 0) || !(h > 0)) fail('width and height must be > 0');
  const x0 = centered ? -w / 2 : 0;
  const y0 = centered ? -h / 2 : 0;
  const points = [
    { id: 'p0', at: [x0, y0] },
    { id: 'p1', at: [x0 + w, y0] },
    { id: 'p2', at: [x0 + w, y0 + h] },
    { id: 'p3', at: [x0, y0 + h] },
  ];
  const lines = [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ];
  const constraints = [
    { id: 'k0', kind: 'horizontal', items: ['e0'] },
    { id: 'k1', kind: 'horizontal', items: ['e2'] },
    { id: 'k2', kind: 'vertical', items: ['e1'] },
    { id: 'k3', kind: 'vertical', items: ['e3'] },
    { id: 'k4', kind: 'fix', items: ['p0'], at: { p0: [x0, y0] } },
  ];
  const dimensions = [
    { id: 'd0', kind: 'length', edge: 'e0', value: w },
    { id: 'd1', kind: 'length', edge: 'e1', value: h },
  ];
  return { points, lines, arcs: [], dimensions, constraints };
}

/**
 * Full circle, center fixed at the origin, radius dimension equal to
 * `radius`. `segments` is the tessellation count (the circle tool uses 64).
 */
export function contourFromCircle(radius, segments = 64) {
  const r = num(radius, 'radius');
  if (!(r > 0)) fail('radius must be > 0');
  const seg = Math.max(3, Math.round(num(segments, 'segments')));
  return {
    points: [{ id: 'p0', at: [0, 0] }],
    lines: [],
    arcs: [{ id: 'a0', center: 'p0', radius: r, full: true, sweep: 'ccw', segments: seg }],
    dimensions: [{ id: 'd0', kind: 'radius', arc: 'a0', value: r }],
    constraints: [{ id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } }],
  };
}

/** Regular polygon, one corner on +V, equal sides, center fixed, radius to a vertex. */
export function contourFromPolygon(preset, radius) {
  const sides = preset === 'triangle' ? 3
    : preset === 'square' ? 4
      : preset === 'pentagon' ? 5
        : preset === 'hexagon' ? 6
          : 0;
  if (!sides) fail('polygon preset must be triangle, square, pentagon, or hexagon');
  const r = num(radius, 'radius');
  if (!(r > 0)) fail('radius must be > 0');
  const points = [{ id: 'p0', at: [0, 0] }];
  for (let i = 0; i < sides; i += 1) {
    const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
    points.push({ id: `p${i + 1}`, at: [r * Math.cos(t), r * Math.sin(t)] });
  }
  const lines = [];
  for (let i = 0; i < sides; i += 1) {
    lines.push({ id: `e${i}`, a: `p${i + 1}`, b: `p${((i + 1) % sides) + 1}` });
  }
  const constraints = [
    { id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
  ];
  for (let i = 1; i < sides; i += 1) {
    constraints.push({ id: `k${i}`, kind: 'equal', items: ['e0', `e${i}`] });
  }
  // Vertex radius is a length on the spoke to the first vertex. The card's
  // dimension kinds stay length / angle / distance / offset / radius-of-arc.
  lines.push({ id: `e${sides}`, a: 'p0', b: 'p1' });
  const dimensions = [{ id: 'd0', kind: 'length', edge: `e${sides}`, value: r }];
  return { points, lines, arcs: [], dimensions, constraints };
}

function orientPair(a, b) {
  const share = [a.a, a.b].find((id) => id === b.a || id === b.b);
  if (!share) return null;
  const into = a.b === share ? a : { id: a.id, a: a.b, b: a.a, flipped: true, src: a };
  const out = b.a === share ? b : { id: b.id, a: b.b, b: b.a, flipped: true, src: b };
  if (into.b !== share || out.a !== share) return null;
  return { first: into, second: out, corner: share };
}

function chainOf(lines, ids) {
  const picked = ids.map((id) => {
    const line = lines.find((l) => l.id === id);
    if (!line) fail(`segment ${id} is not a line on this contour`);
    return line;
  });
  if (picked.length === 2) {
    const pair = orientPair(picked[0], picked[1]) || orientPair(picked[1], picked[0]);
    if (!pair) fail('those two segments do not share a corner');
    return { lines: [pair.first, pair.second], corner: pair.corner, middle: null };
  }
  if (picked.length !== 3) fail('an arc rounds two or three adjacent segments');
  const perm = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  for (const order of perm) {
    const [i, j, k] = order;
    const ab = orientPair(picked[i], picked[j]);
    const bc = orientPair(picked[j], picked[k]);
    if (!ab || !bc) continue;
    if (ab.second.id !== picked[j].id && ab.second.src?.id !== picked[j].id) continue;
    // Middle keeps its original id. Ends are oriented into and out of the chain.
    const mid = picked[j];
    const firstShare = ab.corner;
    const secondShare = bc.corner;
    if (firstShare === secondShare) continue;
    const first = ab.first;
    const last = bc.second;
    if (first.b !== firstShare) continue;
    return { lines: [first, mid, last], corner: null, middle: mid, via: [firstShare, secondShare] };
  }
  fail('those three segments are not an adjacent chain');
}

function lineIntersect(p, d, q, e) {
  const cross = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(cross) < 1e-12) return null;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const t = (dx * e[1] - dy * e[0]) / cross;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Round the corner between two or three adjacent lines. Two lines share a
 * vertex. Three lines are a chain: the outer lines are extended to their
 * intersection and the middle line is removed. The new arc is tangent to
 * both outer lines. The radius is the arc seed; it is not a named dimension.
 */
export function roundContourCorner(spec, segmentIds, radius) {
  const model = cloneSpec(spec);
  const r = num(radius, 'radius');
  if (!(r > 0)) fail('radius must be > 0');
  const ids = (segmentIds || []).map(String);
  const chain = chainOf(model.lines, ids);
  const at = Object.fromEntries(model.points.map((p) => [p.id, p.at]));
  let farA;
  let corner;
  let farB;
  let firstId;
  let secondId;
  let dropIds;
  if (chain.lines.length === 2) {
    const [first, second] = chain.lines;
    farA = at[first.a];
    corner = at[chain.corner];
    farB = at[second.b];
    firstId = first.id;
    secondId = second.id;
    dropIds = [];
  } else {
    const [first, , last] = chain.lines;
    const a = at[first.a];
    const b = at[first.b];
    const c = at[last.a];
    const d = at[last.b];
    const hit = lineIntersect(a, [b[0] - a[0], b[1] - a[1]], c, [d[0] - c[0], d[1] - c[1]]);
    if (!hit) fail('those segments are parallel');
    farA = a;
    corner = hit;
    farB = d;
    firstId = first.id;
    secondId = last.id;
    dropIds = [chain.middle.id];
  }
  const d1 = [farA[0] - corner[0], farA[1] - corner[1]];
  const d2 = [farB[0] - corner[0], farB[1] - corner[1]];
  const L1 = Math.hypot(d1[0], d1[1]);
  const L2 = Math.hypot(d2[0], d2[1]);
  if (L1 < 1e-9 || L2 < 1e-9) fail('a corner segment has zero length');
  d1[0] /= L1; d1[1] /= L1;
  d2[0] /= L2; d2[1] /= L2;
  const dot = d1[0] * d2[0] + d1[1] * d2[1];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  const alpha = Math.atan2(Math.abs(cross), dot);
  if (alpha < 1e-3) fail('that corner is a spike');
  if (alpha > Math.PI - 1e-3) fail('that corner is flat');
  const t = r / Math.tan(alpha / 2);
  if (!(t > 1e-6) || t >= L1 - 1e-6 || t >= L2 - 1e-6) fail('radius does not fit this corner');
  const t1 = [corner[0] + d1[0] * t, corner[1] + d1[1] * t];
  const t2 = [corner[0] + d2[0] * t, corner[1] + d2[1] * t];
  const bisLen = Math.hypot(d1[0] + d2[0], d1[1] + d2[1]);
  const bis = [(d1[0] + d2[0]) / bisLen, (d1[1] + d2[1]) / bisLen];
  const center = [
    corner[0] + bis[0] * (r / Math.sin(alpha / 2)),
    corner[1] + bis[1] * (r / Math.sin(alpha / 2)),
  ];
  const lists = [model.points, model.lines, model.arcs, model.dimensions, model.constraints];
  const idT1 = nextId(lists, 'p');
  const idT2 = nextId([model.points.concat([{ id: idT1 }]), model.lines, model.arcs, model.dimensions, model.constraints], 'p');
  const idC = nextId([model.points.concat([{ id: idT1 }, { id: idT2 }]), model.lines, model.arcs, model.dimensions, model.constraints], 'p');
  const idArc = nextId(lists, 'a');
  const idK1 = nextId(lists, 'k');
  const idK2 = nextId([model.constraints.concat([{ id: idK1 }]), model.points, model.lines, model.arcs, model.dimensions], 'k');

  model.points.push({ id: idT1, at: t1 }, { id: idT2, at: t2 }, { id: idC, at: center });
  const first = model.lines.find((l) => l.id === firstId);
  const second = model.lines.find((l) => l.id === secondId);
  // Keep the far endpoint, trim the corner end onto the tangent point.
  if (chain.lines.length === 2) {
    const f = chain.lines[0];
    const s = chain.lines[1];
    first.a = f.a;
    first.b = idT1;
    second.a = idT2;
    second.b = s.b;
    const used = new Set(model.lines.flatMap((l) => [l.a, l.b]));
    if (!used.has(chain.corner)) {
      model.points = model.points.filter((p) => p.id !== chain.corner);
    }
  } else {
    first.a = chain.lines[0].a;
    first.b = idT1;
    second.a = idT2;
    second.b = chain.lines[2].b;
    model.lines = model.lines.filter((l) => !dropIds.includes(l.id));
    const used = new Set();
    for (const l of model.lines) { used.add(l.a); used.add(l.b); }
    for (const a of model.arcs) {
      used.add(a.center);
      if (a.start) used.add(a.start);
      if (a.end) used.add(a.end);
    }
    used.add(idT1); used.add(idT2); used.add(idC);
    const dropPoints = new Set(chain.via);
    model.points = model.points.filter((p) => used.has(p.id) || !dropPoints.has(p.id));
  }
  const ang1 = Math.atan2(t1[1] - center[1], t1[0] - center[0]);
  const ang2 = Math.atan2(t2[1] - center[1], t2[0] - center[0]);
  let ccw = ang2 - ang1;
  if (ccw <= 0) ccw += Math.PI * 2;
  const sweep = ccw <= Math.PI + 1e-6 ? 'ccw' : 'cw';
  model.arcs.push({
    id: idArc, center: idC, start: idT1, end: idT2, radius: r, sweep, full: false,
  });
  const sideOf = (line) => {
    const pa = model.points.find((p) => p.id === line.a).at;
    const pb = model.points.find((p) => p.id === line.b).at;
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const len = Math.hypot(dx, dy) || 1;
    const signed = ((center[0] - pa[0]) * (-dy) + (center[1] - pa[1]) * dx) / len;
    return signed >= 0 ? 1 : -1;
  };
  model.constraints.push(
    { id: idK1, kind: 'tangent', items: [firstId, idArc], side: sideOf(first) },
    { id: idK2, kind: 'tangent', items: [secondId, idArc], side: sideOf(second) },
  );
  return model;
}

function chainEdges(model) {
  const edges = [];
  for (const line of model.lines) edges.push([line.a, line.b]);
  for (const arc of model.arcs) {
    if (!arc.full) edges.push([arc.start, arc.end]);
  }
  return edges;
}

function closeOpenChain(model) {
  const edges = chainEdges(model);
  const deg = new Map();
  const adj = new Map();
  const link = (a, b) => {
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (const [a, b] of edges) link(a, b);
  for (const d of deg.values()) {
    if (d > 2) fail('contour has a branch');
  }
  const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      comp.push(id);
      for (const next of adj.get(id) || []) stack.push(next);
    }
    const ends = comp.filter((id) => deg.get(id) === 1);
    if (ends.length === 2 && comp.length >= 3) {
      model.lines.push({
        id: nextId([model.points, model.lines, model.arcs, model.dimensions, model.constraints], 'e'),
        a: ends[0],
        b: ends[1],
      });
    }
  }
}

function validateGraph(model) {
  if (model.points.length > CONTOUR_POINT_CAP) {
    fail(`at most ${CONTOUR_POINT_CAP} points`);
  }
  const points = indexById(model.points);
  const lines = indexById(model.lines);
  const arcs = indexById(model.arcs);
  for (const line of model.lines) {
    requireId(points, line.a, 'line endpoint');
    requireId(points, line.b, 'line endpoint');
    if (line.a === line.b) fail(`line ${line.id} has zero length`);
  }
  for (const arc of model.arcs) {
    requireId(points, arc.center, 'arc center');
    if (!(arc.radius > 0)) fail(`arc ${arc.id} radius must be > 0`);
    if (!arc.full) {
      requireId(points, arc.start, 'arc start');
      requireId(points, arc.end, 'arc end');
    }
  }
  const names = new Set();
  for (const dim of model.dimensions) {
    if (!DIMENSION_KINDS.has(dim.kind)) fail(`unknown dimension ${dim.kind}`);
    if (dim.name != null) {
      if (!/^[A-Za-z_$][\w$]*$/.test(dim.name)) fail(`dimension name ${dim.name} is not an identifier`);
      if (names.has(dim.name)) fail(`dimension name ${dim.name} is already used on this contour`);
      names.add(dim.name);
    }
  }
  for (const con of model.constraints) {
    if (!CONSTRAINT_KINDS.has(con.kind)) fail(`unknown constraint ${con.kind}`);
  }
  const refs = indexById(model.refs || []);
  for (const id of refs.keys()) {
    if (points.has(id) || lines.has(id) || arcs.has(id)) fail(`duplicate id ${id}`);
  }
  return { points, lines, arcs, refs };
}

function compile(model) {
  const { points, lines, arcs, refs } = validateGraph(model);
  const pointList = model.points;
  const arcList = model.arcs;
  const pIndex = new Map(pointList.map((p, i) => [p.id, i]));
  const rIndex = new Map(arcList.map((a, i) => [a.id, pointList.length * 2 + i]));
  const n = pointList.length * 2 + arcList.length;
  const eqs = [];

  const xy = (x, id) => {
    const i = pIndex.get(id);
    return [x[i * 2], x[i * 2 + 1]];
  };
  const rad = (x, id) => x[rIndex.get(id)];
  const lineDir = (x, line) => {
    const a = xy(x, line.a);
    const b = xy(x, line.b);
    return [b[0] - a[0], b[1] - a[1], a, b];
  };
  const unitCross = (d1, d2) => {
    const L1 = Math.hypot(d1[0], d1[1]);
    const L2 = Math.hypot(d2[0], d2[1]);
    if (L1 < 1e-12 || L2 < 1e-12) return 1;
    return (d1[0] * d2[1] - d1[1] * d2[0]) / (L1 * L2);
  };
  const unitDot = (d1, d2) => {
    const L1 = Math.hypot(d1[0], d1[1]);
    const L2 = Math.hypot(d2[0], d2[1]);
    if (L1 < 1e-12 || L2 < 1e-12) return 1;
    return (d1[0] * d2[0] + d1[1] * d2[1]) / (L1 * L2);
  };
  const signedDistPointLine = (p, a, d) => {
    const L = Math.hypot(d[0], d[1]);
    if (L < 1e-12) return 1;
    return ((p[0] - a[0]) * (-d[1]) + (p[1] - a[1]) * d[0]) / L;
  };

  const push = (id, scale, fn) => {
    eqs.push({ id, scale, fn });
  };

  const lineOf = (id) => requireId(lines, id, 'line');
  const arcOf = (id) => requireId(arcs, id, 'arc');
  const pointOf = (id) => requireId(points, id, 'point');

  const live = new Map();
  const brokenRefs = [];
  for (const ref of model.refs || []) {
    const geom = ref.broken ? null : referenceGeomLive(ref.geom);
    if (!geom) brokenRefs.push(ref.id);
    else live.set(ref.id, geom);
  }
  const namedIds = (item) => {
    const ids = [];
    if (Array.isArray(item.items)) ids.push(...item.items);
    for (const key of ['a', 'b', 'edge', 'point', 'arc']) {
      if (item[key]) ids.push(item[key]);
    }
    return ids;
  };
  // Two references are both fixed. A broken reference adds nothing.
  const skipItem = (item) => {
    const refIds = namedIds(item).filter((id) => refs.has(id));
    if (refIds.length >= 2) fail('a constraint cannot join two references');
    return refIds.some((id) => !live.has(id));
  };
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const chainDist = (p, pts) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i += 1) best = Math.min(best, segDist(p, pts[i - 1], pts[i]));
    return best;
  };
  const fixedDir = (geom) => [geom.b[0] - geom.a[0], geom.b[1] - geom.a[1], geom.a, geom.b];

  function sketchPoint(id) {
    if (!points.has(id) || lines.has(id) || arcs.has(id) || refs.has(id)) return null;
    return id;
  }

  function compileDistanceRef(dim) {
    const aLive = live.get(dim.a);
    const bLive = live.get(dim.b);
    const geom = aLive || bLive;
    const other = aLive ? dim.b : dim.a;
    if (geom.kind === 'point' && sketchPoint(other)) {
      push(dim.id, 1, (x) => {
        const p = xy(x, other);
        return Math.hypot(p[0] - geom.at[0], p[1] - geom.at[1]) - dim.value;
      });
      return;
    }
    if (geom.kind === 'line' && lines.has(other)) {
      const line = lines.get(other);
      const dir = fixedDir(geom);
      push(dim.id, DEG, (x) => unitCross(lineDir(x, line), dir));
      push(dim.id, 1, (x) => signedDistPointLine(xy(x, line.a), geom.a, dir) - dim.value);
      return;
    }
    if (geom.kind === 'line' && sketchPoint(other)) {
      push(dim.id, 1, (x) => signedDistPointLine(xy(x, other), geom.a, fixedDir(geom)) - dim.value);
      return;
    }
    if (geom.kind === 'polyline' && sketchPoint(other)) {
      push(dim.id, 1, (x) => chainDist(xy(x, other), geom.points) - Math.abs(dim.value));
      return;
    }
    if (geom.kind === 'arc' && sketchPoint(other)) {
      push(dim.id, 1, (x) => {
        const p = xy(x, other);
        return Math.hypot(p[0] - geom.center[0], p[1] - geom.center[1]) - geom.radius - dim.value;
      });
      return;
    }
    fail('distance to that reference is not supported');
  }

  function compileOffsetRef(dim) {
    const edge = live.get(dim.edge);
    const pointRef = live.get(dim.point);
    if (edge?.kind === 'line' && sketchPoint(dim.point)) {
      push(dim.id, 1, (x) => signedDistPointLine(xy(x, dim.point), edge.a, fixedDir(edge)) - dim.value);
      return;
    }
    if (pointRef?.kind === 'point' && lines.has(dim.edge)) {
      const line = lines.get(dim.edge);
      push(dim.id, 1, (x) => {
        const d = lineDir(x, line);
        return signedDistPointLine(pointRef.at, d[2], d) - dim.value;
      });
      return;
    }
    fail('offset needs a line reference or a point reference');
  }

  function compileParallelRef(con, items) {
    const geom = live.get(items[0]) || live.get(items[1]);
    const other = live.has(items[0]) ? items[1] : items[0];
    if (geom.kind !== 'line' || !lines.has(other)) fail(`${con.kind} needs a line reference`);
    const line = lines.get(other);
    const dir = fixedDir(geom);
    push(con.id, DEG, (x) => {
      const d = lineDir(x, line);
      return con.kind === 'parallel' ? unitCross(d, dir) : unitDot(d, dir);
    });
  }

  function compileCoincidentRef(con, items) {
    const geom = live.get(items[0]) || live.get(items[1]);
    const other = live.has(items[0]) ? items[1] : items[0];
    if (!sketchPoint(other)) fail('coincident needs a sketch point and a reference');
    if (geom.kind === 'point') {
      push(con.id, 1, (x) => xy(x, other)[0] - geom.at[0]);
      push(con.id, 1, (x) => xy(x, other)[1] - geom.at[1]);
      return;
    }
    if (geom.kind === 'line') {
      push(con.id, 1, (x) => segDist(xy(x, other), geom.a, geom.b));
      return;
    }
    if (geom.kind === 'polyline') {
      push(con.id, 1, (x) => chainDist(xy(x, other), geom.points));
      return;
    }
    if (geom.kind === 'arc') {
      push(con.id, 1, (x) => {
        const p = xy(x, other);
        return Math.hypot(p[0] - geom.center[0], p[1] - geom.center[1]) - geom.radius;
      });
      return;
    }
    fail('coincident needs a sketch point and a reference');
  }

  function compileTangentRef(con, items) {
    const geom = live.get(items[0]) || live.get(items[1]);
    const other = live.has(items[0]) ? items[1] : items[0];
    if (geom.kind !== 'arc') fail('tangent needs an arc reference');
    const side = con.side || 1;
    if (lines.has(other)) {
      const line = lines.get(other);
      push(con.id, 1, (x) => {
        const d = lineDir(x, line);
        return signedDistPointLine(geom.center, d[2], d) - side * geom.radius;
      });
      return;
    }
    if (arcs.has(other)) {
      const arc = arcs.get(other);
      push(con.id, 1, (x) => {
        const c = xy(x, arc.center);
        const dist = Math.hypot(c[0] - geom.center[0], c[1] - geom.center[1]);
        const radius = rad(x, arc.id);
        const target = side < 0 ? Math.abs(radius - geom.radius) : radius + geom.radius;
        return dist - target;
      });
      return;
    }
    fail('tangent needs an arc reference');
  }

  for (const dim of model.dimensions) {
    if (skipItem(dim)) continue;
    if (dim.kind === 'length') {
      if (refs.has(dim.edge)) fail('length stays on a sketch line');
      const line = lineOf(dim.edge);
      push(dim.id, 1, (x) => {
        const d = lineDir(x, line);
        return Math.hypot(d[0], d[1]) - dim.value;
      });
    } else if (dim.kind === 'angle') {
      if (refs.has(dim.a) || refs.has(dim.b)) fail('angle stays on the sketch');
      const a = lineOf(dim.a);
      const b = lineOf(dim.b);
      const sense = dim.sense || 1;
      push(dim.id, DEG, (x) => {
        const d1 = lineDir(x, a);
        const d2 = lineDir(x, b);
        const L1 = Math.hypot(d1[0], d1[1]);
        const L2 = Math.hypot(d2[0], d2[1]);
        if (L1 < 1e-12 || L2 < 1e-12) return 1;
        const cross = d1[0] * d2[1] - d1[1] * d2[0];
        const dot = d1[0] * d2[0] + d1[1] * d2[1];
        return Math.atan2(sense * cross, dot) - dim.value * DEG;
      });
    } else if (dim.kind === 'distance') {
      if (refs.has(dim.a) || refs.has(dim.b)) {
        compileDistanceRef(dim);
        continue;
      }
      // Two points: the first pick stays put and the second takes the distance.
      // Two lines stay the parallel gap they already were.
      if (points.has(dim.a) && points.has(dim.b) && !lines.has(dim.a) && !lines.has(dim.b)) {
        const pin = dim.at?.[dim.a] || points.get(dim.a).at;
        push(dim.id, 1, (x) => xy(x, dim.a)[0] - pin[0]);
        push(dim.id, 1, (x) => xy(x, dim.a)[1] - pin[1]);
        push(dim.id, 1, (x) => {
          const pa = xy(x, dim.a);
          const pb = xy(x, dim.b);
          return Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) - dim.value;
        });
      } else {
        const a = lineOf(dim.a);
        const b = lineOf(dim.b);
        push(dim.id, DEG, (x) => unitCross(lineDir(x, a), lineDir(x, b)));
        push(dim.id, 1, (x) => {
          const db = lineDir(x, b);
          const pa = xy(x, a.a);
          return signedDistPointLine(pa, db[2], db) - dim.value;
        });
      }
    } else if (dim.kind === 'offset') {
      if (refs.has(dim.edge) || refs.has(dim.point)) {
        compileOffsetRef(dim);
        continue;
      }
      const line = lineOf(dim.edge);
      pointOf(dim.point);
      push(dim.id, 1, (x) => {
        const d = lineDir(x, line);
        return signedDistPointLine(xy(x, dim.point), d[2], d) - dim.value;
      });
    } else if (dim.kind === 'radius') {
      if (refs.has(dim.arc)) fail('a reference arc keeps its radius');
      arcOf(dim.arc);
      push(dim.id, 1, (x) => rad(x, dim.arc) - dim.value);
    }
  }

  for (const con of model.constraints) {
    if (skipItem(con)) continue;
    const items = con.items || [];
    if ((con.kind === 'horizontal' || con.kind === 'vertical' || con.kind === 'equal' || con.kind === 'fix')
      && items.some((id) => refs.has(id))) {
      fail(`${con.kind} stays on the sketch`);
    }
    if (con.kind === 'horizontal' || con.kind === 'vertical') {
      if (items.length !== 1) fail(`${con.kind} needs one line`);
      const line = lineOf(items[0]);
      push(con.id, 1, (x) => {
        const d = lineDir(x, line);
        return con.kind === 'horizontal' ? d[1] : d[0];
      });
    } else if (con.kind === 'parallel' || con.kind === 'perpendicular') {
      if (items.length !== 2) fail(`${con.kind} needs two lines`);
      if (refs.has(items[0]) || refs.has(items[1])) {
        compileParallelRef(con, items);
        continue;
      }
      const a = lineOf(items[0]);
      const b = lineOf(items[1]);
      push(con.id, DEG, (x) => {
        const d1 = lineDir(x, a);
        const d2 = lineDir(x, b);
        return con.kind === 'parallel' ? unitCross(d1, d2) : unitDot(d1, d2);
      });
    } else if (con.kind === 'equal') {
      if (items.length !== 2) fail('equal needs two items');
      const aLine = lines.get(items[0]);
      const bLine = lines.get(items[1]);
      const aArc = arcs.get(items[0]);
      const bArc = arcs.get(items[1]);
      if (aLine && bLine) {
        push(con.id, 1, (x) => {
          const d1 = lineDir(x, aLine);
          const d2 = lineDir(x, bLine);
          return Math.hypot(d1[0], d1[1]) - Math.hypot(d2[0], d2[1]);
        });
      } else if (aArc && bArc) {
        push(con.id, 1, (x) => rad(x, aArc.id) - rad(x, bArc.id));
      } else {
        fail('equal needs two lines or two arcs');
      }
    } else if (con.kind === 'coincident') {
      if (items.length !== 2) fail('coincident needs two items');
      if (refs.has(items[0]) || refs.has(items[1])) {
        compileCoincidentRef(con, items);
        continue;
      }
      const a = items[0];
      const b = items[1];
      if (points.has(a) && points.has(b)) {
        push(con.id, 1, (x) => xy(x, a)[0] - xy(x, b)[0]);
        push(con.id, 1, (x) => xy(x, a)[1] - xy(x, b)[1]);
      } else if (points.has(a) && lines.has(b)) {
        const line = lines.get(b);
        push(con.id, 1, (x) => {
          const d = lineDir(x, line);
          return signedDistPointLine(xy(x, a), d[2], d);
        });
      } else if (points.has(b) && lines.has(a)) {
        const line = lines.get(a);
        push(con.id, 1, (x) => {
          const d = lineDir(x, line);
          return signedDistPointLine(xy(x, b), d[2], d);
        });
      } else if (points.has(a) && arcs.has(b)) {
        push(con.id, 1, (x) => {
          const p = xy(x, a);
          const c = xy(x, arcs.get(b).center);
          return Math.hypot(p[0] - c[0], p[1] - c[1]) - rad(x, b);
        });
      } else if (points.has(b) && arcs.has(a)) {
        push(con.id, 1, (x) => {
          const p = xy(x, b);
          const c = xy(x, arcs.get(a).center);
          return Math.hypot(p[0] - c[0], p[1] - c[1]) - rad(x, a);
        });
      } else {
        fail('coincident needs two points, or a point and a line or an arc');
      }
    } else if (con.kind === 'tangent') {
      if (items.length !== 2) fail('tangent needs two items');
      if (refs.has(items[0]) || refs.has(items[1])) {
        compileTangentRef(con, items);
        continue;
      }
      const line = lines.get(items[0]) || lines.get(items[1]);
      const arc = arcs.get(items[0]) || arcs.get(items[1]);
      const otherArc = [items[0], items[1]].map((id) => arcs.get(id)).filter(Boolean);
      if (line && arc && otherArc.length === 1) {
        const side = con.side || 1;
        push(con.id, 1, (x) => {
          const d = lineDir(x, line);
          const c = xy(x, arc.center);
          return signedDistPointLine(c, d[2], d) - side * rad(x, arc.id);
        });
      } else if (otherArc.length === 2) {
        const [a, b] = otherArc;
        const side = con.side || 1;
        push(con.id, 1, (x) => {
          const ca = xy(x, a.center);
          const cb = xy(x, b.center);
          const dist = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
          const ra = rad(x, a.id);
          const rb = rad(x, b.id);
          const target = side < 0 ? Math.abs(ra - rb) : ra + rb;
          return dist - target;
        });
      } else {
        fail('tangent needs a line and an arc, or two arcs');
      }
    } else if (con.kind === 'fix') {
      if (items.length !== 1) fail('fix needs one item');
      const id = items[0];
      if (points.has(id)) {
        const seed = con.at?.[id] || points.get(id).at;
        push(con.id, 1, (x) => xy(x, id)[0] - seed[0]);
        push(con.id, 1, (x) => xy(x, id)[1] - seed[1]);
      } else if (lines.has(id)) {
        const line = lines.get(id);
        const lockA = con.at?.[line.a] || points.get(line.a).at;
        const lockB = con.at?.[line.b] || points.get(line.b).at;
        push(con.id, 1, (x) => xy(x, line.a)[0] - lockA[0]);
        push(con.id, 1, (x) => xy(x, line.a)[1] - lockA[1]);
        push(con.id, 1, (x) => xy(x, line.b)[0] - lockB[0]);
        push(con.id, 1, (x) => xy(x, line.b)[1] - lockB[1]);
      } else if (arcs.has(id)) {
        const arc = arcs.get(id);
        const lockC = con.at?.[arc.center] || points.get(arc.center).at;
        const lockR = (con.at?.[id] && con.at[id][0]) || arc.radius;
        push(con.id, 1, (x) => xy(x, arc.center)[0] - lockC[0]);
        push(con.id, 1, (x) => xy(x, arc.center)[1] - lockC[1]);
        push(con.id, 1, (x) => rad(x, id) - lockR);
      } else {
        fail(`fix ${id} is not a point, a line, or an arc`);
      }
    }
  }

  const m = eqs.length;
  const scale = new Float64Array(m);
  for (let i = 0; i < m; i += 1) scale[i] = eqs[i].scale;
  const residual = (x, out, skipId) => {
    let row = 0;
    for (const eq of eqs) {
      if (skipId && eq.id === skipId) continue;
      out[row] = eq.fn(x);
      row += 1;
    }
    return row;
  };
  const residualAll = (x, out) => {
    for (let i = 0; i < m; i += 1) out[i] = eqs[i].fn(x);
  };
  const groups = [];
  const seen = new Set();
  for (const eq of eqs) {
    if (seen.has(eq.id)) continue;
    seen.add(eq.id);
    const rows = [];
    eqs.forEach((e, i) => { if (e.id === eq.id) rows.push(i); });
    groups.push({ id: eq.id, rows });
  }
  const x0 = new Float64Array(n);
  pointList.forEach((p, i) => {
    x0[i * 2] = p.at[0];
    x0[i * 2 + 1] = p.at[1];
  });
  arcList.forEach((a, i) => {
    x0[pointList.length * 2 + i] = a.radius;
  });
  return { n, m, scale, residualAll, residual, groups, eqs, x0, pIndex, rIndex, brokenRefs };
}

function scaledInf(r, scale, m) {
  let max = 0;
  for (let i = 0; i < m; i += 1) {
    const s = scale[i] || 1;
    const v = Math.abs(r[i] / s);
    if (v > max) max = v;
  }
  return max;
}

function jacobian(n, m, x, residual, r0, scale) {
  const J = new Float64Array(m * n);
  const rp = new Float64Array(m);
  for (let j = 0; j < n; j += 1) {
    const old = x[j];
    x[j] = old + FD_STEP;
    residual(x, rp);
    x[j] = old;
    for (let i = 0; i < m; i += 1) {
      J[i * n + j] = ((rp[i] - r0[i]) / FD_STEP) / (scale[i] || 1);
    }
  }
  return J;
}

function solveSymmetric(H, g) {
  const n = g.length;
  const M = Float64Array.from(H);
  const x = Float64Array.from(g);
  for (let k = 0; k < n; k += 1) {
    let piv = k;
    let best = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i += 1) {
      const v = Math.abs(M[i * n + k]);
      if (v > best) { best = v; piv = i; }
    }
    if (best < 1e-14) return null;
    if (piv !== k) {
      for (let j = k; j < n; j += 1) {
        const t = M[k * n + j];
        M[k * n + j] = M[piv * n + j];
        M[piv * n + j] = t;
      }
      const t = x[k];
      x[k] = x[piv];
      x[piv] = t;
    }
    const diag = M[k * n + k];
    for (let j = k; j < n; j += 1) M[k * n + j] /= diag;
    x[k] /= diag;
    for (let i = 0; i < n; i += 1) {
      if (i === k) continue;
      const f = M[i * n + k];
      if (f === 0) continue;
      for (let j = k; j < n; j += 1) M[i * n + j] -= f * M[k * n + j];
      x[i] -= f * x[k];
    }
  }
  return x;
}

function levenberg(sys, xStart, skipId) {
  const { n } = sys;
  const useAll = !skipId;
  const m = useAll ? sys.m : sys.eqs.reduce((c, eq) => c + (eq.id === skipId ? 0 : 1), 0);
  const scale = useAll ? sys.scale : (() => {
    const s = new Float64Array(m);
    let row = 0;
    sys.eqs.forEach((eq, i) => {
      if (eq.id === skipId) return;
      s[row] = sys.scale[i];
      row += 1;
    });
    return s;
  })();
  const residual = (x, out) => {
    if (useAll) sys.residualAll(x, out);
    else sys.residual(x, out, skipId);
  };
  const x = Float64Array.from(xStart);
  const r = new Float64Array(m);
  if (m === 0) return { x, scaledInf: 0, converged: true, iterations: 0, r, scale, m };
  residual(x, r);
  let norm = scaledInf(r, scale, m);
  let lambda = 1e-3;
  let iterations = 0;
  let converged = norm <= SOLVE_TOL;
  for (let iter = 0; iter < MAX_ITER && !converged; iter += 1) {
    iterations = iter + 1;
    const J = jacobian(n, m, x, residual, r, scale);
    const H = new Float64Array(n * n);
    const g = new Float64Array(n);
    for (let i = 0; i < m; i += 1) {
      const ri = r[i] / (scale[i] || 1);
      for (let a = 0; a < n; a += 1) {
        const Jia = J[i * n + a];
        g[a] += Jia * ri;
        for (let b = a; b < n; b += 1) H[a * n + b] += Jia * J[i * n + b];
      }
    }
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < a; b += 1) H[a * n + b] = H[b * n + a];
      H[a * n + a] += lambda * Math.max(H[a * n + a], 1e-8);
    }
    const neg = new Float64Array(n);
    for (let a = 0; a < n; a += 1) neg[a] = -g[a];
    const step = solveSymmetric(H, neg);
    if (!step) {
      lambda = Math.min(lambda * 10, 1e8);
      if (lambda >= 1e8) break;
      continue;
    }
    let stepLen = 0;
    const trial = Float64Array.from(x);
    for (let a = 0; a < n; a += 1) {
      trial[a] = x[a] + step[a];
      stepLen += step[a] * step[a];
    }
    const rt = new Float64Array(m);
    residual(trial, rt);
    const next = scaledInf(rt, scale, m);
    if (next < norm) {
      x.set(trial);
      r.set(rt);
      norm = next;
      lambda = Math.max(lambda / 10, 1e-10);
      if (norm <= SOLVE_TOL || stepLen < 1e-18) {
        converged = norm <= SOLVE_TOL;
        break;
      }
    } else {
      lambda = Math.min(lambda * 10, 1e8);
      if (lambda >= 1e8) break;
    }
  }
  return { x, scaledInf: norm, converged: norm <= SOLVE_TOL, iterations, r, scale, m };
}

function jacobiEigen(S, n) {
  const A = Float64Array.from(S);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 32; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += A[p * n + q] ** 2;
    }
    if (off < 1e-24) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-15) continue;
        const app = A[p * n + p];
        const aqq = A[q * n + q];
        const tau = (aqq - app) / (2 * apq);
        const tt = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + tt * tt);
        const s = tt * c;
        A[p * n + p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        A[q * n + q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        A[p * n + q] = 0;
        A[q * n + p] = 0;
        for (let r = 0; r < n; r += 1) {
          if (r === p || r === q) continue;
          const arp = A[r * n + p];
          const arq = A[r * n + q];
          const nrp = c * arp - s * arq;
          const nrq = s * arp + c * arq;
          A[r * n + p] = nrp;
          A[p * n + r] = nrp;
          A[r * n + q] = nrq;
          A[q * n + r] = nrq;
        }
        for (let r = 0; r < n; r += 1) {
          const vip = V[r * n + p];
          const viq = V[r * n + q];
          V[r * n + p] = c * vip - s * viq;
          V[r * n + q] = s * vip + c * viq;
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i += 1) values[i] = Math.max(0, A[i * n + i]);
  return { values, vectors: V };
}

function equationSkipped(skipId, id) {
  if (skipId == null) return false;
  if (typeof skipId === 'string') return id === skipId;
  return typeof skipId.has === 'function' && skipId.has(id);
}

function factorAt(sys, x, skipId) {
  const { n } = sys;
  const skipping = skipId != null && (typeof skipId !== 'string' || skipId !== '');
  const m = skipping
    ? sys.eqs.reduce((c, eq) => c + (equationSkipped(skipId, eq.id) ? 0 : 1), 0)
    : sys.m;
  if (m === 0) {
    const vectors = [];
    for (let j = 0; j < n; j += 1) {
      const v = new Array(n).fill(0);
      v[j] = 1;
      vectors.push(v);
    }
    return { rank: 0, dof: n, nullspace: vectors };
  }
  const scale = new Float64Array(m);
  let row = 0;
  const keep = [];
  sys.eqs.forEach((eq, i) => {
    if (skipping && equationSkipped(skipId, eq.id)) return;
    scale[row] = sys.scale[i];
    keep.push(i);
    row += 1;
  });
  const residual = (xx, out) => {
    if (!skipping) sys.residualAll(xx, out);
    else {
      let k = 0;
      for (const i of keep) out[k++] = sys.eqs[i].fn(xx);
    }
  };
  const r0 = new Float64Array(m);
  residual(x, r0);
  const J = jacobian(n, m, Float64Array.from(x), residual, r0, scale);
  const G = new Float64Array(n * n);
  for (let i = 0; i < m; i += 1) {
    for (let a = 0; a < n; a += 1) {
      const Jia = J[i * n + a];
      for (let b = a; b < n; b += 1) G[a * n + b] += Jia * J[i * n + b];
    }
  }
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < a; b += 1) G[a * n + b] = G[b * n + a];
  }
  const { values, vectors } = jacobiEigen(G, n);
  let sigmaMax = 0;
  const sigma = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    sigma[i] = Math.sqrt(values[i]);
    if (sigma[i] > sigmaMax) sigmaMax = sigma[i];
  }
  const cutoff = Math.max(RANK_REL * sigmaMax, RANK_ABS);
  const nullspace = [];
  for (let j = 0; j < n; j += 1) {
    if (sigma[j] > cutoff) continue;
    const v = new Array(n);
    for (let i = 0; i < n; i += 1) v[i] = vectors[i * n + j];
    nullspace.push(v);
  }
  const rank = n - nullspace.length;
  return { rank, dof: nullspace.length, nullspace };
}

function groupResidual(solved, sys) {
  const out = new Map();
  let row = 0;
  for (const eq of sys.eqs) {
    const scaled = Math.abs(solved.r[row] / (sys.scale[row] || 1));
    out.set(eq.id, Math.max(out.get(eq.id) || 0, scaled));
    row += 1;
  }
  return out;
}

function attribute(sys, solved) {
  if (solved.scaledInf <= CONSISTENT_TOL) return null;
  const weight = groupResidual(solved, sys);
  const suspects = [...weight.entries()]
    .filter(([, w]) => w > CONSISTENT_TOL)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);
  const sufficient = [];
  for (const id of suspects) {
    const again = levenberg(sys, solved.x, id);
    if (again.scaledInf <= CONSISTENT_TOL) sufficient.push(id);
  }
  if (sufficient.length) {
    sufficient.sort((a, b) => (weight.get(b) || 0) - (weight.get(a) || 0));
    return { primary: sufficient[0], ids: sufficient };
  }
  const dropped = [];
  let skip = new Set();
  for (let n = 0; n < 4 && suspects.length; n += 1) {
    const id = suspects.find((s) => !skip.has(s));
    if (!id) break;
    dropped.push(id);
    skip.add(id);
    // Re-solve without the whole dropped set by skipping one at a time is not
    // the same. Fold them: a residual that ignores every dropped id.
    const trial = levenbergDropped(sys, solved.x, skip);
    if (trial.scaledInf <= CONSISTENT_TOL) break;
  }
  if (!dropped.length) return { primary: suspects[0] || sys.groups[0]?.id || null, ids: suspects };
  return { primary: dropped[0], ids: dropped };
}

function levenbergDropped(sys, xStart, skipSet) {
  // Temporary: compile a residual that skips a set. Reuse levenberg by
  // wrapping sys. One id is the common path; a set needs a local residual.
  const { n } = sys;
  const keep = [];
  sys.eqs.forEach((eq, i) => { if (!skipSet.has(eq.id)) keep.push(i); });
  const m = keep.length;
  const scale = new Float64Array(m);
  keep.forEach((i, row) => { scale[row] = sys.scale[i]; });
  const wrapped = {
    n,
    m,
    scale,
    eqs: keep.map((i) => sys.eqs[i]),
    residualAll: (x, out) => {
      for (let row = 0; row < m; row += 1) out[row] = sys.eqs[keep[row]].fn(x);
    },
    residual: (x, out) => {
      for (let row = 0; row < m; row += 1) out[row] = sys.eqs[keep[row]].fn(x);
    },
  };
  return levenberg(wrapped, xStart);
}

function repeatedIds(sys, x, fullRank) {
  const found = [];
  const dropped = new Set();
  const groups = [...sys.groups].reverse();
  let rank = fullRank;
  for (const group of groups) {
    dropped.add(group.id);
    const fact = factorDropped(sys, x, dropped);
    if (fact.rank === rank) {
      found.push({ id: group.id, warning: 'repeated' });
    } else {
      dropped.delete(group.id);
    }
  }
  return found.reverse();
}

function factorDropped(sys, x, skipSet) {
  const { n } = sys;
  const keep = [];
  sys.eqs.forEach((eq, i) => { if (!skipSet.has(eq.id)) keep.push(i); });
  const m = keep.length;
  if (m === 0) return { rank: 0, dof: n };
  const scale = new Float64Array(m);
  keep.forEach((i, row) => { scale[row] = sys.scale[i]; });
  const residual = (xx, out) => {
    for (let row = 0; row < m; row += 1) out[row] = sys.eqs[keep[row]].fn(xx);
  };
  const r0 = new Float64Array(m);
  const xx = Float64Array.from(x);
  residual(xx, r0);
  const J = jacobian(n, m, xx, residual, r0, scale);
  const G = new Float64Array(n * n);
  for (let i = 0; i < m; i += 1) {
    for (let a = 0; a < n; a += 1) {
      const Jia = J[i * n + a];
      for (let b = a; b < n; b += 1) G[a * n + b] += Jia * J[i * n + b];
    }
  }
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < a; b += 1) G[a * n + b] = G[b * n + a];
  }
  const { values } = jacobiEigen(G, n);
  let sigmaMax = 0;
  const sigma = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    sigma[i] = Math.sqrt(Math.max(0, values[i]));
    if (sigma[i] > sigmaMax) sigmaMax = sigma[i];
  }
  const cutoff = Math.max(RANK_REL * sigmaMax, RANK_ABS);
  let rank = 0;
  for (let i = 0; i < n; i += 1) if (sigma[i] > cutoff) rank += 1;
  return { rank, dof: n - rank };
}

function entityTouches(model, id) {
  const ids = new Set();
  const dim = model.dimensions.find((d) => d.id === id);
  const con = model.constraints.find((c) => c.id === id);
  const item = dim || con;
  if (!item) return ids;
  for (const key of ['edge', 'arc', 'point', 'a', 'b']) {
    if (item[key]) ids.add(item[key]);
  }
  for (const ref of item.items || []) ids.add(ref);
  return ids;
}

function tessellateArc(center, radius, start, end, sweep, segments) {
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
  let delta = sweep === 'cw' ? a0 - a1 : a1 - a0;
  if (delta <= 1e-12) delta += Math.PI * 2;
  const chord = radius > 1e-6 ? 2 * Math.acos(Math.min(1, Math.max(-1, 1 - 0.05 / radius))) : Math.PI / 4;
  let steps = Math.ceil(delta / Math.max(chord, 1e-3));
  steps = Math.max(2, Math.min(128, steps));
  if (segments) steps = Math.max(steps, segments);
  const pts = [];
  for (let i = 1; i < steps; i += 1) {
    const t = a0 + (sweep === 'cw' ? -1 : 1) * delta * (i / steps);
    pts.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
  }
  return pts;
}

function tessellateFull(center, radius, segments) {
  const seg = Math.max(3, segments || 64);
  const pts = [];
  for (let i = 0; i < seg; i += 1) {
    const t = (i / seg) * Math.PI * 2;
    pts.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
  }
  return pts;
}

function tessellate(model, at, radii) {
  const loops = [];
  for (const arc of model.arcs) {
    if (!arc.full) continue;
    const c = at[arc.center];
    loops.push(tessellateFull(c, radii[arc.id], arc.segments));
  }
  const partial = model.arcs.filter((a) => !a.full);
  if (!model.lines.length && !partial.length) return { loops, closed: loops.length > 0 };
  const adj = new Map();
  const link = (a, b, edge) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, edge });
    adj.get(b).push({ to: a, edge });
  };
  for (const line of model.lines) link(line.a, line.b, { key: line.id, arc: null });
  for (const arc of partial) link(arc.start, arc.end, { key: arc.id, arc });
  for (const nbrs of adj.values()) {
    if (nbrs.length > 2) fail('contour has a branch');
  }
  const used = new Set();
  let closedAny = loops.length > 0;
  const walk = (start) => {
    const loop = [at[start].slice()];
    let prev = null;
    let cursor = start;
    let closed = false;
    for (;;) {
      const nbrs = adj.get(cursor) || [];
      const next = nbrs.find((n) => !used.has(n.edge.key) && n.to !== prev);
      if (!next) break;
      used.add(next.edge.key);
      const arc = next.edge.arc;
      if (arc) {
        const forward = cursor === arc.start;
        const sweep = forward ? arc.sweep : (arc.sweep === 'cw' ? 'ccw' : 'cw');
        const from = forward ? at[arc.start] : at[arc.end];
        const to = forward ? at[arc.end] : at[arc.start];
        for (const p of tessellateArc(at[arc.center], radii[arc.id], from, to, sweep, arc.segments)) {
          loop.push(p);
        }
      }
      if (next.to === start) { closed = true; break; }
      loop.push(at[next.to].slice());
      prev = cursor;
      cursor = next.to;
    }
    if (loop.length >= 2) loops.push(loop);
    if (closed) closedAny = true;
  };
  for (const [id, nbrs] of adj) {
    if (nbrs.length === 1 && nbrs.some((n) => !used.has(n.edge.key))) walk(id);
  }
  for (const [id, nbrs] of adj) {
    if (nbrs.some((n) => !used.has(n.edge.key))) walk(id);
  }
  return { loops, closed: closedAny };
}

function applyX(model, x) {
  const at = {};
  const radii = {};
  model.points.forEach((p, i) => {
    at[p.id] = [x[i * 2], x[i * 2 + 1]];
  });
  model.arcs.forEach((a, i) => {
    radii[a.id] = x[model.points.length * 2 + i];
  });
  return { at, radii };
}

function pointStatus(nullspace, index, nCoord) {
  let n2 = 0;
  for (const vec of nullspace) {
    for (let k = 0; k < nCoord; k += 1) n2 += (vec[index + k] || 0) ** 2;
  }
  return Math.sqrt(n2) > NULL_EPS ? 'under' : 'full';
}

function assembleResult(model, sys, solved, fact, conflict, repeated) {
  const { at, radii } = applyX(model, solved.x);
  const consistent = !conflict;
  const status = conflict ? 'conflict' : (fact.dof > 0 ? 'under' : 'full');
  const touched = new Set();
  if (conflict) {
    for (const id of conflict.ids) {
      for (const ref of entityTouches(model, id)) touched.add(ref);
    }
  }
  // Grey and dark for everything the conflict does not touch come from the
  // system with those items removed. One bad dimension must not paint the
  // rest of the contour grey. If that subsystem is still inconsistent, the
  // grey/dark pass is skipped and untouched entities stay under.
  let paintSpace = fact.nullspace;
  let paintConsistent = consistent;
  if (conflict?.ids?.length) {
    const skip = new Set(conflict.ids);
    const trial = levenbergDropped(sys, solved.x, skip);
    if (trial.scaledInf <= CONSISTENT_TOL) {
      paintSpace = factorAt(sys, trial.x, skip).nullspace;
      paintConsistent = true;
    }
  }
  const pointState = {};
  model.points.forEach((p, i) => {
    pointState[p.id] = touched.has(p.id)
      ? 'conflict'
      : (paintConsistent ? pointStatus(paintSpace, i * 2, 2) : 'under');
  });
  const lineState = {};
  for (const line of model.lines) {
    if (touched.has(line.id) || pointState[line.a] === 'conflict' || pointState[line.b] === 'conflict') {
      lineState[line.id] = 'conflict';
    } else if (pointState[line.a] === 'under' || pointState[line.b] === 'under') {
      lineState[line.id] = 'under';
    } else {
      lineState[line.id] = 'full';
    }
  }
  const arcState = {};
  model.arcs.forEach((arc, i) => {
    const radiusUnder = paintConsistent && pointStatus(paintSpace, model.points.length * 2 + i, 1) === 'under';
    if (touched.has(arc.id) || pointState[arc.center] === 'conflict') arcState[arc.id] = 'conflict';
    else if (pointState[arc.center] === 'under' || radiusUnder
      || (arc.start && pointState[arc.start] === 'under')
      || (arc.end && pointState[arc.end] === 'under')) arcState[arc.id] = 'under';
    else arcState[arc.id] = 'full';
  });
  const drawn = tessellate(model, at, radii);
  const loops = drawn.loops || drawn;
  const contours = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    let area = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ring = loop.map((p) => [p[0], p[1]]);
    if (area < 0) ring.reverse();
    contours.push(ring);
  }
  const points = model.points.map((p) => ({
    id: p.id,
    at: [round4(at[p.id][0]), round4(at[p.id][1])],
  }));
  const arcs = model.arcs.map((a) => {
    const copy = { ...a, radius: round4(radii[a.id]) };
    return copy;
  });
  return {
    type: 'contour',
    contours,
    points,
    lines: model.lines.map((l) => ({ ...l })),
    arcs,
    dimensions: model.dimensions.map((d) => ({ ...d })),
    constraints: model.constraints.map((c) => ({ ...c, items: c.items ? [...c.items] : undefined })),
    refs: (model.refs || []).map((ref) => copyRef(ref)),
    broken: sys.brokenRefs || [],
    dof: fact.dof,
    status,
    conflict,
    repeated: conflict ? [] : repeated,
    open: contours.length === 0,
    entities: { points: pointState, lines: lineState, arcs: arcState },
    nullspace: fact.nullspace,
  };
}

function solveModel(spec) {
  const model = cloneSpec(spec);
  closeOpenChain(model);
  const sys = compile(model);
  for (const key of ['points', 'lines', 'arcs', 'dimensions', 'constraints']) {
    if (!model[key]) model[key] = [];
  }
  const solved = levenberg(sys, sys.x0);
  const consistent = solved.scaledInf <= CONSISTENT_TOL;
  const fact = factorAt(sys, solved.x);
  const conflict = consistent ? null : attribute(sys, solved);
  const repeated = consistent ? repeatedIds(sys, solved.x, fact.rank) : [];
  return assembleResult(model, sys, solved, fact, conflict, repeated);
}

/** Script helper. Plain data, no nullspace. */
export function solveContour(spec) {
  const full = solveModel(spec);
  const rest = { ...full };
  delete rest.nullspace;
  delete rest.entities;
  return rest;
}

/** Same solve, plus entity status and the nullspace for dragging. */
export function analyzeContour(spec) {
  return solveModel(spec);
}
