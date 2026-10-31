const ALLOWED_KEYS = ['event', 'userId', 'tabId', 'command', 'bytes', 'status'];

/**
 * Metadata only. Payload fields, tokens, codes, and secrets are dropped
 * even if a caller passes them.
 * @param {Record<string, unknown>} meta
 */
export function logRelay(meta) {
  /** @type {Record<string, unknown>} */
  const safe = {};
  for (const key of ALLOWED_KEYS) {
    if (meta[key] !== undefined) safe[key] = meta[key];
  }
  console.info('[agent-relay]', JSON.stringify(safe));
}
