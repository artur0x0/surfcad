import { validatePartnerPayload } from './partnerLeads.js';
import { checkPartnerRateLimit } from './partnerRateLimit.js';
import { verifyPartnerTurnstile } from './partnerTurnstile.js';

function clientIp(req) {
  if (req.ip) return req.ip;
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{
 *   PartnerLeadModel?: { create: (doc: object) => Promise<object> },
 *   sendNotification?: (lead: object) => Promise<boolean>,
 *   rateLimit?: typeof checkPartnerRateLimit,
 *   verifyTurnstile?: typeof verifyPartnerTurnstile,
 * }} deps
 */
export async function handlePartnerPost(req, res, deps = {}) {
  const Lead = deps.PartnerLeadModel;
  const rateLimit = deps.rateLimit ?? checkPartnerRateLimit;
  const verifyTurnstile = deps.verifyTurnstile ?? verifyPartnerTurnstile;

  try {
    const validated = validatePartnerPayload(req.body);
    if (!validated.ok) {
      if (validated.honeypot) {
        return res.json({ ok: true });
      }
      return res.status(validated.status).json({ error: validated.error });
    }

    const ip = clientIp(req);
    const turnstile = await verifyTurnstile(
      req.body?.turnstileToken,
      ip,
      deps.turnstileDeps,
    );
    if (!turnstile.ok) {
      return res.status(turnstile.status).json({ error: turnstile.error });
    }
    const limited = rateLimit(ip);
    if (!limited.allowed) {
      return res.status(429).json({
        error: 'Too many submissions. Please try again later.',
        retryAfter: limited.retryAfterSec,
      });
    }

    if (!Lead) {
      throw new Error('PartnerLeadModel is required');
    }

    const doc = await Lead.create({
      ...validated.data,
      ip,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    });

    const notify = deps.sendNotification ?? (async (lead) => {
      const email = (await import('./email.js')).default;
      return email.sendPartnerLeadNotification(lead);
    });
    notify(doc).catch((err) => {
      console.error('[Partners] Failed to send notification email:', err);
    });

    return res.status(201).json({ ok: true, id: String(doc._id) });
  } catch (error) {
    console.error('[Partners] Submit error:', error);
    return res.status(500).json({ error: 'Could not save your submission' });
  }
}
