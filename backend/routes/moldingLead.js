/**
 * POST /api/molding/leads creates a molding_leads row. It does not call
 * Stripe and does not email the partner. It does not reveal the partner.
 * A name is returned only when this user owns a human-review lead for that
 * partner and the webhook has marked the fee paid.
 * POST /api/molding/review-checkout opens Stripe Checkout for the review
 * fee. It does not mark the lead paid and does not send email.
 * GET /api/molding/review-status reads that webhook flag. A return URL
 * is not a payment.
 */

import { Router } from 'express';
import Stripe from 'stripe';
import { requireAuth } from '../auth/session.js';
import config from '../config/index.js';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingLead from '../db/models/MoldingLead.js';
import { createMoldingLead, presentLead, readLeadRequest } from '../services/moldingLead.js';
import { findHumanReview, startReviewCheckout } from '../services/moldingReviewCheckout.js';
import { reviewCheckoutKeyAllowed, reviewFeeUsdFromEnv } from '../services/reviewFeeEnv.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';

let reviewStripe = null;

function reviewStripeClient(deps) {
  if (deps.stripeClient) return deps.stripeClient;
  const key = config.stripe.secretKey;
  if (!reviewCheckoutKeyAllowed(key)) return null;
  if (!reviewStripe) reviewStripe = new Stripe(key, { apiVersion: '2023-10-16' });
  return reviewStripe;
}

const LEAD_RATE = 'Too many molding requests. Try again in a few minutes.';

/**
 * @param {{
 *   limiter?: ReturnType<typeof createRateLimiter>,
 *   requireAuth?: Function,
 *   models?: object,
 * }} [deps]
 */
export function createMoldingLeadRouter(deps = {}) {
  const limiter = deps.limiter || createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });
  const auth = deps.requireAuth || requireAuth;
  const models = deps.models || { MoldingPartner, MoldingLead };
  const router = Router();
  router.post(
    '/leads',
    auth,
    rateLimitMiddleware(limiter, userKey, LEAD_RATE),
    async (req, res) => {
      const userId = req.user?._id ?? req.user?.id;
      if (!userId) return res.status(401).json({ error: { code: 'sign_in', message: 'Sign in to request this.' } });
      const input = readLeadRequest(req.body);
      if (input.error) return res.status(400).json(input);
      const result = await createMoldingLead(models, userId, input);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      return res.status(201).json(await presentLead(models, userId, result.lead, result.partner));
    },
  );

  router.post(
    '/review-checkout',
    auth,
    rateLimitMiddleware(limiter, userKey, LEAD_RATE),
    async (req, res) => {
      const userId = req.user?._id ?? req.user?.id;
      if (!userId) return res.status(401).json({ error: { code: 'sign_in', message: 'Sign in to request this.' } });
      const input = readAnonLabel(req.body);
      if (input.error) return res.status(400).json(input);
      const feeUsd = Object.prototype.hasOwnProperty.call(deps, 'feeUsd') ? deps.feeUsd : reviewFeeUsdFromEnv();
      const result = await startReviewCheckout({
        models,
        userId,
        anonLabel: input.anonLabel,
        stripeClient: reviewStripeClient(deps),
        feeUsd,
        frontendUrl: deps.frontendUrl || config.frontendUrl,
      });
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      if (result.paid) return res.status(200).json(await presentLead(models, userId, result.lead, result.partner));
      return res.status(200).json({
        url: result.url,
        reviewFeeUsd: result.reviewFeeUsd,
        reviewFeePaid: false,
        revealed: false,
        anonLabel: input.anonLabel,
        leadId: result.leadId,
      });
    },
  );

  router.get(
    '/review-status',
    auth,
    rateLimitMiddleware(limiter, userKey, LEAD_RATE),
    async (req, res) => {
      const userId = req.user?._id ?? req.user?.id;
      if (!userId) return res.status(401).json({ error: { code: 'sign_in', message: 'Sign in to request this.' } });
      const input = readAnonLabel(req.query);
      if (input.error) return res.status(400).json(input);
      const found = await findHumanReview(models, userId, input.anonLabel);
      if (found.error) return res.status(found.status || 400).json({ error: found.error });
      return res.status(200).json(await presentLead(models, userId, found.lead, found.partner));
    },
  );

  return router;
}

function readAnonLabel(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { code: 'bad_args', message: 'anonLabel must be the public label from the quote' } };
  }
  const extra = Object.keys(body).find((key) => key !== 'anonLabel');
  if (extra) return { error: { code: 'bad_args', message: `unknown field ${extra}` } };
  if (typeof body.anonLabel !== 'string' || !body.anonLabel.trim() || body.anonLabel.length > 64) {
    return { error: { code: 'bad_args', message: 'anonLabel must be the public label from the quote' } };
  }
  return { anonLabel: body.anonLabel.trim() };
}

export default createMoldingLeadRouter();
