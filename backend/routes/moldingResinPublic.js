// GET /api/molding/resin-library. Generic properties only. No auth, no write.
import { Router } from 'express';
import MoldingResin from '../db/models/MoldingResin.js';
import { listPublicMoldingResins } from '../services/moldingResinLibrary.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';

const LIBRARY_RATE = 'Too many resin library reads. Try again in a few minutes.';

export function createMoldingResinPublicRouter(deps = {}) {
  const limiter = deps.limiter || createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });
  const Model = deps.Model || MoldingResin;
  const list = deps.listPublicMoldingResins || listPublicMoldingResins;
  const router = Router();
  router.get(
    '/resin-library',
    rateLimitMiddleware(limiter, userKey, LIBRARY_RATE),
    async (req, res) => {
      const extra = Object.keys(req.query || {}).find((key) => key !== '');
      if (extra) return res.status(400).json({ error: `Unknown field: ${extra}` });
      try {
        const body = await list(Model);
        return res.json({ heuristic: true, source: body.source, resins: body.resins });
      } catch {
        console.error('[Molding] resin library did not load');
        return res.status(500).json({ error: 'Could not load the resin library' });
      }
    },
  );
  return router;
}

export default createMoldingResinPublicRouter();
