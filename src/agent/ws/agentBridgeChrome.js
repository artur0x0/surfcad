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

/**
 * Allow/Deny is a document.body portal so PAIR_REQUEST still shows when the
 * profile menu is closed. The connection that drives it stays mounted on the chip.
 *
 * @param {{ body?: { nodeType?: number } | null } | null | undefined} doc
 */
export function approvalPopupPortalTarget(doc) {
  return doc?.body || null;
}

/**
 * Clicks on the body-portal Allow/Deny must not count as "outside the profile
 * panel" — that would close the menu and unmount the pairing UI.
 *
 * @param {{ target?: { closest?: (sel: string) => unknown } | null } | null | undefined} event
 * @param {{ contains?: (node: unknown) => boolean } | null | undefined} panelEl
 */
export function shouldDismissProfilePanelOnPointer(event, panelEl) {
  const target = event?.target;
  if (!panelEl || !target) return false;
  if (typeof panelEl.contains === 'function' && panelEl.contains(target)) return false;
  if (typeof target.closest === 'function' && target.closest('[data-agent-bridge-approval]')) {
    return false;
  }
  return true;
}

/**
 * Axis-aligned box overlap. Used so the body-portal Allow/Deny cannot sit on
 * the profile chip or menu rows the way the in-panel #539 popup did.
 *
 * @param {{ x?: number, y?: number, width?: number, height?: number } | null | undefined} a
 * @param {{ x?: number, y?: number, width?: number, height?: number } | null | undefined} b
 */
export function rectsOverlap(a, b) {
  if (!a || !b) return false;
  const aw = a.width ?? 0;
  const ah = a.height ?? 0;
  const bw = b.width ?? 0;
  const bh = b.height ?? 0;
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
  return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
}
