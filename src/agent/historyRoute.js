/**
 * Which undo/redo stack the feature bar uses, and read-only summaries for agents.
 * Matches App.jsx strip routing: sketch while open, else assembly joints, else part.
 */

import { assemblyHistoryCanRedo, assemblyHistoryCanUndo } from '../joints/jointUi.js';

/** @typedef {'sketch' | 'assembly' | 'part'} HistoryKind */

/**
 * @param {{ sketchOpen?: boolean, showJoints?: boolean }} ctx
 * @returns {HistoryKind}
 */
export function historyStripTarget({ sketchOpen = false, showJoints = false }) {
  if (sketchOpen) return 'sketch';
  if (showJoints) return 'assembly';
  return 'part';
}

/**
 * @param {Array<{ message?: string, code?: string }>} commits
 * @param {number} head
 */
export function summarizePartHistory(commits, head, { partId = null } = {}) {
  const list = Array.isArray(commits) ? commits : [];
  const h = Number.isInteger(head) ? head : -1;
  return {
    kind: 'part',
    partId,
    head: h,
    canUndo: h > 0,
    canRedo: h >= 0 && h < list.length - 1,
    entries: list.map((row, index) => ({
      index,
      label: row?.message || 'Step',
      current: index === h,
    })),
  };
}

/**
 * @param {{ joints?: object[] }} snap
 * @param {{ joints?: object[] }} prev
 */
export function assemblyStepLabel(snap, prev) {
  const joints = snap?.joints || [];
  const prevJoints = prev?.joints || [];
  if (joints.length > prevJoints.length) {
    const added = joints[joints.length - 1];
    const name = added?.name || added?.id;
    return name ? `Joint: ${name}` : 'Add joint';
  }
  if (joints.length < prevJoints.length) {
    return 'Remove joint';
  }
  const prevPlacements = prev?.placements || {};
  const placements = snap?.placements || {};
  const keys = new Set([...Object.keys(prevPlacements), ...Object.keys(placements)]);
  for (const key of keys) {
    const a = prevPlacements[key]?.t;
    const b = placements[key]?.t;
    if (!a || !b) continue;
    if (a.length === 3 && b.length === 3) {
      const moved = Math.abs(a[0] - b[0]) > 1e-6
        || Math.abs(a[1] - b[1]) > 1e-6
        || Math.abs(a[2] - b[2]) > 1e-6;
      if (moved) return 'Move part';
    }
  }
  if (joints.length) return `Assembly (${joints.length} joint${joints.length === 1 ? '' : 's'})`;
  return 'Assembly';
}

/**
 * @param {{ commits?: object[], head?: number }} history
 */
export function summarizeAssemblyHistory(history) {
  const commits = history?.commits || [];
  const head = Number.isInteger(history?.head) ? history.head : 0;
  return {
    kind: 'assembly',
    head,
    canUndo: assemblyHistoryCanUndo(history),
    canRedo: assemblyHistoryCanRedo(history),
    entries: commits.map((snap, index) => ({
      index,
      label: index === 0 ? 'Assembly' : assemblyStepLabel(snap, commits[index - 1]),
      current: index === head,
      jointCount: Array.isArray(snap?.joints) ? snap.joints.length : 0,
    })),
  };
}

/**
 * @param {{ depth?: number, entries?: { index: number, label: string, current?: boolean }[] }} sketch
 */
export function summarizeSketchHistory(sketch) {
  const depth = Number(sketch?.depth) || 0;
  const entries = Array.isArray(sketch?.entries) && sketch.entries.length
    ? sketch.entries
    : Array.from({ length: depth + 1 }, (_, index) => ({
      index,
      label: index === 0 ? 'Sketch start' : 'Sketch edit',
      current: index === depth,
    }));
  return {
    kind: 'sketch',
    head: depth,
    canUndo: depth > 0,
    canRedo: false,
    entries,
  };
}
