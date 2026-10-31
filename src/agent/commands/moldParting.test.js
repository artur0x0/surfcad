import assert from 'node:assert/strict';
import test from 'node:test';
import { moldPartingCommand } from './moldParting.js';

test('mold_parting forwards on and returns the face counts', () => {
  const seen = [];
  const ctx = {
    moldParting: ({ on }) => {
      seen.push(on);
      return { on: true, cavity: 1, core: 1, parting: 4, lines: 2 };
    },
  };
  const out = moldPartingCommand.run(ctx, { on: true });
  assert.deepEqual(seen, [true]);
  assert.equal(out.result.cavity, 1);
  assert.equal(out.result.lines, 2);
});

test('mold_parting toggles when on is omitted and reports a missing handler', () => {
  const seen = [];
  const ctx = {
    moldParting: ({ on }) => {
      seen.push(on);
      return { on: false };
    },
  };
  const toggled = moldPartingCommand.run(ctx, {});
  assert.deepEqual(seen, [undefined]);
  assert.equal(toggled.result.on, false);
  const missing = moldPartingCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});
