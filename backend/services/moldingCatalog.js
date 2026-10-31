// Admin catalog writes for molding partners. No public names leave this module
// except through the admin router that calls it.

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

export const PARTNER_FIELDS = ['displayName', 'anonLabel', 'region', 'active', 'notes'];
export const MACHINE_FIELDS = [
  'partnerId',
  'name',
  'tonnage',
  'platenWidthMm',
  'platenHeightMm',
  'tieBarSpacingXMm',
  'tieBarSpacingYMm',
  'barrelShotCm3',
  'utilizationPct',
  'utilizationUpdatedAt',
  'hourlyRateUsd',
  'active',
];
export const RESIN_FIELDS = ['partnerId', 'grade', 'usdPerKg', 'densityGCm3', 'active'];
export const RATE_FIELDS = [
  'partnerId',
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
  'active',
];

export class CatalogError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
  }
}

export function assertObjectId(value, message = 'Invalid id') {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw new CatalogError(400, message);
  }
}

function assertBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CatalogError(400, 'Expected a JSON object');
  }
}

function rejectUnknown(body, fields) {
  const extra = Object.keys(body).filter((key) => !fields.includes(key));
  if (extra.length) throw new CatalogError(400, `Unknown field: ${extra[0]}`);
}

function pick(body, fields) {
  const data = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) data[key] = body[key];
  }
  return data;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value;
}

async function assertNoClash(Model, query, message) {
  const clash = await Model.findOne(query);
  if (clash) throw new CatalogError(400, message);
}

async function requirePartner(partners, partnerId) {
  const id = partnerId == null ? '' : String(partnerId);
  assertObjectId(id, 'Invalid partner id');
  const partner = await partners.findById(id);
  if (!partner) throw new CatalogError(400, 'Partner not found');
  return id;
}

function listQuery(query, { withPartner = false } = {}) {
  const source = query || {};
  const filter = {};
  if (source.active === 'true') filter.active = true;
  else if (source.active === 'false') filter.active = false;
  else if (source.active != null && source.active !== '') {
    throw new CatalogError(400, 'active must be true or false');
  }
  if (withPartner && source.partnerId != null && source.partnerId !== '') {
    assertObjectId(String(source.partnerId), 'Invalid partner id');
    filter.partnerId = String(source.partnerId);
  }
  return filter;
}

async function load(Model, id) {
  assertObjectId(id);
  const doc = await Model.findById(id);
  if (!doc) throw new CatalogError(404, 'Not found');
  return doc;
}

function stampUtilization(data) {
  if (!Object.prototype.hasOwnProperty.call(data, 'utilizationPct')) return data;
  if (Object.prototype.hasOwnProperty.call(data, 'utilizationUpdatedAt')) return data;
  return { ...data, utilizationUpdatedAt: new Date() };
}

export async function listPartners(Model, query) {
  return Model.find(listQuery(query)).sort({ anonLabel: 1 });
}

export async function createPartner(Model, body) {
  assertBody(body);
  rejectUnknown(body, PARTNER_FIELDS);
  const data = pick(body, PARTNER_FIELDS);
  if (typeof data.anonLabel === 'string') {
    await assertNoClash(
      Model,
      { anonLabel: data.anonLabel.trim() },
      'A partner with that anonLabel already exists',
    );
  }
  const doc = new Model(data);
  await doc.save();
  return doc;
}

export async function updatePartner(Model, id, body) {
  assertBody(body);
  rejectUnknown(body, PARTNER_FIELDS);
  const data = pick(body, PARTNER_FIELDS);
  if (!Object.keys(data).length) throw new CatalogError(400, 'No fields to update');
  const doc = await load(Model, id);
  if (typeof data.anonLabel === 'string') {
    await assertNoClash(
      Model,
      { anonLabel: data.anonLabel.trim(), _id: { $ne: doc._id } },
      'A partner with that anonLabel already exists',
    );
  }
  Object.assign(doc, data);
  await doc.save();
  return doc;
}

export async function deactivate(Model, id) {
  const doc = await load(Model, id);
  doc.active = false;
  await doc.save();
  return doc;
}

export async function listMachines(Model, query) {
  return Model.find(listQuery(query, { withPartner: true })).sort({ name: 1 });
}

export async function createMachine(models, body) {
  assertBody(body);
  rejectUnknown(body, MACHINE_FIELDS);
  const data = stampUtilization(pick(body, MACHINE_FIELDS));
  const partnerId = await requirePartner(models.partners, data.partnerId);
  data.partnerId = partnerId;
  if (typeof data.name === 'string') {
    await assertNoClash(
      models.machines,
      { partnerId, name: data.name.trim() },
      'That partner already has a machine with this name',
    );
  }
  const doc = new models.machines(data);
  await doc.save();
  return doc;
}

export async function updateMachine(models, id, body) {
  assertBody(body);
  rejectUnknown(body, MACHINE_FIELDS);
  const data = stampUtilization(pick(body, MACHINE_FIELDS));
  if (!Object.keys(data).length) throw new CatalogError(400, 'No fields to update');
  const doc = await load(models.machines, id);
  const partnerId = Object.prototype.hasOwnProperty.call(data, 'partnerId')
    ? await requirePartner(models.partners, data.partnerId)
    : String(doc.partnerId);
  if (Object.prototype.hasOwnProperty.call(data, 'partnerId')) data.partnerId = partnerId;
  const name = trimmed(Object.prototype.hasOwnProperty.call(data, 'name') ? data.name : doc.name);
  if (typeof name === 'string') {
    await assertNoClash(
      models.machines,
      { partnerId, name, _id: { $ne: doc._id } },
      'That partner already has a machine with this name',
    );
  }
  Object.assign(doc, data);
  await doc.save();
  return doc;
}

export async function listResins(Model, query) {
  return Model.find(listQuery(query, { withPartner: true })).sort({ grade: 1 });
}

export async function createResin(models, body) {
  assertBody(body);
  rejectUnknown(body, RESIN_FIELDS);
  const data = pick(body, RESIN_FIELDS);
  const partnerId = await requirePartner(models.partners, data.partnerId);
  data.partnerId = partnerId;
  if (typeof data.grade === 'string') {
    await assertNoClash(
      models.resins,
      { partnerId, grade: data.grade.trim() },
      'That partner already has a price for this grade',
    );
  }
  const doc = new models.resins(data);
  await doc.save();
  return doc;
}

export async function updateResin(models, id, body) {
  assertBody(body);
  rejectUnknown(body, RESIN_FIELDS);
  const data = pick(body, RESIN_FIELDS);
  if (!Object.keys(data).length) throw new CatalogError(400, 'No fields to update');
  const doc = await load(models.resins, id);
  const partnerId = Object.prototype.hasOwnProperty.call(data, 'partnerId')
    ? await requirePartner(models.partners, data.partnerId)
    : String(doc.partnerId);
  if (Object.prototype.hasOwnProperty.call(data, 'partnerId')) data.partnerId = partnerId;
  const grade = trimmed(Object.prototype.hasOwnProperty.call(data, 'grade') ? data.grade : doc.grade);
  if (typeof grade === 'string') {
    await assertNoClash(
      models.resins,
      { partnerId, grade, _id: { $ne: doc._id } },
      'That partner already has a price for this grade',
    );
  }
  Object.assign(doc, data);
  await doc.save();
  return doc;
}

export async function listRates(Model, query) {
  return Model.find(listQuery(query, { withPartner: true })).sort({ partnerId: 1 });
}

export async function createRate(models, body) {
  assertBody(body);
  rejectUnknown(body, RATE_FIELDS);
  const data = pick(body, RATE_FIELDS);
  const partnerId = await requirePartner(models.partners, data.partnerId);
  data.partnerId = partnerId;
  await assertNoClash(
    models.rates,
    { partnerId },
    'That partner already has a tooling rate card',
  );
  const doc = new models.rates(data);
  await doc.save();
  return doc;
}

export async function updateRate(models, id, body) {
  assertBody(body);
  rejectUnknown(body, RATE_FIELDS);
  const data = pick(body, RATE_FIELDS);
  if (!Object.keys(data).length) throw new CatalogError(400, 'No fields to update');
  const doc = await load(models.rates, id);
  if (Object.prototype.hasOwnProperty.call(data, 'partnerId')) {
    const partnerId = await requirePartner(models.partners, data.partnerId);
    data.partnerId = partnerId;
    await assertNoClash(
      models.rates,
      { partnerId, _id: { $ne: doc._id } },
      'That partner already has a tooling rate card',
    );
  }
  Object.assign(doc, data);
  await doc.save();
  return doc;
}
