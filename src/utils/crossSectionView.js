/**
 * Cross-section preview: trim visible part meshes with Manifold (capped solids)
 * and keep the uncut mesh data for picks / export.
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
    const entry = solidEntryForGeometry(solidCache, mesh.geometry);
    if (!entry?.meshData?.vertProperties) return;
    targets.push({ mesh, meshData: entry.meshData, partId: partId ?? null });
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
}

/** Restore every part that was sectioned. */
export function clearCrossSectionVisuals(targets, solidCache) {
  for (const { mesh } of targets) clearCrossSectionOnMesh(mesh, solidCache);
}

/**
 * Swap one mesh to a trimmed solid. `trimmedMeshData` comes from the worker.
 */
export function applyTrimmedMeshToTarget(target, trimmedMeshData, solidCache) {
  const { mesh, meshData } = target;
  if (!mesh || !trimmedMeshData?.vertProperties) return;
  if (!mesh.userData.crossSectionRestore) {
    mesh.userData.crossSectionRestore = { meshData };
  }
  mesh.userData.crossSectionTrimmedMeshData = trimmedMeshData;
  const { geometry } = cachedSolidGeometry(solidCache, trimmedMeshData);
  const prev = mesh.geometry;
  if (prev !== geometry) {
    releaseGeometryIn(solidCache, prev);
    mesh.geometry = geometry;
  }
}
