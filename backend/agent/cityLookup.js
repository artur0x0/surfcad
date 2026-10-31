/**
 * City from the requester IP. ipdata.free is keyless and allows commercial
 * use with attribution (https://ipdata.co/free). A miss, a private address,
 * or a timeout leaves the city unset.
 */

export const CITY_LOOKUP_CREDIT = 'IP geolocation by ipdata';
export const CITY_LOOKUP_URL = 'https://ipdata.co/';
const LOOKUP_TIMEOUT_MS = 1500;
const CACHE_MS = 10 * 60 * 1000;

/**
 * @param {string} value
 * @returns {string | null}
 */
export function cityLabel(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/,/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return text || null;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
export function isPublicIp(ip) {
  const raw = String(ip || '').trim().toLowerCase();
  if (!raw || raw === 'unknown') return false;
  const v4 = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  if (v4.includes(':')) {
    if (v4 === '::1' || v4 === '::') return false;
    if (v4.startsWith('fc') || v4.startsWith('fd') || v4.startsWith('fe80')) return false;
    return true;
  }
  const parts = v4.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 255 && b === 255) return false;
  return true;
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   timeoutMs?: number,
 * }} [opts]
 */
export function createCityLookup(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  /** @type {Map<string, { city: string | null, at: number }>} */
  const cache = new Map();

  /**
   * @param {string | undefined} ip
   * @returns {Promise<string | null>}
   */
  return async function lookupCity(ip) {
    const key = String(ip || '').trim();
    if (!isPublicIp(key)) return null;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.city;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    /** @type {string | null} */
    let city = null;
    try {
      const response = await fetchImpl(`https://ipdata.free/${encodeURIComponent(key)}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (response.ok) {
        const body = await response.json();
        city = cityLabel(body?.city);
      }
    } catch {
      city = null;
    } finally {
      clearTimeout(timer);
    }
    cache.set(key, { city, at: now() });
    return city;
  };
}
