import { commandRequest, commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createSystemClock } from './clock.js';
import {
  AGENT_PRESENCE_TTL_MS,
  MAX_AGENTS_PER_USER,
  MAX_HELD_PROMPTS,
  MAX_PENDING,
  MAX_TABS_PER_USER,
  MOLD_COMMAND_MS,
  PROMPT_HOLD_MS,
  RESULT_RETENTION_MS,
  SESSION_MESSAGE_GAP_MS,
  TAB_ASLEEP_MS,
} from './limits.js';

export const TAB_ASLEEP_ERROR = 'SurfCAD tab is asleep';

/** The tab took the command and has not answered inside its budget. */
export const COMMAND_TIMEOUT_ERROR = 'SurfCAD tab took the command but did not answer in time';

/** Commands that get `MOLD_COMMAND_MS` once a tab has taken them. */
const LONG_COMMAND = /^mold_/;

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
 * @param {{ id?: string | number, command?: string }} frame
 * @param {number} budgetMs
 */
function commandTimeoutResponse(frame, budgetMs) {
  return commandResponse({
    id: frame.id,
    ok: false,
    error: {
      code: 'command_timeout',
      message: `${COMMAND_TIMEOUT_ERROR} (${Math.round(budgetMs / 1000)} s)`,
      details: { command: frame.command, budgetMs },
    },
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
 *   moldCommandMs?: number,
 *   retentionMs?: number,
 *   maxPending?: number,
 *   maxTabs?: number,
 *   maxAgents?: number,
 *   promptHoldMs?: number,
 *   presenceTtlMs?: number,
 * }} [opts]
 */
export function createMemoryTabRegistry(opts = {}) {
  const clock = opts.clock || createSystemClock();
  const asleepMs = opts.asleepMs ?? TAB_ASLEEP_MS;
  const moldCommandMs = opts.moldCommandMs ?? MOLD_COMMAND_MS;
  const retentionMs = opts.retentionMs ?? RESULT_RETENTION_MS;
  const maxPending = opts.maxPending ?? MAX_PENDING;
  const maxTabs = opts.maxTabs ?? MAX_TABS_PER_USER;
  const maxAgents = opts.maxAgents ?? MAX_AGENTS_PER_USER;
  const promptHoldMs = opts.promptHoldMs ?? PROMPT_HOLD_MS;
  const presenceTtlMs = opts.presenceTtlMs ?? AGENT_PRESENCE_TTL_MS;
  const sessionMessageGapMs = opts.sessionMessageGapMs ?? SESSION_MESSAGE_GAP_MS;
  /** @type {Map<string, number>} */
  const sessionMessageAt = new Map();
  /**
   * Last activity per account. `at` is null until something stamps it, so
   * a manual clock at 0 is a real sighting. `heldDown` is a revoke.
   * @type {Map<string, { at: number | null, timer: unknown, announced: boolean, heldDown: boolean, epoch: number }>}
   */
  const presence = new Map();

  /**
   * @typedef {{ tabId: string, userId: string, send: (frame: object) => void, lastActiveAt: number, seq: number }} TabRecord
   * @typedef {{
   *   userId: string,
   *   tokenId: string,
   *   frame: { id?: string | number, command: string, args: unknown },
   *   budgetMs: number,
   *   asleepAt: number,
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
  /**
   * Tab prompts held for the agent. While the agent is present (inside the
   * presence window) a row stays until a process reports it taken
   * (`agent.prompt.taken`) or presence ends; it is offered once to each
   * consumer (an agent socket, or an HTTPS pull session) so a fresh process
   * per tool call still receives it. With no agent present a row waits
   * `promptHoldMs` for one to appear and then fails back to the tab.
   * @typedef {{ frame: object, offered: Set<string>, timer: unknown, cancel: () => void, onExpire: () => void }} HeldPrompt
   * @type {Map<string, HeldPrompt[]>}
   */
  const promptInbox = new Map();
  /**
   * Long-polls on GET /agent/prompts, keyed by user. `consumer` is the
   * pull session that rows are offered to once; null drains (older clients).
   * @type {Map<string, Array<{ tokenId: string | null, consumer: string | null, abort: () => void, resolve: (messages: object[]) => void }>>}
   */
  const promptWaiters = new Map();
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
   * does not look like a command frame. `reason` is set only when the
   * agent goes offline: inactive, closed, revoked, or expired.
   * @param {string} userId
   * @param {boolean} connected
   * @param {'inactive' | 'closed' | 'revoked' | 'expired'} [reason]
   */
  function notifyTabs(userId, connected, reason) {
    const found = users.get(String(userId));
    if (!found) return;
    const frame = { type: 'agent', v: 1, connected: connected === true };
    if (
      !frame.connected
      && (reason === 'inactive' || reason === 'closed' || reason === 'revoked' || reason === 'expired')
    ) {
      frame.reason = reason;
    }
    for (const tab of found.tabs.values()) {
      try { tab.send(frame); } catch { /* a dead tab must not block the rest */ }
    }
  }

  /**
   * @param {string} userId
   */
  function presenceRow(userId) {
    const key = String(userId);
    let row = presence.get(key);
    if (!row) {
      row = { at: null, timer: null, announced: false, heldDown: false, epoch: 0 };
      presence.set(key, row);
    }
    return row;
  }

  /**
   * @param {{ timer: unknown }} row
   */
  function cancelPresenceTimer(row) {
    if (row.timer) clock.cancel(row.timer);
    row.timer = null;
  }

  /**
   * @param {string} key
   * @param {{ at: number | null, timer: unknown, announced: boolean, heldDown: boolean }} row
   */
  function armPresence(key, row) {
    cancelPresenceTimer(row);
    if (row.at == null || !row.announced || row.heldDown) return;
    const remain = presenceTtlMs - (clock.now() - row.at);
    if (remain <= 0) {
      expirePresence(key);
      return;
    }
    row.timer = clock.schedule(() => expirePresence(key), remain);
  }

  /**
   * Offline after the presence window, including while a socket is still open.
   * A close is not a goodbye and does not reach this.
   * @param {string} key
   */
  function expirePresence(key) {
    const row = presence.get(key);
    if (!row) return;
    row.timer = null;
    if (row.heldDown || row.at == null || !row.announced) return;
    if (clock.now() - row.at < presenceTtlMs) {
      armPresence(key, row);
      return;
    }
    row.announced = false;
    expireHeldPrompts(key);
    notifyTabs(key, false, 'inactive');
  }

  /**
   * Inside the presence window right now. The closure form of
   * `agentConnected` for the prompt inbox.
   * @param {string} key
   */
  function agentPresent(key) {
    const row = presence.get(key);
    if (!row || row.heldDown || !row.announced || row.at == null) return false;
    return clock.now() - row.at < presenceTtlMs;
  }

  /**
   * @param {string} userId
   * @param {object} frame
   * @param {'tabs' | 'agents'} side
   */
  /**
   * @param {string} userId
   * @param {object} frame
   * @param {'tabs' | 'agents'} side
   * @returns {number} sockets that accepted the frame
   */
  function forward(userId, frame, side) {
    const found = side === 'tabs'
      ? users.get(String(userId))?.tabs
      : agents.get(String(userId));
    if (!found) return 0;
    let delivered = 0;
    for (const peer of found.values()) {
      try {
        peer.send(frame);
        delivered += 1;
      } catch { /* a dead peer must not block the rest */ }
    }
    return delivered;
  }

  /**
   * Remove every held prompt (an older client that takes on pull).
   * @param {string} key
   * @returns {object[]}
   */
  function takeInbox(key) {
    const rows = promptInbox.get(key);
    if (!rows || rows.length === 0) return [];
    promptInbox.delete(key);
    const frames = [];
    for (const row of rows) {
      row.cancel();
      frames.push(row.frame);
    }
    return frames;
  }

  /**
   * Held prompts this consumer has not seen yet, oldest first. The rows
   * stay until taken. A row that was waiting for an agent to appear stops
   * its fail timer: an agent is here now.
   * @param {string} key
   * @param {string} consumer
   * @returns {object[]}
   */
  function offerInbox(key, consumer) {
    const rows = promptInbox.get(key);
    if (!rows || rows.length === 0) return [];
    const frames = [];
    for (const row of rows) {
      if (row.offered.has(consumer)) continue;
      row.offered.add(consumer);
      if (row.timer) {
        clock.cancel(row.timer);
        row.timer = null;
      }
      frames.push(row.frame);
    }
    return frames;
  }

  /**
   * @param {string} key
   * @param {string | null} consumer
   */
  function offerOrTake(key, consumer) {
    return consumer ? offerInbox(key, consumer) : takeInbox(key);
  }

  /**
   * The agent has these prompts. Drop the rows without an ack.
   * @param {string} key
   * @param {unknown} ids
   * @returns {number}
   */
  function takeHeld(key, ids) {
    const rows = promptInbox.get(key);
    if (!rows || !Array.isArray(ids)) return 0;
    const wanted = new Set(ids.filter((id) => typeof id === 'string' && id));
    if (wanted.size === 0) return 0;
    let taken = 0;
    for (const row of [...rows]) {
      if (!wanted.has(row.frame?.id)) continue;
      row.cancel();
      const idx = rows.indexOf(row);
      if (idx >= 0) rows.splice(idx, 1);
      taken += 1;
    }
    if (rows.length === 0) promptInbox.delete(key);
    return taken;
  }

  /**
   * @param {string} key
   * @param {unknown} id
   */
  function dropHeld(key, id) {
    const rows = promptInbox.get(key);
    if (!rows || typeof id !== 'string' || !id) return false;
    const idx = rows.findIndex((row) => row.frame?.id === id);
    if (idx < 0) return false;
    const [row] = rows.splice(idx, 1);
    row.cancel();
    if (rows.length === 0) promptInbox.delete(key);
    return true;
  }

  /**
   * Fail every held prompt for this account. Same ack as a hold expiry.
   * @param {string} userId
   */
  function expireHeldPrompts(userId) {
    const rows = promptInbox.get(String(userId));
    if (!rows || rows.length === 0) return;
    for (const row of [...rows]) row.onExpire();
  }

  /** @param {string} key */
  function wakePromptWaiters(key) {
    const pending = promptWaiters.get(key);
    if (!pending || pending.length === 0) return;
    // Each pull session is offered the new rows once; a legacy waiter
    // (no consumer) takes whatever is left.
    for (const waiter of [...pending]) {
      const frames = offerOrTake(key, waiter.consumer);
      if (frames.length === 0) continue;
      waiter.resolve(frames);
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
      // Never taken by a tab: asleep at the short hold, whatever the budget.
      // Taken and still running past the budget: the tab is awake, the
      // command is the problem, and the agent gets told so.
      if (!item.sentTo && item.asleepAt <= t) item.finish(asleepResponse(item.frame));
      else if (item.deadline <= t) {
        item.finish(item.sentTo ? commandTimeoutResponse(item.frame, item.budgetMs) : asleepResponse(item.frame));
      }
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
      const at = item.sentTo ? item.deadline : Math.min(item.asleepAt, item.deadline);
      if (at < next) next = at;
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
      // A command handed back by a vanished tab is on the asleep clock again.
      arm();
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
      const budgetMs = LONG_COMMAND.test(String(input.frame.command)) ? moldCommandMs : asleepMs;
      /** @type {PendingCommand} */
      const item = {
        userId,
        tokenId,
        frame: {
          id: input.frame.id,
          command: input.frame.command,
          args: input.frame.args == null ? {} : input.frame.args,
        },
        budgetMs,
        asleepAt: clock.now() + asleepMs,
        deadline: clock.now() + budgetMs,
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
     * A finished command's result can be read again until the retention
     * window passes. The HTTPS fallback reads it over an event stream first
     * and polls when that stream fails; the stream had already taken the
     * result, so the poll found nothing and the agent was told "That
     * command is no longer waiting" for a command the tab had run.
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
          resolve({ status: 'done', response });
        });
      });
    },

    /**
     * End long-poll and SSE waits for one token, and drop its unread results.
     * When `userId` is set, held tab prompts for that account expire too:
     * each row tells the tab delivery failed, and a later hello or
     * `GET /agent/prompts` cannot take them.
     * @param {string} tokenId
     * @param {string} [userId]
     */
    abortToken(tokenId, userId) {
      const id = String(tokenId);
      if (userId != null && String(userId) !== '') expireHeldPrompts(userId);
      for (const [waiterUserId, list] of [...promptWaiters.entries()]) {
        for (const waiter of [...list]) {
          if (waiter.tokenId === id) waiter.abort();
        }
        if ((promptWaiters.get(waiterUserId)?.length || 0) === 0) promptWaiters.delete(waiterUserId);
      }
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
     * @param {{ clearHold?: boolean, epoch?: number }} [seen]
     * @returns {boolean | 'revoked'} false when this account is already at the agent cap
     */
    registerAgent(agent, seen) {
      const userId = String(agent.userId);
      let found = agents.get(userId);
      if (found && !found.has(agent.agentId) && found.size >= maxAgents) return false;
      if (!this.noteAgentSeen(userId, seen)) return 'revoked';
      if (!found) {
        found = new Map();
        agents.set(userId, found);
      }
      found.set(agent.agentId, { agentId: agent.agentId, userId, send: agent.send });
      return true;
    },

    /**
     * A socket close is a pause. It does not stamp last-seen and it does
     * not tell the tab the agent left.
     * @param {string} userId
     * @param {string} agentId
     */
    unregisterAgent(userId, agentId) {
      const found = agents.get(String(userId));
      if (!found) return;
      found.delete(agentId);
      if (found.size === 0) agents.delete(String(userId));
    },

    /**
     * True while the last stamp is still inside the presence window.
     * An open socket with no recent activity is offline.
     * @param {string} userId
     * @returns {boolean}
     */
    agentConnected(userId) {
      const row = presence.get(String(userId));
      if (!row || row.heldDown || !row.announced || row.at == null) return false;
      return clock.now() - row.at < presenceTtlMs;
    },

    /**
     * Epoch observed before a token check. A revoke bumps it, so a check
     * that started earlier cannot clear the hold.
     * @param {string} userId
     * @returns {number}
     */
    presenceEpoch(userId) {
      return presence.get(String(userId))?.epoch || 0;
    },

    /**
     * Stamp last-seen and announce on the rising edge. `clearHold` lifts a
     * revoke only when `epoch` is still the one captured before the check.
     * @param {string} userId
     * @param {{ clearHold?: boolean, epoch?: number }} [opts]
     * @returns {boolean} false when a revoke won the race
     */
    noteAgentSeen(userId, opts = {}) {
      const key = String(userId);
      const row = presenceRow(key);
      if (opts.epoch != null && row.epoch !== opts.epoch) return false;
      if (row.heldDown && opts.clearHold !== true) return false;
      if (opts.clearHold === true) row.heldDown = false;
      const rising = !row.announced;
      row.at = clock.now();
      row.announced = true;
      armPresence(key, row);
      if (rising) notifyTabs(key, true);
      return true;
    },

    /**
     * The agent called close_session. Offline immediately, reason closed.
     * A later stamp can return. A following socket close cannot.
     * @param {string} userId
     * @returns {boolean}
     */
    endAgentSession(userId) {
      const key = String(userId);
      const row = presenceRow(key);
      if (row.heldDown) return false;
      cancelPresenceTimer(row);
      const was = row.announced;
      row.announced = false;
      row.at = null;
      expireHeldPrompts(key);
      if (was) notifyTabs(key, false, 'closed');
      return true;
    },

    /**
     * Revoke. Offline immediately, reason revoked, and a closing socket
     * cannot announce the agent again.
     * @param {string} userId
     */
    dropAgentPresence(userId) {
      const key = String(userId);
      const row = presenceRow(key);
      row.epoch += 1;
      row.heldDown = true;
      row.at = null;
      cancelPresenceTimer(row);
      if (!row.announced) return;
      row.announced = false;
      notifyTabs(key, false, 'revoked');
    },

    /**
     * One browser session's tokens were revoked and another pairing is
     * still live. Tabs hear reason revoked, then stay present for the
     * other pairing. The epoch is not bumped and presence is not held
     * down, so the surviving token's next call still clears a hold.
     * @param {string} userId
     */
    notePartialRevoke(userId) {
      const key = String(userId);
      const row = presenceRow(key);
      if (row.heldDown || !row.announced) return;
      notifyTabs(key, false, 'revoked');
      if (row.at == null || clock.now() - row.at >= presenceTtlMs) {
        row.announced = false;
        cancelPresenceTimer(row);
        return;
      }
      notifyTabs(key, true);
    },

    /**
     * Pairing expiry. Offline immediately, reason expired. A revoke that
     * already holds this account is left alone. A later hello on a
     * still-valid token can return; a check that captured this epoch cannot.
     * @param {string} userId
     */
    expireAgentPairing(userId) {
      const key = String(userId);
      const row = presenceRow(key);
      if (row.heldDown) return;
      row.epoch += 1;
      row.heldDown = true;
      row.at = null;
      cancelPresenceTimer(row);
      if (!row.announced) return;
      row.announced = false;
      notifyTabs(key, false, 'expired');
    },

    /**
     * Progress stamps activity and tells tabs the agent is working.
     * Text is never forwarded.
     * @param {string} userId
     * @param {{ clearHold?: boolean, epoch?: number }} [opts]
     * @returns {boolean}
     */
    noteAgentProgress(userId, opts) {
      if (!this.noteAgentSeen(userId, opts)) return false;
      this.forwardToTabs(userId, { type: 'agent.progress', v: 1, working: true });
      return true;
    },

    /**
     * One unsolicited session message per gap, per account. The frame
     * itself is not stored.
     * @param {string} userId
     * @returns {boolean}
     */
    allowSessionMessage(userId) {
      const key = String(userId);
      const at = clock.now();
      const prev = sessionMessageAt.get(key);
      if (prev != null && at - prev < sessionMessageGapMs) return false;
      sessionMessageAt.set(key, at);
      return true;
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
    /**
     * @param {string} userId
     * @param {object} frame
     * @returns {number} agent sockets that accepted the frame
     */
    forwardToAgents(userId, frame) {
      return forward(userId, frame, 'agents');
    },

    /**
     * A tab prompt. Live agent sockets get it now. While the agent is
     * present it is also held (offered to those sockets already) until a
     * process reports it taken, so a one-shot process that exits before
     * `read_messages` does not lose it; the next hello or pull offers it
     * again. With no agent present it waits `promptHoldMs` for one.
     * @param {string} userId
     * @param {object} frame
     * @param {{ onExpire?: () => void }} [opts]
     * @returns {{ delivered: number, held: boolean, present: boolean }}
     */
    deliverPrompt(userId, frame, opts = {}) {
      const key = String(userId);
      const live = agents.get(key);
      const offered = [];
      let delivered = 0;
      if (live) {
        for (const peer of live.values()) {
          try {
            peer.send(frame);
            delivered += 1;
            offered.push(peer.agentId);
          } catch { /* a dead peer must not block the rest */ }
        }
      }
      const present = agentPresent(key);
      if (!present && delivered > 0) return { delivered, held: false, present };
      this.holdPrompt(userId, frame, { ...opts, offeredTo: offered, present });
      return { delivered, held: true, present };
    },

    /**
     * Keep a tab prompt for the agent. While the agent is present
     * (`present`, default: the presence window right now) the row stays
     * until `takeHeldPrompts` or presence ends. Otherwise it waits
     * `promptHoldMs` for an agent to appear and then fails back to the tab.
     * `offeredTo` names consumers that already have the frame.
     * @param {string} userId
     * @param {object} frame
     * @param {{ onExpire?: () => void, offeredTo?: string[], present?: boolean }} [opts]
     * @returns {{ present: boolean }}
     */
    holdPrompt(userId, frame, opts = {}) {
      const key = String(userId);
      /** @type {HeldPrompt[]} */
      let rows = promptInbox.get(key);
      if (!rows) {
        rows = [];
        promptInbox.set(key, rows);
      }
      while (rows.length >= MAX_HELD_PROMPTS) {
        const old = rows.shift();
        old?.onExpire();
      }
      const present = typeof opts.present === 'boolean' ? opts.present : agentPresent(key);
      let expired = false;
      /** @type {HeldPrompt} */
      const row = {
        frame,
        offered: new Set(Array.isArray(opts.offeredTo) ? opts.offeredTo.filter((id) => typeof id === 'string') : []),
        timer: null,
        cancel() {
          if (expired) return;
          expired = true;
          if (row.timer) clock.cancel(row.timer);
          row.timer = null;
        },
        onExpire() {
          if (expired) return;
          expired = true;
          if (row.timer) clock.cancel(row.timer);
          row.timer = null;
          const live = promptInbox.get(key);
          if (live) {
            const idx = live.indexOf(row);
            if (idx >= 0) live.splice(idx, 1);
            if (live.length === 0) promptInbox.delete(key);
          }
          opts.onExpire?.();
        },
      };
      if (!present) row.timer = clock.schedule(() => row.onExpire(), promptHoldMs);
      rows.push(row);
      wakePromptWaiters(key);
      return { present };
    },

    /**
     * The agent reports these prompts as its own (`agent.prompt.taken`).
     * The rows are dropped with no ack; the agent already acked them.
     * @param {string} userId
     * @param {unknown} ids
     * @returns {number}
     */
    takeHeldPrompts(userId, ids) {
      return takeHeld(String(userId), ids);
    },

    /**
     * Held prompts this consumer (an agent socket id) has not seen yet,
     * oldest first. The rows stay held until taken.
     * @param {string} userId
     * @param {string} consumer
     * @returns {object[]}
     */
    offerPrompts(userId, consumer) {
      return offerInbox(String(userId), String(consumer));
    },

    /** Held prompts for this account, in order, for tests. */
    heldPromptIds(userId) {
      return (promptInbox.get(String(userId)) || []).map((row) => row.frame?.id);
    },

    /**
     * Drop one held prompt. The expiry ack does not fire.
     * @param {string} userId
     * @param {unknown} id
     * @returns {boolean}
     */
    dropHeldPrompt(userId, id) {
      return dropHeld(String(userId), id);
    },

    /**
     * Take every held prompt for this account, oldest first (an older
     * client; nothing is held for it afterwards).
     * @param {string} userId
     * @returns {object[]}
     */
    drainPrompts(userId) {
      return takeInbox(String(userId));
    },

    /**
     * HTTPS fallback long-poll. With `consumer` (the pull session's id)
     * held rows are offered once to that session and stay until taken;
     * without it they are drained. `revoked` means this token was aborted.
     * @param {string} userId
     * @param {number} timeoutMs
     * @param {string} [tokenId]
     * @param {string | null} [consumer]
     * @returns {Promise<{ status: 'messages' | 'empty' | 'revoked', messages: object[] }>}
     */
    waitPrompts(userId, timeoutMs, tokenId, consumer = null) {
      const key = String(userId);
      const who = consumer ? String(consumer) : null;
      const ready = offerOrTake(key, who);
      if (ready.length) return Promise.resolve({ status: 'messages', messages: ready });
      if (timeoutMs <= 0) return Promise.resolve({ status: 'empty', messages: [] });
      return new Promise((resolve) => {
        let settled = false;
        /** @type {Array<{ tokenId: string | null, consumer: string | null, abort: () => void, resolve: (messages: object[]) => void }>} */
        let list = promptWaiters.get(key);
        if (!list) {
          list = [];
          promptWaiters.set(key, list);
        }
        const timer = clock.schedule(() => finish({ status: 'empty', messages: [] }), timeoutMs);
        /** @type {{ tokenId: string | null, consumer: string | null, abort: () => void, resolve: (messages: object[]) => void }} */
        const entry = {
          tokenId: tokenId == null ? null : String(tokenId),
          consumer: who,
          abort() { finish({ status: 'revoked', messages: [] }); },
          resolve(messages) { finish({ status: 'messages', messages }); },
        };
        list.push(entry);
        /**
         * @param {{ status: 'messages' | 'empty' | 'revoked', messages: object[] }} value
         */
        function finish(value) {
          if (settled) return;
          settled = true;
          clock.cancel(timer);
          const live = promptWaiters.get(key);
          if (live) {
            const idx = live.indexOf(entry);
            if (idx >= 0) live.splice(idx, 1);
            if (live.length === 0) promptWaiters.delete(key);
          }
          resolve(value);
        }
      });
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
