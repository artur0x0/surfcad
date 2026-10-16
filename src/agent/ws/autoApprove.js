/**
 * Playtest-only auto-approve for M1 local agent pairing.
 * Compiled in only when `VITE_SURFCAD_PLAYTEST=1` at build time (`npm run build:playtest`).
 */

const PLAYTEST_AGENT_BRIDGE = import.meta.env.VITE_SURFCAD_PLAYTEST === '1';

/**
 * @returns {boolean}
 */
export function isAgentBridgeAutoApprove() {
  if (!PLAYTEST_AGENT_BRIDGE) return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('surfcadAgentBridgeAutoApprove') === '1';
  } catch {
    return false;
  }
}

/**
 * @param {boolean} enabled
 */
export function setAgentBridgeAutoApprove(enabled) {
  if (!PLAYTEST_AGENT_BRIDGE) return;
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem('surfcadAgentBridgeAutoApprove', '1');
    else window.localStorage.removeItem('surfcadAgentBridgeAutoApprove');
  } catch {
    /* noop */
  }
}
