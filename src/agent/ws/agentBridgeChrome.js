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

/** Below this width the Allow/Deny portal sits under the chip, not bottom-center. */
export const APPROVAL_POPUP_WIDE_MIN_PX = 900;

/**
 * Body-portal Allow/Deny placement. Wide viewports: bottom-center, clear of the
 * right-hand profile panel. Narrow viewports: under the chip / beside the
 * panel so Privacy choices at the bottom of the menu stays uncovered.
 *
 * @param {number | null | undefined} viewportWidth
 * @param {{ embedded?: boolean }} [opts]
 */
export function approvalPopupPositionClass(viewportWidth, opts = {}) {
  if (opts.embedded) return 'absolute left-0 right-0 -top-2 z-10 -translate-y-full';
  if (viewportWidth != null && viewportWidth < APPROVAL_POPUP_WIDE_MIN_PX) {
    return 'fixed top-14 left-3 z-[130]';
  }
  return 'fixed bottom-6 left-1/2 z-[130] -translate-x-1/2';
}

/**
 * Expected portal box for overlap tests (matches the Tailwind classes above).
 *
 * @param {{ width: number, height?: number }} viewport
 * @param {{ width?: number, height?: number }} [popupSize]
 */
export function approvalPopupBox(viewport, popupSize = {}) {
  const size = { width: popupSize.width ?? 220, height: popupSize.height ?? 48 };
  const height = viewport.height ?? 800;
  if (viewport.width < APPROVAL_POPUP_WIDE_MIN_PX) {
    return { x: 12, y: 56, ...size };
  }
  return {
    x: viewport.width / 2 - size.width / 2,
    y: height - 24 - size.height,
    ...size,
  };
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
