import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUBE_BEGIN,
  CUBE_END,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
} from '../helperPaletteSnippets.js';
import { readSheetMetalSpec, removeSheetMetalBlock, sheetMetalBlock } from './sheetMetalScript.js';

const spec = {
  v: 1,
  sku: 'ALU-090',
  material: '5052',
  t: 2.286,
  r: 1,
  k: 0.44,
  limits: {},
  plane: 'XY',
  width: 100,
  height: 60,
  bends: [{ id: 'b1', panel: 'base', edge: 'u+' }],
  tabs: [],
  holes: [],
};

test('removing the sheet block leaves earlier and later markers and the return', () => {
  const script = [
    CUBE_BEGIN,
    'let box = 1;',
    CUBE_END,
    sheetMetalBlock(spec, { union: true }),
    CONTOUR_EXTRUDE_BEGIN,
    'let ex = 1;',
    CONTOUR_EXTRUDE_END,
    'return part;',
  ].join('\n');
  const removed = removeSheetMetalBlock(script);
  assert.equal(removed.ok, true);
  assert.equal(removed.buffer.includes('sheet-metal begin'), false);
  assert.equal(removed.buffer.includes('let box = 1;'), true);
  assert.equal(removed.buffer.includes('let ex = 1;'), true);
  assert.equal(removed.buffer.includes('return part;'), true);
  assert.equal(readSheetMetalSpec(removed.buffer), null);
  const at = removed.buffer.lastIndexOf('return part;');
  assert.equal(removed.buffer.slice(at + 'return part;'.length).trim(), '');
  assert.ok(removed.buffer.indexOf('let ex = 1;') < at);
});

test('removing the only sheet leaves the return', () => {
  const script = `${sheetMetalBlock(spec)}\nreturn part;\n`;
  const removed = removeSheetMetalBlock(script);
  assert.equal(removed.ok, true);
  assert.equal(readSheetMetalSpec(removed.buffer), null);
  assert.match(removed.buffer, /return part;/);
  assert.equal(removed.buffer.includes('sheetMetalSolid'), false);
});
