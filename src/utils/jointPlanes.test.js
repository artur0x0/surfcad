import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSTRUCTION_PLANE_SIZE,
  planesForJointOverlay,
  planesForWorkplaneTool,
} from './jointPlanes.js';

const DECK = {
  id: 'deck@12',
  name: 'deck',
  plane: { center: [0, 70, 0], normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, 1] },
};

const SKETCH = {
  id: 'c1',
  name: 'c1',
  plane: { center: [0, 0, 1], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
};

const entry = { planes: [DECK], contours: [SKETCH] };

test('the Plane tool lists user planes and the three reference planes', () => {
  const ids = planesForWorkplaneTool(entry).map((plane) => plane.jointPlaneId);
  assert.deepEqual(ids, ['workplane:deck', 'origin:xy', 'origin:yz', 'origin:zx']);
  assert.equal(CONSTRUCTION_PLANE_SIZE, 48);
});

test('the Plane tool does not add sketch planes', () => {
  const ids = planesForWorkplaneTool(entry).map((plane) => plane.jointPlaneId);
  assert.equal(ids.includes('contour:c1'), false);
});

test('a selected face drops the reference planes and keeps the user plane', () => {
  const ids = planesForWorkplaneTool(entry, { references: false }).map((plane) => plane.jointPlaneId);
  assert.deepEqual(ids, ['workplane:deck']);
});

test('the planes toggle alone still omits reference planes', () => {
  const ids = planesForJointOverlay(entry, false).map((plane) => plane.jointPlaneId);
  assert.deepEqual(ids, ['workplane:deck']);
});
