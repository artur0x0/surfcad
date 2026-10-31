/**
 * A signed-in user asks one anonymized partner for a firm quote or a
 * human review. Firm quote reveals that partner's display name. Human
 * review records the lead and leaves the name hidden until the fee is paid.
 * This module does not call Stripe and does not email the partner.
 */

import { MOLDING_LEAD_TYPES } from '../db/models/MoldingLead.js';
import { reviewFeeUsdFromEnv } from './reviewFeeEnv.js';

const TOP_KEYS = new Set(['type', 'anonLabel', 'snapshot']);
const SNAPSHOT_KEYS = new Set([
  'quantity',
  'cavityCount',
  'grade',
  'region',
  'machineCount',
  'aluminumUsd',
  'steelUsd',
  'steelCheaperAt',
  'range',
  'disclaimer',
]);
const RANGE_KEYS = new Set(['lowUsd', 'highUsd']);

function bad(message) {
  return { error: { code: 'bad_args', message } };
}

function extraKey(value, allowed) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).find((key) => !allowed.has(key)) || null;
}

function money(value, name) {
  if (value == null || value === '') return bad(`${name} must be a number`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return bad(`${name} must be 0 or greater`);
  return n;
}

export function readLeadRequest(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('lead body must be an object');
  }
  const extra = extraKey(body, TOP_KEYS);
  if (extra) return bad(`unknown field ${extra}`);
  if (!MOLDING_LEAD_TYPES.includes(body.type)) {
    return bad('type must be firm_quote or human_review');
  }
  if (typeof body.anonLabel !== 'string' || !body.anonLabel.trim() || body.anonLabel.length > 64) {
    return bad('anonLabel must be the public label from the quote');
  }
  let snapshot = null;
  if (body.snapshot != null) {
    if (typeof body.snapshot !== 'object' || Array.isArray(body.snapshot)) {
      return bad('snapshot must be an object');
    }
    const extraSnap = extraKey(body.snapshot, SNAPSHOT_KEYS);
    if (extraSnap) return bad(`unknown field ${extraSnap}`);
    snapshot = {};
    for (const key of ['aluminumUsd', 'steelUsd']) {
      if (body.snapshot[key] != null) {
        const n = money(body.snapshot[key], key);
        if (n?.error) return n;
        snapshot[key] = n;
      }
    }
    if (body.snapshot.steelCheaperAt != null) {
      const n = Number(body.snapshot.steelCheaperAt);
      if (!Number.isInteger(n) || n < 1) return bad('steelCheaperAt must be an integer from 1');
      snapshot.steelCheaperAt = n;
    }
    if (body.snapshot.range != null) {
      const range = body.snapshot.range;
      if (typeof range !== 'object' || Array.isArray(range)) return bad('range must be an object');
      const extraRange = extraKey(range, RANGE_KEYS);
      if (extraRange) return bad(`unknown field ${extraRange}`);
      const low = money(range.lowUsd, 'lowUsd');
      if (low?.error) return low;
      const high = money(range.highUsd, 'highUsd');
      if (high?.error) return high;
      snapshot.range = { lowUsd: low, highUsd: high };
    }
    if (body.snapshot.quantity != null) snapshot.quantity = body.snapshot.quantity;
    if (body.snapshot.cavityCount != null) snapshot.cavityCount = body.snapshot.cavityCount;
    if (typeof body.snapshot.grade === 'string') snapshot.grade = body.snapshot.grade.slice(0, 120);
    if (typeof body.snapshot.region === 'string') snapshot.region = body.snapshot.region.slice(0, 80);
    if (body.snapshot.machineCount != null) snapshot.machineCount = body.snapshot.machineCount;
    if (typeof body.snapshot.disclaimer === 'string') snapshot.disclaimer = body.snapshot.disclaimer.slice(0, 200);
  }
  return { type: body.type, anonLabel: body.anonLabel.trim(), snapshot };
}

export function leadView(lead, partner) {
  const revealed = lead.type === 'firm_quote' || lead.reviewFeePaid === true;
  const view = {
    leadId: String(lead._id ?? lead.id),
    type: lead.type,
    status: lead.status,
    anonLabel: partner.anonLabel,
    revealed,
    reviewFeeUsd: reviewFeeUsdFromEnv(),
    reviewFeePaid: lead.reviewFeePaid === true,
  };
  if (revealed) view.displayName = partner.displayName;
  return view;
}

export async function createMoldingLead(models, userId, input) {
  const partner = await models.MoldingPartner.findOne({ anonLabel: input.anonLabel, active: true });
  if (!partner) {
    return { error: { code: 'unknown_partner', message: 'No active partner uses that label' }, status: 404 };
  }
  const partnerId = partner._id ?? partner.id;
  const existing = await models.MoldingLead.findOne({ userId, partnerId, type: input.type });
  if (existing) {
    if (input.snapshot) {
      existing.budgetaryQuoteSnapshot = input.snapshot;
      await existing.save();
    }
    return { lead: existing, partner };
  }
  const lead = await models.MoldingLead.create({
    userId,
    partnerId,
    type: input.type,
    status: 'sent',
    commissionOwedUsd: 0,
    budgetaryQuoteSnapshot: input.snapshot,
    stripePaymentIntentId: '',
    reviewFeePaid: false,
  });
  return { lead, partner };
}
