/**
 * Core / cavity section of the molding results pane. Labels stay
 * `text-on-dark`. Counts stay off the section: the parting line is one
 * polyline, not a face tally.
 */

import React from 'react';

export default function PartingLegend({ legend }) {
  if (!legend) return null;
  return (
    <div
      data-parting-legend=""
      className="mold-results-section font-ui text-on-dark"
    >
      <div className="text-ui-sm">Core and cavity</div>
      <ul className="mt-1 flex flex-col gap-1" data-mold-pane-end="">
        {legend.rows.map((row) => (
          <li key={row.role} className="flex items-center gap-1 text-ui-sm text-on-dark">
            <span
              data-parting-swatch={row.role}
              className="inline-block h-2 w-4 rounded-sm"
              style={{ background: row.css }}
            />
            {row.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
