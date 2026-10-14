import React from 'react';
import { X } from 'lucide-react';
import { formatDisplayNumber } from '../../utils/displayUnit';

function formatValue(value) {
  const text = formatDisplayNumber(value);
  return text === '' ? 'n/a' : text;
}

function formatCoord(value) {
  const text = formatDisplayNumber(value);
  return text === '' ? '?' : text;
}

function joinNums(list) {
  if (!list || !list.length) return '';
  return list.map((value) => (Number.isFinite(value) ? Number(value).toPrecision(8) : 'nan')).join(' ');
}

/**
 * One row per probe under the legend. The list scrolls after about four
 * rows so the card height stays put at 390 and 1280.
 */
export function FeaProbeList({ rows, onRemove, onClear }) {
  if (!rows?.length) return null;
  return (
    <div data-fea-probes="" data-fea-probe-count={rows.length} className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200/80">Probes</span>
        <button
          type="button"
          data-fea-probe-clear=""
          onClick={() => onClear?.()}
          className="shrink-0 rounded border border-cyan-700/70 bg-cyan-950/80 px-1.5 py-0.5 text-[11px] text-cyan-100"
        >
          Clear
        </button>
      </div>
      <ul
        data-fea-probe-list=""
        className="flex max-h-[5rem] flex-col gap-0.5 overflow-y-auto overscroll-contain"
      >
        {rows.map((row, index) => {
          const unit = row.unit ? ` ${row.unit}` : '';
          const place = `${formatCoord(row.x)}, ${formatCoord(row.y)}, ${formatCoord(row.z)}`;
          return (
            <li
              key={row.id}
              data-fea-probe={index}
              data-fea-probe-id={row.id}
              data-fea-probe-value={Number.isFinite(row.value) ? String(row.value) : ''}
              data-fea-probe-unit={row.unit || ''}
              data-fea-probe-quantity={row.quantity || ''}
              data-fea-probe-mix={row.mix || ''}
              data-fea-probe-x={Number.isFinite(row.x) ? String(row.x) : ''}
              data-fea-probe-y={Number.isFinite(row.y) ? String(row.y) : ''}
              data-fea-probe-z={Number.isFinite(row.z) ? String(row.z) : ''}
              data-fea-probe-weights={joinNums(row.weights)}
              data-fea-probe-nodal={joinNums(row.nodal)}
              className="flex items-center gap-1 text-[12px] text-cyan-50"
            >
              <span className="w-4 shrink-0 tabular-nums text-cyan-100/90">{index + 1}</span>
              <span className="shrink-0 tabular-nums">{formatValue(row.value)}{unit}</span>
              <span className="min-w-0 flex-1 truncate tabular-nums text-cyan-100/75">{place}</span>
              <button
                type="button"
                data-fea-probe-remove={row.id}
                onClick={() => onRemove?.(row.id)}
                className="shrink-0 rounded p-0.5 text-gray-300 hover:text-white"
                aria-label={`Remove probe ${index + 1}`}
                title="Remove probe"
              >
                <X size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
