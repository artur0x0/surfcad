/**
 * Sheet-metal script block. The part script stays the source of truth:
 * one marked block holds the sheet spec (JSON) and builds the solid.
 */
import { starterCubeScript } from '../helperPaletteSnippets.js';
import { insertChunkBeforeReturn } from '../scriptReturn.js';
import { createSheetSpec } from './sheetModel.js';
import { defaultBaseDims } from './sheetMetalMode.js';
import {
  SHEET_METAL_BEGIN,
  SHEET_METAL_END,
  hasSheetMetalBlock,
} from './sheetMeshFlag.js';

export { SHEET_METAL_BEGIN, SHEET_METAL_END, hasSheetMetalBlock };

/**
 * May Start designing replace this buffer with the base-flange starter?
 * Empty, comments-only, a bare `return part;`, or the auto-dropped 20 mm
 * cube. The demo script and any other part that already has features are
 * not fresh — Accept appends a block onto them.
 */
export function sheetMetalFresh(script) {
  const s = String(script ?? '').trim();
  if (!s) return true;
  // Older parts still carry the 20 mm starter cube; those are fresh too.
  if (s === starterCubeScript().trim()) return true;
  const body = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\breturn\s+part\s*;?/g, '')
    .trim();
  return body.length === 0;
}

/**
 * Can sheet-metal mode write into this part in place?
 * Fresh buffers and an existing sheet block are rewritten. A part with
 * other features is still written in place (the block is appended); it is
 * not fresh, so Start does not replace the script and does not spawn a part.
 */
export function sheetMetalReady(script) {
  const s = String(script ?? '').trim();
  if (!s) return true;
  if (hasSheetMetalBlock(s)) return true;
  return sheetMetalFresh(s);
}

const SPEC_LINE = /const sheetSpec\s*=\s*(\{.*\});/;

/**
 * Script for Start designing. A default base flange (Top plane, SKU
 * thickness, 100×60 mm raised to the SKU minimums) replaces the auto-dropped
 * cube. Null when the record has no SKU.
 */
export function sheetStarterScript(record) {
  if (!record?.sku) return null;
  const spec = createSheetSpec(record, 'XY', defaultBaseDims(record));
  const res = composeSheetMetalCommit('', spec);
  if (!res.ok) return null;
  return { script: res.buffer, spec };
}

/**
 * Block text for a spec (one JSON line so diffs stay one-line per edit).
 * `union` adds the flange onto a part that already has a solid. The
 * sheet-only form declares `part`.
 */
export function sheetMetalBlock(spec, { union = false } = {}) {
  const label = [spec.material, spec.sku].filter(Boolean).join(' · ');
  const assign = union
    ? 'part = part.add(sheetMetalSolid(sheetSpec));'
    : 'let part = sheetMetalSolid(sheetSpec);';
  return [
    SHEET_METAL_BEGIN,
    `// SendCutSend ${label} — edit in Sheet Metal mode`,
    `const sheetSpec = ${JSON.stringify(spec)};`,
    assign,
    SHEET_METAL_END,
  ].join('\n');
}

function blockUnions(text) {
  return /part\s*=\s*part\.add\(\s*sheetMetalSolid\s*\(/.test(String(text || ''));
}

/** Code outside the sheet block other than comments and `return part;`. */
function outsideHasWork(script, start, end) {
  const rest = `${script.slice(0, start)}\n${script.slice(end)}`;
  return rest
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\breturn\s+part\s*;?/g, '')
    .trim().length > 0;
}

/** Insert `block` before the script return. A study after that return stays there. */
function appendSheetBlock(buffer, block) {
  return insertChunkBeforeReturn(buffer, block);
}

/** Parse the spec back out of a script (null when absent / unreadable). */
export function readSheetMetalSpec(script) {
  const s = String(script || '');
  const i = s.indexOf(SHEET_METAL_BEGIN);
  if (i < 0) return null;
  const j = s.indexOf(SHEET_METAL_END, i);
  if (j < 0) return null;
  const m = s.slice(i, j).match(SPEC_LINE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** The block assigns `part` but does not return it. One trailing return does. */
function withSheetReturn(buffer) {
  const s = String(buffer ?? '');
  if (/\breturn\s+part\b/.test(s)) return s.endsWith('\n') ? s : `${s}\n`;
  return `${s.replace(/\s*$/, '')}\nreturn part;\n`;
}

/**
 * Write the spec into a buffer: replace the existing block, take over a
 * fresh buffer (empty / starter cube), or append after earlier feature
 * blocks. Appending unions the flange onto `part` so those blocks stay
 * byte-identical and the solid keeps their geometry.
 */
export function composeSheetMetalCommit(buffer, spec) {
  const s = String(buffer ?? '');
  let next;
  if (hasSheetMetalBlock(s)) {
    const i = s.indexOf(SHEET_METAL_BEGIN);
    const j = s.indexOf(SHEET_METAL_END, i) + SHEET_METAL_END.length;
    const union = blockUnions(s.slice(i, j)) || outsideHasWork(s, i, j);
    next = `${s.slice(0, i)}${sheetMetalBlock(spec, { union })}${s.slice(j)}`;
  } else if (sheetMetalFresh(s)) {
    next = `${sheetMetalBlock(spec)}\n`;
  } else {
    next = appendSheetBlock(s, sheetMetalBlock(spec, { union: true }));
  }
  // The return stays outside the markers so a later edit of the block keeps it,
  // and so code after the block still runs. Goldens that only exec the block
  // append their own `return part;`.
  return { ok: true, buffer: withSheetReturn(next) };
}

/**
 * Drop the sheet-metal block. Code before it and code after it stay,
 * including the single `return part;`.
 */
export function removeSheetMetalBlock(buffer) {
  const s = String(buffer ?? '');
  const i = s.indexOf(SHEET_METAL_BEGIN);
  if (i < 0) return { ok: true, buffer: s };
  const endMark = s.indexOf(SHEET_METAL_END, i);
  if (endMark < 0) return { ok: false, buffer: s, message: 'Sheet metal block is incomplete.' };
  let end = endMark + SHEET_METAL_END.length;
  if (s[end] === '\r') end += 1;
  if (s[end] === '\n') end += 1;
  return { ok: true, buffer: withSheetReturn(`${s.slice(0, i)}${s.slice(end)}`) };
}
