import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { applyAnalyticsConsentChoice } from './applyAnalyticsConsentChoice.js';
import {
  configureConsentNavigator,
  configureConsentStorage,
  getAnalyticsConsent,
  hasStoredConsentChoice,
  shouldShowCookieConsentBanner,
} from './consent.js';
import { resetAnalyticsForTests } from './analytics.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('applyAnalyticsConsentChoice', () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    configureConsentStorage(memoryStorage());
    configureConsentNavigator({});
  });

  test('allow all and only required dismiss the first-visit banner', async () => {
    assert.equal(shouldShowCookieConsentBanner(), true);
    await applyAnalyticsConsentChoice(true, { isAuthenticated: false });
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(shouldShowCookieConsentBanner(), false);
    assert.equal(getAnalyticsConsent(), true);

    configureConsentStorage(memoryStorage());
    assert.equal(shouldShowCookieConsentBanner(), true);
    await applyAnalyticsConsentChoice(false, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), false);
    assert.equal(shouldShowCookieConsentBanner(), false);
  });

  test('reopen via settings can flip preference', async () => {
    await applyAnalyticsConsentChoice(false, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), false);
    await applyAnalyticsConsentChoice(true, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), true);
  });
});
