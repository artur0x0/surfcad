/**
 * Mold report. One section of the molding results pane.
 * Geometry on top. Resin, quantity, and the estimates below the break.
 * Firm quote and human review stay available once a vendor quote is loaded.
 */

import React, { useState } from 'react';
import { REPORT_QUANTITIES } from '../../molding/moldReport.js';
import { PAY_FOR_REVIEW_MESSAGE } from '../../utils/moldingLeadClient.js';

function num(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : null;
}

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : null;
}

function Row({ label, testId, value, note }) {
  return (
    <div>
      <dt className="text-muted-on-dark">{label}</dt>
      <dd className="text-on-dark tabular-nums" data-mold-report-field={testId}>
        {value || '—'}
        {note && !value ? <span className="text-muted-on-dark">{` ${note}`}</span> : null}
      </dd>
    </div>
  );
}

export default function MoldReportPanel({
  report,
  resins = [],
  quoteState = null,
  onGrade,
  onQuantity,
  onExport,
  onFirmQuote,
  onHumanReview,
  onPayReview,
}) {
  const [custom, setCustom] = useState('');
  if (!report) return null;
  const geometry = report.geometry || {};
  const estimates = report.estimates || {};
  const notes = report.notes || {};
  const grades = [];
  for (const row of resins) {
    if (typeof row?.grade === 'string' && row.grade && !grades.includes(row.grade)) grades.push(row.grade);
  }
  if (report.grade && !grades.includes(report.grade)) grades.unshift(report.grade);
  const preset = REPORT_QUANTITIES.includes(report.quantity);
  const customInvalid = custom !== '' && !/^[0-9]+$/.test(custom.trim());
  const volume = num(geometry.volumeCm3, 3);
  const area = num(geometry.projectedAreaMm2, 2);
  const tons = num(estimates.pressTons, 2);
  const mass = num(estimates.massKg, 4);
  const toolAl = money(estimates.toolingAluminumUsd);
  const toolSt = money(estimates.toolingSteelUsd);
  const tooling = toolAl && toolSt ? `Aluminum ${toolAl} · Steel ${toolSt}` : null;
  const vendors = Array.isArray(quoteState?.quote?.vendors) ? quoteState.quote.vendors : [];
  const selected = vendors.find((row) => row.anonLabel === quoteState?.selected) || vendors[0] || null;
  const revealed = quoteState?.revealed || {};
  const selectedName = selected ? (revealed[selected.anonLabel] || '') : '';

  return (
    <div data-mold-report="" className="mold-results-section font-ui text-on-dark">
      <div className="text-ui-sm" data-mold-report-framing="">{report.framing}</div>
      <p className="mt-0.5 text-ui-sm text-muted-on-dark" data-mold-report-disclaimer="">
        {report.disclaimer}
      </p>
      <dl className="mt-2 flex flex-col gap-2 text-ui-sm">
        <Row label="Part volume" testId="volume" value={volume ? `${volume} cm³` : null} />
        <Row label="Projected area along the pull" testId="area" value={area ? `${area} mm²` : null} />
        <Row
          label="Side actions"
          testId="sides"
          value={Number.isFinite(geometry.sideActionCount) ? String(geometry.sideActionCount) : null}
        />
        {geometry.draft && (
          <Row
            label="Draft"
            testId="draft"
            value={`${geometry.draft.positiveAbove} above · ${geometry.draft.positiveBelow} below ${geometry.draft.minDeg}° · ${geometry.draft.negative} back-draft`}
          />
        )}
      </dl>
      <div className="my-2 border-t border-chrome-border" data-mold-report-break="" />
      <label className="block text-ui-sm text-muted-on-dark">
        Resin
        <select
          data-mold-report-resin=""
          data-ui-action="data-mold-report-resin"
          className="mt-0.5 w-full min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-on-dark"
          value={report.grade || ''}
          onChange={(event) => onGrade?.(event.target.value)}
        >
          {grades.map((grade) => (
            <option key={grade} value={grade}>{grade}</option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Quantity">
        {REPORT_QUANTITIES.map((qty) => {
          const on = report.quantity === qty;
          return (
            <button
              key={qty}
              type="button"
              data-mold-report-quantity={qty}
              data-ui-action="data-mold-report-quantity"
              aria-pressed={on}
              className={`min-h-11 rounded-md px-2 font-ui text-ui-sm tabular-nums ${on ? 'surface-success text-on-dark' : 'border border-chrome-border text-on-dark'}`}
              onClick={() => {
                setCustom('');
                onQuantity?.(qty);
              }}
            >
              {qty}
            </button>
          );
        })}
      </div>
      <label className="mt-2 block text-ui-sm text-muted-on-dark">
        Custom
        <input
          type="text"
          inputMode="numeric"
          data-mold-report-custom=""
          data-ui-action="data-mold-report-custom"
          data-mold-report-custom-state={customInvalid ? 'invalid' : 'ok'}
          aria-invalid={customInvalid || undefined}
          value={preset ? custom : (custom || String(report.quantity))}
          placeholder="Quantity"
          className="mt-0.5 w-full min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-on-dark"
          onChange={(event) => {
            const next = event.target.value;
            setCustom(next);
            if (!/^[0-9]+$/.test(next.trim())) return;
            const n = Number(next.trim());
            if (n >= 1) onQuantity?.(n);
          }}
        />
      </label>
      <dl className="mt-2 flex flex-col gap-2 text-ui-sm">
        <Row label="Part mass" testId="mass" value={mass ? `${mass} kg` : null} note={notes.mass} />
        <Row label="Press size" testId="tonnage" value={tons ? `${tons} t` : null} />
        <Row label="Tooling estimate" testId="tooling" value={tooling} note={notes.tooling} />
        <Row label="Part price" testId="price" value={money(estimates.partUsd)} note={notes.price} />
        <Row label="Total" testId="total" value={money(estimates.totalUsd)} note={notes.price} />
      </dl>
      {quoteState?.status === 'loading' && (
        <p className="mt-2 text-ui-sm text-muted-on-dark" data-mold-report-status="">Updating…</p>
      )}
      <button
        type="button"
        data-mold-report-export=""
        data-ui-action="data-mold-report-export"
        className="mt-2 min-h-11 w-full rounded-md border border-chrome-border bg-transparent px-2 font-ui text-ui-sm text-on-dark"
        onClick={() => onExport?.(report)}
      >
        Export .xlsx
      </button>
      {selected && quoteState?.status === 'ready' && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-ui-sm text-muted-on-dark" data-mold-report-vendor="">
            {selectedName || selected.anonLabel}
          </p>
          {!selectedName && (
            <p className="text-ui-sm text-muted-on-dark" data-mold-quote-paywall="">
              {PAY_FOR_REVIEW_MESSAGE}
            </p>
          )}
          <button
            type="button"
            data-mold-firm-quote=""
            data-ui-action="data-mold-firm-quote"
            disabled={!!quoteState.leadBusy}
            className="min-h-11 rounded-md surface-success px-2 font-ui text-ui-sm text-on-dark disabled:opacity-60"
            onClick={() => onFirmQuote?.()}
          >
            Request firm quote
          </button>
          <button
            type="button"
            data-mold-human-review=""
            data-ui-action="data-mold-human-review"
            disabled={!!quoteState.leadBusy}
            className="min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-ui-sm text-on-dark disabled:opacity-60"
            onClick={() => onHumanReview?.()}
          >
            Human review
          </button>
          {quoteState.leadMessage && quoteState.leadMessage !== PAY_FOR_REVIEW_MESSAGE && (
            <p className="text-ui-sm text-muted-on-dark" data-mold-quote-lead="">{quoteState.leadMessage}</p>
          )}
          {quoteState.leadError && (
            <p className="text-ui-sm text-on-dark" data-mold-quote-lead-error="">{quoteState.leadError}</p>
          )}
          {!selectedName && (quoteState.reviewPayable || quoteState.payForReview) && Number.isFinite(quoteState.reviewFeeUsd) && (
            <button
              type="button"
              data-mold-pay-review=""
              data-ui-action="data-mold-pay-review"
              disabled={!!quoteState.leadBusy}
              className="min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-ui-sm text-on-dark disabled:opacity-60"
              onClick={() => onPayReview?.()}
            >
              {`Pay review fee ($${quoteState.reviewFeeUsd})`}
            </button>
          )}
        </div>
      )}
      <div data-mold-pane-end="" className="h-px" aria-hidden="true" />
    </div>
  );
}
