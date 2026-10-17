/**
 * Chip, Open, and boot share one phase.
 *
 * /me in + usable token → green chip, vault Open, reopen.
 * /me in + missing/expired token, refresh 200 → connected.
 * /me in + missing/expired token, refresh 401 or 404 → grey reauth,
 *   reconnect Open, read-only cache (never the demo, never a write).
 * /me out → signed-out chip, local Open, clear. A 404 does not sign
 *   that session in, and it does not plant Part (1).
 *
 * Root deps only. No mongoose.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  authStateFromPhase,
  bootPlanForPhase,
  chipView,
  describeAuthOutcome,
  phaseAfterSessionAttempt,
  planOpenTarget,
  reconnectMachine,
} from '../src/utils/authPhase.js';
import { bootWouldClobber, bootWriteAllowed, isBootDemoDocument } from '../src/utils/assemblyBoot.js';
import {
  planTokenRefresh,
  refreshGithubAccessToken,
} from '../src/utils/git/githubTokenRefresh.js';
import {
  OAUTH_MESSAGE_TYPE,
  runReconnectAttempt,
} from '../src/utils/git/githubSilentAuth.js';

const GEARBOX = {
  name: 'Gearbox',
  source: 'git',
  activeId: 'bracket',
  parts: [{ id: 'bracket', name: 'Bracket', visible: true, order: 0 }],
};

const DEMO = {
  name: 'Assembly',
  source: 'local',
  activeId: 'bare-new',
  parts: [{ id: 'bare-new', name: 'Part (1)', visible: true, order: 0 }],
};

const POINTER = { name: 'Gearbox', activeId: 'bracket', source: 'git' };

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function assertNeverWrites(plan) {
  assert.equal(plan.persist, false);
  assert.equal(plan.commit, false);
  assert.equal(plan.enqueue, false);
  assert.equal(plan.createAssembly, false);
  assert.equal(bootWriteAllowed(plan), false);
}

function expectPhase(me, token, http) {
  if (me === 'out') return 'signed-out';
  if (token === 'present') return 'connected';
  if (Number(http) === 200) return 'connected';
  return 'reauth';
}

describe('chip × open × boot', () => {
  const tokens = ['present', 'missing', 'expired'];
  const codes = [200, 401, 404];
  const mes = ['in', 'out'];

  for (const me of mes) {
    for (const token of tokens) {
      for (const http of codes) {
        const phase = expectPhase(me, token, http);
        test(`/me ${me}, token ${token}, refresh ${http} → ${phase}`, () => {
          const real = describeAuthOutcome({
            me,
            token,
            http,
            cacheStatus: 'hit',
            cachedDoc: GEARBOX,
            pointer: POINTER,
            userId: 'user-1',
          });
          assert.equal(real.phase, phase);
          assert.equal(real.open, planOpenTarget(phase));
          assertNeverWrites(real.boot);

          if (phase === 'connected') {
            assert.equal(real.chip.look, 'signed-in');
            assert.equal(real.chip.badge, false);
            assert.equal(real.chip.spinner, false);
            assert.equal(real.open, 'vault');
            assert.equal(real.boot.action, 'reopen-cache');
            assert.equal(real.boot.doc.name, 'Gearbox');
            assert.equal(real.refreshResult.unsupported, false);
          } else if (phase === 'reauth') {
            assert.equal(real.chip.look, 'reauth');
            assert.equal(real.chip.badge, true);
            assert.equal(real.chip.spinner, false);
            assert.equal(real.chip.reconnect, false);
            assert.equal(real.chip.auth, 'reauth');
            assert.equal(real.open, 'reconnect');
            assert.equal(real.boot.action, 'reopen-cache');
            assert.equal(real.boot.readOnly, true);
            assert.equal(real.boot.doc.name, 'Gearbox');
            assert.equal(real.boot.chip, 'show');
            if (http === 404) assert.equal(real.refreshResult.unsupported, true);
            if (http === 401) assert.equal(real.refreshResult.failure, 'failed');
          } else {
            assert.equal(real.chip.look, 'signed-out');
            assert.equal(real.chip.badge, false);
            assert.equal(real.open, 'local');
            assert.equal(real.boot.action, 'clear');
            assert.equal(real.boot.chip, 'clear');
            assert.equal(real.boot.doc, null);
          }

          const demo = describeAuthOutcome({
            me,
            token,
            http,
            cacheStatus: 'hit',
            cachedDoc: DEMO,
            pointer: POINTER,
            userId: 'user-1',
          });
          assert.equal(demo.phase, phase);
          assertNeverWrites(demo.boot);
          if (phase === 'reauth') {
            assert.equal(demo.boot.action, 'empty');
            assert.equal(demo.boot.readOnly, true);
            assert.equal(demo.boot.doc, null);
            assert.equal(demo.open, 'reconnect');
            assert.equal(isBootDemoDocument(DEMO), true);
          }
          if (phase === 'connected') {
            assert.equal(demo.boot.action, 'reopen-vault');
            assert.equal(demo.boot.name, 'Gearbox');
            assert.equal(demo.boot.reason, 'pointer-over-demo');
          }
          if (phase === 'signed-out') {
            assert.equal(demo.boot.action, 'clear');
            assert.equal(demo.open, 'local');
          }

          const miss = describeAuthOutcome({
            me,
            token,
            http,
            cacheStatus: 'miss',
            cachedDoc: null,
            pointer: POINTER,
            userId: 'user-1',
          });
          assertNeverWrites(miss.boot);
          if (phase === 'reauth') {
            assert.equal(miss.boot.action, 'empty');
            assert.equal(miss.boot.reason, 'reauth-empty');
            assert.equal(miss.open, 'reconnect');
          }
          if (phase === 'signed-out') assert.equal(miss.boot.action, 'clear');
          if (phase === 'connected') {
            assert.equal(miss.boot.action, 'reopen-vault');
            assert.equal(miss.open, 'vault');
          }
        });
      }
    }
  }

  test('a 404 cannot turn an unauthenticated /me into reauth or a demo', () => {
    const phase = phaseAfterSessionAttempt({
      me: 'out',
      refreshResult: { ok: false, unsupported: true, accessToken: '' },
      sessionUpsert: 'failed',
    });
    assert.equal(phase, 'signed-out');
    const boot = bootPlanForPhase(phase, { cacheStatus: 'hit', cachedDoc: GEARBOX });
    assert.equal(boot.action, 'clear');
    assertNeverWrites(boot);
    assert.equal(bootWouldClobber(GEARBOX, DEMO), true);
  });

  test('a usable token that upserts the session is connected', () => {
    const phase = phaseAfterSessionAttempt({
      me: 'out',
      refreshResult: { ok: true, accessToken: 'ghu_live' },
      sessionUpsert: 'ok',
    });
    assert.equal(phase, 'connected');
    assert.equal(planOpenTarget(phase), 'vault');
  });

  test('reauth timeout does not invent a demo', () => {
    const boot = bootPlanForPhase('reauth', { cacheStatus: 'timeout', cachedDoc: null });
    assert.equal(boot.action, 'empty');
    assert.equal(boot.reason, 'reauth-timeout');
    assert.equal(boot.readOnly, true);
    assertNeverWrites(boot);
  });
});

describe('reconnect chip motion', () => {
  test('grey, then spinner, then connected or still grey with Reconnect', () => {
    const grey = chipView({ phase: 'reauth', motion: 'idle' });
    assert.equal(grey.look, 'reauth');
    assert.equal(grey.badge, true);
    assert.equal(grey.spinner, false);
    assert.equal(grey.reconnect, false);

    const spinning = reconnectMachine({ refresh: 'pending', silent: 'idle' });
    assert.equal(spinning.motion, 'spinning');
    assert.equal(spinning.step, 'refresh');
    assert.deepEqual(chipView({ phase: 'reauth', motion: spinning.motion }), {
      look: 'reauth', badge: false, spinner: true, reconnect: false, auth: 'reauth',
    });

    const silentSpin = reconnectMachine({ refresh: 'unsupported', silent: 'pending' });
    assert.equal(silentSpin.motion, 'spinning');
    assert.equal(silentSpin.step, 'silent');
    assert.equal(chipView({ phase: 'reauth', motion: 'spinning' }).spinner, true);

    const connected = reconnectMachine({ refresh: 'ok', silent: 'idle' });
    assert.equal(connected.connected, true);
    assert.equal(chipView({ phase: 'connected', motion: 'idle' }).look, 'signed-in');

    const silentOk = reconnectMachine({ refresh: 'failed', silent: 'ok' });
    assert.equal(silentOk.connected, true);
    assert.equal(silentOk.offerReconnect, false);

    for (const silent of ['blocked', 'needs-user', 'failed']) {
      const stayed = reconnectMachine({ refresh: 'unsupported', silent });
      assert.equal(stayed.connected, false);
      assert.equal(stayed.offerReconnect, true);
      assert.equal(stayed.motion, 'reconnect');
      const view = chipView({ phase: 'reauth', motion: stayed.motion });
      assert.equal(view.badge, true);
      assert.equal(view.spinner, false);
      assert.equal(view.reconnect, true);
      assert.equal(view.look, 'reauth');
    }
  });
});

describe('refresh route lag', () => {
  const now = 1_700_000_000_000;

  test('a still-valid bundle is mirrored back into the session store', async () => {
    const storage = memoryStorage({
      'surfcad.github.tokenBundle': JSON.stringify({
        accessToken: 'ghu_kept',
        refreshToken: 'ghr_kept',
        expiresAt: now + 60 * 60 * 1000,
        refreshExpiresAt: now + 86_400_000,
      }),
    });
    const session = memoryStorage();
    assert.equal(planTokenRefresh({
      accessToken: 'ghu_kept',
      refreshToken: 'ghr_kept',
      expiresAt: now + 60 * 60 * 1000,
    }, now), 'keep');
    const kept = await refreshGithubAccessToken({
      now,
      storage,
      session,
      fetchImpl: async () => { throw new Error('refresh should not be called'); },
    });
    assert.equal(kept.ok, true);
    assert.equal(kept.accessToken, 'ghu_kept');
    assert.equal(kept.failure, null);
    assert.equal(session.getItem('surfcad.github.token'), 'ghu_kept');
  });

  test('200 mints a token, 401 drops the dead access token, 404 is unsupported', async () => {
    const expired = {
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: now - 1000,
      refreshExpiresAt: now + 86_400_000,
    };

    const okStorage = memoryStorage({
      'surfcad.github.tokenBundle': JSON.stringify(expired),
    });
    const okSession = memoryStorage({ 'surfcad.github.token': 'ghu_old' });
    const ok = await refreshGithubAccessToken({
      now,
      storage: okStorage,
      session: okSession,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 }),
      }),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.accessToken, 'ghu_new');
    assert.equal(ok.unsupported, false);
    assert.equal(okSession.getItem('surfcad.github.token'), 'ghu_new');

    const deniedStorage = memoryStorage({
      'surfcad.github.tokenBundle': JSON.stringify(expired),
    });
    const deniedSession = memoryStorage({ 'surfcad.github.token': 'ghu_old' });
    const denied = await refreshGithubAccessToken({
      now,
      storage: deniedStorage,
      session: deniedSession,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'bad credentials' }),
      }),
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.unsupported, false);
    assert.equal(denied.failure, 'failed');
    assert.equal(denied.accessToken, '');
    assert.equal(deniedSession.getItem('surfcad.github.token'), null);
    assert.match(deniedStorage.getItem('surfcad.github.tokenBundle'), /ghr_old/);

    const missingStorage = memoryStorage({
      'surfcad.github.tokenBundle': JSON.stringify(expired),
    });
    const missingSession = memoryStorage({ 'surfcad.github.token': 'ghu_old' });
    let posted = 0;
    const missing = await refreshGithubAccessToken({
      now,
      storage: missingStorage,
      session: missingSession,
      fetchImpl: async () => {
        posted += 1;
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      },
    });
    assert.equal(posted, 1);
    assert.equal(missing.ok, false);
    assert.equal(missing.unsupported, true);
    assert.equal(missing.failure, 'unsupported');
    assert.equal(missing.accessToken, '');
    assert.equal(missingSession.getItem('surfcad.github.token'), null);
    assert.match(missingStorage.getItem('surfcad.github.tokenBundle'), /ghr_old/);
    const boot = bootPlanForPhase('reauth', { cacheStatus: 'hit', cachedDoc: GEARBOX });
    assert.equal(boot.action, 'reopen-cache');
    assert.equal(boot.readOnly, true);
    assertNeverWrites(boot);

    const soon = {
      accessToken: 'ghu_soon',
      refreshToken: 'ghr_soon',
      expiresAt: now + 60_000,
      refreshExpiresAt: now + 86_400_000,
    };
    const soonSession = memoryStorage();
    const soonResult = await refreshGithubAccessToken({
      now,
      storage: memoryStorage({ 'surfcad.github.tokenBundle': JSON.stringify(soon) }),
      session: soonSession,
      fetchImpl: async () => ({ ok: false, status: 405, json: async () => ({}) }),
    });
    assert.equal(soonResult.unsupported, true);
    assert.equal(soonResult.ok, true);
    assert.equal(soonResult.accessToken, 'ghu_soon');
    assert.equal(soonSession.getItem('surfcad.github.token'), 'ghu_soon');
  });
});

describe('reconnect attempt', () => {
  test('refresh success closes the gesture popup and does not send the user to GitHub', async () => {
    const popup = {
      location: { href: 'about:blank' },
      closed: false,
      close() { this.closed = true; },
    };
    const result = await runReconnectAttempt({
      refresh: async () => ({ ok: true, accessToken: 'ghu_new', failure: null }),
      openWindow: () => popup,
      clientId: 'cid',
      origin: 'http://localhost',
      timeoutMs: 30,
      addEventListener() {},
      removeEventListener() {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.via, 'refresh');
    assert.equal(result.accessToken, 'ghu_new');
    assert.equal(popup.closed, true);
    assert.equal(popup.location.href, 'about:blank');
  });

  test('404 then a blocked popup stays signed-in-but-reauth', async () => {
    const result = await runReconnectAttempt({
      refresh: async () => ({
        ok: false,
        accessToken: '',
        unsupported: true,
        failure: 'unsupported',
      }),
      openWindow: () => null,
      clientId: 'cid',
      origin: 'http://localhost',
      timeoutMs: 20,
      addEventListener() {},
      removeEventListener() {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.via, 'blocked');
    assert.equal(result.failure, 'unsupported');
    const view = chipView({ phase: 'reauth', motion: 'reconnect' });
    assert.equal(view.reconnect, true);
    assert.equal(view.look, 'reauth');
    assert.equal(planOpenTarget('reauth'), 'reconnect');
  });

  test('silent popup success adopts the bundle token', async () => {
    const prevLocal = globalThis.localStorage;
    const prevSession = globalThis.sessionStorage;
    const local = memoryStorage();
    const session = memoryStorage();
    globalThis.localStorage = local;
    globalThis.sessionStorage = session;
    const popup = {
      location: { href: 'about:blank' },
      closed: false,
      close() { this.closed = true; },
    };
    let listener = null;
    try {
      const pending = runReconnectAttempt({
        refresh: async () => ({ ok: false, unsupported: true, failure: 'unsupported', accessToken: '' }),
        openWindow: () => popup,
        clientId: 'Iv1.cid',
        origin: 'https://surfcad.test',
        timeoutMs: 400,
        addEventListener(_type, fn) { listener = fn; },
        removeEventListener() { listener = null; },
      });
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      assert.equal(typeof listener, 'function');
      assert.match(popup.location.href, /github\.com\/login\/oauth\/authorize/);
      local.setItem('surfcad.github.tokenBundle', JSON.stringify({
        accessToken: 'ghu_silent',
        refreshToken: 'ghr_silent',
        expiresAt: 0,
        refreshExpiresAt: 0,
      }));
      listener({
        origin: 'https://surfcad.test',
        source: popup,
        data: { type: OAUTH_MESSAGE_TYPE, ok: true },
      });
      const result = await pending;
      assert.equal(result.ok, true);
      assert.equal(result.via, 'silent');
      assert.equal(result.accessToken, 'ghu_silent');
      assert.equal(session.getItem('surfcad.github.token'), 'ghu_silent');
      assert.equal(popup.closed, true);
    } finally {
      if (prevLocal === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLocal;
      if (prevSession === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = prevSession;
    }
  });

  test('silent popup ignores a message that omits origin or comes from another window', async () => {
    const prevLocal = globalThis.localStorage;
    const prevSession = globalThis.sessionStorage;
    const local = memoryStorage();
    const session = memoryStorage();
    globalThis.localStorage = local;
    globalThis.sessionStorage = session;
    const popup = {
      location: { href: 'about:blank' },
      closed: false,
      close() { this.closed = true; },
    };
    let listener = null;
    try {
      const pending = runReconnectAttempt({
        refresh: async () => ({ ok: false, unsupported: true, failure: 'unsupported', accessToken: '' }),
        openWindow: () => popup,
        clientId: 'Iv1.cid',
        origin: 'https://surfcad.test',
        timeoutMs: 80,
        addEventListener(_type, fn) { listener = fn; },
        removeEventListener() { listener = null; },
      });
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      assert.equal(typeof listener, 'function');
      local.setItem('surfcad.github.tokenBundle', JSON.stringify({
        accessToken: 'ghu_silent',
        refreshToken: 'ghr_silent',
        expiresAt: 0,
        refreshExpiresAt: 0,
      }));
      listener({
        origin: '',
        source: popup,
        data: { type: OAUTH_MESSAGE_TYPE, ok: true },
      });
      listener({
        origin: 'https://surfcad.test',
        source: null,
        data: { type: OAUTH_MESSAGE_TYPE, ok: true },
      });
      listener({
        origin: 'https://evil.test',
        source: popup,
        data: { type: OAUTH_MESSAGE_TYPE, ok: true },
      });
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.via, 'needs-user');
      assert.equal(session.getItem('surfcad.github.token'), null);
    } finally {
      if (prevLocal === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLocal;
      if (prevSession === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = prevSession;
    }
  });
});

describe('shared auth snapshot', () => {
  test('signedIn is the live session; githubConnected is the vault', () => {
    const connected = authStateFromPhase('connected');
    assert.equal(connected.signedIn, true);
    assert.equal(connected.githubConnected, true);
    assert.equal(connected.needsReconnect, false);
    assert.equal(connected.openTarget, 'vault');

    const reauth = authStateFromPhase('reauth');
    assert.equal(reauth.signedIn, true);
    assert.equal(reauth.githubConnected, false);
    assert.equal(reauth.needsReconnect, true);
    assert.equal(reauth.openTarget, 'reconnect');

    const out = authStateFromPhase('signed-out');
    assert.equal(out.signedIn, false);
    assert.equal(out.signedOut, true);
    assert.equal(out.openTarget, 'local');

    const pending = authStateFromPhase('pending');
    assert.equal(pending.pending, true);
    assert.equal(pending.signedIn, false);
    assert.equal(pending.openTarget, 'wait');
    assert.equal(authStateFromPhase('nope').phase, 'pending');
  });

  test('chip, Open, and App import that snapshot', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const chip = readFileSync(new URL('../src/components/ProfileChip.jsx', import.meta.url), 'utf8');
    const feed = readFileSync(new URL('../src/components/PartFeed.jsx', import.meta.url), 'utf8');
    const hook = readFileSync(new URL('../src/hooks/useAuthState.js', import.meta.url), 'utf8');
    assert.match(app, /useAuthState/);
    assert.match(chip, /useAuthState/);
    assert.match(chip, /githubConnected/);
    assert.match(chip, /needsReconnect/);
    assert.match(feed, /gitSession\.openTarget/);
    assert.match(hook, /authStateFromPhase/);
    assert.match(hook, /signedIn/);
  });
});

describe('boot wiring', () => {
  test('App reauth reopen does not seed the demo or flip source to local', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const start = app.indexOf('Restore editor + assembly');
    const end = app.indexOf('Mirror the live CAD buffer');
    assert.ok(start > 0 && end > start);
    const boot = app.slice(start, end);
    assert.match(boot, /reauth/);
    assert.match(boot, /plan\.readOnly/);
    assert.match(boot, /bootWouldClobber/);
    assert.equal(/setEditorInitialScript\(DEFAULT_SCRIPT\)/.test(boot), false);
    assert.match(app, /bootResume === 'reauth' \|\| bootReadOnlyRef/);
    assert.match(app, /gitSession\.phase === 'connected'/);
  });
});
