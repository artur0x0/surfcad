/**
 * Auto | Plane | Face pull used by core/cavity, side actions, and mold draft.
 * First section of the molding results pane. Light text only.
 */

import React from 'react';
import { MOLD_PULL_PLANES } from '../../molding/pullReference.js';

const MODES = [
  { id: 'auto', label: 'Auto', action: 'data-mold-pull-auto' },
  { id: 'plane', label: 'Plane', action: 'data-mold-pull-plane' },
  { id: 'face', label: 'Face', action: 'data-mold-pull-face' },
];

export default function PullReference({
  mode = 'auto',
  plane = null,
  waiting = false,
  onAuto = null,
  onPlane = null,
  onFace = null,
  onPickPlane = null,
}) {
  const choose = {
    auto: onAuto,
    plane: onPlane,
    face: onFace,
  };
  return (
    <div
      data-mold-pull=""
      data-mold-pull-mode={mode}
      className="mold-results-section font-ui text-on-dark"
    >
      <div className="text-ui-sm">Pull</div>
      <div className="mt-1 flex gap-1" role="group" aria-label="Pull direction">
        {MODES.map((row) => (
          <button
            key={row.id}
            type="button"
            className="mold-pull-choice text-ui-sm text-on-dark"
            aria-pressed={mode === row.id}
            data-mold-pull-choice={row.id}
            data-ui-action={row.action}
            onClick={() => choose[row.id]?.()}
          >
            {row.label}
          </button>
        ))}
      </div>
      {mode === 'plane' && (
        <div className="mt-1 flex gap-1" role="group" aria-label="Pull plane">
          {Object.values(MOLD_PULL_PLANES).map((row) => (
            <button
              key={row.id}
              type="button"
              className="mold-pull-choice text-ui-sm text-on-dark"
              aria-pressed={plane === row.id}
              data-mold-pull-plane={row.id}
              data-ui-action={`data-mold-pull-${row.id}`}
              onClick={() => onPickPlane?.(row.id)}
            >
              {row.label}
            </button>
          ))}
        </div>
      )}
      {mode === 'face' && waiting && (
        <div className="mt-1 text-ui-sm text-muted-on-dark" data-mold-pull-waiting="">
          Pick a face
        </div>
      )}
    </div>
  );
}
