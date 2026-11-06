/**
 * `surfcad-mcp listen`: the process that stays up between agent turns.
 *
 * An MCP server cannot start an agent turn, and a host that starts a fresh
 * `surfcad-mcp` per tool call has nothing running while the agent is idle.
 * A message the user sends from the SurfCAD chat box then waits on the
 * server with nobody to read it. This loop watches for it and fires the
 * saved wake action, so the agent starts a turn and reads the message.
 *
 * It uses the server relay's HTTPS pull (GET /agent/prompts), outbound only,
 * so it works behind NAT and for a tab on a phone: neither side has to be
 * reachable. The pull has the semantics a watcher needs and a socket does
 * not:
 *   - a prompt offered to a pull session stays held on the server until an
 *     agent process reports it taken, so watching never consumes a message;
 *   - each poll renews presence, so the server keeps holding prompts for an
 *     idle agent and the tab shows the message as queued, not failed;
 *   - a cancel is answered by the server, with no socket here to answer it.
 *
 * A prompt is not a reason to wake by itself. An agent that is already in a
 * turn long-polls read_messages and takes it within seconds, and a wake then
 * would start a second turn. So each new prompt waits `graceMs`, and is
 * then looked for again from a fresh pull session: the server offers every
 * prompt it still holds to a session that has not seen it. Still there
 * means nobody took it, and that is when the wake fires.
 *
 * One more case: the agent is in a turn but between polls. It made a tool
 * call in the last minute (./awake.mjs), so it is not woken; the prompt is
 * looked at again every 15 s until the agent reads it or goes idle.
 */

import { randomUUID } from 'node:crypto';
import { agentUrls } from '../remote/config.mjs';
import { createWaker, wakePayload } from './wake.mjs';

export const LISTEN_POLL_MS = 25_000;
export const LISTEN_GRACE_MS = 4_000;
/** A prompt that was woken for and is still unread is woken for once more after this. */
export const LISTEN_REWAKE_MS = 120_000;
/** While the wake command of an earlier message still runs, look again this often. */
export const LISTEN_BUSY_RETRY_MS = 15_000;
export const LISTEN_BACKOFF_MS = Object.freeze([1_000, 2_000, 5_000, 10_000, 30_000]);
const SEEN_CAP = 500;

function newSession() {
  return randomUUID().replace(/-/g, '');
}

/**
 * @param {unknown} frame
 * @returns {{ id: string, text?: string, ts?: string, screenshot?: unknown } | null}
 */
export function promptFromFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;
  const f = /** @type {Record<string, any>} */ (frame);
  if (f.type !== 'agent.prompt' || typeof f.id !== 'string' || !f.id) return null;
  return {
    id: f.id,
    ...(typeof f.text === 'string' ? { text: f.text } : {}),
    ...(typeof f.ts === 'string' ? { ts: f.ts } : {}),
    ...(f.screenshot ? { screenshot: true } : {}),
  };
}

/**
 * @param {{
 *   serverUrl: string,
 *   token: string,
 *   wake: import('./wakeConfig.mjs').WakeConfig,
 *   fetch?: typeof fetch,
 *   log?: (line: string) => void,
 *   graceMs?: number,
 *   pollMs?: number,
 *   rewakeMs?: number,
 *   backoffMs?: readonly number[],
 *   waker?: ReturnType<typeof createWaker>,
 *   isAwake?: () => Promise<boolean> | boolean,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   now?: () => number,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<{ reason: 'stopped' | 'token_revoked' | 'expired' | 'unauthorized' }>}
 */
export async function runListener(options) {
  const urls = agentUrls(options.serverUrl);
  const doFetch = options.fetch || fetch;
  const log = options.log || (() => {});
  const graceMs = options.graceMs ?? LISTEN_GRACE_MS;
  const pollMs = options.pollMs ?? LISTEN_POLL_MS;
  const rewakeMs = options.rewakeMs ?? LISTEN_REWAKE_MS;
  const backoff = options.backoffMs || LISTEN_BACKOFF_MS;
  const waker = options.waker || createWaker(options.wake);
  const isAwake = options.isAwake || (() => false);
  const now = options.now || (() => Date.now());
  const signal = options.signal;
  const sleep = options.sleep || ((ms, sig) => new Promise((resolve) => {
    if (sig?.aborted) { resolve(); return; }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      sig?.removeEventListener('abort', done);
      resolve();
    }
    sig?.addEventListener('abort', done, { once: true });
  }));

  /** Prompts seen and not yet known to be read: id → { prompt, due, wakes }. */
  const waiting = new Map();
  /** Ids that are finished here (read by an agent, or given up on). */
  const settled = new Set();
  const session = newSession();

  /**
   * @param {string} sessionId
   * @param {number} timeoutMs
   * @returns {Promise<object[]>}
   */
  async function pull(sessionId, timeoutMs) {
    const url = new URL(urls.promptsUrl);
    url.searchParams.set('timeout', String(timeoutMs));
    url.searchParams.set('session', sessionId);
    let res;
    try {
      res = await doFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${options.token}` },
        signal,
      });
    } catch {
      throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
    }
    if (res.status === 401) {
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      const code = json && typeof json.error === 'string' ? json.error : '';
      throw Object.assign(new Error('unauthorized'), {
        code: code === 'expired' || code === 'token_revoked' ? code : 'unauthorized',
      });
    }
    if (!res.ok) {
      try { await res.body?.cancel?.(); } catch { /* noop */ }
      throw Object.assign(new Error(`pull ${res.status}`), { code: 'bridge_error' });
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return json && Array.isArray(json.messages) ? json.messages : [];
  }

  /** @param {object[]} frames */
  function note(frames) {
    for (const frame of frames) {
      const prompt = promptFromFrame(frame);
      if (!prompt || settled.has(prompt.id) || waiting.has(prompt.id)) continue;
      waiting.set(prompt.id, { prompt, due: now() + graceMs, wakes: 0 });
      log(`message ${prompt.id} is waiting; checking in ${Math.round(graceMs / 1000)} s whether an agent read it`);
    }
  }

  function settle(id) {
    waiting.delete(id);
    settled.add(id);
    if (settled.size > SEEN_CAP) settled.delete(settled.values().next().value);
  }

  /**
   * Wake for every prompt that is past its grace and still held.
   * @returns {Promise<void>}
   */
  async function check() {
    const due = [...waiting.values()].filter((row) => row.due <= now());
    if (!due.length) return;
    // A fresh session is offered everything the server still holds.
    const held = new Map();
    for (const frame of await pull(newSession(), 0)) {
      const prompt = promptFromFrame(frame);
      if (prompt) held.set(prompt.id, prompt);
    }
    const unread = [];
    for (const row of due) {
      if (!held.has(row.prompt.id)) {
        log(`message ${row.prompt.id} was read (or cancelled); no wake`);
        settle(row.prompt.id);
      } else if (row.wakes >= 2) {
        log(`message ${row.prompt.id} is still unread after two wakes; leaving it for the agent's next turn`);
        settle(row.prompt.id);
      } else {
        unread.push(row);
      }
    }
    // Anything else still held that this loop has not met is new to it.
    note([...held.values()].map((p) => ({ type: 'agent.prompt', ...p })));
    if (!unread.length) return;
    // An agent in a turn is not woken: it reads the message at its next
    // read_messages, and a wake would start a second turn beside the first.
    if (await isAwake()) {
      for (const row of unread) {
        if (!row.deferred) log(`message ${row.prompt.id} is unread but the agent is in a turn; waiting for it to read the message or go idle`);
        row.deferred = true;
        row.due = now() + LISTEN_BUSY_RETRY_MS;
      }
      return;
    }
    const outcome = await waker.wake(wakePayload(unread.map((row) => row.prompt)));
    if (outcome.ok) {
      log(`woke the agent by ${outcome.form} for ${unread.length} message${unread.length === 1 ? '' : 's'}`);
      for (const row of unread) {
        row.wakes += 1;
        row.due = now() + rewakeMs;
      }
      return;
    }
    if (outcome.error === 'wake_exec_busy') {
      log('the wake command from an earlier message is still running; checking again shortly');
      for (const row of unread) row.due = now() + LISTEN_BUSY_RETRY_MS;
      return;
    }
    log(`wake failed (${outcome.error}); trying again in ${Math.round(rewakeMs / 1000)} s`);
    for (const row of unread) row.due = now() + rewakeMs;
  }

  let failures = 0;
  log(`listening for SurfCAD chat messages at ${urls.origin}`);
  while (!signal?.aborted) {
    try {
      // Poll no longer than the next check is due.
      let wait = pollMs;
      for (const row of waiting.values()) wait = Math.min(wait, Math.max(0, row.due - now()));
      if (wait > 0) note(await pull(session, Math.min(pollMs, Math.max(250, wait))));
      if (signal?.aborted) break;
      await check();
      failures = 0;
    } catch (err) {
      if (signal?.aborted) break;
      const code = err && typeof err === 'object' ? err.code : '';
      if (code === 'token_revoked' || code === 'expired' || code === 'unauthorized') {
        log(code === 'expired'
          ? 'the SurfCAD login expired; run npx surfcad-mcp login, then start the listener again'
          : 'the SurfCAD login is no longer valid; run npx surfcad-mcp login, then start the listener again');
        return { reason: code };
      }
      const delay = backoff[Math.min(failures, backoff.length - 1)];
      failures += 1;
      if (failures === 1 || failures % 10 === 0) {
        log(`cannot reach ${urls.origin} (${code || 'error'}); retrying`);
      }
      await sleep(delay, signal);
    }
  }
  return { reason: 'stopped' };
}
