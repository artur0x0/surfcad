import React from 'react';
import { X } from 'lucide-react';

/**
 * Shared error / soft-fail popup. Always includes an Undo control when an
 * onUndo handler is provided (disabled when canUndo is false).
 *
 * layout="inline" (default) keeps the message beside the actions — the
 * soft-fail toasts. layout="stacked" is the execution-error toast: one
 * two-line card (label, then description) whose width comes from the
 * portal, not from the message.
 */
// Same glass card as the mode chips in docs/POPUP_STYLE.md. Not a rounded pill.
const TONE_CLASS = {
  error: 'bg-red-950/80 border border-red-400/70 text-red-50',
  scrap: 'bg-red-950/80 border border-red-400/70 text-red-50',
  warn: 'bg-amber-950/80 border border-amber-400/70 text-amber-50',
  amber: 'bg-amber-950/80 border border-amber-400/70 text-amber-50',
  success: 'bg-emerald-950/80 border border-emerald-400/70 text-emerald-50',
  cyan: 'bg-cyan-950/80 border border-cyan-400/70 text-cyan-50',
  banner: 'bg-red-950/80 border border-red-400/70 text-red-50',
};

export default function ErrorPopup({
  children,
  title = null,
  tone = 'error',
  layout = 'inline',
  onDismiss = null,
  onUndo = null,
  canUndo = false,
  /** Deleted toasts: 44px Undo and dismiss, with space between them. */
  roomy = false,
  className = '',
  ...rest
}) {
  const handleUndo = () => {
    onUndo?.();
    onDismiss?.();
  };

  const actions = (
    <div className={`flex items-center shrink-0 pointer-events-auto ${roomy ? 'gap-4' : layout === 'stacked' ? 'gap-5' : 'gap-1'}`}>
      {typeof onUndo === 'function' && (
        <button
          type="button"
          data-error-undo=""
          onClick={handleUndo}
          disabled={!canUndo}
          className={roomy
            ? `min-h-[44px] min-w-[44px] px-3 rounded-md bg-white/15 hover:bg-white/25
              disabled:opacity-40 disabled:pointer-events-none font-semibold`
            : `px-2 py-0.5 rounded-md bg-white/15 hover:bg-white/25
              disabled:opacity-40 disabled:pointer-events-none font-semibold`}
          title="Undo"
          aria-label="Undo"
        >
          Undo
        </button>
      )}
      {typeof onDismiss === 'function' && (
        <button
          type="button"
          data-error-dismiss=""
          onClick={onDismiss}
          className={roomy
            ? 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-white/80 hover:text-white'
            : 'text-white/80 hover:text-white p-0.5'}
          title="Dismiss"
          aria-label="Dismiss"
        >
          <X size={roomy ? 18 : 14} />
        </button>
      )}
    </div>
  );

  const shell = `${TONE_CLASS[tone] || TONE_CLASS.error} surface-glass-chip text-xs font-sans font-medium shadow-lg rounded-lg ${layout === 'stacked' ? 'w-full' : ''} ${className}`;

  // Execution errors: one shape. Label and actions share the first line;
  // the description is the full-width second line, so a short message and a
  // long one occupy the same card width.
  if (layout === 'stacked') {
    return (
      <div
        role="alert"
        data-error-popup=""
        data-error-tone={tone}
        data-error-layout="stacked"
        className={shell}
        {...rest}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold text-left">{title}</div>
          {actions}
        </div>
        <div className="text-left mt-1 break-words">{children}</div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-error-popup=""
      data-error-tone={tone}
      className={shell}
      {...rest}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {title ? <div className="font-bold mb-1">{title}</div> : null}
          <div className="text-left">{children}</div>
        </div>
        {actions}
      </div>
    </div>
  );
}
