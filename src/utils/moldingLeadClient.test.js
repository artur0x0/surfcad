import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkoutUrlAllowed,
  clearReviewLabel,
  leadBody,
  partnerUnlocked,
  pollReviewStatus,
  postMoldingLead,
  postReviewCheckout,
  readReviewLabel,
  rememberReviewLabel,
} from './moldingLeadClient.js';

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

test('a return url and an unpaid name do not unlock the partner', async () => {
  assert.equal(partnerUnlocked({ revealed: true, displayName: 'Secret Vendor', reviewFeePaid: false }), false);
  assert.equal(partnerUnlocked({ revealed: true, displayName: 'Secret Vendor' }), false);
  assert.equal(partnerUnlocked({ reviewFeePaid: true, revealed: false, displayName: 'Secret Vendor' }), false);
  const storage = new Map();
  const bin = {
    setItem(key, value) { storage.set(key, value); },
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    removeItem(key) { storage.delete(key); },
  };
  rememberReviewLabel('Partner A', bin);
  assert.equal(readReviewLabel(bin), 'Partner A');
  clearReviewLabel(bin);
  assert.equal(readReviewLabel(bin), '');
  const seen = [];
  const unpaid = await pollReviewStatus('Partner A', {
    attempts: 2,
    intervalMs: 5,
    sleep: async () => {},
    fetchImpl: async (url) => {
      seen.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          revealed: true,
          displayName: 'Secret Vendor',
          reviewFeePaid: false,
          anonLabel: 'Partner A',
          notes: 'internal',
        }),
      };
    },
  });
  assert.deepEqual(seen, [
    '/api/molding/review-status?anonLabel=Partner+A',
    '/api/molding/review-status?anonLabel=Partner+A',
  ]);
  assert.equal(seen.some((url) => url.includes('moldReview')), false);
  assert.equal(unpaid.displayName, undefined);
  assert.equal(unpaid.notes, undefined);
  assert.equal(unpaid.revealed, false);
  assert.equal(partnerUnlocked(unpaid), false);
});

test('polling stops when the review status says the fee is paid', async () => {
  let calls = 0;
  const out = await pollReviewStatus('Partner B', {
    attempts: 5,
    intervalMs: 1,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      const paid = calls === 3;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          revealed: paid,
          reviewFeePaid: paid,
          displayName: paid ? 'Other Shop' : 'Secret Vendor',
          anonLabel: 'Partner B',
        }),
      };
    },
  });
  assert.equal(calls, 3);
  assert.equal(out.displayName, 'Other Shop');
  assert.equal(partnerUnlocked(out), true);
});
