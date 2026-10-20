/**
 * Server-side PostHog capture for auth conversions.
 * No-op when POSTHOG_KEY is unset (dev, staging, CI). Never log the key.
 */

import { createHash } from 'node:crypto';

const DEFAULT_HOST = 'https://us.i.posthog.com';

/** @type {{ key?: string | null, host?: string | null } | null} */
let envOverride = null;

/** @type {((payload: object) => Promise<unknown> | unknown) | null} */
let captureImpl = null;

export function configurePosthogEnv(env) {
  envOverride = env ?? null;
}

/** @param {((payload: object) => Promise<unknown> | unknown) | null} fn */
export function configurePosthogCapture(fn) {
  captureImpl = fn;
}

export function getPosthogServerKey() {
  if (envOverride && envOverride.key !== undefined) {
    return String(envOverride.key || '').trim();
  }
  return String(process.env.POSTHOG_KEY || '').trim();
}

export function getPosthogServerHost() {
  if (envOverride && envOverride.host !== undefined) {
    return String(envOverride.host || '').trim() || DEFAULT_HOST;
  }
  const fromEnv = String(process.env.POSTHOG_HOST || '').trim();
  return fromEnv || DEFAULT_HOST;
}

/** SHA-256 hex of the Mongo user id — same distinct id the browser uses. */
export function hashDistinctId(userId) {
  const raw = String(userId || '');
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex');
}

export function parseRequestedAnalyticsConsent(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/**
 * Consent from this auth request: body, query, then session stash.
 * `undefined` means unknown — callers must skip capture.
 */
export function readRequestedAnalyticsConsent(req) {
  const fromBody = parseRequestedAnalyticsConsent(req?.body?.analyticsConsent);
  if (fromBody !== undefined) return fromBody;
  const fromQuery = parseRequestedAnalyticsConsent(req?.query?.analyticsConsent);
  if (fromQuery !== undefined) return fromQuery;
  if (typeof req?.session?.analyticsConsent === 'boolean') {
    return req.session.analyticsConsent;
  }
  return undefined;
}

/** Persist consent from an OAuth start URL onto the session. */
export function stashRequestedAnalyticsConsent(req) {
  const value = parseRequestedAnalyticsConsent(req?.query?.analyticsConsent)
    ?? parseRequestedAnalyticsConsent(req?.body?.analyticsConsent);
  if (typeof value === 'boolean' && req?.session) {
    req.session.analyticsConsent = value;
  }
  return value;
}

export function storedConsentChoice(consent) {
  if (!consent || typeof consent.analytics !== 'boolean') return null;
  if (!consent.updatedAt) return null;
  return consent.analytics;
}

/**
 * Send auth analytics only when consent is known and allowed.
 * Client-passed false always skips. Stored opt-out always skips.
 * Unknown (nothing passed, nothing stored) skips.
 */
export function authAnalyticsAllowed({ requested, stored } = {}) {
  const storedVal = storedConsentChoice(stored);
  if (storedVal === false) return false;
  if (typeof requested === 'boolean') return requested === true;
  return storedVal === true;
}

/** Seed User.consent from the auth request when the user has no stored choice. */
export function seedUserConsent(user, requested) {
  if (typeof requested !== 'boolean' || !user) return false;
  if (user.consent?.updatedAt) return false;
  user.consent = { analytics: requested, updatedAt: new Date() };
  return true;
}

async function defaultCapture(payload) {
  const host = getPosthogServerHost().replace(/\/$/, '');
  const res = await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`posthog capture ${res.status}`);
}

/**
 * @param {{ event: string, distinctId: string, properties?: object, personProperties?: object }} opts
 */
export async function captureEvent({
  event,
  distinctId,
  properties = {},
  personProperties = null,
} = {}) {
  if (!event || !distinctId) return false;
  const key = getPosthogServerKey();
  if (!key) return false;
  const props = { ...properties, $lib: 'surfcad-server' };
  if (personProperties && typeof personProperties === 'object') {
    props.$set = personProperties;
  }
  const payload = {
    api_key: key,
    event,
    distinct_id: distinctId,
    properties: props,
  };
  const send = captureImpl || defaultCapture;
  try {
    await send(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ id?: unknown, _id?: unknown, consent?: object }} user
 * @param {{ isNew?: boolean, method?: string, requestedConsent?: boolean, isInternal?: boolean }} [opts]
 *   `isInternal` tags the event and the person with `is_internal: true` so
 *   reports can filter internal traffic; omitted or false adds nothing.
 */
export async function captureAuthAnalytics(user, {
  isNew = false,
  method = null,
  requestedConsent,
  isInternal = false,
} = {}) {
  if (!authAnalyticsAllowed({ requested: requestedConsent, stored: user?.consent })) {
    return { sent: [] };
  }
  const distinctId = hashDistinctId(user?.id || user?._id);
  if (!distinctId) return { sent: [] };
  const properties = { method: method || null };
  const personProperties = { user_type: 'signed_in' };
  if (isInternal === true) {
    properties.is_internal = true;
    personProperties.is_internal = true;
  }
  const sent = [];
  if (isNew) {
    const ok = await captureEvent({
      event: 'signed_up',
      distinctId,
      properties,
      personProperties,
    });
    if (ok) sent.push('signed_up');
  }
  const logged = await captureEvent({
    event: 'logged_in',
    distinctId,
    properties,
    personProperties,
  });
  if (logged) sent.push('logged_in');
  return { sent };
}

/** Test-only: restore module defaults. */
export function resetPosthogForTests() {
  envOverride = null;
  captureImpl = null;
}
