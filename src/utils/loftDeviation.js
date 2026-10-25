/**
 * Point-to-triangle distances between two manifold meshes.
 * Used to bound an adaptive loft against the dense reference mesh.
 */

function _sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function _dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function _add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function _scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}
function _dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Distance from point `p` to triangle `abc`. */
export function pointTriangleDistance(p, a, b, c) {
  const ab = _sub(b, a);
  const ac = _sub(c, a);
  const ap = _sub(p, a);
  const d1 = _dot(ab, ap);
  const d2 = _dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return _dist(p, a);
  const bp = _sub(p, b);
  const d3 = _dot(ab, bp);
  const d4 = _dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return _dist(p, b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return _dist(p, _add(a, _scale(ab, v)));
  }
  const cp = _sub(p, c);
  const d5 = _dot(ab, cp);
  const d6 = _dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return _dist(p, c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return _dist(p, _add(a, _scale(ac, w)));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return _dist(p, _add(b, _scale(_sub(c, b), w)));
  }
  const denom = va + vb + vc;
  const v = vb / denom;
  const w = vc / denom;
  return _dist(p, _add(a, _add(_scale(ab, v), _scale(ac, w))));
}

function _meshArrays(mesh) {
  const np = mesh.numProp || 3;
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const nTri = mesh.numTri || Math.floor(tv.length / 3);
  const vert = (i) => [vp[i * np], vp[i * np + 1], vp[i * np + 2]];
  return { np, vp, tv, nTri, vert };
}

function _percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/**
 * One-sided distances from `samples` (xyz triples) onto `mesh` triangles.
 * `cellMm` is the spatial hash. Points farther than a few cells search a
 * wider neighborhood.
 * @returns {{ n: number, max: number, p95: number }}
 */
export function pointsToMeshDeviation(samples, mesh, cellMm = 4) {
  const { tv, nTri, vert } = _meshArrays(mesh);
  const cell = Math.max(cellMm, 1e-3);
  const bins = new Map();
  const key = (ix, iy, iz) => `${ix},${iy},${iz}`;
  const triBox = new Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const a = vert(tv[t * 3]);
    const b = vert(tv[t * 3 + 1]);
    const c = vert(tv[t * 3 + 2]);
    const min = [
      Math.min(a[0], b[0], c[0]),
      Math.min(a[1], b[1], c[1]),
      Math.min(a[2], b[2], c[2]),
    ];
    const max = [
      Math.max(a[0], b[0], c[0]),
      Math.max(a[1], b[1], c[1]),
      Math.max(a[2], b[2], c[2]),
    ];
    triBox[t] = { a, b, c, min, max };
    const i0 = Math.floor(min[0] / cell);
    const j0 = Math.floor(min[1] / cell);
    const k0 = Math.floor(min[2] / cell);
    const i1 = Math.floor(max[0] / cell);
    const j1 = Math.floor(max[1] / cell);
    const k1 = Math.floor(max[2] / cell);
    for (let ix = i0; ix <= i1; ix++) {
      for (let iy = j0; iy <= j1; iy++) {
        for (let iz = k0; iz <= k1; iz++) {
          const k = key(ix, iy, iz);
          let list = bins.get(k);
          if (!list) {
            list = [];
            bins.set(k, list);
          }
          list.push(t);
        }
      }
    }
  }

  const dists = new Array(samples.length);
  for (let s = 0; s < samples.length; s++) {
    const p = samples[s];
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    const iz = Math.floor(p[2] / cell);
    let best = Infinity;
    const search = (rad) => {
      for (let dx = -rad; dx <= rad; dx++) {
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dz = -rad; dz <= rad; dz++) {
            const list = bins.get(key(ix + dx, iy + dy, iz + dz));
            if (!list) continue;
            for (const t of list) {
              const tri = triBox[t];
              const d = pointTriangleDistance(p, tri.a, tri.b, tri.c);
              if (d < best) best = d;
            }
          }
        }
      }
    };
    search(1);
    if (!(best <= cell)) search(3);
    dists[s] = best;
  }
  const sorted = dists.slice().sort((a, b) => a - b);
  return {
    n: sorted.length,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    p95: _percentile(sorted, 0.95),
  };
}

export function meshVertexSamples(mesh, stride = 1) {
  const { vp, np } = _meshArrays(mesh);
  const nVert = Math.floor(vp.length / np);
  const step = Math.max(1, stride | 0);
  const out = [];
  for (let i = 0; i < nVert; i += step) {
    out.push([vp[i * np], vp[i * np + 1], vp[i * np + 2]]);
  }
  return out;
}

/** Vertices, triangle centroids, and edge midpoints. The twist error sits on the edges. */
export function meshSurfaceSamples(mesh, stride = 1) {
  return meshVertexSamples(mesh, stride)
    .concat(meshCentroidSamples(mesh, stride))
    .concat(meshEdgeMidpointSamples(mesh, stride));
}

export function meshEdgeMidpointSamples(mesh, stride = 1) {
  const { tv, nTri, vert } = _meshArrays(mesh);
  const step = Math.max(1, stride | 0);
  const out = [];
  for (let t = 0; t < nTri; t += step) {
    const a = vert(tv[t * 3]);
    const b = vert(tv[t * 3 + 1]);
    const c = vert(tv[t * 3 + 2]);
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    out.push([(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2]);
    out.push([(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2]);
  }
  return out;
}

export function meshCentroidSamples(mesh, stride = 1) {
  const { tv, nTri, vert } = _meshArrays(mesh);
  const step = Math.max(1, stride | 0);
  const out = [];
  for (let t = 0; t < nTri; t += step) {
    const a = vert(tv[t * 3]);
    const b = vert(tv[t * 3 + 1]);
    const c = vert(tv[t * 3 + 2]);
    out.push([
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ]);
  }
  return out;
}
