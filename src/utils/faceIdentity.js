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
 * uses. This module turns them into named faces on the main thread.
 * `stampedPiecesForMesh` runs on the full mesh data when the geometry is
 * built (buildSolidGeometry drops needle triangles, and connectivity on the
 * trimmed mesh falls apart where they were; the kernel keeps them, and both
 * sides must find the same pieces): label each triangle from its run's
 * originalID and its faceID, group by label, split each group into
 * connected pieces (triangles that share a vertex). `stampedFaceTable`
 * then measures the kept triangles of each piece, orders the pieces of one
 * label by centre and appends `[k]` when there is more than one, and reads
 * the edges between named faces off the shared triangle edges.
 *
 * The face graph (PartGraph) stays the pick unit: a viewport click, a paint
 * tap and a `list_faces` row are still one graph patch. A patch gets the
 * name of the stamped face that owns most of its triangles, and lists the
 * others when a union or a coplanar merge put several labels in one patch.
 * Unstamped triangles (a hull, a fillet cutter, a freehand Manifold.* call)
 * have no name; those patches keep working on their fingerprint key.
 */

import { chainNamedEdges, describeEdgeNames, matchEdgeName } from '../lib/surfcad/namedEdges.js';

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

/** A synthetic per-coplanar-group stamp (`f<k>`): a facet, not a face a helper named. */
export function syntheticStampRole(role) {
  return /^f\d+$/.test(String(role || ''));
}

/**
 * The face-graph wall index per triangle: the piece index of a helper-named
 * face, -1 where the triangle has no stamp or only a synthetic facet stamp
 * (imports, freehand runs, sheet bends), so those keep the geometric grouping.
 * @param {Int32Array|null|undefined} pieceOfTri
 * @param {Array<{ role?: string }>|null|undefined} pieces
 * @param {ArrayLike<number>|null} [keep] kept-triangle map (needle drop), when pieceOfTri is for the full mesh
 */
export function wallTriFace(pieceOfTri, pieces, keep = null, nKept = 0) {
  if (!pieceOfTri || !Array.isArray(pieces) || !pieces.length) return null;
  const named = new Int8Array(pieces.length);
  let any = false;
  for (let i = 0; i < pieces.length; i++) {
    if (!syntheticStampRole(pieces[i]?.role)) { named[i] = 1; any = true; }
  }
  if (!any) return null;
  const n = keep ? nKept : pieceOfTri.length;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const pi = pieceOfTri[keep ? keep[i] : i];
    out[i] = pi >= 0 && named[pi] ? pi : -1;
  }
  return out;
}

/**
 * Pieces of every stamped label on the full mesh data, by triangle: the
 * step buildSolidGeometry runs before it drops needles.
 * @returns {{ pieceOfTri: Int32Array, pieces: Array<{ feature: string, role: string, helper: string|null, record: object }> }|null}
 */
export function stampedPiecesForMesh(meshData) {
  const rows = meshData?.faceStamps;
  const triVerts = meshData?.triVerts;
  const faceID = meshData?.faceID;
  const runIndex = meshData?.runIndex;
  const runOriginalID = meshData?.runOriginalID;
  if (!Array.isArray(rows) || !rows.length || !triVerts || !faceID || !runIndex || !runOriginalID) return null;
  const nTri = Math.floor(triVerts.length / 3);
  if (faceID.length < nTri || runIndex.length < 2) return null;
  const stampByOriginal = new Map();
  for (const row of rows) {
    if (row && Number.isFinite(row.originalID) && Array.isArray(row.roles)) stampByOriginal.set(Number(row.originalID), row);
  }
  if (!stampByOriginal.size) return null;
  // Label per triangle.
  const labelOfTri = new Int32Array(nTri).fill(-1);
  const labels = [];
  const labelIndex = new Map();
  for (let r = 0; r + 1 < runIndex.length; r++) {
    const stamp = stampByOriginal.get(Number(runOriginalID[r]));
    if (!stamp) continue;
    const t1 = Math.min(nTri, Math.floor(runIndex[r + 1] / 3));
    for (let t = Math.floor(runIndex[r] / 3); t < t1; t++) {
      const role = roleFor(stamp, Number(faceID[t]));
      if (!role) continue;
      const key = `${stamp.feature}.${role.role}`;
      let li = labelIndex.get(key);
      if (li === undefined) {
        li = labels.length;
        labels.push({ feature: stamp.feature, role: role.role, helper: stamp.helper || null, record: role.record || { kind: 'mesh' } });
        labelIndex.set(key, li);
      }
      labelOfTri[t] = li;
    }
  }
  if (!labels.length) return null;
  // Connected pieces per label: triangles that share a vertex.
  const parent = new Int32Array(nTri);
  for (let t = 0; t < nTri; t++) parent[t] = t;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const ownerByVertex = new Map();
  for (let t = 0; t < nTri; t++) {
    const li = labelOfTri[t];
    if (li < 0) continue;
    for (let k = 0; k < 3; k++) {
      const key = li * 4294967296 + triVerts[t * 3 + k];
      const prev = ownerByVertex.get(key);
      if (prev === undefined) ownerByVertex.set(key, t);
      else {
        const a = find(prev);
        const b = find(t);
        if (a !== b) parent[b] = a;
      }
    }
  }
  const pieceOfTri = new Int32Array(nTri).fill(-1);
  const pieceByRoot = new Map();
  const pieces = [];
  for (let t = 0; t < nTri; t++) {
    const li = labelOfTri[t];
    if (li < 0) continue;
    const root = find(t);
    let pi = pieceByRoot.get(root);
    if (pi === undefined) {
      pi = pieces.length;
      pieces.push(labels[li]);
      pieceByRoot.set(root, pi);
    }
    pieceOfTri[t] = pi;
  }
  return { pieceOfTri, pieces };
}

/**
 * Build the named-face table for a geometry.
 *
 * @param {{ attributes?: object, index?: object, userData?: object }} geometry BufferGeometry from buildSolidGeometry (userData carries faceStamps and triOriginalID)
 * @param {ArrayLike<number>|null} faceIDs per-triangle faceID (the geometry's attribute when omitted)
 * @returns {{ faces: Array, edges: Array, triFace: Int32Array|null, byName: Map<string, object> }}
 */
export function stampedFaceTable(geometry, faceIDs = null) {
  const empty = { faces: [], edges: [], triFace: null, triArea: null, byName: new Map() };
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
  const identity = geometry?.userData?.faceIdentity;
  const empty = { faces: [], edges: [], triFace: null, triArea: null, byName: new Map() };
  if (!positions || !indices || !indices.length || !identity?.pieceOfTri || !Array.isArray(identity.pieces) || !identity.pieces.length) return empty;
  const nTri = Math.floor(indices.length / 3);
  if (identity.pieceOfTri.length < nTri) return empty;
  // Kept triangles per piece (the needles buildSolidGeometry dropped are
  // gone, which only trims a sliver of area off a piece).
  const trisOfPiece = new Map();
  for (let t = 0; t < nTri; t++) {
    const pi = identity.pieceOfTri[t];
    if (pi < 0) continue;
    let list = trisOfPiece.get(pi);
    if (!list) { list = []; trisOfPiece.set(pi, list); }
    list.push(t);
  }
  if (!trisOfPiece.size) return empty;

  const faces = [];
  const triFace = new Int32Array(nTri).fill(-1);
  const triArea = new Float32Array(nTri);
  const byLabel = new Map();
  for (const [pi, sub3] of trisOfPiece) {
    const stamp = identity.pieces[pi];
    const fid = Number(ids ? ids[sub3[0]] : -1);
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
      triArea[t] = ta;
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
    const piece = {
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
    };
    const key = `${stamp.feature}.${stamp.role}`;
    let list = byLabel.get(key);
    if (!list) { list = []; byLabel.set(key, list); }
    list.push(piece);
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
  // faces, grouped by face pair and chained into connected polylines; a pair
  // that meets in several disjoint chains gets ordinals. The chaining, the
  // ordinal order and the names are the shared module the kernel's
  // `edgesNamed` uses too, so a pick writes the name the script resolves.
  const edges = chainNamedEdges({
    nTri,
    triVerts: indices,
    posAt: (v) => vec3At(positions, v),
    triFace,
    faceName: (fi) => faces[fi].name,
  }).map((e) => ({
    ...e,
    polyline: e.vertices.map((i) => vec3At(positions, i)),
  }));
  return { faces, edges, triFace, triArea, byName };
}

/**
 * Annotate picked or feature edges with the named edge they lie on. A row
 * with vertex indices `a` / `b` into the table's geometry gets `edgeName`
 * (the chain name, `plate.top~boss.side[1]`), `edgeBase` (the pair),
 * `edgePairChains` (how many chains that pair has) and `edgeChainSize`
 * (segments in that chain), so the Fillet emitter can write `edgesNamed`
 * and tell a whole-chain pick from a partial one. Rows the table does not
 * cover are returned as they are.
 */
export function edgeNamesForPicks(table, edges) {
  const list = Array.isArray(edges) ? edges : [];
  const chains = table?.edges;
  if (!Array.isArray(chains) || !chains.length || !list.length) return list;
  const byPair = new Map();
  for (const chain of chains) {
    for (const [u, w] of chain.segments || []) byPair.set(pairKey(u, w), chain);
  }
  let changed = false;
  const out = list.map((edge) => {
    if (!edge || !Number.isFinite(edge.a) || !Number.isFinite(edge.b)) return edge;
    const chain = byPair.get(pairKey(edge.a, edge.b));
    if (!chain) return edge;
    if (edge.edgeName === chain.name && edge.edgeChainSize === chain.segments.length) return edge;
    changed = true;
    return {
      ...edge,
      edgeName: chain.name,
      edgeBase: chain.base,
      edgePairChains: chain.chains,
      edgeChainSize: chain.segments.length,
    };
  });
  return changed ? out : list;
}

/**
 * Name for a set of triangles (a face-graph patch): the stamped face that
 * owns most of their area, with every other stamped face in the set listed
 * under `names` when the patch spans several (a coplanar union, a merged
 * band). Null when none of the triangles is stamped.
 *
 * Area, not triangle count: a rolling-ball cutter's legs lie on the host
 * flats, so a few thin leftover strips on a flat carry the blend's stamp.
 * Eight strip triangles of 8 mm² must not outvote the two 600 mm² triangles
 * of `seed.top` in the same coplanar patch.
 *
 * @returns {{ name: string, feature: string, role: string, record: object, names?: string[] }|null}
 */
export function stampedNameForTriangles(table, tris) {
  const triFace = table?.triFace;
  if (!triFace || !Array.isArray(tris) || !tris.length) return null;
  const triArea = table.triArea;
  const counts = new Map();
  for (const t of tris) {
    const f = triFace[t];
    if (f == null || f < 0) continue;
    const w = triArea ? triArea[t] : 1;
    counts.set(f, (counts.get(f) || 0) + w);
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

/** A name pattern as a RegExp: `*` matches anything, everything else is literal. */
export function nameGlob(pattern) {
  const esc = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${esc}$`);
}

function labelOf(face) {
  return `${face.feature}.${face.role}`;
}

/**
 * The stamped faces a name picks: an exact name, a label without its `[k]`
 * (every piece), or a glob with `*`. Empty when nothing matches.
 */
export function facesForName(table, pattern) {
  const want = String(pattern ?? '').trim();
  const faces = table?.faces || [];
  if (!want) return [];
  let hits = faces.filter((f) => f.name === want);
  if (!hits.length) hits = faces.filter((f) => labelOf(f) === want);
  if (!hits.length && want.includes('*')) {
    const re = nameGlob(want);
    hits = faces.filter((f) => re.test(f.name) || re.test(labelOf(f)));
  }
  return hits;
}

function describeAvailable(names) {
  if (!names.length) return 'this mesh has no named faces (nothing a stamped helper built)';
  const shown = names.slice(0, 16).join(', ');
  return `names on this mesh: ${shown}${names.length > 16 ? `, … (${names.length})` : ''}`;
}

/**
 * Face picks for `select_faces { names }`: each name becomes the stamped
 * face's own triangles (the exact face the helper built, even when the
 * face graph merged it with a neighbour), in the shape `publishFacePicks`
 * takes.
 * @returns {{ picks: object[], names: string[] } | { error: { code: string, message: string } }}
 */
export function resolveFaceNames(table, names) {
  const list = Array.isArray(names) ? names : (names ? [names] : []);
  if (!list.length) return { error: { code: 'bad_args', message: 'select_faces needs at least one name' } };
  const picks = [];
  const picked = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { error: { code: 'bad_args', message: 'face names must be non-empty strings (see list_faces rows: name)' } };
    }
    const hits = facesForName(table, raw);
    if (!hits.length) {
      const all = (table?.faces || []).map((f) => f.name);
      return { error: { code: 'unknown_face', message: `No face named ${JSON.stringify(raw)}; ${describeAvailable(all)}` } };
    }
    for (const f of hits) {
      picks.push({ center: f.center.slice(), normal: f.normal.slice(), area: f.area, indices: f.tris.slice(), name: f.name });
      picked.push(f.name);
    }
  }
  return { picks, names: picked };
}

/**
 * The feature edges (rows from buildFeatureEdges with tri0 / tri1) that lie
 * on the named edges for `select_edges { names }`: `a~b`, `a~b[k]`, or a
 * glob. An edge name is the two face names joined by `~` in either order.
 * @returns {{ edges: object[], names: string[] } | { error: { code: string, message: string } }}
 */
export function resolveEdgeNames(table, featureEdges, names) {
  const list = Array.isArray(names) ? names : (names ? [names] : []);
  if (!list.length) return { error: { code: 'bad_args', message: 'select_edges needs at least one name' } };
  const triFace = table?.triFace;
  const edgesByName = table?.edges || [];
  if (!triFace || !edgesByName.length) {
    return { error: { code: 'unknown_edge', message: 'this mesh has no named edges (nothing a stamped helper built)' } };
  }
  const faceIndex = new Map((table.faces || []).map((f) => [f.name, f.id]));
  const out = [];
  const seen = new Set();
  const picked = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { error: { code: 'bad_args', message: 'edge names must be non-empty strings (faceA~faceB, see __VIEWPORT__.faceTable or list_edges rows)' } };
    }
    const match = matchEdgeName(edgesByName, raw);
    if (match.error) {
      return { error: { code: match.error === 'bad_name' ? 'bad_args' : 'unknown_edge', message: `${match.message}; ${describeEdgeNames(edgesByName, 12)}` } };
    }
    for (const e of match.hits) {
      const fa = faceIndex.get(e.faces[0]);
      const fb = faceIndex.get(e.faces[1]);
      // Only this chain's segments: a pair with several chains keeps [k] apart.
      const chainKeys = new Set(e.segments.map(([u, w]) => pairKey(u, w)));
      let n = 0;
      for (const row of Array.isArray(featureEdges) ? featureEdges : []) {
        if (row.tri0 == null || row.tri1 == null) continue;
        const a = triFace[row.tri0];
        const b = triFace[row.tri1];
        if (!((a === fa && b === fb) || (a === fb && b === fa))) continue;
        if (Number.isFinite(row.a) && Number.isFinite(row.b) && !chainKeys.has(pairKey(row.a, row.b))) continue;
        const key = `${row.tri0}:${row.tri1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
        n += 1;
      }
      if (!n) {
        return { error: { code: 'unknown_edge', message: `Edge ${e.name} has no feature-edge segments (the two faces meet below the 2° gate)` } };
      }
      picked.push(e.name);
    }
  }
  return { edges: out, names: picked };
}
