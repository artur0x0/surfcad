import React, { useLayoutEffect, useRef, useState } from 'react';
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
// Same glass card as the mode chips in docs/ui-style-guide.md. Not a rounded pill.
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
  /** Extra control inside the card (Disconnect / Reconnect). Already a button. */
  action = null,
  /** Deleted toasts: one line, Undo and dismiss 44px wide, with space between them. */
  roomy = false,
  className = '',
  ...rest
}) {
  const shellRef = useRef(null);
  const rowRef = useRef(null);
  const [roomyMinPx, setRoomyMinPx] = useState(null);

  // Delete Undo used to be exactly one content row plus the border. The card
  // is 2× that height. The row itself stays one line and does not stretch,
  // so the gap between Undo and X is unchanged.
  useLayoutEffect(() => {
    if (!roomy) return undefined;
    const rowEl = rowRef.current;
    const shellEl = shellRef.current;
    if (!rowEl || !shellEl) return undefined;
    const rowH = rowEl.getBoundingClientRect().height;
    if (!(rowH > 0)) return undefined;
    const cs = window.getComputedStyle(shellEl);
    const chrome = (parseFloat(cs.borderTopWidth) || 0)
      + (parseFloat(cs.borderBottomWidth) || 0)
      + (parseFloat(cs.paddingTop) || 0)
      + (parseFloat(cs.paddingBottom) || 0);
    const next = (rowH + chrome) * 2;
    setRoomyMinPx((prev) => (prev != null && Math.abs(prev - next) < 0.5 ? prev : next));
    return undefined;
  }, [roomy, children]);

  const handleUndo = () => {
    onUndo?.();
    onDismiss?.();
  };

  const actions = (
    <div
      data-error-actions=""
      className={`flex items-center shrink-0 pointer-events-auto ${roomy ? 'gap-4' : layout === 'stacked' ? 'gap-5' : 'gap-1'}`}
    >
      {action}
      {typeof onUndo === 'function' && (
        <button
          type="button"
          data-error-undo=""
          onClick={handleUndo}
          disabled={!canUndo}
          className={roomy
            ? `min-w-[44px] border-0 px-3 py-0 rounded-md bg-white/15 hover:bg-white/25
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
            ? 'inline-flex min-w-[44px] items-center justify-center rounded-md border-0 px-0 py-0 text-white/80 hover:text-white'
            : 'text-white/80 hover:text-white p-0.5'}
          title="Dismiss"
          aria-label="Dismiss"
        >
          <X size={roomy ? 18 : 14} />
        </button>
      )}
    </div>
  );

  const shell = `${TONE_CLASS[tone] || TONE_CLASS.error} surface-glass-chip text-xs font-sans font-medium shadow-lg rounded-lg ${layout === 'stacked' ? 'w-full' : ''} ${roomy ? 'flex items-center px-3 py-0' : ''} ${className}`;
  const roomyStyle = roomy && roomyMinPx ? { minHeight: `${roomyMinPx}px` } : undefined;

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
      ref={shellRef}
      role="alert"
      data-error-popup=""
      data-error-tone={tone}
      {...(roomy ? { 'data-error-roomy': '' } : {})}
      className={shell}
      {...rest}
      style={roomyStyle}
    >
      <div
        ref={rowRef}
        data-error-popup-row=""
        className={`flex w-full gap-2 ${roomy ? 'items-center' : 'items-start'}`}
      >
        <div className="flex-1 min-w-0">
          {title ? <div className="font-bold mb-1">{title}</div> : null}
          <div data-error-popup-text="" className={`text-left ${roomy ? 'whitespace-nowrap' : ''}`}>{children}</div>
        </div>
        {actions}
      </div>
    </div>
  );
}
