/**
 * Feature-block identity lives on the marker, not at a character offset.
 *
 *   // --- contour-mode loft begin id=loft1 ---
 *   // --- contour-mode loft end id=loft1 ---
 *
 * A block with no id is still found. Callers that update a block pass the id.
 */

const ID = '([A-Za-z_$][\\w$]*)';

export function markerPrefix(marker) {
  const text = String(marker || '');
  return text.endsWith(' ---') ? text.slice(0, -4) : text;
}

export function markerWithId(marker, id) {
  if (!id) return String(marker || '');
  const prefix = markerPrefix(marker);
  return `${prefix} id=${id} ---`;
}

/** A whole line is this marker, with or without ` id=name`. */
export function isMarkerLine(line, marker) {
  const text = String(line || '').trim();
  const hit = markerAt(text, 0, markerPrefix(marker));
  return !!hit && hit.end === text.length;
}

function markerAt(text, index, prefix) {
  if (!text.startsWith(prefix, index)) return null;
  const after = text.slice(index + prefix.length);
  const m = after.match(new RegExp(`^(?: id=${ID})? ---`));
  if (!m) return null;
  return {
    id: m[1] || null,
    end: index + prefix.length + m[0].length,
  };
}

/**
 * Complete begin/end pairs for one marker, in source order.
 * @returns {Array<{ id: string|null, start: number, end: number, text: string }>}
 */
export function findFeatureBlocks(text, begin, end) {
  const src = String(text || '');
  const bPrefix = markerPrefix(begin);
  const ePrefix = markerPrefix(end);
  const out = [];
  let from = 0;
  while (from < src.length) {
    const i = src.indexOf(bPrefix, from);
    if (i < 0) break;
    const open = markerAt(src, i, bPrefix);
    if (!open) {
      from = i + bPrefix.length;
      continue;
    }
    const j = src.indexOf(ePrefix, open.end);
    if (j < 0) break;
    const close = markerAt(src, j, ePrefix);
    if (!close) {
      from = j + ePrefix.length;
      continue;
    }
    out.push({
      id: open.id || close.id,
      start: i,
      end: close.end,
      text: src.slice(i, close.end),
    });
    from = close.end;
  }
  return out;
}

export function countFeatureMarkers(text, marker) {
  const src = String(text || '');
  const prefix = markerPrefix(marker);
  let n = 0;
  let from = 0;
  while (from < src.length) {
    const i = src.indexOf(prefix, from);
    if (i < 0) break;
    const hit = markerAt(src, i, prefix);
    if (hit) n += 1;
    from = i + prefix.length;
  }
  return n;
}

export function featureMarkersBalanced(text, begin, end) {
  const starts = countFeatureMarkers(text, begin);
  const ends = countFeatureMarkers(text, end);
  if (starts !== ends) return false;
  return findFeatureBlocks(text, begin, end).length === starts;
}

/** Next id: loft1, loft2, … skipping ids already written on these blocks. */
export function mintBlockId(blocks, prefix) {
  const ids = new Set((blocks || []).map((b) => b.id).filter(Boolean));
  let n = 1;
  let cand = `${prefix}${n}`;
  while (ids.has(cand)) {
    n += 1;
    cand = `${prefix}${n}`;
    if (n > 10000) break;
  }
  return cand;
}

/**
 * The last complete begin…end pair for one marker, with or without ids.
 * `start` is the begin marker's offset, `endMarkerStart` the end marker's,
 * `end` the offset just past the end marker. Null when there is none.
 */
export function lastFeatureBlock(text, begin, end) {
  const blocks = findFeatureBlocks(text, begin, end);
  if (!blocks.length) return null;
  const last = blocks[blocks.length - 1];
  const ePrefix = markerPrefix(end);
  const endMarkerStart = String(text || '').lastIndexOf(ePrefix, last.end);
  return { ...last, endMarkerStart };
}

/** True when the text holds at least one complete pair for this marker. */
export function hasFeatureBlock(text, begin, end) {
  return findFeatureBlocks(text, begin, end).length > 0;
}
