import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintOpenCommand, paintStateCommand, paintConfirmCommand, paintCommand } from './paint.js';
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

function paintHost(calls, { fail = null, activeId = 'p-active' } = {}) {
  const step = (name, out) => (args) => {
    calls.push([name, args]);
    if (fail === name) return { error: { code: 'bad_view', message: `${name} refused` } };
    return out;
  };
  return {
    readStatus: () => ({ partId: activeId }),
    setActivePart: (id) => { calls.push(['setActivePart', id]); return { result: { partId: id } }; },
    paintOpen: async () => { calls.push(['paintOpen']); return { result: { open: true } }; },
    paintSetColor: step('paintSetColor', { result: { color: '#3b82f6' } }),
    paintPart: step('paintPart', { result: { pendingCount: 1 } }),
    paintFaces: step('paintFaces', { result: { pendingCount: 2 } }),
    paintConfirm: step('paintConfirm', { result: { ok: true, written: true } }),
    paintCancel: () => { calls.push(['paintCancel']); return { result: { ok: true } }; },
  };
}

test('paint: one call paints the whole active part through the step handlers and confirms', async () => {
  const calls = [];
  const out = await paintCommand.run(paintHost(calls), { color: '#3B82F6' });
  assert.deepEqual(out.result, { ok: true, color: '#3B82F6', painted: 'part', count: 1 });
  assert.deepEqual(calls.map((c) => c[0]), ['paintOpen', 'paintSetColor', 'paintPart', 'paintConfirm']);
  assert.deepEqual(calls[1][1], { color: '#3B82F6' });
});

test('paint: keys paint those faces, and part_id switches the active part first', async () => {
  const calls = [];
  const keys = [{ at: [0, 0, 10], n: [0, 0, 1], area: 400 }, { at: [0, 0, -10], n: [0, 0, -1], area: 400 }];
  const out = await paintCommand.run(paintHost(calls), { color: '#ff0000', keys, part_id: 'p-other' });
  assert.deepEqual(out.result, { ok: true, color: '#ff0000', painted: 'faces', count: 2, partId: 'p-other' });
  assert.deepEqual(calls.map((c) => c[0]), ['setActivePart', 'paintOpen', 'paintSetColor', 'paintFaces', 'paintConfirm']);
  assert.equal(calls[0][1], 'p-other');
  assert.deepEqual(calls[3][1], { keys });
  // The active part is not switched again.
  const again = [];
  await paintCommand.run(paintHost(again), { color: '#ff0000', part_id: 'p-active' });
  assert.equal(again[0][0], 'paintOpen');
});

test('paint: a failing step cancels the session and the error names the step', async () => {
  const calls = [];
  const out = await paintCommand.run(paintHost(calls, { fail: 'paintPart' }), { color: '#ff0000' });
  assert.equal(out.error.code, 'bad_view');
  assert.match(out.error.hint, /paintPart/);
  assert.deepEqual(calls.map((c) => c[0]), ['paintOpen', 'paintSetColor', 'paintPart', 'paintCancel']);
});

test('paint: argument checks', () => {
  assert.equal(paintCommand.checkArgs({ color: '#3b82f6' }), null);
  assert.equal(paintCommand.checkArgs({ color: 'blue' })?.code, 'bad_args');
  assert.equal(paintCommand.checkArgs({ color: '#3b82f6', keys: [] })?.code, 'bad_args');
  assert.equal(paintCommand.checkArgs({ color: '#3b82f6', part_id: 'parts/Frame.js' })?.code, 'unknown_part');
});
