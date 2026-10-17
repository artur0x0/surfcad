/**
 * Stop the browser from pinch-zooming the page around the CAD view.
 *
 * The viewport meta sets user-scalable=no. iOS Safari ignores that, including
 * in the installed PWA. These listeners are what actually hold the page:
 *
 *   - gesturestart / gesturechange / gestureend preventDefault on touch devices
 *     (iOS PWA), including on the canvas. On desktop Safari the canvas installs
 *     its own gesture handler for camera zoom; the document listener skips the
 *     canvas there so those events are not swallowed before the viewport runs.
 *     Off-canvas gestures are always cancelled. Gesture events are separate from
 *     the touch stream TrackballControls reads on iOS, so touch zoom still works.
 *   - touchmove with two or more fingers whose target is outside the canvas
 *     preventDefault, so a pinch on a rail or other chrome does not zoom the
 *     page. The listener is { passive: false } or preventDefault is a no-op.
 *
 * A touch whose target is the canvas is not cancelled. TrackballControls is
 * bound to that canvas and keeps two-finger zoom, one-finger rotate, and pan.
 *
 * A one-finger touchmove is never cancelled. The Parts list, the Script pane,
 * and scrolling popups keep their native scroll.
 *
 * The returned function removes every listener it added. Vite dev mounts under
 * StrictMode, which runs the effect, the cleanup, then the effect again. The
 * first pass has to unsubscribe or the handlers stack. Same shape as the
 * orbit-loop cleanup (#237).
 */

import { documentShouldPreventCanvasGesture } from './viewportGestureZoom.js';

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];

/** True when the event's target is the viewer canvas (or a node inside it). */
export function touchTargetIsCanvas(target, canvas) {
  if (!canvas || !target) return false;
  if (target === canvas) return true;
  return typeof canvas.contains === 'function' && canvas.contains(target);
}

/**
 * @param {HTMLCanvasElement} canvas Viewer canvas. Touches on it are left alone.
 * @returns {() => void} Remove the document listeners.
 */
export function installPageZoomLock(canvas) {
  const listenerOpts = { passive: false, capture: true };

  const onGesture = (event) => {
    if (
      !documentShouldPreventCanvasGesture()
      && touchTargetIsCanvas(event.target, canvas)
    ) {
      return;
    }
    event.preventDefault();
  };

  const onTouchMove = (event) => {
    if (!event.touches || event.touches.length < 2) return;
    if (touchTargetIsCanvas(event.target, canvas)) return;
    event.preventDefault();
  };

  for (const type of GESTURE_EVENTS) {
    document.addEventListener(type, onGesture, listenerOpts);
  }
  document.addEventListener('touchmove', onTouchMove, listenerOpts);

  return () => {
    for (const type of GESTURE_EVENTS) {
      document.removeEventListener(type, onGesture, listenerOpts);
    }
    document.removeEventListener('touchmove', onTouchMove, listenerOpts);
  };
}
