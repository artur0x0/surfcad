/**
 * Express Sentry bootstrap — only imported from server.js (not root unit tests).
 */

import * as Sentry from '@sentry/node';
import { readSentryEnv } from './sentryEnv.js';
import { scrubSentryEvent } from './sentryScrub.js';

/**
 * @param {import('express').Express} app
 * @returns {boolean}
 */
export function initSentryForExpress(app) {
  const config = readSentryEnv();
  if (!config) return false;

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    sendDefaultPii: false,
    tracesSampleRate: config.tracesSampleRate,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration({ app }),
    ],
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  });

  return true;
}

/**
 * @param {import('express').Express} app
 */
export function installSentryErrorHandler(app) {
  if (!readSentryEnv()) return;
  Sentry.setupExpressErrorHandler(app);
}

export { Sentry };
