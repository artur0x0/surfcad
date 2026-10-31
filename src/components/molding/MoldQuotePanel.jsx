/**
 * Budgetary molding quote. Dark glass, text only. It does not paint a skin
 * and it does not take a payment. The label stays "Budgetary, not binding."
 */

import React, { useEffect, useState } from 'react';
import { PART_QUOTE_CONSTANTS } from '../../molding/partQuote.js';
import { TOOLING_CONSTANTS } from '../../molding/toolingEstimate.js';

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
}

function crossoverText(at) {
  if (at == null) return 'Steel stays higher';
  if (at <= 1) return 'Steel is cheaper at this quantity';
  return `Steel cheaper from ${at}`;
}

function Field({ label, value, min, max, onCommit, testId }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <label className="block text-ui-sm text-muted-on-dark">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        value={text}
        data-mold-quote-field={testId}
        className="mt-0.5 w-full min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-on-dark"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next === '' || next === '-') return;
          const n = Number(next);
          if (Number.isInteger(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

export default function MoldQuotePanel({
  state,
  shifted = false,
  onQuantity,
  onCavity,
  onGrade,
  onSelect,
  onFirmQuote,
  onHumanReview,
  onPayReview,
}) {
  if (!state) return null;
  const quote = state.quote;
  const vendors = Array.isArray(quote?.vendors) ? quote.vendors : [];
  const selected = vendors.find((row) => row.anonLabel === state.selected) || vendors[0] || null;
  const grades = Array.isArray(selected?.grades) ? selected.grades : [];
  const disclaimer = quote?.disclaimer || 'Budgetary, not binding.';
  const revealed = state.revealed || {};

  return (
    <div
      data-mold-quote-panel=""
      className={`pointer-events-auto absolute wall-legend-anchor z-30 mold-quote-panel overflow-y-auto rounded-md surface-glass surface-glass-chip px-3 py-2 font-ui text-on-dark${shifted ? ' dfm-report-shifted' : ''}`}
    >
      <div className="text-ui-sm" data-mold-quote-framing="">{quote?.framing || 'Budgetary quote'}</div>
      <p className="mt-0.5 text-ui-sm text-muted-on-dark" data-mold-quote-disclaimer="">
        {disclaimer}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <Field
          label="Quantity"
          value={state.quantity}
          min={1}
          max={PART_QUOTE_CONSTANTS.maxQuantity}
          testId="quantity"
          onCommit={onQuantity}
        />
        <Field
          label="Cavities"
          value={state.cavityCount}
          min={1}
          max={TOOLING_CONSTANTS.maxCavities}
          testId="cavities"
          onCommit={onCavity}
        />
      </div>
      {state.status === 'loading' && (
        <p className="mt-2 text-ui-sm text-muted-on-dark" data-mold-quote-status="">Updating…</p>
      )}
      {state.status === 'error' && (
        <p className="mt-2 text-ui-sm text-on-dark" data-mold-quote-error="">{state.error?.message || 'Quote failed'}</p>
      )}
      {state.status !== 'error' && vendors.length === 0 && state.status !== 'loading' && (
        <p className="mt-2 text-ui-sm text-on-dark" data-mold-quote-empty="">No press fits this part.</p>
      )}
      {vendors.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1" data-mold-quote-vendors="">
          {vendors.map((vendor) => {
            const on = vendor.anonLabel === selected?.anonLabel;
            const name = revealed[vendor.anonLabel];
            return (
              <li key={vendor.anonLabel}>
                <button
                  type="button"
                  data-mold-quote-vendor={vendor.anonLabel}
                  aria-pressed={on}
                  className={`w-full rounded-md px-2 py-1 text-left font-ui text-ui-sm ${on ? 'surface-success text-on-dark' : 'text-on-dark'}`}
                  onClick={() => onSelect?.(vendor.anonLabel)}
                >
                  <div data-mold-quote-name={name || undefined}>{name || vendor.anonLabel}</div>
                  {name && (
                    <div className={on ? 'text-on-dark' : 'text-muted-on-dark'}>{vendor.anonLabel}</div>
                  )}
                  <div className={on ? 'text-on-dark' : 'text-muted-on-dark'}>
                    {`${vendor.region || '—'} · ${vendor.machineCount} machines fit`}
                  </div>
                  <div className="tabular-nums">{`Aluminum ${money(vendor.aluminumUsd)} · Steel ${money(vendor.steelUsd)}`}</div>
                  <div className="tabular-nums">{`Range ${money(vendor.range?.lowUsd)}–${money(vendor.range?.highUsd)}`}</div>
                  <div>{crossoverText(vendor.steelCheaperAt)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && grades.length > 0 && (
        <label className="mt-2 block text-ui-sm text-muted-on-dark">
          Resin
          <select
            data-mold-quote-grade=""
            className="mt-0.5 w-full min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-on-dark"
            value={selected.grade || ''}
            onChange={(event) => onGrade?.(event.target.value)}
          >
            {grades.map((row) => (
              <option key={row.grade} value={row.grade}>
                {`${row.grade} · $${row.usdPerKg}/kg`}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && state.status === 'ready' && (
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            data-mold-firm-quote=""
            data-ui-action="data-mold-firm-quote"
            disabled={!!state.leadBusy}
            className="min-h-11 rounded-md surface-success px-2 font-ui text-ui-sm text-on-dark disabled:opacity-60"
            onClick={() => onFirmQuote?.()}
          >
            Request firm quote
          </button>
          <button
            type="button"
            data-mold-human-review=""
            data-ui-action="data-mold-human-review"
            disabled={!!state.leadBusy}
            className="min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-ui-sm text-on-dark disabled:opacity-60"
            onClick={() => onHumanReview?.()}
          >
            Human review
          </button>
          {state.leadMessage && (
            <p className="text-ui-sm text-muted-on-dark" data-mold-quote-lead="">{state.leadMessage}</p>
          )}
          {state.leadError && (
            <p className="text-ui-sm text-on-dark" data-mold-quote-lead-error="">{state.leadError}</p>
          )}
          {state.reviewPayable && Number.isFinite(state.reviewFeeUsd) && (
            <button
              type="button"
              data-mold-pay-review=""
              data-ui-action="data-mold-pay-review"
              disabled={!!state.leadBusy}
              className="min-h-11 rounded-md border border-chrome-border bg-transparent px-2 font-ui text-ui-sm text-on-dark disabled:opacity-60"
              onClick={() => onPayReview?.()}
            >
              {`Pay review fee ($${state.reviewFeeUsd})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
