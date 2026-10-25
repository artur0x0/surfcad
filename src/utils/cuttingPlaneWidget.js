// utils/cuttingPlaneWidget.js
import {
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  DoubleSide,
  LineSegments,
  EdgesGeometry,
  LineBasicMaterial,
  Group,
  Vector3
} from 'three';
import { PREVIEW_COLORS, PREVIEW_OPACITY } from './previewStyle.js';

/**
 * Create a visual cutting plane widget for the viewport.
 * The default colour is preview skin (`PREVIEW_COLORS.skin`). The cut tool
 * passes that cyan. The section preview passes `SECTION_PLANE_COLOR`.
 * @param {Object} options - Plane configuration
 * @param {Array<number>} options.normal - Normal vector [x, y, z]
 * @param {number} options.originOffset - Distance from origin
 * @param {number} options.size - Size of the plane widget (default: 200)
 * @param {number} options.color - Plane color (default: preview skin)
 * @param {number} options.opacity - Plane opacity (default: preview skin)
 * @returns {Group} Three.js group containing the plane widget
 */
export function createCuttingPlaneWidget(options = {}) {
  const {
    normal = [0, 0, 1],
    originOffset = 0,
    size = 200,
    color = PREVIEW_COLORS.skin,
    opacity = PREVIEW_OPACITY.skin
  } = options;

  const group = new Group();
  group.name = 'CuttingPlaneWidget';

  // Create the plane mesh
  const geometry = new PlaneGeometry(size, size);
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false
  });

  const planeMesh = new Mesh(geometry, material);

  // Add grid lines on the plane
  const edges = new EdgesGeometry(geometry);
  const lineMaterial = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: opacity + 0.3,
    depthTest: false
  });
  const lineSegments = new LineSegments(edges, lineMaterial);
  planeMesh.add(lineSegments);

  // Position and orient the plane
  const normalVec = new Vector3(...normal).normalize();
  
  // Calculate rotation to align plane with normal
  const up = new Vector3(0, 0, 1);
  const quaternion = new Mesh().quaternion;
  if (Math.abs(normalVec.dot(up)) < 0.9999) {
    quaternion.setFromUnitVectors(up, normalVec);
  } else if (normalVec.dot(up) < 0) {
    quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  }
  
  planeMesh.quaternion.copy(quaternion);
  
  // Position along normal
  const position = normalVec.multiplyScalar(originOffset);
  planeMesh.position.copy(position);

  group.add(planeMesh);

  // Store plane data on the group for easy access
  group.userData = {
    normal: [...normal],
    originOffset,
    size,
    color,
    sectionClipExempt: true,
  };
  markCuttingPlaneExempt(group);

  return group;
}

function markCuttingPlaneExempt(widget) {
  if (!widget) return;
  widget.frustumCulled = false;
  widget.userData.sectionClipExempt = true;
  widget.traverse((obj) => {
    obj.frustumCulled = false;
    obj.userData.sectionClipExempt = true;
    const mats = obj.material
      ? (Array.isArray(obj.material) ? obj.material : [obj.material])
      : [];
    for (const mat of mats) {
      if (!mat.userData) mat.userData = {};
      mat.userData.sectionClipExempt = true;
    }
  });
}

/** Drop a widget, including the edge lines parented under the plane mesh. */
export function disposeCuttingPlaneWidget(widget) {
  if (!widget) return;
  widget.parent?.remove(widget);
  widget.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = obj.material;
    if (Array.isArray(mats)) mats.forEach((mat) => mat?.dispose?.());
    else mats?.dispose?.();
  });
}

/**
 * Put the section preview on `scene`. A scene rebuild leaves the previous
 * widget parented to a scene that is no longer drawn; this reattaches it.
 * A size or colour change rebuilds the mesh. The widget is exempt from the
 * section clip, or the plane would discard itself.
 */
export function placeCuttingPlaneWidget(scene, widget, options = {}) {
  if (!scene) return widget || null;
  const size = options.size ?? widget?.userData?.size ?? 200;
  const color = options.color ?? widget?.userData?.color ?? PREVIEW_COLORS.skin;
  const opacity = options.opacity ?? PREVIEW_OPACITY.skin;
  let next = widget;
  const stale = !next
    || next.userData?.size !== size
    || next.userData?.color !== color;
  if (stale) {
    if (next) disposeCuttingPlaneWidget(next);
    next = createCuttingPlaneWidget({
      normal: options.normal ?? [0, 0, 1],
      originOffset: options.originOffset ?? 0,
      size,
      color,
      opacity,
    });
  } else {
    updateCuttingPlaneWidget(next, options);
  }
  markCuttingPlaneExempt(next);
  if (next.parent !== scene) {
    next.parent?.remove(next);
    scene.add(next);
  }
  return next;
}

/**
 * Update an existing cutting plane widget
 * @param {Group} widget - The cutting plane widget group
 * @param {Object} options - Updated plane configuration
 * @param {Array<number>} options.normal - Normal vector
 * @param {number} options.originOffset - Distance from origin
 */
export function updateCuttingPlaneWidget(widget, options = {}) {
  const {
    normal = widget.userData.normal,
    originOffset = widget.userData.originOffset
  } = options;

  const normalVec = new Vector3(...normal).normalize();
  
  // Find the plane mesh (first child)
  const planeMesh = widget.children[0];
  
  // Update rotation
  const up = new Vector3(0, 0, 1);
  const quaternion = new Mesh().quaternion;
  if (Math.abs(normalVec.dot(up)) < 0.9999) {
    quaternion.setFromUnitVectors(up, normalVec);
  } else if (normalVec.dot(up) < 0) {
    quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  }
  
  planeMesh.quaternion.copy(quaternion);
  
  // Update position
  const position = normalVec.clone().multiplyScalar(originOffset);
  planeMesh.position.copy(position);

  // Update userData
  widget.userData.normal = [...normal];
  widget.userData.originOffset = originOffset;
}