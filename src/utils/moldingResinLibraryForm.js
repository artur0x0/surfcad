// Admin form for the generic injection-resin library. No price fields.

const NUMBER_FIELDS = Object.freeze([
  Object.freeze(['tensileModulusMpa', 'Tensile modulus (MPa)', 'positive']),
  Object.freeze(['shrinkLowPct', 'Shrink low (%)', 'percent']),
  Object.freeze(['shrinkHighPct', 'Shrink high (%)', 'percent']),
  Object.freeze(['wallMinMm', 'Wall min (mm)', 'positive']),
  Object.freeze(['wallMaxMm', 'Wall max (mm)', 'positive']),
  Object.freeze(['meltTempLowC', 'Melt temp low (°C)', 'nonneg']),
  Object.freeze(['meltTempHighC', 'Melt temp high (°C)', 'nonneg']),
  Object.freeze(['moldTempLowC', 'Mold temp low (°C)', 'nonneg']),
  Object.freeze(['moldTempHighC', 'Mold temp high (°C)', 'nonneg']),
]);

export const LIBRARY_NUMBER_FIELDS = NUMBER_FIELDS;

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) return { error: `${label} is required` };
  return { value: text };
}

function requiredNumber(value, label, kind) {
  if (value === '' || value == null) return { error: `${label} is required` };
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return { error: `${label} must be a number` };
  if (kind === 'positive' && !(n > 0)) return { error: `${label} must be greater than 0` };
  if (kind === 'nonneg' && n < 0) return { error: `${label} must be 0 or greater` };
  if (kind === 'percent' && (n < 0 || n > 100)) return { error: `${label} must be from 0 to 100` };
  return { value: n };
}

export function emptyLibraryForm() {
  const form = { grade: '', notes: '', active: true };
  for (const [key] of NUMBER_FIELDS) form[key] = '';
  return form;
}

export function libraryFormFromRow(row) {
  const form = emptyLibraryForm();
  if (!row) return form;
  form.grade = row.grade || '';
  form.notes = row.notes || '';
  form.active = row.active !== false;
  for (const [key] of NUMBER_FIELDS) {
    form[key] = row[key] == null ? '' : String(row[key]);
  }
  return form;
}

export function libraryPayload(form) {
  const grade = requiredText(form?.grade, 'Grade');
  if (grade.error) return grade;
  const value = { grade: grade.value, notes: String(form?.notes ?? '').trim(), active: form?.active !== false };
  for (const [key, label, kind] of NUMBER_FIELDS) {
    const parsed = requiredNumber(form?.[key], label, kind);
    if (parsed.error) return parsed;
    value[key] = parsed.value;
  }
  if (value.shrinkLowPct > value.shrinkHighPct) {
    return { error: 'Shrink low must be less than or equal to high' };
  }
  if (value.wallMinMm > value.wallMaxMm) {
    return { error: 'Wall min must be less than or equal to high' };
  }
  if (value.meltTempLowC > value.meltTempHighC) {
    return { error: 'Melt temp low must be less than or equal to high' };
  }
  if (value.moldTempLowC > value.moldTempHighC) {
    return { error: 'Mold temp low must be less than or equal to high' };
  }
  return { value };
}
