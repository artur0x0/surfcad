import assert from 'node:assert/strict';
import test from 'node:test';
import { moldDfmCommand } from './moldDfm.js';

test('mold_dfm forwards on and returns the report', () => {
  const seen = [];
  const ctx = {
    moldDfm: ({ on }) => {
      seen.push(on);
      return {
        on: true,
        framing: 'Budgetary analysis',
        fit: 'good',
        undercutCount: 0,
      };
    },
  };
  const out = moldDfmCommand.run(ctx, { on: true });
  assert.deepEqual(seen, [true]);
  assert.equal(out.result.framing, 'Budgetary analysis');
  assert.equal(out.result.fit, 'good');
  assert.equal(out.error, undefined);
});

test('mold_dfm toggles when on is omitted and reports a missing handler', () => {
  const seen = [];
  const ctx = {
    moldDfm: ({ on }) => {
      seen.push(on);
      return { on: false };
    },
  };
  const toggled = moldDfmCommand.run(ctx, {});
  assert.deepEqual(seen, [undefined]);
  assert.equal(toggled.result.on, false);
  const missing = moldDfmCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});
