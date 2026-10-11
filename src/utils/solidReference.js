/**
 * Extrude, Revolve, and Sweep reference contours by name.
 * The contour owns its frame. Feature data stays in the block.
 *
 *   makeExtrude(c1.contours, 10)
 *   makeRevolve(c1.contours.map(...), 96, 360)
 *   sweepPoints(new CrossSection(c1.contours), localFrom(c2), { closed })
 *
 * A Sweep path is a contour whose profile is `{ type: 'path', closed, points }`.
 * Two points and zero area are legal. The block rebuilds world points from
 * that contour's plane, then maps them into the profile frame.
 */

import { markerWithId } from './featureBlockId.js';

function emitNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const r = +v.toFixed(4);
  return String(Object.is(r, -0) ? 0 : r);
}

function blockLines(begin, end, featureId, lines) {
  return [
    markerWithId(begin, featureId),
    ...lines,
    markerWithId(end, featureId),
  ];
}

export function emitExtrudeReferenceLines({
  begin,
  end,
  featureId,
  contour,
  distance,
  w,
  partLine,
}) {
  const solid = `makeExtrude(${contour}.contours, ${emitNum(distance)})`;
  const placed = partLine(`placeInFrame(${contour}.plane, ${solid}, [0, 0, ${emitNum(w)}])`);
  return blockLines(begin, end, featureId, [placed]);
}

/** @returns {{ name: string, distance: number, w: number } | null} */
export function parseExtrudeReference(block) {
  const text = String(block || '');
  const call = text.match(/makeExtrude\s*\(\s*([A-Za-z_$][\w$]*)\.contours\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (!call) return null;
  const shift = text.match(/\[\s*0\s*,\s*0\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
  return {
    name: call[1],
    distance: Number(call[2]),
    w: shift ? Number(shift[1]) : 0,
  };
}

/** Compact `cu*u + cv*v` for a Revolve remap. */
export function emitUvCombo(uName, vName, cu, cv) {
  const parts = [];
  const pushTerm = (c, name) => {
    const n = +Number(c).toFixed(6);
    if (Math.abs(n) < 1e-12) return;
    if (n === 1) parts.push(name);
    else if (n === -1) parts.push(`-${name}`);
    else parts.push(`${n} * ${name}`);
  };
  pushTerm(cu, uName);
  pushTerm(cv, vName);
  if (parts.length === 0) return '0';
  if (parts.length === 1) return parts[0];
  return parts.join(' + ').replace(/ \+ -/g, ' - ');
}

function emitPlaneAxisExpr(name, cu, cv) {
  const u = +Number(cu).toFixed(6);
  const v = +Number(cv).toFixed(6);
  if (Math.abs(v) < 1e-12 && Math.abs(u - 1) < 1e-12) return `${name}.plane.x`;
  if (Math.abs(v) < 1e-12 && Math.abs(u + 1) < 1e-12) {
    return `[-${name}.plane.x[0], -${name}.plane.x[1], -${name}.plane.x[2]]`;
  }
  if (Math.abs(u) < 1e-12 && Math.abs(v - 1) < 1e-12) return `${name}.plane.y`;
  if (Math.abs(u) < 1e-12 && Math.abs(v + 1) < 1e-12) {
    return `[-${name}.plane.y[0], -${name}.plane.y[1], -${name}.plane.y[2]]`;
  }
  const cuN = emitNum(u);
  const cvN = emitNum(v);
  return `[${cuN} * ${name}.plane.x[0] + ${cvN} * ${name}.plane.y[0], ${cuN} * ${name}.plane.x[1] + ${cvN} * ${name}.plane.y[1], ${cuN} * ${name}.plane.x[2] + ${cvN} * ${name}.plane.y[2]]`;
}

export function emitRevolveReferenceLines({
  begin,
  end,
  featureId,
  contour,
  rU,
  rV,
  aU,
  aV,
  segments,
  angle,
  startDeg,
  partLine,
}) {
  const mapped = `${contour}.contours.map((ring) => ring.map(([u, v]) => [${emitUvCombo('u', 'v', rU, rV)}, ${emitUvCombo('u', 'v', aU, aV)}]))`;
  let solid = `makeRevolve(${mapped}, ${Math.max(3, Math.round(Number(segments) || 96))}, ${emitNum(angle)})`;
  if (Math.abs(Number(startDeg) || 0) > 1e-9) {
    solid = `${solid}.rotate([0, 0, ${emitNum(startDeg)}])`;
  }
  const frame = `{ center: ${contour}.plane.center, x: ${emitPlaneAxisExpr(contour, rU, rV)}, y: ${contour}.plane.normal, normal: ${emitPlaneAxisExpr(contour, aU, aV)} }`;
  return blockLines(begin, end, featureId, [
    partLine(`placeInFrame(${frame}, ${solid})`),
  ]);
}

/** @returns {{ name: string } | null} */
export function parseRevolveReference(block) {
  const text = String(block || '');
  const call = text.match(/makeRevolve\s*\(\s*([A-Za-z_$][\w$]*)\.contours\.map/);
  if (!call) return null;
  return { name: call[1] };
}

function _sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function _dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function _cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function _norm(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-12)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function _round6(n) {
  const r = +Number(n).toFixed(6);
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Plane for a sweep path. Origin is the first point. X is the first
 * nonzero segment. Y is the first off-axis point when the path is planar,
 * otherwise a stable perpendicular. A straight path keeps v = 0, so
 * world = center + u·x is exact.
 */
export function sweepPathFrame(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const origin = points[0];
  if (!origin || origin.length < 3) return null;
  let x = null;
  for (let i = 1; i < points.length; i++) {
    x = _norm(_sub(points[i], points[i - 1]));
    if (x) break;
  }
  if (!x) return null;
  let y = null;
  for (let i = 1; i < points.length; i++) {
    const d = _sub(points[i], origin);
    const along = _dot(d, x);
    y = _norm([d[0] - along * x[0], d[1] - along * x[1], d[2] - along * x[2]]);
    if (y) break;
  }
  if (!y) {
    const ax = Math.abs(x[0]);
    const ay = Math.abs(x[1]);
    const az = Math.abs(x[2]);
    const ref = (ax <= ay && ax <= az) ? [1, 0, 0] : (ay <= az ? [0, 1, 0] : [0, 0, 1]);
    y = _norm(_cross(x, ref));
  }
  const normal = y ? _norm(_cross(x, y)) : null;
  if (!y || !normal) return null;
  return {
    center: origin.slice(0, 3).map(_round6),
    x: x.map(_round6),
    y: y.map(_round6),
    normal: normal.map(_round6),
  };
}

export function projectPathUv(points, frame) {
  return (points || []).map((p) => {
    const d = _sub(p, frame.center);
    return [+(_dot(d, frame.x).toFixed(4)), +(_dot(d, frame.y).toFixed(4))];
  });
}

export function emitPathProfileExpr(points, closed) {
  const pts = (points || []).map((p) => `[${emitNum(p[0])}, ${emitNum(p[1])}]`);
  return `{ type: 'path', closed: ${closed ? 'true' : 'false'}, points: [${pts.join(', ')}] }`;
}

function emitSweepLocalExpr(profile, path, reverse) {
  const ring = reverse ? `${path}.contours[0].slice().reverse()` : `${path}.contours[0]`;
  return `${ring}.map(([u, v]) => { const wx = ${path}.plane.center[0] + u * ${path}.plane.x[0] + v * ${path}.plane.y[0]; const wy = ${path}.plane.center[1] + u * ${path}.plane.x[1] + v * ${path}.plane.y[1]; const wz = ${path}.plane.center[2] + u * ${path}.plane.x[2] + v * ${path}.plane.y[2]; const dx = wx - ${profile}.plane.center[0]; const dy = wy - ${profile}.plane.center[1]; const dz = wz - ${profile}.plane.center[2]; return [dx * ${profile}.plane.x[0] + dy * ${profile}.plane.x[1] + dz * ${profile}.plane.x[2], dx * ${profile}.plane.y[0] + dy * ${profile}.plane.y[1] + dz * ${profile}.plane.y[2], dx * ${profile}.plane.normal[0] + dy * ${profile}.plane.normal[1] + dz * ${profile}.plane.normal[2]]; })`;
}

export function emitSweepReferenceLines({
  begin,
  end,
  featureId,
  profile,
  path,
  localName,
  sweptName,
  partLine,
  reverse = false,
  closed = null,
}) {
  const closedExpr = typeof closed === 'boolean' ? (closed ? 'true' : 'false') : `!!${path}.profile.closed`;
  return blockLines(begin, end, featureId, [
    `const ${localName} = ${emitSweepLocalExpr(profile, path, reverse)};`,
    `const ${sweptName} = sweepPoints(new CrossSection(${profile}.contours), ${localName}, { closed: ${closedExpr}, initialNormal: [1, 0, 0] });`,
    `if (!(${sweptName}.volume() > 1e-8)) throw new Error('sweep: result is EMPTY (volume 0) — check profile area and path');`,
    partLine(`placeInFrame(${profile}.plane, ${sweptName})`),
  ]);
}

/** @returns {{ profile: string, path: string } | null} */
export function parseSweepReferences(block) {
  const text = String(block || '');
  const profile = text.match(/new CrossSection\(\s*([A-Za-z_$][\w$]*)\.contours\s*\)/);
  const closedRef = text.match(/!!\s*([A-Za-z_$][\w$]*)\.profile\.closed/);
  const ring = text.match(/([A-Za-z_$][\w$]*)\.contours\[0\]/);
  const pathName = closedRef?.[1] || ring?.[1];
  if (!profile || !pathName) return null;
  return { profile: profile[1], path: pathName };
}
