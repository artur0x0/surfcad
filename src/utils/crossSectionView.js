/**
 * Leftover helpers from the capped-solid section (Manifold `trimByPlane`).
 *
 * The viewer does not trim anymore. A section is a world-space clip in
 * `sectionClip.js` and does not replace geometry. These helpers stay so a
 * mesh that still carries a trim can be put back, and so the cap tests
 * still describe the worker output.
 */
import { Matrix4, Plane, Vector3 } from 'three';
import { cachedSolidGeometry, releaseGeometryIn, solidEntryForGeometry } from './partSolidCache.js';

/**
 * True when the composed assembly view is active (multiple parts visible).
 * Part-editor mode is a single active solid with no parked assembly meshes.
 */
export function isAssemblyCrossSectionScope(assemblyRunLockRef, assemblyExtrasRef) {
  if (assemblyRunLockRef?.current === true) return true;
  return (assemblyExtrasRef?.current?.size ?? 0) > 0;
}

/** Uncut mesh data for a part, even while a trimmed solid is on screen. */
export function sourceMeshData(mesh, solidCache) {
  const restored = mesh?.userData?.crossSectionRestore?.meshData;
  if (restored?.vertProperties) return restored;
  return solidEntryForGeometry(solidCache, mesh?.geometry)?.meshData ?? null;
}

/**
 * Meshes to section for the current scope.
 * @returns {{ mesh: import('three').Mesh, meshData: object, partId: string|null }[]}
 */
export function collectCrossSectionTargets({
  assemblyRunLockRef,
  resultRef,
  assemblyExtrasRef,
  solidCache,
  activePartIdRef,
}) {
  const targets = [];
  const assembly = isAssemblyCrossSectionScope(assemblyRunLockRef, assemblyExtrasRef);

  const pushMesh = (mesh, partId) => {
    if (!mesh?.geometry?.attributes?.position?.count) return;
    const meshData = sourceMeshData(mesh, solidCache);
    if (!meshData?.vertProperties) return;
    targets.push({ mesh, meshData, partId: partId ?? null });
  };

  if (assembly) {
    pushMesh(resultRef?.current, activePartIdRef?.current ?? null);
    for (const [id, mesh] of assemblyExtrasRef?.current || []) {
      pushMesh(mesh, id);
    }
  } else {
    pushMesh(resultRef?.current, activePartIdRef?.current ?? null);
  }
  return targets;
}

/** Stable key for trim caches while dragging the section slider. */
export function crossSectionPlaneKey(normal, originOffset) {
  const n = new Vector3(...normal).normalize();
  return `${n.x.toFixed(6)},${n.y.toFixed(6)},${n.z.toFixed(6)}:${Number(originOffset).toFixed(6)}`;
}

export function getTrimCacheEntry(cache, meshData, planeKey) {
  return cache?.get(meshData)?.get(planeKey) ?? null;
}

export function setTrimCacheEntry(cache, meshData, planeKey, trimmed) {
  if (!cache || !meshData || !planeKey || !trimmed) return;
  let inner = cache.get(meshData);
  if (!inner) {
    inner = new Map();
    cache.set(meshData, inner);
  }
  inner.set(planeKey, trimmed);
}

/**
 * Transform a world-space cutting plane into a part's local space (mesh data frame).
 * Manifold trim uses unit normal and signed distance from origin along that normal.
 */
export function worldPlaneToLocalTrim(mesh, normal, originOffset) {
  const n = new Vector3(...normal).normalize();
  const coplanar = n.clone().multiplyScalar(Number(originOffset));
  const worldPlane = new Plane().setFromNormalAndCoplanarPoint(n, coplanar);
  const inv = new Matrix4().copy(mesh.matrixWorld).invert();
  const localPlane = worldPlane.clone().applyMatrix4(inv);
  const ln = localPlane.normal;
  return {
    normal: [ln.x, ln.y, ln.z],
    originOffset: -localPlane.constant,
  };
}

export function clearCrossSectionOnMesh(mesh, solidCache) {
  if (!mesh) return;
  const restore = mesh.userData?.crossSectionRestore;
  if (!restore?.meshData) {
    delete mesh.userData.crossSectionRestore;
    delete mesh.userData.crossSectionTrimmedMeshData;
    delete mesh.userData.crossSectionApplied;
    return;
  }
  const { geometry } = cachedSolidGeometry(solidCache, restore.meshData);
  const prev = mesh.geometry;
  if (prev !== geometry) {
    releaseGeometryIn(solidCache, prev);
    mesh.geometry = geometry;
  }
  delete mesh.userData.crossSectionRestore;
  delete mesh.userData.crossSectionTrimmedMeshData;
  delete mesh.userData.crossSectionApplied;
}

/** Restore every part that was sectioned. */
export function clearCrossSectionVisuals(targets, solidCache) {
  for (const { mesh } of targets) clearCrossSectionOnMesh(mesh, solidCache);
}

/**
 * Swap one mesh to a trimmed solid. `trimmedMeshData` comes from the worker.
 * `meshData` on the target must be the uncut source.
 */
export function applyTrimmedMeshToTarget(target, trimmedMeshData, solidCache, applied = null) {
  const { mesh, meshData } = target;
  if (!mesh || !trimmedMeshData?.vertProperties) return;
  if (!mesh.userData.crossSectionRestore) {
    mesh.userData.crossSectionRestore = { meshData };
  }
  mesh.userData.crossSectionTrimmedMeshData = trimmedMeshData;
  if (applied) mesh.userData.crossSectionApplied = applied;
  const { geometry } = cachedSolidGeometry(solidCache, trimmedMeshData);
  const prev = mesh.geometry;
  if (prev !== geometry) {
    releaseGeometryIn(solidCache, prev);
    mesh.geometry = geometry;
  }
}

/** Signed volume of mesh data (mm³). Prefers Manifold `volume` when present. */
export function remainingVolumeOf(meshData) {
  if (Number.isFinite(meshData?.volume)) return meshData.volume;
  const np = meshData?.numProp || 3;
  const p = meshData?.vertProperties;
  const t = meshData?.triVerts;
  if (!p || !t) return 0;
  let v = 0;
  for (let i = 0; i + 2 < t.length; i += 3) {
    const a = t[i] * np;
    const b = t[i + 1] * np;
    const c = t[i + 2] * np;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** Triangles that lie on the cutting plane (solid caps). */
export function countCapTriangles(meshData, normal, originOffset, eps = 0.05) {
  const n = new Vector3(...(normal || [0, 0, 1])).normalize();
  const off = Number(originOffset) || 0;
  const verts = meshData?.vertProperties;
  const tris = meshData?.triVerts;
  const np = meshData?.numProp || 3;
  if (!verts || !tris) return 0;
  let count = 0;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    let on = true;
    for (let k = 0; k < 3; k++) {
      const o = tris[i + k] * np;
      const d = verts[o] * n.x + verts[o + 1] * n.y + verts[o + 2] * n.z - off;
      if (Math.abs(d) > eps) {
        on = false;
        break;
      }
    }
    if (on) count += 1;
  }
  return count;
}

export function summarizeCrossSection(targets) {
  const parts = [];
  let remainingVolume = 0;
  let capCount = 0;
  for (const target of targets) {
    const trimmed = target.mesh?.userData?.crossSectionTrimmedMeshData;
    const applied = target.mesh?.userData?.crossSectionApplied;
    const volume = trimmed ? remainingVolumeOf(trimmed) : 0;
    const caps = trimmed && applied
      ? countCapTriangles(trimmed, applied.normal, applied.originOffset)
      : 0;
    parts.push({ partId: target.partId, volume, capCount: caps });
    remainingVolume += volume;
    capCount += caps;
  }
  return { parts, remainingVolume, capCount };
}
