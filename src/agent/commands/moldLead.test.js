import assert from 'node:assert/strict';
import test from 'node:test';
import { moldFirmQuoteCommand, moldHumanReviewCommand } from './moldLead.js';

test('firm quote forwards the label and returns the revealed name', async () => {
  const seen = [];
  const ctx = {
    moldRequestFirmQuote: (args) => {
      seen.push(args);
      return Promise.resolve({ revealed: true, anonLabel: args.anonLabel, displayName: 'Acme Molding' });
    },
  };
  const out = await moldFirmQuoteCommand.run(ctx, { anonLabel: 'Partner A' });
  assert.equal(seen[0].anonLabel, 'Partner A');
  assert.equal(out.result.displayName, 'Acme Molding');
  assert.equal(out.result.revealed, true);
});

test('human review does not require a handler result to include a name', async () => {
  const out = await moldHumanReviewCommand.run({
    moldRequestHumanReview: () => ({ revealed: false, reviewFeePaid: false, anonLabel: 'Partner A' }),
  }, {});
  assert.equal(out.result.revealed, false);
  assert.equal(out.result.displayName, undefined);
  const missing = moldFirmQuoteCommand.run({}, {});
  assert.equal(missing.error.code, 'internal');
});
