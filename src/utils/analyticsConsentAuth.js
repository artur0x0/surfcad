/**
 * Attach the tab's analytics consent to auth requests so the server can
 * emit signed_up / logged_in only when allowed. Unknown (omitted) → skip.
 */

import { getAnalyticsConsent, isGpcActive } from './consent.js';

/** Current tab consent as a JSON boolean (GPC is always false). */
export function analyticsConsentField() {
  if (isGpcActive()) return false;
  return getAnalyticsConsent();
}

/** Merge `analyticsConsent` onto a POST body. */
export function withAnalyticsConsent(body = {}) {
  return { ...body, analyticsConsent: analyticsConsentField() };
}

/**
 * `/api/auth/{google|apple}` start URL with returnTo + consent query.
 * @param {string} provider
 * @param {string} [returnTo]
 */
export function oauthStartPath(provider, returnTo = '') {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  params.set('analyticsConsent', analyticsConsentField() ? 'true' : 'false');
  return `/api/auth/${provider}?${params.toString()}`;
}
