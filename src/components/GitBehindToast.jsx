import React from 'react';
import ErrorPopup from './ErrorPopup';

const ACTION_CLASS = 'shrink-0 rounded-md bg-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-50 hover:bg-amber-500/45';

/**
 * Yellow "remote is ahead" toast. Get latest opens the Parts-list conflict
 * dialog. Keep mine runs that dialog's keep handler; the caller dismisses.
 */
export default function GitBehindToast({
  message,
  onGetLatest,
  onKeepMine,
  onDismiss,
}) {
  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md" data-git-behind-toast="">
      <ErrorPopup
        tone="warn"
        onDismiss={onDismiss}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span data-git-behind-toast-msg="">{message}</span>
          <div className="flex shrink-0 items-center justify-center gap-1.5 sm:justify-start">
            <button
              type="button"
              data-git-behind-toast-get=""
              className={ACTION_CLASS}
              onClick={() => onGetLatest?.()}
            >
              Get latest
            </button>
            <button
              type="button"
              data-git-behind-toast-keep=""
              className={ACTION_CLASS}
              onClick={() => { void onKeepMine?.(); }}
            >
              Keep mine
            </button>
          </div>
        </div>
      </ErrorPopup>
    </div>
  );
}
