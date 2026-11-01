/**
 * Page adapter for in-viewer agent prompts (contract v:1).
 *
 * The prompt UI can swap `createAgentPromptStub()` for
 * `createAgentPromptTransport(bridge)`. `bridge` is the live tab connection:
 * `send(message)` returns true when the frame was handed to the paired relay
 * socket, and `subscribe(cb)` returns an unsubscribe function.
 *
 * Prompt text and screenshots are plain data. This module does not render
 * them, does not parse them as HTML, and does not grant write access.
 */
import { PAIR_MSG } from './ws/relayMessages.js';

/** Plain-text prompt cap, in UTF-16 code units. Matches the MCP side. */
export const AGENT_PROMPT_TEXT_MAX = 8000;
/** Decoded screenshot cap. The page downscales before send; this rejects anything larger. */
export const AGENT_PROMPT_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

const ID_MAX = 200;

/**
 * Prompt ids this page successfully sent, per bridge. Every transport on
 * that bridge accepts replies for them. `dispose` does not clear the set:
 * the prompt card and a second transport (the bridge golden) share it, and
 * dropping it from one would hide the reply on the other.
 * @type {WeakMap<object, Set<string>>}
 */
const sentIdsByBridge = new WeakMap();
/** Same ids, so the conversation can render a reply with no user row yet. */
const pageSentIds = new Set();

/**
 * @param {object} bridge
 * @returns {Set<string>}
 */
function sentIdsFor(bridge) {
  let ids = sentIdsByBridge.get(bridge);
  if (!ids) {
    ids = new Set();
    sentIdsByBridge.set(bridge, ids);
  }
  return ids;
}

/** @param {string} id */
export function rememberPagePrompt(id) {
  if (typeof id === 'string' && id) pageSentIds.add(id);
}

/** @param {unknown} id */
export function pageSentPrompt(id) {
  return typeof id === 'string' && pageSentIds.has(id);
}

/**
 * @param {string} data
 */
function base64DecodedLength(data) {
  if (typeof data !== 'string' || data.length === 0 || data.startsWith('data:')) return -1;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return -1;
  const pad = data.endsWith('==') ? 2 : (data.endsWith('=') ? 1 : 0);
  return (data.length / 4) * 3 - pad;
}

/**
 * @param {unknown} shot
 */
function normalizeScreenshot(shot) {
  if (!shot || typeof shot !== 'object' || Array.isArray(shot)) return { error: 'bad_screenshot' };
  if (shot.mime !== 'image/png' || typeof shot.data !== 'string') return { error: 'bad_screenshot' };
  const bytes = base64DecodedLength(shot.data);
  if (bytes < 0) return { error: 'bad_screenshot' };
  if (bytes > AGENT_PROMPT_SCREENSHOT_MAX_BYTES) return { error: 'screenshot_too_large' };
  const { width, height } = shot;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    return { error: 'bad_screenshot' };
  }
  return { value: { mime: 'image/png', data: shot.data, width, height } };
}

/**
 * @param {unknown} ctx
 */
function normalizeContext(ctx) {
  if (ctx == null) return { value: undefined };
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return { error: 'bad_prompt' };
  const out = {};
  if (Object.prototype.hasOwnProperty.call(ctx, 'part_id') && ctx.part_id != null) {
    if (typeof ctx.part_id !== 'string' || ctx.part_id.length > ID_MAX) return { error: 'bad_prompt' };
    if (ctx.part_id) out.part_id = ctx.part_id;
  }
  if (Object.prototype.hasOwnProperty.call(ctx, 'assembly_id') && ctx.assembly_id != null) {
    if (typeof ctx.assembly_id !== 'string' || ctx.assembly_id.length > ID_MAX) return { error: 'bad_prompt' };
    if (ctx.assembly_id) out.assembly_id = ctx.assembly_id;
  }
  return { value: Object.keys(out).length ? out : undefined };
}

/**
 * @param {Set<Function>} listeners
 * @param {unknown} event
 */
function emitTo(listeners, event) {
  for (const cb of [...listeners]) {
    try {
      cb(event);
    } catch {
      /* a listener must not break the others */
    }
  }
}

/**
 * @param {{
 *   send: (message: object) => boolean,
 *   subscribe: (cb: (message: object) => void) => (() => void),
 * }} bridge
 */
export function createAgentPromptTransport(bridge) {
  if (!bridge || typeof bridge.send !== 'function' || typeof bridge.subscribe !== 'function') {
    throw new TypeError('createAgentPromptTransport requires a bridge with send and subscribe');
  }

  const replyListeners = new Set();
  const workingListeners = new Set();
  const progressListeners = new Set();
  const ackListeners = new Set();
  /** Prompt ids that already received a final reply. */
  const finalIds = new Set();
  /** Prompt ids this page sent on this bridge. A reply for any other id is dropped. */
  const sentIds = sentIdsFor(bridge);
  /** @type {Map<string, { promise: Promise<{ id: string, state: string }>, resolve: (result: { id: string, state: string }) => void, timer: ReturnType<typeof setTimeout> }>} */
  const cancelWaiters = new Map();
  /** Last prompt handed to the bridge. `cancel()` with no id uses this. */
  let currentId = '';

  /**
   * @param {string} id
   * @param {'cancelled' | 'not_found' | 'already_final'} state
   */
  function settleCancel(id, state) {
    const waiter = cancelWaiters.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    cancelWaiters.delete(id);
    waiter.resolve({ id, state });
  }

  const unsubscribe = bridge.subscribe((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === PAIR_MSG.AGENT_MESSAGE && msg.v === 1 && typeof msg.text === 'string' && msg.text.length > 0) {
      if (msg.id != null) return;
      emitTo(replyListeners, { text: msg.text, final: true, session: true });
      return;
    }
    if (msg.type === PAIR_MSG.AGENT_REPLY && msg.v === 1 && typeof msg.id === 'string' && typeof msg.text === 'string') {
      if (!sentIds.has(msg.id)) return;
      if (msg.final === true) finalIds.add(msg.id);
      emitTo(replyListeners, { id: msg.id, text: msg.text, final: msg.final === true });
      return;
    }
    if (msg.type === PAIR_MSG.AGENT_STATUS && msg.v === 1 && typeof msg.working === 'boolean') {
      emitTo(workingListeners, msg.working);
      return;
    }
    if (msg.type === PAIR_MSG.AGENT_PROGRESS && msg.v === 1 && msg.working === true) {
      emitTo(progressListeners, { working: true });
      return;
    }
    if (msg.type === PAIR_MSG.AGENT_PROMPT_ACK && typeof msg.id === 'string' && typeof msg.delivery === 'string') {
      const event = { id: msg.id, delivery: msg.delivery };
      if (msg.error != null) event.error = msg.error;
      emitTo(ackListeners, event);
      return;
    }
    if (msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT && msg.v === 1 && typeof msg.id === 'string') {
      const state = msg.state === 'cancelled' || msg.state === 'not_found' || msg.state === 'already_final'
        ? msg.state
        : 'not_found';
      settleCancel(msg.id, state);
    }
  });

  function dispose() {
    unsubscribe();
    for (const id of [...cancelWaiters.keys()]) settleCancel(id, 'not_found');
    replyListeners.clear();
    workingListeners.clear();
    progressListeners.clear();
    ackListeners.clear();
    finalIds.clear();
  }

  /**
   * @param {(event: { id: string, text: string, final: boolean }) => void} cb
   */
  function onReply(cb) {
    replyListeners.add(cb);
    return () => { replyListeners.delete(cb); };
  }

  /**
   * @param {(working: boolean) => void} cb
   */
  function onWorking(cb) {
    workingListeners.add(cb);
    return () => { workingListeners.delete(cb); };
  }

  /**
   * A progress frame means the agent is working. Text on the frame is ignored.
   * @param {(event: { working: true }) => void} cb
   */
  function onProgress(cb) {
    progressListeners.add(cb);
    return () => { progressListeners.delete(cb); };
  }

  /**
   * @param {(event: { id: string, delivery: string, error?: unknown }) => void} cb
   */
  function onAck(cb) {
    ackListeners.add(cb);
    return () => { ackListeners.delete(cb); };
  }

  /**
   * @param {string} text
   * @param {{ screenshot?: { mime: string, data: string, width: number, height: number }, context?: { part_id?: string, assembly_id?: string } }} [opts]
   * @returns {string} prompt id
   *
   * One prompt per second is enforced by the paired process after this frame
   * is accepted, so this stays synchronous. `rate_limited` arrives as a failed
   * ack (`{ delivery: 'failed', error: 'rate_limited' }`), not a rejected return.
   */
  function send(text, opts = {}) {
    const id = crypto.randomUUID();
    const fail = (error) => {
      emitTo(ackListeners, { id, delivery: 'failed', error });
      return id;
    };
    if (typeof text !== 'string' || text.length === 0) return fail('bad_prompt');
    if (text.length > AGENT_PROMPT_TEXT_MAX) return fail('prompt_too_long');
    const context = normalizeContext(opts?.context);
    if (context.error) return fail(context.error);
    /** @type {{ type: string, v: number, id: string, text: string, ts: string, context?: object, screenshot?: object }} */
    const message = {
      type: PAIR_MSG.AGENT_PROMPT,
      v: 1,
      id,
      text,
      ts: new Date().toISOString(),
    };
    if (context.value) message.context = context.value;
    if (opts?.screenshot != null) {
      const shot = normalizeScreenshot(opts.screenshot);
      if (shot.error) return fail(shot.error);
      message.screenshot = shot.value;
    }
    if (bridge.send(message) !== true) return fail('not_paired');
    sentIds.add(id);
    rememberPagePrompt(id);
    currentId = id;
    return id;
  }

  /**
   * Cancel the current in-flight prompt, or `id` when passed.
   *
   * @param {string} [id]
   * @returns {Promise<{ id: string, state: 'cancelled' | 'not_found' | 'already_final' }>}
   */
  function cancel(id) {
    const target = typeof id === 'string' && id ? id : currentId;
    if (!target) return Promise.resolve({ id: '', state: 'not_found' });
    const existing = cancelWaiters.get(target);
    if (existing) return existing.promise;
    /** @type {(result: { id: string, state: 'cancelled' | 'not_found' | 'already_final' }) => void} */
    let resolveWaiter;
    const promise = new Promise((resolve) => { resolveWaiter = resolve; });
    const timer = setTimeout(() => settleCancel(target, 'not_found'), 30_000);
    cancelWaiters.set(target, { promise, resolve: resolveWaiter, timer });
    let sent = false;
    try {
      sent = bridge.send({ type: PAIR_MSG.AGENT_PROMPT_CANCEL, v: 1, id: target }) === true;
    } catch {
      sent = false;
    }
    if (!sent) settleCancel(target, finalIds.has(target) ? 'already_final' : 'not_found');
    return promise;
  }

  return { send, cancel, onReply, onWorking, onProgress, onAck, dispose };
}
