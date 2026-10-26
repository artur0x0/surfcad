import { faceColorKey } from '../../utils/faceColorMatch.js';
import { edgeKey } from '../../utils/selectEdge.js';
import { realizeAgentFaceCatalog } from '../faceCatalog.js';
import { vertexPairKey } from '../../lib/surfcad/namedEdges.js';

function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

export function serializeFaceKey(face) {
  const key = faceColorKey(face);
  if (!key) return null;
  return JSON.parse(JSON.stringify(key));
}

function topoFaceToKey(face) {
  if (!face) return null;
  const center = vec3(face.center) || vec3(face.at);
  const normal = vec3(face.normal) || vec3(face.n);
  const area = Number(face.area);
  if (!center || !normal || !Number.isFinite(area)) return null;
  return serializeFaceKey({ at: center, n: normal, area });
}

/**
 * @param {Array<{ faceId?: string, type?: string, at: number[], n: number[], area: number, tris?: number[], axis?: object }>} catalog
 *   rows from `agentFaceCatalog`
 */
export function buildFaceList(catalog) {
  const list = realizeAgentFaceCatalog(catalog);
  const faces = [];
  for (const face of list) {
    const key = serializeFaceKey(face);
    if (!key) continue;
    const center = vec3(face.at);
    const normal = vec3(face.n);
    const tris = Array.isArray(face.tris) ? face.tris : [];
    const row = {};
    if (face.faceId) row.id = face.faceId;
    // Face identity: the stamped name (feature.role[k]) when the helper
    // that built the face recorded one. Absent on unstamped geometry.
    if (typeof face.name === 'string' && face.name) {
      row.name = face.name;
      row.feature = face.feature;
      row.role = face.role;
      if (Array.isArray(face.names) && face.names.length > 1) row.names = face.names.slice();
    }
    row.type = face.type || 'planar';
    row.kind = row.type;
    row.key = key;
    row.center = center;
    row.normal = normal;
    row.area = Number(face.area);
    const bmin = vec3(face.bounds?.min);
    const bmax = vec3(face.bounds?.max);
    if (bmin && bmax) row.bounds = { min: bmin, max: bmax };
    row.triangleCount = tris.length;
    const axisAt = vec3(face.axis?.at);
    const axisDir = vec3(face.axis?.dir);
    const axisRadius = Number(face.axis?.radius);
    if (axisAt && axisDir && axisRadius > 0) {
      row.type = 'cylindrical';
      row.kind = 'cylindrical';
      row.axis = { at: axisAt, dir: axisDir, radius: axisRadius };
      row.radius = axisRadius;
    }
    faces.push(row);
  }
  return { faces };
}

function triOwner(fingerprints) {
  const map = new Map();
  for (const face of fingerprints) {
    const tris = face?.tris;
    if (!Array.isArray(tris)) continue;
    for (let i = 0; i < tris.length; i++) map.set(tris[i], face);
  }
  return map;
}

/**
 * @param {object[]} featureEdges from buildFeatureEdges (may include tri0/tri1)
 * @param {Array} fingerprints
 */
export function buildEdgeList(featureEdges, fingerprints, faceTable = null) {
  const owners = triOwner(fingerprints);
  const triFace = faceTable?.triFace || null;
  const namedFaces = faceTable?.faces || [];
  const edges = [];
  for (const edge of Array.isArray(featureEdges) ? featureEdges : []) {
    const key = edgeKey(edge);
    const mid = vec3(edge.mid);
    const length = Number(edge.length);
    const faceA = edge.tri0 != null ? owners.get(edge.tri0) : null;
    const faceB = edge.tri1 != null ? owners.get(edge.tri1) : null;
    const faceKeyA = faceA ? serializeFaceKey(faceA) : null;
    const faceKeyB = faceB ? serializeFaceKey(faceB) : null;
    const row = {
      key,
      mid,
      length: Number.isFinite(length) ? length : null,
    };
    // Face identity: the two stamped faces the edge lies between, when known.
    if (triFace && edge.tri0 != null && edge.tri1 != null) {
      const a = triFace[edge.tri0];
      const b = triFace[edge.tri1];
      if (a >= 0 && namedFaces[a]) row.faceNameA = namedFaces[a].name;
      if (b >= 0 && namedFaces[b]) row.faceNameB = namedFaces[b].name;
      // Canonical: the two faces in name order, the same name select_edges reports.
      if (row.faceNameA && row.faceNameB) row.name = [row.faceNameA, row.faceNameB].sort().join('~');
    }
    if (faceKeyA && faceKeyB) {
      row.faceKeyA = faceKeyA;
      row.faceKeyB = faceKeyB;
    } else if (mid) {
      const n0 = vec3(edge.n0);
      const n1 = vec3(edge.n1);
      if (n0) row.faceKeyA = { at: mid, n: n0, area: 0 };
      if (n1) row.faceKeyB = { at: mid, n: n1, area: 0 };
    }
    edges.push(row);
  }
  return { edges };
}

/**
 * Edge identity: one row per named edge chain of the stamped face table,
 * keyed by its name (`plate.top~boss.side`, `[k]` for one chain of a pair).
 * The name is the key `select_edges`, `pick_next` and the script
 * (`edgesNamed`) take, and the two face keys come from the same face
 * catalog `list_faces` returns, so centres and normals agree with it
 * (B5). Chains with no crease the pick graph keeps (a coplanar seam
 * between two names) are left out, like the UI cannot pick them.
 *
 * @param {{ edges?: object[] }} table from stampedFaceTable
 * @param {Array} fingerprints face-graph patches (the list_faces catalog)
 * @param {object[]} featureEdges from buildFeatureEdges (a, b per segment)
 */
export function buildNamedEdgeList(table, fingerprints, featureEdges) {
  const owners = triOwner(Array.isArray(fingerprints) ? fingerprints : []);
  const sharp = new Set();
  for (const edge of Array.isArray(featureEdges) ? featureEdges : []) {
    if (Number.isFinite(edge?.a) && Number.isFinite(edge?.b)) sharp.add(vertexPairKey(edge.a, edge.b));
  }
  const edges = [];
  for (const chain of table?.edges || []) {
    const segs = Array.isArray(chain.segments) ? chain.segments : [];
    if (!segs.length) continue;
    if (sharp.size && !segs.some(([u, w]) => sharp.has(vertexPairKey(u, w)))) continue;
    const row = {
      key: chain.name,
      name: chain.name,
      faceNameA: chain.faces[0],
      faceNameB: chain.faces[1],
      mid: vec3(chain.center),
      length: Number.isFinite(chain.length) ? chain.length : null,
      closed: chain.closed === true,
      chains: Number.isFinite(chain.chains) ? chain.chains : 1,
      ordinal: Number.isFinite(chain.ordinal) ? chain.ordinal : 0,
    };
    const [t0, t1] = Array.isArray(chain.tris?.[0]) ? chain.tris[0] : [];
    const faceA = t0 != null ? owners.get(t0) : null;
    const faceB = t1 != null ? owners.get(t1) : null;
    const keyA = faceA ? serializeFaceKey(faceA) : null;
    const keyB = faceB ? serializeFaceKey(faceB) : null;
    if (keyA && keyB) {
      row.faceKeyA = keyA;
      row.faceKeyB = keyB;
    }
    edges.push(row);
  }
  return { edges };
}

/**
 * Topology-stable edges: one row per boundary-edge id from `indexBoundaryEdges`.
 * Keys are short (`e0`, `e1`, …) for `select_edges`.
 *
 * @param {{ faces?: object[], edges?: object[] }} topo
 */
export function buildGroupedEdgeList(topo) {
  const faceById = new Map();
  for (const face of topo?.faces || []) {
    if (face && Number.isFinite(face.id)) faceById.set(face.id, face);
  }
  const edges = [];
  for (const boundary of topo?.edges || []) {
    if (!Number.isFinite(boundary.id)) continue;
    const mid = vec3(boundary.mid);
    const length = Number(boundary.length);
    const faceA = faceById.get(boundary.faceA);
    const faceB = faceById.get(boundary.faceB);
    const row = {
      key: `e${boundary.id}`,
      mid,
      length: Number.isFinite(length) ? length : null,
    };
    const faceKeyA = topoFaceToKey(faceA);
    const faceKeyB = topoFaceToKey(faceB);
    if (faceKeyA && faceKeyB) {
      row.faceKeyA = faceKeyA;
      row.faceKeyB = faceKeyB;
    }
    edges.push(row);
  }
  return { edges };
}
