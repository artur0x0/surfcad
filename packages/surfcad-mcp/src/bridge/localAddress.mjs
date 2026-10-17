/**
 * Localhost binding and browser Origin allowlist for the M1 agent-bridge relay.
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
 * Extra origins (full origin strings) allowed in tests via env.
 * @returns {Set<string>}
 */
export function extraAllowedOrigins() {
  const raw = process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS || '';
  const set = new Set();
  for (const part of raw.split(',')) {
    const o = part.trim();
    if (o) set.add(o);
  }
  return set;
}

/**
 * Browser tab WebSocket upgrades must come from an allowed https/http origin.
 * Node MCP peers omit Origin and are accepted.
 *
 * @param {string | undefined | null} origin
 */
export function isAllowedHttpOrigin(origin) {
  if (!origin || typeof origin !== 'string') return true;
  if (extraAllowedOrigins().has(origin.trim())) return true;
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
