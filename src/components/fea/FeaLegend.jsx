import React from 'react';
import {
  displacementGradientCss,
  displacementTicks,
  legendGradientCss,
  legendTicks,
  scaleTop,
} from '../../fea/colormap.js';
import { activePlot } from '../../fea/resultsView.js';
import { formatSolveSummary } from '../../fea/studyPanel.js';

function formatMPa(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function formatMm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function DisplacementLegend({ result, quiet = false, govern = false }) {
  const known = Number.isFinite(Number(result.displacementMin)) && Number.isFinite(Number(result.displacementMax));
  const scale = known
    ? { min: Number(result.displacementMin), max: Number(result.displacementMax) }
    : null;
  const ticks = scale ? displacementTicks(scale, 5) : [];
  const min = formatMm(result.displacementMin);
  const max = formatMm(result.displacementMax);
  const mode = result.field === 'mode' || result.source === 'modal';
  const unit = mode ? '' : ' mm';
  const governing = formatSolveSummary(result).governing;
  return (
    <div
      {...(quiet ? {} : {
        'data-fea-summary': '',
        'data-fea-legend': '',
        'data-fea-source': result.source || '',
        'data-fea-plot-legend': 'displacement',
        'data-fea-stale': '0',
      })}
      className="rounded border border-amber-300/50 bg-amber-400/10 px-2 py-1.5"
    >
      <div
        {...(quiet ? {} : { 'data-fea-legend-bar': '' })}
        className="h-2 w-full rounded"
        style={{ background: scale ? displacementGradientCss(scale) : 'rgb(128, 128, 128)' }}
        title={scale ? `${min} to ${max}${unit}` : 'displacement'}
      />
      {ticks.length > 0 && (
        <div
          {...(quiet ? {} : { 'data-fea-legend-ticks': '' })}
          className="mt-0.5 flex flex-nowrap justify-between gap-1 text-[10px] tabular-nums text-cyan-100/90"
        >
          {ticks.map((tick, index) => (
            <span key={index}>{formatMm(tick)}</span>
          ))}
        </div>
      )}
      <div className="truncate text-[12px] text-cyan-50" {...(quiet ? {} : { 'data-fea-displacement': '' })}>
        min {min}{unit} · max {max}{unit}
      </div>
      {(governing || govern) ? (
        <div className="truncate text-[12px] text-cyan-50" {...(quiet || !governing ? {} : { 'data-fea-governing': governing })}>
          governs {governing || '\u00a0'}
        </div>
      ) : null}
    </div>
  );
}

function ContactLegend({ result }) {
  const min = Number(result.contactPressureMin);
  const max = Number(result.contactPressureMax);
  const known = Number.isFinite(min) && Number.isFinite(max);
  const scale = known ? { min: Math.min(0, min), max: Math.max(max, min) } : null;
  const ticks = scale ? displacementTicks(scale, 5) : [];
  const open = result.contactOpen ?? 0;
  const stick = result.contactStick ?? 0;
  const slip = result.contactSlip ?? 0;
  return (
    <div
      data-fea-summary=""
      data-fea-legend=""
      data-fea-source={result.source || ''}
      data-fea-plot-legend="contact"
      data-fea-contact-open={String(open)}
      data-fea-contact-stick={String(stick)}
      data-fea-contact-slip={String(slip)}
      data-fea-stale={result.stale === true ? '1' : '0'}
      className="rounded border border-amber-300/50 bg-amber-400/10 px-2 py-1.5"
    >
      <div
        data-fea-legend-bar=""
        className="h-2 w-full rounded"
        style={{ background: scale ? displacementGradientCss(scale) : 'rgb(128, 128, 128)' }}
        title={known ? `${formatMPa(min)} to ${formatMPa(max)} MPa` : 'contact pressure'}
      />
      {ticks.length > 0 && (
        <div
          data-fea-legend-ticks=""
          className="mt-0.5 flex justify-between gap-1 text-[10px] tabular-nums text-cyan-100/90"
        >
          {ticks.map((tick, index) => (
            <span key={index}>{formatMPa(tick)}</span>
          ))}
        </div>
      )}
      <div className="text-[12px] text-cyan-50" data-fea-contact-pressure="">
        pressure min {formatMPa(min)} MPa · max {formatMPa(max)} MPa
      </div>
      <div className="text-[12px] text-cyan-50" data-fea-contact-status="">
        open {open} · stick {stick} · slip {slip}
      </div>
    </div>
  );
}

/**
 * Gradient, ticks, and the stub summary. Sits in the Analyze chip and the
 * phone sheet. Stress is von Mises. Displacement is magnitude in millimetres.
 * A stale result keeps the last stress numbers grey and says Re-run.
 * The coloured skin is already gone; this bar is not a live scale.
 */
export function FeaLegend({ result, plot = 'stress', quiet = false, govern = false }) {
  if (!result) return null;
  if (activePlot(plot) === 'contact' && result.contactActive === true && result.stale !== true) {
    return <ContactLegend result={result} />;
  }
  if (activePlot(plot) === 'displacement' && result.stale !== true) {
    return <DisplacementLegend result={result} quiet={quiet} govern={govern} />;
  }
  const summary = formatSolveSummary(result);
  const stale = result.stale === true;
  const scale = { p95: result.p95, yield_MPa: result.yield_MPa };
  const top = scaleTop(scale);
  const ticks = legendTicks(scale, 5);
  return (
    <div
      {...(quiet ? {} : {
        'data-fea-summary': '',
        'data-fea-legend': '',
        'data-fea-source': result.source || '',
        'data-fea-solve-ms': result.stats && Number.isFinite(result.stats.ms) ? String(Math.round(result.stats.ms)) : '',
        'data-fea-peak-bytes': result.stats && Number.isFinite(result.stats.peakMemoryBytes) ? String(result.stats.peakMemoryBytes) : '',
        'data-fea-stale': stale ? '1' : '0',
      })}
      className="rounded border border-amber-300/50 bg-amber-400/10 px-2 py-1.5"
    >
      <div className="mb-1 flex items-center gap-1.5">
        {summary.stub && (
          <span
            data-fea-stub="1"
            className="rounded bg-amber-400 px-1.5 py-0.5 text-[13px] font-bold tracking-wide text-amber-950"
          >
            STUB
          </span>
        )}
        {stale && (
          <span
            data-fea-rerun=""
            className="rounded bg-white px-1.5 py-0.5 text-[13px] font-bold tracking-wide text-cyan-950"
          >
            Re-run
          </span>
        )}
      </div>
      <div className={stale ? 'opacity-40 grayscale' : ''}>
        <div
          {...(quiet ? {} : { 'data-fea-legend-bar': '' })}
          className="h-2 w-full rounded"
          style={{ background: legendGradientCss(scale) }}
          title={`0 to ${formatMPa(top)} MPa`}
        />
        <div
          {...(quiet ? {} : { 'data-fea-legend-ticks': '' })}
          className="mt-0.5 flex flex-nowrap justify-between gap-1 text-[10px] tabular-nums text-cyan-100/90"
        >
          {ticks.map((tick, index) => (
            <span key={index}>{formatMPa(tick)}</span>
          ))}
        </div>
        <div className="truncate text-[12px] text-cyan-50" {...(quiet ? {} : { 'data-fea-stress': '' })}>
          min {summary.min} MPa · p95 {summary.p95} MPa · max {summary.max} MPa
        </div>
        <div className="truncate text-[12px] text-cyan-50" {...(quiet ? {} : { 'data-fea-fos': summary.fos })}>
          safety factor {summary.fos}
        </div>
        {(summary.governing || govern) ? (
          <div className="truncate text-[12px] text-cyan-50" {...(quiet || !summary.governing ? {} : { 'data-fea-governing': summary.governing })}>
            governs {summary.governing || '\u00a0'}
          </div>
        ) : null}
      </div>
      {summary.warning && (
        <div className="text-[11px] text-amber-100" data-fea-warning="">{summary.warning}</div>
      )}
    </div>
  );
}
