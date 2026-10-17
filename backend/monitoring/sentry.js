/**
 * Express Sentry error handler — SDK init runs in instrument.js before express loads.
 */

import * as Sentry from '@sentry/node';
import { getClient } from '@sentry/core';
import { isSentryConfigured } from './sentryEnv.js';

/**
 * @returns {boolean}
 */
export function isSentryEnabled() {
  return isSentryConfigured() && getClient() !== undefined;
}

/**
 * @param {import('express').Express} app
 */
export function installSentryErrorHandler(app) {
  if (!isSentryEnabled()) return;
  Sentry.setupExpressErrorHandler(app);
}

export { Sentry };
