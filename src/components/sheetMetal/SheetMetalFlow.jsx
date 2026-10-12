import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SHEET_PLANES } from '../../utils/sheetMetal/sheetModel';
import {
  acceptBaseFlange,
  acceptDraft,
  backToPlanePick,
  BASE_MAX,
  baseSliderRange,
  bendDeductionAt,
  bendBlockReason,
  bendLimits,
  cancelDraft,
  closeSheetExport,
  deleteDraftFeature,
  holeRange,
  openSheetExport,
  pickSheetPlane,
  pushSheetHistory,
  setBaseDims,
  sheetDraftExtraCount,
  sheetStepCount,
  TAP_SIZES,
  undoSheetStep,
  updateDraft,
} from '../../utils/sheetMetal/sheetMetalMode';
import { contourDeleteConfirmLabel } from '../../utils/contourUsers';
import ContourDeleteDialog from '../ContourDeleteDialog';
import ErrorPopup from '../ErrorPopup';
import { buildSheetExport } from '../../utils/sheetMetal/sheetExport';
import { formatSheetLength } from '../../utils/sheetMetal/sheetUnits';
import { useDisplayUnit } from '../../hooks/useDisplayUnit';
import SheetMetalModeChip from './SheetMetalModeChip';
import { SmButton, SmMmSlider, SmPopup, SmSelect, SmSlider, SmToggle } from './SmControls';
import { FeatureDeleteButton } from '../FeatureEditDelete';

/**
 * Sheet-metal flow chrome by stage. Viewport owns the mode state, overlay
 * and taps; this renders the chip / translucent popups and calls
 * onCommit(spec) → boolean when a step writes the part script.
 */
const EDGE_NAMES = { 'u+': '+X edge', 'u-': '−X edge', 'v+': '+Y edge', 'v-': '−Y edge' };

/** Accept / Back / Delete footer shared by feature popups. */
const DraftFooter = ({ mode, setMode, onCommit, onDelete, confirmDisabled = false }) => (
  <div className="flex flex-wrap items-center gap-2">
    {!mode.draft.isNew && (
      <SmButton
        variant="danger"
        className="mr-auto"
        data-sm-delete="1"
        onClick={() => onDelete?.()}
      >
        Delete
      </SmButton>
    )}
    <SmButton onClick={() => setMode((m) => cancelDraft(m))} data-sm-back="1">Back</SmButton>
    <SmButton
      variant="primary"
      data-sm-accept="1"
      disabled={confirmDisabled}
      onClick={() => {
        if (confirmDisabled) return;
        const { mode: next, spec } = acceptDraft(mode);
        if (!spec) return;
        if (mode.reopen) {
          setMode((m) => pushSheetHistory(m, spec));
          return;
        }
        if (onCommit?.(spec, { step: mode.draft.kind }) !== false) setMode(() => next);
      }}
    >
      Confirm
    </SmButton>
  </div>
);

const BendPopup = ({ mode, setMode, onCommit, onDelete, onExit, unit, onUnit, compact = false }) => {
  const d = mode.draft;
  const spec = mode.spec;
  const lim = bendLimits(spec);
  const bd = bendDeductionAt(spec, d.angle);
  const place = d.edge === 'u+' ? 'tip' : (d.edge === 'v+' || d.edge === 'v-') ? 'side' : (d.edge || '');
  const where = d.panel === 'base' ? `Base ${EDGE_NAMES[d.edge] || d.edge}` : `Flange ${d.panel} ${place}`;
  const block = bendBlockReason(mode);
  return (
    <SmPopup
      title={d.isNew ? 'Bend' : `Bend ${d.id}`}
      subtitle={where}
      onClose={onExit}
      closeLabel="Exit sheet metal without writing this bend"
      dataAttr="data-sheet-metal-bend"
      unit={unit}
      onUnit={onUnit}
      compact={compact}
      footer={<DraftFooter mode={mode} setMode={setMode} onCommit={onCommit} onDelete={onDelete} confirmDisabled={!!block} />}
    >
      {block && (
        <p className="text-sm text-red-200" data-sm-bend-block="1">{block}</p>
      )}
      <SmSlider
        id="sm-bend-angle"
        label={`Angle (max ${lim.angleMax}°)`}
        unit="°"
        value={d.angle}
        min={lim.angleMin}
        max={lim.angleMax}
        step={1}
        onChange={(v) => setMode((m) => updateDraft(m, { angle: v }))}
      />
      <SmMmSlider
        id="sm-bend-length"
        label={`Flange length (min ${formatSheetLength(lim.lengthMin, unit)})`}
        mm={d.length}
        minMm={lim.lengthMin}
        maxMm={lim.lengthMax}
        unit={unit}
        onMm={(v) => setMode((m) => updateDraft(m, { length: v }))}
      />
      <SmButton
        onClick={() => setMode((m) => updateDraft(m, { flip: !m.draft.flip }))}
        aria-pressed={!!d.flip}
        data-sm-flip="1"
        className={d.flip ? '!bg-cyan-600/40' : ''}
      >
        Flip {d.flip ? '(down)' : '(up)'}
      </SmButton>
      <div className="text-xs text-gray-300 leading-relaxed" data-sm-bend-specs="1">
        R {formatSheetLength(spec.r, unit)} · K {spec.k} · BD {formatSheetLength(bd, unit)} @ {Math.round(d.angle)}° · reliefs automatic
      </div>
    </SmPopup>
  );
};

const TabPopup = ({ mode, setMode, onCommit, onDelete, onExit, unit, onUnit, compact = false, lengthMm = 100 }) => {
  const d = mode.draft;
  const span = Number(d.span) || Math.max(d.width, 1);
  const where = d.panel === 'base' ? `Base ${EDGE_NAMES[d.edge] || d.edge}` : `Flange ${d.panel} ${d.edge === 'u+' ? 'tip' : 'side'}`;
  return (
    <SmPopup
      title={d.isNew ? 'Tab' : `Tab ${d.id}`}
      subtitle={`${where} · edge ${formatSheetLength(span, unit, 1)}`}
      onClose={onExit}
      closeLabel="Exit sheet metal without writing this tab"
      dataAttr="data-sheet-metal-tab"
      unit={unit}
      onUnit={onUnit}
      compact={compact}
      footer={<DraftFooter mode={mode} setMode={setMode} onCommit={onCommit} onDelete={onDelete} />}
    >
      <SmMmSlider id="sm-tab-width" label="Width" mm={d.width} minMm={1} maxMm={span} unit={unit}
        onMm={(v) => setMode((m) => updateDraft(m, { width: v }))} />
      <SmMmSlider id="sm-tab-depth" label="Depth" mm={d.depth} minMm={0.5} maxMm={Math.max(0.5 * lengthMm, Number(d.depth) || 0)} unit={unit}
        onMm={(v) => setMode((m) => updateDraft(m, { depth: v }))} />
      <SmToggle id="sm-tab-centered" label="Centered" checked={d.centered !== false}
        onChange={(v) => setMode((m) => updateDraft(m, { centered: v }))} />
      {d.centered === false && (
        <SmMmSlider id="sm-tab-offset" label="Offset from edge start" mm={d.offset ?? 0} minMm={0}
          maxMm={Math.max(0, span - d.width)} unit={unit}
          onMm={(v) => setMode((m) => updateDraft(m, { offset: v }))} />
      )}
    </SmPopup>
  );
};

const HOLE_TITLES = { hole: 'Hole', countersink: 'Countersunk hole', tapped: 'Tapped hole' };

const HolePopup = ({ mode, setMode, onCommit, onDelete, onExit, unit, onUnit, compact = false, lengthMm = 100 }) => {
  const d = mode.draft;
  const range = holeRange(mode) || { u0: -50, u1: 50, v0: -50, v1: 50 };
  const minHole = Number(mode.spec.limits?.minHole) || 0;
  const type = d.type || 'hole';
  return (
    <SmPopup
      title={d.isNew ? HOLE_TITLES[type] : `${HOLE_TITLES[type]} ${d.id}`}
      subtitle={`${d.panel === 'base' ? 'Base' : `Flange ${d.panel}`} face${minHole ? ` · SKU min Ø ${formatSheetLength(minHole, unit)}` : ''}`}
      onClose={onExit}
      closeLabel="Exit sheet metal without writing this hole"
      dataAttr="data-sheet-metal-hole"
      unit={unit}
      onUnit={onUnit}
      compact={compact}
      footer={<DraftFooter mode={mode} setMode={setMode} onCommit={onCommit} onDelete={onDelete} />}
    >
      {type === 'tapped' ? (
        <SmSelect id="sm-hole-thread" label="Thread" value={d.thread}
          options={TAP_SIZES.map((x) => ({ value: x.id, label: `${x.id} (drill Ø ${formatSheetLength(x.tap, unit)})` }))}
          onChange={(v) => setMode((m) => updateDraft(m, { thread: v }))} />
      ) : (
        <SmMmSlider id="sm-hole-d" label="Diameter" mm={d.d} minMm={Math.max(0.5, minHole)} maxMm={Math.max(0.4 * lengthMm, Number(d.d) || 0, Math.max(0.5, minHole))} unit={unit}
          onMm={(v) => setMode((m) => updateDraft(m, { d: v }))} />
      )}
      {type === 'countersink' && (
        <SmMmSlider id="sm-hole-csk" label="Countersink Ø (82°)" mm={d.cskDia} minMm={d.d} maxMm={Math.max(d.d * 3, d.cskDia)} unit={unit}
          onMm={(v) => setMode((m) => updateDraft(m, { cskDia: v }))} />
      )}
      <SmMmSlider id="sm-hole-u" label="Position along U" mm={d.u} minMm={range.u0} maxMm={range.u1} unit={unit}
        onMm={(v) => setMode((m) => updateDraft(m, { u: v }))} />
      <SmMmSlider id="sm-hole-v" label="Position along V" mm={d.v} minMm={range.v0} maxMm={range.v1} unit={unit}
        onMm={(v) => setMode((m) => updateDraft(m, { v: v }))} />
    </SmPopup>
  );
};


/** DFM, flat size, and the STEP source. Downloads and Order live on the quote handoff. */
const ExportPopup = ({ mode, setMode, mesh, script, partName, unit, onUnit, compact = false }) => {
  const bundle = React.useMemo(
    () => buildSheetExport(mode.spec, { mesh: mesh || null, script: script ?? null, partName: partName || mode.partId || 'sheet', unit }),
    [mode.spec, mode.partId, partName, mesh, script, unit],
  );
  const { dfm, files, blocked, flat, stepSource } = bundle;
  const bendCount = files.step?.stats?.bendFaces ? files.step.stats.bendFaces / 2 : 0;
  const fails = dfm.issues.filter((x) => x.level === 'fail');
  const warns = dfm.issues.filter((x) => x.level === 'warn');
  const size = flat?.size;
  const close = () => setMode((m) => closeSheetExport(m));
  return (
    <SmPopup
      title="Check & Export"
      subtitle={blocked
        ? `${fails.length} issue${fails.length === 1 ? '' : 's'} block export`
        : warns.length
          ? `Ready · ${warns.length} warning${warns.length === 1 ? '' : 's'}`
          : 'Ready for SendCutSend'}
      onClose={close}
      closeLabel="Close export"
      dataAttr="data-sheet-metal-export"
      unit={unit}
      onUnit={onUnit}
      compact={compact}
    >
      {size && (
        <p className="text-xs text-gray-300" data-sm-flat-size="1">
          Flat {formatSheetLength(size[0], unit, 1)} × {formatSheetLength(size[1], unit, 1)}
          {mode.spec?.sku ? ` · ${mode.spec.sku}` : ''}
        </p>
      )}
      {dfm.issues.length === 0 && (
        <p className="text-sm text-emerald-300" data-sm-dfm-ok="1">All SCS checks passed.</p>
      )}
      {fails.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-sm-dfm-fails="1">
          {fails.map((iss, i) => (
            <li key={`f${i}`} className="rounded-md bg-red-950/70 border border-red-500/50 px-3 py-2 text-sm text-red-100">
              <span className="font-semibold uppercase text-[10px] tracking-wide text-red-300 mr-2">{iss.rule}</span>
              {iss.message}
            </li>
          ))}
        </ul>
      )}
      {warns.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-sm-dfm-warns="1">
          {warns.map((iss, i) => (
            <li key={`w${i}`} className="rounded-md bg-amber-950/50 border border-amber-500/40 px-3 py-2 text-sm text-amber-100">
              <span className="font-semibold uppercase text-[10px] tracking-wide text-amber-300 mr-2">{iss.rule}</span>
              {iss.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-gray-400" data-sm-step-source={stepSource || 'none'}>
        DXF is the flat cut (mm). STEP is the bent 3D part
        {stepSource === 'spec' ? `, built from the sheet spec with exact bends${bendCount ? ` (${bendCount} cylindrical)` : ''}` : ''}
        {stepSource === 'mesh' ? ', faceted from the 3D part' : ''}
        . Upload either at app.sendcutsend.com.
      </p>
    </SmPopup>
  );
};

const TOOL_HINTS = {
  tab: 'Tap an orange edge to add a tab, or a tab to edit it.',
  bend: 'Tap an orange edge to bend it, or a bend to edit it.',
  hole: 'Tap a face to place a hole, or a hole to edit it.',
  countersink: 'Tap a face to place a countersunk hole.',
  tapped: 'Tap a face to place a tapped hole.',
};

const SheetMetalFlow = ({
  mode, setMode, onCommit, onConfirm, onExit, compact = false, mesh = null, script = null, partName = '',
  onDeleteFeature = null, onUndo = null, canUndo = false, lengthMm = 100,
}) => {
  const [unit, setDisplayUnit] = useDisplayUnit();
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteToast, setDeleteToast] = useState(null);
  const deleteToastTimer = useRef(null);
  const onUnit = (next) => setDisplayUnit(next);

  const armDeleteToast = (text) => {
    setDeleteToast(text);
    if (deleteToastTimer.current) clearTimeout(deleteToastTimer.current);
    deleteToastTimer.current = setTimeout(() => {
      deleteToastTimer.current = null;
      setDeleteToast(null);
    }, 3200);
  };

  const commitSheetDelete = () => {
    if (!mode?.draft) return;
    const { mode: next, spec } = deleteDraftFeature(mode);
    setDeleteConfirm(null);
    if (!spec) {
      setMode(() => next);
      return;
    }
    if (mode.reopen) {
      setMode((m) => pushSheetHistory(m, spec));
    } else if (onCommit?.(spec, { step: `delete-${mode.draft.kind}` }) === false) {
      return;
    } else {
      setMode(() => next);
    }
    armDeleteToast('Deleted.');
  };

  const requestSheetDelete = () => {
    const extra = sheetDraftExtraCount(mode);
    if (extra > 0) {
      setDeleteConfirm({ label: contourDeleteConfirmLabel(extra) });
      return;
    }
    commitSheetDelete();
  };

  const deleteChrome = (node) => (
    <>
      {node}
      <ContourDeleteDialog
        open={!!deleteConfirm}
        label={deleteConfirm?.label || ''}
        title="Delete feature"
        message="Later sheet features sit on this one. Deleting it removes those features too."
        testId="sm"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={commitSheetDelete}
      />
      {deleteToast && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]"
          data-sm-delete-toast=""
          data-delete-undo-toast=""
        >
          <ErrorPopup
            tone="cyan"
            role="status"
            onDismiss={() => setDeleteToast(null)}
            onUndo={() => {
              if (mode?.reopen) setMode((m) => undoSheetStep(m));
              else onUndo?.();
            }}
            canUndo={mode?.reopen ? mode.step > 0 : !!canUndo}
            roomy
            className="px-3 py-2 pointer-events-auto"
          >
            {deleteToast}
          </ErrorPopup>
        </div>,
        document.body,
      )}
    </>
  );

  if (!mode) return null;

  if (mode.stage === 'edit' && mode.exportOpen) {
    return deleteChrome(<ExportPopup mode={mode} setMode={setMode} mesh={mesh} script={script} partName={partName} unit={unit} onUnit={onUnit} compact={compact} />);
  }

  if (mode.stage === 'edit' && mode.draft?.kind === 'bend') {
    return deleteChrome(<BendPopup mode={mode} setMode={setMode} onCommit={onCommit} onDelete={requestSheetDelete} onExit={onExit} unit={unit} onUnit={onUnit} compact={compact} />);
  }
  if (mode.stage === 'edit' && mode.draft?.kind === 'tab') {
    return deleteChrome(<TabPopup mode={mode} setMode={setMode} onCommit={onCommit} onDelete={requestSheetDelete} onExit={onExit} unit={unit} onUnit={onUnit} compact={compact} lengthMm={lengthMm} />);
  }
  if (mode.stage === 'edit' && mode.draft?.kind === 'hole') {
    return deleteChrome(<HolePopup mode={mode} setMode={setMode} onCommit={onCommit} onDelete={requestSheetDelete} onExit={onExit} unit={unit} onUnit={onUnit} compact={compact} lengthMm={lengthMm} />);
  }

  if (mode.stage === 'base' && mode.base) {
    const plane = SHEET_PLANES[mode.base.plane];
    const ends = baseSliderRange(mode.sku);
    return deleteChrome(
      <SmPopup
        title="Base flange"
        subtitle={`${plane?.label || mode.base.plane} plane · ${formatSheetLength(mode.sku?.thicknessMm, unit)} ${mode.sku?.name || ''}`}
        onClose={onExit}
        closeLabel="Exit sheet metal without writing"
        dataAttr="data-sheet-metal-base"
        unit={unit}
        onUnit={onUnit}
        compact={compact}
        cardAttrs={{ 'data-sheet-length': lengthMm }}
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SmButton onClick={() => setMode((m) => backToPlanePick(m))} data-sm-back="1">Back</SmButton>
            <SmButton
              variant="primary"
              data-sm-accept="1"
              onClick={() => {
                const { mode: next, spec } = acceptBaseFlange(mode);
                if (spec && onCommit?.(spec, { step: 'base' }) !== false) setMode(() => next);
              }}
            >
              Confirm
            </SmButton>
          </div>
        )}
      >
        <SmMmSlider
          id="sm-base-x"
          label="X (width)"
          mm={mode.base.width}
          minMm={ends.widthMin}
          maxMm={ends.max}
          unit={unit}
          onMm={(v) => setMode((m) => setBaseDims(m, { width: v }))}
        />
        <SmMmSlider
          id="sm-base-y"
          label="Y (height)"
          mm={mode.base.height}
          minMm={ends.heightMin}
          maxMm={ends.max}
          unit={unit}
          onMm={(v) => setMode((m) => setBaseDims(m, { height: v }))}
        />
        <p className="text-xs text-gray-400">Up to {formatSheetLength(BASE_MAX, unit, 0)}. Thickness comes from the SKU. Stored in mm.</p>
      </SmPopup>,
    );
  }

  return deleteChrome(
    <SheetMetalModeChip mode={mode} compact={compact} onDismiss={onExit}>
      {mode.stage === 'plane' && (
        <div className="mt-1.5 font-sans" data-sheet-metal-step="plane">
          <div className="text-[12px] text-orange-100">Tap a plane for the base flange</div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {Object.values(SHEET_PLANES).map((p) => (
              <SmButton
                key={p.id}
                className="!px-2"
                onClick={() => setMode((m) => pickSheetPlane(m, p.id, lengthMm))}
                data-sm-plane={p.id}
              >
                {p.label}
              </SmButton>
            ))}
          </div>
        </div>
      )}
      {mode.stage === 'edit' && (
        <div
          className="mt-1.5 font-sans"
          data-sheet-metal-step="edit"
          data-sm-reopen={mode.reopen ? '1' : '0'}
          data-sm-step={Number.isInteger(mode.step) ? mode.step : ''}
          data-sm-step-count={sheetStepCount(mode.spec)}
          data-sm-bends={mode.spec?.bends?.length || 0}
          data-sm-tabs={mode.spec?.tabs?.length || 0}
          data-sm-holes={mode.spec?.holes?.length || 0}
        >
          <div className="text-[12px] text-orange-100 whitespace-normal break-words" data-sm-hint="">
            {TOOL_HINTS[mode.tool] || 'Pick a tool on the left rail.'}
          </div>
          {mode.toast && <div className="mt-1 text-[12px] text-amber-200" data-sm-toast="1">{mode.toast}</div>}
          {mode.reopen && (
            <div className="mt-2 flex items-center gap-2">
              <SmButton
                data-sm-undo="1"
                title="Undo the last bend or feature"
                onClick={() => setMode((m) => undoSheetStep(m))}
              >
                Undo
              </SmButton>
              <SmButton
                variant="primary"
                className="flex-1"
                data-sm-confirm="1"
                title="Write this sheet and close"
                onClick={() => onConfirm?.()}
              >
                Confirm
              </SmButton>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            {onDeleteFeature ? <FeatureDeleteButton onClick={onDeleteFeature} /> : null}
            <SmButton
              variant="primary"
              className={onDeleteFeature ? 'flex-1' : 'w-full'}
              data-sm-export="1"
              onClick={() => setMode((m) => openSheetExport(m))}
            >
              Check &amp; Export
            </SmButton>
          </div>
        </div>
      )}
    </SheetMetalModeChip>,
  );
};

export default SheetMetalFlow;
