import React from 'react';
import { X } from 'lucide-react';
import { entryVisible } from '../../fea/feaPickGate.js';

function faceAt(face) {
  const at = face?.at || [];
  return at.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '?';
  }).join(', ');
}

function loadText(load) {
  if (load?.kind === 'pressure') return `Pressure ${load.pressure_MPa} MPa`;
  const vector = (load?.vector || []).map((value) => Math.round(Number(value) || 0)).join(', ');
  return `Force ${vector} N`;
}

/**
 * Fixtures and loads already on the study, each with a remove button.
 */
export function FeaLoadList({
  study,
  onRemoveFixture,
  onRemoveLoad,
  memberIds = null,
  analyzedPartId = '',
}) {
  const show = (entry) => (
    memberIds == null || entryVisible(entry, memberIds, analyzedPartId)
  );
  const fixtures = (study?.fixtures || [])
    .map((fixture, index) => ({ fixture, index }))
    .filter(({ fixture }) => show(fixture));
  const loads = (study?.loads || [])
    .map((load, index) => ({ load, index }))
    .filter(({ load }) => show(load));
  return (
    <div className="flex flex-col gap-1">
      <div data-fea-fixtures="" data-fea-fixture-count={fixtures.length}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Fixtures</div>
        {fixtures.length === 0 && (
          <div className="text-[11px] text-blue-100/70">None yet. Choose Fix and tap a face.</div>
        )}
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {fixtures.map(({ fixture, index }) => (
            <li key={`fixture-${index}`} className="flex items-center gap-1 text-[12px] text-blue-50" data-fea-fixture={index}>
              <span data-fea-swatch="fixture" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-blue-500" />
              <span className="min-w-0 flex-1 truncate">Fixed · {faceAt(fixture.faces?.[0])}</span>
              <button
                type="button"
                data-fea-remove={`fixture-${index}`}
                onClick={() => onRemoveFixture?.(index)}
                className="shrink-0 rounded p-1 text-gray-300 hover:text-white"
                aria-label={`Remove fixture ${index + 1}`}
                title="Remove fixture"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div data-fea-loads="" data-fea-load-count={loads.length}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-yellow-300">Loads</div>
        {loads.length === 0 && (
          <div className="text-[11px] text-yellow-100/80">None yet. Choose Force or Pressure and tap a face.</div>
        )}
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {loads.map(({ load, index }) => (
            <li key={`load-${index}`} className="flex items-center gap-1 text-[12px] text-yellow-50" data-fea-load={index}>
              <span data-fea-swatch="load" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-yellow-500" />
              <span className="min-w-0 flex-1 truncate">{loadText(load)} · {faceAt(load.faces?.[0])}</span>
              <button
                type="button"
                data-fea-remove={`load-${index}`}
                onClick={() => onRemoveLoad?.(index)}
                className="shrink-0 rounded p-1 text-gray-300 hover:text-white"
                aria-label={`Remove load ${index + 1}`}
                title="Remove load"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
