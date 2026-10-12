import React from 'react';
import { LengthNumberField, NumberField } from './controls/popupUI';
import FeatureSheet from './FeatureSheet';
import { partLengthMm } from '../utils/sliderRange';
import {
  FEATURE_SLOT_TITLE,
  contoursForSlot,
  featureSlotReady,
} from '../utils/featureSlotCard';

const ACCENT = 'cyan';

function slotLabel(contour) {
  if (!contour?.contourName) return 'Pick a contour';
  return contour.label || contour.contourName;
}

function ContourSlot({
  role,
  index,
  title,
  contour,
  contours,
  onPick,
  onHover,
  onNew,
  onEdit,
}) {
  const rows = contoursForSlot(contours, role);
  const chipClass = `truncate rounded px-2.5 py-1 text-left text-[13px] ${
    contour?.contourName
      ? 'bg-amber-500 text-amber-950'
      : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
  }`;
  return (
    <div
      className="flex flex-col gap-1 font-sans"
      data-slot-role={role}
      data-slot-index={index}
    >
      <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">{title}</div>
      {contour?.contourName ? (
        <button
          type="button"
          className={chipClass}
          data-slot-chip={contour.contourName}
          data-slot-edit=""
          title={slotLabel(contour)}
          aria-label={`Edit ${contour.contourName}`}
          onClick={() => onEdit?.()}
        >
          {slotLabel(contour)}
        </button>
      ) : (
        <div
          className={chipClass}
          data-slot-chip=""
          data-slot-empty=""
          title={slotLabel(contour)}
        >
          {slotLabel(contour)}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-[11px] text-cyan-100/80 leading-tight" role="status">
          {role === 'path' ? 'No saved paths yet.' : 'No saved contours yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto" role="listbox" aria-label={`${title} contours`}>
          {rows.map((row) => {
            const on = contour?.contourId === row.id;
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={on}
                data-slot-pick={row.id}
                title={`Use ${row.label || row.name}`}
                onPointerEnter={() => onHover?.(row.id)}
                onPointerLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(row.id)}
                onBlur={() => onHover?.(null)}
                onClick={() => onPick?.(row)}
                data-contour-unused={row.unused ? '' : undefined}
                className={`relative flex items-center gap-2 rounded px-2.5 py-1 text-left text-[13px] ${
                  on
                    ? 'bg-amber-500 text-amber-950'
                    : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{row.label || row.name}</span>
                {row.unused ? (
                  <span
                    className={`pointer-events-none absolute right-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${on ? 'bg-amber-950/80' : 'bg-amber-200/90'}`}
                    data-contour-unused-dot=""
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        data-new-contour=""
        data-new-contour-role={role}
        data-new-contour-index={index}
        onClick={() => onNew?.()}
        className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-left text-[13px] text-cyan-100"
      >
        New contour
      </button>
    </div>
  );
}

function typedNumber(raw, fallback) {
  if (raw === '' || raw === '-' || raw === '.') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function SenseRow({ value, onChange, attr }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Sense</span>
      <div className="flex rounded border border-cyan-700/70 overflow-hidden">
        {[
          { id: 'positive', label: 'Out' },
          { id: 'negative', label: 'In' },
          { id: 'both', label: 'Both' },
        ].map((opt) => {
          const active = (value || 'positive') === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange?.(opt.id)}
              className={`flex-1 px-2 py-1 text-[13px] ${
                active ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100'
              }`}
              aria-pressed={active}
              {...{ [attr]: opt.id }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Extrude, Revolve, Loft, and Sweep. Slots name saved contours.
 * The contour editor is a separate card, opened by New contour.
 * Distance, angle, axis, segments, sense, reverse, and closed stay here.
 * The helper rail stays in the pane, so this card stays centered between the rails.
 */
const FeatureSlotCard = ({
  card,
  contours = [],
  hoverId = null,
  compact = false,
  lengthMm = 100,
  onPick,
  onHover,
  onNew,
  onEdit,
  onOffset,
  onExtrudeChange,
  onRevolveChange,
  onSweepChange,
  onAddStation,
  onRemoveStation,
  onCombine,
  onMerge,
  onConfirm,
  onCancel,
}) => {
  if (!card) return null;
  const title = FEATURE_SLOT_TITLE[card.kind] || 'Feature';
  const loft = card.kind === 'makeLoft';
  const sweep = card.kind === 'makeSweep';
  const ready = featureSlotReady(card);
  const combineOp = card.combine === 'subtract' ? 'subtract' : 'add';
  const extrude = card.kind === 'makeExtrude';
  const revolve = card.kind === 'makeRevolve';
  const L = partLengthMm(lengthMm);
  const extrudeParams = card.extrude || {};
  const revolveParams = card.revolve || {};
  const sweepParams = card.sweep || {};
  const subtitle = loft
    ? 'Stations name contours'
    : sweep
      ? 'Profile and path'
      : 'Names a saved contour';

  return (
    <FeatureSheet
      title={title}
      subtitle={subtitle}
      compact={compact}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmDisabled={!ready}
      cardAttrs={{
        'data-feature-slot-card': card.kind,
        'data-slot-hover': hoverId || '',
      }}
      note={ready ? 'Confirm writes this feature' : 'Pick a contour for each slot'}
      footer={(
        <>
          <div className="flex gap-1" role="group" aria-label="Add or subtract">
            {[
              { id: 'add', label: 'Add' },
              { id: 'subtract', label: 'Subtract' },
            ].map((opt) => {
              const on = combineOp === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onCombine?.(opt.id)}
                  aria-pressed={on}
                  data-contour-combine={opt.id}
                  className={`flex-1 px-2 py-1 rounded text-[13px] ${
                    on ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {combineOp === 'add' && (
            <label className="mt-1.5 flex items-center gap-2 text-[13px] text-cyan-100">
              <input
                type="checkbox"
                checked={card.merge !== false}
                onChange={(e) => onMerge?.(e.target.checked)}
                data-contour-merge={card.merge !== false ? 'on' : 'off'}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Merge bodies
            </label>
          )}
        </>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-2">
        {loft ? card.stations.map((station, index) => {
          const raw = station.offset;
          const shown = (raw === '' || raw === '-' || raw === '.')
            ? raw
            : (Number.isFinite(Number(raw)) ? Number(raw) : 0);
          return (
            <div key={station.id || index} className="flex flex-col gap-1">
              <ContourSlot
                role="station"
                index={index}
                title={`Station ${index + 1}`}
                contour={station.contourName ? station : null}
                contours={contours}
                onHover={onHover}
                onPick={(row) => onPick?.({ role: 'station', index }, row)}
                onNew={() => onNew?.({ role: 'station', index })}
                onEdit={() => onEdit?.({ role: 'station', index })}
              />
              <LengthNumberField
                id={index === 0 ? 'loft-offset' : `loft-offset-${index}`}
                label="Offset"
                accent={ACCENT}
                valueMm={shown}
                onChangeMm={(v) => {
                  if (v === '' || v === '-' || v === '.') {
                    onOffset?.(index, v);
                    return;
                  }
                  const n = Number(v);
                  onOffset?.(index, Number.isFinite(n) ? n : 0);
                }}
                maxMm={L}
                signed
              />
            </div>
          );
        }) : (
          <ContourSlot
            role="profile"
            index={0}
            title="Profile"
            contour={card.profile}
            contours={contours}
            onHover={onHover}
            onPick={(row) => onPick?.({ role: 'profile', index: 0 }, row)}
            onNew={() => onNew?.({ role: 'profile', index: 0 })}
            onEdit={() => onEdit?.({ role: 'profile', index: 0 })}
          />
        )}
        {sweep && (
          <div data-sweep-path-slot="">
            <ContourSlot
              role="path"
              index={0}
              title="Path"
              contour={card.path}
              contours={contours}
              onHover={onHover}
              onPick={(row) => onPick?.({ role: 'path', index: 0 }, row)}
              onNew={() => onNew?.({ role: 'path', index: 0 })}
              onEdit={() => onEdit?.({ role: 'path', index: 0 })}
            />
            <label className="mt-1 flex items-center gap-2 text-[13px] text-cyan-100">
              <input
                type="checkbox"
                checked={!!sweepParams.reverse}
                onChange={(e) => onSweepChange?.({ ...sweepParams, reverse: e.target.checked })}
                data-sweep-reverse={sweepParams.reverse ? 'on' : 'off'}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Reverse path
            </label>
            <label className="flex items-center gap-2 text-[13px] text-cyan-100">
              <input
                type="checkbox"
                checked={!!sweepParams.closed}
                onChange={(e) => onSweepChange?.({ ...sweepParams, closed: e.target.checked })}
                data-sweep-closed={sweepParams.closed ? 'on' : 'off'}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Closed path
            </label>
          </div>
        )}
        {extrude && (
          <div className="pt-1.5 border-t border-cyan-700/50 flex flex-col gap-1.5 font-sans">
            <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Extrude</div>
            <LengthNumberField
              id="extrude-distance"
              label="Distance"
              accent={ACCENT}
              valueMm={extrudeParams.distance}
              onChangeMm={(v) => onExtrudeChange?.({
                ...extrudeParams,
                distance: typedNumber(v, extrudeParams.distance),
              })}
              minMm={0.1}
              maxMm={L}
            />
            <SenseRow
              attr="data-extrude-sense"
              value={extrudeParams.sense}
              onChange={(sense) => onExtrudeChange?.({ ...extrudeParams, sense })}
            />
          </div>
        )}
        {revolve && (
          <div className="pt-1.5 border-t border-cyan-700/50 flex flex-col gap-1.5 font-sans">
            <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Revolve</div>
            <NumberField
              id="revolve-angle"
              label="Angle"
              accent={ACCENT}
              value={revolveParams.angle}
              onChange={(v) => onRevolveChange?.({
                ...revolveParams,
                angle: typedNumber(v, revolveParams.angle),
              })}
              min={0.1}
              max={360}
              step={1}
            />
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Axis</span>
              <select
                value={revolveParams.axis || 'v'}
                onChange={(e) => onRevolveChange?.({ ...revolveParams, axis: e.target.value })}
                className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
                aria-label="Axis"
                data-revolve-axis=""
              >
                <option value="v">along V</option>
                <option value="u">along U</option>
                <option value="x">+X</option>
                <option value="y">+Y</option>
                <option value="z">+Z</option>
              </select>
            </label>
            <NumberField
              id="revolve-segments"
              label="Segments"
              accent={ACCENT}
              value={revolveParams.segments}
              onChange={(v) => onRevolveChange?.({
                ...revolveParams,
                segments: typedNumber(v, revolveParams.segments),
              })}
              min={3}
              max={256}
              step={1}
            />
            <SenseRow
              attr="data-revolve-sense"
              value={revolveParams.sense}
              onChange={(sense) => onRevolveChange?.({ ...revolveParams, sense })}
            />
          </div>
        )}
        {loft && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAddStation?.()}
              disabled={card.stations.length >= 8}
              className="px-2.5 py-1 rounded text-[13px] bg-cyan-950/80 text-cyan-100 border border-cyan-700/70 disabled:opacity-40"
            >
              Add station
            </button>
            {card.stations.length > 2 && (
              <button
                type="button"
                onClick={() => onRemoveStation?.(card.stations.length - 1)}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </FeatureSheet>
  );
};

export default FeatureSlotCard;
