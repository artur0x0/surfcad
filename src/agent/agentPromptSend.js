/**
 * Composer send decisions for the in-viewer agent prompt.
 *
 * The field clears only after the transport accepts the text. A synchronous
 * failed ack, a throw, or a delivery that never acks keeps the draft and
 * the caller shows an error. iOS commits autocorrect and IME text into the
 * textarea before React state updates, so the DOM value wins when they differ.
 */

/** How long a sent prompt may sit with no ack before the field reports failure.
 *  Longer than the server hold (`PROMPT_HOLD_MS`, 8s) so a real `not_paired`
 *  ack arrives first. */
export const AGENT_PROMPT_SEND_TIMEOUT_MS = 12_000;

/**
 * @param {unknown} dom textarea.value
 * @param {unknown} state React state
 * @param {boolean} [composing]
 * @returns {string}
 */
export function promptDraftText(dom, state, composing = false) {
  const node = typeof dom === 'string' ? dom : '';
  const react = typeof state === 'string' ? state : '';
  if (composing === true || node !== react) {
    if (node.trim() || !react.trim()) return node;
  }
  return react;
}

/**
 * Clear the field only when send returned ok and no failed ack landed
 * during that call.
 *
 * @param {{ ok?: boolean, id?: string } | null | undefined} sent
 * @param {{ id?: string, delivery?: string } | null | undefined} syncAck
 */
export function shouldClearPromptOnSend(sent, syncAck) {
  if (!sent || sent.ok !== true) return false;
  if (syncAck && syncAck.id === sent.id && syncAck.delivery === 'failed') return false;
  return true;
}
