import { WebSocket } from 'ws';
import { connectPeer } from './nodeClient.mjs';
import { PAIR_MSG } from './relayMessages.mjs';
import { redactToken } from './bridge/relayHub.mjs';
import { RECONNECT_HINT, pairPendingError, pairingLostError } from './errors.mjs';
import { createPromptSession } from './prompt/promptSession.mjs';

const DEFAULT_WS_URL = 'ws://127.0.0.1:17341';

/** Backoff between automatic re-pair attempts after the tab drops. */
export const DEFAULT_RECONNECT_DELAYS_MS = Object.freeze([250, 500, 1000, 2000, 3000, 5000]);

/**
 * @typedef {'unpaired' | 'pairing' | 'paired' | 'lost'} RelaySessionState
 */

export function defaultRelayUrl() {
  const fromEnv = process.env.SURFCAD_AGENT_BRIDGE_WS_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return DEFAULT_WS_URL;
}

function defaultSessionLog(line) {
  console.error(`${new Date().toISOString()} [surfcad-mcp] ${line}`);
}

function notPaired() {
  return Object.assign(new Error('Not paired'), { code: 'not_paired' });
}

/**
 * @param {unknown} err
 */
function pairError(err) {
  const code = err && typeof err === 'object' && typeof err.code === 'string' ? err.code : 'pair_failed';
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'pair_rejected') {
    return Object.assign(new Error('Pairing rejected in SurfCAD (user clicked Deny)'), { code });
  }
  if (code === 'unknown_token') {
    return Object.assign(new Error('No SurfCAD tab is showing this pairing code'), {
      code,
      hint: RECONNECT_HINT,
    });
  }
  if (code === 'relay_unreachable') {
    return Object.assign(new Error('The local agent bridge relay is not running'), {
      code,
      hint: 'Restart the MCP server (npx surfcad-mcp), then keep the SurfCAD tab open in Chrome.',
    });
  }
  return Object.assign(new Error(message), { code: code === 'relay_error' ? 'pair_failed' : code });
}

export class RelaySession {
  /** @type {WebSocket | null} */
  #ws = null;
  #url;
  #code = '';
  /** @type {string | null} */
  #resumeKey = null;
  /** @type {RelaySessionState} */
  #state = 'unpaired';
  /** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
  #pending = new Map();
  /** @type {{ code: string, promise: Promise<{ paired: true, token: string, relay: string }> } | null} */
  #pairing = null;
  #generation = 0;
  /** @type {string | null} */
  #lostReason = null;
  #lostAt = 0;
  #attempt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  /** @type {readonly number[]} */
  #delays;
  /** @type {(() => Promise<unknown>) | null} */
  #ensureRelay;
  /** @type {(line: string) => void} */
  #log;
  /** @type {ReturnType<typeof createPromptSession>} */
  #prompts;

  /**
   * @param {{
   *   url?: string,
   *   reconnectDelaysMs?: readonly number[],
   *   ensureRelay?: () => Promise<unknown>,
   *   onLog?: (line: string) => void,
   *   promptSession?: ReturnType<typeof createPromptSession>,
   *   postWebhook?: (url: string, body: object, meta: { pinAddress?: string, insecureTls: boolean, authorization?: string }) => Promise<{ ok: boolean, error?: string }>,
   *   testWebhookOverride?: () => boolean,
   *   resolveHost?: (hostname: string) => Promise<string[]>,
   *   now?: () => number,
   *   setTimer?: (fn: () => void, ms: number) => unknown,
   *   clearTimer?: (timer: unknown) => void,
   * }} [options]
   */
  constructor(options = {}) {
    this.#url = options.url || defaultRelayUrl();
    this.#delays = options.reconnectDelaysMs?.length ? options.reconnectDelaysMs : DEFAULT_RECONNECT_DELAYS_MS;
    this.#ensureRelay = options.ensureRelay || null;
    this.#log = options.onLog || defaultSessionLog;
    this.#prompts = options.promptSession || createPromptSession({
      send: (payload) => this.#sendToTab(payload),
      postWebhook: options.postWebhook,
      testWebhookOverride: options.testWebhookOverride,
      resolveHost: options.resolveHost,
      now: options.now,
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
    });
  }

  get url() {
    return this.#url;
  }

  get pairingCode() {
    return this.#code;
  }

  /** @returns {RelaySessionState} */
  get state() {
    return this.#state;
  }

  status() {
    return {
      state: this.#state,
      lostReason: this.#state === 'lost' ? this.#lostReason : null,
      lostForMs: this.#state === 'lost' ? Date.now() - this.#lostAt : 0,
    };
  }

  isPaired() {
    return this.#state === 'paired' && this.#ws != null && this.#ws.readyState === WebSocket.OPEN;
  }

  /** In-memory prompt queue and webhook for this pairing. */
  get prompts() {
    return this.#prompts;
  }

  /**
   * A tool call after a prompt arrives. A model-changing call (`mutates`)
   * marks the agent working; a read-only call keeps the state alive.
   * Best-effort: a dead socket does not fail the tool call.
   * @param {{ mutates?: boolean }} [info]
   */
  noteAgentToolCall(info = {}) {
    try {
      this.#prompts.noteToolCall(info);
    } catch {
      /* status is advisory */
    }
  }

  /**
   * @param {object} payload
   */
  #sendToTab(payload) {
    if (!this.isPaired()) throw notPaired();
    const ws = /** @type {WebSocket} */ (this.#ws);
    ws.send(JSON.stringify(payload));
  }

  /**
   * @param {string} token
   */
  pair(token) {
    const code = String(token || '').trim().toUpperCase();
    if (!code) {
      return Promise.reject(Object.assign(new Error('Pairing code is required'), { code: 'bad_pairing_code' }));
    }
    if (this.#pairing && this.#pairing.code === code) return this.#pairing.promise;
    if (this.isPaired() && this.#code === code) {
      return Promise.resolve({ paired: true, token: code, relay: this.#url });
    }
    const resume = code === this.#code ? this.#resumeKey : null;
    const recovering = this.#state === 'lost' && code === this.#code;
    this.#clearTimer();
    this.#detach(new Error('Re-pairing'), 'not_paired');
    this.#code = code;
    if (!recovering) {
      this.#resumeKey = null;
      this.#state = 'pairing';
    }
    return this.#startPairing(code, resume);
  }

  /**
   * @param {string} code
   * @param {string | null} resume
   */
  #startPairing(code, resume) {
    const generation = ++this.#generation;
    const promise = connectPeer(this.#url, code, { resume }).then(
      ({ ws, resumeKey }) => {
        if (generation !== this.#generation) {
          try { ws.close(); } catch { /* noop */ }
          throw notPaired();
        }
        this.#pairing = null;
        this.#attach(ws, resumeKey);
        return { paired: true, token: code, relay: this.#url };
      },
      (err) => {
        if (generation === this.#generation) {
          this.#pairing = null;
          if (this.#state === 'lost') this.#scheduleReconnect();
          else this.#state = 'unpaired';
        }
        throw pairError(err);
      },
    );
    this.#pairing = { code, promise };
    return promise;
  }

  /**
   * @param {WebSocket} ws
   * @param {string | null} resumeKey
   */
  #attach(ws, resumeKey) {
    const restored = this.#state === 'lost';
    this.#ws = ws;
    this.#resumeKey = resumeKey;
    this.#state = 'paired';
    this.#attempt = 0;
    if (restored) {
      this.#log(`pairing restored token=${redactToken(this.#code)} after ${Date.now() - this.#lostAt}ms`);
    }
    this.#lostReason = null;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === PAIR_MSG.UNPAIRED) {
        this.#lose(ws, typeof msg.detail === 'string' ? `${msg.reason}: ${msg.detail}` : String(msg.reason || 'unpaired'));
        return;
      }
      if (msg.type === PAIR_MSG.AGENT_PROMPT) {
        void this.#prompts.acceptPrompt(msg);
        return;
      }
      if (msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL) {
        const cancelId = typeof msg.id === 'string' ? msg.id : '';
        void this.#prompts.cancel(cancelId).then((result) => {
          try {
            this.#sendToTab({
              type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT,
              v: 1,
              id: result.id,
              state: result.state,
            });
          } catch {
            /* unpaired before the result could be sent */
          }
        }, () => {});
        return;
      }
      const id = typeof msg.id === 'string' ? msg.id : null;
      const waiter = id ? this.#pending.get(id) : undefined;
      if (waiter) {
        this.#pending.delete(id);
        if (msg.ok === true) {
          waiter.resolve(msg.result);
          return;
        }
        const error = msg.error && typeof msg.error === 'object'
          ? msg.error
          : { code: 'bridge_error', message: 'Command refused' };
        // hint and retryable ride along when the tab sent them (the server
        // fills in a hint from its own table when it did not).
        waiter.reject(Object.assign(new Error(error.message || error.code || 'Bridge call failed'), {
          code: error.code,
          details: error.details,
          ...(typeof error.hint === 'string' && error.hint ? { hint: error.hint } : {}),
          ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
        }));
        return;
      }
      if (msg.type === PAIR_MSG.ERROR && msg.id == null) {
        this.#lose(ws, `relay_error ${msg.code || 'unknown'}`);
      }
    });
    ws.on('close', () => { this.#lose(ws, 'relay_closed'); });
    ws.on('error', () => { /* `close` follows */ });
  }

  /**
   * @param {WebSocket} ws
   * @param {string} reason
   */
  #lose(ws, reason) {
    if (this.#ws !== ws) return;
    this.#prompts.clear();
    this.#ws = null;
    try { ws.close(); } catch { /* noop */ }
    this.#state = 'lost';
    this.#lostAt = Date.now();
    this.#lostReason = reason;
    this.#log(`pairing lost token=${redactToken(this.#code)} reason=${reason}; reconnecting`);
    const err = pairingLostError(reason);
    for (const waiter of this.#pending.values()) waiter.reject(err);
    this.#pending.clear();
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.#timer || this.#state !== 'lost' || this.#pairing) return;
    const delay = this.#delays[Math.min(this.#attempt, this.#delays.length - 1)];
    this.#attempt += 1;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#reconnectOnce();
    }, delay);
    if (typeof this.#timer.unref === 'function') this.#timer.unref();
  }

  async #reconnectOnce() {
    if (this.#state !== 'lost' || this.#pairing) return;
    try {
      await this.#startPairing(this.#code, this.#resumeKey);
    } catch (err) {
      if (this.#state !== 'lost') return;
      if (err?.code === 'pair_rejected') {
        this.#log(`pairing denied in SurfCAD token=${redactToken(this.#code)}; stopped reconnecting`);
        this.#state = 'unpaired';
        this.#resumeKey = null;
        this.#clearTimer();
        return;
      }
      if (err?.code === 'relay_unreachable' && this.#ensureRelay) {
        await this.#ensureRelay().catch(() => {});
      }
    }
  }

  #clearTimer() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * @param {Error} reason
   * @param {string} code
   */
  #detach(reason, code) {
    const endPrompts = this.#state === 'paired' || this.#state === 'lost';
    this.#generation += 1;
    this.#pairing = null;
    if (endPrompts) this.#prompts.clear();
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      try { ws.close(); } catch { /* noop */ }
    }
    const err = Object.assign(reason, { code });
    for (const waiter of this.#pending.values()) waiter.reject(err);
    this.#pending.clear();
  }

  /**
   * Never waits on a dead link: while unpaired or lost this rejects at once.
   *
   * @param {string} command
   * @param {Record<string, unknown>} [args]
   */
  call(command, args = {}) {
    if (this.#state === 'lost') return Promise.reject(pairingLostError(this.#lostReason || undefined));
    if (this.#state === 'pairing') return Promise.reject(pairPendingError());
    if (!this.isPaired()) return Promise.reject(notPaired());
    const ws = /** @type {WebSocket} */ (this.#ws);
    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        ws.send(JSON.stringify({ id, command, args }));
      } catch {
        this.#lose(ws, 'send_failed');
      }
    });
  }

  disconnect() {
    this.#clearTimer();
    this.#detach(new Error('Disconnected'), 'not_paired');
    this.#state = 'unpaired';
    this.#resumeKey = null;
  }
}

export { PAIR_MSG };
