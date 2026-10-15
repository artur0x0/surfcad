/**
 * Browser-side WebSocket client: pairs with a local process and dispatches
 * bridge commands through `window.surfcad.call`.
 */

import { PAIR_MSG } from './relayHub.js';

/**
 * @typedef {'idle' | 'advertising' | 'pending' | 'paired'} TabPairState
 */

/**
 * @param {{
 *   url: string,
 *   token: string,
 *   call: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean, result?: unknown, error?: { code?: string, message?: string } }>,
 *   onState?: (state: TabPairState) => void,
 * }} opts
 */
export function createAgentBridgeTabConnection(opts) {
  const { url, token, call, onState } = opts;
  /** @type {WebSocket | null} */
  let ws = null;
  let state = 'idle';

  function setState(next) {
    state = next;
    onState?.(state);
  }

  function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  async function handleCall(msg) {
    const id = msg.id;
    const command = msg.command;
    const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
    try {
      const env = await call(command, args);
      if (env.ok) {
        send({ id, ok: true, result: env.result });
      } else {
        send({ id, ok: false, error: env.error || { code: 'refused', message: 'Command refused' } });
      }
    } catch (err) {
      send({
        id,
        ok: false,
        error: { code: 'internal', message: String(err?.message || err) },
      });
    }
  }

  function connect() {
    if (ws) {
      try { ws.close(); } catch { /* noop */ }
      ws = null;
    }
    setState('advertising');
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      send({ type: PAIR_MSG.REGISTER_TAB, token });
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === PAIR_MSG.PAIR_REQUEST) {
        setState('pending');
        return;
      }
      if (msg.type === PAIR_MSG.PAIRED) {
        setState('paired');
        return;
      }
      if (msg.type === PAIR_MSG.UNPAIRED) {
        setState('advertising');
        return;
      }
      if (typeof msg.command === 'string') {
        void handleCall(msg);
      }
    });
    ws.addEventListener('close', () => {
      ws = null;
      setState('idle');
    });
  }

  function approvePair() {
    send({ type: PAIR_MSG.PAIR_APPROVE });
  }

  function rejectPair() {
    send({ type: PAIR_MSG.PAIR_REJECT });
    setState('advertising');
  }

  function disconnect() {
    if (ws) {
      try { ws.close(); } catch { /* noop */ }
      ws = null;
    }
    setState('idle');
  }

  return {
    getState: () => state,
    connect,
    approvePair,
    rejectPair,
    disconnect,
  };
}
