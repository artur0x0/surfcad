// services/adminAllowlist.js — pure ADMIN_USER_IDS helpers (no config / dotenv)

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

/**
 * @param {{ _id?: unknown } | null | undefined} user
 * @param {Set<string> | undefined} adminUserIds
 */
export function isUserInAdminAllowlist(user, adminUserIds) {
  if (!adminUserIds || adminUserIds.size === 0) return false;
  if (!user?._id) return false;
  return adminUserIds.has(String(user._id));
}
