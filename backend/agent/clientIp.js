import proxyAddr from 'proxy-addr';

/**
 * Client address for a raw Node request, matching Express `req.ip` when
 * `trust proxy` is a hop count. WebSocket upgrades are not Express
 * requests, so they do not get `req.ip`. `hops` is `TRUST_PROXY_HOPS`
 * (default 1): that many closest proxies are trusted, and the address
 * just beyond them is the client. Zero trusts only the socket peer.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [hops]
 * @returns {string}
 */
export function clientAddress(req, hops = 1) {
  const trust = Number.isInteger(hops) && hops >= 0 ? hops : 1;
  if (trust === 0) return req.socket?.remoteAddress || 'unknown';
  try {
    return proxyAddr(req, (_addr, index) => index < trust) || 'unknown';
  } catch {
    return req.socket?.remoteAddress || 'unknown';
  }
}
