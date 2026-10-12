import React from 'react';
import { Trash2 } from 'lucide-react';
import FeatureSheet from './FeatureSheet';

/**
 * Short card for a selected line, arc, circle, unpromoted shape, or
 * reference. The only action is Delete. X closes the card and leaves
 * the sketch selected.
 */
export default function ContourEntityCard({
  chip,
  compact = false,
  onCancel,
  onDelete,
}) {
  if (!chip) return null;
  return (
    <FeatureSheet
      title={chip.label || 'Sketch'}
      compact={compact}
      onCancel={onCancel}
      note={(
        <button
          type="button"
          data-contour-entity-delete=""
          onClick={() => onDelete?.()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-700/60 bg-red-950/50 px-2.5 py-1.5 text-[13px] font-medium text-red-200 hover:bg-red-900/70 hover:text-white"
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
      )}
      cardAttrs={{
        'data-contour-card': 'entity',
        'data-contour-entity-id': chip.id,
      }}
    />
  );
}
