/**
 * Quiet loopback relay reachability check (browser).
 */

/**
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export function probeRelayWebSocket(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    /** @type {WebSocket | undefined} */
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try { ws?.close(); } catch { /* noop */ }
      finish(false);
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* noop */ }
      finish(true);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}
