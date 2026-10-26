import { featureGapLine } from './featureGaps.js';
/**
 * Slice 09/10/11 — Helper insert palette snippets.
 * Source of truth: helper-functions.md allowlist + gamePuzzles / GameHintsModal.
 * Do NOT invent APIs.
 *
 * Slice 10: params schema per button, unique var allocator, numbered body lets
 * (box1, tube2, …); features mutate a chosen body; no class inheritance.
 *
 * Slice 11/12: optional faceContext / edgeContext (from Viewport selectedFace) → face-aware
 * workplane via facesByNormal + closest center (never bare `top`).
 * Slice 21: crossSection plane+profile substrate (planar face → makeCrossSection).
 * Slice 22: sweepPath ordered wire from edge selection (makeSweepPath).
 * Slice 23: filletAlongPath — sweep fillet wedge along Path; Fillet Strategy=sweep (default) | planar.
 * Slice 24: contour-mode Profile region (markers + custom polyline points).
 * Slice 25/hotfix: Extrude Confirm names a contour and writes makeExtrude
 * by that name inside an id-marked extrude block. When `part` already
 * exists, Confirm unions (`part = part.add(placeInFrame(...))`); an empty
 * script still uses `let part = placeInFrame(...)`.
 * Script-insert part-binding: locate the live `part` decl/assign, insert AFTER
 * it (never in the TDZ), and prefer `part = …` / `part.add` over a second
 * `let part`. Founding Contour solids are kept so Extrude-on-Extrude stacks.
 * Slice 26/hotfix: Revolve Confirm names a contour and writes makeRevolve
 * of that contour inside an id-marked revolve block (additive when `part`
 * already exists).
 * Slice 27: Fillet-in-mode Accept wraps makeSweepPath + filletAlongPath in fillet markers
 * (one pair per contiguous component when the edge pick is disconnected).
 * Disjoint corners resolve every edge before the first blend: a fillet boolean
 * merges or splits face ids, and a later edgesBetween of the next corner throws.
 * Slice 28/hotfix: Loft Confirm names contours and writes makeLoft by those
 * names inside an id-marked loft block (additive when `part` already exists).
 * Slice 29: rail groups Prim / Advanced / Features / Xforms. Profile, Workplane,
 * Extrude, Revolve, Sweep, and Loft live in Advanced on the game rail. The CAD
 * rail promotes that set into Model (paletteRailSections) and does not repeat
 * them under Advanced. Draft stays in Transforms.
 * Slice 30: Sweep Confirm names a profile contour and a path contour, then
 * writes sweepPoints inside an id-marked sweep block (additive when `part`
 * already exists).
 *
 * Slice A: every left-rail insertable that creates a feature wraps begin/end
 * markers (primitives, polish, moves, one-shot Model fallbacks) so FeatureStrip
 * chips appear with per-type badges — same pattern as Fillet.
 *
 * Sequential taps compose via composeHelperInsert:
 * strip one trailing `return part;`, insert body, re-append exactly one `return part;`.
 */

import {
  classifySelectedFace,
  emitFaceWorkplaneLines,
  emitFaceEdgeLines,
  emitSelectedEdgeLines,
  emitSelectedEdgeLiteralLines,
  emitFilletBoundaryLines,
  emitNamedEdgeLines,
  emitSpanExpr,
  holeReachParams,
  estimateCylinderAxis,
  roundFaceNum,
  resolveHoleUV,
  holeFeatureParamDefs,
  emitFaceSelectionExpr,
  facePickLiterals,
  formatVec3,
  SHELL_OPENING_OPTIONS,
  DRAFT_PULL_OPTIONS,
  DRAFT_REFERENCE_OPTIONS,
} from './faceFeaturePlacement.js';
import { resolveFilletStrategy } from './filletAlongPath.js';
import { BLOCK_POSE_PARAMS, blockSpec, blockSolidExpression } from './blockSolid.js';
import { POSITION_LIMIT_MM } from './positionLimit.js';
import { assembleSweepPath, splitEdgePathComponents } from './edgeSweepPath.js';
import { planeFrameFromFaceData } from './crossSectionSubstrate.js';
import { emitSolveContour } from './contourScript.js';
import { REGULAR_POLYGON_PRESETS, regularPolygonSides } from './contourSolve.js';
import { findFeatureBlocks, isMarkerLine, mintBlockId } from './featureBlockId.js';
import { joinScriptReturn, splitScriptReturn } from './scriptReturn.js';
import { emitLoftReferenceLines } from './loftReference.js';
import {
  emitExtrudeReferenceLines,
  emitPathProfileExpr,
  emitRevolveReferenceLines,
  emitSweepReferenceLines,
  projectPathUv,
  sweepPathFrame,
} from './solidReference.js';

/** Slice 24 — in-mode Profile region so Confirm can replace without appending. */
export const CONTOUR_PROFILE_BEGIN = '// --- contour-mode profile begin ---';
export const CONTOUR_PROFILE_END = '// --- contour-mode profile end ---';

/** Slice 25 — in-mode Extrude region (profile + solid). Second Confirm replaces this block. */
export const CONTOUR_EXTRUDE_BEGIN = '// --- contour-mode extrude begin ---';
export const CONTOUR_EXTRUDE_END = '// --- contour-mode extrude end ---';

/** Slice 26 — in-mode Revolve region (profile + solid). Second Confirm replaces this block. */
export const CONTOUR_REVOLVE_BEGIN = '// --- contour-mode revolve begin ---';
export const CONTOUR_REVOLVE_END = '// --- contour-mode revolve end ---';

/** Slice 28 — in-mode Loft region (profiles + makeLoft). Second Confirm replaces this block. */
export const CONTOUR_LOFT_BEGIN = '// --- contour-mode loft begin ---';
export const CONTOUR_LOFT_END = '// --- contour-mode loft end ---';

/** Slice 30 — in-mode Sweep region (profile + path + sweepPoints). Second Confirm replaces this block. */
export const CONTOUR_SWEEP_BEGIN = '// --- contour-mode sweep begin ---';
export const CONTOUR_SWEEP_END = '// --- contour-mode sweep end ---';

/** Slice 27 — in-mode Fillet region (makeSweepPath + filletAlongPath). Second Accept replaces this block. */
export const FILLET_MODE_BEGIN = '// --- fillet-mode begin ---';
export const FILLET_MODE_END = '// --- fillet-mode end ---';

/** In-mode Chamfer region (path chamfer via filletAlongPath). Second Accept replaces this block. */
export const CHAMFER_MODE_BEGIN = '// --- chamfer-mode begin ---';
export const CHAMFER_MODE_END = '// --- chamfer-mode end ---';

/**
 * Slice A — feature-strip markers for every left-rail insertable that creates
 * a feature (primitives, polish, moves, and one-shot Model fallbacks). Contour /
 * Fillet / Chamfer mode markers above stay the source of truth for those kinds.
 */
export const CUBE_BEGIN = '// --- cube begin ---';
export const CUBE_END = '// --- cube end ---';
export const ROUNDED_BOX_BEGIN = '// --- roundedBox begin ---';
export const ROUNDED_BOX_END = '// --- roundedBox end ---';
export const CYLINDER_BEGIN = '// --- cylinder begin ---';
export const CYLINDER_END = '// --- cylinder end ---';
export const SPHERE_BEGIN = '// --- sphere begin ---';
export const SPHERE_END = '// --- sphere end ---';
export const TUBE_BEGIN = '// --- tube begin ---';
export const TUBE_END = '// --- tube end ---';
export const HEX_PRISM_BEGIN = '// --- hexPrism begin ---';
export const HEX_PRISM_END = '// --- hexPrism end ---';
export const HOLE_BEGIN = '// --- hole begin ---';
export const HOLE_END = '// --- hole end ---';
export const HOLE_PATTERN_BEGIN = '// --- holePattern begin ---';
export const HOLE_PATTERN_END = '// --- holePattern end ---';
export const CLEARANCE_HOLE_BEGIN = '// --- clearanceHole begin ---';
export const CLEARANCE_HOLE_END = '// --- clearanceHole end ---';
export const TAP_DRILL_HOLE_BEGIN = '// --- tapDrillHole begin ---';
export const TAP_DRILL_HOLE_END = '// --- tapDrillHole end ---';
export const CBORE_HOLE_BEGIN = '// --- cboreHole begin ---';
export const CBORE_HOLE_END = '// --- cboreHole end ---';
export const CSK_HOLE_BEGIN = '// --- cskHole begin ---';
export const CSK_HOLE_END = '// --- cskHole end ---';
export const SHELL_BEGIN = '// --- shell begin ---';
export const SHELL_END = '// --- shell end ---';
export const DRAFT_BEGIN = '// --- draft begin ---';
export const DRAFT_END = '// --- draft end ---';
export const CUT_BEGIN = '// --- cut begin ---';
export const CUT_END = '// --- cut end ---';
export const BOOLEAN_BEGIN = '// --- boolean begin ---';
export const BOOLEAN_END = '// --- boolean end ---';
export const MOVE_BEGIN = '// --- move begin ---';
export const MOVE_END = '// --- move end ---';
export const ROTATE_BEGIN = '// --- rotate begin ---';
export const ROTATE_END = '// --- rotate end ---';
export const MOVE_FACE_BEGIN = '// --- move-face begin ---';
export const MOVE_FACE_END = '// --- move-face end ---';
export const DELETE_FACE_BEGIN = '// --- delete-face begin ---';
export const DELETE_FACE_END = '// --- delete-face end ---';
export const CENTER_BEGIN = '// --- center begin ---';
export const CENTER_END = '// --- center end ---';
export const ALIGN_BEGIN = '// --- align begin ---';
export const ALIGN_END = '// --- align end ---';
export const MIRROR_BEGIN = '// --- mirror begin ---';
export const MIRROR_END = '// --- mirror end ---';
export const ARRAY_BEGIN = '// --- array begin ---';
export const ARRAY_END = '// --- array end ---';
export const POLAR_ARRAY_BEGIN = '// --- polarArray begin ---';
export const POLAR_ARRAY_END = '// --- polarArray end ---';
export const PATTERN_POINTS_BEGIN = '// --- patternPoints begin ---';
export const PATTERN_POINTS_END = '// --- patternPoints end ---';
export const WORKPLANE_BEGIN = '// --- workplane begin ---';
export const WORKPLANE_END = '// --- workplane end ---';
export const CODE_BEGIN = '// --- code begin ---';
export const CODE_END = '// --- code end ---';

/** All feature end-markers — inserts after a live `part` binding skip past these. */
export const FEATURE_BLOCK_END_MARKERS = Object.freeze([
  CONTOUR_PROFILE_END,
  CONTOUR_EXTRUDE_END,
  CONTOUR_REVOLVE_END,
  CONTOUR_LOFT_END,
  CONTOUR_SWEEP_END,
  FILLET_MODE_END,
  CHAMFER_MODE_END,
  CUBE_END,
  ROUNDED_BOX_END,
  CYLINDER_END,
  SPHERE_END,
  TUBE_END,
  HEX_PRISM_END,
  HOLE_END,
  HOLE_PATTERN_END,
  CLEARANCE_HOLE_END,
  TAP_DRILL_HOLE_END,
  CBORE_HOLE_END,
  CSK_HOLE_END,
  SHELL_END,
  DRAFT_END,
  CUT_END,
  BOOLEAN_END,
  MOVE_END,
  ROTATE_END,
  MOVE_FACE_END,
  DELETE_FACE_END,
  CENTER_END,
  ALIGN_END,
  MIRROR_END,
  ARRAY_END,
  POLAR_ARRAY_END,
  PATTERN_POINTS_END,
  WORKPLANE_END,
  CODE_END,
]);

/** Wrap body lines in begin…end strip markers (Slice A). */
export function wrapFeatureBlock(begin, end, bodyLines) {
  return [begin, ...bodyLines, end];
}

/** Metric fastener sizes commonly used in puzzles / hints. */
export const FASTENER_SIZE_OPTIONS = [
  'M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10',
];

export const FIT_OPTIONS = ['close', 'normal', 'loose'];
export const AXIS_OPTIONS = ['x', 'y', 'z'];
export const MIRROR_PLANE_OPTIONS = ['xy', 'yz', 'xz'];

/** Bases treated as body identifiers for the body selector. */
const BODY_BASES = [
  'part', 'box', 'cyl', 'sphere', 'tube', 'hex', 'rbox', 'extrude', 'revolve', 'lofted', 'bore',
];

/** Exact base or numbered form only (box, box1) — not prefix (boxCount). */
function isBodyName(n) {
  return BODY_BASES.some((b) => b === n || new RegExp('^' + b + '\\d+$').test(n));
}

/** Monotonic fallback for allocateUniqueName when the numbered loop is exhausted. */
let uniqueNameFallbackSeq = 0;

/** Strip line/block comments for emptiness / name scans. */
function stripComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Detect empty / whitespace-only / comment-only Monaco buffer.
 * Comment-only counts as empty: a body helper is refused on it, a Block starts it.
 */
export function isBufferEmpty(text) {
  if (!text || !String(text).trim()) return true;
  return !stripComments(text).trim();
}

/**
 * Script is only construction-plane literals (optional `return part` with no
 * part). Running it must clear the solid — Workplane alone is not a host cube.
 */
export function isConstructionPlaneOnlyScript(text) {
  if (isBufferEmpty(text)) return false;
  let body = stripComments(text)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\breturn\s+part\s*;/g, '')
    .trim();
  if (!body) return false;
  if (/\bpart\b/.test(body)) return false;
  if (/\b(?:Manifold|CrossSection|make[A-Z]|sweep|fillet|hole|cube|cylinder|sphere)\b/.test(body)) {
    return false;
  }
  const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
  if (!stmts.length) return false;
  return stmts.every((s) => (
    /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{/.test(s)
    && /center\s*:/.test(s)
    && /normal\s*:/.test(s)
    && /\bx\s*:/.test(s)
    && /\by\s*:/.test(s)
  ));
}

/**
 * Empty / comment-only buffer, or a construction-plane-only script.
 * The viewport clears; it does not keep the previous solid.
 */
export function shouldClearViewportScript(text) {
  if (text == null) return false;
  if (isBufferEmpty(text)) return true;
  return isConstructionPlaneOnlyScript(text);
}

/**
 * True when the buffer already binds `part` to a solid (primitive, feature,
 * or a prior commit outside the block about to be replaced).
 * Advanced Confirm unions onto that part instead of replacing it.
 */
export function scriptHasPriorSolid(buffer) {
  if (isBufferEmpty(buffer)) return false;
  return declaredNames(buffer).has('part');
}

/** Remove a single trailing `return part;` (plus trailing whitespace). */
export function stripTrailingReturnPart(text) {
  if (!text) return '';
  return String(text).replace(/\s*$/, '').replace(/(?:\r?\n)?return\s+part\s*;\s*$/, '');
}

/** Names already declared with const/let/var in buffer (comments ignored). */
export function declaredNames(buffer) {
  const names = new Set();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  const s = stripComments(buffer);
  while ((m = re.exec(s))) names.add(m[1]);
  return names;
}

/** Offset just after the statement whose `=` is at `eq`. */
function statementEndAfterEquals(source, eq) {
  const s = String(source || '');
  let i = eq + 1;
  let depth = 0;
  let inStr = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (ch === ';' && depth === 0) return i + 1;
  }
  return i;
}

/**
 * Offset just after the last top-level `let/const/var part = …` or `part = …`.
 * Returns 0 when no binding exists.
 */
export function findLastPartBindingEnd(buffer) {
  const s = String(buffer || '');
  if (!s) return 0;
  const re = /(?:\b(?:const|let|var)\s+part\s*=|(?:^|[\n;])\s*part\s*=)/g;
  let lastEnd = 0;
  let m;
  while ((m = re.exec(s))) {
    const eq = s.indexOf('=', m.index);
    if (eq < 0) continue;
    lastEnd = statementEndAfterEquals(s, eq);
  }
  return lastEnd;
}

/**
 * Offset just after the first `let/const/var part = …`. Later `part = …`
 * assignments are not the initialization. A caret before this offset would
 * read `part` in the TDZ. Returns 0 when `part` is never declared.
 */
export function findPartDeclarationEnd(buffer) {
  const s = String(buffer || '');
  const m = /\b(?:const|let|var)\s+part\s*=/.exec(s);
  if (!m) return 0;
  const eq = s.indexOf('=', m.index);
  if (eq < 0) return 0;
  return statementEndAfterEquals(s, eq);
}


/** Skip trailing whitespace + Contour/Fillet/Chamfer end-marker lines after a binding. */
function extendPastOwnedEndMarkers(buffer, offset) {
  const s = String(buffer || '');
  const endMarkers = FEATURE_BLOCK_END_MARKERS;
  let i = Math.max(0, Math.min(Number(offset) || 0, s.length));
  while (i < s.length) {
    const ws = /^\s*/.exec(s.slice(i));
    const next = i + (ws ? ws[0].length : 0);
    if (next >= s.length) return s.length;
    const nl = s.indexOf('\n', next);
    const line = s.slice(next, nl < 0 ? s.length : nl).trim();
    if (endMarkers.some((m) => isMarkerLine(line, m))) {
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    break;
  }
  return i;
}


/**
 * Allocate a unique identifier.
 * - Prefer bare `base` when free.
 * - Else `base2`, `base3`, … (never overwrite).
 * - For body-style bases in BODY_BASES (except part), prefer `base1` first
 *   when neither bare nor base1 exists — matches numbered body model (box1).
 * @param {Set<string>|string} existingOrBuffer
 * @param {string} base
 * @returns {string}
 */
export function allocateUniqueName(existingOrBuffer, base) {
  const existing =
    existingOrBuffer instanceof Set
      ? existingOrBuffer
      : declaredNames(existingOrBuffer);
  if (!base || typeof base !== 'string') base = 'tmp';

  // Numbered body lets: box1, tube2, … (never bare box/cyl when allocating).
  const isBodyBase = BODY_BASES.includes(base) && base !== 'part';
  if (isBodyBase) {
    for (let n = 1; n < 10000; n++) {
      const cand = `${base}${n}`;
      if (!existing.has(cand)) {
        existing.add(cand);
        return cand;
      }
    }
  } else if (!existing.has(base)) {
    existing.add(base);
    return base;
  } else {
    for (let n = 2; n < 10000; n++) {
      const cand = `${base}${n}`;
      if (!existing.has(cand)) {
        existing.add(cand);
        return cand;
      }
    }
  }
  const fallback = `${base}_${++uniqueNameFallbackSeq}`;
  existing.add(fallback);
  return fallback;
}

/**
 * Scan buffer for *mutable* body-like identifiers (let/var decls + known assigns).
 * Excludes const-declared names (assignment would throw). Offers `part` as a
 * fallback only when `part` is not const-declared.
 * @param {string} buffer
 * @returns {string[]}
 */
export function listBodyNames(buffer) {
  const names = new Set();
  const constNames = new Set();
  const s = stripComments(buffer || '');
  const decl = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = decl.exec(s))) {
    const kind = m[1];
    const n = m[2];
    if (kind === 'const') {
      constNames.add(n);
      continue;
    }
    if (isBodyName(n)) names.add(n);
  }
  // Fallback only when part is mutable (or undeclared).
  if (!constNames.has('part')) names.add('part');
  // Also catch `part = …` / `box1 = …` mutations without fresh decl.
  const assign = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:Manifold\.|tube\(|hexPrism\(|roundedBox\(|makeExtrude\(|makeRevolve\(|makeLoft\(|filletEdges\(|filletAlongPath\(|chamferEdges\(|hole\(|clearanceHole\(|tapDrillHole\(|cboreHole\(|cskHole\(|holePattern\(|shell\(|hollow\(|addDraft\(|draftFaces\(|cut\(|moveFace\(|deleteFace\(|rectTube\(|center\(|align\(|mirror\(|array3D\(|polarArray\()/g;
  while ((m = assign.exec(s))) {
    const n = m[1];
    if (constNames.has(n)) continue;
    if (isBodyName(n)) names.add(n);
  }
  return [...names];
}

/**
 * Drop top-level starter / const lines whose binding already exists in the buffer
 * (and within earlier top-level lines of the same snippet).
 *
 * Only depth-0 declarations are filtered. Nested `const` inside an IIFE is a
 * new block scope and must be kept — stripping mid-block lines (e.g. the opener
 * of `const _hit = _all.filter((e) => {`) previously left orphan `});` / `}})();`
 * and caused Monaco Parser errors on the second fillet/hole insert.
 *
 * When skipping a top-level decl that opens a block, consume through the matching
 * close so we never leave a half-IIFE behind.
 */
function filterRedeclarations(snippetText, bufferText) {
  const existing = declaredNames(bufferText);
  const out = [];
  const lines = String(snippetText || '').split('\n');
  let depth = 0;
  let i = 0;

  const braceDelta = (line) => {
    let d = 0;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch === '{') d += 1;
      else if (ch === '}') d -= 1;
    }
    return d;
  };

  while (i < lines.length) {
    const line = lines[i];
    const m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    const atTop = depth === 0;

    if (atTop && m && existing.has(m[1])) {
      // Skip whole declaration (including multi-line IIFE / .filter bodies).
      let skipDepth = braceDelta(line);
      i += 1;
      while (skipDepth > 0 && i < lines.length) {
        skipDepth += braceDelta(lines[i]);
        i += 1;
      }
      continue;
    }

    if (m) existing.add(m[1]);
    out.push(line);
    depth += braceDelta(line);
    if (depth < 0) depth = 0;
    i += 1;
  }

  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

function wrapRunnable(bodyLines) {
  return `${bodyLines.join('\n')}\nreturn part;\n`;
}

function withReturn(lines, bufferEmpty) {
  if (bufferEmpty) return wrapRunnable(lines);
  return `${lines.join('\n')}\n`;
}

function num(v, fallback) {
  // Number('') === 0 is finite — treat blank/nullish as fallback (defense in depth).
  if (v === '' || v === null || v === undefined || v === '-' || v === '.') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerce a modal/raw number field: blank/nullish/in-progress/NaN → default, then clamp min/max.
 * @param {*} raw
 * @param {{ default: number, min?: number, max?: number }} p
 * @returns {number}
 */
export function coerceNumberParam(raw, p) {
  let n;
  if (raw === '' || raw === null || raw === undefined || raw === '-' || raw === '.') {
    n = p.default;
  } else {
    n = Number(raw);
    if (!Number.isFinite(n)) n = p.default;
  }
  if (typeof p.min === 'number' && Number.isFinite(p.min) && n < p.min) n = p.min;
  if (typeof p.max === 'number' && Number.isFinite(p.max) && n > p.max) n = p.max;
  return n;
}

/**
 * Confirm-time number coerce for HelperParamModal.
 * Resolve Strategy *before* clamping: Strategy=sweep uses sweepMax alone as
 * the radius/chamfer ceiling (slider parity — not open-time planar p.max).
 *
 * @param {Record<string, unknown>} values
 * @param {object[]} params
 * @param {{ strategy?: string, sweepMax?: number|null }} [opts]
 * @returns {Record<string, unknown>}
 */
export function coerceFilletConfirmNumbers(values, params, opts = {}) {
  const strategy = opts.strategy || 'planar';
  const sweepMax = opts.sweepMax;
  const out = { ...values };
  const list = Array.isArray(params) ? params : [];
  for (const p of list) {
    if (p.type !== 'number') continue;
    const useSweep = (
      strategy === 'sweep'
      && (p.name === 'radius' || p.name === 'chamfer')
      && sweepMax != null
      && Number.isFinite(Number(sweepMax))
    );
    const spec = useSweep
      ? { ...p, max: Number(sweepMax) }
      : p;
    out[p.name] = coerceNumberParam(out[p.name], spec);
  }
  return out;
}

function bool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

/**
 * rotateAbout axis literal: 'x' | 'y' | 'z' (a leading '-' flips it) stays a
 * quoted name; a vector becomes [ax, ay, az]. Null when it is unusable.
 * @param {string|number[]|null|undefined} axis
 * @returns {string|null}
 */
export function rotateAxisLiteral(axis) {
  if (Array.isArray(axis)) {
    if (axis.length < 3) return null;
    const v = axis.slice(0, 3).map(Number);
    if (!v.every(Number.isFinite) || !(Math.hypot(v[0], v[1], v[2]) > 1e-12)) return null;
    return formatVec3(v);
  }
  const key = typeof axis === 'string' ? axis.trim().toLowerCase() : '';
  if (/^-?[xyz]$/.test(key)) return `'${key}'`;
  if (key.startsWith('[')) {
    try {
      return rotateAxisLiteral(JSON.parse(key));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * rotateAbout center literal: [x, y, z], or `null` for the body's own
 * centroid when center is omitted. Null (the JS value) when it is unusable.
 * @param {number[]|string|null|undefined} center
 * @returns {string|null}
 */
export function rotateCenterLiteral(center) {
  if (center == null || center === '' || center === 'body') return 'null';
  if (typeof center === 'string') {
    try {
      return rotateCenterLiteral(JSON.parse(center));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(center) || center.length < 3) return null;
  const v = center.slice(0, 3).map(Number);
  if (!v.every(Number.isFinite)) return null;
  return formatVec3(v);
}

function str(v, fallback) {
  return v == null || v === '' ? fallback : String(v);
}

function mergeParams(item, params) {
  const out = {};
  for (const p of item.params || []) {
    out[p.name] = p.default;
  }
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

/** After mutating a non-part body, keep `part` in sync when it already exists. */
function syncPartLines(bodyName, names, bufferHasPart) {
  if (bodyName === 'part') return [];
  if (bufferHasPart || names.has('part')) {
    return [`part = ${bodyName};`];
  }
  const partName = allocateUniqueName(names, 'part');
  return partName === 'part'
    ? [`let part = ${bodyName};`]
    : [`let ${partName} = ${bodyName};`, `part = ${partName};`];
}

/**
 * After a body is arrayed, re-apply that body's own combine op to `part`.
 * `array3D` keeps the original instance (the untranslated copy), so
 * `part = part.subtract(box2)` cuts every copy and `part = part.add(box2)`
 * adds every copy. The old `part = box2` replaced the whole part with the
 * cutters. A body `part` was only aliased to (`let part = box1`), or that was
 * never combined, is added. A buffer with no `part` keeps the alias.
 * `polarArray` does not keep that untranslated instance when the radius is
 * positive; `polarReapply` handles it.
 */
function reapplyBodyToPart(bodyName, names, buffer) {
  if (bodyName === 'part') return [];
  const code = stripComments(buffer || '');
  const hasPart = names.has('part') || /\b(?:let|var)\s+part\b/.test(code);
  if (!hasPart) return syncPartLines(bodyName, names, false);
  const name = bodyName.replace(/\$/g, '\\$');
  const combine = new RegExp(
    `\\bpart\\s*=\\s*part\\.(add|subtract)\\(\\s*${name}\\s*(,\\s*\\{[^}]*\\})?\\s*\\)`,
    'g',
  );
  let last = null;
  let m;
  while ((m = combine.exec(code))) last = m;
  names.add('part');
  if (!last) return [`part = part.add(${bodyName});`];
  const opts = last[2] ? `, ${last[2].replace(/^,\s*/, '')}` : '';
  return [`part = part.${last[1]}(${bodyName}${opts});`];
}

/**
 * polarArray moves every copy out to the circle when radius is positive, so
 * re-adding the array on top of an already-combined source leaves the
 * untranslated solid behind (list_bodies shows the original plus the copies).
 * Capture the source first, undo that one combine, then apply the array.
 * A subtract cutter is re-subtracted as the array (the original hole stays,
 * because filling it back would also restore any part of the cutter that
 * stuck out of the solid). An alias (`let part = box1`, no combine) is
 * replaced, not added. Radius 0 stacks the copies on the source, so the
 * ordinary reapply is enough.
 */
function polarReapply(bodyName, names, buffer, radius) {
  if (bodyName === 'part') return { before: [], after: [] };
  const code = stripComments(buffer || '');
  const hasPart = names.has('part') || /\b(?:let|var)\s+part\b/.test(code);
  if (!hasPart) return { before: [], after: syncPartLines(bodyName, names, false) };
  const name = bodyName.replace(/\$/g, '\\$');
  const combine = new RegExp(
    `\\bpart\\s*=\\s*part\\.(add|subtract)\\(\\s*${name}\\s*(,\\s*\\{[^}]*\\})?\\s*\\)`,
    'g',
  );
  let last = null;
  let m;
  while ((m = combine.exec(code))) last = m;
  names.add('part');
  if (!last) return { before: [], after: [`part = ${bodyName};`] };
  const opts = last[2] ? `, ${last[2].replace(/^,\s*/, '')}` : '';
  const op = last[1];
  if (op === 'subtract' || !(radius > 0)) {
    return { before: [], after: [`part = part.${op}(${bodyName}${opts});`] };
  }
  const prev = allocateUniqueName(names, 'polarSrc');
  return {
    before: [`const ${prev} = ${bodyName};`],
    after: [
      `part = part.subtract(${prev});`,
      `part = part.add(${bodyName}${opts});`,
    ],
  };
}

/** 'x' | 'y' | 'z'. Anything else is z, matching polarArray's default. */
function polarAxis(raw) {
  const axis = str(raw, 'z').toLowerCase();
  return axis === 'x' || axis === 'y' || axis === 'z' ? axis : 'z';
}

/**
 * A cylinder along `axis`. Centered cutters punch a plate that straddles the
 * origin; uncentered pins (the empty-part demo) still stand on +Z.
 */
function polarPinExpr(bh, br, axis, center) {
  const cyl = center
    ? `Manifold.cylinder(${bh}, ${br}, ${br}, 64, true)`
    : `Manifold.cylinder(${bh}, ${br}, ${br}, 64)`;
  if (axis === 'x') return `${cyl}.rotate([0, 90, 0])`;
  if (axis === 'y') return `${cyl}.rotate([-90, 0, 0])`;
  return cyl;
}

/**
 * Points for patternOnPoints from the palette or the agent: an array, or a
 * JSON string of one, of [x, y, z] or { at: [x, y, z], axis?: [nx, ny, nz] }.
 * Returns the normalised array, or null when it is not usable.
 */
export function parsePatternPoints(raw) {
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try { value = JSON.parse(text); } catch { return null; }
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 10000) return null;
  const vec3 = (v) => (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : null);
  const out = [];
  for (const p of value) {
    if (Array.isArray(p)) {
      const at = vec3(p);
      if (!at) return null;
      out.push(at);
      continue;
    }
    if (p && typeof p === 'object') {
      const at = vec3(p.at);
      if (!at) return null;
      if (p.axis == null) { out.push({ at }); continue; }
      const axis = vec3(p.axis);
      if (!axis || !(Math.hypot(...axis) > 1e-9)) return null;
      out.push({ at, axis });
      continue;
    }
    return null;
  }
  return out;
}

function resolveBody(params, names, buffer) {
  const bodies = listBodyNames(buffer); // mutable only (const bodies excluded)
  let body = str(params.body, 'part');
  // Const-declared or unknown → fall back to part if available, else first mutable.
  if (!bodies.includes(body)) {
    body = bodies.includes('part') ? 'part' : (bodies[0] || 'part');
  }
  // Touch names set so later allocs see body if it was only assigned, not decl'd.
  if (!names.has(body)) names.add(body);
  return body;
}

function hasPartDecl(lines, empty) {
  return /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty;
}

/**
 * Default (no face) top-face workplane — facesByNormal(+Z), never bare `top`.
 */
function emitDefaultTopWorkplane(body, names) {
  const topFace = allocateUniqueName(names, 'topFace');
  const fr = allocateUniqueName(names, 'fr');
  return {
    lines: [
      `const ${topFace} = facesByNormal(${body}, [0, 0, 1])[0];`,
      `if (${topFace} == null) throw new Error('No +Z face for default workplane');`,
      `const ${fr} = workplaneFromFace(${body}, ${topFace});`,
    ],
    frVar: fr,
  };
}

/**
 * Per-station profile fields only. Parent helper params (mergeParams defaults
 * or a selected-chip radius) must not leak onto sibling stations.
 */
export function isolateLoftStationParams(prof = {}) {
  return {
    profileType: prof.profileType,
    radius: prof.radius,
    segments: prof.segments,
    width: prof.width,
    height: prof.height,
    centered: prof.centered,
    polygonPreset: prof.polygonPreset,
    points: prof.points,
    contour: prof.contour,
    ...(Array.isArray(prof.origin) ? { origin: prof.origin } : {}),
  };
}

function profileOrigin(p) {
  const u = Number(p?.origin?.[0]) || 0;
  const v = Number(p?.origin?.[1]) || 0;
  if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) return null;
  return [u, v];
}

function emitPointList(points) {
  const pts = points.map(([u, v]) => `[${roundFaceNum(u, 4)}, ${roundFaceNum(v, 4)}]`);
  return `profilePolygon([${pts.join(', ')}])`;
}

/** Emit profileCircle / profileRectangle / profilePolygon / solveContour from Slice 21 params. */
export function emitProfileExprFromParams(p) {
  if (p.contour) return emitSolveContour(p.contour);
  const type = str(p.profileType, 'circle');
  const origin = profileOrigin(p);
  if (type === 'rectangle') {
    const w = num(p.width, 20);
    const h = num(p.height, 12);
    const c = bool(p.centered, true);
    if (!origin) return `profileRectangle(${w}, ${h}, ${c})`;
    const x0 = (c ? -w / 2 : 0) + origin[0];
    const y0 = (c ? -h / 2 : 0) + origin[1];
    return emitPointList([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]);
  }
  if (type === 'polygon') {
    const preset = str(p.polygonPreset, 'hexagon');
    const r = num(p.radius, 8);
    if (preset === 'custom' && Array.isArray(p.points)) {
      const pts = p.points.map((v) => {
        const u = Number(v?.[0]);
        const vv = Number(v?.[1]);
        return `[${roundFaceNum(u, 4)}, ${roundFaceNum(vv, 4)}]`;
      });
      return `profilePolygon([${pts.join(', ')}])`;
    }
    if (preset === 'quarterCircle') {
      const seg = 8;
      if (!origin) {
        const pts = ['[0, 0]', `[${r}, 0]`];
        for (let i = 1; i <= seg; i++) {
          const t = (i / seg) * (Math.PI / 2);
          const u = +(r * Math.cos(t)).toFixed(4);
          const v = +(r * Math.sin(t)).toFixed(4);
          pts.push(`[${u}, ${v}]`);
        }
        return `profilePolygon([${pts.join(', ')}])`;
      }
      const pts = [[0, 0], [r, 0]];
      for (let i = 1; i <= seg; i++) {
        const t = (i / seg) * (Math.PI / 2);
        pts.push([r * Math.cos(t), r * Math.sin(t)]);
      }
      return emitPointList(pts.map(([u, v]) => [u + origin[0], v + origin[1]]));
    }
    const sides = regularPolygonSides(preset) || 6;
    if (!origin) {
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
        const u = +(r * Math.cos(t)).toFixed(4);
        const v = +(r * Math.sin(t)).toFixed(4);
        pts.push(`[${u}, ${v}]`);
      }
      return `profilePolygon([${pts.join(', ')}])`;
    }
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
      pts.push([r * Math.cos(t) + origin[0], r * Math.sin(t) + origin[1]]);
    }
    return emitPointList(pts);
  }
  const r = num(p.radius, 5);
  const seg = Math.max(3, Math.round(num(p.segments, 64)));
  if (!origin) return `profileCircle(${r}, ${seg})`;
  const pts = [];
  for (let i = 0; i < seg; i += 1) {
    const t = (i / seg) * Math.PI * 2;
    pts.push([r * Math.cos(t) + origin[0], r * Math.sin(t) + origin[1]]);
  }
  return emitPointList(pts);
}

function _loftDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function _loftOwnsPlane(prof) {
  return !!(
    prof
    && prof.plane
    && prof.plane.center
    && prof.plane.normal
    && (prof.planeKind === 'face' || prof.planeKind === 'workplane' || prof.planeKind === 'contour')
  );
}

function loftFramesParallel(frames) {
  const n0 = frames[0].normal;
  const l0 = Math.hypot(n0[0], n0[1], n0[2]);
  if (!(l0 > 1e-12)) return false;
  for (let i = 1; i < frames.length; i++) {
    const n = frames[i].normal;
    const l = Math.hypot(n[0], n[1], n[2]);
    if (!(l > 1e-12)) return false;
    if (Math.abs(_loftDot(n0, n) / (l0 * l)) < 0.99) return false;
  }
  return true;
}

/** Next contour binding: c1, c2, … */
function takeContourName(names) {
  let n = 1;
  let cand = `c${n}`;
  while (names.has(cand)) {
    n += 1;
    cand = `c${n}`;
    if (n > 10000) break;
  }
  names.add(cand);
  return cand;
}

/**
 * Index of the station placeInFrame should use.
 * Parallel stations: the lowest along the first normal (frame center plus offset).
 * Angled stations: the first.
 */
function loftReferencePlaceIndex(frames, offsets) {
  if (!frames.length || !loftFramesParallel(frames)) return 0;
  const n0 = frames[0].normal;
  const l0 = Math.hypot(n0[0], n0[1], n0[2]) || 1;
  const axis = [n0[0] / l0, n0[1] / l0, n0[2] / l0];
  const c0 = frames[0].center;
  let best = 0;
  let bestZ = Number(offsets[0]) || 0;
  for (let i = 1; i < frames.length; i++) {
    const c = frames[i].center;
    const z = _loftDot([c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]], axis) + (Number(offsets[i]) || 0);
    if (z < bestZ - 1e-9) {
      best = i;
      bestZ = z;
    }
  }
  return best;
}

/** Compact `[x, y, z]` for a composed PlaneFrame literal. */
function emitVec3Literal(v, fallback = [0, 0, 0]) {
  const src = Array.isArray(v) && v.length >= 3 ? v : fallback;
  const n = (x) => {
    const r = +Number(x).toFixed(6);
    return Object.is(r, -0) ? 0 : r;
  };
  return `[${n(src[0])}, ${n(src[1])}, ${n(src[2])}]`;
}

/**
 * Emit a PlaneFrame plain object `{ center, normal, x, y }`.
 * Frame-only — never a Manifold / cube / scaffold.
 */
export function emitPlaneFrameLiteral(plane) {
  const p = plane && typeof plane === 'object' ? plane : {};
  return `{ center: ${emitVec3Literal(p.center, [0, 0, 0])}, normal: ${emitVec3Literal(p.normal, [0, 0, 1])}, x: ${emitVec3Literal(p.x, [1, 0, 0])}, y: ${emitVec3Literal(p.y, [0, 1, 0])} }`;
}

/**
 * Plane literal for a profile that has no host solid yet.
 * A selected planar face wins; otherwise the default XY construction plane.
 */
function literalPlaneFromFace(faceCtx) {
  if (faceCtx && faceCtx.type === 'planar') {
    const framed = faceCtx.planeFrame;
    if (framed?.center && framed?.normal && framed?.x && framed?.y) return framed;
    try {
      return planeFrameFromFaceData({
        center: faceCtx.center,
        normal: faceCtx.normal,
        verts: faceCtx.vertices || faceCtx.verts,
      });
    } catch {
      return null;
    }
  }
  return null;
}

/** New-body Confirm: `let part = expr` on empty, `part = expr` when part exists. */
function emitPartReplace(names, expr, partDeclared) {
  if (partDeclared) return `part = ${expr};`;
  names.add('part');
  return `let part = ${expr};`;
}

/**
 * Advanced Confirm placement.
 * Empty / first body: `let part = placeInFrame(...)`.
 * Part already exists: `part = part.add(placeInFrame(...))` so prior solids stay.
 * Second Confirm still replaces only the marked block (the add is inside it).
 */
/** Add unions onto the host. Subtract cuts the new solid out of it. */
export const SOLID_COMBINE_PARAM = {
  name: 'combine',
  type: 'select',
  default: 'add',
  label: 'Mode',
  options: [
    { value: 'add', label: 'Add' },
    { value: 'subtract', label: 'Subtract' },
  ],
};

/** 'add' | 'subtract'. A params object or a bare string both work. */
export function solidCombineOp(value) {
  const raw = value && typeof value === 'object' ? value.combine : value;
  const v = String(raw ?? 'add').toLowerCase();
  return v === 'subtract' || v === 'cut' ? 'subtract' : 'add';
}

/**
 * Merge bodies (Add mode only). On (default): the new solid unions into the
 * part. Off: it stays a separate body — `part.add(solid, { merge: false })`
 * composes instead of a boolean. Hidden while Mode is Subtract.
 */
export const SOLID_MERGE_PARAM = {
  name: 'merge',
  type: 'bool',
  default: true,
  label: 'Merge bodies',
  showWhen: { field: 'combine', values: ['add'] },
};

/** false only for an explicit off. A params object or a bare value both work. */
export function solidMergeOn(value) {
  const raw = value && typeof value === 'object' ? value.merge : value;
  return !(raw === false || raw === 'false' || raw === 0 || raw === '0');
}

export function emitPartPlace(names, expr, partDeclared, additive, op = 'add', merge = true) {
  const subtract = op === 'subtract' && partDeclared;
  if (subtract) {
    names.add('part');
    return `part = part.subtract(${expr});`;
  }
  if (additive && partDeclared) {
    names.add('part');
    if (merge === false) return `part = part.add(${expr}, { merge: false });`;
    return `part = part.add(${expr});`;
  }
  return emitPartReplace(names, expr, partDeclared);
}

/**
 * Resolve workplane for a hole-like feature. With faceContext, uses selected
 * face normal/center (cylindrical: rebuild normal from angleDeg + axis).
 */
function resolveFeatureWorkplane(body, p, names, faceCtx) {
  if (faceCtx && faceCtx.type === 'cylindrical') {
    const { axis } = estimateCylinderAxis(faceCtx.normal);
    const angleDeg = num(p.angleDeg, 0);
    const rad = (angleDeg * Math.PI) / 180;
    let n;
    if (axis === 'z') n = [Math.cos(rad), Math.sin(rad), 0];
    else if (axis === 'y') n = [Math.sin(rad), 0, Math.cos(rad)];
    else n = [0, Math.cos(rad), Math.sin(rad)];
    const syn = {
      ...faceCtx,
      normal: n,
      // Keep pick center; axial adjusts v later
    };
    return emitFaceWorkplaneLines(body, syn, names, allocateUniqueName);
  }
  if (faceCtx && (faceCtx.type === 'planar' || faceCtx.type === 'cylindrical')) {
    return emitFaceWorkplaneLines(body, faceCtx, names, allocateUniqueName);
  }
  return emitDefaultTopWorkplane(body, names);
}

function uvForFace(p, faceCtx) {
  if (faceCtx && faceCtx.type === 'cylindrical') {
    // On cylinder wall workplane: u ~ hoop, v ~ axial relative to face center
    const axial = num(p.axial, faceCtx.center
      ? (estimateCylinderAxis(faceCtx.normal).axis === 'z' ? faceCtx.center[2]
        : estimateCylinderAxis(faceCtx.normal).axis === 'y' ? faceCtx.center[1]
          : faceCtx.center[0])
      : 0);
    // Face already at axial from selection; offset = axial - faceCenterAxis
    const { axis } = estimateCylinderAxis(faceCtx.normal);
    const faceAx = axis === 'z' ? faceCtx.center[2] : axis === 'y' ? faceCtx.center[1] : faceCtx.center[0];
    const vOff = roundFaceNum(axial - faceAx, 3);
    return { u: 0, v: vOff };
  }
  // Planar Center / custom via resolveHoleUV
  const uv = resolveHoleUV(p, faceCtx, num);
  return { u: uv.u, v: uv.v };
}

/**
 * Build insert text for a palette item (single-shot snippet, may include return).
 * Prefer composeHelperInsert for sequential taps.
 * @param {string} id
 * @param {{ bufferEmpty?: boolean, params?: object, buffer?: string }} opts
 * @returns {string|null}
 */
export function buildHelperSnippet(id, opts = {}) {
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === id);
  if (!item) return null;
  const buffer = opts.buffer || '';
  const bufferEmpty = opts.bufferEmpty != null ? !!opts.bufferEmpty : isBufferEmpty(buffer);
  const params = mergeParams(item, opts.params);
  if (bufferEmpty && helperNeedsBody(id, params)) return null;
  const names = declaredNames(buffer);
  return item.build(bufferEmpty, params, names, buffer, opts.faceContext || null, opts.edgeContext || null);
}

/**
 * Template-aware compose: strip trailing return → insert snippet body at caret
 * (skipping redeclarations) → re-append one `return part;`.
 * @param {string} buffer current Monaco buffer
 * @param {string} id palette item id
 * @param {number|null} [caretOffset] offset into buffer; clamped into ops region.
 *   null / omitted → append at end of body (typical sequential taps).
 * @param {object|null} [params] values from HelperParamModal (defaults if null)
 * @param {object|null} [faceContext] Slice 11 classified selected face (or null)
 * @param {object[]|null} [edgeContext] Slice 12 selected edges for fillet/chamfer
 * @returns {string|null} full replacement buffer
 */
/**
 * Splice a finished snippet at a caret. The same rules as a palette insert:
 * stay after `let part`, and do not split the block that declares it.
 * `null` caret appends. The trailing `return part;` is rewritten once.
 * @param {string} buffer
 * @param {string} snippet
 * @param {number|null} [caretOffset]
 * @returns {string}
 */
export function insertBlockAtCaret(buffer, snippet, caretOffset = null) {
  // A study comment sits after `return part;`. Stripping only a trailing
  // return leaves that return in the middle, and a null caret then appends
  // the feature after it. The feature is dead code. Split on the real
  // return, insert into the head, and keep the study as the tail.
  const src = String(buffer || '');
  const { head, tail, returnAt } = splitScriptReturn(src);
  const filtered = stripTrailingReturnPart(String(snippet || '')).replace(/^\n+|\s+$/g, '');
  let insertAt = caretOffset == null ? head.length : caretOffset;
  if (returnAt >= 0 && caretOffset != null && caretOffset >= returnAt) insertAt = head.length;
  if (insertAt < 0) insertAt = 0;
  if (insertAt > head.length) insertAt = head.length;

  // Prefer insert after the declaration of `part` so `part = part.add(…)` /
  // facesByNormal(part, …) never land in the TDZ before `let part`.
  // Later `part =` lines are assignments, not the declaration, so a caret
  // between features stays there. If the declaration sits inside a marked
  // block, land after that block's end marker so we do not split it.
  if (filtered.trim() && /\bpart\b/.test(filtered) && declaredNames(head).has('part')) {
    const bindingEnd = extendPastOwnedEndMarkers(
      head,
      findPartDeclarationEnd(head),
    );
    if (insertAt < bindingEnd) insertAt = bindingEnd;
  }

  if (!filtered.trim()) return joinScriptReturn(head, tail);

  const before = head.slice(0, insertAt);
  const after = head.slice(insertAt);

  let body = '';
  if (before) {
    body = before.endsWith('\n') ? before : `${before}\n`;
  }
  body += filtered.endsWith('\n') ? filtered : `${filtered}\n`;
  if (after) {
    body += after.replace(/^\n+/, '');
  }
  body = body.replace(/\s+$/, '');
  return joinScriptReturn(body, tail);
}

export function composeHelperInsert(buffer, id, caretOffset = null, params = null, faceContext = null, edgeContext = null, reservedNames = null) {
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === id);
  if (!item) return null;

  const strippedBuf = stripTrailingReturnPart(buffer || '');
  const empty = isBufferEmpty(strippedBuf);
  const merged = mergeParams(item, params);
  if (empty && helperNeedsBody(id, merged)) return null;
  const names = declaredNames(strippedBuf);
  // Edit splices one block into a script that already declares names after
  // that block. The prefix alone would hand those names out again.
  if (reservedNames) {
    for (const name of reservedNames) {
      if (typeof name === 'string' && name) names.add(name);
    }
  }
  let snippet = item.build(empty, merged, names, strippedBuf, faceContext, edgeContext);
  if (snippet == null) return null;

  snippet = stripTrailingReturnPart(snippet);
  const filtered = filterRedeclarations(snippet, strippedBuf);
  return insertBlockAtCaret(buffer, filtered, caretOffset);
}

/**
 * Script for a newly spawned part: nothing. The first Block or Shape creates
 * the body (Artur, 2026-10-19: no seed cube). A helper that needs a body is
 * refused on an empty part (`HELPERS_NEED_BODY`) instead of seeding one.
 */
export function newPartStarterScript() {
  return '';
}

/**
 * The 20 mm cube new parts used to begin with: the same Cube feature a user
 * places from the palette (markers, `box1`, `let part = box1`). Tests and
 * goldens use it when they want one body. App still lists it in
 * `defaultScripts` so an unedited part that is exactly this script skips
 * the assembly leave guard. It is a real cube feature, not a fresh
 * sheet-metal part.
 */
export function starterCubeScript() {
  const script = composeHelperInsert('', 'cube', null, {
    width: 20,
    depth: 20,
    height: 20,
    center: true,
  });
  if (!script || !script.includes(CUBE_BEGIN) || !script.includes(CUBE_END)) {
    throw new Error('starterCubeScript: cube feature markers missing');
  }
  return script;
}

/**
 * Helpers that mutate an existing body. On an empty part they are refused
 * (compose returns null) rather than seeded with a hidden 40×30×20 cube.
 * Blocks, the contour solids, and a polar array of bores create their own body.
 */
export const HELPERS_NEED_BODY = Object.freeze(new Set([
  'addDraft', 'align', 'array3D', 'boolean', 'cboreHole', 'center', 'chamferEdges',
  'clearanceHole', 'crossSection', 'cskHole', 'cut', 'deleteFace', 'filletEdges', 'hole',
  'holePattern', 'mirror', 'move', 'moveFace', 'patternPoints', 'rotate', 'shell', 'sweepPath', 'tapDrillHole',
]));

/** True when this insert needs a body the empty buffer does not have. */
export function helperNeedsBody(id, params = null) {
  if (!HELPERS_NEED_BODY.has(id)) return false;
  // A polar array of bores builds its own part.
  if (id === 'array3D' && String(params?.arrayType ?? 'grid') === 'polar') return false;
  return true;
}

/** Default params object for an item (for modal initial state). */
export function defaultParamsFor(id) {
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === id);
  if (!item) return {};
  return mergeParams(item, null);
}

/**
 * @typedef {{ name: string, type: 'number'|'bool'|'select'|'body', default: any, label: string, options?: string[], step?: number, min?: number }} ParamDef
 * @typedef {{ id: string, label: string, group: string, title: string, bodyBase?: string, params: ParamDef[], build: Function, placeholder?: boolean }} PaletteItem
 */

function holeTypeKind(raw) {
  const s = str(raw, 'clearance');
  if (s === 'tapDrill' || s === 'tap drill' || s === 'tap') return 'tapDrill';
  return 'clearance';
}

function holeEndKind(raw) {
  const s = str(raw, 'none');
  if (s === 'cbore' || s === 'c-bore' || s === 'counterbore') return 'cbore';
  if (s === 'csk' || s === 'c-sink' || s === 'countersink') return 'csk';
  return 'none';
}

function negatedNumberLiteral(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Object.is(n, -0)) return '0';
  const r = +(-n).toFixed(6);
  return Object.is(r, -0) ? '0' : String(r);
}

/** Far face of `body` along `fr.normal`, normal flipped so it points outward. */
function emitFarFrameLines(body, fr, names) {
  const far = allocateUniqueName(names, 'frFar');
  return {
    frVar: far,
    lines: [
      `const ${far} = (() => {`,
      `  const bb = ${body}.boundingBox();`,
      `  const fn = ${fr}.normal, fc = ${fr}.center;`,
      `  const xs = [bb.min[0], bb.max[0]], ys = [bb.min[1], bb.max[1]], zs = [bb.min[2], bb.max[2]];`,
      `  let minW = Infinity;`,
      `  for (const x of xs) for (const y of ys) for (const z of zs) {`,
      `    const w = (x - fc[0]) * fn[0] + (y - fc[1]) * fn[1] + (z - fc[2]) * fn[2];`,
      `    if (w < minW) minW = w;`,
      `  }`,
      `  return {`,
      `    center: [fc[0] + fn[0] * minW, fc[1] + fn[1] * minW, fc[2] + fn[2] * minW],`,
      `    normal: [-fn[0], -fn[1], -fn[2]],`,
      `    x: ${fr}.x.slice(),`,
      `    y: [-${fr}.y[0], -${fr}.y[1], -${fr}.y[2]],`,
      `  };`,
      `})();`,
    ],
  };
}

/**
 * Unified Hole: clearance or tap drill, optional c-bore / c-sink on each end.
 * The four old palette ids stay callable; this is what the Hole button emits.
 */
function emitUnifiedHole(lines, body, p, names, faceCtx) {
  const kind = holeTypeKind(p.holeType);
  const size = str(p.size, 'M3');
  const fit = str(p.fit, 'normal');
  const diaExpr = kind === 'tapDrill'
    ? `fastenerTapDrillDia('${size}')`
    : `fastenerClearanceDia('${size}', '${fit}')`;
  const wp = resolveFeatureWorkplane(body, p, names, faceCtx);
  lines.push(...wp.lines);
  const fr = wp.frVar;
  // Depth applies on the default top face too. The old path replaced the
  // caller's params with { through: true } whenever no face was picked, so
  // a blind depth never reached the cutter.
  const reach = holeReachParams(p);
  const usePattern = faceCtx && faceCtx.type === 'planar' && bool(p.usePattern, false);
  if (usePattern) {
    const n = Math.max(1, Math.round(num(p.n, 3)));
    const m = Math.max(1, Math.round(num(p.m, 2)));
    const su = num(p.spacingU, 18);
    const sv = num(p.spacingV, 14);
    const cdVar = allocateUniqueName(names, '_cd');
    lines.push(`const ${cdVar} = ${diaExpr};`);
    if (reach.through === false) {
      const span = emitSpanExpr(body, fr, reach, names, allocateUniqueName, num);
      lines.push(...span.lines);
      lines.push(
        `${body} = holePattern(${body}, ${fr}, { n: ${n}, m: ${m}, spacingU: ${su}, spacingV: ${sv}, dia: ${cdVar}, span: ${span.spanExpr} });`,
      );
    } else {
      lines.push(
        `${body} = holePattern(${body}, ${fr}, { n: ${n}, m: ${m}, spacingU: ${su}, spacingV: ${sv}, dia: ${cdVar} });`,
      );
    }
    return;
  }
  const { u, v } = faceCtx ? uvForFace(p, faceCtx) : { u: num(p.u, 0), v: num(p.v, 0) };
  const span = emitSpanExpr(body, fr, reach, names, allocateUniqueName, num);
  lines.push(...span.lines);
  const near = holeEndKind(p.nearEnd);
  const far = holeEndKind(p.farEnd);
  let diaVar = null;
  const diaName = () => {
    if (!diaVar) {
      diaVar = allocateUniqueName(names, 'holeDia');
      lines.push(`const ${diaVar} = ${diaExpr};`);
    }
    return diaVar;
  };
  if (near === 'cbore') {
    const dia = num(p.nearCboreDia, 6.5);
    const depth = num(p.nearCboreDepth, 3.5);
    lines.push(
      `${body} = cboreHole(${body}, ${fr}, ${u}, ${v}, ${diaName()}, ${dia}, ${depth}, ${span.spanExpr});`,
    );
  } else if (near === 'csk') {
    const dia = num(p.nearCskDia, 6.5);
    const depth = num(p.nearCskDepth, 2);
    lines.push(
      `${body} = cskHole(${body}, ${fr}, ${u}, ${v}, ${diaName()}, ${dia}, ${depth}, ${span.spanExpr});`,
    );
  } else if (kind === 'tapDrill') {
    lines.push(`${body} = tapDrillHole(${body}, ${fr}, ${u}, ${v}, '${size}', ${span.spanExpr});`);
  } else {
    lines.push(
      `${body} = clearanceHole(${body}, ${fr}, ${u}, ${v}, '${size}', ${span.spanExpr}, '${fit}');`,
    );
  }
  if (far === 'none') return;
  const farFrame = emitFarFrameLines(body, fr, names);
  lines.push(...farFrame.lines);
  const spanFar = allocateUniqueName(names, 'spanFar');
  lines.push(`const ${spanFar} = holeSpan(${body}, ${farFrame.frVar});`);
  const fv = negatedNumberLiteral(v);
  if (far === 'cbore') {
    const dia = num(p.farCboreDia, 6.5);
    const depth = num(p.farCboreDepth, 3.5);
    lines.push(
      `${body} = cboreHole(${body}, ${farFrame.frVar}, ${u}, ${fv}, ${diaName()}, ${dia}, ${depth}, ${spanFar});`,
    );
  } else {
    const dia = num(p.farCskDia, 6.5);
    const depth = num(p.farCskDepth, 2);
    lines.push(
      `${body} = cskHole(${body}, ${farFrame.frVar}, ${u}, ${fv}, ${diaName()}, ${dia}, ${depth}, ${spanFar});`,
    );
  }
}

/**
 * One sweep blend per disjoint component. Every edge lookup is written
 * before the first filletAlongPath. That boolean merges or splits Manifold
 * faceIDs, so a later edgesBetween of the next corner throws
 * "no boundary between faces".
 * @returns {boolean} false when a component cannot be emitted
 */
function appendResolvedSweepBlends(feat, comps, emitEdge, emitBlend) {
  const prepared = [];
  for (const comp of comps) {
    if (!Array.isArray(comp) || !comp.length) continue;
    const edge = emitEdge(comp);
    if (!edge || !edge.ok) return false;
    prepared.push(edge);
  }
  if (!prepared.length) return false;
  for (const edge of prepared) feat.push(...edge.lines);
  for (const edge of prepared) emitBlend(edge);
  return true;
}

/** @type {PaletteItem[]} */
export const HELPER_PALETTE_ITEMS = [
  // ── Primitives ──────────────────────────────────────────────
  {
    id: 'cube',
    label: 'Cube',
    group: 'Primitives',
    title: 'Manifold.cube([x,y,z], center)',
    bodyBase: 'box',
    params: [
      { name: 'width', type: 'number', default: 40, label: 'Width', min: 0.1, step: 1 },
      { name: 'depth', type: 'number', default: 30, label: 'Depth', min: 0.1, step: 1 },
      { name: 'height', type: 'number', default: 20, label: 'Height', min: 0.1, step: 1 },
      { name: 'center', type: 'bool', default: true, label: 'Centered' },
      ...BLOCK_POSE_PARAMS,
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names) => {
      const box = allocateUniqueName(names, 'box');
      const spec = blockSpec('cube', p);
      const lines = wrapFeatureBlock(CUBE_BEGIN, CUBE_END, [
        `let ${box} = ${blockSolidExpression(spec)};`,
        // Append, never replace: a second shape unions onto the part, or
        // cuts it out when Mode is Subtract. Overwriting here used to
        // strand the previous solid as dead code.
        emitPartPlace(names, box, !empty && names.has('part'), true, spec.combine, solidMergeOn(p)),
      ]);
      return withReturn(lines, empty);
    },
  },
  {
    id: 'roundedBox',
    label: 'Round box',
    group: 'Primitives',
    title: 'roundedBox(size, radius, segments?)',
    bodyBase: 'rbox',
    params: [
      { name: 'sx', type: 'number', default: 50, label: 'Size X', min: 0.1, step: 1, description: 'Size along X in mm. width is the same axis and wins when both are set.' },
      { name: 'sy', type: 'number', default: 30, label: 'Size Y', min: 0.1, step: 1, description: 'Size along Y in mm. depth is the same axis and wins when both are set.' },
      { name: 'sz', type: 'number', default: 20, label: 'Size Z', min: 0.1, step: 1, description: 'Size along Z in mm. height is the same axis and wins when both are set.' },
      { name: 'edgeRadius', type: 'number', default: 4, label: 'Edge R', min: 0, step: 0.5 },
      { name: 'segments', type: 'number', default: 16, label: 'Segments', min: 1, step: 1 },
      ...BLOCK_POSE_PARAMS,
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names) => {
      const rbox = allocateUniqueName(names, 'rbox');
      const spec = blockSpec('roundedBox', p);
      const lines = wrapFeatureBlock(ROUNDED_BOX_BEGIN, ROUNDED_BOX_END, [
        `let ${rbox} = ${blockSolidExpression(spec)};`,
        emitPartPlace(names, rbox, !empty && names.has('part'), true, spec.combine, solidMergeOn(p)),
      ]);
      return withReturn(lines, empty);
    },
  },
  {
    id: 'cylinder',
    label: 'Cylinder',
    group: 'Primitives',
    title: 'Manifold.cylinder(height, rLow, rHigh, segments)',
    bodyBase: 'cyl',
    params: [
      { name: 'height', type: 'number', default: 20, label: 'Height', min: 0.1, step: 1 },
      { name: 'radius', type: 'number', default: 10, label: 'Radius', min: 0.1, step: 0.5 },
      { name: 'segments', type: 'number', default: 64, label: 'Segments', min: 3, step: 1 },
      ...BLOCK_POSE_PARAMS,
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names) => {
      const cyl = allocateUniqueName(names, 'cyl');
      const spec = blockSpec('cylinder', p);
      const lines = wrapFeatureBlock(CYLINDER_BEGIN, CYLINDER_END, [
        `let ${cyl} = ${blockSolidExpression(spec)};`,
        emitPartPlace(names, cyl, !empty && names.has('part'), true, spec.combine, solidMergeOn(p)),
      ]);
      return withReturn(lines, empty);
    },
  },
  {
    id: 'sphere',
    label: 'Sphere',
    group: 'Primitives',
    title: 'Manifold.sphere(radius, segments)',
    bodyBase: 'sphere',
    params: [
      { name: 'radius', type: 'number', default: 15, label: 'Radius', min: 0.1, step: 0.5 },
      { name: 'segments', type: 'number', default: 64, label: 'Segments', min: 3, step: 1, max: 128 },
      ...BLOCK_POSE_PARAMS,
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names) => {
      const sph = allocateUniqueName(names, 'sphere');
      const spec = blockSpec('sphere', p);
      const lines = wrapFeatureBlock(SPHERE_BEGIN, SPHERE_END, [
        `let ${sph} = ${blockSolidExpression(spec)};`,
        emitPartPlace(names, sph, !empty && names.has('part'), true, spec.combine, solidMergeOn(p)),
      ]);
      return withReturn(lines, empty);
    },
  },
  {
    id: 'tube',
    label: 'Tube',
    group: 'Primitives',
    title: 'tube(outerRadius, innerRadius, height, segments?) — round or rectangular',
    bodyBase: 'tube',
    params: [
      {
        name: 'section', type: 'select', default: 'round', label: 'Section',
        options: [{ value: 'round', label: 'round' }, { value: 'rect', label: 'rectangular' }],
      },
      {
        name: 'outerRadius', type: 'number', default: 15, label: 'Outer R', min: 0.1, step: 0.5,
        showWhen: { field: 'section', values: ['round'] },
      },
      {
        name: 'innerRadius', type: 'number', default: 10, label: 'Inner R', min: 0, step: 0.5,
        showWhen: { field: 'section', values: ['round'] },
      },
      { name: 'height', type: 'number', default: 40, label: 'Height', min: 0.1, step: 1 },
      {
        name: 'segments', type: 'number', default: 64, label: 'Segments', min: 3, step: 1, max: 128,
        showWhen: { field: 'section', values: ['round'] },
      },
      // Rectangular section: outer w x d plus a uniform wall, corners optional.
      {
        name: 'width', type: 'number', default: 40, label: 'Width', min: 0.1, step: 1,
        showWhen: { field: 'section', values: ['rect'] },
      },
      {
        name: 'depth', type: 'number', default: 20, label: 'Depth', min: 0.1, step: 1,
        showWhen: { field: 'section', values: ['rect'] },
      },
      {
        name: 'wall', type: 'number', default: 2.5, label: 'Wall', min: 0.1, step: 0.25,
        showWhen: { field: 'section', values: ['rect'] },
      },
      {
        name: 'cornerRadius', type: 'number', default: 0, label: 'Corner R', min: 0, step: 0.5,
        showWhen: { field: 'section', values: ['rect'] },
      },
      ...BLOCK_POSE_PARAMS,
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names) => {
      const tubeName = allocateUniqueName(names, 'tube');
      const spec = blockSpec('tube', p);
      const lines = [
        `let ${tubeName} = ${blockSolidExpression(spec)};`,
        emitPartPlace(names, tubeName, !empty && names.has('part'), true, spec.combine, solidMergeOn(p)),
      ];
      return withReturn(wrapFeatureBlock(TUBE_BEGIN, TUBE_END, lines), empty);
    },
  },
  {
    id: 'hexPrism',
    label: 'Hex',
    group: 'Primitives',
    title: 'hexPrism(radius, height)',
    bodyBase: 'hex',
    params: [
      { name: 'radius', type: 'number', default: 12, label: 'Radius', min: 0.1, step: 0.5 },
      { name: 'height', type: 'number', default: 8, label: 'Height', min: 0.1, step: 0.5 },
      ...BLOCK_POSE_PARAMS,
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names) => {
      const hex = allocateUniqueName(names, 'hex');
      const spec = blockSpec('hexPrism', p);
      const lines = wrapFeatureBlock(HEX_PRISM_BEGIN, HEX_PRISM_END, [
        `let ${hex} = ${blockSolidExpression(spec)};`,
        emitPartPlace(names, hex, !empty && names.has('part'), true, spec.combine, solidMergeOn(p)),
      ]);
      return withReturn(lines, empty);
    },
  },

  // ── Features ────────────────────────────────────────────────
  {
    id: 'filletEdges',
    label: 'Fillet',
    group: 'Features',
    title: 'filletEdges / filletAlongPath — Strategy sweep (default) | planar',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      {
        name: 'strategy', type: 'select', default: 'sweep', label: 'Strategy',
        options: ['sweep', 'planar', 'auto'],
      },
      { name: 'radius', type: 'number', default: 3, label: 'Radius', min: 0.01, step: 0.5 },
      { name: 'sphericalCorners', type: 'bool', default: true, label: 'Spherical corners' },
      {
        name: 'profile', type: 'select', default: 'fillet', label: 'Sweep profile',
        options: ['fillet', 'chamfer'],
      },
      { name: 'reverse', type: 'bool', default: false, label: 'Reverse path' },
    ],
    build: (empty, p, names, buffer, faceCtx = null, edgeCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const r = num(p.radius, 3);
      // Sweep is the universal default (and auto). Planar is manual override.
      // No picked wire → classic filletEdges (script-style / all-convex / face scope).
      const hasPicked = Array.isArray(edgeCtx) && edgeCtx.length > 0;
      let strategy = resolveFilletStrategy(p.strategy != null ? str(p.strategy, 'sweep') : 'sweep');
      if (strategy === 'sweep' && !hasPicked) strategy = 'planar';
      const feat = [];
      // Strategy=sweep → makeSweepPath + filletAlongPath (easy / curved-adjacent).
      // Strategy=planar → classic filletEdges for planar–planar edges.
      // Hard Accept (C3): _hardVariableProfile → same sweep path with
      // variableProfile:true (densified path-normal inscribed-arc frames).
      const hardVariable = !!p._hardVariableProfile;
      if (strategy === 'sweep' || hardVariable) {
        // Disjoint picks → one makeSweepPath + filletAlongPath per contiguous
        // component (connected chains still emit a single pair). Branch/Y
        // junctions still soft-fail (null → no broken JS).
        const split = splitEdgePathComponents(edgeCtx || []);
        if (!split.ok) return null;
        const comps = split.components;
        if (!comps.length || !comps.some((c) => Array.isArray(c) && c.length)) return null;
        const rev = bool(p.reverse, false);
        const optsPath = rev ? ', { reverse: true }' : '';
        const profile = str(p.profile, 'fillet');
        const sweepBits = [];
        if (profile === 'chamfer') sweepBits.push(`profile: 'chamfer'`);
        if (hardVariable) sweepBits.push('variableProfile: true');
        const sweepOpts = sweepBits.length ? `, { ${sweepBits.join(', ')} }` : '';
        const sweepNote = hardVariable
          ? ' // hard: variable-profile inscribed-arc sweep (C3)'
          : ' // sweep fillet wedge';
        const wrote = appendResolvedSweepBlends(
          feat,
          comps,
          (comp) => emitNamedEdgeLines(body, comp, names, allocateUniqueName)
            || emitFilletBoundaryLines(body, comp, names, allocateUniqueName)
            || emitSelectedEdgeLiteralLines(body, comp, names, allocateUniqueName),
          (edge) => {
            const path = allocateUniqueName(names, 'path');
            feat.push(`const ${path} = makeSweepPath(${edge.edgesExpr}${optsPath}); // edge→sweep path`);
            feat.push(
              `${body} = filletAlongPath(${body}, ${path}, ${r}${sweepOpts});${sweepNote}`,
            );
          },
        );
        if (!wrote) return null;
        if (!feat.some((ln) => /filletAlongPath\s*\(/.test(ln))) return null;
        feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      } else {
        const sc = bool(p.sphericalCorners, true);
        let edgesExpr = `convexEdges(${body})`;
        const scope = p.edgeScope || (edgeCtx && edgeCtx.length ? 'selected' : (faceCtx ? 'face' : 'allConvex'));
        if (scope === 'selected' || (edgeCtx && edgeCtx.length && scope !== 'face' && scope !== 'allConvex')) {
          const edge = emitSelectedEdgeLines(body, edgeCtx || [], names, allocateUniqueName);
          // Soft-fail: never write throw/partial JS — caller clears stale selection.
          if (!edge || !edge.ok) return null;
          feat.push(...edge.lines);
          edgesExpr = edge.edgesExpr;
        } else if (faceCtx && faceCtx.type !== 'irregular' && scope !== 'allConvex') {
          const edge = emitFaceEdgeLines(body, faceCtx, { ...p, edgeScope: 'face' }, names, allocateUniqueName);
          feat.push(...edge.lines);
          edgesExpr = edge.edgesExpr;
        } else if (scope === 'allConvex') {
          edgesExpr = `convexEdges(${body})`;
        }
        feat.push(
          `${body} = filletEdges(${body}, ${edgesExpr}, ${r}, { sphericalCorners: ${sc} });`,
        );
        feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      }
      // Slice 27 + Slice A: always wrap so the feature strip shows Fillet chips
      // for both in-mode Accept and one-shot palette Confirm.
      lines.push(...wrapFeatureBlock(FILLET_MODE_BEGIN, FILLET_MODE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'chamferEdges',
    label: 'Chamfer',
    group: 'Features',
    title: 'chamferEdges / filletAlongPath(profile:chamfer) — equal-leg bevel',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'chamfer', type: 'number', default: 2, label: 'Chamfer', min: 0.01, step: 0.5 },
    ],
    build: (empty, p, names, buffer, faceCtx = null, edgeCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const c = num(p.chamfer, 2);
      const feat = [];
      const hasPicked = Array.isArray(edgeCtx) && edgeCtx.length > 0;
      const scope = p.edgeScope || (hasPicked ? 'selected' : (faceCtx ? 'face' : 'allConvex'));
      // In-mode / selected wire → path chamfer (continuous bevel, disjoint
      // components OK). Script-style allConvex / face scope keeps classic
      // chamferEdges for bulk planar edges.
      if (scope === 'selected' || (hasPicked && scope !== 'face' && scope !== 'allConvex')) {
        const split = splitEdgePathComponents(edgeCtx || []);
        if (!split.ok) return null;
        const comps = split.components;
        if (!comps.length || !comps.some((comp) => Array.isArray(comp) && comp.length)) return null;
        const wrote = appendResolvedSweepBlends(
          feat,
          comps,
          (comp) => emitNamedEdgeLines(body, comp, names, allocateUniqueName)
            || emitFilletBoundaryLines(body, comp, names, allocateUniqueName)
            || emitSelectedEdgeLiteralLines(body, comp, names, allocateUniqueName),
          (edge) => {
            const path = allocateUniqueName(names, 'path');
            feat.push(`const ${path} = makeSweepPath(${edge.edgesExpr}); // edge→sweep path`);
            feat.push(
              `${body} = filletAlongPath(${body}, ${path}, ${c}, { profile: 'chamfer' }); // sweep chamfer wedge`,
            );
          },
        );
        if (!wrote) return null;
        if (!feat.some((ln) => /filletAlongPath\s*\(/.test(ln))) return null;
        feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      } else {
        let edgesExpr = `convexEdges(${body})`;
        const namedFace = typeof faceCtx?.name === 'string' && faceCtx.name;
        // A face pick is that face's boundary only. An irregular region with
        // no name used to fall through to every convex edge and shred a
        // holed faceplate. A named face, irregular or not, is edgesOf.
        if (faceCtx && scope !== 'allConvex') {
          if (faceCtx.type === 'irregular' && !namedFace) return null;
          const edge = emitFaceEdgeLines(body, faceCtx, { ...p, edgeScope: 'face' }, names, allocateUniqueName);
          feat.push(...edge.lines);
          edgesExpr = edge.edgesExpr;
        }
        feat.push(`${body} = chamferEdges(${body}, ${edgesExpr}, ${c});`);
        feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      }
      // Slice A: always wrap so Chamfer chips appear for mode + one-shot.
      lines.push(...wrapFeatureBlock(CHAMFER_MODE_BEGIN, CHAMFER_MODE_END, feat));
      return withReturn(lines, empty);
    },
  },

  {
    id: 'crossSection',
    label: 'Create contour',
    group: 'Advanced',
    title: 'makeCrossSection(plane, profile) — reusable plane + 2D profile',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      {
        name: 'profileType', type: 'select', default: 'circle', label: 'Profile',
        options: ['circle', 'rectangle', 'polygon'],
      },
      { name: 'radius', type: 'number', default: 5, label: 'Radius', min: 0.1, step: 0.5, slider: true },
      { name: 'segments', type: 'number', default: 64, label: 'Segments', min: 3, step: 1, max: 128 },
      { name: 'width', type: 'number', default: 20, label: 'Width', min: 0.1, step: 1, slider: true },
      { name: 'height', type: 'number', default: 12, label: 'Height', min: 0.1, step: 1, slider: true },
      { name: 'centered', type: 'bool', default: true, label: 'Centered' },
      {
        name: 'polygonPreset', type: 'select', default: 'hexagon', label: 'Polygon',
        options: [...Object.keys(REGULAR_POLYGON_PRESETS), 'quarterCircle'],
      },
    ],
    build: (empty, p, names, buffer, faceCtx = null, edgeCtx = null) => {
      // New-body Extrude / Revolve / Loft / Sweep Confirm: no starter cube, no host query.
      // Plane is a literal PlaneFrame; part is replaced (not added onto).
      const isNewBodySolid = !!(p._contourRevolve || p._contourExtrude || p._contourLoft || p._contourSweep);
      // Capture before resolveBody, which always touches `part` in the names set.
      const partDeclared = names.has('part');
      // Planar face → selected workplane; else default +Z top face.
      const planarCtx = faceCtx && faceCtx.type === 'planar' ? faceCtx : null;
      // Profile Confirm on a script with no solid must not invent the 40×30×20
      // host cube. That cube declares `part`, so the following Extrude unions
      // onto it instead of emitting `let part = placeInFrame`.
      // A picked planar face is a literal frame too: workplaneFromFace is
      // opaque to listSavedContours, so a host-query profile read back
      // plane-less and ghosted on the default +Z top instead of the pick.
      const frameOnlyProfile = !!p._contourMode && (!partDeclared || !!planarCtx);
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      let wp;
      if (isNewBodySolid || frameOnlyProfile) {
        const plane = frameOnlyProfile
          ? (p._contourPlane || literalPlaneFromFace(planarCtx))
          : (p._contourRevolve?.plane
          || p._contourExtrude?.plane
          || p._contourLoft?.plane
          || p._contourSweep?.plane
          || null);
        const fr = allocateUniqueName(names, 'fr');
        wp = {
          lines: [`const ${fr} = ${emitPlaneFrameLiteral(plane)};`],
          frVar: fr,
        };
      } else {
        wp = planarCtx
          ? emitFaceWorkplaneLines(body, planarCtx, names, allocateUniqueName)
          : emitDefaultTopWorkplane(body, names);
      }
      const fr = wp.frVar;
      const xs = allocateUniqueName(names, 'xs');
      const profileExpr = emitProfileExprFromParams(p);
      // Substrate only — named let for later edge→sweep / fillet / extrude slices.
      const profileLine = `const ${xs} = makeCrossSection(${fr}, ${profileExpr}); // plane+profile substrate`;
      // Loft Confirm names each contour. The station offset is applied in
      // the makeLoft argument, not baked into the contour frame. Isolate
      // station fields so a parent radius cannot rewrite every profile.
      // golden:slice28 pins composeHelperInsert with parent radius ≠ P2.
      if (p._contourLoft && Array.isArray(p._contourLoft.profiles)) {
        const loftProfiles = p._contourLoft.profiles;
        const shared = p._contourLoft.plane;
        const fallback = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
        const stations = [];
        const frames = [];
        for (const prof of loftProfiles) {
          const owns = _loftOwnsPlane(prof);
          const frame = owns ? prof.plane : (shared || fallback);
          frames.push(frame);
          const name = takeContourName(names);
          const isolated = isolateLoftStationParams(prof);
          const offset = owns ? 0 : (Number(prof.offset) || 0);
          lines.push(
            `const ${name} = makeCrossSection(${emitPlaneFrameLiteral(frame)}, ${emitProfileExprFromParams(isolated)}); // @contour id=${name}`,
          );
          stations.push({ name, offset });
        }
        const featureId = mintBlockId(findFeatureBlocks(buffer, CONTOUR_LOFT_BEGIN, CONTOUR_LOFT_END), 'loft');
        lines.push(...emitLoftReferenceLines({
          begin: CONTOUR_LOFT_BEGIN,
          end: CONTOUR_LOFT_END,
          featureId,
          stations,
          placeIndex: loftReferencePlaceIndex(frames, stations.map((s) => s.offset)),
          partLine: (expr) => emitPartPlace(
            names,
            expr,
            partDeclared,
            partDeclared,
            solidCombineOp(p._contourLoft),
            solidMergeOn(p._contourLoft),
          ),
        }));
      } else if (p._contourRevolve) {
        const rev = p._contourRevolve;
        const name = takeContourName(names);
        const featureId = mintBlockId(findFeatureBlocks(buffer, CONTOUR_REVOLVE_BEGIN, CONTOUR_REVOLVE_END), 'revolve');
        lines.push(
          `const ${name} = makeCrossSection(${emitPlaneFrameLiteral(rev.plane)}, ${profileExpr}); // @contour id=${name}`,
        );
        lines.push(...emitRevolveReferenceLines({
          begin: CONTOUR_REVOLVE_BEGIN,
          end: CONTOUR_REVOLVE_END,
          featureId,
          contour: name,
          rU: num(rev.rU, 1),
          rV: num(rev.rV, 0),
          aU: num(rev.aU, 0),
          aV: num(rev.aV, 1),
          segments: Math.max(3, Math.round(num(rev.segments, 96))),
          angle: num(rev.angle, 360),
          startDeg: num(rev.startDeg, 0),
          partLine: (expr) => emitPartPlace(
            names,
            expr,
            partDeclared,
            partDeclared,
            solidCombineOp(p._contourRevolve),
            solidMergeOn(p._contourRevolve),
          ),
        }));
      } else if (p._contourExtrude) {
        const ext = p._contourExtrude;
        const distance = num(ext.distance, 10);
        const sense = str(ext.sense, 'positive');
        let w = 0;
        if (sense === 'negative') w = -distance;
        else if (sense === 'both') w = -distance / 2;
        w = +Number(w).toFixed(4);
        const name = takeContourName(names);
        const featureId = mintBlockId(findFeatureBlocks(buffer, CONTOUR_EXTRUDE_BEGIN, CONTOUR_EXTRUDE_END), 'extrude');
        lines.push(
          `const ${name} = makeCrossSection(${emitPlaneFrameLiteral(ext.plane)}, ${profileExpr}); // @contour id=${name}`,
        );
        lines.push(...emitExtrudeReferenceLines({
          begin: CONTOUR_EXTRUDE_BEGIN,
          end: CONTOUR_EXTRUDE_END,
          featureId,
          contour: name,
          distance,
          w,
          partLine: (expr) => emitPartPlace(
            names,
            expr,
            partDeclared,
            partDeclared,
            solidCombineOp(p._contourExtrude),
            solidMergeOn(p._contourExtrude),
          ),
        }));
      } else if (p._contourSweep) {
        const sw = p._contourSweep;
        const ordered = assembleSweepPath(edgeCtx || [], { reverse: !!sw.reverse });
        if (!ordered.ok) return null;
        const frame = sweepPathFrame(ordered.value.points);
        if (!frame) return null;
        const profileName = takeContourName(names);
        const pathName = takeContourName(names);
        const featureId = mintBlockId(findFeatureBlocks(buffer, CONTOUR_SWEEP_BEGIN, CONTOUR_SWEEP_END), 'sweep');
        const localName = allocateUniqueName(names, 'sweepLocal');
        const sweptName = allocateUniqueName(names, 'swept');
        lines.push(
          `const ${profileName} = makeCrossSection(${emitPlaneFrameLiteral(sw.plane)}, ${profileExpr}); // @contour id=${profileName}`,
        );
        lines.push(
          `const ${pathName} = makeCrossSection(${emitPlaneFrameLiteral(frame)}, ${emitPathProfileExpr(projectPathUv(ordered.value.points, frame), !!ordered.value.closed)}); // @contour id=${pathName}`,
        );
        lines.push(...emitSweepReferenceLines({
          begin: CONTOUR_SWEEP_BEGIN,
          end: CONTOUR_SWEEP_END,
          featureId,
          profile: profileName,
          path: pathName,
          localName,
          sweptName,
          partLine: (expr) => emitPartPlace(
            names,
            expr,
            partDeclared,
            partDeclared,
            solidCombineOp(p._contourSweep),
            solidMergeOn(p._contourSweep),
          ),
        }));
      } else if (p._contourMode) {
        // Slice 24: wrap in-mode Profile so Confirm replaces the region (no Extrude).
        lines.push(CONTOUR_PROFILE_BEGIN);
        lines.push(...wp.lines);
        lines.push(profileLine);
        lines.push(CONTOUR_PROFILE_END);
      } else {
        // Slice A: one-shot Create contour still gets a Profile strip chip.
        lines.push(...wrapFeatureBlock(CONTOUR_PROFILE_BEGIN, CONTOUR_PROFILE_END, [
          ...wp.lines,
          profileLine,
        ]));
      }
      return withReturn(lines, empty);
    },
  },
  {
    id: 'sweepPath',
    label: 'Path',
    group: 'Features',
    // No rail button of its own: Sweep covers the user-facing case and wears
    // this entry's old Route glyph. The item stays because the edge→wire
    // codegen is still reached programmatically (filletAlongPath, sweepPoints)
    // and `composeHelperInsert('sweepPath')` is the seam the goldens drive.
    railHidden: true,
    title: 'makeSweepPath(edges) — ordered sweep path / wire from edges',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'reverse', type: 'bool', default: false, label: 'Reverse direction' },
    ],
    build: (empty, p, names, buffer, _ = null, edgeCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const edge = emitSelectedEdgeLiteralLines(body, edgeCtx || [], names, allocateUniqueName);
      // Soft-fail: never write throw/partial JS — caller clears stale selection.
      if (!edge.ok) return null;
      lines.push(...edge.lines);
      const path = allocateUniqueName(names, 'path');
      const rev = bool(p.reverse, false);
      const opts = rev ? ', { reverse: true }' : '';
      // Path value — consume with filletAlongPath (Slice 23) or sweepPoints.
      // Literal wire (not convexEdges mid-match) so post-fillet G1 chains stay contiguous.
      lines.push(`const ${path} = makeSweepPath(${edge.edgesExpr}${opts}); // edge→sweep path`);
      return withReturn(lines, empty);
    },
  },
  {
    id: 'hole',
    label: 'Hole',
    group: 'Features',
    title: 'Hole — clearance or tap drill on a contour, with optional c-bore / c-sink on each end',
    // `pattern: true` is what retired the separate Hole grid button: tick
    // "n×m pattern" here and the build emits holePattern() instead of a single
    // hole (the c-bore / c-sink end fields hide themselves, since a pattern
    // takes one diameter).
    params: holeFeatureParamDefs({ uv: true, pattern: true }),
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const feat = [];
      emitUnifiedHole(feat, body, p, names, faceCtx);
      feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      lines.push(...wrapFeatureBlock(HOLE_BEGIN, HOLE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'holePattern',
    label: 'Hole grid',
    group: 'Features',
    // No button: Hole covers this with its n×m pattern option. The entry stays
    // because its build is still composed programmatically and by the goldens.
    railHidden: true,
    title: 'holePattern(part, frame, { n, m, spacingU, spacingV, dia })',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'n', type: 'number', default: 3, label: 'Count U', min: 1, step: 1 },
      { name: 'm', type: 'number', default: 2, label: 'Count V', min: 1, step: 1 },
      { name: 'spacingU', type: 'number', default: 18, label: 'Spacing U', min: 0.1, step: 1 },
      { name: 'spacingV', type: 'number', default: 14, label: 'Spacing V', min: 0.1, step: 1 },
      { name: 'dia', type: 'number', default: 4, label: 'Diameter', min: 0.1, step: 0.5 },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const n = Math.max(1, Math.round(num(p.n, 3)));
      const m = Math.max(1, Math.round(num(p.m, 2)));
      const su = num(p.spacingU, 18);
      const sv = num(p.spacingV, 14);
      const dia = num(p.dia, 4);
      const wp = resolveFeatureWorkplane(body, p, names, faceCtx);
      const feat = [
        ...wp.lines,
        `${body} = holePattern(${body}, ${wp.frVar}, { n: ${n}, m: ${m}, spacingU: ${su}, spacingV: ${sv}, dia: ${dia} });`,
        ...syncPartLines(body, names, hasPartDecl([...lines, ...wp.lines], empty)),
      ];
      lines.push(...wrapFeatureBlock(HOLE_PATTERN_BEGIN, HOLE_PATTERN_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'clearanceHole',
    label: 'Clearance',
    group: 'Features',
    railHidden: true,
    title: "clearanceHole(part, frame, u, v, size, span?, fit?)",
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'size', type: 'select', default: 'M3', label: 'Size', options: FASTENER_SIZE_OPTIONS },
      { name: 'fit', type: 'select', default: 'normal', label: 'Fit', options: FIT_OPTIONS },
      { name: 'u', type: 'number', default: 0, label: 'U', step: 1 },
      { name: 'v', type: 'number', default: 0, label: 'V', step: 1 },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const size = str(p.size, 'M3');
      const fit = str(p.fit, 'normal');
      const wp = resolveFeatureWorkplane(body, p, names, faceCtx);
      const feat = [...wp.lines];
      const fr = wp.frVar;
      const usePattern = faceCtx && faceCtx.type === 'planar' && bool(p.usePattern, false);
      if (usePattern) {
        const n = Math.max(1, Math.round(num(p.n, 3)));
        const m = Math.max(1, Math.round(num(p.m, 2)));
        const su = num(p.spacingU, 18);
        const sv = num(p.spacingV, 14);
        const cdVar = allocateUniqueName(names, '_cd');
        feat.push(`const ${cdVar} = fastenerClearanceDia('${size}', '${fit}');`);
        feat.push(
          `${body} = holePattern(${body}, ${fr}, { n: ${n}, m: ${m}, spacingU: ${su}, spacingV: ${sv}, dia: ${cdVar} });`,
        );
      } else {
        const { u, v } = faceCtx ? uvForFace(p, faceCtx) : { u: num(p.u, 0), v: num(p.v, 0) };
        const span = emitSpanExpr(body, fr, faceCtx ? p : { through: true }, names, allocateUniqueName, num);
        feat.push(...span.lines);
        feat.push(`${body} = clearanceHole(${body}, ${fr}, ${u}, ${v}, '${size}', ${span.spanExpr}, '${fit}');`);
      }
      feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      lines.push(...wrapFeatureBlock(CLEARANCE_HOLE_BEGIN, CLEARANCE_HOLE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'tapDrillHole',
    label: 'Tap drill',
    group: 'Features',
    railHidden: true,
    title: 'tapDrillHole(part, frame, u, v, size, span?)',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'size', type: 'select', default: 'M3', label: 'Size', options: FASTENER_SIZE_OPTIONS },
      { name: 'u', type: 'number', default: 0, label: 'U', step: 1 },
      { name: 'v', type: 'number', default: 0, label: 'V', step: 1 },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const size = str(p.size, 'M3');
      const { u, v } = faceCtx ? uvForFace(p, faceCtx) : { u: num(p.u, 0), v: num(p.v, 0) };
      const wp = resolveFeatureWorkplane(body, p, names, faceCtx);
      const feat = [...wp.lines];
      const fr = wp.frVar;
      // Omit the span on a through hole so the default script stays
      // tapDrillHole(..., size) and the kernel uses holeSpan. A blind
      // depth writes the number. A face pick is not required.
      const reach = holeReachParams(p);
      if (reach.through === false) {
        const span = emitSpanExpr(body, fr, reach, names, allocateUniqueName, num);
        feat.push(...span.lines);
        feat.push(`${body} = tapDrillHole(${body}, ${fr}, ${u}, ${v}, '${size}', ${span.spanExpr});`);
      } else {
        feat.push(`${body} = tapDrillHole(${body}, ${fr}, ${u}, ${v}, '${size}');`);
      }
      feat.push(...syncPartLines(body, names, hasPartDecl([...lines, ...feat], empty)));
      lines.push(...wrapFeatureBlock(TAP_DRILL_HOLE_BEGIN, TAP_DRILL_HOLE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'cboreHole',
    label: 'Cbore',
    group: 'Features',
    railHidden: true,
    title: 'cboreHole(part, frame, u, v, diaThru, diaCbore, cboreDepth, span)',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'diaThru', type: 'number', default: 5.5, label: 'Thru Ø', min: 0.1, step: 0.1 },
      { name: 'diaCbore', type: 'number', default: 10, label: 'Cbore Ø', min: 0.1, step: 0.1 },
      { name: 'cboreDepth', type: 'number', default: 4, label: 'Cbore depth', min: 0.1, step: 0.5 },
      { name: 'u', type: 'number', default: 0, label: 'U', step: 1 },
      { name: 'v', type: 'number', default: 0, label: 'V', step: 1 },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const diaThru = num(p.diaThru, 5.5);
      const diaCbore = num(p.diaCbore, 10);
      const cboreDepth = num(p.cboreDepth, 4);
      const { u, v } = faceCtx ? uvForFace(p, faceCtx) : { u: num(p.u, 0), v: num(p.v, 0) };
      const wp = resolveFeatureWorkplane(body, p, names, faceCtx);
      const fr = wp.frVar;
      const span = emitSpanExpr(body, fr, faceCtx ? p : { through: true }, names, allocateUniqueName, num);
      const feat = [
        ...wp.lines,
        ...span.lines,
        `${body} = cboreHole(${body}, ${fr}, ${u}, ${v}, ${diaThru}, ${diaCbore}, ${cboreDepth}, ${span.spanExpr});`,
        ...syncPartLines(body, names, hasPartDecl([...lines, ...wp.lines, ...span.lines], empty)),
      ];
      lines.push(...wrapFeatureBlock(CBORE_HOLE_BEGIN, CBORE_HOLE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'cskHole',
    label: 'Csk',
    group: 'Features',
    railHidden: true,
    title: 'cskHole(part, frame, u, v, diaThru, diaCsk, cskDepth, span)',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'diaThru', type: 'number', default: 3.4, label: 'Thru Ø', min: 0.1, step: 0.1 },
      { name: 'diaCsk', type: 'number', default: 6.5, label: 'Csk Ø', min: 0.1, step: 0.1 },
      { name: 'cskDepth', type: 'number', default: 2, label: 'Csk depth', min: 0.1, step: 0.5 },
      { name: 'u', type: 'number', default: 0, label: 'U', step: 1 },
      { name: 'v', type: 'number', default: 0, label: 'V', step: 1 },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const diaThru = num(p.diaThru, 3.4);
      const diaCsk = num(p.diaCsk, 6.5);
      const cskDepth = num(p.cskDepth, 2);
      const { u, v } = faceCtx ? uvForFace(p, faceCtx) : { u: num(p.u, 0), v: num(p.v, 0) };
      const wp = resolveFeatureWorkplane(body, p, names, faceCtx);
      const fr = wp.frVar;
      const span = emitSpanExpr(body, fr, faceCtx ? p : { through: true }, names, allocateUniqueName, num);
      const feat = [
        ...wp.lines,
        ...span.lines,
        `${body} = cskHole(${body}, ${fr}, ${u}, ${v}, ${diaThru}, ${diaCsk}, ${cskDepth}, ${span.spanExpr});`,
        ...syncPartLines(body, names, hasPartDecl([...lines, ...wp.lines, ...span.lines], empty)),
      ];
      lines.push(...wrapFeatureBlock(CSK_HOLE_BEGIN, CSK_HOLE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'shell',
    label: 'Shell',
    group: 'Features',
    title: "hollow(manifold, wall, opening) — face-pick opening (or Closed); uniform wall",
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'wall', type: 'number', default: 2.5, label: 'Wall', min: 0.1, step: 0.25, slider: true },
      {
        name: 'openScope', type: 'select', default: 'z', label: 'Opening',
        options: SHELL_OPENING_OPTIONS,
      },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const wall = num(p.wall, 2.5);
      const face = faceCtx && faceCtx.type ? faceCtx : (faceCtx ? classifySelectedFace(faceCtx) : null);
      // Legacy sheets sent `axis`; the face-aware sheet sends `openScope`.
      const scope = str(p.openScope, str(p.axis, 'z'));
      const opening = emitFaceSelectionExpr(face, scope);
      // hollow() is subtract(shell(...)) in one boolean — same uniform wall.
      const feat = [
        `${body} = hollow(${body}, ${wall}, ${opening});`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(SHELL_BEGIN, SHELL_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'cut',
    label: 'Cut',
    group: 'Features',
    title: 'cut(manifold, plane, { keep, bodies, drop }) — split bodies on a plane; kept pieces stay separate',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const face = faceCtx && faceCtx.type ? faceCtx : (faceCtx ? classifySelectedFace(faceCtx) : null);
      // A picked face is its own plane. No face → explicit XY through the origin,
      // not a guess about which face the user meant.
      const planeLit = (face && Array.isArray(face.center) && Array.isArray(face.normal)
        && face.type !== 'cylindrical' && face.type !== 'irregular')
        ? `{ center: ${formatVec3(face.center)}, normal: ${formatVec3(face.normal)} }`
        : '{ normal: [0, 0, 1], originOffset: 0 }';
      const feat = [
        `${body} = cut(${body}, ${planeLit});`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(CUT_BEGIN, CUT_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'boolean',
    label: 'Boolean',
    group: 'Features',
    title: 'booleanBodies(manifold, { op, bodies, drop }) — union, difference, or intersect. Intersect can drop leftover pieces.',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      {
        name: 'op', type: 'select', default: 'union', label: 'Operation',
        options: [
          { value: 'union', label: 'Union' },
          { value: 'difference', label: 'Difference' },
          { value: 'intersect', label: 'Intersect' },
        ],
      },
    ],
    // The rail enters Boolean mode. This build is the sequential-compose
    // fallback: every body, in decompose order. The mode chip names the bodies.
    build: (empty, p, names, buffer) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const op = ['difference', 'intersect'].includes(String(p.op)) ? String(p.op) : 'union';
      const feat = [
        `${body} = booleanBodies(${body}, { op: '${op}' });`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(BOOLEAN_BEGIN, BOOLEAN_END, feat));
      return withReturn(lines, empty);
    },
  },

  // ── Transforms / layout ─────────────────────────────────────
  {
    id: 'move',
    label: 'Move',
    group: 'Transforms',
    title: 'move(manifold, [dx, dy, dz], { bodies }) — translate one body by a delta',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      // Hard cap only (POSITION_LIMIT_MM); the card's slider range is helperFieldSpec's.
      { name: 'dx', type: 'number', default: 0, label: 'X', min: -POSITION_LIMIT_MM, max: POSITION_LIMIT_MM, step: 0.5, slider: true },
      { name: 'dy', type: 'number', default: 0, label: 'Y', min: -POSITION_LIMIT_MM, max: POSITION_LIMIT_MM, step: 0.5, slider: true },
      { name: 'dz', type: 'number', default: 0, label: 'Z', min: -POSITION_LIMIT_MM, max: POSITION_LIMIT_MM, step: 0.5, slider: true },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const dx = num(p.dx, 0);
      const dy = num(p.dy, 0);
      const dz = num(p.dz, 0);
      // The agent path resolves the body first (insert_move at / face /
      // face_id / body_index / selection) and hands its centroid in as
      // params.at. The face center and the origin are only legacy fallbacks.
      const picked = Array.isArray(p.at) && p.at.length >= 3 ? p.at.slice(0, 3).map(Number) : null;
      const at = picked && picked.every(Number.isFinite)
        ? picked
        : ((faceCtx && Array.isArray(faceCtx.center)) ? faceCtx.center : [0, 0, 0]);
      const feat = [
        `${body} = move(${body}, [${dx}, ${dy}, ${dz}], { bodies: [{ at: ${formatVec3(at)} }] });`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(MOVE_BEGIN, MOVE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'rotate',
    label: 'Rotate',
    group: 'Transforms',
    title: 'rotateAbout(manifold, axis, angleDeg, center, { bodies }) — turn one body about an axis through a point',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'axis', type: 'axis', default: 'z', label: 'Axis' },
      { name: 'angle', type: 'number', default: 90, label: 'Angle (deg)', min: -360, max: 360, step: 1, slider: true },
      { name: 'center', type: 'vec3', default: null, label: 'Center [x, y, z] (the body centroid when omitted)' },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const axis = rotateAxisLiteral(p.axis);
      if (!axis) return null;
      const angle = num(p.angle, 0);
      const center = rotateCenterLiteral(p.center);
      if (!center) return null;
      // The agent path resolves the body first (insert_rotate at / face /
      // face_id / body_index / selection) and hands its centroid in as
      // params.at, the same as insert_move.
      const picked = Array.isArray(p.at) && p.at.length >= 3 ? p.at.slice(0, 3).map(Number) : null;
      const at = picked && picked.every(Number.isFinite)
        ? picked
        : ((faceCtx && Array.isArray(faceCtx.center)) ? faceCtx.center : [0, 0, 0]);
      const feat = [
        `${body} = rotateAbout(${body}, ${axis}, ${angle}, ${center}, { bodies: [{ at: ${formatVec3(at)} }] });`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(ROTATE_BEGIN, ROTATE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'center',
    label: 'Center',
    group: 'Transforms',
    title: 'center(manifold, axes?)',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'cx', type: 'bool', default: true, label: 'Center X' },
      { name: 'cy', type: 'bool', default: true, label: 'Center Y' },
      { name: 'cz', type: 'bool', default: false, label: 'Center Z' },
    ],
    build: (empty, p, names, buffer) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const cx = bool(p.cx, true);
      const cy = bool(p.cy, true);
      const cz = bool(p.cz, false);
      const feat = [
        `${body} = center(${body}, [${cx}, ${cy}, ${cz}]);`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(CENTER_BEGIN, CENTER_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'align',
    label: 'Align Z0',
    group: 'Transforms',
    title: 'align(manifold, { min / max / center })',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
    ],
    build: (empty, p, names, buffer) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const feat = [
        `${body} = align(${body}, { min: [undefined, undefined, 0] });`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(ALIGN_BEGIN, ALIGN_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'mirror',
    label: 'Mirror',
    group: 'Transforms',
    title: "mirror(manifold, plane, keepOriginal?)",
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'plane', type: 'select', default: 'yz', label: 'Plane', options: MIRROR_PLANE_OPTIONS },
      { name: 'keepOriginal', type: 'bool', default: true, label: 'Keep original' },
    ],
    build: (empty, p, names, buffer) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const plane = str(p.plane, 'yz');
      const keep = bool(p.keepOriginal, true);
      const picked = Array.isArray(p.at) && p.at.length >= 3 ? p.at.slice(0, 3).map(Number) : null;
      const bodies = picked && picked.every(Number.isFinite)
        ? `, { bodies: [{ at: ${formatVec3(picked)} }] }`
        : '';
      const feat = [
        `${body} = mirror(${body}, '${plane}', ${keep}${bodies});`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(MIRROR_BEGIN, MIRROR_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    // Script: one operation no feature can do, as its own feature block,
    // with the FEATURE-GAP note the backlog is grepped from. The agent tool
    // is insert_code_snippet { gap, why, script }.
    id: 'codeSnippet',
    label: 'Script',
    group: 'Features',
    // Agents and the feature strip still compose and edit this. No rail button.
    railHidden: true,
    title: 'Script snippet — one operation no feature can do, with its FEATURE-GAP note',
    params: [
      { name: 'gap', type: 'string', default: '', required: true, label: 'Missing feature', placeholder: 'sweep along 3D path' },
      { name: 'why', type: 'string', default: '', required: true, label: 'Why no feature works', placeholder: 'extrude only goes straight' },
      { name: 'script', type: 'string', multiline: true, default: 'part = part;', required: true, label: 'Script', placeholder: 'part = part.add(…);' },
    ],
    build: (empty, p, names) => {
      void names;
      const raw = String(p.script ?? '').replace(/\r\n/g, '\n');
      const body = raw.split('\n');
      while (body.length && !body[body.length - 1].trim()) body.pop();
      while (body.length && !body[0].trim()) body.shift();
      if (!body.length || (empty && raw.trim() === 'part = part;')) {
        body.length = 0;
        body.push(empty ? 'let part = Manifold.cube([10, 10, 10], true);' : 'part = part;');
      }
      const lines = wrapFeatureBlock(CODE_BEGIN, CODE_END, [featureGapLine(p.gap, p.why), ...body]);
      return withReturn(lines, empty);
    },
  },
  {
    id: 'array3D',
    label: 'Array',
    group: 'Transforms',
    title: 'Array — grid (array3D), polar (polarArray), or points (patternOnPoints)',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      // One button, three patterns. `arrayType` drives both the visible params
      // (showWhen) and which helper the build emits.
      {
        name: 'arrayType', type: 'select', default: 'grid', label: 'Type',
        options: [
          { value: 'grid', label: 'Grid' },
          { value: 'polar', label: 'Polar' },
          { value: 'points', label: 'Points' },
        ],
      },
      { name: 'nx', type: 'number', default: 2, label: 'Count X', min: 1, step: 1, showWhen: { field: 'arrayType', values: ['grid'] } },
      { name: 'ny', type: 'number', default: 2, label: 'Count Y', min: 1, step: 1, showWhen: { field: 'arrayType', values: ['grid'] } },
      { name: 'nz', type: 'number', default: 1, label: 'Count Z', min: 1, step: 1, showWhen: { field: 'arrayType', values: ['grid'] } },
      { name: 'sx', type: 'number', default: 45, label: 'Spacing X', step: 1, showWhen: { field: 'arrayType', values: ['grid'] } },
      { name: 'sy', type: 'number', default: 35, label: 'Spacing Y', step: 1, showWhen: { field: 'arrayType', values: ['grid'] } },
      { name: 'sz', type: 'number', default: 0, label: 'Spacing Z', step: 1, showWhen: { field: 'arrayType', values: ['grid'] } },
      { name: 'count', type: 'number', default: 4, label: 'Count', min: 1, step: 1, description: 'How many copies, or how many holes when boreRadius is greater than 0.', showWhen: { field: 'arrayType', values: ['polar'] } },
      { name: 'boltCircleRadius', type: 'number', default: 0, label: 'Bolt circle R (0 = on axis)', min: 0, step: 1, description: 'Radius of the circle in mm. 0 (the default) keeps a copied body on the axis. Must be greater than 0 when boreRadius is greater than 0.', showWhen: { field: 'arrayType', values: ['polar'] } },
      { name: 'axis', type: 'select', default: 'z', label: 'Axis', options: AXIS_OPTIONS, description: 'Axis the copies orbit around, or the hole direction: x, y, or z. The radius offset is perpendicular to this axis.', showWhen: { field: 'arrayType', values: ['polar'] } },
      { name: 'boreRadius', type: 'number', default: 0, label: 'Bore R (0 = copy the body)', min: 0, step: 0.5, description: '0 (the default) copies the body around the circle. Greater than 0 subtracts that many holes of this radius in mm and does not copy the body.', showWhen: { field: 'arrayType', values: ['polar'] } },
      { name: 'boreHeight', type: 'number', default: 10, label: 'Bore H', min: 0.1, step: 0.5, description: 'Hole length in mm along the axis, used only when boreRadius is greater than 0. The cutter is centered.', showWhen: { field: 'arrayType', values: ['polar'] } },
      { name: 'points', type: 'points', default: '[[0, 0, 0], [40, 0, 0]]', required: true, label: 'Points [x, y, z] or { at, axis }', multiline: true, placeholder: '[[0, 0, 0], { "at": [40, 0, 0], "axis": [0, 0, 1] }]', showWhen: { field: 'arrayType', values: ['points'] } },
      { name: 'up', type: 'select', default: 'z', label: 'Body axis that follows a point axis', options: AXIS_OPTIONS, showWhen: { field: 'arrayType', values: ['points'] } },
      { name: 'keepOriginal', type: 'bool', default: false, label: 'Keep original', showWhen: { field: 'arrayType', values: ['points'] } },
      { name: 'merge', type: 'bool', default: true, label: 'Merge copies', showWhen: { field: 'arrayType', values: ['points'] } },
    ],
    build: (empty, p, names, buffer) => {
      // Type=polar / Type=points hand off to the hidden entries that still
      // own that codegen (and stay composable on their own ids).
      if (str(p.arrayType, 'grid') === 'polar') {
        const polar = HELPER_PALETTE_ITEMS.find((i) => i.id === 'polarArray');
        return polar.build(empty, p, names, buffer);
      }
      if (str(p.arrayType, 'grid') === 'points') {
        const points = HELPER_PALETTE_ITEMS.find((i) => i.id === 'patternPoints');
        return points.build(empty, p, names, buffer);
      }
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const nx = Math.max(1, Math.round(num(p.nx, 2)));
      const ny = Math.max(1, Math.round(num(p.ny, 2)));
      const nz = Math.max(1, Math.round(num(p.nz, 1)));
      const sx = num(p.sx, 45);
      const sy = num(p.sy, 35);
      const sz = num(p.sz, 0);
      const feat = [
        `${body} = array3D(${body}, [${nx}, ${ny}, ${nz}], [${sx}, ${sy}, ${sz}]);`,
        ...reapplyBodyToPart(body, names, empty ? lines.join('\n') : buffer),
      ];
      lines.push(...wrapFeatureBlock(ARRAY_BEGIN, ARRAY_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    // Pattern on points: one instance at every point, turned along each
    // point's axis. The hardware tool: a bolt part onto the hole centers
    // and axes of the mating part (list_faces, cylindrical faces).
    id: 'patternPoints',
    label: 'Points',
    group: 'Transforms',
    // Folded into the Array button (Type=Points), which delegates to this build.
    railHidden: true,
    title: 'patternOnPoints(body, points, { up, keepOriginal, merge })',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'points', type: 'points', default: '[[0, 0, 0], [40, 0, 0]]', required: true, label: 'Points [x, y, z] or { at, axis }', multiline: true, placeholder: '[[0, 0, 0], { "at": [40, 0, 0], "axis": [0, 0, 1] }]' },
      { name: 'up', type: 'select', default: 'z', label: 'Body axis that follows a point axis', options: AXIS_OPTIONS },
      { name: 'keepOriginal', type: 'bool', default: false, label: 'Keep original' },
      { name: 'merge', type: 'bool', default: true, label: 'Merge copies' },
    ],
    build: (empty, p, names, buffer) => {
      const points = parsePatternPoints(p.points);
      if (!points) return null;
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const up = { x: '[1, 0, 0]', y: '[0, 1, 0]', z: '[0, 0, 1]' }[str(p.up, 'z')] || '[0, 0, 1]';
      const keep = bool(p.keepOriginal, false);
      const merge = bool(p.merge, true);
      const feat = [
        `${body} = patternOnPoints(${body}, ${JSON.stringify(points)}, { up: ${up}, keepOriginal: ${keep}, merge: ${merge} });`,
        ...reapplyBodyToPart(body, names, empty ? lines.join('\n') : buffer),
      ];
      lines.push(...wrapFeatureBlock(PATTERN_POINTS_BEGIN, PATTERN_POINTS_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'polarArray',
    label: 'Polar',
    group: 'Transforms',
    // Folded into the Array button (Type=Polar), which delegates to this build.
    railHidden: true,
    title: "polarArray(manifold, count, radius, axis?)",
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'count', type: 'number', default: 4, label: 'Count', min: 1, step: 1, description: 'How many copies, or how many holes when boreRadius is greater than 0.' },
      { name: 'boltCircleRadius', type: 'number', default: 0, label: 'Bolt circle R (0 = on axis)', min: 0, step: 1, description: 'Radius of the circle in mm. 0 (the default) keeps a copied body on the axis. Must be greater than 0 when boreRadius is greater than 0.' },
      { name: 'axis', type: 'select', default: 'z', label: 'Axis', options: AXIS_OPTIONS, description: 'Axis the copies orbit around, or the hole direction: x, y, or z. The radius offset is perpendicular to this axis.' },
      { name: 'boreRadius', type: 'number', default: 0, label: 'Bore R (0 = copy the body)', min: 0, step: 0.5, description: '0 (the default) copies the body around the circle. Greater than 0 subtracts that many holes of this radius in mm and does not copy the body.' },
      { name: 'boreHeight', type: 'number', default: 10, label: 'Bore H', min: 0.1, step: 0.5, description: 'Hole length in mm along the axis, used only when boreRadius is greater than 0. The cutter is centered.' },
    ],
    build: (empty, p, names, buffer) => {
      const count = Math.max(1, Math.round(num(p.count, 4)));
      const axis = polarAxis(p.axis);
      let bcr = num(p.boltCircleRadius, 0);
      let br = num(p.boreRadius, 0);
      let bh = num(p.boreHeight, 10);
      if (empty) {
        // Both defaults are 0 (copy on axis). An empty part has nothing to
        // copy, so the one-click Array → Polar demo is still a circle of pins.
        if (!(br > 0) && !(bcr > 0)) {
          br = 3;
          bcr = 20;
        } else if (!(br > 0)) {
          br = 3;
        }
        if (!(bh > 0)) bh = 10;
        const bore = allocateUniqueName(names, 'bore');
        const partName = allocateUniqueName(names, 'part');
        const pin = polarPinExpr(bh, br, axis, false);
        const body = [
          `const ${bore} = ${pin};`,
          partName === 'part'
            ? `let part = polarArray(${bore}, ${count}, ${bcr}, '${axis}');`
            : `let ${partName} = polarArray(${bore}, ${count}, ${bcr}, '${axis}');\npart = ${partName};`,
        ];
        return withReturn(wrapFeatureBlock(POLAR_ARRAY_BEGIN, POLAR_ARRAY_END, body), true);
      }
      // Hole mode drills `part`. A positive bore with no circle would stack
      // the cutters on the axis; validateHelperParams reports that as bad_args.
      if (br > 0) {
        if (!(bcr > 0)) return null;
        if (!(bh > 0)) bh = 10;
        const bore = allocateUniqueName(names, 'bore');
        const holes = allocateUniqueName(names, 'holes');
        const feat = [
          `const ${bore} = ${polarPinExpr(bh, br, axis, true)};`,
          `const ${holes} = polarArray(${bore}, ${count}, ${bcr}, '${axis}');`,
          `part = part.subtract(${holes});`,
        ];
        return withReturn(wrapFeatureBlock(POLAR_ARRAY_BEGIN, POLAR_ARRAY_END, feat), false);
      }
      const body = resolveBody(p, names, buffer);
      const reapply = polarReapply(body, names, buffer, bcr);
      const feat = [
        ...reapply.before,
        `${body} = polarArray(${body}, ${count}, ${bcr}, '${axis}');`,
        ...reapply.after,
      ];
      return withReturn(wrapFeatureBlock(POLAR_ARRAY_BEGIN, POLAR_ARRAY_END, feat), false);
    },
  },
  {
    id: 'addDraft',
    label: 'Draft',
    group: 'Features',
    title: "draftFaces(manifold, faces, deg, { pull, reference }) — signed, per face",
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      {
        name: 'draftDeg', type: 'number', default: 2, label: 'Draft °',
        min: -45, max: 45, step: 0.5, slider: true,
      },
      {
        name: 'faceScope', type: 'select', default: 'sides', label: 'Faces',
        options: [{ value: 'sides', label: 'all side walls' }],
      },
      { name: 'pull', type: 'select', default: 'z', label: 'Pull', options: DRAFT_PULL_OPTIONS },
      {
        name: 'reference', type: 'select', default: 'min', label: 'Reference plane',
        options: DRAFT_REFERENCE_OPTIONS,
      },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const deg = num(p.draftDeg, 2);
      const face = faceCtx && faceCtx.type ? faceCtx : (faceCtx ? classifySelectedFace(faceCtx) : null);
      // Legacy sheets sent `axis`; the face-aware sheet sends pull + reference.
      const pull = str(p.pull, str(p.axis, 'z'));
      const reference = str(p.reference, 'min');
      const scope = str(p.faceScope, 'sides');
      const faces = emitFaceSelectionExpr(face, scope);
      const feat = [
        `${body} = draftFaces(${body}, ${faces}, ${deg}, { pull: '${pull}', reference: '${reference}' });`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(DRAFT_BEGIN, DRAFT_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'workplane',
    label: 'Workplane',
    group: 'Advanced',
    title: 'Construction plane — literal PlaneFrame, rendered and selectable. Not a solid.',
    params: [],
    build: (empty, p, names, buffer, faceCtx = null) => {
      void empty;
      void p;
      void buffer;
      const fr = allocateUniqueName(names, 'fr');
      let plane = null;
      let face = faceCtx;
      if (face && face.type !== 'planar' && face.type !== 'cylindrical' && face.type !== 'irregular') {
        face = classifySelectedFace(face) || null;
      }
      if (face && face.type === 'planar') {
        if (face.planeFrame?.center && face.planeFrame?.normal && face.planeFrame?.x && face.planeFrame?.y) {
          plane = face.planeFrame;
        } else {
          try {
            plane = planeFrameFromFaceData({
              center: face.center,
              normal: face.normal,
              verts: face.vertices || face.verts,
            });
          } catch {
            plane = null;
          }
        }
      }
      // Prefer a literal PlaneFrame so listConstructionPlanes can pick it
      // (savedContours expects center/normal/x/y literals, not host queries).
      const lines = wrapFeatureBlock(WORKPLANE_BEGIN, WORKPLANE_END, [
        `const ${fr} = ${emitPlaneFrameLiteral(plane)}; // construction plane`,
      ]);
      return `${lines.join('\n')}\n`;
    },
  },
  {
    id: 'makeExtrude',
    label: 'Extrude',
    group: 'Advanced',
    title: 'Extrude — named contour and makeExtrude. Confirm adds or subtracts when part already exists.',
    bodyBase: 'extrude',
    params: [
      { name: 'height', type: 'number', default: 10, label: 'Height', min: 0.1, step: 1 },
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    // UI always enters contour mode (Slice 24/25). This build is only the
    // sequential-compose / golden fallback — not a one-shot hardcoded plate.
    build: (empty, p, names, buffer) => {
      const h = num(p.height, 10);
      const contour = takeContourName(names);
      const plane = emitPlaneFrameLiteral({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] });
      const featureId = mintBlockId(findFeatureBlocks(buffer || '', CONTOUR_EXTRUDE_BEGIN, CONTOUR_EXTRUDE_END), 'extrude');
      const lines = [
        `const ${contour} = makeCrossSection(${plane}, profileRectangle(40, 30, true)); // @contour id=${contour}`,
        ...emitExtrudeReferenceLines({
          begin: CONTOUR_EXTRUDE_BEGIN,
          end: CONTOUR_EXTRUDE_END,
          featureId,
          contour,
          distance: h,
          w: 0,
          partLine: (expr) => emitPartPlace(names, expr, !empty && names.has('part'), true, solidCombineOp(p), solidMergeOn(p)),
        }),
      ];
      return withReturn(lines, empty);
    },
  },
  {
    id: 'makeRevolve',
    label: 'Revolve',
    group: 'Advanced',
    title: 'Revolve — named contour and makeRevolve. Confirm adds or subtracts when part already exists.',
    bodyBase: 'revolve',
    params: [
      { name: 'segments', type: 'number', default: 64, label: 'Segments', min: 3, step: 1 },
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    build: (empty, p, names, buffer) => {
      const seg = Math.max(3, Math.round(num(p.segments, 64)));
      const contour = takeContourName(names);
      const plane = emitPlaneFrameLiteral({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] });
      const featureId = mintBlockId(findFeatureBlocks(buffer || '', CONTOUR_REVOLVE_BEGIN, CONTOUR_REVOLVE_END), 'revolve');
      const lines = [
        `const ${contour} = makeCrossSection(${plane}, profilePolygon([[8, 0], [25, 0], [25, 6], [12, 6], [12, 40], [8, 40]])); // @contour id=${contour}`,
        ...emitRevolveReferenceLines({
          begin: CONTOUR_REVOLVE_BEGIN,
          end: CONTOUR_REVOLVE_END,
          featureId,
          contour,
          rU: 1,
          rV: 0,
          aU: 0,
          aV: 1,
          segments: seg,
          angle: 360,
          startDeg: 0,
          partLine: (expr) => emitPartPlace(names, expr, !empty && names.has('part'), true, solidCombineOp(p), solidMergeOn(p)),
        }),
      ];
      return withReturn(lines, empty);
    },
  },
  {
    id: 'makeSweep',
    label: 'Sweep',
    group: 'Advanced',
    title: 'Sweep — named profile and path contours. Confirm adds or subtracts when part already exists.',
    bodyBase: 'swept',
    params: [SOLID_COMBINE_PARAM],
    // UI always enters contour mode (Slice 30). This build is the sequential /
    // golden fallback — circle profile swept along a straight +Z edge.
    build: (empty, p, names, buffer) => {
      const partDeclared = names.has('part');
      const profile = takeContourName(names);
      const path = takeContourName(names);
      const xy = emitPlaneFrameLiteral({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] });
      const world = [[0, 0, 0], [0, 0, 20]];
      const frame = sweepPathFrame(world);
      const featureId = mintBlockId(findFeatureBlocks(buffer || '', CONTOUR_SWEEP_BEGIN, CONTOUR_SWEEP_END), 'sweep');
      const localName = allocateUniqueName(names, 'sweepLocal');
      const sweptName = allocateUniqueName(names, 'swept');
      const lines = [
        `const ${profile} = makeCrossSection(${xy}, profileCircle(2, 16)); // @contour id=${profile}`,
        `const ${path} = makeCrossSection(${emitPlaneFrameLiteral(frame)}, ${emitPathProfileExpr(projectPathUv(world, frame), false)}); // @contour id=${path}`,
        // Fallback stays a replace when Mode is Add (contour Confirm is the
        // additive path). Subtract still cuts the sweep out of the host.
        ...emitSweepReferenceLines({
          begin: CONTOUR_SWEEP_BEGIN,
          end: CONTOUR_SWEEP_END,
          featureId,
          profile,
          path,
          localName,
          sweptName,
          partLine: (expr) => emitPartPlace(names, expr, partDeclared, false, solidCombineOp(p)),
        }),
      ];
      return withReturn(lines, empty);
    },
  },
  {
    id: 'makeLoft',
    label: 'Loft',
    group: 'Advanced',
    title: 'Loft — named contours and makeLoft. Confirm adds or subtracts when part already exists.',
    bodyBase: 'lofted',
    params: [
      { name: 'height', type: 'number', default: 20, label: 'Offset', min: 0.1, step: 1 },
      SOLID_COMBINE_PARAM,
      SOLID_MERGE_PARAM,
    ],
    // UI always enters contour mode (Slice 28). This build is the sequential /
    // golden fallback — two circles on +Z. The second station is an offset
    // along the contour normal, not a second frame baked into the contour.
    build: (empty, p, names, buffer) => {
      const h = num(p.height, 20);
      const c0 = takeContourName(names);
      const c1 = takeContourName(names);
      const plane = emitPlaneFrameLiteral({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] });
      const featureId = mintBlockId(findFeatureBlocks(buffer || '', CONTOUR_LOFT_BEGIN, CONTOUR_LOFT_END), 'loft');
      const lines = [
        `const ${c0} = makeCrossSection(${plane}, profileCircle(5, 64)); // @contour id=${c0}`,
        `const ${c1} = makeCrossSection(${plane}, profileCircle(8, 64)); // @contour id=${c1}`,
        ...emitLoftReferenceLines({
          begin: CONTOUR_LOFT_BEGIN,
          end: CONTOUR_LOFT_END,
          featureId,
          stations: [
            { name: c0, offset: 0 },
            { name: c1, offset: h },
          ],
          placeIndex: 0,
          partLine: (expr) => emitPartPlace(names, expr, !empty && names.has('part'), true, solidCombineOp(p), solidMergeOn(p)),
        }),
      ];
      return withReturn(lines, empty);
    },
  },
  {
    id: 'moveFace',
    label: 'Move Face',
    group: 'Refine',
    title: 'moveFace(manifold, faces, distance, { flip }) — offset faces along their normals; adjacent walls extend or trim',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
      { name: 'distance', type: 'number', default: 2, label: 'Distance', step: 0.5, slider: true },
      { name: 'flip', type: 'bool', default: false, label: 'Flip' },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const face = faceCtx && faceCtx.type ? faceCtx : (faceCtx ? classifySelectedFace(faceCtx) : null);
      const picks = face ? facePickLiterals(face) : [];
      const distance = num(p.distance, 2);
      const flip = bool(p.flip, false) ? ', { flip: true }' : '';
      const feat = [
        `${body} = moveFace(${body}, [${picks.join(', ')}], ${distance}${flip});`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(MOVE_FACE_BEGIN, MOVE_FACE_END, feat));
      return withReturn(lines, empty);
    },
  },
  {
    id: 'deleteFace',
    label: 'Delete Face',
    group: 'Refine',
    title: 'deleteFace(manifold, faces) — remove faces and heal by extending or trimming neighbors',
    params: [
      { name: 'body', type: 'body', default: 'part', label: 'Body' },
    ],
    build: (empty, p, names, buffer, faceCtx = null) => {
      const lines = [];
      const body = resolveBody(p, names, empty ? lines.join('\n') : buffer);
      const face = faceCtx && faceCtx.type ? faceCtx : (faceCtx ? classifySelectedFace(faceCtx) : null);
      const picks = face ? facePickLiterals(face) : [];
      const feat = [
        `${body} = deleteFace(${body}, [${picks.join(', ')}]);`,
        ...syncPartLines(body, names, /(?:let|const|var)\s+part\b/.test(lines.join('\n')) || !empty),
      ];
      lines.push(...wrapFeatureBlock(DELETE_FACE_BEGIN, DELETE_FACE_END, feat));
      return withReturn(lines, empty);
    },
  },
];

/** Group order for the palette UI (Slice 29): Prim, Advanced, Features, Xforms. */
export const HELPER_PALETTE_GROUPS = ['Primitives', 'Advanced', 'Features', 'Transforms'];

/**
 * Data-group order. The visible rail is paletteRailSections: Block, Build,
 * Shape, Polish, Move. Display names live in HelperInsertPalette's
 * GROUP_SHORT_LABEL.
 */
export const CAD_RAIL_ORDER = ['Primitives', 'Build', 'Shape', 'Features', 'Transforms'];

const RAIL_BUILD_IDS = ['hole', 'cut', 'boolean', 'shell', 'addDraft', 'array3D'];
const RAIL_POLISH_IDS = ['filletEdges', 'chamferEdges', 'moveFace', 'deleteFace'];
const RAIL_MOVE_FIRST = ['move', 'rotate', 'center', 'align', 'mirror'];

export function itemsByGroup() {
  const map = Object.fromEntries(HELPER_PALETTE_GROUPS.map((g) => [g, []]));
  for (const item of HELPER_PALETTE_ITEMS) {
    if (!map[item.group]) map[item.group] = [];
    map[item.group].push(item);
  }
  return map;
}

/**
 * Visible rail sections, both layouts. Order is Block, Build, Shape, Polish,
 * Move. Shape is the old Model section (Profile / Workplane / Extrude /
 * Revolve / Sweep / Loft), same buttons. Build is hole, cut, boolean, shell,
 * draft, pattern (Array Type is Grid, Polar, or Points). Polish is fillet,
 * chamfer, move face, delete face. Move is every
 * remaining button, with Move first, Rotate directly below it, then Center.
 *
 * `railHidden` items keep their group membership and their build(); they get
 * no button. Filter here, not in itemsByGroup.
 */
export function paletteRailSections(layout, grouped = itemsByGroup()) {
  void layout;
  const byId = new Map();
  for (const items of Object.values(grouped)) {
    for (const item of items || []) {
      if (!item.railHidden) byId.set(item.id, item);
    }
  }
  const take = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
  const visibleIds = (group) => (grouped[group] || []).filter((i) => !i.railHidden).map((i) => i.id);
  const block = take(visibleIds('Primitives'));
  const shape = take(visibleIds('Advanced'));
  const build = take(RAIL_BUILD_IDS);
  const polish = take(RAIL_POLISH_IDS);
  const claimed = new Set([
    ...block.map((i) => i.id),
    ...shape.map((i) => i.id),
    ...RAIL_BUILD_IDS,
    ...RAIL_POLISH_IDS,
  ]);
  const move = [];
  for (const id of RAIL_MOVE_FIRST) {
    if (byId.has(id) && !claimed.has(id)) move.push(byId.get(id));
  }
  for (const item of byId.values()) {
    if (!claimed.has(item.id) && !move.some((entry) => entry.id === item.id)) move.push(item);
  }
  const byKey = {
    Primitives: block,
    Build: build,
    Shape: shape,
    Features: polish,
    Transforms: move,
  };
  return CAD_RAIL_ORDER
    .map((key) => ({ key, items: byKey[key] || [] }))
    .filter((section) => section.items.length);
}
