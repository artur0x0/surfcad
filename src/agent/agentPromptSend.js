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

/**
 * In-flight prompt bookkeeping.
 *
 * A timeout forgets the id and the caller cancels it. The server drops a
 * held prompt (`dropHeldPrompt`, no expiry ack) or forwards
 * `agent.prompt.cancel` to a live agent. The retry is a new id on the same
 * socket, so it does not sit beside the timed-out one.
 *
 * Only the current pending id may change the field. Timed-out ids stay
 * listed so a late `queued` or `webhook` ack cannot clear a restored draft.
 *
 * @typedef {{
 *   pendingId: string | null,
 *   sent: { id: string, text: string } | null,
 *   draft: { id: string, text: string, shot: unknown } | null,
 *   timedOutIds: string[],
 * }} PromptFlight
 */

/** @returns {PromptFlight} */
export function emptyPromptFlight() {
  return { pendingId: null, sent: null, draft: null, timedOutIds: [] };
}

/**
 * Keep a non-empty edit. Otherwise put the sent draft back.
 * @param {unknown} current
 * @param {unknown} draftText
 */
export function restorePromptDraft(current, draftText) {
  if (typeof current === 'string' && current.trim()) return current;
  return typeof draftText === 'string' ? draftText : '';
}

/**
 * Clear only when the field still holds the sent text, or is empty.
 * @param {unknown} current
 * @param {unknown} sentText
 */
export function clearAcceptedPrompt(current, sentText) {
  if (current === sentText) return '';
  if (!(typeof current === 'string' && current.trim())) return '';
  return current;
}

/**
 * @param {PromptFlight | null | undefined} flight
 * @param {{ type: string, id?: string, text?: string, shot?: unknown, delivery?: string }} event
 * @returns {{
 *   flight: PromptFlight,
 *   ignore: boolean,
 *   cancelId: string | null,
 *   ack: { delivery: string, error?: string, id: string } | null,
 *   input: null | { op: 'restore', text: string } | { op: 'clear', text: string },
 *   shot: null | { op: 'restore', shot: unknown } | { op: 'clear' },
 * }}
 */
export function stepPromptFlight(flight, event) {
  const cur = flight && typeof flight === 'object' ? flight : emptyPromptFlight();
  const timedOutIds = Array.isArray(cur.timedOutIds) ? cur.timedOutIds : [];
  const base = {
    flight: { ...cur, timedOutIds },
    ignore: true,
    cancelId: null,
    ack: null,
    input: null,
    shot: null,
  };
  if (!event || typeof event !== 'object') return base;
  const id = typeof event.id === 'string' ? event.id : '';

  if (event.type === 'sent') {
    if (!id) return base;
    const text = typeof event.text === 'string' ? event.text : '';
    return {
      ...base,
      ignore: false,
      flight: {
        pendingId: id,
        sent: { id, text },
        draft: { id, text, shot: event.shot ?? null },
        timedOutIds,
      },
    };
  }

  if (event.type === 'disconnect') {
    return {
      ...base,
      ignore: false,
      flight: { pendingId: null, sent: null, draft: null, timedOutIds },
    };
  }

  if (event.type === 'timeout') {
    if (!id || cur.pendingId !== id) return base;
    const nextTimed = timedOutIds.includes(id) ? timedOutIds : [...timedOutIds, id];
    const draft = cur.draft && cur.draft.id === id ? cur.draft : null;
    return {
      flight: { pendingId: null, sent: null, draft: null, timedOutIds: nextTimed },
      ignore: false,
      cancelId: id,
      ack: { delivery: 'failed', error: 'timeout', id },
      input: draft ? { op: 'restore', text: draft.text } : null,
      shot: draft && draft.shot ? { op: 'restore', shot: draft.shot } : null,
    };
  }

  if (event.type === 'ack') {
    if (!id || timedOutIds.includes(id) || id !== cur.pendingId) return base;
    const draft = cur.draft && cur.draft.id === id ? cur.draft : null;
    let sent = cur.sent;
    let nextDraft = cur.draft;
    let input = null;
    let shot = null;
    if (event.delivery === 'failed') {
      if (sent?.id === id) sent = null;
      if (draft) {
        nextDraft = null;
        input = { op: 'restore', text: draft.text };
        if (draft.shot) shot = { op: 'restore', shot: draft.shot };
      }
    } else if (sent?.id === id) {
      input = { op: 'clear', text: sent.text };
      sent = null;
      if (draft) nextDraft = null;
      shot = { op: 'clear' };
    }
    return {
      flight: { ...cur, sent, draft: nextDraft, timedOutIds },
      ignore: false,
      cancelId: null,
      ack: null,
      input,
      shot,
    };
  }

  return base;
}
