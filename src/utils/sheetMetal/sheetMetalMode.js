/**
 * Sheet-metal mode state (Viewport). Pure transitions so goldens can drive it.
 *
 * stage 'plane' — planes highlighted; tap one (or a Top/Front/Right button)
 * stage 'base'  — base-flange popup: width × height; Accept / Back / ✕
 * stage 'edit'  — spec committed; edges / features (S3+)
 *
 * mode = { stage, sku (S1 record), partId, spec, base?: { plane, width, height } }
 */
import {
  createSheetSpec,
  normalizeSheetSpec,
  bendDefaults,
  bendLimits,
  panelById,
  panelEdge,
  panelLocal,
  respecSheetSku,
  sheetFeatureId,
  sheetFreeEdges,
  solveSheet,
  SHEET_PLANES,
  IN,
} from './sheetModel.js';
import { bendInterference } from './sheetInterference.js';
import { REFERENCE_LENGTH_MM } from '../characteristicLength.js';
import { FASTENER_METRIC, FASTENER_UNC } from '../../workers/fastenerSizes.js';

export const BASE_DEFAULTS = Object.freeze({ width: 100, height: 60 });
export const BASE_MIN = 1;
export const BASE_MAX = 1200;

const round2 = (n) => Math.round(n * 100) / 100;

/** Empty or degenerate parts use the 100 mm reference. */
function sheetLength(lengthMm) {
  const n = Number(lengthMm);
  return Number.isFinite(n) && n > 0 ? n : REFERENCE_LENGTH_MM;
}

/** Inches pair → sorted [smaller, larger] mm, or null. */
function sortedPairMm(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const a = Number(pair[0]);
  const b = Number(pair[1]);
  if (!(a > 0) || !(b > 0)) return null;
  const mm = [a, b].map((n) => Math.round(n * IN * 1000) / 1000).sort((x, y) => x - y);
  return mm;
}

/**
 * SKU floors for the two base axes, in millimetres. The longer minimum
 * (flat part size, then cutting minimum) maps to width. Zero when the SKU
 * has no floor.
 */
export function skuAxisFloors(rec) {
  let height = 0;
  let width = 0;
  const raise = (pair) => {
    const min = sortedPairMm(pair);
    if (!min) return;
    height = Math.max(height, min[0]);
    width = Math.max(width, min[1]);
  };
  raise(rec?.bend?.minFlatIn);
  raise(rec?.minPartIn);
  return { width, height };
}

/**
 * Slider ends for the base flange. The thumb runs from the SKU floor (else
 * 1 mm) to 1200 mm. The hard cap is the thumb, not only a caption.
 */
export function baseSliderRange(rec) {
  const floors = skuAxisFloors(rec);
  return {
    widthMin: floors.width > 0 ? floors.width : BASE_MIN,
    heightMin: floors.height > 0 ? floors.height : BASE_MIN,
    max: BASE_MAX,
  };
}

/**
 * Base-flange seeds. Width is `max(L, the longer SKU minimum)`, height is
 * `max(0.60 L, the shorter)`. At L=100 that is 100×60 unless the SKU is
 * larger. The 1200 mm cap wins after the SKU floor. Result is millimetres.
 * Omit `lengthMm` (the script starter) and L stays the 100 mm reference.
 */
export function defaultBaseDims(rec, lengthMm = REFERENCE_LENGTH_MM) {
  const L = sheetLength(lengthMm);
  const floors = skuAxisFloors(rec);
  return {
    width: round2(Math.min(BASE_MAX, Math.max(L, floors.width))),
    height: round2(Math.min(BASE_MAX, Math.max(0.6 * L, floors.height))),
  };
}

/** Start designing. An existing sheet spec on the part skips straight to edit. */
export function enterSheetMetalMode(record, partId = null, existingSpec = null) {
  if (!record?.sku) return null;
  const spec = normalizeSheetSpec(existingSpec);
  if (spec) {
    return { stage: 'edit', sku: record, partId: partId ?? null, spec: respecSheetSku(spec, record), tool: defaultTool(record) };
  }
  return { stage: 'plane', sku: record, partId: partId ?? null, spec: null, base: null };
}

/**
 * Gauge line for a saved spec. The ribbon reopen does not have the live
 * catalog record; thickness comes from the spec, and inch/gauge from the
 * part binding when the SKU matches. Both numbers are always finite so
 * `scsGaugeLabel` can render.
 */
export function skuFromSheetSpec(spec, binding = null) {
  const clean = normalizeSheetSpec(spec) || spec || {};
  const t = Number(clean.t);
  const thicknessMm = Number.isFinite(t) && t > 0 ? t : null;
  const bound = binding?.sku && clean.sku && binding.sku === clean.sku ? binding : null;
  const boundIn = Number(bound?.thicknessIn);
  const thicknessIn = Number.isFinite(boundIn) && boundIn > 0
    ? boundIn
    : (thicknessMm ? thicknessMm / IN : null);
  const mm = thicknessMm || (thicknessIn ? thicknessIn * IN : null);
  return {
    sku: bound?.sku || clean.sku || '',
    name: bound?.name || clean.material || clean.sku || 'Sheet',
    bendable: !!clean.limits?.bendable,
    thicknessMm: mm,
    thicknessIn,
    gauge: bound?.gauge ?? null,
    services: Array.isArray(clean.limits?.services) ? [...clean.limits.services] : [],
  };
}

/** Bends + tabs + holes on the spec currently shown. */
export function sheetStepCount(spec) {
  if (!spec) return 0;
  return (spec.bends?.length || 0) + (spec.tabs?.length || 0) + (spec.holes?.length || 0);
}

/**
 * One spec per committed step, blank first. Bends replay in array order
 * (parent before child). Tabs and holes follow, each waiting until its
 * panel exists. The last step is the saved spec, so Confirm with no undo
 * is byte-identical.
 */
export function sheetStepHistory(spec) {
  const clean = normalizeSheetSpec(spec);
  if (!clean) return [];
  const blank = { ...clean, bends: [], tabs: [], holes: [] };
  const pending = [
    ...(clean.bends || []).map((f) => ({ key: 'bends', f })),
    ...(clean.tabs || []).map((f) => ({ key: 'tabs', f })),
    ...(clean.holes || []).map((f) => ({ key: 'holes', f })),
  ];
  const steps = [blank];
  let cur = blank;
  const placed = new Set(['base']);
  const take = (idx) => {
    const item = pending.splice(idx, 1)[0];
    cur = { ...cur, [item.key]: [...(cur[item.key] || []), item.f] };
    steps.push(cur);
    if (item.key === 'bends') placed.add(item.f.id);
  };
  let guard = pending.length * pending.length + 1;
  while (pending.length && guard-- > 0) {
    const idx = pending.findIndex((item) => placed.has(item.f.panel || 'base'));
    if (idx < 0) break;
    take(idx);
  }
  while (pending.length) take(0);
  if (steps.length > 1) steps[steps.length - 1] = clean;
  else steps[0] = clean;
  return steps;
}

/**
 * Ribbon reopen: last committed screen (edit), saved blank + bends +
 * features, and a step index at the end of that history. Writes wait
 * for Confirm.
 */
export function reopenSheetMetalMode(spec, partId = null, binding = null) {
  const clean = normalizeSheetSpec(spec);
  if (!clean) return null;
  const history = sheetStepHistory(clean);
  const sku = skuFromSheetSpec(clean, binding);
  return {
    stage: 'edit',
    sku,
    partId: partId ?? null,
    spec: history[history.length - 1] || clean,
    tool: defaultTool(sku),
    history,
    step: Math.max(0, history.length - 1),
    reopen: true,
  };
}

export function defaultTool(record) {
  return record?.bendable ? 'bend' : 'tab';
}

export function pickSheetPlane(mode, planeId, lengthMm = REFERENCE_LENGTH_MM) {
  if (!mode || mode.stage !== 'plane' || !SHEET_PLANES[planeId]) return mode;
  const prev = mode.base || {};
  const dims = defaultBaseDims(mode.sku, lengthMm);
  return {
    ...mode,
    stage: 'base',
    base: {
      plane: planeId,
      width: prev.width ?? dims.width,
      height: prev.height ?? dims.height,
    },
  };
}

export function setBaseDims(mode, patch) {
  if (!mode || mode.stage !== 'base' || !mode.base) return mode;
  const ends = baseSliderRange(mode.sku);
  const clampDim = (n, fallback, lo) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(BASE_MAX, Math.max(lo, v));
  };
  const base = { ...mode.base };
  if (patch?.width !== undefined && patch.width !== '') base.width = clampDim(patch.width, base.width, ends.widthMin);
  if (patch?.height !== undefined && patch.height !== '') base.height = clampDim(patch.height, base.height, ends.heightMin);
  return { ...mode, base };
}

/** Back from the base popup: one tap re-enters plane pick (dims kept). */
export function backToPlanePick(mode) {
  if (!mode || mode.stage !== 'base') return mode;
  return { ...mode, stage: 'plane' };
}

/** Spec the base popup is previewing (base flange at SKU thickness). */
export function baseDraftSpec(mode) {
  if (!mode?.base) return null;
  return createSheetSpec(mode.sku, mode.base.plane, mode.base);
}

/** Accept the base flange → { mode (edit), spec to commit }. */
export function acceptBaseFlange(mode) {
  const spec = baseDraftSpec(mode);
  if (!spec) return { mode, spec: null };
  return { mode: { ...mode, stage: 'edit', spec, base: null, tool: defaultTool(mode.sku) }, spec };
}

// ---------------------------------------------------------------- S3 bends
// Draft = the one feature the popup is editing ({ kind, id, isNew, … }).
// The overlay previews `draftPreviewSpec(mode)`; Accept commits it.

export { bendDefaults, bendLimits };

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

export function startBendDraft(mode, { panel, edge }) {
  if (!mode?.spec || mode.stage !== 'edit') return mode;
  if (!mode.spec.limits?.bendable) {
    return { ...mode, toast: 'This SKU has no bending service — use Tab or pick a bendable gauge.' };
  }
  const edgeRow = sheetFreeEdges(mode.spec).find((e) => e.panel === panel && e.edge === edge);
  // Ineligible edges are dimmed and carry no pick handle. A stray tap does not open a draft.
  if (!edgeRow?.eligible) return mode;
  const id = sheetFeatureId('b', mode.spec);
  return {
    ...mode,
    toast: null,
    hotEdge: { panel, edge },
    draft: { kind: 'bend', id, isNew: true, panel, edge, ...bendDefaults(mode.spec, panel, edge) },
  };
}

/**
 * Why the bend currently in the popup cannot be confirmed.
 * Flat overlap and the swept fold (not only the finished pose) both block.
 * Null when the draft is not a bend or the bend is clear.
 */
export function bendBlockReason(mode) {
  if (mode?.draft?.kind !== 'bend' || !mode.spec) return null;
  const spec = draftPreviewSpec(mode);
  const edges = draftEdgeRows(mode.draft);
  const ids = edges.length ? edges.map((edge) => edge.id) : [mode.draft.id];
  for (const id of ids) {
    const hit = bendInterference(spec, id);
    if (!hit.ok) return hit.reason;
  }
  return null;
}

export function editFeatureDraft(mode, kind, id) {
  if (!mode?.spec || mode.stage !== 'edit') return mode;
  const list = kind === 'bend' ? mode.spec.bends : kind === 'tab' ? mode.spec.tabs : mode.spec.holes;
  const found = (list || []).find((f) => f.id === id);
  if (!found) return mode;
  const draft = { kind, isNew: false, ...found };
  if (kind === 'tab') {
    const p = panelById(solveSheet(mode.spec), found.panel);
    const ef = p ? panelEdge(p, found.edge) : null;
    if (ef) draft.span = round2(ef.q1 - ef.q0);
  }
  return { ...mode, toast: null, hotEdge: found.edge ? { panel: found.panel, edge: found.edge } : null, draft };
}

/** Popup edits, clamped to the SKU. */
export function updateDraft(mode, patch) {
  if (!mode?.draft) return mode;
  const d = { ...mode.draft };
  if (d.kind === 'base') {
    const ends = baseSliderRange(mode.sku);
    const clampDim = (n, fallback, lo) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return fallback;
      return Math.min(BASE_MAX, Math.max(lo, v));
    };
    if (patch?.width !== undefined && patch.width !== '') d.width = clampDim(patch.width, d.width, ends.widthMin);
    if (patch?.height !== undefined && patch.height !== '') d.height = clampDim(patch.height, d.height, ends.heightMin);
    if (patch?.plane && SHEET_PLANES[patch.plane]) d.plane = patch.plane;
  } else if (d.kind === 'bend') {
    const lim = bendLimits(mode.spec);
    if (patch.angle !== undefined && patch.angle !== '') d.angle = clamp(patch.angle, lim.angleMin, lim.angleMax, d.angle);
    if (patch.length !== undefined && patch.length !== '') d.length = clamp(patch.length, lim.lengthMin, Math.max(lim.lengthMax, d.length), d.length);
    if (patch.flip !== undefined) d.flip = !!patch.flip;
  } else if (d.kind === 'tab') {
    const span = Number(d.span) || 1e4;
    if (patch.width !== undefined && patch.width !== '') d.width = clamp(patch.width, 1, span, d.width);
    if (patch.depth !== undefined && patch.depth !== '') d.depth = clamp(patch.depth, 0.5, 1000, d.depth);
    if (patch.centered !== undefined) d.centered = !!patch.centered;
    if (patch.offset !== undefined && patch.offset !== '') d.offset = clamp(patch.offset, 0, Math.max(0, span - d.width), d.offset);
    if (d.offset > span - d.width) d.offset = Math.max(0, round2(span - d.width));
  } else if (d.kind === 'hole') {
    if (patch.u !== undefined && patch.u !== '') d.u = clamp(patch.u, -1e4, 1e4, d.u);
    if (patch.v !== undefined && patch.v !== '') d.v = clamp(patch.v, -1e4, 1e4, d.v);
    if (patch.d !== undefined && patch.d !== '') d.d = clamp(patch.d, 0.1, 500, d.d);
    if (patch.thread !== undefined) {
      const size = TAP_SIZES.find((x) => x.id === patch.thread);
      if (size) {
        d.thread = size.id;
        d.d = size.tap;
      }
    }
    if (patch.cskDia !== undefined && patch.cskDia !== '') d.cskDia = clamp(patch.cskDia, d.d, 500, d.cskDia);
  }
  return { ...mode, draft: d };
}

function featureFromDraft(d) {
  const { kind: _k, isNew: _n, span: _s, edges: _e, memberIds: _m, ...rest } = d;
  return rest;
}

/** One row per selected edge. A single new edge has no `edges` list. */
function draftEdgeRows(draft) {
  if (!draft) return [];
  if (Array.isArray(draft.edges) && draft.edges.length) return draft.edges;
  return [];
}

function bendRow(draft, edge) {
  const row = {
    id: edge.id,
    panel: edge.panel,
    edge: edge.edge,
    angle: draft.angle,
    length: draft.length,
    flip: !!draft.flip,
  };
  if (draft.feature) row.feature = draft.feature;
  return row;
}

function tabRow(draft, edge) {
  const span = Number(edge.span) || Number(draft.span) || 0;
  const width = span > 0 ? Math.min(Number(draft.width) || 0, span) : draft.width;
  const centered = draft.centered !== false;
  const offset = centered
    ? round2(Math.max(0, (span - width) / 2))
    : clamp(draft.offset ?? 0, 0, Math.max(0, span - width), 0);
  const row = {
    id: edge.id,
    panel: edge.panel,
    edge: edge.edge,
    width,
    depth: draft.depth,
    centered,
    offset,
  };
  if (draft.feature) row.feature = draft.feature;
  return row;
}

function replaceRows(list, rows) {
  const next = [...(list || [])];
  for (const row of rows) {
    const at = next.findIndex((item) => item.id === row.id);
    if (at >= 0) next[at] = row;
    else next.push(row);
  }
  return next;
}

/** Spec with the draft applied (preview + Accept). */
export function draftPreviewSpec(mode) {
  const spec = mode?.spec;
  const d = mode?.draft;
  if (!spec || !d) return spec || null;
  if (d.kind === 'base') {
    return { ...spec, plane: d.plane || spec.plane, width: d.width, height: d.height };
  }
  const edges = draftEdgeRows(d);
  if (edges.length && (d.kind === 'bend' || d.kind === 'tab')) {
    const key = d.kind === 'bend' ? 'bends' : 'tabs';
    const rows = edges.map((edge) => (d.kind === 'bend' ? bendRow(d, edge) : tabRow(d, edge)));
    return { ...spec, [key]: replaceRows(spec[key], rows) };
  }
  const key = d.kind === 'bend' ? 'bends' : d.kind === 'tab' ? 'tabs' : 'holes';
  const list = [...(spec[key] || [])];
  const feat = featureFromDraft(d);
  const at = list.findIndex((f) => f.id === d.id);
  if (at >= 0) list[at] = feat;
  else list.push(feat);
  return { ...spec, [key]: list };
}

/** Patch width, height, and plane onto the open sheet. Bends, tabs, and holes stay. */
export function acceptBaseEdit(mode) {
  const d = mode?.draft;
  if (!d || d.kind !== 'base' || !mode.spec) return { mode, spec: null };
  const spec = draftPreviewSpec(mode);
  return { mode: { ...mode, spec, draft: null, hotEdge: null, toast: null }, spec };
}

export function acceptDraft(mode) {
  if (!mode?.draft) return { mode, spec: null };
  if (mode.draft.kind === 'base') return acceptBaseEdit(mode);
  if (bendBlockReason(mode)) return { mode, spec: null };
  const spec = draftPreviewSpec(mode);
  return { mode: { ...mode, spec, draft: null, hotEdge: null, toast: null }, spec };
}

/**
 * Open the base flange card without leaving edit, so the ribbon stays the
 * full chip list. Confirm patches the flange; it does not mint a new spec.
 */
export function editBaseDraft(mode) {
  if (!mode?.spec || mode.stage !== 'edit') return mode;
  const spec = mode.spec;
  return {
    ...mode,
    toast: null,
    exportOpen: false,
    hotEdge: null,
    draft: {
      kind: 'base',
      id: 'base',
      isNew: false,
      memberIds: ['base'],
      plane: spec.plane,
      width: spec.width,
      height: spec.height,
    },
  };
}

/** Ribbon chip → the base, bend, or tab card. Other chips are not sheets. */
export function editSheetChip(mode, chip) {
  if (!mode || mode.stage !== 'edit' || !chip?.sheet) return mode;
  if (chip.sheetKind === 'base') return editBaseDraft(mode);
  if (chip.sheetKind !== 'bend' && chip.sheetKind !== 'tab') return mode;
  const id = chip.memberIds?.[0];
  if (!id) return mode;
  const next = editFeatureDraft(mode, chip.sheetKind, id);
  if (next === mode || !next?.draft) return mode;
  const memberIds = (chip.memberIds || []).filter(Boolean);
  const ids = memberIds.length ? memberIds : [id];
  const draft = { ...next.draft, memberIds: ids };
  if (ids.length > 1) {
    const list = chip.sheetKind === 'bend' ? next.spec.bends : next.spec.tabs;
    const edges = ids.map((memberId) => {
      const row = (list || []).find((item) => item.id === memberId);
      if (!row) return null;
      const edge = { id: row.id, panel: row.panel, edge: row.edge };
      if (chip.sheetKind === 'tab') {
        const panel = panelById(solveSheet(next.spec), row.panel);
        const frame = panel ? panelEdge(panel, row.edge) : null;
        if (frame) edge.span = round2(frame.q1 - frame.q0);
      }
      return edge;
    }).filter(Boolean);
    draft.edges = edges;
    draft.feature = next.draft.feature || chip.feature || null;
    if (chip.sheetKind === 'tab' && edges.length) {
      const spans = edges.map((edge) => Number(edge.span) || 0).filter((n) => n > 0);
      if (spans.length) {
        draft.span = Math.min(...spans);
        if (draft.width > draft.span) draft.width = draft.span;
      }
    }
  }
  return { ...next, exportOpen: false, draft };
}

/** Append one committed spec. Steps after the current index are dropped. */
export function pushSheetHistory(mode, spec) {
  if (!mode || !spec) return mode;
  const hist = Array.isArray(mode.history) ? mode.history : [];
  const step = Number.isInteger(mode.step) ? mode.step : Math.max(0, hist.length - 1);
  const history = [...hist.slice(0, step + 1), spec];
  return {
    ...mode,
    spec,
    history,
    step: history.length - 1,
    draft: null,
    hotEdge: null,
    toast: null,
  };
}

/**
 * Pop one bend or feature. The blank (step 0) stays put — undo does not
 * exit the flow. A no-op returns the same mode.
 */
export function undoSheetStep(mode) {
  if (!mode?.reopen || !Array.isArray(mode.history)) return mode;
  if (mode.draft || mode.exportOpen) return mode;
  if (!(mode.step > 0)) return mode;
  const step = mode.step - 1;
  return {
    ...mode,
    step,
    spec: mode.history[step],
    draft: null,
    hotEdge: null,
    toast: null,
  };
}

/** Back from a feature popup: drop the draft, stay in edge / face pick. */
export function cancelDraft(mode) {
  if (!mode) return mode;
  return { ...mode, draft: null, hotEdge: null, toast: null };
}

function draftMembers(draft) {
  const ids = Array.isArray(draft?.memberIds) ? draft.memberIds.filter(Boolean) : [];
  if (!ids.length && draft?.id) ids.push(draft.id);
  return ids;
}

/** The draft rows plus every bend that hangs off them. */
function bendDeleteClosure(spec, roots) {
  const gone = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const bend of spec?.bends || []) {
      if (!gone.has(bend.id) && gone.has(bend.panel)) {
        gone.add(bend.id);
        grew = true;
      }
    }
  }
  return gone;
}

/**
 * Features a delete would take besides the chip itself.
 * A bend counts child bends, tabs, and holes. A base counts every bend,
 * tab, and hole. The chip's own rows are not counted. A new draft, a tab,
 * or a hole is 0. A contour refKey is not a user and is not counted.
 */
export function sheetDraftExtraCount(mode) {
  const d = mode?.draft;
  if (!d || d.isNew || !mode.spec) return 0;
  const spec = mode.spec;
  if (d.kind === 'base') {
    return (spec.bends?.length || 0) + (spec.tabs?.length || 0) + (spec.holes?.length || 0);
  }
  if (d.kind !== 'bend') return 0;
  const roots = new Set(draftMembers(d));
  const gone = bendDeleteClosure(spec, roots);
  let extra = 0;
  for (const bend of spec.bends || []) {
    if (gone.has(bend.id) && !roots.has(bend.id)) extra += 1;
  }
  for (const tab of spec.tabs || []) {
    if (gone.has(tab.panel)) extra += 1;
  }
  for (const hole of spec.holes || []) {
    if (gone.has(hole.panel)) extra += 1;
  }
  return extra;
}

/**
 * Delete the edited chip. A bend takes its flange's children. A grouped
 * chip drops every member id. Base removes the whole sheet (`removeBlock`).
 */
export function deleteDraftFeature(mode) {
  const d = mode?.draft;
  if (!d || d.isNew) return { mode: cancelDraft(mode), spec: null, removeBlock: false };
  if (d.kind === 'base') {
    return {
      mode: { ...mode, spec: null, draft: null, hotEdge: null, toast: null },
      spec: null,
      removeBlock: true,
    };
  }
  const spec = mode.spec;
  if (!spec) return { mode: cancelDraft(mode), spec: null, removeBlock: false };
  const members = new Set(draftMembers(d));
  const gone = d.kind === 'bend' ? bendDeleteClosure(spec, members) : new Set();
  const next = {
    ...spec,
    bends: (spec.bends || []).filter((b) => (d.kind === 'bend' ? !gone.has(b.id) : true)),
    tabs: (spec.tabs || []).filter((tb) => !(d.kind === 'tab' && members.has(tb.id)) && !gone.has(tb.panel)),
    holes: (spec.holes || []).filter((h) => !(d.kind === 'hole' && members.has(h.id)) && !gone.has(h.panel)),
  };
  return {
    mode: { ...mode, spec: next, draft: null, hotEdge: null },
    spec: next,
    removeBlock: false,
  };
}

function mintSheetId(prefix, spec, reserved = []) {
  const taken = new Set(reserved.filter(Boolean));
  for (const row of [...(spec?.bends || []), ...(spec?.tabs || []), ...(spec?.holes || [])]) {
    if (row?.id) taken.add(row.id);
    if (row?.feature) taken.add(String(row.feature));
  }
  for (let i = 1; i < 10000; i += 1) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}x${Date.now()}`;
}

function freeEdge(spec, panel, edge) {
  return sheetFreeEdges(spec).find((row) => row.panel === panel && row.edge === edge) || null;
}

function edgeSpan(spec, panel, edge) {
  const panelRow = panelById(solveSheet(spec), panel);
  const frame = panelRow ? panelEdge(panelRow, edge) : null;
  if (!frame) return 0;
  return round2(frame.q1 - frame.q0);
}

function bendSelection(mode, edges, shared) {
  const first = edges[0];
  const feature = edges.length > 1
    ? (shared.feature || mintSheetId('f', mode.spec, edges.map((edge) => edge.id)))
    : null;
  return {
    ...mode,
    toast: null,
    hotEdge: { panel: first.panel, edge: first.edge },
    draft: {
      kind: 'bend',
      isNew: true,
      id: first.id,
      panel: first.panel,
      edge: first.edge,
      angle: shared.angle,
      length: shared.length,
      flip: !!shared.flip,
      ...(feature ? { feature, edges } : {}),
    },
  };
}

function tabSelection(mode, edges, shared) {
  const first = edges[0];
  const spans = edges.map((edge) => Number(edge.span) || 0).filter((n) => n > 0);
  const span = spans.length ? Math.min(...spans) : (Number(shared.span) || 0);
  const width = span > 0 ? Math.min(Number(shared.width) || span, span) : shared.width;
  const feature = edges.length > 1
    ? (shared.feature || mintSheetId('f', mode.spec, edges.map((edge) => edge.id)))
    : null;
  return {
    ...mode,
    toast: null,
    hotEdge: { panel: first.panel, edge: first.edge },
    draft: {
      kind: 'tab',
      isNew: true,
      id: first.id,
      panel: first.panel,
      edge: first.edge,
      width,
      depth: shared.depth,
      centered: shared.centered !== false,
      offset: shared.offset ?? 0,
      span,
      ...(feature ? { feature, edges } : {}),
    },
  };
}

/** Add or remove one eligible edge on the open new bend. The last edge closes the card. */
export function toggleBendEdge(mode, pick) {
  if (!mode?.spec || mode.stage !== 'edit') return mode;
  if (mode.draft && (!mode.draft.isNew || mode.draft.kind !== 'bend')) return mode;
  const panel = pick?.panel;
  const edge = pick?.edge;
  if (!panel || !edge) return mode;
  if (!mode.draft) return startBendDraft(mode, pick);
  const current = draftEdgeRows(mode.draft);
  const edges = current.length
    ? current
    : [{ id: mode.draft.id, panel: mode.draft.panel, edge: mode.draft.edge }];
  const at = edges.findIndex((row) => row.panel === panel && row.edge === edge);
  if (at >= 0) {
    const next = edges.filter((_, index) => index !== at);
    if (!next.length) return cancelDraft(mode);
    return bendSelection(mode, next, mode.draft);
  }
  const row = freeEdge(mode.spec, panel, edge);
  if (!row?.eligible) return mode;
  const id = mintSheetId('b', mode.spec, edges.map((item) => item.id));
  return bendSelection(mode, [...edges, { id, panel, edge }], mode.draft);
}

/** Add or remove one tabbable edge on the open new tab. The last edge closes the card. */
export function toggleTabEdge(mode, pick, lengthMm = REFERENCE_LENGTH_MM) {
  if (!mode?.spec || mode.stage !== 'edit') return mode;
  if (mode.draft && (!mode.draft.isNew || mode.draft.kind !== 'tab')) return mode;
  const panel = pick?.panel;
  const edge = pick?.edge;
  if (!panel || !edge) return mode;
  if (!mode.draft) return startTabDraft(mode, pick, lengthMm);
  const current = draftEdgeRows(mode.draft);
  const edges = current.length
    ? current
    : [{ id: mode.draft.id, panel: mode.draft.panel, edge: mode.draft.edge, span: mode.draft.span }];
  const at = edges.findIndex((row) => row.panel === panel && row.edge === edge);
  if (at >= 0) {
    const next = edges.filter((_, index) => index !== at);
    if (!next.length) return cancelDraft(mode);
    return tabSelection(mode, next, mode.draft);
  }
  const row = freeEdge(mode.spec, panel, edge);
  if (!row?.tabbable) return mode;
  const id = mintSheetId('t', mode.spec, edges.map((item) => item.id));
  const span = edgeSpan(mode.spec, panel, edge);
  return tabSelection(mode, [...edges, { id, panel, edge, span }], mode.draft);
}

/**
 * Viewport tap router (pick = sheetPickFromHits result, point in part frame).
 * plane → base popup; edge → toggle into the open bend or tab; feature → edit.
 * A new bend or tab keeps taking edges. An edit card does not.
 */
export function sheetTap(mode, pick, lengthMm = REFERENCE_LENGTH_MM) {
  if (!mode || !pick) return mode;
  if (mode.stage === 'plane') return pick.kind === 'plane' ? pickSheetPlane(mode, pick.plane, lengthMm) : mode;
  if (mode.stage !== 'edit' || mode.exportOpen) return mode;
  if (pick.kind === 'edge') {
    if (mode.draft && !mode.draft.isNew) return mode;
    if (mode.tool === 'bend') return toggleBendEdge(mode, pick);
    if (mode.tool === 'tab') return toggleTabEdge(mode, pick, lengthMm);
    return mode;
  }
  if (mode.draft) return mode;
  if (pick.kind === 'bend' || pick.kind === 'tab' || pick.kind === 'hole') return editFeatureDraft(mode, pick.kind, pick.id);
  if (pick.kind === 'panel' && HOLE_TOOLS.has(mode.tool)) return startHoleDraft(mode, pick, lengthMm);
  return mode;
}

// ---------------------------------------------------------------- S4 tools
// The sheet rail lists only what SendCutSend can make on this SKU, Tab first.

export const SHEET_TOOLS = Object.freeze([
  { id: 'tab', label: 'Tab', title: 'Tab — extend an edge in-plane', service: null },
  { id: 'bend', label: 'Bend', title: 'Bend — tap an edge to fold a flange', service: 'bending' },
  { id: 'hole', label: 'Hole', title: 'Hole — tap a face to cut a round hole', service: null },
  { id: 'countersink', label: 'Csk', title: 'Countersunk hole (SCS countersinking)', service: 'countersinking' },
  { id: 'tapped', label: 'Tap', title: 'Tapped hole (SCS tapping)', service: 'tapping' },
]);
const HOLE_TOOLS = new Set(['hole', 'countersink', 'tapped']);

/** Tools available for a spec: no-service tools always; others need the SKU service. */
export function sheetToolsFor(spec) {
  const services = new Set(spec?.limits?.services || []);
  return SHEET_TOOLS.filter((tool) => {
    if (tool.id === 'bend') return !!spec?.limits?.bendable && services.has('bending');
    return !tool.service || services.has(tool.service);
  });
}

export function setSheetTool(mode, tool) {
  if (!mode || mode.stage !== 'edit' || mode.exportOpen) return mode;
  if (!sheetToolsFor(mode.spec).some((t) => t.id === tool)) return mode;
  return { ...mode, tool, draft: null, hotEdge: null, toast: null };
}

/**
 * Tab seeds. Width is the smaller of 0.25 L and 40% of the edge (at least
 * 1 mm, and not past the edge). Depth is 0.10 L (at least 0.5 mm). At L=100
 * that is the old 25 mm cap and 10 mm depth.
 */
export function tabDraftSize(span, lengthMm = REFERENCE_LENGTH_MM) {
  const L = sheetLength(lengthMm);
  const edge = Number(span) > 0 ? Number(span) : 0;
  const width = round2(Math.max(1, Math.min(edge || 1, Math.min(0.25 * L, edge * 0.4))));
  const depth = round2(Math.max(0.5, 0.1 * L));
  return { width, depth };
}

/** Hole Ø seed: the larger of 0.05 L and 2× the SKU minimum. 5 mm at L=100. */
export function holeDraftDiameter(minHole, lengthMm = REFERENCE_LENGTH_MM) {
  const L = sheetLength(lengthMm);
  const floor = Number(minHole) > 0 ? Number(minHole) : 1;
  return round2(Math.max(0.05 * L, floor * 2));
}

/** Tab defaults: Centered on. Width and depth scale with L, then the edge caps width. */
export function startTabDraft(mode, { panel, edge }, lengthMm = REFERENCE_LENGTH_MM) {
  if (!mode?.spec || mode.stage !== 'edit') return mode;
  const solved = solveSheet(mode.spec);
  const p = panelById(solved, panel);
  if (!p) return mode;
  const ef = panelEdge(p, edge);
  const span = ef.q1 - ef.q0;
  const { width, depth } = tabDraftSize(span, lengthMm);
  return {
    ...mode,
    toast: null,
    hotEdge: { panel, edge },
    draft: {
      kind: 'tab',
      id: sheetFeatureId('t', mode.spec),
      isNew: true,
      panel,
      edge,
      width,
      depth,
      centered: true,
      offset: round2((span - width) / 2),
      span: round2(span),
    },
  };
}

/** Tapped-hole sizes SCS taps (metric + UNC), tap-drill Ø in mm. */
export const TAP_SIZES = Object.freeze([
  ...['M2_5', 'M3', 'M4', 'M5', 'M6', 'M8'].map((k) => ({ id: k.replace('_', '.'), tap: FASTENER_METRIC[k].tap })),
  ...['#4-40', '#6-32', '#8-32', '#10-32', '1/4-20'].map((k) => ({ id: k, tap: FASTENER_UNC[k].tap })),
]);

/** Hole at the tapped point of a panel face. */
export function startHoleDraft(mode, { panel, point }, lengthMm = REFERENCE_LENGTH_MM) {
  if (!mode?.spec || mode.stage !== 'edit' || !Array.isArray(point)) return mode;
  const solved = solveSheet(mode.spec);
  const p = panelById(solved, panel);
  if (!p) return mode;
  const [u, v] = panelLocal(p, point);
  const minHole = Number(mode.spec.limits?.minHole) || 1;
  const kind = mode.tool;
  const thread = kind === 'tapped' ? 'M4' : null;
  const d = kind === 'tapped'
    ? TAP_SIZES.find((x) => x.id === thread).tap
    : holeDraftDiameter(minHole, lengthMm);
  return {
    ...mode,
    toast: null,
    draft: {
      kind: 'hole',
      id: sheetFeatureId('h', mode.spec),
      isNew: true,
      panel,
      u: round2(u),
      v: round2(v),
      d,
      type: kind,
      ...(thread ? { thread } : {}),
      ...(kind === 'countersink' ? { cskDia: round2(d * 2), cskAngle: 82 } : {}),
    },
  };
}

/** u / v ranges for the hole popup (panel extents). */
export function holeRange(mode) {
  const d = mode?.draft;
  if (!d || d.kind !== 'hole') return null;
  const p = panelById(solveSheet(mode.spec), d.panel);
  if (!p) return null;
  return { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1 };
}

/** Bend deduction for display: 2(r+t)·tan(θ/2) − BA (SCS publishes the 90° value). */
export function bendDeductionAt(spec, angle) {
  const th = (Number(angle) * Math.PI) / 180;
  const ba = th * (spec.r + spec.k * spec.t);
  return 2 * (spec.r + spec.t) * Math.tan(th / 2) - ba;
}

// ---------------------------------------------------------------- S5 export
/** Check & Export popup: only from edit with no open draft. */
export function openSheetExport(mode) {
  if (!mode || mode.stage !== 'edit' || mode.draft) return mode;
  return { ...mode, exportOpen: true, hotEdge: null, toast: null };
}
export function closeSheetExport(mode) {
  return mode ? { ...mode, exportOpen: false } : mode;
}
