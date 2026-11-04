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

test('recordPartRun keeps the kernel crash record on a failed run', () => {
  const crash = { code: 'geometry_worker_crashed', reason: 'out_of_memory', workerRestarted: true, message: 'ran out of memory' };
  const runs = recordPartRun({}, 'clamps', { ok: false, error: crash.message, crash });
  assert.equal(runs.clamps.ok, false);
  assert.equal(runs.clamps.error, crash.message);
  assert.deepEqual(runs.clamps.crash, crash);
  const plain = recordPartRun({}, 'frame', { ok: false, error: 'boom' });
  assert.equal('crash' in plain.frame, false);
});

test('recordPartRun keeps a recovered run\'s feature failure and a clean run has none', () => {
  const mesh = { vertProperties: new Float32Array(9) };
  const featureFailure = { id: 'fillet1', kind: 'fillet', block: '// b', message: 'bad edge', skipped: [] };
  const runs = recordPartRun({}, 'bracket', { ok: true, mesh, volume: 10, featureFailure });
  assert.equal(runs.bracket.ok, true);
  assert.deepEqual(runs.bracket.featureFailure, featureFailure);
  const clean = recordPartRun({}, 'frame', { ok: true, mesh, volume: 10 });
  assert.equal('featureFailure' in clean.frame, false);
  const junk = recordPartRun({}, 'lid', { ok: true, mesh, volume: 10, featureFailure: 'nope' });
  assert.equal('featureFailure' in junk.lid, false);
});
