/**
 * Command path used when the agent WebSocket cannot be opened.
 * POST /agent/commands, then SSE, then long-poll. The bearer token is sent
 * on the request and is never written into an error or a log line.
 */

import { readCommandResponse } from '../commandProtocol.mjs';
import { asRemoteError, authErrorFromBody } from '../errors.mjs';

/** How long a command may sit unanswered, on the WebSocket and on HTTPS. */
export const COMMAND_WAIT_MS = 10 * 60 * 1000;
const STEP_TIMEOUT_MS = 30_000;

/** Same error for a WebSocket command and for the HTTPS wait. */
export function commandWaitTimeout() {
  return Object.assign(new Error('Timed out waiting for the SurfCAD tab.'), {
    code: 'bridge_error',
    retryable: true,
  });
}

/**
 * @param {number} status
 * @param {any} json
 */
function httpFailure(status, json) {
  if (status === 401) return authErrorFromBody(json);
  const code = typeof json?.error === 'string' ? json.error : '';
  const message = typeof json?.message === 'string' ? json.message : '';
  return asRemoteError({ code, message: message || code });
}

/**
 * @param {unknown} response
 */
export function resultFromCommandResponse(response) {
  const parsed = readCommandResponse(response);
  if (!parsed) {
    return {
      ok: false,
      error: Object.assign(new Error('Bad command response'), { code: 'bridge_error' }),
    };
  }
  if (parsed.ok === true) return { ok: true, result: parsed.result };
  return { ok: false, error: asRemoteError(parsed.error) };
}

/**
 * @param {string} raw
 */
export function parseSseBlock(raw) {
  let event = 'message';
  /** @type {string[]} */
  const data = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim());
  }
  /** @type {unknown} */
  let json = null;
  if (data.length) {
    try {
      json = JSON.parse(data.join('\n'));
    } catch {
      json = null;
    }
  }
  return { event, data: json };
}

/**
 * @param {string} buffer
 * @param {{ event: string, data: unknown }[]} events
 */
function drainSse(buffer, events) {
  let rest = buffer.replace(/\r\n/g, '\n');
  let idx = rest.indexOf('\n\n');
  while (idx !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    if (raw.trim()) events.push(parseSseBlock(raw));
    idx = rest.indexOf('\n\n');
  }
  return rest;
}

/**
 * @param {Response} res
 */
async function readSseEvents(res) {
  /** @type {{ event: string, data: unknown }[]} */
  const events = [];
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    drainSse(`${text.replace(/\r\n/g, '\n')}\n\n`, events);
    return events;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  try {
    while (!done) {
      const next = await reader.read();
      done = next.done === true;
      if (done) break;
      buffer += decoder.decode(next.value, { stream: true });
      buffer = drainSse(buffer, events);
    }
    buffer += decoder.decode();
    drainSse(`${buffer}\n\n`, events);
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  return events;
}

/**
 * @param {{ event: string, data: unknown }[]} events
 * @returns {'pending' | { ok: true, result: unknown } | { ok: false, error: Error }}
 */
function interpretSse(events) {
  for (const event of events) {
    if (event.event === 'error') {
      const code = event.data && typeof event.data === 'object'
        ? /** @type {{ error?: string }} */ (event.data).error
        : '';
      if (code === 'not_found') {
        return {
          ok: false,
          error: Object.assign(new Error('That command is no longer waiting.'), { code: 'not_found' }),
        };
      }
      return { ok: false, error: asRemoteError({ code: code || 'bridge_error', message: 'Command failed' }) };
    }
    if (event.event === 'pending') return 'pending';
    if (event.event === 'result') {
      const outcome = resultFromCommandResponse(event.data);
      if (!outcome.ok) return { ok: false, error: outcome.error };
      return { ok: true, result: outcome.result };
    }
  }
  return 'pending';
}

/**
 * @param {string} url
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 * @param {AbortSignal} signal
 */
async function fetchAuthed(url, token, fetchImpl, signal) {
  return fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal,
  });
}

/**
 * @param {{
 *   commandsUrl: string,
 *   token: string,
 *   frame: { v: number, id: string | number, command: string, args: unknown },
 *   fetch?: typeof fetch,
 *   now?: () => number,
 * }} options
 */
export async function callOverHttp(options) {
  const fetchImpl = options.fetch || fetch;
  const now = options.now || Date.now;
  const frame = options.frame;
  const post = await fetchImpl(options.commandsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(frame),
  });
  /** @type {any} */
  let posted = null;
  try {
    posted = await post.json();
  } catch {
    posted = null;
  }
  if (post.status === 401) throw authErrorFromBody(posted);
  if (post.status !== 202) throw httpFailure(post.status, posted);

  const deadline = now() + COMMAND_WAIT_MS;
  let sseFailed = false;
  while (now() < deadline) {
    const signal = AbortSignal.timeout(STEP_TIMEOUT_MS + 5000);
    if (!sseFailed) {
      try {
        const outcome = await waitViaSse(options, fetchImpl, signal);
        if (outcome === 'pending') continue;
        if (!outcome.ok) throw outcome.error;
        return outcome.result;
      } catch (err) {
        if (isTerminal(err)) throw err;
        sseFailed = true;
      }
    }
    const polled = await waitViaPoll(options, fetchImpl, signal);
    if (polled === 'pending') continue;
    if (!polled.ok) throw polled.error;
    return polled.result;
  }
  throw commandWaitTimeout();
}

/**
 * @param {unknown} err
 */
function isTerminal(err) {
  const code = err && typeof err === 'object' ? /** @type {{ code?: string }} */ (err).code : '';
  return code === 'tab_asleep'
    || code === 'too_many_pending'
    || code === 'token_revoked'
    || code === 'expired'
    || code === 'client_update_required'
    || code === 'not_found';
}

/**
 * @param {{ commandsUrl: string, token: string, frame: { id: string | number } }} options
 * @param {typeof fetch} fetchImpl
 * @param {AbortSignal} signal
 */
async function waitViaSse(options, fetchImpl, signal) {
  const url = `${options.commandsUrl}/${encodeURIComponent(String(options.frame.id))}/events?timeout=${STEP_TIMEOUT_MS}`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'text/event-stream',
    },
    signal,
  });
  if (res.status === 401) {
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    throw authErrorFromBody(json);
  }
  if (!res.ok) {
    try { await res.body?.cancel?.(); } catch { /* noop */ }
    throw Object.assign(new Error(`Event stream failed (${res.status})`), { code: 'sse_failed' });
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { await res.body?.cancel?.(); } catch { /* noop */ }
    throw Object.assign(new Error('Event stream was not available'), { code: 'sse_failed' });
  }
  const events = await readSseEvents(res);
  if (!events.length) {
    throw Object.assign(new Error('Event stream was empty'), { code: 'sse_failed' });
  }
  return interpretSse(events);
}

/**
 * @param {{ commandsUrl: string, token: string, frame: { id: string | number } }} options
 * @param {typeof fetch} fetchImpl
 * @param {AbortSignal} signal
 */
async function waitViaPoll(options, fetchImpl, signal) {
  const url = `${options.commandsUrl}/${encodeURIComponent(String(options.frame.id))}?timeout=${STEP_TIMEOUT_MS}`;
  const res = await fetchAuthed(url, options.token, fetchImpl, signal);
  /** @type {any} */
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status === 401) throw authErrorFromBody(json);
  if (res.status === 404) {
    throw Object.assign(new Error('That command is no longer waiting.'), { code: 'not_found' });
  }
  if (!res.ok) throw httpFailure(res.status, json);
  if (json?.status === 'pending') return 'pending';
  if (json?.status === 'done') {
    const outcome = resultFromCommandResponse(json.response);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, result: outcome.result };
  }
  throw Object.assign(new Error('Bad command response'), { code: 'bridge_error' });
}
