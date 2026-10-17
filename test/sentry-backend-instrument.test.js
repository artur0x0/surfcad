import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import {
  getSentryInitPayload,
  initializeSentryOnce,
} from '../backend/monitoring/sentryInit.js';

const ENV_KEYS = ['SENTRY_DSN', 'SENTRY_ENVIRONMENT', 'SENTRY_TRACES_SAMPLE_RATE'];

describe('backend sentry instrument init', () => {
  const envBackup = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (envBackup[key] === undefined) delete process.env[key];
      else process.env[key] = envBackup[key];
    }
  });

  test('initializeSentryOnce is a no-op when SENTRY_DSN is unset', async () => {
    delete process.env.SENTRY_DSN;
    const enabled = await initializeSentryOnce();
    assert.equal(enabled, false);
    assert.equal(getSentryInitPayload(), null);
  });

  test('getSentryInitPayload applies production env defaults when DSN is set', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;

    const payload = getSentryInitPayload();
    assert.ok(payload);
    assert.equal(payload.environment, 'production');
    assert.equal(payload.tracesSampleRate, 0.2);
    assert.equal(payload.sendDefaultPii, false);
  });
});
