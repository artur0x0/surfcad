/**
 * Slice 24/25/26/28 — Contour-mode shell + Extrude / Revolve / Loft solid commit.
 * Workplane entry: plane-only mode (Face / construction plane + offset + rotate).
 *
 * Shared mode Extrude / Revolve / Loft own. Fillet-without-edges is Slice 27
 * (its own edge-pick mode — not a contour entry).
 * Slice 24: enter mode, ghost the part, swap the left rail, pick a workplane,
 * draw circle/rect/polygon/(cheap polyline), live makeCrossSection preview.
 * Slice 25: Extrude entry Confirm names a contour and commits makeExtrude
 * by that name. Distance and the sense shift stay in the block. The block
 * id is on the marker, so several extrudes can coexist.
 * Slice 26: Revolve entry Confirm names a contour and commits makeRevolve
 * of that contour. The remap, segments, angle, and rotate stay in the block.
 * Slice 28: Loft entry Confirm names each contour and commits makeLoft by
 * those names. A station stores only an optional offset along the contour
 * normal. The block id is on the marker, so several lofts can coexist.
 * Slice 30: Sweep entry Confirm names a profile contour and a path contour,
 * then commits sweepPoints of those names. Reverse is baked into the path.
 *
 * Reuses Slice 21: workplaneFromFace / makeCrossSection / profile* substrate.
 * Reuses Slice 22: makeSweepPath / assembleSweepPath.
 * Reuses C8 makeExtrude / makeRevolve / makeLoft + sweepPoints + placeInFrame
 * (frame-only, replace part).
 */

import {
  classifySelectedFace,
} from './faceFeaturePlacement.js';
import {
  assembleCrossSection,
  buildCrossSectionPreview,
  buildProfileFromParams,
  CROSS_SECTION_REFUSE_NON_PLANAR,
  defaultTopPlaneFrame,
  planeFrameFromFaceData,
} from './crossSectionSubstrate.js';
import {
  allocateUniqueName,
  composeHelperInsert,
  declaredNames,
  emitPartPlace,
  emitProfileExprFromParams,
  solidCombineOp,
  solidMergeOn,
  CONTOUR_PROFILE_BEGIN,
  CONTOUR_PROFILE_END,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CONTOUR_REVOLVE_BEGIN,
  CONTOUR_REVOLVE_END,
  CONTOUR_LOFT_BEGIN,
  CONTOUR_LOFT_END,
  CONTOUR_SWEEP_BEGIN,
  CONTOUR_SWEEP_END,
  isBufferEmpty,
  scriptHasPriorSolid,
} from './helperPaletteSnippets.js';
import {
  assembleLoftStations,
  buildLoftPreviewStations,
  offsetPlaneFrame,
} from './makeLoft.js';
import { assembleSweepPath } from './edgeSweepPath.js';
import {
  contourStatements,
  findReturnPartIndex,
  insertBeforeScriptReturn,
  upsertNamedContour,
} from './namedContour.js';
import {
  featureMarkersBalanced,
  findFeatureBlocks,
  mintBlockId,
} from './featureBlockId.js';
import {
  emitLoftReferenceLines,
  parseLoftReferences,
} from './loftReference.js';
import {
  emitExtrudeReferenceLines,
  emitPathProfileExpr,
  emitRevolveReferenceLines,
  emitSweepReferenceLines,
  parseExtrudeReference,
  parseRevolveReference,
  parseSweepReferences,
  projectPathUv,
  sweepPathFrame,
} from './solidReference.js';
import {
  commitArc,
  commitConstraint,
  commitDimension,
  deleteContourConstraint,
  deleteContourDimension,
  deleteContourRef,
  liveDimension,
  promoteContourState,
  revertLiveDimension,
  selectContourGesture,
  toggleContourPick,
} from './contourGesture.js';

/** Palette ids that enter contour mode instead of one-shot insert. */
export const CONTOUR_ENTRY_IDS = new Set([
  'makeExtrude',
  'makeRevolve',
  'makeLoft',
  'makeSweep',
  'crossSection',
  'workplane',
]);

export const CONTOUR_TOOLS = [
  { id: 'circle', label: 'Circle', title: 'Circle profile on the workplane' },
  { id: 'rectangle', label: 'Rect', title: 'Rectangle profile on the workplane' },
  { id: 'polygon', label: 'Polygon', title: 'Regular polygon profile on the workplane' },
  { id: 'polyline', label: 'Polyline', title: 'Tap points on the workplane; right-drag a point to move it, or drag it with one finger (closed on Confirm)' },
];

export const CONTOUR_TOOL_IDS = CONTOUR_TOOLS.map((t) => t.id);

export const CONTOUR_NO_SOLID =
  'This Confirm writes Profile only (makeCrossSection). Extrude solids use the Extrude entry; Revolve solids use the Revolve entry; Loft solids use the Loft entry; Sweep solids use the Sweep entry.';

export const SWEEP_EMPTY_PATH =
  'Sweep: pick a path first — select a contiguous edge chain (Edge pick, Tangent on), then Confirm.';

export const LOFT_MIN_PROFILES = 2;
export const LOFT_MAX_PROFILES = 8;

export const EXTRUDE_SENSES = ['positive', 'negative', 'both'];
export const EXTRUDE_DIRECTIONS = ['normal', 'x', 'y', 'z'];
export const REVOLVE_SENSES = ['positive', 'negative', 'both'];
export const REVOLVE_AXES = ['u', 'v', 'x', 'y', 'z'];
export const REVOLVE_SEGMENTS = 96;

export function isContourEntry(id) {
  return CONTOUR_ENTRY_IDS.has(id);
}

export function isExtrudeEntry(id) {
  return id === 'makeExtrude';
}

export function isRevolveEntry(id) {
  return id === 'makeRevolve';
}

export function isLoftEntry(id) {
  return id === 'makeLoft';
}

export function isSweepEntry(id) {
  return id === 'makeSweep';
}

export function isWorkplaneEntry(id) {
  return id === 'workplane';
}

/** Extrude / Revolve / Sweep / Loft — solid Confirm, not Profile-only. */
export function isSolidContourEntry(id) {
  return isExtrudeEntry(id) || isRevolveEntry(id) || isLoftEntry(id) || isSweepEntry(id);
}

export function isContourTool(id) {
  return CONTOUR_TOOL_IDS.includes(id);
}

export function defaultContourParams(tool) {
  if (tool === 'rectangle') {
    return { width: 20, height: 12, centered: true };
  }
  if (tool === 'polygon') {
    return { polygonPreset: 'hexagon', radius: 8 };
  }
  if (tool === 'polyline') {
    return { points: [] };
  }
  return { radius: 5, segments: 64 };
}

/** Sane mobile defaults: 10 mm along the workplane normal, one-sided out. */
export function defaultExtrudeParams() {
  return { distance: 10, direction: 'normal', sense: 'positive' };
}

export function normalizeExtrudeParams(raw = {}) {
  const distance = Number(raw.distance);
  let sense = String(raw.sense ?? 'positive');
  if (sense === '+' || sense === 'out' || sense === 'along') sense = 'positive';
  if (sense === '-' || sense === 'in' || sense === 'opposite') sense = 'negative';
  if (sense === 'mid' || sense === '±' || sense === '+-' || sense === 'symmetric') sense = 'both';
  let direction = String(raw.direction ?? 'normal');
  if (direction === 'along' || direction === 'n' || direction === 'plane') direction = 'normal';
  return { distance, direction, sense };
}

/** Local-Z start of makeExtrude on the workplane (sense → placeInFrame w). */
export function extrudeWOffset(distance, sense) {
  const d = Number(distance);
  if (sense === 'negative') return -d;
  if (sense === 'both') return -d / 2;
  return 0;
}

/**
 * World-axis direction must be parallel to the workplane normal.
 * `normal` always uses the plane normal (placeInFrame maps local Z → normal).
 */
export function resolveExtrudeAxis(plane, direction) {
  if (!plane?.normal) {
    return { ok: false, message: 'Extrude: workplane is missing a normal' };
  }
  const dir = direction || 'normal';
  if (dir === 'normal') {
    return { ok: true, axis: plane.normal.slice(), source: 'normal' };
  }
  const map = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axis = map[dir];
  if (!axis) {
    return { ok: false, message: 'Extrude direction must be normal, x, y, or z' };
  }
  const d = _dot(axis, plane.normal);
  if (Math.abs(d) < 0.99) {
    return {
      ok: false,
      message:
        'Extrude direction must be along the workplane normal (or a world axis parallel to it).',
    };
  }
  return { ok: true, axis: plane.normal.slice(), source: dir };
}

export function validateExtrudeParams(raw) {
  const n = normalizeExtrudeParams(raw);
  if (!(n.distance > 0) || !Number.isFinite(n.distance)) {
    return { ok: false, message: 'makeExtrude: distance must be > 0' };
  }
  if (!EXTRUDE_DIRECTIONS.includes(n.direction)) {
    return { ok: false, message: 'Extrude direction must be normal, x, y, or z' };
  }
  if (!EXTRUDE_SENSES.includes(n.sense)) {
    return { ok: false, message: 'Extrude sense must be positive, negative, or both' };
  }
  return { ok: true, normalized: n };
}

/** Sane mobile defaults: full 360° around the plane V axis (on-plane). */
export function defaultRevolveParams() {
  return { angle: 360, axis: 'v', sense: 'positive' };
}

/** Path direction toggle. The wire itself comes from the edge selection. */
export function defaultSweepParams() {
  return { reverse: false };
}

export function normalizeSweepParams(raw = {}) {
  return { reverse: !!(raw && raw.reverse) };
}

function _newLoftProfileId(profiles = []) {
  const used = new Set((profiles || []).map((p) => p?.id));
  let n = profiles?.length || 0;
  let id = `p${n}`;
  while (used.has(id)) {
    n += 1;
    id = `p${n}`;
  }
  return id;
}

/**
 * Default Loft: two stations on the shared workplane (circle r=5 @ 0, circle r=8 @ 20).
 * Each station can later pick its own face, workplane, or saved sketch plane.
 */
export function defaultLoftProfiles() {
  return [
    { id: 'p0', tool: 'circle', params: defaultContourParams('circle'), offset: 0 },
    { id: 'p1', tool: 'circle', params: { ...defaultContourParams('circle'), radius: 8 }, offset: 20 },
  ];
}

function _cloneFrame(frame) {
  if (!frame?.center || !frame?.normal || !frame?.x || !frame?.y) return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const axis = (v) => {
    if (!Array.isArray(v) || v.length < 3) return null;
    const out = [num(v[0]), num(v[1]), num(v[2])];
    return out.every((n) => n != null) ? out : null;
  };
  const center = axis(frame.center);
  const normal = axis(frame.normal);
  const x = axis(frame.x);
  const y = axis(frame.y);
  if (!center || !normal || !x || !y) return null;
  return { center, normal, x, y };
}

/** A station that sits on its own frame, not the shared plane plus an offset. */
export function loftStationOwnsPlane(profile) {
  return !!(
    profile
    && (profile.planeKind === 'face' || profile.planeKind === 'workplane' || profile.planeKind === 'contour')
    && profile.plane?.center
    && profile.plane?.normal
    && profile.plane?.x
    && profile.plane?.y
  );
}

export function defaultLoftState() {
  return { profiles: defaultLoftProfiles(), selected: 0 };
}

export function normalizeLoftProfile(raw = {}, fallbackTool = 'circle') {
  const tool = isContourTool(raw.tool) ? raw.tool : fallbackTool;
  const params = { ...defaultContourParams(tool), ...(raw.params || {}) };
  const offset = Number(raw.offset);
  const plane = _cloneFrame(raw.plane);
  const owns = (raw.planeKind === 'face' || raw.planeKind === 'workplane' || raw.planeKind === 'contour') && plane;
  return {
    id: raw.id || _newLoftProfileId(),
    tool,
    params,
    offset: Number.isFinite(offset) ? offset : 0,
    planeKind: owns ? raw.planeKind : 'offset',
    plane: owns ? plane : null,
    planeRef: owns ? (raw.planeRef || null) : null,
    planeLabel: owns ? (raw.planeLabel || '') : '',
    contourId: raw.contourId || null,
    contourName: raw.contourName || null,
  };
}

export function writeLoftSelected(state, patch = {}) {
  if (!state?.loft?.profiles?.length) return state;
  const selected = Math.max(0, Math.min(state.loft.selected || 0, state.loft.profiles.length - 1));
  const profiles = state.loft.profiles.map((p, i) => {
    if (i !== selected) {
      return { ...p, params: { ...(p.params || {}) } };
    }
    const next = { ...p, ...patch };
    if (patch.params) next.params = { ...p.params, ...patch.params };
    return normalizeLoftProfile(next, p.tool);
  });
  const cur = profiles[selected];
  return {
    ...state,
    tool: cur.tool,
    params: { ...cur.params },
    loft: { ...state.loft, profiles, selected },
  };
}

export function selectLoftProfile(state, index) {
  const base = state?.dimensionLive ? syncContourSession(revertLiveDimension(state)) : state;
  if (!base?.loft?.profiles?.length) return base;
  const selected = Math.max(0, Math.min(Number(index) || 0, base.loft.profiles.length - 1));
  const cur = base.loft.profiles[selected];
  const next = {
    ...base,
    dimensionLive: null,
    tool: cur.tool,
    params: { ...cur.params },
    picks: [],
    tagId: null,
    loft: { ...base.loft, selected, picking: null },
  };
  if (next.gesture === 'dimension' || next.gesture === 'arc' || next.gesture === 'constraints') {
    return syncContourSession(promoteContourState(next));
  }
  return next;
}

/**
 * Put the selected station on a picked frame. `kind` is face, workplane, or
 * contour. The shared card plane (offset stations) is left alone.
 */
export function setLoftStationPlane(state, frame, meta = {}) {
  const plane = _cloneFrame(frame);
  if (!plane || !state?.loft) return state;
  const next = writeLoftSelected(state, {
    planeKind: meta.kind || 'face',
    plane,
    planeRef: meta.ref || null,
    planeLabel: meta.label || '',
  });
  return { ...next, loft: { ...next.loft, picking: null } };
}

/** Selected station goes back to the shared plane plus its offset. */
export function clearLoftStationPlane(state) {
  if (!state?.loft) return state;
  const next = writeLoftSelected(state, {
    planeKind: 'offset',
    plane: null,
    planeRef: null,
    planeLabel: '',
  });
  return { ...next, loft: { ...next.loft, picking: null } };
}

/** Next face, construction plane, or sketch hit assigns the selected station. */
export function armLoftStationPlanePick(state) {
  if (!state?.loft) return state;
  return { ...state, loft: { ...state.loft, picking: 'face' } };
}

/** Own-plane station frame, or null when the station follows the shared plane. */
export function selectedLoftDrawFrame(state) {
  if (!isLoftEntry(state?.entry) || !state?.loft?.profiles?.length) return null;
  const selected = Math.max(0, Math.min(state.loft.selected || 0, state.loft.profiles.length - 1));
  const profile = state.loft.profiles[selected];
  return loftStationOwnsPlane(profile) ? profile.plane : null;
}

export function addLoftProfile(state) {
  if (!state?.loft?.profiles) return state;
  if (state.loft.profiles.length >= LOFT_MAX_PROFILES) return state;
  const profiles = state.loft.profiles.map((p) => normalizeLoftProfile(p, p.tool));
  const maxOff = profiles.reduce((m, p) => Math.max(m, Number(p.offset) || 0), 0);
  const next = normalizeLoftProfile({
    id: _newLoftProfileId(profiles),
    tool: state.tool || 'circle',
    params: { ...(state.params || defaultContourParams(state.tool || 'circle')) },
    offset: maxOff + 20,
  }, state.tool || 'circle');
  profiles.push(next);
  return {
    ...state,
    tool: next.tool,
    params: { ...next.params },
    loft: { profiles, selected: profiles.length - 1 },
  };
}

export function removeLoftProfile(state, index) {
  if (!state?.loft?.profiles || state.loft.profiles.length <= LOFT_MIN_PROFILES) {
    return state;
  }
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= state.loft.profiles.length) return state;
  const profiles = state.loft.profiles.filter((_, k) => k !== i);
  const selected = Math.min(
    i === state.loft.selected ? Math.max(0, i - 1) : state.loft.selected > i ? state.loft.selected - 1 : state.loft.selected,
    profiles.length - 1,
  );
  const cur = profiles[selected];
  return {
    ...state,
    tool: cur.tool,
    params: { ...cur.params },
    loft: { profiles, selected },
  };
}

export function setLoftProfileOffset(state, offset) {
  if (!state?.loft?.profiles?.length) return state;
  const selected = Math.max(0, Math.min(state.loft.selected || 0, state.loft.profiles.length - 1));
  const profiles = state.loft.profiles.map((p, i) => (i === selected ? { ...p, offset } : p));
  return { ...state, loft: { ...state.loft, profiles, selected } };
}

export function normalizeRevolveParams(raw = {}) {
  const angle = Number(raw.angle);
  let sense = String(raw.sense ?? 'positive');
  if (sense === '+' || sense === 'out' || sense === 'along' || sense === 'ccw') sense = 'positive';
  if (sense === '-' || sense === 'in' || sense === 'opposite' || sense === 'cw') sense = 'negative';
  if (sense === 'mid' || sense === '±' || sense === '+-' || sense === 'symmetric') sense = 'both';
  let axis = String(raw.axis ?? 'v');
  if (axis === 'plane-y' || axis === 'along-v' || axis === 'height' || axis === 'vy') axis = 'v';
  if (axis === 'plane-x' || axis === 'along-u' || axis === 'ux') axis = 'u';
  return { angle, axis, sense };
}

/** Start angle of makeRevolve (sense → rotate around the result Z axis). */
export function revolveStartDeg(angle, sense) {
  const a = Number(angle);
  if (sense === 'negative') return -a;
  if (sense === 'both') return -a / 2;
  return 0;
}

/**
 * Revolve axis must lie on the profile plane (inverse of Extrude's normal rule).
 * `u` / `v` are the workplane basis; world x/y/z must be parallel to the plane.
 */
export function resolveRevolveAxis(plane, axis) {
  if (!plane?.normal || !plane?.x || !plane?.y) {
    return { ok: false, message: 'Revolve: workplane is missing a frame' };
  }
  const dir = axis || 'v';
  if (dir === 'u') {
    return { ok: true, uv: [1, 0], world: plane.x.slice(), source: 'u' };
  }
  if (dir === 'v') {
    return { ok: true, uv: [0, 1], world: plane.y.slice(), source: 'v' };
  }
  const map = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const world = map[dir];
  if (!world) {
    return { ok: false, message: 'Revolve axis must be u, v, x, y, or z' };
  }
  if (Math.abs(_dot(world, plane.normal)) > 0.01) {
    return {
      ok: false,
      message:
        'Revolve axis must lie on the profile plane (or a world axis parallel to it).',
    };
  }
  const u = _dot(world, plane.x);
  const v = _dot(world, plane.y);
  const len = Math.hypot(u, v);
  if (len < 1e-9) {
    return { ok: false, message: 'Revolve axis must lie on the profile plane' };
  }
  return {
    ok: true,
    uv: [u / len, v / len],
    world: [
      (u / len) * plane.x[0] + (v / len) * plane.y[0],
      (u / len) * plane.x[1] + (v / len) * plane.y[1],
      (u / len) * plane.x[2] + (v / len) * plane.y[2],
    ],
    source: dir,
  };
}

export function validateRevolveParams(raw) {
  const n = normalizeRevolveParams(raw);
  if (!(n.angle > 0) || !Number.isFinite(n.angle) || n.angle > 360) {
    return { ok: false, message: 'makeRevolve: angle must be > 0 and ≤ 360' };
  }
  if (!REVOLVE_AXES.includes(n.axis)) {
    return { ok: false, message: 'Revolve axis must be u, v, x, y, or z' };
  }
  if (!REVOLVE_SENSES.includes(n.sense)) {
    return { ok: false, message: 'Revolve sense must be positive, negative, or both' };
  }
  return { ok: true, normalized: n };
}

/**
 * Map workplane UV contours into makeRevolve (radial, height) space.
 *
 * Identity (u,v)→(radial,height) in the axis/radial basis — axis through the
 * workplane origin, no min-radial shift. makeRevolve / Manifold then clips
 * x < 0 (positive-X half only), so a centered circle revolves about a
 * diameter → sphere. Shifting by minR was the opposite geometry: it parked
 * the axis on the profile's leftmost edge (horn torus / filled washer).
 *
 * Crossing (minR < 0 < maxR) is accepted and clipped. Profiles with no
 * +radial material (on-axis / entirely negative) loud-fail.
 */
export function mapContoursToRevolve(contours, uvAxis) {
  if (!Array.isArray(contours) || !contours.length) {
    return { ok: false, message: 'makeRevolve: expected an array of contours' };
  }
  const au = Number(uvAxis?.[0]);
  const av = Number(uvAxis?.[1]);
  if (!Number.isFinite(au) || !Number.isFinite(av) || Math.hypot(au, av) < 1e-9) {
    return { ok: false, message: 'makeRevolve: axis UV direction is missing' };
  }
  const inv = 1 / Math.hypot(au, av);
  const aU = au * inv;
  const aV = av * inv;
  // Radial = rotate axis 90° CW in the plane so V-axis → +U (x=radial, y=height).
  const rU = aV;
  const rV = -aU;
  let minR = Infinity;
  let maxR = -Infinity;
  const mapped = [];
  for (const ring of contours) {
    if (!Array.isArray(ring)) {
      return { ok: false, message: 'makeRevolve: expected an array of contours' };
    }
    const out = [];
    for (const p of ring) {
      const radial = rU * Number(p?.[0]) + rV * Number(p?.[1]);
      const height = aU * Number(p?.[0]) + aV * Number(p?.[1]);
      if (!Number.isFinite(radial) || !Number.isFinite(height)) {
        return { ok: false, message: 'makeRevolve: contour point is not finite' };
      }
      if (radial < minR) minR = radial;
      if (radial > maxR) maxR = radial;
      out.push([radial, height]);
    }
    mapped.push(out);
  }
  if (!Number.isFinite(minR) || maxR - minR < 1e-9) {
    return {
      ok: false,
      message: 'makeRevolve: profile has no width off the axis — would sit on the axis',
    };
  }
  // Reachable: entirely −radial has width but no +X material (empty revolve).
  // Gutting this arm must turn the entirely-negative golden red. Crossing
  // (minR < 0 < maxR) is accepted — Manifold clips to +radial (sphere case).
  if (maxR < 1e-6) {
    return {
      ok: false,
      message: 'makeRevolve: profile has no material on the +radial side of the axis',
    };
  }
  return { ok: true, mapped, shift: 0, rU, rV, aU, aV, minR, maxR };
}

/**
 * Seed mode state from a palette entry + current face pick.
 * Non-planar face → default +Z plane + loud enterRefuse (do not invent a plane).
 */
export function enterContourState(entry, faceData = null) {
  const resolved = resolveContourWorkplane(faceData);
  const loft = defaultLoftState();
  const first = loft.profiles[0];
  return {
    entry: CONTOUR_ENTRY_IDS.has(entry) ? entry : 'crossSection',
    tool: first.tool,
    params: { ...first.params },
    extrude: defaultExtrudeParams(),
    revolve: defaultRevolveParams(),
    sweep: defaultSweepParams(),
    loft,
    planeFace: resolved.ok ? resolved.face : null,
    planePreset: resolved.source === 'face' ? 'face' : 'z',
    planeAngles: { x: 0, y: 0, z: 0 },
    planeBase: resolved.source === 'face' ? resolved.plane : null,
    planeOffset: 0,
    combine: 'add',
    merge: true,
    enterRefuse: resolved.ok ? null : resolved.message,
  };
}

function syncContourSession(state) {
  if (!state || !isLoftEntry(state.entry)) return state;
  const written = writeLoftSelected(state, { params: state.params });
  return {
    ...written,
    gesture: state.gesture ?? null,
    picks: state.picks || [],
    tagId: state.tagId ?? null,
    gestureNote: state.gestureNote ?? null,
  };
}

/** Arc and Dimension. Not profile tools: the contour stays put. */
export function armContourGesture(state, gesture) {
  return syncContourSession(selectContourGesture(state, gesture));
}

export function applyContourPick(state, pick) {
  return syncContourSession(toggleContourPick(state, pick));
}

export function saveContourDimension(state, draft) {
  const result = commitDimension(state, draft);
  return { ...result, state: syncContourSession(result.state) };
}

/** Typed dimension. Updates the session wire and does not write the script. */
export function previewContourDimension(state, draft) {
  const result = draft
    ? liveDimension(state, draft)
    : { state: revertLiveDimension(state), error: null };
  if (!result.state || result.state === state) return { ...result, state };
  return { ...result, state: syncContourSession(result.state) };
}

export function saveContourArc(state, radiusMm) {
  const result = commitArc(state, radiusMm);
  return { ...result, state: syncContourSession(result.state) };
}

export function removeContourDimension(state, id) {
  const result = deleteContourDimension(state, id);
  return { ...result, state: syncContourSession(result.state) };
}

export function saveContourConstraint(state, draft) {
  const result = commitConstraint(state, draft);
  return { ...result, state: syncContourSession(result.state) };
}

export function removeContourConstraint(state, id) {
  const result = deleteContourConstraint(state, id);
  return { ...result, state: syncContourSession(result.state) };
}

export function removeContourRef(state, id) {
  const result = deleteContourRef(state, id);
  return { ...result, state: syncContourSession(result.state) };
}

/** A drawn polyline or a promoted contour survives a tool change. */
export function sketchKeepsGeometry(state) {
  if (state?.params?.contour?.points?.length) return true;
  const pts = state?.params?.points;
  return Array.isArray(pts) && pts.length > 0;
}

export function switchContourTool(state, tool) {
  const reverted = state?.dimensionLive ? syncContourSession(revertLiveDimension(state)) : state;
  const nextTool = isContourTool(tool) ? tool : 'circle';
  // Same tool only drops the gesture. A different tool does that too once
  // geometry exists: switching must not freeze or discard the sketch.
  if (reverted?.tool === nextTool || sketchKeepsGeometry(reverted)) {
    const next = {
      ...reverted,
      tool: nextTool,
      gesture: null,
      picks: [],
      tagId: null,
      gestureNote: null,
      dimensionLive: null,
    };
    if (!isLoftEntry(reverted?.entry)) return next;
    const written = writeLoftSelected(next, { tool: nextTool, params: next.params });
    return {
      ...written,
      gesture: null,
      picks: [],
      tagId: null,
      gestureNote: null,
      dimensionLive: null,
    };
  }
  const next = defaultContourParams(nextTool);
  if (reverted?.params?.radius != null && next.radius != null) {
    next.radius = reverted.params.radius;
  }
  const nextState = {
    ...reverted,
    tool: nextTool,
    params: next,
    pickedContourId: null,
    gesture: null,
    picks: [],
    tagId: null,
    gestureNote: null,
    dimensionLive: null,
  };
  if (isLoftEntry(state?.entry)) {
    const written = writeLoftSelected(nextState, { tool: nextTool, params: next });
    return { ...written, pickedContourId: null };
  }
  return nextState;
}

/**
 * Map in-mode tool + params → Slice 21 buildProfileFromParams / compose shape.
 */
export function toolToProfileParams(tool, params = {}) {
  const p = params || {};
  if (p.contour) return { profileType: 'contour', contour: p.contour };
  if (tool === 'rectangle') {
    return {
      profileType: 'rectangle',
      width: p.width,
      height: p.height,
      centered: p.centered,
    };
  }
  if (tool === 'polygon') {
    return {
      profileType: 'polygon',
      polygonPreset: p.polygonPreset || 'hexagon',
      radius: p.radius,
    };
  }
  if (tool === 'polyline') {
    return {
      profileType: 'polygon',
      polygonPreset: 'custom',
      points: Array.isArray(p.points) ? p.points : [],
    };
  }
  return {
    profileType: 'circle',
    radius: p.radius,
    segments: p.segments,
  };
}

function _dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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

/**
 * Classify a Viewport face pick into a contour workplane.
 * Planar → workplaneFromFace frame (origin snapped to face center, Slice 21).
 * No face → default +Z top. Cylindrical / irregular → refuse (loud, no best-fit).
 *
 * @param {object|null} faceData
 * @returns {{ ok: boolean, face: object|null, plane: object|null, source: string, message?: string }}
 */
export function resolveContourWorkplane(faceData) {
  if (!faceData) {
    return {
      ok: true,
      face: null,
      plane: defaultTopPlaneFrame(),
      source: 'defaultTop',
    };
  }
  const face = classifySelectedFace(faceData);
  if (!face) {
    return {
      ok: true,
      face: null,
      plane: defaultTopPlaneFrame(),
      source: 'defaultTop',
    };
  }
  if (face.type !== 'planar') {
    return {
      ok: false,
      face,
      plane: null,
      source: face.type,
      message: face.type === 'irregular'
        ? (face.refuseMessage || CROSS_SECTION_REFUSE_NON_PLANAR)
        : CROSS_SECTION_REFUSE_NON_PLANAR,
    };
  }
  return {
    ok: true,
    face,
    plane: planeFromContourFace(face),
    source: 'face',
  };
}

/**
 * Plane frame used by live preview (same snap as buildCrossSectionPreview).
 */
export function planeFromContourFace(face) {
  const framed = face?.planeFrame;
  if (framed?.center && framed?.normal && framed?.x && framed?.y) {
    return {
      center: framed.center.map(Number),
      normal: framed.normal.map(Number),
      x: framed.x.map(Number),
      y: framed.y.map(Number),
    };
  }
  if (!face || face.type !== 'planar') return defaultTopPlaneFrame(face?.center);
  const preview = buildCrossSectionPreview(face, { profileType: 'circle', radius: 1 });
  if (preview?.plane) return preview.plane;
  try {
    return planeFrameFromFaceData(face);
  } catch {
    return defaultTopPlaneFrame(face.center);
  }
}

/**
 * World-axis construction frame. +Z is XY (standard views). +X / +Y follow
 * workplaneFromFace: u is the in-plane world axis, v = normal × u.
 */
export function axisPresetFrame(axis, center = [0, 0, 0]) {
  const c = [
    Number(center?.[0]) || 0,
    Number(center?.[1]) || 0,
    Number(center?.[2]) || 0,
  ];
  if (axis === 'x') return { center: c, normal: [1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] };
  if (axis === 'y') return { center: c, normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, -1] };
  return { center: c, normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
}

function _rotAbout(v, axis, deg) {
  const a = (Number(deg) || 0) * Math.PI / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = v[0];
  const y = v[1];
  const z = v[2];
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

/** Rotate a plane frame by degrees about world X, then Y, then Z. */
export function orientPlaneFrame(plane, angles = {}) {
  if (!plane?.center || !plane?.normal || !plane?.x || !plane?.y) return plane;
  const apply = (v) => _rotAbout(_rotAbout(_rotAbout(v, 'x', angles.x), 'y', angles.y), 'z', angles.z);
  let normal = _norm3(apply(plane.normal));
  let x = _norm3(apply(plane.x));
  if (!normal || !x) return plane;
  const along = _dot(x, normal);
  x = _norm3([
    x[0] - along * normal[0],
    x[1] - along * normal[1],
    x[2] - along * normal[2],
  ]);
  const y = x ? _norm3(_cross3(normal, x)) : null;
  if (!x || !y) return plane;
  return {
    center: plane.center.map(Number),
    normal,
    x,
    y,
  };
}

function _faceFromFrame(frame) {
  return {
    type: 'planar',
    center: frame.center.slice(),
    normal: frame.normal.slice(),
    area: 400,
    triangleCount: 2,
    selectionMode: 'coplanar',
    planeFrame: {
      center: frame.center.slice(),
      normal: frame.normal.slice(),
      x: frame.x.slice(),
      y: frame.y.slice(),
    },
  };
}

/**
 * Part-top center for the default +Z plane (preview and Confirm share it).
 * No bounds → world origin.
 */
export function contourHostCenter(bounds) {
  if (bounds?.max && Number.isFinite(Number(bounds.max[2]))) {
    return [
      Number(bounds.center?.[0]) || 0,
      Number(bounds.center?.[1]) || 0,
      Number(bounds.max[2]),
    ];
  }
  return [0, 0, 0];
}

/** Default contour face: world +Z, X/Y axes, center at the host top or origin. */
export function defaultContourPlaneFace(center) {
  return _faceFromFrame(defaultTopPlaneFrame(center || [0, 0, 0]));
}

/**
 * The workplane the user is actually looking at: an edited / picked frame
 * wins; otherwise the default view-aligned +Z plane snapped to the top of the
 * part (not a tilted host face).
 *
 * ONE resolver for the overlay paint, the polyline hit-test and Confirm. When
 * the hit-test resolved its own fallback, a part sitting above z=0 put tapped
 * points on the z=0 plane while the overlay was drawn at the part top, so
 * every tapped point landed off-cursor by that parallax.
 */
export function contourWorkplaneFace(state, bounds) {
  if (state?.planeFace) return state.planeFace;
  const face = defaultContourPlaneFace(contourHostCenter(bounds));
  // Size the overlay quad to the part when we know it (cosmetic only).
  const w = Number(bounds?.size?.[0]);
  const d = Number(bounds?.size?.[1]);
  if (w > 0 && d > 0) face.area = Math.max(1, w * d);
  return face;
}

/** contourWorkplaneFace as a plane frame — what rays are intersected against. */
export function contourWorkplane(state, bounds) {
  return planeFromContourFace(contourWorkplaneFace(state, bounds));
}

/**
 * Face Confirm should use. An edited frame wins; otherwise the default
 * view-aligned +Z plane (not a tilted host face).
 */
export function activeContourFace(state, bounds) {
  return contourWorkplaneFace(state, bounds);
}

/**
 * Apply an X/Y/Z preset, a picked workplane/face frame, and/or angle sliders.
 * The result is stored on planeFace.planeFrame so live preview and Confirm
 * share one plane.
 */
export function applyContourPlaneEdit(state, edit = {}) {
  if (!state) return state;
  const prevAngles = state.planeAngles || { x: 0, y: 0, z: 0 };
  const angles = {
    x: Number(edit.angles?.x ?? prevAngles.x) || 0,
    y: Number(edit.angles?.y ?? prevAngles.y) || 0,
    z: Number(edit.angles?.z ?? prevAngles.z) || 0,
  };
  let preset = edit.preset || state.planePreset || 'z';
  let base = edit.base || state.planeBase || null;
  if (edit.preset === 'x' || edit.preset === 'y' || edit.preset === 'z') {
    const center = (edit.base || base || state.planeFace)?.center || [0, 0, 0];
    base = axisPresetFrame(edit.preset, center);
    preset = edit.preset;
    if (!edit.keepAngles) {
      angles.x = 0;
      angles.y = 0;
      angles.z = 0;
    }
  }
  if (!base) base = axisPresetFrame('z', state.planeFace?.center || [0, 0, 0]);
  let frame = orientPlaneFrame(base, angles);
  const offsetRaw = edit.offset !== undefined ? edit.offset : state.planeOffset;
  const offset = Number(offsetRaw);
  const planeOffset = Number.isFinite(offset) ? offset : 0;
  if (planeOffset !== 0) {
    try {
      frame = offsetPlaneFrame(frame, planeOffset);
    } catch {
      // Keep oriented frame if offset fails (bad frame).
    }
  }
  return {
    ...state,
    planePreset: preset,
    planeAngles: angles,
    planeBase: base,
    planeOffset,
    planeFace: _faceFromFrame(frame),
  };
}

export function workplaneOverlaySize(face, fallback = 36) {
  const area = Number(face?.area);
  if (Number.isFinite(area) && area > 1) {
    return Math.min(120, Math.max(16, Math.sqrt(area) * 1.15));
  }
  return fallback;
}

/** Four world corners of a size×size quad centered on the plane. */
export function workplaneQuadCorners(plane, size) {
  const h = Number(size) / 2;
  if (!plane?.center || !plane?.x || !plane?.y || !Number.isFinite(h)) {
    throw new Error('workplaneQuadCorners: need plane center/x/y and finite size');
  }
  const at = (u, v) => [
    plane.center[0] + u * plane.x[0] + v * plane.y[0],
    plane.center[1] + u * plane.x[1] + v * plane.y[1],
    plane.center[2] + u * plane.x[2] + v * plane.y[2],
  ];
  return [at(-h, -h), at(h, -h), at(h, h), at(-h, h)];
}

/**
 * Ray ↔ plane intersection. Returns world point or null (parallel / non-finite).
 */
export function intersectRayPlane(origin, dir, plane) {
  if (!origin || !dir || !plane?.center || !plane?.normal) return null;
  const denom = _dot(dir, plane.normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = _dot(_sub(plane.center, origin), plane.normal) / denom;
  if (!Number.isFinite(t)) return null;
  return _add(origin, _mul(t, dir));
}

export function worldToPlaneUV(world, plane) {
  if (!world || !plane?.center || !plane?.x || !plane?.y) {
    throw new Error('worldToPlaneUV: need world point and plane center/x/y');
  }
  const d = _sub(world, plane.center);
  return [_dot(d, plane.x), _dot(d, plane.y)];
}

/**
 * Loud-fail gate for Confirm. A promoted contour whose solver still
 * rejects the remainder stays ok: the delete is already in params.
 */
export function validateContourProfile(tool, params) {
  const p = params || {};
  try {
    if (tool === 'circle') {
      const r = Number(p.radius);
      if (!(r > 0) || !Number.isFinite(r)) {
        return { ok: false, message: 'profileCircle: radius must be > 0' };
      }
    } else if (tool === 'rectangle') {
      const w = Number(p.width);
      const h = Number(p.height);
      if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) {
        return { ok: false, message: 'profileRectangle: width and height must be > 0' };
      }
    } else if (tool === 'polygon') {
      const r = Number(p.radius);
      if (!(r > 0) || !Number.isFinite(r)) {
        return { ok: false, message: 'profilePolygon: radius must be > 0 for regular polygon' };
      }
    } else if (tool === 'polyline') {
      const pts = p.points;
      if (!Array.isArray(pts) || pts.length < 3) {
        return {
          ok: false,
          message:
            'profilePolygon: need ≥ 3 points for a closed polyline — tap the workplane, then Confirm.',
        };
      }
    }
    const built = buildProfileFromParams(toolToProfileParams(tool, p));
    if (!built?.contours?.length) {
      return { ok: false, message: 'buildProfileFromParams: empty contours' };
    }
    return { ok: true };
  } catch (e) {
    // A delete can leave a contour the solver still rejects. The removal
    // is already in params, so Confirm may write it and show the status.
    if (p.contour?.points?.length) return { ok: true };
    return { ok: false, message: (e && e.message) || String(e) };
  }
}

/**
 * Live preview via Slice 21 makeCrossSection mirror. Null when params are
 * incomplete (e.g. polyline with fewer than 3 points) — caller may draft.
 */
export function buildContourPreview(face, tool, params) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return null;
  return buildCrossSectionPreview(face || null, toolToProfileParams(tool, params));
}

/** Assemble a reusable cross-section value (goldens / Extrude). */
export function assembleContourCrossSection(face, tool, params) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) {
    throw new Error(gate.message);
  }
  const plane = planeFromContourFace(face);
  return assembleCrossSection(plane, toolToProfileParams(tool, params));
}

/**
 * Live Extrude solid preview payload (plane + UV contours + sense offset).
 * Null when profile or extrude params are incomplete / invalid.
 */
export function buildExtrudeSolidPreview(face, tool, params, extrude) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return null;
  const extGate = validateExtrudeParams(extrude);
  if (!extGate.ok) return null;
  const prev = buildContourPreview(face, tool, params);
  if (!prev?.plane) return null;
  const axis = resolveExtrudeAxis(prev.plane, extGate.normalized.direction);
  if (!axis.ok) return null;
  let contours;
  try {
    contours = buildProfileFromParams(toolToProfileParams(tool, params)).contours;
  } catch {
    return null;
  }
  if (!contours?.length) return null;
  const w0 = extrudeWOffset(extGate.normalized.distance, extGate.normalized.sense);
  return {
    plane: prev.plane,
    rings: prev.rings,
    contours,
    profile: prev.profile,
    extrude: extGate.normalized,
    axis: axis.axis,
    w0,
    distance: extGate.normalized.distance,
  };
}

/**
 * Live Revolve solid preview payload (plane + remapped radial/height contours).
 * Null when profile or revolve params are incomplete / invalid.
 */
export function buildRevolveSolidPreview(face, tool, params, revolve) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return null;
  const revGate = validateRevolveParams(revolve);
  if (!revGate.ok) return null;
  const prev = buildContourPreview(face, tool, params);
  if (!prev?.plane) return null;
  const axis = resolveRevolveAxis(prev.plane, revGate.normalized.axis);
  if (!axis.ok) return null;
  let contours;
  try {
    contours = buildProfileFromParams(toolToProfileParams(tool, params)).contours;
  } catch {
    return null;
  }
  if (!contours?.length) return null;
  const mapped = mapContoursToRevolve(contours, axis.uv);
  if (!mapped.ok) return null;
  const startDeg = revolveStartDeg(revGate.normalized.angle, revGate.normalized.sense);
  const plane = prev.plane;
  const radialWorld = [
    mapped.rU * plane.x[0] + mapped.rV * plane.y[0],
    mapped.rU * plane.x[1] + mapped.rV * plane.y[1],
    mapped.rU * plane.x[2] + mapped.rV * plane.y[2],
  ];
  const axisWorld = axis.world.slice();
  // Axis through the workplane origin (identity remap — no min-radial shift).
  const center = plane.center.slice();
  return {
    plane,
    rings: prev.rings,
    contours: mapped.mapped,
    profile: prev.profile,
    revolve: revGate.normalized,
    axis: axisWorld,
    radial: radialWorld,
    center,
    shift: 0,
    startDeg,
    angle: revGate.normalized.angle,
  };
}

export function validateLoftProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length < LOFT_MIN_PROFILES) {
    return { ok: false, message: 'makeLoft: need at least 2 profiles' };
  }
  if (profiles.length > LOFT_MAX_PROFILES) {
    return { ok: false, message: `makeLoft: at most ${LOFT_MAX_PROFILES} profiles in v1` };
  }
  const normalized = [];
  const sharedOffsets = [];
  for (let i = 0; i < profiles.length; i++) {
    const p = normalizeLoftProfile(profiles[i], profiles[i]?.tool || 'circle');
    const gate = validateContourProfile(p.tool, p.params);
    if (!gate.ok) {
      return { ok: false, message: `makeLoft: profile ${i + 1}: ${gate.message}` };
    }
    if (!Number.isFinite(Number(p.offset))) {
      return { ok: false, message: `makeLoft: profile ${i + 1}: offset must be finite` };
    }
    if (!loftStationOwnsPlane(p)) sharedOffsets.push(Number(p.offset));
    normalized.push(p);
  }
  // Own-plane stations are not on this offset axis. Stations that still
  // share the card plane keep the coincident-offset refuse.
  const sorted = sharedOffsets.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i] - sorted[i - 1]) < 1e-6) {
      return {
        ok: false,
        message: 'makeLoft: profiles share the same station offset — would be a zero-height loft',
      };
    }
  }
  return { ok: true, normalized };
}

function _loftSectionFromProfile(sharedPlane, profile) {
  const built = buildProfileFromParams(toolToProfileParams(profile.tool, profile.params));
  const owns = loftStationOwnsPlane(profile);
  const plane = owns ? profile.plane : offsetPlaneFrame(sharedPlane, profile.offset);
  const section = {
    plane,
    contours: built.contours,
    tool: profile.tool,
    params: profile.params,
  };
  // An explicit offset would hide the picked plane's center from makeLoft.
  if (!owns) section.offset = profile.offset;
  return section;
}

/**
 * Live Loft solid preview payload (shared workplane + offset stations).
 * Null when <2 valid profiles or coincident offsets.
 */
export function buildLoftSolidPreview(face, profiles) {
  const gate = validateLoftProfiles(profiles);
  if (!gate.ok) return null;
  const plane = planeFromContourFace(face);
  const sections = [];
  try {
    for (const p of gate.normalized) {
      const section = _loftSectionFromProfile(plane, p);
      if (!section.contours?.length) return null;
      sections.push(section);
    }
  } catch {
    return null;
  }
  const preview = buildLoftPreviewStations(sections, 32);
  if (!preview) return null;
  return {
    plane,
    stations: preview.stations,
    profiles: gate.normalized,
  };
}

function _norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function _cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** World XYZ → plane-frame UVW (same map the Sweep script emits). */
export function worldToFrameLocal(world, plane) {
  if (!world || !plane?.center || !plane?.x || !plane?.y || !plane?.normal) {
    throw new Error('worldToFrameLocal: need a world point and a plane frame');
  }
  const d0 = world[0] - plane.center[0];
  const d1 = world[1] - plane.center[1];
  const d2 = world[2] - plane.center[2];
  const along = (ax) => d0 * ax[0] + d1 * ax[1] + d2 * ax[2];
  return [along(plane.x), along(plane.y), along(plane.normal)];
}

/** Plane-frame UVW → world XYZ (placeInFrame with no extra uvw offset). */
export function frameLocalToWorld(local, plane) {
  if (!local || !plane?.center || !plane?.x || !plane?.y || !plane?.normal) {
    throw new Error('frameLocalToWorld: need a local point and a plane frame');
  }
  const c = plane.center;
  const x = plane.x;
  const y = plane.y;
  const n = plane.normal;
  return [
    c[0] + local[0] * x[0] + local[1] * y[0] + local[2] * n[0],
    c[1] + local[0] * x[1] + local[1] * y[1] + local[2] * n[1],
    c[2] + local[0] * x[2] + local[1] * y[2] + local[2] * n[2],
  ];
}

/**
 * Loud-fail gate for Sweep Confirm. Empty / disconnected / branched paths
 * refuse before any script is written.
 */
export function validateSweepPath(edges, sweep = {}) {
  const normalized = normalizeSweepParams(sweep);
  const list = Array.isArray(edges) ? edges : [];
  if (!list.length) {
    return { ok: false, message: SWEEP_EMPTY_PATH };
  }
  const ordered = assembleSweepPath(list, { reverse: normalized.reverse });
  if (!ordered.ok) {
    return {
      ok: false,
      message: ordered.message || 'makeSweepPath: could not order edges into a path',
    };
  }
  const value = ordered.value;
  if (!value?.points || value.points.length < 2) {
    return { ok: false, message: 'makeSweepPath: path needs at least 2 points' };
  }
  if (!(value.length > 1e-6)) {
    return { ok: false, message: 'makeSweepPath: path has zero or near-zero length' };
  }
  return { ok: true, path: value, normalized };
}

function sweepLocalFrames(points, closed) {
  const n = points.length;
  const tangentAt = (i) => {
    let a;
    let b;
    if (closed) {
      a = points[i];
      b = points[(i + 1) % n];
    } else if (i >= n - 1) {
      a = points[n - 2];
      b = points[n - 1];
    } else {
      a = points[i];
      b = points[i + 1];
    }
    return _norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) || [0, 0, 1];
  };
  const hint = [1, 0, 0];
  const t0 = tangentAt(0);
  const hd = _dot(hint, t0);
  let normal = _norm3([
    hint[0] - hd * t0[0],
    hint[1] - hd * t0[1],
    hint[2] - hd * t0[2],
  ]) || [0, 0, 1];
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = tangentAt(i);
    const proj = _dot(normal, t);
    const next = _norm3([
      normal[0] - proj * t[0],
      normal[1] - proj * t[1],
      normal[2] - proj * t[2],
    ]) || [0, 1, 0];
    frames.push({ N: next, B: _cross3(t, next) });
    normal = next;
  }
  return frames;
}

function subsampleSweepStations(stations, maxN) {
  if (!stations || stations.length <= maxN) return stations;
  const last = stations.length - 1;
  const out = [];
  let prev = -1;
  for (let i = 0; i < maxN; i++) {
    const idx = Math.round((i / (maxN - 1)) * last);
    if (idx === prev) continue;
    prev = idx;
    out.push(stations[idx]);
  }
  return out;
}

/**
 * Live Sweep preview: profile stations carried along the path in the plane
 * frame (same initial normal as sweepPoints). Null when profile or path is
 * not ready — caller keeps the profile ring and does not invent a solid.
 */
export function buildSweepSolidPreview(face, tool, params, edges, sweep) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return null;
  const pathGate = validateSweepPath(edges, sweep);
  if (!pathGate.ok) return null;
  const prev = buildContourPreview(face, tool, params);
  if (!prev?.plane) return null;
  let loop;
  try {
    loop = buildProfileFromParams(toolToProfileParams(tool, params)).contours?.[0];
  } catch {
    return null;
  }
  if (!loop || loop.length < 3) return null;
  const plane = prev.plane;
  const localPts = pathGate.path.points.map((p) => worldToFrameLocal(p, plane));
  const frames = sweepLocalFrames(localPts, !!pathGate.path.closed);
  const stations = localPts.map((origin, i) => {
    const { N, B } = frames[i];
    const ring = loop.map(([u, v]) => frameLocalToWorld([
      origin[0] + u * N[0] + v * B[0],
      origin[1] + u * N[1] + v * B[1],
      origin[2] + u * N[2] + v * B[2],
    ], plane));
    return { ring };
  });
  return {
    plane,
    stations: subsampleSweepStations(stations, 32),
    closed: !!pathGate.path.closed,
    length: pathGate.path.length,
    edgeCount: pathGate.path.edgeCount,
  };
}

export function loftSectionsForCompose(face, profiles) {
  const gate = validateLoftProfiles(profiles);
  if (!gate.ok) return gate;
  const plane = planeFromContourFace(face);
  const sections = gate.normalized.map((p) => _loftSectionFromProfile(plane, p));
  const assembled = assembleLoftStations(sections);
  if (!assembled.ok) return assembled;
  return { ok: true, normalized: gate.normalized, sections, assembled };
}

export function hasContourProfileBlock(buffer) {
  const t = String(buffer || '');
  return t.includes(CONTOUR_PROFILE_BEGIN) && t.includes(CONTOUR_PROFILE_END);
}

/** Text this composer owns — between CONTOUR_PROFILE_BEGIN and CONTOUR_PROFILE_END. */
export function contourProfileOwnedRegion(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(CONTOUR_PROFILE_BEGIN);
  if (i < 0) return '';
  const j = text.indexOf(CONTOUR_PROFILE_END, i);
  if (j < 0) return '';
  return text.slice(i, j + CONTOUR_PROFILE_END.length);
}

/**
 * Remove the in-mode Profile region so Confirm can replace it.
 * If markers are missing/unbalanced, leave the buffer unchanged (loud later).
 */
export function stripContourProfileBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(CONTOUR_PROFILE_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(CONTOUR_PROFILE_END, i);
  if (j < 0) return text;
  const after = text.slice(j + CONTOUR_PROFILE_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → insert or rewrite one named contour.
 * The contour owns its frame. A new confirm appends c1, c2, ….
 * The same `contourId` rewrites that statement and keeps the id.
 * Never emits makeExtrude / makeRevolve / loft, and does not wrap a
 * profile-marker block.
 *
 * No face means the default +Z frame at the origin. The viewport passes
 * the part-top face, so a real Confirm owns that plane.
 *
 * @returns {{ ok: true, buffer: string, contourId: string, contourName: string } | { ok: false, message: string }}
 */
export function composeContourProfile(buffer, {
  face = null,
  tool = 'circle',
  params = {},
  contourId = null,
  contourName = null,
} = {}) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return gate;

  const planar = face && face.type === 'planar' ? face : null;
  const saved = upsertNamedContour(buffer, {
    id: contourId,
    name: contourName,
    frame: planeFromContourFace(planar),
    profileExpr: emitProfileExprFromParams(toolToProfileParams(tool, params)),
  });
  if (!saved.ok) return saved;
  if (/makeExtrude\s*\(|makeRevolve\s*\(|makeLoft\s*\(|\bsweepPoints\s*\(/.test(saved.statement || '')) {
    return { ok: false, message: CONTOUR_NO_SOLID };
  }
  if (!/makeCrossSection\s*\(/.test(saved.statement || '')) {
    return {
      ok: false,
      message: 'composeContourProfile: makeCrossSection missing — refusing silent no-op.',
    };
  }
  return {
    ok: true,
    buffer: saved.buffer,
    contourId: saved.id,
    contourName: saved.name,
  };
}

export function countMakeCrossSection(buffer) {
  const m = String(buffer || '').match(/makeCrossSection\s*\(/g);
  return m ? m.length : 0;
}

export function countMakeExtrude(buffer) {
  const m = String(buffer || '').match(/makeExtrude\s*\(/g);
  return m ? m.length : 0;
}

export function countMakeRevolve(buffer) {
  const m = String(buffer || '').match(/makeRevolve\s*\(/g);
  return m ? m.length : 0;
}

export function countMakeLoft(buffer) {
  const m = String(buffer || '').match(/makeLoft\s*\(/g);
  return m ? m.length : 0;
}

/**
 * Empty / first-body Confirm must stay `let part = placeInFrame` (no host add,
 * no placeOnFace). When `part` already exists, Confirm must union
 * `part.add(placeInFrame(...))` — a bare replace wipes prior geometry.
 */
function advancedPlaceError(owned, prior, label, combine = 'add') {
  if (/placeOnFace\s*\(/.test(owned)) {
    return `${label}: placeOnFace is the host path — refusing leftover host.`;
  }
  const op = solidCombineOp(combine);
  const wanted = new RegExp(`part\\s*=\\s*part\\.${op}\\(\\s*placeInFrame\\s*\\(`);
  const other = op === 'subtract' ? 'add' : 'subtract';
  const unwanted = new RegExp(`part\\s*=\\s*part\\.${other}\\(\\s*placeInFrame\\s*\\(`);
  if (prior) {
    if (!wanted.test(owned) || unwanted.test(owned)) {
      return op === 'subtract'
        ? `${label}: existing part must subtract the new solid.`
        : `${label}: existing part must union the new solid — refusing wipe.`;
    }
    return null;
  }
  if (/part\s*=\s*part\.(?:add|subtract)\(/.test(owned)) {
    return `${label}: host-add is not the new-body path — refusing leftover host.`;
  }
  return null;
}

function _validFeatureId(id) {
  return id && /^[A-Za-z_$][\w$]*$/.test(String(id)) ? String(id) : null;
}

function _resolveFeatureId(blocks, requested, prefix) {
  const requestedId = _validFeatureId(requested);
  const existing = requestedId ? blocks.find((b) => b.id === requestedId) : null;
  const finalId = existing ? existing.id : (requestedId || mintBlockId(blocks, prefix));
  return { existing, finalId };
}

/** A founding `let part` block still owns the declaration when it is rewritten. */
function _placeHost(buffer, existing) {
  const prior = scriptHasPriorSolid(buffer);
  const founding = !!(existing && /(?:let|const|var)\s+part\s*=/.test(existing.text));
  return prior && !founding;
}

function _ownedFromList(blocks, id) {
  if (id) return blocks.find((b) => b.id === id)?.text || '';
  return blocks.length === 1 ? blocks[0].text : '';
}

function _stripFromList(buffer, blocks, id) {
  const hit = id
    ? blocks.find((b) => b.id === id)
    : (blocks.length === 1 ? blocks[0] : null);
  if (!hit) return String(buffer || '');
  const text = String(buffer || '');
  const after = text.slice(hit.end).replace(/^\r?\n/, '');
  const before = text.slice(0, hit.start).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

function _planContourStep({ buffer, requestedName, requestedContour, priorName, frame, profileExpr }) {
  if (requestedName || requestedContour) {
    const stmt = contourStatements(buffer).find((s) => (
      (requestedName && (s.name === requestedName || s.id === requestedName))
      || (requestedContour && s.id === requestedContour)
    ));
    if (stmt) {
      return {
        name: stmt.name,
        frame: _frameFromPlaneExpr(stmt.planeExpr) || frame,
        action: 'keep',
      };
    }
  }
  const prev = !requestedName && !requestedContour ? priorName : null;
  if (prev) {
    const stmt = contourStatements(buffer).find((s) => s.name === prev || s.id === prev);
    return {
      name: prev,
      frame,
      action: 'upsert',
      id: stmt?.id || prev,
      profileExpr,
    };
  }
  return {
    name: requestedName,
    frame,
    action: 'mint',
    id: requestedContour,
    profileExpr,
  };
}

function _commitContourPlan(buffer, planned, finalId, listFn) {
  let next = buffer;
  for (const step of planned) {
    if (step.action !== 'upsert') continue;
    const saved = upsertNamedContour(next, {
      id: step.id,
      name: step.name,
      frame: step.frame,
      profileExpr: step.profileExpr,
    });
    if (!saved.ok) return saved;
    step.name = saved.name;
    next = saved.buffer;
  }
  for (const step of planned) {
    if (step.action !== 'mint') continue;
    const block = listFn(next).find((b) => b.id === finalId);
    const saved = upsertNamedContour(next, {
      id: step.id || null,
      name: step.name || null,
      frame: step.frame,
      profileExpr: step.profileExpr,
      ...(block ? { at: block.start } : {}),
    });
    if (!saved.ok) return saved;
    step.name = saved.name;
    next = saved.buffer;
  }
  return { ok: true, buffer: next };
}

function _writeFeatureBlock(buffer, finalId, listFn, body) {
  const block = listFn(buffer).find((b) => b.id === finalId);
  if (!block) return _insertBeforeReturn(buffer, body);
  let head = buffer.slice(0, block.start);
  let rest = buffer.slice(block.end);
  if (head && !head.endsWith('\n')) head = `${head}\n`;
  if (rest && !rest.startsWith('\n')) rest = `\n${rest}`;
  let next = `${head}${body}${rest}`;
  if (findReturnPartIndex(next) < 0) {
    next = `${next.replace(/\s*$/, '')}\nreturn part;\n`;
  }
  return next;
}

function _namesBeside(buffer, block) {
  if (!block) return declaredNames(buffer);
  return declaredNames(buffer.slice(0, block.start) + buffer.slice(block.end));
}

export function listContourExtrudeBlocks(buffer) {
  return findFeatureBlocks(buffer, CONTOUR_EXTRUDE_BEGIN, CONTOUR_EXTRUDE_END);
}

export function hasContourExtrudeBlock(buffer) {
  return listContourExtrudeBlocks(buffer).length > 0;
}

/** The block with this id. With no id, the only block, or empty when several exist. */
export function contourExtrudeOwnedRegion(buffer, id = null) {
  return _ownedFromList(listContourExtrudeBlocks(buffer), id);
}

export function stripContourExtrudeBlock(buffer, id = null) {
  return _stripFromList(buffer, listContourExtrudeBlocks(buffer), id);
}

/**
 * Confirm → an extrude block that names a contour.
 * Distance and the sense shift stay in the block. The contour keeps its frame.
 * A new confirm appends extrude2. The same featureId rewrites that block.
 * Empty buffer: `let part = placeInFrame`. Existing part: union via `part.add`.
 *
 * @returns {{ ok: true, buffer: string, run: true, featureId: string, contours: Array<{ name: string }> } | { ok: false, message: string }}
 */
export function composeContourExtrude(buffer, {
  face = null,
  tool = 'circle',
  params = {},
  extrude = {},
  combine,
  merge,
  featureId = null,
  contourId = null,
  contourName = null,
} = {}) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return gate;

  const extGate = validateExtrudeParams(extrude);
  if (!extGate.ok) return extGate;

  const plane = planeFromContourFace(face);
  const axis = resolveExtrudeAxis(plane, extGate.normalized.direction);
  if (!axis.ok) return axis;

  const text = String(buffer || '');
  if (!featureMarkersBalanced(text, CONTOUR_EXTRUDE_BEGIN, CONTOUR_EXTRUDE_END)) {
    return {
      ok: false,
      message: 'composeContourExtrude: unbalanced extrude markers — refusing silent no-op.',
    };
  }

  const stripped = stripContourSiblingBlocks(buffer);
  const blocks = listContourExtrudeBlocks(stripped);
  const { existing, finalId } = _resolveFeatureId(blocks, featureId, 'extrude');
  const prior = existing ? parseExtrudeReference(existing.text) : null;
  const step = _planContourStep({
    buffer: stripped,
    requestedName: contourName || extrude.contourName || null,
    requestedContour: contourId || extrude.contourId || null,
    priorName: prior?.name || null,
    frame: plane,
    profileExpr: emitProfileExprFromParams(toolToProfileParams(tool, params)),
  });
  const committed = _commitContourPlan(stripped, [step], finalId, listContourExtrudeBlocks);
  if (!committed.ok) return committed;

  const host = _placeHost(stripped, existing);
  const combineOp = solidCombineOp(combine ?? extrude?.combine);
  const names = _namesBeside(committed.buffer, listContourExtrudeBlocks(committed.buffer).find((b) => b.id === finalId));
  const lines = emitExtrudeReferenceLines({
    begin: CONTOUR_EXTRUDE_BEGIN,
    end: CONTOUR_EXTRUDE_END,
    featureId: finalId,
    contour: step.name,
    distance: extGate.normalized.distance,
    w: extrudeWOffset(extGate.normalized.distance, extGate.normalized.sense),
    partLine: (expr) => emitPartPlace(
      names,
      expr,
      host,
      host,
      combineOp,
      solidMergeOn(merge ?? extrude?.merge),
    ),
  });
  const next = _writeFeatureBlock(committed.buffer, finalId, listContourExtrudeBlocks, lines.join('\n'));
  const owned = contourExtrudeOwnedRegion(next, finalId);
  if (!/makeExtrude\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourExtrude: makeExtrude missing — refusing silent no-op.',
    };
  }
  if (!/placeInFrame\s*\(|transformByFrame\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourExtrude: placeInFrame missing — refusing unscoped insert.',
    };
  }
  const placeErr = advancedPlaceError(owned, host, 'composeContourExtrude', combineOp);
  if (placeErr) return { ok: false, message: placeErr };
  if (!owned.includes(`id=${finalId}`)) {
    return {
      ok: false,
      message: 'composeContourExtrude: contour-mode extrude markers missing — refusing unscoped insert.',
    };
  }
  if (/makeRevolve\s*\(|makeLoft\s*\(|\bloft\s*\(|\bsweepPoints\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourExtrude: unexpected Revolve/Loft/Sweep in the Extrude block.',
    };
  }
  if (/makeCrossSection\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourExtrude: an extrude block names a contour — refusing an inline profile.',
    };
  }
  if (isBufferEmpty(String(buffer || '')) && /Manifold\.cube\s*\(/.test(next)) {
    return {
      ok: false,
      message: 'composeContourExtrude: unexpected starter box on empty buffer — refusing extra solid.',
    };
  }
  return {
    ok: true,
    buffer: next,
    run: true,
    featureId: finalId,
    contours: [{ name: step.name }],
  };
}

export function listContourRevolveBlocks(buffer) {
  return findFeatureBlocks(buffer, CONTOUR_REVOLVE_BEGIN, CONTOUR_REVOLVE_END);
}

export function hasContourRevolveBlock(buffer) {
  return listContourRevolveBlocks(buffer).length > 0;
}

/** The block with this id. With no id, the only block, or empty when several exist. */
export function contourRevolveOwnedRegion(buffer, id = null) {
  return _ownedFromList(listContourRevolveBlocks(buffer), id);
}

export function stripContourRevolveBlock(buffer, id = null) {
  return _stripFromList(buffer, listContourRevolveBlocks(buffer), id);
}

/**
 * Confirm → a revolve block that names a contour.
 * The remap, segments, angle, and optional rotate stay in the block.
 * A new confirm appends revolve2. The same featureId rewrites that block.
 * Empty buffer: `let part = placeInFrame`. Existing part: union via `part.add`.
 *
 * @returns {{ ok: true, buffer: string, run: true, featureId: string, contours: Array<{ name: string }> } | { ok: false, message: string }}
 */
export function composeContourRevolve(buffer, {
  face = null,
  tool = 'circle',
  params = {},
  revolve = {},
  combine,
  merge,
  featureId = null,
  contourId = null,
  contourName = null,
} = {}) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return gate;

  const revGate = validateRevolveParams({ ...defaultRevolveParams(), ...revolve });
  if (!revGate.ok) return revGate;
  const segRaw = revolve?.segments;
  const segments = segRaw == null || segRaw === ''
    ? REVOLVE_SEGMENTS
    : Math.round(Number(segRaw));
  if (!(segments >= 3) || !Number.isFinite(segments)) {
    return { ok: false, message: 'makeRevolve: segments must be an integer ≥ 3' };
  }

  const plane = planeFromContourFace(face);
  const axis = resolveRevolveAxis(plane, revGate.normalized.axis);
  if (!axis.ok) return axis;

  let contours;
  try {
    contours = buildProfileFromParams(toolToProfileParams(tool, params)).contours;
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
  const mapped = mapContoursToRevolve(contours, axis.uv);
  if (!mapped.ok) return mapped;

  const text = String(buffer || '');
  if (!featureMarkersBalanced(text, CONTOUR_REVOLVE_BEGIN, CONTOUR_REVOLVE_END)) {
    return {
      ok: false,
      message: 'composeContourRevolve: unbalanced revolve markers — refusing silent no-op.',
    };
  }

  const stripped = stripContourSiblingBlocks(buffer);
  const blocks = listContourRevolveBlocks(stripped);
  const { existing, finalId } = _resolveFeatureId(blocks, featureId, 'revolve');
  const prior = existing ? parseRevolveReference(existing.text) : null;
  const step = _planContourStep({
    buffer: stripped,
    requestedName: contourName || revolve.contourName || null,
    requestedContour: contourId || revolve.contourId || null,
    priorName: prior?.name || null,
    frame: plane,
    profileExpr: emitProfileExprFromParams(toolToProfileParams(tool, params)),
  });
  const committed = _commitContourPlan(stripped, [step], finalId, listContourRevolveBlocks);
  if (!committed.ok) return committed;

  const host = _placeHost(stripped, existing);
  const combineOp = solidCombineOp(combine ?? revolve?.combine);
  const names = _namesBeside(committed.buffer, listContourRevolveBlocks(committed.buffer).find((b) => b.id === finalId));
  const lines = emitRevolveReferenceLines({
    begin: CONTOUR_REVOLVE_BEGIN,
    end: CONTOUR_REVOLVE_END,
    featureId: finalId,
    contour: step.name,
    rU: mapped.rU,
    rV: mapped.rV,
    aU: mapped.aU,
    aV: mapped.aV,
    segments,
    angle: revGate.normalized.angle,
    startDeg: revolveStartDeg(revGate.normalized.angle, revGate.normalized.sense),
    partLine: (expr) => emitPartPlace(
      names,
      expr,
      host,
      host,
      combineOp,
      solidMergeOn(merge ?? revolve?.merge),
    ),
  });
  const next = _writeFeatureBlock(committed.buffer, finalId, listContourRevolveBlocks, lines.join('\n'));
  const owned = contourRevolveOwnedRegion(next, finalId);
  if (!/makeRevolve\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourRevolve: makeRevolve missing — refusing silent no-op.',
    };
  }
  if (!/placeInFrame\s*\(|transformByFrame\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourRevolve: placeInFrame missing — refusing unscoped insert.',
    };
  }
  const placeErr = advancedPlaceError(owned, host, 'composeContourRevolve', combineOp);
  if (placeErr) return { ok: false, message: placeErr };
  if (!owned.includes(`id=${finalId}`)) {
    return {
      ok: false,
      message: 'composeContourRevolve: contour-mode revolve markers missing — refusing unscoped insert.',
    };
  }
  if (/makeExtrude\s*\(|makeLoft\s*\(|\bloft\s*\(|\bsweepPoints\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourRevolve: unexpected Extrude/Loft/Sweep in the Revolve block.',
    };
  }
  if (/makeCrossSection\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourRevolve: a revolve block names a contour — refusing an inline profile.',
    };
  }
  if (isBufferEmpty(String(buffer || '')) && /Manifold\.cube\s*\(/.test(next)) {
    return {
      ok: false,
      message: 'composeContourRevolve: unexpected starter box on empty buffer — refusing extra solid.',
    };
  }
  return {
    ok: true,
    buffer: next,
    run: true,
    featureId: finalId,
    contours: [{ name: step.name }],
  };
}

export function listContourLoftBlocks(buffer) {
  return findFeatureBlocks(buffer, CONTOUR_LOFT_BEGIN, CONTOUR_LOFT_END);
}

export function hasContourLoftBlock(buffer) {
  return listContourLoftBlocks(buffer).length > 0;
}

/** The block with this id. With no id, the only block, or empty when several exist. */
export function contourLoftOwnedRegion(buffer, id = null) {
  const blocks = listContourLoftBlocks(buffer);
  if (id) return blocks.find((b) => b.id === id)?.text || '';
  return blocks.length === 1 ? blocks[0].text : '';
}

export function stripContourLoftBlock(buffer, id = null) {
  const blocks = listContourLoftBlocks(buffer);
  const hit = id
    ? blocks.find((b) => b.id === id)
    : (blocks.length === 1 ? blocks[0] : null);
  if (!hit) return String(buffer || '');
  const text = String(buffer || '');
  const after = text.slice(hit.end).replace(/^\r?\n/, '');
  const before = text.slice(0, hit.start).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

function stripContourSiblingBlocks(buffer) {
  // Feature blocks stay. A new confirm appends; the same id rewrites that block.
  return stripContourProfileBlock(buffer);
}

function _loftFramesParallel(frames) {
  const n0 = frames[0]?.normal;
  if (!n0) return false;
  const l0 = Math.hypot(n0[0], n0[1], n0[2]);
  if (!(l0 > 1e-12)) return false;
  for (let i = 1; i < frames.length; i++) {
    const n = frames[i].normal;
    const l = Math.hypot(n[0], n[1], n[2]);
    if (!(l > 1e-12)) return false;
    const dot = (n0[0] * n[0] + n0[1] * n[1] + n0[2] * n[2]) / (l0 * l);
    if (Math.abs(dot) < 0.99) return false;
  }
  return true;
}

function _loftPlaceIndex(frames, offsets) {
  if (!_loftFramesParallel(frames)) return 0;
  const n0 = frames[0].normal;
  const l0 = Math.hypot(n0[0], n0[1], n0[2]) || 1;
  const axis = [n0[0] / l0, n0[1] / l0, n0[2] / l0];
  const c0 = frames[0].center;
  let best = 0;
  let bestZ = Number(offsets[0]) || 0;
  for (let i = 1; i < frames.length; i++) {
    const z = (frames[i].center[0] - c0[0]) * axis[0]
      + (frames[i].center[1] - c0[1]) * axis[1]
      + (frames[i].center[2] - c0[2]) * axis[2]
      + (Number(offsets[i]) || 0);
    if (z < bestZ - 1e-9) {
      best = i;
      bestZ = z;
    }
  }
  return best;
}

function _namedContour(buffer, name, id) {
  if (!name && !id) return null;
  return contourStatements(String(buffer || '')).find((stmt) => (
    (name && (stmt.name === name || stmt.id === name))
    || (id && (stmt.id === id || stmt.name === id))
  )) || null;
}

function _frameFromPlaneExpr(expr) {
  const m = String(expr || '').match(
    /center:\s*\[([^\]]+)\][\s\S]*?normal:\s*\[([^\]]+)\][\s\S]*?x:\s*\[([^\]]+)\][\s\S]*?y:\s*\[([^\]]+)\]/,
  );
  if (!m) return null;
  const vec = (s) => s.split(',').map((part) => Number(part.trim()));
  const center = vec(m[1]);
  const normal = vec(m[2]);
  const x = vec(m[3]);
  const y = vec(m[4]);
  if ([...center, ...normal, ...x, ...y].some((n) => !Number.isFinite(n))) return null;
  return { center, normal, x, y };
}

function _insertBeforeReturn(buffer, blockText) {
  return insertBeforeScriptReturn(buffer, blockText, { ensureReturn: true });
}

/**
 * Confirm → a loft block that names contours.
 * Each station is an optional offset along its contour normal.
 * A new confirm appends loft2. The same featureId rewrites that block.
 * Empty buffer: `let part = placeInFrame`. Existing part: union via `part.add`.
 *
 * @returns {{ ok: true, buffer: string, run: true, featureId: string, contours: Array<{ name: string, offset: number }> } | { ok: false, message: string }}
 */
export function composeContourLoft(buffer, {
  face = null,
  loft = {},
  profiles = null,
  tool = null,
  params = null,
  combine,
  merge,
  featureId = null,
} = {}) {
  const raw = profiles || loft.profiles || defaultLoftProfiles();
  const selected = Math.max(0, Math.min(Number(loft.selected) || 0, raw.length - 1));
  const list = raw.map((p, i) => {
    const cloned = {
      ...p,
      params: { ...(p.params || {}) },
    };
    if (!profiles && i === selected && (tool || params)) {
      cloned.tool = tool || cloned.tool;
      cloned.params = { ...cloned.params, ...(params || {}) };
    }
    return cloned;
  });
  // Named stations already own their frames. Offset stays on the station.
  // Coincident numbers are not a shared-plane clash.
  const namedStations = list.length > 0 && list.every((p) => _namedContour(buffer, p.contourName, p.contourId));
  let sections;
  if (namedStations) {
    if (list.length < LOFT_MIN_PROFILES) {
      return { ok: false, message: 'makeLoft: need at least 2 profiles' };
    }
    if (list.length > LOFT_MAX_PROFILES) {
      return { ok: false, message: `makeLoft: at most ${LOFT_MAX_PROFILES} profiles in v1` };
    }
    const normalized = list.map((p) => normalizeLoftProfile(p));
    for (let i = 0; i < normalized.length; i++) {
      if (!Number.isFinite(Number(normalized[i].offset))) {
        return { ok: false, message: `makeLoft: profile ${i + 1}: offset must be finite` };
      }
    }
    sections = { normalized };
  } else {
    try {
      const built = loftSectionsForCompose(face, list);
      if (!built.ok) return built;
      sections = built;
    } catch (e) {
      return { ok: false, message: (e && e.message) || String(e) };
    }
  }

  const text = String(buffer || '');
  if (!featureMarkersBalanced(text, CONTOUR_LOFT_BEGIN, CONTOUR_LOFT_END)) {
    return {
      ok: false,
      message: 'composeContourLoft: unbalanced loft markers — refusing silent no-op.',
    };
  }

  const stripped = stripContourSiblingBlocks(buffer);
  const blocks = listContourLoftBlocks(stripped);
  const requestedId = featureId && /^[A-Za-z_$][\w$]*$/.test(String(featureId))
    ? String(featureId)
    : null;
  const existing = requestedId ? blocks.find((b) => b.id === requestedId) : null;
  const finalId = existing ? existing.id : (requestedId || mintBlockId(blocks, 'loft'));
  const prior = existing ? parseLoftReferences(existing.text) : [];
  const cardPlane = planeFromContourFace(face && face.type === 'planar' ? face : null);
  const normalized = sections.normalized;
  const planned = [];
  let next = stripped;

  for (let i = 0; i < normalized.length; i++) {
    const p = normalized[i];
    const owns = loftStationOwnsPlane(p);
    const requestedName = p.contourName || null;
    const requestedContour = p.contourId || null;
    const named = !!(requestedName || requestedContour);
    const offset = owns && !named ? 0 : (Number(p.offset) || 0);
    if (requestedName || requestedContour) {
      const stmt = contourStatements(next).find((s) => (
        (requestedName && (s.name === requestedName || s.id === requestedName))
        || (requestedContour && s.id === requestedContour)
      ));
      if (stmt) {
        const frame = _frameFromPlaneExpr(stmt.planeExpr) || (owns ? p.plane : cardPlane);
        planned.push({ name: stmt.name, offset, frame, action: 'keep' });
        continue;
      }
    }
    const prev = !requestedName && !requestedContour ? prior[i] : null;
    const frame = owns ? p.plane : cardPlane;
    const profileExpr = emitProfileExprFromParams(toolToProfileParams(p.tool, p.params));
    if (prev) {
      const stmt = contourStatements(next).find((s) => s.name === prev.name || s.id === prev.name);
      planned.push({
        name: prev.name,
        offset,
        frame,
        action: 'upsert',
        id: stmt?.id || prev.name,
        profileExpr,
      });
      continue;
    }
    planned.push({
      name: requestedName,
      offset,
      frame,
      action: 'mint',
      id: requestedContour,
      profileExpr,
    });
  }

  for (const step of planned) {
    if (step.action !== 'upsert') continue;
    const saved = upsertNamedContour(next, {
      id: step.id,
      name: step.name,
      frame: step.frame,
      profileExpr: step.profileExpr,
    });
    if (!saved.ok) return saved;
    step.name = saved.name;
    next = saved.buffer;
  }
  for (const step of planned) {
    if (step.action !== 'mint') continue;
    const block = listContourLoftBlocks(next).find((b) => b.id === finalId);
    const saved = upsertNamedContour(next, {
      id: step.id || null,
      name: step.name || null,
      frame: step.frame,
      profileExpr: step.profileExpr,
      ...(block ? { at: block.start } : {}),
    });
    if (!saved.ok) return saved;
    step.name = saved.name;
    next = saved.buffer;
  }

  const priorSolid = scriptHasPriorSolid(stripped);
  const names = declaredNames(next);
  const combineOp = solidCombineOp(combine ?? loft?.combine);
  const lines = emitLoftReferenceLines({
    begin: CONTOUR_LOFT_BEGIN,
    end: CONTOUR_LOFT_END,
    featureId: finalId,
    stations: planned.map((s) => ({ name: s.name, offset: s.offset })),
    placeIndex: _loftPlaceIndex(planned.map((s) => s.frame), planned.map((s) => s.offset)),
    partLine: (expr) => emitPartPlace(names, expr, priorSolid, priorSolid, combineOp, solidMergeOn(merge ?? loft?.merge)),
  });
  const body = lines.join('\n');
  const block = listContourLoftBlocks(next).find((b) => b.id === finalId);
  if (block) {
    let head = next.slice(0, block.start);
    let rest = next.slice(block.end);
    if (head && !head.endsWith('\n')) head = `${head}\n`;
    if (rest && !rest.startsWith('\n')) rest = `\n${rest}`;
    next = `${head}${body}${rest}`;
    if (findReturnPartIndex(next) < 0) {
      next = `${next.replace(/\s*$/, '')}\nreturn part;\n`;
    }
  } else {
    next = _insertBeforeReturn(next, body);
  }

  const owned = contourLoftOwnedRegion(next, finalId);
  const refs = parseLoftReferences(owned);
  if (refs.length < LOFT_MIN_PROFILES || !/makeLoft\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourLoft: need at least 2 contour references — refusing silent no-op.',
    };
  }
  if (!/placeInFrame\s*\(|transformByFrame\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourLoft: placeInFrame missing — refusing unscoped insert.',
    };
  }
  const placeErr = advancedPlaceError(owned, priorSolid, 'composeContourLoft', combineOp);
  if (placeErr) return { ok: false, message: placeErr };
  if (!owned.includes(`id=${finalId}`)) {
    return {
      ok: false,
      message: 'composeContourLoft: contour-mode loft markers missing — refusing unscoped insert.',
    };
  }
  if (/makeExtrude\s*\(|makeRevolve\s*\(|\bsweepPoints\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourLoft: unexpected Extrude/Revolve/Sweep in the Loft block.',
    };
  }
  if (/makeCrossSection\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourLoft: a loft block names contours — refusing an inline profile.',
    };
  }
  if (isBufferEmpty(String(buffer || '')) && /Manifold\.cube\s*\(/.test(next)) {
    return {
      ok: false,
      message: 'composeContourLoft: unexpected starter box on empty buffer — refusing extra solid.',
    };
  }
  return {
    ok: true,
    buffer: next,
    run: true,
    featureId: finalId,
    contours: planned.map((s) => ({ name: s.name, offset: s.offset })),
  };
}

export function countSweepPoints(buffer) {
  const m = String(buffer || '').match(/\bsweepPoints\s*\(/g);
  return m ? m.length : 0;
}

export function listContourSweepBlocks(buffer) {
  return findFeatureBlocks(buffer, CONTOUR_SWEEP_BEGIN, CONTOUR_SWEEP_END);
}

export function hasContourSweepBlock(buffer) {
  return listContourSweepBlocks(buffer).length > 0;
}

/** The block with this id. With no id, the only block, or empty when several exist. */
export function contourSweepOwnedRegion(buffer, id = null) {
  return _ownedFromList(listContourSweepBlocks(buffer), id);
}

export function stripContourSweepBlock(buffer, id = null) {
  return _stripFromList(buffer, listContourSweepBlocks(buffer), id);
}

/**
 * Confirm → a sweep block that names a profile contour and a path contour.
 * Reverse is baked into the path contour. The block rebuilds the wire.
 * A new confirm appends sweep2. The same featureId rewrites that block.
 * Empty buffer: `let part = placeInFrame`. Existing part: union via `part.add`.
 *
 * @returns {{ ok: true, buffer: string, run: true, featureId: string, contours: Array<{ name: string, role: string }> } | { ok: false, message: string }}
 */
export function composeContourSweep(buffer, {
  face = null,
  tool = 'circle',
  params = {},
  edges = null,
  sweep = {},
  combine,
  merge,
  featureId = null,
  contourId = null,
  contourName = null,
  pathContourId = null,
  pathContourName = null,
} = {}) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return gate;
  const pathName = pathContourName || sweep.pathContourName || null;
  const pathId = pathContourId || sweep.pathContourId || null;
  const pathStmt = _namedContour(buffer, pathName, pathId);
  let pathGate;
  let pathFrame;
  let pathUv;
  if (pathStmt) {
    pathFrame = _frameFromPlaneExpr(pathStmt.planeExpr) || planeFromContourFace(face);
    if (!pathFrame?.x) {
      return { ok: false, message: 'composeContourSweep: path has no direction.' };
    }
    // The named path stays as written. Reverse and closed are feature data.
    pathUv = [[0, 0], [1, 0]];
    pathGate = {
      ok: true,
      path: { points: [pathFrame.center, pathFrame.center], closed: false, length: 1 },
      normalized: { reverse: false },
    };
  } else {
    pathGate = validateSweepPath(edges, sweep);
    if (!pathGate.ok) return pathGate;
    pathFrame = sweepPathFrame(pathGate.path.points);
    if (!pathFrame) {
      return { ok: false, message: 'composeContourSweep: path has no direction.' };
    }
    pathUv = projectPathUv(pathGate.path.points, pathFrame);
  }
  const plane = planeFromContourFace(face);
  const text = String(buffer || '');
  if (!featureMarkersBalanced(text, CONTOUR_SWEEP_BEGIN, CONTOUR_SWEEP_END)) {
    return {
      ok: false,
      message: 'composeContourSweep: unbalanced sweep markers — refusing silent no-op.',
    };
  }

  const stripped = stripContourSiblingBlocks(buffer);
  const blocks = listContourSweepBlocks(stripped);
  const { existing, finalId } = _resolveFeatureId(blocks, featureId, 'sweep');
  const prior = existing ? parseSweepReferences(existing.text) : null;
  const profileStep = _planContourStep({
    buffer: stripped,
    requestedName: contourName || sweep.contourName || null,
    requestedContour: contourId || sweep.contourId || null,
    priorName: prior?.profile || null,
    frame: plane,
    profileExpr: emitProfileExprFromParams(toolToProfileParams(tool, params)),
  });
  const pathStep = _planContourStep({
    buffer: stripped,
    requestedName: pathContourName || sweep.pathContourName || null,
    requestedContour: pathContourId || sweep.pathContourId || null,
    priorName: prior?.path || null,
    frame: pathFrame,
    profileExpr: emitPathProfileExpr(pathUv, !!pathGate.path.closed),
  });
  const committed = _commitContourPlan(stripped, [profileStep, pathStep], finalId, listContourSweepBlocks);
  if (!committed.ok) return committed;

  const host = _placeHost(stripped, existing);
  const combineOp = solidCombineOp(combine ?? sweep?.combine);
  const block = listContourSweepBlocks(committed.buffer).find((b) => b.id === finalId);
  const names = _namesBeside(committed.buffer, block);
  const localName = allocateUniqueName(names, 'sweepLocal');
  const sweptName = allocateUniqueName(names, 'swept');
  const lines = emitSweepReferenceLines({
    begin: CONTOUR_SWEEP_BEGIN,
    end: CONTOUR_SWEEP_END,
    featureId: finalId,
    profile: profileStep.name,
    path: pathStep.name,
    localName,
    sweptName,
    reverse: !!(pathStmt && normalizeSweepParams(sweep).reverse),
    closed: pathStmt && typeof sweep.closed === 'boolean' ? !!sweep.closed : null,
    partLine: (expr) => emitPartPlace(
      names,
      expr,
      host,
      host,
      combineOp,
      solidMergeOn(merge ?? sweep?.merge),
    ),
  });
  const next = _writeFeatureBlock(committed.buffer, finalId, listContourSweepBlocks, lines.join('\n'));
  const owned = contourSweepOwnedRegion(next, finalId);
  if (!/sweepPoints\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourSweep: sweepPoints missing — refusing silent no-op.',
    };
  }
  if (!/placeInFrame\s*\(|transformByFrame\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourSweep: placeInFrame missing — refusing unscoped insert.',
    };
  }
  const placeErr = advancedPlaceError(owned, host, 'composeContourSweep', combineOp);
  if (placeErr) return { ok: false, message: placeErr };
  if (!owned.includes(`id=${finalId}`)) {
    return {
      ok: false,
      message: 'composeContourSweep: contour-mode sweep markers missing — refusing unscoped insert.',
    };
  }
  if (/makeExtrude\s*\(|makeRevolve\s*\(|makeLoft\s*\(|\bloft\s*\(|makeSweepPath\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourSweep: unexpected solid or makeSweepPath in the Sweep block.',
    };
  }
  if (/makeCrossSection\s*\(/.test(owned)) {
    return {
      ok: false,
      message: 'composeContourSweep: a sweep block names contours — refusing an inline profile.',
    };
  }
  if (isBufferEmpty(String(buffer || '')) && /Manifold\.cube\s*\(/.test(next)) {
    return {
      ok: false,
      message: 'composeContourSweep: unexpected starter box on empty buffer — refusing extra solid.',
    };
  }
  if (pathGate.normalized.reverse && pathStep.action !== 'keep') {
    const stmt = contourStatements(next).find((s) => s.name === pathStep.name);
    const origin = _frameFromPlaneExpr(stmt?.planeExpr)?.center;
    const want = pathFrame.center;
    const drifted = !origin || !want || Math.hypot(
      origin[0] - want[0],
      origin[1] - want[1],
      origin[2] - want[2],
    ) > 1e-3;
    if (drifted) {
      return {
        ok: false,
        message: 'composeContourSweep: reverse was not baked into the path contour.',
      };
    }
  }
  return {
    ok: true,
    buffer: next,
    run: true,
    featureId: finalId,
    contours: [
      { name: profileStep.name, role: 'profile' },
      { name: pathStep.name, role: 'path' },
    ],
  };
}

/**
 * Confirm router: Extrude / Revolve / Loft / Sweep entry → solid; Profile stays Profile-only.
 */
/**
 * Workplane Confirm — marked PlaneFrame literal (construction plane).
 * Face / preset / angles / offset are already baked into payload.face.planeFrame.
 */
export function composeContourWorkplane(buffer, payload = {}) {
  const face = payload.face || null;
  const composed = composeHelperInsert(buffer || '', 'workplane', null, {}, face);
  if (composed == null) {
    return { ok: false, message: 'composeContourWorkplane: insert refused' };
  }
  return { ok: true, buffer: composed, run: false };
}

/**
 * New contour on a Sweep path slot. The drawn profile becomes a path
 * contour (UV ring, closed when the profile is a loop). It does not
 * write a solid.
 */
export function composePathContour(buffer, {
  face = null,
  tool = 'circle',
  params = {},
} = {}) {
  const gate = validateContourProfile(tool, params);
  if (!gate.ok) return gate;
  let ring;
  try {
    ring = buildProfileFromParams(toolToProfileParams(tool, params)).contours?.[0];
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
  if (!ring || ring.length < 2) {
    return { ok: false, message: 'composePathContour: path needs at least 2 points' };
  }
  let pts = ring.map((p) => [Number(p[0]), Number(p[1])]);
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts = pts.slice(0, -1);
  }
  if (pts.length < 2) {
    return { ok: false, message: 'composePathContour: path needs at least 2 points' };
  }
  const saved = upsertNamedContour(buffer, {
    frame: planeFromContourFace(face && face.type === 'planar' ? face : null),
    profileExpr: emitPathProfileExpr(pts, pts.length >= 3),
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    buffer: saved.buffer,
    contourId: saved.id,
    contourName: saved.name,
    run: false,
  };
}

export function composeContourCommit(buffer, payload = {}) {
  const entry = payload.entry || 'crossSection';
  if (payload.saveAsPath) {
    return composePathContour(buffer, payload);
  }
  if (isWorkplaneEntry(entry)) {
    return composeContourWorkplane(buffer, payload);
  }
  if (isExtrudeEntry(entry)) {
    return composeContourExtrude(buffer, payload);
  }
  if (isRevolveEntry(entry)) {
    return composeContourRevolve(buffer, payload);
  }
  if (isLoftEntry(entry)) {
    return composeContourLoft(buffer, payload);
  }
  if (isSweepEntry(entry)) {
    return composeContourSweep(buffer, payload);
  }
  const result = composeContourProfile(buffer, payload);
  if (result.ok) result.run = false;
  return result;
}
