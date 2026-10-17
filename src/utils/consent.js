/**
 * Product usage analytics consent (US launch, opt-out by default).
 *
 * PostHog and similar tools must call getAnalyticsConsent() before sending events.
 * Error reporting (e.g. Sentry) is essential operational telemetry and is NOT
 * gated by this toggle — only anonymous usage analytics and page performance.
 */

export const CONSENT_STORAGE_KEY = 'surfcad.consent.v1';

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

/**
 * GPC on first visit: treat as opt-out and persist without prompting.
 * @returns {boolean} whether a default was written
 */
export function applyGpcDefaultOnFirstVisit(nav = navigatorRef) {
  if (!isGpcActive(nav)) return false;
  if (hasStoredConsentChoice()) return false;
  setAnalyticsConsent(false);
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

function writeRaw(analytics, updatedAt) {
  const payload = {
    analytics: !!analytics,
    updatedAt: updatedAt || new Date().toISOString(),
  };
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
  return true;
}

/**
 * Persist the user's analytics preference. When GPC is active, opting in is ignored.
 * @returns {{ analytics: boolean, updatedAt: string }}
 */
export function setAnalyticsConsent(allow) {
  if (isGpcActive() && allow === true) {
    return readStoredRecord();
  }
  return writeRaw(!!allow, new Date().toISOString());
}

export function readStoredRecord() {
  const raw = readRaw();
  if (raw && typeof raw.analytics === 'boolean' && raw.updatedAt) {
    return { analytics: raw.analytics, updatedAt: raw.updatedAt };
  }
  if (raw && typeof raw.analytics === 'boolean') {
    return { analytics: raw.analytics, updatedAt: new Date().toISOString() };
  }
  return { analytics: true, updatedAt: null };
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
  writeRaw(serverConsent.analytics, updatedAt);
  return true;
}
