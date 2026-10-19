import assert from 'node:assert/strict';
import test from 'node:test';
import { coerceHelperParams, validateHelperParams } from './helperPaletteAgent.js';
import { HELPER_PALETTE_ITEMS } from '../utils/helperPaletteSnippets.js';
import { POSITION_LIMIT_MM } from '../utils/positionLimit.js';

/** Bike acceptance PR 2: the ±500 mm cap on positions is gone; ±1,000,000 mm stays. */

const item = (id) => HELPER_PALETTE_ITEMS.find((row) => row.id === id);
const check = (id, args) => validateHelperParams(item(id), coerceHelperParams(item(id), args));

test('a cube at Pos Z 600 and 2000 mm passes; the old 500 cap is gone', () => {
  assert.equal(check('cube', { z: 600 }), null);
  assert.equal(check('cube', { z: 2000 }), null);
  assert.equal(check('cube', { x: -2000, y: 999_999 }), null);
  assert.equal(check('cube', { z: POSITION_LIMIT_MM }), null);
});

test('positions beyond ±1,000,000 mm, NaN, and Infinity are still bad_args', () => {
  const far = check('cube', { z: POSITION_LIMIT_MM + 1 });
  assert.equal(far?.code, 'bad_args');
  assert.match(far.message, /Pos Z/);
  assert.match(far.message, /1000000/);
  assert.equal(check('cube', { z: NaN })?.code, 'bad_args');
  assert.equal(check('cube', { z: Infinity })?.code, 'bad_args');
  assert.equal(check('cube', { z: -Infinity })?.code, 'bad_args');
  assert.equal(check('cube', { z: 'tall' })?.code, 'bad_args');
});

test('move deltas follow the same limit, and sizes are capped too', () => {
  assert.equal(check('move', { dx: 2000 }), null, 'the old ±1000 cap is gone');
  assert.equal(check('move', { dx: -POSITION_LIMIT_MM }), null);
  assert.equal(check('move', { dy: POSITION_LIMIT_MM * 2 })?.code, 'bad_args');
  assert.equal(check('cube', { width: POSITION_LIMIT_MM * 10 })?.code, 'bad_args');
  assert.equal(check('cube', { width: 5000 }), null);
});

test('the pose and move params declare the limit for the schema', () => {
  for (const name of ['x', 'y', 'z']) {
    const p = item('cube').params.find((row) => row.name === name);
    assert.equal(p.min, -POSITION_LIMIT_MM);
    assert.equal(p.max, POSITION_LIMIT_MM);
  }
  for (const name of ['dx', 'dy', 'dz']) {
    const p = item('move').params.find((row) => row.name === name);
    assert.equal(p.min, -POSITION_LIMIT_MM);
    assert.equal(p.max, POSITION_LIMIT_MM);
  }
});
