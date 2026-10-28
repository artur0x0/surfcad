import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import { BLEND_SIZE_MAX_MM, BLEND_SIZE_MIN_MM } from '../utils/blendSize';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';

/**
 * Fillet / Chamfer on the shared feature card.
 * Tangent (default-on) / Clear / Undo (= last edge pick only) / Confirm.
 * X / Escape / dismiss without Confirm clears all picks and exits.
 * Easy/hard class still chooses the kernel on Confirm; the card does not warn.
 * Picks can span parts; `partCount` > 1 says so, and Confirm writes each part.
 */
const FilletModeChip = ({
  kind = 'fillet',
  edgeCount = 0,
  partCount = 1,
  tangentOn = true,
  params = {},
  pathOk = false,
  componentCount = 0,
  boxCorners = 0,
  compact = false,
  onToggleTangent,
  onClear,
  onAccept,
  onBack,
  onDismiss,
  onParamChange,
  missingLabel = '',
  onClearMissing,
  onDelete = null,
}) => {
  const chamfer = kind === 'chamfer';
  const UI_ACTION = chamfer ? 'data-chamfer-mode-chip' : 'data-fillet-mode-chip';
  const sizeKey = chamfer ? 'chamfer' : 'radius';
  const setSize = (raw) => {
    let v = raw;
    if (raw === '' || raw === '-' || raw === '.') v = raw;
    else {
      const n = Number(raw);
      v = Number.isFinite(n) ? n : params[sizeKey];
    }
    onParamChange?.(
      { ...params, [sizeKey]: v },
      chamfer ? { sizeTouched: true } : { radiusTouched: true },
    );
  };

  const size = params[sizeKey];
  const title = chamfer ? 'Chamfer' : 'Fillet';
  const heading = `${title} · ${edgeCount} edge${edgeCount === 1 ? '' : 's'}`;
  const subtitle = pathOk
    ? (!chamfer && boxCorners > 0
      ? `Box fillet · ${boxCorners} spherical corner${boxCorners === 1 ? '' : 's'} · Confirm commits and exits`
      : componentCount > 1
        ? `${componentCount} independent ${chamfer ? 'chamfers' : 'fillets'} · Confirm commits and exits`
        : (chamfer
          ? 'Sweep chamfer preview · Confirm commits and exits'
          : 'Sweep blend preview · Confirm commits and exits'))
    : edgeCount
      ? (chamfer
        ? 'Path not ready — branched picks need a simple chain (Tangent on)'
        : 'Path not ready — a branched pick needs a simple chain (Tangent on) or straight box edges')
      : (chamfer ? 'Tap edges, then Confirm' : 'Tap edges — shallow blend tessellation is not pickable');

  return (
    <FeatureSheet
      title={heading}
      subtitle={subtitle}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onAccept}
      cardAttrs={{
        'data-edge-blend': chamfer ? 'chamfer' : 'fillet',
        'data-fillet-dismiss': '',
        'data-fillet-accept': 'enabled',
        'data-ui-action': chamfer ? 'data-chamfer-mode-chip' : 'data-fillet-mode-chip',
      }}
      note={onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <LengthNumberField
          id={chamfer ? 'size' : 'radius'}
          label={chamfer ? 'Size' : 'Radius'}
          accent="cyan"
          curve="log"
          valueMm={size}
          onChangeMm={setSize}
          minMm={BLEND_SIZE_MIN_MM}
          maxMm={BLEND_SIZE_MAX_MM}
        />
      </div>
      {partCount > 1 ? (
        <div className="mt-1 font-sans text-[11px] text-gray-300" data-fillet-part-count={partCount}>
          {partCount} parts
        </div>
      ) : null}
      {missingLabel ? (
        <div className="mt-1.5 flex items-center gap-2 font-sans text-[11px] text-gray-200" data-feature-edit-missing="">
          <span>{missingLabel}</span>
          <button
            type="button"
            data-ui-action={UI_ACTION}
            data-feature-edit-clear-missing=""
            className="underline text-cyan-200"
            onClick={() => onClearMissing?.()}
          >
            Clear
          </button>
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-3 font-sans flex-wrap">
        <button
          type="button"
          data-ui-action={UI_ACTION}
          className={`text-[11px] underline ${tangentOn ? 'text-cyan-300' : 'text-gray-300'}`}
          onClick={() => onToggleTangent?.()}
          title="When on, picking one edge adds G1-connected (tangent) edges in the loop"
          aria-pressed={tangentOn}
        >
          Tangent {tangentOn ? 'on' : 'off'}
        </button>
        <button
          type="button"
          data-ui-action={UI_ACTION}
          data-fillet-clear=""
          className="text-[11px] text-gray-200 underline"
          onClick={() => onClear?.()}
          title="Clear all selected edges"
        >
          Clear
        </button>
        <button
          type="button"
          data-ui-action={UI_ACTION}
          data-fillet-back=""
          className="text-[11px] text-gray-200 underline"
          onClick={() => onBack?.()}
          title="Undo"
          aria-label="Undo"
        >
          Undo
        </button>
      </div>
    </FeatureSheet>
  );
};

export default FilletModeChip;
