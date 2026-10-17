/**
 * Silent GitHub re-auth, then the interactive redirect as a last resort.
 *
 * GitHub's authorize URL has no `prompt=none`. When this user has already
 * granted the App, GitHub redirects straight back to /git/callback with a
 * code and does not show consent. A popup can finish that round-trip and
 * postMessage the opener without tearing down the CAD page.
 *
 * A full-page redirect is the last resort (the Reconnect button). It unloads
 * the Manifold worker; the popup does not, which is why the silent attempt
 * is a popup rather than location.assign.
 *
 * Safari drops the user-gesture flag across an await, so the blank popup is
 * opened in the tap turn and only navigated if the quiet refresh fails.
 * If it succeeds, the blank window is closed.
 *
 * OAuth `state` for this popup is stashed beside the refresh bundle. The
 * popup is a new browsing context, so it cannot see the opener's
 * sessionStorage. githubAuth.js reads that stash through setOAuthStateExtra
 * and never names the other store itself.
 */
import {
  buildAuthorizeUrl,
  clearOAuthState,
  createOAuthState,
  githubRedirectUri,
  resolveGithubClientId,
  saveGithubToken,
  setOAuthStateExtra,
  startGithubOAuth,
} from './githubAuth.js';
import { loadGithubTokenBundle } from './githubTokenRefresh.js';

export const POPUP_STATE_KEY = 'surfcad.github.oauth.popupState';
export const POPUP_MODE_KEY = 'surfcad.github.oauth.popup';
export const OAUTH_MESSAGE_TYPE = 'surfcad-github-oauth';
export const SILENT_POPUP_NAME = 'surfcad-github-reauth';
export const SILENT_POPUP_FEATURES = 'popup=yes,width=480,height=720';
/** Budget for an already-authorized redirect. Consent past this is "needs a person". */
export const SILENT_OAUTH_TIMEOUT_MS = 12000;

function localStore() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function installPopupOAuthState() {
  setOAuthStateExtra({
    peek: () => {
      try {
        return localStore()?.getItem(POPUP_STATE_KEY) || null;
      } catch {
        return null;
      }
    },
    clear: () => {
      try { localStore()?.removeItem(POPUP_STATE_KEY); } catch { /* private mode */ }
    },
  });
}

export function markPopupOAuth(state) {
  const store = localStore();
  if (!store) return false;
  try {
    store.setItem(POPUP_MODE_KEY, '1');
    if (state) store.setItem(POPUP_STATE_KEY, String(state));
    return true;
  } catch {
    return false;
  }
}

export function isGithubPopupHandoff() {
  try {
    if (localStore()?.getItem(POPUP_MODE_KEY) !== '1') return false;
  } catch {
    return false;
  }
  return typeof window !== 'undefined' && !!window.opener;
}

export function finishPopupOAuth() {
  const store = localStore();
  if (!store) return;
  try {
    store.removeItem(POPUP_MODE_KEY);
    store.removeItem(POPUP_STATE_KEY);
  } catch { /* private mode */ }
}

export function postPopupOAuthResult(target, payload, origin) {
  if (!target || typeof target.postMessage !== 'function') return false;
  target.postMessage({ type: OAUTH_MESSAGE_TYPE, ...payload }, origin);
  return true;
}

function defaultOpen(url, name, features) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  try {
    return window.open(url, name, features);
  } catch {
    return null;
  }
}

function pointPopup(popup, url) {
  if (!popup) return;
  if (typeof popup.navigate === 'function') {
    popup.navigate(url);
    return;
  }
  if (popup.location && typeof popup.location === 'object') popup.location.href = url;
}

function readRestoredAccessToken() {
  const bundle = loadGithubTokenBundle();
  return bundle.accessToken || '';
}

function waitForPopupResult({
  popup,
  timeoutMs,
  origin,
  addEventListener,
  removeEventListener,
}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { removeEventListener('message', onMessage); } catch { /* ignore */ }
      resolve(result);
    };
    const onMessage = (event) => {
      if (!origin || event?.origin !== origin) return;
      if (!popup || event?.source !== popup) return;
      const data = event?.data;
      if (!data || data.type !== OAUTH_MESSAGE_TYPE) return;
      if (!data.ok) {
        finish({ ok: false, reason: 'exchange-failed', error: data.error || '' });
        return;
      }
      const accessToken = readRestoredAccessToken();
      if (accessToken) {
        try { saveGithubToken(accessToken); } catch { /* ignore */ }
      }
      finish({
        ok: !!accessToken,
        accessToken,
        reason: accessToken ? 'silent' : 'no-token',
      });
    };
    addEventListener('message', onMessage);
    const timer = setTimeout(() => finish({ ok: false, reason: 'needs-user' }), timeoutMs);
  });
}

/**
 * Quiet refresh already failed. Navigate the gesture-opened popup at GitHub
 * and wait. Closes the popup unless a caller wants to keep a consent screen
 * (we close: Reconnect starts a fresh full-page flow).
 */
export async function completeSilentPopup({
  popup,
  clientId,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
  timeoutMs = SILENT_OAUTH_TIMEOUT_MS,
  addEventListener = typeof window !== 'undefined'
    ? window.addEventListener.bind(window)
    : () => {},
  removeEventListener = typeof window !== 'undefined'
    ? window.removeEventListener.bind(window)
    : () => {},
} = {}) {
  if (!popup) return { ok: false, reason: 'blocked', accessToken: '' };
  const id = resolveGithubClientId({ configClientId: clientId });
  if (!id) {
    try { popup.close(); } catch { /* ignore */ }
    return { ok: false, reason: 'no-client', accessToken: '' };
  }
  const state = createOAuthState();
  markPopupOAuth(state);
  const url = buildAuthorizeUrl({
    clientId: id,
    redirectUri: githubRedirectUri(origin),
    state,
  });
  if (!url) {
    try { popup.close(); } catch { /* ignore */ }
    finishPopupOAuth();
    return { ok: false, reason: 'no-client', accessToken: '' };
  }
  pointPopup(popup, url);
  const result = await waitForPopupResult({
    popup,
    timeoutMs,
    origin,
    addEventListener,
    removeEventListener,
  });
  try { popup.close(); } catch { /* already closed */ }
  if (!result.ok) {
    clearOAuthState();
    finishPopupOAuth();
  }
  return {
    ok: !!result.ok,
    accessToken: result.accessToken || '',
    reason: result.reason || (result.ok ? 'silent' : 'needs-user'),
    error: result.error || '',
  };
}

/**
 * Tap orchestration. Opens the blank popup first so the gesture survives
 * the refresh await. `refresh` returns the githubTokenRefresh result.
 */
export async function runReconnectAttempt({
  refresh,
  openWindow = defaultOpen,
  clientId,
  origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  timeoutMs = SILENT_OAUTH_TIMEOUT_MS,
  addEventListener,
  removeEventListener,
  onStep = null,
} = {}) {
  const popup = openWindow
    ? openWindow('about:blank', SILENT_POPUP_NAME, SILENT_POPUP_FEATURES)
    : null;
  onStep?.('refresh');
  let fresh = null;
  try {
    fresh = typeof refresh === 'function' ? await refresh() : null;
  } catch (err) {
    fresh = { ok: false, failure: 'failed', error: err?.message || 'refresh failed' };
  }
  if (fresh?.ok && fresh.accessToken) {
    try { popup?.close(); } catch { /* ignore */ }
    return { ok: true, via: 'refresh', accessToken: fresh.accessToken, failure: null };
  }
  onStep?.('silent');
  if (!popup) {
    return {
      ok: false,
      via: 'blocked',
      accessToken: '',
      failure: fresh?.unsupported ? 'unsupported' : (fresh?.failure || 'failed'),
    };
  }
  const silent = await completeSilentPopup({
    popup,
    clientId,
    origin,
    timeoutMs,
    addEventListener,
    removeEventListener,
  });
  if (silent.ok && silent.accessToken) {
    return { ok: true, via: 'silent', accessToken: silent.accessToken, failure: null };
  }
  return {
    ok: false,
    via: silent.reason || 'needs-user',
    accessToken: '',
    failure: fresh?.unsupported ? 'unsupported' : (fresh?.failure || 'failed'),
  };
}

/** Last resort: full-page OAuth. Clears a leftover popup flag first. */
export function startInteractiveGithubOAuth(options = {}) {
  finishPopupOAuth();
  return startGithubOAuth(options);
}

installPopupOAuthState();
