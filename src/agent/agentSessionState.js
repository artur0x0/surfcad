/**
 * Session-level agent state for the tab: what the paired agent is doing
 * right now, with or without a prompt from the in-viewer chat.
 *
 * The prompt reducer (`agentPromptTyping.js`) follows one prompt the user
 * sent. An agent that works on its own (a build started from the MCP host,
 * or a prompt read by an earlier one-shot `surfcad-mcp` process) has no
 * pending prompt there, so nothing moved. This state is kept in the tab,
 * not in the MCP process: a fresh process per tool call is the normal flow
 * and keeps no memory between calls, and a prompt is optional.
 *
 * Modes: `working` (changing the model), `replying` (writing an answer),
 * `idle`. Inputs, in the order the tab sees them:
 *
 * - `command`: the tab ran a bridge command. One that changes the model
 *   (`mutates`, from the command catalog) enters or refreshes `working`.
 *   A read never changes the mode.
 * - `status`: an `agent.status` frame (`set_status`, or the process's own
 *   building/idle). An explicit state wins at once, with or without a
 *   prompt id.
 * - `progress`: `agent.progress` is the working signal.
 * - `reply`: a final reply or a session note ends the turn (`idle`); a
 *   partial reply is `replying`.
 * - `tick`: no activity for `AGENT_SESSION_IDLE_MS` returns to `idle`.
 *   The window restarts on every input above.
 * - `stop`, `disconnect`, `closed`: `idle`.
 *
 * `at` on an event is the clock; the reducer keeps the last activity time
 * so the caller can arm one timer for the tick.
 */

/** No activity for this long and the session state returns to idle. */
export const AGENT_SESSION_IDLE_MS = 60_000;

export const AGENT_SESSION_MODES = Object.freeze(['idle', 'working', 'replying']);

export const SESSION_IDLE = Object.freeze({ mode: 'idle', explicit: false, at: 0 });

/**
 * @typedef {{ mode: 'idle' | 'working' | 'replying', explicit: boolean, at: number }} AgentSessionState
 */

function idle(cur) {
  if (cur.mode === 'idle' && !cur.explicit) return cur;
  return { mode: 'idle', explicit: false, at: cur.at };
}

function enter(cur, mode, at, explicit) {
  return { mode, explicit: explicit === true, at: Math.max(Number(at) || 0, cur.at || 0) };
}

/** Tab status `state` (typing | working | idle) to a session mode. */
function modeFromStatusState(state) {
  if (state === 'working') return 'working';
  if (state === 'typing') return 'replying';
  if (state === 'idle') return 'idle';
  return null;
}

/**
 * @param {AgentSessionState | null | undefined} state
 * @param {{ type: string, at?: number, mutates?: boolean, state?: string, final?: boolean, idleMs?: number }} event
 * @returns {AgentSessionState}
 */
export function sessionReducer(state, event) {
  const cur = state || SESSION_IDLE;
  const at = Number.isFinite(event?.at) ? event.at : cur.at;
  switch (event?.type) {
    case 'command':
      if (event.mutates !== true) return cur;
      return enter(cur, 'working', at, false);
    case 'progress':
      return enter(cur, 'working', at, false);
    case 'status': {
      const mode = modeFromStatusState(event.state);
      if (!mode) return cur;
      if (mode === 'idle') return { mode: 'idle', explicit: true, at };
      return enter(cur, mode, at, true);
    }
    case 'reply':
      if (event.final === false) return enter(cur, 'replying', at, false);
      return idle(cur);
    case 'tick': {
      if (cur.mode === 'idle') return cur;
      const window = Number.isFinite(event.idleMs) ? event.idleMs : AGENT_SESSION_IDLE_MS;
      if (at - cur.at >= window) return idle(cur);
      return cur;
    }
    case 'stop':
    case 'disconnect':
    case 'closed':
      return idle(cur);
    default:
      return cur;
  }
}

/** The agent is doing something: the chat collapses and the bot icons spin. */
export function sessionBusy(state) {
  return !!state && state.mode !== 'idle';
}

export function sessionWorking(state) {
  return !!state && state.mode === 'working';
}

export function sessionReplying(state) {
  return !!state && state.mode === 'replying';
}

/**
 * The prompt-state vocabulary (`data-agent-prompt-state`) for a session
 * mode: working is working, replying is typing.
 * @param {AgentSessionState | null | undefined} state
 * @returns {'idle' | 'typing' | 'working'}
 */
export function sessionPromptMode(state) {
  if (!state) return 'idle';
  if (state.mode === 'working') return 'working';
  if (state.mode === 'replying') return 'typing';
  return 'idle';
}

/**
 * When the idle tick should fire, or null when nothing is pending.
 * @param {AgentSessionState | null | undefined} state
 * @param {number} [idleMs]
 */
export function sessionIdleAt(state, idleMs = AGENT_SESSION_IDLE_MS) {
  if (!sessionBusy(state)) return null;
  return (state.at || 0) + idleMs;
}

/** Seed for the DEV demo: a session in a mode with no prompt. */
export function sessionSeed(mode, at = Date.now()) {
  if (mode === 'working' || mode === 'replying') return { mode, explicit: false, at };
  return SESSION_IDLE;
}
