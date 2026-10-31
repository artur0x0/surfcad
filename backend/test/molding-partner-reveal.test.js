/**
 * A partner name is returned only for the caller's own paid human-review
 * lead. The webhook is what marks it paid. A return URL is not.
 * Run: cd backend && node --test test/molding-partner-reveal.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingLead from '../db/models/MoldingLead.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import { createMoldingLeadRouter } from '../routes/moldingLead.js';
import { applyReviewCheckoutSession } from '../services/moldingReviewCheckout.js';
import { PAY_FOR_REVIEW_MESSAGE } from '../services/moldingLead.js';
import { installFakeModel } from './helpers/fakeDb.js';

const USER = '64b6f0c0a1b2c3d4e5f60718';
const OTHER = '64b6f0c0a1b2c3d4e5f60799';

let partners;
let leads;
let server;
let base;
let sessions;

const HIDDEN_KEYS = [
  'anonLabel',
  'leadId',
  'message',
  'payForReview',
  'revealed',
  'reviewFeePaid',
  'reviewFeeUsd',
  'status',
  'type',
];
const SHOWN_KEYS = [
  'anonLabel',
  'displayName',
  'leadId',
  'revealed',
  'reviewFeePaid',
  'reviewFeeUsd',
  'status',
  'type',
];

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
    limiter: createRateLimiter({ limit: 80, windowMs: 60_000 }),
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

async function insertPartner(anonLabel, displayName) {
  return partners.insert({
    displayName,
    anonLabel,
    region: 'Midwest',
    active: true,
    notes: 'internal',
  });
}

async function insertReview(partner, userId, { paid = false } = {}) {
  const lead = await leads.insert({
    userId,
    partnerId: partner._id,
    type: 'human_review',
    status: 'sent',
    commissionOwedUsd: 0,
    reviewFeePaid: false,
    stripePaymentIntentId: '',
  });
  if (!paid) return lead;
  const result = await applyReviewCheckoutSession({ MoldingLead }, {
    id: `cs_test_${String(partner._id)}`,
    payment_status: 'paid',
    amount_total: 2500,
    metadata: {
      purpose: 'molding_review',
      leadId: String(lead._id),
      userId: String(userId),
      feeCents: '2500',
    },
    payment_intent: `pi_test_${String(partner._id)}`,
  });
  assert.equal(result.applied, true);
  return lead;
}

function assertHidden(res) {
  assert.equal(res.body.revealed, false);
  assert.equal(res.body.reviewFeePaid, false);
  assert.equal(res.body.payForReview, true);
  assert.equal(res.body.message, PAY_FOR_REVIEW_MESSAGE);
  assert.equal(res.body.displayName, undefined);
  assert.deepEqual(Object.keys(res.body).sort(), HIDDEN_KEYS);
  assert.doesNotMatch(res.text, /Secret Vendor|Other Shop|internal|pi_test|notes/);
}

test('an unpaid reveal is refused', async () => {
  const partner = await insertPartner('Partner A', 'Secret Vendor');
  const firm = await call('/api/molding/leads', {
    body: { type: 'firm_quote', anonLabel: 'Partner A' },
  });
  assert.equal(firm.status, 201);
  assertHidden(firm);
  leads.rows[0].reviewFeePaid = true;
  const lied = await call('/api/molding/leads', {
    body: { type: 'firm_quote', anonLabel: 'Partner A' },
  });
  assert.equal(lied.status, 201);
  assertHidden(lied);
  assert.equal(leads.rows.filter((row) => row.type === 'firm_quote').length, 1);
  const review = await call('/api/molding/leads', {
    body: { type: 'human_review', anonLabel: 'Partner A' },
  });
  assert.equal(review.status, 201);
  assertHidden(review);
  const status = await call('/api/molding/review-status', {
    method: 'GET',
    query: '?anonLabel=Partner%20A',
  });
  assert.equal(status.status, 200);
  assertHidden(status);
  assert.equal(partner.displayName, 'Secret Vendor');
  assert.equal(leads.rows.every((row) => row.type !== 'human_review' || row.reviewFeePaid !== true), true);
});

test('another user cannot use a paid lead to reveal the partner', async () => {
  const partner = await insertPartner('Partner A', 'Secret Vendor');
  await insertReview(partner, USER, { paid: true });
  const status = await call('/api/molding/review-status', {
    method: 'GET',
    user: OTHER,
    query: '?anonLabel=Partner%20A',
  });
  assert.equal(status.status, 404);
  assert.equal(status.body.error.code, 'no_lead');
  assert.doesNotMatch(status.text, /Secret Vendor|internal/);
  const firm = await call('/api/molding/leads', {
    user: OTHER,
    body: { type: 'firm_quote', anonLabel: 'Partner A' },
  });
  assert.equal(firm.status, 201);
  assertHidden(firm);
  const review = await call('/api/molding/leads', {
    user: OTHER,
    body: { type: 'human_review', anonLabel: 'Partner A' },
  });
  assert.equal(review.status, 201);
  assertHidden(review);
  const borrowed = await call('/api/molding/review-status', {
    method: 'GET',
    user: OTHER,
    query: `?anonLabel=Partner%20A&leadId=${String(leads.rows[0]._id)}`,
  });
  assert.equal(borrowed.status, 400);
  assert.doesNotMatch(borrowed.text, /Secret Vendor|internal/);
  const owner = await call('/api/molding/review-status', {
    method: 'GET',
    user: USER,
    query: '?anonLabel=Partner%20A',
  });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.displayName, 'Secret Vendor');
  assert.equal(owner.body.revealed, true);
  assert.equal(owner.body.reviewFeePaid, true);
});

test('a paid lead reveals only its own partner', async () => {
  const partnerA = await insertPartner('Partner A', 'Secret Vendor');
  const partnerB = await insertPartner('Partner B', 'Other Shop');
  await insertReview(partnerA, USER, { paid: true });
  await insertReview(partnerB, USER, { paid: false });
  const own = await call('/api/molding/review-status', {
    method: 'GET',
    query: '?anonLabel=Partner%20A',
  });
  assert.equal(own.status, 200);
  assert.equal(own.body.displayName, 'Secret Vendor');
  assert.equal(own.body.anonLabel, 'Partner A');
  assert.equal(own.body.revealed, true);
  assert.equal(own.body.reviewFeePaid, true);
  assert.deepEqual(Object.keys(own.body).sort(), SHOWN_KEYS);
  assert.doesNotMatch(own.text, /Other Shop|internal|pi_test/);
  const other = await call('/api/molding/review-status', {
    method: 'GET',
    query: '?anonLabel=Partner%20B',
  });
  assert.equal(other.status, 200);
  assertHidden(other);
  const firmOther = await call('/api/molding/leads', {
    body: { type: 'firm_quote', anonLabel: 'Partner B' },
  });
  assert.equal(firmOther.status, 201);
  assertHidden(firmOther);
  const firmOwn = await call('/api/molding/leads', {
    body: { type: 'firm_quote', anonLabel: 'Partner A' },
  });
  assert.equal(firmOwn.status, 201);
  assert.equal(firmOwn.body.displayName, 'Secret Vendor');
  assert.equal(firmOwn.body.revealed, true);
  assert.doesNotMatch(firmOwn.text, /Other Shop|internal/);
  const firmRow = leads.rows.find((row) => String(row._id) === firmOwn.body.leadId);
  assert.equal(firmRow.type, 'firm_quote');
  assert.equal(firmRow.reviewFeePaid, false);
  assert.equal(String(firmRow.partnerId), String(partnerA._id));
  const paidRow = leads.rows.find((row) => String(row.partnerId) === String(partnerA._id) && row.type === 'human_review');
  assert.equal(paidRow.reviewFeePaid, true);
  const unpaidRow = leads.rows.find((row) => String(row.partnerId) === String(partnerB._id) && row.type === 'human_review');
  assert.equal(unpaidRow.reviewFeePaid, false);
});

test('the return url alone does not reveal the partner', async () => {
  await insertPartner('Partner A', 'Secret Vendor');
  const review = await call('/api/molding/leads', {
    body: { type: 'human_review', anonLabel: 'Partner A' },
  });
  assert.equal(review.status, 201);
  assertHidden(review);
  const bounced = await call('/api/molding/review-status', {
    method: 'GET',
    query: '?anonLabel=Partner%20A&moldReview=return',
  });
  assert.equal(bounced.status, 400);
  assert.match(bounced.body.error.message, /unknown field/);
  assert.doesNotMatch(bounced.text, /Secret Vendor|internal/);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  const claimed = await call('/api/molding/leads', {
    body: { type: 'firm_quote', anonLabel: 'Partner A', moldReview: 'return' },
  });
  assert.equal(claimed.status, 400);
  assert.doesNotMatch(claimed.text, /Secret Vendor|internal/);
  assert.equal(leads.rows.length, 1);
  const poisoned = await call('/api/molding/review-checkout', {
    body: { anonLabel: 'Partner A', moldReview: 'return' },
  });
  assert.equal(poisoned.status, 400);
  assert.equal(sessions.length, 0);
  assert.doesNotMatch(poisoned.text, /Secret Vendor|internal/);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  const checkout = await call('/api/molding/review-checkout', {
    body: { anonLabel: 'Partner A' },
  });
  assert.equal(checkout.status, 200);
  assert.equal(checkout.body.revealed, false);
  assert.equal(checkout.body.reviewFeePaid, false);
  assert.equal(checkout.body.displayName, undefined);
  assert.equal(checkout.body.url, 'https://checkout.stripe.com/c/pay/cs_test_mock');
  assert.doesNotMatch(checkout.text, /Secret Vendor|internal/);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  const status = await call('/api/molding/review-status', {
    method: 'GET',
    query: '?anonLabel=Partner%20A',
  });
  assert.equal(status.status, 200);
  assertHidden(status);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  assert.equal(sessions[0].success_url, 'https://surfcad.test/?moldReview=return');
});
