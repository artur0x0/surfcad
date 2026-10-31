/**
 * Viewport legend for the wall heatmap. Thin is the purple end, nominal
 * the middle, thick the yellow end. The chip is dark glass so the labels
 * stay `text-on-dark` over the model.
 */

import React from 'react';
import MoldAnalysisPane from './MoldAnalysisPane';

function mm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

export default function WallLegend({ legend }) {
  if (!legend) return null;
  return (
    <MoldAnalysisPane
      data-wall-legend=""
      className="pointer-events-none absolute wall-legend-anchor z-30 w-44 rounded-md surface-glass surface-glass-chip px-2 py-1.5 font-ui text-on-dark"
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
    </MoldAnalysisPane>
  );
}
