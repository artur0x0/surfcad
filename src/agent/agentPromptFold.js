/**
 * Fold state and announcements for the floating agent prompt (desktop).
 *
 * The chevron on the prompt's bottom edge folds it away; a chevron at the
 * bottom of the screen brings it back exactly as it was (the component
 * stays mounted, so the draft, the scroll position, and the indicator
 * survive). The folded choice is remembered per agent session in
 * localStorage and cleared when the agent disconnects.
 */

export const AGENT_PROMPT_FOLD_KEY = 'surfcadAgentPromptFolded';

function storageOf(env) {
  if (env && env.storage !== undefined) return env.storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** True when the last session folded the prompt. Never throws. */
export function readFolded(env) {
  try {
    return storageOf(env)?.getItem?.(AGENT_PROMPT_FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the choice for this agent session. */
export function writeFolded(folded, env) {
  try {
    const storage = storageOf(env);
    if (!storage) return;
    if (folded) storage.setItem(AGENT_PROMPT_FOLD_KEY, '1');
    else storage.removeItem(AGENT_PROMPT_FOLD_KEY);
  } catch { /* storage blocked */ }
}

/** The agent disconnected: the next session starts open. */
export function clearFolded(env) {
  try { storageOf(env)?.removeItem?.(AGENT_PROMPT_FOLD_KEY); } catch { /* storage blocked */ }
}

/**
 * The badge on the folded chevron: what the agent is doing while the
 * prompt is out of the way. `unread` wins once the reply has landed.
 * @param {{ mode?: string, unread?: boolean }} input
 * @returns {'typing' | 'working' | 'unread' | ''}
 */
export function foldBadge({ mode = 'idle', unread = false } = {}) {
  if (unread) return 'unread';
  if (mode === 'typing' || mode === 'working') return mode;
  return '';
}

/**
 * What the screen reader hears when the agent's state changes.
 * @param {'idle' | 'typing' | 'working'} mode
 * @param {{ replied?: boolean }} [extra]
 */
export function stateAnnouncement(mode, extra = {}) {
  if (extra.replied) return 'Agent replied';
  if (mode === 'typing') return 'Agent is typing';
  if (mode === 'working') return 'Agent is working';
  return '';
}
