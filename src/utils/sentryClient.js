/**
 * Lazy Sentry client — no-op when VITE_SENTRY_DSN is unset (default in dev/CI).
 */

import { hashUserId, scrubMonitoringValue, scrubSentryEvent } from './sentryPii.js';

/** @type {Promise<typeof import('@sentry/react') | null> | null} */
let clientPromise = null;

/** @type {typeof import('@sentry/react') | null} */
let sentryModule = null;

const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;

export function getSentryDsn() {
  const raw = viteEnv?.VITE_SENTRY_DSN;
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseTracesSampleRate() {
  const raw = viteEnv?.VITE_SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === '') return 0.2;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.2;
}

function sentryEnvironment() {
  const raw = viteEnv?.VITE_SENTRY_ENVIRONMENT;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return viteEnv?.PROD ? 'production' : 'development';
}

/**
 * @returns {Promise<typeof import('@sentry/react') | null>}
 */
export function loadSentryClient() {
  const dsn = getSentryDsn();
  if (!dsn) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@sentry/react').then((Sentry) => {
      if (sentryModule) return Sentry;
      Sentry.init({
        dsn,
        environment: sentryEnvironment(),
        sendDefaultPii: false,
        tracesSampleRate: parseTracesSampleRate(),
        integrations: [
          Sentry.browserTracingIntegration({
            enableInp: false,
          }),
        ],
        beforeSend(event) {
          return scrubSentryEvent(event);
        },
        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.data) {
            breadcrumb.data = scrubMonitoringValue(breadcrumb.data);
          }
          if (typeof breadcrumb.message === 'string') {
            breadcrumb.message = /** @type {string} */ (scrubMonitoringValue(breadcrumb.message));
          }
          return breadcrumb;
        },
      });
      sentryModule = Sentry;
      return Sentry;
    }).catch((error) => {
      console.warn('[Sentry] failed to load client', error);
      clientPromise = null;
      return null;
    });
  }
  return clientPromise;
}

/**
 * Fire-and-forget bootstrap (safe when DSN unset).
 */
export function bootstrapSentry() {
  void loadSentryClient();
}

/**
 * @returns {typeof import('@sentry/react') | null}
 */
export function getLoadedSentry() {
  return sentryModule;
}

/**
 * @param {unknown} error
 * @param {Record<string, unknown>} [context]
 */
export async function captureSentryException(error, context) {
  const Sentry = await loadSentryClient();
  if (!Sentry) return;
  Sentry.captureException(error, context);
}

/**
 * @param {string | null | undefined} userId
 */
export async function syncSentryUserId(userId) {
  const Sentry = await loadSentryClient();
  if (!Sentry) return;
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  const id = await hashUserId(userId);
  Sentry.setUser(id ? { id } : null);
}
