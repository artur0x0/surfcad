/**
 * Resolve a registry `uiEntry` (data-* selector or helper id) to a DOM node.
 * @param {string | null | undefined} uiEntry
 * @returns {Element | null}
 */
export function resolveUiEntryElement(uiEntry) {
  if (typeof uiEntry !== 'string' || !uiEntry) return null;
  if (typeof document === 'undefined') return null;
  if (uiEntry.startsWith('data-')) {
    const byAttr = document.querySelector(`[${uiEntry}]`);
    if (byAttr) return byAttr;
    return document.querySelector(`[data-ui-action="${uiEntry}"]`);
  }
  return document.querySelector(`[data-ui-action="${uiEntry}"]`);
}

/**
 * @param {Element} el
 */
export function elementClientCenter(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    rect,
  };
}
