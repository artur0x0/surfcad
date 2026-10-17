/**
 * Sentry SDK init (imported from instrument.js before express).
 * @sentry/node is loaded only when a DSN is configured.
 */

import { readSentryEnv } from './sentryEnv.js';
import { scrubSentryEvent } from './sentryScrub.js';

/**
 * Options passed to Sentry.init from env (no SDK import).
 *
 * @returns {null | { dsn: string, environment: string, sendDefaultPii: false, tracesSampleRate: number }}
 */
export function getSentryInitPayload() {
  const config = readSentryEnv();
  if (!config) return null;

  return {
    dsn: config.dsn,
    environment: config.environment,
    sendDefaultPii: false,
    tracesSampleRate: config.tracesSampleRate,
  };
}

/** @type {Promise<void> | null} */
let initPromise = null;

/**
 * Initialize Sentry once from process env. No-op when DSN is unset or already initialized.
 *
 * @returns {Promise<boolean>} whether Sentry is active after this call
 */
export async function initializeSentryOnce() {
  const payload = getSentryInitPayload();
  if (!payload) {
    return false;
  }

  const { getClient } = await import('@sentry/core');
  if (getClient()) {
    return true;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const Sentry = await import('@sentry/node');
      Sentry.init({
        ...payload,
        integrations: [
          Sentry.httpIntegration(),
          Sentry.expressIntegration(),
        ],
        beforeSend(event) {
          return scrubSentryEvent(event);
        },
      });
    })();
  }

  await initPromise;
  return true;
}
