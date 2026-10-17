import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRACKBALL_DESKTOP_ROTATE_SPEED,
  TRACKBALL_TOUCH_ROTATE_SPEED,
  trackballRotateSpeedForPointer,
} from './trackballFeel.js';

test('trackballRotateSpeedForPointer keeps touch on phones and raises mouse/pen', () => {
  assert.equal(trackballRotateSpeedForPointer('touch'), TRACKBALL_TOUCH_ROTATE_SPEED);
  assert.equal(trackballRotateSpeedForPointer('mouse'), TRACKBALL_DESKTOP_ROTATE_SPEED);
  assert.equal(trackballRotateSpeedForPointer('pen'), TRACKBALL_DESKTOP_ROTATE_SPEED);
  assert.equal(TRACKBALL_DESKTOP_ROTATE_SPEED, TRACKBALL_TOUCH_ROTATE_SPEED * 1.5);
});
