/**
 * Viewport canvas sizing shared by the live Viewport and headless stage hooks.
 * Keeps renderer buffer aspect and camera projection in sync with the container.
 */

export function readViewportContainerSize(container) {
  if (!container) return { width: 0, height: 0 };
  return {
    width: Math.max(0, Math.floor(container.clientWidth)),
    height: Math.max(0, Math.floor(container.clientHeight)),
  };
}

/**
 * @param {import('three').Camera} camera
 * @param {number} width
 * @param {number} height
 */
export function updateCameraProjection(camera, width, height) {
  if (!camera || width <= 0 || height <= 0) return;
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  if (camera.isPerspectiveCamera) {
    camera.aspect = aspect;
  } else if (camera.isOrthographicCamera) {
    const halfH = (camera.top - camera.bottom) * 0.5;
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
  }
  camera.updateProjectionMatrix();
}

/**
 * @param {Object} o
 * @param {import('three').WebGLRenderer} o.renderer
 * @param {import('three').Camera} [o.camera]
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} [o.pixelRatio]
 * @param {boolean} [o.updateStyle=false] CSS owns canvas layout in the shell
 */
export function resizeViewportRenderer({
  renderer,
  camera,
  width,
  height,
  pixelRatio,
  updateStyle = false,
}) {
  if (!renderer || width <= 0 || height <= 0) return false;
  const dpr = pixelRatio ?? Math.min(
    typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
    2,
  );
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, updateStyle);
  if (camera) updateCameraProjection(camera, width, height);
  return true;
}
