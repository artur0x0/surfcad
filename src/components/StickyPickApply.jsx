import React from 'react';
import { X } from 'lucide-react';
import FeatureSheet from './FeatureSheet';

/**
 * Pick one or two objects, then apply a property.
 *
 * Contours use it for Dimension (a length, an angle, a distance), Arc
 * (a corner radius), and Constraints. The joints create card uses it for
 * a face, a point, or an edge, then a joint such as coincident or
 * concentric. This component does not know which objects those are. The
 * parent owns the list and the property. A joint fingerprint stays on
 * that parent list; the chips here are only id, kind, and label.
 *
 * X drops the pending pick and writes nothing. Apply is the parent's
 * Confirm. It does not decide whether the parent leaves its mode.
 */
const StickyPickApply = ({
  title,
  subtitle = '',
  picks = [],
  max = 2,
  properties = [],
  property = '',
  onProperty,
  onRemovePick,
  onApply,
  onCancel,
  applyLabel = 'Confirm',
  applyDisabled = false,
  note = '',
  compact = false,
  footer = null,
  cardAttrs = {},
  children = null,
  onKeyboardDone = null,
}) => {
  const cap = Math.max(1, max);
  return (
    <FeatureSheet
      title={title}
      subtitle={subtitle}
      compact={compact}
      onCancel={onCancel}
      onConfirm={onApply}
      confirmLabel={applyLabel}
      confirmDisabled={applyDisabled}
      note={note}
      footer={footer}
      cardAttrs={{ 'data-sticky-pick-apply': '', ...cardAttrs }}
      onKeyboardDone={onKeyboardDone}
    >
      <div className="flex flex-col gap-2 font-sans" data-sticky-picks={picks.length}>
        <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">
          {picks.length === 0 ? `Tap 1–${cap}` : `${picks.length} of ${cap}`}
        </div>
        <div className="flex flex-wrap gap-1">
          {picks.map((pick) => (
            <button
              key={`${pick.kind}:${pick.id}`}
              type="button"
              className="inline-flex items-center gap-1 rounded bg-cyan-900/80 px-2 py-1 text-[13px] text-cyan-50"
              data-sticky-pick={`${pick.kind}:${pick.id}`}
              onClick={() => onRemovePick?.(pick)}
              title="Remove this pick"
            >
              {pick.label || pick.id}
              <X size={12} strokeWidth={2} />
            </button>
          ))}
          {picks.length === 0 && (
            <span className="text-[13px] text-cyan-100/80">Nothing picked yet.</span>
          )}
        </div>
        {properties.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Property">
            {properties.map((item) => {
              const on = !item.action && item.id === property;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.action ? undefined : on}
                  disabled={!!item.disabled}
                  data-sticky-property={item.id}
                  data-contour-icon={item.icon || undefined}
                  {...(item.attrs || {})}
                  onClick={() => onProperty?.(item.id)}
                  className={`rounded px-2 py-1 text-[13px] disabled:opacity-40 ${
                    on ? 'bg-cyan-600 text-white' : 'border border-cyan-700/70 bg-cyan-950/80 text-cyan-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
        {children}
      </div>
    </FeatureSheet>
  );
};

export default StickyPickApply;
