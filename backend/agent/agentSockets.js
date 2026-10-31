import { WebSocket } from 'ws';
import { MAX_AGENTS_PER_USER } from './limits.js';

/** Application close code for a token that must not keep talking. */
export const AGENT_SOCKET_CLOSE_CODE = 4001;

export const TOKEN_REVOKED_REASON = 'token revoked';

export const TOKEN_EXPIRED_REASON = 'token expired';

/** A further tab or agent past the per-user cap. Not a revoked token. */
export const TOO_MANY_CONNECTIONS_CODE = 4008;

export const TOO_MANY_CONNECTIONS_REASON = 'too many connections';

/**
 * Live agent sockets, keyed by token id. A revoke closes every socket for
 * that token. Browser tabs are not in this map. One account may hold at
 * most `maxPerUser` sockets; a further add is refused.
 * @param {{ maxPerUser?: number }} [opts]
 */
export function createAgentSocketRegistry(opts = {}) {
  const maxPerUser = opts.maxPerUser ?? MAX_AGENTS_PER_USER;
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const byToken = new Map();
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const byUser = new Map();

  return {
    /**
     * @param {string} tokenId
     * @param {import('ws').WebSocket} ws
     * @param {string} userId
     * @returns {boolean} false when this account is already at the cap
     */
    add(tokenId, ws, userId) {
      const id = String(tokenId);
      const user = String(userId || '');
      let userSet = user ? byUser.get(user) : null;
      if (user && userSet && userSet.size >= maxPerUser) return false;
      let set = byToken.get(id);
      if (!set) {
        set = new Set();
        byToken.set(id, set);
      }
      set.add(ws);
      if (user) {
        if (!userSet) {
          userSet = new Set();
          byUser.set(user, userSet);
        }
        userSet.add(ws);
      }
      ws.once('close', () => {
        set.delete(ws);
        if (set.size === 0) byToken.delete(id);
        if (userSet) {
          userSet.delete(ws);
          if (userSet.size === 0) byUser.delete(user);
        }
      });
      return true;
    },

    /**
     * @param {string} tokenId
     * @param {number} code
     * @param {string} reason
     * @returns {number}
     */
    closeToken(tokenId, code, reason) {
      const set = byToken.get(String(tokenId));
      if (!set) return 0;
      const sockets = [...set];
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.CLOSED) continue;
        ws.close(code, reason);
      }
      return sockets.length;
    },
  };
}
