/**
 * Viewport legend for mold draft and ejector hints. The chip is dark glass.
 * Pin and sleeve counts are a heuristic, and the chip says so. This is not
 * the CAD draft tool.
 */

import React from 'react';
import MoldAnalysisPane from './MoldAnalysisPane';

export default function MoldDraftLegend({ legend, belowPull = false }) {
  if (!legend) return null;
  const rows = [
    { key: 'violations', label: `Below ${legend.minDeg}°`, count: legend.violations, swatch: true },
    { key: 'pins', label: 'Ejector pin', count: legend.pins, swatch: false },
    { key: 'sleeves', label: 'Sleeve', count: legend.sleeves, swatch: false },
  ];
  return (
    <MoldAnalysisPane
      data-mold-draft-legend=""
      className={`pointer-events-none absolute wall-legend-anchor z-30 w-44 rounded-md surface-glass surface-glass-chip px-2 py-1.5 font-ui text-on-dark${belowPull ? ' mold-below-pull' : ''}`}
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
    </MoldAnalysisPane>
  );
}
