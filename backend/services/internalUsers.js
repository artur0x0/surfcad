/**
 * Internal analytics traffic: POSTHOG_INTERNAL_USERS (comma-separated GitHub
 * logins and/or emails) plus every admin in ADMIN_GITHUB_LOGINS. Default
 * empty. Never hard-code a real list.
 */
import { parseAdminGithubLogins } from './adminAllowlist.js';

/**
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
export function parseInternalUsers(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Union of the explicit internal list and the admin allowlist, so an admin is
 * internal without being listed twice.
 * @param {{ POSTHOG_INTERNAL_USERS?: string, ADMIN_GITHUB_LOGINS?: string }} env
 * @returns {Set<string>}
 */
export function internalUsersFromEnv(env = {}) {
  return new Set([
    ...parseInternalUsers(env.POSTHOG_INTERNAL_USERS),
    ...parseAdminGithubLogins(env.ADMIN_GITHUB_LOGINS),
  ]);
}

/**
 * @param {{ email?: string, githubLogin?: string } | null | undefined} user
 * @param {Set<string> | undefined} list
 */
export function isInternalUser(user, list) {
  if (!list || list.size === 0 || !user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  const login = String(user.githubLogin || '').trim().toLowerCase();
  if (email && list.has(email)) return true;
  if (login && list.has(login)) return true;
  return false;
}
