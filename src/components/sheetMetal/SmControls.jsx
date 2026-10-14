import React from 'react';
import FeatureSheet from '../FeatureSheet';
import { useDisplayNumber } from '../../hooks/useDisplayNumber';
import { PARTS_TEXT_INPUT_CLASS, PARTS_TEXT_INPUT_STYLE } from '../../utils/partsChrome';
import { commitDisplayLength, lengthToDisplay } from '../../utils/displayUnit';
import { lengthFromThumb, lengthSnap, thumbFromLength, THUMB_COUNT } from '../../utils/sliderMap';

/**
 * Sheet-metal popup controls. Mobile-first: ≥44px tap targets and the shared
 * ≥16px input token (PARTS_TEXT_INPUT_*) so iOS never zooms on focus.
 */

export const SM_TAP = 'min-h-[44px]';

export const SmLabel = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} className="block text-[11px] font-semibold uppercase tracking-wide text-orange-200/90 mb-1">
    {children}
  </label>
);

export const SmSelect = ({ id, label, value, onChange, options = [], placeholder, disabled = false }) => (
  <div>
    <SmLabel htmlFor={id}>{label}</SmLabel>
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      className={`${PARTS_TEXT_INPUT_CLASS} ${SM_TAP} disabled:opacity-50`}
      style={PARTS_TEXT_INPUT_STYLE}
      data-sm-select={id}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
      ))}
    </select>
  </div>
);

/** Range + number pair; the number box is the ≥16px token. A shaped thumb snaps; the box does not. */
export const SmSlider = ({
  id, label, value, onChange, min, max, step = 0.5, unit = 'mm', disabled = false,
  shaped = false, signed = false,
}) => {
  const lo = Number.isFinite(Number(min)) ? Number(min) : 0;
  const hi = Number.isFinite(Number(max)) ? Number(max) : lo;
  const box = useDisplayNumber(value, (raw) => {
    if (shaped || raw === '' || raw === '-' || raw === '.') {
      onChange?.(raw);
      return;
    }
    const n = Number(raw);
    onChange?.(Number.isFinite(n) ? n : raw);
  });
  let rangeValue;
  let rangeMin;
  let rangeMax;
  let rangeStep;
  let onRange;
  if (shaped) {
    const snap = Number(step) > 0 ? Number(step) : 0;
    const thumb = thumbFromLength(value, { min: lo, max: hi, signed });
    rangeValue = Math.round(Number.isFinite(thumb) ? thumb : 0);
    rangeMin = 0;
    rangeMax = THUMB_COUNT;
    rangeStep = 1;
    onRange = (e) => {
      box.endDraft();
      onChange?.(lengthFromThumb(e.target.value, { min: lo, max: hi, signed, snap }));
    };
  } else {
    rangeValue = Number.isFinite(Number(value)) ? Number(value) : (Number(min) || 0);
    rangeMin = min;
    rangeMax = max;
    rangeStep = step;
    onRange = (e) => {
      box.endDraft();
      onChange?.(Number(e.target.value));
    };
  }
  return (
    <div>
      <SmLabel htmlFor={`${id}-n`}>{label}</SmLabel>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={rangeMin}
          max={rangeMax}
          step={rangeStep}
          value={rangeValue}
          disabled={disabled}
          onChange={onRange}
          className={`flex-1 min-w-0 accent-orange-400 h-8 ${disabled ? 'opacity-40' : ''}`}
          aria-label={label}
          data-sm-slider={id}
          {...(shaped ? { 'data-slider-curve': 'shaped' } : null)}
        />
        <input
          id={`${id}-n`}
          type="number"
          inputMode="decimal"
          min={shaped ? undefined : min}
          max={shaped ? undefined : max}
          step={shaped ? 'any' : step}
          value={box.value}
          disabled={disabled}
          onFocus={box.onFocus}
          onBlur={box.onBlur}
          onChange={box.onChange}
          className={`${PARTS_TEXT_INPUT_CLASS} !w-24 shrink-0 tabular-nums ${SM_TAP}`}
          style={PARTS_TEXT_INPUT_STYLE}
          aria-label={`${label} value`}
          data-sm-number={id}
          data-field-label={label}
          {...(unit ? { 'data-unit': unit } : null)}
        />
        {unit && <span className="text-xs text-gray-300 w-7 shrink-0">{unit}</span>}
      </div>
    </div>
  );
};

export const SmButton = ({ variant = 'ghost', className = '', children, ...rest }) => {
  const look = variant === 'primary'
    ? 'bg-cyan-600 text-white hover:bg-cyan-500 active:bg-cyan-400'
    : variant === 'danger'
      ? 'bg-red-900/60 text-red-100 hover:bg-red-800/70'
      : 'bg-white/10 text-gray-100 hover:bg-white/20 active:bg-white/25';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 ${SM_TAP} text-base font-medium
        ${look} disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

/**
 * A length slider stored in millimetres, shown in `unit` ('mm' | 'in').
 * The thumb is the shared length curve and snaps in that unit. The typed
 * box does not snap. `onMm` receives millimetres, or '' while the box is cleared.
 */
export const SmMmSlider = ({
  id, label, mm, onMm, minMm, maxMm, unit = 'mm', signed = false,
}) => {
  const end = signed
    ? Math.max(Math.abs(Number(minMm) || 0), Math.abs(Number(maxMm) || 0))
    : Number(maxMm);
  const lo = signed ? -end : (Number.isFinite(Number(minMm)) ? Number(minMm) : 0);
  const hi = signed ? end : (Number.isFinite(end) ? end : lo);
  const span = Math.abs(hi - lo);
  const snap = lengthToDisplay(lengthSnap(unit, span), unit);
  const partial = mm === '' || mm === '-' || mm === '.';
  const shown = partial
    ? mm
    : (Number.isFinite(Number(mm)) ? lengthToDisplay(Number(mm), unit) : '');
  return (
    <SmSlider
      shaped
      signed={signed}
      id={id}
      label={label}
      value={shown}
      min={lengthToDisplay(lo, unit)}
      max={lengthToDisplay(hi, unit)}
      step={Number.isFinite(snap) && snap > 0 ? snap : undefined}
      unit={unit}
      onChange={(v) => {
        const next = commitDisplayLength(v, mm, unit);
        if (v !== '' && v !== '-' && v !== '.' && next === mm) return;
        onMm?.(next);
      }}
    />
  );
};

/** mm | in. Display only — the model stays millimetres. */
export const SmUnitToggle = ({ unit = 'mm', onChange }) => (
  <div
    role="group"
    aria-label="Display units"
    data-sm-unit-toggle=""
    className="inline-flex shrink-0 rounded-md bg-black/30 p-0.5"
  >
    {['mm', 'in'].map((u) => (
      <button
        key={u}
        type="button"
        data-sm-unit={u}
        aria-pressed={unit === u}
        onClick={() => onChange?.(u)}
        className={`min-h-[44px] min-w-[44px] rounded px-2 text-base font-medium ${
          unit === u ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:text-white'
        }`}
      >
        {u}
      </button>
    ))}
  </div>
);

/** On/off pill (e.g. Tab "Centered"). */
export const SmToggle = ({ id, label, checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={!!checked}
    onClick={() => onChange?.(!checked)}
    className={`flex w-full items-center justify-between rounded-md px-3 ${SM_TAP} text-base
      ${checked ? 'bg-cyan-600/30 text-cyan-100' : 'bg-white/10 text-gray-200'}`}
    data-sm-toggle={id}
  >
    <span>{label}</span>
    <span className={`h-6 w-11 rounded-full p-0.5 transition-colors ${checked ? 'bg-cyan-600' : 'bg-gray-600'}`}>
      <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </span>
  </button>
);

/**
 * The one sheet-metal shell: the shared feature card.
 * X and Esc call `onClose` and write nothing. There is no swipe.
 * The mm|in toggle sits in the header (the subtitle row), because the
 * shell has no header slot and its title has to stay the dialog name.
 * Confirm stays a 44px button in `footer` — the shell's own confirm is
 * shorter than that target, and this file does not restyle the shell.
 */
export const SmPopup = ({
  title,
  subtitle,
  onClose,
  closeLabel = 'Close',
  children,
  footer = null,
  dataAttr,
  unit = null,
  onUnit = null,
  compact = false,
  cardAttrs = null,
  note = null,
}) => {
  const headerSubtitle = onUnit ? (
    <span className="flex items-center justify-between gap-2">
      <span className="min-w-0 flex-1 truncate">{subtitle}</span>
      <SmUnitToggle unit={unit === 'in' ? 'in' : 'mm'} onChange={onUnit} />
    </span>
  ) : subtitle;
  return (
    <FeatureSheet
      title={title}
      subtitle={headerSubtitle}
      onCancel={onClose}
      compact={compact}
      footer={footer}
      note={note}
      cardAttrs={{
        ...(dataAttr ? { [dataAttr]: '1' } : {}),
        title: closeLabel,
        ...(cardAttrs || {}),
      }}
    >
      <div className="flex flex-col gap-3 py-1">
        {children}
      </div>
    </FeatureSheet>
  );
};
