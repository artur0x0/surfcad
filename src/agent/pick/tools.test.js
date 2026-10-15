import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PICK_TOOLS,
  PICK_TOOL_UI_ENTRIES,
  checkToolParams,
  pickTargetFrom,
  pickerBusyError,
} from './tools.js';
import { HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';

test('every picker card is a rail helper with a face or edge kind', () => {
  const rail = new Set(HELPER_PALETTE_ITEMS.map((item) => item.id));
  for (const [id, spec] of Object.entries(PICK_TOOLS)) {
    assert.ok(rail.has(id), `${id} is a rail helper`);
    assert.ok(spec.kind === 'face' || spec.kind === 'edge');
    assert.match(spec.uiEntry, /^data-[a-z-]+-mode-chip$/);
  }
  assert.equal(PICK_TOOL_UI_ENTRIES.length, Object.keys(PICK_TOOLS).length);
});

test('checkToolParams accepts card fields only', () => {
  assert.equal(checkToolParams('filletEdges', { radius: 1.5 }), null);
  assert.equal(checkToolParams('filletEdges', { radius: 0 }).code, 'bad_args');
  assert.match(checkToolParams('filletEdges', { wall: 1 }).message, /radius/);
  assert.equal(checkToolParams('shell', { wall: 2, openingMode: 'none' }), null);
  assert.equal(checkToolParams('shell', { openingMode: 'axis' }).code, 'bad_args');
  assert.equal(checkToolParams('moveFace', { distance: -2, flip: true }), null);
  assert.equal(checkToolParams('moveFace', { flip: 'yes' }).code, 'bad_args');
  assert.match(checkToolParams('deleteFace', { x: 1 }).message, /takes no params/);
  assert.equal(checkToolParams('shell', null), null);
  assert.equal(checkToolParams('shell', []).code, 'bad_args');
});

test('pickTargetFrom picks the open card, else the selection, else names the owner', () => {
  assert.deepEqual(pickTargetFrom({}), { target: 'selection', kind: null, busy: null });
  assert.equal(pickTargetFrom({ fillet: { entry: 'chamferEdges' } }).target, 'chamferEdges');
  assert.equal(pickTargetFrom({ fillet: { entry: 'filletEdges' }, featureEdit: true }).target, 'filletEdges');
  assert.equal(pickTargetFrom({ draft: true }).kind, 'face');
  assert.equal(pickTargetFrom({ cut: true }).busy, 'cut');
  assert.equal(pickTargetFrom({ featureSlot: true }).busy, 'featureSlot');
  assert.equal(pickTargetFrom({ featureEdit: true }).busy, 'featureEdit');
  assert.equal(pickTargetFrom({ game: true, fillet: {} }).busy, 'game');
});

test('picker_busy carries the owning mode and a hint', () => {
  const err = pickerBusyError('featureSlot', 'shell');
  assert.equal(err.code, 'picker_busy');
  assert.match(err.message, /Cannot open shell/);
  assert.equal(err.details.viewport, 'featureSlot');
  assert.match(err.details.hint, /slot_assign_contour/);
});
