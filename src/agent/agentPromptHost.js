/**
 * Imperative handle the floating prompt registers so `agent_prompt` can
 * drive the same send / dismiss / screenshot path as the buttons.
 */
let handler = null;

export function registerAgentPromptHandler(fn) {
  handler = typeof fn === 'function' ? fn : null;
  return () => {
    if (handler === fn) handler = null;
  };
}

export function runAgentPrompt(args) {
  if (typeof handler !== 'function') {
    return { error: { code: 'unavailable', message: 'Agent prompt is hidden' } };
  }
  return handler(args && typeof args === 'object' ? args : {});
}
