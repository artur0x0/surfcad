/**
 * Unsolicited agent → tab chat notes. Plain text, no prompt id.
 * The page renders the string as text. This check does not parse HTML.
 */
import { PROMPT_REPLY_MAX } from '../../packages/surfcad-mcp/src/prompt/promptSession.mjs';
import { PAIR_MSG } from '../../packages/surfcad-mcp/src/relayMessages.mjs';

/**
 * @param {object} frame
 * @returns {string | null} an error code, or null when the frame may be forwarded
 */
export function sessionMessageProblem(frame) {
  if (!frame || frame.type !== PAIR_MSG.AGENT_MESSAGE) return null;
  if (frame.v !== 1 || frame.id != null) return 'bad_call';
  if (typeof frame.text !== 'string' || frame.text.length === 0) return 'bad_call';
  if (frame.text.length > PROMPT_REPLY_MAX) return 'reply_too_long';
  return null;
}
