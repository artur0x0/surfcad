/**
 * While the in-viewer agent prompt is working, agent commands must not
 * auto-open feature cards. The viewer stays interactive: this is not an
 * overlay. A user click (no agent command on the stack) still opens a card,
 * and the prompt slides away instead.
 *
 * `popupOwner` records who opened the card that is up. When working flips
 * on, only an agent-owned card is dismissed. A user-owned card stays.
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
