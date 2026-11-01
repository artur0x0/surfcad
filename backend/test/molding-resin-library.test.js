/**
 * Generic injection-resin library. Separate from partner $/kg rows.
 * Run: cd backend && node --test test/molding-resin-library.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import config from '../config/index.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createAdminRouter } from '../routes/admin.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import Material from '../db/models/Material.js';
import MoldingResin from '../db/models/MoldingResin.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingPartner from '../db/models/MoldingPartner.js';
import { MOLDING_RESIN_SEED } from '../db/models/moldingResinSeed.js';
import { installFakeModel } from './helpers/fakeDb.js';

const previousLogins = config.adminGithubLogins;
let server;
let base;
let library;
let prices;
let partners;
let materials;

const partnerId = '507f1f77bcf86cd799439011';

function absBody(overrides = {}) {
  return {
    grade: 'ABS-custom',
    tensileModulusMpa: 2100,
    shrinkLowPct: 0.4,
    shrinkHighPct: 0.8,
    wallMinMm: 1.5,
    wallMaxMm: 3.2,
    meltTempLowC: 220,
    meltTempHighC: 250,
    moldTempLowC: 50,
    moldTempHighC: 70,
    ...overrides,
  };
}

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
    moldingModels: {
      partners: MoldingPartner,
      machines: { find() { return { sort() { return this; }, then(fn) { return Promise.resolve([]).then(fn); } } } },
      resins: MoldingResinPrice,
      rates: { find() { return { sort() { return this; }, then(fn) { return Promise.resolve([]).then(fn); } } } },
      leads: { find() { return { sort() { return this; }, then(fn) { return Promise.resolve([]).then(fn); } } } },
      library: MoldingResin,
    },
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function api(method, path, { login = 'octocat', body } = {}) {
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
  library = installFakeModel(MoldingResin, { unique: ['grade'] });
  prices = installFakeModel(MoldingResinPrice, { unique: ['grade'] });
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  materials = installFakeModel(Material);
  await listen();
});

beforeEach(() => {
  library.rows.length = 0;
  prices.rows.length = 0;
  partners.rows.length = 0;
  materials.rows.length = 0;
});

after(() => {
  config.adminGithubLogins = previousLogins;
  library.restore();
  prices.restore();
  partners.restore();
  materials.restore();
  server?.close();
});

describe('molding resin library', () => {
  test('the quote service does not read the library', () => {
    const quote = readFileSync(new URL('../services/moldingQuote.js', import.meta.url), 'utf8');
    const route = readFileSync(new URL('../routes/moldingQuote.js', import.meta.url), 'utf8');
    assert.equal(/\bMoldingResin\b/.test(quote), false);
    assert.equal(quote.includes('molding_resins'), false);
    assert.equal(route.includes('resin-library'), false);
    assert.equal(route.includes('MoldingResinPrice'), true);
  });

  test('an admin list inserts missing seed grades and leaves prices alone', async () => {
    const listed = await api('GET', '/api/admin/molding/resin-library');
    assert.equal(listed.status, 200);
    const grades = listed.body.resins.map((row) => row.grade).sort();
    assert.deepEqual(grades, MOLDING_RESIN_SEED.map((row) => row.grade).sort());
    const abs = listed.body.resins.find((row) => row.grade === 'ABS');
    assert.equal(abs.tensileModulusMpa, 2300);
    assert.equal(abs.usdPerKg, undefined);
    assert.equal(abs.densityGCm3, undefined);
    assert.equal(abs.partnerId, undefined);
    assert.equal(prices.rows.length, 0);
    assert.equal(materials.rows.length, 0);
    assert.equal(library.rows.length, MOLDING_RESIN_SEED.length);

    library.rows.find((row) => row.grade === 'ABS').active = false;
    library.rows.find((row) => row.grade === 'ABS').tensileModulusMpa = 1111;
    const again = await api('GET', '/api/admin/molding/resin-library');
    assert.equal(again.status, 200);
    assert.equal(library.rows.length, MOLDING_RESIN_SEED.length);
    const kept = again.body.resins.find((row) => row.grade === 'ABS');
    assert.equal(kept.active, false);
    assert.equal(kept.tensileModulusMpa, 1111);
  });

  test('signed-out and non-admin callers get 404', async () => {
    for (const login of [null, 'someone-else']) {
      const listed = await api('GET', '/api/admin/molding/resin-library', { login });
      assert.equal(listed.status, 404);
      const posted = await api('POST', '/api/admin/molding/resin-library', {
        login,
        body: absBody(),
      });
      assert.equal(posted.status, 404);
    }
    assert.equal(library.rows.length, 0);
  });

  test('a library write rejects a price and does not touch partner resins', async () => {
    const priced = await api('POST', '/api/admin/molding/resin-library', {
      body: absBody({ usdPerKg: 3 }),
    });
    assert.equal(priced.status, 400);
    assert.match(priced.body.error, /Unknown field: usdPerKg/);
    assert.equal(library.rows.length, 0);
    assert.equal(prices.rows.length, 0);

    const created = await api('POST', '/api/admin/molding/resin-library', { body: absBody() });
    assert.equal(created.status, 201);
    assert.equal(created.body.grade, 'ABS-custom');
    assert.equal(created.body.usdPerKg, undefined);
    assert.equal(prices.rows.length, 0);
    assert.equal(materials.rows.length, 0);

    const partner = await partners.insert({
      displayName: 'Secret Vendor',
      anonLabel: 'Partner A',
      region: 'Midwest',
    });
    const price = await api('POST', '/api/admin/molding/resins', {
      body: {
        partnerId: String(partner._id),
        grade: 'ABS',
        usdPerKg: 2.4,
        densityGCm3: 1.04,
      },
    });
    assert.equal(price.status, 201);
    assert.equal(price.body.usdPerKg, 2.4);
    assert.equal(prices.rows.length, 1);
    assert.equal(library.rows.some((row) => row.usdPerKg != null), false);
    assert.equal(partnerId.length > 0, true);
  });

  test('an inverted band and a duplicate grade are rejected', async () => {
    const inverted = await api('POST', '/api/admin/molding/resin-library', {
      body: absBody({ wallMinMm: 4, wallMaxMm: 1 }),
    });
    assert.equal(inverted.status, 400);
    assert.equal(library.rows.length, 0);

    const created = await api('POST', '/api/admin/molding/resin-library', { body: absBody() });
    assert.equal(created.status, 201);
    const duplicate = await api('POST', '/api/admin/molding/resin-library', { body: absBody() });
    assert.equal(duplicate.status, 400);
    assert.equal(library.rows.length, 1);

    const patched = await api('PATCH', `/api/admin/molding/resin-library/${created.body._id}`, {
      body: { tensileModulusMpa: 1900 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.tensileModulusMpa, 1900);

    const off = await api('POST', `/api/admin/molding/resin-library/${created.body._id}/deactivate`);
    assert.equal(off.status, 200);
    assert.equal(off.body.active, false);
    assert.equal(prices.rows.length, 0);
  });

  test('a partner id on the library is an unknown field', async () => {
    const res = await api('POST', '/api/admin/molding/resin-library', {
      body: absBody({ partnerId }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unknown field: partnerId/);
  });
});
