/**
 * Budgetary DFM panel. Dark glass, scrollable, text only. It does not
 * paint a skin. Draft, side actions, and ejectors stay labeled heuristic.
 */

import React from 'react';

function pullText(pull) {
  if (!Array.isArray(pull)) return '—';
  return `[${pull.join(', ')}]`;
}

function kindLabel(kind) {
  return kind === 'lifter' ? 'Lifter' : 'Slide';
}

export default function DfmReportPanel({ report, shifted = false, belowPull = false }) {
  if (!report) return null;
  const wall = report.wall || {};
  const draft = report.draft || {};
  const sides = report.sideActions || {};
  const ejectors = report.ejectors || {};
  const naming = report.naming || {};
  const groups = Array.isArray(sides.groups) ? sides.groups : [];
  const shown = groups.slice(0, 6);
  const hiddenGroups = Math.max(0, groups.length - shown.length);
  const nominal = wall.nominalKnown
    ? `${wall.nominal} mm${wall.nominalMethod ? ` (${wall.nominalMethod})` : ''}`
    : 'Unknown';
  const max = wall.max == null ? '—' : `${wall.max} mm`;
  const minDraft = draft.minDraftDeg == null ? '—' : `${draft.minDraftDeg}°`;
  const pullSource = report.pullSource === 'override' ? 'Override' : 'Search';

  return (
    <div
      data-mold-dfm-report=""
      className={`pointer-events-auto absolute wall-legend-anchor z-30 dfm-report-panel overflow-y-auto rounded-md surface-glass surface-glass-chip px-3 py-2 font-ui text-on-dark${shifted ? ' dfm-report-shifted' : ''}${belowPull ? ' dfm-report-below-pull' : ''}`}
    >
      <div className="text-ui-sm" data-mold-dfm-framing="">{report.framing}</div>
      <p className="mt-0.5 text-ui-sm text-muted-on-dark" data-mold-dfm-disclaimer="">
        {report.disclaimer}
      </p>
      <dl className="mt-2 flex flex-col gap-2 text-ui-sm">
        <div>
          <dt className="text-muted-on-dark">Fit</dt>
          <dd className="text-on-dark" data-mold-dfm-fit="">
            {report.fitLabel || '—'}
            <span className="text-muted-on-dark">{` · ${report.undercutCount} undercuts`}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-on-dark">Pull</dt>
          <dd className="text-on-dark tabular-nums" data-mold-dfm-pull="">
            {pullText(report.pull)}
            <span className="text-muted-on-dark">{` · ${pullSource}`}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-on-dark">Wall</dt>
          <dd className="text-on-dark" data-mold-dfm-wall="">
            <div>{nominal}</div>
            <div className="text-muted-on-dark">{`thin ${wall.thinCount} · thick ${wall.thickCount} · max ${max}`}</div>
          </dd>
        </div>
        <div>
          <dt className="text-muted-on-dark">Draft</dt>
          <dd className="text-on-dark" data-mold-dfm-draft="">
            {`${draft.violationCount} below ${draft.minDeg}° · min ${minDraft}`}
          </dd>
          <div className="text-muted-on-dark">Heuristic</div>
        </div>
        <div>
          <dt className="text-muted-on-dark">Side actions</dt>
          <dd className="text-on-dark" data-mold-dfm-sides="">
            {`${sides.slideCount} slides · ${sides.lifterCount} lifters`}
          </dd>
          {shown.length > 0 && (
            <ul className="mt-0.5 flex flex-col gap-0.5" data-mold-dfm-groups="">
              {shown.map((group, index) => (
                <li key={`${group.kind}-${index}`} className="flex justify-between gap-2 text-on-dark tabular-nums">
                  <span>{kindLabel(group.kind)}</span>
                  <span>{pullText(group.pull)}</span>
                </li>
              ))}
            </ul>
          )}
          {hiddenGroups > 0 && (
            <div className="text-muted-on-dark">{`+${hiddenGroups} more`}</div>
          )}
          <div className="text-muted-on-dark">Heuristic</div>
        </div>
        <div>
          <dt className="text-muted-on-dark">Ejectors</dt>
          <dd className="text-on-dark" data-mold-dfm-ejectors="">
            {`${ejectors.pinCount} pins · ${ejectors.sleeveCount} sleeves`}
          </dd>
          <div className="text-muted-on-dark">Heuristic</div>
        </div>
        <div data-mold-dfm-names="">
          <div className="text-muted-on-dark">Faces</div>
          {naming.stamped ? (
            <ul className="text-on-dark">
              {(naming.names || []).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <div className="text-on-dark">{naming.note || 'Face names are not available.'}</div>
          )}
          {naming.extra > 0 && (
            <div className="text-muted-on-dark">{`+${naming.extra} more`}</div>
          )}
        </div>
      </dl>
    </div>
  );
}
