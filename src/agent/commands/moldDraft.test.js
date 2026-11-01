import assert from 'node:assert/strict';
import test from 'node:test';
import { moldDraftCommand } from './moldDraft.js';

test('mold_draft forwards on and threshold and returns the signed counts', () => {
  const seen = [];
  const ctx = {
    moldDraft: ({ on, threshold }) => {
      seen.push({ on, threshold });
      return {
        on: true,
        threshold: 1,
        positive: { count: 8, area: 1048 },
        negative: { count: 1, area: 40 },
        below: {
          count: 2,
          area: 12,
          positive: { count: 1, area: 8 },
          negative: { count: 1, area: 4 },
        },
        violations: 0,
        minDeg: 1,
        pins: 0,
        sleeves: 0,
      };
    },
  };
  const out = moldDraftCommand.run(ctx, { on: true, threshold: 1 });
  assert.deepEqual(seen, [{ on: true, threshold: 1 }]);
  assert.equal(out.result.positive.count, 8);
  assert.equal(out.result.negative.count, 1);
  assert.equal(out.result.below.negative.count, 1);
  assert.equal(out.result.pins, 0);
  assert.equal(out.error, undefined);
});

test('mold_draft toggles when on is omitted and reports a missing handler', () => {
  const seen = [];
  const ctx = {
    moldDraft: ({ on, threshold }) => {
      seen.push({ on, threshold });
      return { on: false };
    },
  };
  const toggled = moldDraftCommand.run(ctx, {});
  assert.deepEqual(seen, [{ on: undefined, threshold: undefined }]);
  assert.equal(toggled.result.on, false);
  const missing = moldDraftCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});

test('mold_draft forwards a rejected threshold', () => {
  const out = moldDraftCommand.run({
    moldDraft: () => ({ error: { code: 'bad_args', message: 'threshold must be an angle in (0, 90] degrees' } }),
  }, { threshold: 0 });
  assert.equal(out.error.code, 'bad_args');
});
