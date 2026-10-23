/**
 * Rotate mode — double-click a body, then set an axis, an angle, and a
 * center. Confirm writes one rotateAbout() and replaces a previous Rotate
 * block, the way Move replaces its Move block.
 *
 * rotateAbout() turns the named body about the line through the center
 * along the axis (right-hand rule, degrees). The body is the same { at }
 * centroid move() and cut() use. The center defaults to that body's own
 * centroid. There is no second kernel and no viewport gizmo.
 */

import { ROTATE_BEGIN, ROTATE_END, rotateAxisLiteral } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { snapMoveBodyAt } from './moveMode.js';

export const ROTATE_ENTRY_ID = 'rotate';

export const ROTATE_MODE_NEED_BODY = 'Double-click a body to rotate.';
export const ROTATE_MODE_NEED_ANGLE = 'Angle must be a number of degrees.';
export const ROTATE_MODE_NEED_AXIS = 'The axis must not be zero.';
export const ROTATE_MODE_NEED_FACE = 'Click a face to turn about its normal.';
export const ROTATE_MODE_NEED_CENTER = 'Center X, Y, and Z must be numbers.';

/** Axis choices on the card: a world axis, the picked face normal, or a typed vector. */
export const ROTATE_AXIS_CHOICES = Object.freeze(['x', 'y', 'z', 'face', 'custom']);

function formatNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Object.is(v, -0)) return '0';
  const r = Math.round(v * 1e4) / 1e4;
  if (r === 0) return '0';
  return String(r);
}

function formatVec(arr) {
  const a = Array.isArray(arr) ? arr : [0, 0, 0];
  return `[${formatNum(a[0])}, ${formatNum(a[1])}, ${formatNum(a[2])}]`;
}

function dist2(a, b) {
  const dx = Number(a[0]) - Number(b[0]);
  const dy = Number(a[1]) - Number(b[1]);
  const dz = Number(a[2]) - Number(b[2]);
  return dx * dx + dy * dy + dz * dz;
}

function unit3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-12) || !Number.isFinite(len)) return null;
  return [x / len, y / len, z / len];
}

function vec3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out = v.slice(0, 3).map(Number);
  return out.every(Number.isFinite) ? out : null;
}

const NAMED_AXES = Object.freeze({
  x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1],
});

export function emptyRotateState() {
  return {
    entry: ROTATE_ENTRY_ID,
    body: 'part',
    target: null,
    /** 'x' | 'y' | 'z' | 'face' | 'custom' */
    axis: 'z',
    /** The typed vector for 'custom'. */
    axisVec: [0, 0, 1],
    /** Normal of the last single-clicked face, for 'face'. */
    faceNormal: null,
    angle: 0,
    /** 'body' (the body's own centroid) | 'custom' (typed point). */
    centerMode: 'body',
    center: [0, 0, 0],
  };
}

export function clearRotateTarget(state) {
  if (!state) return emptyRotateState();
  return { ...state, target: null };
}

/**
 * The axis as a unit vector for the given state, or null when the choice
 * has nothing to turn about yet (no face picked, a zero custom vector).
 */
export function rotateAxisVector(state) {
  const which = state?.axis || 'z';
  if (NAMED_AXES[which]) return NAMED_AXES[which].slice();
  if (which === 'face') return unit3(state?.faceNormal);
  return unit3(state?.axisVec);
}

/**
 * The script literal for the axis: a world axis keeps its name ('z'), a face
 * normal or a typed vector is written as [ax, ay, az].
 */
export function rotateAxisScriptValue(state) {
  const which = state?.axis || 'z';
  if (NAMED_AXES[which]) return which;
  return rotateAxisVector(state);
}

/** 'x' | 'y' | 'z' | '-x' … for a literal, or the parsed vector. Null when it is neither. */
export function parseRotateAxisLiteral(text) {
  const raw = String(text ?? '').trim();
  const quoted = raw.match(/^['"](-?[xyz])['"]$/i);
  if (quoted) return quoted[1].toLowerCase();
  if (raw.startsWith('[')) {
    try {
      return vec3(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (/^-?[xyz]$/i.test(raw)) return raw.toLowerCase();
  return null;
}

/** Unit vector for a parsed axis ('z' or [ax, ay, az]). */
export function axisToVector(axis) {
  if (typeof axis === 'string') return NAMED_AXES[axis.toLowerCase()] ? NAMED_AXES[axis.toLowerCase()].slice() : null;
  return unit3(axis);
}

export function sameRotateAxis(a, b) {
  const va = axisToVector(a);
  const vb = axisToVector(b);
  if (!va || !vb) return a === b;
  return dist2(va, vb) <= 1e-9;
}

export function sameVec3(a, b) {
  const va = vec3(a);
  const vb = vec3(b);
  if (!va && !vb) return a == null && b == null;
  if (!va || !vb) return false;
  return dist2(va, vb) <= 1e-9;
}

/** 3×3 rotation (rows) of angleDeg about the unit axis k. Right-hand rule. */
export function rotationMatrix(k, angleDeg) {
  const t = (Number(angleDeg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const u = 1 - c;
  const [x, y, z] = k;
  return [
    [c + x * x * u, x * y * u - z * s, x * z * u + y * s],
    [y * x * u + z * s, c + y * y * u, y * z * u - x * s],
    [z * x * u - y * s, z * y * u + x * s, c + z * z * u],
  ];
}

/** p turned by R about pivot. */
export function rotatePoint(R, p, pivot) {
  const dx = p[0] - pivot[0];
  const dy = p[1] - pivot[1];
  const dz = p[2] - pivot[2];
  return [
    pivot[0] + R[0][0] * dx + R[0][1] * dy + R[0][2] * dz,
    pivot[1] + R[1][0] * dx + R[1][1] * dy + R[1][2] * dz,
    pivot[2] + R[2][0] * dx + R[2][1] * dy + R[2][2] * dz,
  ];
}

/** Last marked rotateAbout(), so a replaced block still names the pre-rotate body. */
export function parseLastRotate(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(ROTATE_BEGIN);
  if (i < 0) return null;
  const j = text.indexOf(ROTATE_END, i);
  if (j < 0) return null;
  const chunk = text.slice(i, j);
  const m = chunk.match(
    /rotateAbout\(\s*\w+\s*,\s*('[-+]?[xyzXYZ]'|"[-+]?[xyzXYZ]"|\[[^\]]*\])\s*,\s*([-+0-9.eE]+)\s*,\s*(null|\[[^\]]*\])\s*,\s*\{\s*bodies:\s*\[\s*\{\s*at:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\s*\](?:\s*,\s*tri:\s*(\d+))?/,
  );
  if (!m) return null;
  const axis = parseRotateAxisLiteral(m[1]);
  const angle = Number(m[2]);
  let center = null;
  if (m[3] !== 'null') {
    try {
      center = vec3(JSON.parse(m[3]));
    } catch {
      return null;
    }
    if (!center) return null;
  }
  const at = [m[4], m[5], m[6]].map(Number);
  if (!axis || !Number.isFinite(angle) || at.some((n) => !Number.isFinite(n))) return null;
  const tri = m[7] != null && m[7] !== '' ? Number(m[7]) : null;
  return { axis, angle, center, at, tri: Number.isFinite(tri) ? tri : null };
}

/** { R, pivot } for a parsed rotate (pivot is the body centroid when center is null), or null. */
export function rotationOf(spec) {
  const k = axisToVector(spec?.axis);
  if (!k || !Number.isFinite(Number(spec?.angle))) return null;
  const pivot = vec3(spec.center) || vec3(spec.at);
  if (!pivot) return null;
  return { R: rotationMatrix(k, spec.angle), pivot };
}

/**
 * World centroid for the subtitle. When the anchor matches the last rotate
 * block, the body already sits where that rotate left its centroid.
 */
export function rotateBodyWorldAt(anchorAt, buffer) {
  const at = vec3(anchorAt);
  if (!at) return null;
  const prev = parseLastRotate(buffer);
  if (prev && dist2(at, prev.at) <= 1e-4) {
    const xf = rotationOf(prev);
    if (xf) return rotatePoint(xf.R, prev.at, xf.pivot);
  }
  return at;
}

export function rotateTargetLabel(target, opts = {}) {
  if (!target || !Array.isArray(target.at)) return 'Double-click a body';
  const buffer = typeof opts.buffer === 'string' ? opts.buffer : '';
  const world = rotateBodyWorldAt(target.at, buffer) || target.at;
  return `Body at ${formatVec(world)}`;
}

/**
 * Viewport centroids are post-rotate; the script names the pre-rotate body.
 * When the picked centroid is where the last rotate left that body, keep the
 * pre-rotate { at } so a second confirm still replaces the block.
 */
export function resolveRotateBodyAt(viewportAt, kernelCentroids, buffer) {
  const view = vec3(viewportAt) || [0, 0, 0];
  const snapped = snapMoveBodyAt(view, kernelCentroids);
  const prev = parseLastRotate(buffer);
  if (!prev) return snapped;
  const xf = rotationOf(prev);
  if (!xf) return snapped;
  const turned = rotatePoint(xf.R, prev.at, xf.pivot);
  if (dist2(snapped, turned) <= 1e-4 || dist2(view, turned) <= 1e-4) {
    return prev.at.slice();
  }
  return snapped;
}

/** Mesh body whose centroid matches the rotate anchor, before or after its rotate. */
export function findMeshBodyForRotateAnchor(bodies, anchorAt, kernelCentroids, buffer) {
  const list = Array.isArray(bodies) ? bodies : [];
  const anchor = vec3(anchorAt);
  if (!anchor) return null;
  const world = rotateBodyWorldAt(anchor, buffer) || anchor;
  let best = null;
  let bestD = Infinity;
  for (const body of list) {
    const resolved = resolveRotateBodyAt(body.at, kernelCentroids, buffer);
    const current = snapMoveBodyAt(body.at, kernelCentroids);
    const d = Math.min(dist2(resolved, anchor), dist2(current, world));
    if (d < bestD) {
      bestD = d;
      best = body;
    }
  }
  if (!best || bestD > 1) return null;
  return best;
}

export function attachRotateTargetMesh(target, bodies, kernelCentroids, buffer) {
  if (!target || !Array.isArray(target.at)) return target;
  const hit = findMeshBodyForRotateAnchor(bodies, target.at, kernelCentroids, buffer);
  if (!hit) return target;
  return {
    ...target,
    at: resolveRotateBodyAt(hit.at, kernelCentroids, buffer),
    minTri: hit.minTri,
    triangles: hit.triangles.slice(),
  };
}

/**
 * After a body pick, an untouched card takes the last rotate's axis, angle,
 * and center when that block names this body, so Confirm replaces it with
 * the same values instead of adding a second turn.
 */
export function seedRotateFromLastRotate(state, buffer, anchorAt) {
  if (!state) return state;
  const prev = parseLastRotate(buffer);
  const at = vec3(anchorAt);
  if (!prev || !at || dist2(at, prev.at) > 1e-4) return state;
  const untouched = (Number(state.angle) || 0) === 0 && state.axis === 'z' && (state.centerMode || 'body') === 'body';
  if (!untouched) return state;
  const next = { ...state, angle: prev.angle };
  if (typeof prev.axis === 'string' && NAMED_AXES[prev.axis]) {
    next.axis = prev.axis;
  } else if (Array.isArray(prev.axis)) {
    next.axis = 'custom';
    next.axisVec = prev.axis.slice();
  }
  if (prev.center) {
    next.centerMode = 'custom';
    next.center = prev.center.slice();
  }
  return next;
}

export function validateRotateAccept(state) {
  const at = vec3(state?.target?.at);
  if (!at) return { ok: false, message: ROTATE_MODE_NEED_BODY };
  const which = state?.axis || 'z';
  if (which === 'face' && !unit3(state?.faceNormal)) {
    return { ok: false, message: ROTATE_MODE_NEED_FACE };
  }
  const k = rotateAxisVector(state);
  if (!k) return { ok: false, message: ROTATE_MODE_NEED_AXIS };
  const angle = Number(state?.angle);
  if (!Number.isFinite(angle)) return { ok: false, message: ROTATE_MODE_NEED_ANGLE };
  let center = null;
  if ((state?.centerMode || 'body') === 'custom') {
    center = vec3(state?.center);
    if (!center) return { ok: false, message: ROTATE_MODE_NEED_CENTER };
  }
  const tri = state?.target?.minTri;
  return {
    ok: true,
    axis: rotateAxisScriptValue(state),
    axisVec: k,
    angle,
    center,
    at,
    tri: Number.isFinite(Number(tri)) ? Number(tri) : null,
  };
}

/**
 * Point map for the ghost while the card changes. A replaced rotate is
 * absolute from the pre-rotate solid, so the body that already turned is
 * first turned back (the previous block, inverted), then turned by the new
 * values. Null when there is nothing to show (zero angle and no previous
 * rotate, or the same values as the committed block).
 * @returns {((p: number[]) => number[])|null}
 */
export function rotatePreviewMap(state, buffer) {
  const gate = validateRotateAccept(state);
  if (!gate.ok) return null;
  const prev = parseLastRotate(buffer);
  const replacing = prev && dist2(gate.at, prev.at) <= 1e-4 ? prev : null;
  const nextSpec = { axis: gate.axisVec, angle: gate.angle, center: gate.center, at: gate.at };
  if (!replacing) {
    if (Math.abs(gate.angle) < 1e-9) return null;
    const xf = rotationOf(nextSpec);
    if (!xf) return null;
    return (p) => rotatePoint(xf.R, p, xf.pivot);
  }
  const same = Math.abs(gate.angle - replacing.angle) < 1e-9
    && sameRotateAxis(gate.axisVec, replacing.axis)
    && sameVec3(gate.center, replacing.center);
  if (same) return null;
  const old = rotationOf(replacing);
  const next = rotationOf(nextSpec);
  if (!old || !next) return null;
  // Transpose = inverse for a rotation.
  const Rt = [
    [old.R[0][0], old.R[1][0], old.R[2][0]],
    [old.R[0][1], old.R[1][1], old.R[2][1]],
    [old.R[0][2], old.R[1][2], old.R[2][2]],
  ];
  return (p) => rotatePoint(next.R, rotatePoint(Rt, p, old.pivot), next.pivot);
}

export function stripRotateBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(ROTATE_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(ROTATE_END, i);
  if (j < 0) return text;
  const after = text.slice(j + ROTATE_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → one rotateAbout() wrapped in Rotate markers.
 * Always names the body. Always replaces the last marked Rotate block.
 * Leaving without confirm does not call this.
 */
export function composeRotateCommit(buffer, state) {
  const gate = validateRotateAccept(state);
  if (!gate.ok) return gate;
  const bodyName = state?.body || 'part';
  const axisLit = rotateAxisLiteral(gate.axis);
  if (!axisLit) return { ok: false, message: ROTATE_MODE_NEED_AXIS };
  const centerLit = gate.center ? formatVec(gate.center) : 'null';
  const triLit = gate.tri != null ? `, tri: ${gate.tri}` : '';
  const call = `${bodyName} = rotateAbout(${bodyName}, ${axisLit}, ${formatNum(gate.angle)}, ${centerLit}, { bodies: [{ at: ${formatVec(gate.at)}${triLit} }] });`;
  const block = [ROTATE_BEGIN, call, ROTATE_END].join('\n');
  const composed = placeBlockBeforeReturn(stripRotateBlock(String(buffer || '')), block);
  const ownedStart = composed.lastIndexOf(ROTATE_BEGIN);
  const ownedEnd = composed.indexOf(ROTATE_END, ownedStart);
  const owned = composed.slice(ownedStart, ownedEnd + ROTATE_END.length);
  if ((owned.match(/\brotateAbout\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeRotateCommit: Rotate must emit exactly one rotateAbout().' };
  }
  return { ok: true, buffer: composed, run: true };
}
