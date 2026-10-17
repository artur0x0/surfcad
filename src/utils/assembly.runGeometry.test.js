import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryFromExecuteResult, recordPartRun } from './assembly.js';

test('recordPartRun keeps per-part volume and bbox from the execute result', () => {
  const mesh = { vertProperties: new Float32Array(9) };
  const first = recordPartRun({}, 'a', {
    ok: true,
    mesh,
    volume: 1000,
    boundingBox: { min: [-5, -5, -5], max: [5, 5, 5] },
    bodyCount: 1,
  });
  const both = recordPartRun(first, 'b', {
    ok: true,
    mesh,
    volume: 2000,
    bbox: { min: [-8, -8, -8], max: [8, 8, 8] },
    bodyCount: 2,
  });
  assert.equal(both.a.volume, 1000);
  assert.deepEqual(both.a.bbox, { min: [-5, -5, -5], max: [5, 5, 5] });
  assert.equal(both.b.volume, 2000);
  assert.deepEqual(both.b.bbox.max, [8, 8, 8]);
  const fromRun = geometryFromExecuteResult(both.a);
  assert.equal(fromRun.volume, 1000);
  assert.deepEqual(fromRun.bbox.min, [-5, -5, -5]);
});
