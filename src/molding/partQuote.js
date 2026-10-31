/**
 * Budgetary part cost, machine fit, and anonymous vendor ranking (M4.3).
 * Pure numbers. Prices come from the caller’s catalog rows, never from a
 * client total. This does not write a print Quote.
 */

import { TOOLING_CONSTANTS, steelCheaperAt, toolingEstimate } from './toolingEstimate.js';

export const PART_QUOTE_CONSTANTS = Object.freeze({
  /** Clamp estimate. Tunable. 50 MPa is about 3.6 ton per square inch. */
  cavityPressureMpa: 50,
  /** Standard gravity: 1 ton-force in newtons. */
  newtonPerTon: 9806.65,
  shotLow: 0.2,
  shotHigh: 0.8,
  /** Extra shot volume for the runner. Not a flow simulation. */
  runnerFraction: 0.15,
  maxQuantity: 1_000_000,
});

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function bad(message) {
  return { error: { code: 'bad_args', message } };
}

function idOf(row) {
  if (row == null) return '';
  return String(row.id ?? row._id ?? '');
}

function sameId(a, b) {
  return idOf(a) !== '' && idOf(a) === idOf(b);
}

function active(row) {
  return row?.active !== false;
}

export function requiredTonnage(projectedAreaMm2, constants = PART_QUOTE_CONSTANTS) {
  const area = finite(projectedAreaMm2);
  if (area == null || area <= 0) return null;
  return (area * constants.cavityPressureMpa) / constants.newtonPerTon;
}

export function shotVolumeCm3(volumeCm3, cavityCount, constants = PART_QUOTE_CONSTANTS) {
  const volume = finite(volumeCm3);
  if (volume == null || volume <= 0) return null;
  return volume * cavityCount * (1 + constants.runnerFraction);
}

function orientationFits(lengthMm, widthMm, limitX, limitY) {
  return lengthMm <= limitX && widthMm <= limitY;
}

/** The plate must sit on the platen and pass the tie bars in the same rotation. */
export function moldFitsPress(plate, machine) {
  const options = [
    [plate.lengthMm, plate.widthMm],
    [plate.widthMm, plate.lengthMm],
  ];
  return options.some(([lengthMm, widthMm]) => (
    orientationFits(lengthMm, widthMm, machine.platenWidthMm, machine.platenHeightMm)
    && orientationFits(lengthMm, widthMm, machine.tieBarSpacingXMm, machine.tieBarSpacingYMm)
  ));
}

function cycleSeconds(maxWallMm, metal) {
  const wall = maxWallMm;
  const k = metal === 'steel' ? TOOLING_CONSTANTS.kCoolSteel : TOOLING_CONSTANTS.kCoolAluminum;
  const mech = metal === 'steel' ? TOOLING_CONSTANTS.mechSteelS : TOOLING_CONSTANTS.mechAluminumS;
  return TOOLING_CONSTANTS.fillS + k * wall * wall + mech;
}

function resinMassKg(volumeCm3, densityGCm3) {
  return (volumeCm3 * densityGCm3) / 1000;
}

/**
 * One press, one resin, both metals. Null when the press cannot run the mold.
 * A press at 100% utilization cannot. Shot outside 20–80% of the barrel cannot.
 */
export function quoteMachine({
  machine,
  resin,
  rates,
  part,
  quantity,
  cavityCount = 1,
  includeHotRunner = false,
  constants = PART_QUOTE_CONSTANTS,
}) {
  if (!active(machine) || !active(resin) || !active(rates)) return null;
  const utilization = finite(machine.utilizationPct);
  if (utilization == null || utilization < 0 || utilization >= 100) return null;
  const hourly = finite(machine.hourlyRateUsd);
  if (hourly == null || hourly < 0) return null;

  const estimate = toolingEstimate({
    rates,
    footprint: part.footprint,
    partingLengthMm: part.partingLengthMm ?? 0,
    slideCount: part.slideCount ?? 0,
    lifterCount: part.lifterCount ?? 0,
    pinCount: part.pinCount ?? 0,
    sleeveCount: part.sleeveCount ?? 0,
    maxWallMm: part.maxWallMm,
    flowLengthMm: part.flowLengthMm,
    cavityCount,
    includeHotRunner,
  });
  if (estimate.error) return null;

  const projected = part.footprint.lengthMm * part.footprint.widthMm * cavityCount;
  const tons = requiredTonnage(projected, constants);
  if (tons == null || tons > machine.tonnage) return null;

  const shot = shotVolumeCm3(part.volumeCm3, cavityCount, constants);
  const barrel = finite(machine.barrelShotCm3);
  if (shot == null || barrel == null) return null;
  if (shot < constants.shotLow * barrel || shot > constants.shotHigh * barrel) return null;
  if (!moldFitsPress(estimate.plate, machine)) return null;

  const rate = hourly / (1 - utilization / 100);
  const resinKg = resinMassKg(part.volumeCm3, resin.densityGCm3);
  const resinUsd = roundMoney(resinKg * resin.usdPerKg);
  const side = (metal, toolUsd) => {
    const seconds = cycleSeconds(part.maxWallMm, metal);
    const machineUsd = roundMoney((seconds / 3600) * rate);
    const partUsd = roundMoney(resinUsd + machineUsd);
    const unitUsd = roundMoney(partUsd + toolUsd / quantity);
    return { partUsd, machineUsd, resinUsd, toolUsd, unitUsd, seconds: Math.round(seconds * 1000) / 1000 };
  };
  const aluminum = side('aluminum', estimate.aluminum.totalUsd);
  const steel = side('steel', estimate.steel.totalUsd);
  return {
    aluminum,
    steel,
    steelCheaperAt: steelCheaperAt(
      estimate.aluminum.totalUsd,
      estimate.steel.totalUsd,
      aluminum.partUsd,
      steel.partUsd,
    ),
    range: {
      lowUsd: Math.min(aluminum.unitUsd, steel.unitUsd),
      highUsd: Math.max(aluminum.unitUsd, steel.unitUsd),
    },
    utilizationUpdatedAt: machine.utilizationUpdatedAt ?? null,
  };
}

function pickResin(rows, grade) {
  const activeRows = rows.filter(active);
  if (grade) return activeRows.find((row) => row.grade === grade) || null;
  return activeRows.slice().sort((a, b) => (
    a.usdPerKg - b.usdPerKg || String(a.grade).localeCompare(String(b.grade))
  ))[0] || null;
}

function asOf(stamps) {
  const times = stamps
    .map((stamp) => (stamp ? new Date(stamp).getTime() : NaN))
    .filter((time) => Number.isFinite(time));
  if (!times.length) return null;
  return new Date(Math.min(...times)).toISOString();
}

/**
 * Rank active partners that can mold the part. Fit first (a partner with no
 * fitting press is omitted), then the lowest unit cost, then the public label.
 * Real names are not copied onto the result.
 */
export function rankMoldingQuotes(input = {}) {
  const constants = { ...PART_QUOTE_CONSTANTS, ...(input.constants || {}) };
  const quantity = input.quantity == null ? 1 : finite(input.quantity);
  if (quantity == null || !Number.isInteger(quantity) || quantity < 1 || quantity > constants.maxQuantity) {
    return bad(`quantity must be an integer from 1 to ${constants.maxQuantity}`);
  }
  const cavityCount = input.cavityCount == null ? 1 : finite(input.cavityCount);
  if (cavityCount == null || !Number.isInteger(cavityCount) || cavityCount < 1) {
    return bad('cavityCount must be an integer from 1');
  }
  const part = input.part || {};
  const footprint = part.footprint || {};
  if (!(finite(footprint.lengthMm) > 0) || !(finite(footprint.widthMm) > 0) || !(finite(footprint.heightMm) > 0)) {
    return bad('footprint length, width, and height must be greater than 0');
  }
  if (!(finite(part.volumeCm3) > 0)) return bad('volumeCm3 must be greater than 0');
  if (!(finite(part.maxWallMm) > 0)) return bad('maxWallMm must be greater than 0');

  const partners = (input.partners || []).filter(active);
  const machines = input.machines || [];
  const resins = input.resins || [];
  const rates = input.rates || [];
  const vendors = [];

  for (const partner of partners) {
    const partnerId = idOf(partner);
    const resin = pickResin(resins.filter((row) => sameId({ id: row.partnerId }, { id: partnerId })), input.grade);
    const card = rates.find((row) => sameId({ id: row.partnerId }, { id: partnerId }) && active(row));
    if (!resin || !card || !partner.anonLabel) continue;
    const presses = machines.filter((row) => sameId({ id: row.partnerId }, { id: partnerId }));
    const quotes = [];
    for (const machine of presses) {
      const quote = quoteMachine({
        machine,
        resin,
        rates: card,
        part,
        quantity,
        cavityCount,
        includeHotRunner: input.includeHotRunner === true,
        constants,
      });
      if (quote) quotes.push(quote);
    }
    if (!quotes.length) continue;
    quotes.sort((a, b) => a.range.lowUsd - b.range.lowUsd);
    const low = Math.min(...quotes.map((quote) => quote.range.lowUsd));
    const high = Math.max(...quotes.map((quote) => quote.range.highUsd));
    const bestAluminum = Math.min(...quotes.map((quote) => quote.aluminum.unitUsd));
    const bestSteel = Math.min(...quotes.map((quote) => quote.steel.unitUsd));
    vendors.push({
      anonLabel: partner.anonLabel,
      region: partner.region || '',
      grade: resin.grade,
      machineCount: quotes.length,
      range: { lowUsd: low, highUsd: high },
      aluminumUsd: bestAluminum,
      steelUsd: bestSteel,
      steelCheaperAt: quotes[0].steelCheaperAt,
      utilizationAsOf: asOf(quotes.map((quote) => quote.utilizationUpdatedAt)),
    });
  }

  vendors.sort((a, b) => a.range.lowUsd - b.range.lowUsd || a.anonLabel.localeCompare(b.anonLabel));
  return {
    framing: 'Budgetary quote',
    binding: false,
    disclaimer: 'Budgetary, not binding.',
    quantity,
    cavityCount,
    vendors,
  };
}
