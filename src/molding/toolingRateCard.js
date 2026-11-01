/**
 * Published tooling rate card for the mold report.
 *
 * One cavity. Base mold cost scales with projected area along the pull, and
 * each side action adds a fixed amount. Part price is material, plus press
 * time at the machine rate, plus this tooling divided by quantity.
 *
 * The cycle is the aluminum uncooled stand-in already in TOOLING_CONSTANTS
 * (fill, plus k times max wall squared, plus the mechanical seconds). The
 * machine rate is that file's stand-in press rate. Material is the solid
 * part only. The runner allowance used to size a press shot is not added.
 * This is not a supplier quote and it does not read a partner rate card.
 */

import { TOOLING_CONSTANTS } from './toolingEstimate.js';

export const REPORT_TOOLING_CARD = Object.freeze({
  asOf: '2026-06-01',
  source: 'Budgetary single-cavity aluminum prototype mold, reviewed 2026-06-01. The $8,000 base is the middle of a $5,000–$11,000 band for a 100 mm × 100 mm silhouette, from published US quick-turn mold ranges. It is not a supplier quote. Below 5,000 mm² the base stays at half, because a mold base does not keep shrinking with the part. Each side action adds $1,500, the low end of published $1,000–$5,000 slide and lifter adders. Press time uses the aluminum uncooled cycle and standInPressUsdPerHour from TOOLING_CONSTANTS. One cavity. Material is the solid part only.',
  /** Dollars at the reference silhouette. */
  baseMoldUsd: 8000,
  /** 100 mm × 100 mm projected area, mm². */
  referenceAreaMm2: 10000,
  /** Floor on baseMoldUsd × area / reference. */
  minSizeFactor: 0.5,
  /** Dollars added once per side action (slide or lifter). */
  sideActionAdderUsd: 1500,
  machineRateUsdPerHour: TOOLING_CONSTANTS.standInPressUsdPerHour,
  fillS: TOOLING_CONSTANTS.fillS,
  /** Seconds per mm² of max wall. Aluminum, uncooled. */
  kCoolSPerMm2: TOOLING_CONSTANTS.kCoolAluminum,
  mechS: TOOLING_CONSTANTS.mechAluminumS,
});

export const REPORT_PRICE_FORMULAS = Object.freeze({
  mass: 'massKg = volumeCm3 * densityGCm3 / 1000',
  tooling: 'toolingUsd = baseMoldUsd * max(minSizeFactor, projectedAreaMm2 / referenceAreaMm2) + sideActionCount * sideActionAdderUsd',
  cycle: 'cycleS = fillS + kCoolSPerMm2 * maxWallMm^2 + mechS',
  press: 'pressUsd = cycleS / 3600 * machineRateUsdPerHour',
  material: 'materialUsd = massKg * usdPerKg',
  part: 'partUsd = materialUsd + pressUsd + toolingUsd / quantity',
});

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

/**
 * Size factor and tooling dollars. Null when the projected area is missing.
 * A side-action count below 0 is treated as missing.
 */
export function toolingFromCard(projectedAreaMm2, sideActionCount, card = REPORT_TOOLING_CARD) {
  const area = finite(projectedAreaMm2);
  if (area == null || area <= 0) return null;
  const sides = finite(sideActionCount);
  if (sides == null || sides < 0) return null;
  const sizeFactor = Math.max(card.minSizeFactor, area / card.referenceAreaMm2);
  return {
    sizeFactor: round6(sizeFactor),
    toolingUsd: roundMoney(card.baseMoldUsd * sizeFactor + sides * card.sideActionAdderUsd),
  };
}

/**
 * Budgetary mass, tooling, press share, and part price from the published
 * table and this card. Any missing input stays null. Nothing here is filled
 * with a stand-in wall, density, or price.
 */
export function publishedPartQuote({
  volumeCm3,
  densityGCm3,
  usdPerKg,
  projectedAreaMm2,
  sideActionCount,
  maxWallMm,
  quantity,
  card = REPORT_TOOLING_CARD,
}) {
  const volume = finite(volumeCm3);
  const density = finite(densityGCm3);
  const pricePerKg = finite(usdPerKg);
  const massKg = volume != null && volume > 0 && density != null && density > 0
    ? round6((volume * density) / 1000)
    : null;
  const tooling = toolingFromCard(projectedAreaMm2, sideActionCount, card);
  const wall = finite(maxWallMm);
  const cycleS = wall != null && wall > 0
    ? round6(card.fillS + card.kCoolSPerMm2 * wall * wall + card.mechS)
    : null;
  const pressUsd = cycleS == null ? null : roundMoney((cycleS / 3600) * card.machineRateUsdPerHour);
  const materialUsd = massKg != null && pricePerKg != null && pricePerKg >= 0
    ? roundMoney(massKg * pricePerKg)
    : null;
  const qty = finite(quantity);
  const partUsd = materialUsd != null && pressUsd != null && tooling && qty != null && qty > 0
    ? roundMoney(materialUsd + pressUsd + tooling.toolingUsd / qty)
    : null;
  return {
    massKg,
    toolingUsd: tooling ? tooling.toolingUsd : null,
    sizeFactor: tooling ? tooling.sizeFactor : null,
    materialUsd,
    pressUsd,
    cycleS,
    partUsd,
    totalUsd: partUsd == null || qty == null ? null : roundMoney(partUsd * qty),
  };
}
