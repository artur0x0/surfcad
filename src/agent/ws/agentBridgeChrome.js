/**
 * Pure UI state helpers for agent bridge chrome (unit-tested).
 */

/**
 * @typedef {'connected' | 'reconnecting' | 'lost' | null} AgentBridgeLink
 */

const RING_STATES = new Set(['connected', 'reconnecting', 'lost']);

/**
 * Profile-chip ring variant for the local agent link, or null for no ring.
 *
 * @param {AgentBridgeLink | undefined} link
 * @returns {AgentBridgeLink}
 */
export function agentBridgeRingState(link) {
  return RING_STATES.has(link) ? link : null;
}

/** @param {AgentBridgeLink} ring */
export function agentBridgeRingLabel(ring) {
  if (ring === 'connected') return 'Local agent connected';
  if (ring === 'reconnecting') return 'Local agent reconnecting';
  if (ring === 'lost') return 'Local agent connection lost';
  return '';
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
