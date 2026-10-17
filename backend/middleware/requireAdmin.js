// middleware/requireAdmin.js — ADMIN_USER_IDS allowlist (404 when not allowed)
import config from '../config/index.js';

/**
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
export function parseAdminUserIds(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function isAdminUser(user) {
  const allow = config.adminUserIds;
  if (!allow || allow.size === 0) return false;
  if (!user?._id) return false;
  return allow.has(String(user._id));
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
