import React from 'react';
import { Trash2 } from 'lucide-react';
import StickyPickApply from './StickyPickApply';
import { useDisplayUnit } from '../hooks/useDisplayUnit';
import {
  JOINT_TYPE_LABEL,
  jointConfirmDisabled,
  jointPickCap,
  jointSubtitle,
  planarAnglePair,
  stickyJointPick,
} from '../joints/jointUi';
import { LengthNumberField, NumberField } from './controls/popupUI';
import { fallbackOffscreenDistance, offscreenRange } from '../utils/sliderMap';

const TYPES = ['coincident', 'concentric', 'distance', 'angle', 'symmetric', 'fixed'];
const PROPERTIES = TYPES.map((id) => ({ id, label: JOINT_TYPE_LABEL[id] }));

/**
 * Create card, and the card a strip chip reopens. StickyPickApply owns
 * the chrome. The parent owns the fingerprints. Create says Add and
 * stays open. A chip reopens this card in edit mode: Confirm saves and
 * closes, the red Delete removes the joint, and X writes nothing.
 */
export default function JointCard({
  card,
  unit = null,
  distanceRangeMm = null,
  onChange,
  onConfirm,
  onCancel,
  onDelete,
  onQuickAngle,
  onResolvePartChange,
  compact = false,
  locked = false,
}) {
  const [liveUnit] = useDisplayUnit();
  const shownUnit = unit || liveUnit;
  const distanceEnd = Number(distanceRangeMm) > 0
    ? Number(distanceRangeMm)
    : offscreenRange(fallbackOffscreenDistance(100));
  if (!card) return null;
  const editing = card.mode === 'edit';
  const set = (patch) => onChange?.({ ...card, ...patch });
  const picks = (card.picks || []).map(stickyJointPick);
  const distance = card.type === 'distance';
  const angle = card.type === 'angle';
  const anglePair = planarAnglePair(card.picks);
  const asking = !!card.partChange;
  const properties = [
    ...PROPERTIES,
    {
      id: 'parallel',
      label: 'Parallel',
      action: true,
      disabled: !anglePair || asking,
      attrs: { 'data-joint-parallel': '' },
    },
    {
      id: 'perpendicular',
      label: 'Perpendicular',
      action: true,
      disabled: !anglePair || asking,
      attrs: { 'data-joint-perpendicular': '' },
    },
  ];
  const suggestion = card.suggested ? JOINT_TYPE_LABEL[card.suggested] : '';
  const note = [suggestion ? `Suggested: ${suggestion}` : '', card.note || ''].filter(Boolean).join(' ');
  return (
    <StickyPickApply
      title="Joint"
      subtitle={jointSubtitle(card.picks)}
      picks={picks}
      max={jointPickCap(card.picks)}
      properties={properties}
      property={card.type || ''}
      onProperty={(id) => {
        if (id === 'parallel') {
          onQuickAngle?.(0);
          return;
        }
        if (id === 'perpendicular') {
          onQuickAngle?.(90);
          return;
        }
        set({ type: id, userPickedType: true });
      }}
      onRemovePick={(pick) => {
        const next = (card.picks || []).filter((row, index) => stickyJointPick(row, index).id !== pick.id);
        set({ picks: next });
      }}
      onApply={onConfirm}
      onCancel={onCancel}
      applyLabel={editing ? 'Confirm' : 'Add'}
      applyDisabled={jointConfirmDisabled({ card, locked })}
      note={editing ? (
        <span className="flex min-w-0 items-center gap-2">
          {note ? <span className="min-w-0">{note}</span> : null}
          <button
            type="button"
            data-joint-delete=""
            onClick={() => onDelete?.()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-700/60 bg-red-950/50 px-2.5 py-1.5 text-[13px] font-medium text-red-200 hover:bg-red-900/70 hover:text-white"
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </span>
      ) : note}
      compact={compact}
      cardAttrs={{
        'data-joint-card': '',
        'data-joint-id': card.id || '',
        'data-joint-type': card.type || '',
        ...(suggestion ? { 'data-joint-suggestion': card.suggested } : {}),
      }}
    >
      <div className="flex flex-col gap-2" data-joint-body="">
        {asking && (
          <div
            className="flex flex-col gap-1 rounded-md border border-cyan-600/80 bg-cyan-950 p-2"
            data-joint-part-change=""
            role="dialog"
            aria-label="Change one of the parts?"
          >
            <p className="text-[13px] text-cyan-50">Change one of the parts?</p>
            <button
              type="button"
              data-joint-part-discard=""
              onClick={() => onResolvePartChange?.('discard')}
              className="min-h-[36px] rounded-md border border-cyan-700/70 bg-cyan-950/80 px-2 text-left text-[13px] text-cyan-100"
            >
              Discard last pick
            </button>
            <button
              type="button"
              data-joint-part-replace="1"
              onClick={() => onResolvePartChange?.('replace-1')}
              className="min-h-[36px] rounded-md border border-cyan-700/70 bg-cyan-950/80 px-2 text-left text-[13px] text-cyan-100"
            >
              Replace part 1
            </button>
            <button
              type="button"
              data-joint-part-replace="2"
              onClick={() => onResolvePartChange?.('replace-2')}
              className="min-h-[36px] rounded-md border border-cyan-700/70 bg-cyan-950/80 px-2 text-left text-[13px] text-cyan-100"
            >
              Replace part 2
            </button>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-cyan-200/80">Name</span>
          <input
            data-joint-name=""
            value={card.name || ''}
            onChange={(event) => set({ name: event.target.value, userNamed: true })}
            className="min-h-[36px] rounded border border-cyan-700/70 bg-cyan-950/80 px-2 text-white"
          />
        </label>
        {card.picks?.length === 1 && (
          <button
            type="button"
            data-joint-ground=""
            onClick={() => set({ type: 'fixed', userPickedType: true })}
            className="self-start rounded-md border border-cyan-700/70 bg-cyan-950/80 px-2 py-1 text-[12px] text-cyan-100"
          >
            Ground
          </button>
        )}
        {distance && (
          <LengthNumberField
            id="joint-distance"
            label="Distance"
            accent="cyan"
            unit={shownUnit}
            valueMm={Number.isFinite(Number(card.valueMm)) ? Number(card.valueMm) : ''}
            onChangeMm={(raw) => {
              if (raw === '' || raw === '-' || raw === '.') {
                set({ valueMm: NaN });
                return;
              }
              const n = Number(raw);
              set({ valueMm: Number.isFinite(n) ? n : card.valueMm });
            }}
            maxMm={distanceEnd}
            signed
            numberAttrs={{ 'data-joint-value': '' }}
            captionAttrs={{ 'data-joint-value-caption': '' }}
          />
        )}
        {angle && (
          <NumberField
            id="joint-angle"
            label="Angle °"
            accent="cyan"
            value={Number.isFinite(Number(card.valueMm)) ? card.valueMm : ''}
            onChange={(raw) => {
              if (raw === '' || raw === '-' || raw === '.') {
                set({ valueMm: raw === '' ? NaN : Number(raw) });
                return;
              }
              const n = Number(raw);
              set({ valueMm: Number.isFinite(n) ? n : card.valueMm });
            }}
            min={-90}
            max={90}
            step={1}
            numberAttrs={{ 'data-joint-angle': '' }}
            sliderAttrs={{ 'data-joint-angle-slider': '' }}
            captionAttrs={{ 'data-joint-angle-caption': '' }}
          />
        )}
        {(distance || angle) && (
          <button
            type="button"
            data-joint-flip=""
            onClick={() => set({ sense: card.sense === -1 ? 1 : -1 })}
            className="self-start rounded-md border border-cyan-700/70 bg-cyan-950/80 px-2 py-1 text-[12px] text-cyan-100"
          >
            Flip
          </button>
        )}
      </div>
    </StickyPickApply>
  );
}
