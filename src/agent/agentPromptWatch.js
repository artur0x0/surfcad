/**
 * Safety deadline for one in-viewer prompt.
 *
 * The prompt stays pending until the agent replies (or reports done), the
 * user presses Stop, or the agent disconnects. This watch only notices a
 * stall: no relayed tool call, status, reply, or other activity for
 * `timeoutMs`. A call that is still in flight holds the deadline, because
 * that call is the agent working. `onStall` runs once; the next activity
 * starts a fresh window.
 */
import { pendingShown, typingReducer } from './agentPromptTyping.js';

/**
 * @param {{
 *   timeoutMs: number,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: unknown) => void,
 *   onStall?: () => void,
 * }} options
 */
export function createPromptWatch(options) {
  const timeoutMs = options?.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('createPromptWatch requires a positive timeoutMs');
  }
  const setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer || ((timer) => clearTimeout(timer));
  let onStall = typeof options.onStall === 'function' ? options.onStall : () => {};
  let timer = null;
  let epoch = 0;
  let pending = false;
  let paused = false;
  let holds = 0;

  function clearTimerOnly() {
    epoch += 1;
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function arm() {
    clearTimerOnly();
    if (!pending || paused || holds > 0) return;
    const token = epoch;
    timer = setTimer(() => {
      if (token !== epoch) return;
      timer = null;
      if (!pending || paused || holds > 0) return;
      paused = true;
      onStall();
    }, timeoutMs);
  }

  return {
    /** @param {() => void} fn */
    setOnStall(fn) {
      onStall = typeof fn === 'function' ? fn : () => {};
    },
    markPending() {
      pending = true;
      paused = false;
      if (holds > 0) {
        clearTimerOnly();
        return;
      }
      arm();
    },
    pause() {
      paused = true;
      clearTimerOnly();
    },
    stop() {
      pending = false;
      paused = false;
      holds = 0;
      clearTimerOnly();
    },
    /** @param {boolean} on */
    hold(on) {
      if (on) {
        holds += 1;
        clearTimerOnly();
        return;
      }
      holds = Math.max(0, holds - 1);
      if (pending && !paused && holds === 0) arm();
    },
    holding() {
      return holds > 0;
    },
  };
}

/**
 * Apply one prompt event and keep the watch in step with the indicator.
 * `hold` is a bridge call still running on the page: the deadline waits
 * until the call finishes, then activity starts a new window.
 *
 * @param {Parameters<typeof typingReducer>[0]} typing
 * @param {ReturnType<typeof createPromptWatch>} watch
 * @param {{ type: string, id?: string, final?: boolean, on?: boolean, state?: string, delivery?: string }} event
 */
export function stepPromptWatch(typing, watch, event) {
  if (event?.type === 'hold') {
    watch.hold(event.on === true);
    if (event.on === true) return typing;
    const next = typingReducer(typing, { type: 'activity' });
    syncPromptWatch(next, watch);
    return next;
  }
  const next = typingReducer(typing, event);
  syncPromptWatch(next, watch);
  return next;
}

/**
 * @param {Parameters<typeof typingReducer>[0]} typing
 * @param {ReturnType<typeof createPromptWatch>} watch
 */
function syncPromptWatch(typing, watch) {
  if (!pendingShown(typing)) watch.stop();
  else if (typing.stalled) watch.pause();
  else watch.markPending();
}
