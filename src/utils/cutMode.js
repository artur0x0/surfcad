/**
 * Cut mode — pick a plane (a planar face, or an explicit XY / YZ / ZX plane)
 * and one or more bodies. The plane splits every selected body that crosses
 * it. After the cut, tap any resulting piece to delete it. Pieces that stay
 * are separate bodies. A body that does not cross the plane is left as it was.
 *
 * Confirm writes one cut() and replaces a previous Cut block, the way Shell
 * replaces hollow() and Draft replaces draftFaces(). A face plane is emitted
 * as { center, normal } — never a guessed world axis. A face offset moves
 * that plane along the face normal and is written as `offset` only when it
 * is not 0. An explicit plane is { normal, originOffset }.
 *
 * Several bodies or several pieces use the Shell picker: tap to add, tap
 * again to remove, Undo drops the last pick, Clear drops that list. No
 * shift-click.
 */

import { CUT_BEGIN, CUT_END } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { meshBodyComponents } from './meshBodyComponents.js';
import { lastFeatureBlock } from './featureBlockId.js';
import { mintBlockIds } from './featureBlockMint.js';

export { meshBodyComponents };

export const CUT_ENTRY_ID = 'cut';

/** Same gap the kernel uses. A body must pass the plane by more than this to be cut. */
export const CUT_PLANE_EPS = 1e-5;

export const CUT_EXPLICIT_PLANES = Object.freeze({
  xy: { normal: [0, 0, 1], label: 'XY' },
  yz: { normal: [1, 0, 0], label: 'YZ' },
  zx: { normal: [0, 1, 0], label: 'ZX' },
});

export const CUT_MODE_NEED_PLANE = 'Pick a planar face, or choose XY, YZ, or ZX.';
export const CUT_MODE_NEED_BODIES = 'Tap the bodies to cut. Tap a body again to remove it.';
export const CUT_MODE_ALL_DROPPED = 'Every piece is hidden. Tap a hidden piece to bring it back.';

/** Slightly translucent, one per resulting piece, stable for the life of the list. */
export const CUT_PIECE_COLORS = Object.freeze([
  0x38bdf8,
  0xfbbf24,
  0xc084fc,
  0x4ade80,
  0xfb7185,
  0x2dd4bf,
  0xf97316,
  0x818cf8,
]);
export const CUT_PIECE_OPACITY = 0.78;

function round3(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

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

export function unit3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-12)) return null;
  return [x / len, y / len, z / len];
}

function readPos(positions, i) {
  if (positions && typeof positions.getX === 'function') {
    return [positions.getX(i), positions.getY(i), positions.getZ(i)];
  }
  const arr = positions?.array || positions;
  if (!arr) return [0, 0, 0];
  return [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
}

function readIndex(index) {
  if (!index) return null;
  return index.array || index;
}

export function emptyCutState() {
  return {
    entry: CUT_ENTRY_ID,
    /** 'face' | 'xy' | 'yz' | 'zx' */
    planeSource: 'face',
    planeFace: null,
    originOffset: 0,
    /** 'plane' | 'bodies' | 'pieces' — which sticky list a tap edits. */
    pick: 'plane',
    bodies: [],
    drop: [],
    body: 'part',
  };
}

export function cutBodyKey(body) {
  const c = body?.at || body?.center;
  if (!Array.isArray(c)) return '';
  const base = c.map(round3).join(',');
  return body?.minTri != null ? `${base}|${body.minTri}` : base;
}

export function cutPointsMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.map(round3).join(',') === b.map(round3).join(',');
}

export function bodyContainingTriangle(bodies, tri) {
  const list = Array.isArray(bodies) ? bodies : [];
  const t = Number(tri);
  return list.find((b) => Array.isArray(b.triangles) && b.triangles.includes(t)) || null;
}

/**
 * The plane the chip will cut with.
 * A face contributes its own center and normal. An explicit plane contributes
 * a fixed normal plus originOffset. Nothing here snaps a face onto x/y/z.
 */
export function cutPlaneFromState(state) {
  if (!state) return null;
  if (state.planeSource === 'face') {
    const face = state.planeFace;
    if (!face || !Array.isArray(face.center) || !Array.isArray(face.normal)) return null;
    const normal = unit3(face.normal);
    if (!normal) return null;
    const center = face.center.map(Number);
    if (center.some((v) => !Number.isFinite(v))) return null;
    const faceOffset = Number(state.originOffset);
    const extra = Number.isFinite(faceOffset) ? faceOffset : 0;
    const originOffset = normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2] + extra;
    return { source: 'face', normal, center, originOffset, faceOffset: extra };
  }
  const spec = CUT_EXPLICIT_PLANES[state.planeSource];
  if (!spec) return null;
  const offset = Number(state.originOffset);
  return {
    source: state.planeSource,
    normal: spec.normal.slice(),
    originOffset: Number.isFinite(offset) ? offset : 0,
  };
}

function signedDistance(point, plane) {
  return plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2] - plane.originOffset;
}

/**
 * Does this mesh body cross the plane? Extents come from its vertices.
 * @returns {{ crosses: boolean, wholeSide: '+'|'-'|null, min: number, max: number }}
 */
export function classifyCutBody(body, plane, positions, index) {
  if (!body || !plane) return { crosses: false, wholeSide: '+', min: 0, max: 0 };
  const idx = readIndex(index);
  let min = Infinity;
  let max = -Infinity;
  const seen = new Set();
  const tris = body.triangles || [];
  if (idx && positions && tris.length) {
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        if (seen.has(v)) continue;
        seen.add(v);
        const d = signedDistance(readPos(positions, v), plane);
        if (d < min) min = d;
        if (d > max) max = d;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { crosses: !!body.crosses, wholeSide: body.wholeSide || '+', min: 0, max: 0 };
  }
  const crosses = min < -CUT_PLANE_EPS && max > CUT_PLANE_EPS;
  const wholeSide = crosses ? null : (min >= -CUT_PLANE_EPS ? '+' : '-');
  return { crosses, wholeSide, min, max };
}

/** Which resulting piece a triangle belongs to. Non-crossing bodies have one piece. */
export function trianglePieceSide(tri, body, info, plane, positions, index) {
  if (!info?.crosses) return info?.wholeSide || '+';
  const idx = readIndex(index);
  if (!idx || !positions || !plane) return '+';
  const i0 = idx[tri * 3];
  const i1 = idx[tri * 3 + 1];
  const i2 = idx[tri * 3 + 2];
  const a = readPos(positions, i0);
  const b = readPos(positions, i1);
  const c = readPos(positions, i2);
  const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const d = signedDistance(centroid, plane);
  if (Math.abs(d) <= CUT_PLANE_EPS) return '0';
  return d > 0 ? '+' : '-';
}

function copyBody(body) {
  return {
    center: body.center.map(Number),
    at: (body.at || body.center).map(Number),
    triangles: body.triangles.slice(),
    minTri: body.minTri,
  };
}

function withoutDropsFor(drop, body) {
  const key = cutBodyKey(body);
  return (drop || []).filter((d) => d.key !== key);
}

export function setCutPlaneSource(state, source) {
  const s = state || emptyCutState();
  const known = source === 'face' || Object.prototype.hasOwnProperty.call(CUT_EXPLICIT_PLANES, source);
  const nextSource = known ? source : s.planeSource;
  const next = { ...s, planeSource: nextSource, drop: [] };
  if (nextSource === 'face') {
    next.pick = s.planeFace ? (s.pick === 'plane' ? 'bodies' : s.pick) : 'plane';
  } else if (s.pick === 'plane') {
    next.pick = 'bodies';
  }
  return next;
}

export function setCutOriginOffset(state, originOffset) {
  const s = state || emptyCutState();
  return { ...s, originOffset, drop: [] };
}

export function setCutPickTarget(state, pick) {
  const s = state || emptyCutState();
  if (pick !== 'plane' && pick !== 'bodies' && pick !== 'pieces') return s;
  if (pick === 'plane' && s.planeSource !== 'face') return s;
  return { ...s, pick };
}

/**
 * Tap while the plane target is armed, or while Bodies / Pieces is armed.
 * @returns {{ state: object, toast?: string }}
 */
export function applyCutTap(state, tap = {}) {
  const s = state || emptyCutState();
  if (s.pick === 'plane') {
    const face = tap.face;
    if (!face || !Array.isArray(face.center) || !Array.isArray(face.normal)) {
      return { state: s, toast: 'Tap a planar face to set the cutting plane.' };
    }
    const normal = unit3(face.normal);
    if (!normal) return { state: s, toast: 'That face has no plane.' };
    return {
      state: {
        ...s,
        planeSource: 'face',
        planeFace: {
          center: face.center.map(Number),
          normal: normal,
          indices: Array.isArray(face.indices) ? face.indices.slice() : undefined,
        },
        pick: 'bodies',
        drop: [],
      },
    };
  }

  const positions = tap.positions;
  const index = tap.index;
  const bodies = meshBodyComponents(positions, index);
  const hit = bodyContainingTriangle(bodies, tap.triangle);
  if (!hit) return { state: s, toast: 'Tap a body.' };

  if (s.pick === 'pieces') {
    const selected = (s.bodies || []).find((b) => cutBodyKey(b) === cutBodyKey(hit));
    if (!selected) {
      return { state: s, toast: 'That body is not being cut. Switch to Bodies, or tap a selected body.' };
    }
    const plane = cutPlaneFromState(s);
    if (!plane) return { state: s, toast: CUT_MODE_NEED_PLANE };
    const info = classifyCutBody(hit, plane, positions, index);
    let side;
    if (!info.crosses) {
      side = info.wholeSide;
    } else if (!Array.isArray(tap.point)) {
      return { state: s, toast: 'Tap a piece off the plane.' };
    } else {
      const d = signedDistance(tap.point, plane);
      if (Math.abs(d) <= CUT_PLANE_EPS) {
        return { state: s, toast: 'That point is on the plane. Tap either side of it.' };
      }
      side = d > 0 ? '+' : '-';
    }
    const key = cutBodyKey(selected);
    const drop = (s.drop || []).slice();
    const idx = drop.findIndex((d) => d.key === key && d.side === side);
    if (idx >= 0) drop.splice(idx, 1);
    else drop.push({ key, at: selected.at.map(Number), side });
    return { state: { ...s, drop } };
  }

  const list = (s.bodies || []).slice();
  const key = cutBodyKey(hit);
  const idx = list.findIndex((b) => cutBodyKey(b) === key);
  if (idx >= 0) {
    const removed = list[idx];
    list.splice(idx, 1);
    return { state: { ...s, bodies: list, drop: withoutDropsFor(s.drop, removed) } };
  }
  list.push(copyBody(hit));
  return { state: { ...s, bodies: list } };
}

/** Undo drops the last pick of the active list. */
export function popLastCutPick(state) {
  const s = state || emptyCutState();
  if (s.pick === 'plane') return { ...s, planeFace: null };
  if (s.pick === 'pieces') {
    const drop = (s.drop || []).slice();
    drop.pop();
    return { ...s, drop };
  }
  const bodies = (s.bodies || []).slice();
  const removed = bodies.pop();
  return { ...s, bodies, drop: removed ? withoutDropsFor(s.drop, removed) : (s.drop || []) };
}

/** Clear drops the active list. Clearing bodies also drops their piece marks. */
export function clearCutPicks(state) {
  const s = state || emptyCutState();
  if (s.pick === 'plane') return { ...s, planeFace: null };
  if (s.pick === 'pieces') return { ...s, drop: [] };
  return { ...s, bodies: [], drop: [] };
}

function pieceList(info) {
  if (info.crosses) return ['+', '-'];
  return [info.wholeSide || '+'];
}

function isDropped(drop, body, side) {
  const key = cutBodyKey(body);
  return (drop || []).some((d) => d.key === key && d.side === side);
}

/**
 * Pieces the cut would produce for the bodies already picked.
 * A hidden piece is one the user tapped to delete. It stays in the list so
 * a later tap can bring it back. Colors stay put when a piece is hidden.
 */
export function listCutPieces(state, positions, index) {
  const plane = cutPlaneFromState(state);
  if (!plane) return [];
  const bodies = Array.isArray(state?.bodies) ? state.bodies : [];
  const out = [];
  for (const body of bodies) {
    const info = classifyCutBody(body, plane, positions, index);
    const buckets = new Map();
    for (const tri of body.triangles || []) {
      let side = trianglePieceSide(tri, body, info, plane, positions, index);
      if (side === '0') side = '+';
      let list = buckets.get(side);
      if (!list) {
        list = [];
        buckets.set(side, list);
      }
      list.push(tri);
    }
    const sides = info.crosses ? ['+', '-'] : [info.wholeSide || '+'];
    for (const side of sides) {
      out.push({
        key: cutBodyKey(body),
        side,
        triangles: buckets.get(side) || [],
        hidden: isDropped(state?.drop, body, side),
      });
    }
  }
  return out.map((piece, i) => ({
    ...piece,
    color: CUT_PIECE_COLORS[i % CUT_PIECE_COLORS.length],
  }));
}

/**
 * @param {object} state
 * @param {{ positions?: object, index?: object, bodyCount?: number }} [mesh]
 */
export function validateCutAccept(state, mesh = null) {
  const s = state || emptyCutState();
  const plane = cutPlaneFromState(s);
  if (!plane) return { ok: false, message: CUT_MODE_NEED_PLANE };
  const bodies = Array.isArray(s.bodies) ? s.bodies : [];
  if (!bodies.length) return { ok: false, message: CUT_MODE_NEED_BODIES };
  const positions = mesh?.positions;
  const index = mesh?.index;
  const infos = bodies.map((b) => classifyCutBody(b, plane, positions, index));
  let plusPieces = 0;
  let minusPieces = 0;
  let plusDropped = 0;
  let minusDropped = 0;
  let kept = 0;
  bodies.forEach((body, i) => {
    for (const side of pieceList(infos[i])) {
      if (side === '+') plusPieces++;
      else minusPieces++;
      if (isDropped(s.drop, body, side)) {
        if (side === '+') plusDropped++;
        else minusDropped++;
      } else {
        kept++;
      }
    }
  });
  const bodyCount = Number.isFinite(mesh?.bodyCount) ? mesh.bodyCount : bodies.length;
  const unselected = Math.max(0, bodyCount - bodies.length);
  if (kept + unselected <= 0) return { ok: false, message: CUT_MODE_ALL_DROPPED };

  let keep = 'both';
  if (plusDropped === 0 && minusDropped === 0) keep = 'both';
  else if (plusDropped === 0 && minusPieces > 0 && minusDropped === minusPieces) keep = '+';
  else if (minusDropped === 0 && plusPieces > 0 && plusDropped === plusPieces) keep = '-';
  else keep = 'drop';

  return {
    ok: true,
    plane,
    keep,
    bodies,
    infos,
    bodyCount,
    allBodies: bodies.length >= bodyCount,
  };
}

function planeLiteral(plane) {
  if (plane.source === 'face') {
    const base = `{ center: ${formatVec(plane.center)}, normal: ${formatVec(plane.normal)}`;
    const off = formatNum(plane.faceOffset);
    if (off !== '0') return `${base}, offset: ${off} }`;
    return `${base} }`;
  }
  return `{ normal: ${formatVec(plane.normal)}, originOffset: ${formatNum(plane.originOffset)} }`;
}

export function stripCutBlock(buffer) {
  const text = String(buffer || '');
  const blk = lastFeatureBlock(text, CUT_BEGIN, CUT_END);
  if (!blk) return text;
  const i = blk.start;
  const after = text.slice(blk.end).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → one cut() wrapped in Cut markers.
 * Always replaces the last marked Cut block.
 */
export function composeCutCommit(buffer, state, mesh = null) {
  const gate = validateCutAccept(state, mesh);
  if (!gate.ok) return gate;
  const bodyName = state?.body || 'part';
  const planeLit = planeLiteral(gate.plane);
  if (gate.plane.source === 'face' && /['"]/.test(planeLit)) {
    return { ok: false, message: 'composeCutCommit: a face plane must not be written as a world axis.' };
  }
  const optParts = [];
  if (!gate.allBodies) {
    const specs = gate.bodies.map((b) => `{ at: ${formatVec(b.at)} }`).join(', ');
    optParts.push(`bodies: [${specs}]`);
  }
  if (gate.keep === '+' || gate.keep === '-') {
    optParts.push(`keep: '${gate.keep}'`);
  } else if (gate.keep === 'drop') {
    const drops = (state.drop || []).map((d) => `{ at: ${formatVec(d.at)}, side: '${d.side}' }`).join(', ');
    optParts.push(`drop: [${drops}]`);
  }
  const call = optParts.length
    ? `${bodyName} = cut(${bodyName}, ${planeLit}, { ${optParts.join(', ')} });`
    : `${bodyName} = cut(${bodyName}, ${planeLit});`;
  const base = stripCutBlock(String(buffer || ''));
  const block = mintBlockIds([CUT_BEGIN, call, CUT_END].join('\n'), base);
  const composed = placeBlockBeforeReturn(base, block);
  const owned = lastFeatureBlock(composed, CUT_BEGIN, CUT_END)?.text || '';
  if ((owned.match(/cut\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeCutCommit: Cut must emit exactly one cut().' };
  }
  if (gate.plane.source === 'face') {
    if (!/\{\s*center:\s*\[/.test(owned) || !/normal:\s*\[/.test(owned)) {
      return { ok: false, message: 'composeCutCommit: a face plane must emit { center, normal }.' };
    }
    if (/'[xyz]'|"[xyz]"|'(xy|yz|zx)'/.test(owned)) {
      return { ok: false, message: 'composeCutCommit: a face plane must not guess a world axis.' };
    }
  }
  return { ok: true, buffer: composed, run: true };
}
