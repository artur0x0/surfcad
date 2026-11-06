/**
 * In-viewer prompt turn: queued notice, ack dots, the 10s reply hold, fold.
 *
 * A send that the server queues shows "Waiting for agent" until the agent
 * acks. The ack is `set_status { state: "responding" }` (tab state typing)
 * or any working signal (building, post_progress, a model-changing tool).
 * There is no separate ack tool. After the ack the bouncing dots replace
 * the waiting line.
 *
 * The first non-final reply starts a hard 10s hold. Building, progress, and
 * model changes that arrive during it are remembered and applied when the
 * hold ends. Phone and desktop share that decision. Phone then closes the
 * pane so the Bot button spinner shows; desktop slides the prompt away on
 * the same fold path. A final reply cancels the hold, unfolds, and idles.
 */

/** How long the non-final ack reply stays on screen before a queued fold. */
export const AGENT_PROMPT_ACK_HOLD_MS = 10_000;

export function initialPromptFlow() {
  return {
    delivery: null,
    agentAcked: false,
    mode: 'idle',
    holdUntil: 0,
    holdStarted: false,
    foldQueued: false,
    folded: false,
    final: false,
    foldEpoch: 0,
    expandEpoch: 0,
  };
}

/**
 * Where an auto-fold lands. Phone uses the Bot button spinner. Desktop
 * uses the prompt fold. Neither is skipped: `foldable = !isMobile` is only
 * the chevron, not this decision.
 * @param {boolean} isMobile
 * @returns {'bot' | 'prompt'}
 */
export function autoFoldTarget(isMobile) {
  return isMobile ? 'bot' : 'prompt';
}

function foldNow(state) {
  if (state.final) return state;
  return {
    ...state,
    folded: true,
    foldQueued: false,
    holdUntil: 0,
    foldEpoch: state.foldEpoch + 1,
  };
}

function noteWork(state, now) {
  const acked = { ...state, agentAcked: true, mode: 'working' };
  if (state.final) return state;
  if (state.holdUntil > now) return { ...acked, foldQueued: true };
  return foldNow(acked);
}

/**
 * @param {ReturnType<typeof initialPromptFlow> | null | undefined} state
 * @param {{ type?: string, delivery?: string, state?: string, final?: boolean, now?: number }} event
 * @param {number} [now]
 */
export function stepPromptFlow(state, event, now = Date.now()) {
  const s = state || initialPromptFlow();
  const at = Number.isFinite(event?.now) ? event.now : now;
  switch (event?.type) {
    case 'sent':
      return {
        ...initialPromptFlow(),
        mode: 'typing',
        foldEpoch: s.foldEpoch,
        expandEpoch: s.expandEpoch,
      };
    case 'delivery':
      return { ...s, delivery: typeof event.delivery === 'string' ? event.delivery : null };
    case 'status':
      if (event.state === 'working') return noteWork(s, at);
      if (event.state === 'typing' || event.state === 'responding') {
        if (s.final) return s;
        return { ...s, agentAcked: true, mode: s.mode === 'working' ? s.mode : 'typing' };
      }
      if (event.state === 'idle' && (s.folded || s.foldQueued)) {
        return {
          ...s,
          mode: 'idle',
          foldQueued: false,
          folded: false,
          holdUntil: 0,
          expandEpoch: s.expandEpoch + 1,
        };
      }
      return s;
    case 'work':
      return noteWork(s, at);
    case 'reply': {
      if (s.final && event.final !== true) return s;
      if (event.final === true) {
        return {
          ...s,
          agentAcked: true,
          final: true,
          mode: 'idle',
          holdUntil: 0,
          holdStarted: true,
          foldQueued: false,
          folded: false,
          expandEpoch: s.expandEpoch + 1,
        };
      }
      if (s.holdStarted) return { ...s, agentAcked: true };
      return {
        ...s,
        agentAcked: true,
        holdStarted: true,
        holdUntil: at + AGENT_PROMPT_ACK_HOLD_MS,
        folded: false,
        mode: s.mode === 'idle' ? 'typing' : s.mode,
        expandEpoch: s.expandEpoch + 1,
      };
    }
    case 'tick': {
      if (!(s.holdUntil > 0) || at < s.holdUntil) return s;
      const released = { ...s, holdUntil: 0 };
      if (s.foldQueued || s.mode === 'working') return foldNow(released);
      return released;
    }
    case 'stop':
    case 'disconnect':
      return {
        ...initialPromptFlow(),
        foldEpoch: s.foldEpoch,
        expandEpoch: s.expandEpoch,
      };
    default:
      return s;
  }
}

/**
 * What the prompt chrome should show for this flow state.
 * @param {ReturnType<typeof initialPromptFlow> | null | undefined} state
 * @param {number} [now]
 */
export function promptFlowView(state, now = Date.now()) {
  const s = state || initialPromptFlow();
  const holdActive = !s.final && s.holdUntil > now;
  const waiting = s.delivery === 'queued' && !s.agentAcked && !s.final;
  const folded = s.folded === true && !holdActive && !s.final;
  const dots = !waiting && !folded && !s.final && (s.agentAcked || s.mode === 'typing');
  const spinner = folded && s.mode === 'working';
  return {
    waiting,
    dots,
    folded,
    spinner,
    holdActive,
    chatOpen: !folded,
  };
}

/**
 * Arm the 10s hold. `onTick` runs when the hold ends. Returns a cancel.
 * A hold that is already due does not fire synchronously.
 * @param {number} holdUntil
 * @param {number} now
 * @param {() => void} onTick
 * @returns {() => void}
 */
export function scheduleAckHold(holdUntil, now, onTick) {
  const delay = holdUntil - now;
  if (!(delay > 0) || typeof onTick !== 'function') return () => {};
  const id = setTimeout(onTick, delay);
  return () => clearTimeout(id);
}
