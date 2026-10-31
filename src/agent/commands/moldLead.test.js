import assert from 'node:assert/strict';
import test from 'node:test';
import { moldFirmQuoteCommand, moldHumanReviewCommand, moldPayReviewCommand } from './moldLead.js';

test('firm quote forwards the label and does not invent a partner name', async () => {
  const seen = [];
  const ctx = {
    moldRequestFirmQuote: (args) => {
      seen.push(args);
      return Promise.resolve({
        revealed: false,
        reviewFeePaid: false,
        payForReview: true,
        anonLabel: args.anonLabel,
        message: 'Pay for review to see the partner.',
      });
    },
  };
  const out = await moldFirmQuoteCommand.run(ctx, { anonLabel: 'Partner A' });
  assert.equal(seen[0].anonLabel, 'Partner A');
  assert.equal(out.result.revealed, false);
  assert.equal(out.result.reviewFeePaid, false);
  assert.equal(out.result.displayName, undefined);
  assert.equal(out.result.message, 'Pay for review to see the partner.');
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

test('pay review forwards the label and does not invent a card charge', async () => {
  const out = await moldPayReviewCommand.run({
    moldPayHumanReview: ({ anonLabel }) => ({
      anonLabel,
      url: 'https://checkout.stripe.com/c/pay/cs_test_mock',
      revealed: false,
      reviewFeePaid: false,
    }),
  }, { anonLabel: 'Partner A' });
  assert.equal(out.result.anonLabel, 'Partner A');
  assert.equal(out.result.revealed, false);
  assert.equal(out.result.displayName, undefined);
});
