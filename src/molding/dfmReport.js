/**
 * Budgetary DFM summary of one mold-analysis result (M4.1).
 * Text only. It does not price a part and it does not paint a skin.
 */

/** How many stamped parting-line names the panel lists before "+N more". */
export const DFM_NAME_PREVIEW = 4;

const FIT_LABEL = Object.freeze({
  good: 'Good',
  fixable: 'Fixable',
  not_a_fit: 'Not a fit',
});

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bucketCount(bucket) {
  if (bucket == null) return null;
  if (typeof bucket === 'number') return finite(bucket);
  return finite(bucket.count);
}

function roundTo(value, places) {
  const n = finite(value);
  if (n == null) return null;
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
}

function pullOf(pull) {
  if (!Array.isArray(pull) || pull.length < 3) return null;
  return [0, 1, 2].map((i) => roundTo(pull[i], 3) ?? 0);
}

function namingOf(parting) {
  const lines = Array.isArray(parting?.lines) ? parting.lines : [];
  const names = [];
  const seen = new Set();
  for (const line of lines) {
    const listed = [];
    if (typeof line?.name === 'string' && line.name.trim()) listed.push(line.name.trim());
    if (Array.isArray(line?.edgeNames)) {
      for (const edgeName of line.edgeNames) {
        if (typeof edgeName === 'string' && edgeName.trim()) listed.push(edgeName.trim());
      }
    }
    for (const name of listed) {
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  if (!names.length) {
    return {
      stamped: false,
      note: 'Face names are not available.',
      names: [],
      extra: 0,
    };
  }
  return {
    stamped: true,
    note: null,
    names: names.slice(0, DFM_NAME_PREVIEW),
    extra: Math.max(0, names.length - DFM_NAME_PREVIEW),
  };
}

/**
 * Readable summary of a mold-analysis object. Null when the object is not
 * that result. Counts only: no triangle lists, no ejector positions, no money.
 */
export function dfmReport(analysis) {
  if (!analysis || analysis.kind !== 'mold-analysis') return null;
  const wall = analysis.wall || {};
  const draft = analysis.moldDraft || {};
  const ejectors = draft.ejectors || {};
  const sides = analysis.sideActions || {};
  const groups = Array.isArray(sides.groups) ? sides.groups : [];
  const nominal = roundTo(wall.nominal, 2);
  const pullSource = analysis.pullSource === 'override' || analysis.pullSource === 'search'
    ? analysis.pullSource
    : null;
  return {
    framing: 'Budgetary analysis',
    binding: false,
    disclaimer: 'Not a binding supplier DFM.',
    fit: analysis.fit || null,
    fitLabel: FIT_LABEL[analysis.fit] || null,
    undercutCount: finite(analysis.undercutCount) ?? 0,
    pull: pullOf(analysis.pull),
    pullSource,
    wall: {
      nominal,
      nominalKnown: nominal != null,
      nominalMethod: nominal == null ? null : (wall.nominalMethod || null),
      thinCount: finite(wall.thinCount) ?? 0,
      thickCount: finite(wall.thickCount) ?? 0,
      max: roundTo(wall.max, 2),
      unit: 'mm',
    },
    draft: {
      heuristic: true,
      minDeg: finite(draft.minDeg) ?? 1,
      violationCount: finite(draft.violationCount) ?? 0,
      minDraftDeg: roundTo(draft.minDraftDeg, 1),
      positiveAbove: bucketCount(draft.positiveAbove),
      positiveBelow: bucketCount(draft.positiveBelow),
      negative: bucketCount(draft.negative),
    },
    sideActions: {
      heuristic: true,
      slideCount: finite(sides.slideCount) ?? 0,
      lifterCount: finite(sides.lifterCount) ?? 0,
      groups: groups.map((group) => ({
        kind: group?.kind === 'lifter' ? 'lifter' : 'slide',
        pull: pullOf(group?.pull),
      })),
    },
    ejectors: {
      heuristic: true,
      pinCount: finite(ejectors.pinCount) ?? 0,
      sleeveCount: finite(ejectors.sleeveCount) ?? 0,
    },
    naming: namingOf(analysis.parting),
  };
}
