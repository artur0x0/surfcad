/**
 * postMessage protocol for the loopback popup bridge.
 * Kept in sync with `packages/surfcad-mcp/src/bridge/bridgePopup.mjs`.
 */

export const BRIDGE_CHANNEL = 'surfcad-agent-bridge';

export const BRIDGE_MSG = Object.freeze({
  READY: 'bridge_ready',
  HELLO: 'bridge_hello',
  OPEN: 'bridge_open',
  FRAME: 'bridge_frame',
  CLOSE: 'bridge_close',
});

export const BRIDGE_PAGE_PATH = '/bridge';

/** Close reasons the popup transport reports on its synthetic close event. */
export const BRIDGE_CLOSE_REASON = Object.freeze({
  POPUP_BLOCKED: 'popup_blocked',
  BRIDGE_CLOSED: 'bridge_closed',
  BRIDGE_UNREACHABLE: 'bridge_unreachable',
});
