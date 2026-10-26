/**
 * Extra `data-ui-action` ids mapped to helper palette commands (mode chips, etc.).
 */

export const HELPER_UI_ENTRY_EXTRAS = Object.freeze({
  cut: Object.freeze(['data-cut-mode-chip']),
  boolean: Object.freeze(['data-boolean-mode-chip']),
  move: Object.freeze(['data-move-mode-chip']),
  rotate: Object.freeze(['data-rotate-mode-chip']),
  mirror: Object.freeze(['data-mirror-mode-chip']),
});

export function helperUiEntries(helperId) {
  const extras = HELPER_UI_ENTRY_EXTRAS[helperId];
  if (!extras?.length) return helperId;
  return Object.freeze([helperId, ...extras]);
}
