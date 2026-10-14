import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import FeatureSheet from './FeatureSheet';
import {
  HOLE_END_OPTIONS,
  HOLE_FIT_OPTIONS,
  HOLE_SIZE_OPTIONS,
} from '../utils/holeCard';
import { partLengthMm } from '../utils/sliderRange';

const ACCENT = 'cyan';

const selectClass = 'rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white';

function FieldLabel({ children }) {
  return (
    <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">{children}</span>
  );
}

function SelectField({ id, label, value, options, onChange }) {
  return (
    <label className="flex flex-col gap-0.5" data-hole-field={id}>
      <FieldLabel>{label}</FieldLabel>
      <select
        data-hole-select={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
        aria-label={label}
      >
        {options.map((opt) => {
          const val = typeof opt === 'object' ? opt.value : opt;
          const text = typeof opt === 'object' ? opt.label : opt;
          return <option key={val} value={val}>{text}</option>;
        })}
      </select>
    </label>
  );
}

/**
 * Hole params. Next opens the plane card. X and Esc write nothing.
 * No U/V and no n×m. An explicit diameter wins over size and fit.
 */
const HoleCard = ({
  card,
  onChange,
  onNext,
  onCancel,
  compact = false,
  lengthMm = 100,
}) => {
  const L = partLengthMm(lengthMm);
  const set = (patch) => onChange?.({ ...card, ...patch });
  const clearance = card.type !== 'tapDrill';
  const through = card.through !== false;
  const endFields = (side) => {
    const kind = card[`${side}Kind`] || 'none';
    const title = side === 'near' ? 'Near end' : 'Far end';
    return (
      <div className="mt-1.5 flex flex-col gap-1" data-hole-end={side}>
        <SelectField
          id={`${side}-kind`}
          label={title}
          value={kind}
          options={HOLE_END_OPTIONS}
          onChange={(value) => set({ [`${side}Kind`]: value })}
        />
        {kind !== 'none' && (
          <>
            <LengthNumberField
              id={`hole-${side}-dia`}
              label={`${title} Ø`}
              accent={ACCENT}
              valueMm={card[`${side}Dia`]}
              onChangeMm={(value) => set({ [`${side}Dia`]: value })}
              minMm={0.1}
              maxMm={L}
            />
            <LengthNumberField
              id={`hole-${side}-depth`}
              label={`${title} depth`}
              accent={ACCENT}
              valueMm={card[`${side}Depth`]}
              onChangeMm={(value) => set({ [`${side}Depth`]: value })}
              minMm={0.1}
              maxMm={L}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <FeatureSheet
      title="Hole"
      subtitle="Type, size, ends"
      compact={compact}
      onCancel={onCancel}
      onConfirm={onNext}
      confirmLabel="Next"
      cardAttrs={{ 'data-hole-card': '' }}
      bodyAttrs={{ 'data-hole-card-scroll': '' }}
      note="Next picks the plane. Accept writes one hole at every centre."
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <SelectField
          id="type"
          label="Type"
          value={card.type || 'clearance'}
          options={[
            { value: 'clearance', label: 'clearance' },
            { value: 'tapDrill', label: 'tap drill' },
          ]}
          onChange={(type) => set({ type })}
        />
        <SelectField
          id="size"
          label="Size"
          value={card.size || 'M3'}
          options={HOLE_SIZE_OPTIONS}
          onChange={(size) => set({ size })}
        />
        {clearance && (
          <SelectField
            id="fit"
            label="Fit"
            value={card.fit || 'normal'}
            options={HOLE_FIT_OPTIONS}
            onChange={(fit) => set({ fit })}
          />
        )}
        <label className="flex flex-col gap-0.5" data-hole-field="dia">
          <FieldLabel>Diameter</FieldLabel>
          <input
            data-hole-dia=""
            aria-label="Diameter"
            inputMode="decimal"
            value={card.dia === 0 ? 0 : (card.dia ?? '')}
            placeholder="size"
            onChange={(event) => set({ dia: event.target.value })}
            className={selectClass}
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-cyan-100" data-hole-field="through">
          <input
            type="checkbox"
            data-hole-through=""
            checked={through}
            onChange={(event) => set({ through: event.target.checked })}
            className="h-3.5 w-3.5 accent-cyan-400"
          />
          Through
        </label>
        {!through && (
          <LengthNumberField
            id="hole-depth"
            label="Depth"
            accent={ACCENT}
            valueMm={card.depth}
            onChangeMm={(depth) => set({ depth })}
            minMm={0.1}
            maxMm={L}
          />
        )}
        <div className="flex flex-col gap-0.5" data-hole-field="side">
          <FieldLabel>Side</FieldLabel>
          <div className="flex gap-1" role="group" aria-label="Side">
            {[
              { id: 1, label: '1' },
              { id: -1, label: '−1' },
            ].map((opt) => {
              const on = (Number(card.side) === -1 ? -1 : 1) === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-hole-side={String(opt.id)}
                  aria-pressed={on}
                  onClick={() => set({ side: opt.id })}
                  className={`flex-1 rounded px-2 py-1 text-[13px] ${
                    on ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                  }`}
                  title={opt.id === 1 ? 'Cut toward −normal' : 'Cut the other way'}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        {endFields('near')}
        {through ? endFields('far') : null}
      </div>
    </FeatureSheet>
  );
};

export default HoleCard;
