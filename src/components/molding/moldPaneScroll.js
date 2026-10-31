/**
 * Keep a molding pane's scroll off the CAD camera.
 *
 * Listeners are capture-phase so a wheel, touch, or pointer gesture that
 * starts on the pane does not bubble to the viewport shell. They do not
 * call preventDefault: the pane still scrolls. `gesture*` is iOS Safari's
 * pinch stream; React does not bind those.
 */

export const MOLD_PANE_GESTURES = [
  'wheel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'gesturestart',
  'gesturechange',
  'gestureend',
];

export function stopMoldPaneGesture(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
}

/**
 * @param {EventTarget | null | undefined} element
 * @returns {() => void}
 */
export function bindMoldPaneGestures(element) {
  if (!element || typeof element.addEventListener !== 'function') return () => {};
  for (const type of MOLD_PANE_GESTURES) {
    element.addEventListener(type, stopMoldPaneGesture, true);
  }
  return () => {
    if (typeof element.removeEventListener !== 'function') return;
    for (const type of MOLD_PANE_GESTURES) {
      element.removeEventListener(type, stopMoldPaneGesture, true);
    }
  };
}
