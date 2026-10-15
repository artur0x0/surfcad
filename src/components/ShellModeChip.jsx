import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import { growToFit, shellWallRange } from '../utils/sliderRange';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';

/**
 * Shell on the shared feature card.
 * Tap a face to add it (no modifier). Tap a selected face again to drop it,
 * same as the edge picker. Undo drops only the last face; Clear drops all.
 * Closed is the no-opening hollow. Confirm writes one hollow(); X exits
 * with no write.
 */
const ShellModeChip = ({
  face = null,
  params = {},
  compact = false,
  onParamChange,
  onUndoFace,
  onClearFace,
  onConfirm,
  onDismiss,
  onDelete = null,
  lengthMm = 100,
  minExtent = null,
}) => {
  const openingMode = params.openingMode === 'none' ? 'none' : 'face';
  const closed = openingMode === 'none';
  const faceCount = Array.isArray(face?.group) && face.group.length > 1
    ? face.group.length
    : (face ? 1 : 0);
  const wall = params.wall;
  const wallNum = Number(wall);
  const range = shellWallRange(lengthMm, minExtent);
  const fit = growToFit(range.minMm, range.maxMm, Number.isFinite(wallNum) ? wallNum : range.minMm);

  const setWall = (raw) => {
    let v = raw;
    if (raw === '' || raw === '-' || raw === '.') v = raw;
    else {
      const n = Number(raw);
      v = Number.isFinite(n) ? n : params.wall;
    }
    onParamChange?.({ ...params, wall: v });
  };

  const setMode = (mode) => {
    onParamChange?.({ ...params, openingMode: mode });
  };

  let status;
  if (closed) {
    status = 'Closed hollow — no opening face';
  } else if (faceCount > 1) {
    status = `${faceCount} faces · tap to add, tap a selected face to remove`;
  } else if (face) {
    const kind = face.type || 'planar';
    status = `Opening · ${kind} face — tap another to add`;
  } else {
    status = 'Tap faces to add openings';
  }

  const canConfirm = closed || !!face;
  const title = `Shell${faceCount ? ` · ${faceCount} face${faceCount === 1 ? '' : 's'}` : ''}`;

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
        'data-shell-mode': '1',
        'data-shell-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-shell-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">hollow(body, wall, opening)</span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Opening">
          <button
            type="button"
            onClick={() => setMode('face')}
            aria-pressed={!closed}
            className={`px-2.5 py-1 rounded text-[13px] ${
              !closed
                ? 'bg-cyan-600 text-white'
                : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
            }`}
            title="Opening at the picked face(s)"
          >
            Face
          </button>
          <button
            type="button"
            onClick={() => setMode('none')}
            aria-pressed={closed}
            className={`px-2.5 py-1 rounded text-[13px] ${
              closed
                ? 'bg-cyan-600 text-white'
                : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
            }`}
            title="Closed hollow — no opening"
          >
            Closed
          </button>
          {faceCount > 0 && (
            <>
              <button
                type="button"
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onUndoFace?.()}
                title="Drop the last selected face"
                data-shell-undo=""
              >
                Undo
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onClearFace?.()}
                title="Drop every selected face"
                data-shell-clear=""
              >
                Clear
              </button>
            </>
          )}
        </div>

        <LengthNumberField
          id="shell-wall"
          label="Wall"
          accent="cyan"
          valueMm={wall}
          onChangeMm={setWall}
          minMm={fit.min}
          maxMm={fit.max}
        />
      </div>
    </FeatureSheet>
  );
};

export default ShellModeChip;
