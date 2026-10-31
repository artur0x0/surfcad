/**
 * Clock seam so pairing, tokens, and the tab registry can be tested
 * without waiting out real minutes.
 */

export function createSystemClock() {
  return {
    now() {
      return Date.now();
    },
    /**
     * @param {() => void} fn
     * @param {number} ms
     */
    schedule(fn, ms) {
      // The HTTP server is what keeps the process up. These timers must
      // still fire while it is listening, and must not block exit once it closes.
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return handle;
    },
    /** @param {ReturnType<typeof setTimeout>} handle */
    cancel(handle) {
      clearTimeout(handle);
    },
  };
}

/**
 * @param {number} [start]
 */
export function createManualClock(start = 0) {
  let t = start;
  /** @type {{ at: number, fn: () => void, cancelled: boolean }[]} */
  const timers = [];

  function runDue() {
    let guard = 0;
    while (guard < 100) {
      guard += 1;
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= t);
      if (!due.length) return;
      for (const timer of due) timer.cancelled = true;
      for (const timer of due) timer.fn();
    }
  }

  return {
    now() {
      return t;
    },
    /** @param {number} ms */
    advance(ms) {
      t += ms;
      runDue();
    },
    /**
     * @param {() => void} fn
     * @param {number} ms
     */
    schedule(fn, ms) {
      const timer = { at: t + ms, fn, cancelled: false };
      timers.push(timer);
      return timer;
    },
    /** @param {{ cancelled?: boolean } | undefined} timer */
    cancel(timer) {
      if (timer) timer.cancelled = true;
    },
  };
}
