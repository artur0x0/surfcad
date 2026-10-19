import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { applyCameraPose, fitView } from './viewCamera.js';

/** Bike acceptance PR 4: camera_set never rolls; named views frame a placed box. */

function controlsAt(x, y, z) {
  return { target: new Vector3(x, y, z), update() {} };
}

/** Horizon tilt: the camera's right axis should have no world-Z part. */
function rightAxisZ(camera) {
  camera.updateMatrixWorld(true);
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return right.z;
}

test('camera_set position + target from a high oblique angle gives a level horizon (Z-up default)', () => {
  const camera = new PerspectiveCamera(45, 1.6, 0.1, 10000);
  camera.up.set(0.3, 0.9, 0.2).normalize(); // a rolled up vector left by an orbit
  const controls = controlsAt(0, 0, 0);
  const ok = applyCameraPose({ camera, controls, position: [300, -400, 500], target: [0, 0, 0] });
  assert.equal(ok, true);
  assert.deepEqual(camera.up.toArray().map((v) => Math.round(v * 1e6) / 1e6), [0, 0, 1]);
  assert.ok(Math.abs(rightAxisZ(camera)) < 1e-6, `right axis z = ${rightAxisZ(camera)}`);
});

test('an explicit up is honoured, and a bad up falls back to Z-up', () => {
  const camera = new PerspectiveCamera(45, 1.6, 0.1, 10000);
  const controls = controlsAt(0, 0, 0);
  applyCameraPose({ camera, controls, position: [0, -400, 0], target: [0, 0, 0], up: [1, 0, 0] });
  assert.deepEqual(camera.up.toArray(), [1, 0, 0]);
  applyCameraPose({ camera, controls, position: [0, -400, 0], target: [0, 0, 0], up: [0, 0, 'x'] });
  assert.deepEqual(camera.up.toArray(), [0, 0, 1]);
  applyCameraPose({ camera, controls, position: [0, -400, 0], target: [0, 0, 0], up: [0, 0, 0] });
  assert.deepEqual(camera.up.toArray(), [0, 0, 1]);
});

test('position alone keeps the target and still levels the view', () => {
  const camera = new PerspectiveCamera(45, 1.6, 0.1, 10000);
  camera.up.set(0, 1, 0);
  const controls = controlsAt(100, 0, 0);
  applyCameraPose({ camera, controls, position: [100, -500, 300] });
  assert.ok(Math.abs(rightAxisZ(camera)) < 1e-6);
  assert.deepEqual(controls.target.toArray(), [100, 0, 0]);
});

test('fitView on a placed box frames the box center, not the part origin', () => {
  const camera = new PerspectiveCamera(45, 1.6, 0.1, 10000);
  const controls = controlsAt(0, 0, 0);
  // Two parts: one at the origin, one placed at x = 200. The assembly box spans both.
  const box = new Box3(new Vector3(-10, -10, -10), new Vector3(210, 10, 10));
  const ok = fitView({ camera, controls, box, dir: [0, -1, 0], up: [0, 0, 1], margin: 1.35 });
  assert.equal(ok, true);
  assert.ok(Math.abs(controls.target.x - 100) < 1e-6, `target x ${controls.target.x}`);
  assert.ok(camera.position.y < -100, 'front view looks along +Y');
  assert.ok(Math.abs(rightAxisZ(camera)) < 1e-6);
});
