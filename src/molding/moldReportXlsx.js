/**
 * Workbook for one mold report. SheetJS writes OOXML (.xlsx), which Excel
 * and Numbers open. The rows are the same object `buildMoldReport` returns.
 */

import * as XLSXns from 'xlsx';

const XLSX = XLSXns.default || XLSXns;

function cell(value) {
  if (value == null || value === '') return '';
  return value;
}

function cardText(card) {
  if (!card) return '';
  return Object.entries(card)
    .filter(([key]) => key !== 'source')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function rowsOf(report) {
  const geometry = report?.geometry || {};
  const estimates = report?.estimates || {};
  const notes = report?.notes || {};
  const assumptions = report?.assumptions || {};
  const published = assumptions.published || null;
  const resin = published?.resin || null;
  const formulas = published?.formulas || null;
  const rates = assumptions.rates;
  const rateText = rates
    ? Object.entries(rates).map(([key, value]) => `${key}=${value}`).join('; ')
    : cardText(published?.card);
  const rateNote = rates
    ? (assumptions.ratesNote || '')
    : (published?.card?.source || assumptions.ratesNote || '');
  const priceNote = notes.price || formulas?.part || '';
  return [
    ['Field', 'Value', 'Note'],
    ['Volume (cm3)', cell(geometry.volumeCm3), ''],
    ['Projected area along pull (mm2)', cell(geometry.projectedAreaMm2), ''],
    ['Side actions', cell(geometry.sideActionCount), ''],
    ['Positive ≥ threshold', cell(geometry.draft?.positive), geometry.draft ? `Threshold ${geometry.draft.minDeg}°` : ''],
    ['Negative ≥ threshold', cell(geometry.draft?.negative), ''],
    ['Below threshold', cell(geometry.draft?.below), geometry.draft ? `${geometry.draft.belowPositive} positive, ${geometry.draft.belowNegative} negative` : ''],
    ['Resin', cell(report?.grade), ''],
    ['Quantity', cell(report?.quantity), ''],
    ['Part mass (kg)', cell(estimates.massKg), cell(notes.mass) || formulas?.mass || ''],
    ['Press size (t)', cell(estimates.pressTons), cell(assumptions.tonnageNote)],
    ['Tooling estimate (USD)', cell(estimates.toolingUsd), cell(notes.tooling) || formulas?.tooling || ''],
    ['Tooling estimate, aluminum (USD)', cell(estimates.toolingAluminumUsd), cell(notes.tooling)],
    ['Tooling estimate, steel (USD)', cell(estimates.toolingSteelUsd), cell(notes.tooling)],
    ['Material (USD)', cell(estimates.materialUsd), formulas?.material || ''],
    ['Press share (USD)', cell(estimates.pressUsd), formulas?.press || ''],
    ['Cycle (s)', cell(estimates.cycleS), formulas?.cycle || ''],
    ['Size factor', cell(published?.sizeFactor), 'max(minSizeFactor, projectedAreaMm2 / referenceAreaMm2)'],
    ['Part price (USD)', cell(estimates.partUsd), cell(priceNote)],
    ['Total (USD)', cell(estimates.totalUsd), cell(notes.price)],
    ['Price metal', cell(estimates.metal), ''],
    ['Price path', cell(assumptions.priceSource), published?.cavityNote || ''],
    ['Resin density (g/cm3)', cell(resin?.densityGCm3), cell(resin?.densitySource)],
    ['Resin density as of', cell(resin?.densityAsOf), ''],
    ['Resin price (USD/kg)', cell(resin?.usdPerKg), cell(resin?.priceSource)],
    ['Resin price as of', cell(resin?.priceAsOf), ''],
    ['Mass formula', cell(formulas?.mass), ''],
    ['Tooling formula', cell(formulas?.tooling), ''],
    ['Cycle formula', cell(formulas?.cycle), ''],
    ['Press formula', cell(formulas?.press), ''],
    ['Material formula', cell(formulas?.material), ''],
    ['Part price formula', cell(formulas?.part), ''],
    ['Cavity count', cell(assumptions.cavityCount), 'Not shown in the report. The quote uses 1 unless a caller sets it.'],
    ['Clamp pressure (MPa)', cell(assumptions.cavityPressureMpa), ''],
    ['Newton per ton', cell(assumptions.newtonPerTon), ''],
    ['Fill (s)', cell(assumptions.fillS), ''],
    ['Cool factor, aluminum (s/mm2)', cell(assumptions.kCoolAluminum), ''],
    ['Cool factor, steel (s/mm2)', cell(assumptions.kCoolSteel), ''],
    ['Mechanical, aluminum (s)', cell(assumptions.mechAluminumS), ''],
    ['Mechanical, steel (s)', cell(assumptions.mechSteelS), ''],
    ['Stand-in press (USD/h)', cell(assumptions.standInPressUsdPerHour), ''],
    ['Runner fraction', cell(assumptions.runnerFraction), ''],
    ['Shot window low', cell(assumptions.shotLow), ''],
    ['Shot window high', cell(assumptions.shotHigh), ''],
    ['Rates', rateText, cell(rateNote)],
  ];
}

/** @returns {Uint8Array} */
export function moldReportXlsx(report) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rowsOf(report));
  XLSX.utils.book_append_sheet(book, sheet, 'Report');
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/** Parse a workbook this module wrote. Tests use this; Excel uses the file. */
export function readMoldReportXlsx(bytes) {
  const book = XLSX.read(bytes, { type: 'array' });
  const name = book.SheetNames[0];
  return XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1 });
}
