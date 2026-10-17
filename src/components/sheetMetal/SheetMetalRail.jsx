import React from 'react';
import { Circle, Cone, Drill, FoldVertical, PanelTop, X } from 'lucide-react';
import {
  RAIL_PAIR_HEIGHT_ATTR,
  RAIL_DESKTOP_FULL_ATTR,
  leftRailPositionClasses,
  useLeftRailFit,
} from '../../utils/railPair';

/**
 * Left rail while sheet-metal mode is active (swaps out the FEAT palette,
 * like ContourModeRail for loft/sweep). ✕ leaves the flow without writing.
 */
const TOOL_ICONS = { tab: PanelTop, bend: FoldVertical, hole: Circle, countersink: Cone, tapped: Drill };

const SHEET_TOOL_UI_ACTION = {
  tab: 'sheet-tool-tab',
  bend: 'sheet-tool-bend',
  hole: 'sheet-tool-hole',
  countersink: 'sheet-tool-countersink',
  tapped: 'sheet-tool-tapped',
};

/**
 * tools = sheetToolsFor(spec): only features SendCutSend makes on this SKU,
 * Tab first. Empty before the base flange exists.
 */
const SheetMetalRail = ({
  onExit, tools = [], tool = null, onSelectTool, children, desktopFullRail = false,
}) => {
  const { railRef, fits, widthClass } = useLeftRailFit();
  return (
    <div
      ref={railRef}
      className={`absolute left-2 lg:left-4 z-10 flex flex-col gap-1
        bg-white/60 backdrop-blur-sm rounded-lg shadow-lg
        ${widthClass} ${leftRailPositionClasses({ desktopFull: desktopFullRail })} p-2`}
      role="group"
      aria-label="Sheet metal tools"
      data-rail-pair="left"
      data-rail-height={desktopFullRail ? RAIL_DESKTOP_FULL_ATTR : RAIL_PAIR_HEIGHT_ATTR}
      data-rail-fit={fits ? 'fits' : 'scroll'}
      data-sheet-metal-rail="1"
    >
      <div className="flex flex-col gap-0.5" data-palette-section="shape">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 px-1 truncate leading-4">
          Shape
        </div>
        {tools.map((item) => {
        const Icon = TOOL_ICONS[item.id] || Circle;
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTool?.(item.id)}
            title={item.title}
            aria-label={item.title}
            aria-pressed={active}
            data-sheet-tool={item.id}
            data-ui-action={SHEET_TOOL_UI_ACTION[item.id] || `sheet-tool-${item.id}`}
            className={`p-2 min-h-[44px] rounded flex flex-col items-center justify-center gap-0.5 transition-colors
              ${active ? 'bg-orange-200 text-orange-900' : 'text-orange-800 hover:bg-orange-100 active:bg-orange-200'}`}
          >
            <Icon size={20} strokeWidth={2} />
            <span className="text-[9px] font-semibold leading-none">{item.label}</span>
          </button>
        );
        })}
      </div>
      {children}
      <div className="border-t border-gray-300/70 my-0.5 mx-0.5" aria-hidden />
      <button
        type="button"
        onClick={() => onExit?.()}
        title="Exit sheet metal"
        aria-label="Exit sheet metal mode"
        data-ui-action="data-sheet-metal-exit"
        className="p-2 min-h-[44px] rounded text-gray-700 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center"
      >
        <X size={20} strokeWidth={2} />
      </button>
    </div>
  );
};

export default SheetMetalRail;
