/**
 * DEV-only echo stub for the in-viewer agent prompt.
 *
 * Paired sessions use `createAgentPromptTransport(bridge)` from the MCP
 * Lead's adapter. This stub stays for DEV with no pairing and for tests.
 * Production with no paired agent must never call it.
 *
 * Interface:
 *   send(text, { screenshot?, context? }) → page-made uuid
 *   onReply(cb)  cb({ id, text, final })   — multiple replies per id append
 *   onWorking(cb) cb(boolean)
 *   onAck(cb)    cb({ id, delivery: 'webhook'|'queued'|'failed', error? })
 *   cancel(id?)  → Promise<{ id, state: 'cancelled'|'not_found' }>
 *   holdReply(on?) / releaseReply() — test-only: park the echo until released
 *   Each subscription returns an unsubscribe function.
 */

export const AGENT_PROMPT_MAX_CHARS = 8000;

/**
 * UI-side send: trim, enforce the char cap, attach an optional screenshot
 * and part/assembly context. The caller discards the attached shot after
 * a successful send.
 */
export function sendAgentPromptText(transport, text, extras = {}, options = {}) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : AGENT_PROMPT_MAX_CHARS;
  if (!trimmed || options.working === true) return { ok: false, reason: 'empty' };
  if (trimmed.length > maxChars) return { ok: false, reason: 'too_long' };
  const payload = {};
  if (extras && extras.screenshot && typeof extras.screenshot === 'object') {
    payload.screenshot = extras.screenshot;
  }
  if (extras && extras.context && typeof extras.context === 'object') {
    payload.context = extras.context;
  }
  const id = transport.send(trimmed, payload);
  return { ok: true, id };
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addListener(set, cb) {
  if (typeof cb !== 'function') return () => {};
  set.add(cb);
  return () => { set.delete(cb); };
}

function emit(set, payload) {
  for (const cb of set) {
    try { cb(payload); } catch { /* subscriber errors stay local */ }
  }
}

/**
 * @param {{
 *   delayMs?: number,
 *   reply?: string,
 *   delivery?: 'webhook'|'queued'|'failed',
 *   error?: string,
 *   chunk?: boolean,
 *   holdReply?: boolean,
 * }} [options]
 */
export function createAgentPromptStub(options = {}) {
  const replyListeners = new Set();
  const workingListeners = new Set();
  const ackListeners = new Set();
  const timers = new Set();
  let lastScreenshot = null;
  let lastId = '';
  let aborted = false;
  let held = options.holdReply === true;
  let pendingFinish = null;

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function send(text, extras = {}) {
    const id = newId();
    lastId = id;
    aborted = false;
    const body = typeof text === 'string' ? text : '';
    lastScreenshot = extras && extras.screenshot && typeof extras.screenshot === 'object'
      ? extras.screenshot
      : null;
    const delay = Number.isFinite(options.delayMs) ? options.delayMs : 420;
    const delivery = options.delivery || 'queued';

    emit(workingListeners, true);
    const finish = () => {
      if (aborted) return;
      const ack = { id, delivery };
      if (delivery === 'failed') {
        ack.error = options.error || 'agent not listening';
      }
      emit(ackListeners, ack);
      if (delivery === 'failed') {
        emit(workingListeners, false);
        return;
      }
      const replyText = typeof options.reply === 'string' && options.reply.length
        ? options.reply
        : `Echo: ${body}`;
      if (options.chunk) {
        const mid = Math.max(1, Math.floor(replyText.length / 2));
        emit(replyListeners, { id, text: replyText.slice(0, mid), final: false });
        emit(replyListeners, { id, text: replyText.slice(mid), final: true });
      } else {
        emit(replyListeners, { id, text: replyText, final: true });
      }
      emit(workingListeners, false);
    };
    const scheduleFinish = () => {
      if (aborted) return;
      if (held) {
        pendingFinish = finish;
        return;
      }
      finish();
    };
    if (held || delay <= 0) scheduleFinish();
    else later(scheduleFinish, delay);
    return id;
  }

  function holdReply(on = true) {
    held = on !== false;
  }

  function releaseReply() {
    held = false;
    const fn = pendingFinish;
    pendingFinish = null;
    if (typeof fn === 'function') fn();
  }

  function abort() {
    aborted = true;
    pendingFinish = null;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    emit(workingListeners, false);
  }

  /**
   * DEV echo stand-in for the live transport's cancel.
   * @param {string} [id]
   * @returns {Promise<{ id: string, state: 'cancelled' | 'not_found' }>}
   */
  function cancel(id) {
    const target = typeof id === 'string' && id ? id : lastId;
    abort();
    if (!target) return Promise.resolve({ id: '', state: 'not_found' });
    return Promise.resolve({ id: target, state: 'cancelled' });
  }

  function dispose() {
    abort();
    replyListeners.clear();
    workingListeners.clear();
    ackListeners.clear();
  }

  return {
    send,
    onReply: (cb) => addListener(replyListeners, cb),
    onWorking: (cb) => addListener(workingListeners, cb),
    onAck: (cb) => addListener(ackListeners, cb),
    abort,
    cancel,
    dispose,
    holdReply,
    releaseReply,
    /** Test helper — last screenshot passed to send(). */
    lastScreenshot: () => lastScreenshot,
  };
}
