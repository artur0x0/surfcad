// middleware/requireAdmin.js — ADMIN_GITHUB_LOGINS allowlist (404 when not allowed)
import config from '../config/index.js';
import { isAdmin as userIsAdmin } from '../services/adminAllowlist.js';

export { parseAdminGithubLogins, isAdmin as userHasAdminGithubLogin } from '../services/adminAllowlist.js';

export function isAdmin(user) {
  return userIsAdmin(user, config.adminGithubLogins);
}

/**
 * Hide admin routes when the allowlist is empty or the caller is not listed.
 * 404 (not 403) so the route is not discoverable.
 */
export function requireAdmin(req, res, next) {
  if (!req.isAuthenticated?.() || !isAdmin(req.user)) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}
