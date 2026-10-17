/**
 * Parse `npm pack --json` stdout across npm versions.
 * npm ≤11: JSON array; npm 12+: JSON object keyed by package name.
 * Lifecycle / notice lines may appear before or after the JSON document.
 */

function extractFirstJsonValue(text) {
  const startChar = text[0];
  if (startChar !== '[' && startChar !== '{') {
    throw new Error(`expected JSON array or object, got ${JSON.stringify(text.slice(0, 20))}`);
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }
  throw new Error('incomplete JSON in npm pack output');
}

export function parseNpmPackStdout(stdout) {
  const start = stdout.search(/[[{]/);
  if (start < 0) {
    throw new Error('no JSON document in npm pack stdout');
  }
  const jsonText = extractFirstJsonValue(stdout.slice(start).trimStart());
  return JSON.parse(jsonText);
}

export function packTarballEntry(packed) {
  if (Array.isArray(packed)) {
    return packed[0];
  }
  if (packed && typeof packed === 'object') {
    for (const value of Object.values(packed)) {
      if (value && typeof value === 'object' && value.filename) {
        return value;
      }
    }
  }
  throw new Error('unexpected npm pack --json shape');
}
