import React from 'react';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';

/**
 * Delete Face on the shared feature card.
 * Tap a face to add it. Tap a selected face again to remove it. Undo drops
 * the last face. Clear drops every face. No modifier key. Confirm writes one
 * deleteFace(); X exits with no write.
 */
const DeleteFaceModeChip = ({
  faces = [],
  compact = false,
  onUndo,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
}) => {
  const faceCount = Array.isArray(faces) ? faces.length : 0;

  let status;
  if (faceCount > 1) {
    status = `${faceCount} faces · tap to add, tap a selected face to remove`;
  } else if (faceCount === 1) {
    status = '1 face · tap another to add, tap it again to remove';
  } else {
    status = 'Tap faces to delete. Neighbors extend or trim to heal.';
  }

  const canConfirm = faceCount > 0;
  const title = `Delete Face${faceCount ? ` · ${faceCount} face${faceCount === 1 ? '' : 's'}` : ''}`;

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
        'data-delete-face-mode': '1',
        'data-delete-face-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-delete-face-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">deleteFace(body, faces)</span>
        </span>
      )}
    >
      {faceCount > 0 ? (
        <div className="mt-1.5 flex gap-1 flex-wrap font-sans" role="group" aria-label="Picked faces">
          <button
            type="button"
            className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
            onClick={() => onUndo?.()}
            title="Drop the last selected face"
            data-delete-face-undo=""
          >
            Undo
          </button>
          <button
            type="button"
            className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
            onClick={() => onClear?.()}
            title="Drop every selected face"
            data-delete-face-clear=""
          >
            Clear
          </button>
        </div>
      ) : null}
    </FeatureSheet>
  );
};

export default DeleteFaceModeChip;
