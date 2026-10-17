import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  ALLOWED_ANALYTICS_EVENTS,
  analyticsWouldLoad,
  bootAnalytics,
  configureAnalyticsEnv,
  configurePosthogImporter,
  getPosthogClient,
  hashUserId,
  resetAnalyticsForTests,
  syncAnalyticsConsent,
  syncAnalyticsIdentity,
  track,
  trackFeatureCommits,
} from './analytics.js';
import {
  configureConsentNavigator,
  configureConsentStorage,
  setAnalyticsConsent,
} from './consent.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function mockPosthog() {
  const calls = [];
  const client = {
    calls,
    init: (...args) => { calls.push(['init', ...args]); },
    capture: (...args) => { calls.push(['capture', ...args]); },
    identify: (...args) => { calls.push(['identify', ...args]); },
    register: (...args) => { calls.push(['register', ...args]); },
    reset: (...args) => { calls.push(['reset', ...args]); },
    opt_in_capturing: (...args) => { calls.push(['opt_in', ...args]); },
    opt_out_capturing: (...args) => { calls.push(['opt_out', ...args]); },
  };
  return client;
}

describe('analytics', () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    configureConsentStorage(memoryStorage());
    configureConsentNavigator({});
    setAnalyticsConsent(true);
    configureAnalyticsEnv({ key: null, host: null });
  });

  test('no-op when project key is unset (SDK not imported)', async () => {
    let imported = false;
    configurePosthogImporter(async () => {
      imported = true;
      return { default: mockPosthog() };
    });
    track('app_loaded', { load_ms: 1 });
    await syncAnalyticsConsent();
    assert.equal(imported, false);
    assert.equal(analyticsWouldLoad(), false);
  });

  test('no-op when consent is false', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    setAnalyticsConsent(false);
    let imported = false;
    configurePosthogImporter(async () => {
      imported = true;
      return { default: mockPosthog() };
    });
    track('logged_in');
    await syncAnalyticsConsent();
    assert.equal(imported, false);
  });

  test('no-op when GPC is active', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    configureConsentNavigator({ globalPrivacyControl: true });
    let imported = false;
    configurePosthogImporter(async () => {
      imported = true;
      return { default: mockPosthog() };
    });
    track('logged_in');
    await syncAnalyticsConsent();
    assert.equal(imported, false);
  });

  test('opts out on consent change after init', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    bootAnalytics();
    await getPosthogClient();
    assert.ok(client.calls.some((row) => row[0] === 'init'));
    setAnalyticsConsent(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(client.calls.some((row) => row[0] === 'opt_out'));
    assert.ok(client.calls.some((row) => row[0] === 'reset'));
  });

  test('hashed identify uses SHA-256 hex', async () => {
    const hashed = await hashUserId('user-abc');
    assert.equal(hashed.length, 64);
    assert.match(hashed, /^[0-9a-f]+$/);
    const again = await hashUserId('user-abc');
    assert.equal(hashed, again);
  });

  test('syncAnalyticsIdentity identifies hashed id only', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await syncAnalyticsIdentity({ id: 'uid-1', email: 'secret@example.com' }, true);
    const identifyCall = client.calls.find((row) => row[0] === 'identify');
    assert.ok(identifyCall);
    const hashed = await hashUserId('uid-1');
    assert.equal(identifyCall[1], hashed);
    assert.ok(!JSON.stringify(client.calls).includes('secret@example.com'));
  });

  test('event name allowlist blocks unknown events', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    track('not_allowed', { x: 1 });
    await syncAnalyticsConsent();
    track('logged_in');
    await new Promise((r) => setTimeout(r, 0));
    const captures = client.calls.filter((row) => row[0] === 'capture');
    assert.equal(captures.length, 1);
    assert.equal(captures[0][1], 'logged_in');
  });

  test('trackFeatureCommits emits feature_used for new markers', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    const before = '';
    const after = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
return part;
`;
    trackFeatureCommits(before, after);
    await syncAnalyticsConsent();
    await new Promise((r) => setTimeout(r, 0));
    const capture = client.calls.find((row) => row[0] === 'capture' && row[1] === 'feature_used');
    assert.ok(capture);
    assert.equal(capture[2].feature, 'cube');
  });

  test('allowed events list matches product contract', () => {
    assert.deepEqual(ALLOWED_ANALYTICS_EVENTS, [
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
  });
});
