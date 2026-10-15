/**
 * Playtest-only auto-approve for M1 local agent pairing.
 * Normal sessions never set the storage flag; harnesses and `npm run demo:mcp`
 * set it only under SURFCAD_PLAYTEST / scripted automation.
 */

const STORAGE_KEY = 'surfcadAgentBridgeAutoApprove';

/**
 * @returns {boolean}
 */
export function isAgentBridgeAutoApprove() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {boolean} enabled
 */
export function setAgentBridgeAutoApprove(enabled) {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
