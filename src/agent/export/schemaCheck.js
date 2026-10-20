/**
 * Small JSON Schema checker for the agent catalog.
 *
 * Covers the keywords the catalog arg schemas use (type, enum, properties,
 * required, additionalProperties, items, minItems, maxItems, minimum,
 * maximum, exclusiveMinimum, pattern, minLength, maxLength, oneOf, anyOf,
 * allOf). Strict MCP clients validate every call against these schemas
 * before sending it, so the examples the catalog and the skill doc show
 * must pass here.
 */

const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

function typeMatches(type, value) {
  if (Array.isArray(type)) return type.some((t) => typeMatches(t, value));
  const check = TYPE_CHECKS[type];
  if (!check) throw new Error(`schemaCheck: unsupported type ${String(type)}`);
  return check(value);
}

const KNOWN_KEYWORDS = new Set([
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'pattern', 'minLength', 'maxLength', 'oneOf', 'anyOf',
  'allOf', 'description', 'default', 'title', 'examples', '$schema',
]);

/**
 * Errors from checking `value` against `schema`. Empty when it validates.
 * Throws on a keyword this checker does not implement, so a new keyword in
 * the catalog cannot pass silently.
 *
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function schemaErrors(schema, value, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) throw new Error(`schemaCheck: unsupported keyword ${key} at ${path}`);
  }
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type}`);
    return errors;
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => sameJson(e, value))) {
    errors.push(`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (schema.const !== undefined && !sameJson(schema.const, value)) {
    errors.push(`${path} must be ${JSON.stringify(schema.const)}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push(`${path} must be < ${schema.exclusiveMaximum}`);
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path} must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} items`);
    if (schema.items !== undefined) {
      value.forEach((item, i) => {
        const sub = Array.isArray(schema.items) ? schema.items[i] : schema.items;
        if (sub) errors.push(...schemaErrors(sub, item, `${path}[${i}]`));
      });
    }
  }
  if (TYPE_CHECKS.object(value)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (key in props) {
        errors.push(...schemaErrors(props[key], item, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...schemaErrors(schema.additionalProperties, item, `${path}.${key}`));
      }
    }
  }
  if (schema.allOf) {
    for (const sub of schema.allOf) errors.push(...schemaErrors(sub, value, path));
  }
  if (schema.anyOf) {
    const passes = schema.anyOf.some((sub) => schemaErrors(sub, value, path).length === 0);
    if (!passes) errors.push(`${path} matches none of anyOf`);
  }
  if (schema.oneOf) {
    const count = schema.oneOf.filter((sub) => schemaErrors(sub, value, path).length === 0).length;
    if (count !== 1) errors.push(`${path} matches ${count} of oneOf, needs exactly 1`);
  }
  return errors;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Top-level arg keys of a shorthand call from the skill doc, such as
 * `{ id | index, confirm? }` or `{ scope: "assembly" | "repo", confirm? }`.
 * `…` is skipped. Each key comes back without its `?`.
 *
 * @param {string} inner The text between the braces.
 * @returns {string[]}
 */
export function shorthandKeys(inner) {
  const keys = [];
  let depth = 0;
  let token = '';
  const flush = () => {
    const t = token.trim();
    token = '';
    if (!t || t === '…' || t === '...') return;
    const head = t.includes(':') ? t.slice(0, t.indexOf(':')) : t;
    for (const alt of head.split('|')) {
      const key = alt.trim().replace(/^["']|["']$/g, '').replace(/\?$/, '');
      if (key && key !== '…' && key !== '...') keys.push(key);
    }
  };
  for (const ch of inner) {
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      flush();
      continue;
    }
    token += ch;
  }
  flush();
  return keys;
}

/**
 * JSON for a shorthand call when it is concrete (no `?`, `…`, or bare
 * alternatives); null otherwise. Bare keys are quoted.
 *
 * @param {string} inner
 * @returns {object | null}
 */
export function shorthandJson(inner) {
  if (/[?…|]|\.\.\./.test(inner)) return null;
  const quoted = `{${inner}}`.replace(/([{,]\s*)([A-Za-z_][\w]*)(\s*:)/g, '$1"$2"$3');
  try {
    const parsed = JSON.parse(quoted);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
