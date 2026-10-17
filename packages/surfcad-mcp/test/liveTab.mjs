/**
 * Test helper: the real browser tab client (`src/agent/ws/tabConnection.js`)
 * over Node `ws`, with a switch that makes the relay unreachable for the tab.
 */
import { WebSocket } from 'ws';
import { createAgentBridgeTabConnection } from '../../../src/agent/ws/tabConnection.js';

const UNREACHABLE_URL = 'ws://127.0.0.1:1';

/**
 * @param {string} url
 * @param {string} token
 * @param {{
 *   call?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean, result?: unknown }>,
 *   reconnectDelaysMs?: number[],
 *   lostAfterMs?: number,
 * }} [options]
 */
export function liveTab(url, token, options = {}) {
  /** @type {WebSocket[]} */
  const sockets = [];
  const states = [];
  const links = [];
  let prompts = 0;
  let offline = false;
  const conn = createAgentBridgeTabConnection({
    url,
    token,
    call: options.call || (async (name) => ({ ok: true, result: { command: name } })),
    createSocket: (u) => {
      const ws = new WebSocket(offline ? UNREACHABLE_URL : u, { headers: { Origin: 'https://surfcad.com' } });
      ws.on('error', () => { /* surfaced as close */ });
      sockets.push(ws);
      return /** @type {any} */ (ws);
    },
    onState: (state) => {
      states.push(state);
      // Stands in for the user clicking Allow in the approval popup.
      if (state === 'pending') {
        prompts += 1;
        conn.approvePair();
      }
    },
    onLink: (link) => { links.push(link); },
    reconnectDelaysMs: options.reconnectDelaysMs || [50, 100, 200],
    lostAfterMs: options.lostAfterMs,
  });

  return {
    conn,
    states,
    links,
    get prompts() { return prompts; },
    connect() { conn.connect(); },
    /** Kill the tab's relay socket and keep it from reconnecting until `goOnline`. */
    killSocket() {
      offline = true;
      sockets.at(-1)?.terminate();
    },
    goOnline() {
      offline = false;
      conn.reconnectNow();
    },
    close() { conn.disconnect(); },
  };
}

/**
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 */
export async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
