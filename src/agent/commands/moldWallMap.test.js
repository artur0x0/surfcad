import assert from 'node:assert/strict';
import test from 'node:test';
import { moldWallMapCommand } from './moldWallMap.js';

test('mold_wall_map forwards on and returns the legend numbers', async () => {
  const seen = [];
  const ctx = {
    moldWallMap: ({ on }) => {
      seen.push(on);
      return Promise.resolve({ on: true, nominal: 2, max: 8, thinMm: 1.2, thickMm: 3 });
    },
  };
  const out = await moldWallMapCommand.run(ctx, { on: true });
  assert.deepEqual(seen, [true]);
  assert.equal(out.result.on, true);
  assert.equal(out.result.nominal, 2);
  assert.equal(out.result.thickMm, 3);
});

test('mold_wall_map toggles when on is omitted and reports a missing handler', async () => {
  const seen = [];
  const ctx = {
    moldWallMap: ({ on }) => {
      seen.push(on);
      return { on: false };
    },
  };
  const toggled = await moldWallMapCommand.run(ctx, {});
  assert.deepEqual(seen, [undefined]);
  assert.equal(toggled.result.on, false);
  const missing = await moldWallMapCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});
