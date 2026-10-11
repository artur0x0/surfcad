/**
 * Screen-space hit test for a contour. Point, then arc, then line.
 * Ten pixels, so zoom does not change how hard an edge is to hit.
 * The caller projects plane UV into client pixels.
 */

/** On-screen slop for a sketch point, line, or arc. A finger needs more than the 3px stroke. */
export const SKETCH_HIT_PX = 12;

const HIT_PX = SKETCH_HIT_PX;

export function planeUvToWorld(uv, plane) {
  const u = Number(uv?.[0]) || 0;
  const v = Number(uv?.[1]) || 0;
  const c = plane.center;
  const x = plane.x;
  const y = plane.y;
  return [
    c[0] + u * x[0] + v * y[0],
    c[1] + u * x[1] + v * y[1],
    c[2] + u * x[2] + v * y[2],
  ];
}

function distPoint(px, py, q) {
  if (!q) return Infinity;
  return Math.hypot(px - q.x, py - q.y);
}

function distSegment(px, py, a, b) {
  if (!a || !b) return Infinity;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return distPoint(px, py, a);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function projectAt(model, id, project) {
  const point = (model.points || []).find((p) => p.id === id);
  if (!point) return null;
  return project(point.at);
}

/**
 * @param {object} model contour spec
 * @param {(uv:number[]) => {x:number,y:number}|null} project client pixels
 * @returns {{ kind:'point'|'line'|'arc', id:string }|null}
 */
export function pickContourScreen(model, project, px, py, threshold = HIT_PX) {
  if (!model || typeof project !== 'function') return null;
  const limit = threshold > 0 ? threshold : HIT_PX;
  let bestPoint = null;
  let bestPointD = limit;
  for (const point of model.points || []) {
    const q = project(point.at);
    const d = distPoint(px, py, q);
    if (d <= bestPointD) {
      bestPointD = d;
      bestPoint = point.id;
    }
  }
  if (bestPoint) return { kind: 'point', id: bestPoint, label: bestPoint };

  let bestArc = null;
  let bestArcD = limit;
  for (const arc of model.arcs || []) {
    const samples = arcSamples(model, arc).map(project).filter(Boolean);
    let d = Infinity;
    for (let i = 1; i < samples.length; i += 1) {
      d = Math.min(d, distSegment(px, py, samples[i - 1], samples[i]));
    }
    if (samples.length === 1) d = distPoint(px, py, samples[0]);
    if (d <= bestArcD) {
      bestArcD = d;
      bestArc = arc.id;
    }
  }
  if (bestArc) return { kind: 'arc', id: bestArc, label: bestArc };

  let bestLine = null;
  let bestLineD = limit;
  for (const line of model.lines || []) {
    const a = projectAt(model, line.a, project);
    const b = projectAt(model, line.b, project);
    const d = distSegment(px, py, a, b);
    if (d <= bestLineD) {
      bestLineD = d;
      bestLine = line.id;
    }
  }
  if (bestLine) return { kind: 'line', id: bestLine, label: bestLine };
  return null;
}

function entityPoint(model, id) {
  return (model?.points || []).find((p) => p.id === id)?.at || null;
}

/** Closest UV on a picked point or line. The dimension extension starts here. */
export function anchorOnEntity(model, pick, uv) {
  if (!model || !pick?.id) return null;
  if (pick.kind === 'point') {
    const at = entityPoint(model, pick.id);
    return at ? [at[0], at[1]] : null;
  }
  if (pick.kind === 'line') {
    const line = (model.lines || []).find((l) => l.id === pick.id);
    const a = line && entityPoint(model, line.a);
    const b = line && entityPoint(model, line.b);
    if (!a || !b) return null;
    if (!uv) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    if (!(L2 > 1e-12)) return [a[0], a[1]];
    let t = ((uv[0] - a[0]) * dx + (uv[1] - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return [a[0] + t * dx, a[1] + t * dy];
  }
  return null;
}

function arcSamples(model, arc) {
  const center = (model.points || []).find((p) => p.id === arc.center);
  if (!center) return [];
  const c = center.at;
  const r = Number(arc.radius) || 0;
  if (!(r > 0)) return [];
  if (arc.full) {
    const n = 24;
    const pts = [];
    for (let i = 0; i <= n; i += 1) {
      const t = (i / n) * Math.PI * 2;
      pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
    return pts;
  }
  const start = (model.points || []).find((p) => p.id === arc.start);
  const end = (model.points || []).find((p) => p.id === arc.end);
  if (!start || !end) return [];
  const a0 = Math.atan2(start.at[1] - c[1], start.at[0] - c[0]);
  const a1 = Math.atan2(end.at[1] - c[1], end.at[0] - c[0]);
  let delta = arc.sweep === 'cw' ? a0 - a1 : a1 - a0;
  if (delta <= 1e-12) delta += Math.PI * 2;
  const n = 12;
  const pts = [[start.at[0], start.at[1]]];
  for (let i = 1; i < n; i += 1) {
    const t = a0 + (arc.sweep === 'cw' ? -1 : 1) * delta * (i / n);
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  pts.push([end.at[0], end.at[1]]);
  return pts;
}

/** UV anchor for a dimension tag. */
export function dimensionAnchor(model, dim) {
  if (!model || !dim) return null;
  const pointAt = (id) => (model.points || []).find((p) => p.id === id)?.at || null;
  const midLine = (id) => {
    const line = (model.lines || []).find((l) => l.id === id);
    if (!line) return null;
    const a = pointAt(line.a);
    const b = pointAt(line.b);
    if (!a || !b) return null;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  if (dim.kind === 'length' || dim.kind === 'offset') {
    if (dim.kind === 'offset' && dim.point) return pointAt(dim.point) || midLine(dim.edge);
    return midLine(dim.edge);
  }
  if (dim.kind === 'radius') {
    const arc = (model.arcs || []).find((a) => a.id === dim.arc);
    const c = arc && pointAt(arc.center);
    if (!c) return null;
    return [c[0] + (Number(arc.radius) || 0), c[1]];
  }
  const pa = pointAt(dim.a);
  const pb = pointAt(dim.b);
  if (pa && pb) return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  const a = midLine(dim.a);
  const b = midLine(dim.b);
  if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return a || b;
}

/** UV anchor for a constraint icon. Coincident sits on the shared point. */
export function constraintAnchor(model, con) {
  if (!model || !con) return null;
  const pointAt = (id) => (model.points || []).find((p) => p.id === id)?.at || null;
  const midLine = (id) => {
    const line = (model.lines || []).find((l) => l.id === id);
    if (!line) return null;
    const a = pointAt(line.a);
    const b = pointAt(line.b);
    if (!a || !b) return null;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const arcCrown = (id) => {
    const arc = (model.arcs || []).find((a) => a.id === id);
    const c = arc && pointAt(arc.center);
    if (!c) return null;
    return [c[0] + (Number(arc.radius) || 0), c[1]];
  };
  const refAt = (id) => {
    const geom = (model.refs || []).find((ref) => ref.id === id)?.geom;
    if (!geom) return null;
    if (geom.kind === 'point') return geom.at;
    if (geom.kind === 'line') return [(geom.a[0] + geom.b[0]) / 2, (geom.a[1] + geom.b[1]) / 2];
    if (geom.kind === 'polyline' && geom.points?.length) {
      return geom.points[Math.floor((geom.points.length - 1) / 2)];
    }
    if (geom.kind === 'arc') return geom.center;
    return null;
  };
  const anchorOf = (id) => pointAt(id) || midLine(id) || arcCrown(id) || refAt(id);
  const items = con.items || [];
  if (con.kind === 'coincident') {
    const pts = items.map(pointAt).filter(Boolean);
    if (pts.length) {
      return [
        pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
        pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
      ];
    }
  }
  const pts = items.map(anchorOf).filter(Boolean);
  if (!pts.length) return null;
  return [
    pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
    pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
  ];
}
