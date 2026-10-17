/**
 * Decide whether a page-lifecycle ping should soft-restart the Manifold worker.
 *
 * Script execution is synchronous WASM on the worker thread. A ping posted
 * behind that call cannot be answered until it returns, so a short ping
 * timeout means "busy", not "the browser killed the worker". Restarting
 * anyway rejects the in-flight script with "Worker terminated" and the next
 * call observes isReady === false ("Manifold Sandbox not initialized")
 * until init() finishes.
 *
 * @param {{
 *   initInFlight?: boolean,
 *   restartInFlight?: boolean,
 *   pendingWork?: number,
 *   pingOk?: boolean | null,
 * }} state
 * @returns {'alive' | 'busy' | 'starting' | 'wait' | 'restart' | 'ping'}
 */
export function softRestartDecision(state = {}) {
  const pendingWork = Number(state.pendingWork) || 0;
  if (state.restartInFlight) return 'wait';
  if (state.initInFlight) return 'starting';
  if (pendingWork > 0) return 'busy';
  if (state.pingOk === true) return 'alive';
  if (state.pingOk === false) return 'restart';
  return 'ping';
}
