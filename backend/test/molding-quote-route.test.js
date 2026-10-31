/**
 * POST /api/molding/quote. No auth, no persistence, anonymous labels.
 * Run: cd backend && node --test test/molding-quote-route.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingMachine from '../db/models/MoldingMachine.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingToolingRate from '../db/models/MoldingToolingRate.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import { createMoldingQuoteRouter } from '../routes/moldingQuote.js';
import { installFakeModel } from './helpers/fakeDb.js';

const RATES = {
  aluminumUsdPerKg: 0,
  steelUsdPerKg: 0,
  aluminumMachiningUsdPerHour: 0,
  steelMachiningUsdPerHour: 0,
  baseHoursSimple: 0,
  coolingLineHoursFactor: 0,
  slideAdderUsd: 0,
  lifterAdderUsd: 0,
  ejectorPinUsd: 0,
  sleeveUsd: 0,
  hotRunnerSuggestionUsd: 0,
  active: true,
};

const PART = {
  footprint: { lengthMm: 20, widthMm: 10, heightMm: 5 },
  volumeCm3: 30,
  maxWallMm: 2,
  partingLengthMm: 0,
  slideCount: 0,
  lifterCount: 0,
  pinCount: 0,
  sleeveCount: 0,
  flowLengthMm: null,
};

let partners;
let machines;
let resins;
let rates;
let server;
let base;

async function listen(limiter) {
  const app = express();
  app.use(express.json());
  app.use('/api/molding', createMoldingQuoteRouter({ limiter }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function api(body) {
  const res = await fetch(`${base}/api/molding/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  machines = installFakeModel(MoldingMachine, { unique: ['partnerId', 'name'] });
  resins = installFakeModel(MoldingResinPrice, { unique: ['grade'] });
  rates = installFakeModel(MoldingToolingRate, { unique: ['partnerId'] });
  await listen(createRateLimiter({ limit: 20, windowMs: 60_000 }));
});

beforeEach(() => {
  partners.rows.length = 0;
  machines.rows.length = 0;
  resins.rows.length = 0;
  rates.rows.length = 0;
});

after(async () => {
  partners.restore();
  machines.restore();
  resins.restore();
  rates.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('a signed-out caller gets an anonymous budgetary quote and nothing is stored', async () => {
  const partner = await partners.insert({
    displayName: 'Secret Vendor',
    anonLabel: 'Partner A',
    region: 'Midwest',
    active: true,
    notes: 'internal',
  });
  await machines.insert({
    partnerId: partner._id,
    name: 'Press 1',
    tonnage: 50,
    platenWidthMm: 200,
    platenHeightMm: 200,
    tieBarSpacingXMm: 150,
    tieBarSpacingYMm: 150,
    barrelShotCm3: 100,
    utilizationPct: 50,
    hourlyRateUsd: 40,
    active: true,
  });
  await resins.insert({
    partnerId: partner._id,
    grade: 'PP',
    usdPerKg: 1,
    densityGCm3: 0.9,
    active: true,
  });
  await resins.insert({
    partnerId: partner._id,
    grade: 'ABS',
    usdPerKg: 2,
    densityGCm3: 1.04,
    active: true,
  });
  await rates.insert({ partnerId: partner._id, ...RATES });
  const before = partners.rows.length;

  const res = await api({ part: PART, quantity: 1000, cavityCount: 1, grade: 'ABS' });
  assert.equal(res.status, 200);
  assert.equal(res.body.disclaimer, 'Budgetary, not binding.');
  assert.equal(res.body.binding, false);
  assert.equal(res.body.vendors[0].anonLabel, 'Partner A');
  assert.equal(res.body.vendors[0].region, 'Midwest');
  assert.equal(res.body.vendors[0].grade, 'ABS');
  assert.deepEqual(res.body.vendors[0].grades.map((row) => row.grade), ['PP', 'ABS']);
  assert.equal(res.body.vendors[0].steelUsd, 0.55);
  assert.doesNotMatch(JSON.stringify(res.body), /Secret Vendor|Press 1|displayName|internal/);
  assert.equal(partners.rows.length, before);
});

test('a bad part and a client price are refused', async () => {
  const missing = await api({
    part: { ...PART, maxWallMm: null },
    quantity: 1,
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'bad_args');
  const priced = await api({ part: PART, quantity: 1, aluminumUsd: 1 });
  assert.equal(priced.status, 400);
  assert.match(priced.body.error.message, /unknown field/);
  const cavities = await api({ part: PART, quantity: 1, cavityCount: 65 });
  assert.equal(cavities.status, 400);
  assert.match(cavities.body.error.message, /cavityCount/);
});

test('the limiter answers 429', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/molding', createMoldingQuoteRouter({
    limiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
  }));
  const httpServer = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const url = `http://127.0.0.1:${httpServer.address().port}/api/molding/quote`;
  const post = () => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ part: PART, quantity: 1 }),
  });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  const blocked = await post();
  assert.equal(blocked.status, 429);
  await new Promise((resolve) => httpServer.close(resolve));
});
