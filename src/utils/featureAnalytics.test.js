import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FEATURE_MARKER_KINDS } from './featureMarkers.js';
import { HELPER_PALETTE_ITEMS } from './helperPaletteSnippets.js';
import {
  PALETTE_MARKERLESS_IDS,
  analyticsKindForPaletteId,
} from './featureAnalytics.js';

describe('feature analytics registry', () => {
  test('every palette feature maps to a feature_used kind', () => {
    const markerKinds = new Set(FEATURE_MARKER_KINDS.map((row) => row.kind));
    const markerless = new Set(PALETTE_MARKERLESS_IDS);
    assert.ok(HELPER_PALETTE_ITEMS.length > 10);
    for (const item of HELPER_PALETTE_ITEMS) {
      const kind = analyticsKindForPaletteId(item.id);
      assert.ok(kind, `${item.id} has an empty analytics kind`);
      assert.ok(
        markerKinds.has(kind) || markerless.has(item.id),
        `${item.id} → ${kind} is not a feature marker kind and is not listed as markerless`,
      );
    }
  });

  test('aliases match the kinds the strip already uses', () => {
    assert.equal(analyticsKindForPaletteId('filletEdges'), 'fillet');
    assert.equal(analyticsKindForPaletteId('chamferEdges'), 'chamfer');
    assert.equal(analyticsKindForPaletteId('makeExtrude'), 'extrude');
    assert.equal(analyticsKindForPaletteId('array3D'), 'array');
    assert.equal(analyticsKindForPaletteId('cube'), 'cube');
  });
});
