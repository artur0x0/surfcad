/**
 * Re-export the shared relay hub for Node-side tests and scripts.
 * Browser code should import PAIR_MSG from `./relayMessages.js` only.
 */
export { PAIR_MSG, createAgentBridgeRelayHub } from '../../../packages/surfcad-mcp/src/bridge/relayHub.mjs';
