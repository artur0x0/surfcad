/**
 * Loopback popup bridge (browser side). The relay serves this file at
 * `/bridge.js` for the page at `http://127.0.0.1:<port>/bridge`.
 *
 * Safari blocks `ws://127.0.0.1` from https://surfcad.com as mixed content.
 * A top-level page on the relay's own origin can open that socket, so the
 * SurfCAD tab opens this page as a popup and the two exchange frames with
 * postMessage. Nothing here touches the socket until the opener proves it is
 * an allowlisted SurfCAD origin holding the session nonce.
 *
 * Must stay dependency-free: it runs in the browser and is imported by tests.
 * Kept in sync with `src/agent/ws/bridgeMessages.js`.
 */

export const BRIDGE_CHANNEL = 'surfcad-agent-bridge';

export const BRIDGE_MSG = Object.freeze({
  /** popup → opener: page loaded, waiting for hello */
  READY: 'bridge_ready',
  /** opener → popup: open the relay socket */
  HELLO: 'bridge_hello',
  /** popup → opener: relay socket is open */
  OPEN: 'bridge_open',
  /** both ways: one relay frame (string) */
  FRAME: 'bridge_frame',
  /** both ways: socket closed / please close it */
  CLOSE: 'bridge_close',
});

export const BRIDGE_NONCE_RE = /^[A-Za-z0-9_-]{22,128}$/;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const PROD_SURFCAD_HOSTS = new Set(['surfcad.com', 'www.surfcad.com']);

/**
 * Same loopback rule as the relay allowlist, without `node:net`.
 * Four decimal octets only. A hostname is never prefix-matched.
 * @param {string} hostname
 */
function isLiteralLoopbackHost(hostname) {
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (LOCAL_HOSTNAMES.has(host)) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) {
    return Number(parts[0]) === 127;
  }
  const lower = host.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    const mapped = v4.split('.');
    return mapped.length === 4
      && mapped.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
      && Number(mapped[0]) === 127;
  }
  return false;
}

/**
 * Same rule as the relay's `isAllowedHttpOrigin`, but an opener must always
 * present an origin, and it must be a bare origin (no path, query or `null`).
 *
 * @param {unknown} origin
 * @param {Iterable<string>} [extraOrigins]
 */
export function isAllowedOpenerOrigin(origin, extraOrigins = []) {
  if (typeof origin !== 'string' || !origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  for (const extra of extraOrigins) {
    if (extra === origin) return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isLiteralLoopbackHost(url.hostname)) return true;
  return PROD_SURFCAD_HOSTS.has(url.hostname);
}

/**
 * @param {string} hash `location.hash`, with or without `#`
 * @returns {{ nonce: string, origin: string } | null}
 */
export function parseBridgeFragment(hash) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const params = new URLSearchParams(raw);
  const nonce = params.get('nonce') || '';
  const origin = params.get('origin') || '';
  if (!BRIDGE_NONCE_RE.test(nonce) || !origin) return null;
  return { nonce, origin };
}

/** @param {{ nonce: string, origin: string }} session */
export function formatBridgeFragment({ nonce, origin }) {
  return `nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(origin)}`;
}

/**
 * @typedef {'invalid' | 'forbidden' | 'no_opener' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'opener_gone'} PopupBridgeStatus
 */

/**
 * @param {{
 *   win: Window,
 *   WebSocketCtor?: typeof WebSocket,
 *   wsUrl?: string,
 *   extraOrigins?: string[],
 *   onStatus?: (status: PopupBridgeStatus) => void,
 *   readyIntervalMs?: number,
 *   readyAttempts?: number,
 *   openerPollMs?: number,
 * }} opts
 */
export function startPopupBridge(opts) {
  const win = opts.win;
  const WebSocketCtor = opts.WebSocketCtor || win.WebSocket;
  const wsUrl = opts.wsUrl || `ws://${win.location.host}`;
  const extraOrigins = opts.extraOrigins || [];
  const onStatus = opts.onStatus || (() => {});
  const readyIntervalMs = opts.readyIntervalMs ?? 200;
  const readyAttempts = opts.readyAttempts ?? 50;
  const openerPollMs = opts.openerPollMs ?? 1000;

  const session = parseBridgeFragment(win.location.hash);
  try {
    win.history?.replaceState?.(null, '', `${win.location.pathname}${win.location.search}`);
  } catch { /* fragment stays; harmless */ }

  /** @type {{ stop: () => void, status: () => PopupBridgeStatus }} */
  const inert = (status) => {
    onStatus(status);
    return { stop() {}, status: () => status };
  };
  if (!session) return inert('invalid');
  if (!isAllowedOpenerOrigin(session.origin, extraOrigins)) return inert('forbidden');
  const opener = win.opener;
  if (!opener) return inert('no_opener');

  const { nonce, origin } = session;
  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {PopupBridgeStatus} */
  let status = 'waiting';
  let stopped = false;
  let readyTimer = null;
  let openerTimer = null;

  function setStatus(next) {
    status = next;
    onStatus(next);
  }

  function post(payload) {
    try {
      // targetOrigin pins delivery: an opener on any other origin never sees this.
      opener.postMessage({ channel: BRIDGE_CHANNEL, nonce, ...payload }, origin);
    } catch { /* opener gone */ }
  }

  function clearReady() {
    if (readyTimer != null) win.clearInterval(readyTimer);
    readyTimer = null;
  }

  function closeSocket() {
    if (!ws) return;
    const s = ws;
    ws = null;
    try { s.close(); } catch { /* noop */ }
  }

  function openSocket() {
    if (ws || stopped) return;
    clearReady();
    setStatus('connecting');
    const socket = new WebSocketCtor(wsUrl);
    ws = socket;
    socket.addEventListener('open', () => {
      if (ws !== socket) return;
      setStatus('connected');
      post({ type: BRIDGE_MSG.OPEN });
    });
    socket.addEventListener('message', (event) => {
      if (ws !== socket) return;
      post({ type: BRIDGE_MSG.FRAME, data: String(event.data) });
    });
    socket.addEventListener('close', (event) => {
      if (ws !== socket) return;
      ws = null;
      post({ type: BRIDGE_MSG.CLOSE, code: event?.code ?? 1006, reason: event?.reason || '' });
      if (!stopped) setStatus('closed');
    });
  }

  function onMessage(event) {
    if (event.source !== opener || event.origin !== origin) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.channel !== BRIDGE_CHANNEL || msg.nonce !== nonce) return;
    if (msg.type === BRIDGE_MSG.HELLO) {
      openSocket();
      return;
    }
    if (msg.type === BRIDGE_MSG.FRAME) {
      if (ws && ws.readyState === 1 && typeof msg.data === 'string') ws.send(msg.data);
      return;
    }
    if (msg.type === BRIDGE_MSG.CLOSE) {
      closeSocket();
      post({ type: BRIDGE_MSG.CLOSE, code: 1000, reason: 'opener_close' });
      setStatus('closed');
    }
  }

  function stop(nextStatus = 'closed') {
    if (stopped) return;
    stopped = true;
    clearReady();
    if (openerTimer != null) win.clearInterval(openerTimer);
    win.removeEventListener('message', onMessage);
    closeSocket();
    setStatus(nextStatus);
  }

  win.addEventListener('message', onMessage);
  win.addEventListener('pagehide', () => stop('closed'));
  setStatus('waiting');

  let attempts = 0;
  post({ type: BRIDGE_MSG.READY });
  readyTimer = win.setInterval(() => {
    attempts += 1;
    if (ws || attempts >= readyAttempts) {
      clearReady();
      return;
    }
    post({ type: BRIDGE_MSG.READY });
  }, readyIntervalMs);

  openerTimer = win.setInterval(() => {
    if (!opener || opener.closed) stop('opener_gone');
  }, openerPollMs);

  return { stop, status: () => status };
}

const STATUS_TEXT = {
  invalid: 'This window only works when SurfCAD opens it. Close it and use the Local agent panel in SurfCAD.',
  forbidden: 'This window was not opened by SurfCAD, so it will not connect. Close it.',
  no_opener: 'This window lost its link to the SurfCAD tab. Close it, then click Reconnect in SurfCAD.',
  waiting: 'Connecting to the SurfCAD tab…',
  connecting: 'Connecting to the local agent…',
  connected: 'Connected. Keep this window open while your agent works in SurfCAD.',
  closed: 'The local agent disconnected. Keep this window open — SurfCAD will reconnect.',
  opener_gone: 'The SurfCAD tab was closed. You can close this window.',
};

/** @param {PopupBridgeStatus} status */
export function popupBridgeStatusText(status) {
  return STATUS_TEXT[status] || '';
}

function bootFromDocument() {
  const doc = globalThis.document;
  const root = doc?.documentElement;
  if (!root || root.dataset.surfcadBridge !== '1') return;
  let extraOrigins = [];
  try {
    const parsed = JSON.parse(root.dataset.extraOrigins || '[]');
    if (Array.isArray(parsed)) extraOrigins = parsed.filter((o) => typeof o === 'string');
  } catch { /* none */ }
  const statusEl = doc.getElementById('bridge-status');
  startPopupBridge({
    win: globalThis.window,
    extraOrigins,
    onStatus: (status) => {
      root.dataset.status = status;
      if (statusEl) statusEl.textContent = popupBridgeStatusText(status);
    },
  });
}

bootFromDocument();
