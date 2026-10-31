// Form values for the admin molding catalog. The server still validates.

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

function activeFlag(value) {
  return value !== false;
}

export const MACHINE_NUMBER_FIELDS = Object.freeze([
  Object.freeze(['tonnage', 'Tonnage', 'positive']),
  Object.freeze(['platenWidthMm', 'Platen width (mm)', 'positive']),
  Object.freeze(['platenHeightMm', 'Platen height (mm)', 'positive']),
  Object.freeze(['tieBarSpacingXMm', 'Tie-bar spacing X (mm)', 'positive']),
  Object.freeze(['tieBarSpacingYMm', 'Tie-bar spacing Y (mm)', 'positive']),
  Object.freeze(['barrelShotCm3', 'Shot size (cm³)', 'positive']),
  Object.freeze(['utilizationPct', 'Utilization (%)', 'percent']),
  Object.freeze(['hourlyRateUsd', 'Hourly rate (USD)', 'nonneg']),
]);

export const RATE_FIELDS = Object.freeze([
  Object.freeze(['aluminumUsdPerKg', 'Aluminum (USD/kg)']),
  Object.freeze(['steelUsdPerKg', 'Steel (USD/kg)']),
  Object.freeze(['aluminumMachiningUsdPerHour', 'Aluminum machining (USD/hour)']),
  Object.freeze(['steelMachiningUsdPerHour', 'Steel machining (USD/hour)']),
  Object.freeze(['baseHoursSimple', 'Base hours, simple mold']),
  Object.freeze(['coolingLineHoursFactor', 'Cooling-line hours factor']),
  Object.freeze(['slideAdderUsd', 'Slide adder (USD)']),
  Object.freeze(['lifterAdderUsd', 'Lifter adder (USD)']),
  Object.freeze(['ejectorPinUsd', 'Ejector pin (USD)']),
  Object.freeze(['sleeveUsd', 'Sleeve (USD)']),
  Object.freeze(['hotRunnerSuggestionUsd', 'Hot-runner suggestion (USD)']),
]);

export function emptyPartnerForm() {
  return { displayName: '', anonLabel: '', region: '', notes: '', active: true };
}

export function partnerFormFromRow(row) {
  return {
    displayName: row?.displayName || '',
    anonLabel: row?.anonLabel || '',
    region: row?.region || '',
    notes: row?.notes || '',
    active: row?.active !== false,
  };
}

export function partnerPayload(form) {
  const displayName = requiredText(form?.displayName, 'Real name');
  if (displayName.error) return displayName;
  const anonLabel = requiredText(form?.anonLabel, 'Public label');
  if (anonLabel.error) return anonLabel;
  const region = requiredText(form?.region, 'Region');
  if (region.error) return region;
  return {
    value: {
      displayName: displayName.value,
      anonLabel: anonLabel.value,
      region: region.value,
      notes: String(form?.notes ?? '').trim(),
      active: activeFlag(form?.active),
    },
  };
}

export function emptyMachineForm() {
  const form = { name: '', active: true };
  for (const [key] of MACHINE_NUMBER_FIELDS) form[key] = '';
  return form;
}

export function machineFormFromRow(row) {
  const form = emptyMachineForm();
  form.name = row?.name || '';
  form.active = row?.active !== false;
  for (const [key] of MACHINE_NUMBER_FIELDS) {
    form[key] = row?.[key] == null ? '' : String(row[key]);
  }
  return form;
}

export function machinePayload(form, partnerId) {
  const name = requiredText(form?.name, 'Name');
  if (name.error) return name;
  const value = { partnerId, name: name.value, active: activeFlag(form?.active) };
  for (const [key, label, kind] of MACHINE_NUMBER_FIELDS) {
    const parsed = requiredNumber(form?.[key], label, kind);
    if (parsed.error) return parsed;
    value[key] = parsed.value;
  }
  return { value };
}

export function emptyResinForm() {
  return { grade: '', usdPerKg: '', densityGCm3: '', active: true };
}

export function resinFormFromRow(row) {
  return {
    grade: row?.grade || '',
    usdPerKg: row?.usdPerKg == null ? '' : String(row.usdPerKg),
    densityGCm3: row?.densityGCm3 == null ? '' : String(row.densityGCm3),
    active: row?.active !== false,
  };
}

export function resinPayload(form, partnerId) {
  const grade = requiredText(form?.grade, 'Grade');
  if (grade.error) return grade;
  const usdPerKg = requiredNumber(form?.usdPerKg, 'USD per kg', 'nonneg');
  if (usdPerKg.error) return usdPerKg;
  const densityGCm3 = requiredNumber(form?.densityGCm3, 'Density (g/cm³)', 'positive');
  if (densityGCm3.error) return densityGCm3;
  return {
    value: {
      partnerId,
      grade: grade.value,
      usdPerKg: usdPerKg.value,
      densityGCm3: densityGCm3.value,
      active: activeFlag(form?.active),
    },
  };
}

export function emptyRateForm() {
  const form = { active: true };
  for (const [key] of RATE_FIELDS) form[key] = '';
  return form;
}

export function rateFormFromRow(row) {
  const form = emptyRateForm();
  if (!row) return form;
  form.active = row.active !== false;
  for (const [key] of RATE_FIELDS) {
    form[key] = row[key] == null ? '' : String(row[key]);
  }
  return form;
}

export function ratePayload(form, partnerId) {
  const value = { partnerId, active: activeFlag(form?.active) };
  for (const [key, label] of RATE_FIELDS) {
    const parsed = requiredNumber(form?.[key], label, 'nonneg');
    if (parsed.error) return parsed;
    value[key] = parsed.value;
  }
  return { value };
}
