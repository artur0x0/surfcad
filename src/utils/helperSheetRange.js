/**
 * Helper-sheet slider ends. Static `default` fields stay the L=100 numbers
 * so an empty-buffer compose keeps today's script literals. The modal scales
 * a fresh length seed by L/100 when the sheet opens.
 *
 * Counts and angles stay linear. A typed number is not snapped.
 */
import { BLEND_SIZE_MAX_MM, BLEND_SIZE_MIN_MM, defaultBlendSizeMm } from './blendSize.js';
import { partLengthMm, scaleFromReference, travelRangeMm } from './sliderRange.js';
import { resolveFastenerSize } from '../workers/fastenerSizes.js';

const POSE_AXIS = Object.freeze({
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
  dx: [1, 0, 0],
  dy: [0, 1, 0],
  dz: [0, 0, 1],
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function unit(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-12)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Planar u/v of a picked face, in the same frame as workplaneFromFace,
 * plus the cylinder axis span of those vertices. Offsets are from the
 * face center. Axial numbers are world coordinates along that axis.
 */
export function faceSliderFrame(vertices, normal, center) {
  const n = unit(normal);
  const c = Array.isArray(center) ? center : null;
  if (!n || !c || !Array.isArray(vertices) || !vertices.length) return null;
  const world = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let x = world[0];
  let best = Infinity;
  for (const axis of world) {
    const score = Math.abs(dot(n, axis));
    if (score < best - 1e-9) {
      best = score;
      x = axis;
    }
  }
  if (best > 0.9) {
    const w = vertices.find((p) => Array.isArray(p) && Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 1e-9) || vertices[0];
    if (!Array.isArray(w)) return null;
    const raw = [w[0] - c[0], w[1] - c[1], w[2] - c[2]];
    const along = dot(raw, n);
    x = unit([raw[0] - along * n[0], raw[1] - along * n[1], raw[2] - along * n[2]]) || [1, 0, 0];
  } else {
    x = unit(x);
  }
  const y = x ? unit(cross(n, x)) : null;
  if (!x || !y) return null;
  const axes = [
    { i: 0, score: Math.abs(n[0]) },
    { i: 1, score: Math.abs(n[1]) },
    { i: 2, score: Math.abs(n[2]) },
  ].sort((a, b) => a.score - b.score);
  const ai = axes[0].i;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  let axial0 = Infinity;
  let axial1 = -Infinity;
  for (const p of vertices) {
    if (!Array.isArray(p)) continue;
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const u = dot(d, x);
    const v = dot(d, y);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
    const a = Number(p[ai]);
    if (Number.isFinite(a)) {
      if (a < axial0) axial0 = a;
      if (a > axial1) axial1 = a;
    }
  }
  if (!Number.isFinite(u0) || !(u1 > u0)) return null;
  return {
    u0: round2(u0),
    u1: round2(u1),
    v0: round2(v0),
    v1: round2(v1),
    axial0: round2(axial0),
    axial1: round2(axial1),
  };
}

/** How far the part box continues behind a face. Null when the box is missing. */
export function thicknessBehind(bounds, face) {
  const n = unit(face?.normal);
  const c = face?.center;
  if (!n || !Array.isArray(c) || !bounds?.min || !bounds?.max) return null;
  let depth = 0;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const behind = n[0] * (c[0] - x) + n[1] * (c[1] - y) + n[2] * (c[2] - z);
        if (behind > depth) depth = behind;
      }
    }
  }
  return depth > 0 ? round2(depth) : null;
}

function grown(min, max, ...vals) {
  let lo = min;
  let hi = max;
  for (const v of vals) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
  }
  return { min: round2(lo), max: round2(hi) };
}

function pack(kind, seed, min, max, step, ctx, param, extra = {}) {
  const s = ctx?.saved ? num(param?.default, seed) : seed;
  const g = grown(min, max, s, ctx?.values?.[param?.name]);
  const shaped = kind === 'length' || kind === 'signed';
  return {
    kind,
    seed: round2(s),
    min: g.min,
    max: g.max,
    step,
    shaped,
    signed: kind === 'signed',
    ...extra,
  };
}

function liveNum(values, name, fallback) {
  const raw = values?.[name];
  if (raw === '' || raw === '-' || raw === '.') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function uvWidth(face, axis) {
  const s = face?.span;
  if (!s) return null;
  const lo = axis === 'u' ? s.u0 : s.v0;
  const hi = axis === 'u' ? s.u1 : s.v1;
  const w = Number(hi) - Number(lo);
  return w > 0 ? w : null;
}

function faceSpanMm(face, L) {
  const u = uvWidth(face, 'u');
  const v = uvWidth(face, 'v');
  const widths = [u, v].filter((n) => n > 0);
  if (!widths.length) return L;
  return Math.min(...widths);
}

function fastenerThru(values) {
  if (values && values.size != null && values.size !== '') {
    try {
      const { entry } = resolveFastenerSize(values.size);
      if (String(values.holeType || 'clearance') === 'tapDrill') return entry.tap;
      const fit = String(values.fit || 'normal');
      return Number(entry[fit]) || Number(entry.normal) || 0;
    } catch {
      /* unknown token: fall through to a typed thru */
    }
  }
  const n = Number(values?.diaThru);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function count(seed, min, max, ctx, param) {
  return pack('count', seed, min, max, 1, ctx, param);
}

function angle(seed, min, max, step, ctx, param) {
  const raw = ctx?.saved ? num(param?.default, seed) : seed;
  const clamped = Math.max(min, Math.min(max, raw));
  const spec = pack('angle', ctx?.saved ? raw : clamped, min, max, step, { ...ctx, saved: false }, param);
  if (ctx?.saved) {
    const g = grown(min, max, raw);
    return { ...spec, seed: round2(raw), min: g.min, max: g.max };
  }
  return spec;
}

/**
 * Slider spec for one helper-sheet number param.
 * @param {string} itemId
 * @param {{ name: string, type?: string, default?: number, min?: number, max?: number }} param
 * @param {object} [ctx]
 */
export function helperFieldSpec(itemId, param, ctx = {}) {
  if (!param || param.type !== 'number') return null;
  const id = itemId || '';
  const name = param.name;
  const L = partLengthMm(ctx.lengthMm);
  const seedOf = (fallback) => scaleFromReference(
    Number.isFinite(Number(param.default)) ? Number(param.default) : fallback,
    L,
  );

  if (name === 'rx' || name === 'ry' || name === 'rz') {
    return angle(num(param.default, 0), -360, 360, 1, ctx, param);
  }
  if (name === 'draftDeg') {
    return angle(num(param.default, 2), -45, 45, 0.5, ctx, param);
  }
  if (name === 'angleDeg') {
    return angle(num(param.default, 0), -90, 90, 1, ctx, param);
  }

  if (name === 'segments') {
    if (id === 'roundedBox') return count(num(param.default, 16), 1, 64, ctx, param);
    return count(num(param.default, 64), 3, 128, ctx, param);
  }
  if (name === 'n' || name === 'm' || name === 'nx' || name === 'ny' || name === 'nz') {
    return count(num(param.default, 1), 1, 32, ctx, param);
  }
  if (name === 'count') {
    return count(num(param.default, 4), 1, 64, ctx, param);
  }

  if (POSE_AXIS[name]) {
    const travel = travelRangeMm(ctx.travelByName?.[name], L);
    return pack('signed', 0, -travel, travel, 1, ctx, param, { measure: POSE_AXIS[name] });
  }

  if (name === 'u' || name === 'v') {
    const span = ctx.face?.span;
    const lo = span ? span[name === 'u' ? 'u0' : 'v0'] : -L;
    const hi = span ? span[name === 'u' ? 'u1' : 'v1'] : L;
    const min = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? lo : -L;
    const max = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? hi : L;
    return pack('signed', num(param.default, 0), min, max, 1, ctx, param);
  }
  if (name === 'axial') {
    const span = ctx.face?.span;
    const seed = num(param.default, 0);
    const min = span && span.axial1 > span.axial0 ? span.axial0 : seed - L;
    const max = span && span.axial1 > span.axial0 ? span.axial1 : seed + L;
    return pack('signed', seed, min, max, 1, ctx, param);
  }
  if ((id === 'array3D' || id === 'polarArray') && (name === 'sx' || name === 'sy' || name === 'sz')) {
    const end = 5 * L;
    return pack('signed', seedOf(0), -end, end, 1, ctx, param);
  }
  if (id === 'moveFace' && name === 'distance') {
    const thin = Number(ctx.minExtent);
    let end = 0.5 * L;
    if (Number.isFinite(thin) && thin > 0) end = Math.min(end, 0.45 * thin);
    end = Math.max(end, 0.1);
    const seed = Math.min(seedOf(2), end);
    return pack('signed', seed, -end, end, 1, ctx, param);
  }

  if ((id === 'filletEdges' && name === 'radius') || (id === 'chamferEdges' && name === 'chamfer')) {
    const seed = ctx?.saved ? num(param.default, defaultBlendSizeMm()) : defaultBlendSizeMm();
    return {
      kind: 'length',
      seed,
      min: BLEND_SIZE_MIN_MM,
      max: BLEND_SIZE_MAX_MM,
      step: 1,
      shaped: true,
      signed: false,
      curve: 'log',
    };
  }

  if (id === 'roundedBox' && name === 'edgeRadius') {
    const sx = liveNum(ctx.values, 'sx', seedOf(50));
    const sy = liveNum(ctx.values, 'sy', scaleFromReference(30, L));
    const sz = liveNum(ctx.values, 'sz', scaleFromReference(20, L));
    const cap = Math.min(0.5 * Math.min(sx, sy, sz), 0.5 * L);
    return pack('length', seedOf(4), 0, Math.max(0, cap), 1, ctx, param);
  }
  if (id === 'tube' && name === 'innerRadius') {
    const outer = liveNum(ctx.values, 'outerRadius', seedOf(15));
    const cap = Math.max(0, outer - 0.1);
    return pack('length', seedOf(10), 0, cap, 1, ctx, param);
  }
  if (id === 'tube' && name === 'wall') {
    const width = liveNum(ctx.values, 'width', seedOf(40));
    const depth = liveNum(ctx.values, 'depth', scaleFromReference(20, L));
    const cap = Math.max(0.1, 0.45 * Math.min(width, depth));
    return pack('length', seedOf(2.5), 0.1, cap, 1, ctx, param);
  }
  if (id === 'tube' && name === 'cornerRadius') {
    const width = liveNum(ctx.values, 'width', seedOf(40));
    const depth = liveNum(ctx.values, 'depth', scaleFromReference(20, L));
    return pack('length', 0, 0, Math.max(0, 0.5 * Math.min(width, depth)), 1, ctx, param);
  }
  if (id === 'shell' && name === 'wall') {
    const thin = Number(ctx.minExtent);
    let max = 0.25 * L;
    if (Number.isFinite(thin) && thin > 0) max = Math.min(max, 0.45 * thin);
    max = Math.max(max, 0.1);
    return pack('length', Math.min(seedOf(2.5), max), Math.min(0.1, max), max, 1, ctx, param);
  }

  const twoL = new Set(['width', 'depth', 'height', 'sx', 'sy', 'sz']);
  if ((id === 'cube' || id === 'roundedBox' || id === 'hexPrism' || id === 'tube' || id === 'cylinder') && twoL.has(name) && name !== 'radius') {
    if (id === 'cylinder' && name === 'height') {
      return pack('length', seedOf(20), 0.1, 2 * L, 1, ctx, param);
    }
    if (id === 'hexPrism' && name === 'height') {
      return pack('length', seedOf(8), 0.1, 2 * L, 1, ctx, param);
    }
    if (id === 'tube' && name === 'height') {
      return pack('length', seedOf(40), 0.1, 2 * L, 1, ctx, param);
    }
    if (id === 'cube' || id === 'roundedBox' || (id === 'tube' && (name === 'width' || name === 'depth'))) {
      return pack('length', seedOf(param.default), 0.1, 2 * L, 1, ctx, param);
    }
  }
  if ((id === 'cylinder' || id === 'sphere' || id === 'hexPrism' || id === 'tube') && (name === 'radius' || name === 'outerRadius')) {
    const cap = id === 'cylinder' && name === 'radius' ? L : L;
    return pack('length', seedOf(param.default), name === 'outerRadius' ? 0.1 : 0.1, cap, 1, ctx, param);
  }
  if (id === 'crossSection' && (name === 'radius' || name === 'width' || name === 'height')) {
    const cap = name === 'radius' ? 0.8 * L : 1.2 * L;
    return pack('length', seedOf(param.default), 0.1, cap, 1, ctx, param);
  }
  if (id === 'makeExtrude' && name === 'height') {
    return pack('length', seedOf(10), 0.1, L, 1, ctx, param);
  }
  if (id === 'makeLoft' && name === 'height') {
    return pack('length', seedOf(20), 0.1, L, 1, ctx, param);
  }
  if ((id === 'polarArray' || id === 'array3D') && name === 'boltCircleRadius') {
    return pack('length', seedOf(20), 0, 2 * L, 1, ctx, param);
  }
  if ((id === 'polarArray' || id === 'array3D') && name === 'boreRadius') {
    const bolt = liveNum(ctx.values, 'boltCircleRadius', seedOf(20));
    return pack('length', seedOf(3), 0.1, Math.max(0.1, bolt), 1, ctx, param);
  }
  if ((id === 'polarArray' || id === 'array3D') && name === 'boreHeight') {
    return pack('length', seedOf(10), 0.1, 2 * L, 1, ctx, param);
  }

  if (name === 'depth') {
    const thick = thicknessBehind(ctx.bounds, ctx.face) || L;
    const max = Math.max(0.1, thick);
    return pack('length', Math.min(seedOf(12), max), 0.1, max, 1, ctx, param);
  }
  if (name === 'spacingU' || name === 'spacingV') {
    const width = uvWidth(ctx.face, name === 'spacingU' ? 'u' : 'v') || L;
    const max = Math.max(0.1, width);
    return pack('length', Math.min(seedOf(name === 'spacingU' ? 18 : 14), max), 0.1, max, 1, ctx, param);
  }
  if (name === 'nearCboreDepth' || name === 'farCboreDepth' || name === 'nearCskDepth' || name === 'farCskDepth' || name === 'cboreDepth' || name === 'cskDepth') {
    const cap = Math.max(0.1, liveNum(ctx.values, 'depth', Math.min(seedOf(12), thicknessBehind(ctx.bounds, ctx.face) || L)));
    return pack('length', Math.min(seedOf(param.default), cap), 0.1, cap, 1, ctx, param);
  }
  if (name === 'dia' || name === 'diaThru' || name === 'diaCbore' || name === 'diaCsk'
    || name === 'nearCboreDia' || name === 'farCboreDia' || name === 'nearCskDia' || name === 'farCskDia') {
    const span = faceSpanMm(ctx.face, L);
    const max = Math.max(0.1, 0.5 * Math.min(span, L));
    const floors = name !== 'dia' && name !== 'diaThru';
    const thru = floors ? fastenerThru(ctx.values) : 0;
    const min = floors && thru > 0 ? thru : 0.1;
    const seed = Math.max(min, Math.min(seedOf(param.default), max));
    return pack('length', seed, Math.min(min, max), Math.max(min, max), 1, ctx, param);
  }

  const scaled = seedOf(0);
  const min = Number.isFinite(Number(param.min))
    ? Number(param.min)
    : (Number(param.default) < 0 ? Number(param.default) * 2 : 0);
  const max = Number.isFinite(Number(param.max))
    ? scaleFromReference(Number(param.max), L)
    : Math.max(L, Math.abs(scaled) * 4, 0.4 * L);
  const kind = min < 0 ? 'signed' : 'length';
  return pack(kind, Number.isFinite(Number(param.default)) ? scaled : 0, min, Math.max(min, max), param.step ?? 0.5, ctx, param);
}
