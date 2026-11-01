import assert from 'node:assert/strict';
import test from 'node:test';
import { moldDfmCommand } from './moldDfm.js';

test('mold_dfm forwards grade and quantity and returns the report', () => {
  const seen = [];
  const ctx = {
    moldDfm: (args) => {
      seen.push(args);
      return {
        on: true,
        framing: 'Mold report',
        grade: args.grade,
        quantity: args.quantity,
      };
    },
  };
  const out = moldDfmCommand.run(ctx, { on: true, grade: 'PC/ABS', quantity: 1000 });
  assert.equal(seen[0].on, true);
  assert.equal(seen[0].grade, 'PC/ABS');
  assert.equal(seen[0].quantity, 1000);
  assert.equal(out.result.framing, 'Mold report');
  assert.equal(out.result.quantity, 1000);
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
