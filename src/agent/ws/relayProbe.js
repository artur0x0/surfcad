/**
 * Quiet loopback relay reachability check (browser).
 *
 * Uses only the WebSocket handshake — never `http://` / `https://` to
 * loopback. Prod CSP allows `ws://127.0.0.1:17341` and not an HTTP fetch
 * to that port; a follow-up GET after a failed upgrade is what logged the
 * connect-src violations on Connect Agent.
 *
 * A failed handshake is not always "relay not running". Browsers hide the
 * HTTP status of a failed upgrade (connection refused and a raw 403 both
 * surface as `error` + close 1006), so the probe reads WebSocket events
 * instead: `open` means reachable; close 1008 / reason `origin_blocked` or
 * a hub `origin_blocked` message means origin_rejected; a constructor throw
 * on a secure page is browser_blocked (mixed content). Timeout and 1006
 * stay `issue: null` so the poller keeps showing "Waiting for relay…".
 */

import { issueFromRelayMessage } from './connectionErrors.js';

/**
 * @typedef {'origin_rejected' | 'browser_blocked' | null} RelayProbeIssue
 * @typedef {{ ok: boolean, issue: RelayProbeIssue }} RelayProbeResult
 */

/**
 * Classify a failed WebSocket handshake from WS events / close codes.
 * Policy close 1008 (or `origin_blocked` reason / hub error) is
 * origin_rejected. A constructor throw on https is browser_blocked.
 * Abnormal close 1006, timeout, and connection errors are null so the
 * poller keeps waiting.
 *
 * @param {{
 *   closeCode?: number | null,
 *   closeReason?: string | null,
 *   relayErrorCode?: string | null,
 *   constructorThrew?: boolean,
 *   pageSecure?: boolean,
 * }} input
 * @returns {RelayProbeIssue}
 */
export function classifyRelayHandshakeFailure(input = {}) {
  if (input.constructorThrew === true) {
    return input.pageSecure === true ? 'browser_blocked' : null;
  }
  if (input.relayErrorCode === 'origin_blocked') return 'origin_rejected';
  const reason = String(input.closeReason || '');
  if (input.closeCode === 1008 || reason === 'origin_blocked') return 'origin_rejected';
  return null;
}

function closeReasonText(reason) {
  if (reason == null) return '';
  if (typeof reason === 'string') return reason;
  if (typeof reason === 'object' && typeof reason.toString === 'function') {
    return reason.toString();
  }
  return String(reason);
}

/**
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   settleMs?: number,
 *   pageSecure?: boolean,
 *   WebSocket?: typeof WebSocket,
 * }} [options]
 * @returns {Promise<RelayProbeResult>}
 */
export function probeRelayWebSocket(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const settleMs = options.settleMs ?? 50;
  const pageSecure = options.pageSecure === true;
  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;

  return new Promise((resolve) => {
    if (typeof WebSocketImpl === 'undefined') {
      resolve({ ok: false, issue: null });
      return;
    }
    let settled = false;
    let opened = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let settleTimer = null;
    /** @type {{ close: () => void, addEventListener: (type: string, cb: (event: any) => void) => void } | undefined} */
    let ws;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      if (settleTimer != null) clearTimeout(settleTimer);
      try { ws?.close(); } catch { /* noop */ }
      resolve(result);
    };
    try {
      ws = new WebSocketImpl(url);
    } catch {
      finish({
        ok: false,
        issue: classifyRelayHandshakeFailure({ constructorThrew: true, pageSecure }),
      });
      return;
    }
    timer = setTimeout(() => {
      finish({ ok: opened, issue: null });
    }, timeoutMs);

    ws.addEventListener('open', () => {
      opened = true;
      // The relay may complete the upgrade and immediately policy-close
      // (1008 / origin_blocked). Wait a beat before treating open as ok.
      settleTimer = setTimeout(() => {
        try { ws?.close(); } catch { /* noop */ }
        finish({ ok: true, issue: null });
      }, settleMs);
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event?.data ?? ''));
      } catch {
        return;
      }
      const issue = issueFromRelayMessage(msg);
      if (issue) finish({ ok: false, issue });
    });
    ws.addEventListener('close', (event) => {
      const issue = classifyRelayHandshakeFailure({
        closeCode: event?.code,
        closeReason: closeReasonText(event?.reason),
        pageSecure,
      });
      if (issue) {
        finish({ ok: false, issue });
        return;
      }
      finish({ ok: opened, issue: null });
    });
    ws.addEventListener('error', () => {
      // Close usually follows with a code (1006 vs 1008). The timeout
      // covers sockets that error without a close event.
    });
  });
}
