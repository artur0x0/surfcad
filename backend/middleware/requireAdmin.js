// middleware/requireAdmin.js — ADMIN_USER_IDS allowlist (404 when not allowed)
import config from '../config/index.js';
import { isUserInAdminAllowlist } from '../services/adminAllowlist.js';

export { parseAdminUserIds, isUserInAdminAllowlist } from '../services/adminAllowlist.js';

export function isAdminUser(user) {
  return isUserInAdminAllowlist(user, config.adminUserIds);
}

/**
 * Hide admin routes when the allowlist is empty or the caller is not listed.
 */
export function requireAdmin(req, res, next) {
  if (!req.isAuthenticated?.() || !isAdminUser(req.user)) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}
