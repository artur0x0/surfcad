/**
 * Slice 27 — Fillet-in-mode: enter without edges, pick in-mode, live blend
 * preview, Accept commits makeSweepPath + filletAlongPath.
 *
 * Locked UX: tapping Fillet never soft-fails for empty selection. Edge-pick
 * chip (Tangent / Clear / Undo / Accept / X) owns the session. Accept writes
 * a marked block, Auto-Runs, and exits. Disconnected picks split into
 * contiguous components and each gets its own makeSweepPath + filletAlongPath
 * inside the same FILLET_MODE markers (connected chains keep single-path
 * behavior). A later Fillet on a different sharp edge appends another block
 * (commitMode 'append') so edge() runs on the already-filleted solid. Replace
 * stays the default for an in-place update of the same block. Undo pops the
 * last edge only. X exits with no commit. Strategy default stays sweep (#30).
 * Editing an existing block uses this same composer (`replaceEditedBlend`):
 * the new block is spliced over the old one. There is no second validator
 * and no edge-list rebuild.
 *
 * Chamfer mode mirrors Fillet: enter without edges, pick disjoint components,
 * Accept emits makeSweepPath + filletAlongPath(..., { profile: 'chamfer' })
 * (not per-edge chamferEdges hulls — those rib around rounded corners).
 *
 * Reuses Slice 22/23: makeSweepPath / filletAlongPath / canBuildFilletAlongPath.
 * Does not change Extrude / Revolve / Profile / Loft.
 */

import {
  composeHelperInsert,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  CHAMFER_MODE_BEGIN,
  CHAMFER_MODE_END,
} from './helperPaletteSnippets.js';
import { liveSheetFeature } from './featureSheetWriteback.js';
import { scriptWithFeatureCount } from './partHistory.js';
import {
  canBuildFilletAlongPath,
  filletWedgeContour,
  dihedralFilletContour,
  dihedralChamferContour,
  orientFilletFrame,
  resolveFilletStrategy,
  FILLET_SWEEP_DISCONNECTED,
  FILLET_SWEEP_BRANCH,
  FILLET_ARC_SEGMENTS,
} from './filletAlongPath.js';
import {
  assembleSweepPath,
  buildSweepPathPreview,
  splitEdgePathComponents,
} from './edgeSweepPath.js';
import {
  edgeKey,
  pathLengthFromEdges,
  FILLET_DEFAULT_RADIUS,
  sweepBlendHardMax,
} from './selectEdge.js';
import { adjacentBlendSize } from './adjacentBlend.js';
import { classifyFilletEdges } from './filletEdgeClass.js';
import { shouldUseHardVariableSweep } from './filletKernelSpike.js';

export const FILLET_ENTRY_IDS = new Set(['filletEdges']);

export const FILLET_MODE_EMPTY =
  'Pick edges in Fillet mode, then Accept. Tangent-on chains work for circular rims.';

export const FILLET_MODE_NO_COMMIT =
  'Dismiss exits Fillet mode with no commit.';

export const FILLET_BLEND_ONLY =
  'Those edges are an existing blend. Pick a sharp edge — re-filleting a blend is not supported.';

export function isFilletEntry(id) {
  return FILLET_ENTRY_IDS.has(id);
}

export function isChamferEntry(id) {
  return id === 'chamferEdges';
}

export function enterChamferState(edges = null, { neighbors = null } = {}) {
  const list = Array.isArray(edges) && edges.length ? edges : null;
  const seeded = adjacentBlendSize(list, neighbors).defaultMm;
  const chamfer = Number.isFinite(seeded) && seeded > 0 ? seeded : 2;
  return {
    entry: 'chamferEdges',
    params: { body: 'part', chamfer, edgeScope: 'selected' },
    sizeTouched: false,
    lastEdges: list ? list.slice() : [],
    enterRefuse: null,
  };
}

export const CHAMFER_MODE_EMPTY =
  'Pick edges in Chamfer mode, then Accept. Tangent-on chains work for circular rims.';

export function validateChamferAccept(edges, params = {}) {
  const list = Array.isArray(edges) ? edges : [];
  if (!list.length) {
    return { ok: false, message: CHAMFER_MODE_EMPTY };
  }
  const split = splitEdgePathComponents(list);
  if (!split.ok) {
    if (split.code === 'branch') return { ok: false, message: FILLET_SWEEP_BRANCH };
    return { ok: false, message: split.message || CHAMFER_MODE_EMPTY };
  }
  const components = split.components;
  for (const comp of components) {
    const gate = canBuildFilletAlongPath(comp);
    if (!gate.ok) {
      const msg = gate.message || CHAMFER_MODE_EMPTY;
      if (/branch/i.test(msg)) return { ok: false, message: FILLET_SWEEP_BRANCH };
      if (/disconnect/i.test(msg)) {
        return { ok: false, message: msg.includes('disconnected') ? msg : FILLET_SWEEP_DISCONNECTED };
      }
      return { ok: false, message: msg };
    }
  }
  const raw = Number(params.chamfer);
  let chamfer = Number.isFinite(raw) && raw > 0 ? raw : 2;
  // Clamp shared size to the tightest per-component sweep hard-max (same as fillet).
  if (components.length >= 1) {
    let hard = Infinity;
    for (const comp of components) {
      hard = Math.min(hard, sweepBlendHardMax(pathLengthFromEdges(comp)));
    }
    if (Number.isFinite(hard) && hard > 0) {
      chamfer = Math.min(chamfer, hard);
    }
  }
  return {
    ok: true,
    normalized: {
      body: params.body || 'part',
      chamfer,
      edgeScope: 'selected',
      profile: 'chamfer',
      strategy: 'sweep',
    },
    components,
  };
}

export function hasChamferModeBlock(buffer) {
  const t = String(buffer || '');
  return t.includes(CHAMFER_MODE_BEGIN) && t.includes(CHAMFER_MODE_END);
}

export function chamferModeOwnedRegion(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(CHAMFER_MODE_BEGIN);
  if (i < 0) return '';
  const j = text.indexOf(CHAMFER_MODE_END, i);
  if (j < 0) return '';
  return text.slice(i, j + CHAMFER_MODE_END.length);
}

export function stripChamferModeBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(CHAMFER_MODE_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(CHAMFER_MODE_END, i);
  if (j < 0) return text;
  const after = text.slice(j + CHAMFER_MODE_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Accept → makeSweepPath + filletAlongPath(profile:chamfer) per contiguous
 * component, wrapped in chamfer-mode markers (mirrors Fillet Accept).
 * commitMode 'append' keeps a previous block so a second chain cuts the
 * already-chamfered solid.
 */
export function composeChamferCommit(buffer, {
  edges = null,
  params = {},
  commitMode = 'replace',
} = {}) {
  const gate = validateChamferAccept(edges, params);
  if (!gate.ok) return gate;
  const text = String(buffer || '');
  const base = commitMode === 'append' ? text : stripChamferModeBlock(text);
  const composed = composeHelperInsert(
    base,
    'chamferEdges',
    null,
    { ...gate.normalized, _chamferMode: true },
    null,
    edges,
  );
  if (typeof composed !== 'string') {
    return { ok: false, message: gate.message || CHAMFER_MODE_EMPTY };
  }
  const owned = chamferModeOwnedRegion(composed);
  const expectedComps = Array.isArray(gate.components) ? gate.components.length : 1;
  const pathCount = (owned.match(/makeSweepPath\s*\(/g) || []).length;
  const alongCount = (owned.match(/filletAlongPath\s*\(/g) || []).length;
  if (pathCount < 1 || alongCount < 1) {
    return {
      ok: false,
      message: 'composeChamferCommit: makeSweepPath/filletAlongPath missing — refusing silent no-op.',
    };
  }
  if (pathCount !== expectedComps || alongCount !== expectedComps) {
    return {
      ok: false,
      message: `composeChamferCommit: expected ${expectedComps} makeSweepPath/filletAlongPath pair(s), got ${pathCount}/${alongCount}.`,
    };
  }
  if (!/profile:\s*'chamfer'/.test(owned)) {
    return {
      ok: false,
      message: 'composeChamferCommit: profile:chamfer missing — refusing silent no-op.',
    };
  }
  if (!owned.includes(CHAMFER_MODE_BEGIN) || !owned.includes(CHAMFER_MODE_END)) {
    return { ok: false, message: 'composeChamferCommit: chamfer markers missing — refusing unscoped insert.' };
  }
  return { ok: true, buffer: composed, run: true, kernel: 'sweep-chamfer' };
}

/**
 * Untouched Fillet radius when nothing is picked (FILLET_DEFAULT_RADIUS).
 * A pick uses the adjacent edge instead (`defaultFilletRadius`).
 */
export { FILLET_DEFAULT_RADIUS };
/** No longer sizes the default. Kept so older readers still resolve. */
export const FILLET_THIN_FRACTION = 0.45;
/** Smallest chip default, unless the slider max is smaller. */
export const FILLET_DEFAULT_MIN_RADIUS = 0.1;

/**
 * Smallest bounding-box extent of a solid (mm), or null.
 * Accepts a three.js BufferGeometry (boundingBox or position attribute)
 * or a plain `{ min: [x,y,z], max: [x,y,z] }` box.
 */
export function solidMinExtent(geometryOrBox) {
  const g = geometryOrBox;
  if (!g) return null;
  let min = null;
  let max = null;
  if (Array.isArray(g.min) && Array.isArray(g.max)) {
    min = g.min;
    max = g.max;
  } else {
    if (!g.boundingBox && typeof g.computeBoundingBox === 'function' && g.attributes?.position?.count) {
      g.computeBoundingBox();
    }
    const b = g.boundingBox;
    if (!b || (typeof b.isEmpty === 'function' && b.isEmpty())) return null;
    min = [b.min.x, b.min.y, b.min.z];
    max = [b.max.x, b.max.y, b.max.z];
  }
  const e = [0, 1, 2].map((i) => Number(max[i]) - Number(min[i]));
  if (!e.every((v) => Number.isFinite(v) && v >= 0)) return null;
  const m = Math.min(...e);
  return m > 0 ? m : null;
}

/**
 * Default Fillet radius from the adjacent edge closest to perpendicular.
 * `minExtent` is ignored. No picks → 2 mm.
 * @param {{ picked?: object[]|null, neighbors?: object[]|null, minExtent?: number|null }} [opts]
 */
export function defaultFilletRadius({ picked = null, neighbors = null } = {}) {
  return adjacentBlendSize(picked, neighbors).defaultMm;
}

/**
 * Fillet mode defaults. The radius is the adjacent-edge seed, not the
 * path length and not the part's thinnest extent.
 */
export function defaultFilletParams(edges, { neighbors = null } = {}) {
  const radius = defaultFilletRadius({ picked: edges, neighbors });
  return {
    body: 'part',
    strategy: 'sweep',
    radius,
    sphericalCorners: true,
    profile: 'fillet',
    reverse: false,
    edgeScope: 'selected',
  };
}

/**
 * Seed in-mode state. Empty edges are OK — never refuse on enter.
 */
export function enterFilletState(edges = null, { neighbors = null } = {}) {
  return {
    entry: 'filletEdges',
    params: defaultFilletParams(edges, { neighbors }),
    radiusTouched: false,
    lastEdges: Array.isArray(edges) && edges.length ? edges.slice() : [],
    enterRefuse: null,
  };
}

export function normalizeFilletParams(raw = {}, edges = null) {
  const seeded = defaultFilletParams(edges);
  const radius = Number(raw.radius);
  const strategy = resolveFilletStrategy(raw.strategy);
  let r = Number.isFinite(radius) && radius > 0 ? radius : seeded.radius;
  // Sweep regime mirrors the live preview (buildFilletBlendPreview) exactly:
  // clamp the committed radius to the path-length hard max so Accept writes the
  // same radius the blend preview painted — no preview≠commit divergence, and
  // the worker's loud "removed X vs expected" net never fires from the chip.
  // Planar keeps its own 0.45·L guard (different regime) — clamp only sweep.
  if (strategy === 'sweep') {
    r = Math.min(r, sweepBlendHardMax(pathLengthFromEdges(edges)));
  }
  return {
    body: raw.body || seeded.body,
    strategy,
    radius: r,
    sphericalCorners: raw.sphericalCorners !== false,
    profile: raw.profile === 'chamfer' ? 'chamfer' : 'fillet',
    reverse: !!raw.reverse,
    edgeScope: 'selected',
  };
}

export function validateFilletAccept(edges, params = {}) {
  const list = Array.isArray(edges) ? edges : [];
  if (!list.length) {
    return { ok: false, message: FILLET_MODE_EMPTY };
  }
  if (list.every((edge) => edge && edge.blendStrip === true)) {
    return { ok: false, message: FILLET_BLEND_ONLY };
  }
  let components = [list];
  if (resolveFilletStrategy(params.strategy) === 'sweep') {
    const split = splitEdgePathComponents(list);
    if (!split.ok) {
      if (split.code === 'branch') return { ok: false, message: FILLET_SWEEP_BRANCH };
      return { ok: false, message: split.message || FILLET_MODE_EMPTY };
    }
    components = split.components;
    for (const comp of components) {
      const gate = canBuildFilletAlongPath(comp);
      if (!gate.ok) {
        const msg = gate.message || FILLET_MODE_EMPTY;
        if (/branch/i.test(msg)) return { ok: false, message: FILLET_SWEEP_BRANCH };
        if (/disconnect/i.test(msg)) {
          return { ok: false, message: msg.includes('disconnected') ? msg : FILLET_SWEEP_DISCONNECTED };
        }
        return { ok: false, message: msg };
      }
    }
  }
  // Clamp shared radius to the tightest per-component sweep hard-max so one
  // Accept radius is safe for every independent filletAlongPath.
  const n = normalizeFilletParams(params, list);
  if (n.strategy === 'sweep' && components.length > 1) {
    let hard = Infinity;
    for (const comp of components) {
      hard = Math.min(hard, sweepBlendHardMax(pathLengthFromEdges(comp)));
    }
    if (Number.isFinite(hard) && hard > 0) {
      n.radius = Math.min(n.radius, hard);
    }
  }
  return { ok: true, normalized: n, components };
}

function _sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function _add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function _mul(s, a) {
  return [s * a[0], s * a[1], s * a[2]];
}
function _dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function _cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function _len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
function _n(v) {
  const L = _len(v) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

/** Squared distance from p to segment [a,b]. */
function _distSqToSeg(p, a, b) {
  const ab = _sub(b, a);
  const L2 = _dot(ab, ab);
  let t = L2 > 1e-18 ? _dot(_sub(p, a), ab) / L2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const d = _sub(p, _add(a, _mul(t, ab)));
  return _dot(d, d);
}

/**
 * The ordered edge whose segment lies closest to this path point.
 * Falls back to positional indexing when an edge lacks va/vb.
 */
function _edgeNearestPoint(p, ordered, i) {
  if (!ordered?.length) return null;
  const fallback = ordered[Math.min(i, ordered.length - 1)];
  if (!p) return fallback;
  let best = null;
  let bestD = Infinity;
  for (const e of ordered) {
    if (!e?.va || !e?.vb) continue;
    const d = _distSqToSeg(p, e.va, e.vb);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best || fallback;
}

function inFaceFromNormal(n, T, nOther) {
  if (!n || !T) return null;
  const f = _cross(n, T);
  if (_len(f) < 1e-8) return null;
  let out = _n(f);
  if (nOther && _dot(out, _mul(-1, nOther)) < 0) out = _mul(-1, out);
  return out;
}

function projectPerp(v, T) {
  if (!v) return null;
  const out = _sub(v, _mul(_dot(v, T), T));
  return _len(out) > 1e-8 ? _n(out) : null;
}

function frameFromNormals(T, n0, n1) {
  let N = projectPerp(n0, T);
  let B = projectPerp(n1, T);
  if (!N && B) N = _n(_cross(B, T));
  if (!B && N) B = _n(_cross(T, N));
  if (!N) {
    const up = Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    N = _n(_cross(T, up));
  }
  if (!B) B = _n(_cross(T, N));
  if (_dot(B, _cross(T, N)) < 0) B = _mul(-1, B);
  return { N, B };
}

function lookupNormals(edges) {
  const map = new Map();
  for (const e of edges || []) {
    const k = edgeKey(e);
    if (!k) continue;
    map.set(k, { n0: e.n0, n1: e.n1 });
  }
  return map;
}

/**
 * Visible polylines for branched / invalid selections (or as a fallback).
 * Disjoint-but-simple components now preview and Accept independently —
 * this helper stays for the branch / invalid path painter.
 */
export function disconnectedPathPolylines(edges) {
  const list = Array.isArray(edges) ? edges : [];
  const out = [];
  for (const e of list) {
    const va = e?.va;
    const vb = e?.vb;
    if (!Array.isArray(va) || !Array.isArray(vb) || va.length < 3 || vb.length < 3) continue;
    out.push([
      [Number(va[0]), Number(va[1]), Number(va[2])],
      [Number(vb[0]), Number(vb[1]), Number(vb[2])],
    ]);
  }
  return out;
}

function ringsFromFrames(frames) {
  if (!frames?.length) return null;
  const rings = [];
  for (const fr of frames) {
    const wedge = fr.wedge;
    if (!wedge?.length) return null;
    rings.push(wedge.map(([u, v]) => (
      _add(fr.origin, _add(_mul(u, fr.N), _mul(v, fr.B)))
    )));
  }
  return rings;
}

/**
 * Live blend preview (sweep / filletAlongPath intent).
 * Valid chain → path + swept wedge rings.
 * Disjoint simple components → ok:true with per-component rings (independent fillets).
 * Branched / empty → ok:false; polylines stay visible when possible.
 */
function buildSingleFilletBlendPreview(list, params = {}) {
  const n = normalizeFilletParams(params, list);
  const sweepMax = sweepBlendHardMax(pathLengthFromEdges(list));
  const radius = Math.min(n.radius, sweepMax);
  const base = {
    strategy: n.strategy,
    profile: n.profile,
    reverse: n.reverse,
    radius,
    sweepMax,
    edgeCount: list.length,
  };

  if (!list.length) {
    return {
      ...base,
      ok: false,
      message: FILLET_MODE_EMPTY,
      path: null,
      preview: null,
      rings: null,
      polylines: [],
    };
  }

  const assembled = assembleSweepPath(list, { reverse: n.reverse });
  if (!assembled.ok) {
    return {
      ...base,
      ok: false,
      message: assembled.message,
      code: assembled.code,
      path: null,
      preview: null,
      rings: null,
      polylines: disconnectedPathPolylines(list),
    };
  }

  const preview = buildSweepPathPreview(list, { reverse: n.reverse });
  let wedge = null;
  try {
    wedge = n.profile === 'chamfer'
      ? dihedralChamferContour(radius, Math.PI / 2)
      : filletWedgeContour(radius, FILLET_ARC_SEGMENTS);
  } catch {
    wedge = null;
  }

  const normals = lookupNormals(list);
  const pts = assembled.value.points;
  /**
   * Which selected edge owns this path point.
   *
   * The path is densified/thinned independently of the edge list, so point i
   * and edge i are NOT the same thing: Artur's 20-edge top-loop wrap assembles
   * to 25 points. Indexing `ordered[i]` (clamped to the last edge) therefore
   * gave the final 5 rings — 20% of the loop — the LAST edge's wall normals.
   * On a closed wrap the walls rotate around the perimeter, so those rings got
   * oriented into the wrong plane and the preview visibly disagreed with the
   * committed blend. Match by geometry instead: nearest segment wins.
   */
  const ordered = assembled.orderedEdges || [];
  const closed = !!assembled.value.closed;
  const frames = [];
  let prevN = null;
  for (let i = 0; i < pts.length; i++) {
    const e = _edgeNearestPoint(pts[i], ordered, i);
    const nr = e ? normals.get(e.key) : null;
    let T;
    if (i < pts.length - 1) T = _n(_sub(pts[i + 1], pts[i]));
    else if (closed) T = _n(_sub(pts[0], pts[i]));
    else T = _n(_sub(pts[i], pts[i - 1]));
    const f0 = inFaceFromNormal(nr?.n0, T, nr?.n1);
    const f1 = inFaceFromNormal(nr?.n1, T, nr?.n0);
    let N;
    let B;
    let theta = Math.PI / 2;
    let frameWedge = wedge;
    if (f0 && f1) {
      const fr = orientFilletFrame(T, f0, f1, prevN);
      N = fr.N;
      B = fr.B;
      theta = fr.theta;
      prevN = N;
      try {
        frameWedge = n.profile === 'chamfer'
          ? dihedralChamferContour(radius, theta)
          : dihedralFilletContour(radius, theta, FILLET_ARC_SEGMENTS);
      } catch {
        frameWedge = wedge;
      }
    } else {
      const fb = frameFromNormals(T, nr?.n0, nr?.n1);
      N = fb.N;
      B = fb.B;
    }
    frames.push({ origin: pts[i], T, N, B, theta, wedge: frameWedge });
  }

  return {
    ...base,
    ok: true,
    path: assembled.value,
    preview,
    wedge: frames[0]?.wedge || wedge,
    frames,
    rings: ringsFromFrames(frames),
    polylines: preview?.points ? [preview.points] : [],
    closed,
    length: assembled.value.length,
  };
}

export function buildFilletBlendPreview(edges, params = {}) {
  const list = Array.isArray(edges) ? edges : [];
  const n = normalizeFilletParams(params, list);
  const sweepMax = sweepBlendHardMax(pathLengthFromEdges(list));
  const radius = Math.min(n.radius, sweepMax);
  const base = {
    strategy: n.strategy,
    profile: n.profile,
    reverse: n.reverse,
    radius,
    sweepMax,
    edgeCount: list.length,
  };

  if (!list.length) {
    return {
      ...base,
      ok: false,
      message: FILLET_MODE_EMPTY,
      path: null,
      preview: null,
      rings: null,
      polylines: [],
      componentCount: 0,
    };
  }

  if (n.strategy === 'sweep') {
    const split = splitEdgePathComponents(list);
    if (!split.ok) {
      return {
        ...base,
        ok: false,
        message: split.message,
        code: split.code,
        path: null,
        preview: null,
        rings: null,
        polylines: disconnectedPathPolylines(list),
        componentCount: 0,
      };
    }
    if (split.components.length > 1) {
      let hard = Infinity;
      for (const comp of split.components) {
        hard = Math.min(hard, sweepBlendHardMax(pathLengthFromEdges(comp)));
      }
      const sharedR = Math.min(radius, Number.isFinite(hard) ? hard : radius);
      const parts = split.components.map((comp) => buildSingleFilletBlendPreview(comp, {
        ...params,
        strategy: 'sweep',
        radius: sharedR,
      }));
      const allOk = parts.every((p) => p.ok);
      const polylines = [];
      for (const p of parts) {
        if (p.preview?.points?.length) polylines.push(p.preview.points);
        else if (p.polylines?.length) polylines.push(...p.polylines);
      }
      return {
        ...base,
        radius: sharedR,
        sweepMax: Number.isFinite(hard) ? hard : sweepMax,
        ok: allOk,
        message: allOk ? undefined : (parts.find((p) => !p.ok)?.message || FILLET_MODE_EMPTY),
        path: null,
        preview: null,
        rings: null,
        components: parts,
        componentCount: parts.length,
        polylines,
        closed: false,
        length: parts.reduce((s, p) => s + (Number(p.length) || 0), 0),
      };
    }
    const one = buildSingleFilletBlendPreview(split.components[0], params);
    return { ...one, componentCount: 1, components: [one] };
  }

  const one = buildSingleFilletBlendPreview(list, params);
  return { ...one, componentCount: 1, components: [one] };
}

export function hasFilletModeBlock(buffer) {
  const t = String(buffer || '');
  return t.includes(FILLET_MODE_BEGIN) && t.includes(FILLET_MODE_END);
}

export function filletModeOwnedRegion(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(FILLET_MODE_BEGIN);
  if (i < 0) return '';
  const j = text.indexOf(FILLET_MODE_END, i);
  if (j < 0) return '';
  return text.slice(i, j + FILLET_MODE_END.length);
}

export function stripFilletModeBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(FILLET_MODE_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(FILLET_MODE_END, i);
  if (j < 0) return text;
  const after = text.slice(j + FILLET_MODE_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

function markersUnbalanced(text, begin, end) {
  const i = text.lastIndexOf(begin);
  const j = text.indexOf(end, i < 0 ? 0 : i);
  if (text.includes(begin) && i < 0) return true;
  if (i >= 0 && j < 0) return true;
  if (i < 0 && text.includes(end)) return true;
  return false;
}

export function countFilletAlongPath(buffer) {
  const m = String(buffer || '').match(/filletAlongPath\s*\(/g);
  return m ? m.length : 0;
}

export function countMakeSweepPath(buffer) {
  const m = String(buffer || '').match(/makeSweepPath\s*\(/g);
  return m ? m.length : 0;
}

/**
 * Accept → insert, replace, or append in-mode Fillet.
 * Easy / default: makeSweepPath + filletAlongPath (one pair per contiguous
 * component when the pick is disconnected).
 * Hard (C3, production flag on): makeSweepPath + filletAlongPath({ variableProfile }).
 * commitMode 'replace' (default) updates the last marked block.
 * commitMode 'append' keeps that block and adds another, so a second sharp
 * edge is filleted on the solid the first block already produced.
 *
 * @param {string} buffer
 * @param {{ edges?: object[]|null, params?: object, commitMode?: string, filletClass?: string|null, geometry?: object|null }} [opts]
 * @returns {{ ok: true, buffer: string, run: true, kernel?: string } | { ok: false, message: string }}
 */
export function composeFilletCommit(buffer, {
  edges = null,
  params = {},
  commitMode = 'replace',
  filletClass = null,
  geometry = null,
} = {}) {
  const gate = validateFilletAccept(edges, params);
  if (!gate.ok) return gate;

  const text = String(buffer || '');
  if (markersUnbalanced(text, FILLET_MODE_BEGIN, FILLET_MODE_END)) {
    return {
      ok: false,
      message: 'composeFilletCommit: unbalanced fillet markers — refusing silent no-op.',
    };
  }

  // Prefer an explicit class from the viewport (#50 chip). Without geometry,
  // untagged edges look "hard" to classifyFilletEdges — do not flip goldens /
  // one-shot Accept onto the hard variable-profile path unless callers ask.
  let klass = filletClass || params.filletClass || null;
  const geom = geometry || params.geometry || null;
  if (!klass && geom) {
    klass = classifyFilletEdges(edges, {
      radius: gate.normalized.radius,
      geometry: geom,
    }).klass;
  }
  if (!klass) klass = 'easy';
  const hardVariable = shouldUseHardVariableSweep(klass);
  const emitParams = {
    ...gate.normalized,
    _filletMode: true,
    ...(hardVariable ? { _hardVariableProfile: true } : {}),
  };

  const base = commitMode === 'append' ? text : stripFilletModeBlock(text);
  const composed = composeHelperInsert(
    base,
    'filletEdges',
    null,
    emitParams,
    null,
    edges,
  );
  if (typeof composed !== 'string') {
    return {
      ok: false,
      message: gate.message || FILLET_MODE_EMPTY,
    };
  }
  const owned = filletModeOwnedRegion(composed);
  const expectedComps = Array.isArray(gate.components) ? gate.components.length : 1;
  if (hardVariable || gate.normalized.strategy === 'sweep') {
    const pathCount = countMakeSweepPath(owned);
    const filletCount = countFilletAlongPath(owned);
    if (pathCount < 1) {
      return {
        ok: false,
        message: 'composeFilletCommit: makeSweepPath missing — refusing silent no-op.',
      };
    }
    if (filletCount < 1) {
      return {
        ok: false,
        message: 'composeFilletCommit: filletAlongPath missing — refusing silent no-op.',
      };
    }
    if (pathCount !== expectedComps || filletCount !== expectedComps) {
      return {
        ok: false,
        message: `composeFilletCommit: expected ${expectedComps} makeSweepPath/filletAlongPath pair(s), got ${pathCount}/${filletCount}.`,
      };
    }
    if (hardVariable && !/variableProfile:\s*true/.test(owned)) {
      return {
        ok: false,
        message: 'composeFilletCommit: hard variable-profile flag missing — refusing silent no-op.',
      };
    }
    if (hardVariable && /relaxPlanar:\s*true/.test(owned)) {
      return {
        ok: false,
        message: 'composeFilletCommit: hard C3 must not use relaxPlanar rolling-ball.',
      };
    }
  } else if (!/filletEdges\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeFilletCommit: filletEdges missing — refusing silent no-op.',
    };
  }
  if (!hasFilletModeBlock(composed)) {
    return {
      ok: false,
      message: 'composeFilletCommit: fillet-mode markers missing — refusing unscoped insert.',
    };
  }
  return {
    ok: true,
    buffer: composed,
    run: true,
    kernel: hardVariable ? 'variable-profile-sweep' : 'sweep-dihedral',
  };
}

/**
 * Edit a fillet or chamfer by running the same composer Accept uses.
 *
 * The base is the script before this feature (later features stay out of
 * name allocation, the same way the block was first written). commitMode
 * follows the create rule on that prefix: append when an earlier block of
 * this kind is still there, otherwise replace. The new block is spliced
 * over the old one, so disconnected corners stay separate blends and
 * everything after the feature stays put. One buffer, no second validator.
 *
 * @param {string} script
 * @param {{ id?: string, kind?: string, index?: number }} feature
 * @param {{ chamfer?: boolean, edges?: object[]|null, params?: object, filletClass?: string|null, geometry?: object|null }} [opts]
 */
export function replaceEditedBlend(script, feature, {
  chamfer = false,
  edges = null,
  params = {},
  filletClass = null,
  geometry = null,
} = {}) {
  const text = String(script || '');
  const live = liveSheetFeature(text, feature);
  if (!live) {
    return {
      ok: false,
      message: 'That feature is not in this part\'s script any more — pick it again.',
    };
  }
  const prefix = scriptWithFeatureCount(text, live.index);
  const commitMode = (chamfer ? hasChamferModeBlock(prefix) : hasFilletModeBlock(prefix))
    ? 'append'
    : 'replace';
  const created = chamfer
    ? composeChamferCommit(prefix, { edges, params, commitMode })
    : composeFilletCommit(prefix, {
      edges,
      params,
      commitMode,
      filletClass,
      geometry,
    });
  if (!created.ok) return created;
  const block = chamfer ? chamferModeOwnedRegion(created.buffer) : filletModeOwnedRegion(created.buffer);
  if (!block) {
    return {
      ok: false,
      message: chamfer
        ? 'composeChamferCommit: chamfer-mode markers missing — refusing unscoped insert.'
        : 'composeFilletCommit: fillet-mode markers missing — refusing unscoped insert.',
    };
  }
  const buffer = text.slice(0, live.startOffset) + block + text.slice(live.endOffset);
  if (buffer === text) return { ok: true, buffer: text, changed: false, run: false };
  return { ok: true, buffer, changed: true, run: true, kernel: created.kernel };
}
