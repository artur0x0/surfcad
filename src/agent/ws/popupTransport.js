/**
 * Popup transport for the Local agent relay: a WebSocket-shaped object that
 * carries relay frames through the loopback bridge page
 * (`http://127.0.0.1:<port>/bridge`) with postMessage.
 *
 * Used where the page cannot open `ws://127.0.0.1` itself (Safari on https).
 * Must be created inside a click handler: it calls `window.open`.
 *
 * Besides the WebSocket events it emits `relay` when the bridge page first
 * answers (the relay is up). Until then it quietly reloads the window with
 * backoff (`retryDelaysMs`, last delay repeats) for as long as the window is
 * open: there is no give-up state.
 */

import { BRIDGE_CHANNEL, BRIDGE_CLOSE_REASON, BRIDGE_MSG, BRIDGE_PAGE_PATH } from './bridgeMessages.js';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export const BRIDGE_WINDOW_NAME = 'surfcad-agent-bridge';
export const BRIDGE_WINDOW_FEATURES = 'popup=yes,width=460,height=340';
/** Reload backoff while the relay is not up; the last (cap) delay repeats. */
export const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 3000]);

/**
 * @param {string} wsUrl e.g. `ws://127.0.0.1:17341`
 * @returns {string | null} e.g. `http://127.0.0.1:17341/bridge`
 */
export function bridgePageUrlForWsUrl(wsUrl) {
  let url;
  try {
    url = new URL(String(wsUrl || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'ws:') return null;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  if (!url.port) return null;
  return `http://${url.hostname}:${url.port}${BRIDGE_PAGE_PATH}`;
}

/** @param {{ getRandomValues: (a: Uint8Array) => Uint8Array }} cryptoImpl */
export function createBridgeNonce(cryptoImpl = globalThis.crypto) {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {{
 *   wsUrl: string,
 *   win?: Window,
 *   nonce?: string,
 *   retryDelaysMs?: number[],
 *   pollMs?: number,
 * }} opts
 */
export function createPopupBridgeSocket(opts) {
  const win = opts.win || window;
  const pageUrl = bridgePageUrlForWsUrl(opts.wsUrl);
  const retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const pollMs = opts.pollMs ?? 500;
  const nonce = opts.nonce || createBridgeNonce();

  /** @type {Map<string, Set<(event: object) => void>>} */
  const listeners = new Map();
  let readyState = CONNECTING;
  let helloSent = false;
  let popup = null;
  let retryTimer = null;
  let pollTimer = null;
  let popupUrl = '';
  const bridgeOrigin = pageUrl ? new URL(pageUrl).origin : '';

  function emit(type, event) {
    for (const cb of [...(listeners.get(type) || [])]) {
      try { cb({ type, ...event }); } catch (err) { setTimeout(() => { throw err; }); }
    }
  }

  function post(payload) {
    if (!popup || popup.closed) return;
    try {
      popup.postMessage({ channel: BRIDGE_CHANNEL, nonce, ...payload }, bridgeOrigin);
    } catch { /* popup gone */ }
  }

  function teardown() {
    stopRetrying();
    if (pollTimer != null) clearInterval(pollTimer);
    pollTimer = null;
    win.removeEventListener('message', onMessage);
  }

  function stopRetrying() {
    if (retryTimer != null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function finish(code, reason) {
    if (readyState === CLOSED) return;
    readyState = CLOSED;
    teardown();
    emit('close', { code, reason, wasClean: code === 1000 });
  }

  function onMessage(event) {
    if (!popup || event.source !== popup || event.origin !== bridgeOrigin) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.channel !== BRIDGE_CHANNEL || msg.nonce !== nonce) return;
    if (msg.type === BRIDGE_MSG.READY) {
      if (helloSent) return;
      helloSent = true;
      stopRetrying();
      emit('relay', {});
      post({ type: BRIDGE_MSG.HELLO });
      return;
    }
    if (msg.type === BRIDGE_MSG.OPEN) {
      if (readyState !== CONNECTING) return;
      readyState = OPEN;
      emit('open', {});
      return;
    }
    if (msg.type === BRIDGE_MSG.FRAME) {
      if (readyState === OPEN && typeof msg.data === 'string') emit('message', { data: msg.data });
      return;
    }
    if (msg.type === BRIDGE_MSG.CLOSE) {
      finish(typeof msg.code === 'number' ? msg.code : 1006, typeof msg.reason === 'string' ? msg.reason : '');
    }
  }

  const socket = {
    get readyState() { return readyState; },
    get popup() { return popup; },
    transport: 'popup',
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    /** @param {string} data */
    send(data) {
      if (readyState !== OPEN) return;
      post({ type: BRIDGE_MSG.FRAME, data: String(data) });
    },
    close() {
      if (readyState === CLOSED) return;
      post({ type: BRIDGE_MSG.CLOSE });
      try { popup?.close(); } catch { /* noop */ }
      finish(1000, 'client_close');
    },
  };

  const failSoon = (reason) => {
    setTimeout(() => finish(4000, reason), 0);
  };

  if (!pageUrl) {
    failSoon(BRIDGE_CLOSE_REASON.BRIDGE_UNREACHABLE);
    return socket;
  }

  win.addEventListener('message', onMessage);
  const fragment = `nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(win.location.origin)}`;
  // The query makes a reused named window navigate (and re-run) instead of
  // only changing its fragment.
  const session = nonce.slice(0, 8);
  popupUrl = `${pageUrl}?s=${session}#${fragment}`;
  try {
    popup = win.open(popupUrl, BRIDGE_WINDOW_NAME, BRIDGE_WINDOW_FEATURES);
  } catch {
    popup = null;
  }
  if (!popup) {
    failSoon(BRIDGE_CLOSE_REASON.POPUP_BLOCKED);
    return socket;
  }

  // An opener may navigate the window it opened without a new click.
  let attempt = 0;
  const scheduleRetry = () => {
    const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)];
    attempt += 1;
    retryTimer = setTimeout(() => {
      if (helloSent || readyState === CLOSED) return;
      try { popup.location.replace(popupUrl); } catch { /* window gone */ }
      scheduleRetry();
    }, delay);
  };
  scheduleRetry();

  pollTimer = setInterval(() => {
    if (popup.closed) finish(4000, BRIDGE_CLOSE_REASON.BRIDGE_CLOSED);
  }, pollMs);

  return socket;
}
