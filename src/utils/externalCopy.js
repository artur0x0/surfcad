/**
 * Cross-part geometry copies (edit-what-you-touch C).
 *
 * A tool body that lives in another part is frozen into the *target* part at
 * Accept. The source part's script text, as it was at Accept, is embedded in
 * the feature inside `externalBody(function () { … }, { bodies, offset })`.
 * `offset` is source position − target position. A rotated pose is refused:
 * externalBody stays a translation, and the confirm writes no script.
 *
 * Not associative: editing the source part later does not change the copy.
 * The copy lives inside the feature's marked block, so deleting or undoing
 * that feature deletes the copy with it. The strip chip of a feature that
 * holds a copy gets a yellow border.
 */

import { parseFeatureMarkers } from './featureMarkers.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { partPlacement } from './jointSchema.js';
import { quaternionIsIdentity } from './partPose.js';

export const EXTERNAL_BODY_ROTATION_MESSAGE = 'A rotated part cannot be copied across parts. No script is written.';

/** True when either pose is rotated. externalBody then writes nothing. */
export function externalBodyRotationBlock(source, targets) {
  const rows = [source, ...(targets || [])];
  for (const row of rows) {
    if (!row) continue;
    const q = row.placement?.q || row.quaternion || partPlacement(row).q;
    if (!quaternionIsIdentity(q)) {
      return { ok: false, message: EXTERNAL_BODY_ROTATION_MESSAGE };
    }
  }
  return { ok: true };
}

/** First line of every external copy, right after the begin marker. */
export const EXTERNAL_COPY_TAG = '// external copy';

/** Block and Shape kinds whose Subtract mode cuts every part it overlaps. */
export const CROSS_PART_SUBTRACT_KINDS = Object.freeze([
  'cube', 'roundedBox', 'cylinder', 'sphere', 'tube', 'hexPrism',
  'extrude', 'revolve', 'loft', 'sweep',
]);

export const EXTERNAL_COPY_FAILED_SOURCE = (name) => (
  `${name || 'That part'} failed its last run — fix it before copying its body.`
);

/** A feature block holds an external copy when it calls externalBody(). */
export function isExternalCopyBlock(text) {
  return /\bexternalBody\s*\(/.test(String(text || ''));
}

/** FNV-1a, 8 hex chars. Stable across sessions. */
export function hashText(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Copied text must not add chips or confuse marker scans in the target.
 * `// --- cube begin ---` becomes `// (copy) --- cube begin ---`.
 */
export function neutralizeMarkers(text) {
  return String(text || '').replace(/\/\/ --- /g, '// (copy) --- ');
}

function stripTrailingReturnPart(text) {
  return String(text || '').replace(/\n*return\s+part\s*;?\s*$/i, '').replace(/\s+$/, '');
}

function cleanName(name) {
  return String(name || 'part').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").slice(0, 80);
}

function cleanId(id) {
  return String(id == null ? '' : id).replace(/[\s\r\n]+/g, '_');
}

function formatNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Object.is(v, -0)) return '0';
  const r = Math.round(v * 1e4) / 1e4;
  if (r === 0) return '0';
  return String(r);
}

export function formatVec(arr) {
  const a = Array.isArray(arr) ? arr : [0, 0, 0];
  return `[${formatNum(a[0])}, ${formatNum(a[1])}, ${formatNum(a[2])}]`;
}

function vec3(p) {
  if (!Array.isArray(p) || p.length < 3) return [0, 0, 0];
  return [0, 1, 2].map((i) => (Number.isFinite(Number(p[i])) ? Number(p[i]) : 0));
}

/** Pose from the source frame into the target frame (translation only). */
export function partOffset(sourcePosition, targetPosition) {
  const s = vec3(sourcePosition);
  const t = vec3(targetPosition);
  return [s[0] - t[0], s[1] - t[1], s[2] - t[2]];
}

/** Comment line that tags a copy. `src` / `ref` let a re-Accept find it. */
export function externalCopyHeader({ sourceName, sourceId, ref = null }) {
  const bits = [
    `${EXTERNAL_COPY_TAG} from "${cleanName(sourceName)}"`,
    `src ${cleanId(sourceId)}`,
  ];
  if (ref) bits.push(`ref ${ref}`);
  bits.push('frozen at Accept, not linked');
  return bits.join(' · ');
}

/** Read the tag back out of a block. */
export function parseExternalCopyHeader(text) {
  const t = String(text || '');
  const i = t.indexOf(EXTERNAL_COPY_TAG);
  if (i < 0) return null;
  const line = t.slice(i, t.indexOf('\n', i) < 0 ? t.length : t.indexOf('\n', i));
  const src = /· src (\S+)/.exec(line);
  const ref = /· ref ([0-9a-f]{8})/.exec(line);
  const name = /from "([^"]*)"/.exec(line);
  return {
    sourceId: src ? src[1] : null,
    ref: ref ? ref[1] : null,
    sourceName: name ? name[1] : null,
  };
}

/**
 * `function () { … }` holding a part's whole script as it is now.
 * Its own `return part;` returns the solid from the function.
 */
export function frozenScriptFunction(script) {
  const body = neutralizeMarkers(String(script || '').replace(/\s+$/, ''));
  return `function () {\n${body}\n}`;
}

/** Feature blocks with their text, in buffer order. */
export function featureBlocks(script) {
  const text = String(script || '');
  return parseFeatureMarkers(text).map((f) => ({
    ...f,
    text: text.slice(f.startOffset, f.endOffset),
  }));
}

/**
 * Which feature blocks an Accept added and which it replaced.
 * Matching is by exact block text, so an untouched block is neither.
 */
export function diffFeatureBlocks(before, after) {
  const prev = featureBlocks(before);
  const next = featureBlocks(after);
  const pool = new Map();
  for (const b of prev) pool.set(b.text, (pool.get(b.text) || 0) + 1);
  const added = [];
  for (const b of next) {
    const n = pool.get(b.text) || 0;
    if (n > 0) pool.set(b.text, n - 1);
    else added.push(b);
  }
  const keep = new Map();
  for (const b of next) keep.set(b.text, (keep.get(b.text) || 0) + 1);
  const removed = [];
  for (const b of prev) {
    const n = keep.get(b.text) || 0;
    if (n > 0) keep.set(b.text, n - 1);
    else removed.push(b);
  }
  return { added, removed };
}

const DECL_RE = /\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g;

function declaredNames(text) {
  const out = new Set();
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(String(text || '')))) out.add(m[1]);
  return out;
}

function stripComments(text) {
  return String(text || '').replace(/\/\/[^\n]*/g, '');
}

/** Index just past the `)` that closes the `(` at `open`. -1 when unbalanced. */
function closeParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The body of a function that returns a subtract feature's cutter.
 *
 * The block's own lines stay. Its `part = part.subtract(EXPR);` becomes
 * `return EXPR;`. When those lines read `part` or a name declared earlier in
 * the source script, the earlier script is copied in front so the cutter is
 * the same solid the source part cuts with.
 */
export function subtractCutterBody(sourceScript, block) {
  const script = String(sourceScript || '');
  const text = String(block?.text || '');
  const firstNl = text.indexOf('\n');
  const lastNl = text.lastIndexOf('\n');
  if (firstNl < 0 || lastNl <= firstNl) return { ok: false, message: 'Subtract block is empty.' };
  const inner = text.slice(firstNl + 1, lastNl);
  const head = /part\s*=\s*part\.subtract\s*\(/g;
  let m;
  let last = null;
  while ((m = head.exec(inner))) last = m;
  if (!last) return { ok: false, message: 'Not a subtract feature.' };
  const open = last.index + last[0].length - 1;
  const close = closeParen(inner, open);
  if (close < 0) return { ok: false, message: 'Subtract call is not closed.' };
  const expr = inner.slice(open + 1, close - 1).trim();
  let tail = inner.slice(close).replace(/^\s*;/, '');
  const lines = `${inner.slice(0, last.index)}return ${expr};${tail}`;

  const prefix = stripTrailingReturnPart(script.slice(0, Math.max(0, block.startOffset | 0)));
  const reads = stripComments(lines.replace(/^\s*return\s+/m, ''));
  const prior = declaredNames(prefix);
  prior.add('part');
  const local = declaredNames(lines);
  let needsPrefix = false;
  for (const name of prior) {
    if (local.has(name)) continue;
    if (new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(reads)) {
      needsPrefix = true;
      break;
    }
  }
  const body = needsPrefix
    ? `${neutralizeMarkers(prefix)}\n${neutralizeMarkers(lines.replace(/\s+$/, ''))}`
    : neutralizeMarkers(lines.replace(/\s+$/, ''));
  return { ok: true, body, expr, needsPrefix };
}

/** Script for the worker probe: the cutter in the source frame. */
export function cutterProbeScript(body) {
  return `return (${`function () {\n${body}\n}`})();`;
}

function insertBeforeReturn(buffer, block) {
  return placeBlockBeforeReturn(buffer, block);
}

/** Find a copy block by its source id and ref. */
export function findExternalCopy(buffer, { sourceId, ref }) {
  if (!ref) return null;
  const sid = cleanId(sourceId);
  return featureBlocks(buffer).find((b) => {
    const tag = parseExternalCopyHeader(b.text);
    return tag && tag.ref === ref && tag.sourceId === sid;
  }) || null;
}

function replaceRange(buffer, block, text) {
  const s = String(buffer || '');
  return s.slice(0, block.startOffset) + text + s.slice(block.endOffset);
}

/** Remove a copy block (the source cutter moved off this part). */
export function removeExternalCopy(buffer, tag) {
  const hit = findExternalCopy(buffer, tag);
  if (!hit) return { ok: false, buffer: String(buffer || '') };
  let out = replaceRange(buffer, hit, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return { ok: true, buffer: out };
}

/**
 * Write the cutter of a source subtract feature into another part.
 * Same kind markers as the source, so the chip label matches ("Cube"),
 * plus the yellow-border tag. A copy with `replaceRef` (the source block
 * this Accept replaced) is replaced in place; otherwise it is appended.
 */
export function composeExternalSubtract(buffer, {
  begin,
  end,
  sourceName,
  sourceId,
  ref,
  replaceRef = null,
  body,
  offset,
}) {
  if (!begin || !end) return { ok: false, message: 'composeExternalSubtract: missing markers' };
  if (!body) return { ok: false, message: 'composeExternalSubtract: missing cutter' };
  const call = `part = part.subtract(externalBody(${frozenBody(body)}, { offset: ${formatVec(offset)} }));`;
  const block = [begin, externalCopyHeader({ sourceName, sourceId, ref }), call, end].join('\n');
  const old = replaceRef ? findExternalCopy(buffer, { sourceId, ref: replaceRef }) : null;
  const out = old ? replaceRange(buffer, old, block) : insertBeforeReturn(buffer, block);
  return { ok: true, buffer: out, replaced: !!old };
}

function frozenBody(body) {
  return `function () {\n${String(body).replace(/\s+$/, '')}\n}`;
}

/**
 * Plan a cross-part subtract after the source part's Accept.
 *
 * @param {{
 *   before: string, after: string,
 *   source: { id: string, name?: string, position?: number[] },
 *   parts: { id: string, name?: string, position?: number[], visible?: boolean, ok?: boolean, mesh?: object, script?: string }[],
 * }} args
 * @returns {null | { kind, begin, end, ref, replaceRef, body, cutterScript, candidates: { id, offset }[] }}
 */
export function planCrossPartSubtract({ before, after, source, parts, markers }) {
  const { added, removed } = diffFeatureBlocks(before, after);
  const cutters = added.filter((b) => (
    CROSS_PART_SUBTRACT_KINDS.includes(b.kind)
    && /part\s*=\s*part\.subtract\s*\(/.test(b.text)
    && !isExternalCopyBlock(b.text)
  ));
  if (cutters.length !== 1) return null;
  const block = cutters[0];
  const cutter = subtractCutterBody(after, block);
  if (!cutter.ok) return null;
  const def = (markers || []).find((k) => k.kind === block.kind);
  if (!def) return null;
  const replaced = removed.find((b) => b.kind === block.kind) || null;
  const candidates = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || part.id == null || String(part.id) === String(source?.id)) continue;
    if (part.visible === false) continue;
    if (part.ok === false) continue;
    if (typeof part.script !== 'string') continue;
    candidates.push({
      id: String(part.id),
      offset: partOffset(source?.position, part.position),
    });
  }
  return {
    kind: block.kind,
    begin: def.begin,
    end: def.end,
    ref: hashText(block.text),
    replaceRef: replaced ? hashText(replaced.text) : null,
    body: cutter.body,
    cutterScript: cutterProbeScript(cutter.body),
    candidates,
  };
}

/**
 * Each part the cutter overlaps gets the copy (one feature step there).
 * A part that held the copy this Accept replaced, and no longer overlaps,
 * loses it. Returns { id, buffer, message } per part that changes.
 */
export function crossPartSubtractWrites(plan, { source, parts, overlapIds }) {
  if (!plan) return [];
  const involved = (parts || []).filter((part) => (
    (plan.candidates || []).some((cand) => String(cand.id) === String(part?.id))
  ));
  if (!externalBodyRotationBlock(source, involved).ok) return [];
  const hit = new Set((overlapIds || []).map(String));
  const writes = [];
  for (const cand of plan.candidates) {
    const part = (parts || []).find((p) => String(p.id) === cand.id);
    if (!part || typeof part.script !== 'string') continue;
    if (hit.has(cand.id)) {
      const res = composeExternalSubtract(part.script, {
        begin: plan.begin,
        end: plan.end,
        sourceName: source?.name,
        sourceId: source?.id,
        ref: plan.ref,
        replaceRef: plan.replaceRef,
        body: plan.body,
        offset: cand.offset,
      });
      if (res.ok && res.buffer !== part.script) {
        writes.push({ id: cand.id, buffer: res.buffer, message: 'External copy' });
      }
    } else if (plan.replaceRef) {
      const res = removeExternalCopy(part.script, { sourceId: source?.id, ref: plan.replaceRef });
      if (res.ok) writes.push({ id: cand.id, buffer: res.buffer, message: 'Drop external copy' });
    }
  }
  return writes;
}
