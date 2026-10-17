import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import { isSentryConfigured, readSentryEnv } from '../backend/monitoring/sentryEnv.js';

const ENV_KEYS = ['SENTRY_DSN', 'SENTRY_ENVIRONMENT', 'SENTRY_TRACES_SAMPLE_RATE'];

describe('backend sentry env', () => {
  const envBackup = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (envBackup[key] === undefined) delete process.env[key];
      else process.env[key] = envBackup[key];
    }
  });

  test('no-op when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    assert.equal(isSentryConfigured(), false);
    assert.equal(readSentryEnv(), null);
  });

  test('parses production defaults when DSN is set', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.us.sentry.io/123';
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    const cfg = readSentryEnv();
    assert.ok(cfg);
    assert.equal(cfg.environment, 'production');
    assert.equal(cfg.tracesSampleRate, 0.2);
  });
});
