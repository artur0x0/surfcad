/**
 * Evaluation copy for a failed feature and for the rollback bar.
 *
 * The buffer, undo commits, and saved script stay as written. This module
 * returns a throwaway string: skipped block interiors are blank, and a
 * rollback anchor blanks every statement after that feature except the
 * trailing `return part`, unless that copy no longer declares `part`.
 * Marker comments stay, and newlines stay, so
 * feature ids and line numbers do not move. That is the same effect as
 * commenting the statements out. `part` keeps the previous live assignment.
 *
 * Do not call `scriptWithFeatureCount`. That helper deletes later blocks
 * for the undo seed.
 */
import { parseFeatureMarkers } from './featureMarkers.js';
import { featureDependents } from './featureEdit.js';
import { declaredNames, insertBlockAtCaret } from './helperPaletteSnippets.js';
import { contourStatements } from './namedContour.js';
import { featureStripChips } from './sheetMetal/sheetRibbon.js';
import { readSheetMetalSpec } from './sheetMetal/sheetMetalScript.js';
import {
  findReturnPartIndex,
  joinScriptReturn,
  splitScriptReturn,
} from './scriptReturn.js';

const REF_KEY = /refKey\s*:\s*(['"`])([^'"`]*)\1/g;

function blockText(script, feature) {
  return script.slice(feature.startOffset, feature.endOffset);
}

function quoted(block, key) {
  return block.includes(`'${key}'`) || block.includes(`"${key}"`) || block.includes(`\`${key}\``);
}

function refKeysOf(block) {
  const keys = [];
  REF_KEY.lastIndex = 0;
  let match = REF_KEY.exec(block);
  while (match) {
    if (match[2]) keys.push(match[2]);
    match = REF_KEY.exec(block);
  }
  return keys;
}

function variableDependentIds(script, feature) {
  const ids = [];
  for (const dep of featureDependents(script, feature)) {
    if (dep.reason === 'variable' && dep.id && !ids.includes(dep.id)) ids.push(dep.id);
  }
  return ids;
}

/**
 * True when one of this block's `refKey:` values is quoted only in blocks
 * that are already skipped. An earlier block still outside the skip set
 * keeps the key alive.
 */
function refKeyDepends(script, features, feature, skipped) {
  const keys = refKeysOf(blockText(script, feature));
  if (!keys.length) return false;
  const earlier = features.filter((item) => item.endOffset <= feature.startOffset);
  for (const key of keys) {
    const holders = earlier.filter((item) => quoted(blockText(script, item), key));
    if (!holders.length) continue;
    if (holders.every((item) => skipped.has(item.id))) return true;
  }
  return false;
}

/**
 * The failed feature and its transitive hard dependents, in script order.
 *
 * A hard dependent is a later block that uses a `const` / `let` / `var`
 * this block declares, other than `part` (`featureDependents` reason
 * `variable`, including a contour name), or a later block whose `refKey:`
 * is quoted in a skipped block and in no earlier block outside the skip
 * set. Reading or writing `part` is not a hard edge. Edge and face
 * dependents are not included: they still run, and a throw there is a new
 * failure.
 *
 * @param {string} script
 * @param {string} featureId
 * @returns {string[]}
 */
export function hardSkipIds(script, featureId) {
  const text = typeof script === 'string' ? script : '';
  if (typeof featureId !== 'string' || !featureId) return [];
  const features = parseFeatureMarkers(text);
  if (!features.some((feature) => feature.id === featureId)) return [];
  const skipped = new Set([featureId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const feature of features) {
      if (!skipped.has(feature.id)) continue;
      for (const id of variableDependentIds(text, feature)) {
        if (skipped.has(id)) continue;
        skipped.add(id);
        grew = true;
      }
    }
    for (const feature of features) {
      if (skipped.has(feature.id)) continue;
      if (!refKeyDepends(text, features, feature, skipped)) continue;
      skipped.add(feature.id);
      grew = true;
    }
  }
  return features.filter((feature) => skipped.has(feature.id)).map((feature) => feature.id);
}

function endOfMarker(text, at) {
  const lineEnd = text.indexOf('\n', at);
  const stop = lineEnd < 0 ? text.length : lineEnd;
  const match = text.slice(at, stop).match(/---[ \t]*$/);
  if (!match) return stop;
  return at + match.index + 3;
}

/** Interior between the begin marker and the end-marker line, or null. */
function blockInterior(text, feature) {
  const beginEnd = endOfMarker(text, feature.startOffset);
  const endLine = text.lastIndexOf('\n', Math.max(feature.endOffset - 1, 0)) + 1;
  if (endLine <= beginEnd) return null;
  return [beginEnd, endLine];
}

function statementRanges(text, from) {
  const ranges = [];
  let lineStart = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i !== text.length && text[i] !== '\n') continue;
    let contentEnd = i;
    if (text[contentEnd - 1] === '\r') contentEnd -= 1;
    const sliceFrom = Math.max(lineStart, from);
    if (sliceFrom < contentEnd) {
      const body = text.slice(sliceFrom, contentEnd).trim();
      if (body && !body.startsWith('//')) ranges.push([sliceFrom, contentEnd]);
    }
    if (i === text.length) break;
    lineStart = i + 1;
  }
  return ranges;
}

function blankTrailingReturn(text) {
  const keep = trailingReturnRange(text);
  if (!keep) return text;
  const [start, end] = keep;
  return `${text.slice(0, start)}${text.slice(start, end).replace(/[^\n\r]/g, '')}${text.slice(end)}`;
}

function trailingReturnRange(text) {
  const re = /^[ \t]*return\s+part\s*;[ \t]*$/gm;
  let last = null;
  let match = re.exec(text);
  while (match) {
    last = match;
    match = re.exec(text);
  }
  if (!last) return null;
  let end = last.index + last[0].length;
  if (text[end] === '\r') end += 1;
  if (text[end] === '\n') end += 1;
  return [last.index, end];
}

function subtractRange(range, keep) {
  const [start, end] = range;
  const [keepStart, keepEnd] = keep;
  if (end <= keepStart || start >= keepEnd) return [range];
  const out = [];
  if (start < keepStart) out.push([start, keepStart]);
  if (keepEnd < end) out.push([keepEnd, end]);
  return out;
}

function mergeRanges(ranges) {
  const sorted = ranges.filter((range) => range[1] > range[0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

/**
 * Throwaway evaluation copy.
 *
 * `skipIds` blanks those block interiors. `anchorId` is the feature or
 * contour the rollback bar sits after: a feature id blanks every statement
 * after it, a contour id blanks every statement after that contour
 * statement, `null` blanks from the start of the script, and an unknown id
 * blanks no tail.
 * A sheet chip keeps that block through the chip (later bends, tabs, and
 * their holes drop out of `sheetSpec`) and blanks from the end of the block.
 * Omit `anchorId` when the bar is at the end. The trailing `return part;`
 * stays unless the copy no longer declares `part`. The input string is not modified.
 *
 * @param {string} script
 * @param {{ skipIds?: string[], anchorId?: string|null }} [options]
 * @returns {string}
 */
export function evaluationScript(script, options = {}) {
  const text = typeof script === 'string' ? script : '';
  const opts = options && typeof options === 'object' ? options : {};
  const skipIds = new Set(Array.isArray(opts.skipIds) ? opts.skipIds.filter((id) => typeof id === 'string') : []);
  const features = parseFeatureMarkers(text);
  const ranges = [];
  for (const feature of features) {
    if (!skipIds.has(feature.id)) continue;
    const interior = blockInterior(text, feature);
    if (interior) ranges.push(interior);
  }
  let applied = false;
  if (opts.anchorId === null || typeof opts.anchorId === 'string') {
    let from = null;
    if (opts.anchorId === null) from = 0;
    else {
      const anchor = features.find((feature) => feature.id === opts.anchorId);
      if (anchor) from = anchor.endOffset;
      else {
        const chip = sheetAnchor(text, opts.anchorId);
        if (chip && Number.isFinite(chip.endOffset)) from = chip.endOffset;
        else {
          const contour = contourAnchor(text, opts.anchorId);
          if (contour && Number.isFinite(contour.endOffset)) from = contour.endOffset;
        }
      }
    }
    if (from != null) {
      applied = true;
      ranges.push(...statementRanges(text, from));
    }
  }
  const keep = trailingReturnRange(text);
  const cut = keep ? ranges.flatMap((range) => subtractRange(range, keep)) : ranges;
  const merged = mergeRanges(cut);
  let out = text;
  if (merged.length) {
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      const [start, end] = merged[i];
      out = `${out.slice(0, start)}${out.slice(start, end).replace(/[^\n\r]/g, '')}${out.slice(end)}`;
    }
  }
  out = applySheetAnchorTrim(out, text, opts.anchorId);
  // Blanking from the start removes `let part` and used to leave
  // `return part;`. The worker then throws "Can't find variable: part".
  // Drop that return when the copy no longer declares part. Line count stays.
  if (applied && !declaredNames(out).has('part')) out = blankTrailingReturn(out);
  return out === text ? text : out;
}

/**
 * The rollback copy has no `part` to return. The viewport clears the solid
 * instead of running the worker. `null` is the start. A feature id is the
 * bar after that feature. Omitted, or the end, is false.
 * @param {string} script
 * @param {string|null|undefined} anchor
 */
export function rollbackClearsPart(script, anchor) {
  if (anchor !== null && typeof anchor !== 'string') return false;
  return !declaredNames(evaluationScript(script, { anchorId: anchor })).has('part');
}

/**
 * Gap the rollback bar occupies. `0` is before every feature, `ids.length`
 * is after the last one. A missing anchor sits at the end, never at the start.
 * An empty list's only index is 0; that is the end until the anchor is `null`.
 * @param {string[]} ids
 * @param {string|null|undefined} anchor
 */
export function rollbackGapIndex(ids, anchor) {
  const list = Array.isArray(ids) ? ids : [];
  if (anchor === null) return 0;
  if (typeof anchor !== 'string') return list.length;
  const at = list.indexOf(anchor);
  return at < 0 ? list.length : at + 1;
}

/**
 * One reading of the rollback bar for the strip and for evaluation.
 * `null` is the start and skips every feature. A known id skips the tail
 * after that feature. A missing id, or no anchor, is the end and skips
 * nothing — it is not the start. Callers must use this anchor, not a second
 * guess from the gap index: index 0 is the start only when the anchor is `null`.
 * @param {string} script
 * @param {string|null|undefined} anchor
 * @returns {{ anchor: string|null|undefined, index: number, skipIds: string[], ids: string[] }}
 */
export function resolveRollback(script, anchor) {
  const text = typeof script === 'string' ? script : '';
  const markerIds = featureIds(text);
  const chips = featureStripChips(text);
  const ids = chips.map((chip) => chip.id);
  const known = new Set(markerIds);
  for (const chip of chips) {
    if (chip.sheet || chip.kind === 'contour') known.add(chip.id);
  }
  let resolved;
  if (anchor === null) resolved = null;
  else if (typeof anchor === 'string' && known.has(anchor)) resolved = anchor;
  else resolved = undefined;
  return {
    anchor: resolved,
    index: rollbackGapIndex(ids, resolved),
    skipIds: rolledBackFeatureIds(text, resolved),
    ids,
  };
}

/**
 * Feature the bar sits after. `null` is before everything. `undefined` is
 * the gap after the last feature (no skip).
 * @param {string[]} ids
 * @param {number} index
 * @returns {string|null|undefined}
 */
export function rollbackAnchorAtGap(ids, index) {
  const list = Array.isArray(ids) ? ids : [];
  const at = Number(index);
  if (!Number.isFinite(at) || at <= 0) return null;
  if (at >= list.length) return undefined;
  return list[at - 1];
}

function featureIds(script) {
  return parseFeatureMarkers(script).map((feature) => feature.id);
}

/** A sheet chip id, when it is not also a marker id. */
function sheetAnchor(script, anchor) {
  if (typeof anchor !== 'string') return null;
  if (featureIds(script).includes(anchor)) return null;
  const chip = featureStripChips(script).find((item) => item.sheet && item.id === anchor);
  return chip || null;
}

/**
 * A contour chip id (`contour:<id>`), when that statement is still in the script.
 * The statement stays live. Features that start after it are the rolled-back tail.
 */
function contourAnchor(script, anchor) {
  if (typeof anchor !== 'string' || !anchor.startsWith('contour:')) return null;
  const id = anchor.slice('contour:'.length);
  if (!id) return null;
  const stmt = contourStatements(script).find((row) => row.id === id);
  if (!stmt || !Number.isFinite(stmt.end)) return null;
  return { id: anchor, startOffset: stmt.start, endOffset: stmt.end };
}

function markerIndexForAnchor(features, script, anchor) {
  if (anchor === null) return -1;
  if (typeof anchor !== 'string') return null;
  const direct = features.findIndex((feature) => feature.id === anchor);
  if (direct >= 0) return direct;
  const chip = sheetAnchor(script, anchor);
  if (chip?.markerId) {
    const host = features.findIndex((feature) => feature.id === chip.markerId);
    return host >= 0 ? host : null;
  }
  const contour = contourAnchor(script, anchor);
  if (!contour) return null;
  let last = -1;
  for (let i = 0; i < features.length; i += 1) {
    if (features[i].endOffset <= contour.endOffset) last = i;
  }
  return last;
}

function trimSheetSpec(spec, keptChips) {
  const bends = new Set();
  const tabs = new Set();
  for (const chip of keptChips) {
    if (chip.sheetKind === 'bend') {
      for (const id of chip.memberIds || []) bends.add(String(id));
    }
    if (chip.sheetKind === 'tab') {
      for (const id of chip.memberIds || []) tabs.add(String(id));
    }
  }
  const panels = new Set(['base', ...bends]);
  return {
    ...spec,
    bends: (spec.bends || []).filter((row) => bends.has(String(row?.id))),
    tabs: (spec.tabs || []).filter((row) => tabs.has(String(row?.id))),
    holes: (spec.holes || []).filter((row) => panels.has(String(row?.panel || 'base'))),
  };
}

/** Keep the sheet spec through the chip the bar sits on. Later features are already blank. */
function applySheetAnchorTrim(blanked, original, anchorId) {
  const chip = sheetAnchor(original, anchorId);
  if (!chip?.markerId || !Number.isFinite(chip.endOffset)) return blanked;
  const marker = parseFeatureMarkers(original).find((feature) => feature.id === chip.markerId);
  if (!marker) return blanked;
  const spec = readSheetMetalSpec(original.slice(marker.startOffset, marker.endOffset));
  if (!spec) return blanked;
  const group = featureStripChips(original).filter((item) => item.sheet && item.markerId === chip.markerId);
  const at = group.findIndex((item) => item.id === chip.id);
  if (at < 0) return blanked;
  const next = trimSheetSpec(spec, group.slice(0, at + 1));
  const needle = `const sheetSpec = ${JSON.stringify(spec)};`;
  const replacement = `const sheetSpec = ${JSON.stringify(next)};`;
  if (needle === replacement) return blanked;
  const i = blanked.indexOf(needle);
  if (i < 0) return blanked;
  return `${blanked.slice(0, i)}${replacement}${blanked.slice(i + needle.length)}`;
}

/**
 * Caret for a palette insert while the bar is set. `null` anchor is the
 * start of the buffer. A feature id is that block's end. Omitted, or an
 * id that is no longer in the script, appends (compose treats null as the end).
 * @param {string} script
 * @param {string|null|undefined} anchor
 * @returns {number|null}
 */
export function rollbackInsertCaret(script, anchor) {
  if (anchor === null) return 0;
  if (typeof anchor !== 'string') return null;
  const feature = parseFeatureMarkers(script).find((item) => item.id === anchor);
  if (feature) return feature.endOffset;
  const chip = sheetAnchor(script, anchor);
  if (chip && Number.isFinite(chip.endOffset)) return chip.endOffset;
  const contour = contourAnchor(script, anchor);
  return contour ? contour.endOffset : null;
}

/**
 * Keep the bar when its feature is still in the script. `null` stays before
 * everything. A missing id snaps to the end. Callers that must remember a
 * stale id (undo, redo, delete) do not use this: they keep the stored id
 * and let `resolveRollback` draw that miss as the end.
 * @param {string} script
 * @param {string|null|undefined} anchor
 * @returns {string|null|undefined}
 */
export function clampRollbackAnchor(script, anchor) {
  if (anchor === null) return null;
  if (typeof anchor !== 'string') return undefined;
  if (featureIds(script).includes(anchor)) return anchor;
  if (sheetAnchor(script, anchor)) return anchor;
  return contourAnchor(script, anchor) ? anchor : undefined;
}

function blockBody(script, feature) {
  return script.slice(feature.startOffset, feature.endOffset);
}

/**
 * Blocks whose text changed, between the unchanged prefix and suffix.
 * @param {string} beforeScript
 * @param {string} afterScript
 */
export function changedFeatureSlice(beforeScript, afterScript) {
  const before = parseFeatureMarkers(beforeScript);
  const after = parseFeatureMarkers(afterScript);
  let prefix = 0;
  while (
    prefix < before.length
    && prefix < after.length
    && before[prefix].kind === after[prefix].kind
    && blockBody(beforeScript, before[prefix]) === blockBody(afterScript, after[prefix])
  ) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix].kind === after[after.length - 1 - suffix].kind
    && blockBody(beforeScript, before[before.length - 1 - suffix]) === blockBody(afterScript, after[after.length - 1 - suffix])
  ) suffix += 1;
  return after.slice(prefix, after.length - suffix);
}

/**
 * The block an insert added, matched by the unchanged blocks on either side.
 * @param {string} beforeScript
 * @param {string} afterScript
 */
export function insertedFeature(beforeScript, afterScript) {
  const added = changedFeatureSlice(beforeScript, afterScript);
  return added.length ? added[0] : null;
}

/**
 * Features the rollback bar blanks. `null` is every feature. An unknown
 * anchor blanks nothing. Omit the anchor when the bar is at the end.
 * @param {string} script
 * @param {string|null|undefined} anchorId
 * @returns {string[]}
 */
export function rolledBackFeatureIds(script, anchorId) {
  const text = typeof script === 'string' ? script : '';
  const features = parseFeatureMarkers(text);
  if (anchorId === null) return features.map((feature) => feature.id);
  if (typeof anchorId !== 'string') return [];
  const at = features.findIndex((feature) => feature.id === anchorId);
  if (at >= 0) return features.slice(at + 1).map((feature) => feature.id);
  const chip = sheetAnchor(text, anchorId);
  if (chip?.markerId) {
    const host = features.findIndex((feature) => feature.id === chip.markerId);
    if (host < 0) return [];
    return features.slice(host + 1).map((feature) => feature.id);
  }
  const contour = contourAnchor(text, anchorId);
  if (!contour) return [];
  return features
    .filter((feature) => feature.startOffset >= contour.endOffset)
    .map((feature) => feature.id);
}

function explicitMarkerId(script, feature) {
  const lineEnd = script.indexOf('\n', feature.startOffset);
  const line = script.slice(feature.startOffset, lineEnd < 0 ? feature.endOffset : lineEnd);
  return / id=[A-Za-z_$][\w$]* ---/.test(line);
}

function mintFeatureId(script, prefix) {
  const used = new Set(parseFeatureMarkers(script).map((feature) => feature.id));
  let n = 1;
  let cand = `${prefix}${n}`;
  while (used.has(cand)) {
    n += 1;
    cand = `${prefix}${n}`;
    if (n > 10000) break;
  }
  return cand;
}

/** Write `id=` on a block that only had a positional chip id, so the id survives a later insert. */
function stampFeatureId(script, feature, id) {
  if (!feature || explicitMarkerId(script, feature)) return script;
  const beginEnd = script.indexOf('\n', feature.startOffset);
  const beginStop = beginEnd < 0 ? feature.endOffset : beginEnd;
  const endStart = script.lastIndexOf('\n', Math.max(feature.endOffset - 1, 0)) + 1;
  const beginLine = script.slice(feature.startOffset, beginStop);
  const endLine = script.slice(endStart, feature.endOffset);
  if (/ id=/.test(beginLine) || / id=/.test(endLine)) return script;
  const nextBegin = beginLine.replace(/ ---$/, ` id=${id} ---`);
  const nextEnd = endLine.replace(/ ---$/, ` id=${id} ---`);
  if (nextBegin === beginLine || nextEnd === endLine) return script;
  return `${script.slice(0, feature.startOffset)}${nextBegin}${script.slice(beginStop, endStart)}${nextEnd}${script.slice(feature.endOffset)}`;
}

function stampLanded(buffer, featureId) {
  const feature = parseFeatureMarkers(buffer).find((item) => item.id === featureId);
  if (!feature || explicitMarkerId(buffer, feature)) return { buffer, id: featureId };
  const id = mintFeatureId(buffer, feature.kind || 'feature');
  const next = stampFeatureId(buffer, feature, id);
  const placed = parseFeatureMarkers(next).find((item) => item.id === id);
  return { buffer: next, id: placed?.id || featureId };
}

/**
 * The same block after a rewrite that changed its positional id.
 * An id that still exists but now labels a different block follows the
 * original body. A missing block is the end, not the start.
 * @returns {string|null|undefined}
 */
function reboundAnchor(beforeScript, afterScript, anchor) {
  if (anchor === null) return null;
  if (typeof anchor !== 'string') return undefined;
  if (sheetAnchor(beforeScript, anchor)) {
    return sheetAnchor(afterScript, anchor) ? anchor : undefined;
  }
  if (contourAnchor(beforeScript, anchor)) {
    return contourAnchor(afterScript, anchor) ? anchor : undefined;
  }
  const before = parseFeatureMarkers(beforeScript);
  const after = parseFeatureMarkers(afterScript);
  const host = before.find((feature) => feature.id === anchor);
  if (!host) return after.some((feature) => feature.id === anchor) ? anchor : undefined;
  const body = blockBody(beforeScript, host);
  const same = after.find((feature) => (
    feature.kind === host.kind && blockBody(afterScript, feature) === body
  ));
  if (same) return same.id;
  return after.some((feature) => feature.id === anchor) ? anchor : undefined;
}

function withStampedAnchor(buffer, featureId) {
  if (typeof featureId !== 'string' || !featureId) {
    return { buffer, anchor: featureId === null ? null : undefined };
  }
  const stamped = stampLanded(buffer, featureId);
  return { buffer: stamped.buffer, anchor: stamped.id };
}

/**
 * Place new feature blocks at the rollback bar, the way a palette insert does.
 * An Accept that appended past the bar is cut out and spliced at the caret.
 * A block that is already in that gap stays. An edit of an existing block
 * does not move, and the bar stays. The bar then sits on the new feature.
 * A missing anchor is the end: fresh blocks are not pulled to the start.
 * @param {string} beforeScript
 * @param {string} afterScript
 * @param {string|null|undefined} anchor
 * @returns {{ buffer: string, anchor: string|null|undefined }}
 */
export function commitScriptAtRollback(beforeScript, afterScript, anchor) {
  const after = typeof afterScript === 'string' ? afterScript : '';
  const bound = reboundAnchor(beforeScript, after, anchor);
  if (bound !== null && typeof bound !== 'string') {
    return { buffer: after, anchor: undefined };
  }
  anchor = bound;
  const beforeIds = new Set(parseFeatureMarkers(beforeScript).map((feature) => feature.id));
  const fresh = changedFeatureSlice(beforeScript, after).filter((feature) => (
    feature.id && !beforeIds.has(feature.id)
  ));
  if (!fresh.length) {
    return { buffer: after, anchor: clampRollbackAnchor(after, anchor) };
  }
  const features = parseFeatureMarkers(after);
  const anchorIndex = markerIndexForAnchor(features, after, anchor);
  if (anchorIndex == null) {
    return { buffer: after, anchor: clampRollbackAnchor(after, anchor) };
  }
  const freshIds = new Set(fresh.map((feature) => feature.id));
  const tailFresh = features.filter((feature) => {
    if (!freshIds.has(feature.id)) return false;
    const idx = features.findIndex((item) => item.id === feature.id);
    return idx > anchorIndex;
  });
  if (!tailFresh.length) {
    return { buffer: after, anchor: clampRollbackAnchor(after, anchor) };
  }
  const packed = tailFresh.every((feature, i) => {
    const idx = features.findIndex((item) => item.id === feature.id);
    return idx === anchorIndex + 1 + i;
  });
  const lastId = tailFresh[tailFresh.length - 1].id;
  if (packed) return withStampedAnchor(after, lastId);

  const chunks = tailFresh.map((feature) => (
    after.slice(feature.startOffset, feature.endOffset).replace(/^\n+|\s+$/g, '')
  ));
  let rest = after;
  for (let i = tailFresh.length - 1; i >= 0; i -= 1) {
    const feature = tailFresh[i];
    let cutStart = feature.startOffset;
    let cutEnd = feature.endOffset;
    if (rest[cutEnd] === '\n') cutEnd += 1;
    else if (cutStart > 0 && rest[cutStart - 1] === '\n') cutStart -= 1;
    rest = `${rest.slice(0, cutStart)}${rest.slice(cutEnd)}`;
  }
  const caret = rollbackInsertCaret(rest, anchor);
  if (typeof caret !== 'number') {
    return { buffer: after, anchor: clampRollbackAnchor(after, anchor) };
  }
  const buffer = insertBlockAtCaret(rest, chunks.join('\n'), caret);
  // A marker without an id is named from its place in the strip, so the
  // name can change when the block moves. Read it from the placed script.
  const norm = (text) => text.replace(/\s+/g, ' ').trim();
  const want = new Set(chunks.map(norm));
  const placed = parseFeatureMarkers(buffer).filter((feature) => (
    want.has(norm(buffer.slice(feature.startOffset, feature.endOffset)))
  ));
  const landed = placed.length ? placed[placed.length - 1].id : lastId;
  return withStampedAnchor(buffer, landed || lastId);
}

/**
 * After a palette insert at the bar, the bar sits on the new feature so that
 * card stays live and the old tail stays dim. The end of the strip (no
 * anchor) stays at the end.
 * @param {string} beforeScript
 * @param {string} afterScript
 * @param {string|null|undefined} anchor
 */
export function rollbackAnchorAfterInsert(beforeScript, afterScript, anchor) {
  if (anchor !== null && typeof anchor !== 'string') return undefined;
  const added = insertedFeature(beforeScript, afterScript);
  if (added?.id) return added.id;
  return clampRollbackAnchor(afterScript, anchor);
}

/** File open and reload drop the in-memory bar. Nothing is written to the file. */
export function rollbackAnchorsAfterOpen() {
  return {};
}

/**
 * Feature blocks that start after the script's `return part;`.
 * The strip still lists them. The worker never runs them.
 * @param {string} script
 * @returns {Array<{ id: string, kind: string, startOffset: number, endOffset: number }>}
 */
export function featureBlocksAfterReturn(script) {
  const text = typeof script === 'string' ? script : '';
  const at = findReturnPartIndex(text);
  if (at < 0) return [];
  return parseFeatureMarkers(text).filter((feature) => feature.startOffset >= at);
}

/**
 * Move feature blocks that sit after `return part;` to just before it,
 * and drop every extra top-level return. The study comment stays after
 * the one return. A script that is already in that shape is returned
 * unchanged.
 * @param {string} script
 * @returns {{ buffer: string, moved: string[], changed: boolean }}
 */
export function repairScriptReturns(script) {
  const text = typeof script === 'string' ? script : '';
  const dead = featureBlocksAfterReturn(text);
  const splitOnce = splitScriptReturn(text);
  const tailHasReturn = splitOnce.returnAt >= 0 && findReturnPartIndex(splitOnce.tail) >= 0;
  if (!dead.length && !tailHasReturn) {
    return { buffer: text, moved: [], changed: false };
  }
  let rest = text;
  for (let i = dead.length - 1; i >= 0; i -= 1) {
    const feature = dead[i];
    let cutStart = feature.startOffset;
    let cutEnd = feature.endOffset;
    if (rest[cutEnd] === '\n') cutEnd += 1;
    else if (cutStart > 0 && rest[cutStart - 1] === '\n') cutStart -= 1;
    rest = `${rest.slice(0, cutStart)}${rest.slice(cutEnd)}`;
  }
  const split = splitScriptReturn(rest);
  const chunks = dead.map((feature) => (
    text.slice(feature.startOffset, feature.endOffset).replace(/^\n+|\s+$/g, '')
  ));
  const nextHead = chunks.length
    ? (split.head ? `${split.head}\n${chunks.join('\n')}` : chunks.join('\n'))
    : split.head;
  const buffer = joinScriptReturn(nextHead, split.tail);
  return {
    buffer,
    moved: dead.map((feature) => feature.id),
    changed: buffer !== text,
  };
}
