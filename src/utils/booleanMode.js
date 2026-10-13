/**
 * Boolean mode — union, difference, or intersect of bodies in the active
 * solid. The first picked body is the target. Later bodies are tools.
 * Difference is target − (union of tools). Intersect is target ∩ (union of
 * tools). Intersect then lists the leftover pieces; a tap hides one, a tap
 * again brings it back, the same way Cut's Pieces list works.
 *
 * Picks are stored per part id. Hiding a part (the part manager eye) does
 * not add, remove, or rewrite that part's list. The cross-section manager
 * stays usable while the chip is open: a section hit is matched back to the
 * unsectioned body so the script still names the real centroid.
 *
 * Confirm writes one booleanBodies() and replaces the previous Boolean block.
 *
 * Cross-part (edit-what-you-touch C): picks may span parts. The first pick,
 * in tap order across every part, is the target, and Confirm writes the
 * target's part. A tool body in another part is frozen into the target at
 * Confirm: that part's script text is embedded in the Boolean block as
 * externalBody(function () { … }, { bodies, offset }), posed by the
 * assembly offset. Not linked; deleting the Boolean deletes the copy.
 */

import { BOOLEAN_BEGIN, BOOLEAN_END } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { meshBodyComponents, bodyContainingTriangle, cutBodyKey } from './cutMode.js';
import {
  EXTERNAL_COPY_FAILED_SOURCE,
  externalCopyHeader,
  frozenScriptFunction,
  externalBodyRotationBlock,
  partOffset,
} from './externalCopy.js';

export { meshBodyComponents, bodyContainingTriangle, cutBodyKey };

export const BOOLEAN_ENTRY_ID = 'boolean';

export const BOOLEAN_OPS = Object.freeze(['union', 'difference', 'intersect']);

export const BOOLEAN_MODE_NEED_BODIES = 'Tap the bodies. The first is the target. Tap a body again to remove it.';
export const BOOLEAN_MODE_NEED_TOOL = 'Pick a target and at least one tool body.';
export const BOOLEAN_MODE_ALL_DROPPED = 'Every piece is hidden. Tap a hidden piece to bring it back.';

export const BOOLEAN_PIECE_COLORS = Object.freeze([
  0x38bdf8,
  0xfbbf24,
  0xc084fc,
  0x4ade80,
  0xfb7185,
  0x2dd4bf,
  0xf97316,
  0x818cf8,
]);

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

export function booleanPartKey(partId) {
  if (partId == null || partId === '') return '__active__';
  return String(partId);
}

export function emptyBooleanSlot() {
  return { bodies: [], drop: [] };
}

export function emptyBooleanState() {
  return {
    entry: BOOLEAN_ENTRY_ID,
    op: 'union',
    /** 'bodies' | 'pieces' — pieces is only meaningful for intersect. */
    pick: 'bodies',
    /** part id → { bodies, drop }. Hiding a part must not rewrite its slot. */
    byPart: {},
    /** Tap counter. Each body pick carries `seq` so order spans parts. */
    seq: 0,
    body: 'part',
  };
}

export function booleanOp(value) {
  const v = String(value || 'union').toLowerCase();
  if (v === 'difference' || v === 'subtract' || v === 'cut') return 'difference';
  if (v === 'intersect' || v === 'intersection') return 'intersect';
  return 'union';
}

export function booleanSlot(state, partId) {
  const key = booleanPartKey(partId);
  const slot = state?.byPart?.[key];
  if (!slot) return emptyBooleanSlot();
  return {
    bodies: Array.isArray(slot.bodies) ? slot.bodies : [],
    drop: Array.isArray(slot.drop) ? slot.drop : [],
  };
}

function withSlot(state, partId, slot) {
  const s = state || emptyBooleanState();
  const key = booleanPartKey(partId);
  return {
    ...s,
    byPart: {
      ...(s.byPart || {}),
      [key]: {
        bodies: slot.bodies || [],
        drop: slot.drop || [],
      },
    },
  };
}

function copyBody(body, seq) {
  const out = {
    center: (body.center || body.at).map(Number),
    at: (body.at || body.center).map(Number),
    triangles: (body.triangles || []).slice(),
    minTri: body.minTri,
  };
  if (Number.isFinite(seq)) out.seq = seq;
  if (body.soup) out.soup = body.soup;
  return out;
}

/**
 * The body's triangles as a flat xyz list in that part's frame. Lets the
 * viewport keep showing a pick on a part that is no longer the pick mesh.
 */
export function bodySoup(body, positions, index) {
  const tris = body?.triangles || [];
  if (!tris.length || !positions || !index) return null;
  const out = new Float32Array(tris.length * 9);
  let k = 0;
  for (const tri of tris) {
    const verts = triVerts(tri, positions, index);
    if (!verts) continue;
    for (const v of verts) {
      out[k] = v[0];
      out[k + 1] = v[1];
      out[k + 2] = v[2];
      k += 3;
    }
  }
  return k === out.length ? out : out.slice(0, k);
}

/**
 * Every body pick across parts, in tap order. Picks without `seq` (older
 * state) keep their slot order after the numbered ones.
 */
export function booleanPicksInOrder(state) {
  const byPart = state?.byPart || {};
  const out = [];
  let n = 0;
  for (const [partId, slot] of Object.entries(byPart)) {
    const bodies = Array.isArray(slot?.bodies) ? slot.bodies : [];
    for (const body of bodies) {
      out.push({
        partId,
        body,
        order: Number.isFinite(body?.seq) ? body.seq : 1e9 + n,
      });
      n += 1;
    }
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** Part of the first pick (the target), or null. */
export function booleanTargetPartId(state) {
  const first = booleanPicksInOrder(state)[0];
  return first ? first.partId : null;
}

/** More than one part holds body picks. */
export function booleanCrossPart(state) {
  const parts = new Set(booleanPicksInOrder(state).map((p) => p.partId));
  return parts.size > 1;
}

/**
 * Hiding a part does not clear or change that part's pick status.
 * The bodies and drop arrays already stored for that part are kept as they
 * are. A part that was never picked stays unpicked.
 */
export function noteBooleanPartHidden(state, partId) {
  const s = state || emptyBooleanState();
  const key = booleanPartKey(partId);
  const slot = s.byPart?.[key];
  if (!slot) return s;
  return {
    ...s,
    byPart: {
      ...s.byPart,
      [key]: {
        bodies: slot.bodies,
        drop: slot.drop,
      },
    },
  };
}

/** Stable snapshot of one part's picks, for tests that hide must not move them. */
export function booleanPickSnapshot(state, partId) {
  const slot = booleanSlot(state, partId);
  return {
    bodies: slot.bodies.map((b) => cutBodyKey(b)),
    drop: slot.drop.map((d) => (Array.isArray(d.at) ? d.at.map(round3).join(',') : '')),
  };
}

export function setBooleanOp(state, op) {
  const s = state || emptyBooleanState();
  const next = booleanOp(op);
  const pick = next === 'intersect' ? s.pick : 'bodies';
  return { ...s, op: next, pick };
}

export function setBooleanPickTarget(state, pick) {
  const s = state || emptyBooleanState();
  if (pick !== 'bodies' && pick !== 'pieces') return s;
  if (pick === 'pieces' && booleanOp(s.op) !== 'intersect') return s;
  return { ...s, pick };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Ray from `origin` along `dir` (not necessarily unit) hits the triangle. */
function rayHitsTri(origin, dir, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const pvec = cross(dir, ac);
  const det = dot(ab, pvec);
  if (Math.abs(det) < 1e-10) return false;
  const inv = 1 / det;
  const tvec = sub(origin, a);
  const u = dot(tvec, pvec) * inv;
  if (u < -1e-8 || u > 1 + 1e-8) return false;
  const qvec = cross(tvec, ab);
  const v = dot(dir, qvec) * inv;
  if (v < -1e-8 || u + v > 1 + 1e-8) return false;
  const t = dot(ac, qvec) * inv;
  return t > 1e-8;
}

function triVerts(tri, positions, index) {
  const idx = readIndex(index);
  if (!idx || !positions) return null;
  const i0 = idx[tri * 3];
  const i1 = idx[tri * 3 + 1];
  const i2 = idx[tri * 3 + 2];
  if (i0 == null || i1 == null || i2 == null) return null;
  return [readPos(positions, i0), readPos(positions, i1), readPos(positions, i2)];
}

function pointTriDist2(p, a, b, c) {
  // Distance to the triangle, not its infinite plane. Two bodies that share
  // a plane (a section through both) must not both claim the hit.
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const q = sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]);
    return dot(q, q);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const q = sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]);
    return dot(q, q);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const bc = sub(c, b);
    const q = sub(p, [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w]);
    return dot(q, q);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const q = sub(p, [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ]);
  return dot(q, q);
}

/**
 * Which original body contains `point`. Used when the cross-section manager
 * has replaced the drawn mesh, so the hit triangle is not a triangle of the
 * solid the script will boolean. A point on a body's surface wins. Otherwise
 * the body whose interior contains the point (ray parity), nearest surface
 * if several overlap.
 */
export function bodyContainingPoint(bodies, point, positions, index) {
  const list = Array.isArray(bodies) ? bodies : [];
  if (!Array.isArray(point) || point.length < 3 || !list.length) return null;
  const p = [Number(point[0]), Number(point[1]), Number(point[2])];
  if (p.some((v) => !Number.isFinite(v))) return null;
  // Tilted so a section cap parallel to YZ does not graze every edge.
  const dir = [1, 0.00013, 0.00021];
  let surface = null;
  let surfaceD = 0.05 * 0.05;
  let inside = null;
  let insideD = Infinity;
  for (const body of list) {
    let hits = 0;
    let near = Infinity;
    for (const tri of body.triangles || []) {
      const verts = triVerts(tri, positions, index);
      if (!verts) continue;
      const d2 = pointTriDist2(p, verts[0], verts[1], verts[2]);
      if (d2 < near) near = d2;
      if (rayHitsTri(p, dir, verts[0], verts[1], verts[2])) hits += 1;
    }
    if (near < surfaceD) {
      surface = body;
      surfaceD = near;
    }
    if (hits % 2 === 1 && near < insideD) {
      inside = body;
      insideD = near;
    }
  }
  return surface || inside;
}

/**
 * Body under a tap. A live mesh uses the hit triangle. A sectioned view
 * matches the hit point to the unsectioned body.
 */
export function resolveBooleanBody(tap = {}) {
  if (tap.sectioned && tap.basePositions && tap.baseIndex) {
    const bodies = meshBodyComponents(tap.basePositions, tap.baseIndex);
    return bodyContainingPoint(bodies, tap.point, tap.basePositions, tap.baseIndex);
  }
  const bodies = meshBodyComponents(tap.positions, tap.index);
  return bodyContainingTriangle(bodies, tap.triangle);
}

function pieceKey(at) {
  if (!Array.isArray(at)) return '';
  return at.map(round3).join(',');
}

export function applyBooleanTap(state, tap = {}) {
  const s = state || emptyBooleanState();
  const partId = tap.partId;
  const slot = booleanSlot(s, partId);
  if (s.pick === 'pieces') {
    const at = tap.at;
    if (!Array.isArray(at)) return { state: s, toast: 'Tap a piece.' };
    const key = pieceKey(at);
    const drop = slot.drop.slice();
    const idx = drop.findIndex((d) => pieceKey(d.at) === key);
    if (idx >= 0) drop.splice(idx, 1);
    else drop.push({ at: at.map(Number) });
    return { state: withSlot(s, partId, { bodies: slot.bodies, drop }) };
  }
  const hit = tap.body || resolveBooleanBody(tap);
  if (!hit) return { state: s, toast: 'Tap a body.' };
  const list = slot.bodies.slice();
  const key = cutBodyKey(hit);
  const idx = list.findIndex((b) => cutBodyKey(b) === key);
  if (idx >= 0) {
    list.splice(idx, 1);
    return { state: withSlot(s, partId, { bodies: list, drop: [] }) };
  }
  const seq = (Number.isFinite(s.seq) ? s.seq : 0) + 1;
  const soupPos = tap.sectioned ? tap.basePositions : tap.positions;
  const soupIdx = tap.sectioned ? tap.baseIndex : tap.index;
  const picked = copyBody(hit, seq);
  if (!picked.soup) {
    const soup = bodySoup(picked, soupPos, soupIdx);
    if (soup) picked.soup = soup;
  }
  list.push(picked);
  return { state: { ...withSlot(s, partId, { bodies: list, drop: slot.drop }), seq } };
}

export function popLastBooleanPick(state, partId) {
  const s = state || emptyBooleanState();
  if (s.pick === 'pieces') {
    const slot = booleanSlot(s, partId);
    const drop = slot.drop.slice();
    drop.pop();
    return withSlot(s, partId, { bodies: slot.bodies, drop });
  }
  // Undo drops the latest body pick, whichever part it is on.
  const picks = booleanPicksInOrder(s);
  const last = picks[picks.length - 1];
  const owner = last ? last.partId : booleanPartKey(partId);
  const slot = booleanSlot(s, owner);
  const bodies = slot.bodies.slice();
  const at = last ? bodies.indexOf(last.body) : bodies.length - 1;
  if (at >= 0) bodies.splice(at, 1);
  return withSlot(s, owner, { bodies, drop: [] });
}

export function clearBooleanPicks(state, partId) {
  const s = state || emptyBooleanState();
  const slot = booleanSlot(s, partId);
  if (s.pick === 'pieces') return withSlot(s, partId, { bodies: slot.bodies, drop: [] });
  // Clear drops the body picks on every part (they are one Boolean).
  let next = s;
  for (const key of Object.keys(s.byPart || {})) {
    next = withSlot(next, key, { bodies: [], drop: [] });
  }
  return withSlot(next, partId, { bodies: [], drop: [] });
}

export function booleanPieceHidden(state, partId, at) {
  const slot = booleanSlot(state, partId);
  const key = pieceKey(at);
  return slot.drop.some((d) => pieceKey(d.at) === key);
}

export function stripBooleanBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(BOOLEAN_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(BOOLEAN_END, i);
  if (j < 0) return text;
  const after = text.slice(j + BOOLEAN_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm uses every body pick, in tap order across parts. The first is the
 * target and its part is the one written (`targetPartId`). Tools in that part
 * are named by centroid. Tools in other parts are `external`, grouped by part
 * in first-tap order, and become frozen copies. Intersect drops are the
 * target part's slot.
 */
export function validateBooleanAccept(state, partId, mesh = null) {
  const s = state || emptyBooleanState();
  const op = booleanOp(s.op);
  const picks = booleanPicksInOrder(s);
  if (picks.length < 1) return { ok: false, message: BOOLEAN_MODE_NEED_BODIES };
  if (picks.length < 2) return { ok: false, message: BOOLEAN_MODE_NEED_TOOL };
  const targetPartId = picks[0].partId;
  const bodies = picks.filter((p) => p.partId === targetPartId).map((p) => p.body);
  const external = [];
  for (const p of picks) {
    if (p.partId === targetPartId) continue;
    let group = external.find((g) => g.partId === p.partId);
    if (!group) {
      group = { partId: p.partId, bodies: [] };
      external.push(group);
    }
    group.bodies.push(p.body);
  }
  const slot = booleanSlot(s, targetPartId);
  const pieceCount = Number(mesh?.pieceCount);
  if (op === 'intersect' && pieceCount > 0 && slot.drop.length >= pieceCount) {
    return { ok: false, message: BOOLEAN_MODE_ALL_DROPPED };
  }
  return {
    ok: true,
    op,
    targetPartId: targetPartId === '__active__' ? (partId ?? null) : targetPartId,
    bodies,
    external,
    crossPart: external.length > 0,
    drop: op === 'intersect' ? slot.drop : [],
  };
}

function contextPart(ctx, id) {
  const parts = ctx?.parts || {};
  return parts[id] || parts[String(id)] || null;
}

/**
 * External tools for the worker preview and for the script, posed into the
 * target frame. `ctx.parts[id]` is `{ script, name, position, ok }`.
 */
export function booleanExternalTools(gate, ctx = {}) {
  if (!gate?.ok) return { ok: false, message: gate?.message || BOOLEAN_MODE_NEED_TOOL };
  const target = contextPart(ctx, gate.targetPartId);
  const tools = [];
  for (const group of gate.external || []) {
    const src = contextPart(ctx, group.partId);
    if (!src || typeof src.script !== 'string') {
      return { ok: false, message: 'Boolean: that tool part has no script to copy.' };
    }
    if (src.ok === false) {
      return { ok: false, message: EXTERNAL_COPY_FAILED_SOURCE(src.name) };
    }
    const rotated = externalBodyRotationBlock(src, target ? [target] : []);
    if (!rotated.ok) return rotated;
    tools.push({
      partId: group.partId,
      name: src.name || group.partId,
      script: src.script,
      bodies: group.bodies.map((b) => ({ at: b.at.map(Number) })),
      offset: partOffset(src.position, target?.position),
    });
  }
  return { ok: true, tools };
}

/** Worker payload for the intersect Pieces preview. */
export function booleanPreviewRequest(state, partId, ctx = {}) {
  const gate = validateBooleanAccept(state, partId);
  if (!gate.ok) return gate;
  const bodies = gate.bodies.map((b) => ({ at: b.at.map(Number) }));
  if (!gate.crossPart) return { ok: true, op: gate.op, bodies, targetPartId: gate.targetPartId };
  const ext = booleanExternalTools(gate, ctx);
  if (!ext.ok) return ext;
  const target = contextPart(ctx, gate.targetPartId);
  return {
    ok: true,
    op: gate.op,
    bodies,
    targetPartId: gate.targetPartId,
    targetScript: typeof target?.script === 'string' ? target.script : undefined,
    tools: ext.tools.map((t) => ({ script: t.script, bodies: t.bodies, offset: t.offset })),
  };
}

/**
 * Confirm → one booleanBodies() wrapped in Boolean markers.
 * Always replaces the last marked Boolean block. `buffer` is the target
 * part's script. A cross-part pick embeds each tool part's script.
 */
export function composeBooleanCommit(buffer, state, partId, mesh = null, ctx = {}) {
  const gate = validateBooleanAccept(state, partId, mesh);
  if (!gate.ok) return gate;
  const bodyName = state?.body || 'part';
  const specs = gate.bodies.map((b) => `{ at: ${formatVec(b.at)} }`).join(', ');
  const optParts = [`op: '${gate.op}'`, `bodies: [${specs}]`];
  if (gate.op === 'intersect' && gate.drop.length) {
    const drops = gate.drop.map((d) => `{ at: ${formatVec(d.at)} }`).join(', ');
    optParts.push(`drop: [${drops}]`);
  }
  let tools = [];
  if (gate.crossPart) {
    const ext = booleanExternalTools(gate, ctx);
    if (!ext.ok) return ext;
    tools = ext.tools;
    optParts.push('tools: [__TOOLS__]');
  }
  const skeleton = `${bodyName} = booleanBodies(${bodyName}, { ${optParts.join(', ')} });`;
  if ((skeleton.match(/booleanBodies\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeBooleanCommit: Boolean must emit exactly one booleanBodies().' };
  }
  const headers = tools.map((t) => externalCopyHeader({ sourceName: t.name, sourceId: t.partId }));
  const toolText = tools.map((t) => {
    const at = t.bodies.map((b) => `{ at: ${formatVec(b.at)} }`).join(', ');
    return `externalBody(${frozenScriptFunction(t.script)}, { bodies: [${at}], offset: ${formatVec(t.offset)} })`;
  }).join(',\n');
  const call = tools.length ? skeleton.replace('__TOOLS__', `\n${toolText}\n`) : skeleton;
  const block = [BOOLEAN_BEGIN, ...headers, call, BOOLEAN_END].join('\n');
  const composed = placeBlockBeforeReturn(stripBooleanBlock(String(buffer || '')), block);
  return {
    ok: true,
    buffer: composed,
    run: true,
    targetPartId: gate.targetPartId,
    external: tools.length,
  };
}
