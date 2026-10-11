import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import FeatureSheet from './FeatureSheet';
import { partLengthMm } from '../utils/sliderRange';
import {
  FEATURE_SLOT_TITLE,
  contoursForSlot,
  featureSlotReady,
} from '../utils/featureSlotCard';

const ACCENT = 'cyan';

function slotLabel(contour) {
  if (!contour?.contourName) return 'No contour';
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
}) {
  const rows = contoursForSlot(contours, role);
  return (
    <div
      className="flex flex-col gap-1 font-sans"
      data-slot-role={role}
      data-slot-index={index}
    >
      <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">{title}</div>
      <div
        className={`truncate rounded px-2.5 py-1 text-[13px] ${
          contour?.contourName
            ? 'bg-amber-500 text-amber-950'
            : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
        }`}
        data-slot-chip={contour?.contourName || ''}
        title={slotLabel(contour)}
      >
        {slotLabel(contour)}
      </div>
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
                className={`truncate rounded px-2.5 py-1 text-left text-[13px] ${
                  on
                    ? 'bg-amber-500 text-amber-950'
                    : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                }`}
              >
                {row.label || row.name}
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

/**
 * Extrude, Revolve, Loft, and Sweep. Slots name saved contours.
 * The contour editor is a separate card, opened by New contour.
 * fullLeft stays off: the helper rail is still in the pane.
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
  onOffset,
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
  const L = partLengthMm(lengthMm);
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
