/**
 * The script's one top-level `return part;`.
 *
 * A study comment is allowed after that return. A feature block is not:
 * the worker stops at the return, the strip still draws the chip, and the
 * solid never includes it. A `return part` inside a function is a copied
 * body, not this return.
 */

export function findReturnPartIndex(buffer) {
  const spans = topLevelReturnSpans(buffer);
  return spans.length ? spans[0].start : -1;
}

export function topLevelReturnSpans(buffer) {
  const s = String(buffer || '');
  const spans = [];
  let i = 0;
  let quote = null;
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && i + 1 < s.length) {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') {
      quote = c;
      i += 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === '}') {
      if (depth > 0) depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && s.startsWith('return', i) && !/[\w$]/.test(s[i - 1] || '')) {
      const m = /^return\s+part\s*;/.exec(s.slice(i));
      if (m) {
        spans.push({ start: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

/** Drop every top-level `return part;`. Comments and code stay. */
export function removeTopLevelReturns(buffer) {
  const spans = topLevelReturnSpans(buffer);
  if (!spans.length) return String(buffer || '');
  let out = String(buffer || '');
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    let start = spans[i].start;
    let end = spans[i].end;
    if (out[end] === '\r') end += 1;
    if (out[end] === '\n') end += 1;
    else if (start > 0 && out[start - 1] === '\n') start -= 1;
    out = `${out.slice(0, start)}${out.slice(end)}`;
  }
  return out;
}

/**
 * `head` is the code before the first return. `tail` is everything after
 * that return statement (the study, and any dead blocks). No return yet.
 */
export function splitScriptReturn(buffer) {
  const src = String(buffer || '');
  const at = findReturnPartIndex(src);
  if (at < 0) return { head: src.replace(/\s*$/, ''), tail: '', returnAt: -1 };
  return {
    head: src.slice(0, at).replace(/\s*$/, ''),
    tail: src.slice(at).replace(/^return\s+part\s*;\s*/, ''),
    returnAt: at,
  };
}

/** One `return part;`, then the tail with any further returns removed. */
export function joinScriptReturn(head, tail) {
  const body = String(head || '').replace(/\s*$/, '');
  let rest = removeTopLevelReturns(String(tail || '')).replace(/^\s+/, '');
  if (rest) rest = rest.endsWith('\n') ? rest : `${rest}\n`;
  if (!body && !rest) return 'return part;\n';
  if (!rest) return `${body}\nreturn part;\n`;
  return body ? `${body}\nreturn part;\n${rest}` : `return part;\n${rest}`;
}

/**
 * Insert `chunk` immediately before the script's `return part;`.
 * Text after that return stays after it. With no return, the chunk is
 * appended. `ensureReturn` adds `return part;` in that case.
 */
export function insertChunkBeforeReturn(buffer, chunk, { ensureReturn = false } = {}) {
  const src = String(buffer || '');
  const body = String(chunk || '').endsWith('\n') ? String(chunk || '') : `${chunk}\n`;
  const at = findReturnPartIndex(src);
  if (at >= 0) {
    const head = src.slice(0, at).replace(/\s*$/, '');
    let tail = src.slice(at);
    if (tail && !tail.endsWith('\n')) tail = `${tail}\n`;
    return `${head ? `${head}\n` : ''}${body}${tail}`;
  }
  const trimmed = src.replace(/\s*$/, '');
  const base = trimmed ? `${trimmed}\n${body}` : body;
  if (ensureReturn && findReturnPartIndex(base) < 0) {
    return `${base.replace(/\s*$/, '')}\nreturn part;\n`;
  }
  return base.endsWith('\n') ? base : `${base}\n`;
}

/** Append a feature block before the single return, keeping the study tail. */
export function placeBlockBeforeReturn(buffer, block) {
  return insertChunkBeforeReturn(buffer, String(block || '').replace(/\s+$/, ''), { ensureReturn: true });
}
