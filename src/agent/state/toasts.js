/**
 * Toast text. Viewport payloads are `{ text }` objects; some callers pass a string.
 * @param {unknown} value
 * @returns {string}
 */
export function toastText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.message === 'string') return value.message;
  }
  return '';
}

/**
 * Viewport notices the agent host publishes. Includes the execution-error
 * popup while that popup is showing.
 *
 * @param {{ executionError?: unknown, shellToast?: unknown }} [input]
 * @returns {Array<{ id: string, kind: string, message: string }>}
 */
export function viewportToastRows(input = {}) {
  const rows = [];
  const executionError = toastText(input.executionError);
  if (executionError) {
    rows.push({ id: 'execution-error', kind: 'error', message: executionError });
  }
  const shell = toastText(input.shellToast);
  if (shell) rows.push({ id: 'viewport-toast', kind: 'info', message: shell });
  return rows;
}

/**
 * Visible top-of-screen notices the agent can read without scraping the DOM.
 *
 * @param {Array<{ id: string, kind?: string, message: string }>} rows
 */
export function buildToasts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    toasts: list
      .filter((row) => row && typeof row.message === 'string' && row.message)
      .map((row) => ({
        id: typeof row.id === 'string' ? row.id : 'notice',
        kind: typeof row.kind === 'string' ? row.kind : 'info',
        message: row.message,
      })),
  };
}
