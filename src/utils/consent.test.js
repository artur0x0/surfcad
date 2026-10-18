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
  shouldShowPrivacyConsentPopup,
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

  test('first visit: no stored choice, analytics off, popup shown', () => {
    assert.equal(hasStoredConsentChoice(), false);
    assert.equal(getAnalyticsConsent(), false);
    assert.equal(readStoredRecord().analytics, false);
    assert.equal(shouldShowPrivacyConsentPopup(), true);
  });

  test('stored Accept all hides the popup and allows analytics', () => {
    setAnalyticsConsent(true);
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(getAnalyticsConsent(), true);
    assert.equal(shouldShowPrivacyConsentPopup(), false);
    assert.equal(readStoredRecord().source, 'user');
  });

  test('stored Required only hides the popup and keeps analytics off', () => {
    setAnalyticsConsent(false);
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(getAnalyticsConsent(), false);
    assert.equal(shouldShowPrivacyConsentPopup(), false);
    assert.equal(readStoredRecord().source, 'user');
  });

  test('GPC on first visit skips popup, stores Required only with source gpc', () => {
    configureConsentNavigator({ globalPrivacyControl: true });
    assert.equal(shouldShowPrivacyConsentPopup(), false);
    assert.equal(applyGpcDefaultOnFirstVisit(), true);
    assert.equal(hasStoredConsentChoice(), true);
    assert.equal(getAnalyticsConsent(), false);
    const rec = readStoredRecord();
    assert.equal(rec.analytics, false);
    assert.equal(rec.source, 'gpc');
    const raw = JSON.parse(storage.getItem(CONSENT_STORAGE_KEY));
    assert.equal(raw.source, 'gpc');
    assert.equal(applyGpcDefaultOnFirstVisit(), false);
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
