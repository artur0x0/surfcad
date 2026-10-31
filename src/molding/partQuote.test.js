import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteMachine, rankMoldingQuotes, requiredTonnage, shotVolumeCm3 } from './partQuote.js';

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
};

const PART = {
  footprint: { lengthMm: 20, widthMm: 10, heightMm: 5 },
  volumeCm3: 30,
  maxWallMm: 2,
};

function press(patch = {}) {
  return {
    tonnage: 50,
    platenWidthMm: 200,
    platenHeightMm: 200,
    tieBarSpacingXMm: 150,
    tieBarSpacingYMm: 150,
    barrelShotCm3: 100,
    utilizationPct: 50,
    hourlyRateUsd: 40,
    active: true,
    ...patch,
  };
}

test('clamp force and shot use the exported factors', () => {
  const tons = requiredTonnage(200);
  assert.ok(Math.abs(tons - (200 * 50) / 9806.65) < 1e-9);
  assert.equal(shotVolumeCm3(30, 1), 34.5);
});

test('a fitting press prices resin and the cooled cycle', () => {
  const quote = quoteMachine({
    machine: press(),
    resin: { grade: 'ABS', usdPerKg: 2, densityGCm3: 1.04, active: true },
    rates: RATES,
    part: PART,
    quantity: 1000,
  });
  assert.equal(quote.aluminum.resinUsd, 0.06);
  assert.equal(quote.aluminum.machineUsd, 1.31);
  assert.equal(quote.aluminum.partUsd, 1.37);
  assert.equal(quote.aluminum.unitUsd, 1.37);
  assert.equal(quote.steel.machineUsd, 0.49);
  assert.equal(quote.steel.partUsd, 0.55);
  assert.equal(quote.steel.unitUsd, 0.55);
  assert.equal(quote.range.lowUsd, 0.55);
  assert.equal(quote.range.highUsd, 1.37);
  assert.equal(quote.steelCheaperAt, 1);
});

test('tonnage, shot window, platen, tie bars, and full utilization reject the press', () => {
  const base = {
    machine: press(),
    resin: { usdPerKg: 2, densityGCm3: 1.04, active: true },
    rates: RATES,
    part: PART,
    quantity: 1,
  };
  assert.equal(quoteMachine({ ...base, machine: press({ tonnage: 1 }) }), null);
  assert.equal(quoteMachine({ ...base, machine: press({ barrelShotCm3: 40 }) }), null);
  assert.equal(quoteMachine({ ...base, machine: press({ barrelShotCm3: 200 }) }), null);
  assert.equal(quoteMachine({ ...base, machine: press({ platenWidthMm: 80 }) }), null);
  assert.equal(quoteMachine({ ...base, machine: press({ tieBarSpacingXMm: 80 }) }), null);
  assert.equal(quoteMachine({ ...base, machine: press({ utilizationPct: 100 }) }), null);
});

test('vendors rank by fit then price, under public labels only', () => {
  const ranked = rankMoldingQuotes({
    quantity: 1000,
    grade: 'ABS',
    part: PART,
    partners: [
      { id: 'secret', anonLabel: 'Partner B', region: 'north', displayName: 'Secret Vendor', active: true },
      { id: 'open', anonLabel: 'Partner A', region: 'south', displayName: 'Also Secret', active: true },
      { id: 'idle', anonLabel: 'Partner C', region: 'west', displayName: 'Closed', active: false },
    ],
    machines: [
      { partnerId: 'secret', ...press({ hourlyRateUsd: 80 }), utilizationUpdatedAt: '2026-10-01T00:00:00.000Z' },
      { partnerId: 'open', ...press({ hourlyRateUsd: 40 }), utilizationUpdatedAt: '2026-09-01T00:00:00.000Z' },
      { partnerId: 'open', ...press({ hourlyRateUsd: 40, tonnage: 1 }) },
      { partnerId: 'idle', ...press() },
    ],
    resins: [
      { partnerId: 'secret', grade: 'ABS', usdPerKg: 2, densityGCm3: 1.04, active: true },
      { partnerId: 'open', grade: 'ABS', usdPerKg: 2, densityGCm3: 1.04, active: true },
      { partnerId: 'open', grade: 'PP', usdPerKg: 1, densityGCm3: 0.9, active: true },
      { partnerId: 'idle', grade: 'ABS', usdPerKg: 1, densityGCm3: 1, active: true },
    ],
    rates: [
      { partnerId: 'secret', ...RATES },
      { partnerId: 'open', ...RATES },
      { partnerId: 'idle', ...RATES },
    ],
  });
  assert.equal(ranked.binding, false);
  assert.match(ranked.disclaimer, /Budgetary, not binding/);
  assert.deepEqual(ranked.vendors.map((row) => row.anonLabel), ['Partner A', 'Partner B']);
  assert.equal(ranked.vendors[0].grade, 'ABS');
  assert.equal(ranked.vendors[0].machineCount, 1);
  assert.equal(ranked.vendors[0].region, 'south');
  assert.ok(ranked.vendors[0].range.lowUsd < ranked.vendors[1].range.lowUsd);
  assert.equal(ranked.vendors[0].utilizationAsOf, '2026-09-01T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(ranked), /Secret|displayName|Closed/);
});

test('with no grade, the cheapest active resin is the default', () => {
  const ranked = rankMoldingQuotes({
    part: PART,
    partners: [{ id: 'p', anonLabel: 'Partner A', region: 'south', active: true }],
    machines: [{ partnerId: 'p', ...press() }],
    resins: [
      { partnerId: 'p', grade: 'ABS', usdPerKg: 3, densityGCm3: 1.04, active: true },
      { partnerId: 'p', grade: 'PP', usdPerKg: 1, densityGCm3: 0.9, active: true },
    ],
    rates: [{ partnerId: 'p', ...RATES }],
  });
  assert.equal(ranked.vendors[0].grade, 'PP');
  const missing = rankMoldingQuotes({
    grade: 'Nylon',
    part: PART,
    partners: [{ id: 'p', anonLabel: 'Partner A', region: 'south', active: true }],
    machines: [{ partnerId: 'p', ...press() }],
    resins: [{ partnerId: 'p', grade: 'ABS', usdPerKg: 2, densityGCm3: 1.04, active: true }],
    rates: [{ partnerId: 'p', ...RATES }],
  });
  assert.deepEqual(missing.vendors, []);
});
