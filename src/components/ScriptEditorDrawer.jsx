import React, { useRef, useState } from 'react';

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;
/** Leave the viewport's left rail uncovered. */
const LEFT_RAIL_CLEARANCE = 96;

/**
 * Desktop CAD script editor. Sits on the right of the viewer, under the
 * feature ribbon, so it does not cover the left tool rail or that ribbon.
 * Stays mounted when closed so Monaco's model remains the live buffer.
 */
export default function ScriptEditorDrawer({ open = false, children }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const onPointerDown = (event) => {
    if (!open) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = event.pointerId;
  };

  const onPointerMove = (event) => {
    if (dragRef.current == null) return;
    const bounds = frameRef.current?.parentElement?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const next = bounds.right - event.clientX;
    const max = Math.max(MIN_WIDTH, bounds.width - LEFT_RAIL_CLEARANCE);
    setWidth(Math.round(Math.min(max, Math.max(MIN_WIDTH, next))));
  };

  const endDrag = (event) => {
    if (dragRef.current == null) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={frameRef}
      data-script-drawer=""
      data-script-drawer-side="right"
      data-script-editor-open={open ? 'true' : 'false'}
      data-script-drawer-clearance="below-feature-ribbon"
      aria-hidden={open ? undefined : true}
      className={`absolute bottom-0 right-0 z-[45] flex min-h-0 flex-col border-l border-white/10 bg-chrome-background shadow-2xl ${
        open ? '' : 'invisible pointer-events-none'
      }`}
      style={{ top: '8rem', width, maxWidth: `calc(100% - ${LEFT_RAIL_CLEARANCE}px)` }}
    >
      <div
        data-script-drawer-resize=""
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize script editor"
        className="absolute bottom-0 left-0 top-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      {children}
    </div>
  );
}
