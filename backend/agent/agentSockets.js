import { WebSocket } from 'ws';

/** Application close code for a token that must not keep talking. */
export const AGENT_SOCKET_CLOSE_CODE = 4001;

export const TOKEN_REVOKED_REASON = 'token revoked';

export const TOKEN_EXPIRED_REASON = 'token expired';

/**
 * Live agent sockets, keyed by token id. A revoke closes every socket for
 * that token. Browser tabs are not in this map.
 */
export function createAgentSocketRegistry() {
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const byToken = new Map();

  return {
    /**
     * @param {string} tokenId
     * @param {import('ws').WebSocket} ws
     */
    add(tokenId, ws) {
      const id = String(tokenId);
      let set = byToken.get(id);
      if (!set) {
        set = new Set();
        byToken.set(id, set);
      }
      set.add(ws);
      ws.once('close', () => {
        set.delete(ws);
        if (set.size === 0) byToken.delete(id);
      });
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
