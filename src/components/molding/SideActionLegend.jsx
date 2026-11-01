/**
 * Side-action section of the molding results pane. Labels stay
 * `text-on-dark`. Each row is one slide or lifter, with its area and
 * release direction. Slide versus lifter is a heuristic, and the section says so.
 */

import React from 'react';

export default function SideActionLegend({ legend }) {
  if (!legend) return null;
  return (
    <div
      data-side-action-legend=""
      className="mold-results-section font-ui text-on-dark"
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
              <span className="flex items-baseline gap-2 tabular-nums text-muted-on-dark">
                {row.areaLabel ? <span data-side-action-area="">{row.areaLabel}</span> : null}
                <span>{row.pull}</span>
              </span>
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
    </div>
  );
}
