/**
 * Confirm before a referenced contour is deleted with the features that
 * name it. Same scrim and glass card as the part-delete dialog: Cancel is
 * focused, the confirm button is red.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ContourDeleteDialog({
  open = false,
  label = '',
  title = 'Delete contour',
  message = 'This contour is still named by features. Deleting it removes those features too.',
  testId = 'contour',
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    return undefined;
  }, [open, label]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  const card = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center surface-scrim p-4"
      {...{ [`data-${testId}-delete-dialog`]: '' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${testId}-delete-title`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel?.();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel?.();
      }}
    >
      <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg surface-glass border border-chrome-border p-4 shadow-xl">
        <h2 id={`${testId}-delete-title`} className="text-sm font-semibold text-chrome-text">
          {title}
        </h2>
        <p className="mt-2 text-xs text-gray-300" {...{ [`data-${testId}-delete-message`]: '' }}>
          {message}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            {...{ [`data-${testId}-delete-cancel`]: '' }}
            className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
            onClick={() => onCancel?.()}
          >
            Cancel
          </button>
          <button
            type="button"
            {...{ [`data-${testId}-delete-confirm`]: '' }}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            onClick={() => onConfirm?.()}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(card, document.body);
}
