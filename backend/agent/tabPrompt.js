import { PAIR_MSG } from '../../packages/surfcad-mcp/src/relayMessages.mjs';

/**
 * Tab → agent prompt frames on the server relay.
 *
 * A live agent socket gets a prompt immediately. While the agent is present
 * (inside the presence window) the prompt is also held, and the tab is told
 * `queued` at once: a fresh `surfcad-mcp` process per tool call may have no
 * socket open right now, or may exit before `read_messages`, so the server
 * keeps the prompt and offers it to each new socket or pull session until
 * one reports it taken (`agent.prompt.taken`), or presence ends and the tab
 * is told delivery failed. With no agent present the prompt waits the short
 * hold for one to appear and then fails.
 */

/**
 * @param {ReturnType<import('./registry.js').createMemoryTabRegistry>} registry
 * @param {string} userId
 * @param {object} frame
 * @param {(frame: object) => void} reply
 */
export function deliverTabAgentFrame(registry, userId, frame, reply) {
  const type = typeof frame?.type === 'string' ? frame.type : '';
  if (type === PAIR_MSG.AGENT_MESSAGE) return;
  if (type !== 'agent.prompt' && type !== 'agent.prompt.cancel') {
    registry.forwardToAgents(userId, frame);
    return;
  }
  const id = typeof frame.id === 'string' ? frame.id : '';
  if (type === 'agent.prompt.cancel') {
    // A held copy goes whether or not a socket is live; a live agent that
    // has the prompt answers the cancel itself.
    const dropped = registry.dropHeldPrompt(userId, id);
    const delivered = registry.forwardToAgents(userId, frame);
    if (delivered > 0) return;
    reply({
      type: 'agent.prompt.cancel.result',
      v: 1,
      id,
      state: dropped ? 'cancelled' : 'not_found',
    });
    return;
  }
  const outcome = registry.deliverPrompt(userId, frame, {
    onExpire() {
      reply({
        type: 'agent.prompt.ack',
        id,
        delivery: 'failed',
        error: 'not_paired',
      });
    },
  });
  // Held for a present agent with no socket at this moment: the tab hears
  // queued now instead of waiting on its send timer. A live socket's
  // process sends its own ack.
  if (outcome.held && outcome.present && outcome.delivered === 0) {
    reply({ type: 'agent.prompt.ack', id, delivery: 'queued' });
  }
}
