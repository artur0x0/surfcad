/**
 * Keep a molding pane's scroll off the CAD camera.
 *
 * Listeners are capture-phase so a wheel, touch, or pointer gesture that
 * starts on the pane does not bubble to the viewport shell. They do not
 * call preventDefault: the pane still scrolls. A gesture whose target is a
 * button, field, link, or label is not stopped, so that control still runs.
 * `gesture*` is iOS Safari's pinch stream; React does not bind those.
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

const MOLD_PANE_CONTROL = 'button, input, select, textarea, a, label';

/** A press on a control still reaches React. Wheel and drag on the pane do not. */
export function moldPaneEventOnControl(event) {
  const node = event?.target;
  const el = node && node.nodeType === 3 ? node.parentElement : node;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest(MOLD_PANE_CONTROL);
}

export function stopMoldPaneGesture(event) {
  if (!event || typeof event.stopPropagation !== 'function') return;
  if (moldPaneEventOnControl(event)) return;
  event.stopPropagation();
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
