import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getLoadedSentry,
  getSentryDsn,
  loadSentryClient,
} from './sentryClient.js';

describe('sentryClient', () => {
  test('no-op when VITE_SENTRY_DSN is unset', async () => {
    assert.equal(getSentryDsn(), '');
    const client = await loadSentryClient();
    assert.equal(client, null);
    assert.equal(getLoadedSentry(), null);
  });
});
