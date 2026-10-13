import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
} from '../helperPaletteSnippets.js';
import { sheetMetalBlock } from './sheetMetalScript.js';
import { featureStripChips, sheetChipOwnsRef, sheetRibbonChips } from './sheetRibbon.js';
import { parseFeatureMarkers } from '../featureMarkers.js';

const spec = {
  v: 1,
  sku: 'ALU-090',
  material: '5052 H32 Aluminum',
  t: 2.286,
  r: 1,
  k: 0.44,
  limits: {},
  plane: 'XY',
  width: 100,
  height: 60,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u+', feature: 'lip' },
    { id: 'b2', panel: 'base', edge: 'u-', feature: 'lip' },
    { id: 'b3', panel: 'b1', edge: 'u+' },
  ],
  tabs: [
    { id: 't1', panel: 'base', edge: 'v+', feature: 'lip' },
  ],
  holes: [{ id: 'h1', panel: 'base', u: 0, v: 0, d: 5 }],
};

function mixedScript() {
  return [
    CUBE_BEGIN,
    'let box = 1;',
    CUBE_END,
    FILLET_MODE_BEGIN,
    'let edge = 1;',
    FILLET_MODE_END,
    sheetMetalBlock(spec, { union: true }),
    CONTOUR_EXTRUDE_BEGIN,
    'let ex = 1;',
    CONTOUR_EXTRUDE_END,
    'return part;',
  ].join('\n');
}

test('plane and base show only the base flange', () => {
  const script = mixedScript();
  for (const stage of ['plane', 'base']) {
    const chips = sheetRibbonChips(script, { stage, spec });
    assert.deepEqual(chips.map((chip) => chip.chipLabel), ['Base']);
    assert.equal(chips[0].kind, 'sheetBase');
  }
});

test('a mixed part lists markers and sheet chips in script order', () => {
  const chips = sheetRibbonChips(mixedScript(), { stage: 'edit', spec });
  assert.deepEqual(chips.map((chip) => chip.kind), [
    'cube', 'fillet', 'sheetBase', 'sheetBend', 'sheetBend', 'sheetTab', 'extrude',
  ]);
  assert.deepEqual(chips.map((chip) => chip.chipLabel), [
    'Cube', 'Fillet', 'Base', 'Bend 1', 'Bend 2', 'Tab', 'Extrude',
  ]);
  assert.equal(chips.some((chip) => chip.kind === 'sheetMetal'), false);
  const lip = chips.find((chip) => chip.id === 'sheet:bend:lip');
  assert.deepEqual(lip.memberIds, ['b1', 'b2']);
  assert.deepEqual(chips.find((chip) => chip.id === 'sheet:bend:b3').memberIds, ['b3']);
  assert.deepEqual(chips.find((chip) => chip.id === 'sheet:tab:lip').memberIds, ['t1']);
  assert.equal(chips.some((chip) => chip.memberIds?.includes('h1')), false);
});

test('a deleted base leaves the other markers and does not invent a Base chip', () => {
  const script = [
    CUBE_BEGIN,
    'let box = 1;',
    CUBE_END,
    CONTOUR_EXTRUDE_BEGIN,
    'let ex = 1;',
    CONTOUR_EXTRUDE_END,
    'return part;',
  ].join('\n');
  const chips = sheetRibbonChips(script, { stage: 'edit', spec: null });
  assert.deepEqual(chips.map((chip) => chip.kind), ['cube', 'extrude']);
});

test('a sheet with no other markers is base, bends, then tabs', () => {
  const script = `${sheetMetalBlock(spec)}\nreturn part;\n`;
  const chips = sheetRibbonChips(script, { stage: 'edit' });
  assert.deepEqual(chips.map((chip) => chip.chipLabel), ['Base', 'Bend 1', 'Bend 2', 'Tab']);
});

test('refKeys stay on the bend id and the tab id', () => {
  const chips = sheetRibbonChips(mixedScript(), { stage: 'edit', spec });
  const base = chips.find((chip) => chip.sheetKind === 'base');
  const lip = chips.find((chip) => chip.id === 'sheet:bend:lip');
  const child = chips.find((chip) => chip.id === 'sheet:bend:b3');
  const tab = chips.find((chip) => chip.sheetKind === 'tab');
  assert.equal(sheetChipOwnsRef(base, 'wall:base:v-:w0'), true);
  assert.equal(sheetChipOwnsRef(base, 'wall:b1:u+:w0'), false);
  assert.equal(sheetChipOwnsRef(lip, 'bend:b1:base:w0'), true);
  assert.equal(sheetChipOwnsRef(lip, 'wall:b2:u+:w0'), true);
  assert.equal(sheetChipOwnsRef(lip, 'wall:b3:u+:w0'), false);
  assert.equal(sheetChipOwnsRef(child, 'bend:b3:end:q0:in'), true);
  assert.equal(sheetChipOwnsRef(tab, 'tab:t1:outer'), true);
  assert.equal(sheetChipOwnsRef(tab, 'tab:t1:q0:w1'), true);
  assert.equal(chips.some((chip) => sheetChipOwnsRef(chip, 'hole:h1:w0')), false);
  assert.equal(chips.some((chip) => sheetChipOwnsRef(chip, 'cutout:base:w0')), false);
});

test('featureStripChips follows script order and keeps the block offsets', () => {
  const chips = featureStripChips(mixedScript());
  assert.deepEqual(chips.map((chip) => chip.kind), [
    'cube', 'fillet', 'sheetBase', 'sheetBend', 'sheetBend', 'sheetTab', 'extrude',
  ]);
  const base = chips.find((chip) => chip.id === 'sheet:base');
  const marker = parseFeatureMarkers(mixedScript()).find((feature) => feature.kind === 'sheetMetal');
  assert.equal(base.markerId, marker.id);
  assert.equal(base.endOffset, marker.endOffset);
  assert.equal(chips.some((chip) => chip.kind === 'sheetMetal'), false);
});

test('a second sheet block does not reuse the first chip ids', () => {
  const script = [
    sheetMetalBlock(spec),
    sheetMetalBlock({ ...spec, width: 40 }, { union: true }),
    'return part;',
  ].join('\n');
  const chips = featureStripChips(script);
  const bases = chips.filter((chip) => chip.sheetKind === 'base');
  assert.equal(bases.length, 2);
  assert.equal(bases[0].id, 'sheet:base');
  assert.notEqual(bases[1].id, 'sheet:base');
  assert.match(bases[1].id, /^sheet:sheetMetal-\d+:base$/);
});
