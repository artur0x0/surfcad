import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutUrlAllowed, leadBody, postMoldingLead, postReviewCheckout } from './moldingLeadClient.js';

test('the lead body names the public label and not the real name', () => {
  const body = leadBody('firm_quote', {
    anonLabel: 'Partner A',
    displayName: 'Acme Molding',
    grade: 'ABS',
    region: 'Midwest',
    machineCount: 2,
    aluminumUsd: 1.37,
    steelUsd: 0.55,
    steelCheaperAt: 500,
    range: { lowUsd: 0.55, highUsd: 1.37 },
  }, { quantity: 100, cavityCount: 1, disclaimer: 'Budgetary, not binding.' });
  assert.equal(body.anonLabel, 'Partner A');
  assert.equal(JSON.stringify(body).includes('Acme'), false);
  assert.equal(JSON.stringify(body).includes('displayName'), false);
});

test('a signed-out lead request becomes sign_in', async () => {
  const out = await postMoldingLead({ type: 'firm_quote', anonLabel: 'Partner A' }, async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Authentication required' }),
  }));
  assert.equal(out.error.code, 'sign_in');
});

test('review checkout sends only the public label', async () => {
  let seen = null;
  const out = await postReviewCheckout('Partner A', async (url, init) => {
    seen = { url, body: init.body };
    return {
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_mock', revealed: false }),
    };
  });
  assert.equal(seen.url, '/api/molding/review-checkout');
  assert.equal(seen.body, JSON.stringify({ anonLabel: 'Partner A' }));
  assert.equal(out.url.startsWith('https://'), true);
  assert.equal(checkoutUrlAllowed('http://checkout.stripe.com/pay'), null);
  assert.equal(checkoutUrlAllowed('https://checkout.stripe.com/c/pay/cs_test_mock'), 'https://checkout.stripe.com/c/pay/cs_test_mock');
});
