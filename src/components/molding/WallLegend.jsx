/**
 * Wall-thickness section of the molding results pane. Thin is the purple
 * end, nominal the middle, thick the yellow end. Labels stay `text-on-dark`.
 */

import React from 'react';

function mm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

export default function WallLegend({ legend }) {
  if (!legend) return null;
  return (
    <div
      data-wall-legend=""
      className="mold-results-section font-ui text-on-dark"
    >
      <div className="text-ui-sm">Wall thickness</div>
      <div
        data-wall-legend-bar=""
        className="mt-1 h-2 w-full rounded"
        style={{ background: legend.css }}
      />
      <div
        data-wall-legend-ticks=""
        className="mt-1 flex justify-between gap-1 text-ui-sm text-muted-on-dark"
      >
        <span>Thin</span>
        <span>Nominal</span>
        <span>Thick</span>
      </div>
      <div className="flex justify-between gap-1 text-ui-sm tabular-nums text-on-dark" data-mold-pane-end="">
        <span>{mm(legend.thinMm)}</span>
        <span>{mm(legend.nominalMm)}</span>
        <span>{mm(legend.thickMm)}</span>
      </div>
    </div>
  );
}
