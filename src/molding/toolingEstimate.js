/**
 * Budgetary aluminum-vs-steel tooling estimate (M4.2).
 * Pure numbers. No Manifold, no mongoose, and no print-quote math.
 *
 * The constants below are a stand-in until a manufacturing review retunes
 * them. They are not a supplier quote.
 */

export const TOOLING_CONSTANTS = Object.freeze({
  /** Plate border around the cavity grid, mm. */
  marginMm: 40,
  /** Gap between cavities, mm. */
  cavityGapMm: 20,
  /** Two plates are at least this thick together, mm. */
  minStackMm: 50,
  /** Extra plate thickness on each side of the part, mm. */
  plateBackupMm: 40,
  aluminumDensityGCm3: 2.7,
  steelDensityGCm3: 7.85,
  /** Shutoff machining. Parting-line length per hour, mm. */
  partingMmPerHour: 250,
  /** Stand-in cycle, seconds. Resin cost cancels in the crossover. */
  fillS: 2,
  mechAluminumS: 25,
  mechSteelS: 12,
  /** Seconds per mm² of max wall. Aluminum is the uncooled case. */
  kCoolAluminum: 8,
  kCoolSteel: 2,
  /** Used only when the caller does not pass a part cost. Not a press rate. */
  standInPressUsdPerHour: 40,
  /** flow length / max wall at or above this suggests a hot runner. */
  hotRunnerAspect: 80,
  /** Or a flow this long, mm. */
  hotRunnerFlowMm: 150,
  maxCavities: 64,
});

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

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function bad(message) {
  return { error: { code: 'bad_args', message } };
}

function nonNegative(value, name) {
  const n = finite(value);
  if (n == null || n < 0) return bad(`${name} must be 0 or greater`);
  return n;
}

function positive(value, name) {
  const n = finite(value);
  if (n == null || n <= 0) return bad(`${name} must be greater than 0`);
  return n;
}

/**
 * Parting-plane footprint. `pull` picks the height axis (largest component).
 * Length and width stay in X, Y, Z order among the other two axes.
 */
export function footprintFromBox(box, pull) {
  const size = [0, 1, 2].map((axis) => {
    const min = finite(box?.min?.[axis]);
    const max = finite(box?.max?.[axis]);
    if (min == null || max == null) return null;
    return Math.abs(max - min);
  });
  if (size.some((n) => n == null || n <= 0)) return null;
  const p = Array.isArray(pull) ? pull : [0, 0, 1];
  let heightAxis = 2;
  let best = -1;
  for (let axis = 0; axis < 3; axis += 1) {
    const mag = Math.abs(finite(p[axis]) ?? 0);
    if (mag > best) {
      best = mag;
      heightAxis = axis;
    }
  }
  const plane = [0, 1, 2].filter((axis) => axis !== heightAxis);
  return {
    lengthMm: round4(size[plane[0]]),
    widthMm: round4(size[plane[1]]),
    heightMm: round4(size[heightAxis]),
  };
}

/** Counts a tooling estimate can read off a mold-analysis result. */
export function toolingCounts(analysis) {
  if (!analysis || analysis.kind !== 'mold-analysis') return null;
  const lines = Array.isArray(analysis.parting?.lines) ? analysis.parting.lines : [];
  let partingLengthMm = 0;
  for (const line of lines) {
    const length = finite(line?.length);
    if (length != null && length > 0) partingLengthMm += length;
  }
  return {
    partingLengthMm: round4(partingLengthMm),
    slideCount: finite(analysis.sideActions?.slideCount) ?? 0,
    lifterCount: finite(analysis.sideActions?.lifterCount) ?? 0,
    pinCount: finite(analysis.moldDraft?.ejectors?.pinCount) ?? 0,
    sleeveCount: finite(analysis.moldDraft?.ejectors?.sleeveCount) ?? 0,
    maxWallMm: finite(analysis.wall?.max),
  };
}

function plateSize(lengthMm, count, gapMm, marginMm) {
  return count * lengthMm + Math.max(0, count - 1) * gapMm + 2 * marginMm;
}

function cavityGrid(cavityCount) {
  const cols = Math.ceil(Math.sqrt(cavityCount));
  const rows = Math.ceil(cavityCount / cols);
  return { cols, rows };
}

/**
 * Smallest quantity where the steel unit cost is at or under aluminum.
 * Null when steel never catches up. Equal costs return 1.
 */
export function steelCheaperAt(toolAluminumUsd, toolSteelUsd, partAluminumUsd, partSteelUsd) {
  const toolAl = finite(toolAluminumUsd);
  const toolSteel = finite(toolSteelUsd);
  const partAl = finite(partAluminumUsd);
  const partSteel = finite(partSteelUsd);
  if (toolAl == null || toolSteel == null || partAl == null || partSteel == null) return null;
  const holds = (qty) => partSteel + toolSteel / qty <= partAl + toolAl / qty + 1e-9;
  if (holds(1)) return 1;
  const toolDelta = toolSteel - toolAl;
  const partDelta = partAl - partSteel;
  if (toolDelta <= 0 || partDelta <= 0) return null;
  const qty = Math.ceil(toolDelta / partDelta - 1e-9);
  if (!Number.isFinite(qty) || qty < 2) return null;
  return holds(qty) ? qty : null;
}

function readRates(rates) {
  if (!rates || typeof rates !== 'object') return bad('A tooling rate card is required');
  if (rates.active === false) {
    return { error: { code: 'inactive_rate', message: 'That tooling rate card is inactive' } };
  }
  const out = {};
  for (const field of RATE_FIELDS) {
    const n = nonNegative(rates[field], field);
    if (n?.error) return n;
    out[field] = n;
  }
  return out;
}

function cycleSeconds(maxWallMm, kCool, mechS, fillS) {
  const wall = maxWallMm == null ? 0 : maxWallMm;
  return fillS + kCool * wall * wall + mechS;
}

function sideOf(metal, input) {
  const massKg = round4(input.volumeMm3 * input.density / 1e6);
  const materialUsd = roundMoney(massKg * input.usdPerKg);
  const hours = round4(input.hours);
  const machiningUsd = roundMoney(hours * input.usdPerHour);
  const addersUsd = input.addersUsd;
  const hotRunnerUsd = input.includeHotRunner ? input.hotRunnerUsd : 0;
  const totalUsd = roundMoney(materialUsd + machiningUsd + addersUsd + hotRunnerUsd);
  return {
    metal,
    massKg,
    materialUsd,
    hours,
    machiningUsd,
    addersUsd,
    hotRunnerUsd,
    totalUsd,
  };
}

/**
 * Side-by-side tooling. `footprint` is the parting-plane box in mm.
 * Slides, lifters, pins, and sleeves are multiplied by the cavity count.
 * A hot runner is suggested from flow length and is left out of the totals
 * unless `includeHotRunner` is true.
 */
export function toolingEstimate(input = {}) {
  const constants = { ...TOOLING_CONSTANTS, ...(input.constants || {}) };
  const rates = readRates(input.rates);
  if (rates.error) return rates;

  const footprint = input.footprint || {};
  const lengthMm = positive(footprint.lengthMm, 'lengthMm');
  if (lengthMm?.error) return lengthMm;
  const widthMm = positive(footprint.widthMm, 'widthMm');
  if (widthMm?.error) return widthMm;
  const heightMm = positive(footprint.heightMm, 'heightMm');
  if (heightMm?.error) return heightMm;

  const cavityCount = input.cavityCount == null ? 1 : finite(input.cavityCount);
  if (cavityCount == null || !Number.isInteger(cavityCount) || cavityCount < 1 || cavityCount > constants.maxCavities) {
    return bad(`cavityCount must be an integer from 1 to ${constants.maxCavities}`);
  }

  const partingLengthMm = nonNegative(input.partingLengthMm ?? 0, 'partingLengthMm');
  if (partingLengthMm?.error) return partingLengthMm;
  const slideCount = nonNegative(input.slideCount ?? 0, 'slideCount');
  if (slideCount?.error) return slideCount;
  const lifterCount = nonNegative(input.lifterCount ?? 0, 'lifterCount');
  if (lifterCount?.error) return lifterCount;
  const pinCount = nonNegative(input.pinCount ?? 0, 'pinCount');
  if (pinCount?.error) return pinCount;
  const sleeveCount = nonNegative(input.sleeveCount ?? 0, 'sleeveCount');
  if (sleeveCount?.error) return sleeveCount;

  const maxWallMm = input.maxWallMm == null ? null : nonNegative(input.maxWallMm, 'maxWallMm');
  if (maxWallMm?.error) return maxWallMm;
  const flowLengthMm = input.flowLengthMm == null ? null : nonNegative(input.flowLengthMm, 'flowLengthMm');
  if (flowLengthMm?.error) return flowLengthMm;

  const { cols, rows } = cavityGrid(cavityCount);
  const plateLengthMm = round4(plateSize(lengthMm, cols, constants.cavityGapMm, constants.marginMm));
  const plateWidthMm = round4(plateSize(widthMm, rows, constants.cavityGapMm, constants.marginMm));
  const stackMm = round4(Math.max(
    constants.minStackMm,
    heightMm + 2 * constants.plateBackupMm,
  ));
  const volumeMm3 = plateLengthMm * plateWidthMm * stackMm;

  const shutoffHours = constants.partingMmPerHour > 0
    ? (partingLengthMm * cavityCount) / constants.partingMmPerHour
    : 0;
  const aluminumHours = rates.baseHoursSimple * cavityCount + shutoffHours;
  const steelHours = aluminumHours + rates.coolingLineHoursFactor * cavityCount;

  const addersUsd = roundMoney(cavityCount * (
    slideCount * rates.slideAdderUsd
    + lifterCount * rates.lifterAdderUsd
    + pinCount * rates.ejectorPinUsd
    + sleeveCount * rates.sleeveUsd
  ));

  const aspect = maxWallMm > 0 && flowLengthMm != null ? flowLengthMm / maxWallMm : 0;
  const hotRunnerSuggested = flowLengthMm != null && (
    flowLengthMm >= constants.hotRunnerFlowMm || aspect >= constants.hotRunnerAspect
  );
  const hotRunnerUsd = roundMoney(rates.hotRunnerSuggestionUsd);
  const includeHotRunner = input.includeHotRunner === true && hotRunnerSuggested;

  const shared = {
    volumeMm3,
    addersUsd,
    includeHotRunner,
    hotRunnerUsd,
  };
  const aluminum = sideOf('aluminum', {
    ...shared,
    density: constants.aluminumDensityGCm3,
    usdPerKg: rates.aluminumUsdPerKg,
    hours: aluminumHours,
    usdPerHour: rates.aluminumMachiningUsdPerHour,
  });
  const steel = sideOf('steel', {
    ...shared,
    density: constants.steelDensityGCm3,
    usdPerKg: rates.steelUsdPerKg,
    hours: steelHours,
    usdPerHour: rates.steelMachiningUsdPerHour,
  });

  let partAluminumUsd;
  let partSteelUsd;
  let partCostSource;
  if (input.partCostUsd) {
    partAluminumUsd = nonNegative(input.partCostUsd.aluminum, 'partCostUsd.aluminum');
    if (partAluminumUsd?.error) return partAluminumUsd;
    partSteelUsd = nonNegative(input.partCostUsd.steel, 'partCostUsd.steel');
    if (partSteelUsd?.error) return partSteelUsd;
    partAluminumUsd = roundMoney(partAluminumUsd);
    partSteelUsd = roundMoney(partSteelUsd);
    partCostSource = 'input';
  } else {
    const wall = maxWallMm == null ? 0 : maxWallMm;
    const aluminumS = cycleSeconds(wall, constants.kCoolAluminum, constants.mechAluminumS, constants.fillS);
    const steelS = cycleSeconds(wall, constants.kCoolSteel, constants.mechSteelS, constants.fillS);
    partAluminumUsd = roundMoney((aluminumS / 3600) * constants.standInPressUsdPerHour);
    partSteelUsd = roundMoney((steelS / 3600) * constants.standInPressUsdPerHour);
    partCostSource = 'stand-in';
  }

  return {
    framing: 'Budgetary tooling estimate',
    binding: false,
    disclaimer: 'Not a binding supplier tooling quote.',
    cavityCount,
    plate: {
      lengthMm: plateLengthMm,
      widthMm: plateWidthMm,
      stackMm,
      cols,
      rows,
    },
    aluminum,
    steel,
    hotRunner: {
      suggested: hotRunnerSuggested,
      included: includeHotRunner,
      usd: hotRunnerUsd,
    },
    partCostUsd: {
      aluminum: partAluminumUsd,
      steel: partSteelUsd,
      source: partCostSource,
    },
    steelCheaperAt: steelCheaperAt(aluminum.totalUsd, steel.totalUsd, partAluminumUsd, partSteelUsd),
    addersUsd,
  };
}
