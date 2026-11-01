/**
 * Tab → agent prompt frames on the server relay.
 *
 * A live agent socket gets the frame immediately. Otherwise it is held
 * until that socket finishes hello, an HTTPS-fallback agent pulls it,
 * or the hold expires and the tab is told delivery failed.
 */

/**
 * @param {ReturnType<import('./registry.js').createMemoryTabRegistry>} registry
 * @param {string} userId
 * @param {object} frame
 * @param {(frame: object) => void} reply
 */
export function deliverTabAgentFrame(registry, userId, frame, reply) {
  const type = typeof frame?.type === 'string' ? frame.type : '';
  if (type !== 'agent.prompt' && type !== 'agent.prompt.cancel') {
    registry.forwardToAgents(userId, frame);
    return;
  }
  const delivered = registry.forwardToAgents(userId, frame);
  if (delivered > 0) return;
  const id = typeof frame.id === 'string' ? frame.id : '';
  if (type === 'agent.prompt.cancel') {
    const dropped = registry.dropHeldPrompt(userId, id);
    reply({
      type: 'agent.prompt.cancel.result',
      v: 1,
      id,
      state: dropped ? 'cancelled' : 'not_found',
    });
    return;
  }
  registry.holdPrompt(userId, frame, {
    onExpire() {
      reply({
        type: 'agent.prompt.ack',
        id,
        delivery: 'failed',
        error: 'not_paired',
      });
    },
  });
}
