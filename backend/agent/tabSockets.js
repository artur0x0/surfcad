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
    add(userId, ws) {
      const user = String(userId);
      let set = byUser.get(user);
      if (!set) {
        set = new Set();
        byUser.set(user, set);
      }
      set.add(ws);
      ws.once('close', () => {
        set.delete(ws);
        if (set.size === 0) byUser.delete(user);
      });
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
