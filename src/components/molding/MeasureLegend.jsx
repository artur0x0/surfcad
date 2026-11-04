/**
 * Measurements section of the molding results pane: part volume, projected
 * area along the pull, and extents, with an in | cm toggle at the top right
 * (inches by default). Labels stay `text-on-dark`. Read-only.
 */

import React from 'react';

function Row({ label, testId, value, note }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-on-dark">
        {label}
        {note ? <span className="text-muted-on-dark">{` ${note}`}</span> : null}
      </dt>
      <dd className="text-on-dark tabular-nums" data-mold-measure-field={testId}>{value || '—'}</dd>
    </div>
  );
}

export default function MeasureLegend({ legend, onUnit = null }) {
  if (!legend) return null;
  const units = Array.isArray(legend.units) && legend.units.length ? legend.units : ['in', 'cm'];
  return (
    <div
      data-mold-measure-legend=""
      data-mold-measure-unit={legend.unit}
      className="mold-results-section font-ui text-on-dark"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-ui-sm">Measurements</div>
        <div className="flex gap-1" role="group" aria-label="Measurement unit">
          {units.map((unit) => (
            <button
              key={unit}
              type="button"
              className="mold-pull-choice text-ui-sm text-on-dark"
              aria-pressed={legend.unit === unit}
              data-mold-measure-unit-choice={unit}
              data-ui-action={`data-mold-measure-unit-${unit}`}
              onClick={() => onUnit?.(unit)}
            >
              {unit}
            </button>
          ))}
        </div>
      </div>
      <dl className="mt-1 flex flex-col gap-1 text-ui-sm" data-mold-pane-end="">
        <Row label="Volume" testId="volume" value={legend.volume} />
        <Row label="Projected area" testId="area" value={legend.area} note={legend.pull ? `along ${legend.pull}` : ''} />
        <Row label="Extents" testId="extents" value={legend.extents} note="X × Y × Z" />
      </dl>
    </div>
  );
}
