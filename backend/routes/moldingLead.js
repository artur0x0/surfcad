/**
 * POST /api/molding/leads. Signed-in only. Creates a molding_leads row.
 * Does not call Stripe, does not charge the review fee, and does not email
 * the partner. A firm quote reveals that one partner. A human review does not.
 */

import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingLead from '../db/models/MoldingLead.js';
import { createMoldingLead, leadView, readLeadRequest } from '../services/moldingLead.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';

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
      return res.status(201).json(leadView(result.lead, result.partner));
    },
  );
  return router;
}

export default createMoldingLeadRouter();
