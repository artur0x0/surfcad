import { WebSocket } from 'ws';

/** A signed-out tab. Not a revoked agent token (4001) and not a policy close (1008). */
export const TAB_SESSION_ENDED_CODE = 1000;

export const TAB_SESSION_ENDED_REASON = 'session ended';

/**
 * Live browser-tab sockets, keyed by user id. Agent tokens are not in this map.
 */
export function createTabSocketRegistry() {
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const byUser = new Map();

  return {
    /**
     * @param {string} userId
     * @param {import('ws').WebSocket} ws
     */
    /**
     * @param {string} userId
     * @param {import('ws').WebSocket} ws
     * @param {string | null} [sessionKey] hash of the browser session, not the id
     */
    add(userId, ws, sessionKey = null) {
      const user = String(userId);
      let set = byUser.get(user);
      if (!set) {
        set = new Set();
        byUser.set(user, set);
      }
      /** @type {import('ws').WebSocket & { surfcadSessionKey?: string | null }} */ (ws).surfcadSessionKey = sessionKey || null;
      set.add(ws);
      ws.once('close', () => {
        set.delete(ws);
        if (set.size === 0) byUser.delete(user);
      });
    },

    /**
     * Close tab sockets opened by one browser session. Other sessions stay.
     * @param {string} userId
     * @param {string} sessionKey
     * @param {number} [code]
     * @param {string} [reason]
     * @returns {number}
     */
    closeSession(userId, sessionKey, code = TAB_SESSION_ENDED_CODE, reason = TAB_SESSION_ENDED_REASON) {
      if (!sessionKey) return 0;
      const set = byUser.get(String(userId));
      if (!set) return 0;
      const sockets = [...set].filter((ws) => {
        const keyed = /** @type {import('ws').WebSocket & { surfcadSessionKey?: string | null }} */ (ws);
        return keyed.surfcadSessionKey === sessionKey && ws.readyState !== WebSocket.CLOSED;
      });
      for (const ws of sockets) ws.close(code, reason);
      return sockets.length;
    },

    /**
     * @param {string} userId
     * @param {number} [code]
     * @param {string} [reason]
     * @returns {number}
     */
    closeUser(userId, code = TAB_SESSION_ENDED_CODE, reason = TAB_SESSION_ENDED_REASON) {
      const set = byUser.get(String(userId));
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
