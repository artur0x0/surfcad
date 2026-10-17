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

/** Greeting: charset/length check, then escape. Invalid names disappear. */
export function verificationGreeting(name) {
  const safe = sanitizePersonName(name);
  return safe ? ` ${escapeHtml(safe)}` : '';
}

/**
 * Shipping-address HTML. Escape only — do not charset-filter the name
 * ('Smith & Sons', 'c/o Jane' must remain).
 */
export function addressBlockHtml(address) {
  const name = address?.name ?? '';
  const street = address?.['address-1'] || address?.street || '';
  const street2 = address?.['address-2'] || address?.street2 || '';
  const city = address?.city || '';
  const state = address?.state || '';
  const zip = address?.zip || '';
  const street2Html = street2 ? `${escapeHtml(street2)}<br>` : '';
  return `${escapeHtml(name)}<br>
        ${escapeHtml(street)}<br>
        ${street2Html}
        ${escapeHtml(city)}, ${escapeHtml(state)} ${escapeHtml(zip)}`;
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
