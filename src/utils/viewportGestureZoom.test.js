import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { TRACKBALL_ZOOM_SPEED } from './trackballFeel.js';
import {
  applyTrackballZoomFactor,
  gestureScaleToZoomFactor,
  wheelDeltaYForZoomFactor,
} from './viewportGestureZoom.js';

test('gestureScaleToZoomFactor uses the relative scale step', () => {
  assert.equal(gestureScaleToZoomFactor(1, 1), 1);
  assert.equal(gestureScaleToZoomFactor(1, 1.1), 1 / 1.1);
  assert.equal(gestureScaleToZoomFactor(1.1, 1.2), 1.1 / 1.2);
  assert.equal(gestureScaleToZoomFactor(0, 1), 1);
});

test('wheelDeltaYForZoomFactor inverts the TrackballControls pixel wheel step', () => {
  const factor = 0.95;
  const deltaY = wheelDeltaYForZoomFactor(factor, TRACKBALL_ZOOM_SPEED);
  const zoomStartY = -deltaY * 0.00025;
  const fromWheel = 1 + (0 - zoomStartY) * TRACKBALL_ZOOM_SPEED;
  assert.ok(Math.abs(fromWheel - factor) < 1e-12);
});

test('applyTrackballZoomFactor dollies a perspective camera toward the target', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  const controls = {
    target: new Vector3(0, 0, 0),
    noZoom: false,
    minZoom: 0,
    maxZoom: Infinity,
    dispatchEvent() {},
  };
  const before = camera.position.distanceTo(controls.target);
  applyTrackballZoomFactor(camera, controls, 0.9);
  const after = camera.position.distanceTo(controls.target);
  assert.ok(Math.abs(after - before * 0.9) < 1e-9);
});
