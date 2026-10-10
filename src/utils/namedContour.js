/**
 * A contour is its own script object. The contour owns its frame.
 *
 *   const c1 = makeCrossSection({ center, normal, x, y }, profile); // @contour id=c1
 *
 * Identity is the `@contour id=` marker, or the binding name when a
 * hand-written call has no marker. It is never a character offset.
 * Names start at c1. Renaming the binding rewrites code references
 * and leaves the id, which lives in the comment.
 */

import { declaredNames, emitPlaneFrameLiteral } from './helperPaletteSnippets.js';

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'let', 'static', 'yield', 'enum', 'await', 'implements',
  'package', 'protected', 'interface', 'private', 'public', 'part',
]);

/** Names that would shadow the helpers this statement calls. */
const SHADOW = new Set([
  'makeCrossSection', 'solveContour', 'profileCircle', 'profileRectangle', 'profilePolygon',
]);

function isContourIdent(name) {
  return /^[A-Za-z_$][\w$]*$/.test(String(name || ''));
}

function splitArgs(src) {
  const args = [];
  let depth = 0;
  let start = 0;
  const s = String(src || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      args.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function findCalls(src, name) {
  const out = [];
  const text = String(src || '');
  const needle = `${name}(`;
  let from = 0;
  while (from < text.length) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    if (i > 0 && /[\w$]/.test(text[i - 1])) {
      from = i + 1;
      continue;
    }
    const open = i + name.length;
    let depth = 0;
    let end = -1;
    for (let j = open; j < text.length; j++) {
      const c = text[j];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    out.push({
      start: i,
      end,
      args: splitArgs(text.slice(open + 1, end)),
    });
    from = end + 1;
  }
  return out;
}

/**
 * Named `makeCrossSection` statements, in source order.
 * An unbound call has no name and no marker, so it is not a contour.
 *
 * @returns {Array<{ id: string, name: string, marker: string|null, start: number, end: number, planeExpr: string, profileExpr: string }>}
 */
export function contourStatements(buffer) {
  const src = String(buffer || '');
  const out = [];
  for (const call of findCalls(src, 'makeCrossSection')) {
    const windowStart = Math.max(0, call.start - 240);
    const before = src.slice(windowStart, call.start);
    const bind = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
    if (!bind) continue;
    const rel = before.lastIndexOf(bind[0]);
    const start = windowStart + rel;
    const tail = src.slice(call.end + 1);
    const endMatch = tail.match(/^\s*;[^\n]*/);
    if (!endMatch) continue;
    const marker = endMatch[0].match(/@contour\s+id\s*=\s*([A-Za-z_$][\w$]*)/);
    const name = bind[1];
    out.push({
      id: marker ? marker[1] : name,
      name,
      marker: marker ? marker[1] : null,
      start,
      end: call.end + 1 + endMatch[0].length,
      planeExpr: (call.args[0] || '').trim(),
      profileExpr: (call.args[1] || '').trim(),
    });
  }
  return out;
}

export function hasNamedContour(buffer, id) {
  if (!id) return false;
  return contourStatements(buffer).some((stmt) => stmt.id === id);
}

function checkContourName(buffer, name, exceptName = null) {
  if (!isContourIdent(name)) {
    return { ok: false, message: 'Contour name must be an identifier.' };
  }
  if (RESERVED.has(name) || SHADOW.has(name)) {
    return { ok: false, message: `Contour name ${name} is reserved.` };
  }
  if (declaredNames(buffer).has(name) && name !== exceptName) {
    return { ok: false, message: `Contour name ${name} is already used.` };
  }
  const clash = contourStatements(buffer).some((stmt) => (
    stmt.name !== exceptName && (stmt.name === name || stmt.id === name)
  ));
  if (clash) return { ok: false, message: `Contour name ${name} is already used.` };
  return { ok: true };
}

/** Next auto name and id: c1, c2, … skipping names and ids already taken. */
export function mintContourIdentity(buffer) {
  const names = declaredNames(buffer);
  const ids = new Set();
  for (const stmt of contourStatements(buffer)) {
    names.add(stmt.name);
    ids.add(stmt.id);
  }
  let n = 1;
  let cand = 'c1';
  while (names.has(cand) || ids.has(cand)) {
    n += 1;
    cand = `c${n}`;
    if (n > 10000) break;
  }
  return { id: cand, name: cand };
}

export function emitNamedContourLine({ name, id, frame, profileExpr }) {
  return `const ${name} = makeCrossSection(${emitPlaneFrameLiteral(frame)}, ${profileExpr}); // @contour id=${id}`;
}

function spliceStatement(buffer, stmt, line) {
  const text = String(buffer || '');
  const next = text.slice(0, stmt.start) + line + text.slice(stmt.end);
  if (!next || next.endsWith('\n')) return next;
  return `${next}\n`;
}

function insertStatement(buffer, line) {
  const text = String(buffer || '').replace(/\s*$/, '');
  const ret = text.match(/\n?return\s+part\s*;$/);
  if (ret) {
    const head = text.slice(0, text.length - ret[0].length).replace(/\s*$/, '');
    return `${head ? `${head}\n` : ''}${line}\nreturn part;\n`;
  }
  if (!text) return `${line}\n`;
  return `${text}\n${line}\n`;
}

/**
 * Insert a contour, or rewrite the statement with this id.
 * A missing id mints c1, c2, …. An id that is not in the script yet
 * is inserted under that id (the session reserved it before the write).
 *
 * @returns {{ ok: true, buffer: string, id: string, name: string, statement: string } | { ok: false, message: string }}
 */
export function upsertNamedContour(buffer, spec = {}) {
  const profileExpr = String(spec.profileExpr || '').trim();
  if (!profileExpr) return { ok: false, message: 'No contour to save.' };
  const frame = spec.frame;
  if (!frame?.center || !frame?.normal || !frame?.x || !frame?.y) {
    return { ok: false, message: 'Contour needs a plane.' };
  }
  const stmts = contourStatements(buffer);
  const requestedId = spec.id ? String(spec.id) : '';
  const found = requestedId ? stmts.find((stmt) => stmt.id === requestedId) : null;
  if (found) {
    const nextName = spec.name ? String(spec.name) : found.name;
    const nameGate = checkContourName(buffer, nextName, found.name);
    if (!nameGate.ok) return nameGate;
    const line = emitNamedContourLine({ name: nextName, id: found.id, frame, profileExpr });
    return {
      ok: true,
      buffer: spliceStatement(buffer, found, line),
      id: found.id,
      name: nextName,
      statement: line,
    };
  }
  const minted = mintContourIdentity(buffer);
  const finalId = requestedId || minted.id;
  if (!isContourIdent(finalId)) return { ok: false, message: 'Contour id is not an identifier.' };
  if (stmts.some((stmt) => stmt.id === finalId)) {
    return { ok: false, message: `Contour id ${finalId} is already used.` };
  }
  let finalName;
  if (spec.name) finalName = String(spec.name);
  else if (requestedId && checkContourName(buffer, requestedId).ok) finalName = requestedId;
  else finalName = minted.name;
  const nameGate = checkContourName(buffer, finalName);
  if (!nameGate.ok) return nameGate;
  const line = emitNamedContourLine({ name: finalName, id: finalId, frame, profileExpr });
  return {
    ok: true,
    buffer: insertStatement(buffer, line),
    id: finalId,
    name: finalName,
    statement: line,
  };
}

/**
 * Rewrite bare code identifiers. Strings and comments stay, so
 * `@contour id=` and a dimension name inside quotes stay.
 * A property (`obj.c1`) is not a reference.
 */
function rewriteCodeIdentifiers(text, from, to) {
  let out = '';
  let i = 0;
  const ident = (ch) => /[A-Za-z0-9_$]/.test(ch || '');
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      out += c;
      i += 1;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') {
          out += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += text[i];
        i += 1;
      }
      if (i < text.length) {
        out += text[i];
        i += 1;
      }
      continue;
    }
    if (ident(c) && !ident(text[i - 1])) {
      let j = i + 1;
      while (ident(text[j])) j += 1;
      const word = text.slice(i, j);
      const prev = i > 0 ? text[i - 1] : '';
      out += word === from && prev !== '.' ? to : word;
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Rename the binding. References update. The marker id does not.
 *
 * @returns {{ ok: true, buffer: string, id: string, name: string } | { ok: false, message: string }}
 */
export function renameNamedContour(buffer, id, newName) {
  const found = contourStatements(buffer).find((stmt) => stmt.id === id);
  if (!found) return { ok: false, message: 'No contour with that id.' };
  const name = String(newName || '').trim();
  if (name === found.name) {
    return { ok: true, buffer: String(buffer || ''), id: found.id, name };
  }
  const gate = checkContourName(buffer, name, found.name);
  if (!gate.ok) return gate;
  return {
    ok: true,
    buffer: rewriteCodeIdentifiers(String(buffer || ''), found.name, name),
    id: found.id,
    name,
  };
}
