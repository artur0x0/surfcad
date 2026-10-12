import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowUpFromLine,
  Rotate3d,
  Pyramid,
  Route,
  NotebookPen,
  TriangleRight,
  Code2,
  Trash2,
  Box,
  Cylinder,
  Circle,
  Torus,
  Hexagon,
  Squircle,
  Drill,
  Grid3x3,
  Bolt,
  Cone,
  PackageOpen,
  Scissors,
  Focus,
  AlignVerticalJustifyCenter,
  FlipHorizontal2,
  Boxes,
  Move,
} from 'lucide-react';
import { sheetIdentityTone, sheetPickTone } from '../utils/featureChipTone';
import SquareRoundCorner from './icons/SquareRoundCorner';
import RectangleCircle from './icons/RectangleCircle';
import Angle from './icons/Angle';
import SheetMetalPlate from './icons/SheetMetalPlate';
import {
  NumberField,
  LengthNumberField,
  ChoiceRow,
  PopupButton,
  POPUP_TEXT,
  accentOf,
} from './controls/popupUI';
import { growToFit, partLengthMm } from '../utils/sliderRange';
import {
  featureBlockText,
  parseFeatureSheetParams,
  isFeatureSheetEditable,
} from '../utils/featureSheetWriteback';
import FeatureSheet from './FeatureSheet';

/**
 * Fallback editor and the feature picker, on the shared bottom card.
 * Kinds with a creation dialog reopen that dialog instead (`beginFeatureEdit`).
 * This card is what stays when that dialog does not open, plus the picker.
 * X and Esc write nothing. Confirm saves and closes. There is no swipe.
 * Game does not mount it.
 */

const FEATURE_ICONS = Object.freeze({
  profile: NotebookPen,
  extrude: ArrowUpFromLine,
  revolve: Rotate3d,
  loft: Pyramid,
  sweep: Route,
  fillet: SquareRoundCorner,
  chamfer: TriangleRight,
  cube: Box,
  roundedBox: Squircle,
  cylinder: Cylinder,
  sphere: Circle,
  tube: Torus,
  hexPrism: Hexagon,
  hole: Drill,
  holePattern: Grid3x3,
  clearanceHole: Bolt,
  tapDrillHole: Drill,
  cboreHole: Cylinder,
  cskHole: Cone,
  shell: PackageOpen,
  draft: Angle,
  cut: Scissors,
  boolean: RectangleCircle,
  move: Move,
  center: Focus,
  align: AlignVerticalJustifyCenter,
  mirror: FlipHorizontal2,
  array: Boxes,
  polarArray: Boxes,
  sheetMetal: SheetMetalPlate,
});

function FeatureGlyph({ kind, size }) {
  const Icon = FEATURE_ICONS[kind] || NotebookPen;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      className={kind === 'sheetMetal' ? 'text-blue-400' : undefined}
    />
  );
}

const ACCENT = 'cyan';

function snippetPreview(text, maxLines = 2) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines - 1).join('\n')}\n…`;
}

function TypeBadge({ index }) {
  if (!index) return null;
  return (
    <span
      className="absolute -bottom-1 -right-1 min-w-[0.85rem] h-[0.85rem] px-0.5
        rounded-full bg-cyan-500 text-[8px] leading-[0.85rem] text-center
        font-bold text-white"
      data-feature-type-badge={index}
      aria-hidden="true"
    >
      {index}
    </span>
  );
}

export default function FeatureEditSheet({
  feature = null,
  features = null,
  script = '',
  onAccept,
  onCancel,
  onDelete,
  onEditScript,
  onPickFeature,
  /** Ids the last run failed in (red border, wins over the external yellow). */
  failedIds = null,
  /** Dependent titles from `failedFeatureTitles`. The thrown feature keeps the failed copy. */
  failedTitles = null,
  /** Phone. The card docks to the pane bottom and the stage switcher hides. */
  compact = false,
  lengthMm = 100,
}) {
  const a = accentOf(ACCENT);
  const block = useMemo(
    () => (feature ? featureBlockText(script, feature) : ''),
    [script, feature],
  );
  const parsed = useMemo(
    () => (feature ? parseFeatureSheetParams(feature.kind, block) : null),
    [feature, block],
  );

  const [draft, setDraft] = useState(() => parsed?.params || {});

  useEffect(() => {
    setDraft(parsed?.params || {});
    // Re-seed draft when the open feature (or its parsed literals) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature?.id, block]);

  // Picker: several features, none selected. X closes and writes nothing.
  if (!feature && Array.isArray(features) && features.length > 0) {
    return (
      <FeatureSheet
        title="Edit feature"
        compact={compact}
        onCancel={onCancel}
        cardAttrs={{
          'data-feature-sheet': '',
          'data-feature-sheet-layout': 'feature-card',
          'data-feature-sheet-picker': '',
          'data-feature-sheet-cancel': '',
          'aria-label': 'Choose feature to edit',
        }}
      >
        <div className="flex flex-col gap-1.5 py-1">
          {features.map((f) => {
            const editable = isFeatureSheetEditable(f.kind);
            const failed = !!failedIds?.has?.(f.id);
            const typeIndex = f.typeIndex || ((f.index ?? 0) + 1);
            return (
              <button
                key={f.id}
                type="button"
                data-feature-sheet-pick={f.id}
                data-feature-kind={f.kind}
                data-feature-type-index={typeIndex}
                onClick={() => onPickFeature?.(f)}
                data-feature-sheet-failed={failed ? '1' : undefined}
                data-feature-depends={failedTitles?.[f.id]?.dependsOn || undefined}
                aria-invalid={failed || undefined}
                title={failedTitles?.[f.id]?.chip || (failed ? `${f.chipLabel} — failed on the last run` : undefined)}
                className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left
                  ${sheetPickTone(editable, failed)}`}
              >
                <span className="relative inline-flex">
                  <FeatureGlyph kind={f.kind} size={16} />
                  <TypeBadge index={typeIndex} />
                </span>
                <span className={`${POPUP_TEXT.value} font-medium whitespace-nowrap`}>{f.chipLabel}</span>
                {!editable && (
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">script</span>
                )}
              </button>
            );
          })}
        </div>
      </FeatureSheet>
    );
  }

  if (!feature) return null;

  const editable = !!(parsed && parsed.editable);
  const typeIndex = feature.typeIndex || ((feature.index ?? 0) + 1);
  // Same red as the strip chip (failedFeatureIds on this script).
  const failed = !!failedIds?.has?.(feature.id);

  const setNum = (key, raw, fallback) => {
    let next = raw;
    if (raw === '' || raw === '-' || raw === '.') next = raw;
    else {
      const n = Number(raw);
      next = Number.isFinite(n) ? n : (draft[key] ?? fallback);
    }
    setDraft((prev) => ({ ...prev, [key]: next }));
  };

  const L = partLengthMm(lengthMm);
  let fields = null;
  if (editable && feature.kind === 'extrude') {
    const distanceFit = growToFit(0.1, L, Number(draft.distance));
    fields = (
      <>
        <LengthNumberField
          id="sheet-extrude-distance"
          label="Distance"
          accent={ACCENT}
          valueMm={draft.distance}
          onChangeMm={(v) => setNum('distance', v, 10)}
          minMm={distanceFit.min}
          maxMm={distanceFit.max}
        />
        <ChoiceRow
          label="Direction"
          accent={ACCENT}
          value={draft.sense || 'positive'}
          onChange={(sense) => setDraft((prev) => ({ ...prev, sense }))}
          options={[
            { value: 'positive', label: 'Out' },
            { value: 'negative', label: 'In' },
            { value: 'both', label: 'Both' },
          ]}
        />
      </>
    );
  } else if (editable && feature.kind === 'fillet') {
    const radiusNum = Number(draft.radius);
    const radiusFit = growToFit(0.1, Math.max(40, Number.isFinite(radiusNum) ? radiusNum : 0), radiusNum);
    fields = (
      <LengthNumberField
        id="sheet-fillet-radius"
        label="Radius"
        accent={ACCENT}
        valueMm={draft.radius}
        onChangeMm={(v) => setNum('radius', v, 2)}
        minMm={radiusFit.min}
        maxMm={radiusFit.max}
      />
    );
  } else if (editable && feature.kind === 'revolve') {
    fields = (
      <NumberField
        id="sheet-revolve-angle"
        label="Angle"
        accent={ACCENT}
        value={draft.angle}
        onChange={(v) => setNum('angle', v, 360)}
        min={0.1}
        max={360}
        step={1}
      />
    );
  } else {
    fields = (
      <p className={`${POPUP_TEXT.note} ${a.muted}`} data-feature-sheet-stub="">
        Params for {feature.label} aren’t editable here yet. Use Edit script.
      </p>
    );
  }

  const skipTitle = failedTitles?.[feature.id];
  const subtitle = skipTitle?.sheet
    ? skipTitle.sheet
    : failed
      ? 'Failed on the last run'
      : feature.external
        ? 'External copy · not linked · Delete removes it'
        : 'Feature sheet';

  return (
    <FeatureSheet
      title={feature.chipLabel}
      subtitle={subtitle}
      compact={compact}
      onCancel={onCancel}
      onConfirm={editable ? () => onAccept?.(feature, draft) : undefined}
      note={(
        <button
          type="button"
          aria-label="Delete feature"
          data-feature-sheet-delete=""
          title="Delete this feature from the script"
          onClick={() => onDelete?.(feature)}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px]
            font-medium text-red-200 border border-red-700/60 bg-red-950/50
            hover:bg-red-900/70 hover:text-white"
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
      )}
      cardAttrs={{
        'data-feature-sheet': '',
        'data-feature-sheet-layout': 'feature-card',
        'data-feature-sheet-kind': feature.kind,
        'data-feature-sheet-id': feature.id,
        'data-feature-sheet-editable': editable ? 'true' : 'false',
        'data-feature-sheet-accept': editable ? '' : undefined,
        'data-feature-sheet-cancel': '',
        'aria-label': `${feature.chipLabel} feature sheet`,
      }}
    >
      <div className="flex flex-col gap-2 py-1" data-feature-sheet-params="">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`relative inline-flex items-center justify-center rounded-lg bg-cyan-900/70 p-1.5 shrink-0 ${
              sheetIdentityTone(feature.external, failed)
            }`}
            data-feature-sheet-external={feature.external ? '1' : undefined}
            data-feature-sheet-failed={failed ? '1' : undefined}
            data-feature-depends={skipTitle?.dependsOn || undefined}
          >
            <FeatureGlyph kind={feature.kind} size={18} />
            <TypeBadge index={typeIndex} />
          </span>
          <PopupButton
            variant="ghost"
            accent={ACCENT}
            data-feature-sheet-edit-script=""
            onClick={() => onEditScript?.(feature)}
          >
            <Code2 size={14} aria-hidden="true" />
            Edit script
          </PopupButton>
        </div>
        {fields}
        <div
          className="rounded-md border border-cyan-800/60 bg-black/35 px-2 py-1
            font-mono text-[10px] leading-snug text-cyan-100/85 max-h-12 overflow-hidden"
          data-feature-sheet-snippet=""
          aria-hidden="true"
        >
          <pre className="whitespace-pre-wrap break-all m-0">{snippetPreview(block)}</pre>
        </div>
      </div>
    </FeatureSheet>
  );
}
