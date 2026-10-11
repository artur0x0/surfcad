// Drafting figures for a contour dimension, in canvas pixels.
//
// A length, distance, offset, or radius is two endpoints, extension lines,
// and a double-headed arrow offset from the geometry. An angle is the same
// idea on an arc: extension lines along the legs, arrowheads at the arc ends.
// The label point is the middle of that arrow or arc. The value chip sits there.

const OFFSET_PX = 22;
const GAP_PX = 0;
const PAST_PX = 7;
const ARROW_PX = 9;
const ARROW_W = 5.5;
const ARC_PX = 36;
/** A shorter move still opens the editor. Past this, the chip repositions. */
export const DIM_TAP_PX = 6;
const LINEAR_PLACE_MIN = 1;
const ANGLE_PLACE_MIN = 2;
const ANGLE_PLACE_MAX = 400;

function pointAt(model, id) {
  const sketch = (model?.points || []).find((p) => p.id === id)?.at;
  if (sketch) return sketch;
  const geom = (model?.refs || []).find((ref) => ref.id === id)?.geom;
  if (geom?.kind === 'point') return geom.at;
  return null;
}

function lineOf(model, id) {
  const line = (model?.lines || []).find((l) => l.id === id);
  if (line) {
    const a = pointAt(model, line.a);
    const b = pointAt(model, line.b);
    if (!a || !b) return null;
    return { line, a, b, d: [b[0] - a[0], b[1] - a[1]] };
  }
  const geom = (model?.refs || []).find((ref) => ref.id === id)?.geom;
  if (geom?.kind !== 'line' || !geom.a || !geom.b) return null;
  return { line: { a: id, b: id, ref: true }, a: geom.a, b: geom.b, d: [geom.b[0] - geom.a[0], geom.b[1] - geom.a[1]] };
}

function hypot2(x, y) {
  return Math.hypot(x, y);
}

function unit(x, y) {
  const L = hypot2(x, y);
  if (!(L > 1e-9)) return null;
  return { x: x / L, y: y / L, L };
}

function footOnLine(p, a, b, clamp = false) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (!(L2 > 1e-12)) return null;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  if (clamp) t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function sharedVertex(model, A, B) {
  if (A.line.a === B.line.a || A.line.a === B.line.b) return pointAt(model, A.line.a);
  if (A.line.b === B.line.a || A.line.b === B.line.b) return pointAt(model, A.line.b);
  return null;
}

function intersectLines(A, B) {
  const d1 = A.d;
  const d2 = B.d;
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-9) return null;
  const dx = B.a[0] - A.a[0];
  const dy = B.a[1] - A.a[1];
  const t = (dx * d2[1] - dy * d2[0]) / cross;
  return [A.a[0] + t * d1[0], A.a[1] + t * d1[1]];
}

function awayFrom(line, vertex) {
  const da = hypot2(line.a[0] - vertex[0], line.a[1] - vertex[1]);
  const db = hypot2(line.b[0] - vertex[0], line.b[1] - vertex[1]);
  const far = da >= db ? line.a : line.b;
  return unit(far[0] - vertex[0], far[1] - vertex[1]);
}

function signedAngle(a, b) {
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

/** UV endpoints for every dimension that is not an angle. Null when incomplete. */
export function dimensionEndpoints(model, dim) {
  if (!model || !dim) return null;
  if (dim.kind === 'length') {
    const line = lineOf(model, dim.edge);
    if (!line) return null;
    return { a: line.a, b: line.b };
  }
  if (dim.kind === 'radius') {
    const arc = (model.arcs || []).find((item) => item.id === dim.arc);
    const c = arc && pointAt(model, arc.center);
    const r = Number(arc?.radius) || 0;
    if (!c || !(r > 0)) return null;
    const start = arc.start && pointAt(model, arc.start);
    const rim = start || [c[0] + r, c[1]];
    return { a: c, b: rim };
  }
  if (dim.kind === 'offset') {
    const p = pointAt(model, dim.point);
    const line = lineOf(model, dim.edge);
    if (!p || !line) return null;
    const foot = footOnLine(p, line.a, line.b);
    if (!foot) return null;
    return { a: p, b: foot };
  }
  if (dim.kind === 'distance') {
    const pa = pointAt(model, dim.a);
    const pb = pointAt(model, dim.b);
    if (pa && pb) return { a: pa, b: pb };
    const A = lineOf(model, dim.a);
    const B = lineOf(model, dim.b);
    if (pa && B && !pb) {
      const foot = footOnLine(pa, B.a, B.b);
      return foot ? { a: pa, b: foot } : null;
    }
    if (pb && A && !pa) {
      const foot = footOnLine(pb, A.a, A.b);
      return foot ? { a: pb, b: foot } : null;
    }
    if (!A || !B) return null;
    // The two taps, snapped back onto the solved lines. A midpoint of the
    // first edge sits off the point the user actually picked.
    const anchors = Array.isArray(dim.anchors) ? dim.anchors : null;
    const from = anchors?.[0]
      ? (footOnLine(anchors[0], A.a, A.b, true) || anchors[0])
      : mid(A.a, A.b);
    const onto = anchors?.[1]
      ? (footOnLine(anchors[1], B.a, B.b, true) || anchors[1])
      : footOnLine(from, B.a, B.b);
    if (!from || !onto) return null;
    return { a: from, b: onto };
  }
  return null;
}

/** Vertex and the two legs of an angle, swept by the dimensioned turn. */
export function dimensionAngle(model, dim) {
  if (!model || dim?.kind !== 'angle') return null;
  const A = lineOf(model, dim.a);
  const B = lineOf(model, dim.b);
  if (!A || !B) return null;
  const vertex = sharedVertex(model, A, B) || intersectLines(A, B);
  if (!vertex) return null;
  const dirA = awayFrom(A, vertex);
  const dirB = awayFrom(B, vertex);
  if (!dirA || !dirB) return null;
  const want = (Number(dim.value) || 0) * Math.PI / 180;
  const options = [];
  for (const a of [dirA, { x: -dirA.x, y: -dirA.y }]) {
    for (const b of [dirB, { x: -dirB.x, y: -dirB.y }]) {
      const sweep = signedAngle(a, b);
      options.push({ dirA: a, dirB: b, sweep, err: Math.abs(Math.abs(sweep) - Math.abs(want)) });
    }
  }
  options.sort((p, q) => p.err - q.err);
  const best = options[0];
  if (!best || !(Math.abs(best.sweep) > 1e-3)) return null;
  return { vertex, dirA: best.dirA, dirB: best.dirB, sweep: best.sweep };
}

function arrowHead(tip, dir) {
  const backX = tip.x - dir.x * ARROW_PX;
  const backY = tip.y - dir.y * ARROW_PX;
  const px = -dir.y;
  const py = dir.x;
  return {
    tip: { x: tip.x, y: tip.y },
    left: { x: backX + px * (ARROW_W / 2), y: backY + py * (ARROW_W / 2) },
    right: { x: backX - px * (ARROW_W / 2), y: backY - py * (ARROW_W / 2) },
  };
}

function arrowBase(arrow) {
  return {
    x: (arrow.left.x + arrow.right.x) / 2,
    y: (arrow.left.y + arrow.right.y) / 2,
  };
}

/** Pull both ends of a polyline back by `inset` px so the stroke stops at the arrow base. */
function trimEnds(samples, inset) {
  const cut = (pts) => {
    let remain = inset;
    let i = 0;
    while (i < pts.length - 1 && remain > 0) {
      const L = hypot2(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (!(L > 1e-6)) {
        i += 1;
        continue;
      }
      if (L > remain) {
        const t = remain / L;
        const p = {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
        };
        return [p, ...pts.slice(i + 1)];
      }
      remain -= L;
      i += 1;
    }
    return pts.slice(-1);
  };
  if (!samples || samples.length < 2 || !(inset > 0)) return samples;
  const fromStart = cut(samples);
  const rev = cut([...fromStart].reverse());
  const out = rev.reverse();
  return out.length >= 2 ? out : samples;
}

function extension(geo, dim) {
  const u = unit(dim.x - geo.x, dim.y - geo.y);
  if (!u) return null;
  return {
    a: { x: geo.x + u.x * GAP_PX, y: geo.y + u.y * GAP_PX },
    b: { x: dim.x + u.x * PAST_PX, y: dim.y + u.y * PAST_PX },
  };
}

function offsetNormal(a, b) {
  const u = unit(b.x - a.x, b.y - a.y);
  if (!u) return null;
  let nx = -u.y;
  let ny = u.x;
  if (ny > 0.15 || (Math.abs(ny) <= 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

function round4(n) {
  const r = Math.round(Number(n) * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}

/** Left perpendicular of the segment, in sketch millimetres. Stable across cameras. */
function segmentNormal(aUv, bUv) {
  const u = unit(bUv[0] - aUv[0], bUv[1] - aUv[1]);
  if (!u) return null;
  return { x: -u.y, y: u.x };
}

function clampLinearPlacement(mm) {
  if (!Number.isFinite(mm)) return null;
  let v = mm;
  if (Math.abs(v) < LINEAR_PLACE_MIN) v = v < 0 ? -LINEAR_PLACE_MIN : LINEAR_PLACE_MIN;
  return round4(v);
}

function clampAnglePlacement(mm) {
  if (!Number.isFinite(mm)) return null;
  let v = mm;
  if (v < ANGLE_PLACE_MIN) v = ANGLE_PLACE_MIN;
  if (v > ANGLE_PLACE_MAX) v = ANGLE_PLACE_MAX;
  return round4(v);
}

/**
 * Signed millimetres from the segment to the pointer, along segmentNormal.
 * A 1mm probe through `project` keeps the sign on the side the camera shows.
 */
function linearPlacementAt(aUv, bUv, project, pointer) {
  const n = segmentNormal(aUv, bUv);
  if (!n || !pointer) return null;
  const mid = [(aUv[0] + bUv[0]) / 2, (aUv[1] + bUv[1]) / 2];
  const origin = project(mid);
  const probe = project([mid[0] + n.x, mid[1] + n.y]);
  if (!origin || !probe) return null;
  const dx = probe.x - origin.x;
  const dy = probe.y - origin.y;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-6)) return null;
  const along = ((pointer.x - origin.x) * dx + (pointer.y - origin.y) * dy) / len2;
  return clampLinearPlacement(along);
}

/** Arc radius in millimetres from the vertex out to the pointer. */
function anglePlacementAt(model, dim, project, pointer) {
  const angle = dimensionAngle(model, dim);
  if (!angle || !pointer) return null;
  const vertex = project(angle.vertex);
  const probe = project([
    angle.vertex[0] + angle.dirA.x,
    angle.vertex[1] + angle.dirA.y,
  ]);
  if (!vertex || !probe) return null;
  const pxPerUv = hypot2(probe.x - vertex.x, probe.y - vertex.y);
  if (!(pxPerUv > 1e-3)) return null;
  const radiusPx = hypot2(pointer.x - vertex.x, pointer.y - vertex.y);
  return clampAnglePlacement(radiusPx / pxPerUv);
}

/**
 * Placement for a chip drag. Linear kinds move along the dimension normal.
 * An angle moves along its radius. Null when the pointer cannot be measured.
 */
export function placementFromPointer(model, dim, project, pointer) {
  if (!model || !dim || typeof project !== 'function' || !pointer) return null;
  if (dim.kind === 'angle') return anglePlacementAt(model, dim, project, pointer);
  const ends = dimensionEndpoints(model, dim);
  if (!ends) return null;
  return linearPlacementAt(ends.a, ends.b, project, pointer);
}

function linearLayout(kind, aUv, bUv, project, placement) {
  const a = project(aUv);
  const b = project(bUv);
  if (!a || !b) return null;
  const placed = Number.isFinite(placement) && placement !== 0;
  let dimA;
  let dimB;
  if (placed) {
    const n = segmentNormal(aUv, bUv);
    if (!n) return null;
    dimA = project([aUv[0] + n.x * placement, aUv[1] + n.y * placement]);
    dimB = project([bUv[0] + n.x * placement, bUv[1] + n.y * placement]);
    if (!dimA || !dimB) return null;
  } else {
    const n = offsetNormal(a, b);
    if (!n) return null;
    dimA = { x: a.x + n.x * OFFSET_PX, y: a.y + n.y * OFFSET_PX };
    dimB = { x: b.x + n.x * OFFSET_PX, y: b.y + n.y * OFFSET_PX };
  }
  const span = hypot2(dimB.x - dimA.x, dimB.y - dimA.y);
  if (!(span > 1)) return null;
  const extA = extension(a, dimA);
  const extB = extension(b, dimB);
  if (!extA || !extB) return null;
  const outwardA = unit(dimA.x - dimB.x, dimA.y - dimB.y);
  const outwardB = unit(dimB.x - dimA.x, dimB.y - dimA.y);
  if (!outwardA || !outwardB) return null;
  // Tips sit on the extension lines. The head points back along the dimension
  // line, so the shaft can stop at that base and not cross the extension.
  // A span too short for two heads puts the heads outside, still tip-on-line.
  const outside = span < ARROW_PX * 2 + 4;
  const arrows = outside
    ? [arrowHead(dimA, outwardB), arrowHead(dimB, outwardA)]
    : [arrowHead(dimA, outwardA), arrowHead(dimB, outwardB)];
  const shaft = outside ? null : [arrowBase(arrows[0]), arrowBase(arrows[1])];
  return {
    kind,
    label: { x: (dimA.x + dimB.x) / 2, y: (dimA.y + dimB.y) / 2 },
    extensions: [extA, extB],
    shaft,
    arc: null,
    arrows,
  };
}

function angleLayout(model, dim, project) {
  const angle = dimensionAngle(model, dim);
  if (!angle) return null;
  const vertex = project(angle.vertex);
  const probe = project([
    angle.vertex[0] + angle.dirA.x,
    angle.vertex[1] + angle.dirA.y,
  ]);
  if (!vertex || !probe) return null;
  const pxPerUv = hypot2(probe.x - vertex.x, probe.y - vertex.y);
  if (!(pxPerUv > 1e-3)) return null;
  const storedRadius = Number(dim.placement);
  const useStored = Number.isFinite(storedRadius) && storedRadius > 0;
  let radiusUv = useStored ? storedRadius : ARC_PX / pxPerUv;
  if (!useStored) {
    const A = lineOf(model, dim.a);
    const B = lineOf(model, dim.b);
    const leg = Math.min(
      A ? hypot2(A.d[0], A.d[1]) : radiusUv,
      B ? hypot2(B.d[0], B.d[1]) : radiusUv,
    );
    if (leg > 1) radiusUv = Math.min(radiusUv, leg * 0.55);
  }
  const steps = 14;
  const a0 = Math.atan2(angle.dirA.y, angle.dirA.x);
  const samples = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = a0 + angle.sweep * (i / steps);
    const uv = [
      angle.vertex[0] + radiusUv * Math.cos(t),
      angle.vertex[1] + radiusUv * Math.sin(t),
    ];
    const p = project(uv);
    if (!p) return null;
    samples.push(p);
  }
  const endA = samples[0];
  const endB = samples[samples.length - 1];
  const midSample = samples[Math.floor(samples.length / 2)];
  const tanA = unit(samples[0].x - samples[1].x, samples[0].y - samples[1].y);
  const tanB = unit(
    samples[samples.length - 1].x - samples[samples.length - 2].x,
    samples[samples.length - 1].y - samples[samples.length - 2].y,
  );
  if (!tanA || !tanB) return null;
  const ext = (end) => extension(vertex, end);
  const extA = ext(endA);
  const extB = ext(endB);
  if (!extA || !extB) return null;
  const arrows = [arrowHead(endA, tanA), arrowHead(endB, tanB)];
  return {
    kind: 'angle',
    label: midSample,
    extensions: [extA, extB],
    shaft: null,
    arc: trimEnds(samples, ARROW_PX),
    arrows,
  };
}

/**
 * Screen figure for one dimension.
 * `project` maps a UV pair to `{x, y}` canvas pixels, or null when off-view.
 * @returns {object|null}
 */
export function dimensionLayout(model, dim, project) {
  if (!model || !dim || typeof project !== 'function') return null;
  const placement = Number(dim.placement);
  const fig = dim.kind === 'angle'
    ? angleLayout(model, dim, project)
    : (() => {
      const ends = dimensionEndpoints(model, dim);
      if (!ends) return null;
      return linearLayout(
        dim.kind,
        ends.a,
        ends.b,
        project,
        Number.isFinite(placement) ? placement : undefined,
      );
    })();
  if (!fig) return null;
  if (Number.isFinite(placement)) fig.placement = placement;
  return fig;
}

function num(n) {
  return Number(n).toFixed(1);
}

function lineAttrs(a, b, extra) {
  return `x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" ${extra}`;
}

/** SVG children for one figure. Strokes are a dark halo under a light core. */
export function dimensionMarkup(fig) {
  if (!fig) return '';
  const halo = 'stroke="#0f172a" stroke-opacity="0.55" fill="none" stroke-width="3.5" stroke-linecap="butt"';
  const core = 'stroke="#f8fafc" fill="none" stroke-width="1.5" stroke-linecap="butt"';
  const parts = [];
  for (const ext of fig.extensions || []) {
    parts.push(`<line ${lineAttrs(ext.a, ext.b, halo)} />`);
    parts.push(`<line data-contour-dim-ext="" ${lineAttrs(ext.a, ext.b, core)} />`);
  }
  if (fig.shaft) {
    const [a, b] = fig.shaft;
    parts.push(`<line ${lineAttrs(a, b, halo)} />`);
    parts.push(`<line data-contour-dim-shaft="" ${lineAttrs(a, b, core)} />`);
  }
  if (fig.arc?.length > 1) {
    const d = fig.arc.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join(' ');
    parts.push(`<path d="${d}" ${halo} />`);
    parts.push(`<path data-contour-dim-arc="" d="${d}" ${core} />`);
  }
  for (const arrow of fig.arrows || []) {
    const pts = `${num(arrow.tip.x)},${num(arrow.tip.y)} ${num(arrow.left.x)},${num(arrow.left.y)} ${num(arrow.right.x)},${num(arrow.right.y)}`;
    parts.push(`<polygon points="${pts}" fill="#0f172a" fill-opacity="0.55" stroke="none" />`);
    parts.push(`<polygon data-contour-dim-arrow="" points="${pts}" fill="#f8fafc" stroke="none" />`);
  }
  const place = Number.isFinite(Number(fig.placement))
    ? ` data-contour-dim-placement="${round4(fig.placement)}"`
    : '';
  return `<g data-contour-dim="${fig.id || ''}" data-contour-dim-kind="${fig.kind || ''}" data-contour-dim-label-x="${num(fig.label.x)}" data-contour-dim-label-y="${num(fig.label.y)}"${place}>${parts.join('')}</g>`;
}
