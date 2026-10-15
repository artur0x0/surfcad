import { edgeKey } from '../../utils/selectEdge.js';

function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

function faceKeyFromFace(face) {
  if (!face) return null;
  const at = vec3(face.center) || vec3(face.at);
  const n = vec3(face.normal) || vec3(face.n);
  const area = Number(face.area);
  if (!at || !n || !(area > 0)) return null;
  const key = { at, n, area };
  if (Number.isInteger(face.src) && face.src < 0) {
    key.src = face.src;
    if (Number.isInteger(face.ord) && face.ord >= 0) key.ord = face.ord;
  }
  return key;
}

function serializeFace(face) {
  if (!face) return null;
  const center = vec3(face.center);
  const normal = vec3(face.normal);
  if (!center || !normal) return null;
  const out = {
    type: typeof face.type === 'string' ? face.type : 'planar',
    center,
    normal,
    area: Number.isFinite(Number(face.area)) ? Number(face.area) : 0,
  };
  const key = faceKeyFromFace(face);
  if (key) out.key = key;
  if (Array.isArray(face.group) && face.group.length > 1) {
    out.groupCount = face.group.length;
  }
  return out;
}

function serializeEdge(edge) {
  if (!edge) return null;
  const mid = vec3(edge.mid);
  const length = Number(edge.length);
  const row = {
    key: edgeKey(edge),
    partId: edge.partId != null && edge.partId !== '' ? String(edge.partId) : null,
    mid,
    length: Number.isFinite(length) ? length : null,
  };
  if (Number.isFinite(edge.faceA)) row.faceA = edge.faceA;
  if (Number.isFinite(edge.faceB)) row.faceB = edge.faceB;
  const n0 = vec3(edge.n0);
  const n1 = vec3(edge.n1);
  if (n0 && mid) row.faceKeyA = { at: mid, n: n0, area: 0 };
  if (n1 && mid) row.faceKeyB = { at: mid, n: n1, area: 0 };
  return row;
}

/**
 * @param {{
 *   activePartId?: string | null,
 *   cadPartId?: string | null,
 *   face?: object | null,
 *   edges?: object[],
 *   armedContourId?: string | null,
 *   selectedPlaneId?: string | null,
 * }} input
 */
export function buildSelection(input = {}) {
  const edges = Array.isArray(input.edges)
    ? input.edges.map(serializeEdge).filter(Boolean)
    : [];
  return {
    activePartId: input.activePartId ?? null,
    cadPartId: input.cadPartId ?? null,
    face: serializeFace(input.face),
    edges,
    contour: {
      armedId: input.armedContourId ?? null,
      planeId: input.selectedPlaneId ?? null,
    },
  };
}
