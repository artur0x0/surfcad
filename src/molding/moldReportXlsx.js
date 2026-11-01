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

function rowsOf(report) {
  const geometry = report?.geometry || {};
  const estimates = report?.estimates || {};
  const notes = report?.notes || {};
  const assumptions = report?.assumptions || {};
  const rates = assumptions.rates;
  const rateText = rates
    ? Object.entries(rates).map(([key, value]) => `${key}=${value}`).join('; ')
    : (assumptions.ratesNote || '');
  return [
    ['Field', 'Value', 'Note'],
    ['Volume (cm3)', cell(geometry.volumeCm3), ''],
    ['Projected area along pull (mm2)', cell(geometry.projectedAreaMm2), ''],
    ['Side actions', cell(geometry.sideActionCount), ''],
    ['Resin', cell(report?.grade), ''],
    ['Quantity', cell(report?.quantity), ''],
    ['Part mass (kg)', cell(estimates.massKg), cell(notes.mass)],
    ['Press size (t)', cell(estimates.pressTons), cell(assumptions.tonnageNote)],
    ['Tooling estimate, aluminum (USD)', cell(estimates.toolingAluminumUsd), cell(notes.tooling)],
    ['Tooling estimate, steel (USD)', cell(estimates.toolingSteelUsd), cell(notes.tooling)],
    ['Part price (USD)', cell(estimates.partUsd), cell(notes.price)],
    ['Total (USD)', cell(estimates.totalUsd), cell(notes.price)],
    ['Price metal', cell(estimates.metal), ''],
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
    ['Rates', rateText, cell(assumptions.ratesNote)],
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
