import React from 'react';
import FeatureSheet from './FeatureSheet';
import { useDisplayUnit } from '../hooks/useDisplayUnit';
import {
  formatDisplayAngle,
  formatDisplayDelta,
  formatDisplayLength,
  lengthCaption,
} from '../utils/displayUnit';
import { measureReadout } from '../utils/measurePicks';

/**
 * mm | in in the card header. The model stays millimetres. This is the
 * first reader of the global display unit.
 */
export function MeasureUnitToggle({ unit = 'mm', onChange }) {
  return (
    <div
      role="group"
      aria-label="Display units"
      data-measure-unit={unit}
      className="inline-flex shrink-0 rounded-md bg-black/30 p-0.5"
    >
      {['mm', 'in'].map((next) => (
        <button
          key={next}
          type="button"
          data-measure-unit-choice={next}
          aria-pressed={unit === next}
          onClick={() => onChange?.(next)}
          className={`min-h-[44px] min-w-[44px] rounded px-2 text-sm font-medium ${
            unit === next ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:text-white'
          }`}
        >
          {next}
        </button>
      ))}
    </div>
  );
}

function formatRow(row, unit) {
  if (row.kind === 'angle') return formatDisplayAngle(row.deg);
  if (String(row.kind).startsWith('delta')) return formatDisplayDelta(row.mm, unit);
  return formatDisplayLength(row.mm, unit);
}

/** Length captions end with mm or in. Angles keep the degree mark on the value. */
function rowCaption(row, unit) {
  if (row.kind === 'angle') return row.label;
  return lengthCaption(row.label, unit);
}

/**
 * Measure on the shared feature card. X closes and writes nothing.
 * There is no Confirm. Clear drops the picks and leaves the tool open.
 */
export default function MeasureModeChip({
  picks = [],
  compact = false,
  onClear,
  onDismiss,
}) {
  const [unit, setUnit] = useDisplayUnit();
  const list = Array.isArray(picks) ? picks : [];
  const readout = measureReadout(list);
  const count = list.length;
  let subtitle = 'Tap a point, edge, face, or part';
  if (count === 1) subtitle = '1 pick · tap to add, tap it again to remove';
  else if (count > 1) subtitle = `${count} picks · showing the last two`;

  return (
    <FeatureSheet
      title="Measure"
      subtitle={subtitle}
      compact={compact}
      onCancel={onDismiss}
      headerExtra={<MeasureUnitToggle unit={unit} onChange={setUnit} />}
      cardAttrs={{
        'data-measure-mode': '1',
        'data-measure-picks': String(count),
        'data-measure-unit': unit,
        'data-ui-action': 'data-measure-mode-chip',
      }}
    >
      <div className="mt-1 space-y-1 font-sans" data-measure-readout="">
        {readout.rows.length ? readout.rows.map((row) => (
          <div
            key={row.id}
            className="flex items-baseline justify-between gap-3 text-[13px]"
            data-measure-id={row.id}
          >
            <span className="text-gray-300" data-measure-caption="">
              {rowCaption(row, unit)}
            </span>
            <span className="font-mono text-white" data-measure-value={row.kind}>
              {formatRow(row, unit)}
            </span>
          </div>
        )) : (
          <p className="text-[13px] text-gray-300" data-measure-empty="">
            Distance, angle, radius, and ΔX ΔY ΔZ show up as you pick.
          </p>
        )}
      </div>
      {count > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Picked geometry">
          {list.map((pick, index) => (
            <li
              key={pick.id}
              data-measure-pick={pick.kind}
              className="rounded bg-cyan-600/25 px-2 py-0.5 text-[12px] text-cyan-100"
            >
              {index + 1} {pick.label}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        data-measure-clear=""
        onClick={() => onClear?.()}
        className="mt-2 min-h-[44px] w-full rounded-md bg-white/10 text-[13px] font-medium text-white hover:bg-white/15"
      >
        Clear
      </button>
    </FeatureSheet>
  );
}
