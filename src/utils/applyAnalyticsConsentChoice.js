import { setAnalyticsConsent } from './consent.js';
import { persistConsentToServer } from './consentApi.js';
import { shutdownAnalyticsCapturing, syncAnalyticsConsent } from './analytics.js';

/**
 * Persist analytics preference locally, sync PostHog, and optionally the signed-in server.
 * @param {boolean} allow
 * @param {{ isAuthenticated?: boolean }} [opts]
 */
export async function applyAnalyticsConsentChoice(allow, { isAuthenticated = false } = {}) {
  const record = setAnalyticsConsent(allow);
  if (!record.analytics) {
    shutdownAnalyticsCapturing();
  } else {
    syncAnalyticsConsent();
  }
  if (isAuthenticated) {
    await persistConsentToServer(record.analytics);
  }
  return record;
}
