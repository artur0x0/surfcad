/**
 * Where this tab looks for an agent.
 * Auto (Chrome desktop): localhost relay, then the server.
 * Safari and a phone-width page always use the server.
 */

export const RELAY_PREFERENCE_KEY = 'surfcadAgentRelay';
export const RELAY_PREFERENCES = Object.freeze(['auto', 'local', 'server']);

/**
 * @param {Storage | null | undefined} storage
 * @returns {'auto' | 'local' | 'server'}
 */
export function readRelayPreference(storage) {
  try {
    const value = storage?.getItem(RELAY_PREFERENCE_KEY);
    if (value === 'local' || value === 'server' || value === 'auto') return value;
  } catch { /* private mode */ }
  return 'auto';
}

/**
 * @param {Storage | null | undefined} storage
 * @param {'auto' | 'local' | 'server'} value
 */
export function writeRelayPreference(storage, value) {
  if (value !== 'auto' && value !== 'local' && value !== 'server') return;
  try {
    storage?.setItem(RELAY_PREFERENCE_KEY, value);
  } catch { /* private mode */ }
  if (typeof globalThis.dispatchEvent === 'function' && typeof Event !== 'undefined') {
    try { globalThis.dispatchEvent(new Event('surfcad-agent-relay')); } catch { /* node */ }
  }
}

/**
 * @param {string | undefined} userAgent
 */
export function isSafariFamily(userAgent) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg\/|CriOS|FxiOS|EdgiOS/i.test(ua);
}

/**
 * @param {{
 *   preference?: string,
 *   userAgent?: string,
 *   isMobile?: boolean,
 * }} input
 * @returns {'auto' | 'local' | 'server'}
 */
export function resolveRelayTarget(input = {}) {
  if (input.isMobile === true || isSafariFamily(input.userAgent)) return 'server';
  if (input.preference === 'local' || input.preference === 'server') return input.preference;
  return 'auto';
}

/**
 * @param {{ protocol?: string, host?: string }} [location]
 * @returns {string}
 */
export function serverAgentWsUrl(location = globalThis.location) {
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location?.host || 'localhost';
  return `${protocol}//${host}/agent`;
}
