/**
 * Public generic resin read. No prices, no writes, no auth.
 * Run: cd backend && node --test test/molding-resin-public.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import MoldingResin from '../db/models/MoldingResin.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import { MOLDING_RESIN_SEED } from '../db/models/moldingResinSeed.js';
import { createMoldingResinPublicRouter } from '../routes/moldingResinPublic.js';
import { installFakeModel } from './helpers/fakeDb.js';

let server;
let base;
let library;
let prices;

async function listen() {
  const app = express();
  app.use(express.json());
  app.use('/api/molding', createMoldingResinPublicRouter({ Model: MoldingResin }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function api(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  library = installFakeModel(MoldingResin, { unique: ['grade'] });
  prices = installFakeModel(MoldingResinPrice);
  await listen();
});

beforeEach(() => {
  library.rows.length = 0;
  prices.rows.length = 0;
});

after(() => {
  library.restore();
  prices.restore();
  server?.close();
});

describe('public molding resin library', () => {
  test('an empty collection returns the seed and does not write', async () => {
    const res = await api('/api/molding/resin-library');
    assert.equal(res.status, 200);
    assert.equal(res.body.heuristic, true);
    assert.equal(res.body.source, 'seed');
    assert.deepEqual(
      res.body.resins.map((row) => row.grade).sort(),
      MOLDING_RESIN_SEED.map((row) => row.grade).sort(),
    );
    const abs = res.body.resins.find((row) => row.grade === 'ABS');
    assert.equal(abs.tensileModulusMpa, 2300);
    assert.equal(abs.usdPerKg, undefined);
    assert.equal(abs.partnerId, undefined);
    assert.equal(library.rows.length, 0);
    assert.equal(prices.rows.length, 0);
  });

  test('stored rows win and an inactive grade stays out', async () => {
    await library.insert({
      grade: 'ABS-GF30',
      tensileModulusMpa: 7000,
      shrinkLowPct: 0.2,
      shrinkHighPct: 0.4,
      wallMinMm: 1.5,
      wallMaxMm: 3,
      meltTempLowC: 220,
      meltTempHighC: 260,
      moldTempLowC: 50,
      moldTempHighC: 80,
      active: true,
    });
    await library.insert({
      grade: 'ABS',
      tensileModulusMpa: 2300,
      shrinkLowPct: 0.4,
      shrinkHighPct: 0.7,
      wallMinMm: 1.2,
      wallMaxMm: 3.5,
      meltTempLowC: 220,
      meltTempHighC: 260,
      moldTempLowC: 40,
      moldTempHighC: 80,
      active: false,
    });
    const res = await api('/api/molding/resin-library');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'library');
    assert.deepEqual(res.body.resins.map((row) => row.grade), ['ABS-GF30']);
    assert.equal(res.body.resins[0].usdPerKg, undefined);
    assert.equal(library.rows.length, 2);
    assert.equal(prices.rows.length, 0);
  });

  test('a query string is rejected', async () => {
    const res = await api('/api/molding/resin-library?partnerId=1');
    assert.equal(res.status, 400);
    assert.equal(library.rows.length, 0);
  });
});
