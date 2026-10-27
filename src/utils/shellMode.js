/**
 * Shell face-pick mode — enter from the left rail, tap a face (or Closed),
 * set wall thickness, Confirm writes hollow() in SHELL begin/end markers.
 *
 * Replaces the HelperParamModal axis Opening select (X/Y/Z/+/-), which was
 * confusing. Face pick maps to hollow(body, wall, { center, normal }) — the
 * same worker API as axis / 'none' / facesByNormal forms.
 *
 * Confirm Auto-Runs. Grey X / Cancel exits with no write. One Shell feature:
 * tap faces to add openings (no shift / ctrl). Tap a selected face again to
 * drop it, same as the edge picker. Undo drops only the last face; Clear
 * drops every face. Emit one hollow(body, wall, [pick, …]). A later Shell
 * replaces that block — it does not append another hollow(). Closed stays
 * 'none'.
 */

import {
  composeHelperInsert,
  SHELL_BEGIN,
  SHELL_END,
} from './helperPaletteSnippets.js';
import { classifySelectedFace } from './faceFeaturePlacement.js';
import { hasFeatureBlock, lastFeatureBlock } from './featureBlockId.js';

export const SHELL_ENTRY_ID = 'shell';

export const SHELL_MODE_EMPTY =
  'Tap a face to open the shell, or choose Closed, then Confirm.';

export const SHELL_MODE_NO_COMMIT =
  'Dismiss exits Shell mode with no commit.';

/** Stable id for a shell opening face. Rounded so the same coplanar tap matches. */
export function shellFaceKey(face) {
  if (!face || !Array.isArray(face.center) || !Array.isArray(face.normal)) return '';
  const r = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
  };
  return `${face.center.map(r).join(',')}|${face.normal.map(r).join(',')}`;
}

/**
 * Edge-picker model for shell openings: tap adds, tap again removes that face.
 * Order is oldest first. No modifier.
 * @param {object[]|null|undefined} selected
 * @param {object} face — { center, normal, indices? }
 * @returns {object[]}
 */
export function toggleShellFaceSelection(selected, face) {
  const list = Array.isArray(selected) ? selected.slice() : [];
  const key = shellFaceKey(face);
  if (!key) return list;
  const idx = list.findIndex((f) => shellFaceKey(f) === key);
  if (idx >= 0) {
    list.splice(idx, 1);
    return list;
  }
  list.push({
    center: face.center.map(Number),
    normal: face.normal.map(Number),
    indices: Array.isArray(face.indices) ? face.indices.slice() : undefined,
  });
  return list;
}

/** Undo: drop only the last selected opening face. */
export function popLastShellFace(selected) {
  const list = Array.isArray(selected) ? selected.slice() : [];
  if (list.length) list.pop();
  return list;
}

export function isShellEntry(id) {
  return id === SHELL_ENTRY_ID;
}

export function defaultShellParams() {
  return {
    body: 'part',
    wall: 2.5,
    /** 'face' | 'none' — face uses the live viewport pick; none → closed hollow. */
    openingMode: 'face',
  };
}

/**
 * Seed in-mode state. A pre-selected face is fine; empty is OK (pick in-mode).
 * @param {object|null} [face]
 */
export function enterShellState(face = null) {
  const classified = face && face.type
    ? face
    : (face ? classifySelectedFace(face) : null);
  return {
    entry: SHELL_ENTRY_ID,
    params: defaultShellParams(),
    lastFace: classified,
    enterRefuse: null,
  };
}

export function normalizeShellParams(raw = {}) {
  const seeded = defaultShellParams();
  const wall = Number(raw.wall);
  return {
    body: raw.body || seeded.body,
    wall: Number.isFinite(wall) && wall > 0 ? wall : seeded.wall,
    openingMode: raw.openingMode === 'none' ? 'none' : 'face',
  };
}

/**
 * @param {object|null} face — classified or raw selectedFace
 * @param {object} params
 */
export function validateShellAccept(face, params = {}) {
  const n = normalizeShellParams(params);
  if (!(n.wall > 0)) {
    return { ok: false, message: 'Wall thickness must be greater than 0.' };
  }
  if (n.openingMode === 'none') {
    return {
      ok: true,
      normalized: n,
      face: null,
      openScope: 'none',
    };
  }
  const classified = face && face.type
    ? face
    : (face ? classifySelectedFace(face) : null);
  if (!classified) {
    return { ok: false, message: SHELL_MODE_EMPTY };
  }
  return {
    ok: true,
    normalized: n,
    face: classified,
    openScope: 'selected',
  };
}

export function hasShellBlock(buffer) {
  const t = String(buffer || '');
  return hasFeatureBlock(t, SHELL_BEGIN, SHELL_END);
}

export function shellOwnedRegion(buffer) {
  const text = String(buffer || '');
  const blk = lastFeatureBlock(text, SHELL_BEGIN, SHELL_END);
  if (!blk) return '';
  const i = blk.start;
  return text.slice(i, blk.end);
}

export function stripShellBlock(buffer) {
  const text = String(buffer || '');
  const blk = lastFeatureBlock(text, SHELL_BEGIN, SHELL_END);
  if (!blk) return text;
  const i = blk.start;
  const after = text.slice(blk.end).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → one hollow() wrapped in SHELL markers.
 * Always replaces the last marked Shell block. `commitMode: 'append'` is
 * accepted and ignored: a second hollow() would shell an already thin body.
 *
 * @param {string} buffer
 * @param {{ face?: object|null, params?: object, commitMode?: string }} [opts]
 */
export function composeShellCommit(buffer, {
  face = null,
  params = {},
} = {}) {
  const gate = validateShellAccept(face, params);
  if (!gate.ok) return gate;

  const text = String(buffer || '');
  // One feature. Never keep the previous hollow() and add another,
  // even if the caller still passes commitMode: 'append'.
  const base = stripShellBlock(text);
  const emitParams = {
    body: gate.normalized.body,
    wall: gate.normalized.wall,
    openScope: gate.openScope,
  };
  const composed = composeHelperInsert(
    base,
    'shell',
    null,
    emitParams,
    gate.face,
  );
  if (typeof composed !== 'string') {
    return { ok: false, message: gate.message || SHELL_MODE_EMPTY };
  }
  const owned = shellOwnedRegion(composed);
  if (!/hollow\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeShellCommit: hollow() missing — refusing silent no-op.',
    };
  }
  if (!hasShellBlock(composed)) {
    return {
      ok: false,
      message: 'composeShellCommit: shell markers missing — refusing unscoped insert.',
    };
  }
  if (gate.openScope === 'none') {
    if (!/hollow\s*\([^,]+,\s*[^,]+,\s*'none'\s*\)/.test(owned)) {
      return {
        ok: false,
        message: "composeShellCommit: closed opening must emit 'none'.",
      };
    }
  } else if (!/\{\s*center:\s*\[/.test(owned)) {
    return {
      ok: false,
      message: 'composeShellCommit: face opening must emit a { center, normal } literal.',
    };
  }
  const multi = Array.isArray(gate.face?.group) && gate.face.group.length > 1;
  if (multi && !/hollow\s*\(\s*[^,]+,\s*[^,]+,\s*\[/.test(owned)) {
    return {
      ok: false,
      message: 'composeShellCommit: several opening faces must emit one hollow() with an array.',
    };
  }
  if ((owned.match(/hollow\s*\(/g) || []).length !== 1) {
    return {
      ok: false,
      message: 'composeShellCommit: Shell must emit exactly one hollow().',
    };
  }
  return { ok: true, buffer: composed, run: true };
}
