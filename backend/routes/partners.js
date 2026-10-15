// routes/partners.js — public partner interest form
import { Router } from 'express';
import PartnerLead from '../db/models/PartnerLead.js';
import { handlePartnerPost } from '../services/partnerSubmit.js';

/**
 * @param {{
 *   PartnerLeadModel?: typeof PartnerLead,
 *   sendNotification?: (lead: object) => Promise<boolean>,
 *   rateLimit?: import('../services/partnerRateLimit.js').checkPartnerRateLimit,
 * }} [deps]
 */
export function createPartnersRouter(deps = {}) {
  const router = Router();
  const merged = {
    PartnerLeadModel: deps.PartnerLeadModel ?? PartnerLead,
    sendNotification: deps.sendNotification,
    rateLimit: deps.rateLimit,
  };
  router.post('/', (req, res) => handlePartnerPost(req, res, merged));
  return router;
}

export { handlePartnerPost } from '../services/partnerSubmit.js';

const router = createPartnersRouter();

export default router;
