/**
 * PII scrubbing helpers for Sentry payloads (browser). Pure functions — safe for unit tests.
 */

const FILE_NAME_RE = /\b[\w.-]+\.(?:step|stp|stl|3mf|obj|scad|iges|igs|brep|fcstd|part|asm)(?:\b|$)/gi;
const PART_NAME_KEY_RE = /^(partName|part_name|filename|fileName|file_name|vaultName|vault_name)$/i;

/**
 * @param {string} url
 * @returns {string}
 */
export function redactUrlQueryAndHash(url) {
  if (typeof url !== 'string' || !url) return url;
  try {
    const parsed = new URL(url, 'http://localhost');
    parsed.search = '';
    parsed.hash = '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.hash ? '' : ''}`;
  } catch {
    const noHash = url.split('#')[0];
    const q = noHash.indexOf('?');
    return q === -1 ? noHash : noHash.slice(0, q);
  }
}

/**
 * @param {string} text
 * @returns {string}
 */
export function scrubFileAndPartNamesInText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(FILE_NAME_RE, '[redacted-file]');
}

/**
 * Deep-scrub objects sent to Sentry (breadcrumbs, contexts, extra).
 * @param {unknown} value
 * @returns {unknown}
 */
export function scrubMonitoringValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return scrubFileAndPartNamesInText(redactUrlQueryAndHash(value));
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubMonitoringValue(item));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (PART_NAME_KEY_RE.test(key)) {
        out[key] = '[redacted]';
        continue;
      }
      if (key === 'body' || key === 'data' || key === 'requestBody') {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = scrubMonitoringValue(child);
    }
    return out;
  }
  return value;
}

/**
 * @param {string} userId
 * @returns {Promise<string>}
 */
export async function hashUserId(userId) {
  const s = String(userId ?? '').trim();
  if (!s) return '';
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is not available');
  }
  const bytes = new TextEncoder().encode(s);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Record<string, unknown>} event
 * @returns {Record<string, unknown> | null}
 */
export function scrubSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const next = { ...event };

  if (next.request) {
    const req = { ...next.request };
    if (req.url) req.url = redactUrlQueryAndHash(req.url);
    if (req.headers) {
      const headers = { ...req.headers };
      delete headers.cookie;
      delete headers.Cookie;
      delete headers.authorization;
      delete headers.Authorization;
      req.headers = headers;
    }
    if (req.data !== undefined) req.data = '[redacted]';
    next.request = req;
  }

  if (next.user) {
    const id = next.user.id;
    next.user = id ? { id: String(id) } : {};
  }

  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => {
      const c = { ...crumb };
      if (c.data) c.data = scrubMonitoringValue(c.data);
      if (typeof c.message === 'string') c.message = scrubFileAndPartNamesInText(c.message);
      return c;
    });
  }

  if (next.extra) next.extra = scrubMonitoringValue(next.extra);
  if (next.contexts) next.contexts = scrubMonitoringValue(next.contexts);

  return next;
}
