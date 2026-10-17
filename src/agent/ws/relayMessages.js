/**
 * Wire message types for the SurfCAD M1 agent-bridge relay (browser tab ↔ local peer).
 * Kept in sync with `packages/surfcad-mcp/src/relayMessages.mjs`.
 */
export const PAIR_MSG = Object.freeze({
  ERROR: 'error',
  REGISTER_TAB: 'register_tab',
  PAIR: 'pair',
  PAIR_REQUEST: 'pair_request',
  PAIR_APPROVE: 'pair_approve',
  PAIR_REJECT: 'pair_reject',
  PAIRED: 'paired',
  UNPAIRED: 'unpaired',
  CALL: 'call',
  RESPONSE: 'response',
});
