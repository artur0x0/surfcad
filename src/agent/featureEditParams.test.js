import assert from 'node:assert/strict';
import test from 'node:test';
import { featureEditOpenPlan, featureEditParamError } from './featureEditParams.js';

test('a move accepts dx, dy, dz, and at, and refuses a key it cannot write', () => {
  assert.equal(featureEditParamError('move', { dx: -38 }), null);
  assert.equal(featureEditParamError('move', { at: [1, 2, 3] }), null);
  assert.equal(featureEditParamError('move', {}), null);
  assert.equal(featureEditParamError('move', null), null);
  const height = featureEditParamError('move', { height: 12 });
  assert.equal(height.code, 'bad_args');
  assert.match(height.message, /move has no param height/);
  const typed = featureEditParamError('move', { dx: '-38' });
  assert.equal(typed.code, 'bad_args');
  assert.match(typed.message, /dx must be a number/);
  const at = featureEditParamError('move', { at: [1, 2] });
  assert.match(at.message, /at must be \[x, y, z\]/);
});

test('cube pose and size pass, and an unknown key does not', () => {
  assert.equal(featureEditParamError('cube', { x: 15, center: false, height: 12 }), null);
  const bad = featureEditParamError('cube', { dx: 1 });
  assert.equal(bad.code, 'bad_args');
  assert.match(bad.message, /cube has no param dx/);
  assert.match(featureEditParamError('cube', { center: 1 }).message, /center must be a boolean/);
});

test('a fillet accepts radius; a kind with no list is left to its own writer', () => {
  assert.equal(featureEditParamError('fillet', { radius: 2 }), null);
  assert.equal(featureEditParamError('contour', { width: 44, distance: 5 }), null);
  assert.equal(featureEditParamError(null, { anything: 1 }), null);
  assert.equal(featureEditParamError('move', []).code, 'bad_args');
});

test('the popup gate suppresses the card and still keeps a non-contour session', () => {
  assert.deepEqual(featureEditOpenPlan({ popupAllowed: false, contour: false }), {
    keepSession: true,
    openCard: false,
  });
  assert.deepEqual(featureEditOpenPlan({ popupAllowed: true, contour: false }), {
    keepSession: true,
    openCard: true,
  });
  assert.deepEqual(featureEditOpenPlan({ popupAllowed: false, contour: true }), {
    keepSession: false,
    openCard: false,
  });
  assert.deepEqual(featureEditOpenPlan({ popupAllowed: true, contour: true }), {
    keepSession: true,
    openCard: true,
  });
});
