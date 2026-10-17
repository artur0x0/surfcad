/**
 * HTML escaping and person-name checks for outbound email.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const PERSON_NAME_MAX = 80;
/** Letters (any script), marks, numbers, spaces, and a small punctuation set. */
export const PERSON_NAME_RE = /^[\p{L}\p{M}\p{N} .,'-]+$/u;

/**
 * @returns {string} the trimmed name, or '' if empty / too long / bad charset
 */
export function sanitizePersonName(raw) {
  const s = String(raw ?? '').normalize('NFC').trim();
  if (!s || s.length > PERSON_NAME_MAX) return '';
  if (!PERSON_NAME_RE.test(s)) return '';
  return s;
}

/** Only http(s) URLs may go in an href. */
export function safeHttpUrl(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  } catch {
    /* ignore */
  }
  return '';
}
