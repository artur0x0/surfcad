/**
 * Connected components of an indexed triangle mesh. Shared vertex indices
 * join one body, which is how a composed Manifold comes back from the worker
 * (separate solids do not share vertices).
 *
 * This is a leaf module. selectEdge and selectFace need it, and cutMode
 * imports helperPaletteSnippets. Keeping the function here stops that import
 * from cycling back through faceFeaturePlacement while HOLE_SIZE_OPTIONS is
 * still initializing.
 *
 * @returns {{ center: number[], at: number[], triangles: number[], minTri: number }[]}
 */

function readPos(positions, i) {
  if (positions && typeof positions.getX === 'function') {
    return [positions.getX(i), positions.getY(i), positions.getZ(i)];
  }
  const arr = positions?.array || positions;
  if (!arr) return [0, 0, 0];
  return [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
}

function readIndex(index) {
  if (!index) return null;
  return index.array || index;
}

export function meshBodyComponents(positions, index) {
  const idx = readIndex(index);
  if (!positions || !idx || !idx.length) return [];
  const triCount = Math.floor(idx.length / 3);
  if (!triCount) return [];
  const parent = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
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
  const vertToTri = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      const prev = vertToTri.get(v);
      if (prev === undefined) vertToTri.set(v, t);
      else unite(prev, t);
    }
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let g = groups.get(r);
    if (!g) {
      g = { triangles: [], minTri: t };
      groups.set(r, g);
    }
    g.triangles.push(t);
  }
  const bodies = [];
  for (const g of groups.values()) {
    const seen = new Set();
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    for (const t of g.triangles) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        if (seen.has(v)) continue;
        seen.add(v);
        const p = readPos(positions, v);
        sx += p[0];
        sy += p[1];
        sz += p[2];
        n++;
      }
    }
    const center = n ? [sx / n, sy / n, sz / n] : [0, 0, 0];
    bodies.push({
      center,
      at: center.slice(),
      triangles: g.triangles,
      minTri: g.minTri,
    });
  }
  bodies.sort((a, b) => a.minTri - b.minTri);
  return bodies;
}

/**
 * Body count for a worker mesh (`vertProperties` / `triVerts` / `numProp`).
 * Same connected-component count as meshBodyComponents on the drawn mesh.
 */
function workerMeshGeometry(mesh) {
  if (!mesh?.vertProperties || !mesh?.triVerts) return null;
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  if (nVert <= 0) return null;
  let positions = src;
  if (np !== 3) {
    positions = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
      positions[i * 3] = src[i * np];
      positions[i * 3 + 1] = src[i * np + 1];
      positions[i * 3 + 2] = src[i * np + 2];
    }
  }
  return { positions, index: mesh.triVerts };
}

function triangleVertexKey(positions, index, tri) {
  const keys = [];
  for (let k = 0; k < 3; k++) {
    const vi = index[tri * 3 + k];
    const p = readPos(positions, vi);
    keys.push(p.map((v) => Math.round(v * 1e4) / 1e4).join(','));
  }
  return keys.sort().join('|');
}

function bodyOwnsTriangle(body, wantKey) {
  const mesh = body?.getMesh?.();
  if (!mesh) return false;
  const geom = workerMeshGeometry(mesh);
  if (!geom) return false;
  const { positions, index } = geom;
  const triCount = Math.floor(index.length / 3);
  for (let t = 0; t < triCount; t++) {
    if (triangleVertexKey(positions, index, t) === wantKey) return true;
  }
  return false;
}

/**
 * Which decomposed Manifold body owns a hit triangle on the combined mesh.
 * Overlapping solids can share a centroid; the triangle index does not.
 */
export function decomposedBodyIndexForTri(manifold, bodies, tri) {
  const t = Number(tri);
  if (!manifold || !Array.isArray(bodies) || bodies.length <= 1 || !Number.isFinite(t)) return -1;
  const geom = workerMeshGeometry(manifold.getMesh());
  if (!geom) return -1;
  const comps = meshBodyComponents(geom.positions, geom.index);
  const comp = comps.find((c) => c.triangles.includes(t));
  if (!comp) return -1;
  const wantKey = triangleVertexKey(geom.positions, geom.index, t);
  for (let i = 0; i < bodies.length; i++) {
    if (bodyOwnsTriangle(bodies[i], wantKey)) return i;
  }
  return -1;
}

export function bodyCountOfWorkerMesh(mesh) {
  if (!mesh?.vertProperties || !mesh?.triVerts) return 0;
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  if (!src.length || np < 3) return 0;
  const nVert = Math.floor(src.length / np);
  if (nVert <= 0) return 0;
  // meshBodyComponents only reads xyz; pass a view that looks like a flat xyz buffer
  // by copying when numProp !== 3, otherwise reuse vertProperties directly.
  let positions = src;
  if (np !== 3) {
    positions = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
      positions[i * 3] = src[i * np];
      positions[i * 3 + 1] = src[i * np + 1];
      positions[i * 3 + 2] = src[i * np + 2];
    }
  }
  return meshBodyComponents(positions, mesh.triVerts).length;
}
