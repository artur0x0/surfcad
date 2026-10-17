/**
 * Node WebSocket client for the M1 agent-bridge relay.
 */
import { WebSocket } from 'ws';
import { PAIR_MSG } from './relayMessages.mjs';

/**
 * Resolves once the tab approves. `resume` is the key the tab handed out on
 * the previous approval; a tab that still holds it re-approves without a prompt.
 *
 * @param {string} url
 * @param {string} token
 * @param {{ resume?: string | null }} [options]
 * @returns {Promise<{ ws: WebSocket, resumeKey: string | null }>}
 */
export function connectPeer(url, token, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      ws.removeAllListeners('message');
      try { ws.close(); } catch { /* noop */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    ws.once('open', () => {
      const pair = { type: PAIR_MSG.PAIR, token: token.trim().toUpperCase() };
      if (options.resume) pair.resume = options.resume;
      ws.send(JSON.stringify(pair));
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        fail(new Error('Invalid JSON from relay'));
        return;
      }
      if (msg?.type === PAIR_MSG.PAIRED) {
        settled = true;
        ws.removeAllListeners('message');
        ws.removeAllListeners('close');
        resolve({ ws, resumeKey: typeof msg.resumeKey === 'string' ? msg.resumeKey : null });
        return;
      }
      if (msg?.type === PAIR_MSG.ERROR || (msg?.code && !msg?.id)) {
        fail(Object.assign(new Error(msg.message || msg.code || 'Pairing failed'), {
          code: typeof msg.code === 'string' ? msg.code : 'pair_failed',
        }));
      }
    });
    ws.once('error', (err) => {
      fail(Object.assign(err instanceof Error ? err : new Error(String(err)), {
        code: err?.code === 'ECONNREFUSED' ? 'relay_unreachable' : (err?.code || 'relay_error'),
      }));
    });
    ws.once('close', () => {
      fail(Object.assign(new Error('Relay closed the connection before pairing finished'), { code: 'pair_cancelled' }));
    });
  });
}
