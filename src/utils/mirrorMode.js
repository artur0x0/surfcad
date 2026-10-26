/**
 * Mirror mode — double-click a body, then pick the plane.
 * Confirm writes one mirror() and replaces a previous Mirror block, the way
 * Move replaces its Move block.
 *
 * The plane is XY, YZ, or ZX through the origin, a user workplane, or a
 * planar face. The body is the same { at } centroid move() uses. The copy
 * is a preview until Confirm. There is no second kernel.
 */

import { MIRROR_BEGIN, MIRROR_END } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { snapMoveBodyAt } from './moveMode.js';
import { listConstructionPlanes, resolveConstructionPlane } from './savedContours.js';

export const MIRROR_ENTRY_ID = 'mirror';

export const MIRROR_MODE_NEED_BODY = 'Double-click a body to mirror.';
export const MIRROR_MODE_NEED_PLANE = 'Pick a plane: XY, YZ, ZX, a workplane, or a planar face.';

const NAMED_PLANES = Object.freeze({
  xy: Object.freeze({ center: [0, 0, 0], normal: [0, 0, 1] }),
  xz: Object.freeze({ center: [0, 0, 0], normal: [0, 1, 0] }),
  yz: Object.freeze({ center: [0, 0, 0], normal: [1, 0, 0] }),
});

const NAMED_LABELS = Object.freeze({ xy: 'XY', yz: 'YZ', xz: 'ZX' });

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

function vec3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out = v.slice(0, 3).map(Number);
  return out.every(Number.isFinite) ? out : null;
}

function unit3(v) {
  const raw = vec3(v);
  if (!raw) return null;
  const len = Math.hypot(raw[0], raw[1], raw[2]);
  if (!(len > 1e-12)) return null;
  return [raw[0] / len, raw[1] / len, raw[2] / len];
}

export function emptyMirrorState() {
  return {
    entry: MIRROR_ENTRY_ID,
    body: 'part',
    target: null,
    /** 'xy' | 'yz' | 'xz' | 'face' | 'workplane' | null */
    planeSource: null,
    facePlane: null,
    workplane: null,
    keepOriginal: true,
  };
}

export function clearMirrorTarget(state) {
  if (!state) return emptyMirrorState();
  return { ...state, target: null };
}

/** { center, normal, named } for the picked plane, or null when nothing is picked. */
export function mirrorPlaneFrame(state) {
  const src = state?.planeSource;
  if (src === 'xy' || src === 'yz' || src === 'xz') {
    const named = NAMED_PLANES[src];
    return { center: named.center.slice(), normal: named.normal.slice(), named: src };
  }
  if (src === 'face') {
    const center = vec3(state?.facePlane?.center);
    const normal = unit3(state?.facePlane?.normal);
    if (!center || !normal) return null;
    return { center, normal, named: null };
  }
  if (src === 'workplane') {
    const center = vec3(state?.workplane?.center);
    const normal = unit3(state?.workplane?.normal);
    if (!center || !normal) return null;
    return { center, normal, named: null };
  }
  return null;
}

export function mirrorPlaneLabel(state) {
  const src = state?.planeSource;
  if (src === 'xy' || src === 'yz' || src === 'xz') return NAMED_LABELS[src];
  if (src === 'face' && mirrorPlaneFrame(state)) return 'Face';
  if (src === 'workplane' && mirrorPlaneFrame(state)) return state?.workplane?.name || 'Workplane';
  return 'Pick a plane';
}

export function mirrorTargetLabel(target, state) {
  if (!target || !Array.isArray(target.at)) return 'Double-click a body';
  return `Body at ${formatVec(target.at)} · ${mirrorPlaneLabel(state)}`;
}

export function setMirrorNamedPlane(state, named) {
  if (!state || !NAMED_PLANES[named]) return state;
  return { ...state, planeSource: named };
}

export function setMirrorFacePlane(state, facePlane) {
  if (!state) return state;
  const center = vec3(facePlane?.center);
  const normal = unit3(facePlane?.normal);
  if (!center || !normal) return state;
  return { ...state, planeSource: 'face', facePlane: { center, normal } };
}

export function setMirrorWorkplane(state, workplane) {
  if (!state) return state;
  const center = vec3(workplane?.center) || vec3(workplane?.plane?.center);
  const normal = unit3(workplane?.normal) || unit3(workplane?.plane?.normal);
  if (!center || !normal) return state;
  return {
    ...state,
    planeSource: 'workplane',
    workplane: {
      id: workplane.id || workplane.name || 'workplane',
      name: workplane.name || 'Workplane',
      center,
      normal,
    },
  };
}

/**
 * A construction-plane quad click. Origin ids are the standard planes.
 * Anything else is a user workplane.
 */
export function mirrorPlaneFromHit(userData, buffer) {
  const id = String(userData?.planeId || userData?.jointPlaneId || '');
  if (id === 'origin:xy') return { planeSource: 'xy' };
  if (id === 'origin:yz') return { planeSource: 'yz' };
  if (id === 'origin:zx') return { planeSource: 'xz' };
  const row = resolveConstructionPlane(listConstructionPlanes(buffer || ''), id);
  const center = vec3(row?.plane?.center) || vec3(userData?.plane?.center);
  const normal = unit3(row?.plane?.normal) || unit3(userData?.plane?.normal);
  if (!center || !normal) return null;
  return {
    planeSource: 'workplane',
    workplane: {
      id: row?.id || id || 'workplane',
      name: row?.name || 'Workplane',
      center,
      normal,
    },
  };
}

/** Id of the quad to highlight, or null for a face plane. */
export function mirrorSelectedPlaneId(state) {
  const src = state?.planeSource;
  if (src === 'xy') return 'origin:xy';
  if (src === 'yz') return 'origin:yz';
  if (src === 'xz') return 'origin:zx';
  if (src === 'workplane') return state?.workplane?.id || null;
  return null;
}

/** Reflect p across the picked plane. Null until a body and a plane are both set. */
export function mirrorPreviewMap(state) {
  const frame = mirrorPlaneFrame(state);
  const at = vec3(state?.target?.at);
  if (!frame || !at) return null;
  const c = frame.center;
  const n = frame.normal;
  return (p) => {
    const point = vec3(p) || [0, 0, 0];
    const d = 2 * ((point[0] - c[0]) * n[0] + (point[1] - c[1]) * n[1] + (point[2] - c[2]) * n[2]);
    return [point[0] - d * n[0], point[1] - d * n[1], point[2] - d * n[2]];
  };
}

/** The original stays put, so the script anchor is the mesh centroid. */
export function resolveMirrorBodyAt(viewportAt, kernelCentroids) {
  return snapMoveBodyAt(viewportAt, kernelCentroids);
}

export function attachMirrorTargetMesh(target, bodies, kernelCentroids) {
  if (!target || !Array.isArray(target.at)) return target;
  const at = resolveMirrorBodyAt(target.at, kernelCentroids);
  const list = Array.isArray(bodies) ? bodies : [];
  let best = null;
  let bestD = Infinity;
  for (const body of list) {
    const d = dist2(body.at, at);
    if (d < bestD) {
      bestD = d;
      best = body;
    }
  }
  if (!best || bestD > 1) return { ...target, at };
  return {
    ...target,
    at,
    minTri: best.minTri,
    triangles: best.triangles.slice(),
  };
}

function matchingBrace(text) {
  if (!text.startsWith('{')) return -1;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Fields of one mirror() call: plane string or { center, normal }, keep, at. */
export function parseMirrorCall(block) {
  const text = String(block || '');
  const head = text.match(/mirror\s*\(\s*[^,]+,\s*/);
  if (!head) return null;
  let i = head.index + head[0].length;
  const rest = text.slice(i);
  let plane = null;
  const quoted = rest.match(/^['"](xy|xz|yz)['"]/i);
  if (quoted) {
    plane = quoted[1].toLowerCase();
    i += quoted[0].length;
  } else if (rest.startsWith('{')) {
    const end = matchingBrace(rest);
    if (end < 0) return null;
    const obj = rest.slice(0, end + 1);
    const center = obj.match(/center\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\]/);
    const normal = obj.match(/normal\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\]/);
    if (!center || !normal) return null;
    const c = center.slice(1, 4).map(Number);
    const n = normal.slice(1, 4).map(Number);
    if (c.some((v) => !Number.isFinite(v)) || n.some((v) => !Number.isFinite(v))) return null;
    plane = { center: c, normal: n };
    i += end + 1;
  } else {
    return null;
  }
  const keepM = text.slice(i).match(/^\s*,\s*(true|false)/);
  const keepOriginal = keepM ? keepM[1] === 'true' : true;
  const atM = text.match(/bodies\s*:\s*\[\s*\{\s*at\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\]/);
  const at = atM ? atM.slice(1, 4).map(Number) : null;
  if (at && at.some((n) => !Number.isFinite(n))) return null;
  return { plane, keepOriginal, at };
}

/** Card state for a reopened Mirror block. */
export function mirrorStateFromFields(fields) {
  const next = emptyMirrorState();
  next.keepOriginal = fields?.keepOriginal !== false;
  const plane = fields?.plane;
  if (typeof plane === 'string' && NAMED_PLANES[plane]) {
    next.planeSource = plane;
  } else if (plane && typeof plane === 'object') {
    const seeded = setMirrorWorkplane(next, {
      id: 'edited',
      name: 'Plane',
      center: plane.center,
      normal: plane.normal,
    });
    if (seeded) Object.assign(next, seeded);
  }
  if (Array.isArray(fields?.at) && fields.at.length >= 3) {
    next.target = { at: fields.at.slice(0, 3).map(Number) };
  }
  return next;
}

export function validateMirrorAccept(state) {
  const at = state?.target?.at;
  if (!Array.isArray(at) || at.length < 3 || at.slice(0, 3).some((v) => !Number.isFinite(Number(v)))) {
    return { ok: false, message: MIRROR_MODE_NEED_BODY };
  }
  const frame = mirrorPlaneFrame(state);
  if (!frame) return { ok: false, message: MIRROR_MODE_NEED_PLANE };
  const tri = state?.target?.minTri;
  return {
    ok: true,
    at: at.slice(0, 3).map(Number),
    frame,
    tri: Number.isFinite(Number(tri)) ? Number(tri) : null,
    keepOriginal: state?.keepOriginal !== false,
  };
}

function planeLiteral(frame) {
  if (frame.named) return `'${frame.named}'`;
  return `{ center: ${formatVec(frame.center)}, normal: ${formatVec(frame.normal)} }`;
}

export function stripMirrorBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(MIRROR_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(MIRROR_END, i);
  if (j < 0) return text;
  const after = text.slice(j + MIRROR_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → one mirror() wrapped in Mirror markers.
 * Always names the body. Always replaces the last marked Mirror block.
 * Leaving without confirm does not call this.
 */
export function composeMirrorCommit(buffer, state) {
  const gate = validateMirrorAccept(state);
  if (!gate.ok) return gate;
  const bodyName = state?.body || 'part';
  const triLit = gate.tri != null ? `, tri: ${gate.tri}` : '';
  const call = `${bodyName} = mirror(${bodyName}, ${planeLiteral(gate.frame)}, ${gate.keepOriginal}, { bodies: [{ at: ${formatVec(gate.at)}${triLit} }] });`;
  const block = [MIRROR_BEGIN, call, MIRROR_END].join('\n');
  const composed = placeBlockBeforeReturn(stripMirrorBlock(String(buffer || '')), block);
  const ownedStart = composed.lastIndexOf(MIRROR_BEGIN);
  const ownedEnd = composed.indexOf(MIRROR_END, ownedStart);
  const owned = composed.slice(ownedStart, ownedEnd + MIRROR_END.length);
  if ((owned.match(/\bmirror\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeMirrorCommit: Mirror must emit exactly one mirror().' };
  }
  return { ok: true, buffer: composed, run: true };
}
