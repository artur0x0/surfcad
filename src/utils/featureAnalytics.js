/**
 * Map palette / feature-registry ids to the `feature_used` kind property.
 * Marker kinds (fillet, extrude, …) are the values PostHog stores.
 */

/** Palette ids whose analytics kind is not the palette id itself. */
export const PALETTE_FEATURE_KIND_ALIASES = Object.freeze({
  filletEdges: 'fillet',
  chamferEdges: 'chamfer',
  crossSection: 'profile',
  array3D: 'array',
  addDraft: 'draft',
  makeExtrude: 'extrude',
  makeRevolve: 'revolve',
  makeSweep: 'sweep',
  makeLoft: 'loft',
  // The Script button writes a code block (marker kind `code`).
  codeSnippet: 'code',
});

/**
 * Palette ids that do not write a feature-strip marker. Confirm still sends
 * `feature_used` via trackPaletteFeature.
 */
export const PALETTE_MARKERLESS_IDS = Object.freeze(['sweepPath']);

/** @param {string} id HELPER_PALETTE_ITEMS id */
export function analyticsKindForPaletteId(id) {
  const key = String(id || '');
  if (!key) return '';
  return PALETTE_FEATURE_KIND_ALIASES[key] || key;
}
