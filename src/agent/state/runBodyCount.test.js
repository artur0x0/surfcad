import assert from 'node:assert/strict';
import test from 'node:test';
import { finishedRunBodyCount } from './runBodyCount.js';

const mesh = { vertProperties: new Float32Array([0, 0, 0]) };

test('a finished cube run keeps its body count', () => {
  const count = finishedRunBodyCount({
    ok: true,
    mesh,
    volume: 8000,
    bodyCount: 1,
  });
  assert.equal(count, 1);
});

test('a finished run falls back to the mesh count when the cache omitted it', () => {
  const count = finishedRunBodyCount({ ok: true, mesh, volume: 8000 }, 1);
  assert.equal(count, 1);
});

test('a finished run with no bodies is 0, and an unrun part stays null', () => {
  assert.equal(finishedRunBodyCount({ ok: true, mesh, bodyCount: 0 }), 0);
  assert.equal(finishedRunBodyCount({ empty: true }), 0);
  assert.equal(finishedRunBodyCount(null), null);
  assert.equal(finishedRunBodyCount({ ok: false, mesh: null, error: 'failed' }), null);
});
