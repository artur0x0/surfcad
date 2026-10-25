import { faceColorKey } from '../../utils/faceColorMatch.js';
import { edgeKey } from '../../utils/selectEdge.js';
import { realizeAgentFaceCatalog } from '../faceCatalog.js';

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
