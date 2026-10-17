/**
 * Preset analytics consent in browser localStorage before the app boots.
 * Used by goldens, playtests, and smoke scripts — not shipped in production.
 */
/* global localStorage */

export const SURFCAD_CONSENT_STORAGE_KEY = 'surfcad.consent.v1';

export function buildStoredConsentRecord(allow = true) {
  return JSON.stringify({
    analytics: !!allow,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * @param {import('playwright-core').Page | import('playwright-core').BrowserContext} target
 * @param {boolean} [allow]
 */
export async function presetAnalyticsConsentInit(target, allow = true) {
  await target.addInitScript(({ key, record }) => {
    try {
      localStorage.setItem(key, record);
    } catch {
      /* private mode */
    }
  }, { key: SURFCAD_CONSENT_STORAGE_KEY, record: buildStoredConsentRecord(allow) });
}

/**
 * Register on all contexts created after attach (call immediately after chromium.launch).
 * @param {import('playwright-core').Browser} browser
 */
export function attachConsentPresetToBrowser(browser) {
  browser.on('context', (context) => {
    void presetAnalyticsConsentInit(context);
  });
}
