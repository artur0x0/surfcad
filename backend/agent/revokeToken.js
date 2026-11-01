import { AGENT_SOCKET_CLOSE_CODE, TOKEN_REVOKED_REASON } from './agentSockets.js';

/**
 * Revoke one agent token the same way `DELETE /agent/tokens/:id` does:
 * mark it revoked, end its waits, and close its sockets. Does not revoke
 * the rest of the account. Presence drops only when `dropPresence` is set,
 * which is the profile-menu path. Sign-out of one browser leaves presence
 * to the caller so another session's agent can stay up.
 * @param {{
 *   tokens: { revoke: (userId: string, id: string) => Promise<boolean> },
 *   registry: {
 *     abortToken: (tokenId: string, userId?: string) => void,
 *     dropAgentPresence?: (userId: string) => void,
 *   },
 *   agentSockets: { closeToken: (tokenId: string, code: number, reason: string) => number },
 * }} relay
 * @param {string} userId
 * @param {string} tokenId
 * @param {{ alreadyRevoked?: boolean, heldPrompts?: 'account' | 'token', dropPresence?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function revokeOneAgentToken(relay, userId, tokenId, opts = {}) {
  const user = String(userId);
  const id = String(tokenId);
  if (!opts.alreadyRevoked) {
    const revoked = await relay.tokens.revoke(user, id);
    if (!revoked) return false;
  }
  if (opts.heldPrompts === 'account') relay.registry.abortToken(id, user);
  else relay.registry.abortToken(id);
  relay.agentSockets.closeToken(id, AGENT_SOCKET_CLOSE_CODE, TOKEN_REVOKED_REASON);
  if (opts.dropPresence) relay.registry.dropAgentPresence?.(user);
  return true;
}
