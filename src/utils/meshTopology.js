/**
 * Shared triangle frames and edge adjacency for the face graph and the edge
 * graph. One pass, typed arrays, cached on the index buffer so the second
 * builder does not walk the mesh again.
 *
 * Edge pairs are in first-seen order: triangle index, then the three edges
 * of that triangle. That is the order the old Map insertion produced, which
 * feature-edge emission and boundary segment ids follow.
 */

const cache = new WeakMap();

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function mix2(lo, hi) {
  let x = Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA77);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * @param {ArrayLike<number>} positions tightly packed xyz, or stride-spaced
 * @param {ArrayLike<number>} indices
 * @param {number} [stride=3]
 */
export function meshFrames(positions, indices, stride = 3) {
  if (!positions || !indices || !indices.length) return null;
  const hit = cache.get(indices);
  if (hit && hit.positions === positions && hit.stride === stride) return hit;

  const numTri = Math.floor(indices.length / 3);
  const step = stride || 3;
  const nVert = Math.floor(positions.length / step);
  const nx = new Float64Array(numTri);
  const ny = new Float64Array(numTri);
  const nz = new Float64Array(numTri);
  // Boundary faces used `cross * (1 / len)` and (0,0,1) on a zero-area
  // triangle. Division (`cross / len`) differs by an ulp, so both are stored.
  const bnx = new Float64Array(numTri);
  const bny = new Float64Array(numTri);
  const bnz = new Float64Array(numTri);
  const area = new Float64Array(numTri);
  const cx = new Float64Array(numTri);
  const cy = new Float64Array(numTri);
  const cz = new Float64Array(numTri);

  for (let t = 0; t < numTri; t++) {
    const i0 = indices[t * 3] * step;
    const i1 = indices[t * 3 + 1] * step;
    const i2 = indices[t * 3 + 2] * step;
    const v0x = positions[i0];
    const v0y = positions[i0 + 1];
    const v0z = positions[i0 + 2];
    const e1x = positions[i1] - v0x;
    const e1y = positions[i1 + 1] - v0y;
    const e1z = positions[i1 + 2] - v0z;
    const e2x = positions[i2] - v0x;
    const e2y = positions[i2 + 1] - v0y;
    const e2z = positions[i2 + 2] - v0z;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    const crLen = Math.hypot(crx, cry, crz);
    const a = 0.5 * crLen;
    area[t] = a;
    const L = crLen || 1;
    nx[t] = crx / L;
    ny[t] = cry / L;
    nz[t] = crz / L;
    if (a > 1e-18) {
      const inv = 1 / (crLen || 1);
      bnx[t] = crx * inv;
      bny[t] = cry * inv;
      bnz[t] = crz * inv;
    } else {
      bnx[t] = 0;
      bny[t] = 0;
      bnz[t] = 1;
    }
    cx[t] = (v0x + positions[i1] + positions[i2]) / 3;
    cy[t] = (v0y + positions[i1 + 1] + positions[i2 + 1]) / 3;
    cz[t] = (v0z + positions[i1 + 2] + positions[i2 + 2]) / 3;
  }

  const nHalf = numTri * 3;
  const cap = nextPow2(Math.max(16, nHalf * 2));
  const mask = cap - 1;
  const occ = new Uint8Array(cap);
  const hLo = new Uint32Array(cap);
  const hHi = new Uint32Array(cap);
  const hTri0 = new Int32Array(cap);
  const hTri1 = new Int32Array(cap);
  const hCount = new Uint8Array(cap);
  const seen = new Uint32Array(nHalf);
  let nSeen = 0;

  for (let t = 0; t < numTri; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    const vs = [i0, i1, i1, i2, i2, i0];
    for (let k = 0; k < 6; k += 2) {
      let lo = vs[k];
      let hi = vs[k + 1];
      if (lo > hi) {
        const s = lo;
        lo = hi;
        hi = s;
      }
      let h = mix2(lo, hi) & mask;
      while (occ[h] && (hLo[h] !== lo || hHi[h] !== hi)) h = (h + 1) & mask;
      if (!occ[h]) {
        occ[h] = 1;
        hLo[h] = lo;
        hHi[h] = hi;
        hTri0[h] = t;
        hCount[h] = 1;
        seen[nSeen++] = h;
      } else if (hCount[h] === 1) {
        hTri1[h] = t;
        hCount[h] = 2;
      } else if (hCount[h] < 255) {
        hCount[h] = 3;
      }
    }
  }

  let pairN = 0;
  for (let i = 0; i < nSeen; i++) if (hCount[seen[i]] === 2) pairN++;
  const pairTri0 = new Uint32Array(pairN);
  const pairTri1 = new Uint32Array(pairN);
  const pairLo = new Uint32Array(pairN);
  const pairHi = new Uint32Array(pairN);
  let p = 0;
  for (let i = 0; i < nSeen; i++) {
    const h = seen[i];
    if (hCount[h] !== 2) continue;
    pairTri0[p] = hTri0[h];
    pairTri1[p] = hTri1[h];
    pairLo[p] = hLo[h];
    pairHi[p] = hHi[h];
    p++;
  }

  const parent = new Uint32Array(numTri);
  for (let i = 0; i < numTri; i++) parent[i] = i;
  const find = (a) => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    let x = a;
    while (parent[x] !== r) {
      const n = parent[x];
      parent[x] = r;
      x = n;
    }
    return r;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const vertTri = new Int32Array(nVert);
  vertTri.fill(-1);
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      const prev = vertTri[v];
      if (prev < 0) vertTri[v] = t;
      else unite(prev, t);
    }
  }
  const bodyOf = new Int32Array(numTri);
  const rootId = new Int32Array(numTri);
  rootId.fill(-1);
  let nBody = 0;
  for (let t = 0; t < numTri; t++) {
    const r = find(t);
    let id = rootId[r];
    if (id < 0) {
      id = nBody++;
      rootId[r] = id;
    }
    bodyOf[t] = id;
  }

  const vCount = new Uint32Array(nVert);
  for (let t = 0; t < numTri; t++) {
    vCount[indices[t * 3]]++;
    vCount[indices[t * 3 + 1]]++;
    vCount[indices[t * 3 + 2]]++;
  }
  const vOff = new Uint32Array(nVert + 1);
  for (let v = 0; v < nVert; v++) vOff[v + 1] = vOff[v] + vCount[v];
  const vCursor = new Uint32Array(nVert);
  for (let v = 0; v < nVert; v++) vCursor[v] = vOff[v];
  const vTris = new Uint32Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      vTris[vCursor[v]++] = t;
    }
  }

  const frames = {
    positions,
    indices,
    stride: step,
    numTri,
    nVert,
    nx,
    ny,
    nz,
    bnx,
    bny,
    bnz,
    area,
    cx,
    cy,
    cz,
    pairN,
    pairTri0,
    pairTri1,
    pairLo,
    pairHi,
    bodyOf,
    multiBody: nBody > 1,
    vOff,
    vTris,
  };
  cache.set(indices, frames);
  return frames;
}

/**
 * One record per unordered atom pair that shares an edge in a body.
 * Records are in first-seen order (edge insertion order), and each record's
 * dihedral sum is accumulated in that same order.
 * `triAtom` null means each triangle is its own atom.
 */
export function aggregateAtomAdj(frames, pairDeg, triAtom, sameBody) {
  const { pairN, pairTri0, pairTri1 } = frames;
  const cap = nextPow2(Math.max(16, pairN * 2));
  const mask = cap - 1;
  const occ = new Uint8Array(cap);
  const ka = new Int32Array(cap);
  const kb = new Int32Array(cap);
  const oa = new Int32Array(cap);
  const ob = new Int32Array(cap);
  const sum = new Float64Array(cap);
  const maxd = new Float64Array(cap);
  const nn = new Uint32Array(cap);
  const seen = new Uint32Array(pairN);
  let nSeen = 0;
  for (let i = 0; i < pairN; i++) {
    const t0 = pairTri0[i];
    const t1 = pairTri1[i];
    if (!sameBody(t0, t1)) continue;
    const a0 = triAtom ? triAtom[t0] : t0;
    const a1 = triAtom ? triAtom[t1] : t1;
    if (a0 === a1) continue;
    const lo = a0 < a1 ? a0 : a1;
    const hi = a0 < a1 ? a1 : a0;
    let h = mix2(lo, hi) & mask;
    while (occ[h] && (ka[h] !== lo || kb[h] !== hi)) h = (h + 1) & mask;
    if (!occ[h]) {
      occ[h] = 1;
      ka[h] = lo;
      kb[h] = hi;
      // First-seen endpoint order, not the sorted key. κ sums and the
      // prism-loop neighbour map follow that order.
      oa[h] = a0;
      ob[h] = a1;
      seen[nSeen++] = h;
    }
    const d = pairDeg[i];
    sum[h] += d;
    nn[h] += 1;
    if (d > maxd[h]) maxd[h] = d;
  }
  const adjA = new Int32Array(nSeen);
  const adjB = new Int32Array(nSeen);
  const adjSum = new Float64Array(nSeen);
  const adjMax = new Float64Array(nSeen);
  const adjN = new Uint32Array(nSeen);
  for (let i = 0; i < nSeen; i++) {
    const h = seen[i];
    adjA[i] = oa[h];
    adjB[i] = ob[h];
    adjSum[i] = sum[h];
    adjMax[i] = maxd[h];
    adjN[i] = nn[h];
  }
  return { n: nSeen, adjA, adjB, adjSum, adjMax, adjN };
}

/**
 * Spatial hash of `used` vertices. `nearby(v, emit)` reports other vertices
 * within `dist`. Cell pitch is `dist`. The key matches the face-graph seam
 * (numeric while every cell is inside ±65536, string past that).
 */
export function vertexGrid(positions, used, stride, dist) {
  const nVert = used.length;
  const step = stride || 3;
  const none = { nearby() { /* no vertices to query */ } };
  if (!(dist > 0) || nVert < 2) return none;
  const inv = 1 / dist;
  const dist2 = dist * dist;
  const CELL = 131072;
  const BIAS = 65536;
  const cellKey = (x, y, z) => {
    if (x < -BIAS || y < -BIAS || z < -BIAS || x >= BIAS || y >= BIAS || z >= BIAS) {
      return `${x}|${y}|${z}`;
    }
    return ((x + BIAS) * CELL + (y + BIAS)) * CELL + (z + BIAS);
  };
  let nUsed = 0;
  for (let v = 0; v < nVert; v++) if (used[v]) nUsed++;
  if (nUsed < 2) return none;

  const cap = nextPow2(Math.max(16, nUsed * 2));
  const mask = cap - 1;
  const occ = new Uint8Array(cap);
  const keys = new Float64Array(cap);
  const head = new Int32Array(cap);
  const chain = new Int32Array(nVert);
  chain.fill(-1);
  const far = new Map();
  const hashKey = (key) => mix2(key | 0, Math.floor(key / 4294967296)) & mask;
  const insert = (key, v) => {
    if (typeof key === 'string') {
      chain[v] = far.has(key) ? far.get(key) : -1;
      far.set(key, v);
      return;
    }
    let h = hashKey(key);
    while (occ[h] && keys[h] !== key) h = (h + 1) & mask;
    if (!occ[h]) {
      occ[h] = 1;
      keys[h] = key;
      head[h] = v;
      chain[v] = -1;
    } else {
      chain[v] = head[h];
      head[h] = v;
    }
  };
  const lookup = (key) => {
    if (typeof key === 'string') return far.has(key) ? far.get(key) : -1;
    let h = hashKey(key);
    while (occ[h] && keys[h] !== key) h = (h + 1) & mask;
    return occ[h] ? head[h] : -1;
  };
  for (let v = 0; v < nVert; v++) {
    if (!used[v]) continue;
    const o = v * step;
    insert(cellKey(
      Math.floor(positions[o] * inv),
      Math.floor(positions[o + 1] * inv),
      Math.floor(positions[o + 2] * inv),
    ), v);
  }

  const nearby = (v, emit) => {
    if (!used[v]) return;
    const o = v * step;
    const px = positions[o];
    const py = positions[o + 1];
    const pz = positions[o + 2];
    const cx = Math.floor(px * inv);
    const cy = Math.floor(py * inv);
    const cz = Math.floor(pz * inv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          let u = lookup(cellKey(cx + dx, cy + dy, cz + dz));
          while (u >= 0) {
            if (u !== v) {
              const ou = u * step;
              const ex = positions[ou] - px;
              const ey = positions[ou + 1] - py;
              const ez = positions[ou + 2] - pz;
              if (ex * ex + ey * ey + ez * ez <= dist2) emit(u);
            }
            u = chain[u];
          }
        }
      }
    }
  };
  return { nearby };
}

/** Dihedral degrees of each edge pair. Cached on the frames. Same acos as the face graph. */
export function pairDihedral(frames) {
  if (frames.pairDeg) return frames.pairDeg;
  const n = frames.pairN;
  const deg = new Float64Array(n);
  const { pairTri0, pairTri1, nx, ny, nz } = frames;
  for (let i = 0; i < n; i++) {
    const t0 = pairTri0[i];
    const t1 = pairTri1[i];
    const ax = nx[t0];
    const ay = ny[t0];
    const az = nz[t0];
    const bx = nx[t1];
    const by = ny[t1];
    const bz = nz[t1];
    const la = Math.hypot(ax, ay, az) || 1;
    const lb = Math.hypot(bx, by, bz) || 1;
    const d = (ax * bx + ay * by + az * bz) / (la * lb);
    // `(acos * 180) / π`, not `acos * (180/π)`. The face graph's old helper
    // scaled in that order, and the curvature mean is in the output hash.
    deg[i] = (Math.acos(d < -1 ? -1 : d > 1 ? 1 : d) * 180) / Math.PI;
  }
  frames.pairDeg = deg;
  return deg;
}
