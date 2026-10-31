// routes/admin.js — operator-only reporting
import { Router } from 'express';
import { requireAdmin as defaultRequireAdmin } from '../middleware/requireAdmin.js';
import { fetchAdminStats as defaultFetchAdminStats, parseAdminStatsDays } from '../services/adminStats.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';
import { createMoldingAdminRouter } from './moldingAdmin.js';

export const ADMIN_STATS_RATE = 'Too many requests. Try again in a few minutes.';

/**
 * @param {{
 *   requireAdmin?: typeof defaultRequireAdmin,
 *   fetchAdminStats?: typeof defaultFetchAdminStats,
 *   limiter?: ReturnType<typeof createRateLimiter>,
 *   moldingModels?: Parameters<typeof createMoldingAdminRouter>[0],
 * }} [deps]
 */
export function createAdminRouter(deps = {}) {
  const adminGate = deps.requireAdmin || defaultRequireAdmin;
  const getStats = deps.fetchAdminStats || defaultFetchAdminStats;
  const limiter = deps.limiter || createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

  const router = Router();

  router.use(
    '/molding',
    adminGate,
    rateLimitMiddleware(limiter, userKey, ADMIN_STATS_RATE),
    createMoldingAdminRouter(deps.moldingModels),
  );

  /**
   * GET /api/admin/stats?days=7|30|120
   * Signed-in GitHub login must be in ADMIN_GITHUB_LOGINS. Returns 404 otherwise
   * (including signed-out), so the route is not discoverable. Other days → 400.
   */
  router.get(
    '/stats',
    adminGate,
    rateLimitMiddleware(limiter, userKey, ADMIN_STATS_RATE),
    async (req, res) => {
      const days = parseAdminStatsDays(req.query.days);
      if (days == null) {
        return res.status(400).json({ error: 'days must be 7, 30, or 120' });
      }
      try {
        const stats = await getStats({ days });
        return res.json(stats);
      } catch (error) {
        console.error('[Admin] stats error:', error);
        return res.status(500).json({ error: 'Failed to load stats' });
      }
    },
  );

  return router;
}

const router = createAdminRouter();

export default router;
