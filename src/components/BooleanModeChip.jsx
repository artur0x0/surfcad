import React from 'react';
import {
  booleanOp,
  booleanSlot,
  booleanPicksInOrder,
  booleanTargetPartId,
  booleanCrossPart,
} from '../utils/booleanMode';
import { FeatureDeleteButton } from './FeatureEditDelete';
import FeatureSheet from './FeatureSheet';

const UI_ACTION = 'data-boolean-mode-chip';

/**
 * Boolean on the shared feature card.
 * Union / Difference / Intersect. Bodies use the Shell sticky picker.
 * Intersect opens Pieces: tap hides a leftover, tap again brings it back.
 * The card is not a modal. The cross-section rail (z-40) stays above this
 * card (FeatureSheet is z-20), and hiding a part does not clear its picks.
 * Confirm writes one booleanBodies(); X exits with no write.
 *
 * Picks span parts. The first tap is the target and its part is written.
 * A tool body on another part is copied into the target at Confirm (frozen,
 * not linked).
 */
const BooleanModeChip = ({
  state = null,
  partId = null,
  compact = false,
  pieceCount = 0,
  /** part id → display name, for the cross-part line. */
  partNames = null,
  onOp,
  onPickTarget,
  onUndo,
  onClear,
  onConfirm,
  onDismiss,
  onDelete = null,
}) => {
  const op = booleanOp(state?.op);
  const pick = state?.pick === 'pieces' && op === 'intersect' ? 'pieces' : 'bodies';
  const picks = booleanPicksInOrder(state);
  const targetId = booleanTargetPartId(state) ?? partId;
  const crossPart = booleanCrossPart(state);
  const slot = booleanSlot(state, targetId);
  const bodyCount = picks.length;
  const dropCount = slot.drop.length;
  const nameOf = (id) => (partNames && partNames[id]) || id;
  const canConfirm = bodyCount >= 2 && !(op === 'intersect' && pieceCount > 0 && dropCount >= pieceCount);
  const opLabel = op === 'difference' ? 'Difference' : op === 'intersect' ? 'Intersect' : 'Union';

  let status;
  if (pick === 'pieces') {
    status = dropCount
      ? `${dropCount} hidden · tap that piece again to bring it back`
      : 'Each leftover has its own color · tap a piece to hide it';
  } else if (bodyCount > 1) {
    status = `${bodyCount} bodies · first is the target · tap again to remove`;
  } else if (bodyCount === 1) {
    status = '1 body, the target · tap a tool body to add it';
  } else {
    status = 'Tap bodies. The first tap is the target.';
  }

  const opBtn = (id, label, title) => {
    const on = op === id;
    return (
      <button
        type="button"
        data-ui-action={UI_ACTION}
        onClick={() => onOp?.(id)}
        aria-pressed={on}
        className={`px-2.5 py-1 rounded text-[13px] ${
          on
            ? 'bg-cyan-600 text-white'
            : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
        }`}
        title={title}
        data-boolean-op={id}
      >
        {label}
      </button>
    );
  };

  const pickBtn = (id, label, title) => {
    const on = pick === id;
    return (
      <button
        type="button"
        data-ui-action={UI_ACTION}
        onClick={() => onPickTarget?.(id)}
        aria-pressed={on}
        className={`px-2.5 py-1 rounded text-[13px] ${
          on
            ? 'bg-cyan-600 text-white'
            : 'bg-cyan-950/80 text-cyan-100 border border-cyan-700/70'
        }`}
        title={title}
      >
        {label}
      </button>
    );
  };

  const showUndo = (pick === 'bodies' && bodyCount > 0) || (pick === 'pieces' && dropCount > 0);

  return (
    <FeatureSheet
      title={`Boolean · ${opLabel}`}
      subtitle={status}
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-boolean-mode': '1',
        'data-boolean-allow-section': '1',
        'data-boolean-survives-parts': '1',
        'data-boolean-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-boolean-mode-chip',
      }}
      note={(
        <span className="flex min-w-0 items-center gap-2">
          {onDelete ? <FeatureDeleteButton onClick={onDelete} /> : null}
          <span className="leading-tight">booleanBodies</span>
        </span>
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Boolean operation">
          {opBtn('union', 'Union', 'Add the bodies together')}
          {opBtn('difference', 'Difference', 'Cut the tool bodies out of the target')}
          {opBtn('intersect', 'Intersect', 'Keep only the overlap, then hide leftover pieces')}
        </div>
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Boolean picks">
          {pickBtn('bodies', 'Bodies', 'Tap to add a body. Tap a selected body to remove it.')}
          {op === 'intersect' && pickBtn('pieces', 'Pieces', 'Tap a leftover piece to hide it. Tap again to bring it back.')}
          {showUndo && (
            <>
              <button
                type="button"
                data-ui-action={UI_ACTION}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onUndo?.()}
                title={pick === 'pieces' ? 'Bring back the last hidden piece' : 'Drop the last pick'}
                data-boolean-undo=""
              >
                Undo
              </button>
              <button
                type="button"
                data-ui-action={UI_ACTION}
                className="px-2.5 py-1 rounded text-[13px] text-cyan-200 underline"
                onClick={() => onClear?.()}
                title={pick === 'pieces' ? 'Show every piece. The bodies stay.' : 'Drop the bodies in this list'}
                data-boolean-clear=""
              >
                Clear
              </button>
            </>
          )}
        </div>
        {crossPart && (
          <p
            className="text-[11px] text-yellow-200 leading-snug m-0 border-l-2 border-yellow-400 pl-1.5"
            data-boolean-cross-part="1"
          >
            Writes {nameOf(targetId)}. Tool bodies from other parts are copied in at Confirm — not linked.
          </p>
        )}
        <p className="text-[11px] text-cyan-200/80 leading-snug m-0">
          Section and the part list stay open. Hiding a part keeps its picks.
        </p>
      </div>
    </FeatureSheet>
  );
};

export default BooleanModeChip;
