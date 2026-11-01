import { AGENT_SOCKET_CLOSE_CODE, TOKEN_EXPIRED_REASON } from './agentSockets.js';

/**
 * The pairing's absolute expiry has passed. Clear held prompts, close that
 * token's sockets, and tell tabs the agent is offline with reason expired.
 * A later hello on a still-valid token can return. A revoke that already
 * holds presence is left as revoked.
 * @param {{
 *   registry: {
 *     abortToken: (tokenId: string, userId: string) => void,
 *     expireAgentPairing: (userId: string) => void,
 *   },
 *   agentSockets?: { closeToken: (tokenId: string, code: number, reason: string) => number },
 * }} relay
 * @param {{ id?: string, userId?: string } | null | undefined} auth
 */
export function forgetExpiredPairing(relay, auth) {
  if (!auth || auth.id == null || auth.userId == null) return;
  const tokenId = String(auth.id);
  const userId = String(auth.userId);
  relay.registry.abortToken(tokenId, userId);
  relay.agentSockets?.closeToken(tokenId, AGENT_SOCKET_CLOSE_CODE, TOKEN_EXPIRED_REASON);
  relay.registry.expireAgentPairing(userId);
}
