import React, { useMemo } from 'react';
import { LengthNumberField, NumberField } from './controls/popupUI';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';
import { planeCardCommit } from '../utils/contourMode';
import { contourStatusNote, contourStatusNoteAttrs } from '../utils/contourStatus';
import { partLengthMm } from '../utils/sliderRange';

const ACCENT = 'cyan';

/**
 * Slice 24/25/26/28/30 — contour-mode chip (Edge-pick pattern).
 * Plane + profile params; Extrude / Revolve / Loft / Sweep entries also edit
 * solid params and Confirm commits the solid. Workplane entry is plane-only
 * (Face / construction plane + offset + rotate). Contour and hole plane
 * cards share that Offset field. Mobile-first compact card.
 */
const ContourModeChip = ({
  tool = 'circle',
  entry = 'crossSection',
  params = {},
  extrude = {},
  revolve = {},
  loft = {},
  sweep = {},
  sweepPath = null,
  pickMode = 'face',
  planeLabel = 'default +Z',
  onParamChange,
  onExtrudeChange,
  onRevolveChange,
  onSweepChange,
  onPickPath,
  onPickPlane,
  onSelectLoftProfile,
  onAddLoftProfile,
  onRemoveLoftProfile,
  onLoftOffsetChange,
  onLoftUseOffset,
  onLoftPickFace,
  onLoftPickWorkplane,
  onLoftPickSketch,
  onConfirm,
  onUndoPoint,
  onClearPoints,
  savedContours = [],
  pickedContourId = null,
  onPickSaved,
  planePreset = 'z',
  planeAngles = {},
  constructionPlanes = [],
  pickedPlaneId = '',
  onPlanePreset,
  onPlaneAngles,
  onPickWorkplane,
  onPickFace,
  planeOffset = 0,
  onPlaneOffset,
  tangentOn = false,
  edgeCount = 0,
  onToggleTangent,
  onClearEdges,
  onPopEdge,
  combine = 'add',
  onCombineChange,
  /** Merge bodies (Add only): false keeps the solid as a separate body. */
  merge = true,
  onMergeChange,
  compact = false,
  onDelete = null,
  onCancel = null,
  lengthMm = 100,
}) => {
  const isExtrude = entry === 'makeExtrude';
  const isRevolve = entry === 'makeRevolve';
  const isLoft = entry === 'makeLoft';
  const isSweep = entry === 'makeSweep';
  const isWorkplane = entry === 'workplane';
  const commitName = isWorkplane
    ? 'Workplane'
    : isSweep ? 'Sweep' : isLoft ? 'Loft' : isRevolve ? 'Revolve' : isExtrude ? 'Extrude' : null;
  const solidEntry = !!(commitName && !isWorkplane);
  const combineOp = combine === 'subtract' ? 'subtract' : 'add';
  const L = partLengthMm(lengthMm);
  const statusNote = useMemo(
    () => (params?.contour ? contourStatusNote(params.contour) : null),
    [params],
  );
  const loftProfiles = Array.isArray(loft.profiles) ? loft.profiles : [];
  const loftSelected = Number.isInteger(loft.selected) ? loft.selected : 0;
  const loftStation = loftProfiles[loftSelected] || null;
  const loftOwnsPlane = !!(
    loftStation
    && loftStation.plane
    && (loftStation.planeKind === 'face' || loftStation.planeKind === 'workplane' || loftStation.planeKind === 'contour')
  );
  const rawLoftOffset = loftStation?.offset;
  const loftOffsetVal = (rawLoftOffset === '' || rawLoftOffset === '-' || rawLoftOffset === '.')
    ? rawLoftOffset
    : (Number.isFinite(Number(rawLoftOffset)) ? Number(rawLoftOffset) : 0);
  const sketchPlanes = (savedContours || []).filter((c) => c?.plane?.center);
  const set = (name, raw, type) => {
    let v = raw;
    if (type === 'number') {
      if (raw === '' || raw === '-' || raw === '.') v = raw;
      else {
        const n = Number(raw);
        v = Number.isFinite(n) ? n : params[name];
      }
    } else if (type === 'bool') {
      v = !!raw;
    }
    onParamChange?.({ ...params, [name]: v });
  };

  // Counts stay linear. Lengths use the curve and the part length.
  const numField = (name, label, { min, step, max } = {}) => (
    <NumberField
      key={name}
      id={name}
      label={label}
      accent={ACCENT}
      value={params[name]}
      onChange={(v) => set(name, v, 'number')}
      min={min ?? 0.1}
      max={max ?? 80}
      step={step ?? 0.5}
    />
  );
  const lenField = (name, label, { min = 0.1, max = L } = {}) => (
    <LengthNumberField
      key={name}
      id={name}
      label={label}
      accent={ACCENT}
      valueMm={params[name]}
      onChangeMm={(v) => set(name, v, 'number')}
      minMm={min}
      maxMm={max}
    />
  );

  let fields = null;
  if (params.contour) {
    const n = params.contour.dimensions?.length || 0;
    const lines = params.contour.lines?.length || 0;
    const constraints = params.contour.constraints?.length || 0;
    fields = (
      <span className="text-[13px] text-cyan-100">
        Contour · {lines} line{lines === 1 ? '' : 's'} · {n} dimension{n === 1 ? '' : 's'} · {constraints} constraint{constraints === 1 ? '' : 's'}
      </span>
    );
  } else if (tool === 'circle') {
    fields = (
      <>
        {lenField('radius', 'Radius', { min: 0.1, max: 0.8 * L })}
        {numField('segments', 'Segments', { min: 3, step: 1, max: 128 })}
      </>
    );
  } else if (tool === 'rectangle') {
    fields = (
      <>
        {lenField('width', 'Width', { min: 0.1, max: 1.2 * L })}
        {lenField('height', 'Height', { min: 0.1, max: 1.2 * L })}
        <label className="flex items-center gap-2 text-[13px] text-cyan-100">
          <input
            type="checkbox"
            checked={params.centered !== false}
            onChange={(e) => set('centered', e.target.checked, 'bool')}
            className="h-3.5 w-3.5 accent-cyan-400"
          />
          Centered
        </label>
      </>
    );
  } else if (tool === 'polygon') {
    fields = (
      <>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Polygon</span>
          <select
            value={params.polygonPreset || 'hexagon'}
            onChange={(e) => set('polygonPreset', e.target.value, 'select')}
            className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
          >
            <option value="triangle">triangle</option>
            <option value="square">square</option>
            <option value="pentagon">pentagon</option>
            <option value="hexagon">hexagon</option>
          </select>
        </label>
        {lenField('radius', 'Radius', { min: 0.1, max: 0.8 * L })}
      </>
    );
  } else if (tool === 'polyline') {
    const n = Array.isArray(params.points) ? params.points.length : 0;
    fields = (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-cyan-100">
          {n} pt{n === 1 ? '' : 's'} · tap plane{n > 0 ? ' · right-drag or one-finger drag to move' : ''}
        </span>
        {n > 0 && (
          <>
            <button
              type="button"
              className="text-[11px] text-cyan-200 underline"
              onClick={() => onUndoPoint?.()}
            >
              Undo
            </button>
            <button
              type="button"
              className="text-[11px] text-cyan-200 underline"
              onClick={() => onClearPoints?.()}
            >
              Clear
            </button>
          </>
        )}
      </div>
    );
  }

  const shapeLabel = ({
    circle: 'Circle',
    rectangle: 'Rectangle',
    polygon: 'Polygon',
    polyline: 'Polyline',
  })[tool] || tool;
  // Feature entries title the card with the thing the rail Confirm writes.
  // The plane card for a profile is just Contour. Select plane accepts the plane.
  // Workplane writes from this card: Add plane, no helper line.
  const cardCommit = planeCardCommit(entry);
  const title = commitName || 'Contour';
  const subtitle = solidEntry && shapeLabel
    ? `${shapeLabel} · Plane · ${planeLabel}`
    : `Plane · ${planeLabel}`;
  const confirmNote = cardCommit.writes
    ? ''
    : commitName
      ? `Select plane accepts the plane. Confirm on the rail writes ${commitName}`
      : 'Select plane accepts the plane';
  const statusAttrs = contourStatusNoteAttrs(statusNote);
  const note = statusNote?.text
    ? (statusAttrs
      ? <span {...statusAttrs}>{statusNote.text}</span>
      : statusNote.text)
    : confirmNote;

  return (
    <FeatureSheet
      title={title}
      subtitle={subtitle}
      compact={compact}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmLabel={cardCommit.label}
      cardAttrs={{ 'data-contour-chip': '' }}
      bodyAttrs={{ 'data-contour-chip-scroll': '' }}
      note={note}
      footer={(
        <>
          {solidEntry && (
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
                    onClick={() => onCombineChange?.(opt.id)}
                    aria-pressed={on}
                    data-contour-combine={opt.id}
                    className={`flex-1 px-2 py-1 rounded text-[13px] ${
                      on ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                    }`}
                    title={opt.id === 'subtract'
                      ? 'Cut this solid out of the part'
                      : 'Union this solid onto the part'}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
          {solidEntry && combineOp === 'add' && (
            <label
              className="mt-1.5 flex items-center gap-2 text-[13px] text-cyan-100"
              title="On: union into the part. Off: keep this solid as a separate body in the same part."
            >
              <input
                type="checkbox"
                checked={merge !== false}
                onChange={(e) => onMergeChange?.(e.target.checked)}
                data-contour-merge={merge !== false ? 'on' : 'off'}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Merge bodies
            </label>
          )}
          {onDelete ? (
            <div className="mt-1.5">
              <FeatureDeleteButton onClick={onDelete} />
            </div>
          ) : null}
        </>
      )}
    >
      <div className="mt-1.5 font-sans" data-plane-editor="1" role="group" aria-label="Contour plane">
        <div className="flex gap-1 flex-wrap">
          {['x', 'y', 'z'].map((axis) => {
            const active = planePreset === axis;
            return (
              <button
                key={axis}
                type="button"
                onClick={() => onPlanePreset?.(axis)}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded text-[13px] uppercase ${
                  active ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                }`}
                title={`World ${axis.toUpperCase()} plane`}
              >
                {axis}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onPickFace?.()}
            aria-pressed={planePreset === 'face'}
            className={`px-2.5 py-1 rounded text-[13px] ${
              planePreset === 'face' ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
            }`}
            title="Tap a planar face to set the plane"
          >
            Face
          </button>
        </div>
        {constructionPlanes.length > 0 && (
          <label className="mt-1 flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Workplane</span>
            <select
              value={pickedPlaneId || ''}
              onChange={(e) => {
                const id = e.target.value;
                const hit = constructionPlanes.find((p) => p.id === id);
                if (hit) onPickWorkplane?.(hit.plane, hit.id);
              }}
              className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
              aria-label="Pick a saved workplane"
            >
              <option value="">Pick workplane…</option>
              {constructionPlanes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        {['x', 'y', 'z'].map((axis) => {
          const val = Number(planeAngles?.[axis]);
          const shown = Number.isFinite(val) ? val : 0;
          return (
            <NumberField
              key={`ang-${axis}`}
              id={`plane-angle-${axis}`}
              label={`Plane angle ∠${axis.toUpperCase()}`}
              accent={ACCENT}
              value={shown}
              onChange={(v) => {
                const n = Number(v);
                onPlaneAngles?.({ ...planeAngles, [axis]: Number.isFinite(n) ? n : 0 });
              }}
              min={-180}
              max={180}
              step={1}
              className="mt-1"
            />
          );
        })}
        <LengthNumberField
          id="workplane-offset"
          label="Offset"
          accent={ACCENT}
          valueMm={(planeOffset === '' || planeOffset === '-' || planeOffset === '.')
            ? planeOffset
            : (Number.isFinite(Number(planeOffset)) ? Number(planeOffset) : 0)}
          onChangeMm={(v) => {
            if (v === '' || v === '-' || v === '.') {
              onPlaneOffset?.(v);
              return;
            }
            const n = Number(v);
            onPlaneOffset?.(Number.isFinite(n) ? n : 0);
          }}
          maxMm={L}
          signed
          className="mt-1"
        />
      </div>
      {!isWorkplane && (
      <>
      <div className="mt-1.5 font-sans" role="group" aria-label="Saved contours">
        <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">
          Saved · {savedContours.length}
        </div>
        {savedContours.length === 0 ? (
          <p className="mt-0.5 text-[11px] text-cyan-100/80 leading-tight" role="status">
            No saved contours yet. Confirm Create contour, or draw one here.
          </p>
        ) : (
          <div className="mt-0.5 flex flex-col gap-0.5 max-h-16 overflow-y-auto">
            {savedContours.map((c) => {
              const active = c.id === pickedContourId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPickSaved?.(c.id)}
                  aria-pressed={active}
                  title={`Use ${c.label}`}
                  className={`truncate rounded px-2.5 py-1 text-left text-[13px] ${
                    active
                      ? 'bg-amber-500 text-amber-950'
                      : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        {fields}
      </div>
      {isRevolve && (
        <div className="mt-2 pt-1.5 border-t border-cyan-700/50 flex flex-col gap-1.5 font-sans">
          <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Revolve</div>
          <NumberField
            id="revolve-angle"
            label="Angle"
            accent={ACCENT}
            value={revolve.angle}
            onChange={(v) => {
              let next = v;
              if (v === '' || v === '-' || v === '.') next = v;
              else {
                const n = Number(v);
                next = Number.isFinite(n) ? n : revolve.angle;
              }
              onRevolveChange?.({ ...revolve, angle: next });
            }}
            min={0.1}
            max={360}
            step={1}
          />
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Axis</span>
            <select
              value={revolve.axis || 'v'}
              onChange={(e) => onRevolveChange?.({ ...revolve, axis: e.target.value })}
              className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
              aria-label="Axis"
            >
              <option value="v">along V</option>
              <option value="u">along U</option>
              <option value="x">+X</option>
              <option value="y">+Y</option>
              <option value="z">+Z</option>
            </select>
          </label>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Sense</span>
            <div className="flex rounded border border-cyan-700/70 overflow-hidden">
              {[
                { id: 'positive', label: 'Out' },
                { id: 'negative', label: 'In' },
                { id: 'both', label: 'Both' },
              ].map((opt) => {
                const active = (revolve.sense || 'positive') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onRevolveChange?.({ ...revolve, sense: opt.id })}
                    className={`flex-1 px-2 py-1 text-[13px] ${
                      active ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100'
                    }`}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {isLoft && (
        <div className="mt-2 pt-1.5 border-t border-cyan-700/50 flex flex-col gap-1.5 font-sans">
          <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Loft profiles</div>
          <div className="flex items-center gap-1 flex-wrap">
            {loftProfiles.map((p, i) => {
              const active = i === loftSelected;
              return (
                <button
                  key={p.id || i}
                  type="button"
                  onClick={() => onSelectLoftProfile?.(i)}
                  className={`px-2.5 py-1 rounded text-[13px] ${
                    active ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
                  }`}
                  aria-pressed={active}
                  title={`Select profile ${i + 1}`}
                >
                  P{i + 1}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onAddLoftProfile?.()}
              className="px-2.5 py-1 rounded text-[13px] bg-cyan-950/80 text-cyan-100 border border-cyan-700/70"
              title="Add a profile on the shared plane, at the next offset"
              disabled={loftProfiles.length >= 8}
            >
              +
            </button>
            {loftProfiles.length > 2 && (
              <button
                type="button"
                onClick={() => onRemoveLoftProfile?.(loftSelected)}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                title="Remove selected profile"
              >
                Remove
              </button>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Station plane</div>
          <div className="flex items-center gap-1 flex-wrap" data-loft-station-plane={loftOwnsPlane ? (loftStation.planeKind || 'face') : 'offset'}>
            <button
              type="button"
              onClick={() => onLoftUseOffset?.()}
              aria-pressed={!loftOwnsPlane && loft.picking !== 'face'}
              data-loft-plane="offset"
              className={`px-2.5 py-1 rounded text-[13px] ${
                !loftOwnsPlane && loft.picking !== 'face'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
              }`}
              title="This station follows the card plane, offset along its normal"
            >
              Offset
            </button>
            <button
              type="button"
              onClick={() => onLoftPickFace?.()}
              aria-pressed={loft.picking === 'face' || loftStation?.planeKind === 'face'}
              data-loft-plane="face"
              className={`px-2.5 py-1 rounded text-[13px] ${
                loft.picking === 'face' || loftStation?.planeKind === 'face'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
              }`}
              title="Tap a face, a construction plane, or a sketch for this station"
            >
              Face
            </button>
          </div>
          {constructionPlanes.length > 0 && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Station workplane</span>
              <select
                value={loftStation?.planeKind === 'workplane' ? (loftStation.planeRef || '') : ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const hit = constructionPlanes.find((p) => p.id === id);
                  if (hit) onLoftPickWorkplane?.(hit.plane, hit.id, hit.name);
                }}
                className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
                aria-label="Station workplane"
                data-loft-workplane=""
              >
                <option value="">Pick workplane…</option>
                {constructionPlanes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          {sketchPlanes.length > 0 && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Station sketch</span>
              <select
                value={loftStation?.planeKind === 'contour' ? (loftStation.planeRef || '') : ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const hit = sketchPlanes.find((c) => c.id === id);
                  if (hit) onLoftPickSketch?.(hit);
                }}
                className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
                aria-label="Station sketch plane"
                data-loft-sketch=""
              >
                <option value="">Pick sketch plane…</option>
                {sketchPlanes.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          )}
          {!loftOwnsPlane && (
            <LengthNumberField
              id="loft-offset"
              label="Offset"
              accent={ACCENT}
              valueMm={loftOffsetVal}
              onChangeMm={(v) => {
                if (v === '' || v === '-' || v === '.') {
                  onLoftOffsetChange?.(v);
                  return;
                }
                const n = Number(v);
                onLoftOffsetChange?.(Number.isFinite(n) ? n : 0);
              }}
              maxMm={L}
              signed
            />
          )}
          <div className="text-[11px] text-cyan-200/70 leading-tight">
            {loftOwnsPlane
              ? `${loftStation.planeLabel || loftStation.planeKind} · min 2`
              : loft.picking === 'face'
                ? 'Tap a face, plane, or sketch · min 2'
                : 'Same plane · offset along normal · min 2'}
          </div>
        </div>
      )}
      {isSweep && (
        <div
          className="mt-2 pt-1.5 border-t border-cyan-700/50 flex flex-col gap-1.5 font-sans"
          data-sweep-path-selector="embedded"
        >
          <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Path</div>
          <div className="text-[13px] text-cyan-100 leading-tight">
            {sweepPath?.ok
              ? `${sweepPath.path.edgeCount} edge${sweepPath.path.edgeCount === 1 ? '' : 's'} · ${sweepPath.path.closed ? 'loop' : 'chain'} · ${Number(sweepPath.path.length).toFixed(1)} mm`
              : (sweepPath?.message || 'Pick a contiguous edge chain')}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-cyan-100">{edgeCount} edge{edgeCount === 1 ? '' : 's'}</span>
            <button
              type="button"
              className={`underline ${tangentOn ? 'text-cyan-300' : 'text-cyan-200/70'}`}
              onClick={() => onToggleTangent?.()}
              aria-pressed={tangentOn}
              title="When on, picking one edge adds tangent-connected edges"
            >
              Tangent {tangentOn ? 'on' : 'off'}
            </button>
            {edgeCount > 0 && (
              <>
                <button
                  type="button"
                  className="text-cyan-200 underline"
                  onClick={() => onPopEdge?.()}
                  title="Remove the last path edge"
                >
                  Undo edge
                </button>
                <button
                  type="button"
                  className="text-cyan-200 underline"
                  onClick={() => onClearEdges?.()}
                  title="Clear the path"
                >
                  Clear
                </button>
              </>
            )}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onPickPath?.()}
              aria-pressed={pickMode === 'edge'}
              className={`flex-1 px-2 py-1 rounded text-[13px] ${
                pickMode === 'edge' ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
              }`}
              title="Pick the sweep path from edges"
            >
              Path
            </button>
            <button
              type="button"
              onClick={() => onPickPlane?.()}
              aria-pressed={pickMode !== 'edge'}
              className={`flex-1 px-2 py-1 rounded text-[13px] ${
                pickMode !== 'edge' ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
              }`}
              title="Pick the profile workplane"
            >
              Plane
            </button>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-cyan-100">
            <input
              type="checkbox"
              checked={!!sweep.reverse}
              onChange={(e) => onSweepChange?.({ ...sweep, reverse: e.target.checked })}
              className="h-3.5 w-3.5 accent-cyan-400"
            />
            Reverse path
          </label>
        </div>
      )}
      {isExtrude && (
        <div className="mt-2 pt-1.5 border-t border-cyan-700/50 flex flex-col gap-1.5 font-sans">
          <div className="text-[11px] uppercase tracking-wide text-cyan-200/80">Extrude</div>
          <LengthNumberField
            id="extrude-distance"
            label="Distance"
            accent={ACCENT}
            valueMm={extrude.distance}
            onChangeMm={(v) => {
              let next = v;
              if (v === '' || v === '-' || v === '.') next = v;
              else {
                const n = Number(v);
                next = Number.isFinite(n) ? n : extrude.distance;
              }
              onExtrudeChange?.({ ...extrude, distance: next });
            }}
            minMm={0.1}
            maxMm={L}
          />
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Direction</span>
            <select
              value={extrude.direction || 'normal'}
              onChange={(e) => onExtrudeChange?.({ ...extrude, direction: e.target.value })}
              className="rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[13px] text-white"
              aria-label="Direction"
            >
              <option value="normal">along plane</option>
              <option value="x">+X</option>
              <option value="y">+Y</option>
              <option value="z">+Z</option>
            </select>
          </label>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Sense</span>
            <div className="flex rounded border border-cyan-700/70 overflow-hidden">
              {[
                { id: 'positive', label: 'Out' },
                { id: 'negative', label: 'In' },
                { id: 'both', label: 'Both' },
              ].map((opt) => {
                const active = (extrude.sense || 'positive') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onExtrudeChange?.({ ...extrude, sense: opt.id })}
                    className={`flex-1 px-2 py-1 text-[13px] ${
                      active ? 'bg-cyan-600 text-white' : 'bg-cyan-950/80 text-cyan-100'
                    }`}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </FeatureSheet>
  );
};

export default ContourModeChip;
