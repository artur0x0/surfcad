/**
 * Stage line while a molding analysis is still computing. It is status,
 * not a control: the toolbar button carries the pending state.
 */

import React from 'react';

export default function MoldProgress({ progress }) {
  if (!progress?.stage) return null;
  const percent = Number.isFinite(progress.percent)
    ? Math.max(0, Math.min(100, Math.round(progress.percent)))
    : null;
  return (
    <div
      className="mold-results-section flex items-center gap-2 font-ui text-on-dark"
      role="status"
      aria-live="polite"
      data-mold-progress=""
      data-mold-pane-end=""
    >
      <span className="mold-progress-spinner" aria-hidden="true" />
      <span data-mold-progress-stage="">{progress.stage}</span>
      {percent != null && (
        <span className="tabular-nums" data-mold-progress-percent="">{`${percent}%`}</span>
      )}
    </div>
  );
}
