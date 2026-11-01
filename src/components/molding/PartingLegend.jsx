/**
 * Core / cavity section of the molding results pane. Labels stay
 * `text-on-dark`. Counts stay off the section: the parting line is one
 * polyline, not a face tally. Side actions are rows in this same section.
 */

import React from 'react';

export default function PartingLegend({ legend, onSelectGroup = null }) {
  if (!legend) return null;
  const groups = Array.isArray(legend.groups) ? legend.groups : null;
  return (
    <div
      data-parting-legend=""
      className="mold-results-section font-ui text-on-dark"
    >
      <div className="text-ui-sm">Core and cavity</div>
      <ul className="mt-1 flex flex-col gap-1" data-mold-pane-end={groups ? undefined : ''}>
        {legend.rows.map((row) => (
          <li key={row.role} className="flex items-center gap-1 text-ui-sm text-on-dark">
            <span
              data-parting-swatch={row.role}
              className="inline-block h-2 w-4 rounded-sm"
              style={{ background: row.css }}
            />
            {row.label}
            {row.role === 'side' && groups && groups.length === 0 ? (
              <span className="ml-auto text-muted-on-dark" data-side-action-empty="">
                None
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {groups && groups.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {groups.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-ui-sm text-on-dark"
                aria-pressed={!!row.selected}
                data-mold-side-action-group=""
                data-side-action-id={row.id}
                data-side-action-selected={row.selected ? 'true' : 'false'}
                data-ui-action="data-mold-side-action-group"
                onClick={() => onSelectGroup?.(row.id)}
              >
                <span className="flex items-center gap-1">
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
              </button>
            </li>
          ))}
        </ul>
      )}
      {groups && (
        <div className="mt-1 text-ui-sm text-muted-on-dark" data-side-action-heuristic="" data-mold-pane-end="">
          Heuristic
        </div>
      )}
    </div>
  );
}
