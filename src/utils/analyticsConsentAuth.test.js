import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  analyticsConsentField,
  oauthStartPath,
  withAnalyticsConsent,
} from './analyticsConsentAuth.js';
import {
  configureConsentNavigator,
  configureConsentStorage,
  setAnalyticsConsent,
} from './consent.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('analyticsConsentAuth', () => {
  beforeEach(() => {
    configureConsentStorage(memoryStorage());
    configureConsentNavigator({});
    setAnalyticsConsent(true);
  });

  test('withAnalyticsConsent attaches the tab preference', () => {
    assert.deepEqual(withAnalyticsConsent({ email: 'a@b.c' }), {
      email: 'a@b.c',
      analyticsConsent: true,
    });
    setAnalyticsConsent(false);
    assert.equal(withAnalyticsConsent().analyticsConsent, false);
  });

  test('GPC forces false on OAuth start URLs', () => {
    configureConsentNavigator({ globalPrivacyControl: true });
    assert.equal(analyticsConsentField(), false);
    const url = oauthStartPath('google', '/cad');
    assert.match(url, /\/api\/auth\/google\?/);
    assert.match(url, /analyticsConsent=false/);
    assert.match(url, /returnTo=%2Fcad/);
  });
});
