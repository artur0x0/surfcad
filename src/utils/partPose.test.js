import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh } from 'three';
import { shiftLocalPoint } from './activePartOverlay.js';
import {
  applyPartPose,
  eulerDegreesToQuaternion,
  frameElements,
  quaternionToEulerDegrees,
  worldPoint,
} from './partPose.js';
import { quatFromOmega } from '../joints/rigid.js';

test('a 90 degree Z pose matches the column-major matrixWorld', () => {
  const q = quatFromOmega([0, 0, Math.PI / 2]);
  const placement = { t: [4, 5, 6], q };
  const group = new Group();
  group.name = 'assembly-parts';
  const mesh = new Mesh();
  group.add(mesh);
  applyPartPose(group, { t: [0, 0, 0], q: [0, 0, 0, 1] });
  applyPartPose(mesh, placement);
  group.updateMatrixWorld(true);
  const matrix = frameElements(mesh);
  const expected = [
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 1, 0,
    4, 5, 6, 1,
  ];
  for (let i = 0; i < 16; i += 1) assert.ok(Math.abs(matrix[i] - expected[i]) < 1e-9, `element ${i}`);
  assert.equal(mesh.scale.x, 1);
  assert.equal(mesh.scale.y, 1);
  assert.equal(mesh.scale.z, 1);
  const parent = frameElements(group);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i += 1) assert.ok(Math.abs(parent[i] - identity[i]) < 1e-12);
  const fitted = worldPoint([1, 0, 0], placement);
  assert.ok(Math.abs(fitted[0] - 4) < 1e-9);
  assert.ok(Math.abs(fitted[1] - 6) < 1e-9);
  assert.ok(Math.abs(fitted[2] - 6) < 1e-9);
  const shifted = shiftLocalPoint([1, 0, 0], placement.t, placement.q);
  assert.ok(Math.abs(shifted[0] - fitted[0]) < 1e-9);
  assert.ok(Math.abs(shifted[1] - fitted[1]) < 1e-9);
  assert.ok(Math.abs(shifted[2] - fitted[2]) < 1e-9);
});

test('quaternionToEulerDegrees treats a missing w as 1 and keeps w=0', () => {
  const identity = quaternionToEulerDegrees([0, 0, 0]);
  assert.ok(Math.abs(identity[0]) < 1e-9);
  assert.ok(Math.abs(identity[1]) < 1e-9);
  assert.ok(Math.abs(identity[2]) < 1e-9);
  const flipped = quaternionToEulerDegrees([0, 1, 0, 0]);
  assert.ok(Math.hypot(flipped[0], flipped[1], flipped[2]) > 90);
  const q = eulerDegreesToQuaternion([0, 90, 0]);
  const back = quaternionToEulerDegrees(q);
  assert.ok(Math.abs(back[1] - 90) < 1e-6);
});
