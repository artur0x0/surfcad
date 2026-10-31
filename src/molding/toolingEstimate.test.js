import assert from 'node:assert/strict';
import test from 'node:test';
import {
  footprintFromBox,
  steelCheaperAt,
  toolingCounts,
  toolingEstimate,
} from './toolingEstimate.js';

const RATES = {
  aluminumUsdPerKg: 8,
  steelUsdPerKg: 4,
  aluminumMachiningUsdPerHour: 80,
  steelMachiningUsdPerHour: 100,
  baseHoursSimple: 12,
  coolingLineHoursFactor: 6,
  slideAdderUsd: 500,
  lifterAdderUsd: 800,
  ejectorPinUsd: 15,
  sleeveUsd: 40,
  hotRunnerSuggestionUsd: 2500,
};

function estimate(patch = {}) {
  return toolingEstimate({
    rates: RATES,
    footprint: { lengthMm: 20, widthMm: 10, heightMm: 5 },
    partingLengthMm: 200,
    slideCount: 1,
    pinCount: 2,
    maxWallMm: 2,
    flowLengthMm: 200,
    ...patch,
  });
}

test('one cavity prices the plate, the shutoff, and the adders', () => {
  const quote = estimate();
  assert.equal(quote.error, undefined);
  assert.equal(quote.binding, false);
  assert.match(quote.disclaimer, /not a binding supplier tooling quote/i);
  assert.equal(quote.cavityCount, 1);
  assert.deepEqual(quote.plate, {
    lengthMm: 100,
    widthMm: 90,
    stackMm: 85,
    cols: 1,
    rows: 1,
  });
  assert.equal(quote.aluminum.massKg, 2.0655);
  assert.equal(quote.aluminum.materialUsd, 16.52);
  assert.equal(quote.aluminum.hours, 12.8);
  assert.equal(quote.aluminum.machiningUsd, 1024);
  assert.equal(quote.aluminum.addersUsd, 530);
  assert.equal(quote.aluminum.hotRunnerUsd, 0);
  assert.equal(quote.aluminum.totalUsd, 1570.52);
  assert.equal(quote.steel.massKg, 6.0053);
  assert.equal(quote.steel.materialUsd, 24.02);
  assert.equal(quote.steel.hours, 18.8);
  assert.equal(quote.steel.machiningUsd, 1880);
  assert.equal(quote.steel.totalUsd, 2434.02);
  assert.equal(quote.hotRunner.suggested, true);
  assert.equal(quote.hotRunner.included, false);
  assert.equal(quote.hotRunner.usd, 2500);
  assert.equal(quote.partCostUsd.source, 'stand-in');
  assert.equal(quote.partCostUsd.aluminum, 0.66);
  assert.equal(quote.partCostUsd.steel, 0.24);
  assert.equal(quote.steelCheaperAt, 2056);
});

test('a hot runner is optional and a short flow is not suggested', () => {
  const withRunner = estimate({ includeHotRunner: true });
  assert.equal(withRunner.aluminum.hotRunnerUsd, 2500);
  assert.equal(withRunner.aluminum.totalUsd, 4070.52);
  assert.equal(withRunner.steel.totalUsd, 4934.02);
  assert.equal(withRunner.hotRunner.included, true);
  const short = estimate({ flowLengthMm: 40, maxWallMm: 2 });
  assert.equal(short.hotRunner.suggested, false);
  assert.equal(short.aluminum.totalUsd, 1570.52);
});

test('four cavities grow the plate and repeat the adders', () => {
  const quote = estimate({ cavityCount: 4, slideCount: 0, pinCount: 0, partingLengthMm: 0, flowLengthMm: null });
  assert.deepEqual(
    { lengthMm: quote.plate.lengthMm, widthMm: quote.plate.widthMm, cols: quote.plate.cols, rows: quote.plate.rows },
    { lengthMm: 140, widthMm: 120, cols: 2, rows: 2 },
  );
  assert.equal(quote.addersUsd, 0);
  assert.equal(quote.aluminum.hours, 48);
  assert.equal(quote.steel.hours, 72);
});

test('a caller part cost replaces the stand-in crossover', () => {
  const never = estimate({
    partCostUsd: { aluminum: 1, steel: 2 },
  });
  assert.equal(never.partCostUsd.source, 'input');
  assert.equal(never.steelCheaperAt, null);
  const already = estimate({
    rates: { ...RATES, steelUsdPerKg: 0, steelMachiningUsdPerHour: 0, coolingLineHoursFactor: 0 },
    slideCount: 0,
    pinCount: 0,
    partingLengthMm: 0,
    partCostUsd: { aluminum: 1, steel: 1 },
  });
  assert.equal(already.steel.totalUsd < already.aluminum.totalUsd, true);
  assert.equal(already.steelCheaperAt, 1);
});

test('an inactive card and a bad footprint are refused', () => {
  const inactive = estimate({ rates: { ...RATES, active: false } });
  assert.equal(inactive.error.code, 'inactive_rate');
  const flat = estimate({ footprint: { lengthMm: 20, widthMm: 0, heightMm: 5 } });
  assert.equal(flat.error.code, 'bad_args');
  const cavities = estimate({ cavityCount: 65 });
  assert.equal(cavities.error.code, 'bad_args');
  assert.match(cavities.error.message, /cavityCount/);
});

test('footprint follows the pull axis and counts come off the analysis', () => {
  const box = { min: [0, 0, 0], max: [20, 10, 5] };
  assert.deepEqual(footprintFromBox(box, [0, 0, 1]), {
    lengthMm: 20,
    widthMm: 10,
    heightMm: 5,
  });
  assert.deepEqual(footprintFromBox(box, [1, 0, 0]), {
    lengthMm: 10,
    widthMm: 5,
    heightMm: 20,
  });
  const counts = toolingCounts({
    kind: 'mold-analysis',
    parting: { lines: [{ length: 40 }, { length: 10 }, { name: 'loose' }] },
    sideActions: { slideCount: 2, lifterCount: 1 },
    moldDraft: { ejectors: { pinCount: 4, sleeveCount: 1 } },
    wall: { max: 3.5 },
  });
  assert.equal(counts.partingLengthMm, 50);
  assert.equal(counts.slideCount, 2);
  assert.equal(counts.lifterCount, 1);
  assert.equal(counts.pinCount, 4);
  assert.equal(counts.sleeveCount, 1);
  assert.equal(counts.maxWallMm, 3.5);
  assert.equal(toolingCounts({ kind: 'wall' }), null);
});

test('steelCheaperAt is the first quantity that holds', () => {
  assert.equal(steelCheaperAt(100, 100, 2, 1), 1);
  assert.equal(steelCheaperAt(100, 250, 2, 1), 150);
  assert.equal(steelCheaperAt(100, 250, 1, 2), null);
});
