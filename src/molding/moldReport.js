/**
 * One molding report for the pane, the spreadsheet, and the agent commands.
 *
 * Geometry is measured here. Money uses the existing quote and tooling
 * functions when the caller passes a priced catalog. The public resin
 * library has no density and no price, so those estimates stay empty
 * instead of inventing a number. Press tonnage is `requiredTonnage` on the
 * measured projected area. A ranked vendor quote still sizes the press from
 * the bounding-box footprint.
 */

import { PART_QUOTE_CONSTANTS, rankMoldingQuotes, requiredTonnage } from './partQuote.js';
import { solidVolumeCm3 } from './solidVolume.js';
import { TOOLING_CONSTANTS, footprintFromBox, toolingCounts, toolingEstimate } from './toolingEstimate.js';

export const REPORT_QUANTITIES = Object.freeze([25, 100, 1000, 5000, 10000]);
export const DEFAULT_REPORT_QUANTITY = 1000;
/** Library grade. The request said ABS/PC; the database stores PC/ABS. */
export const DEFAULT_REPORT_GRADE = 'PC/ABS';

const RATE_FIELDS = Object.freeze([
  'aluminumUsdPerKg',
  'steelUsdPerKg',
  'aluminumMachiningUsdPerHour',
  'steelMachiningUsdPerHour',
  'baseHoursSimple',
  'coolingLineHoursFactor',
  'slideAdderUsd',
  'lifterAdderUsd',
  'ejectorPinUsd',
  'sleeveUsd',
  'hotRunnerSuggestionUsd',
]);

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function coordsOf(positions) {
  if (!positions) return null;
  if (ArrayBuffer.isView(positions) || Array.isArray(positions)) return positions;
  if (ArrayBuffer.isView(positions.array) || Array.isArray(positions.array)) return positions.array;
  return null;
}

function indexOf(indices) {
  if (indices == null) return null;
  if (ArrayBuffer.isView(indices) || Array.isArray(indices)) return indices;
  if (ArrayBuffer.isView(indices.array) || Array.isArray(indices.array)) return indices.array;
  return null;
}

function bucketCount(bucket) {
  if (bucket == null) return null;
  if (typeof bucket === 'number') return finite(bucket);
  return finite(bucket.count);
}

/** Signed draft counts for the report row. Null when the analysis has no signed field. */
function draftOf(moldDraft) {
  if (!moldDraft || moldDraft.positiveAbove == null) return null;
  return {
    minDeg: finite(moldDraft.minDeg) ?? 1,
    positiveAbove: bucketCount(moldDraft.positiveAbove) ?? 0,
    positiveBelow: bucketCount(moldDraft.positiveBelow) ?? 0,
    negative: bucketCount(moldDraft.negative) ?? 0,
  };
}

function unit(pull) {
  const src = Array.isArray(pull) && pull.length >= 3 ? pull : [0, 0, 1];
  const x = finite(src[0]) ?? 0;
  const y = finite(src[1]) ?? 0;
  const z = finite(src[2]) ?? 0;
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

/**
 * Silhouette along `pull`, in mm². A closed solid is half the sum of the
 * projected triangle areas, so the front and the back cancel to the outline.
 * An open shell uses that same sum.
 */
export function projectedAreaMm2(positions, indices, pull) {
  const pos = coordsOf(positions);
  if (!pos || pos.length < 9) return null;
  const idx = indexOf(indices);
  if (indices != null && !idx) return null;
  const dir = unit(pull);
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
  if (triCount < 1) return null;
  let sum = 0;
  for (let tri = 0; tri < triCount; tri += 1) {
    const ia = idx ? idx[tri * 3] : tri * 3;
    const ib = idx ? idx[tri * 3 + 1] : tri * 3 + 1;
    const ic = idx ? idx[tri * 3 + 2] : tri * 3 + 2;
    const ax = pos[ia * 3];
    const ay = pos[ia * 3 + 1];
    const az = pos[ia * 3 + 2];
    const bx = pos[ib * 3];
    const by = pos[ib * 3 + 1];
    const bz = pos[ib * 3 + 2];
    const cx = pos[ic * 3];
    const cy = pos[ic * 3 + 1];
    const cz = pos[ic * 3 + 2];
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return null;
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    sum += Math.abs(nx * dir[0] + ny * dir[1] + nz * dir[2]);
  }
  // `|cross|` is twice the triangle area, and a closed solid counts both sides.
  const area = sum * 0.25;
  if (!Number.isFinite(area) || area <= 0) return null;
  return round6(area);
}

export function defaultReportGrade(resins) {
  const grades = [];
  for (const row of resins || []) {
    if (typeof row?.grade === 'string' && row.grade && !grades.includes(row.grade)) grades.push(row.grade);
  }
  if (grades.includes(DEFAULT_REPORT_GRADE)) return DEFAULT_REPORT_GRADE;
  return grades[0] || DEFAULT_REPORT_GRADE;
}

export function parseReportQuantity(value) {
  if (value == null || value === '') {
    return { error: { code: 'bad_args', message: 'quantity must be a positive integer' } };
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^[0-9]+$/.test(text)) {
      return { error: { code: 'bad_args', message: 'quantity must be a positive integer' } };
    }
    return parseReportQuantity(Number(text));
  }
  const max = PART_QUOTE_CONSTANTS.maxQuantity;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    return { error: { code: 'bad_args', message: `quantity must be an integer from 1 to ${max}` } };
  }
  return { quantity: value };
}

function boundsOf(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const n = pos[i + axis];
      if (!Number.isFinite(n)) return null;
      if (n < min[axis]) min[axis] = n;
      if (n > max[axis]) max[axis] = n;
    }
  }
  return { min, max };
}

function active(row) {
  return row?.active !== false;
}

function rateCardOf(catalog) {
  const rates = catalog?.rates;
  if (!rates) return null;
  const list = Array.isArray(rates) ? rates : [rates];
  return list.find((row) => active(row)) || null;
}

function densityOf(catalog, grade) {
  const rows = Array.isArray(catalog?.resins) ? catalog.resins : [];
  const match = rows.find((row) => active(row) && row.grade === grade && finite(row.densityGCm3) > 0);
  return match ? finite(match.densityGCm3) : null;
}

function assumptionsOf(cavityCount, rates) {
  const used = {};
  if (rates) {
    for (const field of RATE_FIELDS) {
      if (rates[field] != null) used[field] = rates[field];
    }
  }
  return {
    cavityPressureMpa: PART_QUOTE_CONSTANTS.cavityPressureMpa,
    newtonPerTon: PART_QUOTE_CONSTANTS.newtonPerTon,
    fillS: TOOLING_CONSTANTS.fillS,
    kCoolAluminum: TOOLING_CONSTANTS.kCoolAluminum,
    kCoolSteel: TOOLING_CONSTANTS.kCoolSteel,
    mechAluminumS: TOOLING_CONSTANTS.mechAluminumS,
    mechSteelS: TOOLING_CONSTANTS.mechSteelS,
    standInPressUsdPerHour: TOOLING_CONSTANTS.standInPressUsdPerHour,
    runnerFraction: PART_QUOTE_CONSTANTS.runnerFraction,
    shotLow: PART_QUOTE_CONSTANTS.shotLow,
    shotHigh: PART_QUOTE_CONSTANTS.shotHigh,
    cavityCount,
    rates: Object.keys(used).length ? used : null,
    ratesNote: Object.keys(used).length ? null : 'No tooling rate card was loaded.',
    tonnageNote: 'Press tonnage is requiredTonnage of the measured projected area. A ranked vendor quote still gates each press on the bounding-box footprint times the cavity count.',
  };
}

function priceFromVendors(vendors, quantity) {
  const best = Array.isArray(vendors) ? vendors[0] : null;
  if (!best) return null;
  let perPart = finite(best.range?.lowUsd);
  const aluminum = finite(best.aluminumUsd);
  const steel = finite(best.steelUsd);
  if (perPart == null) {
    const both = [aluminum, steel].filter((n) => n != null);
    perPart = both.length ? Math.min(...both) : null;
  }
  if (perPart == null) return null;
  let metal = null;
  if (aluminum != null && steel != null) metal = aluminum <= steel ? 'aluminum' : 'steel';
  else if (aluminum != null) metal = 'aluminum';
  else if (steel != null) metal = 'steel';
  return {
    perPartUsd: roundMoney(perPart),
    totalUsd: roundMoney(perPart * quantity),
    metal,
  };
}

/**
 * @param {object} input
 * @param {ArrayLike<number>} input.positions
 * @param {ArrayLike<number> | null} [input.indices]
 * @param {object | null} [input.analysis] mold-analysis result
 * @param {string} [input.grade]
 * @param {number} [input.quantity]
 * @param {number} [input.cavityCount]
 * @param {object | null} [input.catalog] priced partners, machines, resins, rates
 * @param {object | null} [input.ranked] server `rankMoldingQuotes` payload, used when `catalog` is absent
 */
export function buildMoldReport(input = {}) {
  const parsed = parseReportQuantity(input.quantity == null ? DEFAULT_REPORT_QUANTITY : input.quantity);
  if (parsed.error) return parsed;
  const quantity = parsed.quantity;
  const cavityCount = input.cavityCount == null ? 1 : finite(input.cavityCount);
  if (cavityCount == null || !Number.isInteger(cavityCount) || cavityCount < 1 || cavityCount > TOOLING_CONSTANTS.maxCavities) {
    return { error: { code: 'bad_args', message: `cavityCount must be an integer from 1 to ${TOOLING_CONSTANTS.maxCavities}` } };
  }
  const grade = typeof input.grade === 'string' && input.grade
    ? input.grade
    : defaultReportGrade(input.library);
  const pos = coordsOf(input.positions);
  const idx = input.indices == null ? null : indexOf(input.indices);
  const pull = input.analysis?.pull || input.pull || null;
  const volumeCm3 = pos ? solidVolumeCm3(pos, idx) : null;
  const projected = pos ? projectedAreaMm2(pos, idx, pull) : null;
  const sides = input.analysis?.sideActions;
  const sideActionCount = finite(sides?.count)
    ?? ((finite(sides?.slideCount) ?? 0) + (finite(sides?.lifterCount) ?? 0));
  const draft = draftOf(input.analysis?.moldDraft);
  const tons = projected == null ? null : requiredTonnage(projected);
  const notes = {
    mass: null,
    tooling: null,
    price: null,
  };
  const estimates = {
    massKg: null,
    pressTons: tons == null ? null : round6(tons),
    toolingAluminumUsd: null,
    toolingSteelUsd: null,
    partUsd: null,
    totalUsd: null,
    metal: null,
  };

  const density = densityOf(input.catalog, grade);
  if (density != null && volumeCm3 != null) {
    estimates.massKg = round6((volumeCm3 * density) / 1000);
  } else {
    notes.mass = 'The resin library has no density, so part mass is not computed.';
  }

  const rates = rateCardOf(input.catalog);
  const counts = toolingCounts(input.analysis);
  const footprint = pos ? footprintFromBox(boundsOf(pos), pull) : null;
  if (rates && counts && footprint && finite(counts.maxWallMm) > 0) {
    const tooling = toolingEstimate({
      rates,
      footprint,
      partingLengthMm: counts.partingLengthMm,
      slideCount: counts.slideCount,
      lifterCount: counts.lifterCount,
      pinCount: counts.pinCount,
      sleeveCount: counts.sleeveCount,
      maxWallMm: counts.maxWallMm,
      flowLengthMm: null,
      cavityCount,
    });
    if (tooling?.error) notes.tooling = tooling.error.message;
    else {
      estimates.toolingAluminumUsd = tooling.aluminum.totalUsd;
      estimates.toolingSteelUsd = tooling.steel.totalUsd;
    }
  } else {
    notes.tooling = 'No tooling rate card was loaded, so the tooling estimate is not computed.';
  }

  let price = null;
  if (input.catalog && footprint && volumeCm3 && counts && finite(counts.maxWallMm) > 0) {
    const ranked = rankMoldingQuotes({
      quantity,
      cavityCount,
      grade,
      part: {
        footprint,
        volumeCm3,
        maxWallMm: counts.maxWallMm,
        partingLengthMm: counts.partingLengthMm,
        slideCount: counts.slideCount,
        lifterCount: counts.lifterCount,
        pinCount: counts.pinCount,
        sleeveCount: counts.sleeveCount,
        flowLengthMm: null,
      },
      partners: input.catalog.partners,
      machines: input.catalog.machines,
      resins: input.catalog.resins,
      rates: Array.isArray(input.catalog.rates) ? input.catalog.rates : [input.catalog.rates].filter(Boolean),
    });
    if (ranked?.error) notes.price = ranked.error.message;
    else price = priceFromVendors(ranked.vendors, quantity);
    if (!price && !notes.price) notes.price = 'No press fits this part.';
  } else if (input.ranked && !input.ranked.error) {
    price = priceFromVendors(input.ranked.vendors, quantity);
    if (!price) notes.price = 'No press fits this part.';
  } else {
    notes.price = 'No partner catalog is loaded, so the part price is not computed.';
  }
  if (price) {
    estimates.partUsd = price.perPartUsd;
    estimates.totalUsd = price.totalUsd;
    estimates.metal = price.metal;
    notes.price = null;
  }

  return {
    framing: 'Mold report',
    binding: false,
    disclaimer: 'Budgetary, not binding.',
    grade,
    quantity,
    cavityCount,
    geometry: {
      volumeCm3,
      projectedAreaMm2: projected,
      sideActionCount,
      draft,
    },
    estimates,
    notes,
    assumptions: assumptionsOf(cavityCount, rates),
  };
}
