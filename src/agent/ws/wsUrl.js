function isLoopbackWsUrl(url) {
  return typeof url === 'string' && /^ws:\/\/127\.0\.0\.1:\d+$/.test(url.trim());
}

/** Default loopback relay URL (set by the Vite plugin via `VITE_SURFCAD_AGENT_WS_URL`). */
export function defaultAgentBridgeWsUrl() {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('agentBridgeWs') || params.get('agentWs');
      if (isLoopbackWsUrl(fromQuery)) return fromQuery.trim();
      const stored = window.localStorage.getItem('surfcadAgentBridgeWsUrl');
      if (isLoopbackWsUrl(stored)) return stored.trim();
    } catch {
      /* noop */
    }
  }
  const fromVite = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SURFCAD_AGENT_WS_URL;
  if (typeof fromVite === 'string' && fromVite) return fromVite;
  return 'ws://127.0.0.1:17341';
}

/**
 * Query / localStorage transport overrides are for `vite` and
 * `npm run build:playtest` only. Production ignores them.
 *
 * @param {{ DEV?: boolean, VITE_SURFCAD_PLAYTEST?: string }} [env]
 */
export function agentBridgeTransportOverrideAllowed(env = import.meta.env) {
  return env?.DEV === true || env?.VITE_SURFCAD_PLAYTEST === '1';
}

/**
 * Force the Local agent transport (`direct` or `popup`) for testing via
 * `?agentBridgeTransport=` or localStorage `surfcadAgentBridgeTransport`.
 *
 * @returns {'direct' | 'popup' | null}
 */
export function agentBridgeTransportOverride() {
  if (!agentBridgeTransportOverrideAllowed()) return null;
  if (typeof window === 'undefined') return null;
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('agentBridgeTransport');
    if (fromQuery === 'direct' || fromQuery === 'popup') return fromQuery;
    const stored = window.localStorage.getItem('surfcadAgentBridgeTransport');
    if (stored === 'direct' || stored === 'popup') return stored;
  } catch {
    /* noop */
  }
  return null;
}
