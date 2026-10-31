import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  emptyMachineForm,
  emptyRateForm,
  machinePayload,
  partnerPayload,
  ratePayload,
  resinPayload,
} from './moldingCatalogForm.js';

const partnerId = '64b7f3a2c1d09e8877665544';

function filledMachine(overrides = {}) {
  return {
    ...emptyMachineForm(),
    name: 'Press 1',
    tonnage: '150',
    platenWidthMm: '500',
    platenHeightMm: '480',
    tieBarSpacingXMm: '460',
    tieBarSpacingYMm: '450',
    barrelShotCm3: '200',
    utilizationPct: '70',
    hourlyRateUsd: '85',
    ...overrides,
  };
}

function filledRate(overrides = {}) {
  const form = emptyRateForm();
  for (const key of Object.keys(form)) {
    if (key !== 'active') form[key] = '1';
  }
  return { ...form, ...overrides };
}

describe('molding catalog form payloads', () => {
  test('a partner keeps the real name and trims the public label', () => {
    const parsed = partnerPayload({
      displayName: ' Acme Molding ',
      anonLabel: ' Partner A ',
      region: ' Midwest ',
      notes: ' floor 2 ',
      active: true,
    });
    assert.equal(parsed.error, undefined);
    assert.deepEqual(parsed.value, {
      displayName: 'Acme Molding',
      anonLabel: 'Partner A',
      region: 'Midwest',
      notes: 'floor 2',
      active: true,
    });
  });

  test('a blank real name does not build a payload', () => {
    const parsed = partnerPayload({ displayName: '  ', anonLabel: 'Partner A', region: 'Midwest' });
    assert.match(parsed.error, /Real name/);
    assert.equal(parsed.value, undefined);
  });

  test('tonnage and shot size must be greater than 0', () => {
    assert.match(machinePayload(filledMachine({ tonnage: '0' }), partnerId).error, /Tonnage/);
    assert.match(machinePayload(filledMachine({ tonnage: '-5' }), partnerId).error, /Tonnage/);
    assert.match(machinePayload(filledMachine({ barrelShotCm3: '0' }), partnerId).error, /Shot size/);
    assert.match(machinePayload(filledMachine({ barrelShotCm3: '-1' }), partnerId).error, /Shot size/);
    assert.match(machinePayload(filledMachine({ utilizationPct: '101' }), partnerId).error, /Utilization/);
    assert.match(machinePayload(filledMachine({ hourlyRateUsd: '-1' }), partnerId).error, /Hourly rate/);
    const ok = machinePayload(filledMachine(), partnerId);
    assert.equal(ok.value.tonnage, 150);
    assert.equal(ok.value.barrelShotCm3, 200);
    assert.equal(ok.value.partnerId, partnerId);
    assert.equal(Object.hasOwn(ok.value, 'utilizationUpdatedAt'), false);
  });

  test('resin price and rate adders may be zero and may not be negative', () => {
    const zero = resinPayload({ grade: 'ABS', usdPerKg: '0', densityGCm3: '1.04', active: true }, partnerId);
    assert.equal(zero.value.usdPerKg, 0);
    assert.match(resinPayload({ grade: 'ABS', usdPerKg: '-1', densityGCm3: '1.04' }, partnerId).error, /USD per kg/);
    assert.match(resinPayload({ grade: 'ABS', usdPerKg: '1', densityGCm3: '0' }, partnerId).error, /Density/);
    const rate = ratePayload(filledRate({ slideAdderUsd: '0', hotRunnerSuggestionUsd: '0' }), partnerId);
    assert.equal(rate.value.slideAdderUsd, 0);
    assert.equal(rate.value.hotRunnerSuggestionUsd, 0);
    assert.match(ratePayload(filledRate({ sleeveUsd: '-2' }), partnerId).error, /Sleeve/);
  });
});
