/**
 * Outbound session to the server relay. WebSocket first; if that upgrade
 * fails, commands go over HTTPS POST plus SSE, then long-poll.
 * The bearer token is never logged and is never placed in the URL.
 */

import { WebSocket } from 'ws';
import {
  AGENT_HANDSHAKE_UPDATE_MESSAGE,
  AGENT_PROTOCOL_VERSION,
  commandRequest,
} from '../commandProtocol.mjs';
import {
  asRemoteError,
  clientUpdateError,
  pairingLostError,
  tokenRevokedError,
} from '../errors.mjs';
import { PAIR_MSG } from '../relayMessages.mjs';
import { createPromptSession } from '../prompt/promptSession.mjs';
import { agentUrls, resolveAgentName } from './config.mjs';
import { callOverHttp, resultFromCommandResponse } from './httpFallback.mjs';

/** Server relay closes a revoked or expired token with this code. */
const TOKEN_CLOSE_CODE = 4001;
const HELLO_TIMEOUT_MS = 8000;

/**
 * @param {string} wsUrl
 * @param {string} token
 */
function openAuthorizedSocket(wsUrl, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${token}` },
      handshakeTimeout: HELLO_TIMEOUT_MS,
    });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch { /* noop */ }
      reject(err);
    };
    ws.once('unexpected-response', (_req, res) => {
      const status = res.statusCode || 0;
      res.resume();
      if (status === 401) {
        fail(tokenRevokedError());
        return;
      }
      fail(Object.assign(new Error(`WebSocket upgrade failed (${status})`), {
        code: 'ws_blocked',
        statusCode: status,
      }));
    });
    ws.once('error', (error) => {
      const errno = error && typeof error === 'object' ? error.code : '';
      const code = errno === 'ECONNREFUSED' || errno === 'ENOTFOUND' ? 'unreachable' : 'ws_blocked';
      const err = error instanceof Error ? error : new Error(String(error));
      fail(Object.assign(err, { code: /** @type {Error & { code?: string }} */ (err).code || code }));
    });
    ws.once('open', () => {
      if (settled) return;
      settled = true;
      resolve(ws);
    });
  });
}

/**
 * Hello frame. `name` is omitted when empty so the server keeps its default.
 * @param {{ v?: number, name?: string }} fields
 */
export function agentHelloFrame(fields = {}) {
  /** @type {{ type: 'hello', v: number, name?: string }} */
  const frame = {
    type: 'hello',
    v: typeof fields.v === 'number' ? fields.v : AGENT_PROTOCOL_VERSION,
  };
  if (typeof fields.name === 'string' && fields.name.trim()) frame.name = fields.name.trim();
  return frame;
}

function defaultLog(line) {
  console.error(`${new Date().toISOString()} [surfcad-mcp] ${line}`);
}

export class RemoteSession {
  /** @type {WebSocket | null} */
  #ws = null;
  #urls;
  #token;
  #name;
  #fillFromClient;
  #protocolVersion;
  /** @type {'ws' | 'http' | null} */
  #transport = null;
  /** @type {'unpaired' | 'pairing' | 'paired'} */
  #state = 'unpaired';
  /** @type {Promise<void> | null} */
  #connecting = null;
  /** @type {{ resolve: () => void, reject: (err: Error) => void } | null} */
  #hello = null;
  /** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
  #pending = new Map();
  #log;
  #fetch;
  #prompts;

  /**
   * @param {{
   *   serverUrl: string,
   *   token: string,
   *   name?: string,
   *   fillNameFromClient?: boolean,
   *   protocolVersion?: number,
   *   onLog?: (line: string) => void,
   *   fetch?: typeof fetch,
   *   env?: NodeJS.ProcessEnv,
   *   promptSession?: ReturnType<typeof createPromptSession>,
   * }} options
   */
  constructor(options) {
    this.#urls = agentUrls(options.serverUrl);
    this.#token = options.token;
    this.#name = typeof options.name === 'string' ? options.name.trim() : '';
    this.#fillFromClient = options.fillNameFromClient === true && !this.#name;
    this.#protocolVersion = typeof options.protocolVersion === 'number'
      ? options.protocolVersion
      : AGENT_PROTOCOL_VERSION;
    this.#log = options.onLog || defaultLog;
    this.#fetch = options.fetch || fetch;
    this.#prompts = options.promptSession || createPromptSession({
      send: (payload) => this.#sendToTab(payload),
    });
  }

  get url() {
    return this.#urls.wsUrl;
  }

  get state() {
    return this.#state;
  }

  get agentName() {
    return this.#name;
  }

  /** True when hello should wait for the MCP client name. */
  needsClientName() {
    return this.#fillFromClient && !this.#name;
  }

  /**
   * @param {{ name?: string } | null | undefined} clientInfo
   */
  applyClientInfo(clientInfo) {
    if (!this.#fillFromClient || this.#name) return;
    const name = resolveAgentName({ clientInfo });
    if (name) this.#name = name;
  }

  /**
   * @param {string} name
   */
  setName(name) {
    const text = typeof name === 'string' ? name.trim() : '';
    if (text) this.#name = text;
  }

  status() {
    return {
      state: this.#state,
      transport: this.#transport,
      remote: true,
      server: this.#urls.origin,
    };
  }

  isPaired() {
    if (this.#state !== 'paired') return false;
    if (this.#transport === 'http') return true;
    return this.#ws != null && this.#ws.readyState === WebSocket.OPEN;
  }

  get prompts() {
    return this.#prompts;
  }

  /**
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
   * @param {boolean} held
   */
  holdAgentWork(held) {
    try {
      this.#prompts.holdWork(held === true);
    } catch {
      /* status is advisory */
    }
  }

  /**
   * Already logged in. The 6-character code is the local relay's; remote
   * mode ignores it and reports the saved login.
   * @param {string} [_] local pairing code; a remote login ignores it
   */
  pair(_) {
    return this.connect().then(() => ({
      paired: true,
      remote: true,
      relay: this.#urls.approvalUrl,
    }));
  }

  connect() {
    if (this.#state === 'paired' && this.isPaired()) return Promise.resolve();
    if (!this.#connecting) this.#connecting = this.#connect();
    return this.#connecting;
  }

  async #connect() {
    this.#state = 'pairing';
    try {
      await this.#openWebSocket();
      this.#transport = 'ws';
      this.#state = 'paired';
      this.#log('remote agent connected via websocket');
      return;
    } catch (err) {
      this.#dropSocket();
      const code = err && typeof err === 'object' ? err.code : '';
      if (code === 'token_revoked' || code === 'client_update_required') {
        // Stay 'pairing' so a later tool call reaches `call()` and surfaces this error.
        this.#state = 'pairing';
        this.#connecting = null;
        throw err;
      }
      try {
        await this.#probeHttp();
      } catch (probeErr) {
        this.#state = 'pairing';
        this.#connecting = null;
        throw probeErr;
      }
      this.#transport = 'http';
      this.#state = 'paired';
      this.#log('remote agent connected via https fallback');
    }
  }

  async #openWebSocket() {
    const ws = await openAuthorizedSocket(this.#urls.wsUrl, this.#token);
    this.#ws = ws;
    ws.on('message', (raw) => this.#onMessage(raw));
    ws.on('close', (code, reason) => this.#onClose(code, reason));
    ws.on('error', () => { /* close follows */ });
    const hello = agentHelloFrame({ v: this.#protocolVersion, name: this.#name });
    const acked = new Promise((resolve, reject) => {
      this.#hello = { resolve, reject };
      const timer = setTimeout(() => {
        if (this.#hello) {
          this.#hello = null;
          reject(Object.assign(new Error('Agent handshake timed out'), { code: 'ws_blocked' }));
        }
      }, HELLO_TIMEOUT_MS);
      const settle = this.#hello;
      this.#hello = {
        resolve: () => {
          clearTimeout(timer);
          settle.resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          settle.reject(err);
        },
      };
    });
    ws.send(JSON.stringify(hello));
    await acked;
  }

  async #probeHttp() {
    try {
      const res = await this.#fetch(this.#urls.approvalUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(HELLO_TIMEOUT_MS),
      });
      try { await res.body?.cancel?.(); } catch { /* noop */ }
      if (!res.status) {
        throw Object.assign(new Error('Could not reach the SurfCAD agent server.'), { code: 'unreachable' });
      }
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'unreachable') throw err;
      throw Object.assign(new Error('Could not reach the SurfCAD agent server.'), { code: 'unreachable' });
    }
  }

  #dropSocket() {
    const ws = this.#ws;
    this.#ws = null;
    this.#hello = null;
    if (!ws) return;
    ws.removeAllListeners();
    try { ws.terminate(); } catch { /* noop */ }
  }

  /**
   * @param {import('ws').RawData} raw
   */
  #onMessage(raw) {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (this.#hello) {
      const hello = this.#hello;
      this.#hello = null;
      if (msg.type === 'hello') {
        hello.resolve();
        return;
      }
      const text = typeof msg.error === 'string' ? msg.error : '';
      hello.reject(asRemoteError({
        code: text.includes(AGENT_HANDSHAKE_UPDATE_MESSAGE) ? 'client_update_required' : 'ws_blocked',
        message: text || 'Agent handshake failed',
      }));
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
          /* socket closed before the result could be sent */
        }
      }, () => {});
      return;
    }
    const id = msg.id == null ? '' : String(msg.id);
    const waiter = id ? this.#pending.get(id) : undefined;
    if (!waiter) return;
    this.#pending.delete(id);
    const outcome = resultFromCommandResponse(msg);
    if (outcome.ok) waiter.resolve(outcome.result);
    else waiter.reject(outcome.error);
  }

  /**
   * @param {number} code
   * @param {Buffer | string} reason
   */
  #onClose(code, reason) {
    const why = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '');
    const hello = this.#hello;
    this.#hello = null;
    this.#ws = null;
    if (code === TOKEN_CLOSE_CODE) {
      this.#transport = null;
      this.#state = 'pairing';
      this.#connecting = null;
      const err = tokenRevokedError();
      if (hello) hello.reject(err);
      this.#failPending(err);
      return;
    }
    if (code === 1008 || why.includes(AGENT_HANDSHAKE_UPDATE_MESSAGE)) {
      this.#transport = null;
      this.#state = 'pairing';
      this.#connecting = null;
      const err = clientUpdateError(why || AGENT_HANDSHAKE_UPDATE_MESSAGE);
      if (hello) hello.reject(err);
      this.#failPending(err);
      return;
    }
    if (hello) {
      hello.reject(Object.assign(new Error(`WebSocket closed (${code})`), { code: 'ws_blocked' }));
      return;
    }
    if (this.#state === 'paired' && this.#transport === 'ws') {
      this.#transport = 'http';
      this.#log('websocket closed; later commands use https');
      this.#failPending(pairingLostError('socket closed'));
    }
  }

  /**
   * @param {Error} err
   */
  #failPending(err) {
    for (const waiter of this.#pending.values()) waiter.reject(err);
    this.#pending.clear();
  }

  /**
   * @param {object} payload
   */
  #sendToTab(payload) {
    if (this.#transport !== 'ws' || !this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw Object.assign(
        new Error('In-viewer prompts need the agent WebSocket. This session is using the HTTPS fallback.'),
        {
          code: 'prompts_need_websocket',
          hint: 'This session is on the HTTPS fallback because WebSocket was blocked. In-viewer prompts need the WebSocket; retry where the agent server allows wss.',
        },
      );
    }
    this.#ws.send(JSON.stringify(payload));
  }

  /**
   * @param {string} command
   * @param {Record<string, unknown>} [args]
   */
  call(command, args = {}) {
    return this.connect().then(() => this.#call(command, args));
  }

  /**
   * @param {string} command
   * @param {Record<string, unknown>} args
   */
  #call(command, args) {
    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const frame = commandRequest({ id, command, args });
    if (this.#transport === 'ws' && this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve, reject) => {
        this.#pending.set(id, { resolve, reject });
        try {
          this.#ws.send(JSON.stringify(frame));
        } catch {
          this.#pending.delete(id);
          reject(pairingLostError('send failed'));
        }
      });
    }
    return callOverHttp({
      commandsUrl: this.#urls.commandsUrl,
      token: this.#token,
      frame,
      fetch: this.#fetch,
    }).catch((err) => {
      throw asRemoteError(err);
    });
  }

  disconnect() {
    this.#connecting = null;
    this.#dropSocket();
    this.#transport = null;
    this.#state = 'unpaired';
    this.#prompts.clear();
    this.#failPending(Object.assign(new Error('Disconnected'), { code: 'not_paired' }));
  }
}
