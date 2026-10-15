/** Default loopback relay URL (set by the Vite plugin via `VITE_SURFCAD_AGENT_WS_URL`). */
export function defaultAgentBridgeWsUrl() {
  const fromVite = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SURFCAD_AGENT_WS_URL;
  if (typeof fromVite === 'string' && fromVite) return fromVite;
  return 'ws://127.0.0.1:17341';
}
