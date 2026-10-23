import React from 'react';
import { LengthNumberField, NumberField } from './controls/popupUI';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { rotateTargetLabel, validateRotateAccept } from '../utils/rotateMode';

const ACCENT = 'cyan';
const UI_ACTION = 'data-rotate-mode-chip';

/**
 * Rotate body on the shared feature card.
 * Double-click sets the body. One click keeps the face (its normal becomes
 * the Face axis) and does not change the target. Axis is X, Y, Z, the picked
 * face normal, or a typed vector; Angle is degrees; Center is the body's own
 * centroid or a typed point. Confirm writes one rotateAbout(); X exits with
 * no write. No viewport gizmo. The turned body is a preview until Confirm.
 */
const RotateModeChip = ({
  target = null,
  axis = 'z',
  axisVec = [0, 0, 1],
  faceNormal = null,
  angle = 0,
  centerMode = 'body',
  center = [0, 0, 0],
  compact = false,
  onAngle,
  onAxis,
  onAxisVec,
  onCenterMode,
  onCenter,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
  lengthMm = 100,
  labelBuffer = '',
}) => {
  const gate = validateRotateAccept({
    target, axis, axisVec, faceNormal, angle, centerMode, center,
  });
  const canConfirm = gate.ok;

  const choiceBtn = (id, label, on, enabled, onPick, extra = {}) => (
    <button
      key={id}
      type="button"
      data-ui-action={UI_ACTION}
      onClick={onPick}
      disabled={!enabled}
      aria-pressed={on}
      className={`rounded px-2.5 py-1 text-[13px] font-medium ${
        on
          ? 'bg-cyan-600 text-white'
          : enabled
            ? 'bg-cyan-950/80 border border-cyan-700/70 text-cyan-100'
            : 'bg-cyan-950/50 border border-cyan-900/60 text-cyan-400/40 cursor-not-allowed'
      }`}
      {...extra}
    >
      {label}
    </button>
  );

  const axisBtn = (id, label, enabled = true) => choiceBtn(
    `axis-${id}`, label, axis === id, enabled, () => onAxis?.(id), { 'data-rotate-axis': id },
  );
  const centerBtn = (id, label) => choiceBtn(
    `center-${id}`, label, centerMode === id, true, () => onCenterMode?.(id), { 'data-rotate-center': id },
  );

  const vecField = (key, label, value, onChange) => (
    <NumberField
      id={key}
      label={label}
      accent={ACCENT}
      value={value}
      onChange={onChange}
      min={-1}
      max={1}
      step={0.01}
      signed
    />
  );

  return (
    <FeatureSheet
      title="Rotate"
      subtitle={rotateTargetLabel(target, { buffer: labelBuffer })}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-rotate-mode': '1',
        'data-rotate-axis-mode': axis,
        'data-rotate-center-mode': centerMode,
        'data-rotate-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': UI_ACTION,
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">rotateAbout(body, axis, degrees, center)</span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        {target && (
          <button
            type="button"
            data-ui-action={UI_ACTION}
            className="self-start px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
            onClick={() => onClear?.()}
            title="Drop the picked body"
            data-rotate-clear=""
          >
            Clear
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rotate axis">
          {axisBtn('x', 'X')}
          {axisBtn('y', 'Y')}
          {axisBtn('z', 'Z')}
          {axisBtn('face', 'Face', !!faceNormal)}
          {axisBtn('custom', 'Vector')}
        </div>
        {axis === 'custom' && (
          <div className="flex flex-col gap-1" data-rotate-axis-vector="">
            {vecField('ax', 'Axis X', axisVec?.[0] ?? 0, (v) => onAxisVec?.(0, v))}
            {vecField('ay', 'Axis Y', axisVec?.[1] ?? 0, (v) => onAxisVec?.(1, v))}
            {vecField('az', 'Axis Z', axisVec?.[2] ?? 0, (v) => onAxisVec?.(2, v))}
          </div>
        )}
        <NumberField
          id="angle"
          label="Angle"
          unit="°"
          accent={ACCENT}
          value={angle}
          onChange={(v) => onAngle?.(v)}
          min={-180}
          max={180}
          step={1}
          signed
        />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rotate center">
          {centerBtn('body', 'Body center')}
          {centerBtn('custom', 'Point')}
        </div>
        {centerMode === 'custom' && (
          <div className="flex flex-col gap-1" data-rotate-center-point="">
            <LengthNumberField
              id="cx"
              label="Center X"
              accent={ACCENT}
              valueMm={center?.[0] ?? 0}
              onChangeMm={(v) => onCenter?.(0, v)}
              maxMm={lengthMm}
              signed
            />
            <LengthNumberField
              id="cy"
              label="Center Y"
              accent={ACCENT}
              valueMm={center?.[1] ?? 0}
              onChangeMm={(v) => onCenter?.(1, v)}
              maxMm={lengthMm}
              signed
            />
            <LengthNumberField
              id="cz"
              label="Center Z"
              accent={ACCENT}
              valueMm={center?.[2] ?? 0}
              onChangeMm={(v) => onCenter?.(2, v)}
              maxMm={lengthMm}
              signed
            />
          </div>
        )}
      </div>
    </FeatureSheet>
  );
};

export default RotateModeChip;
