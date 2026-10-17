/**
 * Localhost binding and browser Origin allowlist for the M1 agent-bridge relay.
 * Kept in sync with `packages/surfcad-mcp/src/bridge/localAddress.mjs`.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const PROD_SURFCAD_HOSTS = new Set(['surfcad.com', 'www.surfcad.com']);

/**
 * @param {string | undefined | null} address
 */
export function isLoopbackAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (LOCAL_HOSTNAMES.has(trimmed)) return true;
  if (trimmed.startsWith('127.')) return true;
  if (trimmed === '::ffff:127.0.0.1') return true;
  return false;
}

/**
 * @param {string | undefined | null} origin
 */
export function isAllowedHttpOrigin(origin) {
  if (!origin || typeof origin !== 'string') return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (LOCAL_HOSTNAMES.has(url.hostname) || url.hostname.startsWith('127.')) return true;
    if (PROD_SURFCAD_HOSTS.has(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export { PROD_SURFCAD_HOSTS, LOCAL_HOSTNAMES };
