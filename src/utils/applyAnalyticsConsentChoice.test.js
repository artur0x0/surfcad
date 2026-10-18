import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { applyAnalyticsConsentChoice } from './applyAnalyticsConsentChoice.js';
import {
  configureConsentNavigator,
  configureConsentStorage,
  getAnalyticsConsent,
  hasStoredConsentChoice,
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

  test('defaults analytics off until the user accepts', async () => {
    assert.equal(getAnalyticsConsent(), false);
    assert.equal(hasStoredConsentChoice(), false);

    await applyAnalyticsConsentChoice(true, { isAuthenticated: false });
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(getAnalyticsConsent(), true);
  });

  test('privacy choices can flip preference back on', async () => {
    await applyAnalyticsConsentChoice(false, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), false);
    await applyAnalyticsConsentChoice(true, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), true);
  });

  test('GPC keeps analytics off even when opting in', async () => {
    configureConsentNavigator({ globalPrivacyControl: true });
    await applyAnalyticsConsentChoice(true, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), false);
    await applyAnalyticsConsentChoice(false, { isAuthenticated: false });
    assert.equal(getAnalyticsConsent(), false);
  });
});
