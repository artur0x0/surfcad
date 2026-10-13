/**
 * One feature list for the CAD strip and the script rail.
 *
 * The script still has one sheet-metal marker per block. `featureStripChips`
 * expands each block in place: Base, then one chip per bend group, then one
 * per tab group. A row with no `feature` is its own chip. Rows that share
 * `feature` are one chip, sitting at the first row. Holes are not chips.
 * There is no second list for sheet mode.
 *
 * refKeys stay on the bend id and the tab id (`solveSheet` panel ids and
 * `buildSheetBrep` pieces). The chip does not rename them.
 */
import { featuresWithContours } from '../contourUsers.js';
import { readSheetMetalSpec } from './sheetMetalScript.js';

function baseChip() {
  return {
    id: 'sheet:base',
    kind: 'sheetBase',
    sheetKind: 'base',
    sheet: true,
    memberIds: ['base'],
    feature: null,
    typeIndex: 1,
    label: 'Base',
    chipLabel: 'Base',
  };
}

function groupRows(rows, kind) {
  const name = kind === 'bend' ? 'Bend' : 'Tab';
  const glyph = kind === 'bend' ? 'sheetBend' : 'sheetTab';
  const chips = [];
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row?.id) continue;
    const id = String(row.id);
    const key = row.feature ? String(row.feature) : id;
    const existing = byKey.get(key);
    if (existing) {
      existing.memberIds.push(id);
      continue;
    }
    const chip = {
      id: `sheet:${kind}:${key}`,
      kind: glyph,
      sheetKind: kind,
      sheet: true,
      memberIds: [id],
      feature: row.feature ? String(row.feature) : null,
    };
    byKey.set(key, chip);
    chips.push(chip);
  }
  const total = chips.length;
  return chips.map((chip, index) => ({
    ...chip,
    typeIndex: index + 1,
    label: name,
    chipLabel: total > 1 ? `${name} ${index + 1}` : name,
  }));
}

/** Base, then bend groups in array order, then tab groups. Holes stay out. */
export function sheetEntries(spec) {
  return [
    baseChip(),
    ...groupRows(spec?.bends, 'bend'),
    ...groupRows(spec?.tabs, 'tab'),
  ];
}

function blockSpec(script, marker, live, usedLive) {
  if (!usedLive.current && live) {
    usedLive.current = true;
    return live;
  }
  return readSheetMetalSpec(script.slice(marker.startOffset, marker.endOffset));
}

function withBlock(chip, marker, first) {
  const id = first || !marker?.id
    ? chip.id
    : `sheet:${marker.id}:${chip.id.replace(/^sheet:/, '')}`;
  return {
    ...chip,
    id,
    markerId: marker?.id || null,
    startOffset: marker?.startOffset,
    endOffset: marker?.endOffset,
  };
}

/**
 * One feature list: contours and markers in script order, with each sheet
 * block expanded to Base, then bend groups, then tab groups. There is no
 * second list for sheet mode. `spec` wins for the first sheet block.
 */
export function featureStripChips(script, { spec = null } = {}) {
  const text = String(script || '');
  const markers = featuresWithContours(text);
  const live = spec && typeof spec === 'object' ? spec : null;
  const usedLive = { current: false };
  const out = [];
  let sheets = 0;
  for (const marker of markers) {
    if (marker.kind !== 'sheetMetal') {
      out.push(marker);
      continue;
    }
    const block = blockSpec(text, marker, live, usedLive);
    if (!block) {
      out.push(marker);
      continue;
    }
    const first = sheets === 0;
    sheets += 1;
    for (const chip of sheetEntries(block)) out.push(withBlock(chip, marker, first));
  }
  return out;
}

/**
 * Ordered chips while a sheet flow is choosing its plane or base flange:
 * that step is Base only. Every other stage is the one feature list.
 */
export function sheetRibbonChips(script, { stage = 'edit', spec = null } = {}) {
  if (stage === 'plane' || stage === 'base') return [baseChip()];
  const text = String(script || '');
  const chips = featureStripChips(text, { spec });
  if (chips.some((chip) => chip.sheet)) return chips;
  const live = spec && typeof spec === 'object' ? spec : null;
  const fallback = live || readSheetMetalSpec(text);
  if (!fallback || featuresWithContours(text).some((marker) => marker.kind === 'sheetMetal')) {
    return chips;
  }
  return [...chips, ...sheetEntries(fallback)];
}

/**
 * Whether `refKey` belongs to this chip. Bend chips own `bend:${id}:` and
 * the child flange `wall:${id}:`. Tab chips own `tab:${id}:`. The base owns
 * `wall:base:`. Hole, notch, thick, and loose keys belong to no chip.
 */
export function sheetChipOwnsRef(chip, refKey) {
  const key = String(refKey || '');
  if (!chip?.sheet || !key) return false;
  if (chip.sheetKind === 'base') return key.startsWith('wall:base:');
  if (chip.sheetKind === 'bend') {
    return chip.memberIds.some((id) => key.startsWith(`bend:${id}:`) || key.startsWith(`wall:${id}:`));
  }
  if (chip.sheetKind === 'tab') {
    return chip.memberIds.some((id) => key.startsWith(`tab:${id}:`));
  }
  return false;
}
