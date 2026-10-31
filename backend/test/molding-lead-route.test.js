/**
 * POST /api/molding/leads. Signed in, no charge, no partner name.
 * Run: cd backend && node --test test/molding-lead-route.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingLead from '../db/models/MoldingLead.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import { createMoldingLeadRouter } from '../routes/moldingLead.js';
import { installFakeModel } from './helpers/fakeDb.js';

const USER = '64b6f0c0a1b2c3d4e5f60718';
const previousFee = process.env.MOLDING_REVIEW_FEE_USD;

let partners;
let leads;
let server;
let base;

function auth(req, res, next) {
  const id = req.get('x-user-id');
  if (!id) return res.status(401).json({ error: 'Authentication required' });
  req.user = { _id: new mongoose.Types.ObjectId(id) };
  next();
}

async function listen(limiter) {
  const app = express();
  app.use(express.json());
  app.use('/api/molding', createMoldingLeadRouter({ limiter, requireAuth: auth }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function api(body, { user = USER } = {}) {
  const res = await fetch(`${base}/api/molding/leads`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(user ? { 'x-user-id': user } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  delete process.env.MOLDING_REVIEW_FEE_USD;
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  leads = installFakeModel(MoldingLead);
  await listen(createRateLimiter({ limit: 20, windowMs: 60_000 }));
});

beforeEach(() => {
  partners.rows.length = 0;
  leads.rows.length = 0;
});

after(async () => {
  if (previousFee === undefined) delete process.env.MOLDING_REVIEW_FEE_USD;
  else process.env.MOLDING_REVIEW_FEE_USD = previousFee;
  partners.restore();
  leads.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function partner() {
  return partners.insert({
    displayName: 'Secret Vendor',
    anonLabel: 'Partner A',
    region: 'Midwest',
    active: true,
    notes: 'internal',
  });
}

test('a firm quote records the lead and does not reveal the partner', async () => {
  await partner();
  const first = await api({
    type: 'firm_quote',
    anonLabel: 'Partner A',
    snapshot: { quantity: 100, aluminumUsd: 1.37, steelUsd: 0.55, range: { lowUsd: 0.55, highUsd: 1.37 } },
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.revealed, false);
  assert.equal(first.body.displayName, undefined);
  assert.equal(first.body.payForReview, true);
  assert.equal(first.body.message, 'Pay for review to see the partner.');
  assert.equal(first.body.reviewFeePaid, false);
  assert.equal(first.body.anonLabel, 'Partner A');
  assert.doesNotMatch(JSON.stringify(first.body), /Secret Vendor|internal|stripe/);
  const again = await api({ type: 'firm_quote', anonLabel: 'Partner A' });
  assert.equal(again.status, 201);
  assert.equal(again.body.leadId, first.body.leadId);
  assert.equal(again.body.revealed, false);
  assert.equal(again.body.displayName, undefined);
  assert.equal(leads.rows.length, 1);
  assert.equal(leads.rows[0].reviewFeePaid, false);
  assert.equal(leads.rows[0].stripePaymentIntentId, '');
  assert.equal(leads.rows[0].commissionOwedUsd, 0);
  assert.equal(leads.rows[0].status, 'sent');
});

test('human review stores a lead and does not reveal the name or mark it paid', async () => {
  await partner();
  const res = await api({ type: 'human_review', anonLabel: 'Partner A' });
  assert.equal(res.status, 201);
  assert.equal(res.body.revealed, false);
  assert.equal(res.body.reviewFeePaid, false);
  assert.equal(res.body.reviewFeeUsd, null);
  assert.equal(res.body.payForReview, true);
  assert.equal(res.body.message, 'Pay for review to see the partner.');
  assert.equal(res.body.displayName, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /Secret Vendor/);
  assert.equal(leads.rows[0].type, 'human_review');
  assert.equal(leads.rows[0].reviewFeePaid, false);
});

test('a signed-out caller and a client price are refused', async () => {
  await partner();
  const signedOut = await api({ type: 'firm_quote', anonLabel: 'Partner A' }, { user: '' });
  assert.equal(signedOut.status, 401);
  assert.equal(leads.rows.length, 0);
  const priced = await api({ type: 'firm_quote', anonLabel: 'Partner A', displayName: 'Secret Vendor' });
  assert.equal(priced.status, 400);
  assert.match(priced.body.error.message, /unknown field/);
  const paid = await api({ type: 'human_review', anonLabel: 'Partner A', reviewFeePaid: true });
  assert.equal(paid.status, 400);
  assert.equal(leads.rows.length, 0);
});

test('the limiter answers 429', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/molding', createMoldingLeadRouter({
    limiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    requireAuth: auth,
  }));
  const httpServer = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const url = `http://127.0.0.1:${httpServer.address().port}/api/molding/leads`;
  const post = () => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': USER },
    body: JSON.stringify({ type: 'firm_quote', anonLabel: 'Missing' }),
  });
  assert.equal((await post()).status, 404);
  assert.equal((await post()).status, 429);
  await new Promise((resolve) => httpServer.close(resolve));
});
