// components/SplitDivider.jsx — the draggable seam between editor and viewport.
//
// Desktop: vertical seam, drag left/right to re-split the two columns.
// Mobile:  horizontal seam, drag up/down to grow or shrink the editor budget.
//
// Pointer events + setPointerCapture, so a drag that leaves the element (or the
// window) still tracks and still ends. Touch needs `touch-none`, otherwise the
// browser scrolls the shell instead of giving us the move events.
import React, { useCallback, useRef } from 'react';

/**
 * @param orientation 'vertical' (desktop columns) | 'horizontal' (mobile rows)
 * @param onDrag      (clientX, clientY) => void — called on every move
 * @param onDragEnd   optional, fires once when the drag finishes
 */
const SplitDivider = ({ orientation = 'vertical', onDrag, onDragEnd, label }) => {
  const draggingRef = useRef(false);
  const vertical = orientation === 'vertical';

  const handleMove = useCallback((e) => {
    if (!draggingRef.current) return;
    onDrag?.(e.clientX, e.clientY);
  }, [onDrag]);

  const end = useCallback((e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label || (vertical ? 'Resize editor and viewport' : 'Resize viewport and editor')}
      data-split-divider={orientation}
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={handleMove}
      onPointerUp={end}
      onPointerCancel={end}
      className={`shrink-0 touch-none bg-chrome-border hover:bg-blue-500 active:bg-blue-400
        transition-colors ${vertical
          ? 'w-1 cursor-col-resize h-full'
          : 'h-1 cursor-row-resize w-full'}`}
    />
  );
};

export default SplitDivider;
