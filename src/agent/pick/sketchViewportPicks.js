/**
 * Contour / hole-centre pick target for H10 (extends H9 face/edge host).
 */

import { applyContourPick, isHoleEntry } from '../../utils/contourMode.js';
import {
  applyHoleCentreWrites,
  holeCentreCount,
  listSketchEntities,
  resolveSketchPickKeys,
  sketchPickKey,
} from '../sketchEntityAgent.js';
import { stickyPickKey } from '../../utils/stickyPick.js';

const SKETCH_KINDS = new Set(['point', 'line', 'arc', 'ref']);

export function sketchPickTarget(contourState, planeOpen) {
  if (!contourState) return null;
  if (contourState.gesture) {
    const kind = contourState.gesture === 'constraints' ? 'line' : 'point';
    return { target: 'contour', kind, gesture: contourState.gesture };
  }
  if (isHoleEntry(contourState.entry) && !planeOpen) {
    return { target: 'holeCentres', kind: 'point' };
  }
  return null;
}

export function createSketchPickHandlers(getDeps) {
  const deps = () => getDeps();

  function contourState() {
    const d = deps();
    return d?.contourState?.() || null;
  }

  function planeOpen() {
    return !!deps()?.contourPlaneOpen?.();
  }

  function readContourPicks(state) {
    const picks = Array.isArray(state?.picks) ? state.picks : [];
    return picks.map((pick) => ({
      id: stickyPickKey(pick),
      entry: pick,
    }));
  }

  return {
    sketchPickInfo() {
      const sketch = sketchPickTarget(contourState(), planeOpen());
      if (!sketch) return null;
      return sketch;
    },

    sketchPickRead() {
      const state = contourState();
      const sketch = sketchPickTarget(state, planeOpen());
      if (!sketch) return { target: null, entries: [], settled: true };
      if (sketch.target === 'holeCentres') {
        const count = holeCentreCount(state);
        return {
          target: sketch.target,
          entries: Array.from({ length: count }, (_, i) => ({
            id: `centre:${i}`,
            entry: { kind: 'centre', index: i },
          })),
          settled: true,
          count,
        };
      }
      return { target: sketch.target, ...readContourPicks(state), settled: true };
    },

    sketchPickResolve({ kind, keys }) {
      const state = contourState();
      if (!state) return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
      if (!SKETCH_KINDS.has(kind)) {
        return { error: { code: 'bad_args', message: `kind must be one of: ${[...SKETCH_KINDS].join(', ')}` } };
      }
      return resolveSketchPickKeys(state, kind, keys);
    },

    sketchPickWrite({ entries }) {
      const state = contourState();
      const sketch = sketchPickTarget(state, planeOpen());
      if (!sketch) return { error: { code: 'pick_closed', message: 'No contour pick target is open' } };
      const d = deps();
      if (sketch.target === 'holeCentres') {
        const applied = applyHoleCentreWrites(state, entries);
        if (applied.error) return applied;
        d.commitContourState?.(applied.state);
        const count = holeCentreCount(applied.state);
        return {
          count,
          ids: Array.from({ length: count }, (_, i) => `centre:${i}`),
        };
      }
      let next = state;
      for (const row of entries) {
        const pick = row.entry;
        if (!pick?.kind) continue;
        next = applyContourPick(next, pick);
      }
      d.commitContourState?.(next);
      const rows = readContourPicks(next);
      return { count: rows.length, ids: rows.map((r) => r.id) };
    },

    sketchPickEnter({ kind }) {
      const sketch = sketchPickTarget(contourState(), planeOpen());
      if (!sketch) {
        return { error: { code: 'picker_busy', message: 'Open a contour gesture or hole centres sketch first' } };
      }
      if (kind && kind !== sketch.kind && sketch.target !== 'holeCentres') {
        return { error: { code: 'wrong_kind', message: `${sketch.target} picks ${sketch.kind}s`, details: { kind: sketch.kind } } };
      }
      return { ok: true };
    },

    listSketchEntities() {
      const state = contourState();
      if (!state) return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
      return { result: listSketchEntities(state) };
    },
  };
}

export function sketchPickKeyId(kind, key) {
  return sketchPickKey(kind, key);
}
