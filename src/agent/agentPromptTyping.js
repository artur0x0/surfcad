/**
 * Indicator state for the in-viewer agent prompt.
 *
 * One prompt is pending at a time: the one the tab sent last and has not
 * seen closed. While it is pending the agent is in one of two modes:
 *
 * - `typing`: the agent is writing an answer. The chat pane stays open and
 *   shows the dots as the next agent bubble; the input is normal.
 * - `working`: the agent is changing the model. The chat pane collapses so
 *   the viewport is visible, and the input shows the spinner and
 *   "Agent is working".
 *
 * A sent prompt starts in `typing` (waiting for the reply). The MCP side
 * sends `state` on its status message: `working` on the first
 * model-changing tool call or an explicit set_status, `typing` on a
 * streamed (non-final) reply or an explicit set_status, `idle` on the
 * final reply, Stop, or the idle timer. A tab that only gets the legacy
 * `working` boolean maps true to `working` and false to idle.
 *
 * Everything closes on the final reply, on idle, on a failed delivery, on
 * Stop, and on disconnect. Anything that arrives for a closed prompt,
 * including a late, duplicate, or out-of-order status, is ignored, so the
 * dots cannot come back next to a finished reply. `working` stays on the
 * state as a boolean (`mode === 'working'`) for the callers that read it.
 */

export const AGENT_MODES = Object.freeze(['idle', 'typing', 'working']);

export const TYPING_IDLE = Object.freeze({
  pendingId: null,
  mode: 'idle',
  working: false,
  streaming: false,
});

function closed() {
  return { pendingId: null, mode: 'idle', working: false, streaming: false };
}

function withMode(cur, mode) {
  if (cur.mode === mode) return cur;
  return { ...cur, mode, working: mode === 'working' };
}

/**
 * @param {{ pendingId: string | null, mode: 'idle' | 'typing' | 'working', working: boolean, streaming: boolean }} state
 * @param {{ type: string, id?: string, final?: boolean, on?: boolean, state?: string, delivery?: string }} event
 */
export function typingReducer(state, event) {
  const cur = state || TYPING_IDLE;
  switch (event?.type) {
    case 'sent':
      if (typeof event.id !== 'string' || !event.id) return cur;
      return { pendingId: event.id, mode: 'typing', working: false, streaming: false };
    case 'reply': {
      if (!cur.pendingId || event.id !== cur.pendingId) return cur;
      if (event.final === true) return closed();
      const typing = withMode(cur, 'typing');
      return typing.streaming ? typing : { ...typing, streaming: true };
    }
    case 'state': {
      if (!cur.pendingId) return cur;
      if (event.state === 'idle') return closed();
      if (event.state === 'working' || event.state === 'typing') return withMode(cur, event.state);
      return cur;
    }
    case 'working': {
      if (!cur.pendingId) return cur;
      if (event.on !== true) return closed();
      return withMode(cur, 'working');
    }
    case 'ack': {
      if (!cur.pendingId) return cur;
      if (event.id && event.id !== cur.pendingId) return cur;
      return event.delivery === 'failed' ? closed() : cur;
    }
    case 'stop':
    case 'disconnect':
    case 'timeout':
      return cur.pendingId || cur.working || cur.streaming ? closed() : cur;
    default:
      return cur;
  }
}

/** The dots show in the chat while the pending prompt is being answered. */
export function typingShown(state) {
  return !!state?.pendingId && state.mode === 'typing';
}

/** The spinner and "Agent is working" show while the agent changes the model. */
export function workingShown(state) {
  return !!state?.pendingId && state.mode === 'working';
}

/** A prompt is in progress in either mode (Stop is available). */
export function pendingShown(state) {
  return !!state?.pendingId && state.mode !== 'idle';
}

/** The mode a status message asks for, from `state` or the legacy boolean. */
export function modeFromStatus(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.state === 'typing' || msg.state === 'working' || msg.state === 'idle') return msg.state;
  if (typeof msg.working === 'boolean') return msg.working ? 'working' : 'idle';
  return null;
}

/** Seed for the demo states: a pending prompt in a mode. */
export function typingSeed({ working = false, streaming = false, mode = null } = {}) {
  const wanted = mode === 'typing' || mode === 'working'
    ? mode
    : (working ? 'working' : (streaming ? 'typing' : 'idle'));
  if (wanted === 'idle') return TYPING_IDLE;
  return { pendingId: 'demo', mode: wanted, working: wanted === 'working', streaming: streaming === true };
}
