import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { edgeKey } from '../utils/selectEdge.js';
import { serializeFaceKey } from './state/listPickables.js';

const BOUNDARY_EDGE_KEY_RE = /^e(\d+)$/;

function vec3(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const out = [Number(value[0]), Number(value[1]), Number(value[2])];
    return out.every((n) => Number.isFinite(n)) ? out : null;
  }
  if (typeof value === 'object') {
    const out = [Number(value.x), Number(value.y), Number(value.z)];
    return out.every((n) => Number.isFinite(n)) ? out : null;
  }
  return null;
}

function readFaceKey(raw, { allowZeroArea = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const at = vec3(raw.at);
  const n = vec3(raw.n);
  const area = Number(raw.area);
  const areaOk = allowZeroArea
    ? Number.isFinite(area) && area >= 0
    : area > 0;
  if (!at || !n || !areaOk) return null;
  const key = { at, n, area };
  if (Number.isInteger(raw.src) && raw.src < 0) {
    key.src = raw.src;
    if (Number.isInteger(raw.ord) && raw.ord >= 0) key.ord = raw.ord;
  }
  return key;
}

function keysMatchLoose(a, b) {
  if (!a || !b) return false;
  const atA = vec3(a.at);
  const atB = vec3(b.at);
  const nA = vec3(a.n);
  const nB = vec3(b.n);
  if (!atA || !atB || !nA || !nB) return false;
  const dist = Math.hypot(atA[0] - atB[0], atA[1] - atB[1], atA[2] - atB[2]);
  if (dist > 1.01) return false;
  const dot = nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2];
  return dot > Math.cos((8 * Math.PI) / 180);
}

/**
 * Resolve stable face keys against mesh fingerprints.
 * @returns {{ picks: object[], error?: { code: string, message: string } }}
 */
export function resolveFaceKeys(fingerprints, keys) {
  const list = Array.isArray(keys) ? keys : (keys ? [keys] : []);
  if (!list.length) {
    return { error: { code: 'bad_args', message: 'select_faces needs at least one face key' } };
  }
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const key = readFaceKey(list[i]);
    if (!key) {
      return { error: { code: 'bad_args', message: `face key at index ${i} must include at, n, and area` } };
    }
    items.push({ key });
  }
  const { matched, ambiguous, missing } = matchFaceKeys(fingerprints, items);
  if (ambiguous.length) {
    return { error: { code: 'ambiguous_face', message: 'Face key matches more than one patch' } };
  }
  if (missing.length) {
    return { error: { code: 'unknown_face', message: 'Face key did not match any patch on the active mesh' } };
  }
  const picks = matched.map((row) => faceToAgentPick(row.face));
  return { picks };
}

/** Same triangle list and area as a viewport face pick. */
export function faceToAgentPick(face) {
  if (!face) {
    return { center: null, normal: null, area: 0, indices: [] };
  }
  const tris = Array.isArray(face.tris) ? face.tris.slice() : [];
  return {
    center: vec3(face.at)?.slice() || null,
    normal: vec3(face.n)?.slice() || null,
    area: Number(face.area),
    indices: tris,
  };
}

function readEdgeFacePair(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.faceKeyA && raw.faceKeyB) {
    return { faceKeyA: raw.faceKeyA, faceKeyB: raw.faceKeyB };
  }
  if (raw.faceA && raw.faceB) {
    return { faceKeyA: raw.faceA, faceKeyB: raw.faceB };
  }
  if (Array.isArray(raw.faceKeys) && raw.faceKeys.length === 2) {
    return { faceKeyA: raw.faceKeys[0], faceKeyB: raw.faceKeys[1] };
  }
  return null;
}

function keyMatchesFace(fingerprint, queryKey) {
  const { matched, missing, ambiguous } = matchFaceKeys([fingerprint], [{ key: queryKey }]);
  return matched.length === 1 && !missing.length && !ambiguous.length;
}

function edgeFromAdjacentFaceKeys(featureEdges, fingerprints, faceKeyA, faceKeyB) {
  const owners = new Map();
  for (const face of fingerprints) {
    const tris = face?.tris;
    if (!Array.isArray(tris)) continue;
    for (let i = 0; i < tris.length; i++) owners.set(tris[i], face);
  }
  const hits = [];
  for (const edge of featureEdges) {
    if (edge.tri0 == null || edge.tri1 == null) continue;
    const fa = owners.get(edge.tri0);
    const fb = owners.get(edge.tri1);
    if (!fa || !fb) continue;
    const forward = keyMatchesFace(fa, faceKeyA) && keyMatchesFace(fb, faceKeyB);
    const reverse = keyMatchesFace(fa, faceKeyB) && keyMatchesFace(fb, faceKeyA);
    if (forward || reverse) hits.push(edge);
  }
  return hits;
}

function edgeFromFaceKeys(featureEdges, faceKeyA, faceKeyB) {
  const hits = [];
  for (const edge of featureEdges) {
    const mid = vec3(edge.mid);
    const n0 = vec3(edge.n0);
    const n1 = vec3(edge.n1);
    if (!mid || !n0 || !n1) continue;
    const a = { at: mid, n: n0, area: 0 };
    const b = { at: mid, n: n1, area: 0 };
    const forward = keysMatchLoose(a, faceKeyA) && keysMatchLoose(b, faceKeyB);
    const reverse = keysMatchLoose(a, faceKeyB) && keysMatchLoose(b, faceKeyA);
    if (forward || reverse) hits.push(edge);
  }
  return hits;
}

function topoFaceToKey(face) {
  if (!face) return null;
  const at = vec3(face.center) || vec3(face.at);
  const n = vec3(face.normal) || vec3(face.n);
  const area = Number(face.area);
  if (!at || !n || !Number.isFinite(area)) return null;
  return serializeFaceKey({ at, n, area });
}

function resolveBoundaryKey(raw, topo, featureEdges, fingerprints) {
  const match = BOUNDARY_EDGE_KEY_RE.exec(raw);
  if (!match) return null;
  const id = Number(match[1]);
  const boundary = (topo?.edges || []).find((row) => row.id === id);
  if (!boundary) {
    return { error: { code: 'unknown_edge', message: `Boundary edge not found: ${raw}` } };
  }
  const faceById = new Map();
  for (const face of topo?.faces || []) {
    if (face && Number.isFinite(face.id)) faceById.set(face.id, face);
  }
  const faceKeyA = topoFaceToKey(faceById.get(boundary.faceA));
  const faceKeyB = topoFaceToKey(faceById.get(boundary.faceB));
  if (faceKeyA && faceKeyB) {
    const hits = edgeFromAdjacentFaceKeys(featureEdges, fingerprints, faceKeyA, faceKeyB);
    if (hits.length === 1) {
      return {
        edge: {
          ...hits[0],
          boundaryId: boundary.id,
          faceA: boundary.faceA,
          faceB: boundary.faceB,
        },
      };
    }
    if (hits.length > 1) {
      return { error: { code: 'ambiguous_edge', message: 'Boundary edge matches more than one mesh segment' } };
    }
  }
  const seg = boundary.segments?.[0];
  if (seg?.key) {
    const hit = featureEdges.find((edge) => edgeKey(edge) === seg.key) || null;
    if (hit) {
      return {
        edge: {
          ...hit,
          boundaryId: boundary.id,
          faceA: boundary.faceA,
          faceB: boundary.faceB,
        },
      };
    }
  }
  return { error: { code: 'unknown_edge', message: `Could not resolve boundary edge: ${raw}` } };
}

/**
 * @returns {{ edges: object[], error?: { code: string, message: string } }}
 */
export function resolveEdgeKeys(featureEdges, keys, partId = null, fingerprints = [], topo = null) {
  const list = Array.isArray(keys) ? keys : (keys ? [keys] : []);
  if (!list.length) {
    return { error: { code: 'bad_args', message: 'select_edges needs at least one edge key' } };
  }
  const edges = Array.isArray(featureEdges) ? featureEdges : [];
  const resolved = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    let hit = null;
    if (typeof raw === 'string' && raw) {
      if (BOUNDARY_EDGE_KEY_RE.test(raw)) {
        const resolvedBoundary = resolveBoundaryKey(raw, topo, edges, fingerprints);
        if (resolvedBoundary?.error) return resolvedBoundary;
        if (resolvedBoundary?.edge) {
          hit = resolvedBoundary.edge;
        }
      }
      if (!hit) {
        hit = edges.find((edge) => edgeKey(edge) === raw) || null;
      }
      if (!hit) {
        return { error: { code: 'unknown_edge', message: `Edge key not found: ${raw}` } };
      }
    } else if (raw && typeof raw === 'object') {
      const pair = readEdgeFacePair(raw);
      if (!pair) {
        return { error: { code: 'bad_args', message: `edge key at index ${i} needs faceKeyA/faceKeyB, faceA/faceB, or faceKeys[2]` } };
      }
      const fullA = readFaceKey(pair.faceKeyA);
      const fullB = readFaceKey(pair.faceKeyB);
      let hits;
      if (fullA && fullB) {
        hits = edgeFromAdjacentFaceKeys(edges, fingerprints, fullA, fullB);
      } else {
        const faceKeyA = readFaceKey(pair.faceKeyA, { allowZeroArea: true });
        const faceKeyB = readFaceKey(pair.faceKeyB, { allowZeroArea: true });
        if (!faceKeyA || !faceKeyB) {
          return { error: { code: 'bad_args', message: `edge key at index ${i} needs valid face keys` } };
        }
        hits = edgeFromFaceKeys(edges, faceKeyA, faceKeyB);
      }
      if (hits.length > 1) {
        return { error: { code: 'ambiguous_edge', message: 'Edge face-key pair matches more than one edge' } };
      }
      if (!hits.length) {
        return { error: { code: 'unknown_edge', message: 'Edge face-key pair did not match any feature edge' } };
      }
      hit = hits[0];
    } else {
      return { error: { code: 'bad_args', message: `edge key at index ${i} must be a string or face-key pair` } };
    }
    if (partId != null && partId !== '') {
      resolved.push({ ...hit, partId: String(partId) });
    } else {
      resolved.push(hit);
    }
  }
  return { edges: resolved };
}
