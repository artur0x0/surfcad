/**
 * Safari desktop trackpad pinch uses gesture* events (not ctrlKey wheel).
 * Map scale deltas to the same camera dolly / ortho zoom TrackballControls uses.
 */
import { MathUtils } from 'three';

/** True when document-level page-zoom lock should cancel gesture* on the canvas. */
export function documentShouldPreventCanvasGesture() {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

/**
 * Perspective dolly factor for one gesturechange step (Safari scale is cumulative).
 * @param {number} prevScale
 * @param {number} newScale
 * @returns {number} multiply eye-to-target distance by this factor
 */
export function gestureScaleToZoomFactor(prevScale, newScale) {
  const prev = Number(prevScale);
  const next = Number(newScale);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0 || next <= 0) return 1;
  if (prev === next) return 1;
  return prev / next;
}

/**
 * Wheel deltaY that yields the same factor as TrackballControls' pixel wheel path
 * for one update with _zoomEnd === _zoomStart.
 * @param {number} factor
 * @param {number} zoomSpeed
 */
export function wheelDeltaYForZoomFactor(factor, zoomSpeed) {
  const z = Number(zoomSpeed);
  const f = Number(factor);
  if (!Number.isFinite(z) || z <= 0 || !Number.isFinite(f) || f <= 0 || f === 1) return 0;
  return (f - 1) / (0.00025 * z);
}

/**
 * @param {import('three').Camera} camera
 * @param {import('three').TrackballControls} controls
 * @param {number} factor
 */
export function applyTrackballZoomFactor(camera, controls, factor) {
  if (!camera || !controls || !(factor > 0) || factor === 1) return;
  if (controls.noZoom) return;

  if (camera.isPerspectiveCamera && controls.target) {
    const eye = camera.position.clone().sub(controls.target);
    eye.multiplyScalar(factor);
    camera.position.copy(controls.target).add(eye);
    camera.lookAt(controls.target);
    controls.dispatchEvent({ type: 'change' });
    return;
  }

  if (camera.isOrthographicCamera) {
    const nextZoom = MathUtils.clamp(
      camera.zoom / factor,
      controls.minZoom,
      controls.maxZoom,
    );
    if (nextZoom !== camera.zoom) {
      camera.zoom = nextZoom;
      camera.updateProjectionMatrix();
      controls.dispatchEvent({ type: 'change' });
    }
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ getCamera: () => import('three').Camera | null, getControls: () => import('three').TrackballControls | null }} accessors
 * @returns {() => void}
 */
export function installViewportGestureZoom(canvas, { getCamera, getControls }) {
  const listenerOpts = { passive: false, capture: true };
  let prevScale = 1;

  const onGestureStart = (event) => {
    event.preventDefault();
    prevScale = Number.isFinite(event.scale) ? event.scale : 1;
  };

  const onGestureChange = (event) => {
    event.preventDefault();
    if (documentShouldPreventCanvasGesture()) return;
    const scale = Number.isFinite(event.scale) ? event.scale : prevScale;
    const factor = gestureScaleToZoomFactor(prevScale, scale);
    prevScale = scale;
    const camera = getCamera();
    const controls = getControls();
    if (!camera || !controls) return;
    applyTrackballZoomFactor(camera, controls, factor);
  };

  const onGestureEnd = (event) => {
    event.preventDefault();
    prevScale = 1;
  };

  const handlers = [
    ['gesturestart', onGestureStart],
    ['gesturechange', onGestureChange],
    ['gestureend', onGestureEnd],
  ];

  for (const [type, handler] of handlers) {
    canvas.addEventListener(type, handler, listenerOpts);
  }

  return () => {
    for (const [type, handler] of handlers) {
      canvas.removeEventListener(type, handler, listenerOpts);
    }
  };
}
