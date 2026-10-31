/**
 * Where this tab looks for an agent.
 * Auto (Chrome desktop): localhost relay, then the server.
 * Safari, iOS (including a touch Mac UA), and a phone-width page always
 * use the server. A stored Local preference does not override that.
 * `isSecureContext` is not an input: plain http still forces the server.
 */

export const RELAY_PREFERENCE_KEY = 'surfcadAgentRelay';
export const RELAY_PREFERENCES = Object.freeze(['auto', 'local', 'server']);
/** Match the app's phone layout split. */
export const PHONE_RELAY_MAX_WIDTH_PX = 768;

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
 * Desktop Safari, and any UA that names iPhone, iPad, or iPod (iOS Chrome
 * and Firefox are WebKit and still carry that token).
 *
 * @param {string | undefined} userAgent
 */
export function isSafariFamily(userAgent) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg\/|CriOS|FxiOS|EdgiOS/i.test(ua);
}

/**
 * iPadOS desktop-site mode sends a Macintosh UA and platform `MacIntel`
 * with maxTouchPoints > 1. iOS Chrome does that too (`CriOS` on Macintosh),
 * which {@link isSafariFamily} does not treat as Safari.
 *
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [input]
 */
export function isTouchAppleDevice(input = {}) {
  const ua = String(input.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (Number(input.maxTouchPoints) <= 1) return false;
  const platform = String(input.platform || '');
  return /Macintosh|MacIntel/i.test(ua) || /MacIntel/i.test(platform);
}

/**
 * @param {{ isMobile?: boolean, innerWidth?: number }} [input]
 */
export function isPhoneWidth(input = {}) {
  if (input.isMobile === true) return true;
  const width = Number(input.innerWidth);
  return Number.isFinite(width) && width > 0 && width <= PHONE_RELAY_MAX_WIDTH_PX;
}

/**
 * Synchronous phone-width read. Uses innerWidth and matchMedia so a missing
 * matchMedia (or a width that lands after the first effect) still counts.
 * A zero innerWidth is "not laid out yet", not a phone.
 *
 * @param {{ innerWidth?: number, matchMedia?: (query: string) => { matches?: boolean } } | null | undefined} win
 */
export function readPhoneWidth(win) {
  if (!win) return false;
  const width = Number(win.innerWidth);
  if (Number.isFinite(width) && width > 0 && width <= PHONE_RELAY_MAX_WIDTH_PX) return true;
  try {
    if (typeof win.matchMedia === 'function' && win.matchMedia('(max-width: 768px)').matches) return true;
  } catch { /* private / old webview */ }
  return false;
}

/**
 * Safari, iOS WebKit (including desktop-site iPad), or a phone-width page.
 * Ignores `isSecureContext` and the stored relay preference.
 *
 * @param {{
 *   userAgent?: string,
 *   platform?: string,
 *   maxTouchPoints?: number,
 *   isMobile?: boolean,
 *   innerWidth?: number,
 *   isSecureContext?: boolean,
 * }} [input]
 */
export function forcesServerRelay(input = {}) {
  if (isPhoneWidth(input)) return true;
  if (isSafariFamily(input.userAgent)) return true;
  if (isTouchAppleDevice(input)) return true;
  return false;
}

/**
 * @param {{
 *   preference?: string,
 *   userAgent?: string,
 *   platform?: string,
 *   maxTouchPoints?: number,
 *   isMobile?: boolean,
 *   innerWidth?: number,
 *   isSecureContext?: boolean,
 * }} [input]
 * @returns {'auto' | 'local' | 'server'}
 */
export function resolveRelayTarget(input = {}) {
  if (forcesServerRelay(input)) return 'server';
  if (input.preference === 'local' || input.preference === 'server') return input.preference;
  return 'auto';
}

/**
 * Auto on desktop Chrome probes the loopback relay once. Local only, Server
 * only, and every forced server client do not.
 *
 * @param {{
 *   preference?: string,
 *   relayTarget?: string,
 *   userAgent?: string,
 *   platform?: string,
 *   maxTouchPoints?: number,
 *   isMobile?: boolean,
 *   innerWidth?: number,
 *   isSecureContext?: boolean,
 * }} [input]
 */
export function shouldProbeLocalRelay(input = {}) {
  if (forcesServerRelay(input)) return false;
  if (input.relayTarget === 'server' || input.relayTarget === 'local') return false;
  if (input.preference === 'local' || input.preference === 'server') return false;
  return true;
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
