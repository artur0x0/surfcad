/**
 * Chips for the CAD bar while sheet metal is open.
 *
 * The script still has one sheet-metal marker. This list is a view: markers
 * before that block, then the base flange, then one chip per bend group and
 * one per tab group, then markers after the block. A row with no `feature`
 * is its own chip. Rows that share `feature` are one chip, sitting at the
 * first row. Holes are not chips.
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

/**
 * Ordered chips. `plane` and `base` are the base flange only.
 * `spec` is the live sheet (it wins for the first block). Other markers
 * stay in script order around that block.
 */
export function sheetRibbonChips(script, { stage = 'edit', spec = null } = {}) {
  if (stage === 'plane' || stage === 'base') return [baseChip()];
  const text = String(script || '');
  const markers = featuresWithContours(text);
  const live = spec && typeof spec === 'object' ? spec : null;
  const usedLive = { current: false };
  const out = [];
  let sawSheet = false;
  for (const marker of markers) {
    if (marker.kind !== 'sheetMetal') {
      out.push(marker);
      continue;
    }
    sawSheet = true;
    out.push(...sheetEntries(blockSpec(text, marker, live, usedLive)));
  }
  if (!sawSheet) out.push(...sheetEntries(live || readSheetMetalSpec(text)));
  return out;
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
