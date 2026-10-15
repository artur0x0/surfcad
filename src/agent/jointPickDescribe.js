import { classifySelectedFace } from '../utils/faceFeaturePlacement.js';
import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { fitJointAxis } from '../utils/jointResolve.js';

function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

/**
 * Same joint reference shape as a viewport tap while the joint card is open.
 * @param {{ key: object, faceIDs?: object, geometry: object }} input
 */
export function describeJointPickFromFaceMesh({ key, faceIDs, geometry }) {
  if (!geometry || !key) {
    return { error: { code: 'bad_args', message: 'Missing geometry or face key' } };
  }
  const fingerprints = fingerprintsFromGeometry(geometry, faceIDs);
  const hit = matchFaceKeys(fingerprints, [{ key }]);
  if (hit.matched.length !== 1) {
    return {
      error: {
        code: hit.ambiguous.length ? 'ambiguous_face' : 'unknown_face',
        message: hit.ambiguous.length
          ? 'Face key is ambiguous on this part'
          : 'Face key not found on this part mesh',
      },
    };
  }
  const face = hit.matched[0].face;
  const center = vec3(face.at);
  const normal = vec3(face.n);
  const area = Number(face.area);
  const classified = classifySelectedFace({
    center,
    normal,
    area,
    indices: Array.isArray(face.tris) ? face.tris : undefined,
    triangleCount: Array.isArray(face.tris) ? face.tris.length : 0,
    selectionMode: 'coplanar',
  }) || { center, normal, area, type: 'planar' };
  const positions = geometry.attributes?.position?.array;
  const index = geometry.index?.array;
  const tris = face.tris;
  const axis = (positions && index && tris) ? fitJointAxis(positions, index, tris) : null;
  const useArea = Number(classified.area) || area || 0;
  if (axis) {
    return { kind: 'axis', planar: false, axis: true, key: axis };
  }
  if (classified.type === 'planar' && useArea > 0 && center && normal) {
    return {
      kind: 'face',
      planar: true,
      axis: false,
      key: { at: center.slice(), n: normal.slice(), area: useArea },
    };
  }
  return { error: { code: 'pick_failed', message: 'Face is not usable for a joint reference' } };
}

export function describeJointPickFromExplicit({ key, kind }) {
  const at = vec3(key?.at);
  const dir = vec3(key?.dir);
  const radius = Number(key?.radius);
  const length = Number(key?.length);
  const hasAxisKey = dir && Number.isFinite(radius) && radius > 0 && !Number.isFinite(length);
  if (kind === 'axis' || hasAxisKey) {
    if (!at || !dir) {
      return { error: { code: 'bad_args', message: 'Axis key needs at, dir, and radius' } };
    }
    if (!(radius > 0)) {
      return { error: { code: 'bad_args', message: 'Axis key needs a positive radius' } };
    }
    return {
      kind: 'axis',
      planar: false,
      axis: true,
      key: { at, dir, radius },
    };
  }
  if (kind === 'edge' || (dir && Number.isFinite(length))) {
    if (!at || !dir) {
      return { error: { code: 'bad_args', message: 'Edge key needs at and dir' } };
    }
    return {
      kind: 'edge',
      planar: false,
      axis: Number.isFinite(radius) && radius > 0,
      key: { ...key, at, dir },
    };
  }
  return null;
}

/**
 * Classify an agent joint pick the same way viewport face/edge taps do.
 */
export function describeJointPick({ key, kind, geometry, faceIDs }) {
  const explicit = describeJointPickFromExplicit({ key, kind });
  if (explicit) {
    return explicit.error ? explicit : explicit;
  }
  if (!geometry?.attributes?.position) {
    return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
  }
  return describeJointPickFromFaceMesh({ key, faceIDs, geometry });
}
