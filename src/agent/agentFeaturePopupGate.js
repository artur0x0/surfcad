/**
 * While the in-viewer agent prompt is working, agent commands must not
 * auto-open feature cards. The viewer stays interactive: this is not an
 * overlay. A user click (no agent command on the stack) still opens a card,
 * and the prompt slides away instead.
 *
 * `popupOwner` records who opened the card that is up. When working flips
 * on, only a card an agent command popped as a side effect (`agent`) is
 * dismissed. A user-owned card stays, and so does the agent's own work
 * surface (`agent-surface`: the contour sketch and the feature slot card).
 *
 * Working flips on far more often than "a new prompt started": the
 * session-level state returns to idle 60 s after the last model change and
 * goes back to working on the next one, on `post_progress`, and on
 * `set_status building`. Dismissing the work surface on that edge closed the
 * sketch `sketch_begin` had just opened, so the next `sketch_add` (a later
 * tool call, often a later process) answered `no_sketch`.
 */

let promptWorking = false;
let agentDepth = 0;
let popupOwner = null;
let authorizedEdit = false;
const dismissers = new Set();
const workingListeners = new Set();

/**
 * Would `allowFeaturePopup` say yes right now? A peek with no side effect,
 * for a host that wants to wait for the gate or report why it is closed
 * instead of opening nothing.
 */
export function featurePopupAllowed() {
  if (authorizedEdit) return !(promptWorking && popupOwner !== 'user');
  return !(promptWorking && agentDepth > 0);
}

export function allowFeaturePopup() {
  if (authorizedEdit) {
    // A launch that started before `onWorking` must not mount once the
    // prompt is working, unless the user owns the card.
    if (promptWorking && popupOwner !== 'user') return false;
    return true;
  }
  if (promptWorking && agentDepth > 0) return false;
  popupOwner = agentDepth > 0 ? 'agent' : 'user';
  return true;
}

/**
 * The agent's own work surfaces: the contour sketch (`sketch_begin`) and a
 * feature slot card (`slot_open`, `insert_make_extrude`). They are how an
 * agent builds, so a working session does not hold them the way it holds
 * the feature cards an agent command would pop as a side effect, and it
 * does not dismiss them when working starts again: the surface stays open
 * across tool calls until the agent commits or cancels it (or the user
 * closes it). A user tap goes through `allowFeaturePopup` as before.
 */
export function allowAgentWorkSurface() {
  if (agentDepth > 0) {
    popupOwner = 'agent-surface';
    return true;
  }
  return allowFeaturePopup();
}

/** Who opened the card that is up: 'user', 'agent', 'agent-surface', or null. For tests and hosts that report it. */
export function featurePopupOwner() {
  return popupOwner;
}

/** An in-flight feature-edit launch may mount after the agent command returns. */
export function setAuthorizedFeatureEdit(on) {
  authorizedEdit = on === true;
}

export function setAgentPromptWorking(on) {
  const next = on === true;
  if (next === promptWorking) return;
  promptWorking = next;
  if (next && popupOwner === 'agent') {
    popupOwner = null;
    for (const fn of [...dismissers]) {
      try { fn(); } catch { /* a dismisser must not block the rest */ }
    }
  }
  for (const fn of [...workingListeners]) {
    try { fn(promptWorking); } catch { /* a listener must not block the rest */ }
  }
}

/**
 * @param {(working: boolean) => void} cb
 * @returns {() => void}
 */
export function subscribeAgentPromptWorking(cb) {
  if (typeof cb !== 'function') return () => {};
  workingListeners.add(cb);
  try { cb(promptWorking); } catch { /* listener */ }
  return () => { workingListeners.delete(cb); };
}

export async function withAgentDrivenChange(fn) {
  agentDepth += 1;
  try {
    return await fn();
  } finally {
    agentDepth -= 1;
  }
}

export function registerFeaturePopupDismiss(fn) {
  if (typeof fn !== 'function') return () => {};
  dismissers.add(fn);
  return () => { dismissers.delete(fn); };
}

export function resetAgentFeaturePopupGateForTests() {
  promptWorking = false;
  agentDepth = 0;
  popupOwner = null;
  authorizedEdit = false;
  dismissers.clear();
  workingListeners.clear();
}
