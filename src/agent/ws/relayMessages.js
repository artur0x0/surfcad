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
  /** Page → paired agent. Contract v:1. */
  AGENT_PROMPT: 'agent.prompt',
  /** Agent → page. `{ id, delivery, error? }`. */
  AGENT_PROMPT_ACK: 'agent.prompt.ack',
  /** Agent → page. Contract v:1. Several replies may share one prompt id. */
  AGENT_REPLY: 'agent.reply',
  /** Agent → page. Contract v:1. */
  AGENT_STATUS: 'agent.status',
  /** Agent → page, or the page noting a bridge call. Contract v:1. Refreshes the working deadline. */
  AGENT_ACTIVITY: 'agent.activity',
  /** Page → paired agent. Contract v:1. `{ id }`. */
  AGENT_PROMPT_CANCEL: 'agent.prompt.cancel',
  /** Agent → page. Contract v:1. `{ id, state }`. */
  AGENT_PROMPT_CANCEL_RESULT: 'agent.prompt.cancel.result',
});
