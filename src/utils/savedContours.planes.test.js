import assert from 'node:assert/strict';
import test from 'node:test';
import { listConstructionPlanes, resolveConstructionPlane } from './savedContours.js';

test('resolveConstructionPlane accepts name shorthand and full id', () => {
  const script = `
const wp1 = { center: [0,0,0], normal: [0,0,1], x: [1,0,0], y: [0,1,0] };
const wp2 = offsetPlaneFrame(wp1, 5);
`;
  const planes = listConstructionPlanes(script);
  const wp1 = planes.find((row) => row.name === 'wp1');
  assert.ok(wp1?.id);
  assert.equal(resolveConstructionPlane(planes, wp1.id)?.name, 'wp1');
  assert.equal(resolveConstructionPlane(planes, 'wp1')?.id, wp1.id);
});
