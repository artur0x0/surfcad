import assert from 'node:assert/strict';
import test from 'node:test';
import { POSITION_LIMIT_MM, positionWithinLimit, withinPositionLimit } from './positionLimit.js';

test('the limit is one million mm, finite, and symmetric', () => {
  assert.equal(POSITION_LIMIT_MM, 1_000_000);
  for (const v of [0, 600, 2000, -2000, 999_999.5, POSITION_LIMIT_MM, -POSITION_LIMIT_MM, '2000']) {
    assert.equal(withinPositionLimit(v), true, String(v));
  }
  for (const v of [NaN, Infinity, -Infinity, POSITION_LIMIT_MM + 1, 'x', null, undefined]) {
    assert.equal(withinPositionLimit(v), false, String(v));
  }
});

test('positionWithinLimit returns the numbers or null', () => {
  assert.deepEqual(positionWithinLimit([0, 600, 2000]), [0, 600, 2000]);
  assert.deepEqual(positionWithinLimit(['1', '2', '3']), [1, 2, 3]);
  assert.equal(positionWithinLimit([0, 0, Infinity]), null);
  assert.equal(positionWithinLimit([0, 0, NaN]), null);
  assert.equal(positionWithinLimit([0, 0, POSITION_LIMIT_MM + 1]), null);
  assert.equal(positionWithinLimit([1, 2]), null);
  assert.equal(positionWithinLimit('1,2,3'), null);
});
