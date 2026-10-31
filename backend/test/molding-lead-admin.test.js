/**
 * Admin molding leads. Same 404 gate as the catalog. No requester identity.
 * Run: cd backend && node --test test/molding-lead-admin.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import config from '../config/index.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createAdminRouter } from '../routes/admin.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingLead from '../db/models/MoldingLead.js';
import { installFakeModel } from './helpers/fakeDb.js';

const previousLogins = config.adminGithubLogins;
const USER_ID = '64b6f0c0a1b2c3d4e5f60718';
let server;
let base;
let partners;
let leads;

async function listen() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const login = req.get('x-github-login');
    req.user = login ? { _id: 'admin-1', githubLogin: login } : undefined;
    req.isAuthenticated = () => Boolean(login);
    next();
  });
  app.use('/api/admin', createAdminRouter({
    requireAdmin,
    fetchAdminStats: async () => ({ days: 7 }),
    limiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function api(method, path, { login, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(login ? { 'x-github-login': login } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  if (text) parsed = JSON.parse(text);
  return { status: res.status, body: parsed, text };
}

async function seed() {
  const partner = await partners.insert({
    displayName: 'Secret Vendor',
    anonLabel: 'Partner A',
    region: 'Midwest',
    active: true,
    notes: 'internal note',
  });
  const other = await partners.insert({
    displayName: 'Other Shop',
    anonLabel: 'Partner B',
    region: 'East',
    active: true,
  });
  const newer = await leads.insert({
    userId: USER_ID,
    partnerId: partner._id,
    type: 'firm_quote',
    status: 'sent',
    commissionOwedUsd: 0,
    reviewFeePaid: false,
    stripePaymentIntentId: 'pi_test_secret',
    budgetaryQuoteSnapshot: { quantity: 100 },
  });
  const older = await leads.insert({
    userId: USER_ID,
    partnerId: other._id,
    type: 'human_review',
    status: 'won',
    commissionOwedUsd: 40,
    reviewFeePaid: false,
    stripePaymentIntentId: '',
  });
  const byId = new Map(leads.rows.map((row) => [String(row._id), row]));
  byId.get(String(newer._id)).createdAt = new Date('2026-02-02T00:00:00.000Z');
  byId.get(String(older._id)).createdAt = new Date('2026-01-01T00:00:00.000Z');
  return { partner, other, newer, older };
}

before(async () => {
  config.adminGithubLogins = new Set(['octocat']);
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  leads = installFakeModel(MoldingLead);
  await listen();
});

beforeEach(() => {
  partners.rows.length = 0;
  leads.rows.length = 0;
});

after(() => {
  config.adminGithubLogins = previousLogins;
  partners.restore();
  leads.restore();
  server?.close();
});

describe('admin molding leads', () => {
  test('signed-out and non-admin callers get 404 and no partner name', async () => {
    await seed();
    const signedOut = await api('GET', '/api/admin/molding/leads');
    const stranger = await api('GET', '/api/admin/molding/leads', { login: 'eve' });
    assert.equal(signedOut.status, 404);
    assert.equal(stranger.status, 404);
    assert.doesNotMatch(signedOut.text, /Secret Vendor|Partner A|pi_test/);
    assert.doesNotMatch(stranger.text, /Secret Vendor/);
  });

  test('lists newest first and filters by partner and status', async () => {
    const { partner } = await seed();
    const all = await api('GET', '/api/admin/molding/leads', { login: 'octocat' });
    assert.equal(all.status, 200);
    assert.equal(all.body.leads.length, 2);
    assert.equal(all.body.leads[0].anonLabel, 'Partner A');
    assert.equal(all.body.leads[0].partnerName, 'Secret Vendor');
    assert.equal(all.body.leads[0].status, 'sent');
    assert.equal(all.body.leads[1].status, 'won');
    assert.doesNotMatch(all.text, new RegExp(`${USER_ID}|pi_test_secret|internal note|userId|quantity`));

    const byPartner = await api(
      'GET',
      `/api/admin/molding/leads?partnerId=${partner._id}`,
      { login: 'octocat' },
    );
    assert.equal(byPartner.status, 200);
    assert.equal(byPartner.body.leads.length, 1);
    assert.equal(byPartner.body.leads[0].anonLabel, 'Partner A');

    const byStatus = await api('GET', '/api/admin/molding/leads?status=won', { login: 'octocat' });
    assert.equal(byStatus.status, 200);
    assert.equal(byStatus.body.leads.length, 1);
    assert.equal(byStatus.body.leads[0].anonLabel, 'Partner B');

    const both = await api(
      'GET',
      `/api/admin/molding/leads?partnerId=${partner._id}&status=won`,
      { login: 'octocat' },
    );
    assert.equal(both.status, 200);
    assert.deepEqual(both.body.leads, []);
  });

  test('rejects a requester filter and a bad status', async () => {
    await seed();
    const userFilter = await api('GET', `/api/admin/molding/leads?userId=${USER_ID}`, { login: 'octocat' });
    assert.equal(userFilter.status, 400);
    assert.match(userFilter.body.error, /Unknown field/);
    const bad = await api('GET', '/api/admin/molding/leads?status=paid', { login: 'octocat' });
    assert.equal(bad.status, 400);
  });

  test('patches status and commission and refuses payment or identity fields', async () => {
    const { newer } = await seed();
    const id = String(newer._id);
    const patched = await api('PATCH', `/api/admin/molding/leads/${id}`, {
      login: 'octocat',
      body: { status: 'quoted', commissionOwedUsd: 12.345 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.status, 'quoted');
    assert.equal(patched.body.commissionOwedUsd, 12.35);
    assert.equal(patched.body.partnerName, 'Secret Vendor');
    assert.equal(patched.body.reviewFeePaid, false);
    assert.doesNotMatch(patched.text, new RegExp(`${USER_ID}|pi_test_secret|userId`));
    assert.equal(leads.rows[0].status, 'quoted');
    assert.equal(leads.rows[0].reviewFeePaid, false);
    assert.equal(leads.rows[0].stripePaymentIntentId, 'pi_test_secret');

    const paid = await api('PATCH', `/api/admin/molding/leads/${id}`, {
      login: 'octocat',
      body: { reviewFeePaid: true },
    });
    assert.equal(paid.status, 400);
    assert.equal(leads.rows.find((row) => String(row._id) === id).reviewFeePaid, false);

    const identity = await api('PATCH', `/api/admin/molding/leads/${id}`, {
      login: 'octocat',
      body: { userId: USER_ID },
    });
    assert.equal(identity.status, 400);

    const negative = await api('PATCH', `/api/admin/molding/leads/${id}`, {
      login: 'octocat',
      body: { commissionOwedUsd: -1 },
    });
    assert.equal(negative.status, 400);
    assert.equal(leads.rows.find((row) => String(row._id) === id).commissionOwedUsd, 12.35);

    const missing = await api('PATCH', `/api/admin/molding/leads/${new mongoose.Types.ObjectId()}`, {
      login: 'octocat',
      body: { status: 'lost' },
    });
    assert.equal(missing.status, 404);

    const badId = await api('PATCH', '/api/admin/molding/leads/nope', {
      login: 'octocat',
      body: { status: 'lost' },
    });
    assert.equal(badId.status, 400);
  });
});
