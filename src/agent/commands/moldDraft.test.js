import assert from 'node:assert/strict';
import test from 'node:test';
import { moldDraftCommand } from './moldDraft.js';

test('mold_draft forwards on and returns the counts', () => {
  const seen = [];
  const ctx = {
    moldDraft: ({ on }) => {
      seen.push(on);
      return { on: true, violations: 4, minDeg: 1, pins: 0, sleeves: 0 };
    },
  };
  const out = moldDraftCommand.run(ctx, { on: true });
  assert.deepEqual(seen, [true]);
  assert.equal(out.result.violations, 4);
  assert.equal(out.result.pins, 0);
  assert.equal(out.error, undefined);
});

test('mold_draft toggles when on is omitted and reports a missing handler', () => {
  const seen = [];
  const ctx = {
    moldDraft: ({ on }) => {
      seen.push(on);
      return { on: false };
    },
  };
  const toggled = moldDraftCommand.run(ctx, {});
  assert.deepEqual(seen, [undefined]);
  assert.equal(toggled.result.on, false);
  const missing = moldDraftCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});
