/**
 * Popup transport for the Local agent relay: a WebSocket-shaped object that
 * carries relay frames through the loopback bridge page
 * (`http://127.0.0.1:<port>/bridge`) with postMessage.
 *
 * Used where the page cannot open `ws://127.0.0.1` itself (Safari on https).
 * `window.open` runs only when this session has never opened a window, or
 * after a click calls {@link createPopupBridgeSession}'s `armOpen` (Reconnect).
 * A timer or focus reconnect that finds a previously opened, now-closed
 * window must not `window.open` — it ends the socket with `bridge_closed`.
 *
 * A socket emits `relay` when the bridge page first answers (the relay is
 * up). Until then it quietly reloads the window with backoff
 * (`retryDelaysMs`, last delay repeats) for as long as the window is open:
 * there is no give-up state.
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
 * One bridge window for many logical sockets. `tabConnection` calls
 * `createSocket` on every reconnect. `window.open` is allowed only for the
 * first window, or after `armOpen` from a click.
 *
 * @param {{
 *   win?: Window,
 *   nonce?: string,
 *   retryDelaysMs?: number[],
 *   pollMs?: number,
 * }} [opts]
 */
export function createPopupBridgeSession(opts = {}) {
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  const retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const pollMs = opts.pollMs ?? 500;
  const sessionNonce = opts.nonce || null;

  let popup = null;
  let attachCount = 0;
  let generation = 0;
  let disposed = false;
  let openArmed = false;
  /** @type {null | (() => void)} */
  let retireActive = null;

  /** Call from a click (Reconnect) before `createSocket` may `window.open` again. */
  function armOpen() {
    openArmed = true;
  }

  function createSocket(wsUrl) {
    if (retireActive) {
      const retire = retireActive;
      retireActive = null;
      retire();
    }
    const myGen = ++generation;
    const pageUrl = bridgePageUrlForWsUrl(wsUrl);
    const nonce = sessionNonce || createBridgeNonce();
    const bridgeOrigin = pageUrl ? new URL(pageUrl).origin : '';

    /** @type {Map<string, Set<(event: object) => void>>} */
    const listeners = new Map();
    let readyState = CONNECTING;
    let helloSent = false;
    let retryTimer = null;
    let pollTimer = null;
    let popupUrl = '';

    function stillMine() {
      return !disposed && generation === myGen;
    }

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

    function stopRetrying() {
      if (retryTimer != null) clearTimeout(retryTimer);
      retryTimer = null;
    }

    function teardown() {
      stopRetrying();
      if (pollTimer != null) clearInterval(pollTimer);
      pollTimer = null;
      if (win) win.removeEventListener('message', onMessage);
    }

    function finish(code, reason) {
      if (readyState === CLOSED) return;
      readyState = CLOSED;
      teardown();
      if (retireActive && generation === myGen) retireActive = null;
      emit('close', { code, reason, wasClean: code === 1000 });
    }

    function onMessage(event) {
      if (!stillMine() || !popup || event.source !== popup || event.origin !== bridgeOrigin) return;
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

    function retire() {
      if (readyState === CLOSED) return;
      // Drop this logical socket only. Do not close the window, and do not
      // post CLOSE — a newer attach may already be handshaking.
      readyState = CLOSED;
      teardown();
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
        if (stillMine()) post({ type: BRIDGE_MSG.CLOSE });
        finish(1000, 'client_close');
      },
    };

    const failSoon = (reason) => {
      setTimeout(() => finish(4000, reason), 0);
    };

    if (!pageUrl || !win) {
      failSoon(BRIDGE_CLOSE_REASON.BRIDGE_UNREACHABLE);
      return socket;
    }

    const previouslyOpened = popup != null;
    if (previouslyOpened && popup.closed && !openArmed) {
      failSoon(BRIDGE_CLOSE_REASON.BRIDGE_CLOSED);
      return socket;
    }

    win.addEventListener('message', onMessage);
    attachCount += 1;
    const fragment = `nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(win.location.origin)}`;
    popupUrl = `${pageUrl}?s=${attachCount}#${fragment}`;

    const needOpen = !popup || popup.closed;
    if (needOpen) {
      openArmed = false;
      try {
        popup = win.open(popupUrl, BRIDGE_WINDOW_NAME, BRIDGE_WINDOW_FEATURES);
      } catch {
        popup = null;
      }
      if (!popup) {
        failSoon(BRIDGE_CLOSE_REASON.POPUP_BLOCKED);
        return socket;
      }
    } else {
      // An opener may navigate the window it opened without a new click.
      try { popup.location.replace(popupUrl); } catch { /* window gone */ }
    }

    let attempt = 0;
    const scheduleRetry = () => {
      const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(() => {
        if (helloSent || readyState === CLOSED || !stillMine()) return;
        try { popup.location.replace(popupUrl); } catch { /* window gone */ }
        scheduleRetry();
      }, delay);
    };
    scheduleRetry();

    pollTimer = setInterval(() => {
      if (popup.closed) finish(4000, BRIDGE_CLOSE_REASON.BRIDGE_CLOSED);
    }, pollMs);

    retireActive = retire;
    return socket;
  }

  function dispose() {
    disposed = true;
    generation += 1;
    if (retireActive) {
      const retire = retireActive;
      retireActive = null;
      retire();
    }
    try { popup?.close(); } catch { /* noop */ }
    popup = null;
  }

  return {
    createSocket,
    armOpen,
    dispose,
    get popup() { return popup; },
  };
}

/**
 * One-shot socket: opens the window on create and closes it on `close()`.
 * Prefer {@link createPopupBridgeSession} when `tabConnection` will reconnect.
 *
 * @param {{
 *   wsUrl: string,
 *   win?: Window,
 *   nonce?: string,
 *   retryDelaysMs?: number[],
 *   pollMs?: number,
 * }} opts
 */
export function createPopupBridgeSocket(opts) {
  const session = createPopupBridgeSession(opts);
  const sock = session.createSocket(opts.wsUrl);
  const innerClose = sock.close.bind(sock);
  sock.close = () => {
    innerClose();
    session.dispose();
  };
  return sock;
}
