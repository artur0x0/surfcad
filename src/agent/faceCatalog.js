import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { classifySelectedFace } from '../utils/faceFeaturePlacement.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { fitJointAxis } from '../utils/jointResolve.js';

const FACE_ID_RE = /^f(\d+)$/;

/** Per-triangle Manifold face ids from a BufferGeometry, when present. */
export function faceIDsForGeometry(geometry) {
  const attr = geometry?.getAttribute?.('faceID');
  const arr = attr?.array;
  return arr?.length ? arr : null;
}

/** `f<patch id>`: the face-graph patch a single viewport click selects. */
export function agentFaceId(patchId) {
  return `f${patchId}`;
}

export function parseAgentFaceId(raw) {
  if (Number.isInteger(raw) && raw >= 0) return raw;
  const match = typeof raw === 'string' ? FACE_ID_RE.exec(raw.trim()) : null;
  return match ? Number(match[1]) : null;
}

function faceType(face, axis) {
  if (axis) return 'cylindrical';
  if (face.kind === 'planar') return 'planar';
  return 'curved';
}

/**
 * The agent face catalog: one row per face-graph patch, across every body in
 * the mesh, with no size filter. It is the graph a viewport click, a paint
 * tap, and the joint refresh catalog (`catalogFromMeshData`) read, so a row
 * is exactly one pickable face and its key matches the joint catalog. The
 * patch id is deterministic for a given mesh, so a rerun of the same script
 * keeps every id.
 *
 * @returns {Array<{ id: number, faceId: string, tris: number[], at: number[], n: number[], area: number, kind: string, type: string, axis: object|null, src?: number, ord?: number }>}
 */
export function agentFaceCatalog(geometry, faceIDs = null) {
  const positions = geometry?.attributes?.position?.array;
  const indices = geometry?.index?.array;
  if (!positions || !indices?.length) return [];
  const ids = faceIDs || faceIDsForGeometry(geometry);
  const fingerprints = fingerprintsFromGeometry(geometry, ids);
  return fingerprints.map((face) => {
    const axis = fitJointAxis(positions, indices, face.tris) || null;
    return {
      ...face,
      faceId: agentFaceId(face.id),
      type: faceType(face, axis),
      axis,
    };
  });
}

/** The catalog row for a `face_id` or a face key. */
export function findAgentFace(catalog, { faceId = null, key = null } = {}) {
  const rows = Array.isArray(catalog) ? catalog : [];
  if (faceId != null && faceId !== '') {
    const id = parseAgentFaceId(faceId);
    if (id == null) {
      return { error: { code: 'bad_args', message: `face_id must look like f12 (got ${JSON.stringify(faceId)})` } };
    }
    const face = rows.find((row) => row.id === id);
    if (!face) {
      return { error: { code: 'unknown_face', message: `Face ${agentFaceId(id)} is not on this part. Call list_faces for current ids.` } };
    }
    return { face };
  }
  if (!key || typeof key !== 'object') {
    return { error: { code: 'bad_args', message: 'Pass face_id or a face key' } };
  }
  const hit = matchFaceKeys(rows, [{ key }]);
  if (hit.ambiguous.length) {
    return { error: { code: 'ambiguous_face', message: 'Face key matches more than one face. Pass face_id from list_faces.' } };
  }
  const face = hit.matched[0]?.face;
  if (!face) {
    return { error: { code: 'unknown_face', message: 'Face key not found on this part mesh. Call list_faces for current faces.' } };
  }
  return { face };
}

/**
 * Joint reference for one catalog row, decided the way a viewport tap in the
 * Joints card decides it: a patch that fits an axis is an axis pick, a flat
 * is a face pick, anything else is refused.
 */
export function jointPickForFace(face) {
  if (!face) {
    return { error: { code: 'unknown_face', message: 'Face not found on this part mesh' } };
  }
  if (face.axis) {
    return {
      kind: 'axis',
      planar: false,
      axis: true,
      key: { at: face.axis.at.slice(), dir: face.axis.dir.slice(), radius: face.axis.radius },
    };
  }
  const classified = classifySelectedFace({
    center: face.at,
    normal: face.n,
    area: face.area,
    triangleCount: face.tris?.length || 0,
    selectionMode: face.kind === 'planar' ? 'coplanar' : 'angular-tolerance',
  });
  const area = Number(classified?.area) || 0;
  if (classified?.type === 'planar' && area > 0) {
    return {
      kind: 'face',
      planar: true,
      axis: false,
      key: { at: classified.center.slice(), n: classified.normal.slice(), area },
    };
  }
  return {
    error: {
      code: 'pick_failed',
      message: `Face ${face.faceId} is curved with no axis, so it cannot be a joint reference`,
    },
  };
}
