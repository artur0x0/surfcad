/**
 * One tap, one action, for the prompt's icon buttons.
 *
 * The buttons cancel pointerdown so the field keeps the caret and the
 * keyboard, then act on pointerup. Browsers differ on what follows: some
 * drop the click after a cancelled pointerdown, some deliver it in the same
 * task as pointerup, and a touch tap can deliver it tens of milliseconds
 * later, from its own task. A flag cleared on a 0 ms timer only covers the
 * second case. The third ran the action twice: the screenshot toggled on and
 * straight back off, and a Send turned into a Stop for the prompt it had
 * just sent.
 *
 * `press()` marks a handled pointerup. `echo()` answers whether a click or
 * form submit is the tail of that same tap, and consumes the mark, so each
 * press swallows at most one echo and a later real click still works.
 */

/** A tap's click arrives well inside this; a deliberate second tap does not rely on it. */
export const AGENT_PROMPT_PRESS_ECHO_MS = 700;

/**
 * @param {{ now?: () => number, windowMs?: number }} [opts]
 */
export function createPressGate(opts = {}) {
  const now = typeof opts.now === 'function'
    ? opts.now
    : () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : AGENT_PROMPT_PRESS_ECHO_MS;
  /** @type {number | null} */
  let pressedAt = null;
  return {
    /** A pointerup that ran the action. */
    press() {
      pressedAt = now();
    },
    /** True when this click or submit belongs to the press just handled. */
    echo() {
      if (pressedAt == null) return false;
      const age = now() - pressedAt;
      pressedAt = null;
      return age >= 0 && age <= windowMs;
    },
  };
}
