/**
 * Least-squares cylinder fit for one face-graph patch.
 *
 * The axis direction is the normal direction the patch's triangle normals
 * span least (the smallest eigenvector of their covariance): on a cylinder
 * every normal is radial, so they all lie in the plane across the axis. The
 * centre and radius come from a Kåsa circle fit of the vertices projected
 * onto that plane, so a partial cylinder (a ring wall with tubes cut into
 * it, a bore cut by a slot) lands on the true axis. A vertex centroid does
 * not: it drifts toward whichever arc survived the cut.
 *
 * A flat patch (one normal) and a patch whose normals are not radial (a
 * sphere, a torus) return null, as does a fit whose radius spread exceeds
 * `radiusTol` of the mean.
 */

const MIN_TRIS = 4;
const MIN_POINTS = 6;
/** Normals must sit this close to the plane across the axis (mean |n·d|). */
const MAX_AXIAL_LEAN = 0.35;
/** The patch must turn at least this far around the axis to be a cylinder. */
const MIN_SPAN_DEG = 2;

function unit(v) {
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

/** Area-weighted triangle normal (length = 2 × area). */
function triangleAreaNormal(positions, indices, t) {
  const i0 = indices[t * 3] * 3;
  const i1 = indices[t * 3 + 1] * 3;
  const i2 = indices[t * 3 + 2] * 3;
  const ax = positions[i1] - positions[i0];
  const ay = positions[i1 + 1] - positions[i0 + 1];
  const az = positions[i1 + 2] - positions[i0 + 2];
  const bx = positions[i2] - positions[i0];
  const by = positions[i2 + 1] - positions[i0 + 1];
  const bz = positions[i2 + 2] - positions[i0 + 2];
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/**
 * Eigenvectors of a symmetric 3×3 matrix by cyclic Jacobi rotations.
 * @returns {{ values: number[], vectors: number[][] }} ascending by value
 */
function symmetricEigen(m) {
  const a = m.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (let p = 0; p < 2; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]),
  };
}

/** Solve a 3×3 linear system by Gaussian elimination; null when singular. */
function solve3(m, b) {
  const a = m.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    for (let r = 0; r < 3; r += 1) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let k = col; k < 4; k += 1) a[r][k] -= f * a[col][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * @param {ArrayLike<number>} positions xyz triples
 * @param {ArrayLike<number>} indices triangle vertex indices
 * @param {number[]} tris triangle indices of the patch
 * @param {{ radiusTol?: number }} [opts] rms radius spread allowed, as a fraction of the radius
 * @returns {{ at: number[], dir: number[], radius: number } | null}
 */
export function fitCylinderPatch(positions, indices, tris, { radiusTol = 0.25 } = {}) {
  if (!positions || !indices || !tris || tris.length < MIN_TRIS) return null;
  // Normal covariance, weighted by triangle area.
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const normals = [];
  let weight = 0;
  for (let i = 0; i < tris.length; i += 1) {
    const an = triangleAreaNormal(positions, indices, tris[i]);
    const w = Math.hypot(an[0], an[1], an[2]);
    if (!(w > 1e-12)) continue;
    const n = [an[0] / w, an[1] / w, an[2] / w];
    normals.push({ n, w });
    weight += w;
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) cov[r][c] += w * n[r] * n[c];
    }
  }
  if (normals.length < MIN_TRIS || !(weight > 0)) return null;
  const eig = symmetricEigen(cov);
  const dir = unit(eig.vectors[0]);
  if (!dir) return null;
  // Normals must lie across the axis, and must actually turn around it:
  // a flat face has one normal (no spread), a sphere leans along every axis.
  let lean = 0;
  for (const { n, w } of normals) lean += Math.abs(dot(n, dir)) * w;
  if (lean / weight > MAX_AXIAL_LEAN) return null;
  const u = unit(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  if (!u) return null;
  const v = cross(dir, u);
  let minCos = 1;
  const n0 = normals[0].n;
  for (const { n } of normals) minCos = Math.min(minCos, dot(n, n0));
  if (Math.acos(Math.max(-1, Math.min(1, minCos))) * (180 / Math.PI) < MIN_SPAN_DEG) return null;
  // Unique vertices, projected onto the (u, v) plane across the axis.
  const seen = new Set();
  const pts = [];
  let alongSum = 0;
  for (let i = 0; i < tris.length; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const vi = indices[tris[i] * 3 + k];
      if (seen.has(vi)) continue;
      seen.add(vi);
      const p = [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];
      pts.push([dot(p, u), dot(p, v)]);
      alongSum += dot(p, dir);
    }
  }
  if (pts.length < MIN_POINTS) return null;
  // Kåsa fit: x² + y² + a·x + b·y + c = 0, linear least squares in (a, b, c).
  // Centre the data first so large coordinates do not swamp the normal equations.
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const [px, py] of pts) {
    const x = px - mx;
    const y = py - my;
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = pts.length;
  const sol = solve3(
    [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [a, b, c] = sol;
  const cx = -a / 2;
  const cy = -b / 2;
  const r2 = cx * cx + cy * cy - c;
  if (!(r2 > 1e-12)) return null;
  const radius = Math.sqrt(r2);
  let spread = 0;
  for (const [px, py] of pts) {
    const d = Math.hypot(px - mx - cx, py - my - cy) - radius;
    spread += d * d;
  }
  spread = Math.sqrt(spread / n);
  if (spread > radiusTol * radius) return null;
  const centerU = cx + mx;
  const centerV = cy + my;
  const along = alongSum / n;
  const at = [
    u[0] * centerU + v[0] * centerV + dir[0] * along,
    u[1] * centerU + v[1] * centerV + dir[1] * along,
    u[2] * centerU + v[2] * centerV + dir[2] * along,
  ];
  return { at, dir, radius };
}
