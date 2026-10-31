/**
 * Approval sentence. The city clause is the word "in", never a comma.
 * A missing city leaves the clause off. Client-supplied cities are ignored;
 * the relay looks the city up itself.
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
 * Client body city is ignored. The real city comes from the lookup, not
 * from this function.
 * @param {unknown} _
 * @returns {null}
 */
export function cityFromRequest(_) {
  return null;
}
