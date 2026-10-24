/* global structuredClone */
/**
 * Feature-level memoisation (MVP plan step 6).
 *
 * A part script runs from its first line on every edit. The feature strip
 * already splits it into marked blocks in order, and a block's result is a
 * pure function of the script text before it, so the worker keeps, per
 * block, the bindings the script holds when that block closes. A rerun
 * walks the blocks in order: every leading block whose key still matches is
 * restored instead of executed, and execution starts at the first changed
 * block. Changing block k therefore re-runs k and everything after it, and
 * nothing before it.
 *
 * Key. The key of block i is a hash of the whole script text up to the end
 * of block i (plus the imported-model signature). That is deliberately a
 * prefix hash, not a per-block dependency graph: it can only lose hits (an
 * edit to an unrelated earlier block), never serve a stale one.
 *
 * Value. The live kernel handles (clones, so the script's own handles stay
 * the arena's to free) plus structured clones of the plain data bound at
 * that point, and the runtime's per-run side tables (face stamps, fillet op
 * brackets, tessellation tags, stamp counters). Handles, not serialised
 * meshes: a mesh round-trip is float32 and would not be bit-identical for
 * the booleans that follow, while a clone shares the kernel's own node and
 * its already-evaluated result.
 *
 * Replay. The evaluation copy keeps every marker line (so block ids, the
 * tracker and error lines are unchanged) and replaces each restored block's
 * interior with one line that rebinds its names from the cache; the blocks
 * that run get a capture call on their end-marker line. Line count is
 * unchanged. Code outside blocks always runs: the preamble's helper lambdas
 * must close over this run's bindings, so they are re-created, and the
 * restore then assigns every captured name over them (top-level `const` in
 * the copy is relaxed to `let` for that).
 *
 * What is not cached: a block that uses a clock or randomness, a block that
 * declares a function or class, a script whose top level has a construct
 * the scanner does not follow (destructuring, a nested `var`), and every
 * block after such a point. A block that throws is never captured.
 *
 * Storage is an in-memory LRU per worker with a byte budget; eviction only
 * costs time. Nothing is persisted: handles cannot be, and a serialised
 * mesh would not be exact (above).
 */
import { parseFeatureMarkers } from '../../utils/featureMarkers.js';

/** Scope names the evaluation copy calls. Not user-visible helpers. */
export const MEMO_CAPTURE = '__memoCapture';
export const MEMO_RESTORE = '__memoRestore';

/** A block that reads a clock, randomness, or the network is not a pure function of its text. */
const IMPURE_RE = /\b(?:Math\.random|Date\.now|new\s+Date\b|performance\.now|crypto\.|setTimeout|setInterval|fetch\s*\(|importScripts)/;

const MIB = 1024 * 1024;
export const FEATURE_MEMO_MIN_BUDGET = 64 * MIB;
export const FEATURE_MEMO_MAX_BUDGET = 512 * MIB;
const FEATURE_MEMO_PER_GB = 64 * MIB;
const FEATURE_MEMO_FALLBACK = 128 * MIB;

/**
 * Byte budget for one worker's cache, from the same device signal the
 * geometry pool cap reads: 64 MiB per GB of `deviceMemory`, clamped to
 * 64..512 MiB; 128 MiB when the browser does not say.
 */
export function featureMemoBudgetBytes({ deviceMemory } = {}) {
  const gb = Number(deviceMemory);
  if (!Number.isFinite(gb) || gb <= 0) return FEATURE_MEMO_FALLBACK;
  return Math.max(FEATURE_MEMO_MIN_BUDGET, Math.min(FEATURE_MEMO_MAX_BUDGET, Math.floor(gb * FEATURE_MEMO_PER_GB)));
}

// ─── hashing ────────────────────────────────────────────────────────────────

/** cyrb53: a fast 53-bit string hash. Two seeds give 106 bits. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Content key of `text` (and `salt`): length plus two independent hashes. */
export function memoKey(text, salt = '') {
  const s = `${salt}\u0000${text}`;
  return `${s.length}:${cyrb53(s, 1).toString(36)}:${cyrb53(s, 2).toString(36)}`;
}

/**
 * Signature of the imported models a script may read through `importMesh`:
 * names, lengths and a sparse sample of the vertex data. Part of every key.
 */
export function importedModelsKey(importedModels) {
  if (!importedModels || typeof importedModels !== 'object') return '';
  const names = Object.keys(importedModels).sort();
  if (!names.length) return '';
  const parts = [];
  for (const name of names) {
    const m = importedModels[name] || {};
    const vp = m.vertProperties || [];
    const tv = m.triVerts || [];
    let sample = 0;
    const step = Math.max(1, Math.floor(vp.length / 64));
    for (let i = 0; i < vp.length; i += step) sample = (sample * 31 + Math.round(vp[i] * 1000)) | 0;
    parts.push(`${name}|${vp.length}|${tv.length}|${sample}`);
  }
  return parts.join(';');
}

// ─── top-level declaration scanner ──────────────────────────────────────────

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
/** A `/` after one of these starts a regular expression, not a division. */
const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return', 'typeof', 'case', 'in', 'of', 'new', 'void', 'delete', 'throw']);
/** A line that starts with one of these continues the expression above it (no ASI). */
const CONTINUES_LINE = new Set(['.', '+', '-', '*', '/', '%', '?', ':', ',', ')', ']', '}', '&', '|', '=', '<', '>', '(', '[', '`']);
const DECL_WORDS = new Set(['let', 'const', 'var']);

/**
 * Top-level `let` / `const` / `var` / `function` declarations of a script
 * that runs as a function body, with the offset of each name, in order.
 * Comments, strings, template literals and regex literals are skipped;
 * nesting of (), [], {} is tracked so a `let` inside a lambda is not a
 * top-level name. Anything the scanner does not follow at top level
 * (destructuring, `class`, a `var` below top level, `let` with no name) is
 * reported in `unsupported` with its offset, so a caller can stop caching
 * there instead of guessing.
 *
 * @returns {{ decls: Array<{ name: string, kind: 'let'|'const'|'var'|'function', at: number }>, unsupported: Array<{ at: number, reason: string }> }}
 */
export function topLevelDeclarations(text) {
  const s = String(text || '');
  const decls = [];
  const unsupported = [];
  const n = s.length;
  let i = 0;
  let depth = 0;
  // Template literals: a stack of the brace depth at which each `${` opened.
  const tplStack = [];
  let lastSig = '';
  let lastWord = '';
  // Declarator parsing state for a top-level let/const/var statement.
  let decl = null; // { kind, depth, expectName, inInit, lastSigInInit }

  const peekNonSpace = (from) => {
    let j = from;
    while (j < n && /\s/.test(s[j])) j += 1;
    return j;
  };
  const endDecl = () => { decl = null; };

  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];

    // Comments.
    if (c === '/' && c2 === '/') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    // Strings.
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && s[j] !== c) { if (s[j] === '\\') j += 1; if (s[j] === '\n') break; j += 1; }
      i = j + 1;
      lastSig = c;
      lastWord = '';
      continue;
    }
    // Template literal start (or a `${…}` body closing back into one).
    if (c === '`') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '`') { closed = true; break; }
        if (s[j] === '$' && s[j + 1] === '{') { tplStack.push(depth); depth += 1; j += 2; break; }
        j += 1;
      }
      i = j + 1;
      lastSig = closed ? '`' : '{';
      lastWord = '';
      continue;
    }
    // Regex literal.
    if (c === '/' && (lastSig === '' || REGEX_BEFORE.has(lastSig) || REGEX_BEFORE.has(lastWord))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && s[j] !== '\n') {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '[') inClass = true;
        else if (s[j] === ']') inClass = false;
        else if (s[j] === '/' && !inClass) break;
        j += 1;
      }
      i = j + 1;
      while (i < n && ID_PART.test(s[i])) i += 1; // flags
      lastSig = ')';
      lastWord = '';
      continue;
    }

    // Brackets.
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      i += 1;
      lastSig = c;
      lastWord = '';
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (c === '}' && tplStack.length && depth - 1 === tplStack[tplStack.length - 1]) {
        // Back into the template literal.
        tplStack.pop();
        depth -= 1;
        let j = i + 1;
        let closed = false;
        while (j < n) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '`') { closed = true; break; }
          if (s[j] === '$' && s[j + 1] === '{') { tplStack.push(depth); depth += 1; j += 2; break; }
          j += 1;
        }
        i = j + 1;
        lastSig = closed ? '`' : '{';
        lastWord = '';
        continue;
      }
      if (depth > 0) depth -= 1;
      i += 1;
      lastSig = c;
      lastWord = '';
      continue;
    }

    // Declarator list of an open top-level declaration.
    if (decl && depth === decl.depth) {
      if (decl.expectName) {
        const j = peekNonSpace(i);
        if (j >= n) { endDecl(); break; }
        const ch = s[j];
        if (ch === '{' || ch === '[') {
          unsupported.push({ at: j, reason: 'destructuring' });
          endDecl();
          i = j;
          continue;
        }
        if (!ID_START.test(ch)) {
          unsupported.push({ at: j, reason: `${decl.kind} without a name` });
          endDecl();
          i = j;
          continue;
        }
        let k = j + 1;
        while (k < n && ID_PART.test(s[k])) k += 1;
        decls.push({ name: s.slice(j, k), kind: decl.kind, at: j });
        decl.expectName = false;
        decl.inInit = false;
        const after = peekNonSpace(k);
        if (s[after] === '=' && s[after + 1] !== '=') {
          decl.inInit = true;
          i = after + 1;
          lastSig = '=';
          lastWord = '';
          continue;
        }
        if (s[after] === ',') { decl.expectName = true; i = after + 1; lastSig = ','; lastWord = ''; continue; }
        endDecl();
        i = k;
        lastSig = 'x';
        lastWord = '';
        continue;
      }
      if (decl.inInit) {
        if (c === ',') { decl.expectName = true; decl.inInit = false; i += 1; lastSig = ','; lastWord = ''; continue; }
        if (c === ';') { endDecl(); i += 1; lastSig = ';'; lastWord = ''; continue; }
        if (c === '\n') {
          // ASI: the statement ends unless the next line continues the expression.
          const j = peekNonSpace(i);
          const next = s[j];
          const prevContinues = lastSig && (CONTINUES_LINE.has(lastSig) && lastSig !== ')' && lastSig !== ']' && lastSig !== '}');
          if (j >= n || !(CONTINUES_LINE.has(next) || prevContinues)) endDecl();
          i += 1;
          continue;
        }
      }
    }

    // Words.
    if (ID_START.test(c) && !(i > 0 && ID_PART.test(s[i - 1]))) {
      let k = i + 1;
      while (k < n && ID_PART.test(s[k])) k += 1;
      const word = s.slice(i, k);
      const inInit = !!(decl && decl.inInit);
      if (depth === 0 && !inInit) {
        if (DECL_WORDS.has(word)) {
          decl = { kind: word, depth, expectName: true, inInit: false };
          i = k;
          lastSig = 'x';
          lastWord = word;
          continue;
        }
        if (word === 'function') {
          let j = peekNonSpace(k);
          if (s[j] === '*') j = peekNonSpace(j + 1);
          if (ID_START.test(s[j] || '')) {
            let e = j + 1;
            while (e < n && ID_PART.test(s[e])) e += 1;
            decls.push({ name: s.slice(j, e), kind: 'function', at: j });
          }
        } else if (word === 'class') {
          unsupported.push({ at: i, reason: 'class declaration' });
        }
      } else if (word === 'var' && depth > 0) {
        // Function-scoped but declared where the scanner cannot see its
        // binding; a capture would miss it.
        unsupported.push({ at: i, reason: 'var below top level' });
      }
      i = k;
      lastSig = 'x';
      lastWord = word;
      continue;
    }

    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i += 1;
  }
  return { decls, unsupported };
}

// ─── planning ───────────────────────────────────────────────────────────────

/** Offset of the first character of the line containing `at`. */
function lineStart(text, at) {
  return text.lastIndexOf('\n', at - 1) + 1;
}

/** True when only spaces/tabs sit between the start of the line and `at`. */
function atLineStart(text, at) {
  for (let i = at - 1; i >= 0; i -= 1) {
    const c = text[i];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t' && c !== '\r') return false;
  }
  return true;
}

/** Interior of a block: after the begin-marker line, before the end-marker line. */
function blockInterior(text, feature) {
  const beginEol = text.indexOf('\n', feature.startOffset);
  const endMarkerAt = lineStart(text, feature.endOffset - 1);
  if (beginEol < 0 || beginEol + 1 > endMarkerAt) return null;
  return { from: beginEol + 1, to: endMarkerAt, endMarkerAt };
}

/** Does any block assign `name` (so a function bound outside a block cannot be re-created by the preamble)? */
function assignedInBlocks(text, blocks, name) {
  const re = new RegExp(`(^|[^.\\w$])${name.replace(/\$/g, '\\$')}\\s*(?:=[^=]|\\+\\+|--|[+\\-*/%&|^]=)`, 'm');
  for (const b of blocks) if (re.test(text.slice(b.interior.from, b.interior.to))) return b.index;
  return -1;
}

/**
 * Plan a run of `script`: which blocks can be served from the cache, and
 * the evaluation copy that restores them and captures the rest.
 *
 * @param {string} script the text to run (already the evaluation copy when blocks are blanked)
 * @param {{ lookup: (key: string) => object | null, salt?: string }} opts
 * @returns {{
 *   text: string,
 *   blocks: Array<{ index: number, id: string, key: string, cacheable: boolean, reason: string|null,
 *     names: Array<{ name: string, kind: string, inBlock: boolean, here: boolean }> }>,
 *   hits: number,
 *   entries: object[],
 *   disabled: string | null,
 * }}
 */
export function planMemo(script, opts = {}) {
  const text = String(script ?? '');
  const lookup = typeof opts.lookup === 'function' ? opts.lookup : () => null;
  const salt = String(opts.salt || '');
  const features = parseFeatureMarkers(text);
  if (!features.length) return { text, blocks: [], hits: 0, entries: [], disabled: 'no_blocks' };

  const scan = topLevelDeclarations(text);
  const blocks = [];
  for (const f of features) {
    const interior = blockInterior(text, f);
    const ok = !!interior && atLineStart(text, f.startOffset) && atLineStart(text, interior.endMarkerAt);
    blocks.push({ index: f.index, id: f.id, start: f.startOffset, end: f.endOffset, interior, markersOk: ok });
  }

  // Where caching must stop: the first unsupported construct, impure block,
  // function/class declared inside a block, or a function bound outside a
  // block that a block reassigns.
  let stopAt = Infinity; // text offset
  let stopReason = null;
  const stop = (at, reason) => { if (at < stopAt) { stopAt = at; stopReason = reason; } };
  for (const u of scan.unsupported) stop(u.at, u.reason);
  const inBlockOf = (at) => blocks.find((b) => at >= b.start && at < b.end) || null;
  for (const d of scan.decls) {
    const b = inBlockOf(d.at);
    if (d.kind === 'function') {
      if (b) stop(b.start, 'function declared in a block');
      continue;
    }
    if (!b) {
      const k = assignedInBlocks(text, blocks.filter((x) => x.interior), d.name);
      // Only a function value needs this; the capture decides at run time
      // and marks the name fresh. Record the first assigning block so a
      // fresh (function-valued) name that a block rebinds stops the cache.
      if (k >= 0) d.reassignedIn = k;
    }
  }
  for (const b of blocks) {
    if (!b.markersOk) { stop(b.start, 'marker not at line start'); continue; }
    const body = text.slice(b.interior.from, b.interior.to);
    if (IMPURE_RE.test(body)) stop(b.start, 'clock, randomness or network in a block');
  }

  const plain = scan.decls.filter((d) => d.kind !== 'function');
  for (const b of blocks) {
    b.cacheable = b.markersOk && b.end <= stopAt;
    b.reason = b.cacheable ? null : (b.markersOk ? stopReason : 'marker not at line start');
    b.key = memoKey(text.slice(0, b.end), salt);
    // Names bound by the end of this block: declared textually before it
    // closes, at top level. `here` = first declared inside this block.
    b.names = plain
      .filter((d) => d.at < b.end)
      .map((d) => ({
        name: d.name,
        kind: d.kind,
        inBlock: !!inBlockOf(d.at),
        here: d.at >= b.start && d.at < b.end,
        reassignedIn: d.reassignedIn,
      }));
    // Two declarations of one name (a `var` twice): keep the first.
    const seen = new Set();
    b.names = b.names.filter((row) => (seen.has(row.name) ? false : (seen.add(row.name), true)));
  }

  // Longest prefix served from the cache.
  const entries = [];
  let hits = 0;
  for (const b of blocks) {
    if (!b.cacheable) break;
    const entry = lookup(b.key);
    if (!entry || entry.blockIndex !== b.index) break;
    entries.push(entry);
    hits += 1;
  }

  // Evaluation copy: restore stubs for hits, capture calls for the rest.
  const edits = [];
  for (const b of blocks) {
    if (!b.cacheable) continue;
    if (b.index < hits) {
      const entry = entries[b.index];
      const parts = [`const __memo${b.index} = ${MEMO_RESTORE}(${b.index});`];
      for (const row of entry.names) {
        if (!row.restore) continue;
        parts.push(row.here ? `let ${row.name} = __memo${b.index}.${row.name};` : `${row.name} = __memo${b.index}.${row.name};`);
      }
      const interior = text.slice(b.interior.from, b.interior.to);
      edits.push({ from: b.interior.from, to: b.interior.to, code: parts.join(' ') + interior.replace(/[^\n]/g, '') });
    } else {
      const list = b.names.map((row) => `${row.name}:${row.name}`).join(',');
      edits.push({ from: b.interior.endMarkerAt, to: b.interior.endMarkerAt, code: `;${MEMO_CAPTURE}(${b.index},()=>({${list}}));` });
    }
  }
  // In a copy that restores blocks, a top-level `const` declared outside a
  // block before the last restored one is assigned by a restore, so it
  // becomes `let  ` (same length). A script that reassigned a const would
  // have thrown cold and never been cached, so this changes nothing else.
  if (hits > 0) {
    const lastEnd = blocks[hits - 1].end;
    for (const d of scan.decls) {
      if (d.kind !== 'const' || d.at >= lastEnd) continue;
      if (blocks.some((b) => b.index < hits && d.at >= b.start && d.at < b.end)) continue;
      const k = text.lastIndexOf('const', d.at);
      if (k < 0 || k < d.at - 12) continue;
      edits.push({ from: k, to: k + 5, code: 'let  ' });
    }
  }
  let out = text;
  edits.sort((a, b) => b.from - a.from);
  for (const e of edits) out = out.slice(0, e.from) + e.code + out.slice(e.to);
  return { text: out, blocks, hits, entries, disabled: null };
}

// ─── the cache ──────────────────────────────────────────────────────────────

function isHandle(value) {
  return !!value && typeof value === 'object'
    && typeof value.delete === 'function'
    && typeof value.isDeleted === 'function';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Approximate bytes a kernel handle holds (float32 verts, uint32 tris and faceIDs). */
function handleBytes(h) {
  try {
    if (typeof h.numTri === 'function' && typeof h.numVert === 'function') {
      const nv = h.numVert();
      const nt = h.numTri();
      const np = typeof h.numProp === 'function' ? Math.max(3, h.numProp()) : 3;
      return nv * np * 4 + nt * 16;
    }
    if (typeof h.numVert === 'function') return h.numVert() * 16;
  } catch { /* an empty or deleted handle */ }
  return 1024;
}

function approxDataBytes(v) {
  try { return JSON.stringify(v)?.length ?? 16; } catch { return 1024; }
}

/**
 * Snapshot one bound value. Handles are cloned (`cloneHandle` must keep the
 * clone out of the arena sweep); plain data is structured-cloned; a
 * function is reported as `fresh` so the caller can decide; anything else
 * is unclonable and stops the capture.
 */
function snapshotValue(value, cloneHandle, holders) {
  if (typeof value === 'function') return { kind: 'fresh' };
  if (value === null || typeof value !== 'object') return { kind: 'data', v: value };
  if (isHandle(value)) {
    if (typeof value.clone !== 'function') throw new Error('handle without clone');
    const h = cloneHandle(value);
    holders.push(h);
    return { kind: 'handle', h };
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => snapshotValue(item, cloneHandle, holders));
    if (items.some((it) => it.kind === 'fresh')) throw new Error('function inside an array');
    return items.every((it) => it.kind === 'data') ? { kind: 'data', v: structuredClone(value) } : { kind: 'array', items };
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const items = {};
    let allData = true;
    for (const k of keys) {
      const it = snapshotValue(value[k], cloneHandle, holders);
      if (it.kind === 'fresh') throw new Error('function inside an object');
      if (it.kind !== 'data') allData = false;
      items[k] = it;
    }
    return allData ? { kind: 'data', v: structuredClone(value) } : { kind: 'object', items };
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return { kind: 'data', v: structuredClone(value) };
  throw new Error(`unclonable value (${value.constructor?.name || 'object'})`);
}

function restoreValue(snap, cloneHandle) {
  switch (snap.kind) {
    case 'data': return typeof snap.v === 'object' && snap.v !== null ? structuredClone(snap.v) : snap.v;
    case 'handle': return cloneHandle(snap.h);
    case 'array': return snap.items.map((it) => restoreValue(it, cloneHandle));
    case 'object': {
      const out = {};
      for (const k of Object.keys(snap.items)) out[k] = restoreValue(snap.items[k], cloneHandle);
      return out;
    }
    default: return undefined;
  }
}

function forEachHandle(snap, fn) {
  if (!snap) return;
  if (snap.kind === 'handle') fn(snap.h);
  else if (snap.kind === 'array') snap.items.forEach((it) => forEachHandle(it, fn));
  else if (snap.kind === 'object') Object.values(snap.items).forEach((it) => forEachHandle(it, fn));
}

/**
 * One worker's cache: an insertion-ordered map used as an LRU with a byte
 * budget. `cloneHandle(h)` clones a kernel handle for storage or hand-out
 * (the runtime wires it to the arena and the run-estimate table).
 */
export class FeatureMemo {
  constructor({
    budgetBytes = FEATURE_MEMO_FALLBACK,
    /** Clone for storage: the runtime keeps this one out of the arena sweep. */
    cloneHandle = (h) => h.clone(),
    /** Clone for hand-out: an ordinary handle the run's arena frees. */
    handOut = cloneHandle,
    freeHandle = (h) => h.delete(),
  } = {}) {
    this.budgetBytes = budgetBytes;
    this.cloneHandle = cloneHandle;
    this.handOut = handOut;
    this.freeHandle = freeHandle;
    this.entries = new Map();
    this.bytes = 0;
    this.enabled = true;
    this.hits = 0;
    this.misses = 0;
  }

  lookup(key) {
    const e = this.entries.get(key);
    if (!e) return null;
    // Touch: move to the end.
    this.entries.delete(key);
    this.entries.set(key, e);
    e.lastUsed = Date.now();
    return e;
  }

  /**
   * Take a capture made during a run. `values` is what the script's thunk
   * returned; `names` the plan's rows for that block; `state` the runtime's
   * side tables. Returns the entry (not yet counted: `commit` sizes it) or
   * throws when a value cannot be snapshotted.
   */
  capture({ key, blockIndex, names, values, state }) {
    const holders = [];
    try {
      const snaps = {};
      const rows = [];
      for (const row of names) {
        const snap = snapshotValue(values[row.name], this.cloneHandle, holders);
        if (snap.kind === 'fresh') {
          if (row.inBlock) throw new Error(`function bound in a block (${row.name})`);
          if (row.reassignedIn != null && row.reassignedIn >= 0 && row.reassignedIn <= blockIndex) {
            throw new Error(`function ${row.name} rebound in a block`);
          }
          rows.push({ ...row, restore: false });
          continue;
        }
        snaps[row.name] = snap;
        rows.push({ ...row, restore: true });
      }
      return { key, blockIndex, names: rows, snaps, state, holders, bytes: 0, lastUsed: Date.now() };
    } catch (err) {
      for (const h of holders) { try { this.freeHandle(h); } catch { /* freed */ } }
      throw err;
    }
  }

  /** Size and store entries from one run, evicting the least recently used first. */
  commit(entries) {
    const fresh = [];
    for (const e of entries) {
      let bytes = 256;
      for (const snap of Object.values(e.snaps)) {
        if (snap.kind === 'data') bytes += approxDataBytes(snap.v);
        else forEachHandle(snap, (h) => { bytes += handleBytes(h); });
      }
      bytes += approxDataBytes(e.state);
      e.bytes = bytes;
      fresh.push(e);
    }
    const need = fresh.reduce((n, e) => n + e.bytes, 0);
    if (need > this.budgetBytes) {
      // One run alone is over budget: keep nothing of it.
      for (const e of fresh) this.free(e);
      return { stored: 0, dropped: fresh.length, reason: 'over_budget' };
    }
    for (const e of fresh) {
      const prev = this.entries.get(e.key);
      if (prev) { this.entries.delete(e.key); this.bytes -= prev.bytes; this.free(prev); }
    }
    while (this.bytes + need > this.budgetBytes && this.entries.size) {
      const [oldKey, old] = this.entries.entries().next().value;
      this.entries.delete(oldKey);
      this.bytes -= old.bytes;
      this.free(old);
    }
    for (const e of fresh) { this.entries.set(e.key, e); this.bytes += e.bytes; }
    return { stored: fresh.length, dropped: 0, reason: null };
  }

  /** Hand out this entry's bindings as fresh values (handles are clones). */
  restore(entry) {
    const out = {};
    for (const row of entry.names) {
      if (!row.restore) continue;
      out[row.name] = restoreValue(entry.snaps[row.name], this.handOut);
    }
    return out;
  }

  free(entry) {
    for (const h of entry.holders) { try { if (!h.isDeleted()) this.freeHandle(h); } catch { /* freed */ } }
    entry.holders = [];
  }

  clear() {
    for (const e of this.entries.values()) this.free(e);
    this.entries.clear();
    this.bytes = 0;
  }

  stats() {
    return { enabled: this.enabled, entries: this.entries.size, bytes: this.bytes, budgetBytes: this.budgetBytes, hits: this.hits, misses: this.misses };
  }
}
