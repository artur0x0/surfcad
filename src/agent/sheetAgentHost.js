import { findScsSku, loadScsCatalog } from '../utils/scs/scsCatalog.js';
import { scsCatalogCache } from '../utils/scs/scsCatalogStore.js';
import { respecSheetSku } from '../utils/sheetMetal/sheetModel.js';
import {
  acceptBaseFlange,
  acceptDraft,
  backToPlanePick,
  bendBlockReason,
  cancelDraft,
  closeSheetExport,
  editSheetChip,
  enterSheetMetalMode,
  openSheetExport,
  pickSheetPlane,
  pushSheetHistory,
  setBaseDims,
  setSheetTool,
  sheetDoneSpec,
  sheetTap,
  updateDraft,
} from '../utils/sheetMetal/sheetMetalMode.js';
import { readSheetMetalSpec } from '../utils/sheetMetal/sheetMetalScript.js';
import { sheetRibbonChips } from '../utils/sheetMetal/sheetRibbon.js';
import { parseFeatureMarkers } from '../utils/featureMarkers.js';

function refKeyToPanelEdge(refKey) {
  const m = String(refKey || '').match(/^wall:([^:]+):([uv][+-])/);
  if (!m) return null;
  return { panel: m[1] === 'base' ? 'base' : m[1], edge: m[2] };
}

export function createSheetAgentHandlers(deps) {
  const {
    modeRef,
    pickerRef,
    setMode,
    setPicker,
    onBindSheetMetal,
    onCommitSheetMetal,
    getHelperBuffer,
    cancelFeatureEdit,
    selectSheetChip,
    beginFeatureEdit,
    characteristicLengthMm,
    modelBoundsRef,
  } = deps;

  const length = () => characteristicLengthMm?.({ bounds: modelBoundsRef?.current }) ?? 100;

  // Consecutive agent calls (sheet_check then sheet_refold) read modeRef
  // before React flushes setState. Keep the ref in lockstep with the write.
  const applyMode = (next) => {
    modeRef.current = next ?? null;
    setMode(next);
  };

  function readScript() {
    const read = getHelperBuffer;
    return typeof read === 'function' ? read() : '';
  }

  function applySkuPatch(mode, patch) {
    if (!patch?.sku && !patch?.material) return mode;
    const sku = patch.sku || mode?.sku?.sku;
    if (!sku) return mode;
    return loadScsCatalog({ cache: scsCatalogCache }).then((res) => {
      const rec = findScsSku(res.records, sku);
      if (!rec) return { error: { code: 'unknown_sku', message: `Unknown sheet SKU: ${sku}` } };
      let next = mode;
      if (next?.spec) {
        const spec = respecSheetSku(next.spec, rec);
        next = { ...next, sku: rec, spec };
      } else {
        next = { ...next, sku: rec };
      }
      if (patch.r != null || patch.k != null || patch.t != null) {
        const spec = next.spec ? { ...next.spec } : null;
        if (spec) {
          if (patch.r != null) spec.r = patch.r;
          if (patch.k != null) spec.k = patch.k;
          if (patch.t != null) spec.t = patch.t;
          next = { ...next, spec };
        }
      }
      applyMode(next);
      return { result: { sku: rec.sku, stage: next.stage } };
    });
  }

  return {
    sheetOpen() {
      if (deps.appMode === 'game') {
        return { error: { code: 'bad_view', message: 'Sheet metal is not available in game mode' } };
      }
      setPicker({ willCreatePart: deps.willCreatePart?.() ?? false });
      return { result: { open: true, picker: true } };
    },

    async sheetStart(args = {}) {
      if (deps.appMode === 'game') {
        return { error: { code: 'bad_view', message: 'Sheet metal is not available in game mode' } };
      }
      const res = await loadScsCatalog({ cache: scsCatalogCache });
      let rec = args?.sku ? findScsSku(res.records, String(args.sku)) : null;
      if (!rec && args?.material) {
        rec = res.records.find((row) => row.name === String(args.material) && row.inStock !== false) || null;
      }
      if (!rec) {
        return { error: { code: 'unknown_sku', message: 'Could not resolve sheet SKU from catalog' } };
      }
      if (!onBindSheetMetal) {
        return { error: { code: 'internal', message: 'Sheet metal bind handler is missing' } };
      }
      const start = onBindSheetMetal(rec);
      const finish = (bound) => {
        if (!bound?.ok) {
          return { error: { code: 'bind_failed', message: 'Could not bind sheet metal to the part' } };
        }
        setPicker(null);
        const next = enterSheetMetalMode(rec, bound.partId, bound.spec || null);
        if (next?.stage === 'edit' && next.spec && bound.partId) {
          onCommitSheetMetal?.(next.spec, { partId: bound.partId, step: 'rebind' });
        }
        applyMode(next);
        return { result: { ok: true, stage: next?.stage, partId: bound.partId } };
      };
      if (start && typeof start.then === 'function') {
        const bound = await start;
        return finish(bound);
      }
      return finish(start);
    },

    sheetSetTool({ tool } = {}) {
      const mode = modeRef.current;
      if (!mode) return { error: { code: 'no_sheet_mode', message: 'Open sheet metal first' } };
      const next = setSheetTool(mode, tool);
      if (next === mode) {
        return { error: { code: 'bad_tool', message: `Tool ${tool} is not available on this SKU` } };
      }
      applyMode(next);
      return { result: { tool: next.tool } };
    },

    sheetSetParams({ patch } = {}) {
      const mode = modeRef.current;
      if (!mode) return { error: { code: 'no_sheet_mode', message: 'Open sheet metal first' } };
      if (patch?.sku || patch?.material) {
        return applySkuPatch(mode, patch);
      }
      let next = mode;
      if (mode.stage === 'plane' && patch?.plane) {
        next = pickSheetPlane(mode, patch.plane, length());
      } else if (mode.stage === 'base' && mode.base) {
        next = setBaseDims(mode, patch);
      } else if (mode.draft) {
        next = updateDraft(mode, patch);
      } else if (mode.stage === 'edit' && mode.spec && (patch.r != null || patch.k != null || patch.t != null)) {
        const spec = { ...mode.spec };
        if (patch.r != null) spec.r = patch.r;
        if (patch.k != null) spec.k = patch.k;
        if (patch.t != null) spec.t = patch.t;
        next = { ...mode, spec };
      } else {
        return { error: { code: 'bad_stage', message: 'No sheet params apply at this stage' } };
      }
      applyMode(next);
      return { result: { ok: true, stage: next.stage, draft: next.draft?.kind || null } };
    },

    sheetApplyPicks({ picks } = {}) {
      const mode = modeRef.current;
      if (!mode) return { error: { code: 'no_sheet_mode', message: 'Open sheet metal first' } };
      let next = mode;
      for (const pick of picks || []) {
        if (pick.kind === 'chip') {
          const script = readScript();
          const chips = sheetRibbonChips(script, { stage: next.stage, spec: next.spec });
          const chip = chips.find((row) => row.id === pick.chip_id);
          if (!chip) {
            return { error: { code: 'unknown_chip', message: `Unknown sheet chip: ${pick.chip_id}` } };
          }
          next = editSheetChip(next, chip);
          continue;
        }
        if (pick.kind === 'plane') {
          next = pickSheetPlane(next, pick.plane, length());
          continue;
        }
        if (pick.kind === 'panel') {
          next = sheetTap(next, { kind: 'panel', panel: pick.panel }, length());
          continue;
        }
        if (pick.kind === 'edge') {
          let panel = pick.panel;
          let edge = pick.edge;
          if (pick.ref_key) {
            const mapped = refKeyToPanelEdge(pick.ref_key);
            if (!mapped) {
              return { error: { code: 'bad_pick', message: `Could not map ref_key: ${pick.ref_key}` } };
            }
            panel = mapped.panel;
            edge = mapped.edge;
          }
          next = sheetTap(next, { kind: 'edge', panel, edge }, length());
          continue;
        }
        return { error: { code: 'bad_pick', message: 'Unsupported sheet pick kind' } };
      }
      if (next === mode) {
        return { result: { ok: true, unchanged: true } };
      }
      applyMode(next);
      return {
        result: {
          ok: true,
          stage: next.stage,
          draft: next.draft?.kind || null,
          tool: next.tool || null,
        },
      };
    },

    prepareSheetCommit() {
      const mode = modeRef.current;
      if (!mode) return { error: { code: 'no_sheet_mode', message: 'Open sheet metal first' } };
      if (mode.stage === 'base' && mode.base) {
        const { mode: next, spec } = acceptBaseFlange(mode);
        if (!spec) return { error: { code: 'commit_failed', message: 'Base flange is incomplete' } };
        return {
          ok: true,
          write: true,
          step: 'base',
          spec,
          partId: mode.partId,
          nextMode: next,
          reopen: false,
        };
      }
      if (!mode.draft) {
        return { error: { code: 'no_draft', message: 'No sheet feature draft is open to confirm' } };
      }
      if (mode.draft.kind === 'bend' && bendBlockReason(mode)) {
        return { error: { code: 'commit_failed', message: bendBlockReason(mode) } };
      }
      const { mode: next, spec } = acceptDraft(mode);
      if (!spec) return { error: { code: 'commit_failed', message: 'Draft could not be confirmed' } };
      if (mode.reopen) {
        return {
          ok: true,
          write: false,
          step: mode.draft.kind,
          spec,
          nextMode: pushSheetHistory(mode, spec),
          reopen: true,
        };
      }
      return {
        ok: true,
        write: true,
        step: mode.draft.kind,
        spec,
        partId: mode.partId,
        nextMode: next,
        reopen: false,
      };
    },

    finishSheetCommit(prepared) {
      if (!prepared?.ok) return;
      if (prepared.nextMode) applyMode(prepared.nextMode);
    },

    sheetCancel() {
      const mode = modeRef.current;
      if (pickerRef.current) {
        setPicker(null);
        return { result: { cancelled: true, picker: true } };
      }
      if (!mode) return { error: { code: 'no_sheet_mode', message: 'Sheet metal is not open' } };
      if (mode.exportOpen) {
        applyMode(closeSheetExport(mode));
        return { result: { cancelled: true, check: true } };
      }
      if (mode.draft) {
        applyMode(cancelDraft(mode));
        return { result: { cancelled: true, draft: true } };
      }
      if (mode.stage === 'base') {
        applyMode(backToPlanePick(mode));
        return { result: { cancelled: true, base: true } };
      }
      return { error: { code: 'nothing_to_cancel', message: 'Nothing to cancel in sheet metal' } };
    },

    sheetExit() {
      cancelFeatureEdit?.('sheetMetal');
      setPicker(null);
      applyMode(null);
      return { result: { exited: true } };
    },

    sheetCheck() {
      const mode = modeRef.current;
      if (!mode || mode.stage !== 'edit' || mode.draft) {
        return { error: { code: 'bad_stage', message: 'Check is only available in sheet edit with no open draft' } };
      }
      applyMode(openSheetExport(mode));
      return { result: { check: true } };
    },

    sheetRefold() {
      const mode = modeRef.current;
      if (!mode?.exportOpen) {
        return { error: { code: 'bad_stage', message: 'Flat pattern check is not open' } };
      }
      applyMode(closeSheetExport(mode));
      return { result: { refold: true } };
    },

    prepareSheetDone() {
      const mode = modeRef.current;
      if (!mode || mode.stage !== 'edit' || mode.draft || mode.exportOpen) {
        return { error: { code: 'bad_stage', message: 'Done is not available right now' } };
      }
      const saved = readSheetMetalSpec(readScript());
      const decision = sheetDoneSpec(mode, saved);
      if (!decision.close) {
        return { error: { code: 'commit_failed', message: 'Sheet metal cannot close yet' } };
      }
      return {
        ok: true,
        write: decision.write,
        spec: decision.spec,
        partId: mode.partId,
        closed: true,
        nextMode: null,
      };
    },

    finishSheetDone() {
      cancelFeatureEdit?.('sheetMetal');
      setPicker(null);
      applyMode(null);
    },

    sheetBeginHole() {
      const mode = modeRef.current;
      const draft = mode?.draft;
      if (!draft || draft.kind !== 'hole' || !draft.isNew) {
        return { error: { code: 'bad_stage', message: 'Open a new sheet hole draft first' } };
      }
      applyMode({
        ...mode,
        draft: null,
        toast: null,
        holeSketch: {
          panel: draft.panel,
          type: draft.type || 'hole',
          d: draft.d,
          ...(draft.thread ? { thread: draft.thread } : {}),
          ...(draft.type === 'countersink' ? { cskDia: draft.cskDia, cskAngle: draft.cskAngle ?? 82 } : {}),
        },
      });
      return { result: { hole_sketch: true, panel: draft.panel } };
    },

    async sheetEdit({ chip_id, feature_id, patch } = {}) {
      if (feature_id) {
        const script = readScript();
        const marker = parseFeatureMarkers(script).find((f) => f.id === feature_id && f.kind === 'sheetMetal');
        if (!marker) {
          return { error: { code: 'unknown_feature', message: `No sheet feature ${feature_id}` } };
        }
        const opened = beginFeatureEdit?.(marker, script);
        if (!opened) {
          return { error: { code: 'edit_failed', message: 'Could not open sheet feature edit' } };
        }
      } else if (chip_id) {
        const mode = modeRef.current;
        if (!mode) {
          return { error: { code: 'no_sheet_mode', message: 'Open sheet metal first' } };
        }
        const chips = sheetRibbonChips(readScript(), { stage: mode.stage, spec: mode.spec });
        const chip = chips.find((row) => row.id === chip_id);
        if (!chip) {
          return { error: { code: 'unknown_chip', message: `Unknown sheet chip: ${chip_id}` } };
        }
        selectSheetChip?.(chip);
      }
      if (patch && Object.keys(patch).length) {
        const applied = await this.sheetSetParams({ patch });
        if (applied?.error) return applied;
      }
      const mode = modeRef.current;
      return {
        result: {
          ok: true,
          stage: mode?.stage,
          draft: mode?.draft?.kind || null,
          chip_id: chip_id || null,
        },
      };
    },
  };
}
