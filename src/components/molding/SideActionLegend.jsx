/**
 * Viewport legend for side-action groups. The chip is dark glass so the
 * labels stay `text-on-dark` over the model. Slide versus lifter is a
 * heuristic, and the chip says so.
 */

import React from 'react';
import MoldAnalysisPane from './MoldAnalysisPane';

export default function SideActionLegend({ legend, belowPull = false }) {
  if (!legend) return null;
  return (
    <MoldAnalysisPane
      data-side-action-legend=""
      className={`pointer-events-none absolute wall-legend-anchor z-30 w-44 rounded-md surface-glass surface-glass-chip px-2 py-1.5 font-ui text-on-dark${belowPull ? ' mold-below-pull' : ''}`}
    >
      <div className="text-ui-sm">Side actions</div>
      {legend.rows.length === 0 ? (
        <div className="mt-1 text-ui-sm text-muted-on-dark" data-side-action-empty="">
          None on this pull
        </div>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {legend.rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 text-ui-sm">
              <span className="flex items-center gap-1 text-on-dark">
                <span
                  data-side-action-swatch={row.kind}
                  className="inline-block h-2 w-4 rounded-sm"
                  style={{ background: row.css }}
                />
                {row.label}
              </span>
              <span className="tabular-nums text-muted-on-dark">{row.pull}</span>
            </li>
          ))}
        </ul>
      )}
      {legend.more > 0 && (
        <div className="mt-1 text-ui-sm text-muted-on-dark">{`+${legend.more} more`}</div>
      )}
      <div className="mt-1 text-ui-sm text-muted-on-dark" data-side-action-heuristic="" data-mold-pane-end="">
        Heuristic
      </div>
    </MoldAnalysisPane>
  );
}
