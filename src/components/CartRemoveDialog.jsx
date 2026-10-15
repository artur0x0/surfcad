/**
 * Confirm before a cart line is removed. Removal writes a tombstone and
 * cannot be undone, unlike a quantity change. Same scrim and glass card as
 * the part-delete dialog: Cancel is focused, Remove is destructive.
 *
 * Portaled to document.body so it is not a child of ModalFit. Quote and
 * checkout sheet caps stay on those shells.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function CartRemoveDialog({
  open = false,
  name = '',
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    return undefined;
  }, [open, name]);

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
      data-cart-remove-dialog=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-remove-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel?.();
      }}
    >
      <div className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg surface-glass border border-chrome-border p-4 shadow-xl">
        <h2 id="cart-remove-title" className="text-sm font-semibold text-chrome-text">
          Remove from cart
        </h2>
        <p className="mt-2 text-xs text-gray-300" data-cart-remove-message="">
          {'Remove '}
          <span className="font-medium text-chrome-text" data-cart-remove-name="">{name}</span>
          {" from the cart? This can't be undone."}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            data-cart-remove-cancel=""
            className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
            onClick={() => onCancel?.()}
          >
            Cancel
          </button>
          <button
            type="button"
            data-cart-remove-confirm=""
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            onClick={() => onConfirm?.()}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(card, document.body);
}
