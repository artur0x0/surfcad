import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { listBodyNames, coerceFilletConfirmNumbers } from '../utils/helperPaletteSnippets';
import {
  minSelectedEdgeLength,
  edgeBlendFailsSizeGuard,
  edgeBlendHardMax,
  EDGE_BLEND_SIZE_GUARD,
  sweepBlendHardMax,
} from '../utils/selectEdge';
import { resolveFilletStrategy } from '../utils/filletAlongPath';
import {
  LengthNumberField, NumberField, SelectField, CheckField, PopupButton, POPUP_TEXT,
} from './controls/popupUI';
import { helperFieldSpec } from '../utils/helperSheetRange';
import { formatDisplayNumber } from '../utils/displayUnit';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { isBlockSolidId } from '../utils/blockSolid';

/** Helper sheets are neutral; the accent chips own cyan/amber. */
const ACCENT = 'slate';
const NO_PARAMS = [];

/**
 * Param sheet for guided helper insert.
 * CAD mounts the shared feature card: X and Esc write nothing, Confirm saves
 * and closes. Game keeps the previous bottom-centre sheet (click-through, no
 * scrim, no card, no slide).
 * Face banner, sliders, refuse, and the live pose preview stay.
 * Confirm → parent builds/inserts; Cancel → no-op.
 */
const HelperParamModal = ({
  item,
  buffer = '',
  onConfirm,
  onCancel,
  faceInfo = null,
  edgeInfo = null,
  refuseMessage = null,
  refuseTitle = null,
  onValuesChange = null,
  onDelete = null,
  /** CAD feature card. Game passes false and keeps the docked sheet. */
  useCard = false,
  compact = false,
  lengthMm = 100,
  bounds = null,
  minExtent = null,
  onMeasure = null,
}) => {
  const params = useMemo(() => item?.params ?? NO_PARAMS, [item]);
  const bodies = useMemo(() => listBodyNames(buffer), [buffer]);

  const initial = useMemo(() => {
    const o = {};
    const saved = !!item?._featureEdit;
    for (const p of params) {
      if (p.type === 'body') {
        o[p.name] = bodies.includes(p.default) ? p.default : (bodies[0] || 'part');
      } else if (p.type === 'number') {
        const spec = helperFieldSpec(item?.id, p, {
          lengthMm, face: faceInfo, bounds, minExtent, edges: edgeInfo, saved, values: o,
        });
        o[p.name] = spec ? spec.seed : p.default;
      } else {
        o[p.name] = p.default;
      }
    }
    return o;
  }, [item, params, faceInfo, edgeInfo, lengthMm, bounds, minExtent, bodies]);

  const [values, setValues] = useState(initial);
  const [measured, setMeasured] = useState({});

  useEffect(() => {
    setValues(initial);
    setMeasured({});
  }, [initial]);

  // Slice 21: live param preview (cross-section profile on plane).
  useEffect(() => {
    if (typeof onValuesChange === 'function' && item) {
      onValuesChange(values, item);
    }
  }, [values, item, onValuesChange]);

  const minEdgeLength = useMemo(
    () => (item?._minEdgeLength != null ? item._minEdgeLength : minSelectedEdgeLength(edgeInfo)),
    [item?._minEdgeLength, edgeInfo],
  );

  // Game keeps the docked sheet: BOTTOM-CENTRE OF THE VIEWPORT, not the
  // screen. `absolute` resolves against the viewport shell (this modal renders
  // as a sibling of the helper rail inside it), so the panel lands between the
  // two bottom rails instead of covering them. The overlay is click-through
  // (`pointer-events-none`) and undimmed so the part, the rails and the live
  // preview all stay visible and usable while you tune params — which also
  // means there is no click-outside-to-cancel; the X and Cancel buttons are
  // the way out. CAD uses the shared feature card instead (no overlay).
  const refuseHeading = refuseTitle
    || (/edge/i.test(refuseMessage || '') ? 'Select edges' : 'Face not supported');
  if (refuseMessage && useCard) {
    return (
      <FeatureSheet
        title={refuseHeading}
        compact={compact}
        onCancel={onCancel}
        onConfirm={onCancel}
        confirmLabel="OK"
        cardAttrs={{
          id: 'helper-refuse-title',
          'data-helper-refuse': '1',
        }}
      >
        <div className="flex items-start gap-2 py-1 text-sm leading-relaxed text-gray-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
          <p>{refuseMessage}</p>
        </div>
      </FeatureSheet>
    );
  }
  if (refuseMessage) {
    return (
      <div
        className="absolute inset-0 z-50 flex items-end justify-center p-3 pointer-events-none"
        role="presentation"
      >
        <div
          role="alertdialog"
          aria-labelledby="helper-refuse-title"
          className="pointer-events-auto w-full max-w-sm max-h-[min(70%,calc(100dvh-11rem))] mb-1 overflow-hidden flex flex-col rounded-lg surface-glass border border-amber-700/60 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-chrome-border shrink-0">
            <div className="min-w-0 flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-400 shrink-0" />
              <h2 id="helper-refuse-title" className="font-semibold text-sm text-white truncate">
                {refuseHeading}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onCancel?.()}
              className="p-1.5 rounded text-chrome-secondary hover:text-white hover:bg-gray-800 shrink-0"
              title="Close"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-4 text-sm text-gray-200 leading-relaxed">
            {refuseMessage}
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-chrome-border shrink-0">
            <PopupButton accent={ACCENT} onClick={() => onCancel?.()}>
              OK
            </PopupButton>
          </div>
        </div>
      </div>
    );
  }

  if (!item) return null;

  const setField = (name, raw, type) => {
    setValues((prev) => {
      let v = raw;
      if (type === 'number') {
        if (raw === '' || raw === '-' || raw === '.') {
          v = raw;
        } else {
          const n = Number(raw);
          v = Number.isFinite(n) ? n : prev[name];
        }
      } else if (type === 'bool') {
        v = !!raw;
      }
      const next = { ...prev, [name]: v };
      if (
        isBlockSolidId(item?.id)
        && Object.prototype.hasOwnProperty.call(prev, 'center')
        && ['x', 'y', 'z', 'rx', 'ry', 'rz'].includes(name)
        && type === 'number'
        && v !== prev[name]
      ) {
        next.center = false;
      }
      return next;
    });
  };

  const blendParamName = params.some((p) => p.name === 'radius')
    ? 'radius'
    : (params.some((p) => p.name === 'chamfer') ? 'chamfer' : null);

  // Planar-only size guard. Strategy=sweep (default / auto) / filletAlongPath must
  // not inherit the 0.45·L clamp (tessellated prior-fillet rims pin ~0.04).
  const hasStrategy = params.some((p) => p.name === 'strategy');
  const resolvedStrategy = hasStrategy
    ? resolveFilletStrategy(values.strategy, edgeInfo)
    : 'planar';
  // Strategy wins over the open-time _blendSizeGuard flag so switching
  // planar↔sweep in the modal correctly enables/disables the planar clamp.
  const applySizeGuard = (
    resolvedStrategy !== 'sweep'
    && blendParamName != null
    && minEdgeLength != null
  );

  const blendRaw = blendParamName != null ? values[blendParamName] : null;
  const blendNum = Number(blendRaw);
  const sizeGuardFail = (
    applySizeGuard
    && Number.isFinite(blendNum)
    && edgeBlendFailsSizeGuard(blendNum, minEdgeLength)
  );
  const safeBlendMax = minEdgeLength != null ? edgeBlendHardMax(minEdgeLength) : null;
  const sweepMax = item?._sweepBlendMax != null
    ? item._sweepBlendMax
    : sweepBlendHardMax(item?._pathLength ?? minEdgeLength);

  const sheetCtx = {
    lengthMm,
    face: faceInfo,
    bounds,
    minExtent,
    edges: edgeInfo,
    saved: !!item?._featureEdit,
    travelByName: measured,
  };
  const handleConfirm = () => {
    // Resolve strategy BEFORE number coercion — open-time planar p.max must not
    // silently clamp a typed radius after the user switches Strategy→sweep.
    const confirmStrategy = hasStrategy
      ? resolveFilletStrategy(values.strategy, edgeInfo)
      : 'planar';
    const specParams = params.map((p) => {
      if (p.type !== 'number') return p;
      const spec = helperFieldSpec(item.id, p, { ...sheetCtx, values });
      if (!spec) return p;
      return { ...p, default: spec.seed, min: spec.min, max: spec.max };
    });
    const out = coerceFilletConfirmNumbers(values, specParams, {
      strategy: confirmStrategy,
      sweepMax,
    });
    // Clamp under planar size guard only — never for Strategy=sweep.
    if (
      confirmStrategy !== 'sweep'
      && blendParamName
      && minEdgeLength != null
      && edgeBlendFailsSizeGuard(out[blendParamName], minEdgeLength)
      && safeBlendMax != null
    ) {
      out[blendParamName] = safeBlendMax;
    }
    onConfirm?.(out);
  };

  // Hole sheets hide Depth while Through is on. Cube and tube also have a
  // Depth field and no Through switch — those stay visible.
  const hasThrough = params.some((x) => x.name === 'through');
  const showDepth = values.through === false || values.through === 'false';
  const showPattern = !!values.usePattern;
  const placementCenter = !values.placement || values.placement === 'center';
  const profileType = values.profileType || 'circle';
  const ruleHolds = (rule) => {
    if (!rule) return true;
    const rules = Array.isArray(rule) ? rule : [rule];
    return rules.every((one) => (one.values || []).includes(values[one.field]));
  };
  const optionValue = (opt) => (opt && typeof opt === 'object' ? opt.value : opt);
  const optionLabel = (opt) => (opt && typeof opt === 'object' ? (opt.label ?? opt.value) : opt);
  const visibleParams = params.filter((p) => {
    if (p.showWhen && !ruleHolds(p.showWhen)) return false;
    if (hasThrough && p.name === 'depth' && !showDepth) return false;
    if (['n', 'm', 'spacingU', 'spacingV'].includes(p.name) && params.some((x) => x.name === 'usePattern') && !showPattern) {
      return false;
    }
    // Center placement → hide custom U/V (still emitted as 0,0).
    if ((p.name === 'u' || p.name === 'v') && params.some((x) => x.name === 'placement') && placementCenter) {
      return false;
    }
    // Slice 21: show only params relevant to the selected profile type.
    if (params.some((x) => x.name === 'profileType')) {
      if (profileType === 'circle') {
        if (['width', 'height', 'centered', 'polygonPreset'].includes(p.name)) return false;
      } else if (profileType === 'rectangle') {
        if (['radius', 'segments', 'polygonPreset'].includes(p.name)) return false;
      } else if (profileType === 'polygon') {
        if (['width', 'height', 'centered', 'segments'].includes(p.name)) return false;
      }
    }
    return true;
  });

  const banners = (
    <>
      {faceInfo && (
        <div className="px-4 py-2 border-b border-cyan-900/50 bg-cyan-950/40 text-[11px] text-cyan-100/90 shrink-0">
          <span className="font-semibold uppercase tracking-wide text-cyan-300">
            {faceInfo.type} face
          </span>
          {' · '}
          n {faceInfo.normal.map((v) => formatDisplayNumber(v)).join(', ')}
          {' · '}
          c {faceInfo.center.map((v) => formatDisplayNumber(v)).join(', ')}
        </div>
      )}

      {edgeInfo && edgeInfo.length > 0 && (
        <div className="px-4 py-2 border-b border-amber-900/50 bg-amber-950/40 text-[11px] text-amber-100/90 shrink-0">
          <span className="font-semibold uppercase tracking-wide text-amber-300">
            {edgeInfo.length} edge{edgeInfo.length === 1 ? '' : 's'} selected
          </span>
          {' · '}
          Fillet/Chamfer will use the picked set
          {minEdgeLength != null && (
            <>
              {' · '}
              min L={formatDisplayNumber(minEdgeLength)}{item?._minEdgeLength != null ? ' (effective)' : ''}
              {applySizeGuard && (
                <>
                  {' · '}
                  keep r &lt; {formatDisplayNumber(EDGE_BLEND_SIZE_GUARD * minEdgeLength)} (planar)
                </>
              )}
              {resolvedStrategy === 'sweep' && (
                <>
                  {' · '}
                  sweep — no 0.45·L clamp (max {formatDisplayNumber(sweepMax)})
                </>
              )}
            </>
          )}
        </div>
      )}

      {sizeGuardFail && (
        <div className="px-4 py-2 border-b border-red-900/50 bg-red-950/50 text-[11px] text-red-100 shrink-0 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">{blendParamName === 'chamfer' ? 'Chamfer' : 'Radius'} {formatDisplayNumber(blendNum)}</span>
            {' ≥ '}
            size guard ({EDGE_BLEND_SIZE_GUARD}× min L = {formatDisplayNumber(EDGE_BLEND_SIZE_GUARD * minEdgeLength)}).
            {' '}Confirm will clamp to {formatDisplayNumber(safeBlendMax)}.
          </div>
        </div>
      )}
    </>
  );

  const fields = (
    <>
      {visibleParams.length === 0 && (
        <p className="text-xs text-chrome-secondary">No options — confirm to insert.</p>
      )}
      {visibleParams.map((p) => {
        if (p.type === 'bool') {
          return (
            <CheckField
              key={p.name}
              label={p.label}
              accent={ACCENT}
              checked={!!values[p.name]}
              onChange={(v) => setField(p.name, v, 'bool')}
            />
          );
        }
        if (p.type === 'select' || p.type === 'body') {
          return (
            <SelectField
              key={p.name}
              label={p.label}
              accent={ACCENT}
              value={String(values[p.name] ?? p.default)}
              onChange={(v) => setField(p.name, v, p.type)}
              options={(p.type === 'body' ? bodies : p.options || []).map((opt) => ({
                value: optionValue(opt),
                label: optionLabel(opt),
              }))}
            />
          );
        }
        const spec = helperFieldSpec(item.id, p, { ...sheetCtx, values });
        if (spec?.shaped) {
          return (
            <LengthNumberField
              key={p.name}
              id={p.name}
              label={p.label}
              accent={ACCENT}
              valueMm={values[p.name]}
              onChangeMm={(v) => setField(p.name, v, 'number')}
              minMm={spec.min}
              maxMm={spec.max}
              signed={spec.signed}
              curve={spec.curve === 'log' ? 'log' : 'shape'}
              onPointerDown={spec.measure ? () => {
                const d = onMeasure?.(spec.measure);
                if (!Number.isFinite(Number(d))) return;
                setMeasured((prev) => ({ ...prev, [p.name]: Number(d) }));
              } : undefined}
            />
          );
        }
        return (
          <NumberField
            key={p.name}
            id={p.name}
            label={p.label}
            accent={ACCENT}
            value={values[p.name]}
            onChange={(v) => setField(p.name, v, 'number')}
            min={spec?.min ?? (p.min ?? 0)}
            max={spec?.max ?? (p.max ?? 100)}
            step={spec?.step ?? (p.step ?? 1)}
          />
        );
      })}
    </>
  );

  if (useCard) {
    return (
      <FeatureSheet
        title={item.label}
        subtitle={item.title || ''}
        compact={compact}
        onCancel={onCancel}
        onConfirm={handleConfirm}
        confirmLabel={sizeGuardFail ? `Clamp & Confirm (${formatDisplayNumber(safeBlendMax)})` : 'Confirm'}
        cardAttrs={{
          id: 'helper-param-title',
          'data-helper-param': item.id,
          'data-helper-length': String(lengthMm),
        }}
        note={onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
      >
        {banners}
        <div className="space-y-3 py-1 text-sm text-gray-200">
          {fields}
        </div>
      </FeatureSheet>
    );
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center p-3 pointer-events-none"
      role="presentation"
    >
      <div
        role="dialog"
        aria-labelledby="helper-param-title"
        className="pointer-events-auto w-full max-w-sm max-h-[min(70%,calc(100dvh-11rem))] mb-1 overflow-hidden flex flex-col rounded-lg surface-glass border border-chrome-border shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-chrome-border shrink-0">
          <div className="min-w-0">
            <h2 id="helper-param-title" className={`${POPUP_TEXT.title} text-white truncate`}>
              {item.label}
            </h2>
            <p className={`${POPUP_TEXT.subtitle} text-chrome-secondary truncate`} title={item.title}>
              {item.title}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="p-1.5 rounded text-chrome-secondary hover:text-white hover:bg-gray-800 shrink-0"
            title="Cancel"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        {banners}

        <div className="overflow-y-auto min-h-0 flex-1 p-4 space-y-3 text-sm text-gray-200">
          {fields}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-chrome-border shrink-0">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <div className="ml-auto flex items-center gap-2">
          <PopupButton accent={ACCENT} onClick={() => onCancel?.()}>
            Cancel
          </PopupButton>
          <PopupButton
            variant="primary"
            accent={sizeGuardFail ? 'amber' : ACCENT}
            onClick={handleConfirm}
            title={sizeGuardFail ? `Clamp to ${formatDisplayNumber(safeBlendMax)} and insert` : 'Confirm insert'}
          >
            <Check size={16} />
            {sizeGuardFail ? `Clamp & Confirm (${formatDisplayNumber(safeBlendMax)})` : 'Confirm'}
          </PopupButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelperParamModal;
