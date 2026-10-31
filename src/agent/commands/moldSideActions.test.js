import assert from 'node:assert/strict';
import test from 'node:test';
import { moldSideActionsCommand } from './moldSideActions.js';

test('mold_side_actions forwards on and returns the group counts', () => {
  const seen = [];
  const ctx = {
    moldSideActions: ({ on }) => {
      seen.push(on);
      return { on: true, count: 2, slides: 1, lifters: 1 };
    },
  };
  const out = moldSideActionsCommand.run(ctx, { on: true });
  assert.deepEqual(seen, [true]);
  assert.equal(out.result.count, 2);
  assert.equal(out.result.slides, 1);
  assert.equal(out.result.lifters, 1);
  assert.equal(out.error, undefined);
});

test('mold_side_actions toggles when on is omitted and reports a missing handler', () => {
  const seen = [];
  const ctx = {
    moldSideActions: ({ on }) => {
      seen.push(on);
      return { on: false };
    },
  };
  const toggled = moldSideActionsCommand.run(ctx, {});
  assert.deepEqual(seen, [undefined]);
  assert.equal(toggled.result.on, false);
  const missing = moldSideActionsCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});
