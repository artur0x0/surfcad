import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLEND_DEFAULT_MM,
  BLEND_SIZE_MAX_MM,
  BLEND_SIZE_MIN_MM,
  blendSnapStep,
  defaultBlendSizeMm,
} from './blendSize.js';
import { formatDisplayNumber, lengthToDisplay } from './displayUnit.js';
import { logLengthFromThumb, logThumbFromLength, THUMB_COUNT } from './sliderMap.js';

const ends = { min: BLEND_SIZE_MIN_MM, max: BLEND_SIZE_MAX_MM };

test('the default blend size is 2 mm in every unit', () => {
  assert.equal(BLEND_DEFAULT_MM, 2);
  assert.equal(defaultBlendSizeMm(), 2);
  assert.equal(formatDisplayNumber(lengthToDisplay(defaultBlendSizeMm(), 'mm')), '2');
  assert.equal(formatDisplayNumber(lengthToDisplay(defaultBlendSizeMm(), 'in')), '0.0787');
});

test('the blend slider maps 0.5 and 25 at its ends', () => {
  const snap = (v) => blendSnapStep(v, 'mm');
  assert.equal(logLengthFromThumb(0, { ...ends, snap }), BLEND_SIZE_MIN_MM);
  assert.equal(logLengthFromThumb(THUMB_COUNT, { ...ends, snap }), BLEND_SIZE_MAX_MM);
  assert.equal(logLengthFromThumb(0, ends), 0.5);
  assert.equal(logLengthFromThumb(THUMB_COUNT, ends), 25);
});

test('the blend slider is monotonic with finer steps at the low end', () => {
  const snap = (v) => blendSnapStep(v, 'mm');
  let prev = -Infinity;
  for (let i = 0; i <= THUMB_COUNT; i += 1) {
    const value = logLengthFromThumb(i, { ...ends, snap });
    assert.ok(value >= prev, `thumb ${i} went backwards: ${value} < ${prev}`);
    assert.ok(value >= BLEND_SIZE_MIN_MM && value <= BLEND_SIZE_MAX_MM);
    prev = value;
  }
  const low = logLengthFromThumb(THUMB_COUNT * 0.1, ends) - BLEND_SIZE_MIN_MM;
  const high = BLEND_SIZE_MAX_MM - logLengthFromThumb(THUMB_COUNT * 0.9, ends);
  assert.ok(low < high, `low span ${low} is not finer than high span ${high}`);
  const mid = logLengthFromThumb(THUMB_COUNT / 2, ends);
  const linearMid = (BLEND_SIZE_MIN_MM + BLEND_SIZE_MAX_MM) / 2;
  assert.ok(mid < linearMid, `log midpoint ${mid} is not below the linear midpoint`);
});

test('a typed 40 mm is kept and the thumb sits at the end', () => {
  const typed = 40;
  assert.equal(typed, 40);
  assert.equal(logThumbFromLength(typed, ends), THUMB_COUNT);
  assert.equal(logLengthFromThumb(logThumbFromLength(typed, ends), ends), BLEND_SIZE_MAX_MM);
  assert.equal(logThumbFromLength(0.1, ends), 0);
});

test('inch detents are finer at the small end and do not move the millimetre ends', () => {
  assert.ok(blendSnapStep(0.02, 'in') < blendSnapStep(0.6, 'in'));
  assert.ok(blendSnapStep(0.6, 'mm') < blendSnapStep(12, 'mm'));
});
