/**
 * One Code feature around unmarked Manifold source so the ribbon has a chip.
 *
 * Wrap only on set/paste/Save — never on open. Opened unmarked files show a
 * virtual chip from `unmarkedCodeChip` without rewriting the stored script.
 * Any begin/end marker, including a partial pair, is left alone.
 */

import { FEATURE_MARKER_KINDS } from './featureMarkers.js';
import { markerPrefix } from './featureBlockId.js';
import {
  CODE_BEGIN,
  CODE_END,
  wrapFeatureBlock,
} from './helperPaletteSnippets.js';
import { bytesAfterHeaderLine, headerLineEnding } from './git/surfId.js';

/**
 * Split a leading `// @surf-id …` line without the mint-id regex, so UUID
 * part ids from set_script stay outside the Code block the same way
 * timestamp ids do (`normalizeAgentScript` prefix detection).
 */
function splitSurfHeaderBytes(script) {
  const text = String(script ?? '');
  if (headerLineEnding(text) == null) return { header: '', body: text };
  const body = bytesAfterHeaderLine(text);
  return { header: text.slice(0, text.length - body.length), body };
}

/** Begin/end comments, including unknown kinds (`// --- pin begin ---`). */
const GENERIC_FEATURE_MARKER = /\/\/ --- .+ (?:begin|end)(?: id=[A-Za-z_$][\w$]*)? ---/;

/** True when any feature begin/end prefix is present, complete or not. */
export function hasAnyFeatureMarker(script) {
  const text = typeof script === 'string' ? script : '';
  if (!text) return false;
  if (GENERIC_FEATURE_MARKER.test(text)) return true;
  for (const def of FEATURE_MARKER_KINDS) {
    if (text.includes(markerPrefix(def.begin)) || text.includes(markerPrefix(def.end))) {
      return true;
    }
  }
  return false;
}

export function scriptNeedsCodeWrap(script) {
  return wrapRawScript(script) !== script;
}

/**
 * Wrap unmarked source in `// --- code begin/end ---`. Surf-id stays the
 * first line. Already-marked and partially marked scripts pass through.
 */
export function wrapRawScript(script) {
  if (typeof script !== 'string') return script;
  if (hasAnyFeatureMarker(script)) return script;
  const { header, body } = splitSurfHeaderBytes(script);
  if (!body.trim()) return script;
  const lines = body.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const block = wrapFeatureBlock(CODE_BEGIN, CODE_END, lines).join('\n');
  return `${header}${block}\n`;
}

/**
 * Wrap unmarked scripts that are already in the Save set (`onlyIds`:
 * dirty or new parts). Untouched unmarked parts are left as stored.
 * Omitting `onlyIds` wraps nothing.
 */
export function wrapUnmarkedPartScripts(scripts, onlyIds) {
  if (!scripts || typeof scripts !== 'object') return {};
  const out = { ...scripts };
  if (onlyIds == null) return out;
  const allow = new Set([...onlyIds].map((id) => String(id)));
  if (allow.size === 0) return out;
  for (const [id, text] of Object.entries(out)) {
    if (!allow.has(String(id))) continue;
    if (typeof text === 'string') out[id] = wrapRawScript(text);
  }
  return out;
}

/**
 * Display-only Code chip for unmarked source. Does not rewrite the script.
 * Offsets skip a leading surf-id line so Edit script / delete leave the header.
 */
export function unmarkedCodeChip(script) {
  if (typeof script !== 'string') return null;
  if (hasAnyFeatureMarker(script)) return null;
  const { header, body } = splitSurfHeaderBytes(script);
  if (!body.trim()) return null;
  return {
    id: 'code-fallback',
    kind: 'code',
    label: 'Code',
    chipLabel: 'Code',
    startOffset: header.length,
    endOffset: script.length,
    external: false,
    separate: false,
    index: 0,
    typeIndex: 1,
    virtual: true,
  };
}

export { CODE_BEGIN, CODE_END };
