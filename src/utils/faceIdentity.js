/**
 * Stamped faces and edges of one mesh (face identity, part 1).
 *
 * The kernel helpers record, for every solid they build, which faceIDs of
 * that solid's run play which role (`cube1.top`, `cyl1.side`,
 * `extrude3.wall[2]`; src/lib/surfcad/runtime.js, "FACE IDENTITY"). The
 * mesh itself is untouched: Manifold's own `originalID` per run and
 * `faceID` per triangle carry the stamp through every boolean, and the
 * run's mesh data adds `faceStamps`, one `{ originalID, feature, helper,
 * roles: [{ role, record, ranges }] }` row per run the final mesh still
 * uses. This module turns them into named faces on the main thread: label
 * each kept triangle from its run's originalID and its faceID, group by
 * label, split each group into connected pieces (triangles that share an
 * edge), order the pieces of one label by centre and append `[k]` when
 * there is more than one, then read the edges between named faces off the
 * shared triangle edges.
 *
 * The face graph (PartGraph) stays the pick unit: a viewport click, a paint
 * tap and a `list_faces` row are still one graph patch. A patch gets the
 * name of the stamped face that owns most of its triangles, and lists the
 * others when a union or a coplanar merge put several labels in one patch.
 * Unstamped triangles (a hull, a fillet cutter, a freehand Manifold.* call)
 * have no name; those patches keep working on their fingerprint key.
 */

const tableCache = new WeakMap();

function vec3At(positions, i) {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(v) { return Math.hypot(v[0], v[1], v[2]); }
function unit(v) { const l = len(v); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; }

/** Numeric key of an undirected vertex pair (vertex indices below 2^26). */
function pairKey(u, w) {
  return u < w ? u * 67108864 + w : w * 67108864 + u;
}

/** The role row of (stamp, faceID), or null (binary search over each role's ranges). */
function roleFor(stamp, faceID) {
  for (const row of stamp.roles) {
    const r = row.ranges;
    let lo = 0;
    let hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (faceID < r[mid][0]) hi = mid - 1;
      else if (faceID >= r[mid][1]) lo = mid + 1;
      else return row;
    }
  }
  return null;
}

/**
 * Build the named-face table for a geometry.
 *
 * @param {{ attributes?: object, index?: object, userData?: object }} geometry BufferGeometry from buildSolidGeometry (userData carries faceStamps and triOriginalID)
 * @param {ArrayLike<number>|null} faceIDs per-triangle faceID (the geometry's attribute when omitted)
 * @returns {{ faces: Array, edges: Array, triFace: Int32Array|null, byName: Map<string, object> }}
 */
export function stampedFaceTable(geometry, faceIDs = null) {
  const empty = { faces: [], edges: [], triFace: null, byName: new Map() };
  if (!geometry) return empty;
  const ids = faceIDs || geometry.getAttribute?.('faceID')?.array || null;
  const cached = tableCache.get(geometry);
  if (cached && cached.ids === ids) return cached.table;
  const table = buildTable(geometry, ids);
  tableCache.set(geometry, { ids, table });
  return table;
}

function buildTable(geometry, ids) {
  const positions = geometry?.attributes?.position?.array;
  const indices = geometry?.index?.array;
  const rows = geometry?.userData?.faceStamps;
  const triOriginalID = geometry?.userData?.triOriginalID;
  const empty = { faces: [], edges: [], triFace: null, byName: new Map() };
  if (!positions || !indices || !indices.length || !ids || !triOriginalID || !Array.isArray(rows) || !rows.length) return empty;
  const stampByOriginal = new Map();
  for (const row of rows) {
    if (row && Number.isFinite(row.originalID) && Array.isArray(row.roles)) stampByOriginal.set(Number(row.originalID), row);
  }
  if (!stampByOriginal.size) return empty;
  const nTri = Math.floor(indices.length / 3);
  if (triOriginalID.length < nTri) return empty;
  // Group triangles by label (feature.role); a union of two copies of one
  // solid puts the same originalID in two runs, so one label can span runs.
  const groups = new Map();
  const labelInfo = new Map();
  for (let t = 0; t < nTri; t++) {
    const stamp = stampByOriginal.get(triOriginalID[t]);
    if (!stamp) continue;
    const role = roleFor(stamp, Number(ids[t]));
    if (!role) continue;
    const key = `${stamp.feature}.${role.role}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
      labelInfo.set(key, { feature: stamp.feature, role: role.role, helper: stamp.helper || null, record: role.record || { kind: 'mesh' } });
    }
    list.push(t);
  }
  if (!groups.size) return empty;

  const faces = [];
  const triFace = new Int32Array(nTri).fill(-1);
  const byLabel = new Map();
  for (const [key, tris] of groups) {
    const stamp = labelInfo.get(key);
    const fid = Number(ids[tris[0]]);
    // Connected pieces of this stamped id.
    const parent = tris.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edgeOwner = new Map();
    tris.forEach((t, gi) => {
      const v0 = indices[t * 3];
      const v1 = indices[t * 3 + 1];
      const v2 = indices[t * 3 + 2];
      for (const [u, w] of [[v0, v1], [v1, v2], [v2, v0]]) {
        const key = pairKey(u, w);
        const prev = edgeOwner.get(key);
        if (prev === undefined) edgeOwner.set(key, gi);
        else {
          const a = find(prev);
          const b = find(gi);
          if (a !== b) parent[b] = a;
        }
      }
    });
    const byRoot = new Map();
    tris.forEach((t, gi) => {
      const r = find(gi);
      let list = byRoot.get(r);
      if (!list) { list = []; byRoot.set(r, list); }
      list.push(t);
    });
    const pieces = [];
    for (const sub3 of byRoot.values()) {
      const c = [0, 0, 0];
      const n = [0, 0, 0];
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let area = 0;
      for (const t of sub3) {
        const a = vec3At(positions, indices[t * 3]);
        const b = vec3At(positions, indices[t * 3 + 1]);
        const d = vec3At(positions, indices[t * 3 + 2]);
        const cr = cross(sub(b, a), sub(d, a));
        const ta = 0.5 * len(cr);
        const tn = unit(cr);
        for (let k = 0; k < 3; k++) {
          c[k] += ((a[k] + b[k] + d[k]) / 3) * ta;
          n[k] += tn[k] * ta;
          const lo = Math.min(a[k], b[k], d[k]);
          const hi = Math.max(a[k], b[k], d[k]);
          if (lo < min[k]) min[k] = lo;
          if (hi > max[k]) max[k] = hi;
        }
        area += ta;
      }
      pieces.push({
        faceID: fid,
        feature: stamp.feature,
        role: stamp.role,
        helper: stamp.helper,
        record: stamp.record,
        ordinal: 0,
        name: '',
        tris: sub3,
        area,
        center: area > 1e-18 ? [c[0] / area, c[1] / area, c[2] / area] : [0, 0, 0],
        normal: unit(n),
        bbox: { min, max },
      });
    }
    byLabel.set(key, pieces);
  }
  // Ordinals: one label in several pieces, ordered by centre x, y, z. A
  // union of two copies of one solid gives the same stamped ids twice, so
  // the pieces of one label can come from more than one faceID.
  for (const [key, pieces] of byLabel) {
    pieces.sort((p, q) => p.center[0] - q.center[0] || p.center[1] - q.center[1] || p.center[2] - q.center[2]);
    pieces.forEach((p, i) => {
      p.ordinal = i;
      p.name = pieces.length > 1 ? `${key}[${i}]` : key;
    });
    faces.push(...pieces);
  }
  faces.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const byName = new Map();
  faces.forEach((f, i) => {
    f.id = i;
    byName.set(f.name, f);
    for (const t of f.tris) triFace[t] = i;
  });

  // Edges: a triangle edge whose two triangles belong to different named
  // faces. Grouped by face pair, then chained into connected polylines;
  // a pair that meets in several disjoint chains gets ordinals.
  const pairSegs = new Map();
  const edgeTris = new Map();
  for (let t = 0; t < nTri; t++) {
    if (triFace[t] < 0) continue;
    const v0 = indices[t * 3];
    const v1 = indices[t * 3 + 1];
    const v2 = indices[t * 3 + 2];
    for (const [u, w] of [[v0, v1], [v1, v2], [v2, v0]]) {
      const key = pairKey(u, w);
      const prev = edgeTris.get(key);
      if (prev === undefined) { edgeTris.set(key, t); continue; }
      const fa = triFace[prev];
      const fb = triFace[t];
      if (fa < 0 || fb < 0 || fa === fb) continue;
      const lo = Math.min(fa, fb);
      const hi = Math.max(fa, fb);
      const pk = `${lo}:${hi}`;
      let list = pairSegs.get(pk);
      if (!list) { list = []; pairSegs.set(pk, list); }
      list.push([u, w]);
    }
  }
  const edges = [];
  for (const [pk, segs] of pairSegs) {
    const [fa, fb] = pk.split(':').map(Number);
    const chains = chainSegments(segs);
    chains.sort((a, b) => a.mid[0] - b.mid[0] || a.mid[1] - b.mid[1] || a.mid[2] - b.mid[2]);
    chains.forEach((chain, k) => {
      const base = `${faces[fa].name}~${faces[fb].name}`;
      edges.push({
        name: chains.length > 1 ? `${base}[${k}]` : base,
        faces: [faces[fa].name, faces[fb].name],
        ordinal: k,
        length: chain.length,
        closed: chain.closed,
        polyline: chain.vertices.map((i) => vec3At(positions, i)),
        segments: chain.segments,
      });
    });
  }
  edges.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { faces, edges, triFace, byName };

  /** Connected chains of vertex-pair segments: ordered vertex lists, length, midpoint. */
  function chainSegments(list) {
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
      // Collect the component first.
      const comp = [];
      const stack = [s];
      used[s] = 1;
      while (stack.length) {
        const si = stack.pop();
        comp.push(si);
        for (const v of list[si]) {
          for (const nx of adj.get(v) || []) {
            if (!used[nx]) { used[nx] = 1; stack.push(nx); }
          }
        }
      }
      // Walk it from an endpoint (odd degree) or anywhere on a loop.
      const degree = new Map();
      for (const si of comp) for (const v of list[si]) degree.set(v, (degree.get(v) || 0) + 1);
      let start = null;
      for (const [v, d] of degree) if (d === 1) { start = v; break; }
      const closed = start === null;
      if (start === null) start = list[comp[0]][0];
      const walked = new Set();
      const vertices = [start];
      let at = start;
      for (;;) {
        const next = (adj.get(at) || []).find((si) => comp.includes(si) && !walked.has(si));
        if (next === undefined) break;
        walked.add(next);
        at = list[next][0] === at ? list[next][1] : list[next][0];
        vertices.push(at);
      }
      let length = 0;
      for (let i = 1; i < vertices.length; i++) {
        length += len(sub(vec3At(positions, vertices[i]), vec3At(positions, vertices[i - 1])));
      }
      const mid = vec3At(positions, vertices[Math.floor(vertices.length / 2)]);
      out.push({ vertices, segments: comp.map((si) => list[si]), length, closed, mid });
    }
    return out;
  }
}

/**
 * Name for a set of triangles (a face-graph patch): the stamped face that
 * owns most of them, with every other stamped face in the set listed under
 * `names` when the patch spans several (a coplanar union, a merged band).
 * Null when none of the triangles is stamped.
 *
 * @returns {{ name: string, feature: string, role: string, record: object, names?: string[] }|null}
 */
export function stampedNameForTriangles(table, tris) {
  const triFace = table?.triFace;
  if (!triFace || !Array.isArray(tris) || !tris.length) return null;
  const counts = new Map();
  for (const t of tris) {
    const f = triFace[t];
    if (f == null || f < 0) continue;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  if (!counts.size) return null;
  let best = -1;
  let bestN = 0;
  for (const [f, n] of counts) {
    if (n > bestN || (n === bestN && f < best)) { best = f; bestN = n; }
  }
  const face = table.faces[best];
  const out = { name: face.name, feature: face.feature, role: face.role, record: face.record };
  if (counts.size > 1) {
    out.names = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a - b).map((f) => table.faces[f].name);
  }
  return out;
}

/** Plain-data view of the table for a dev hook or a golden (no triangle lists). */
export function describeFaceTable(table) {
  return {
    faces: (table?.faces || []).map((f) => ({
      name: f.name,
      feature: f.feature,
      role: f.role,
      ordinal: f.ordinal,
      helper: f.helper,
      record: f.record,
      area: f.area,
      center: f.center,
      normal: f.normal,
      bbox: f.bbox,
      triangleCount: f.tris.length,
    })),
    edges: (table?.edges || []).map((e) => ({
      name: e.name,
      faces: e.faces,
      ordinal: e.ordinal,
      length: e.length,
      closed: e.closed,
      points: e.polyline.length,
    })),
  };
}
