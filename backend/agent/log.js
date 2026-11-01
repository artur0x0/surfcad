const ALLOWED_KEYS = [
  'event',
  'userId',
  'tabId',
  'command',
  'bytes',
  'status',
  'side',
  'code',
  'reason',
  'wasClean',
  'livedMs',
  'hello',
  'pingOutstanding',
  'message',
  'timeoutMs',
];

const CLIP_KEYS = new Set(['reason', 'message', 'status']);

/**
 * Newlines and other controls become spaces so one close stays one log line.
 * @param {string} text
 */
function singleLine(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    out += text.charCodeAt(i) < 32 ? ' ' : text[i];
  }
  return out;
}

/**
 * Close reasons and error messages are short diagnostics. A bearer, a
 * join code, or a long token-shaped run is removed before it is written.
 * @param {unknown} value
 * @param {number} [max]
 */
export function clipRelayText(value, max = 120) {
  let text;
  if (Buffer.isBuffer(value)) text = value.toString('utf8');
  else if (typeof value === 'string') text = value;
  else if (value == null) text = '';
  else text = String(value);
  text = text.replace(/Bearer\s+\S+/gi, '');
  text = text.replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '');
  text = text.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '');
  text = singleLine(text).replace(/\s+/g, ' ').trim();
  if (text.length > max) text = text.slice(0, max);
  return text;
}

/**
 * @param {unknown} value
 */
function relayCode(value) {
  const code = Number(value);
  if (!Number.isInteger(code) || code < 0 || code > 4999) return 1006;
  return code;
}

/**
 * @param {unknown} value
 */
function relayMillis(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms);
}

/**
 * `null` when the socket library did not say.
 * @param {unknown} value
 */
function relayWasClean(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

/**
 * Metadata only. Payload fields, tokens, join codes, and message bodies
 * are dropped even if a caller passes them. Close diagnostics stay, after
 * the reason and message are clipped.
 * @param {Record<string, unknown>} meta
 */
export function logRelay(meta) {
  /** @type {Record<string, unknown>} */
  const safe = {};
  for (const key of ALLOWED_KEYS) {
    if (meta[key] === undefined) continue;
    if (key === 'code') safe[key] = relayCode(meta[key]);
    else if (key === 'livedMs' || key === 'timeoutMs' || key === 'bytes') safe[key] = relayMillis(meta[key]);
    else if (key === 'hello' || key === 'pingOutstanding') safe[key] = meta[key] === true;
    else if (key === 'wasClean') safe[key] = relayWasClean(meta[key]);
    else if (key === 'side') safe[key] = meta[key] === 'tab' ? 'tab' : 'agent';
    else if (CLIP_KEYS.has(key)) safe[key] = clipRelayText(meta[key]);
    else safe[key] = meta[key];
  }
  console.info('[agent-relay]', JSON.stringify(safe));
}
