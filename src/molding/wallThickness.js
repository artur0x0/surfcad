/**
 * Local wall thickness for an injection-molded part.
 *
 * The mesh is the same one the pull scorer prepares (`analyzePullDirection`
 * in `src/molding/pullDirection.js`). Each triangle carries a geometric
 * normal from its cross product and, when the stamp did not cancel, the
 * stamped face normal from `stampedFaceTable` (`src/utils/faceIdentity.js`).
 * The probe follows the geometric normal. The stamp only flips that side
 * when the two point opposite ways.
 *
 * Two fields share each sample. The ray leaves an inset origin along the
 * triangle's own normal (the cross product; a stamp only flips that side
 * when it points the other way). A curved face's single stamp is not the
 * probe direction. The ray stops at the first back face (n · ray > 0) that
 * does not share an edge with the source. It is unstable when that hit is
 * grazing (|n_hit · ray| < 0.5). The sphere is an Inui shrinking ball: its
 * center stays on the same ray, it starts at half the ray hit (or the mesh
 * diagonal when the ray misses), and it shrinks against the closest BVH
 * contact for at most five iterations. Contacts omit the source triangle and
 * edge neighbors whose normals stay within 60° of the source. Any other
 * contact whose normal still faces with the source is the same smooth
 * surface and is ignored too, so a facet two rings along a fillet cannot
 * collapse the ball. Perpendicular skins stay in the query, which is what
 * bounds a rim, a plate edge, and a hole wall.
 *
 * The ray is kept only when it is stable and within 15% of the sphere
 * diameter. Otherwise the diameter is the thickness. A sample with no sphere
 * is unknown: it is not painted thick from the ray. Fillets and junctions
 * are not dropped; a larger sphere paints thick.
 *
 * One triangle is one skin color. If any probe on it has a stable ray, the
 * color is the smallest of those rays: a corner sample that misses the near
 * skin and agrees with a far wall does not replace the real wall. If every
 * probe is unstable (a rim, a plate edge, a hole wall, a fillet the ray
 * cannot trust), the color is the largest sphere, so the edge halo does not
 * average the rim down to half the wall. Nominal is the mode of those
 * triangle values on an
 * interior band, or the band median. The band
 * drops the thinnest and thickest 10% of triangle area. Thin is below
 * thinRatio × nominal (default 0.6). Thick is above thickRatio × nominal
 * (default 1.5). Regions are triangles of one flag that share a vertex.
 *
 * Spacing is min(0.5 × nominal, 0.8 mm), raised so the probe count stays
 * under 80k. A centroid pass estimates nominal before that spacing. The ray
 * grid is a broadphase for the ray, not a second thickness definition.
 */

export const MOLD_WALL_THIN_RATIO = 0.6;
export const MOLD_WALL_THICK_RATIO = 1.5;
/** Fraction of sample area dropped from each end before the nominal is taken. */
export const MOLD_WALL_TAIL_FRACTION = 0.1;
/** Winning histogram bin must hold at least this share of the band to be the mode. */
export const MOLD_WALL_MODE_FRACTION = 0.35;
export const MOLD_WALL_BIN_MM = 0.1;
/** Bin width is at least this fraction of the band median. */
export const MOLD_WALL_BIN_FRACTION = 0.05;
export const MOLD_WALL_GRID_CELLS = 16;
/** Hits closer than this are the source surface, not a wall. */
export const MOLD_WALL_HIT_EPS_MM = 1e-4;
/** |n_hit · ray| below this is a grazing ray and is not used. */
export const MOLD_WALL_GRAZE_COS = 0.5;
/** A stable ray within this fraction of the sphere diameter is kept. */
export const MOLD_WALL_AGREE_FRACTION = 0.15;
/** Edge neighbors at least this aligned are the same surface (fillet tessellation). */
export const MOLD_WALL_TANGENT_COS = 0.5;
/** Probe spacing is at most this, and at most half the coarse nominal. */
export const MOLD_WALL_SPACING_MM = 0.8;
export const MOLD_WALL_SPACING_FACTOR = 0.5;
/** Raised spacing keeps the refined probe count at or under this. */
export const MOLD_WALL_MAX_SAMPLES = 80000;
export const MOLD_WALL_SPHERE_ITERS = 5;
const MOLD_WALL_MIN_SPACING_MM = 0.05;
const MOLD_WALL_MAX_STEPS = 48;

const BARY_EPS = 1e-8;
const DET_EPS = 1e-12;
const BACKFACE_EPS = 1e-8;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function round(n, places = 6) {
  const f = 10 ** places;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
}

/**
 * @param {object|null|undefined} wall
 * @returns {{ thinRatio: number, thickRatio: number }|{ error: { code: string, message: string } }}
 */
export function resolveWallOptions(wall) {
  if (wall == null) {
    return { thinRatio: MOLD_WALL_THIN_RATIO, thickRatio: MOLD_WALL_THICK_RATIO };
  }
  if (typeof wall !== 'object' || Array.isArray(wall)) {
    return { error: { code: 'bad_args', message: 'wall thresholds must be { thinRatio, thickRatio }' } };
  }
  const thinRatio = wall.thinRatio == null ? MOLD_WALL_THIN_RATIO : Number(wall.thinRatio);
  const thickRatio = wall.thickRatio == null ? MOLD_WALL_THICK_RATIO : Number(wall.thickRatio);
  if (!(thinRatio > 0) || !Number.isFinite(thinRatio) || !(thickRatio > thinRatio) || !Number.isFinite(thickRatio)) {
    return {
      error: { code: 'bad_args', message: 'wall thinRatio must be positive and less than thickRatio' },
    };
  }
  return { thinRatio, thickRatio };
}

function areaMedian(sorted, total) {
  const half = total * 0.5;
  let acc = 0;
  for (const sample of sorted) {
    acc += sample.area;
    if (acc >= half - 1e-9) return sample.thickness;
  }
  return sorted[sorted.length - 1].thickness;
}

function areaMean(samples) {
  let area = 0;
  let acc = 0;
  for (const sample of samples) {
    area += sample.area;
    acc += sample.area * sample.thickness;
  }
  return area > 0 ? acc / area : null;
}

function interiorBand(sorted, total) {
  const cap = MOLD_WALL_TAIL_FRACTION * total;
  let lo = 0;
  let hi = sorted.length - 1;
  let dropLo = 0;
  let dropHi = 0;
  while (lo < hi && dropLo + sorted[lo].area <= cap + 1e-9) {
    dropLo += sorted[lo].area;
    lo += 1;
  }
  while (hi > lo && dropHi + sorted[hi].area <= cap + 1e-9) {
    dropHi += sorted[hi].area;
    hi -= 1;
  }
  return sorted.slice(lo, hi + 1);
}

/**
 * Nominal wall from area-weighted samples `{ thickness, area }`.
 * Empty input returns nulls. The mode is the area-weighted mean of the
 * winning bin; a tie goes to the thinner bin.
 *
 * @param {Array<{ thickness: number, area: number }>} samples
 */
export function nominalWallFromSamples(samples) {
  const empty = {
    nominal: null,
    nominalMethod: null,
    min: null,
    max: null,
    mean: null,
    median: null,
    binWidth: null,
  };
  if (!samples?.length) return empty;
  const sorted = samples.slice().sort((a, b) => a.thickness - b.thickness);
  let total = 0;
  for (const sample of sorted) total += sample.area;
  if (!(total > 0)) return empty;
  const min = sorted[0].thickness;
  const max = sorted[sorted.length - 1].thickness;
  const mean = areaMean(sorted);
  const median = areaMedian(sorted, total);
  const band = interiorBand(sorted, total);
  let bandArea = 0;
  for (const sample of band) bandArea += sample.area;
  const bandMedian = areaMedian(band, bandArea);
  const binWidth = Math.max(MOLD_WALL_BIN_MM, MOLD_WALL_BIN_FRACTION * Math.abs(bandMedian));
  const bins = new Map();
  for (const sample of band) {
    const key = Math.round(sample.thickness / binWidth);
    let bin = bins.get(key);
    if (!bin) {
      bin = { area: 0, samples: [] };
      bins.set(key, bin);
    }
    bin.area += sample.area;
    bin.samples.push(sample);
  }
  let bestKey = null;
  let bestArea = -1;
  for (const [key, bin] of bins) {
    const betterArea = bin.area > bestArea + 1e-9;
    const tieThinner = Math.abs(bin.area - bestArea) <= 1e-9 && (bestKey == null || key < bestKey);
    if (betterArea || tieThinner) {
      bestArea = bin.area;
      bestKey = key;
    }
  }
  const best = bins.get(bestKey);
  const mode = bestArea >= MOLD_WALL_MODE_FRACTION * bandArea - 1e-9;
  const nominal = mode ? areaMean(best.samples) : bandMedian;
  return {
    nominal: round(nominal),
    nominalMethod: mode ? 'mode' : 'median',
    min: round(min),
    max: round(max),
    mean: round(mean),
    median: round(median),
    binWidth: round(binWidth),
  };
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

function buildAdjacency(tris) {
  const edges = new Map();
  for (const tri of tris) {
    const pairs = [[tri.ia, tri.ib], [tri.ib, tri.ic], [tri.ic, tri.ia]];
    for (const [i, j] of pairs) {
      const key = edgeKey(i, j);
      let list = edges.get(key);
      if (!list) {
        list = [];
        edges.set(key, list);
      }
      list.push(tri.t);
    }
  }
  const neighbors = new Map();
  for (const tri of tris) neighbors.set(tri.t, []);
  for (const list of edges.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i !== j) neighbors.get(list[i]).push(list[j]);
      }
    }
  }
  const byIndex = new Map();
  for (const tri of tris) byIndex.set(tri.t, tri);
  const raySkip = new Map();
  const sphereSkip = new Map();
  for (const tri of tris) {
    const ray = new Set([tri.t]);
    const sphere = new Set([tri.t]);
    for (const otherIndex of neighbors.get(tri.t)) {
      ray.add(otherIndex);
      const other = byIndex.get(otherIndex);
      if (other && Math.abs(dot(tri.n, other.n)) >= MOLD_WALL_TANGENT_COS) sphere.add(otherIndex);
    }
    raySkip.set(tri.t, ray);
    sphereSkip.set(tri.t, sphere);
  }
  return { raySkip, sphereSkip };
}

function rayTriangle(origin, dir, tri) {
  const e1 = sub(tri.b, tri.a);
  const e2 = sub(tri.c, tri.a);
  const p = cross(dir, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < DET_EPS) return null;
  const inv = 1 / det;
  const s = sub(origin, tri.a);
  const u = dot(s, p) * inv;
  if (u < -BARY_EPS || u > 1 + BARY_EPS) return null;
  const q = cross(s, e1);
  const v = dot(dir, q) * inv;
  if (v < -BARY_EPS || u + v > 1 + BARY_EPS) return null;
  const t = dot(e2, q) * inv;
  if (!Number.isFinite(t)) return null;
  return t;
}

function buildGrid(tris) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) {
    for (const p of [tri.a, tri.b, tri.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const pad = Math.max(MOLD_WALL_HIT_EPS_MM, diag * 1e-6);
  min = [min[0] - pad, min[1] - pad, min[2] - pad];
  max = [max[0] + pad, max[1] + pad, max[2] + pad];
  const cells = MOLD_WALL_GRID_CELLS;
  const size = [0, 1, 2].map((k) => Math.max((max[k] - min[k]) / cells, 1e-9));
  const buckets = new Array(cells * cells * cells);
  const span = cells * cells;
  for (const tri of tris) {
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let a = tri.a[k];
      let b = tri.b[k];
      let c = tri.c[k];
      if (b < a) a = b;
      if (c < a) a = c;
      b = tri.a[k];
      if (tri.b[k] > b) b = tri.b[k];
      if (tri.c[k] > b) b = tri.c[k];
      lo[k] = Math.max(0, Math.min(cells - 1, Math.floor((a - min[k]) / size[k])));
      hi[k] = Math.max(0, Math.min(cells - 1, Math.floor((b - min[k]) / size[k])));
    }
    for (let iz = lo[2]; iz <= hi[2]; iz++) {
      for (let iy = lo[1]; iy <= hi[1]; iy++) {
        for (let ix = lo[0]; ix <= hi[0]; ix++) {
          const key = ix + cells * iy + span * iz;
          let bucket = buckets[key];
          if (!bucket) {
            bucket = [];
            buckets[key] = bucket;
          }
          bucket.push(tri);
        }
      }
    }
  }
  return { min, size, cells, span, buckets, diag };
}

function cellIndex(grid, p, axis) {
  const i = Math.floor((p[axis] - grid.min[axis]) / grid.size[axis]);
  if (i < 0) return 0;
  if (i >= grid.cells) return grid.cells - 1;
  return i;
}

function nearestHit(origin, dir, grid, skip, seen, stamp) {
  const { cells, size, min, buckets, span } = grid;
  let ix = cellIndex(grid, origin, 0);
  let iy = cellIndex(grid, origin, 1);
  let iz = cellIndex(grid, origin, 2);
  const axes = [0, 1, 2].map((axis) => {
    const component = dir[axis];
    if (Math.abs(component) < 1e-15) return { step: 0, tMax: Infinity, tDelta: Infinity };
    const step = component > 0 ? 1 : -1;
    const index = cellIndex(grid, origin, axis);
    const boundary = min[axis] + (step > 0 ? (index + 1) * size[axis] : index * size[axis]);
    let tMax = (boundary - origin[axis]) / component;
    if (!(tMax > 0)) tMax = 0;
    return { step, tMax, tDelta: Math.abs(size[axis] / component) };
  });
  let best = Infinity;
  let bestN = null;
  const maxSteps = cells * 3 + 3;
  for (let step = 0; step < maxSteps; step++) {
    const bucket = buckets[ix + cells * iy + span * iz];
    if (bucket) {
      for (const tri of bucket) {
        if (seen[tri.t] === stamp) continue;
        seen[tri.t] = stamp;
        if (skip.has(tri.t)) continue;
        const nd = dot(tri.n, dir);
        if (nd <= BACKFACE_EPS) continue;
        const t = rayTriangle(origin, dir, tri);
        if (t == null || t <= MOLD_WALL_HIT_EPS_MM || t >= best) continue;
        best = t;
        bestN = nd;
      }
    }
    const tx = axes[0].tMax;
    const ty = axes[1].tMax;
    const tz = axes[2].tMax;
    const tNext = tx < ty ? (tx < tz ? tx : tz) : (ty < tz ? ty : tz);
    if (!(tNext < best) || tNext > grid.diag) break;
    if (tx <= ty && tx <= tz) {
      ix += axes[0].step;
      if (ix < 0 || ix >= cells) break;
      axes[0].tMax += axes[0].tDelta;
    } else if (ty <= tz) {
      iy += axes[1].step;
      if (iy < 0 || iy >= cells) break;
      axes[1].tMax += axes[1].tDelta;
    } else {
      iz += axes[2].step;
      if (iz < 0 || iz >= cells) break;
      axes[2].tMax += axes[2].tDelta;
    }
  }
  return best < Infinity ? { dist: best, nd: bestN } : null;
}

function boundsOf(list) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of list) {
    for (const p of [tri.a, tri.b, tri.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  return { min, max };
}

function buildBvh(tris) {
  function build(list) {
    const box = boundsOf(list);
    const node = { min: box.min, max: box.max, tris: null, left: null, right: null };
    if (list.length <= 6) {
      node.tris = list;
      return node;
    }
    let axis = 0;
    let extent = box.max[0] - box.min[0];
    for (let k = 1; k < 3; k++) {
      const span = box.max[k] - box.min[k];
      if (span > extent) {
        extent = span;
        axis = k;
      }
    }
    const ordered = list.slice().sort((p, q) => p.centroid[axis] - q.centroid[axis]);
    const mid = Math.floor(ordered.length / 2);
    const left = ordered.slice(0, mid);
    const right = ordered.slice(mid);
    if (!left.length || !right.length) {
      node.tris = list;
      return node;
    }
    node.left = build(left);
    node.right = build(right);
    return node;
  }
  return build(tris);
}

function boxDist2(min, max, p) {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const v = p[k] < min[k] ? min[k] - p[k] : (p[k] > max[k] ? p[k] - max[k] : 0);
    sum += v * v;
  }
  return sum;
}

function boxMaxAlong(min, max, origin, dir) {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const v = dir[k] >= 0 ? max[k] : min[k];
    sum += (v - origin[k]) * dir[k];
  }
  return sum;
}

function closestOnTriangle(p, a, b, c, out) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return;
  }
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    out[0] = b[0];
    out[1] = b[1];
    out[2] = b[2];
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = a[0] + ab[0] * v;
    out[1] = a[1] + ab[1] * v;
    out[2] = a[2] + ab[2] * v;
    return;
  }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = a[0] + ac[0] * w;
    out[1] = a[1] + ac[1] * w;
    out[2] = a[2] + ac[2] * w;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = b[0] + (c[0] - b[0]) * w;
    out[1] = b[1] + (c[1] - b[1]) * w;
    out[2] = b[2] + (c[2] - b[2]) * w;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = a[0] + ab[0] * v + ac[0] * w;
  out[1] = a[1] + ab[1] * v + ac[1] * w;
  out[2] = a[2] + ab[2] * v + ac[2] * w;
}

function sameSurface(tri, srcN) {
  if (!srcN) return false;
  return dot(tri.n, srcN) >= MOLD_WALL_TANGENT_COS;
}

function closestContact(node, center, excluded, origin, dir, srcN, best, scratch) {
  if (!node) return;
  if (boxMaxAlong(node.min, node.max, origin, dir) <= 1e-6) return;
  if (boxDist2(node.min, node.max, center) >= best.d2) return;
  if (node.tris) {
    for (const tri of node.tris) {
      if (excluded.has(tri.t) || sameSurface(tri, srcN)) continue;
      closestOnTriangle(center, tri.a, tri.b, tri.c, scratch);
      const along = (scratch[0] - origin[0]) * dir[0]
        + (scratch[1] - origin[1]) * dir[1]
        + (scratch[2] - origin[2]) * dir[2];
      if (!(along > 1e-6)) continue;
      const dx = scratch[0] - center[0];
      const dy = scratch[1] - center[1];
      const dz = scratch[2] - center[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best.d2) {
        best.d2 = d2;
        best.q[0] = scratch[0];
        best.q[1] = scratch[1];
        best.q[2] = scratch[2];
        best.hit = true;
      }
    }
    return;
  }
  const leftD = node.left ? boxDist2(node.left.min, node.left.max, center) : Infinity;
  const rightD = node.right ? boxDist2(node.right.min, node.right.max, center) : Infinity;
  if (leftD < rightD) {
    closestContact(node.left, center, excluded, origin, dir, srcN, best, scratch);
    closestContact(node.right, center, excluded, origin, dir, srcN, best, scratch);
  } else {
    closestContact(node.right, center, excluded, origin, dir, srcN, best, scratch);
    closestContact(node.left, center, excluded, origin, dir, srcN, best, scratch);
  }
}

function probeRay(tri, point, dir, grid, skip, seen, stamp) {
  const inset = Math.max(MOLD_WALL_HIT_EPS_MM, grid.diag * 1e-6);
  const origin = [
    point[0] + dir[0] * inset,
    point[1] + dir[1] * inset,
    point[2] + dir[2] * inset,
  ];
  const hit = nearestHit(origin, dir, grid, skip, seen, stamp);
  if (!hit) return null;
  return { dist: hit.dist + inset, nd: hit.nd };
}

function probeSphere(point, dir, ray, diag, bvh, excluded, srcN) {
  const fromRay = !!(ray && ray.dist > 0);
  let radius = fromRay ? ray.dist * 0.5 : Math.max(diag * 0.5, 1);
  if (!(radius > 0)) return null;
  let bounded = fromRay;
  const best = { d2: Infinity, q: [0, 0, 0], hit: false };
  const scratch = [0, 0, 0];
  for (let iter = 0; iter < MOLD_WALL_SPHERE_ITERS; iter++) {
    const center = [
      point[0] + radius * dir[0],
      point[1] + radius * dir[1],
      point[2] + radius * dir[2],
    ];
    best.d2 = Infinity;
    best.hit = false;
    closestContact(bvh, center, excluded, point, dir, srcN, best, scratch);
    if (!best.hit) break;
    const dx = best.q[0] - center[0];
    const dy = best.q[1] - center[1];
    const dz = best.q[2] - center[2];
    const gap = Math.hypot(dx, dy, dz);
    if (gap >= radius - 1e-4) break;
    const vx = best.q[0] - point[0];
    const vy = best.q[1] - point[1];
    const vz = best.q[2] - point[2];
    const along = vx * dir[0] + vy * dir[1] + vz * dir[2];
    if (!(along > 1e-6)) break;
    const next = (vx * vx + vy * vy + vz * vz) / (2 * along);
    if (!(next > 1e-4)) return null;
    if (next >= radius - 1e-6) break;
    radius = next;
    bounded = true;
  }
  if (!bounded || !(radius > 1e-4)) return null;
  return radius * 2;
}

function combineProbe(ray, diameter) {
  if (!(diameter > 0)) return { thickness: null, source: 'unknown' };
  const stable = !!(ray && ray.nd >= MOLD_WALL_GRAZE_COS);
  const agree = !!(ray && Math.abs(ray.dist - diameter) <= MOLD_WALL_AGREE_FRACTION * diameter);
  if (stable && agree) return { thickness: ray.dist, source: 'ray' };
  return { thickness: diameter, source: 'sphere' };
}

function estimateProbes(tris, spacing) {
  let count = 0;
  for (const tri of tris) {
    if (!(tri.longest > spacing)) count += 1;
    else {
      const steps = Math.min(MOLD_WALL_MAX_STEPS, Math.ceil(tri.longest / spacing));
      count += ((steps + 1) * (steps + 2)) / 2;
    }
  }
  return count;
}

function spacingFor(tris, nominal) {
  let spacing = !(nominal > 0)
    ? MOLD_WALL_SPACING_MM
    : Math.min(MOLD_WALL_SPACING_FACTOR * nominal, MOLD_WALL_SPACING_MM);
  if (!(spacing >= MOLD_WALL_MIN_SPACING_MM)) spacing = MOLD_WALL_MIN_SPACING_MM;
  for (let guard = 0; guard < 16; guard++) {
    const estimated = estimateProbes(tris, spacing);
    if (estimated <= MOLD_WALL_MAX_SAMPLES) break;
    spacing *= Math.max(1.05, Math.sqrt(estimated / MOLD_WALL_MAX_SAMPLES));
  }
  return spacing;
}

function samplePoints(tri, spacing) {
  if (!(tri.longest > spacing)) return [tri.centroid];
  const steps = Math.min(MOLD_WALL_MAX_STEPS, Math.max(1, Math.ceil(tri.longest / spacing)));
  const pts = [];
  const shrink = 0.9;
  const bias = (1 - shrink) / 3;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps - i; j++) {
      const uu = (i / steps) * shrink + bias;
      const vv = (j / steps) * shrink + bias;
      const ww = 1 - uu - vv;
      pts.push([
        uu * tri.a[0] + vv * tri.b[0] + ww * tri.c[0],
        uu * tri.a[1] + vv * tri.b[1] + ww * tri.c[1],
        uu * tri.a[2] + vv * tri.b[2] + ww * tri.c[2],
      ]);
    }
  }
  return pts;
}

function clusterRegions(members) {
  if (!members.length) return [];
  const parent = new Map();
  const find = (x) => {
    let p = parent.get(x);
    if (p == null) {
      parent.set(x, x);
      return x;
    }
    while (parent.get(p) !== p) p = parent.get(p);
    let c = x;
    while (c !== p) {
      const next = parent.get(c);
      parent.set(c, p);
      c = next;
    }
    return p;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  const at = new Map();
  for (const member of members) {
    find(member.t);
    for (const v of [member.ia, member.ib, member.ic]) {
      const other = at.get(v);
      if (other == null) at.set(v, member.t);
      else union(member.t, other);
    }
  }
  const groups = new Map();
  for (const member of members) {
    const root = find(member.t);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(member);
  }
  const regions = [];
  for (const group of groups.values()) {
    let area = 0;
    let acc = 0;
    let sort = Infinity;
    for (const member of group) {
      area += member.area;
      acc += member.area * member.thickness;
      if (member.t < sort) sort = member.t;
    }
    regions.push({
      sort,
      area: round(area),
      triangleCount: group.length,
      thickness: round(acc / area),
    });
  }
  regions.sort((a, b) => a.sort - b.sort || a.thickness - b.thickness);
  return regions.map((region, id) => ({
    id,
    area: region.area,
    triangleCount: region.triangleCount,
    thickness: region.thickness,
  }));
}

function emptyWall(nTri, thinRatio, thickRatio) {
  const field = [];
  for (let index = 0; index < nTri; index++) {
    field.push({ index, thickness: null, flag: 'unknown' });
  }
  return {
    nominal: null,
    nominalMethod: null,
    min: null,
    max: null,
    mean: null,
    median: null,
    sampleCount: 0,
    thinCount: 0,
    thickCount: 0,
    thinArea: 0,
    thickArea: 0,
    thresholds: wallThresholds(thinRatio, thickRatio),
    appliedBinWidth: null,
    thin: [],
    thick: [],
    field,
  };
}

function wallThresholds(thinRatio, thickRatio) {
  return {
    thinRatio,
    thickRatio,
    tailFraction: MOLD_WALL_TAIL_FRACTION,
    modeFraction: MOLD_WALL_MODE_FRACTION,
    binMm: MOLD_WALL_BIN_MM,
    binFraction: MOLD_WALL_BIN_FRACTION,
  };
}

/**
 * Local thickness field for triangles prepared by `analyzePullDirection`.
 * `nTri` is the mesh triangle count, including degenerates that were dropped
 * from `tris` (those stay `unknown`). `pass: 'centroid'` is the coarse field.
 * `nominalHint` skips that coarse pass when the caller already has one.
 *
 * @param {Array<{ t: number, ia: number, ib: number, ic: number, a: number[], b: number[], c: number[], n: number[], area: number, centroid: number[] }>} tris
 * @param {number} nTri
 * @param {{ thinRatio: number, thickRatio: number, pass?: 'centroid'|'refine', nominalHint?: number|null }} options
 */
export function measureWallThickness(tris, nTri, options) {
  const thinRatio = options.thinRatio;
  const thickRatio = options.thickRatio;
  const count = Math.max(0, Math.floor(nTri) || 0);
  if (!tris?.length) return emptyWall(count, thinRatio, thickRatio);
  let maxIndex = count;
  for (const tri of tris) {
    if (tri.t + 1 > maxIndex) maxIndex = tri.t + 1;
    tri.longest = Math.max(dist(tri.a, tri.b), dist(tri.b, tri.c), dist(tri.c, tri.a));
  }
  const { raySkip, sphereSkip } = buildAdjacency(tris);
  const grid = buildGrid(tris);
  const bvh = buildBvh(tris);
  const seen = new Uint32Array(maxIndex);
  let stamp = 1;
  const probe = (tri, point) => {
    stamp += 1;
    if (stamp >= 0xfffffffe) {
      seen.fill(0);
      stamp = 1;
    }
    // The triangle's own normal. A curved face keeps one stamp for every
    // facet, and that vector does not pass through the wall.
    const n = tri.nGeom || tri.n;
    const side = tri.n && n && dot(tri.n, n) < 0 ? -1 : 1;
    const dir = [-n[0] * side, -n[1] * side, -n[2] * side];
    const srcN = [n[0] * side, n[1] * side, n[2] * side];
    const ray = probeRay(tri, point, dir, grid, raySkip.get(tri.t), seen, stamp);
    const diameter = probeSphere(point, dir, ray, grid.diag, bvh, sphereSkip.get(tri.t), srcN);
    return combineProbe(ray, diameter);
  };
  const collect = (spacing) => {
    const best = new Map();
    for (const tri of tris) {
      let stable = null;
      let sphere = null;
      for (const point of samplePoints(tri, spacing)) {
        const reading = probe(tri, point);
        if (!(reading.thickness > 0)) continue;
        if (reading.source === 'ray') {
          if (!stable || reading.thickness < stable.thickness) stable = reading;
        } else if (reading.source === 'sphere') {
          if (!sphere || reading.thickness > sphere.thickness) sphere = reading;
        }
      }
      const chosen = stable || sphere;
      if (!chosen) continue;
      best.set(tri.t, {
        t: tri.t,
        ia: tri.ia,
        ib: tri.ib,
        ic: tri.ic,
        area: tri.area,
        thickness: chosen.thickness,
        source: chosen.source,
      });
    }
    return best;
  };
  const pass = options.pass === 'centroid' ? 'centroid' : 'refine';
  let spacing = Infinity;
  if (pass === 'refine') {
    let nominal = null;
    if (Object.prototype.hasOwnProperty.call(options, 'nominalHint')) {
      nominal = Number.isFinite(options.nominalHint) ? options.nominalHint : null;
    } else {
      nominal = nominalWallFromSamples([...collect(Infinity).values()]).nominal;
    }
    spacing = spacingFor(tris, nominal);
  }
  const byIndex = collect(spacing);
  const samples = [];
  for (const sample of byIndex.values()) {
    sample.thickness = round(sample.thickness);
    samples.push(sample);
  }
  const stats = nominalWallFromSamples(samples);
  const field = [];
  const thinMembers = [];
  const thickMembers = [];
  const nominal = stats.nominal;
  const thinCut = nominal == null ? Infinity : nominal * thinRatio;
  const thickCut = nominal == null ? -Infinity : nominal * thickRatio;
  for (let index = 0; index < count; index++) {
    const sample = byIndex.get(index);
    if (!sample || nominal == null) {
      field.push({
        index,
        thickness: sample ? sample.thickness : null,
        flag: 'unknown',
        source: sample ? sample.source : 'unknown',
      });
      continue;
    }
    let flag = 'nominal';
    if (sample.thickness < thinCut) flag = 'thin';
    else if (sample.thickness > thickCut) flag = 'thick';
    field.push({ index, thickness: sample.thickness, flag, source: sample.source });
    if (flag === 'thin') thinMembers.push(sample);
    else if (flag === 'thick') thickMembers.push(sample);
  }
  const thin = clusterRegions(thinMembers);
  const thick = clusterRegions(thickMembers);
  let thinArea = 0;
  let thickArea = 0;
  for (const region of thin) thinArea += region.area;
  for (const region of thick) thickArea += region.area;
  return {
    nominal: stats.nominal,
    nominalMethod: stats.nominalMethod,
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
    median: stats.median,
    sampleCount: samples.length,
    thinCount: thin.length,
    thickCount: thick.length,
    thinArea: round(thinArea),
    thickArea: round(thickArea),
    thresholds: wallThresholds(thinRatio, thickRatio),
    appliedBinWidth: stats.binWidth,
    thin,
    thick,
    field,
  };
}
