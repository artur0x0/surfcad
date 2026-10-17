/**
 * Quiet loopback relay reachability check (browser).
 *
 * A failed handshake is not always "relay not running": the upgrade 403s for a
 * disallowed Origin, and a secure page may block ws:// even when HTTP works.
 * Those map to UI banners without waiting for startPairing.
 */

/**
 * @typedef {'origin_rejected' | 'browser_blocked' | null} RelayProbeIssue
 * @typedef {{ ok: boolean, issue: RelayProbeIssue }} RelayProbeResult
 */

function wsUrlToHttp(url) {
  if (typeof url !== 'string') return '';
  return url.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
}

/**
 * Classify a failed WebSocket handshake from the HTTP follow-up.
 * Only a visible HTTP 403 is origin_rejected. CORS-hidden + opaque OK on a
 * secure page is what Chrome Local Network Access blocking looks like, so
 * that is browser_blocked (insecure pages keep polling with null). A timeout
 * / connection error is null so the poller keeps waiting.
 *
 * @param {{
 *   corsStatus?: number | null,
 *   corsFailed?: boolean,
 *   opaqueOk?: boolean,
 *   timedOut?: boolean,
 *   pageSecure?: boolean,
 * }} input
 * @returns {RelayProbeIssue}
 */
export function classifyRelayHandshakeFailure(input = {}) {
  if (input.corsStatus === 403) return 'origin_rejected';
  if (input.corsFailed && input.opaqueOk) {
    return input.pageSecure === true ? 'browser_blocked' : null;
  }
  if (input.timedOut && !input.opaqueOk) return null;
  if (!input.corsFailed && input.corsStatus != null && input.corsStatus !== 403) {
    return input.pageSecure === true ? 'browser_blocked' : null;
  }
  return null;
}

/**
 * @param {string} httpUrl
 * @param {{ timeoutMs: number, fetchImpl: typeof fetch, pageSecure: boolean }} opts
 * @returns {Promise<RelayProbeIssue>}
 */
async function classifyViaHttp(httpUrl, opts) {
  const { timeoutMs, fetchImpl, pageSecure } = opts;
  if (typeof fetchImpl !== 'function' || !httpUrl) {
    return pageSecure ? 'browser_blocked' : null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const get = (mode) => fetchImpl(httpUrl, { method: 'GET', mode, signal: ctrl.signal });
  try {
    const [corsSettled, opaqueSettled] = await Promise.all([
      get('cors').then((r) => ({ failed: false, status: r.status })).catch(() => ({ failed: true, status: null })),
      get('no-cors').then((r) => ({ failed: false, type: r.type })).catch(() => ({ failed: true })),
    ]);
    return classifyRelayHandshakeFailure({
      corsStatus: corsSettled.status,
      corsFailed: corsSettled.failed,
      opaqueOk: !opaqueSettled.failed,
      timedOut: false,
      pageSecure,
    });
  } catch {
    return classifyRelayHandshakeFailure({
      corsFailed: true,
      opaqueOk: false,
      timedOut: true,
      pageSecure,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   pageSecure?: boolean,
 *   fetch?: typeof fetch,
 *   WebSocket?: typeof WebSocket,
 * }} [options]
 * @returns {Promise<RelayProbeResult>}
 */
export function probeRelayWebSocket(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const pageSecure = options.pageSecure === true;
  const fetchImpl = options.fetch || globalThis.fetch;
  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;

  return new Promise((resolve) => {
    if (typeof WebSocketImpl === 'undefined') {
      resolve({ ok: false, issue: null });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    /** @type {{ close: () => void, addEventListener: (type: string, cb: (event: any) => void) => void } | undefined} */
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch {
      finish({ ok: false, issue: null });
      return;
    }
    const timer = setTimeout(() => {
      try { ws?.close(); } catch { /* noop */ }
      finish({ ok: false, issue: null });
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* noop */ }
      finish({ ok: true, issue: null });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* noop */ }
      void classifyViaHttp(wsUrlToHttp(url), { timeoutMs, fetchImpl, pageSecure }).then((issue) => {
        finish({ ok: false, issue });
      });
    });
  });
}
