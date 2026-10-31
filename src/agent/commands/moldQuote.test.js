import assert from 'node:assert/strict';
import test from 'node:test';
import { moldQuoteCommand } from './moldQuote.js';

test('mold_quote forwards quantity and returns the quote', async () => {
  const seen = [];
  const ctx = {
    moldQuote: (args) => {
      seen.push(args);
      return Promise.resolve({
        on: true,
        framing: 'Budgetary quote',
        disclaimer: 'Budgetary, not binding.',
        quantity: args.quantity,
      });
    },
  };
  const out = await moldQuoteCommand.run(ctx, { on: true, quantity: 1000, grade: 'ABS' });
  assert.equal(seen[0].quantity, 1000);
  assert.equal(seen[0].grade, 'ABS');
  assert.equal(out.result.disclaimer, 'Budgetary, not binding.');
  assert.equal(out.error, undefined);
});

test('mold_quote toggles when on is omitted and reports a missing handler', async () => {
  const seen = [];
  const ctx = {
    moldQuote: ({ on }) => {
      seen.push(on);
      return { on: false };
    },
  };
  const toggled = await moldQuoteCommand.run(ctx, {});
  assert.deepEqual(seen, [undefined]);
  assert.equal(toggled.result.on, false);
  const missing = moldQuoteCommand.run({}, { on: false });
  assert.equal(missing.error.code, 'internal');
});
