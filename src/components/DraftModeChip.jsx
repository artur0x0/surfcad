import React from 'react';
import { NumberField } from './controls/popupUI';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';

const UI_ACTION = 'data-draft-mode-chip';

/**
 * Draft on the shared feature card.
 * First tap is the neutral face (its normal is the pull). Flip reverses that
 * normal. Later taps add faces to draft; tap a drafted face again to remove
 * it. Undo drops only the last drafted face. Clear drops drafted faces and
 * keeps the neutral face. Confirm writes one draftFaces(); X exits with no
 * write. No modifier key and no tangent chain.
 */
const DraftModeChip = ({
  neutral = null,
  drafts = [],
  replaceNeutral = false,
  angle = 2,
  flip = false,
  compact = false,
  onAngle,
  onFlip,
  onUndo,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
}) => {
  const faceCount = Array.isArray(drafts) ? drafts.length : 0;

  const setAngle = (raw) => {
    if (raw === '' || raw === '-' || raw === '.') {
      onAngle?.(raw);
      return;
    }
    const n = Number(raw);
    onAngle?.(Number.isFinite(n) ? n : angle);
  };

  let status;
  if (!neutral) {
    status = 'Tap the neutral face. Its normal is the pull.';
  } else if (replaceNeutral) {
    status = 'Tap a face to replace the neutral plane.';
  } else if (faceCount > 0) {
    status = `${faceCount} face${faceCount === 1 ? '' : 's'} · tap to add, tap again to remove`;
  } else {
    status = 'Neutral set. Tap faces to draft.';
  }

  const canConfirm = !!neutral && faceCount > 0;
  const title = `Draft${faceCount ? ` · ${faceCount} face${faceCount === 1 ? '' : 's'}` : ''}`;

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
        'data-draft-mode': '1',
        'data-draft-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-draft-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">draftFaces(body, faces, angle)</span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Pull">
          <button
            type="button"
            data-ui-action={UI_ACTION}
            onClick={() => onFlip?.(!flip)}
            aria-pressed={!!flip}
            disabled={!neutral}
            data-draft-flip=""
            className={`px-2.5 py-1 rounded text-[13px] ${
              flip
                ? 'bg-cyan-600 text-white'
                : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
            } ${!neutral ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Reverse the neutral-face normal. That direction is the pull."
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
                title="Drop the last drafted face. The neutral face stays."
                data-draft-undo=""
              >
                Undo
              </button>
              <button
                type="button"
                data-ui-action={UI_ACTION}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onClear?.()}
                title="Drop drafted faces and keep the neutral face"
                data-draft-clear=""
              >
                Clear
              </button>
            </>
          )}
        </div>

        <NumberField
          id="draft-angle"
          label="Angle °"
          accent="cyan"
          value={angle}
          onChange={setAngle}
          min={-45}
          max={45}
          step={0.5}
        />
      </div>
    </FeatureSheet>
  );
};

export default DraftModeChip;
