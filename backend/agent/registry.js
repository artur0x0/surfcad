import { commandRequest, commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createSystemClock } from './clock.js';
import {
  MAX_AGENTS_PER_USER,
  MAX_PENDING,
  MAX_TABS_PER_USER,
  RESULT_RETENTION_MS,
  TAB_ASLEEP_MS,
} from './limits.js';

export const TAB_ASLEEP_ERROR = 'SurfCAD tab is asleep';

/**
 * @param {string} userId
 * @param {string | number} id
 */
function commandKey(userId, id) {
  return `${userId}\0${String(id)}`;
}

/**
 * @param {{ id?: string | number }} frame
 */
function asleepResponse(frame) {
  return commandResponse({
    id: frame.id,
    ok: false,
    error: { code: 'tab_asleep', message: TAB_ASLEEP_ERROR },
  });
}

/**
 * In-memory tab registry for one Node process.
 *
 * The returned methods are the seam a later Redis pub/sub implementation
 * would fill: tab presence and command envelopes would be published instead
 * of held in these Maps. HTTP and WebSocket callers only see this object.
 * Command payloads stay here until the tab answers, the asleep timeout
 * fires, or the short result retention passes. They are not written anywhere else.
 *
 * @param {{
 *   clock?: ReturnType<typeof createSystemClock>,
 *   asleepMs?: number,
 *   retentionMs?: number,
 *   maxPending?: number,
 *   maxTabs?: number,
 *   maxAgents?: number,
 * }} [opts]
 */
export function createMemoryTabRegistry(opts = {}) {
  const clock = opts.clock || createSystemClock();
  const asleepMs = opts.asleepMs ?? TAB_ASLEEP_MS;
  const retentionMs = opts.retentionMs ?? RESULT_RETENTION_MS;
  const maxPending = opts.maxPending ?? MAX_PENDING;
  const maxTabs = opts.maxTabs ?? MAX_TABS_PER_USER;
  const maxAgents = opts.maxAgents ?? MAX_AGENTS_PER_USER;

  /**
   * @typedef {{ tabId: string, userId: string, send: (frame: object) => void, lastActiveAt: number, seq: number }} TabRecord
   * @typedef {{
   *   userId: string,
   *   tokenId: string,
   *   frame: { id?: string | number, command: string, args: unknown },
   *   deadline: number,
   *   sentTo: string | null,
   *   finished: boolean,
   *   listeners: Array<(response: object) => void>,
   *   abortWaiters: Array<() => void>,
   *   finish: (response: object) => void,
   * }} PendingCommand
   */

  /** @type {Map<string, { tabs: Map<string, TabRecord>, selectedId: string | null }>} */
  const users = new Map();
  /** @type {Map<string, Map<string, { agentId: string, userId: string, send: (frame: object) => void }>>} */
  const agents = new Map();
  /** @type {Map<string, PendingCommand>} */
  const pending = new Map();
  /** @type {Map<string, { userId: string, tokenId: string, response: object, at: number }>} */
  const completed = new Map();
  let seq = 0;
  /** @type {unknown} */
  let timer = null;

  function bucket(userId) {
    let found = users.get(userId);
    if (!found) {
      found = { tabs: new Map(), selectedId: null };
      users.set(userId, found);
    }
    return found;
  }

  /**
   * Presence only. Not sent from registerTab, so a tab that just joined
   * does not look like a command frame.
   * @param {string} userId
   * @param {boolean} connected
   */
  function notifyTabs(userId, connected) {
    const found = users.get(String(userId));
    if (!found) return;
    const frame = { type: 'agent', v: 1, connected: connected === true };
    for (const tab of found.tabs.values()) {
      try { tab.send(frame); } catch { /* a dead tab must not block the rest */ }
    }
  }

  /**
   * @param {string} userId
   * @param {object} frame
   * @param {'tabs' | 'agents'} side
   */
  function forward(userId, frame, side) {
    if (side === 'tabs') {
      const found = users.get(String(userId));
      if (!found) return;
      for (const tab of found.tabs.values()) {
        try { tab.send(frame); } catch { /* tab */ }
      }
      return;
    }
    const found = agents.get(String(userId));
    if (!found) return;
    for (const agent of found.values()) {
      try { agent.send(frame); } catch { /* agent */ }
    }
  }

  /** @param {string} userId */
  function activeTab(userId) {
    const found = users.get(userId);
    if (!found || found.tabs.size === 0) return null;
    if (found.selectedId && found.tabs.has(found.selectedId)) {
      return found.tabs.get(found.selectedId) || null;
    }
    /** @type {TabRecord | null} */
    let best = null;
    for (const tab of found.tabs.values()) {
      if (!best || tab.lastActiveAt > best.lastActiveAt || (tab.lastActiveAt === best.lastActiveAt && tab.seq > best.seq)) {
        best = tab;
      }
    }
    return best;
  }

  function sweep() {
    const t = clock.now();
    for (const item of [...pending.values()]) {
      if (item.deadline <= t) item.finish(asleepResponse(item.frame));
    }
    for (const [key, done] of [...completed.entries()]) {
      if (t - done.at >= retentionMs) completed.delete(key);
    }
  }

  function arm() {
    if (timer) clock.cancel(timer);
    timer = null;
    let next = Infinity;
    for (const item of pending.values()) {
      if (item.deadline < next) next = item.deadline;
    }
    for (const done of completed.values()) {
      const at = done.at + retentionMs;
      if (at < next) next = at;
    }
    if (next === Infinity) return;
    timer = clock.schedule(() => {
      timer = null;
      sweep();
      arm();
    }, Math.max(0, next - clock.now()));
  }

  /** @param {string} userId */
  function deliver(userId) {
    const tab = activeTab(userId);
    if (!tab) return;
    for (const item of pending.values()) {
      if (item.userId !== userId || item.finished || item.sentTo) continue;
      item.sentTo = tab.tabId;
      try {
        tab.send(commandRequest({
          id: item.frame.id,
          command: item.frame.command,
          args: item.frame.args,
        }));
      } catch {
        item.sentTo = null;
      }
    }
  }

  /**
   * A result belongs to the token that submitted it. Omitting `tokenId`
   * only matches a command that was queued without one.
   * @param {string} stored
   * @param {string | null} requested
   */
  function tokenMatches(stored, requested) {
    const issued = stored == null ? '' : String(stored);
    if (requested == null) return issued === '';
    return issued === requested;
  }

  return {
    /**
     * @param {{ userId: string, tabId: string, send: (frame: object) => void }} tab
     * @returns {boolean} false when this account is already at the tab cap
     */
    registerTab(tab) {
      const userId = String(tab.userId);
      const existing = users.get(userId);
      const replacing = existing?.tabs.has(tab.tabId) === true;
      if (!replacing && (existing?.tabs.size || 0) >= maxTabs) return false;
      const found = bucket(userId);
      seq += 1;
      found.tabs.set(tab.tabId, {
        tabId: tab.tabId,
        userId,
        send: tab.send,
        lastActiveAt: clock.now(),
        seq,
      });
      deliver(userId);
      return true;
    },

    /**
     * @param {string} userId
     * @param {string} tabId
     */
    unregisterTab(userId, tabId) {
      const found = users.get(String(userId));
      if (!found) return;
      found.tabs.delete(tabId);
      if (found.selectedId === tabId) found.selectedId = null;
      for (const item of pending.values()) {
        if (item.userId === String(userId) && item.sentTo === tabId) item.sentTo = null;
      }
      if (found.tabs.size === 0) users.delete(String(userId));
      else deliver(String(userId));
    },

    /**
     * @param {string} userId
     * @param {string} tabId
     */
    touchTab(userId, tabId) {
      const found = users.get(String(userId));
      const tab = found?.tabs.get(tabId);
      if (!tab) return false;
      tab.lastActiveAt = clock.now();
      seq += 1;
      tab.seq = seq;
      return true;
    },

    /** @param {string} userId */
    listTabs(userId) {
      const found = users.get(String(userId));
      if (!found) return [];
      return [...found.tabs.values()]
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt || b.seq - a.seq)
        .map((tab) => ({
          id: tab.tabId,
          lastActiveAt: tab.lastActiveAt,
          selected: found.selectedId === tab.tabId,
        }));
    },

    /**
     * @param {string} userId
     * @param {string | null} tabId
     */
    selectTab(userId, tabId) {
      const found = users.get(String(userId));
      if (!found) return false;
      if (tabId == null) {
        found.selectedId = null;
        return true;
      }
      if (!found.tabs.has(tabId)) return false;
      found.selectedId = tabId;
      return true;
    },

    /**
     * @param {string} userId
     * @param {string | number} id
     */
    hasInFlight(userId, id) {
      return pending.has(commandKey(userId, id));
    },

    /**
     * Held commands for one agent token. Commands submitted without a token
     * id are not counted.
     * @param {string} tokenId
     */
    pendingCount(tokenId) {
      const id = String(tokenId);
      let held = 0;
      for (const item of pending.values()) {
        if (item.tokenId === id) held += 1;
      }
      return held;
    },

    /**
     * Queue a command, or refuse it, before yielding. HTTP uses this so a
     * full queue is a 429 and not an accepted command.
     * @param {{ userId: string, tokenId?: string, frame: { id?: string | number, command: string, args?: unknown } }} input
     * @returns {{ accepted: true, done: Promise<object> } | { accepted: false, response: object }}
     */
    trySubmit(input) {
      const userId = String(input.userId);
      const tokenId = input.tokenId == null ? '' : String(input.tokenId);
      const key = commandKey(userId, input.frame.id);
      if (pending.has(key)) {
        return {
          accepted: false,
          response: commandResponse({
            id: input.frame.id,
            ok: false,
            error: { code: 'duplicate_id', message: 'A command with this id is still in flight' },
          }),
        };
      }
      if (tokenId && this.pendingCount(tokenId) >= maxPending) {
        return {
          accepted: false,
          response: commandResponse({
            id: input.frame.id,
            ok: false,
            error: { code: 'too_many_pending', message: 'Too many commands are waiting' },
          }),
        };
      }
      /** @type {PendingCommand} */
      const item = {
        userId,
        tokenId,
        frame: {
          id: input.frame.id,
          command: input.frame.command,
          args: input.frame.args == null ? {} : input.frame.args,
        },
        deadline: clock.now() + asleepMs,
        sentTo: null,
        finished: false,
        listeners: [],
        abortWaiters: [],
        finish: () => {},
      };
      let resolvePromise = /** @type {(response: object) => void} */ (() => {});
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      item.finish = (response) => {
        if (item.finished) return;
        item.finished = true;
        pending.delete(key);
        completed.set(key, { userId, tokenId, response, at: clock.now() });
        for (const listener of item.listeners) listener(response);
        resolvePromise(response);
        arm();
      };
      pending.set(key, item);
      deliver(userId);
      arm();
      return { accepted: true, done: promise };
    },

    /**
     * @param {{ userId: string, tokenId?: string, frame: { id?: string | number, command: string, args?: unknown } }} input
     * @returns {Promise<object>}
     */
    submit(input) {
      const attempt = this.trySubmit(input);
      if (!attempt.accepted) return Promise.resolve(attempt.response);
      return attempt.done;
    },

    /**
     * @param {string} userId
     * @param {string | number} id
     * @param {object} response
     */
    complete(userId, id, response) {
      const item = pending.get(commandKey(userId, id));
      if (!item || item.userId !== String(userId)) return false;
      item.finish(response);
      return true;
    },

    /**
     * @param {string} userId
     * @param {string | number} id
     * @param {number} timeoutMs
     * @param {string} [tokenId]
     * @returns {Promise<{ status: 'done', response: object } | { status: 'pending' } | { status: 'revoked' } | null>}
     */
    wait(userId, id, timeoutMs, tokenId) {
      const key = commandKey(userId, id);
      const requested = tokenId == null ? null : String(tokenId);
      const done = completed.get(key);
      if (done) {
        if (done.userId !== String(userId) || !tokenMatches(done.tokenId, requested)) {
          return Promise.resolve(null);
        }
        completed.delete(key);
        return Promise.resolve({ status: 'done', response: done.response });
      }
      const item = pending.get(key);
      if (!item || item.userId !== String(userId) || !tokenMatches(item.tokenId, requested)) {
        return Promise.resolve(null);
      }
      if (timeoutMs <= 0) return Promise.resolve({ status: 'pending' });
      return new Promise((resolve) => {
        let settled = false;
        const timeout = clock.schedule(() => {
          if (settled) return;
          settled = true;
          resolve({ status: 'pending' });
        }, timeoutMs);
        item.abortWaiters.push(() => {
          if (settled) return;
          settled = true;
          clock.cancel(timeout);
          resolve({ status: 'revoked' });
        });
        item.listeners.push((response) => {
          if (settled) return;
          settled = true;
          clock.cancel(timeout);
          completed.delete(key);
          resolve({ status: 'done', response });
        });
      });
    },

    /**
     * End long-poll and SSE waits for one token, and drop its unread results.
     * @param {string} tokenId
     */
    abortToken(tokenId) {
      const id = String(tokenId);
      for (const item of [...pending.values()]) {
        if (item.tokenId !== id || item.finished) continue;
        const waiters = item.abortWaiters.splice(0);
        for (const abort of waiters) abort();
        item.finish(commandResponse({
          id: item.frame.id,
          ok: false,
          error: { code: 'unauthorized', message: 'Token revoked' },
        }));
      }
      for (const [key, done] of [...completed.entries()]) {
        if (done.tokenId === id) completed.delete(key);
      }
    },

    /**
     * @param {{ userId: string, agentId: string, send: (frame: object) => void }} agent
     * @returns {boolean} false when this account is already at the agent cap
     */
    registerAgent(agent) {
      const userId = String(agent.userId);
      let found = agents.get(userId);
      if (found && !found.has(agent.agentId) && found.size >= maxAgents) return false;
      const first = !found || found.size === 0;
      if (!found) {
        found = new Map();
        agents.set(userId, found);
      }
      found.set(agent.agentId, { agentId: agent.agentId, userId, send: agent.send });
      if (first) notifyTabs(userId, true);
      return true;
    },

    /**
     * @param {string} userId
     * @param {string} agentId
     */
    unregisterAgent(userId, agentId) {
      const found = agents.get(String(userId));
      if (!found) return;
      found.delete(agentId);
      if (found.size === 0) {
        agents.delete(String(userId));
        notifyTabs(userId, false);
      }
    },

    /**
     * @param {string} userId
     * @returns {boolean}
     */
    agentConnected(userId) {
      return (agents.get(String(userId))?.size || 0) > 0;
    },

    /**
     * Prompt frames from an agent socket. Not stored.
     * @param {string} userId
     * @param {object} frame
     */
    forwardToTabs(userId, frame) {
      forward(userId, frame, 'tabs');
    },

    /**
     * Prompt frames from a tab socket. Not stored.
     * @param {string} userId
     * @param {object} frame
     */
    forwardToAgents(userId, frame) {
      forward(userId, frame, 'agents');
    },

    /** Joined in-flight and unread payloads, for tests that they are dropped. */
    debugPayloads() {
      const blobs = [];
      for (const item of pending.values()) blobs.push(JSON.stringify(item.frame));
      for (const done of completed.values()) blobs.push(JSON.stringify(done.response));
      return blobs.join('\n');
    },
  };
}
