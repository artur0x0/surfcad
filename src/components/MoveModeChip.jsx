import React, { useState } from 'react';
import { LengthNumberField } from './controls/popupUI';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { moveTargetLabel, validateMoveAccept } from '../utils/moveMode';
import { travelRangeMm } from '../utils/sliderRange';

const ACCENT = 'cyan';

/**
 * Move body on the shared feature card.
 * Double-click sets the body. One click keeps the face and does not change
 * the target. XYZ deltas, or one distance along the cut normal or a picked
 * face normal. Confirm writes one move(); X exits with no write.
 * No viewport arrows. The translated body is a preview until Confirm.
 */
const MoveModeChip = ({
  target = null,
  dx = 0,
  dy = 0,
  dz = 0,
  direction = 'xyz',
  distance = 0,
  cutNormal = null,
  faceNormal = null,
  compact = false,
  onDelta,
  onDirection,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
  lengthMm = 100,
  onMeasure = null,
}) => {
  const gate = validateMoveAccept({
    target, dx, dy, dz, direction, distance, cutNormal, faceNormal,
  });
  const canConfirm = gate.ok;
  const along = direction === 'cut' || direction === 'face';
  const [measured, setMeasured] = useState({});
  const endFor = (axis) => travelRangeMm(
    Number.isFinite(Number(measured[axis])) ? Number(measured[axis]) : null,
    lengthMm,
  );
  const press = (axis, dir) => () => {
    const d = onMeasure?.(dir);
    if (!Number.isFinite(Number(d))) return;
    setMeasured((prev) => ({ ...prev, [axis]: Number(d) }));
  };
  const alongDir = direction === 'cut' ? cutNormal : faceNormal;

  const setAxis = (axis) => (raw) => {
    onDelta?.(axis, raw);
  };

  const choose = (next) => {
    if (next === 'cut' && !cutNormal) return;
    if (next === 'face' && !faceNormal) return;
    onDirection?.(next, next === 'cut' ? cutNormal : null);
  };

  const modeBtn = (id, label, enabled) => {
    const on = direction === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => choose(id)}
        disabled={!enabled}
        aria-pressed={on}
        className={`rounded px-2.5 py-1 text-[13px] font-medium ${
          on
            ? 'bg-cyan-600 text-white'
            : enabled
              ? 'bg-cyan-950/80 border border-cyan-700/70 text-cyan-100'
              : 'bg-cyan-950/50 border border-cyan-900/60 text-cyan-400/40 cursor-not-allowed'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <FeatureSheet
      title="Move"
      subtitle={moveTargetLabel(target)}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-move-mode': '1',
        'data-move-direction': direction,
        'data-move-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-move-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">
            {along ? 'move along the normal' : 'move(body, [dx, dy, dz])'}
          </span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        {target && (
          <button
            type="button"
            className="self-start px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
            onClick={() => onClear?.()}
            title="Drop the picked body"
            data-move-clear=""
          >
            Clear
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Move direction">
          {modeBtn('xyz', 'XYZ', true)}
          {modeBtn('cut', 'Cut', !!cutNormal)}
          {modeBtn('face', 'Face', !!faceNormal)}
        </div>
        {along ? (
          <LengthNumberField
            id="distance"
            label="Distance"
            accent={ACCENT}
            valueMm={distance}
            onChangeMm={setAxis('distance')}
            maxMm={endFor('distance')}
            signed
            onPointerDown={press('distance', alongDir)}
          />
        ) : (
          <>
            <LengthNumberField
              id="dx"
              label="X"
              accent={ACCENT}
              valueMm={dx}
              onChangeMm={setAxis('dx')}
              maxMm={endFor('dx')}
              signed
              onPointerDown={press('dx', [1, 0, 0])}
            />
            <LengthNumberField
              id="dy"
              label="Y"
              accent={ACCENT}
              valueMm={dy}
              onChangeMm={setAxis('dy')}
              maxMm={endFor('dy')}
              signed
              onPointerDown={press('dy', [0, 1, 0])}
            />
            <LengthNumberField
              id="dz"
              label="Z"
              accent={ACCENT}
              valueMm={dz}
              onChangeMm={setAxis('dz')}
              maxMm={endFor('dz')}
              signed
              onPointerDown={press('dz', [0, 0, 1])}
            />
          </>
        )}
      </div>
    </FeatureSheet>
  );
};

export default MoveModeChip;
