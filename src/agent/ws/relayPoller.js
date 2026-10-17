/**
 * Poll loopback relay while the pairing flow is open.
 */

export const DEFAULT_RELAY_POLL_MS = 5000;

/**
 * @param {{
 *   probe: () => Promise<boolean>,
 *   intervalMs?: number,
 *   isActive: () => boolean,
 *   onDetected: () => void,
 * }} options
 */
export function createRelayPoller(options) {
  const intervalMs = options.intervalMs ?? DEFAULT_RELAY_POLL_MS;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let active = false;

  async function tick() {
    if (!options.isActive()) return;
    const ok = await options.probe();
    if (ok && options.isActive()) {
      options.onDetected();
    }
  }

  function start() {
    if (active) return;
    active = true;
    void tick();
    timer = setInterval(() => { void tick(); }, intervalMs);
  }

  function stop() {
    active = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    tick,
    isRunning: () => active,
  };
}
