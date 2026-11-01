/**
 * Mold-draft section of the molding results pane.
 *
 * Threshold buttons rebucket the signed field. The reference plane is the
 * shared pull control above this section. Pin and sleeve counts are a
 * heuristic, and the section says so. This is not the CAD draft tool.
 */

import React from 'react';
import { MOLD_DRAFT_PRESETS, moldDraftSwatchChannels } from '../../molding/moldDraft.js';

function areaText(area) {
  const n = Number(area) || 0;
  if (Math.abs(n) >= 100) return String(Math.round(n));
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function bucket(value) {
  return {
    count: value?.count || 0,
    area: value?.area || 0,
  };
}

export default function MoldDraftLegend({ legend, onThreshold = null }) {
  if (!legend) return null;
  const minDeg = legend.minDeg ?? 1;
  const presets = Array.isArray(legend.presets) && legend.presets.length
    ? legend.presets
    : MOLD_DRAFT_PRESETS;
  const positive = bucket(legend.positive);
  const negative = bucket(legend.negative);
  const below = bucket(legend.below);
  const belowPositive = legend.below?.positive?.count || 0;
  const belowNegative = legend.below?.negative?.count || 0;
  const swatches = moldDraftSwatchChannels();
  const rows = [
    {
      key: 'positive',
      label: `Positive ≥ ${minDeg}°`,
      count: positive.count,
      area: positive.area,
      swatch: 'mold-draft-swatch-positive',
      state: 'positive',
    },
    {
      key: 'negative',
      label: `Negative ≥ ${minDeg}°`,
      count: negative.count,
      area: negative.area,
      swatch: 'mold-draft-swatch-negative',
      state: 'negative',
    },
    {
      key: 'below',
      label: `Below ${minDeg}°`,
      count: below.count,
      area: below.area,
      swatch: 'mold-draft-swatch-needs-work',
      state: 'below',
      signText: `${belowPositive} positive · ${belowNegative} negative`,
    },
    { key: 'pins', label: 'Ejector pin', count: legend.pins || 0, swatch: null, state: null },
    { key: 'sleeves', label: 'Sleeve', count: legend.sleeves || 0, swatch: null, state: null },
  ];
  return (
    <div
      data-mold-draft-legend=""
      className="mold-results-section font-ui text-on-dark"
      style={{
        '--mold-draft-positive': swatches.positive,
        '--mold-draft-negative': swatches.negative,
      }}
    >
      <div className="text-ui-sm">Mold draft</div>
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Draft threshold">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="mold-pull-choice text-ui-sm text-on-dark"
            aria-pressed={Number(minDeg) === Number(preset)}
            data-mold-draft-threshold={preset}
            data-ui-action="data-mold-draft-threshold"
            onClick={() => onThreshold?.(preset)}
          >
            {`${preset}°`}
          </button>
        ))}
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-0.5 text-ui-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 text-on-dark">
                {row.swatch && (
                  <span
                    data-mold-draft-swatch={row.state}
                    className={`inline-block h-2 w-4 rounded-sm ${row.swatch}`}
                  />
                )}
                {row.label}
              </span>
              <span
                className="shrink-0 whitespace-nowrap tabular-nums text-muted-on-dark"
                {...(row.state ? {
                  [`data-mold-draft-${row.state}`]: row.count,
                  [`data-mold-draft-${row.state}-area`]: row.area,
                } : {})}
              >
                {row.area == null ? row.count : `${row.count} · ${areaText(row.area)} mm²`}
              </span>
            </div>
            {row.signText && (
              <div
                className="pl-5 text-ui-sm text-muted-on-dark"
                data-mold-draft-below-sign=""
                data-mold-draft-below-positive={belowPositive}
                data-mold-draft-below-negative={belowNegative}
              >
                {row.signText}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-1 text-ui-sm text-muted-on-dark" data-mold-draft-heuristic="" data-mold-pane-end="">
        Heuristic
      </div>
    </div>
  );
}
