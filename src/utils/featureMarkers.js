/**
 * Slice Mobile B — parse marked Contour / Extrude / Fillet / … blocks so the
 * Script-stage feature strip can jump the caret between modeling steps.
 *
 * Markers are the same begin/end comments composers already write
 * (helperPaletteSnippets.js). Geometry highlight is out of scope for B.
 *
 * Slice A — also parse primitives / polish / move insertables so every
 * left-rail feature that creates a block shows a strip chip (same pattern
 * as fillets).
 */

import { FEATURE_BLOCK_MARKERS } from './helperPaletteSnippets.js';
import { SHEET_METAL_BEGIN, SHEET_METAL_END } from './sheetMetal/sheetMetalScript.js';
import { findFeatureBlocks } from './featureBlockId.js';

/** externalBody() inside a block = a cross-part copy (see externalCopy.js). */
const EXTERNAL_COPY_CALL = /\bexternalBody\s*\(/;

/** `.add(solid, { merge: false })` inside a block = Merge bodies off (separate body). */
export const SEPARATE_BODY_CALL = /\.add\s*\([\s\S]*?,\s*\{\s*merge\s*:\s*false\s*\}\s*\)/;

/**
 * Violet strip marker: the block wrote `{ merge: false }`, and the live part
 * still has more than one body. After a Boolean union (or any fuse to one
 * body) bodyCount is 1 and the marker clears even though the script still
 * says merge: false.
 */
export function featureShowsSeparateBody(feature, bodyCount) {
  return !!(feature && feature.separate && Number(bodyCount) > 1);
}

/** Chip text per block kind (`FEATURE_BLOCK_MARKERS` in helperPaletteSnippets.js holds the markers). */
const FEATURE_KIND_LABELS = Object.freeze({
  profile: 'Profile',
  extrude: 'Extrude',
  revolve: 'Revolve',
  loft: 'Loft',
  sweep: 'Sweep',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  cube: 'Cube',
  roundedBox: 'Round box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  tube: 'Tube',
  hexPrism: 'Hex',
  hole: 'Hole',
  holePattern: 'Hole grid',
  clearanceHole: 'Clearance',
  tapDrillHole: 'Tap drill',
  cboreHole: 'Cbore',
  cskHole: 'Csk',
  shell: 'Shell',
  draft: 'Draft',
  cut: 'Cut',
  boolean: 'Boolean',
  move: 'Move',
  rotate: 'Rotate',
  moveFace: 'Move face',
  deleteFace: 'Delete face',
  center: 'Center',
  align: 'Align',
  mirror: 'Mirror',
  array: 'Array',
  polarArray: 'Polar',
  patternPoints: 'Points',
  workplane: 'Workplane',
  code: 'Code'
});

/** Ordered kinds the strip cares about (label is the chip text). */
export const FEATURE_MARKER_KINDS = Object.freeze([
  ...FEATURE_BLOCK_MARKERS.filter((m) => m.kind !== 'code').map((m) => ({ ...m, label: FEATURE_KIND_LABELS[m.kind] })),
  { begin: SHEET_METAL_BEGIN, end: SHEET_METAL_END, kind: 'sheetMetal', label: 'Sheet' },
  ...FEATURE_BLOCK_MARKERS.filter((m) => m.kind === 'code').map((m) => ({ ...m, label: FEATURE_KIND_LABELS[m.kind] })),
]);

/**
 * Scan `script` for every complete begin…end marker pair.
 * Returns blocks sorted by start offset:
 *   { id, kind, label, chipLabel, startOffset, endOffset, external, index, typeIndex }
 */
export function parseFeatureMarkers(script) {
  if (typeof script !== 'string' || script.length === 0) return [];

  const hits = [];
  for (const def of FEATURE_MARKER_KINDS) {
    for (const block of findFeatureBlocks(script, def.begin, def.end)) {
      hits.push({
        kind: def.kind,
        label: def.label,
        markerId: block.id,
        startOffset: block.start,
        endOffset: block.end,
      });
    }
  }

  hits.sort((a, b) => a.startOffset - b.startOffset);

  const kindTotals = Object.create(null);
  for (const h of hits) kindTotals[h.kind] = (kindTotals[h.kind] || 0) + 1;

  const kindSeen = Object.create(null);
  return hits.map((h, index) => {
    kindSeen[h.kind] = (kindSeen[h.kind] || 0) + 1;
    const typeIndex = kindSeen[h.kind];
    const chipLabel = kindTotals[h.kind] > 1
      ? `${h.label} ${typeIndex}`
      : h.label;
    return {
      id: h.markerId || `${h.kind}-${index}`,
      kind: h.kind,
      label: h.label,
      chipLabel,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      /** Holds a frozen copy of another part's geometry (yellow chip border). */
      external: EXTERNAL_COPY_CALL.test(script.slice(h.startOffset, h.endOffset)),
      /** Wrote its solid with Merge bodies off. Live marker also needs bodyCount > 1. */
      separate: SEPARATE_BODY_CALL.test(script.slice(h.startOffset, h.endOffset)),
      index,
      /** 1-based index within this kind (badge on strip / sheet icons). */
      typeIndex,
    };
  });
}
