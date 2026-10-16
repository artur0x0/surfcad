import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { moveFaceRange } from '../utils/sliderRange';

const UI_ACTION = 'data-move-face-mode-chip';

/**
 * Move Face on the shared feature card.
 * Tap a face to add it. Tap a selected face again to remove it. Undo drops
 * the last face. Clear drops every face. No modifier key. Distance is along
 * each face normal. Flip reverses that normal. Confirm writes one moveFace();
 * X exits with no write.
 */
const MoveFaceModeChip = ({
  faces = [],
  distance = 2,
  flip = false,
  compact = false,
  onDistance,
  onFlip,
  onUndo,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
  lengthMm = 100,
  minExtent = null,
}) => {
  const faceCount = Array.isArray(faces) ? faces.length : 0;
  const distNum = Number(distance);
  const range = moveFaceRange(lengthMm, minExtent);
  const max = Math.max(range.maxMm, Number.isFinite(distNum) ? Math.abs(distNum) : 0);

  const setDistance = (raw) => {
    if (raw === '' || raw === '-' || raw === '.') {
      onDistance?.(raw);
      return;
    }
    const n = Number(raw);
    onDistance?.(Number.isFinite(n) ? n : distance);
  };

  let status;
  if (faceCount > 1) {
    status = `${faceCount} faces · tap to add, tap a selected face to remove`;
  } else if (faceCount === 1) {
    status = '1 face · tap another to add, tap it again to remove';
  } else {
    status = 'Tap faces to offset along their normals';
  }

  const canConfirm = faceCount > 0 && Number.isFinite(distNum);
  const title = `Move Face${faceCount ? ` · ${faceCount} face${faceCount === 1 ? '' : 's'}` : ''}`;

  return (
    <FeatureSheet
      title={title}
      subtitle={status}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-move-face-mode': '1',
        'data-move-face-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-move-face-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">moveFace(body, faces, distance)</span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Offset">
          <button
            type="button"
            data-ui-action={UI_ACTION}
            onClick={() => onFlip?.(!flip)}
            aria-pressed={!!flip}
            data-move-face-flip=""
            className={`px-2.5 py-1 rounded text-[13px] ${
              flip
                ? 'bg-cyan-600 text-white'
                : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
            }`}
            title="Reverse each face normal. The distance is applied the other way."
          >
            Flip
          </button>
          {faceCount > 0 && (
            <>
              <button
                type="button"
                data-ui-action={UI_ACTION}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onUndo?.()}
                title="Drop the last selected face"
                data-move-face-undo=""
              >
                Undo
              </button>
              <button
                type="button"
                data-ui-action={UI_ACTION}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onClear?.()}
                title="Drop every selected face"
                data-move-face-clear=""
              >
                Clear
              </button>
            </>
          )}
        </div>

        <LengthNumberField
          id="move-face-distance"
          label="Distance"
          accent="cyan"
          valueMm={distance}
          onChangeMm={setDistance}
          maxMm={max}
          signed
        />
      </div>
    </FeatureSheet>
  );
};

export default MoveFaceModeChip;
