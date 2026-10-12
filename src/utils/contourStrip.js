/**
 * Sketch chips for one open contour.
 *
 * `seq` is creation order across kinds. Ids are per-kind high-water marks,
 * so they are not order after a delete. Builders and solve stamp any entity
 * that lacks `seq`, walking lines, arcs, dimensions, constraints, then refs.
 * Points and guide spokes are not chips. An old statement with no `seq`
 * lists in that same kind order.
 */

const SEQ_LISTS = ['lines', 'arcs', 'dimensions', 'constraints', 'refs'];

const SHAPE_LABEL = {
  circle: 'Circle',
  rectangle: 'Rectangle',
  polygon: 'Polygon',
  polyline: 'Polyline',
};

const DIM_LABEL = {
  length: 'Length',
  distance: 'Distance',
  offset: 'Offset',
  radius: 'Radius',
  angle: 'Angle',
};

const CON_LABEL = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  equal: 'Equal',
  coincident: 'Coincident',
  fix: 'Fix',
};

function finiteSeq(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

/** Stamp missing `seq` values in place. Existing numbers stay put. */
export function assignSeq(spec) {
  if (!spec) return spec;
  let max = 0;
  for (const key of SEQ_LISTS) {
    for (const item of spec[key] || []) {
      const n = finiteSeq(item?.seq);
      if (n != null && n > max) max = n;
    }
  }
  for (const key of SEQ_LISTS) {
    for (const item of spec[key] || []) {
      if (!item) continue;
      const n = finiteSeq(item.seq);
      if (n != null) {
        item.seq = n;
        continue;
      }
      max += 1;
      item.seq = max;
    }
  }
  return spec;
}

function shownNumber(kind, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const shown = kind === 'angle' ? n : Math.abs(n);
  const rounded = Math.round(shown * 1e4) / 1e4;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function chip(entry, indexByLabel) {
  const label = entry.label;
  const index = (indexByLabel.get(label) || 0) + 1;
  indexByLabel.set(label, index);
  return {
    id: entry.id,
    kind: entry.kind,
    label,
    index,
    title: entry.title || label,
    seq: entry.seq,
    ...(entry.dimKind ? { dimKind: entry.dimKind } : {}),
    ...(entry.constraintKind ? { constraintKind: entry.constraintKind } : {}),
    ...(entry.geomKind ? { geomKind: entry.geomKind } : {}),
    ...(entry.broken ? { broken: true } : {}),
  };
}

function entityRows(spec) {
  const groups = [
    ['line', spec?.lines],
    ['arc', spec?.arcs],
    ['dimension', spec?.dimensions],
    ['constraint', spec?.constraints],
    ['ref', spec?.refs],
  ];
  const stamped = [];
  const loose = [];
  let order = 0;
  for (const [kind, list] of groups) {
    for (const item of list || []) {
      order += 1;
      if (kind === 'line' && item?.guide) continue;
      if (!item?.id) continue;
      const seq = finiteSeq(item.seq);
      const row = { kind, item, order };
      if (seq == null) loose.push(row);
      else stamped.push({ ...row, seq });
    }
  }
  stamped.sort((a, b) => a.seq - b.seq || a.order - b.order);
  const start = stamped.reduce((max, row) => Math.max(max, row.seq), 0);
  return [
    ...stamped,
    ...loose.map((row, i) => ({ ...row, seq: start + i + 1 })),
  ];
}

function rowChip(row) {
  const { kind, item, seq } = row;
  if (kind === 'line') {
    return { id: item.id, kind: 'line', label: 'Line', title: 'Line', seq };
  }
  if (kind === 'arc') {
    const circle = !!item.full;
    return {
      id: item.id,
      kind: circle ? 'circle' : 'arc',
      label: circle ? 'Circle' : 'Arc',
      title: circle ? 'Circle' : 'Arc',
      seq,
    };
  }
  if (kind === 'dimension') {
    const label = DIM_LABEL[item.kind] || 'Dimension';
    const shown = shownNumber(item.kind, item.value);
    return {
      id: item.id,
      kind: 'dimension',
      dimKind: item.kind,
      label,
      title: shown ? `${label} ${shown}` : label,
      seq,
      ...(item.broken ? { broken: true } : {}),
    };
  }
  if (kind === 'constraint') {
    const label = CON_LABEL[item.kind] || 'Constraint';
    return {
      id: item.id,
      kind: 'constraint',
      constraintKind: item.kind,
      label,
      title: label,
      seq,
      ...(item.broken ? { broken: true } : {}),
    };
  }
  return {
    id: item.id,
    kind: 'ref',
    geomKind: item.geom?.kind || '',
    broken: !!item.broken,
    label: 'Reference',
    title: 'Reference',
    seq,
  };
}

function shapeChip(tool) {
  const label = SHAPE_LABEL[tool];
  if (!label) return [];
  return [{
    id: 'shape',
    kind: tool,
    label,
    index: 1,
    title: label,
    seq: 0,
  }];
}

/** Cursor edits the profile already on screen. Chips follow that profile. */
function drawnTool(tool, params) {
  if (tool !== 'cursor') return tool;
  const p = params || {};
  if (Array.isArray(p.points)) return 'polyline';
  if (p.polygonPreset) return 'polygon';
  if (p.width != null || p.height != null) return 'rectangle';
  return 'circle';
}

function unpromotedChips(tool, params) {
  const drawn = drawnTool(tool, params);
  if (drawn === 'polyline') {
    return Array.isArray(params?.points) && params.points.length > 0 ? shapeChip(drawn) : [];
  }
  if (drawn === 'circle') return Number(params?.radius) > 0 ? shapeChip(drawn) : [];
  if (drawn === 'rectangle') {
    return Number(params?.width) > 0 && Number(params?.height) > 0 ? shapeChip(drawn) : [];
  }
  if (drawn === 'polygon') return Number(params?.radius) > 0 ? shapeChip(drawn) : [];
  return [];
}

function polylineChip(seq) {
  return {
    id: 'polyline',
    kind: 'polyline',
    label: 'Polyline',
    index: 1,
    title: 'Polyline',
    seq,
  };
}

/**
 * One chip per line, arc, dimension, constraint, and reference.
 * A polyline is the exception: its segments stay one chip. Constraints
 * and dimensions that name a segment or a point still get their own chips.
 */
function chipsForSpec(spec) {
  const rows = entityRows(spec);
  const indexByLabel = new Map();
  if (!spec?.polyline) return rows.map((row) => chip(rowChip(row), indexByLabel));
  const out = [];
  let placed = false;
  for (const row of rows) {
    if (row.kind === 'line') {
      if (!placed) {
        out.push(polylineChip(row.seq));
        placed = true;
      }
      continue;
    }
    out.push(chip(rowChip(row), indexByLabel));
  }
  if (!placed && (spec.points || []).length) out.unshift(polylineChip(0));
  return out;
}

/** Chips in creation order. A promoted contour replaces the single shape chip. */
export function contourChips(state) {
  if (!state) return [];
  if (state.params?.contour) return chipsForSpec(state.params.contour);
  if (Array.isArray(state.lines) || Array.isArray(state.arcs)
    || Array.isArray(state.dimensions) || Array.isArray(state.constraints)
    || Array.isArray(state.refs)) {
    return chipsForSpec(state);
  }
  return unpromotedChips(state.tool, state.params);
}

function namesId(item, id) {
  if (!item || item.id === id) return false;
  for (const key of ['edge', 'point', 'arc', 'a', 'b']) {
    if (item[key] === id) return true;
  }
  return Array.isArray(item.items) && item.items.includes(id);
}

/** Dimensions and constraints that name `id`. The entity itself is not one of them. */
export function contourDependents(spec, id) {
  const dimensions = (spec?.dimensions || []).filter((item) => namesId(item, id));
  const constraints = (spec?.constraints || []).filter((item) => namesId(item, id));
  return { dimensions, constraints, count: dimensions.length + constraints.length };
}

/** Red-button sentence. Null when nothing else has to go. */
export function dependentDeleteLabel(dependents) {
  const count = dependents?.count || 0;
  if (!count) return null;
  const dims = dependents.dimensions?.length || 0;
  const cons = dependents.constraints?.length || 0;
  let noun = 'items';
  if (dims && !cons) noun = count === 1 ? 'dimension' : 'dimensions';
  else if (cons && !dims) noun = count === 1 ? 'constraint' : 'constraints';
  return `Delete along with ${count} ${noun}`;
}

function entityPresent(spec, id) {
  for (const key of SEQ_LISTS) {
    if ((spec?.[key] || []).some((item) => item?.id === id)) return true;
  }
  return false;
}

function withoutId(list, ids) {
  return (list || []).filter((item) => item && !ids.has(item.id));
}

function uniqueById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * The polyline chip deletes the whole chain: every segment, the points on
 * those segments, and a corner arc that uses one of those points. Dimensions
 * and constraints that name any of them go with it.
 */
function deletePolylineChip(state, contour) {
  const lineIds = (contour.lines || []).filter((line) => line && !line.guide).map((line) => line.id);
  const pointIds = new Set();
  for (const line of contour.lines || []) {
    if (!line || line.guide) continue;
    if (line.a) pointIds.add(line.a);
    if (line.b) pointIds.add(line.b);
  }
  const arcIds = [];
  for (const arc of contour.arcs || []) {
    if (!arc) continue;
    if ([arc.center, arc.start, arc.end].some((id) => id && pointIds.has(id))) {
      arcIds.push(arc.id);
      if (arc.center) pointIds.add(arc.center);
    }
  }
  const geometryIds = [...lineIds, ...arcIds, ...pointIds];
  const dimensions = uniqueById(geometryIds.flatMap((id) => contourDependents(contour, id).dimensions));
  const constraints = uniqueById(geometryIds.flatMap((id) => contourDependents(contour, id).constraints));
  const dependents = { dimensions, constraints, count: dimensions.length + constraints.length };
  const removed = new Set([
    ...geometryIds,
    ...dimensions.map((item) => item.id),
    ...constraints.map((item) => item.id),
  ]);
  const next = {
    ...contour,
    points: (contour.points || []).filter((point) => point && !pointIds.has(point.id)),
    lines: (contour.lines || []).filter((line) => line && !removed.has(line.id)),
    arcs: (contour.arcs || []).filter((arc) => arc && !removed.has(arc.id)),
    dimensions: withoutId(contour.dimensions, removed),
    constraints: withoutId(contour.constraints, removed),
    refs: withoutId(contour.refs, removed),
  };
  const alive = next.points.length || next.lines.some((line) => !line.guide)
    || next.arcs.length || next.dimensions.length || next.constraints.length || next.refs.length;
  const cleared = {
    ...state,
    params: alive
      ? { ...(state.params || {}), contour: next, points: next.points.map((point) => point.at.slice()) }
      : { points: [] },
    picks: [],
    tagId: null,
    gestureNote: null,
    dimensionEdit: null,
    constraintEdit: null,
    dimensionLive: null,
    entityCard: null,
  };
  return {
    state: cleared,
    dependents,
    label: dependentDeleteLabel(dependents),
    removed: ['polyline', ...removed],
  };
}

/**
 * Drop one sketch entity and the dimensions and constraints that name it.
 * Points stay. One params replace, no solve, so a deleted side is not redrawn.
 * A missing id leaves the state alone.
 */
export function deleteContourEntity(state, id) {
  if (!state || !id) return { state, dependents: contourDependents(null, id), label: null, removed: [] };
  const contour = state.params?.contour;
  if (contour?.polyline && id === 'polyline') return deletePolylineChip(state, contour);
  if (!contour) {
    if (id !== 'shape') {
      return { state, dependents: contourDependents(null, id), label: null, removed: [] };
    }
    return {
      state: { ...state, params: { points: [] }, picks: [], dimensionLive: null },
      dependents: contourDependents(null, id),
      label: null,
      removed: ['shape'],
    };
  }
  if (!entityPresent(contour, id)) {
    return { state, dependents: contourDependents(contour, id), label: null, removed: [] };
  }
  const dependents = contourDependents(contour, id);
  const removed = new Set([
    id,
    ...dependents.dimensions.map((item) => item.id),
    ...dependents.constraints.map((item) => item.id),
  ]);
  const next = {
    ...contour,
    lines: withoutId(contour.lines, removed),
    arcs: withoutId(contour.arcs, removed),
    dimensions: withoutId(contour.dimensions, removed),
    constraints: withoutId(contour.constraints, removed),
    refs: withoutId(contour.refs, removed),
  };
  return {
    state: {
      ...state,
      params: { ...(state.params || {}), contour: next },
      picks: (state.picks || []).filter((pick) => !removed.has(pick.id)),
      dimensionEdit: removed.has(state.dimensionEdit) ? null : state.dimensionEdit,
      constraintEdit: removed.has(state.constraintEdit) ? null : state.constraintEdit,
      tagId: removed.has(state.tagId) ? null : state.tagId,
      dimensionLive: null,
    },
    dependents,
    label: dependentDeleteLabel(dependents),
    removed: [...removed],
  };
}
