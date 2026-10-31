/**
 * Approval sentence. City is optional: there is no IP geolocation in this
 * repo, so callers pass null and the "in <city>" clause is left off.
 * The clause is the word "in", never a comma before the city.
 *
 * @param {{ name?: string | null, machine?: string | null, city?: string | null }} fields
 * @returns {string}
 */
export function approvalSentence(fields) {
  const name = fields.name || 'an agent';
  const machine = fields.machine || 'an unknown machine';
  if (fields.city) return `Allow ${name} on ${machine} in ${fields.city} to connect?`;
  return `Allow ${name} on ${machine} to connect?`;
}

/**
 * No geo library is checked in. City stays unset rather than guessing from
 * the IP or trusting a client-supplied city.
 * @param {unknown} _
 * @returns {null}
 */
export function cityFromRequest(_) {
  return null;
}
