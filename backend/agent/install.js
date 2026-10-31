import config from '../config/index.js';
import AgentToken from '../db/models/AgentToken.js';
import {
  AGENT_SOCKET_CLOSE_CODE,
  TOKEN_REVOKED_REASON,
} from './agentSockets.js';
import { authenticateBrowserUpgrade } from './browserAuth.js';
import { cityLookupEnabled, createCityLookup } from './cityLookup.js';
import { createAgentRelay } from './createRelay.js';
import { warnIfAgentRelayIsClustered } from './processMode.js';
import { createMongoTokenStore } from './tokens.js';
import { attachAgentWebSocket } from './wsServer.js';

/** @type {{ relay: ReturnType<typeof createAgentRelay> | null, sessionMiddleware: import('express').RequestHandler | null, socketsAttached: boolean }} */
const state = {
  relay: null,
  sessionMiddleware: null,
  socketsAttached: false,
};

/**
 * Mount `/agent` on the Express app. WebSocket upgrade is attached later,
 * once `startServer` has an `http.Server`.
 * @param {import('express').Express} app
 * @param {{ sessionMiddleware: import('express').RequestHandler }} deps
 */
export function installAgentRelay(app, deps) {
  warnIfAgentRelayIsClustered();
  const relay = createAgentRelay(
    cityLookupEnabled() ? { lookupCity: createCityLookup() } : {},
  );
  state.relay = relay;
  state.sessionMiddleware = deps.sessionMiddleware;
  app.use('/agent', relay.router);
}

/** Swap the in-memory token hash store for the Mongo `agentTokens` collection. */
export function useMongoTokenStore() {
  if (!state.relay) return;
  state.relay.tokens.setStore(createMongoTokenStore(AgentToken));
}

/**
 * Revoke every agent token for the account, close its sockets with 4001,
 * and drop its pending join codes. In-flight long-poll and SSE waits for
 * those tokens end here too.
 * @param {string | { toString(): string }} userId
 * @returns {Promise<string[]>}
 */
export async function revokeUserAgentAccess(userId) {
  if (!state.relay || userId == null) return [];
  return revokeRelayUser(state.relay, userId);
}

/**
 * Revoke every agent token for the account, close its sockets with 4001,
 * and drop its join codes.
 * @param {NonNullable<typeof state.relay>} relay
 * @param {string | { toString(): string }} userId
 */
export async function revokeRelayUser(relay, userId) {
  const id = String(userId);
  const ids = await relay.tokens.revokeAll(id);
  for (const tokenId of ids) {
    relay.registry.abortToken(tokenId);
    relay.agentSockets.closeToken(tokenId, AGENT_SOCKET_CLOSE_CODE, TOKEN_REVOKED_REASON);
  }
  relay.joinCodes.clearUser(id);
  return ids;
}

/**
 * Close browser tab sockets for a signed-out account. Does not revoke agent tokens.
 * @param {string | { toString(): string }} userId
 * @returns {number}
 */
export function closeUserTabSockets(userId) {
  if (!state.relay || userId == null) return 0;
  return state.relay.tabSockets.closeUser(String(userId));
}

/**
 * @param {import('node:http').Server} httpServer
 */
export function attachAgentSockets(httpServer) {
  if (!state.relay || !state.sessionMiddleware || state.socketsAttached) return;
  state.socketsAttached = true;
  const sessionMiddleware = state.sessionMiddleware;
  attachAgentWebSocket(httpServer, state.relay, {
    authenticateUpgrade: (req) => authenticateBrowserUpgrade(req, sessionMiddleware),
    trustProxyHops: config.trustProxyHops,
  });
}
