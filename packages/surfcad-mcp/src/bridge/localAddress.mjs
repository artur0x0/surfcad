import { isIP } from 'node:net';

/**
 * Localhost binding and browser Origin allowlist for the M1 agent-bridge relay.
 *
 * Hostnames are exact matches only. A string that merely starts with `127.`
 * is not loopback: `127.evil.com` is a DNS name.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const PROD_SURFCAD_HOSTS = new Set(['surfcad.com', 'www.surfcad.com']);

/**
 * Drop one pair of URL brackets so `net.isIP` can see the address.
 * @param {string} host
 */
function unbracket(host) {
  if (host.startsWith('[') && host.endsWith(']') && host.indexOf(']') === host.length - 1) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * A literal IP in 127.0.0.0/8, `::1`, or an IPv4-mapped form of those.
 * `net.isIP` has already accepted `host`. Never call this with a hostname.
 * @param {string} host
 */
function isLiteralLoopbackIp(host) {
  const kind = isIP(host);
  if (kind === 4) {
    const dot = host.indexOf('.');
    return dot > 0 && Number(host.slice(0, dot)) === 127;
  }
  if (kind === 6) {
    const lower = host.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice('::ffff:'.length);
      return isIP(v4) === 4 && isLiteralLoopbackIp(v4);
    }
  }
  return false;
}

export function isLoopbackAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (LOCAL_HOSTNAMES.has(trimmed)) return true;
  const host = unbracket(trimmed);
  if (host !== trimmed && LOCAL_HOSTNAMES.has(host)) return true;
  if (!isIP(host)) return false;
  return isLiteralLoopbackIp(host);
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
    if (LOCAL_HOSTNAMES.has(url.hostname)) return true;
    const literal = unbracket(url.hostname);
    if (isIP(literal) && isLoopbackAddress(literal)) return true;
    if (PROD_SURFCAD_HOSTS.has(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export { PROD_SURFCAD_HOSTS, LOCAL_HOSTNAMES };
