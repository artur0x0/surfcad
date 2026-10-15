import { featureStripChips } from '../../utils/sheetMetal/sheetRibbon.js';

/**
 * @param {{
 *   script?: string,
 *   failedIds?: Iterable<string>,
 *   rollbackAnchor?: string | null,
 *   activeChipId?: string | null,
 *   sheetSpec?: object | null,
 * }} input
 */
export function buildFeatureTree(input = {}) {
  const script = typeof input.script === 'string' ? input.script : '';
  const failed = new Set(input.failedIds || []);
  const chips = featureStripChips(script, { spec: input.sheetSpec || null });
  const features = chips.map((chip, index) => ({
    id: chip.id,
    kind: chip.kind,
    label: chip.label,
    chipLabel: chip.chipLabel,
    index,
    failed: failed.has(chip.id),
    sheet: chip.sheet === true,
    external: chip.external === true,
    separate: chip.separate === true,
  }));
  return {
    features,
    rollbackAnchor: input.rollbackAnchor ?? null,
    activeChipId: input.activeChipId ?? null,
  };
}
