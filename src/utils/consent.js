/**
 * Product usage analytics consent.
 *
 * PostHog and similar tools must call getAnalyticsConsent() before sending events.
 * Nothing optional loads until the user has a stored choice (Accept all) or GPC
 * has been recorded as Required only. Error reporting (e.g. Sentry) is essential
 * operational telemetry and is NOT gated by this toggle.
 */

export const CONSENT_STORAGE_KEY = 'surfcad.consent.v1';

export { openPrivacyChoices } from './privacyChoicesUi.js';

const listeners = new Set();

let storage = typeof localStorage !== 'undefined' ? localStorage : null;
let navigatorRef = typeof navigator !== 'undefined' ? navigator : {};

/** Test hook: inject a Map-like localStorage. */
export function configureConsentStorage(next) {
  storage = next;
}

/** Test hook: inject navigator (for GPC). */
export function configureConsentNavigator(nav) {
  navigatorRef = nav ?? {};
}

export function isGpcActive(nav = navigatorRef) {
  return nav.globalPrivacyControl === true;
}

/** Whether the user has made an explicit analytics choice (privacy choices or prior opt-out). */
export function hasStoredConsentChoice() {
  const raw = readRaw();
  return raw != null && typeof raw.analytics === 'boolean';
}

/** First visit with no stored choice: show the privacy consent popup (not when GPC applies). */
export function shouldShowPrivacyConsentPopup(nav = navigatorRef) {
  if (isGpcActive(nav)) return false;
  return !hasStoredConsentChoice();
}

/**
 * GPC on first visit: treat as Required only, persist with source `gpc`, no popup.
 * @returns {boolean} whether a default was written
 */
export function applyGpcDefaultOnFirstVisit(nav = navigatorRef) {
  if (!isGpcActive(nav)) return false;
  if (hasStoredConsentChoice()) return false;
  setAnalyticsConsent(false, { source: 'gpc' });
  return true;
}

function readRaw() {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(analytics, updatedAt, source) {
  const payload = {
    analytics: !!analytics,
    updatedAt: updatedAt || new Date().toISOString(),
  };
  if (source) payload.source = String(source);
  if (storage) {
    try {
      storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota / private mode */
    }
  }
  notifyListeners();
  return payload;
}

function notifyListeners() {
  const value = getAnalyticsConsent();
  for (const cb of listeners) {
    try {
      cb(value);
    } catch {
      /* listener */
    }
  }
}

export function consentTimestamp(record) {
  if (!record?.updatedAt) return 0;
  const t = new Date(record.updatedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * @returns {boolean} Whether anonymous usage analytics may run in this tab.
 */
export function getAnalyticsConsent() {
  if (isGpcActive()) return false;
  const raw = readRaw();
  if (raw && typeof raw.analytics === 'boolean') return raw.analytics;
  return false;
}

function recordFromRaw(raw, fallbackUpdatedAt) {
  const rec = {
    analytics: !!raw.analytics,
    updatedAt: raw.updatedAt || fallbackUpdatedAt || null,
  };
  if (raw.source) rec.source = String(raw.source);
  return rec;
}

/**
 * Persist the user's analytics preference. When GPC is active, opting in is ignored.
 * @param {boolean} allow
 * @param {{ source?: string }} [opts]
 * @returns {{ analytics: boolean, updatedAt: string, source?: string }}
 */
export function setAnalyticsConsent(allow, { source } = {}) {
  if (isGpcActive() && allow === true) {
    return readStoredRecord();
  }
  const resolvedSource = source || (isGpcActive() ? 'gpc' : 'user');
  return writeRaw(!!allow, new Date().toISOString(), resolvedSource);
}

export function readStoredRecord() {
  const raw = readRaw();
  if (raw && typeof raw.analytics === 'boolean') {
    return recordFromRaw(raw, raw.updatedAt ? null : new Date().toISOString());
  }
  return { analytics: false, updatedAt: null };
}

/**
 * @param {(allowed: boolean) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onConsentChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Apply signed-in server consent when it is newer than localStorage.
 * @returns {boolean} whether local storage was updated
 */
export function applyServerConsent(serverConsent) {
  if (!serverConsent || typeof serverConsent.analytics !== 'boolean') return false;
  const serverAt = consentTimestamp(serverConsent);
  if (serverAt <= 0) return false;

  const local = readRaw();
  const localAt = consentTimestamp(local);
  if (serverAt <= localAt) return false;

  const updatedAt = new Date(serverAt).toISOString();
  writeRaw(serverConsent.analytics, updatedAt, 'server');
  return true;
}
