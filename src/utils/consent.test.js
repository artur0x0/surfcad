import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  CONSENT_STORAGE_KEY,
  applyGpcDefaultOnFirstVisit,
  applyServerConsent,
  configureConsentStorage,
  configureConsentNavigator,
  getAnalyticsConsent,
  hasStoredConsentChoice,
  onConsentChange,
  readStoredRecord,
  setAnalyticsConsent,
  isGpcActive,
} from './consent.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('consent', () => {
  let storage;

  beforeEach(() => {
    storage = memoryStorage();
    configureConsentStorage(storage);
    configureConsentNavigator({});
  });

  test('defaults analytics on when storage is empty', () => {
    assert.equal(getAnalyticsConsent(), true);
    assert.equal(readStoredRecord().analytics, true);
    assert.equal(hasStoredConsentChoice(), false);
  });

  test('explicit choice persists until cleared', () => {
    setAnalyticsConsent(false);
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(getAnalyticsConsent(), false);
    setAnalyticsConsent(true);
    assert.equal(getAnalyticsConsent(), true);
    assert.equal(hasStoredConsentChoice(), true);
  });

  test('GPC persists opt-out default on first visit', () => {
    configureConsentNavigator({ globalPrivacyControl: true });
    assert.equal(applyGpcDefaultOnFirstVisit(), true);
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(getAnalyticsConsent(), false);
  });

  test('GPC forces analytics off and blocks opt-in', () => {
    assert.equal(isGpcActive({ globalPrivacyControl: true }), true);
    configureConsentNavigator({ globalPrivacyControl: true });
    assert.equal(getAnalyticsConsent(), false);
    setAnalyticsConsent(true);
    assert.equal(getAnalyticsConsent(), false);
    setAnalyticsConsent(false);
    assert.equal(getAnalyticsConsent(), false);
  });

  test('persists opt-out in localStorage', () => {
    setAnalyticsConsent(false);
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    assert.ok(raw);
    assert.equal(getAnalyticsConsent(), false);
    setAnalyticsConsent(true);
    assert.equal(getAnalyticsConsent(), true);
  });

  test('notifies listeners on change', () => {
    const seen = [];
    const off = onConsentChange((v) => seen.push(v));
    setAnalyticsConsent(false);
    setAnalyticsConsent(true);
    off();
    assert.deepEqual(seen, [false, true]);
  });

  test('server sync applies when newer than local', () => {
    setAnalyticsConsent(true);
    const local = JSON.parse(storage.getItem(CONSENT_STORAGE_KEY));
    const older = new Date(Date.parse(local.updatedAt) - 60_000).toISOString();
    assert.equal(
      applyServerConsent({ analytics: false, updatedAt: older }),
      false,
    );
    const newer = new Date(Date.parse(local.updatedAt) + 60_000).toISOString();
    assert.equal(
      applyServerConsent({ analytics: false, updatedAt: newer }),
      true,
    );
    assert.equal(getAnalyticsConsent(), false);
  });
});
