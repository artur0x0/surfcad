// routes/admin.js — operator-only reporting
import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { fetchAdminStats } from '../services/adminStats.js';

const router = Router();

/**
 * GET /api/admin/stats
 * Signed-in user must be in ADMIN_USER_IDS. Returns 404 otherwise.
 */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await fetchAdminStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Admin] stats error:', error);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
