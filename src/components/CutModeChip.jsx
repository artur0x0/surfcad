import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { CUT_EXPLICIT_PLANES, cutPlaneFromState } from '../utils/cutMode';
import { cutTravelMm, travelRangeMm } from '../utils/sliderRange';

const ACCENT = 'cyan';

/**
 * Cut on the shared feature card.
 * Plane is a planar face or an explicit XY / YZ / ZX plane.
 * Bodies and pieces use the Shell sticky picker: tap to add, tap again to
 * remove, Undo drops the last pick, Clear drops that list.
 * Offset is along the plane normal for a face and for XY / YZ / ZX.
 * Pieces: each resulting piece gets its own color; tap hides it, tap again
 * brings it back. Undo drops the last hide. Clear unhides every piece.
 * Confirm writes one cut(); X exits with no write.
 */
const CutModeChip = ({
  state = null,
  compact = false,
  onPlaneSource,
  onOffset,
  onPickTarget,
  onUndo,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
  bounds = null,
  lengthMm = 100,
}) => {
  const source = state?.planeSource === 'xy' || state?.planeSource === 'yz' || state?.planeSource === 'zx'
    ? state.planeSource
    : 'face';
  const pick = state?.pick === 'bodies' || state?.pick === 'pieces' || state?.pick === 'plane'
    ? state.pick
    : 'plane';
  const plane = cutPlaneFromState(state);
  const bodyCount = Array.isArray(state?.bodies) ? state.bodies.length : 0;
  const dropCount = Array.isArray(state?.drop) ? state.drop.length : 0;
  const offset = state?.originOffset ?? 0;
  const offsetNum = Number(offset);
  const travel = travelRangeMm(cutTravelMm(bounds, plane), lengthMm);
  const offsetMax = Math.max(travel, Number.isFinite(offsetNum) ? Math.abs(offsetNum) : 0);

  let status;
  if (!plane && source === 'face') {
    status = 'Tap a planar face, or choose an explicit plane';
  } else if (pick === 'plane') {
    status = 'Plane from the face — tap another face to replace it';
  } else if (pick === 'pieces') {
    status = dropCount
      ? `${dropCount} hidden · tap that piece again to bring it back`
      : 'Each piece has its own color · tap a piece to hide it';
  } else if (bodyCount > 1) {
    status = `${bodyCount} bodies · tap to add, tap a selected body to remove`;
  } else if (bodyCount === 1) {
    status = '1 body · tap another to add, tap it again to remove';
  } else {
    status = 'Tap the bodies to cut';
  }

  const planeLabel = source === 'face'
    ? (plane ? 'Face plane' : 'Face')
    : `${CUT_EXPLICIT_PLANES[source].label} plane`;

  const canConfirm = !!plane && bodyCount > 0;
  const showUndo = (pick === 'plane' && !!state?.planeFace)
    || (pick === 'bodies' && bodyCount > 0)
    || (pick === 'pieces' && dropCount > 0);

  const sourceBtn = (id, label, title) => {
    const on = source === id;
    return (
      <button
        type="button"
        onClick={() => onPlaneSource?.(id)}
        aria-pressed={on}
        className={`px-2.5 py-1 rounded text-[13px] ${
          on
            ? 'bg-cyan-600 text-white'
            : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
        }`}
        title={title}
      >
        {label}
      </button>
    );
  };

  const pickBtn = (id, label, title) => {
    const on = pick === id;
    return (
      <button
        type="button"
        onClick={() => onPickTarget?.(id)}
        aria-pressed={on}
        data-cut-pick={id}
        className={`px-2.5 py-1 rounded text-[13px] ${
          on
            ? 'bg-cyan-600 text-white'
            : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
        }`}
        title={title}
      >
        {label}
      </button>
    );
  };

  return (
    <FeatureSheet
      title={`Cut · ${planeLabel}`}
      subtitle={status}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-cut-mode': '1',
        'data-cut-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-cut-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">cut(body, plane)</span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Cutting plane">
          {sourceBtn('face', 'Face', 'Plane from a planar face')}
          {sourceBtn('xy', 'XY', 'Explicit XY plane, normal +Z')}
          {sourceBtn('yz', 'YZ', 'Explicit YZ plane, normal +X')}
          {sourceBtn('zx', 'ZX', 'Explicit ZX plane, normal +Y')}
        </div>

        <div title="Offset along the plane normal. Positive moves with the normal. Zero keeps a face call as { center, normal }.">
          <LengthNumberField
            id="cut-offset"
            label="Offset"
            accent={ACCENT}
            valueMm={offset}
            onChangeMm={(raw) => onOffset?.(raw)}
            maxMm={offsetMax}
            signed
          />
        </div>

        <div className="flex gap-1 flex-wrap" role="group" aria-label="Cut picks">
          {source === 'face' && pickBtn('plane', 'Plane', 'Tap a face to set the plane')}
          {pickBtn('bodies', 'Bodies', 'Tap bodies to cut. Tap again to remove.')}
          {pickBtn('pieces', 'Pieces', 'Tap a piece to hide it. Tap again to bring it back.')}
          {showUndo && (
            <>
              <button
                type="button"
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onUndo?.()}
                title={pick === 'pieces' ? 'Bring back the last hidden piece' : 'Drop the last pick'}
                data-cut-undo=""
              >
                Undo
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onClear?.()}
                title={pick === 'pieces' ? 'Show every piece. The plane stays.' : 'Drop the picks in this list'}
                data-cut-clear=""
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>
    </FeatureSheet>
  );
};

export default CutModeChip;
