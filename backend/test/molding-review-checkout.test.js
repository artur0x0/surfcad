/**
 * Human-review Checkout. A session does not mark the lead paid.
 * A failed or unpaid event does not either. No card numbers, no email.
 * Run: cd backend && node --test test/molding-review-checkout.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingLead from '../db/models/MoldingLead.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import { createMoldingLeadRouter } from '../routes/moldingLead.js';
import { applyReviewCheckoutSession, applyReviewPaymentIntent } from '../services/moldingReviewCheckout.js';
import { reviewCheckoutKeyAllowed, reviewFeeUsdFromEnv } from '../services/reviewFeeEnv.js';
import { installFakeModel } from './helpers/fakeDb.js';

const USER = '64b6f0c0a1b2c3d4e5f60718';
let partners;
let leads;
let server;
let base;
let sessions;

function auth(req, res, next) {
  const id = req.get('x-user-id');
  if (!id) return res.status(401).json({ error: 'Authentication required' });
  req.user = { _id: new mongoose.Types.ObjectId(id) };
  next();
}

function stripeClient() {
  return {
    checkout: {
      sessions: {
        async create(params) {
          sessions.push(params);
          return { id: 'cs_test_mock', url: 'https://checkout.stripe.com/c/pay/cs_test_mock' };
        },
      },
    },
  };
}

async function listen() {
  const app = express();
  app.use(express.json());
  app.use('/api/molding', createMoldingLeadRouter({
    limiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    requireAuth: auth,
    stripeClient: stripeClient(),
    feeUsd: 25,
    frontendUrl: 'https://surfcad.test',
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function call(path, { method = 'POST', user = USER, body, query = '' } = {}) {
  const res = await fetch(`${base}${path}${query}`, {
    method,
    headers: {
      ...(user ? { 'x-user-id': user } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

before(async () => {
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  leads = installFakeModel(MoldingLead);
  await listen();
});

beforeEach(() => {
  partners.rows.length = 0;
  leads.rows.length = 0;
  sessions = [];
});

after(async () => {
  partners.restore();
  leads.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function partnerAndLead() {
  const partner = await partners.insert({
    displayName: 'Secret Vendor',
    anonLabel: 'Partner A',
    region: 'Midwest',
    active: true,
    notes: 'internal',
  });
  const lead = await leads.insert({
    userId: USER,
    partnerId: partner._id,
    type: 'human_review',
    status: 'sent',
    commissionOwedUsd: 0,
    reviewFeePaid: false,
    stripePaymentIntentId: '',
  });
  return { partner, lead };
}

test('the fee parser accepts dollars and cents and rejects a blank or a live default', () => {
  assert.equal(reviewFeeUsdFromEnv({ MOLDING_REVIEW_FEE_USD: '150' }), 150);
  assert.equal(reviewFeeUsdFromEnv({ MOLDING_REVIEW_FEE_USD: '25.50' }), 25.5);
  assert.equal(reviewFeeUsdFromEnv({ MOLDING_REVIEW_FEE_USD: '' }), null);
  assert.equal(reviewFeeUsdFromEnv({}), null);
  assert.equal(reviewFeeUsdFromEnv({ MOLDING_REVIEW_FEE_USD: '0.10' }), null);
  const testKey = 'sk_test_123';
  const liveKey = 'sk_' + 'live_123';
  assert.equal(reviewCheckoutKeyAllowed(testKey, 'development'), true);
  assert.equal(reviewCheckoutKeyAllowed(liveKey, 'development'), false);
  assert.equal(reviewCheckoutKeyAllowed(liveKey, 'test'), false);
  assert.equal(reviewCheckoutKeyAllowed(liveKey, 'production'), true);
  assert.equal(reviewCheckoutKeyAllowed('', 'production'), false);
});

test('checkout returns a hosted url and does not mark the lead paid or reveal the name', async () => {
  const { lead } = await partnerAndLead();
  const res = await call('/api/molding/review-checkout', { body: { anonLabel: 'Partner A' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/cs_test_mock');
  assert.equal(res.body.reviewFeePaid, false);
  assert.equal(res.body.revealed, false);
  assert.equal(res.body.displayName, undefined);
  assert.doesNotMatch(res.text, /Secret Vendor|internal|4242/);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  assert.equal(leads.rows[0].stripePaymentIntentId, '');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].mode, 'payment');
  assert.equal(sessions[0].line_items[0].price_data.unit_amount, 2500);
  assert.equal(sessions[0].metadata.purpose, 'molding_review');
  assert.equal(sessions[0].metadata.leadId, String(lead._id));
  assert.equal(sessions[0].metadata.feeCents, '2500');
  assert.equal(sessions[0].success_url, 'https://surfcad.test/?moldReview=return');
  assert.equal(sessions[0].cancel_url, 'https://surfcad.test/?moldReview=cancel');
  assert.equal(sessions[0].customer_email, undefined);
  assert.equal(JSON.stringify(sessions[0]).includes('4242'), false);
});

test('a price field, a missing lead, and a signed-out caller do not start checkout', async () => {
  await partnerAndLead();
  const priced = await call('/api/molding/review-checkout', {
    body: { anonLabel: 'Partner A', reviewFeePaid: true },
  });
  assert.equal(priced.status, 400);
  assert.equal(sessions.length, 0);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  const missing = await call('/api/molding/review-checkout', { body: { anonLabel: 'Partner B' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'unknown_partner');
  await partners.insert({
    displayName: 'Other Shop',
    anonLabel: 'Partner B',
    region: 'East',
    active: true,
  });
  const noLead = await call('/api/molding/review-checkout', { body: { anonLabel: 'Partner B' } });
  assert.equal(noLead.status, 404);
  assert.equal(noLead.body.error.code, 'no_lead');
  const signedOut = await call('/api/molding/review-checkout', { user: '', body: { anonLabel: 'Partner A' } });
  assert.equal(signedOut.status, 401);
  assert.equal(sessions.length, 0);
});

test('an unpaid session and a failed payment intent do not reveal the partner', async () => {
  const { lead } = await partnerAndLead();
  const meta = {
    purpose: 'molding_review',
    leadId: String(lead._id),
    userId: USER,
    feeCents: '2500',
  };
  const unpaid = await applyReviewCheckoutSession({ MoldingLead }, {
    id: 'cs_test_unpaid',
    payment_status: 'unpaid',
    amount_total: 2500,
    metadata: meta,
  });
  assert.equal(unpaid.reason, 'unpaid');
  assert.equal(leads.rows[0].reviewFeePaid, false);
  const expired = await applyReviewCheckoutSession({ MoldingLead }, {
    id: 'cs_test_expired',
    payment_status: 'unpaid',
    status: 'expired',
    amount_total: 0,
    metadata: meta,
  });
  assert.equal(expired.reason, 'unpaid');
  const failed = await applyReviewPaymentIntent({ MoldingLead }, {
    id: 'pi_test_failed',
    status: 'requires_payment_method',
    amount_received: 0,
    amount: 2500,
    metadata: meta,
  });
  assert.equal(failed.reason, 'unpaid');
  const cheap = await applyReviewCheckoutSession({ MoldingLead }, {
    id: 'cs_test_cheap',
    payment_status: 'paid',
    amount_total: 50,
    metadata: meta,
    payment_intent: 'pi_test_cheap',
  });
  assert.equal(cheap.reason, 'amount');
  assert.equal(leads.rows[0].reviewFeePaid, false);
  assert.equal(leads.rows[0].stripePaymentIntentId, '');
  const status = await call('/api/molding/review-status', { method: 'GET', query: '?anonLabel=Partner%20A' });
  assert.equal(status.status, 200);
  assert.equal(status.body.revealed, false);
  assert.equal(status.body.displayName, undefined);
});

test('a paid checkout session reveals the name and a second event does not change the payment id', async () => {
  const { lead } = await partnerAndLead();
  const meta = {
    purpose: 'molding_review',
    leadId: String(lead._id),
    userId: USER,
    feeCents: '2500',
  };
  const paid = await applyReviewCheckoutSession({ MoldingLead }, {
    id: 'cs_test_paid',
    payment_status: 'paid',
    amount_total: 2500,
    metadata: meta,
    payment_intent: 'pi_test_paid',
  });
  assert.equal(paid.applied, true);
  assert.equal(leads.rows[0].reviewFeePaid, true);
  assert.equal(leads.rows[0].stripePaymentIntentId, 'pi_test_paid');
  const again = await applyReviewPaymentIntent({ MoldingLead }, {
    id: 'pi_test_other',
    status: 'succeeded',
    amount_received: 2500,
    metadata: meta,
  });
  assert.equal(again.already, true);
  assert.equal(leads.rows[0].stripePaymentIntentId, 'pi_test_paid');
  const status = await call('/api/molding/review-status', { method: 'GET', query: '?anonLabel=Partner%20A' });
  assert.equal(status.body.revealed, true);
  assert.equal(status.body.displayName, 'Secret Vendor');
  assert.equal(status.body.reviewFeePaid, true);
  assert.doesNotMatch(status.text, /pi_test_paid|internal/);
  const checkout = await call('/api/molding/review-checkout', { body: { anonLabel: 'Partner A' } });
  assert.equal(checkout.status, 200);
  assert.equal(checkout.body.revealed, true);
  assert.equal(checkout.body.url, undefined);
  assert.equal(sessions.length, 0);
});

test('a payment intent for someone else does not mark the lead paid', async () => {
  const { lead } = await partnerAndLead();
  const wrong = await applyReviewPaymentIntent({ MoldingLead }, {
    id: 'pi_test_other_user',
    status: 'succeeded',
    amount_received: 2500,
    metadata: {
      purpose: 'molding_review',
      leadId: String(lead._id),
      userId: '64b6f0c0a1b2c3d4e5f60799',
      feeCents: '2500',
    },
  });
  assert.equal(wrong.reason, 'lead');
  assert.equal(leads.rows[0].reviewFeePaid, false);
});
