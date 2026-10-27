/**
 * Every feature block a snippet or a mode writes carries an id on its
 * markers (`// --- cube begin id=cube1 ---`). Stamped face names are
 * `<block id>.<role>`, and a block with no id falls back to its position in
 * the script (`cube-1`), which an insert ahead of it renumbers; a name
 * written against that block then fails loud. Minting here keeps the name
 * stable for the life of the block.
 */
import { FEATURE_BLOCK_MARKERS } from './helperPaletteSnippets.js';
import { findFeatureBlocks, isMarkerLine, markerPrefix, markerWithId, mintBlockId } from './featureBlockId.js';

/** Raw Code blocks keep their bare markers; sheet metal is not in the list. */
const UNMINTED_KINDS = new Set(['code']);

/** Every block id already written in the script, any kind. */
export function existingBlockIds(buffer) {
  const ids = new Set();
  for (const def of FEATURE_BLOCK_MARKERS) {
    for (const block of findFeatureBlocks(buffer, def.begin, def.end)) {
      if (block.id) ids.add(block.id);
    }
  }
  return ids;
}

function markerLineKind(line, which) {
  const text = String(line || '').trim();
  for (const def of FEATURE_BLOCK_MARKERS) {
    if (UNMINTED_KINDS.has(def.kind)) continue;
    const marker = which === 'begin' ? def.begin : def.end;
    if (text === marker || isMarkerLine(text, marker)) return def;
  }
  return null;
}

function markerHasId(line, marker) {
  const text = String(line || '').trim();
  return text.startsWith(markerPrefix(marker)) && text !== marker;
}

/**
 * Give every bare begin/end marker pair in `snippet` an id unique across
 * `buffer` and the snippet itself (`cube1`, `fillet2`, `hole1`, …). Markers
 * that already carry an id, and sheet-metal / Code blocks, are left alone.
 * Lines keep their indentation.
 */
export function mintBlockIds(snippet, buffer) {
  const text = String(snippet || '');
  if (!text) return text;
  const taken = existingBlockIds(buffer);
  for (const id of existingBlockIds(text)) taken.add(id);
  const lines = text.split('\n');
  const open = [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const begin = markerLineKind(line, 'begin');
    if (begin) {
      if (markerHasId(line, begin.begin)) {
        open.push({ def: begin, id: null });
        continue;
      }
      const id = mintBlockId([...taken].map((v) => ({ id: v })), begin.kind);
      taken.add(id);
      lines[i] = line.replace(begin.begin, markerWithId(begin.begin, id));
      open.push({ def: begin, id });
      changed = true;
      continue;
    }
    const end = markerLineKind(line, 'end');
    if (end) {
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k].def.kind !== end.kind) continue;
        const [hit] = open.splice(k, 1);
        if (hit.id && !markerHasId(line, end.end)) {
          lines[i] = line.replace(end.end, markerWithId(end.end, hit.id));
          changed = true;
        }
        break;
      }
    }
  }
  return changed ? lines.join('\n') : text;
}
