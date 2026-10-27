import { resolveFaceKeys, resolveEdgeKeys } from './resolvePickIds.js';
import { getDisplayUnit, setDisplayUnit, normalizeDisplayUnit } from '../utils/displayUnit.js';
import { faceColorKey, matchFaceKeys } from '../utils/faceColorMatch.js';
import {
  fingerprintsFromGeometry,
  livePaintChanged,
  livePaintTap,
  parsePaintHex,
  pendingPaintCount,
  resolvedPaintColor,
} from '../utils/facePaint.js';
import {
  buildEdgeMeasurePick,
  buildFaceMeasurePick,
  buildPointMeasurePick,
  measureReadout,
  toggleMeasurePick,
  triangleGroupStats,
} from '../utils/measurePicks.js';
import { propagateTangentEdges } from '../utils/selectEdge.js';

/** How long paint_open waits for the viewport to take the mode. */
export const PAINT_OPEN_WAIT_MS = 1500;
const PAINT_OPEN_POLL_MS = 50;

const PAINT_OPEN_REASON_TEXT = {
  prompt_working: 'an agent prompt is being worked, so agent-opened cards are held back until it is answered',
  mode_not_ready: 'the viewport did not take paint mode yet (a part switch or run may still be settling)',
};
const PROMPT_WORKING = 'prompt_working';

export function createPaintMeasureAgentHandlers(deps) {
  const wait = (ms) => (typeof deps.wait === 'function' ? deps.wait(ms) : new Promise((r) => setTimeout(r, ms)));
  const now = () => (typeof deps.now === 'function' ? deps.now() : Date.now());
  const meshContext = () => {
    const mesh = deps.getMesh?.();
    const geometry = mesh?.geometry;
    const positions = geometry?.attributes?.position;
    const index = geometry?.index?.array;
    if (!geometry || !positions?.array || !index?.length) {
      return { error: { code: 'no_mesh', message: 'No mesh to paint or measure on' } };
    }
    const faceIDs = deps.faceIDsRef?.current;
    const fingerprints = fingerprintsFromGeometry(geometry, faceIDs);
    return {
      mesh,
      geometry,
      positions: positions.array,
      index,
      faceIDs,
      fingerprints,
      partId: deps.activePartIdRef?.current || '',
    };
  };

  return {
    /**
     * Open paint mode, waiting up to PAINT_OPEN_WAIT_MS for the viewport to
     * take it: right after create_part or set_active_part the part switch
     * may still be settling. While an agent prompt is being worked the
     * feature-popup gate holds agent-opened cards back, so paint opens
     * headless instead (the session runs, no card is mounted; result
     * `headless: true`), rather than refusing or waiting (B2: a bronze paint
     * returned nothing and never applied until set_status idle). Never
     * `open: false` with no reason: when the wait runs out the result is a
     * `not_ready` error that names the reason and can be retried.
     */
    async paintOpen() {
      if (deps.appMode === 'game') {
        return { error: { code: 'bad_view', message: 'Paint is not available in game mode' } };
      }
      if (deps.paintModeRef?.current) {
        return { result: { open: true, already: true } };
      }
      const deadline = now() + (Number.isFinite(deps.paintOpenWaitMs) ? deps.paintOpenWaitMs : PAINT_OPEN_WAIT_MS);
      let reason = null;
      for (;;) {
        reason = typeof deps.paintOpenBlocked === 'function' ? (deps.paintOpenBlocked() || null) : null;
        if (!reason) {
          deps.enterPaintModeRef?.current?.();
          if (deps.paintModeRef?.current) return { result: { open: true } };
          reason = 'mode_not_ready';
        } else if (reason === PROMPT_WORKING) {
          deps.enterPaintModeRef?.current?.({ headless: true });
          if (deps.paintModeRef?.current) return { result: { open: true, headless: true } };
          reason = 'mode_not_ready';
        }
        if (now() >= deadline) break;
        await wait(PAINT_OPEN_POLL_MS);
      }
      const why = PAINT_OPEN_REASON_TEXT[reason] || reason;
      return {
        error: {
          code: 'not_ready',
          message: `Paint did not open: ${why}. Retry paint_open.`,
          details: { reason, retryable: true },
        },
      };
    },

    paintClose() {
      if (!deps.paintModeRef?.current) {
        return { result: { open: false, already: true } };
      }
      deps.exitPaintModeRef?.current?.();
      return { result: { open: false } };
    },

    paintCancel() {
      return this.paintClose();
    },

    paintSetColor({ color, hex } = {}) {
      const raw = color ?? hex;
      const parsed = parsePaintHex(String(raw || ''));
      if (!parsed) {
        return { error: { code: 'bad_args', message: 'paint_set_color needs color as #RRGGBB' } };
      }
      if (!deps.paintModeRef?.current) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
      }
      deps.patchPaintRef?.current?.({ color: parsed, custom: '' });
      return { result: { color: parsed } };
    },

    paintFaces({ keys } = {}) {
      const state = deps.paintModeRef?.current;
      if (!state) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
      }
      const ctx = meshContext();
      if (ctx.error) return ctx;
      const list = Array.isArray(keys) ? keys : [];
      if (!list.length) {
        return { error: { code: 'bad_args', message: 'paint_faces needs keys' } };
      }
      const items = list.map((key) => ({ key }));
      const { matched, ambiguous, missing } = matchFaceKeys(ctx.fingerprints, items);
      if (ambiguous.length) {
        return { error: { code: 'ambiguous_face', message: 'Face key matches more than one patch' } };
      }
      if (missing.length) {
        return { error: { code: 'unknown_face', message: 'Face key did not match any patch on the active mesh' } };
      }
      if (!matched.length) {
        return { error: { code: 'unknown_face', message: 'No face keys matched the active mesh' } };
      }
      const color = resolvedPaintColor(state.color, state.custom);
      const surfId = deps.paintSurfIdRef?.current?.();
      if (!color || !surfId) {
        return { error: { code: 'bad_paint', message: 'Active part has no surf id or color' } };
      }
      const faces = ctx.fingerprints;
      const now = Date.now();
      let session = state.session;
      let undo = state.undo;
      let lastTap = state.lastTap;
      for (const row of matched) {
        const key = faceColorKey(row.face);
        const tap = livePaintTap(
          { session, undo, lastTap },
          { surfId, color, key, faces, now },
        );
        session = tap.session;
        undo = tap.undo;
        lastTap = tap.lastTap;
      }
      deps.storeLivePaintRef?.current?.({ session, undo, lastTap });
      if (!livePaintChanged(session, state.baseline)) {
        return { result: { painted: matched.length, color, unchanged: true } };
      }
      return { result: { painted: matched.length, color } };
    },

    paintPart() {
      const state = deps.paintModeRef?.current;
      if (!state) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
      }
      const color = resolvedPaintColor(state.color, state.custom);
      const surfId = deps.paintSurfIdRef?.current?.();
      if (!color || !surfId) {
        return { error: { code: 'bad_paint', message: 'Active part has no surf id or color' } };
      }
      deps.paintWholePartRef?.current?.();
      return { result: { ok: true } };
    },

    paintUndo() {
      if (!deps.paintModeRef?.current) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
      }
      deps.undoLivePaintRef?.current?.();
      return { result: { ok: true } };
    },

    paintClear() {
      if (!deps.paintModeRef?.current) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
      }
      deps.clearLivePaintRef?.current?.();
      return { result: { ok: true } };
    },

    paintConfirm() {
      if (!deps.paintModeRef?.current) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
      }
      const state = deps.paintModeRef.current;
      const canConfirm = resolvedPaintColor(state.color, state.custom)
        && livePaintChanged(state.session, state.baseline);
      if (!canConfirm) {
        return { result: { ok: true, written: false, unchanged: true } };
      }
      deps.acceptPaintRef?.current?.();
      return { result: { ok: true, written: true, unchanged: false } };
    },

    paintState() {
      const state = deps.paintModeRef?.current;
      if (!state) {
        return { result: { open: false } };
      }
      const color = resolvedPaintColor(state.color, state.custom);
      const canConfirm = !!color && livePaintChanged(state.session, state.baseline);
      return {
        result: {
          open: true,
          color,
          swatch: state.color,
          custom: state.custom || '',
          pendingCount: pendingPaintCount(state.session, state.baseline),
          canConfirm,
          canUndo: Array.isArray(state.undo) && state.undo.length > 0,
          ...(state.headless === true ? { headless: true } : {}),
        },
      };
    },

    measureOpen() {
      if (deps.appMode === 'game') {
        return { error: { code: 'bad_view', message: 'Measure is not available in game mode' } };
      }
      if (deps.measurementEnabledRef?.current) {
        return { result: { open: true, already: true } };
      }
      deps.handleMeasurementToggleRef?.current?.();
      return { result: { open: !!deps.measurementEnabledRef?.current } };
    },

    measureClose() {
      if (!deps.measurementEnabledRef?.current) {
        return { result: { open: false, already: true } };
      }
      deps.exitMeasureModeRef?.current?.();
      return { result: { open: false } };
    },

    measureSetUnit({ unit } = {}) {
      const next = normalizeDisplayUnit(unit);
      if (!next) {
        return { error: { code: 'bad_args', message: 'measure_set_unit needs unit mm or in' } };
      }
      setDisplayUnit(next);
      return { result: { unit: getDisplayUnit() } };
    },

    measureClear() {
      if (!deps.measurementEnabledRef?.current) {
        return { error: { code: 'no_measure_mode', message: 'Open measure mode first' } };
      }
      deps.commitMeasurePicksRef?.current?.([]);
      return { result: { ok: true, count: 0 } };
    },

    measurePick(args = {}) {
      if (!deps.measurementEnabledRef?.current) {
        return { error: { code: 'no_measure_mode', message: 'Open measure mode first' } };
      }
      const ctx = meshContext();
      if (ctx.error) return ctx;
      const picks = [];
      const faceKeys = Array.isArray(args.face_keys) ? args.face_keys
        : (Array.isArray(args.keys) ? args.keys : (args.face_key ? [args.face_key] : []));
      if (faceKeys.length) {
        const resolved = resolveFaceKeys(ctx.fingerprints, faceKeys);
        if (resolved.error) return resolved;
        for (const row of resolved.picks) {
          const indices = Array.isArray(row.indices) && row.indices.length
            ? row.indices
            : [];
          const stats = indices.length
            ? triangleGroupStats(ctx.positions, ctx.index, indices)
            : { center: row.center, normal: row.normal, points: [] };
          picks.push(buildFaceMeasurePick({
            partId: ctx.partId,
            patchId: indices.length ? String(Math.min(...indices)) : 'agent',
            center: stats.center || row.center,
            normal: stats.normal || row.normal,
            points: stats.points || [],
            indices,
          }));
        }
      }
      if (args.point && Array.isArray(args.point) && args.point.length >= 3) {
        picks.push(buildPointMeasurePick({
          partId: ctx.partId,
          position: args.point.slice(0, 3),
        }));
      }
      const edgeKeys = Array.isArray(args.edge_keys) ? args.edge_keys
        : (args.edge_key ? [args.edge_key] : []);
      if (edgeKeys.length) {
        deps.syncFeatureEdgesRef?.current?.(ctx.geometry);
        const rawEdges = deps.featureEdgesRef?.current || [];
        const resolved = resolveEdgeKeys(
          rawEdges,
          edgeKeys,
          ctx.partId,
          ctx.fingerprints,
          deps.boundaryTopoRef?.current,
        );
        if (resolved.error) return resolved;
        for (const edge of resolved.edges) {
          let chain = propagateTangentEdges(rawEdges, edge);
          if (!chain.length || chain.length > 128) chain = [edge];
          const canon = chain.reduce((best, item) => (
            String(item.key) < String(best.key) ? item : best
          ), chain[0]);
          picks.push(buildEdgeMeasurePick({ partId: ctx.partId, edge: canon, chain }));
        }
      }
      if (!picks.length) {
        return { error: { code: 'bad_args', message: 'measure_pick needs face_keys, edge_keys, or point' } };
      }
      let list = deps.measurePicksRef?.current || [];
      for (const pick of picks) {
        list = toggleMeasurePick(list, pick);
      }
      deps.commitMeasurePicksRef?.current?.(list);
      return { result: { count: list.length } };
    },

    measureState() {
      const list = deps.measurePicksRef?.current || [];
      const readout = measureReadout(list);
      return {
        result: {
          open: !!deps.measurementEnabledRef?.current,
          unit: getDisplayUnit(),
          count: list.length,
          picks: list.map((pick) => ({ id: pick.id, kind: pick.kind, label: pick.label })),
          readout,
        },
      };
    },
  };
}
