import React, { useLayoutEffect, useRef, useState } from 'react';

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;
/** Leave the viewport's left rail uncovered when it cannot be measured. */
const LEFT_RAIL_CLEARANCE = 96;
/** Gap between the left rail's right edge and the drawer at full width. */
const LEFT_RAIL_GAP = 16;

/** Live clearance: the left rail's right edge inside the pane, plus a gap. */
function leftClearanceOf(frame) {
  const pane = frame?.parentElement;
  const rail = pane?.querySelector?.('[data-rail-pair="left"]');
  if (!pane || !rail) return LEFT_RAIL_CLEARANCE;
  const paneBox = pane.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  if (!(railBox.width > 0)) return LEFT_RAIL_CLEARANCE;
  return Math.max(LEFT_RAIL_CLEARANCE, Math.round(railBox.right - paneBox.left + LEFT_RAIL_GAP));
}

/**
 * Desktop CAD script editor. Sits on the right of the viewer, under the
 * feature ribbon and the joints row (`--joint-row-height`, 0 when that row
 * is not mounted), so it does not cover the left tool rail or those rows.
 * The left clearance is the measured rail edge plus a gap, 96px until the
 * rail can be measured.
 * Stays mounted when closed so Monaco's model remains the live buffer.
 */
export default function ScriptEditorDrawer({ open = false, children }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [clearance, setClearance] = useState(LEFT_RAIL_CLEARANCE);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => setClearance(leftClearanceOf(frameRef.current));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const pane = frameRef.current?.parentElement;
    const rail = pane?.querySelector?.('[data-rail-pair="left"]');
    const ro = new ResizeObserver(update);
    if (pane) ro.observe(pane);
    if (rail) ro.observe(rail);
    return () => ro.disconnect();
  }, [open]);

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
    const max = Math.max(MIN_WIDTH, bounds.width - clearance);
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
      data-script-drawer-left-clearance={clearance}
      style={{ top: 'calc(8rem + var(--joint-row-height))', width, maxWidth: `calc(100% - ${clearance}px)` }}
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
