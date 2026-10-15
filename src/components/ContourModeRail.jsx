import React from 'react';
import {
  Circle,
  Square,
  Hexagon,
  Waypoints,
  Spline,
  MousePointer2,
  Ruler,
  Link2,
  ArrowLeft,
  Check,
  X,
} from 'lucide-react';
import { contourRailTools } from '../utils/contourMode';
import {
  RAIL_PAIR_HEIGHT_CLASS,
  RAIL_SCROLL_CLASS,
  RAIL_PAIR_HEIGHT_ATTR,
  useLeftRailFit,
} from '../utils/railPair';

// lucide-react 0.469 has no `vector-polygon`. Waypoints is the node-and-segment glyph.
// Arc takes `spline`, the polyline glyph this rail used before.
const ICONS = {
  cursor: MousePointer2,
  circle: Circle,
  rectangle: Square,
  polygon: Hexagon,
  polyline: Waypoints,
};

const GESTURES = [
  { id: 'arc', title: 'Round a corner of the contour' },
  { id: 'dimension', title: 'Dimension' },
  { id: 'constraints', title: 'Constrain' },
];

const GESTURE_ICONS = {
  arc: Spline,
  dimension: Ruler,
  constraints: Link2,
};

/**
 * Left rail while contour mode is active.
 * Replaces the FEAT palette: contour tools, Back (undo one edit, or the
 * plane card when nothing is left), Confirm (finish), and grey X (exit).
 * Mobile-first: same chrome/width as HelperInsertPalette (compact on phone).
 */
const ContourModeRail = ({
  tool = 'circle',
  gesture = null,
  entry = 'crossSection',
  canUndo = false,
  onSelectTool,
  onUndo,
  onConfirm,
  onBack,
  compact = false,
}) => {
  // Content-height capped like HelperInsertPalette; narrows when no scroll.
  const { railRef, fits, widthClass } = useLeftRailFit();
  const iconSize = 20;
  const pad = 'p-2';
  const profileTools = contourRailTools(entry);

  return (
    <div
      ref={railRef}
      className={`absolute left-2 lg:left-4 bottom-2.5 z-10 flex flex-col gap-1
        bg-white/60 backdrop-blur-sm rounded-lg shadow-lg
        ${widthClass} ${RAIL_PAIR_HEIGHT_CLASS} ${RAIL_SCROLL_CLASS}
        p-2`}
      role="group"
      aria-label="Contour tools"
      data-rail-pair="left"
      data-rail-height={RAIL_PAIR_HEIGHT_ATTR}
      data-rail-fit={fits ? 'fits' : 'scroll'}
    >
      <div
        className={`text-[9px] font-semibold uppercase tracking-wide text-cyan-800 px-1 truncate ${
          compact ? 'leading-3' : 'leading-4'
        }`}
      >
        Contour
      </div>
      {profileTools.map((item) => {
        const Icon = ICONS[item.id] || Circle;
        const active = !gesture && tool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-contour-tool={item.id}
            data-ui-action={item.id}
            onClick={() => onSelectTool?.(item.id)}
            title={item.title}
            aria-label={item.title}
            aria-pressed={active}
            className={`${pad} rounded flex items-center justify-center transition-colors
              ${active
                ? 'bg-cyan-200 text-cyan-900'
                : 'text-cyan-800 hover:bg-cyan-100 active:bg-cyan-200'}`}
          >
            <Icon size={iconSize} strokeWidth={2} />
          </button>
        );
      })}
      {GESTURES.map((item) => {
        const Icon = GESTURE_ICONS[item.id] || Ruler;
        const active = gesture === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-contour-tool={item.id}
            data-ui-action={item.id}
            onClick={() => onSelectTool?.(item.id)}
            title={item.title}
            aria-label={item.title}
            aria-pressed={active}
            className={`${pad} rounded flex items-center justify-center transition-colors
              ${active
                ? 'bg-cyan-200 text-cyan-900'
                : 'text-cyan-800 hover:bg-cyan-100 active:bg-cyan-200'}`}
          >
            <Icon size={iconSize} strokeWidth={2} />
          </button>
        );
      })}
      <div className="border-t border-gray-300/70 my-0.5 mx-0.5" aria-hidden />
      <button
        type="button"
        data-contour-back=""
        data-ui-action="data-contour-back"
        onClick={() => onUndo?.()}
        title={canUndo ? 'Undo' : 'Plane'}
        aria-label="Back"
        className={`${pad} rounded flex items-center justify-center transition-colors
          text-cyan-800 hover:bg-cyan-100 active:bg-cyan-200`}
      >
        <ArrowLeft size={iconSize} strokeWidth={2} />
      </button>
      <button
        type="button"
        data-contour-confirm=""
        data-ui-action="data-contour-confirm"
        onClick={() => onConfirm?.()}
        title="Finish contour"
        aria-label="Confirm"
        className={`${pad} rounded flex items-center justify-center transition-colors
          text-cyan-800 hover:bg-cyan-100 active:bg-cyan-200`}
      >
        <Check size={iconSize} strokeWidth={2} />
      </button>
      <button
        type="button"
        data-contour-exit=""
        data-ui-action="data-contour-exit"
        onClick={() => onBack?.()}
        title="Dismiss — exit contour mode (no additional solid write)"
        aria-label="Dismiss contour mode without committing a solid"
        className={`${pad} rounded text-gray-700 hover:bg-gray-200 active:bg-gray-300
          flex items-center justify-center transition-colors`}
      >
        <X size={iconSize} strokeWidth={2} />
      </button>
    </div>
  );
};

export default ContourModeRail;
