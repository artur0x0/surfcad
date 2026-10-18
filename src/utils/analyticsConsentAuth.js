/**
 * Attach the tab's analytics consent to auth requests so the server can
 * emit signed_up / logged_in only when allowed. Unknown (omitted) → skip.
 */

import {
  getAnalyticsConsent,
  hasStoredConsentChoice,
  isGpcActive,
} from './consent.js';

/**
 * Tab consent for auth requests.
 * `undefined` = no stored choice yet (skip server capture unless Mongo has one).
 * GPC is always false.
 */
export function analyticsConsentField() {
  if (isGpcActive()) return false;
  if (!hasStoredConsentChoice()) return undefined;
  return getAnalyticsConsent();
}

/** Merge `analyticsConsent` onto a POST body. Omits the field when unknown. */
export function withAnalyticsConsent(body = {}) {
  const analyticsConsent = analyticsConsentField();
  if (analyticsConsent === undefined) return { ...body };
  return { ...body, analyticsConsent };
}

/**
 * `/api/auth/{google|apple}` start URL with returnTo + consent query.
 * @param {string} provider
 * @param {string} [returnTo]
 */
export function oauthStartPath(provider, returnTo = '') {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  const analyticsConsent = analyticsConsentField();
  if (analyticsConsent !== undefined) {
    params.set('analyticsConsent', analyticsConsent ? 'true' : 'false');
  }
  const qs = params.toString();
  return qs ? `/api/auth/${provider}?${qs}` : `/api/auth/${provider}`;
}
