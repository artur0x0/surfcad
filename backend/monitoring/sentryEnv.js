/**
 * Sentry env parsing without loading @sentry/node (root unit tests may import this).
 */

export function readSentryEnv() {
  const dsn = typeof process.env.SENTRY_DSN === 'string' ? process.env.SENTRY_DSN.trim() : '';
  if (!dsn) return null;

  const envRaw = process.env.SENTRY_ENVIRONMENT;
  const environment = typeof envRaw === 'string' && envRaw.trim() ? envRaw.trim() : 'production';

  const rateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  let tracesSampleRate = 0.2;
  if (rateRaw !== undefined && rateRaw !== '') {
    const n = Number(rateRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) tracesSampleRate = n;
  }

  return { dsn, environment, tracesSampleRate };
}

export function isSentryConfigured() {
  return readSentryEnv() !== null;
}
