import AgentToken from '../db/models/AgentToken.js';
import { authenticateBrowserUpgrade } from './browserAuth.js';
import { createAgentRelay } from './createRelay.js';
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
  const relay = createAgentRelay();
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
 * @param {import('node:http').Server} httpServer
 */
export function attachAgentSockets(httpServer) {
  if (!state.relay || !state.sessionMiddleware || state.socketsAttached) return;
  state.socketsAttached = true;
  const sessionMiddleware = state.sessionMiddleware;
  attachAgentWebSocket(httpServer, state.relay, {
    authenticateUpgrade: (req) => authenticateBrowserUpgrade(req, sessionMiddleware),
  });
}
