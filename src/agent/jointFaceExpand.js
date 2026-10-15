import { classifySelectedFace } from '../utils/faceFeaturePlacement.js';
import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { resolveViewportFaceClick } from '../utils/selectFace.js';
import { fitJointAxis } from '../utils/jointResolve.js';
import { agentFaceFingerprints, faceIDsForGeometry } from './faceCatalog.js';

function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

function seedTriangleForKey(geometry, fingerprints, hit, key) {
  const pick = hit.matched[0]?.face || hit.ambiguous[0]?.face;
  if (pick?.tris?.length) return pick.tris[0];
  const want = vec3(key?.at);
  const positions = geometry?.attributes?.position?.array;
  const index = geometry?.index?.array;
  if (!want || !positions || !index) return null;
  let best = null;
  let bestD = Infinity;
  for (const face of fingerprints) {
    for (const tri of face.tris || []) {
      const i0 = index[tri * 3];
      const i1 = index[tri * 3 + 1];
      const i2 = index[tri * 3 + 2];
      const mx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
      const my = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
      const mz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
      const d = (mx - want[0]) ** 2 + (my - want[1]) ** 2 + (mz - want[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = tri;
      }
    }
  }
  return best;
}

export function faceMetricsFromIndices(geometry, indices, selectionMode) {
  const positions = geometry.attributes.position;
  const index = geometry.index?.array;
  if (!positions || !index || !indices?.length) return null;
  let ax = 0;
  let ay = 0;
  let az = 0;
  let area = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let bestA = 0;
  for (const faceIdx of indices) {
    const i0 = index[faceIdx * 3];
    const i1 = index[faceIdx * 3 + 1];
    const i2 = index[faceIdx * 3 + 2];
    const x0 = positions.getX(i0);
    const y0 = positions.getY(i0);
    const z0 = positions.getZ(i0);
    const x1 = positions.getX(i1);
    const y1 = positions.getY(i1);
    const z1 = positions.getZ(i1);
    const x2 = positions.getX(i2);
    const y2 = positions.getY(i2);
    const z2 = positions.getZ(i2);
    const ab = [x1 - x0, y1 - y0, z1 - z0];
    const ac = [x2 - x0, y2 - y0, z2 - z0];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    const a = 0.5 * Math.hypot(cx, cy, cz);
    if (!(a > 0)) continue;
    const mx = (x0 + x1 + x2) / 3;
    const my = (y0 + y1 + y2) / 3;
    const mz = (z0 + z1 + z2) / 3;
    ax += mx * a;
    ay += my * a;
    az += mz * a;
    area += a;
    if (a > bestA) {
      bestA = a;
      const len = Math.hypot(cx, cy, cz);
      if (len > 1e-12) {
        nx = cx / len;
        ny = cy / len;
        nz = cz / len;
      }
    }
  }
  if (!(area > 0)) return null;
  return {
    center: [ax / area, ay / area, az / area],
    normal: [nx, ny, nz],
    area,
    indices: indices.slice(),
    triangleCount: indices.length,
    selectionMode,
  };
}

export function patchSignatureFromIndices(indices) {
  const sorted = indices.slice().sort((a, b) => a - b);
  return `${sorted.length}:${sorted[0]}:${sorted[sorted.length - 1]}`;
}

/**
 * Expand a list_faces key to the same triangle patch a viewport single-click would use.
 */
export function resolvePatchFromFaceKey({ geometry, faceIDs, key }) {
  const ids = faceIDs || faceIDsForGeometry(geometry);
  const fingerprints = agentFaceFingerprints(geometry, ids);
  const hit = matchFaceKeys(fingerprints, [{ key }]);
  if (!hit.matched.length && !hit.ambiguous.length) {
    return { error: { code: 'unknown_face', message: 'Face key not found on this part mesh' } };
  }
  const pickFace = hit.matched[0]?.face || hit.ambiguous[0]?.face;
  const seed = seedTriangleForKey(geometry, fingerprints, hit, key);
  if (seed == null) {
    return { error: { code: 'unknown_face', message: 'Face key not found on this part mesh' } };
  }
  const resolved = resolveViewportFaceClick({
    geometry,
    seedFaceIndex: seed,
    faceNormal: key?.n,
    clickCount: 1,
    faceIDs: ids,
    legacy: false,
  });
  let indices = resolved?.indices || [];
  const positions = geometry?.attributes?.position?.array;
  const indexArr = geometry?.index?.array;
  const mergedTris = pickFace?.tris;
  if (mergedTris?.length && positions && indexArr) {
    const axisOnMerged = mergedTris.length >= 4 ? fitJointAxis(positions, indexArr, mergedTris) : null;
    const axisOnPatch = indices.length >= 4 ? fitJointAxis(positions, indexArr, indices) : null;
    if (axisOnMerged) indices = mergedTris;
    else if (!axisOnPatch && mergedTris.length > indices.length) indices = mergedTris;
  }
  if (!indices.length) {
    return { error: { code: 'pick_failed', message: 'Face is not usable for a joint reference' } };
  }
  const metrics = faceMetricsFromIndices(geometry, indices, resolved.selectionMode);
  if (!metrics) {
    return { error: { code: 'pick_failed', message: 'Face is not usable for a joint reference' } };
  }
  return {
    metrics,
    indices,
    kind: resolved.kind,
    selectionMode: resolved.selectionMode,
    sig: patchSignatureFromIndices(indices),
  };
}

export function describeExpandedFaceJointPick({ geometry, faceIDs, key }) {
  const expanded = resolvePatchFromFaceKey({ geometry, faceIDs, key });
  if (expanded.error) return expanded;
  const { metrics, indices, selectionMode } = expanded;
  const ids = faceIDs || faceIDsForGeometry(geometry);
  const fingerprints = agentFaceFingerprints(geometry, ids);
  const hit = matchFaceKeys(fingerprints, [{ key }]);
  const catalogFace = hit.matched[0]?.face || hit.ambiguous[0]?.face;
  if (catalogFace?.axis) {
    return {
      kind: 'axis',
      planar: false,
      axis: true,
      key: catalogFace.axis,
    };
  }
  const classified = classifySelectedFace({
    center: metrics.center,
    normal: metrics.normal,
    area: metrics.area,
    indices: metrics.indices,
    triangleCount: metrics.triangleCount,
    selectionMode,
  }) || { ...metrics, type: 'planar' };
  const positions = geometry.attributes?.position?.array;
  const index = geometry.index?.array;
  const axis = (positions && index) ? fitJointAxis(positions, index, indices) : null;
  const useArea = Number(classified.area) || metrics.area || 0;
  const center = vec3(classified.center) || vec3(metrics.center);
  const normal = vec3(classified.normal) || vec3(metrics.normal);
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
