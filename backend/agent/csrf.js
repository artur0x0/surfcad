import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isAllowedBrowserOrigin } from './origins.js';

const CSRF_BYTES = 32;

/**
 * One token per session. A second tab of the same session shares it, so
 * rendering the form again does not invalidate a form that is already open.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function ensureCsrfToken(req) {
  const session = req.session;
  if (!session || typeof session !== 'object') return '';
  const current = session.agentCsrf;
  if (typeof current === 'string' && current.length >= CSRF_BYTES) return current;
  session.agentCsrf = randomBytes(CSRF_BYTES).toString('base64url');
  return session.agentCsrf;
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function csrfTokenMatches(req) {
  const expected = req.session?.agentCsrf;
  const given = req.body?.csrf;
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof given !== 'string' || given.length === 0 || given.length > 128) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isApprovalFormPost(req) {
  return Boolean(req.is('application/x-www-form-urlencoded') || req.is('multipart/form-data'));
}

/**
 * A browser approval POST must come from the relay's origin allowlist.
 * `Sec-Fetch-Site: cross-site` is rejected even when Origin is missing.
 * Non-browser clients omit both headers; the form token still covers those posts.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function approvalFetchAllowed(req) {
  const origin = req.get('origin');
  if (origin && !isAllowedBrowserOrigin(origin)) return false;
  const site = req.get('sec-fetch-site');
  if (!site) return true;
  const value = site.trim().toLowerCase();
  return value === 'same-origin' || value === 'same-site' || value === 'none';
}

/**
 * @param {import('express').Request} req
 * @returns {'ok' | 'csrf' | 'cross_origin'}
 */
export function checkApprovalPost(req) {
  if (!approvalFetchAllowed(req)) return 'cross_origin';
  if (isApprovalFormPost(req) && !csrfTokenMatches(req)) return 'csrf';
  return 'ok';
}
