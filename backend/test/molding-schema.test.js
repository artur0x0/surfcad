/**
 * Molding catalog schemas. validate() does not need a live Mongo.
 * Run: cd backend && node --test test/molding-schema.test.js
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import mongoose from 'mongoose';
import PartnerLead from '../db/models/PartnerLead.js';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingMachine from '../db/models/MoldingMachine.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingToolingRate from '../db/models/MoldingToolingRate.js';
import MoldingLead from '../db/models/MoldingLead.js';

const partnerId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();

function collectionName(model) {
  return model.collection.collectionName;
}

function hasIndex(model, fields, { unique = false } = {}) {
  return model.schema.indexes().some(([spec, options]) => {
    if (unique && !options?.unique) return false;
    return JSON.stringify(spec) === JSON.stringify(fields);
  });
}

async function fails(doc) {
  await assert.rejects(() => doc.validate(), (err) => {
    assert.equal(err.name, 'ValidationError');
    return true;
  });
}

function machine(overrides = {}) {
  return new MoldingMachine({
    partnerId,
    name: 'Press 1',
    tonnage: 150,
    platenWidthMm: 500,
    platenHeightMm: 500,
    tieBarSpacingXMm: 460,
    tieBarSpacingYMm: 460,
    barrelShotCm3: 200,
    utilizationPct: 70,
    hourlyRateUsd: 85,
    ...overrides,
  });
}

function resin(overrides = {}) {
  return new MoldingResinPrice({
    partnerId,
    grade: 'ABS',
    usdPerKg: 2.4,
    densityGCm3: 1.04,
    ...overrides,
  });
}

function rate(overrides = {}) {
  return new MoldingToolingRate({
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
  });
}

function lead(overrides = {}) {
  return new MoldingLead({
    userId,
    partnerId,
    type: 'firm_quote',
    status: 'sent',
    commissionOwedUsd: 0,
    ...overrides,
  });
}

describe('molding catalog collections', () => {
  test('interest-form partners collection is untouched', () => {
    assert.equal(collectionName(PartnerLead), 'partners');
    assert.equal(PartnerLead.modelName, 'PartnerLead');
  });

  test('molding models use their own collections', () => {
    assert.deepEqual(
      [
        collectionName(MoldingPartner),
        collectionName(MoldingMachine),
        collectionName(MoldingResinPrice),
        collectionName(MoldingToolingRate),
        collectionName(MoldingLead),
      ],
      [
        'molding_partners',
        'molding_machines',
        'molding_resin_prices',
        'molding_tooling_rates',
        'molding_leads',
      ],
    );
    const models = [MoldingPartner, MoldingMachine, MoldingResinPrice, MoldingToolingRate, MoldingLead];
    for (const model of models) {
      assert.notEqual(collectionName(model), 'partners');
      assert.notEqual(model.modelName, 'Partner');
    }
  });

  test('partner lookup and lead status indexes are declared', () => {
    assert.equal(hasIndex(MoldingPartner, { anonLabel: 1 }, { unique: true }), true);
    assert.equal(hasIndex(MoldingPartner, { active: 1, anonLabel: 1 }), true);
    assert.equal(hasIndex(MoldingPartner, { displayName: 1 }), true);
    assert.equal(hasIndex(MoldingMachine, { partnerId: 1, name: 1 }, { unique: true }), true);
    assert.equal(hasIndex(MoldingMachine, { partnerId: 1, active: 1 }), true);
    assert.equal(hasIndex(MoldingResinPrice, { partnerId: 1, grade: 1 }, { unique: true }), true);
    assert.equal(hasIndex(MoldingToolingRate, { partnerId: 1 }, { unique: true }), true);
    assert.equal(hasIndex(MoldingLead, { status: 1, createdAt: -1 }), true);
    assert.equal(hasIndex(MoldingLead, { partnerId: 1, status: 1 }), true);
    assert.equal(hasIndex(MoldingLead, { userId: 1, createdAt: -1 }), true);
  });
});

describe('molding catalog validation', () => {
  test('a complete partner, machine, resin, rate, and lead pass', async () => {
    const partner = new MoldingPartner({
      displayName: 'Acme Molding',
      anonLabel: 'Partner A',
      region: 'Midwest',
    });
    await partner.validate();
    assert.equal(partner.active, true);
    assert.equal(partner.notes, '');
    await machine().validate();
    await resin().validate();
    const card = rate();
    await card.validate();
    assert.equal(card.hotRunnerSuggestionUsd, 0);
    assert.equal(card.active, true);
    const row = lead();
    await row.validate();
    assert.equal(row.reviewFeePaid, false);
    assert.equal(row.stripePaymentIntentId, '');
    assert.equal(row.budgetaryQuoteSnapshot, null);
  });

  test('region is free text', async () => {
    const partner = new MoldingPartner({
      displayName: 'Acme Molding',
      anonLabel: 'Partner B',
      region: 'not-a-region',
    });
    await partner.validate();
    assert.equal(partner.region, 'not-a-region');
  });

  test('tonnage and shot size must be greater than 0', async () => {
    await fails(machine({ tonnage: 0 }));
    await fails(machine({ tonnage: -10 }));
    await fails(machine({ barrelShotCm3: 0 }));
    await fails(machine({ barrelShotCm3: -1 }));
    await fails(machine({ platenWidthMm: 0 }));
  });

  test('utilization stays inside 0 to 100', async () => {
    await fails(machine({ utilizationPct: -1 }));
    await fails(machine({ utilizationPct: 101 }));
    await machine({ utilizationPct: 0 }).validate();
    await machine({ utilizationPct: 100 }).validate();
  });

  test('negative prices fail and a zero adder is allowed', async () => {
    await fails(resin({ usdPerKg: -0.01 }));
    await fails(resin({ densityGCm3: 0 }));
    await fails(rate({ slideAdderUsd: -1 }));
    await fails(machine({ hourlyRateUsd: -1 }));
    await resin({ usdPerKg: 0 }).validate();
    await rate({ sleeveUsd: 0 }).validate();
    await fails(lead({ commissionOwedUsd: -5 }));
  });

  test('lead type and status are the closed enums', async () => {
    await fails(lead({ status: 'pending' }));
    await fails(lead({ type: 'email' }));
    await lead({
      type: 'human_review',
      status: 'quoted',
      budgetaryQuoteSnapshot: { range: [1, 2], qty: 1000 },
      stripePaymentIntentId: 'pi_test_placeholder',
    }).validate();
  });

  test('a blank partner name does not pass', async () => {
    await fails(new MoldingPartner({
      displayName: '   ',
      anonLabel: 'Partner C',
      region: 'Midwest',
    }));
  });
});
