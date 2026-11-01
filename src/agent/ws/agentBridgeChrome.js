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
 * Pairing dialog and Allow/Deny portal onto document.body so they survive
 * the profile menu closing. The socket stays on AgentBridgeHost.
 *
 * @param {{ body?: { nodeType?: number } | null } | null | undefined} doc
 */
export function approvalPopupPortalTarget(doc) {
  return doc?.body || null;
}

/**
 * Clicks on the pairing dialog (or its Allow/Deny) must not count as "outside
 * the profile panel".
 *
 * @param {{ target?: { closest?: (sel: string) => unknown } | null } | null | undefined} event
 * @param {{ contains?: (node: unknown) => boolean } | null | undefined} panelEl
 */
export function shouldDismissProfilePanelOnPointer(event, panelEl) {
  const target = event?.target;
  if (!panelEl || !target) return false;
  if (typeof panelEl.contains === 'function' && panelEl.contains(target)) return false;
  if (typeof target.closest === 'function') {
    if (target.closest('[data-agent-bridge-approval]')) return false;
    if (target.closest('[data-agent-bridge-dialog]')) return false;
    if (target.closest('[data-git-dialog="account"]')) return false;
    if (target.closest('[data-profile-account-pane]')) return false;
  }
  return true;
}

/**
 * Pairing dialog chrome. `p-4 pb-14` on a centered scrim so the card stays
 * above the page-footer Privacy choices link (`SiteFooter` is `bottom-0`).
 * The old Allow/Deny pill used `bottom-6` (~24px) and overlapped that link
 * by ~4px at 1280×800.
 */
export const PAIRING_DIALOG_PAD_TOP_PX = 16;
export const PAIRING_DIALOG_PAD_BOTTOM_PX = 56;
export const PAIRING_DIALOG_MAX_WIDTH_PX = 384;

/**
 * Centered pairing-dialog card inside the padded scrim.
 *
 * @param {{ width: number, height?: number }} viewport
 * @param {{ width?: number, height?: number }} [cardSize]
 */
export function pairingDialogBox(viewport, cardSize = {}) {
  const vw = viewport.width;
  const vh = viewport.height ?? 800;
  const width = Math.min(cardSize.width ?? PAIRING_DIALOG_MAX_WIDTH_PX, Math.max(0, vw - 32));
  const innerH = Math.max(0, vh - PAIRING_DIALOG_PAD_TOP_PX - PAIRING_DIALOG_PAD_BOTTOM_PX);
  const height = Math.min(cardSize.height ?? 280, innerH);
  return {
    x: (vw - width) / 2,
    y: PAIRING_DIALOG_PAD_TOP_PX + Math.max(0, (innerH - height) / 2),
    width,
    height,
  };
}

/**
 * Page-footer Privacy choices (`[data-privacy-choices-link]`), not the
 * in-menu `[data-profile-privacy-choices]` row.
 *
 * @param {{ width: number, height?: number }} viewport
 */
/** Measured top of `[data-privacy-choices-link]` at 1280×800 in the #556 playtest. */
export const FOOTER_PRIVACY_HEIGHT_PX = 28;

export function footerPrivacyChoicesBox(viewport) {
  const vh = viewport.height ?? 800;
  const vw = viewport.width;
  return {
    x: vw / 2 - 70,
    y: vh - FOOTER_PRIVACY_HEIGHT_PX,
    width: 140,
    height: FOOTER_PRIVACY_HEIGHT_PX,
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
