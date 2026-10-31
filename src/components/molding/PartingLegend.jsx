/**
 * Viewport legend for the core / cavity split. The chip is dark glass so
 * the labels stay `text-on-dark` over the model.
 */

import React from 'react';

export default function PartingLegend({ legend, belowPull = false }) {
  if (!legend) return null;
  return (
    <div
      data-parting-legend=""
      className={`pointer-events-none absolute wall-legend-anchor z-30 w-44 rounded-md surface-glass surface-glass-chip px-2 py-1.5 font-ui text-on-dark${belowPull ? ' mold-below-pull' : ''}`}
    >
      <div className="text-ui-sm">Core and cavity</div>
      <ul className="mt-1 flex flex-col gap-1">
        {legend.rows.map((row) => (
          <li key={row.role} className="flex items-center justify-between gap-2 text-ui-sm">
            <span className="flex items-center gap-1 text-on-dark">
              <span
                data-parting-swatch={row.role}
                className="inline-block h-2 w-4 rounded-sm"
                style={{ background: row.css }}
              />
              {row.label}
            </span>
            <span className="tabular-nums text-muted-on-dark">{row.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-ui-sm text-muted-on-dark" data-parting-lines="">
        {`Parting line · ${legend.lineCount}`}
      </div>
    </div>
  );
}
