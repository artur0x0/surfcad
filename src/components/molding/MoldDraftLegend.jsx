/**
 * Mold-draft section of the molding results pane. Pin and sleeve counts
 * are a heuristic, and the section says so. This is not the CAD draft tool.
 */

import React from 'react';

export default function MoldDraftLegend({ legend }) {
  if (!legend) return null;
  const rows = [
    { key: 'violations', label: `Below ${legend.minDeg}°`, count: legend.violations, swatch: true },
    { key: 'pins', label: 'Ejector pin', count: legend.pins, swatch: false },
    { key: 'sleeves', label: 'Sleeve', count: legend.sleeves, swatch: false },
  ];
  return (
    <div
      data-mold-draft-legend=""
      className="mold-results-section font-ui text-on-dark"
    >
      <div className="text-ui-sm">Mold draft</div>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-2 text-ui-sm">
            <span className="flex items-center gap-1 text-on-dark">
              {row.swatch && (
                <span
                  data-mold-draft-swatch=""
                  className="inline-block h-2 w-4 rounded-sm"
                  style={{ background: legend.css }}
                />
              )}
              {row.label}
            </span>
            <span className="tabular-nums text-muted-on-dark">{row.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-ui-sm text-muted-on-dark" data-mold-draft-heuristic="" data-mold-pane-end="">
        Heuristic
      </div>
    </div>
  );
}
