/**
 * Project a part edge, vertex, or face loop onto a contour plane.
 *
 * The result is plane UV. A line, an arc, or a polyline. A projected
 * length under 0.05 mm is broken and is not collapsed to a point.
 * solveContour stays pure: this module does not read a mesh.
 */

/** Projected length below this is a collapsed edge, not a reference. */
export const REF_DEGENERATE_MM = 0.05;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit3(v, what) {
  const n = Math.hypot(v?.[0] || 0, v?.[1] || 0, v?.[2] || 0);
  if (!(n > 0) || !Number.isFinite(n)) {
    throw new Error(`projectReference: ${what} is not a direction`);
  }
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function planeFrame(plane) {
  if (!plane?.center || !plane?.x || !plane?.y) {
    throw new Error('projectReference: the plane needs a center, x, and y');
  }
  const x = unit3(plane.x, 'plane x');
  const y = unit3(plane.y, 'plane y');
  const normal = plane.normal ? unit3(plane.normal, 'plane normal') : unit3(cross(x, y), 'plane normal');
  return { center: plane.center, x, y, normal };
}

function uvOf(world, frame) {
  const d = [
    world[0] - frame.center[0],
    world[1] - frame.center[1],
    world[2] - frame.center[2],
  ];
  return [dot(d, frame.x), dot(d, frame.y)];
}

function dist2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polyLength(pts) {
  let length = 0;
  for (let i = 1; i < pts.length; i += 1) length += dist2(pts[i - 1], pts[i]);
  return length;
}

function heightSpan(worldPoints, frame) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of worldPoints) {
    const h = dot([
      p[0] - frame.center[0],
      p[1] - frame.center[1],
      p[2] - frame.center[2],
    ], frame.normal);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return max - min;
}

function fitLine(pts) {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of pts) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  const dir = [Math.cos(ang), Math.sin(ang)];
  let maxDev = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of pts) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const t = dx * dir[0] + dy * dir[1];
    maxDev = Math.max(maxDev, Math.hypot(dx - t * dir[0], dy - t * dir[1]));
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  return {
    maxDev,
    length: tMax - tMin,
    a: [cx + tMin * dir[0], cy + tMin * dir[1]],
    b: [cx + tMax * dir[0], cy + tMax * dir[1]],
  };
}

function solve3(m, b) {
  const A = m.slice();
  const B = b.slice();
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(A[row * 3 + col]) > Math.abs(A[pivot * 3 + col])) pivot = row;
    }
    if (Math.abs(A[pivot * 3 + col]) < 1e-12) return null;
    if (pivot !== col) {
      for (let k = col; k < 3; k += 1) {
        const tmp = A[col * 3 + k];
        A[col * 3 + k] = A[pivot * 3 + k];
        A[pivot * 3 + k] = tmp;
      }
      const tb = B[col];
      B[col] = B[pivot];
      B[pivot] = tb;
    }
    const div = A[col * 3 + col];
    for (let row = col + 1; row < 3; row += 1) {
      const f = A[row * 3 + col] / div;
      for (let k = col; k < 3; k += 1) A[row * 3 + k] -= f * A[col * 3 + k];
      B[row] -= f * B[col];
    }
  }
  const x = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let sum = B[row];
    for (let k = row + 1; k < 3; k += 1) sum -= A[row * 3 + k] * x[k];
    const diag = A[row * 3 + row];
    if (Math.abs(diag) < 1e-12) return null;
    x[row] = sum / diag;
  }
  return x;
}

function fitCircle(pts) {
  if (pts.length < 3) return null;
  let a00 = 0;
  let a01 = 0;
  let a02 = 0;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const p of pts) {
    const x = p[0];
    const y = p[1];
    const rr = x * x + y * y;
    a00 += x * x;
    a01 += x * y;
    a02 += x;
    a11 += y * y;
    a12 += y;
    a22 += 1;
    b0 += -rr * x;
    b1 += -rr * y;
    b2 += -rr;
  }
  const sol = solve3(
    [a00, a01, a02, a01, a11, a12, a02, a12, a22],
    [b0, b1, b2],
  );
  if (!sol) return null;
  const cx = -sol[0] / 2;
  const cy = -sol[1] / 2;
  const r2 = cx * cx + cy * cy - sol[2];
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  let maxDev = 0;
  for (const p of pts) {
    maxDev = Math.max(maxDev, Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - radius));
  }
  return { center: [cx, cy], radius, maxDev };
}

function wrapPi(d) {
  let x = d;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function arcGeom(pts, center, radius) {
  const ang = pts.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]));
  let total = 0;
  for (let i = 1; i < ang.length; i += 1) total += wrapPi(ang[i] - ang[i - 1]);
  const gap = dist2(pts[0], pts[pts.length - 1]);
  const closed = gap <= REF_DEGENERATE_MM;
  if (closed && gap > 1e-9) total += wrapPi(ang[0] - ang[ang.length - 1]);
  const sweep = total >= 0 ? 'ccw' : 'cw';
  const geom = { kind: 'arc', center, radius, sweep };
  if (closed && Math.abs(Math.abs(total) - Math.PI * 2) < 0.35) geom.full = true;
  else {
    const toDeg = (r) => (r * 180) / Math.PI;
    geom.start = toDeg(ang[0]);
    geom.end = toDeg(ang[ang.length - 1]);
  }
  return geom;
}

/**
 * World millimetres onto the plane. One point is a vertex. Two or more
 * are an edge or a face loop.
 *
 * @returns {{ broken: boolean, geom: object|null }}
 */
export function projectReference(plane, worldPoints) {
  const frame = planeFrame(plane);
  const world = Array.isArray(worldPoints) ? worldPoints : [];
  if (!world.length) return { broken: true, geom: null };
  for (const p of world) {
    if (!Array.isArray(p) || p.length < 3 || p.some((n) => !Number.isFinite(Number(n)))) {
      throw new Error('projectReference: a point must be finite [x, y, z]');
    }
  }
  const uv = world.map((p) => uvOf(p, frame));
  if (uv.length === 1) return { broken: false, geom: { kind: 'point', at: uv[0] } };
  if (polyLength(uv) < REF_DEGENERATE_MM) return { broken: true, geom: null };
  const line = fitLine(uv);
  if (!(line.length >= REF_DEGENERATE_MM)) return { broken: true, geom: null };
  if (line.maxDev <= REF_DEGENERATE_MM) {
    return { broken: false, geom: { kind: 'line', a: line.a, b: line.b } };
  }
  if (heightSpan(world, frame) <= REF_DEGENERATE_MM) {
    const circle = fitCircle(uv);
    if (circle && circle.maxDev <= REF_DEGENERATE_MM) {
      return {
        broken: false,
        geom: arcGeom(uv, circle.center, circle.radius),
      };
    }
  }
  return { broken: false, geom: { kind: 'polyline', points: uv.map((p) => [p[0], p[1]]) } };
}

/** A geom the solver can read. A collapsed line or polyline is not live. */
export function referenceGeomLive(geom) {
  if (!geom || typeof geom !== 'object') return null;
  if (geom.kind === 'point') {
    const at = geom.at;
    if (!Array.isArray(at) || at.length < 2) return null;
    if (!Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    return geom;
  }
  if (geom.kind === 'line') {
    const a = geom.a;
    const b = geom.b;
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    if (dist2(a, b) < REF_DEGENERATE_MM) return null;
    return geom;
  }
  if (geom.kind === 'polyline') {
    const pts = geom.points;
    if (!Array.isArray(pts) || pts.length < 2) return null;
    if (polyLength(pts) < REF_DEGENERATE_MM) return null;
    return geom;
  }
  if (geom.kind === 'arc') {
    if (!(Number(geom.radius) > 0) || !Array.isArray(geom.center)) return null;
    return geom;
  }
  return null;
}
