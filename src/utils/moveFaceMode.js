/**
 * Move Face — offset one or more faces along their normals.
 * Confirm writes one moveFace() and replaces a previous Move Face block.
 * Leaving without Confirm writes nothing. This is not the body move() helper.
 *
 * Tap adds a face. Tap it again to remove it. Undo drops the last face.
 * Clear drops every face. No modifier key. Flip reverses each face normal.
 */

import { shellFaceKey } from './shellMode.js';
import { facePickLiteral } from './faceFeaturePlacement.js';
import { MOVE_FACE_BEGIN, MOVE_FACE_END } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { lastFeatureBlock } from './featureBlockId.js';
import { mintBlockIds } from './featureBlockMint.js';

export const MOVE_FACE_ENTRY_ID = 'moveFace';

export const MOVE_FACE_NEED_FACE = 'Tap a face to offset.';
export const MOVE_FACE_NEED_DISTANCE = 'Distance must be a number.';

function copyFace(face) {
  return {
    center: face.center.map(Number),
    normal: face.normal.map(Number),
    indices: Array.isArray(face.indices) ? face.indices.slice() : undefined,
  };
}

export function emptyMoveFaceState(faces = []) {
  const list = [];
  for (const face of Array.isArray(faces) ? faces : []) {
    if (!face || !Array.isArray(face.center) || !Array.isArray(face.normal)) continue;
    list.push(copyFace(face));
  }
  return {
    entry: MOVE_FACE_ENTRY_ID,
    body: 'part',
    faces: list,
    distance: 2,
    flip: false,
  };
}

/** Tap adds. Tap the same face again to remove it. No modifier. */
export function toggleMoveFaceSelection(state, face) {
  const s = state || emptyMoveFaceState();
  const key = shellFaceKey(face);
  if (!key) return s;
  const faces = s.faces.slice();
  const idx = faces.findIndex((f) => shellFaceKey(f) === key);
  if (idx >= 0) faces.splice(idx, 1);
  else faces.push(copyFace(face));
  return { ...s, faces };
}

/** Undo: drop only the last face. Distance and Flip stay. */
export function popLastMoveFace(state) {
  const s = state || emptyMoveFaceState();
  const faces = s.faces.slice();
  if (faces.length) faces.pop();
  return { ...s, faces };
}

/** Clear: drop every face. Distance and Flip stay. */
export function clearMoveFaces(state) {
  const s = state || emptyMoveFaceState();
  return { ...s, faces: [] };
}

export function setMoveFaceDistance(state, distance) {
  return { ...(state || emptyMoveFaceState()), distance };
}

export function setMoveFaceFlip(state, flip) {
  return { ...(state || emptyMoveFaceState()), flip: !!flip };
}

function formatNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Object.is(v, -0)) return '0';
  const r = Math.round(v * 1e4) / 1e4;
  if (r === 0) return '0';
  return String(r);
}

export function validateMoveFaceAccept(state) {
  const s = state || emptyMoveFaceState();
  const faces = (s.faces || []).filter((f) => shellFaceKey(f));
  if (!faces.length) return { ok: false, message: MOVE_FACE_NEED_FACE };
  const distance = Number(s.distance);
  if (!Number.isFinite(distance)) return { ok: false, message: MOVE_FACE_NEED_DISTANCE };
  return { ok: true, faces, distance, flip: !!s.flip };
}

export function stripMoveFaceBlock(buffer) {
  const text = String(buffer || '');
  const blk = lastFeatureBlock(text, MOVE_FACE_BEGIN, MOVE_FACE_END);
  if (!blk) return text;
  const i = blk.start;
  const after = text.slice(blk.end).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → one moveFace() wrapped in Move Face markers.
 * Always replaces the last marked Move Face block.
 * A body move() block elsewhere in the script is left alone.
 */
export function composeMoveFaceCommit(buffer, state) {
  const gate = validateMoveFaceAccept(state);
  if (!gate.ok) return gate;
  const body = state?.body || 'part';
  const faces = gate.faces.map((f) => facePickLiteral(f)).join(', ');
  const flip = gate.flip ? ', { flip: true }' : '';
  const call = `${body} = moveFace(${body}, [${faces}], ${formatNum(gate.distance)}${flip});`;
  const base = stripMoveFaceBlock(String(buffer || ''));
  const block = mintBlockIds([MOVE_FACE_BEGIN, call, MOVE_FACE_END].join('\n'), base);
  const composed = placeBlockBeforeReturn(base, block);
  const owned = lastFeatureBlock(composed, MOVE_FACE_BEGIN, MOVE_FACE_END)?.text || '';
  if ((owned.match(/\bmoveFace\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeMoveFaceCommit: Move Face must emit exactly one moveFace().' };
  }
  return { ok: true, buffer: composed, run: true };
}
