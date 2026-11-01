/**
 * Chat open/collapsed bit for a Safari or iOS reload.
 *
 * The join latch and the mobile chat-open flag live in React memory, so a
 * reload paints the chat shut until the new tab socket sees the agent.
 * This record is only that bit, scoped to the signed-in user. It is not a
 * live agent: nothing here sets paired, the ring, or Disconnect.
 *
 * sessionStorage survives a Safari reload and dies with the tab. The value
 * is `{ v, userId, open }` — no pairing token, join code, or bearer.
 */
import { clearFolded } from '../agentPromptFold.js';

export const AGENT_CHAT_PERSIST_KEY = 'surfcad.agent.chat';
export const AGENT_CHAT_CLEAR_EVENT = 'surfcad-agent-chat-clear';
/** How long a `registered: false` snapshot can sit before the agent is gone. */
export const AGENT_CHAT_RESTORE_GRACE_MS = 3000;

/**
 * @param {unknown} user
 * @returns {string}
 */
export function agentChatUserId(user) {
  if (!user || typeof user !== 'object') return '';
  const raw = user.id || user._id;
  if (raw == null || raw === '') return '';
  const text = typeof raw === 'string'
    ? raw
    : (typeof raw.toString === 'function' ? raw.toString() : '');
  if (!text || text === '[object Object]') return '';
  return text;
}

/**
 * @returns {Storage | null}
 */
export function agentChatStorage() {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}

/**
 * @param {Storage | null | undefined} storage
 * @returns {{ open: boolean, userId: string } | null}
 */
export function readAgentChatPersist(storage) {
  try {
    const raw = storage?.getItem?.(AGENT_CHAT_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.open !== 'boolean') return null;
    if (typeof parsed.userId !== 'string' || !parsed.userId) return null;
    return { open: parsed.open, userId: parsed.userId };
  } catch {
    return null;
  }
}

/**
 * @param {Storage | null | undefined} storage
 * @param {string} userId
 * @param {boolean} open
 */
export function writeAgentChatPersist(storage, userId, open) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return;
    const id = typeof userId === 'string' ? userId : '';
    if (!id) return;
    storage.setItem(AGENT_CHAT_PERSIST_KEY, JSON.stringify({
      v: 1,
      userId: id,
      open: open === true,
    }));
  } catch { /* storage blocked */ }
}

/**
 * @param {Storage | null | undefined} storage
 */
export function clearAgentChatPersist(storage) {
  try { storage?.removeItem?.(AGENT_CHAT_PERSIST_KEY); } catch { /* storage blocked */ }
}

/**
 * Drop the reload bit and the desktop fold. `close: false` (token revoke)
 * leaves a still-live chat mounted; logout and Disconnect pass close.
 *
 * @param {Storage | null | undefined} storage
 * @param {{ close?: boolean }} [options]
 */
export function forgetAgentChat(storage, options = {}) {
  clearAgentChatPersist(storage);
  clearFolded();
  const close = options.close !== false;
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    if (typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(AGENT_CHAT_CLEAR_EVENT, { detail: { close } }));
  } catch { /* no window */ }
}

/**
 * @param {{ close?: boolean }} [options]
 */
export function forgetAgentChatSession(options) {
  forgetAgentChat(agentChatStorage(), options);
}

/**
 * Socket presence while a reload restore is in flight.
 * `registered-down` is not final — the server snapshot can be false before
 * the agent frame. `agent-down` is final. `cleared` stays cleared.
 *
 * @param {'pending' | 'grace' | 'up' | 'down' | 'cleared'} report
 * @param {'registered-down' | 'agent-up' | 'agent-down' | 'grace-elapsed' | 'clear'} event
 * @returns {'pending' | 'grace' | 'up' | 'down' | 'cleared'}
 */
export function stepAgentReport(report, event) {
  const state = report === 'grace' || report === 'up' || report === 'down' || report === 'cleared'
    ? report
    : 'pending';
  if (event === 'clear') return 'cleared';
  if (state === 'cleared') return 'cleared';
  if (event === 'agent-up') return 'up';
  if (event === 'agent-down') return 'down';
  if (event === 'registered-down') {
    if (state === 'up' || state === 'down' || state === 'grace') return state;
    return 'grace';
  }
  if (event === 'grace-elapsed') return state === 'grace' ? 'down' : state;
  return state;
}

/**
 * What the chat shell should do with a stored bit.
 * Desktop Chrome (`forcedServer` false) gets the empty result so device-code
 * login is unchanged. `hold` paints the saved bit before the socket speaks.
 * `adopt` keeps that bit once the agent is actually up — it does not force
 * the chat open. `gone` is only when the saved bit was open, so the existing
 * "Agent disconnected." notice has a shell to sit in.
 *
 * @param {{
 *   record?: { open?: boolean, userId?: string } | null,
 *   userId?: string,
 *   authPending?: boolean,
 *   forcedServer?: boolean,
 *   report?: string,
 *   live?: boolean,
 * }} [input]
 * @returns {{ hold: boolean, adopt: boolean, open: boolean, gone: boolean, clear: boolean }}
 */
export function nextAgentChatShell(input = {}) {
  const none = { hold: false, adopt: false, open: false, gone: false, clear: false };
  const record = input.record;
  if (!record || typeof record.open !== 'boolean' || input.forcedServer !== true) return none;
  if (input.report === 'cleared') return none;
  const userId = typeof input.userId === 'string' ? input.userId : '';
  if (input.authPending !== true && (!userId || userId !== record.userId)) {
    return { hold: false, adopt: false, open: false, gone: false, clear: true };
  }
  if (input.report === 'down') {
    const open = record.open === true;
    return { hold: false, adopt: false, open, gone: open, clear: true };
  }
  const report = input.report || 'pending';
  if (input.live === true && (report === 'up' || report === 'pending' || report === 'grace')) {
    return { hold: false, adopt: true, open: record.open === true, gone: false, clear: false };
  }
  return { hold: true, adopt: false, open: record.open === true, gone: false, clear: false };
}
