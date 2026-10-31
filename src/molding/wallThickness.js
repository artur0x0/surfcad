/**
 * Local wall thickness for an injection-molded part (M1.2).
 *
 * The mesh is the same one M1.1 scores (`analyzePullDirection` in
 * `src/molding/pullDirection.js`). Each triangle already carries the normal
 * that scorer picked: the stamped face normal from `stampedFaceTable`
 * (`src/utils/faceIdentity.js`) when the stamp did not cancel, otherwise the
 * triangle normal.
 *
 * Thickness at a triangle is the nearest hit of a ray from its centroid along
 * −normal (into the material). The hit must be the back of another triangle
 * (n · ray > 0), so the ray is crossing a wall rather than leaving through a
 * front face. Triangles that share a vertex with the source are skipped, which
 * drops the source face and its welded neighbors. A miss is unknown: it is not
 * a sample and it is not thin.
 *
 * Nominal is the mode of an interior band when one thickness dominates, and
 * the band's area-weighted median otherwise. The band drops the thinnest and
 * thickest 10% of sample area, so a small boss or rib does not move nominal.
 * Thin is below thinRatio × nominal (default 0.6). Thick is above thickRatio
 * × nominal (default 1.5). Regions are triangles of one flag that share a
 * vertex. The two sides of a wall do not share vertices, so they are two
 * regions.
 *
 * Hits are found with a coarse grid and a 3D DDA. The grid is a broadphase
 * for the same ray test, not a second thickness definition.
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

function nearestHit(origin, dir, source, grid) {
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
  const skip = new Set([source.ia, source.ib, source.ic]);
  const seen = new Set();
  let best = Infinity;
  const maxSteps = cells * 3 + 3;
  for (let step = 0; step < maxSteps; step++) {
    const bucket = buckets[ix + cells * iy + span * iz];
    if (bucket) {
      for (const tri of bucket) {
        if (seen.has(tri.t)) continue;
        seen.add(tri.t);
        if (tri.t === source.t || skip.has(tri.ia) || skip.has(tri.ib) || skip.has(tri.ic)) continue;
        if (dot(tri.n, dir) <= BACKFACE_EPS) continue;
        const t = rayTriangle(origin, dir, tri);
        if (t == null || t <= MOLD_WALL_HIT_EPS_MM || t >= best) continue;
        best = t;
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
  return best < Infinity ? best : null;
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
 * from `tris` (those stay `unknown`).
 *
 * @param {Array<{ t: number, ia: number, ib: number, ic: number, a: number[], b: number[], c: number[], n: number[], area: number, centroid: number[] }>} tris
 * @param {number} nTri
 * @param {{ thinRatio: number, thickRatio: number }} options
 */
export function measureWallThickness(tris, nTri, options) {
  const thinRatio = options.thinRatio;
  const thickRatio = options.thickRatio;
  const count = Math.max(0, Math.floor(nTri) || 0);
  if (!tris?.length) return emptyWall(count, thinRatio, thickRatio);
  const grid = buildGrid(tris);
  const samples = [];
  const byIndex = new Map();
  for (const tri of tris) {
    const dir = [-tri.n[0], -tri.n[1], -tri.n[2]];
    const hit = nearestHit(tri.centroid, dir, tri, grid);
    if (hit == null) continue;
    const thickness = round(hit);
    if (!(thickness > 0)) continue;
    const sample = {
      t: tri.t,
      ia: tri.ia,
      ib: tri.ib,
      ic: tri.ic,
      area: tri.area,
      thickness,
    };
    samples.push(sample);
    byIndex.set(tri.t, sample);
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
      field.push({ index, thickness: sample ? sample.thickness : null, flag: 'unknown' });
      continue;
    }
    let flag = 'nominal';
    if (sample.thickness < thinCut) flag = 'thin';
    else if (sample.thickness > thickCut) flag = 'thick';
    field.push({ index, thickness: sample.thickness, flag });
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
