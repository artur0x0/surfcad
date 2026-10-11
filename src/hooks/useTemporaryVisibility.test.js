import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTemporaryVisibility,
  holdContourOverlays,
  holdJointPlanes,
  overlayKeysForContourEntry,
  releaseContourOverlays,
  releaseJointPlanes,
} from './useTemporaryVisibility.js';

function harness(initial = { planes: false, contours: false }) {
  const state = { ...initial };
  const api = createTemporaryVisibility({
    get: (key) => state[key],
    set: (key, value) => { state[key] = value; },
  });
  return { state, api };
}

test('contour tools pick planes and sketches; workplane picks a plane only', () => {
  for (const entry of ['crossSection', 'makeExtrude', 'makeRevolve', 'makeLoft', 'makeSweep']) {
    assert.deepEqual(overlayKeysForContourEntry(entry), ['planes', 'contours']);
  }
  assert.deepEqual(overlayKeysForContourEntry('workplane'), ['planes']);
});

test('a hold forces off toggles on and restores them on release', () => {
  const { state, api } = harness();
  holdContourOverlays(api, 'makeExtrude');
  assert.equal(state.planes, true);
  assert.equal(state.contours, true);
  assert.equal(api.isHeld('planes'), true);
  releaseContourOverlays(api);
  assert.equal(state.planes, false);
  assert.equal(state.contours, false);
  assert.equal(api.isHeld('planes'), false);
});

test('an already-on toggle stays on after the hold ends', () => {
  const { state, api } = harness({ planes: true, contours: true });
  holdContourOverlays(api, 'makeExtrude');
  assert.equal(state.planes, true);
  assert.equal(state.contours, true);
  releaseContourOverlays(api);
  assert.equal(state.planes, true);
  assert.equal(state.contours, true);
});

test('a tap during the hold is kept, per toggle', () => {
  const { state, api } = harness({ planes: true, contours: false });
  holdContourOverlays(api, 'makeExtrude');
  api.choose('planes', false);
  api.choose('contours', false);
  assert.equal(state.planes, false);
  assert.equal(state.contours, false);
  releaseContourOverlays(api);
  assert.equal(state.planes, false);
  assert.equal(state.contours, false);
});

test('opening the next contour tool snapshots the choice, then forces on again', () => {
  const { state, api } = harness();
  holdContourOverlays(api, 'makeExtrude');
  api.choose('planes', false);
  holdContourOverlays(api, 'makeRevolve');
  assert.equal(state.planes, true);
  assert.equal(state.contours, true);
  releaseContourOverlays(api);
  assert.equal(state.planes, false);
  assert.equal(state.contours, false);
});

test('workplane holds planes only and leaves a sketch choice alone', () => {
  const { state, api } = harness({ planes: false, contours: true });
  holdContourOverlays(api, 'workplane');
  assert.equal(state.planes, true);
  assert.equal(state.contours, true);
  assert.equal(api.isHeld('planes'), true);
  assert.equal(api.isHeld('contours'), false);
  releaseContourOverlays(api);
  assert.equal(state.planes, false);
  assert.equal(state.contours, true);
});

test('the joints card holds planes and restores them when it closes', () => {
  const { state, api } = harness();
  holdJointPlanes(api);
  assert.equal(state.planes, true);
  assert.equal(state.contours, false);
  assert.equal(api.isHeld('planes'), true);
  releaseJointPlanes(api);
  assert.equal(state.planes, false);
  assert.equal(api.isHeld('planes'), false);
});

test('a plane toggle during the joints card stays after the card closes', () => {
  const { state, api } = harness();
  holdJointPlanes(api);
  api.choose('planes', false);
  assert.equal(state.planes, false);
  releaseJointPlanes(api);
  assert.equal(state.planes, false);
});

test('a second begin does not replace the remembered value', () => {
  const { state, api } = harness();
  api.begin('planes');
  api.choose('planes', false);
  api.begin('planes');
  assert.equal(state.planes, false);
  api.end('planes');
  assert.equal(state.planes, false);
});

test('end with no hold does not change the toggle', () => {
  const { state, api } = harness({ planes: true, contours: false });
  api.end('planes');
  api.end('contours');
  assert.equal(state.planes, true);
  assert.equal(state.contours, false);
});

test('a tap outside a hold just sets the toggle', () => {
  const { state, api } = harness();
  api.choose('contours', true);
  assert.equal(state.contours, true);
  assert.equal(api.isHeld('contours'), false);
});
