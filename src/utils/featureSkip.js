/**
 * Evaluation copy for a failed feature and for the rollback bar.
 *
 * The buffer, undo commits, and saved script stay as written. This module
 * returns a throwaway string: skipped block interiors are blank, and a
 * rollback anchor blanks every statement after that feature except the
 * trailing `return part`. Marker comments stay, and newlines stay, so
 * feature ids and line numbers do not move. That is the same effect as
 * commenting the statements out. `part` keeps the previous live assignment.
 *
 * Do not call `scriptWithFeatureCount`. That helper deletes later blocks
 * for the undo seed.
 */
import { parseFeatureMarkers } from './featureMarkers.js';
import { featureDependents } from './featureEdit.js';

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
 * `skipIds` blanks those block interiors. `anchorId` is the feature the
 * rollback bar sits after: a string blanks every statement after it, `null`
 * blanks from the start of the script, and an unknown id blanks no tail.
 * Omit `anchorId` when the bar is at the end. The trailing `return part;`
 * stays. The input string is not modified.
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
  if (opts.anchorId === null || typeof opts.anchorId === 'string') {
    let from = null;
    if (opts.anchorId === null) from = 0;
    else {
      const anchor = features.find((feature) => feature.id === opts.anchorId);
      if (anchor) from = anchor.endOffset;
    }
    if (from != null) ranges.push(...statementRanges(text, from));
  }
  const keep = trailingReturnRange(text);
  const cut = keep ? ranges.flatMap((range) => subtractRange(range, keep)) : ranges;
  const merged = mergeRanges(cut);
  if (!merged.length) return text;
  let out = text;
  for (let i = merged.length - 1; i >= 0; i -= 1) {
    const [start, end] = merged[i];
    out = `${out.slice(0, start)}${out.slice(start, end).replace(/[^\n\r]/g, '')}${out.slice(end)}`;
  }
  return out === text ? text : out;
}

/**
 * Gap the rollback bar occupies. `0` is before every feature, `ids.length`
 * is after the last one. A missing anchor sits at the end.
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
