/**
 * View-only cross-section.
 *
 * One world-space THREE.Plane, the same object on every part material.
 * Three.js clips in view space (`vClipPosition = -mvPosition`), and
 * `WebGLClipping` transforms the plane by the camera only, so a transformed
 * mesh is clipped by its own model-view position. Putting a per-instance
 * local plane on a shared material cannot: every instance would inherit the
 * first one's cut.
 *
 * Side, depth, and stencil stay as the part material set them. Flipping
 * those to hide the old dark wedge z-fights a new band across the cut.
 * The wedge was the Manifold cap, not a missing stencil.
 */
import { Plane, Vector3 } from 'three';

/**
 * Section preview fill. Tailwind `text-blue-400` (`#60a5fa`), the chrome
 * accent on the Parts header icons (`STRIP_ICON_BLUE`), the toolbar, the
 * feature strip, and the code editor. Datum quads use
 * `PREVIEW_COLORS.outline`. The cut-tool plane keeps `PREVIEW_COLORS.skin`.
 */
export const SECTION_PLANE_COLOR = 0x60a5fa;

/** @type {null | { plane: Plane, planes: Plane[], saved: Map<object, object>, materials: Set<object> }} */
let session = null;

export function sectionClipSession() {
  return session;
}

export function sectionClipActive() {
  return !!session;
}

/**
 * Keep the half-space the normal points into (normal·x >= originOffset).
 * That is the side Manifold's trimByPlane used to keep, and the side
 * Three.js discards the opposite of (`dot(vClipPosition, plane) > plane.w`
 * with vClipPosition = -viewPosition).
 */
export function setSectionPlane(plane, normal, originOffset) {
  const n = new Vector3(
    Number(normal?.[0]) || 0,
    Number(normal?.[1]) || 0,
    Number(normal?.[2]) || 0,
  );
  if (n.lengthSq() < 1e-20) n.set(0, 0, 1);
  else n.normalize();
  const point = n.clone().multiplyScalar(Number(originOffset) || 0);
  plane.setFromNormalAndCoplanarPoint(n, point);
  return plane;
}

export function beginSectionClip(normal, originOffset) {
  if (!session) {
    const plane = setSectionPlane(new Plane(), normal, originOffset);
    session = {
      plane,
      planes: [plane],
      saved: new Map(),
      materials: new Set(),
    };
    return session;
  }
  setSectionPlane(session.plane, normal, originOffset);
  return session;
}

export function endSectionClip() {
  if (!session) return;
  for (const material of session.materials) {
    const prev = session.saved.get(material);
    if (!material || !prev) continue;
    material.clippingPlanes = prev.clippingPlanes;
    material.clipShadows = prev.clipShadows;
    material.clipIntersection = prev.clipIntersection;
    material.needsUpdate = true;
  }
  session.materials.clear();
  session.saved.clear();
  session = null;
}

function samePlane(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const n = a.normal;
  const m = b.normal;
  return Math.abs(n.x - m.x) < 1e-6
    && Math.abs(n.y - m.y) < 1e-6
    && Math.abs(n.z - m.z) < 1e-6
    && Math.abs(a.constant - b.constant) < 1e-4;
}

/**
 * A clone of an adopted material copies the section plane (`Material.clone`
 * clones each plane). That copy is the section, not a plane the part had
 * before the tool was on, so turning the tool off clears it.
 */
function planesAreSection(planes, sectionPlane) {
  if (!planes || !sectionPlane || !Array.isArray(planes) || planes.length !== 1) return false;
  return samePlane(planes[0], sectionPlane);
}

function remember(material) {
  if (session.saved.has(material)) return;
  const existing = material.clippingPlanes;
  session.saved.set(material, {
    clippingPlanes: planesAreSection(existing, session.plane) ? null : (existing ?? null),
    clipShadows: material.clipShadows,
    clipIntersection: material.clipIntersection,
  });
}

/**
 * Point this material at the live world plane. Does not change side, depth,
 * stencil, color, opacity, or visibility.
 */
export function adoptSectionClip(material) {
  if (!session || !material) return;
  if (Array.isArray(material)) {
    for (const entry of material) adoptSectionClip(entry);
    return;
  }
  if (material.userData?.sectionClipExempt) return;
  // The contact seam is a custom shader with no clipping chunks.
  if (material.isShaderMaterial && material.clipping !== true) return;
  remember(material);
  if (material.clippingPlanes !== session.planes) {
    material.clippingPlanes = session.planes;
    material.needsUpdate = true;
  }
  session.materials.add(material);
}

/** Part meshes and the skins parented under them. Not the section widget. */
export function syncSectionClipMeshes(meshes) {
  if (!session || !meshes) return;
  const list = Array.isArray(meshes) ? meshes : [meshes];
  for (const mesh of list) {
    if (!mesh) continue;
    const visit = (obj) => {
      if (!obj || obj.userData?.sectionClipExempt) return;
      if (obj.name === 'contactSeam' || obj.name === 'CuttingPlaneWidget') return;
      if (obj.material) adoptSectionClip(obj.material);
      const kids = obj.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i += 1) visit(kids[i]);
    };
    visit(mesh);
  }
}

/** True when the world point is on the kept side of the section plane. */
export function sectionKeepsWorldPoint(plane, x, y, z, eps = 1e-4) {
  const n = plane.normal;
  return n.x * x + n.y * y + n.z * z + plane.constant >= -eps;
}
