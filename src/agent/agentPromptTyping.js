/**
 * Typing indicator state for the in-viewer agent prompt.
 *
 * One prompt is pending at a time: the one the tab sent last and has not
 * seen closed. The indicator (and the Stop / working affordances) follow
 * that prompt only. It closes on the final reply, on an agent status of
 * done (`working: false`) or a failed delivery, on Stop, and on
 * disconnect. Anything that arrives for a closed prompt, including a late,
 * duplicate, or out-of-order `working: true`, is ignored, so the dots
 * cannot come back next to a finished reply.
 */

export const TYPING_IDLE = Object.freeze({
  pendingId: null,
  working: false,
  streaming: false,
});

function closed() {
  return { pendingId: null, working: false, streaming: false };
}

/**
 * @param {{ pendingId: string | null, working: boolean, streaming: boolean }} state
 * @param {{ type: string, id?: string, final?: boolean, on?: boolean, delivery?: string }} event
 */
export function typingReducer(state, event) {
  const cur = state || TYPING_IDLE;
  switch (event?.type) {
    case 'sent':
      if (typeof event.id !== 'string' || !event.id) return cur;
      return { pendingId: event.id, working: true, streaming: false };
    case 'reply': {
      if (!cur.pendingId || event.id !== cur.pendingId) return cur;
      if (event.final === true) return closed();
      return cur.streaming ? cur : { ...cur, streaming: true };
    }
    case 'working': {
      if (!cur.pendingId) return cur;
      if (event.on !== true) return closed();
      return cur.working ? cur : { ...cur, working: true };
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

/** The dots show only while the pending prompt is in progress. */
export function typingShown(state) {
  return !!state?.pendingId && (state.working === true || state.streaming === true);
}

/** Seed for the demo states: a pending prompt that is working or streaming. */
export function typingSeed({ working = false, streaming = false } = {}) {
  if (!working && !streaming) return TYPING_IDLE;
  return { pendingId: 'demo', working: working === true, streaming: streaming === true };
}
