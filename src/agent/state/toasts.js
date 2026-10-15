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
