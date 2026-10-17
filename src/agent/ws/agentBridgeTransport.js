/**
 * Local agent transports. The pairing UI picks one with
 * {@link agentBridgePairingMode} and hands `createSocket` to
 * `createAgentBridgeTabConnection`; nothing else needs to know which is used.
 *
 * Relay detection differs per transport:
 * - `direct`: `probeRelay(url)` opens and closes a WebSocket; poll it freely.
 * - `popup`: there is no background probe (Safari cannot open the socket, and
 *   the bridge window may only open from a click). Open the connection from
 *   the user's click; the socket emits `relay` when the relay answers (the
 *   bridge page loaded). Until then the window reloads quietly with backoff
 *   capped at 3 s, for as long as it is open.
 */

import { createPopupBridgeSocket } from './popupTransport.js';

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, WebSocketCtor?: typeof WebSocket }} [opts]
 * @returns {Promise<boolean>}
 */
export function probeRelayDirect(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const WebSocketCtor = opts.WebSocketCtor || globalThis.WebSocket;
  return new Promise((resolve) => {
    let ws;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* noop */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WebSocketCtor(url);
    } catch {
      finish(false);
      return;
    }
    ws.addEventListener('open', () => finish(true));
    ws.addEventListener('error', () => finish(false));
    ws.addEventListener('close', () => finish(false));
  });
}

/**
 * @typedef {{
 *   mode: 'direct' | 'popup',
 *   opensWindow: boolean,
 *   createSocket: (url: string) => import('./tabConnection.js').AgentBridgeSocket,
 *   probeRelay: ((url: string) => Promise<boolean>) | null,
 * }} AgentBridgeTransport
 */

/**
 * @param {{ mode: 'direct' | 'popup', win?: Window, retryDelaysMs?: number[] }} opts
 * @returns {AgentBridgeTransport}
 */
export function createAgentBridgeTransport(opts) {
  if (opts.mode === 'popup') {
    return {
      mode: 'popup',
      opensWindow: true,
      createSocket: (url) => createPopupBridgeSocket({
        wsUrl: url, win: opts.win, retryDelaysMs: opts.retryDelaysMs,
      }),
      probeRelay: null,
    };
  }
  return {
    mode: 'direct',
    opensWindow: false,
    createSocket: (url) => new WebSocket(url),
    probeRelay: (url) => probeRelayDirect(url),
  };
}
