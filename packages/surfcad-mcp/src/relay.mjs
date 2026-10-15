import { WebSocket } from 'ws';
import { connectPeer } from '../../../src/agent/ws/nodeClient.js';
import { PAIR_MSG } from '../../../src/agent/ws/relayHub.js';

const DEFAULT_WS_URL = 'ws://127.0.0.1:17341';

export function defaultRelayUrl() {
  const fromEnv = process.env.SURFCAD_AGENT_BRIDGE_WS_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return DEFAULT_WS_URL;
}

/**
 * @param {WebSocket} ws
 * @param {string} command
 * @param {Record<string, unknown>} args
 * @param {string | number} id
 */
export function invokeBridge(ws, command, args = {}, id = '1') {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.id !== id) return;
      ws.off('message', onMessage);
      if (msg.ok === true) {
        resolve(msg.result);
        return;
      }
      const error = msg.error && typeof msg.error === 'object'
        ? msg.error
        : { code: 'bridge_error', message: 'Command refused' };
      reject(Object.assign(new Error(error.message || error.code || 'Bridge call failed'), {
        code: error.code,
        details: error.details,
      }));
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, command, args }));
  });
}

export class RelaySession {
  /** @type {WebSocket | null} */
  #ws = null;
  #url;
  #code = '';

  constructor(options = {}) {
    this.#url = options.url || defaultRelayUrl();
  }

  get url() {
    return this.#url;
  }

  get pairingCode() {
    return this.#code;
  }

  isPaired() {
    return this.#ws != null && this.#ws.readyState === WebSocket.OPEN;
  }

  /**
   * @param {string} token
   */
  async pair(token) {
    const code = String(token || '').trim().toUpperCase();
    if (!code) {
      throw Object.assign(new Error('Pairing code is required'), { code: 'bad_pairing_code' });
    }
    if (this.#ws) {
      try { this.#ws.close(); } catch { /* noop */ }
      this.#ws = null;
    }
    this.#code = code;
    try {
      this.#ws = await connectPeer(this.#url, code);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/rejected/i.test(message) || message.includes('pair_rejected')) {
        throw Object.assign(new Error('Pairing rejected in SurfCAD (user clicked Deny)'), {
          code: 'pair_rejected',
        });
      }
      if (/unknown_token/i.test(message)) {
        throw Object.assign(new Error('No SurfCAD tab is showing this pairing code'), {
          code: 'unknown_token',
        });
      }
      throw Object.assign(new Error(message), { code: err?.code || 'pair_failed' });
    }
    this.#ws.on('close', () => {
      this.#ws = null;
    });
    return { paired: true, token: code, relay: this.#url };
  }

  async call(command, args = {}) {
    if (!this.isPaired()) {
      throw Object.assign(new Error('Not paired'), { code: 'not_paired' });
    }
    return invokeBridge(this.#ws, command, args, `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  disconnect() {
    if (this.#ws) {
      try { this.#ws.close(); } catch { /* noop */ }
      this.#ws = null;
    }
  }
}

export { PAIR_MSG };
