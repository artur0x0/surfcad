import { resolveFaceKeys, resolveEdgeKeys } from './resolvePickIds.js';
import { getDisplayUnit, setDisplayUnit, normalizeDisplayUnit } from '../utils/displayUnit.js';
import { faceColorKey, matchFaceKeys } from '../utils/faceColorMatch.js';
import {
  fingerprintsFromGeometry,
  livePaintChanged,
  livePaintTap,
  parsePaintHex,
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

function paintPendingCount(session) {
  if (!session || typeof session !== 'object') return 0;
  let count = 0;
  for (const entry of Object.values(session)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.part) count += 1;
    else if (Array.isArray(entry.faces)) count += entry.faces.length;
  }
  return count;
}

export function createPaintMeasureAgentHandlers(deps) {
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
    paintOpen() {
      if (deps.appMode === 'game') {
        return { error: { code: 'bad_view', message: 'Paint is not available in game mode' } };
      }
      if (deps.paintModeRef?.current) {
        return { result: { open: true, already: true } };
      }
      deps.enterPaintModeRef?.current?.();
      return { result: { open: !!deps.paintModeRef?.current } };
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
        return { error: { code: 'paint_unchanged', message: 'Face paint did not change the session' } };
      }
      return { result: { painted: matched.length, color } };
    },

    paintPart() {
      const state = deps.paintModeRef?.current;
      if (!state) {
        return { error: { code: 'no_paint_mode', message: 'Open paint mode first' } };
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
          pendingCount: paintPendingCount(state.session),
          canConfirm,
          canUndo: Array.isArray(state.undo) && state.undo.length > 0,
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
