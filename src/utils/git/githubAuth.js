/**
 * Browser-only GitHub App user-to-server OAuth helpers.
 *
 * The access token lives in sessionStorage (tab-scoped; cleared when the
 * tab closes). The server only exchanges a one-time code → token and
 * stores nothing. Client secret never reaches the browser.
 *
 * Client ID resolution (first hit wins):
 *   1. runtime `/api/config`.githubAppClientId (from GITHUB_APP_CLIENT_ID)
 *   2. import.meta.env.VITE_GITHUB_APP_CLIENT_ID (static build inject)
 *
 * Callback path is always `/git/callback`. redirect_uri is always
 * `window.location.origin + '/git/callback'` — register that exact URL
 * on the GitHub App for every host you use (prod, localhost, Tailscale IP).
 * OAuth `state` is sessionStorage (origin-scoped): Connect and callback
 * must share the same origin.
 *
 * Expiring GitHub App user tokens also return a refresh token. That bundle
 * is stored by githubTokenRefresh.js; this file still keeps the access
 * token in sessionStorage.
 */
import { clearGithubTokenBundle, rememberGithubTokenBundle } from './githubTokenRefresh.js';
import { withAnalyticsConsent } from '../analyticsConsentAuth.js';

export const GITHUB_TOKEN_STORAGE_KEY = 'surfcad.github.token';
export const GITHUB_OAUTH_STATE_KEY = 'surfcad.github.oauth.state';
export const GITHUB_CALLBACK_PATH = '/git/callback';
export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_EXCHANGE_PATH = '/api/github/oauth/token';
/** App-user session upsert after OAuth (G8) — mirrors Apple/Google login. */
export const GITHUB_SESSION_PATH = '/api/auth/github';
/** Subtitle under Sign in with GitHub (exact copy). */
export const GITHUB_SIGNIN_SUBTITLE = 'Enables free part revision control';

/** Shown when sessionStorage has no state (wrong origin / fresh tab / Strict remount after clear). */
export const GITHUB_OAUTH_STATE_MISSING_HINT =
  'OAuth state missing — open Connect and complete authorization on the same origin (same host and port)';

/** Build absolute redirect_uri for the current origin + /git/callback. */
export function githubRedirectUri(origin = typeof window !== 'undefined' ? window.location.origin : '') {
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}${GITHUB_CALLBACK_PATH}`;
}

/**
 * Popup OAuth cannot see this tab's sessionStorage. A sibling module
 * registers a reader for the one-shot state it stashed for that window.
 * Null unless that module is loaded. This file does not open the other store.
 */
let oauthStateExtra = null;

export function setOAuthStateExtra(store) {
  oauthStateExtra = store && typeof store.peek === 'function' ? store : null;
}

/** Random opaque state for CSRF; stored in sessionStorage for the round-trip. */
export function createOAuthState(randomBytes = defaultRandom) {
  const state = randomBytes();
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(GITHUB_OAUTH_STATE_KEY, state);
  }
  return state;
}

export function peekOAuthState() {
  let fromSession = null;
  if (typeof sessionStorage !== 'undefined') {
    fromSession = sessionStorage.getItem(GITHUB_OAUTH_STATE_KEY);
  }
  if (fromSession) return fromSession;
  try {
    return oauthStateExtra?.peek?.() || null;
  } catch {
    return null;
  }
}

export function clearOAuthState() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(GITHUB_OAUTH_STATE_KEY);
  }
  try { oauthStateExtra?.clear?.(); } catch { /* ignore */ }
}

/** Validate callback state against what we stored; clears it either way. */
export function consumeOAuthState(received) {
  const expected = peekOAuthState();
  clearOAuthState();
  if (!expected || !received || expected !== received) return false;
  return true;
}

function defaultRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Authorize URL for Connect GitHub.
 * GitHub App "Request user authorization during installation" is on, so this
 * OAuth authorize endpoint covers both install and user-to-server token.
 */
export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  if (!clientId) return null;
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri || githubRedirectUri());
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/** sessionStorage token helpers — token never goes to the server after exchange. */
export function loadGithubToken() {
  if (typeof sessionStorage === 'undefined') return null;
  const t = sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY);
  return t || null;
}

export function saveGithubToken(token) {
  if (typeof sessionStorage === 'undefined') return;
  if (!token) {
    sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, String(token));
}

export function clearGithubToken() {
  saveGithubToken(null);
  clearGithubTokenBundle();
}

export function hasGithubToken() {
  return !!loadGithubToken();
}

/**
 * Resolve Client ID from runtime config and/or Vite env.
 * Returns '' when unset — Connect stays disabled with a setup hint.
 */
/**
 * Runtime Client ID from GET /api/config (App fills this). AuthStep / LoginModal
 * call resolveGithubClientId() without props — without this cache they only see
 * VITE_* and Sign-in stays dead when the ID is server-only (Tailscale / prod).
 */
let runtimeGithubClientId = '';

export function rememberGithubClientId(clientId) {
  runtimeGithubClientId = String(clientId || '').trim();
  return runtimeGithubClientId;
}

export function peekGithubClientId() {
  return runtimeGithubClientId;
}

export function resolveGithubClientId({ configClientId, viteClientId } = {}) {
  const fromConfig = String(configClientId || '').trim();
  if (fromConfig) return fromConfig;
  if (runtimeGithubClientId) return runtimeGithubClientId;
  const fromVite = String(
    viteClientId
    ?? (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GITHUB_APP_CLIENT_ID)
    ?? '',
  ).trim();
  return fromVite;
}

/**
 * POST code to the stateless exchange endpoint. Returns
 * `{ access_token, token_type?, scope?, refresh_token?, expires_in? }` or throws.
 * Never logs the token.
 */
export async function exchangeCodeForToken({
  code,
  redirectUri,
  fetchImpl = globalThis.fetch,
  exchangePath = GITHUB_TOKEN_EXCHANGE_PATH,
} = {}) {
  if (!code) throw new Error('Missing OAuth code');
  const res = await fetchImpl(exchangePath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code: String(code),
      redirect_uri: redirectUri || githubRedirectUri(),
    }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body?.error || body?.message || `Token exchange failed (${res.status})`;
    throw new Error(msg);
  }
  if (!body?.access_token) {
    throw new Error(body?.error || 'Token exchange returned no access_token');
  }
  return {
    access_token: body.access_token,
    token_type: body.token_type || 'bearer',
    scope: body.scope || '',
    refresh_token: body.refresh_token || '',
    expires_in: Number(body.expires_in) || 0,
    refresh_token_expires_in: Number(body.refresh_token_expires_in) || 0,
  };
}

/** In-flight + completed results keyed by OAuth code (Strict Mode remount / double effect). */
const callbackInflight = new Map();
const callbackDone = new Map();

/** Test hook — clear callback dedupe maps between golden cases. */
export function resetGithubCallbackDedupe() {
  callbackInflight.clear();
  callbackDone.clear();
}

/**
 * Handle `/git/callback?code=&state=`: validate state, exchange, store token.
 * Returns `{ ok: true, token }` or `{ ok: false, error }`.
 *
 * Safe under React Strict Mode: the same `code` reuses one in-flight / done
 * result so a remount cannot clear sessionStorage state then fail validation.
 * State is cleared only after a definitive outcome (success or exchange error
 * with a matched state), not on peek.
 */
export async function completeGithubCallback(search, options = {}) {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  const code = params.get?.('code') || params.code;
  const state = params.get?.('state') || params.state;
  const err = params.get?.('error') || params.error;
  if (err) {
    return { ok: false, error: String(params.get?.('error_description') || err) };
  }
  if (!code) return { ok: false, error: 'Missing code' };

  const key = String(code);
  if (callbackDone.has(key)) return callbackDone.get(key);
  if (callbackInflight.has(key)) return callbackInflight.get(key);

  const run = (async () => {
    const expected = peekOAuthState();
    if (!expected) {
      return { ok: false, error: GITHUB_OAUTH_STATE_MISSING_HINT };
    }
    if (!state || expected !== String(state)) {
      clearOAuthState();
      return { ok: false, error: 'Invalid or missing OAuth state' };
    }
    try {
      const token = await exchangeCodeForToken({
        code,
        redirectUri: options.redirectUri || githubRedirectUri(options.origin),
        fetchImpl: options.fetchImpl,
        exchangePath: options.exchangePath,
      });
      clearOAuthState();
      saveGithubToken(token.access_token);
      rememberGithubTokenBundle(token);
      return { ok: true, token: token.access_token };
    } catch (e) {
      clearOAuthState();
      return { ok: false, error: e?.message || String(e) };
    }
  })();

  callbackInflight.set(key, run);
  try {
    const result = await run;
    callbackDone.set(key, result);
    return result;
  } finally {
    callbackInflight.delete(key);
  }
}

/**
 * Start GitHub OAuth (Connect or Sign in). Same authorize URL, state, and
 * /git/callback as G7. Returns false when Client ID is missing.
 */
export function startGithubOAuth({
  clientId,
  redirectUri,
  assign = typeof window !== 'undefined' ? (url) => window.location.assign(url) : null,
} = {}) {
  const id = resolveGithubClientId({ configClientId: clientId });
  if (!id) return false;
  const state = createOAuthState();
  const url = buildAuthorizeUrl({
    clientId: id,
    redirectUri: redirectUri || githubRedirectUri(),
    state,
  });
  if (!url || typeof assign !== 'function') return false;
  assign(url);
  return true;
}

/** Race a promise against a timeout; does not cancel the underlying work. */
export function withTimeout(promise, ms, label = 'operation') {
  const timeoutMs = Math.max(0, Number(ms) || 0);
  if (!timeoutMs) return promise;
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

/** Default budget for app-session upsert so OAuth soft-nav cannot stick forever. */
export const GITHUB_SESSION_TIMEOUT_MS = 8000;

/**
 * After token exchange: POST access_token to /api/auth/github so the server
 * can verify with GitHub, upsert User.githubId (findOrCreateOAuth), and set
 * the Express session. Token is not stored server-side.
 * Returns `{ ok: true, user, isNew }` or `{ ok: false, error }`.
 */
export async function establishGithubSession({
  accessToken,
  fetchImpl = globalThis.fetch,
  sessionPath = GITHUB_SESSION_PATH,
  timeoutMs = GITHUB_SESSION_TIMEOUT_MS,
} = {}) {
  if (!accessToken) return { ok: false, error: 'Missing access token' };

  const run = async () => {
  let res;
  try {
    res = await fetchImpl(sessionPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify(withAnalyticsConsent({ access_token: String(accessToken) })),
    });
  } catch (e) {
    return { ok: false, error: e?.message || 'Session upsert unreachable' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    return { ok: false, error: body?.error || body?.message || `Session upsert failed (${res.status})` };
  }
  if (!body?.user) {
    return { ok: false, error: body?.error || 'Session upsert returned no user' };
  }
  return { ok: true, user: body.user, isNew: !!body.isNew };
  };

  try {
    return await withTimeout(run(), timeoutMs, 'GitHub session upsert');
  } catch (e) {
    return { ok: false, error: e?.message || 'Session upsert timed out' };
  }
}
