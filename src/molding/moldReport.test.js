import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection } from './pullDirection.js';
import { quoteMachine, rankMoldingQuotes } from './partQuote.js';
import { solidVolumeCm3 } from './solidVolume.js';
import { footprintFromBox, toolingCounts } from './toolingEstimate.js';
import {
  DEFAULT_REPORT_GRADE,
  buildMoldReport,
  defaultReportGrade,
  parseReportQuantity,
  projectedAreaMm2,
} from './moldReport.js';
import { readMoldReportXlsx, moldReportXlsx } from './moldReportXlsx.js';

function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  return { positions, indices };
}

function appendMesh(dstPos, dstIdx, src, flip) {
  const base = dstPos.length / 3;
  for (let i = 0; i < src.positions.length; i += 1) dstPos.push(src.positions[i]);
  for (let t = 0; t < src.indices.length; t += 3) {
    const a = src.indices[t] + base;
    const b = src.indices[t + 1] + base;
    const c = src.indices[t + 2] + base;
    if (flip) dstIdx.push(a, c, b);
    else dstIdx.push(a, b, c);
  }
}

function addShelf(positions, indices, x0, x1, y0, y1, z) {
  const base = positions.length / 3;
  positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function addLoop(positions, loop, z) {
  const base = positions.length / 3;
  for (const [x, y] of loop) positions.push(x, y, z);
  return base;
}

function capLoop(indices, base, n, up) {
  for (let i = 1; i < n - 1; i += 1) {
    if (up) indices.push(base, base + i, base + i + 1);
    else indices.push(base, base + i + 1, base + i);
  }
}

function wallLoop(indices, bottom, top, n, out) {
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    if (out) indices.push(bottom + i, bottom + j, top + j, bottom + i, top + j, top + i);
    else indices.push(bottom + i, top + j, bottom + j, bottom + i, top + i, top + j);
  }
}

function annulus(indices, outer, inner, n, up) {
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    if (up) indices.push(outer + i, outer + j, inner + j, outer + i, inner + j, inner + i);
    else indices.push(outer + i, inner + j, outer + j, outer + i, inner + i, inner + j);
  }
}

function openTray() {
  const wall = 1.85;
  const height = 8;
  const outer = [
    [3, 0], [17, 0], [20, 3], [20, 13], [17, 16], [3, 16], [0, 13], [0, 3],
  ];
  const inner = [
    [3, wall], [17, wall], [20 - wall, 3], [20 - wall, 13],
    [17, 16 - wall], [3, 16 - wall], [wall, 13], [wall, 3],
  ];
  const positions = [];
  const indices = [];
  const n = outer.length;
  const bottom = addLoop(positions, outer, 0);
  const floor = addLoop(positions, inner, wall);
  const rimOut = addLoop(positions, outer, height);
  const rimIn = addLoop(positions, inner, height);
  capLoop(indices, bottom, n, false);
  capLoop(indices, floor, n, true);
  wallLoop(indices, bottom, rimOut, n, true);
  wallLoop(indices, floor, rimIn, n, false);
  annulus(indices, rimOut, rimIn, n, true);
  return { positions, indices };
}

function draftedCup() {
  const positions = [];
  const indices = [];
  const outerBottom = [[1, 1], [13, 1], [13, 13], [1, 13]];
  const outerTop = [[0, 0], [14, 0], [14, 14], [0, 14]];
  const innerBottom = [[2.5, 2.5], [11.5, 2.5], [11.5, 11.5], [2.5, 11.5]];
  const innerTop = [[1.5, 1.5], [12.5, 1.5], [12.5, 12.5], [1.5, 12.5]];
  const n = 4;
  const ob = addLoop(positions, outerBottom, 0);
  const ib = addLoop(positions, innerBottom, 1.5);
  const ot = addLoop(positions, outerTop, 12);
  const it = addLoop(positions, innerTop, 12);
  capLoop(indices, ob, n, false);
  capLoop(indices, ib, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  annulus(indices, ot, it, n, true);
  return { positions, indices };
}

function throughHole() {
  const positions = [];
  const indices = [];
  const outer = [[0, 0], [20, 0], [20, 16], [0, 16]];
  const inner = [[6, 4], [14, 4], [14, 12], [6, 12]];
  const n = 4;
  const ob = addLoop(positions, outer, 0);
  const ib = addLoop(positions, inner, 0);
  const ot = addLoop(positions, outer, 12);
  const it = addLoop(positions, inner, 12);
  annulus(indices, ob, ib, n, false);
  annulus(indices, ot, it, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  return { positions, indices };
}

function snapHook() {
  const positions = [];
  const indices = [];
  appendMesh(positions, indices, boxMesh([0, 0, 0], [2, 10, 12]), false);
  appendMesh(positions, indices, boxMesh([2, 3, 8], [8, 7, 10]), false);
  addShelf(positions, indices, 6, 8, 3, 7, 6);
  return { positions, indices };
}

function reportOf(mesh) {
  const analysis = analyzePullDirection(mesh);
  return buildMoldReport({
    positions: mesh.positions,
    indices: mesh.indices,
    analysis,
    library: [{ grade: 'ABS' }, { grade: 'PC/ABS' }],
  });
}

test('quantity is a positive integer and the default resin is PC/ABS', () => {
  assert.equal(parseReportQuantity(1000).quantity, 1000);
  assert.equal(parseReportQuantity('25').quantity, 25);
  assert.equal(parseReportQuantity('0').error.code, 'bad_args');
  assert.equal(parseReportQuantity('-4').error.code, 'bad_args');
  assert.equal(parseReportQuantity('1.5').error.code, 'bad_args');
  assert.equal(parseReportQuantity('').error.code, 'bad_args');
  assert.equal(defaultReportGrade([{ grade: 'ABS' }, { grade: 'PC/ABS' }]), DEFAULT_REPORT_GRADE);
  assert.equal(defaultReportGrade([{ grade: 'ABS' }]), 'ABS');
  assert.equal(defaultReportGrade([]), DEFAULT_REPORT_GRADE);
});

test('plate, tray, cup, snap hook, and through hole report their own geometry', () => {
  const plate = boxMesh([0, 0, 0], [20, 20, 2]);
  const plateReport = reportOf(plate);
  assert.equal(plateReport.grade, 'PC/ABS');
  assert.equal(plateReport.quantity, 1000);
  assert.equal(plateReport.geometry.volumeCm3, 0.8);
  assert.equal(plateReport.geometry.projectedAreaMm2, 400);
  assert.equal(plateReport.geometry.sideActionCount, 0);
  assert.equal(plateReport.geometry.draft.minDeg, 1);
  assert.equal(plateReport.geometry.draft.positive, 0);
  assert.equal(plateReport.geometry.draft.negative, 0);
  assert.ok(plateReport.geometry.draft.below > 0);
  assert.equal(plateReport.geometry.draft.belowPositive, plateReport.geometry.draft.below);
  assert.equal(plateReport.geometry.draft.belowNegative, 0);
  assert.equal(plateReport.estimates.massKg, null);
  assert.match(plateReport.notes.mass, /density/);
  assert.equal(plateReport.estimates.toolingAluminumUsd, null);
  assert.equal(plateReport.estimates.partUsd, null);
  assert.ok(plateReport.estimates.pressTons > 0);
  assert.equal(plateReport.assumptions.rates, null);
  assert.equal(plateReport.assumptions.cavityPressureMpa, 50);

  const expected = [
    ['tray', openTray(), 0],
    ['cup', draftedCup(), 0],
    ['snap', snapHook(), 1],
    ['hole', throughHole(), 0],
  ];
  for (const [name, mesh, sides] of expected) {
    const report = reportOf(mesh);
    assert.equal(report.error, undefined, name);
    assert.equal(report.geometry.sideActionCount, sides, name);
    assert.equal(report.geometry.volumeCm3, solidVolumeCm3(mesh.positions, mesh.indices), name);
    assert.equal(
      report.geometry.projectedAreaMm2,
      projectedAreaMm2(mesh.positions, mesh.indices, [0, 0, 1]),
      name,
    );
    assert.ok(report.geometry.projectedAreaMm2 > 0, name);
    assert.equal(report.estimates.massKg, null, name);
  }
  const hole = reportOf(throughHole());
  assert.ok(Math.abs(hole.geometry.projectedAreaMm2 - 256) < 1e-6);
});

test('resin and quantity live-update mass, tooling, and price from the existing quote', () => {
  const mesh = boxMesh([0, 0, 0], [20, 20, 2]);
  const analysis = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  const rates = {
    aluminumUsdPerKg: 8,
    steelUsdPerKg: 4,
    aluminumMachiningUsdPerHour: 50,
    steelMachiningUsdPerHour: 70,
    baseHoursSimple: 10,
    coolingLineHoursFactor: 2,
    slideAdderUsd: 100,
    lifterAdderUsd: 80,
    ejectorPinUsd: 1,
    sleeveUsd: 5,
    hotRunnerSuggestionUsd: 0,
  };
  const catalog = {
    partners: [{ id: 'p', anonLabel: 'North', region: 'US', active: true }],
    machines: [{
      id: 'm',
      partnerId: 'p',
      tonnage: 80,
      platenWidthMm: 400,
      platenHeightMm: 400,
      tieBarSpacingXMm: 300,
      tieBarSpacingYMm: 300,
      barrelShotCm3: 4,
      utilizationPct: 50,
      hourlyRateUsd: 40,
      active: true,
    }],
    resins: [
      { id: 'r1', partnerId: 'p', grade: 'PC/ABS', usdPerKg: 3, densityGCm3: 1.1, active: true },
      { id: 'r2', partnerId: 'p', grade: 'PP', usdPerKg: 1, densityGCm3: 0.9, active: true },
    ],
    rates: [{ ...rates, id: 'rate', partnerId: 'p', active: true }],
  };
  const base = {
    positions: mesh.positions,
    indices: mesh.indices,
    analysis,
    catalog,
  };
  const at1000 = buildMoldReport({ ...base, grade: 'PC/ABS', quantity: 1000 });
  const at25 = buildMoldReport({ ...base, grade: 'PC/ABS', quantity: 25 });
  const pp = buildMoldReport({ ...base, grade: 'PP', quantity: 1000 });
  assert.equal(at1000.estimates.massKg, 0.00088);
  assert.equal(pp.estimates.massKg, 0.00072);
  assert.equal(at1000.estimates.pressTons, at25.estimates.pressTons);
  assert.notEqual(at1000.estimates.totalUsd, at25.estimates.totalUsd);
  assert.equal(at1000.estimates.partUsd * 1000, at1000.estimates.totalUsd);
  assert.ok(at1000.estimates.toolingAluminumUsd > 0);
  assert.ok(at1000.estimates.toolingSteelUsd > 0);
  assert.equal(at1000.assumptions.rates.aluminumUsdPerKg, 8);
  assert.equal(at1000.assumptions.fillS, 2);

  const counts = toolingCounts(analysis);
  const footprint = footprintFromBox({ min: [0, 0, 0], max: [20, 20, 2] }, [0, 0, 1]);
  const part = {
    footprint,
    volumeCm3: 0.8,
    maxWallMm: counts.maxWallMm,
    partingLengthMm: counts.partingLengthMm,
    slideCount: counts.slideCount,
    lifterCount: counts.lifterCount,
    pinCount: counts.pinCount,
    sleeveCount: counts.sleeveCount,
    flowLengthMm: null,
  };
  const ranked = rankMoldingQuotes({
    quantity: 1000,
    cavityCount: 1,
    grade: 'PC/ABS',
    part,
    partners: catalog.partners,
    machines: catalog.machines,
    resins: catalog.resins,
    rates: catalog.rates,
  });
  assert.equal(ranked.error, undefined);
  assert.equal(at1000.estimates.partUsd, ranked.vendors[0].range.lowUsd);
  const machine = quoteMachine({
    machine: catalog.machines[0],
    resin: catalog.resins[0],
    rates: catalog.rates[0],
    part,
    quantity: 1000,
  });
  assert.ok(machine);
  assert.equal(at1000.estimates.partUsd, Math.min(machine.aluminum.unitUsd, machine.steel.unitUsd));
});

test('the workbook round-trips geometry, resin, quantity, estimates, and assumptions', () => {
  const report = buildMoldReport({
    positions: boxMesh([0, 0, 0], [20, 20, 2]).positions,
    indices: boxMesh([0, 0, 0], [20, 20, 2]).indices,
    analysis: {
      kind: 'mold-analysis',
      pull: [0, 0, 1],
      sideActions: { count: 0, slideCount: 0, lifterCount: 0 },
      wall: { max: 2 },
      parting: { lines: [] },
      moldDraft: { ejectors: { pinCount: 0, sleeveCount: 0 } },
    },
    grade: 'PC/ABS',
    quantity: 100,
  });
  const rows = readMoldReportXlsx(moldReportXlsx(report));
  const value = (field) => rows.find((row) => row[0] === field);
  assert.equal(value('Volume (cm3)')[1], 0.8);
  assert.equal(value('Projected area along pull (mm2)')[1], 400);
  assert.equal(value('Side actions')[1], 0);
  assert.equal(value('Positive ≥ threshold')[1], '');
  assert.equal(value('Negative ≥ threshold')[1], '');
  assert.equal(value('Below threshold')[1], '');
  assert.equal(value('Below threshold')[2], '');
  assert.equal(value('Resin')[1], 'PC/ABS');
  assert.equal(value('Quantity')[1], 100);
  assert.equal(value('Part mass (kg)')[1], '');
  assert.match(String(value('Part mass (kg)')[2]), /density/);
  assert.equal(value('Clamp pressure (MPa)')[1], 50);
  assert.equal(value('Fill (s)')[1], 2);
  assert.match(String(value('Rates')[1]), /No tooling rate card/);
  assert.ok(rows.length > 20);
});
