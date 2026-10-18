import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  ALLOWED_ANALYTICS_EVENTS,
  analyticsWouldLoad,
  bootAnalytics,
  capturePageview,
  configureAnalyticsEnv,
  configurePosthogImporter,
  getPosthogClient,
  hashUserId,
  isLocalDevHost,
  resetAnalyticsForTests,
  resetAnalyticsIdentity,
  syncAnalyticsConsent,
  syncAnalyticsIdentity,
  track,
  trackFeatureCommits,
  trackPaletteFeature,
} from './analytics.js';
import { analyticsKindForPaletteId } from './featureAnalytics.js';
import {
  configureConsentNavigator,
  configureConsentStorage,
  setAnalyticsConsent,
} from './consent.js';
import { HELPER_PALETTE_ITEMS } from './helperPaletteSnippets.js';

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
    init: (key, opts) => {
      calls.push(['init', key, opts]);
      if (typeof opts?.loaded === 'function') opts.loaded(client);
    },
    capture: (...args) => { calls.push(['capture', ...args]); },
    identify: (...args) => { calls.push(['identify', ...args]); },
    register: (...args) => { calls.push(['register', ...args]); },
    setPersonProperties: (...args) => { calls.push(['setPersonProperties', ...args]); },
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

  test('opts out on consent change after init without reset', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    bootAnalytics();
    await getPosthogClient();
    assert.ok(client.calls.some((row) => row[0] === 'init'));
    setAnalyticsConsent(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(client.calls.some((row) => row[0] === 'opt_out'));
    assert.equal(client.calls.some((row) => row[0] === 'reset'), false);
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

  test('user_type is registered before the first $pageview', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await getPosthogClient();
    assert.equal(client.calls.some((row) => row[0] === 'capture' && row[1] === '$pageview'), false);
    await syncAnalyticsIdentity(null, false);
    const registerAt = client.calls.findIndex((row) => row[0] === 'register' && row[1]?.user_type);
    const personAt = client.calls.findIndex((row) => row[0] === 'setPersonProperties' && row[1]?.user_type);
    const pageAt = client.calls.findIndex((row) => row[0] === 'capture' && row[1] === '$pageview');
    assert.ok(registerAt >= 0);
    assert.ok(personAt >= 0);
    assert.ok(pageAt > registerAt);
    assert.ok(pageAt > personAt);
    assert.equal(client.calls[registerAt][1].user_type, 'guest');
  });

  test('guest identity sync does not reset', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await syncAnalyticsIdentity(null, false);
    assert.equal(client.calls.some((row) => row[0] === 'reset'), false);
  });

  test('resetAnalyticsIdentity is the only client reset path', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await getPosthogClient();
    resetAnalyticsIdentity();
    assert.ok(client.calls.some((row) => row[0] === 'reset'));
  });

  test('is_internal is registered for localhost and /me flag', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await syncAnalyticsIdentity({ id: 'uid-1', isInternal: true }, true);
    assert.ok(client.calls.some((row) => row[0] === 'register' && row[1]?.is_internal === true));
    assert.ok(client.calls.some((row) => (
      row[0] === 'setPersonProperties' && row[1]?.is_internal === true
    )));
  });

  test('isLocalDevHost detects localhost and vite DEV', () => {
    assert.equal(isLocalDevHost({ hostname: 'localhost' }, {}), true);
    assert.equal(isLocalDevHost({ hostname: '127.0.0.1' }, {}), true);
    assert.equal(isLocalDevHost({ hostname: 'surfcad.com' }, { DEV: true }), true);
    assert.equal(isLocalDevHost({ hostname: 'surfcad.com' }, {}), false);
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

  test('trackPaletteFeature emits feature_used for every registry kind', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    assert.ok(HELPER_PALETTE_ITEMS.length > 10);
    for (const item of HELPER_PALETTE_ITEMS) {
      trackPaletteFeature(item.id);
    }
    await syncAnalyticsConsent();
    await new Promise((r) => setTimeout(r, 0));
    const used = client.calls.filter((row) => row[0] === 'capture' && row[1] === 'feature_used');
    assert.equal(used.length, HELPER_PALETTE_ITEMS.length);
    const kinds = used.map((row) => row[2].feature);
    for (const item of HELPER_PALETTE_ITEMS) {
      assert.ok(
        kinds.includes(analyticsKindForPaletteId(item.id)),
        `missing feature_used for ${item.id}`,
      );
    }
  });

  test('consent after identity sync still sets user_type before $pageview', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    setAnalyticsConsent(false);
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await syncAnalyticsIdentity(null, false);
    assert.equal(client.calls.length, 0);
    setAnalyticsConsent(true);
    bootAnalytics();
    await getPosthogClient();
    for (let i = 0; i < 10; i++) {
      if (client.calls.some((row) => row[0] === 'capture' && row[1] === '$pageview')) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    const registerAt = client.calls.findIndex((row) => row[0] === 'register' && row[1]?.user_type);
    const pageAt = client.calls.findIndex((row) => row[0] === 'capture' && row[1] === '$pageview');
    assert.ok(registerAt >= 0);
    assert.ok(pageAt > registerAt);
  });

  test('capturePageview is skipped until identity is synced', async () => {
    configureAnalyticsEnv({ key: 'phk_test', host: 'https://us.i.posthog.com' });
    const client = mockPosthog();
    configurePosthogImporter(async () => ({ default: client }));
    await capturePageview();
    assert.equal(client.calls.some((row) => row[0] === 'capture' && row[1] === '$pageview'), false);
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
