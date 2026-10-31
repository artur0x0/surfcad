/**
 * Stripe Checkout for the human-review fee. Hosted Checkout only: this
 * module never sees a card number and never sends email. Creating a session
 * does not mark the lead paid. The webhook does that after Stripe says paid.
 */

import { reviewFeeCents } from './reviewFeeEnv.js';

const PURPOSE = 'molding_review';
const UNAVAILABLE = {
  error: { code: 'review_unavailable', message: 'Human review checkout is not available.' },
  status: 503,
};

function appUrl(raw, flag) {
  if (typeof raw !== 'string' || !/^https?:\/\//.test(raw)) return null;
  try {
    const url = new URL(raw);
    url.searchParams.set('moldReview', flag);
    return url.toString();
  } catch {
    return null;
  }
}

function paymentIntentId(value) {
  if (typeof value === 'string' && value) return value.slice(0, 255);
  if (value && typeof value.id === 'string' && value.id) return value.id.slice(0, 255);
  return '';
}

export async function findHumanReview(models, userId, anonLabel) {
  const partner = await models.MoldingPartner.findOne({ anonLabel, active: true });
  if (!partner) {
    return { error: { code: 'unknown_partner', message: 'No active partner uses that label' }, status: 404 };
  }
  const lead = await models.MoldingLead.findOne({
    userId,
    partnerId: partner._id ?? partner.id,
    type: 'human_review',
  });
  if (!lead) {
    return { error: { code: 'no_lead', message: 'Request a human review first.' }, status: 404 };
  }
  return { lead, partner };
}

export async function startReviewCheckout({
  models,
  userId,
  anonLabel,
  stripeClient,
  feeUsd,
  frontendUrl,
}) {
  if (!(feeUsd >= 0.5) || !stripeClient?.checkout?.sessions?.create) return UNAVAILABLE;
  const successUrl = appUrl(frontendUrl, 'return');
  const cancelUrl = appUrl(frontendUrl, 'cancel');
  if (!successUrl || !cancelUrl) return UNAVAILABLE;

  const found = await findHumanReview(models, userId, anonLabel);
  if (found.error) return found;
  const { lead, partner } = found;
  if (lead.reviewFeePaid === true) return { paid: true, lead, partner };

  const cents = reviewFeeCents(feeUsd);
  const metadata = {
    purpose: PURPOSE,
    leadId: String(lead._id),
    userId: String(userId),
    feeCents: String(cents),
  };
  let session;
  try {
    session = await stripeClient.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: String(lead._id),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: { name: 'Human review' },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
    });
  } catch {
    console.error('[Molding] review checkout did not start');
    return UNAVAILABLE;
  }
  if (typeof session?.url !== 'string' || !session.url.startsWith('https://')) return UNAVAILABLE;
  return {
    url: session.url,
    reviewFeeUsd: feeUsd,
    leadId: String(lead._id),
  };
}

async function markPaid(models, meta, paymentId) {
  const expected = Number(meta.feeCents);
  if (!Number.isInteger(expected) || expected < 50) return { applied: false, reason: 'amount' };
  if (!meta.leadId || !meta.userId) return { applied: false, reason: 'lead' };
  const lead = await models.MoldingLead.findById(meta.leadId);
  if (!lead || String(lead.userId) !== String(meta.userId) || lead.type !== 'human_review') {
    return { applied: false, reason: 'lead' };
  }
  if (lead.reviewFeePaid === true) return { applied: true, already: true };
  lead.reviewFeePaid = true;
  if (paymentId) lead.stripePaymentIntentId = paymentId;
  await lead.save();
  return { applied: true };
}

export async function applyReviewCheckoutSession(models, session) {
  const meta = session?.metadata || {};
  if (meta.purpose !== PURPOSE) return { applied: false, reason: 'ignored' };
  if (session.payment_status !== 'paid') return { applied: false, reason: 'unpaid' };
  const expected = Number(meta.feeCents);
  if (session.amount_total !== expected) return { applied: false, reason: 'amount' };
  const paymentId = paymentIntentId(session.payment_intent) || (session.id ? String(session.id).slice(0, 255) : '');
  return markPaid(models, meta, paymentId);
}

export async function applyReviewPaymentIntent(models, paymentIntent) {
  const meta = paymentIntent?.metadata || {};
  if (meta.purpose !== PURPOSE) return { applied: false, reason: 'ignored' };
  if (paymentIntent.status !== 'succeeded') return { applied: false, reason: 'unpaid' };
  const expected = Number(meta.feeCents);
  if (paymentIntent.amount_received !== expected) return { applied: false, reason: 'amount' };
  return markPaid(models, meta, paymentIntentId(paymentIntent.id));
}
