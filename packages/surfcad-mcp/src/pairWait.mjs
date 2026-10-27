import { pairPendingError } from './errors.mjs';

/** Sentinel the pairing wait resolves with when the user has not clicked Allow in time. */
const PAIR_WAIT_TIMED_OUT = Symbol('pair_wait_timed_out');

/**
 * Wait up to `waitMs` for a pairing attempt. Past that it is `pair_pending`:
 * the attempt keeps running in the background and the caller retries.
 *
 * The timer used to resolve the timeout promise with itself, which is a
 * TypeError ("Chaining cycle detected for promise"): every pairing that did
 * not complete in time (an old tab that never answers, status before Allow
 * with a code in the env) surfaced as that message instead of pair_pending
 * (MVP 3 B4). A plain sentinel now marks the timeout.
 *
 * @template T
 * @param {Promise<T>} attempt
 * @param {number} waitMs
 * @returns {Promise<T>}
 */
export async function waitForPairing(attempt, waitMs) {
  attempt.catch(() => {});
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(PAIR_WAIT_TIMED_OUT), waitMs);
  });
  try {
    const outcome = await Promise.race([attempt, timeout]);
    if (outcome === PAIR_WAIT_TIMED_OUT) throw pairPendingError();
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}
