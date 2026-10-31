/**
 * Account-panel rows for relay tokens. Revoked rows stay off the list.
 * Last-used is a stable UTC stamp so a test can assert it.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatAgentLastUsed(value) {
  if (value == null || value === '') return 'Not used yet';
  const date = new Date(/** @type {string | number | Date} */ (value));
  if (Number.isNaN(date.getTime())) return 'Not used yet';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * @param {unknown} tokens
 * @returns {Array<{ id: string, label: string, machine: string, city: string | null, lastUsedAt: string | null }>}
 */
export function visibleAgentTokens(tokens) {
  if (!Array.isArray(tokens)) return [];
  return tokens.filter((row) => row && !row.revokedAt).map((row) => ({
    id: String(row.id),
    label: row.label || '',
    machine: row.machine || '',
    city: row.city || null,
    lastUsedAt: row.lastUsedAt ?? null,
  }));
}
