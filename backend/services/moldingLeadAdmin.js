/**
 * Admin list and edit for molding leads. Status and commission only.
 * The view names the partner, not the person who asked. No payout, no Stripe.
 */

import { MOLDING_LEAD_STATUSES } from '../db/models/MoldingLead.js';
import { CatalogError, assertObjectId } from './moldingCatalog.js';

const QUERY_KEYS = new Set(['partnerId', 'status']);
const PATCH_KEYS = ['status', 'commissionOwedUsd'];

function assertBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CatalogError(400, 'Expected a JSON object');
  }
}

function money(value) {
  if (value == null || value === '') {
    throw new CatalogError(400, 'commissionOwedUsd must be a number');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new CatalogError(400, 'commissionOwedUsd must be 0 or greater');
  }
  return Math.round(n * 100) / 100;
}

export function leadAdminView(lead, partner) {
  return {
    _id: String(lead._id),
    partnerId: String(lead.partnerId),
    partnerName: partner?.displayName || '',
    anonLabel: partner?.anonLabel || '',
    type: lead.type,
    status: lead.status,
    commissionOwedUsd: lead.commissionOwedUsd,
    reviewFeePaid: lead.reviewFeePaid === true,
    createdAt: lead.createdAt,
  };
}

function leadFilter(query) {
  const source = query || {};
  const extra = Object.keys(source).find((key) => !QUERY_KEYS.has(key));
  if (extra) throw new CatalogError(400, `Unknown field: ${extra}`);
  const filter = {};
  if (source.partnerId != null && source.partnerId !== '') {
    assertObjectId(String(source.partnerId), 'Invalid partner id');
    filter.partnerId = String(source.partnerId);
  }
  if (source.status != null && source.status !== '') {
    if (!MOLDING_LEAD_STATUSES.includes(source.status)) {
      throw new CatalogError(400, 'status must be sent, quoted, won, or lost');
    }
    filter.status = source.status;
  }
  return filter;
}

export async function listMoldingLeads(models, query) {
  const filter = leadFilter(query);
  const leads = await models.leads.find(filter).sort({ createdAt: -1 });
  const ids = [...new Set(leads.map((lead) => String(lead.partnerId)))];
  const partners = ids.length
    ? await models.partners.find({ _id: { $in: ids } })
    : [];
  const byId = new Map(partners.map((partner) => [String(partner._id), partner]));
  return leads.map((lead) => leadAdminView(lead, byId.get(String(lead.partnerId))));
}

export async function updateMoldingLead(models, id, body) {
  assertObjectId(id, 'Invalid lead id');
  assertBody(body);
  const extra = Object.keys(body).find((key) => !PATCH_KEYS.includes(key));
  if (extra) throw new CatalogError(400, `Unknown field: ${extra}`);
  const data = {};
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!MOLDING_LEAD_STATUSES.includes(body.status)) {
      throw new CatalogError(400, 'status must be sent, quoted, won, or lost');
    }
    data.status = body.status;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'commissionOwedUsd')) {
    data.commissionOwedUsd = money(body.commissionOwedUsd);
  }
  if (!Object.keys(data).length) throw new CatalogError(400, 'No fields to update');
  const doc = await models.leads.findById(id);
  if (!doc) throw new CatalogError(404, 'Not found');
  Object.assign(doc, data);
  await doc.save();
  const partner = await models.partners.findById(String(doc.partnerId));
  return leadAdminView(doc, partner);
}
