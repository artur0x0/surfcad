// Generic injection-resin properties. No dollars, no partner id.
// Listing inserts curated grades that are not already stored.

import { CatalogError, assertObjectId } from './moldingCatalog.js';
import { MOLDING_RESIN_SEED, MOLDING_RESIN_SEED_NOTE } from '../db/models/moldingResinSeed.js';

export const LIBRARY_FIELDS = [
  'grade',
  'tensileModulusMpa',
  'shrinkLowPct',
  'shrinkHighPct',
  'wallMinMm',
  'wallMaxMm',
  'meltTempLowC',
  'meltTempHighC',
  'moldTempLowC',
  'moldTempHighC',
  'notes',
  'active',
];

const QUERY_KEYS = new Set(['active']);
const REQUIRED = LIBRARY_FIELDS.filter((key) => key !== 'notes' && key !== 'active');

function assertBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CatalogError(400, 'Expected a JSON object');
  }
}

function rejectUnknown(body) {
  const extra = Object.keys(body).find((key) => !LIBRARY_FIELDS.includes(key));
  if (extra) throw new CatalogError(400, `Unknown field: ${extra}`);
}

async function assertGradeFree(Model, grade, exceptId) {
  const clash = await Model.findOne({ grade });
  if (clash && String(clash._id) !== String(exceptId || '')) {
    throw new CatalogError(400, 'A library resin with that grade already exists');
  }
}

export async function ensureMoldingResinSeed(Model) {
  for (const row of MOLDING_RESIN_SEED) {
    const existing = await Model.findOne({ grade: row.grade });
    if (existing) continue;
    try {
      const doc = new Model({
        ...row,
        notes: MOLDING_RESIN_SEED_NOTE,
        active: true,
      });
      await doc.save();
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
}

export async function listMoldingResins(Model, query) {
  const source = query || {};
  const extra = Object.keys(source).find((key) => !QUERY_KEYS.has(key));
  if (extra) throw new CatalogError(400, `Unknown field: ${extra}`);
  await ensureMoldingResinSeed(Model);
  const filter = {};
  if (source.active === 'true') filter.active = true;
  else if (source.active === 'false') filter.active = false;
  else if (source.active != null && source.active !== '') {
    throw new CatalogError(400, 'active must be true or false');
  }
  return Model.find(filter).sort({ grade: 1 });
}

export async function createMoldingResin(Model, body) {
  assertBody(body);
  rejectUnknown(body);
  const missing = REQUIRED.find((key) => !Object.prototype.hasOwnProperty.call(body, key));
  if (missing) throw new CatalogError(400, `${missing} is required`);
  const grade = typeof body.grade === 'string' ? body.grade.trim() : body.grade;
  if (typeof grade === 'string') await assertGradeFree(Model, grade);
  const doc = new Model({ ...body, grade });
  await doc.save();
  return doc;
}

export async function updateMoldingResin(Model, id, body) {
  assertObjectId(id);
  assertBody(body);
  rejectUnknown(body);
  const data = {};
  for (const key of LIBRARY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) data[key] = body[key];
  }
  if (!Object.keys(data).length) throw new CatalogError(400, 'No fields to update');
  const doc = await Model.findById(id);
  if (!doc) throw new CatalogError(404, 'Not found');
  if (typeof data.grade === 'string') {
    data.grade = data.grade.trim();
    await assertGradeFree(Model, data.grade, doc._id);
  }
  Object.assign(doc, data);
  await doc.save();
  return doc;
}
