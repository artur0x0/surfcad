import React from 'react';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { mirrorTargetLabel, validateMirrorAccept } from '../utils/mirrorMode';

const UI_ACTION = 'data-mirror-mode-chip';

/**
 * Mirror body on the shared feature card.
 * Double-click sets the body. One click keeps the face and offers it as
 * the mirror plane. XY, YZ, ZX, that face, or a user workplane. The copy
 * is a preview until Confirm. Confirm writes one mirror(); X exits with
 * no write.
 */
const MirrorModeChip = ({
  target = null,
  planeSource = null,
  facePlane = null,
  workplane = null,
  workplanes = [],
  compact = false,
  onNamedPlane,
  onFace,
  onWorkplane,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
}) => {
  const view = { target, planeSource, facePlane, workplane };
  const gate = validateMirrorAccept(view);
  const canConfirm = gate.ok;
  const faceReady = planeSource === 'face' || !!(facePlane?.center && facePlane?.normal);

  const choiceClass = (on, enabled) => `rounded px-2.5 py-1 text-[13px] font-medium ${
    on
      ? 'bg-cyan-600 text-white'
      : enabled
        ? 'bg-cyan-950/80 border border-cyan-700/70 text-cyan-100'
        : 'bg-cyan-950/50 border border-cyan-900/60 text-cyan-400/40 cursor-not-allowed'
  }`;

  const named = (id, label) => (
    <button
      key={id}
      type="button"
      data-ui-action={UI_ACTION}
      data-mirror-plane-choice={id}
      onClick={() => onNamedPlane?.(id)}
      aria-pressed={planeSource === id}
      className={choiceClass(planeSource === id, true)}
    >
      {label}
    </button>
  );

  return (
    <FeatureSheet
      title="Mirror"
      subtitle={mirrorTargetLabel(target, view)}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-mirror-mode': '1',
        'data-mirror-plane': planeSource || 'none',
        'data-mirror-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-mirror-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">mirror(body, plane)</span>
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
            data-mirror-clear=""
          >
            Clear
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Mirror plane">
          {named('xy', 'XY')}
          {named('yz', 'YZ')}
          {named('xz', 'ZX')}
          <button
            type="button"
            data-ui-action={UI_ACTION}
            data-mirror-plane-choice="face"
            onClick={() => faceReady && onFace?.()}
            disabled={!faceReady}
            aria-pressed={planeSource === 'face'}
            className={choiceClass(planeSource === 'face', faceReady)}
          >
            Face
          </button>
          {workplanes.map((plane) => {
            const on = planeSource === 'workplane' && workplane?.id === plane.id;
            return (
              <button
                key={plane.id}
                type="button"
                data-ui-action={UI_ACTION}
                data-mirror-workplane={plane.id}
                onClick={() => onWorkplane?.(plane)}
                aria-pressed={on}
                className={choiceClass(on, true)}
              >
                {plane.name}
              </button>
            );
          })}
        </div>
      </div>
    </FeatureSheet>
  );
};

export default MirrorModeChip;
