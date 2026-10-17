/**
 * Pure UI state helpers for agent bridge chrome (unit-tested).
 */

/**
 * @param {{ connected?: boolean }} input
 */
export function shouldShowAgentBridgeRing(input) {
  return input.connected === true;
}

/**
 * @param {{ open: boolean }} state
 * @param {'pair_request' | 'allow' | 'deny' | 'dismiss'} action
 */
export function approvalPopupReducer(state, action) {
  if (action === 'pair_request') return { open: true };
  if (action === 'allow' || action === 'deny' || action === 'dismiss') return { open: false };
  return state;
}
