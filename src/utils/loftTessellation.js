/**
 * Curvature-adaptive sample counts for makeLoft.
 *
 * The tolerance is a fraction of the part's bounding diagonal, clamped, so a
 * small prism is not decimated and a saddle is not meshed at a fixed 128
 * rays. Samples drop only where the profile is straight or the ruling is
 * flat. opts.resolution, when set, is a separate cap on the polar gap.
 */

export const LOFT_CHORD_FRAC = 0.0005;
export const LOFT_CHORD_MIN_MM = 0.01;
export const LOFT_CHORD_MAX_MM = 0.25;
/** Turning angle kept even when the chord error is under the tolerance. */
export const LOFT_CREASE_DEG = 25;
/** A simplified chain whose tangent turns more than this is split again. */
export const LOFT_ANGULAR_MAX_DEG = 12;
export const LOFT_SPAN_SEGS_CAP = 32;
export const LOFT_RESOLUTION_MIN = 8;
export const LOFT_RESOLUTION_MAX = 256;
/**
 * Spans shorter than this are not their own extrude. 1e-6 is the coincident
 * floor assembleLoftStations already allows, and it is below float32 ulp
 * once z is tens of millimetres.
 */
export const LOFT_SPAN_MIN_MM = 1e-4;

function _distToSeg(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-24) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

function _turnDeg(pts, i) {
  const n = pts.length;
  const prev = pts[(i - 1 + n) % n];
  const cur = pts[i];
  const next = pts[(i + 1) % n];
  const ax = cur[0] - prev[0];
  const ay = cur[1] - prev[1];
  const bx = next[0] - cur[0];
  const by = next[1] - cur[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-12 || lb < 1e-12) return 180;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Closed Douglas–Peucker. Crease vertices stay. Other vertices stay when
 * their distance to the kept chord exceeds `epsMm`.
 * @returns {number[]} indices into `pts`, in loop order
 */
export function simplifyClosedPolylineIndices(pts, epsMm, creaseDeg = LOFT_CREASE_DEG) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  if (n === 0) return [];
  if (!(epsMm > 0) || n <= 3) {
    return pts.map((_, i) => i);
  }
  for (let i = 0; i < n; i++) {
    if (_turnDeg(pts, i) >= creaseDeg) keep[i] = 1;
  }
  let lockedCount = 0;
  for (let i = 0; i < n; i++) if (keep[i]) lockedCount += 1;
  if (lockedCount < 3) {
    let i0 = 0;
    let r0 = -1;
    for (let i = 0; i < n; i++) {
      const r = pts[i][0] * pts[i][0] + pts[i][1] * pts[i][1];
      if (r > r0) {
        r0 = r;
        i0 = i;
      }
    }
    keep[i0] = 1;
    let i1 = 0;
    let d1 = -1;
    for (let i = 0; i < n; i++) {
      const dx = pts[i][0] - pts[i0][0];
      const dy = pts[i][1] - pts[i0][1];
      const d = dx * dx + dy * dy;
      if (d > d1) {
        d1 = d;
        i1 = i;
      }
    }
    keep[i1] = 1;
    let i2 = -1;
    let d2 = -1;
    for (let i = 0; i < n; i++) {
      if (i === i0 || i === i1) continue;
      const d = _distToSeg(pts[i], pts[i0], pts[i1]);
      if (d > d2) {
        d2 = d;
        i2 = i;
      }
    }
    if (i2 >= 0) keep[i2] = 1;
  }

  const dp = (i0, i1) => {
    let maxD = 0;
    let maxI = -1;
    for (let i = (i0 + 1) % n; i !== i1; i = (i + 1) % n) {
      const d = _distToSeg(pts[i], pts[i0], pts[i1]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsMm && maxI >= 0) {
      keep[maxI] = 1;
      dp(i0, maxI);
      dp(maxI, i1);
    }
  };

  const locked = [];
  for (let i = 0; i < n; i++) if (keep[i]) locked.push(i);
  for (let k = 0; k < locked.length; k++) {
    dp(locked[k], locked[(k + 1) % locked.length]);
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function simplifyClosedPolyline(pts, epsMm, creaseDeg = LOFT_CREASE_DEG) {
  return simplifyClosedPolylineIndices(pts, epsMm, creaseDeg).map((i) => pts[i]);
}

function _chainTurnDeg(pts, i0, i1) {
  const n = pts.length;
  let prev = null;
  let total = 0;
  let i = i0;
  let guard = 0;
  while (i !== i1 && guard++ < n + 1) {
    const j = (i + 1) % n;
    const dx = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-12) {
      const dir = [dx / len, dy / len];
      if (prev) {
        const cos = Math.max(-1, Math.min(1, prev[0] * dir[0] + prev[1] * dir[1]));
        total += (Math.acos(cos) * 180) / Math.PI;
      }
      prev = dir;
    }
    i = j;
  }
  return total;
}

/**
 * Put back original vertices on a simplified chain whose tangent turns more
 * than `maxTurnDeg`. A single input edge is straight and is left alone.
 */
export function refineAngularIndices(pts, indices, maxTurnDeg = LOFT_ANGULAR_MAX_DEG) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  for (const i of indices) keep[i] = 1;
  let guard = 0;
  while (guard++ < n) {
    const locked = [];
    for (let i = 0; i < n; i++) if (keep[i]) locked.push(i);
    if (locked.length < 2) break;
    let changed = false;
    for (let k = 0; k < locked.length; k++) {
      const i0 = locked[k];
      const i1 = locked[(k + 1) % locked.length];
      let between = 0;
      for (let i = (i0 + 1) % n; i !== i1; i = (i + 1) % n) between += 1;
      if (between === 0) continue;
      if (_chainTurnDeg(pts, i0, i1) <= maxTurnDeg) continue;
      let far = -1;
      let farD = -1;
      for (let i = (i0 + 1) % n; i !== i1; i = (i + 1) % n) {
        const d = _distToSeg(pts[i], pts[i0], pts[i1]);
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
      if (far < 0) continue;
      keep[far] = 1;
      changed = true;
      break;
    }
    if (!changed) break;
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function angleOf(x, y) {
  let a = Math.atan2(y, x);
  if (a < 0) a += Math.PI * 2;
  if (a >= Math.PI * 2 - 1e-12) a = 0;
  return a;
}

export function dedupeAngles(raw) {
  const vals = [];
  for (const x of raw) {
    if (!Number.isFinite(x)) continue;
    let a = x % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    if (a >= Math.PI * 2 - 1e-12) a = 0;
    vals.push(a);
  }
  vals.sort((p, q) => p - q);
  const out = [];
  for (const a of vals) {
    if (!out.length || a - out[out.length - 1] > 1e-4) out.push(a);
  }
  if (out.length > 1 && out[0] + Math.PI * 2 - out[out.length - 1] < 1e-4) out.pop();
  return out;
}

export function gapAfter(angles, i) {
  const n = angles.length;
  const j = (i + 1) % n;
  if (j === 0) return angles[0] + Math.PI * 2 - angles[i];
  return angles[j] - angles[i];
}

export function maxPolarGap(angles) {
  if (!angles || angles.length < 2) return Math.PI * 2;
  let worst = 0;
  for (let i = 0; i < angles.length; i++) {
    const g = gapAfter(angles, i);
    if (g > worst) worst = g;
  }
  return worst;
}

/** Insert angle midpoints until every wrapped gap is ≤ `maxGap` radians. */
export function capPolarGaps(angles, maxGap) {
  let a = dedupeAngles(angles);
  if (a.length < 2 || !(maxGap > 0)) return a;
  let guard = 0;
  while (a.length < 4096 && guard++ < 4096) {
    let worst = 0;
    let worstAt = 0;
    for (let i = 0; i < a.length; i++) {
      const g = gapAfter(a, i);
      if (g > worst) {
        worst = g;
        worstAt = i;
      }
    }
    if (worst <= maxGap + 1e-8) break;
    let mid = a[worstAt] + worst / 2;
    if (mid >= Math.PI * 2) mid -= Math.PI * 2;
    const next = dedupeAngles(a.concat([mid]));
    if (next.length === a.length) break;
    a = next;
  }
  return a;
}

/**
 * `opts.resolution` when it is a positive finite number. Omitted means the
 * chordal/angular pass alone (no uniform polar floor).
 */
export function resolveLoftResolution(opts) {
  if (!opts || opts.resolution == null || opts.resolution === '') return null;
  const n = Number(opts.resolution);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(LOFT_RESOLUTION_MAX, Math.max(LOFT_RESOLUTION_MIN, Math.round(n)));
}

function _stationPoint(station, uv) {
  const plane = station && station.plane;
  if (plane && plane.center && plane.x && plane.y) {
    return [
      plane.center[0] + uv[0] * plane.x[0] + uv[1] * plane.y[0],
      plane.center[1] + uv[0] * plane.x[1] + uv[1] * plane.y[1],
      plane.center[2] + uv[0] * plane.x[2] + uv[1] * plane.y[2],
    ];
  }
  const z = Number(station && station.offset) || 0;
  return [uv[0], uv[1], z];
}

/** Bounding diagonal of every station contour, in millimetres. */
export function loftCharacteristicLengthMm(stations) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (const s of stations || []) {
    const contour = s && (s.contour || s.pts);
    if (!Array.isArray(contour)) continue;
    for (const uv of contour) {
      if (!uv || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) continue;
      const p = _stationPoint(s, uv);
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
      any = true;
    }
  }
  if (!any) return LOFT_CHORD_MIN_MM / LOFT_CHORD_FRAC;
  return Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
}

export function loftChordToleranceMm(stations) {
  const chord = LOFT_CHORD_FRAC * loftCharacteristicLengthMm(stations);
  return Math.min(LOFT_CHORD_MAX_MM, Math.max(LOFT_CHORD_MIN_MM, chord));
}

/**
 * Shared polar angles for a parallel loft. Vertex angles of the simplified
 * profiles, split again where a chain still turns, then (only when
 * `opts.resolution` is set) filled so no polar gap exceeds 2π/N.
 */
export function adaptiveLoftAngles(stations, opts = {}, epsMm) {
  const eps = Number.isFinite(epsMm) ? epsMm : loftChordToleranceMm(stations);
  const raw = [];
  for (const s of stations) {
    const contour = s.contour;
    if (!Array.isArray(contour) || contour.length < 3) continue;
    const simplified = simplifyClosedPolylineIndices(contour, eps, LOFT_CREASE_DEG);
    const refined = refineAngularIndices(contour, simplified, LOFT_ANGULAR_MAX_DEG);
    for (const i of refined) {
      const p = contour[i];
      if (Math.hypot(p[0], p[1]) > 1e-8) raw.push(angleOf(p[0], p[1]));
    }
  }
  let angles = dedupeAngles(raw);
  const res = resolveLoftResolution(opts);
  if (res != null) angles = capPolarGaps(angles, (Math.PI * 2) / res);
  if (angles.length < 3) {
    throw new Error('makeLoft: could not build an angle table (profiles must contain the plane origin)');
  }
  return angles;
}

/** |twist| / 4 — distance from the bilinear quad center to either diagonal. */
export function quadTwistSagitta(a0, a1, b0, b1) {
  const x = a0[0] - a1[0] + b1[0] - b0[0];
  const y = a0[1] - a1[1] + b1[1] - b0[1];
  const z = (a0[2] || 0) - (a1[2] || 0) + (b1[2] || 0) - (b0[2] || 0);
  return Math.hypot(x, y, z) / 4;
}

export function maxTwistSagitta(ringA, ringB) {
  let m = 0;
  const n = ringA.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const s = quadTwistSagitta(ringA[k], ringA[k1], ringB[k], ringB[k1]);
    if (s > m) m = s;
  }
  return m;
}

/**
 * Segments along one station span so the quad-twist error stays ≤ eps.
 * One segment when the span is a straight, untwisted ruling.
 */
export function loftSpanSegments(sagittaMm, epsMm, cap = LOFT_SPAN_SEGS_CAP) {
  const sag = Number(sagittaMm) || 0;
  const eps = Number(epsMm);
  if (!(sag > 0) || !(eps > 0) || sag <= eps) return 1;
  const n = Math.ceil(sag / eps - 1e-12);
  if (!Number.isFinite(n) || n < 1) return 1;
  const limit = Number.isFinite(cap) && cap > 0 ? cap : LOFT_SPAN_SEGS_CAP;
  return Math.min(limit, n);
}

/** Every authored contour vertex, as a polar angle. No simplification. */
export function vertexLoftAngles(stations) {
  const raw = [];
  for (const s of stations || []) {
    const contour = s && s.contour;
    if (!Array.isArray(contour)) continue;
    for (const p of contour) {
      if (p && Math.hypot(p[0], p[1]) > 1e-8) raw.push(angleOf(p[0], p[1]));
    }
  }
  const angles = dedupeAngles(raw);
  if (angles.length < 3) {
    throw new Error('makeLoft: could not build an angle table (profiles must contain the plane origin)');
  }
  return angles;
}
