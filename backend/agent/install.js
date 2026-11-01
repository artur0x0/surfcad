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
import { hashApprovingSession } from './sessionKey.js';
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
 * drop its join codes, and mark the agent offline at once.
 * Presence drops after the token status is revoked, so a check that
 * already passed still loses to the epoch bump instead of clearing the hold.
 * @param {NonNullable<typeof state.relay>} relay
 * @param {string | { toString(): string }} userId
 */
export async function revokeRelayUser(relay, userId) {
  const id = String(userId);
  // Before any await, so an in-flight redeem still inside tokens.issue
  // sees the account as cleared and revokes the token it is about to insert.
  relay.joinCodes.clearUser(id);
  const ids = await relay.tokens.revokeAll(id);
  for (const tokenId of ids) {
    relay.registry.abortToken(tokenId, id);
    relay.agentSockets.closeToken(tokenId, AGENT_SOCKET_CLOSE_CODE, TOKEN_REVOKED_REASON);
  }
  relay.registry.dropAgentPresence(id);
  return ids;
}

/**
 * Sign-out of one browser. Revoke only the tokens that browser approved.
 * A token with no recorded session is left in place. Other sessions stay
 * connected: their sockets stay open, and when one of them is still live
 * the account hears reason revoked and then stays present. The last live
 * pairing for the account goes offline with reason revoked.
 * Password change, account delete, and profile-menu revoke do not use this.
 * @param {string | { toString(): string }} userId
 * @param {string | undefined} sessionId express session id, hashed before use
 * @returns {Promise<string[]>}
 */
export async function revokeSessionAgentAccess(userId, sessionId) {
  if (!state.relay || userId == null) return [];
  return revokeRelaySession(state.relay, userId, sessionId);
}

/**
 * @param {NonNullable<typeof state.relay>} relay
 * @param {string | { toString(): string }} userId
 * @param {string | undefined} sessionId
 * @returns {Promise<string[]>}
 */
export async function revokeRelaySession(relay, userId, sessionId) {
  const id = String(userId);
  const sessionKey = hashApprovingSession(sessionId);
  if (!sessionKey) return [];
  relay.joinCodes.clearSession(id, sessionKey);
  const ids = await relay.tokens.revokeBySession(id, sessionKey);
  for (const tokenId of ids) {
    relay.registry.abortToken(tokenId);
    relay.agentSockets.closeToken(tokenId, AGENT_SOCKET_CLOSE_CODE, TOKEN_REVOKED_REASON);
  }
  if (ids.length === 0) return ids;
  const live = await relay.tokens.countLive(id);
  if (live === 0) {
    relay.registry.abortToken(ids[0], id);
    relay.registry.dropAgentPresence(id);
    return ids;
  }
  relay.registry.notePartialRevoke(id);
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
 * Close only the tab sockets of the browser that is signing out.
 * @param {string | { toString(): string }} userId
 * @param {string | undefined} sessionId
 * @returns {number}
 */
export function closeSessionTabSockets(userId, sessionId) {
  if (!state.relay || userId == null) return 0;
  const sessionKey = hashApprovingSession(sessionId);
  if (!sessionKey) return 0;
  return state.relay.tabSockets.closeSession(String(userId), sessionKey);
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
