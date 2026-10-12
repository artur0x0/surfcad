import {
  CONTOUR_STATUS_LEGEND,
  contourStatusHex,
} from '../utils/contourStatus';

/**
 * Sketch status key. Blue is free and draggable. Black is locked.
 * Red is a conflict. Amber is the repeated warning, not a geometry colour.
 */
export default function ContourStatusLegend() {
  return (
    <div
      data-contour-status-legend=""
      className="pointer-events-none absolute left-14 top-2 z-20 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white/90 px-2 py-1 text-[10px] font-medium leading-tight text-gray-900 shadow"
      aria-hidden="true"
    >
      {CONTOUR_STATUS_LEGEND.map((item) => {
        const hex = contourStatusHex(item.color);
        return (
          <span
            key={item.status}
            data-contour-status={item.status}
            className="inline-flex items-center gap-1"
          >
            <span
              data-contour-status-swatch=""
              data-contour-status-color={hex}
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: hex }}
            />
            {item.label}
          </span>
        );
      })}
    </div>
  );
}
