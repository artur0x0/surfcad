import React from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import ErrorPopup from './ErrorPopup';
import ContourDeleteDialog from './ContourDeleteDialog';

/**
 * Danger control matching the feature sheet's Delete
 * (`border-red-700/60`, `bg-red-950/50`, `text-red-200`).
 * Callers place it on the opposite side of the row from Confirm.
 */
export function FeatureDeleteButton({ onClick }) {
  return (
    <button
      type="button"
      data-feature-edit-delete=""
      aria-label="Delete feature"
      title="Delete this feature from the script"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px]
        font-medium text-red-200 border border-red-700/60 bg-red-950/50
        hover:bg-red-900/70 hover:text-white shrink-0"
    >
      <Trash2 size={14} aria-hidden="true" />
      Delete
    </button>
  );
}

/**
 * Confirm before a feature is deleted together with the later feature blocks
 * that reference it. Same scrim and red button as contour delete.
 */
export function FeatureDeleteConfirm({
  open = false,
  label = '',
  onCancel,
  onConfirm,
}) {
  return (
    <ContourDeleteDialog
      open={open}
      label={label}
      title="Delete feature"
      message="Later features use this one. Deleting it removes those features too."
      testId="feature-edit"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/**
 * Undo toast after a feature delete. One applyBuffer step puts the blocks back.
 */
export function FeatureDeleteToast({
  lines = [],
  onUndo,
  onDismiss,
  canUndo = false,
}) {
  if (!lines.length) return null;

  const card = (
    <div
      className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]"
      data-feature-edit-delete-toast=""
      data-delete-undo-toast=""
    >
      <ErrorPopup
        tone="warn"
        role="status"
        onDismiss={onDismiss}
        onUndo={onUndo}
        canUndo={canUndo}
        roomy
        className="pointer-events-auto"
      >
        <ul className="space-y-0.5" data-feature-edit-dependents="">
          {lines.map((line, index) => (
            <li key={`${index}:${line}`} data-feature-edit-dependent="">{line}</li>
          ))}
        </ul>
      </ErrorPopup>
    </div>
  );

  if (typeof document === 'undefined') return card;
  return createPortal(card, document.body);
}
