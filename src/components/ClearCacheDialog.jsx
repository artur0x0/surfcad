/**
 * Confirm popup for Clear local cache. Same scrim + glass card as part delete.
 * The wipe itself lives in App (`clearLocalCadData`). This card only warns.
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function ClearCacheDialog({
  open = false,
  outbox = 0,
  unsynced = 0,
  offerPush = false,
  busy = false,
  error = '',
  onCancel,
  onConfirm,
  onPushFirst,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const warn = outbox > 0 || unsynced > 0;
  const card = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center surface-scrim p-4"
      data-clear-cache-dialog=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-cache-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        className="w-full max-w-sm rounded-lg surface-glass border border-chrome-border p-4 shadow-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="clear-cache-title" className="text-sm font-semibold text-chrome-text">
          Clear local cache
        </h2>
        <p className="mt-2 text-xs text-gray-300">
          This removes parts, assemblies, and unpushed changes on this device, then
          reloads. Your GitHub account and repo are not deleted. The GitHub
          session token is kept. Settings stay. Nothing is written to the
          remote repo.
        </p>
        {warn ? (
          <p className="mt-2 text-xs text-amber-200" data-clear-cache-warning="">
            {outbox > 0 ? (
              <span className="block" data-clear-cache-outbox="">
                {`${noun(outbox, "change hasn't been pushed yet", "changes haven't been pushed yet")}.`}
              </span>
            ) : null}
            {unsynced > 0 ? (
              <span className="block" data-clear-cache-unsynced="">
                {`${noun(unsynced, "part isn't in the repo yet", "parts aren't in the repo yet")}.`}
              </span>
            ) : null}
            <span className="mt-1 block">
              {offerPush
                ? 'Push first sends queued changes on the current branch, then clears. Unsynced parts that were never queued are not uploaded.'
                : 'Nothing is pushed. This work leaves this device and stays off the repo.'}
            </span>
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs text-amber-300" data-clear-cache-error="">{error}</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            data-clear-cache-cancel=""
            className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
            disabled={busy}
            onClick={() => onCancel?.()}
          >
            Cancel
          </button>
          {offerPush ? (
            <button
              type="button"
              data-clear-cache-push=""
              className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50"
              disabled={busy}
              onClick={() => { void onPushFirst?.(); }}
            >
              {busy ? 'Working…' : 'Push first'}
            </button>
          ) : null}
          <button
            type="button"
            data-clear-cache-confirm=""
            className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            disabled={busy}
            onClick={() => { void onConfirm?.(); }}
          >
            {busy ? 'Clearing…' : 'Clear local cache'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return card;
  return createPortal(card, document.body);
}
