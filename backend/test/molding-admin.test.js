/**
 * Admin molding catalog. 404 for everyone except the GitHub allowlist.
 * Run: cd backend && node --test test/molding-admin.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import config from '../config/index.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { ADMIN_STATS_RATE, createAdminRouter } from '../routes/admin.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingMachine from '../db/models/MoldingMachine.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingToolingRate from '../db/models/MoldingToolingRate.js';
import { installFakeModel } from './helpers/fakeDb.js';

const previousLogins = config.adminGithubLogins;
let server;
let base;
let partners;
let machines;
let resins;
let rates;

function machineBody(partnerId, overrides = {}) {
  return {
    partnerId,
    name: 'Press 1',
    tonnage: 150,
    platenWidthMm: 500,
    platenHeightMm: 480,
    tieBarSpacingXMm: 460,
    tieBarSpacingYMm: 450,
    barrelShotCm3: 200,
    utilizationPct: 70,
    hourlyRateUsd: 85,
    ...overrides,
  };
}

function rateBody(partnerId, overrides = {}) {
  return {
    partnerId,
    aluminumUsdPerKg: 8,
    steelUsdPerKg: 4,
    aluminumMachiningUsdPerHour: 90,
    steelMachiningUsdPerHour: 110,
    baseHoursSimple: 40,
    coolingLineHoursFactor: 0.5,
    slideAdderUsd: 400,
    lifterAdderUsd: 250,
    ejectorPinUsd: 12,
    sleeveUsd: 40,
    hotRunnerSuggestionUsd: 0,
    ...overrides,
  };
}

async function listen(limiter) {
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
    limiter,
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
  return { status: res.status, body: parsed };
}

before(async () => {
  config.adminGithubLogins = new Set(['octocat']);
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  machines = installFakeModel(MoldingMachine);
  resins = installFakeModel(MoldingResinPrice);
  rates = installFakeModel(MoldingToolingRate);
  await listen(createRateLimiter({ limit: 100, windowMs: 60_000 }));
});

beforeEach(() => {
  partners.rows.length = 0;
  machines.rows.length = 0;
  resins.rows.length = 0;
  rates.rows.length = 0;
});

after(() => {
  config.adminGithubLogins = previousLogins;
  partners.restore();
  machines.restore();
  resins.restore();
  rates.restore();
  server?.close();
});

describe('molding catalog access', () => {
  test('signed-out and non-admin callers get 404 and no vendor name', async () => {
    const created = await api('POST', '/api/admin/molding/partners', {
      login: 'octocat',
      body: { displayName: 'Secret Vendor', anonLabel: 'Partner A', region: 'Midwest' },
    });
    assert.equal(created.status, 201);
    const hidden = JSON.stringify(created.body);

    for (const login of [undefined, 'someone-else']) {
      const listed = await api('GET', '/api/admin/molding/partners', { login });
      assert.equal(listed.status, 404);
      assert.equal(listed.body.error, 'Not found');
      assert.equal(JSON.stringify(listed.body).includes('Secret Vendor'), false);
      const posted = await api('POST', '/api/admin/molding/partners', {
        login,
        body: { displayName: 'Other Vendor', anonLabel: 'Partner Z', region: 'West' },
      });
      assert.equal(posted.status, 404);
      assert.notEqual(posted.status, 403);
    }
    assert.equal(partners.rows.length, 1);
    assert.equal(hidden.includes('Secret Vendor'), true);
  });

  test('a bad id still 404s for a non-admin', async () => {
    const res = await api('POST', '/api/admin/molding/machines', {
      login: 'someone-else',
      body: { tonnage: -1, barrelShotCm3: 0 },
    });
    assert.equal(res.status, 404);
    assert.equal(machines.rows.length, 0);
  });
});

describe('molding catalog writes', () => {
  test('admin can add, list, edit, and deactivate a partner', async () => {
    const created = await api('POST', '/api/admin/molding/partners', {
      login: 'octocat',
      body: { displayName: 'Acme Molding', anonLabel: 'Partner A', region: 'Midwest', notes: 'floor 2' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.displayName, 'Acme Molding');
    assert.equal(created.body.active, true);
    const id = created.body._id;

    const dup = await api('POST', '/api/admin/molding/partners', {
      login: 'octocat',
      body: { displayName: 'Other', anonLabel: 'Partner A', region: 'West' },
    });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error, /anonLabel/);

    const listed = await api('GET', '/api/admin/molding/partners', { login: 'octocat' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.partners.length, 1);
    assert.equal(listed.body.partners[0].displayName, 'Acme Molding');

    const patched = await api('PATCH', `/api/admin/molding/partners/${id}`, {
      login: 'octocat',
      body: { region: 'Southeast' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.region, 'Southeast');

    const off = await api('POST', `/api/admin/molding/partners/${id}/deactivate`, { login: 'octocat' });
    assert.equal(off.status, 200);
    assert.equal(off.body.active, false);
    const still = await api('GET', '/api/admin/molding/partners', { login: 'octocat' });
    assert.equal(still.body.partners[0].active, false);

    const on = await api('PATCH', `/api/admin/molding/partners/${id}`, {
      login: 'octocat',
      body: { active: true },
    });
    assert.equal(on.body.active, true);
  });

  test('unknown fields and a blank name are rejected', async () => {
    const unknown = await api('POST', '/api/admin/molding/partners', {
      login: 'octocat',
      body: {
        displayName: 'Acme',
        anonLabel: 'Partner A',
        region: 'Midwest',
        stripePaymentIntentId: 'pi_test',
      },
    });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /Unknown field/);
    assert.equal(partners.rows.length, 0);

    const blank = await api('POST', '/api/admin/molding/partners', {
      login: 'octocat',
      body: { displayName: '   ', anonLabel: 'Partner A', region: 'Midwest' },
    });
    assert.equal(blank.status, 400);
  });

  test('tonnage, shot size, and prices must be in range', async () => {
    const partner = await api('POST', '/api/admin/molding/partners', {
      login: 'octocat',
      body: { displayName: 'Acme', anonLabel: 'Partner A', region: 'Midwest' },
    });
    const partnerId = partner.body._id;

    for (const overrides of [
      { tonnage: 0 },
      { tonnage: -5 },
      { barrelShotCm3: 0 },
      { barrelShotCm3: -1 },
      { utilizationPct: 101 },
      { hourlyRateUsd: -1 },
    ]) {
      const res = await api('POST', '/api/admin/molding/machines', {
        login: 'octocat',
        body: machineBody(partnerId, overrides),
      });
      assert.equal(res.status, 400, JSON.stringify(overrides));
    }
    assert.equal(machines.rows.length, 0);

    const missingPartner = await api('POST', '/api/admin/molding/machines', {
      login: 'octocat',
      body: machineBody(new mongoose.Types.ObjectId().toString()),
    });
    assert.equal(missingPartner.status, 400);
    assert.match(missingPartner.body.error, /Partner not found/);

    const created = await api('POST', '/api/admin/molding/machines', {
      login: 'octocat',
      body: machineBody(partnerId),
    });
    assert.equal(created.status, 201);
    assert.ok(created.body.utilizationUpdatedAt);
    const kept = created.body.tonnage;

    const badEdit = await api('PATCH', `/api/admin/molding/machines/${created.body._id}`, {
      login: 'octocat',
      body: { tonnage: 0 },
    });
    assert.equal(badEdit.status, 400);
    const again = await api('GET', `/api/admin/molding/machines?partnerId=${partnerId}`, { login: 'octocat' });
    assert.equal(again.body.machines[0].tonnage, kept);

    const sameName = await api('POST', '/api/admin/molding/machines', {
      login: 'octocat',
      body: machineBody(partnerId, { name: 'Press 1' }),
    });
    assert.equal(sameName.status, 400);

    const resinNeg = await api('POST', '/api/admin/molding/resins', {
      login: 'octocat',
      body: { partnerId, grade: 'ABS', usdPerKg: -0.01, densityGCm3: 1.04 },
    });
    assert.equal(resinNeg.status, 400);
    const resin = await api('POST', '/api/admin/molding/resins', {
      login: 'octocat',
      body: { partnerId, grade: 'ABS', usdPerKg: 0, densityGCm3: 1.04 },
    });
    assert.equal(resin.status, 201);
    const otherCase = await api('POST', '/api/admin/molding/resins', {
      login: 'octocat',
      body: { partnerId, grade: 'abs', usdPerKg: 2, densityGCm3: 1.04 },
    });
    assert.equal(otherCase.status, 201);
    const sameGrade = await api('POST', '/api/admin/molding/resins', {
      login: 'octocat',
      body: { partnerId, grade: 'ABS', usdPerKg: 3, densityGCm3: 1.04 },
    });
    assert.equal(sameGrade.status, 400);

    const rateNeg = await api('POST', '/api/admin/molding/rates', {
      login: 'octocat',
      body: rateBody(partnerId, { slideAdderUsd: -1 }),
    });
    assert.equal(rateNeg.status, 400);
    const rate = await api('POST', '/api/admin/molding/rates', {
      login: 'octocat',
      body: rateBody(partnerId),
    });
    assert.equal(rate.status, 201);
    assert.equal(rate.body.hotRunnerSuggestionUsd, 0);
    const second = await api('POST', '/api/admin/molding/rates', {
      login: 'octocat',
      body: rateBody(partnerId),
    });
    assert.equal(second.status, 400);

    const off = await api('POST', `/api/admin/molding/machines/${created.body._id}/deactivate`, {
      login: 'octocat',
    });
    assert.equal(off.status, 200);
    assert.equal(off.body.active, false);
    const partnerStill = await api('GET', '/api/admin/molding/partners', { login: 'octocat' });
    assert.equal(partnerStill.body.partners[0].active, true);
  });

  test('a missing row is 404 and a bad id is 400', async () => {
    const missing = await api(
      'POST',
      `/api/admin/molding/partners/${new mongoose.Types.ObjectId().toString()}/deactivate`,
      { login: 'octocat' },
    );
    assert.equal(missing.status, 404);
    const bad = await api('PATCH', '/api/admin/molding/partners/nope', {
      login: 'octocat',
      body: { region: 'West' },
    });
    assert.equal(bad.status, 400);
  });
});

describe('molding catalog rate limit', () => {
  test('the admin limiter answers 429 with the stats message', async () => {
    const limited = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const app = express();
    app.use((req, res, next) => {
      req.user = { _id: 'admin-1', githubLogin: 'octocat' };
      req.isAuthenticated = () => true;
      next();
    });
    app.use('/api/admin', createAdminRouter({
      requireAdmin,
      fetchAdminStats: async () => ({ days: 7 }),
      limiter: limited,
    }));
    const local = await new Promise((resolve) => {
      const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
    });
    try {
      const url = `http://127.0.0.1:${local.address().port}/api/admin/molding/partners`;
      const first = await fetch(url);
      const second = await fetch(url);
      const third = await fetch(url);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429);
      assert.equal((await third.json()).error, ADMIN_STATS_RATE);
    } finally {
      await new Promise((resolve) => local.close(resolve));
    }
  });
});
