/**
 * Server-side molding quote. Catalog prices, anonymous labels.
 * Run: cd backend && node --test test/molding-quote.test.js
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingMachine from '../db/models/MoldingMachine.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingToolingRate from '../db/models/MoldingToolingRate.js';
import { quoteMolding } from '../services/moldingQuote.js';
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

let partners;
let machines;
let resins;
let rates;

before(() => {
  partners = installFakeModel(MoldingPartner, { unique: ['anonLabel'] });
  machines = installFakeModel(MoldingMachine, { unique: ['partnerId', 'name'] });
  resins = installFakeModel(MoldingResinPrice, { unique: ['partnerId', 'grade'] });
  rates = installFakeModel(MoldingToolingRate, { unique: ['partnerId'] });
});

after(() => {
  partners.restore();
  machines.restore();
  resins.restore();
  rates.restore();
});

test('quoteMolding ranks a catalog row without its real name', async () => {
  const partner = await partners.insert({
    displayName: 'Secret Vendor',
    anonLabel: 'Partner A',
    region: 'south',
    active: true,
    notes: '',
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
    grade: 'ABS',
    usdPerKg: 2,
    densityGCm3: 1.04,
    active: true,
  });
  await rates.insert({ partnerId: partner._id, ...RATES });

  const quote = await quoteMolding({
    MoldingPartner,
    MoldingMachine,
    MoldingResinPrice,
    MoldingToolingRate,
  }, {
    quantity: 1000,
    part: {
      footprint: { lengthMm: 20, widthMm: 10, heightMm: 5 },
      volumeCm3: 30,
      maxWallMm: 2,
    },
  });

  assert.equal(quote.vendors.length, 1);
  assert.equal(quote.vendors[0].anonLabel, 'Partner A');
  assert.equal(quote.vendors[0].grade, 'ABS');
  assert.equal(quote.vendors[0].steelUsd, 0.55);
  assert.equal(quote.vendors[0].aluminumUsd, 1.37);
  assert.doesNotMatch(JSON.stringify(quote), /Secret Vendor|Press 1|displayName/);
});
