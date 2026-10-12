import React from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { ACCENTS, ChoiceRow, NumberField, POPUP_TEXT, PopupSection } from '../controls/popupUI';
import { MODAL_MODE_SLOTS, activePlot, plotTabs, resultsChrome } from '../../fea/resultsView.js';
import { FORCE_DIRECTIONS } from '../../fea/studyPanel.js';
import { directionAxis, directionButtonStyle } from '../../utils/triadAxis.js';
import { FeaLegend } from './FeaLegend';
import { FeaProbeList } from './FeaProbeList';
import { FeaLoadList } from './FeaLoadList';
import { FeaAssemblySetup } from './FeaAssemblySetup';
import { FeaMaterialPicker } from './FeaMaterialPicker';
import { FeaPreviewSliders } from './FeaPreviewSliders';

const TARGETS = [
  { value: 'fixture', label: 'Fix' },
  { value: 'force', label: 'Force' },
  { value: 'pressure', label: 'Pressure' },
];

const TAB_TONES = {
  cyan: {
    on: 'bg-cyan-600 text-white',
    off: 'border border-cyan-700/70 bg-cyan-950/80 text-cyan-100',
  },
  blue: {
    on: 'bg-blue-500 text-white',
    off: 'border border-blue-700/70 bg-blue-950/80 text-blue-100',
  },
  yellow: {
    on: 'bg-yellow-500 text-gray-900',
    off: 'border border-yellow-700/70 bg-yellow-950/80 text-yellow-100',
  },
};

/** Shared tab row. Fix / Force / Pressure and Stress / Displacement use it. */
export function FeaTabs({ options, value, onChange, groupAttr, itemAttr, toneFor }) {
  return (
    <div className="flex gap-1" {...{ [groupAttr]: '' }}>
      {options.map((option) => {
        const active = value === option.value;
        const toneName = toneFor?.(option.value) || 'cyan';
        const tone = TAB_TONES[toneName] || TAB_TONES.cyan;
        return (
          <button
            key={option.value}
            type="button"
            {...{ [itemAttr]: option.value }}
            {...(toneFor ? { 'data-fea-tone': toneName } : {})}
            aria-pressed={active}
            onClick={() => onChange?.(option.value)}
            className={`rounded px-2 py-1 text-[13px] ${active ? tone.on : tone.off}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** X/Y/Z use the viewport triad colors. Normal stays the card accent. */
function FeaDirectionRow({ value, onChange }) {
  return (
    <PopupSection label="Direction" accent="cyan">
      <div className="flex flex-wrap items-center gap-1.5" data-fea-directions="">
        {FORCE_DIRECTIONS.map((option) => {
          const on = option.value === value;
          const axis = directionAxis(option.value);
          const style = axis ? directionButtonStyle(axis, on) : undefined;
          return (
            <button
              key={option.value}
              type="button"
              data-fea-direction={option.value}
              {...(axis ? { 'data-fea-axis': axis } : {})}
              aria-pressed={on}
              onClick={() => onChange?.(option.value)}
              style={style}
              className={`rounded px-2.5 py-1 ${POPUP_TEXT.value} font-medium ${
                axis
                  ? 'border'
                  : (on ? ACCENTS.cyan.chipOn : ACCENTS.cyan.chipOff)
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </PopupSection>
  );
}

const STUDY_TYPES = [
  { value: 'linear-static', label: 'Static' },
  { value: 'modal', label: 'Modal' },
];

export function FeaStudyControls({ panel }) {
  const draft = panel.draft || {};
  const studyType = panel.study?.type === 'modal' ? 'modal' : 'linear-static';
  return (
    <>
      <FeaTabs
        options={STUDY_TYPES}
        value={studyType}
        onChange={panel.setStudyType}
        groupAttr="data-fea-study-types"
        itemAttr="data-fea-study-type"
      />
      {studyType === 'modal' && (
        <p className="text-[11px] text-cyan-100/80" data-fea-modal-note="">
          Loads are ignored. A modal study uses fixtures only.
        </p>
      )}
      <FeaMaterialPicker
        study={panel.study}
        draft={draft}
        onMaterial={panel.setMaterialId}
        onCustomMode={panel.setCustomMode}
        onCustomField={panel.setCustomField}
      />
      <div data-fea-refine={panel.refine === 'off' ? 'off' : 'auto'}>
        <ChoiceRow
          label="Refine"
          accent="cyan"
          options={[{ value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }]}
          value={panel.refine === 'off' ? 'off' : 'auto'}
          onChange={panel.setRefine}
        />
      </div>
      <FeaAssemblySetup panel={panel} />
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200/80">Tap adds</span>
      <FeaTabs
        options={TARGETS}
        value={draft.target}
        onChange={panel.setTarget}
        groupAttr="data-fea-targets"
        itemAttr="data-fea-target"
        toneFor={(target) => (target === 'fixture' ? 'blue' : 'yellow')}
      />
      </div>
      {draft.target === 'force' && (
        <>
          <NumberField
            label="Force N"
            id="fea-force"
            accent="cyan"
            min={0.1}
            max={10000}
            step={10}
            value={draft.magnitudeN}
            onChange={panel.setMagnitude}
          />
          <FeaDirectionRow
            value={draft.direction || 'normal'}
            onChange={panel.setDirection}
          />
        </>
      )}
      {draft.target === 'pressure' && (
        <NumberField
          label="Pressure MPa"
          id="fea-pressure"
          accent="cyan"
          min={-50}
          max={50}
          step={0.1}
          value={draft.pressureMPa}
          onChange={panel.setPressure}
        />
      )}
      <p className="text-[11px] text-cyan-100/80">Tap a face. Tap it again to remove it.</p>
      <FeaLoadList
        study={panel.study}
        memberIds={panel.memberIds}
        analyzedPartId={panel.analyzedPartId}
        onRemoveFixture={panel.removeFixture}
        onRemoveLoad={panel.removeLoad}
        selectedLoad={panel.preview?.available ? panel.preview.loadIndex : -1}
        onSelectLoad={panel.preview?.available ? panel.selectPreviewLoad : null}
      />
      <FeaPreviewSliders panel={panel} />
      {panel.notice && (
        <p className="text-[11px] text-amber-200" data-fea-notice="">{panel.notice}</p>
      )}
    </>
  );
}

const STAGE_LABEL = {
  'loading-mesher': 'Loading mesher',
  meshing: 'Meshing',
  assembling: 'Assembling',
  solving: 'Solving',
  'post-processing': 'Post-processing',
};

function FeaProgressBar({ report }) {
  const indeterminate = report.percent == null;
  const label = [report.stageLabel, report.stepLabel].filter(Boolean).join(' · ');
  const elapsed = report.elapsedText || '';
  return (
    <div
      data-fea-progress-bar=""
      data-fea-progress={report.stage || 'running'}
      data-fea-progress-indeterminate={indeterminate ? '1' : '0'}
      role="progressbar"
      aria-label={label || 'Analyze'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : report.percent}
      aria-busy="true"
      className="flex flex-col gap-0.5"
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-cyan-50">
        <span data-fea-progress-stage="" className="min-w-0 truncate">{label}</span>
        <span data-fea-progress-elapsed="" className="shrink-0 tabular-nums text-cyan-100/90">
          {elapsed}{report.percent != null ? ` · ${report.percent}%` : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-cyan-950">
        <div
          className={`h-full rounded bg-cyan-300 ${indeterminate ? 'w-1/3 animate-pulse' : ''}`}
          style={indeterminate ? undefined : { width: `${report.percent}%` }}
        />
      </div>
    </div>
  );
}

function StageTimes({ report }) {
  if (!Array.isArray(report?.details) || report.details.length === 0) return null;
  return (
    <details data-fea-timing-details="" className="text-[11px] text-cyan-100/80">
      <summary>Stage times</summary>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {report.details.map((row) => (
          <li key={row.id} data-fea-stage={row.id}>
            {row.label}: {row.seconds}
          </li>
        ))}
      </ul>
    </details>
  );
}

function FeaTiming({ report }) {
  if (!report || (report.status !== 'done' && report.status !== 'stopped') || !report.text) return null;
  const stopped = report.status === 'stopped';
  return (
    <div className="flex flex-col gap-0.5">
      <p
        data-fea-timing={stopped ? undefined : ''}
        data-fea-stopped={stopped ? '' : undefined}
        className={`text-[11px] leading-snug ${stopped ? 'text-amber-200' : 'text-cyan-50'}`}
      >
        {report.text}
      </p>
      <StageTimes report={report} />
    </div>
  );
}

/**
 * The done line is one grid cell with a reserve string of the same shape,
 * so a finished solve does not change the card height when the real line wraps.
 */
const TIMING_RESERVE = 'Solid mesh in 00.0 s, solved in 00.0 s (000k DOF), total 00.0 s, refined 0x, converged';

function FrameTiming({ report, done }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="grid text-[11px] leading-snug text-cyan-50">
        <span className="invisible col-start-1 row-start-1" aria-hidden="true">{TIMING_RESERVE}</span>
        {done && (
          <span className="col-start-1 row-start-1" data-fea-timing="">{report?.text || ''}</span>
        )}
      </p>
      {done ? <StageTimes report={report} /> : (
        <details data-fea-timing-details="" className="text-[11px] text-cyan-100/80">
          <summary>Stage times</summary>
        </details>
      )}
    </div>
  );
}

function showLegend(panel) {
  if (panel.preview?.showing) return true;
  if (!panel.result) return false;
  if (panel.results) return true;
  if (panel.dismissed && !panel.result.stale) return false;
  return true;
}

const STRESS_RESERVE = Object.freeze({
  source: 'tet10',
  min: 0,
  p95: 1,
  max: 1,
  safetyFactor: 1,
  yield_MPa: 1,
  warnings: [],
  stale: false,
});

const MODAL_RESERVE = Object.freeze({
  source: 'modal',
  field: 'mode',
  displacementMin: 0,
  displacementMax: 1,
  stale: false,
});

function multiPartScope(panel) {
  const kind = panel.study?.scope?.kind;
  return kind === 'assembly' || kind === 'parts';
}

/**
 * Invisible sizer for the plot slot. A multi-part study adds the governs
 * line here so the finished legend, which names the governing part, does
 * not change the card height.
 */
function reservedResult(panel, modes) {
  const base = modes ? MODAL_RESERVE : STRESS_RESERVE;
  if (!multiPartScope(panel)) return base;
  return { ...base, governingName: 'part' };
}

function modeButtonClass(selected) {
  return `whitespace-nowrap rounded px-2 py-1 text-left text-[13px] tabular-nums ${
    selected
      ? 'bg-cyan-600 text-white'
      : 'border border-cyan-700/70 bg-cyan-950/80 text-cyan-100'
  }`;
}

/** Results readout. Scrolls in the card body so Stage times cannot cover Back to Setup. */
function ModeList({ panel, reserve }) {
  const frequencies = reserve
    ? Array.from({ length: MODAL_MODE_SLOTS }, () => null)
    : (panel.result?.frequenciesHz || []);
  const mass = reserve ? [] : (panel.result?.effectiveMass || []);
  const selected = reserve ? 0 : (panel.modeIndex || 0);
  return (
    <div className="flex flex-col gap-1" data-fea-modes="">
      {frequencies.map((hz, index) => {
        const fx = mass[index * 3];
        const fy = mass[index * 3 + 1];
        const fz = mass[index * 3 + 2];
        const title = !reserve && [fx, fy, fz].every((value) => Number.isFinite(value))
          ? `effective mass ${fx.toFixed(2)} ${fy.toFixed(2)} ${fz.toFixed(2)}`
          : undefined;
        const label = reserve || !Number.isFinite(Number(hz))
          ? `Mode ${index + 1}`
          : `Mode ${index + 1}: ${Number(hz).toFixed(1)} Hz`;
        return (
          <button
            key={index}
            type="button"
            {...(reserve
              ? { 'data-fea-mode-slot': index, disabled: true }
              : { 'data-fea-mode': index, 'data-fea-frequency': hz })}
            title={title}
            aria-pressed={selected === index}
            onClick={reserve ? undefined : () => panel.setMode?.(index)}
            className={modeButtonClass(selected === index)}
          >
            {label}
          </button>
        );
      })}
      <label className="flex items-center gap-1.5 text-[12px] text-cyan-100">
        <input
          type="checkbox"
          {...(reserve ? { disabled: true } : { 'data-fea-animate': '' })}
          checked={!reserve && panel.animate === true}
          onChange={reserve ? () => {} : (event) => panel.setAnimate?.(event.target.checked)}
        />
        Animate
      </label>
    </div>
  );
}

export function FeaResultsReadout({ panel }) {
  const chrome = resultsChrome({ screen: panel.screen, kind: panel.viewKind });
  if (!chrome.frame) return null;
  const filled = chrome.screen === 'results';
  const tabs = plotTabs(filled ? panel.result : null);
  const plot = tabs.some((tab) => tab.value === panel.plot) ? activePlot(panel.plot) : 'stress';
  const legendPlot = chrome.modes ? 'displacement' : (filled ? plot : 'stress');
  const legendResult = filled ? panel.result : reservedResult(panel, chrome.modes);
  const govern = multiPartScope(panel);
  return (
    <div className="mt-1.5 flex flex-col gap-1 font-sans" data-fea-results-frame="">
      {chrome.modes ? (
        <ModeList panel={panel} reserve={!filled} />
      ) : (
        <FeaTabs
          options={tabs}
          value={plot}
          onChange={panel.setPlot}
          groupAttr="data-fea-plots"
          itemAttr="data-fea-plot"
        />
      )}
      <div className="relative" data-fea-plot-slot="">
        <div className={filled ? undefined : 'invisible'} aria-hidden={filled ? undefined : true}>
          <FeaLegend
            quiet={!filled}
            govern={govern}
            result={legendResult}
            preview={filled ? panel.preview : null}
            plot={legendPlot}
          />
        </div>
        {chrome.progress && (
          <div className="absolute inset-0 flex items-center">
            <div className="w-full">
              <FeaProgressBar report={panel.runReport || {}} />
            </div>
          </div>
        )}
        {chrome.stopped && (
          <div className="absolute inset-0 flex items-center overflow-hidden">
            <p data-fea-stopped="" className="w-full text-[11px] leading-snug text-amber-200">
              {panel.runReport?.text || ''}
            </p>
          </div>
        )}
      </div>
      {filled ? (
        <FeaProbeList
          rows={panel.probeRows}
          onRemove={panel.removeProbe}
          onClear={panel.clearProbes}
        />
      ) : null}
      {chrome.stopped ? <StageTimes report={panel.runReport} /> : (
        <FrameTiming report={panel.runReport} done={filled} />
      )}
    </div>
  );
}

export function FeaRunBar({ panel }) {
  const chrome = resultsChrome({ screen: panel.screen, kind: panel.viewKind });
  const report = panel.runReport;
  const stage = panel.running ? (report?.stageLabel || STAGE_LABEL[panel.progress] || 'Running') : 'Run';
  return (
    <div className="mt-1 flex shrink-0 flex-col gap-1">
      {!chrome.frame && showLegend(panel) && (
        <FeaLegend result={panel.result} preview={panel.preview} plot="stress" />
      )}
      {!chrome.frame && !panel.running && <FeaTiming report={report} />}
      <div className="flex items-center justify-end gap-2">
      {chrome.cancel && (
        <button
          type="button"
          data-fea-cancel=""
          onClick={() => panel.cancel?.()}
          className="inline-flex items-center rounded-md border border-cyan-700/70 px-2 py-1 text-[13px] font-medium text-cyan-100"
        >
          Cancel
        </button>
      )}
      {chrome.back && (
        <button
          type="button"
          data-fea-back=""
          onClick={() => panel.backToSetup?.()}
          className="inline-flex items-center gap-1 rounded-md border border-transparent bg-cyan-600 px-2 py-1 text-[13px] font-medium text-white hover:bg-cyan-500"
        >
          <ArrowLeft size={14} />
          Back to Setup
        </button>
      )}
      {chrome.run && (
      <button
        type="button"
        data-fea-run={panel.running ? 'busy' : 'ready'}
        onClick={() => panel.run?.()}
        disabled={!!panel.running}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium ${
          panel.running
            ? 'cursor-wait bg-cyan-950/80 text-cyan-300'
            : 'bg-cyan-600 text-white hover:bg-cyan-500'
        }`}
      >
        <Check size={14} />
        {stage}
      </button>
      )}
      </div>
    </div>
  );
}
