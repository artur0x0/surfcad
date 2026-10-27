/**
 * Draft face-pick mode — first tap is the neutral plane (SolidWorks Neutral
 * Plane / Fusion Fixed Plane / Onshape neutral plane). Its normal is the pull.
 * Later taps are the faces to draft. Not a Parasolid parting-line taper.
 *
 * Tap the neutral face again to arm replacement (it is not added to the draft
 * list). The next tap becomes the new neutral. Tap a drafted face again to
 * remove it. Undo drops only the last drafted face. Clear drops the drafted
 * faces and keeps the neutral face.
 *
 * Confirm writes one draftFaces() and replaces a previous Draft block. It does
 * not emit addDraft and does not guess a world axis.
 */

import { shellFaceKey } from './shellMode.js';
import { facePickLiteral, formatVec3 } from './faceFeaturePlacement.js';
import { DRAFT_BEGIN, DRAFT_END } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { lastFeatureBlock } from './featureBlockId.js';
import { mintBlockIds } from './featureBlockMint.js';

export const DRAFT_ENTRY_ID = 'addDraft';

function copyFace(face) {
  return {
    center: face.center.map(Number),
    normal: face.normal.map(Number),
    indices: Array.isArray(face.indices) ? face.indices.slice() : undefined,
  };
}

export function emptyDraftState(face = null) {
  const neutral = face && Array.isArray(face.center) && Array.isArray(face.normal)
    ? copyFace(face)
    : null;
  return {
    entry: DRAFT_ENTRY_ID,
    neutral,
    drafts: [],
    replaceNeutral: false,
    angle: 2,
    flip: false,
    body: 'part',
  };
}

function unit3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-12)) return null;
  return [x / len, y / len, z / len];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Pull direction: the neutral face normal, reversed when Flip is on. */
export function draftPullOf(state) {
  if (!state?.neutral) return null;
  const n = unit3(state.neutral.normal);
  if (!n) return null;
  return state.flip ? [-n[0], -n[1], -n[2]] : n;
}

/**
 * A cap: the face plane is perpendicular to the pull (face normal parallel to
 * the pull). Same 1e-6 in-plane test the kernel uses. Includes the neutral
 * face when the pull is its normal, flipped or not.
 */
export function faceParallelToPull(face, pull) {
  const n = unit3(face?.normal);
  const p = unit3(pull);
  if (!n || !p) return false;
  const d = dot3(n, p);
  const inplane = Math.hypot(n[0] - d * p[0], n[1] - d * p[1], n[2] - d * p[2]);
  return inplane < 1e-6;
}

/**
 * First tap sets the neutral face. Tapping it again arms replacement and does
 * not draft it. While armed, the next tap replaces the neutral (and leaves the
 * draft list if it was on it). Other taps toggle the draft list.
 */
export function applyDraftFaceTap(state, face) {
  const s = state || emptyDraftState();
  const key = shellFaceKey(face);
  if (!key) return s;
  const picked = copyFace(face);
  if (!s.neutral) {
    return { ...s, neutral: picked, drafts: [], replaceNeutral: false };
  }
  if (shellFaceKey(s.neutral) === key) {
    return { ...s, replaceNeutral: !s.replaceNeutral };
  }
  if (s.replaceNeutral) {
    const drafts = s.drafts.filter((f) => shellFaceKey(f) !== key);
    return { ...s, neutral: picked, drafts, replaceNeutral: false };
  }
  const idx = s.drafts.findIndex((f) => shellFaceKey(f) === key);
  const drafts = s.drafts.slice();
  if (idx >= 0) drafts.splice(idx, 1);
  else drafts.push(picked);
  return { ...s, drafts };
}

/** Undo: drop only the last drafted face. The neutral face stays. */
export function popLastDraftFace(state) {
  const s = state || emptyDraftState();
  const drafts = s.drafts.slice();
  if (drafts.length) drafts.pop();
  return { ...s, drafts, replaceNeutral: false };
}

/** Clear: drop drafted faces, keep the neutral face. */
export function clearDraftFaces(state) {
  const s = state || emptyDraftState();
  return { ...s, drafts: [], replaceNeutral: false };
}

export function setDraftAngle(state, angle) {
  return { ...(state || emptyDraftState()), angle };
}

export function setDraftFlip(state, flip) {
  return { ...(state || emptyDraftState()), flip: !!flip };
}

export function validateDraftAccept(state) {
  const s = state || emptyDraftState();
  if (!s.neutral) {
    return { ok: false, message: 'Tap the neutral face first. Its normal is the pull.' };
  }
  const angle = Number(s.angle);
  if (!Number.isFinite(angle)) {
    return { ok: false, message: 'Draft angle must be a number.' };
  }
  if (Math.abs(angle) >= 89) {
    return { ok: false, message: 'Draft angle is past vertical.' };
  }
  if (!s.drafts.length) {
    return {
      ok: false,
      message: 'Tap the faces to draft. The neutral face sets the pull and stays put.',
    };
  }
  const pull = draftPullOf(s);
  if (!pull) {
    return { ok: false, message: 'The neutral face has no pull direction.' };
  }
  if (s.drafts.some((f) => shellFaceKey(f) === shellFaceKey(s.neutral))) {
    return {
      ok: false,
      message: 'The neutral face is in the draft list. Tap it to replace the neutral, not to draft it.',
    };
  }
  if (s.drafts.some((f) => faceParallelToPull(f, pull))) {
    return {
      ok: false,
      message: 'A chosen face is parallel to the pull — a cap cannot be drafted. Remove it.',
    };
  }
  return { ok: true, pull, angle };
}

export function stripDraftBlock(buffer) {
  const text = String(buffer || '');
  const blk = lastFeatureBlock(text, DRAFT_BEGIN, DRAFT_END);
  if (!blk) return text;
  const i = blk.start;
  const after = text.slice(blk.end).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

function formatAngle(angle) {
  const n = Number(angle);
  if (Object.is(n, -0) || n === 0) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

/**
 * Confirm → one draftFaces() wrapped in DRAFT markers.
 * Always replaces the last marked Draft block.
 *
 * @param {string} buffer
 * @param {object} state draft picker state
 */
export function composeDraftCommit(buffer, state) {
  const gate = validateDraftAccept(state);
  if (!gate.ok) return gate;
  const s = state;
  const faces = s.drafts.map((f) => facePickLiteral(f)).join(', ');
  const pullLit = formatVec3(gate.pull);
  const refLit = facePickLiteral(s.neutral);
  const body = s.body || 'part';
  const line = `${body} = draftFaces(${body}, [${faces}], ${formatAngle(gate.angle)}, { pull: ${pullLit}, reference: ${refLit} });`;
  const base = stripDraftBlock(String(buffer || ''));
  const block = mintBlockIds([DRAFT_BEGIN, line, DRAFT_END].join('\n'), base);
  const composed = placeBlockBeforeReturn(base, block);
  const owned = lastFeatureBlock(composed, DRAFT_BEGIN, DRAFT_END)?.text || '';
  if ((owned.match(/draftFaces\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeDraftCommit: Draft must emit exactly one draftFaces().' };
  }
  if (/addDraft\s*\(/.test(owned)) {
    return { ok: false, message: 'composeDraftCommit: do not emit addDraft.' };
  }
  if (/pull:\s*'/.test(owned)) {
    return {
      ok: false,
      message: 'composeDraftCommit: pull must be the neutral normal, not a world-axis guess.',
    };
  }
  return { ok: true, buffer: composed, run: true };
}
