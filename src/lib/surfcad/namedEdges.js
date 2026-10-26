/**
 * Named edges: the chains of mesh edges that run between two stamped faces.
 *
 * An edge is identified by the pair of face names it lies between
 * (`plate.top~boss.side`), with `[k]` appended when that pair meets in
 * more than one disconnected chain. The viewport table
 * (`src/utils/faceIdentity.js`) and the kernel helper `edgesNamed`
 * (`runtime.js`) both build their edges here, so the name a pick writes is
 * the name the script resolves: same chaining, same ordinal order, same
 * pattern matching. See `mvp3/edge-identity-design.md`.
 *
 * Pure: no Manifold, no three.js. The caller passes triangle indices, a
 * position accessor, the face index of every triangle and the face names.
 */

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(v) { return Math.hypot(v[0], v[1], v[2]); }

/** Numeric key of an undirected vertex pair (vertex indices below 2^26). */
export function vertexPairKey(u, w) {
  return u < w ? u * 67108864 + w : w * 67108864 + u;
}

/** `a~b` with the two face names in sorted order, so either order names the same edge. */
export function canonicalEdgeName(faceA, faceB) {
  return faceA < faceB ? `${faceA}~${faceB}` : `${faceB}~${faceA}`;
}

/**
 * Connected chains of vertex-pair segments. Each segment is `[u, w, t0, t1]`
 * (the two triangles that share it). A chain is walked from an endpoint
 * (odd degree) or, on a loop, from anywhere; `center` is the
 * length-weighted centroid of its segments, which does not depend on the
 * walk direction, so the ordinal order is the same on every side.
 */
function chainSegments(list, posAt) {
  const adj = new Map();
  const addAdj = (v, si) => {
    let l = adj.get(v);
    if (!l) { l = []; adj.set(v, l); }
    l.push(si);
  };
  list.forEach(([u, w], si) => { addAdj(u, si); addAdj(w, si); });
  const used = new Uint8Array(list.length);
  const out = [];
  for (let s = 0; s < list.length; s++) {
    if (used[s]) continue;
    const comp = [];
    const stack = [s];
    used[s] = 1;
    while (stack.length) {
      const si = stack.pop();
      comp.push(si);
      for (const v of [list[si][0], list[si][1]]) {
        for (const nx of adj.get(v) || []) {
          if (!used[nx]) { used[nx] = 1; stack.push(nx); }
        }
      }
    }
    const compSet = new Set(comp);
    const degree = new Map();
    for (const si of comp) for (const v of [list[si][0], list[si][1]]) degree.set(v, (degree.get(v) || 0) + 1);
    let start = null;
    for (const [v, d] of degree) if (d === 1) { start = v; break; }
    const closed = start === null;
    if (start === null) start = list[comp[0]][0];
    const walked = new Set();
    const vertices = [start];
    let at = start;
    for (;;) {
      const next = (adj.get(at) || []).find((si) => compSet.has(si) && !walked.has(si));
      if (next === undefined) break;
      walked.add(next);
      at = list[next][0] === at ? list[next][1] : list[next][0];
      vertices.push(at);
    }
    let length = 0;
    const c = [0, 0, 0];
    for (const si of comp) {
      const a = posAt(list[si][0]);
      const b = posAt(list[si][1]);
      const L = len(sub(b, a));
      length += L;
      for (let k = 0; k < 3; k++) c[k] += ((a[k] + b[k]) / 2) * L;
    }
    const center = length > 1e-12 ? [c[0] / length, c[1] / length, c[2] / length] : posAt(start);
    out.push({
      vertices,
      segments: comp.map((si) => [list[si][0], list[si][1]]),
      tris: comp.map((si) => [list[si][2], list[si][3]]),
      length,
      closed,
      center,
    });
  }
  return out;
}

/**
 * Every edge between two named faces, chained and named.
 *
 * @param {{
 *   nTri: number,
 *   triVerts: ArrayLike<number>,
 *   posAt: (v: number) => number[],
 *   triFace: ArrayLike<number>,
 *   faceName: (fi: number) => string,
 * }} input
 * @returns {Array<{ name: string, base: string, faces: [string, string], ordinal: number, chains: number, length: number, closed: boolean, vertices: number[], segments: number[][], tris: number[][], center: number[] }>}
 */
export function chainNamedEdges({ nTri, triVerts, posAt, triFace, faceName }) {
  const pairSegs = new Map();
  const edgeTris = new Map();
  for (let t = 0; t < nTri; t++) {
    if (triFace[t] < 0) continue;
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];
    for (const [u, w] of [[v0, v1], [v1, v2], [v2, v0]]) {
      const key = vertexPairKey(u, w);
      const prev = edgeTris.get(key);
      if (prev === undefined) { edgeTris.set(key, t); continue; }
      const fa = triFace[prev];
      const fb = triFace[t];
      if (fa < 0 || fb < 0 || fa === fb) continue;
      const lo = Math.min(fa, fb);
      const hi = Math.max(fa, fb);
      const pk = lo * 4294967296 + hi;
      let list = pairSegs.get(pk);
      if (!list) { list = []; pairSegs.set(pk, list); }
      // t0 is the triangle on face `lo`, t1 the one on face `hi`.
      list.push(fa === lo ? [u, w, prev, t] : [u, w, t, prev]);
    }
  }
  const edges = [];
  for (const [pk, segs] of pairSegs) {
    const lo = Math.floor(pk / 4294967296);
    const hi = pk - lo * 4294967296;
    const nameLo = faceName(lo);
    const nameHi = faceName(hi);
    const base = canonicalEdgeName(nameLo, nameHi);
    const chains = chainSegments(segs, posAt);
    chains.sort((a, b) => a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2] || a.length - b.length);
    chains.forEach((chain, k) => {
      edges.push({
        name: chains.length > 1 ? `${base}[${k}]` : base,
        base,
        faces: [nameLo, nameHi],
        ordinal: k,
        chains: chains.length,
        length: chain.length,
        closed: chain.closed,
        vertices: chain.vertices,
        segments: chain.segments,
        tris: chain.tris,
        center: chain.center,
      });
    });
  }
  edges.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return edges;
}

/** Glob with `*` on an edge or face name. */
export function nameGlob(pattern) {
  const esc = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${esc}$`);
}

/** `a~b[k]` → `{ base: 'a~b', faces: ['a', 'b'], ordinal: k | null }`; null when there is no `~`. */
export function parseEdgeName(name) {
  const text = String(name ?? '').trim();
  const m = /^(.*?)(?:\[(\d+)\])?$/.exec(text);
  if (!m) return null;
  const body = m[1];
  const tilde = body.indexOf('~');
  if (tilde < 0) return null;
  const a = body.slice(0, tilde);
  const b = body.slice(tilde + 1);
  if (!a || !b) return null;
  return { base: canonicalEdgeName(a, b), faces: [a, b], ordinal: m[2] != null ? Number(m[2]) : null };
}

/**
 * The edges one pattern names. An exact name or its flipped form (`b~a`),
 * a bare pair (every chain of that pair), or a glob with `*` on either
 * side. `[k]` on a pair that does not have that chain is an `ordinal`
 * error, never a nearby chain; a name that matches nothing is `unknown`.
 *
 * @param {ReturnType<typeof chainNamedEdges>} edges
 * @param {string} pattern
 * @returns {{ hits: object[] } | { error: 'bad_name' | 'unknown' | 'ordinal', message: string }}
 */
export function matchEdgeName(edges, pattern) {
  const want = String(pattern ?? '').trim();
  if (!want) return { error: 'bad_name', message: 'an edge name is faceA~faceB (see list_feature_edges or faceNames)' };
  const parsed = parseEdgeName(want);
  if (!parsed) return { error: 'bad_name', message: `'${want}' is not an edge name (faceA~faceB, with [k] for one chain of a pair)` };
  if (parsed.ordinal != null) {
    const siblings = edges.filter((e) => e.base === parsed.base);
    if (!siblings.length) return { error: 'unknown', message: `no edge between ${parsed.faces[0]} and ${parsed.faces[1]}` };
    const hit = siblings.find((e) => e.ordinal === parsed.ordinal && e.chains > 1);
    if (hit) return { hits: [hit] };
    if (siblings.length === 1 && parsed.ordinal === 0 && siblings[0].chains === 1) return { hits: siblings };
    return {
      error: 'ordinal',
      message: `edge ${parsed.base} has ${siblings.length} chain${siblings.length === 1 ? '' : 's'} on this solid, so [${parsed.ordinal}] names none of them — re-pick the edge (the pieces changed), or use the bare name for every chain`,
    };
  }
  let hits = edges.filter((e) => e.base === parsed.base);
  if (!hits.length && want.includes('*')) {
    const re = nameGlob(want);
    const flipped = nameGlob(`${parsed.faces[1]}~${parsed.faces[0]}`);
    hits = edges.filter((e) => re.test(e.name) || re.test(e.base) || flipped.test(e.name) || flipped.test(e.base)
      || re.test(`${e.faces[1]}~${e.faces[0]}`) || flipped.test(`${e.faces[1]}~${e.faces[0]}`));
  }
  if (!hits.length) return { error: 'unknown', message: `no edge named ${JSON.stringify(want)}` };
  return { hits };
}

/** The first `n` edge names for an error message, with a count when there are more. */
export function describeEdgeNames(edges, n = 16) {
  const all = edges.map((e) => e.name);
  if (!all.length) return 'this solid has no named edges';
  return `edges on this solid: ${all.slice(0, n).join(', ')}${all.length > n ? `, … (${all.length})` : ''}`;
}
