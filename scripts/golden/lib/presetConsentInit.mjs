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

const PRESET_READY = Symbol('surfcadConsentPresetReady');

/**
 * Register on all contexts created after attach (call immediately after launch).
 * Awaits the init script on `newContext` so `browser.newPage()` cannot load
 * the app before `surfcad.consent.v1` is set (otherwise the first-visit popup
 * covers goldens).
 * @param {import('playwright-core').Browser} browser
 */
export function attachConsentPresetToBrowser(browser) {
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async function patchedNewContext(...args) {
    const context = await origNewContext(...args);
    await presetContext(context);
    return context;
  };

  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async function patchedBrowserNewPage(...args) {
    const page = await origNewPage(...args);
    await presetContext(page.context());
    return page;
  };

  browser.on('context', (context) => {
    const ready = presetContext(context);
    const origContextNewPage = context.newPage.bind(context);
    context.newPage = async function patchedContextNewPage(...args) {
      await ready;
      return origContextNewPage(...args);
    };
  });
}

function presetContext(context) {
  if (context[PRESET_READY]) return context[PRESET_READY];
  context[PRESET_READY] = presetAnalyticsConsentInit(context);
  return context[PRESET_READY];
}
