/**
 * Sentry SDK init (imported from instrument.js before express).
 */

import * as Sentry from '@sentry/node';
import { getClient } from '@sentry/core';
import { readSentryEnv } from './sentryEnv.js';
import { scrubSentryEvent } from './sentryScrub.js';

/**
 * Initialize Sentry once from process env. No-op when DSN is unset or already initialized.
 *
 * @returns {boolean} whether Sentry is active after this call
 */
export function initializeSentryOnce() {
  if (getClient()) {
    return readSentryEnv() !== null;
  }

  const config = readSentryEnv();
  if (!config) {
    return false;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    sendDefaultPii: false,
    tracesSampleRate: config.tracesSampleRate,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  });

  return true;
}

/**
 * @returns {import('@sentry/core').Client | undefined}
 */
export function getSentryClient() {
  return getClient();
}
