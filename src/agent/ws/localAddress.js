/**
 * Localhost binding and browser Origin allowlist for the M1 agent-bridge relay.
 * Kept in sync with `packages/surfcad-mcp/src/bridge/localAddress.mjs`.
 *
 * This copy stays dependency-free. Hostnames are exact matches. A literal
 * IPv4 in 127.0.0.0/8 is allowed only when all four octets are decimal.
 * Never prefix-match a hostname with `127.`.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const PROD_SURFCAD_HOSTS = new Set(['surfcad.com', 'www.surfcad.com']);

/**
 * @param {string} host
 */
function unbracket(host) {
  if (host.startsWith('[') && host.endsWith(']') && host.indexOf(']') === host.length - 1) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * Four decimal octets, no leading zeros. Matches what `net.isIP` accepts
 * for IPv4 dotted quads.
 * @param {string} host
 */
function isDottedQuad(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

/**
 * @param {string} host
 */
function isLiteralLoopbackIp(host) {
  if (isDottedQuad(host)) {
    const dot = host.indexOf('.');
    return dot > 0 && Number(host.slice(0, dot)) === 127;
  }
  const lower = host.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    return isDottedQuad(v4) && isLiteralLoopbackIp(v4);
  }
  return false;
}

export function isLoopbackAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (LOCAL_HOSTNAMES.has(trimmed)) return true;
  const host = unbracket(trimmed);
  if (host !== trimmed && LOCAL_HOSTNAMES.has(host)) return true;
  return isLiteralLoopbackIp(host);
}

/**
 * @param {string | undefined | null} origin
 */
export function isAllowedHttpOrigin(origin) {
  if (!origin || typeof origin !== 'string') return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (LOCAL_HOSTNAMES.has(url.hostname)) return true;
    const literal = unbracket(url.hostname);
    if (isLiteralLoopbackIp(literal)) return true;
    if (PROD_SURFCAD_HOSTS.has(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export { PROD_SURFCAD_HOSTS, LOCAL_HOSTNAMES };
