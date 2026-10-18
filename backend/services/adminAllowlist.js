// services/adminAllowlist.js — pure ADMIN_GITHUB_LOGINS helpers (no config / dotenv)

/**
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
export function parseAdminGithubLogins(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Operator gate: GitHub login must appear in ADMIN_GITHUB_LOGINS.
 * Empty allowlist → no admins. Comparison is case-insensitive.
 *
 * @param {{ githubLogin?: unknown } | null | undefined} user
 * @param {Set<string> | undefined} adminGithubLogins
 */
export function isAdmin(user, adminGithubLogins) {
  if (!adminGithubLogins || adminGithubLogins.size === 0) return false;
  const login = String(user?.githubLogin || '').trim().toLowerCase();
  if (!login) return false;
  return adminGithubLogins.has(login);
}
