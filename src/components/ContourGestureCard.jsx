import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import StickyPickApply from './StickyPickApply';
import { useDisplayUnit } from '../hooks/useDisplayUnit';
import { commitDisplayLength, commitDisplayNumber, formatDisplayNumber, lengthToDisplay } from '../utils/displayUnit';
import { contourStatusNote, contourStatusNoteAttrs } from '../utils/contourStatus';
import {
  CONSTRAINT_LABELS,
  DIMENSION_LABELS,
  dimensionShownNumber,
  prefillForKind,
  suggestContourArc,
  suggestContourConstraint,
  suggestContourDimension,
  validateDimensionName,
} from '../utils/contourGesture';

const FIELD = 'w-full rounded border border-cyan-700/70 bg-cyan-950/80 px-2.5 py-1 text-[16px] text-white';

function formatPrefill(kind, mm, unit) {
  const shown = dimensionShownNumber(kind, mm);
  const n = kind === 'angle' ? shown : lengthToDisplay(shown, unit);
  return formatDisplayNumber(n);
}

function seedText(isArc, arc, suggestion, unit) {
  if (isArc) return formatPrefill('length', arc?.radius || 0, unit);
  return suggestion?.kind ? formatPrefill(suggestion.kind, suggestion.value, unit) : '';
}

/**
 * Dimension, Arc, and Constraints cards. All are StickyPickApply.
 * Dimension and Constrain create say Add: it writes, clears the picks,
 * and leaves the card open. X exits and writes nothing. A tag tap reopens
 * that item: Confirm saves and closes, red Delete removes it, no Add.
 * On a phone, Done or Enter in the compact field does that Add or
 * Confirm after the value commits. Blur only commits. Arc does not.
 */
const ContourGestureCard = ({
  gesture = 'dimension',
  model = null,
  picks = [],
  note = '',
  compact = false,
  onRemovePick,
  onApply,
  onCancel,
  onDelete,
  onLive,
  ignoreNameId = null,
  editDimension = null,
  editConstraint = null,
}) => {
  const [unit] = useDisplayUnit();
  const isArc = gesture === 'arc';
  const isConstraint = gesture === 'constraints';
  const suggestion = isArc || isConstraint ? null : suggestContourDimension(model, picks);
  const status = useMemo(() => contourStatusNote(model), [model]);
  const arc = isArc ? suggestContourArc(model, picks) : null;
  const constraint = isConstraint ? suggestContourConstraint(model, picks) : null;
  const pickKey = (picks || []).map((p) => `${p.kind}:${p.id}`).join(',');
  const gestureKey = isConstraint ? 'constraints' : (isArc ? 'arc' : 'dimension');
  const editingDimension = !isArc && !isConstraint && !!editDimension;
  const editingConstraint = isConstraint && !!editConstraint;
  const editing = editingDimension || editingConstraint;
  const sessionKey = `${gestureKey}|${unit}|${pickKey}|${editDimension?.id || ''}|${editConstraint?.id || ''}`;
  const seededKind = editingDimension
    ? editDimension.kind
    : editingConstraint
      ? editConstraint.kind
      : (isConstraint ? (constraint?.kind || '') : (suggestion?.kind || ''));
  const [property, setProperty] = useState(seededKind);
  const [text, setText] = useState(() => (
    editingDimension
      ? formatPrefill(editDimension.kind, editDimension.value, unit)
      : (isConstraint ? '' : seedText(isArc, arc, suggestion, unit))
  ));
  const [name, setName] = useState(() => (editingDimension ? (editDimension.name || '') : ''));
  const [filledKey, setFilledKey] = useState(sessionKey);
  // A new pick or unit refills before paint. Typing keeps the same key.
  if (filledKey !== sessionKey) {
    setFilledKey(sessionKey);
    setProperty(isArc ? '' : seededKind);
    setText(editingDimension
      ? formatPrefill(editDimension.kind, editDimension.value, unit)
      : (isConstraint ? '' : seedText(isArc, arc, suggestion, unit)));
    setName(editingDimension ? (editDimension.name || '') : '');
  }

  const kinds = (isConstraint ? constraint?.kinds : suggestion?.kinds) || [];
  const active = property || (isConstraint ? constraint?.kind : suggestion?.kind);
  const prefill = !isArc && !isConstraint && active ? prefillForKind(model, picks, active) : null;
  const nameCheck = isArc || isConstraint ? { ok: true, name: '' } : validateDimensionName(name, model, ignoreNameId);
  const seedKind = isArc
    ? 'length'
    : (editingDimension ? editDimension.kind : (active || suggestion?.kind));
  const seedRaw = isArc
    ? (arc?.radius || 0)
    : (editingDimension ? editDimension.value : (prefill?.value ?? suggestion?.value));
  const seedMm = dimensionShownNumber(seedKind, seedRaw);
  let valueMm = NaN;
  if (isArc || active !== 'angle') valueMm = commitDisplayLength(text, seedMm, unit);
  else valueMm = commitDisplayNumber(text, seedMm);
  if (valueMm === '' || valueMm === '-' || valueMm === '.') valueMm = NaN;
  const pointDistance = !isArc && !isConstraint && active === 'distance'
    && (picks || []).length === 2
    && (picks || []).every((p) => p.kind === 'point');
  const valueOk = Number.isFinite(valueMm) && (
    (isArc || active === 'length' || active === 'radius' || pointDistance) ? valueMm > 0 : true
  );
  const lengthOk = isArc || active === 'length' || active === 'radius' || pointDistance
    ? valueMm > 0
    : Number.isFinite(valueMm);
  const liveRef = useRef(null);
  liveRef.current = {
    isArc,
    isConstraint,
    active,
    valueMm,
    nameOk: nameCheck.ok,
    nameText: nameCheck.ok ? (nameCheck.name || '') : '',
    side: prefill?.side ?? suggestion?.side ?? 1,
    sense: prefill?.sense ?? suggestion?.sense ?? 1,
    ok: !!(suggestion?.ok && active),
    onLive,
  };
  useEffect(() => {
    const snap = liveRef.current;
    if (!snap || snap.isArc || snap.isConstraint || !snap.onLive) return;
    if (!snap.ok) {
      snap.onLive(null);
      return;
    }
    if (!snap.nameOk) return;
    snap.onLive({
      kind: snap.active,
      valueMm: snap.valueMm,
      name: snap.nameText,
      side: snap.side,
      sense: snap.sense,
    });
  }, [isArc, isConstraint, active, text, name, pickKey, unit]);
  const ready = isArc
    ? !!(arc?.ok && lengthOk)
    : isConstraint
      ? !!(constraint?.ok && active && kinds.includes(active))
      : !!(suggestion?.ok && active && nameCheck.ok && lengthOk && valueOk);

  const apply = () => {
    if (!ready) return;
    if (isArc) onApply?.({ radiusMm: valueMm });
    else if (isConstraint) onApply?.({ kind: active, side: constraint.side });
    else {
      onApply?.({
        kind: active,
        valueMm,
        name: nameCheck.name || '',
        side: prefill?.side ?? suggestion.side,
        sense: prefill?.sense ?? suggestion.sense,
      });
    }
  };

  const pickNote = (!nameCheck.ok ? nameCheck.message : '')
    || (isArc ? arc?.note : isConstraint ? constraint?.note : suggestion?.note)
    || '';
  const parts = [];
  if (status.text) parts.push(status.text);
  if (note && note !== status.text) parts.push(note);
  if (pickNote && pickNote !== status.text && !parts.includes(pickNote)) parts.push(pickNote);
  const shownNote = parts.join(' ');
  const statusAttrs = contourStatusNoteAttrs(status);
  const noteNode = statusAttrs
    ? <span {...statusAttrs}>{shownNote}</span>
    : shownNote;
  const title = isArc ? 'Arc' : isConstraint ? 'Constrain' : 'Dimension';
  const labels = isConstraint ? CONSTRAINT_LABELS : DIMENSION_LABELS;

  return (
    <StickyPickApply
      title={title}
      subtitle={isArc ? 'Round a corner' : isConstraint ? 'Add a constraint' : 'Add a dimension'}
      picks={picks}
      max={isArc ? 3 : 2}
      properties={(kinds || []).map((id) => ({
        id,
        label: labels[id] || id,
        icon: isConstraint ? id : undefined,
      }))}
      property={active || ''}
      onProperty={(id) => {
        setProperty(id);
        if (isConstraint) return;
        const filled = prefillForKind(model, picks, id);
        setText(formatPrefill(id, filled.value, unit));
      }}
      onRemovePick={onRemovePick}
      onApply={apply}
      onKeyboardDone={isArc ? undefined : apply}
      onCancel={onCancel}
      applyLabel={isArc ? 'Round' : (editing ? 'Confirm' : 'Add')}
      applyDisabled={!ready}
      note={editing ? (
        <span className="flex min-w-0 items-center gap-2">
          {noteNode ? <span className="min-w-0">{noteNode}</span> : null}
          <button
            type="button"
            data-ui-action="data-contour-gesture-card"
            data-contour-dimension-delete={editingDimension ? '' : undefined}
            data-contour-constraint-delete={editingConstraint ? '' : undefined}
            onClick={() => onDelete?.()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-700/60 bg-red-950/50 px-2.5 py-1.5 text-[13px] font-medium text-red-200 hover:bg-red-900/70 hover:text-white"
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </span>
      ) : noteNode}
      compact={compact}
      cardAttrs={{
        'data-contour-card': isArc ? 'arc' : isConstraint ? 'constraint' : 'dimension',
        'data-ui-action': 'data-contour-gesture-card',
        ...(isConstraint
          ? { 'data-contour-constraint-mode': editingConstraint ? 'edit' : 'add' }
          : isArc
            ? {}
            : { 'data-contour-dimension-mode': editingDimension ? 'edit' : 'add' }),
      }}
    >
      {!isConstraint && (
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">
          {isArc ? 'Radius' : (DIMENSION_LABELS[active] || 'Value')}
        </span>
        <input
          type="number"
          inputMode="decimal"
          className={FIELD}
          data-field-label={isArc ? 'Radius' : (DIMENSION_LABELS[active] || 'Value')}
          data-unit={(!isArc && active === 'angle') ? '°' : unit}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      )}
      {!isArc && !isConstraint && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Name</span>
          <input
            type="text"
            className={FIELD}
            data-field-label="Name"
            value={name}
            placeholder="optional"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}
    </StickyPickApply>
  );
};

export default ContourGestureCard;
