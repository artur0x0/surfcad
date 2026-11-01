import { createHash } from 'node:crypto';

const SESSION_KEY_RE = /^[a-f0-9]{64}$/;

/**
 * Stable id of the browser session that approved a pairing.
 * SHA-256 of the express session id. Not the session secret, and not
 * the session id itself.
 * @param {unknown} sessionId
 * @returns {string | null}
 */
export function hashApprovingSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  return createHash('sha256').update(sessionId).digest('hex');
}

/**
 * Only a hex SHA-256 is stored. Anything else, including a raw session
 * id, is dropped.
 * @param {unknown} value
 * @returns {string | null}
 */
export function storedApprovingSession(value) {
  if (typeof value !== 'string' || !SESSION_KEY_RE.test(value)) return null;
  return value;
}
