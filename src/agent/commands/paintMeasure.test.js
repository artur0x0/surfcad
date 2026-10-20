import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintOpenCommand, paintStateCommand, paintConfirmCommand } from './paint.js';
import { measureOpenCommand, measureStateCommand, measureClearCommand } from './measure.js';

test('paint and measure commands call host handlers', async () => {
  const calls = [];
  const ctx = {
    paintOpen: () => {
      calls.push('paintOpen');
      return { result: { open: true } };
    },
    paintState: () => ({ result: { open: true, color: '#3b82f6', pendingCount: 1, canConfirm: true } }),
    paintConfirm: () => ({ result: { ok: true, written: true, unchanged: false } }),
    measureOpen: () => {
      calls.push('measureOpen');
      return { result: { open: true } };
    },
    measureState: () => ({ result: { open: true, count: 2, unit: 'mm', readout: { rows: [] } } }),
    measureClear: () => ({ result: { ok: true, count: 0 } }),
  };
  // paint_open may wait for the viewport, so it answers a promise.
  assert.equal((await paintOpenCommand.run(ctx)).result.open, true);
  assert.equal(paintStateCommand.run(ctx).result.canConfirm, true);
  assert.equal(paintConfirmCommand.run(ctx).result.written, true);
  assert.equal(measureOpenCommand.run(ctx).result.open, true);
  assert.equal(measureStateCommand.run(ctx).result.count, 2);
  assert.equal(measureClearCommand.run(ctx).result.count, 0);
  assert.deepEqual(calls, ['paintOpen', 'measureOpen']);
});
