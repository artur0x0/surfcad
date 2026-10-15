import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCameraState } from './camera.js';

test('buildCameraState reads three.js vectors', () => {
  const state = buildCameraState({
    position: { x: 1, y: 2, z: 3 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    target: [0, 0, 0],
    zoom: 1,
    fov: 45,
  });
  assert.deepEqual(state.position, [1, 2, 3]);
  assert.deepEqual(state.quaternion, [0, 0, 0, 1]);
  assert.deepEqual(state.target, [0, 0, 0]);
  assert.equal(state.fov, 45);
});
