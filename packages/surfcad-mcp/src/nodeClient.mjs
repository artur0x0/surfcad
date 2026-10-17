/**
 * Node WebSocket client for the M1 agent-bridge relay.
 */
import { WebSocket } from 'ws';
import { PAIR_MSG } from './relayMessages.mjs';

/**
 * @param {string} url
 * @param {string} token
 * @returns {Promise<WebSocket>}
 */
export function connectPeer(url, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const fail = (err) => {
      ws.removeAllListeners('message');
      try { ws.close(); } catch { /* noop */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: PAIR_MSG.PAIR, token: token.trim().toUpperCase() }));
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
        ws.removeAllListeners('message');
        resolve(ws);
        return;
      }
      if (msg?.type === PAIR_MSG.ERROR || (msg?.code && !msg?.id)) {
        fail(new Error(msg.message || msg.code || 'Pairing failed'));
      }
    });
    ws.once('error', fail);
  });
}
