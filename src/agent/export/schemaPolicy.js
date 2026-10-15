/**
 * Validates agent command arg schemas before they land in commands.json.
 */

const ALLOW_LOOSE_NESTED = new Set(['params']);

/**
 * @param {string} commandName
 * @param {object} schema
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function validateArgsSchema(commandName, schema) {
  const reasons = [];
  if (!schema || schema.type !== 'object') {
    reasons.push('schema must be type object');
    return { ok: false, reasons };
  }
  if (schema.additionalProperties !== false) {
    reasons.push('top-level additionalProperties must be false');
  }
  const props = schema.properties || {};
  for (const [key, sub] of Object.entries(props)) {
    if (!sub || typeof sub !== 'object') {
      reasons.push(`property ${key} is missing a schema object`);
      continue;
    }
    if (sub.type === undefined && !sub.enum && !sub.oneOf && !sub.anyOf && !sub.allOf && !sub.$ref) {
      reasons.push(`property ${key} has no type, enum, or combinator`);
    }
    if (sub.type === 'object' && sub.additionalProperties === true && !ALLOW_LOOSE_NESTED.has(key)) {
      reasons.push(`property ${key} object allows additionalProperties (only params may)`);
    }
  }
  if (reasons.length) return { ok: false, reasons };
  return { ok: true };
}

/**
 * Properties with incomplete typing (for the PR report).
 * @param {object} schema
 * @returns {string[]}
 */
export function ambiguousArgProperties(schema) {
  const out = [];
  const props = schema?.properties || {};
  for (const [key, sub] of Object.entries(props)) {
    if (!sub || typeof sub !== 'object') {
      out.push(key);
      continue;
    }
    if (sub.type === undefined && !sub.enum && !sub.oneOf && !sub.anyOf) {
      out.push(key);
    }
    if (sub.type === 'object' && sub.additionalProperties === true) {
      out.push(`${key}.*`);
    }
  }
  return out;
}
