/**
 * PostHog product analytics (US cloud). Lazy-loads posthog-js only when
 * VITE_POSTHOG_KEY is set and getAnalyticsConsent() is true.
 */

import { getAnalyticsConsent, isGpcActive, onConsentChange } from './consent.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { analyticsKindForPaletteId } from './featureAnalytics.js';
import {
  normalizeWebVital,
  webVitalsComplete,
  webVitalsHasSample,
} from './webVitalsAnalytics.js';

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** @type {number} */
const bootStartedMs = typeof performance !== 'undefined' ? performance.now() : 0;

export const ALLOWED_ANALYTICS_EVENTS = Object.freeze([
  'app_loaded',
  'signed_up',
  'logged_in',
  'part_created',
  'assembly_created',
  'feature_used',
  'export_done',
  'quote_requested',
  'checkout_started',
  'git_saved',
  'local_agent_paired',
  'partners_form_submitted',
]);

const allowedEvents = new Set(ALLOWED_ANALYTICS_EVENTS);

/** @type {{ key?: string | null, host?: string | null } | null} */
let envOverride = null;

/** @type {(() => Promise<{ default: import('posthog-js').PostHog }>) | null} */
let posthogImporter = null;

let posthogModule = null;
let initPromise = null;
let booted = false;
let appLoadedSent = false;
let webVitalsStarted = false;
let identitySynced = false;
let initialPageviewSent = false;
/** Last identity passed to syncAnalyticsIdentity (re-applied if consent arrives later). */
let lastIdentity = { user: null, isAuthenticated: false, isInternal: false };

/**
 * Test hooks — override Vite env and dynamic import.
 * @param {{ key?: string | null, host?: string | null }} env
 */
export function configureAnalyticsEnv(env) {
  envOverride = env ?? null;
}

/** @param {() => Promise<{ default: import('posthog-js').PostHog }>} importer */
export function configurePosthogImporter(importer) {
  posthogImporter = importer;
}

export function getPosthogProjectKey() {
  if (envOverride && envOverride.key !== undefined) {
    return envOverride.key || '';
  }
  return String(import.meta.env?.VITE_POSTHOG_KEY || '').trim();
}

export function getPosthogApiHost() {
  if (envOverride && envOverride.host !== undefined) {
    return envOverride.host || DEFAULT_POSTHOG_HOST;
  }
  const fromEnv = String(import.meta.env?.VITE_POSTHOG_HOST || '').trim();
  return fromEnv || DEFAULT_POSTHOG_HOST;
}

export function analyticsWouldLoad() {
  return !!getPosthogProjectKey() && getAnalyticsConsent() && !isGpcActive();
}

/**
 * Localhost / Vite-dev hosts count as internal traffic.
 * @param {{ hostname?: string } | null} [loc]
 * @param {{ DEV?: boolean } | null} [env]
 */
export function isLocalDevHost(
  loc = typeof window !== 'undefined' ? window.location : null,
  env = import.meta.env,
) {
  if (env?.DEV) return true;
  const host = String(loc?.hostname || '').toLowerCase();
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '[::1]'
    || host.endsWith('.local');
}

async function importPosthog() {
  if (posthogImporter) return posthogImporter();
  return import('posthog-js');
}

function persistUserType(ph, userType) {
  if (!ph) return;
  ph.register({ user_type: userType });
  if (typeof ph.setPersonProperties === 'function') {
    ph.setPersonProperties({ user_type: userType });
  }
}

function persistInternalFlag(ph, isInternal) {
  if (!ph || !isInternal) return;
  ph.register({ is_internal: true });
  if (typeof ph.setPersonProperties === 'function') {
    ph.setPersonProperties({ is_internal: true });
  }
}

/**
 * @returns {Promise<import('posthog-js').PostHog | null>}
 */
export async function getPosthogClient() {
  if (!analyticsWouldLoad()) return null;
  if (posthogModule) return posthogModule;
  if (!initPromise) {
    initPromise = (async () => {
      const key = getPosthogProjectKey();
      if (!key || !getAnalyticsConsent()) return null;
      const { default: posthog } = await importPosthog();
      posthog.init(key, {
        api_host: getPosthogApiHost(),
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_surveys_automatic_display: true,
        persistence: 'localStorage',
        cross_subdomain_cookie: false,
        ip: false,
        property_denylist: ['$ip', '$initial_ip'],
        opt_out_capturing_by_default: false,
        loaded: (client) => {
          client.opt_in_capturing();
          // Super property before any later capture; first $pageview waits
          // for syncAnalyticsIdentity so it carries the real user_type.
          persistUserType(client, 'guest');
          startWebVitalsCapture(client);
        },
      });
      posthogModule = posthog;
      return posthog;
    })().catch(() => {
      initPromise = null;
      return null;
    });
  }
  return initPromise;
}

function teardownPosthog({ reset = false } = {}) {
  if (posthogModule) {
    try {
      posthogModule.opt_out_capturing();
      if (reset) posthogModule.reset();
    } catch {
      /* ignore */
    }
  }
  posthogModule = null;
  initPromise = null;
}

export function shutdownAnalyticsCapturing() {
  teardownPosthog({ reset: false });
}

export function syncAnalyticsConsent() {
  if (!getPosthogProjectKey()) return;
  if (!getAnalyticsConsent() || isGpcActive()) {
    shutdownAnalyticsCapturing();
    return;
  }
  if (posthogModule) {
    posthogModule.opt_in_capturing();
    return;
  }
  void getPosthogClient().then((ph) => {
    if (!ph || !identitySynced || initialPageviewSent) return;
    return syncAnalyticsIdentity(lastIdentity.user, lastIdentity.isAuthenticated, {
      isInternal: lastIdentity.isInternal,
    });
  });
}

export function bootAnalytics() {
  if (booted) return;
  booted = true;
  onConsentChange(() => {
    syncAnalyticsConsent();
  });
  syncAnalyticsConsent();
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      void capturePageview();
    });
  }
}

function maybeSendAppLoaded() {
  if (appLoadedSent) return;
  appLoadedSent = true;
  const loadMs = Math.max(0, Math.round(
    (typeof performance !== 'undefined' ? performance.now() : 0) - bootStartedMs,
  ));
  track('app_loaded', { load_ms: loadMs });
}

async function captureWhenReady(event, properties) {
  if (!analyticsWouldLoad()) return;
  const client = await getPosthogClient();
  if (!client || !getAnalyticsConsent()) return;
  client.capture(event, properties);
}

/**
 * @param {string} name
 * @param {Record<string, string | number | boolean | null | undefined>} [props]
 */
export function track(name, props = {}) {
  if (!allowedEvents.has(name)) {
    if (import.meta.env?.DEV) {
      console.warn(`[analytics] blocked event name: ${name}`);
    }
    return;
  }
  if (!analyticsWouldLoad()) return;
  const safe = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean' || value === null) {
      safe[key] = value;
    }
  }
  void captureWhenReady(name, safe);
}

export async function capturePageview(client = null) {
  if (!analyticsWouldLoad() || !identitySynced) return;
  const ph = client || await getPosthogClient();
  if (!ph) return;
  ph.capture('$pageview', {
    $current_url: typeof window !== 'undefined' ? window.location.href : undefined,
  });
}

export async function hashUserId(userId) {
  const raw = String(userId || '');
  if (!raw || typeof crypto === 'undefined' || !crypto.subtle) return '';
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sendInitialPageview(ph) {
  if (initialPageviewSent) return;
  initialPageviewSent = true;
  maybeSendAppLoaded();
  await capturePageview(ph);
}

/**
 * @param {{ id?: string, _id?: string, isInternal?: boolean } | null} user
 * @param {boolean} isAuthenticated
 * @param {{ isInternal?: boolean }} [opts]
 */
export async function syncAnalyticsIdentity(user, isAuthenticated, { isInternal = false } = {}) {
  lastIdentity = {
    user,
    isAuthenticated,
    isInternal: !!(isInternal || user?.isInternal),
  };
  identitySynced = true;
  if (!getPosthogProjectKey()) return;
  if (!getAnalyticsConsent() || isGpcActive()) return;
  const ph = await getPosthogClient();
  if (!ph) return;

  const userType = isAuthenticated ? 'signed_in' : 'guest';
  persistUserType(ph, userType);
  persistInternalFlag(ph, !!(isInternal || user?.isInternal || isLocalDevHost()));

  if (isAuthenticated && user) {
    const rawId = user.id || user._id;
    if (rawId) {
      const hashed = await hashUserId(rawId);
      if (hashed) ph.identify(hashed, { user_type: 'signed_in' });
    }
  }

  await sendInitialPageview(ph);
}

/** Sign-out only. Consent opt-out must not reset the distinct id. */
export function resetAnalyticsIdentity() {
  if (!posthogModule) return;
  posthogModule.reset();
  persistUserType(posthogModule, 'guest');
}

export function trackFeatureUsed(kind) {
  const feature = String(kind || '').trim();
  if (!feature) return;
  track('feature_used', { feature });
}

/** Palette Confirm / insert: one `feature_used` with the registry kind. */
export function trackPaletteFeature(helperId) {
  const kind = analyticsKindForPaletteId(helperId);
  if (!kind) return;
  trackFeatureUsed(kind);
}

/**
 * Compare feature markers before/after a script write; emit feature_used per new block.
 * @param {string} beforeBuffer
 * @param {string} afterBuffer
 */
export function trackFeatureCommits(beforeBuffer, afterBuffer) {
  const before = String(beforeBuffer || '');
  const after = String(afterBuffer || '');
  if (after === before) return;
  const seen = new Set(parseFeatureMarkers(before).map((f) => f.id));
  for (const feature of parseFeatureMarkers(after)) {
    if (!feature?.id || seen.has(feature.id)) continue;
    const kind = feature.kind || 'unknown';
    trackFeatureUsed(kind);
    seen.add(feature.id);
  }
}

function startWebVitalsCapture(client) {
  if (webVitalsStarted || typeof window === 'undefined') return;
  webVitalsStarted = true;
  void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    const metrics = {};
    let sent = false;
    const flush = () => {
      if (sent || !getAnalyticsConsent()) return;
      if (!webVitalsHasSample(metrics)) return;
      sent = true;
      client.capture('web_vitals', {
        lcp: metrics.lcp ?? null,
        inp: metrics.inp ?? null,
        cls: metrics.cls ?? null,
        fcp: metrics.fcp ?? null,
        ttfb: metrics.ttfb ?? null,
      });
    };
    const record = (name, value) => {
      const next = normalizeWebVital(name, value);
      if (next == null) return;
      metrics[name] = next;
      if (webVitalsComplete(metrics)) flush();
    };
    onLCP((m) => record('lcp', m.value));
    onINP((m) => record('inp', m.value));
    onCLS((m) => record('cls', m.value));
    onFCP((m) => record('fcp', m.value));
    onTTFB((m) => record('ttfb', m.value));
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    setTimeout(flush, 12_000);
  }).catch(() => {
    webVitalsStarted = false;
  });
}

/** Test-only: reset module state between tests. */
export function resetAnalyticsForTests() {
  teardownPosthog({ reset: true });
  envOverride = null;
  posthogImporter = null;
  booted = false;
  appLoadedSent = false;
  webVitalsStarted = false;
  identitySynced = false;
  initialPageviewSent = false;
  lastIdentity = { user: null, isAuthenticated: false, isInternal: false };
}
