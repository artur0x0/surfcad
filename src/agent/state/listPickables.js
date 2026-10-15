import { faceColorKey } from '../../utils/faceColorMatch.js';
import { edgeKey } from '../../utils/selectEdge.js';

function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

function serializeFaceKey(face) {
  const key = faceColorKey(face);
  if (!key) return null;
  return JSON.parse(JSON.stringify(key));
}

/**
 * @param {Array<{ at: number[], n: number[], area: number, tris?: number[] }>} fingerprints
 */
export function buildFaceList(fingerprints) {
  const list = Array.isArray(fingerprints) ? fingerprints : [];
  const faces = [];
  for (const face of list) {
    const key = serializeFaceKey(face);
    if (!key) continue;
    const center = vec3(face.at);
    const normal = vec3(face.n);
    const tris = Array.isArray(face.tris) ? face.tris : [];
    faces.push({
      key,
      center,
      normal,
      area: Number(face.area),
      triangleCount: tris.length,
    });
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
export function buildEdgeList(featureEdges, fingerprints) {
  const owners = triOwner(fingerprints);
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
