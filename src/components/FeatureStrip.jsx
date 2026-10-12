import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpFromLine,
  Rotate3d,
  Pyramid,
  Route,
  NotebookPen,
  TriangleRight,
  Undo,
  Redo,
  Box,
  Cylinder,
  Circle,
  CircleDot,
  Equal,
  Lock,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Radius,
  Ruler,
  Spline,
  Square,
  Torus,
  Hexagon,
  Squircle,
  Drill,
  Grid3x3,
  Bolt,
  Cone,
  PackageOpen,
  Focus,
  AlignCenterHorizontal,
  AlignVerticalJustifyCenter,
  FlipHorizontal2,
  Boxes,
  Layers3,
  Scissors,
  Move,
  SquareArrowOutUpRight,
  SquareX,
} from 'lucide-react';
import SquareRoundCorner from './icons/SquareRoundCorner';
import RectangleCircle from './icons/RectangleCircle';
import Angle from './icons/Angle';
import SheetMetalPlate from './icons/SheetMetalPlate';
import { featureShowsSeparateBody } from '../utils/featureMarkers';
import { featuresWithContours } from '../utils/contourUsers';
import { featureBarWindowMode } from '../utils/featureBarLayout';
import { chipTone } from '../utils/featureChipTone';
import { JOINT_TYPE_LABEL } from '../joints/jointUi';

/**
 * Slice Mobile B.1 → C.2 — feature strip (+ desktop seam).
 *
 * C.2:
 *   - CAD (mobile): full-width bar under the top ribbon. Fixed Undo, centered
 *     feature chips (tail window once they overflow), fixed Redo.
 *   - Script (mobile): vertical on the right, starting below the ribbon.
 *   - Desktop: vertical between editor and viewer (`side="between"`).
 *
 * Icons match CAD toolbar tools. Per-type index badges (C.1). Script/desktop:
 * jump caret. CAD mobile: open feature sheet.
 *
 * Slice A: strip covers every left-rail insertable that creates a feature
 * (Block / Model / Polish / Move), not only Contour/Fillet markers.
 */

/** Same glyphs as HelperInsertPalette for every left-rail insertable. */
const FEATURE_ICONS = Object.freeze({
  profile: NotebookPen,       // Create contour / crossSection
  extrude: ArrowUpFromLine,   // makeExtrude
  revolve: Rotate3d,          // makeRevolve
  loft: Pyramid,              // makeLoft
  sweep: Route,               // makeSweep
  fillet: SquareRoundCorner,  // filletEdges
  chamfer: TriangleRight,     // chamferEdges
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
  moveFace: SquareArrowOutUpRight,
  deleteFace: SquareX,
  center: Focus,
  align: AlignVerticalJustifyCenter,
  mirror: FlipHorizontal2,
  array: Boxes,
  polarArray: Boxes,
  workplane: Layers3,
  sheetMetal: SheetMetalPlate,
});

const JOINT_ICONS = Object.freeze({
  coincident: AlignVerticalJustifyCenter,
  concentric: Circle,
  distance: Move,
  angle: Angle,
  symmetric: FlipHorizontal2,
  fixed: Focus,
});

/** Same box for an empty joints caption and a joint chip, so the bar does not jump. */
const JOINT_CHIP_BOX = 'relative shrink-0 rounded-lg p-1.5 h-8 box-border flex items-center justify-center border';

const SKETCH_SHAPE_ICONS = Object.freeze({
  circle: Circle,
  rectangle: Square,
  polygon: Hexagon,
  polyline: Spline,
  line: Minus,
  arc: Radius,
});

const SKETCH_CONSTRAINT_ICONS = Object.freeze({
  horizontal: MoveHorizontal,
  vertical: MoveVertical,
  parallel: AlignCenterHorizontal,
  perpendicular: Angle,
  tangent: Radius,
  equal: Equal,
  coincident: CircleDot,
  fix: Lock,
});

function SketchGlyph({ entity, size }) {
  let Icon = Minus;
  if (entity?.kind === 'dimension') Icon = entity.dimKind === 'angle' ? Angle : Ruler;
  else if (entity?.kind === 'constraint') Icon = SKETCH_CONSTRAINT_ICONS[entity.constraintKind] || Lock;
  else if (entity?.kind === 'ref') {
    Icon = entity.geomKind === 'point' ? CircleDot
      : entity.geomKind === 'arc' ? Circle
        : entity.geomKind === 'polyline' ? Spline
          : Minus;
  } else Icon = SKETCH_SHAPE_ICONS[entity?.kind] || Minus;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

function JointGlyph({ type, size }) {
  const Icon = JOINT_ICONS[type] || AlignVerticalJustifyCenter;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

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

/** Title text for one chip. A skipped dependent names the feature it uses. */
function chipTitle(f, failed, bodyCount, failedTitles) {
  if (failed) return failedTitles?.[f.id]?.chip || `${f.chipLabel} — failed on the last run`;
  if (f.external) return `${f.chipLabel} — external copy, not linked`;
  if (f.unused) return `${f.chipLabel} — unused`;
  return featureShowsSeparateBody(f, bodyCount)
    ? `${f.chipLabel} — separate body (merge off)`
    : f.chipLabel;
}

/** Unused status without a label. The word made the chip taller than a used one. */
function UnusedMark({ on }) {
  if (!on) return null;
  return (
    <span
      className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-200/90 pointer-events-none"
      data-contour-unused-dot=""
      aria-hidden="true"
    />
  );
}

/** Merge bodies off: two small offset squares, top-left of the chip. */
function SeparateBodyMarker({ on }) {
  if (!on) return null;
  return (
    <span
      className="absolute -top-0.5 -left-0.5 w-[0.8rem] h-[0.8rem] rounded-sm
        bg-violet-500 shadow pointer-events-none flex items-center justify-center"
      data-feature-separate-body=""
      aria-hidden="true"
    >
      <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="white" strokeWidth="1.3">
        <rect x="1" y="1" width="5" height="5" />
        <rect x="4" y="4" width="5" height="5" />
      </svg>
    </span>
  );
}

function chipTypeIndex(feature) {
  if (feature?.kind === 'contour') return null;
  return feature?.typeIndex || 1;
}

function TypeBadge({ index }) {
  if (!index) return null;
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 min-w-[0.85rem] h-[0.85rem] px-0.5
        rounded-full bg-cyan-500 text-[8px] leading-[0.85rem] text-center
        font-bold text-white pointer-events-none shadow"
      data-feature-type-badge={index}
      aria-hidden="true"
    >
      {index}
    </span>
  );
}

export default function FeatureStrip({
  script = '',
  activeId = null,
  onJump,
  hideWhenEmpty = false,
  /** 'vertical' (Script/desktop) | 'horizontal' (CAD under-ribbon). */
  orientation = 'vertical',
  /**
   * Placement chrome: 'top' (horizontal CAD), 'right' (Script rail),
   * 'between' (desktop seam between editor and viewer). Defaults from orientation.
   */
  side,
  /** Same history handlers as the editor toolbar. Mobile CAD bar only. */
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  /** A feature session hides the strip. Undo stays on the feature chip. */
  hidden = false,
  /** Ids of features the last run failed in (red chip border). */
  failedIds = null,
  /**
   * Titles for dependents skipped with that failure.
   * `{ [id]: { chip, sheet, dependsOn } }` from `failedFeatureTitles`.
   */
  failedTitles = null,
  /**
   * Live body count of the strip's part (from the last successful run).
   * Separate-body marker shows only when a chip wrote merge:false AND this
   * is greater than 1 — so a later Boolean union clears it.
   */
  bodyCount = 0,
  /** Joint chips. An array (including empty) switches this strip to joints. */
  joints = null,
  onSelectJoint,
  /**
   * Sketch chips. An array (including empty) switches this strip to the
   * open contour. Undo stays; Redo stays disabled by the caller.
   */
  entities = null,
  onSelectEntity,
  undoLabel = 'Undo',
  redoLabel = 'Redo',
}) {
  const features = useMemo(() => featuresWithContours(script), [script]);
  const entityMode = Array.isArray(entities);
  const jointMode = !entityMode && Array.isArray(joints);
  const horizontal = orientation === 'horizontal';
  const stripSide = side || (horizontal ? 'top' : 'right');
  const between = stripSide === 'between';
  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const [featureWindow, setFeatureWindow] = useState('fit');
  const stripItems = entityMode ? entities : (jointMode ? joints : features);
  const lastFeatureId = stripItems.length ? stripItems[stripItems.length - 1].id : null;
  const listLength = stripItems.length;

  // Vertical rails: when the feature list grows, scroll so the last chip is
  // visible. Key off length + last id so unrelated re-renders don't yank
  // mid-scroll. The mobile bar pins its own window in the layout effect.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !lastFeatureId || horizontal) return;
    const chips = el.querySelectorAll('[data-feature-id]');
    const lastChip = chips.length ? chips[chips.length - 1] : null;
    if (lastChip && typeof lastChip.scrollIntoView === 'function') {
      lastChip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [listLength, lastFeatureId, horizontal]);

  // Mobile bar: center the chips while they fit. Once they overflow, the
  // visible window is the tail (latest features); earlier chips sit to the start.
  useLayoutEffect(() => {
    if (!horizontal) return undefined;
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return undefined;

    const pin = () => {
      // Horizontal padding stays on the section around this scroller, so it
      // stays put when the chips scroll. Vertical padding is on the scroller
      // itself: the count badges hang a couple of pixels past the icon, and
      // overflow-x clips that hang unless it sits inside the padding edge.
      // Measure the scrollport itself.
      const next = featureBarWindowMode(track.scrollWidth, scroller.clientWidth);
      setFeatureWindow((prev) => (prev === next ? prev : next));
      if (next === 'tail') {
        const max = scroller.scrollWidth - scroller.clientWidth;
        if (Math.abs(scroller.scrollLeft - max) > 1) scroller.scrollLeft = max;
      } else if (scroller.scrollLeft !== 0) {
        scroller.scrollLeft = 0;
      }
    };

    pin();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(pin);
    ro.observe(scroller);
    ro.observe(track);
    return () => ro.disconnect();
  }, [horizontal, listLength, lastFeatureId, featureWindow]);

  if (hidden) {
    return (
      <div
        data-feature-strip=""
        data-feature-strip-hidden="feature"
        data-feature-strip-orientation={orientation}
        hidden
      />
    );
  }

  if (!horizontal && listLength === 0) {
    if (hideWhenEmpty && !jointMode) return null;
    return (
      <div
        className={between
          ? `shrink-0 flex flex-col items-center justify-start gap-1
            border-x border-gray-700/50 bg-gray-900/80 surface-glass-chip
            px-1.5 py-2 w-11 h-full min-h-0`
          : `shrink-0 flex flex-col items-center justify-start gap-1
            border-l border-gray-700/40 bg-gray-900/70 surface-glass-chip
            px-1.5 py-2 w-11 flex-1 min-h-0
            pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]`}
        data-feature-strip=""
        data-feature-strip-empty=""
        data-assembly-joints={jointMode ? '' : undefined}
        data-feature-strip-orientation="vertical"
        data-feature-strip-side={stripSide}
        data-feature-strip-placement={between ? 'desktop-seam' : undefined}
        title="No marked features yet"
      >
        <div
          className="text-[9px] text-gray-400 font-sans leading-tight text-center writing-mode-vertical"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {jointMode ? 'No assembly joints' : 'No features'}
        </div>
      </div>
    );
  }

  if (horizontal) {
    const historyBtn = 'shrink-0 rounded-lg p-1.5 flex items-center justify-center text-blue-400 hover:bg-gray-700/60 disabled:opacity-30 active:opacity-80';
    return (
      <div
        className="flex w-full min-w-0 flex-row items-center
          border border-gray-700/40 bg-gray-900/70 surface-glass-chip"
        data-feature-strip=""
        data-feature-strip-orientation="horizontal"
        data-feature-strip-side="top"
        data-feature-strip-empty={listLength === 0 ? '' : undefined}
        data-assembly-joints={jointMode ? '' : undefined}
        data-sketch-entities={entityMode ? '' : undefined}
        data-feature-bar-layout="undo-features-redo"
        role="navigation"
        aria-label={entityMode ? 'Sketch' : (jointMode ? 'Assembly joints' : 'Modeling features')}
      >
        <div
          className="shrink-0 pl-[max(0.5rem,env(safe-area-inset-left))]"
          data-feature-bar-section="undo"
        >
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className={historyBtn}
            title={undoLabel}
            aria-label={undoLabel}
            data-feature-bar-undo=""
          >
            <Undo size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div
          className="min-w-0 flex-1 px-3"
          data-feature-bar-section="features"
          data-feature-bar-window={featureWindow}
          data-feature-bar-justify={featureWindow === 'tail' ? 'tail' : 'center'}
        >
          <div
            ref={scrollRef}
            className={`flex flex-row items-center overflow-x-auto rail-scroll py-1.5 ${
              featureWindow === 'tail' ? 'justify-start' : 'justify-center'
            }`}
            data-feature-bar-scroller=""
          >
            <div
              ref={trackRef}
              className="flex w-max flex-row items-center gap-1.5"
              data-feature-bar-track=""
            >
            {jointMode && joints.length === 0 && (
              <div
                className={`${JOINT_CHIP_BOX} border-transparent px-2 text-[9px] text-gray-400 font-sans whitespace-nowrap`}
                data-assembly-joints-empty=""
              >
                No assembly joints
              </div>
            )}
            {entityMode && entities.length === 0 && (
              <div
                className={`${JOINT_CHIP_BOX} border-transparent px-2 text-[9px] text-gray-400 font-sans whitespace-nowrap`}
                data-sketch-entities-empty=""
              >
                No sketch entities
              </div>
            )}
            {!jointMode && !entityMode && features.length === 0 && !hideWhenEmpty && (
              <div className="text-[9px] text-gray-400 font-sans whitespace-nowrap px-1">
                No features
              </div>
            )}
            {jointMode && joints.map((joint) => {
              const invalid = !!joint.invalid;
              return (
                <button
                  key={joint.id}
                  type="button"
                  data-joint-id={joint.id}
                  data-joint-type={joint.type}
                  data-joint-status={joint.status || 'ok'}
                  data-joint-value={joint.type === 'angle' ? joint.value : undefined}
                  aria-label={joint.name || JOINT_TYPE_LABEL[joint.type] || 'Joint'}
                  aria-invalid={invalid || undefined}
                  title={joint.title || joint.name}
                  onClick={() => onSelectJoint?.(joint)}
                  className={`${JOINT_CHIP_BOX} transition-colors active:opacity-80 ${chipTone(false, false, invalid)}`}
                >
                  <JointGlyph type={joint.type} size={16} />
                </button>
              );
            })}
            {entityMode && entities.map((entity) => {
              const active = activeId === entity.id;
              const failed = !!entity.broken;
              return (
                <button
                  key={entity.id}
                  type="button"
                  data-sketch-id={entity.id}
                  data-sketch-kind={entity.kind}
                  data-sketch-broken={failed ? '' : undefined}
                  aria-pressed={active}
                  aria-label={entity.label}
                  aria-invalid={failed || undefined}
                  title={entity.title || entity.label}
                  onClick={() => onSelectEntity?.(entity)}
                  className={`${JOINT_CHIP_BOX} transition-colors active:opacity-80 ${chipTone(active, false, failed)}`}
                >
                  <SketchGlyph entity={entity} size={16} />
                  <TypeBadge index={entity.index} />
                </button>
              );
            })}
            {!jointMode && !entityMode && features.map((f) => {
              const active = activeId === f.id;
              const failed = !!failedIds?.has?.(f.id);
              const typeIndex = chipTypeIndex(f);
              const separateLive = featureShowsSeparateBody(f, bodyCount);
              return (
                <button
                  key={f.id}
                  type="button"
                  data-feature-chip={f.kind}
                  data-feature-id={f.id}
                  data-feature-type-index={typeIndex || undefined}
                  data-contour-id={f.contourId || undefined}
                  data-contour-unused={f.unused ? '' : undefined}
                  data-feature-external={f.external ? '1' : undefined}
                  data-feature-separate={separateLive ? '1' : undefined}
                  data-feature-failed={failed ? '1' : undefined}
                  data-feature-depends={failedTitles?.[f.id]?.dependsOn || undefined}
                  aria-pressed={active}
                  aria-label={f.unused ? `${f.chipLabel} unused` : f.chipLabel}
                  aria-invalid={failed || undefined}
                  aria-description={f.external ? 'External copy, not linked' : undefined}
                  title={chipTitle(f, failed, bodyCount, failedTitles)}
                  onClick={() => onJump?.(f)}
                  className={`relative shrink-0 rounded-lg p-1.5 flex items-center justify-center
                    border transition-colors active:opacity-80 ${chipTone(active, f.external, failed)}`}
                >
                  <FeatureGlyph kind={f.kind} size={16} />
                  <UnusedMark on={f.unused} />
                  <TypeBadge index={typeIndex} />
                  <SeparateBodyMarker on={separateLive} />
                </button>
              );
            })}
            </div>
          </div>
        </div>
        <div
          className="shrink-0 pr-[max(0.5rem,env(safe-area-inset-right))]"
          data-feature-bar-section="redo"
        >
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className={historyBtn}
            title={redoLabel}
            aria-label={redoLabel}
            data-feature-bar-redo=""
          >
            <Redo size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={between
        ? `shrink-0 flex flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden
          border-x border-gray-700/50 bg-gray-900/80 surface-glass-chip
          px-1.5 py-2 w-11 rail-scroll h-full min-h-0`
        : `shrink-0 flex flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden
          border-l border-gray-700/40 bg-gray-900/70 surface-glass-chip
          px-1.5 pt-2 w-11 rail-scroll flex-1 min-h-0
          pb-[max(3.5rem,calc(env(safe-area-inset-bottom,0px)+3.25rem))]`}
      data-feature-strip=""
      data-feature-strip-orientation="vertical"
      data-feature-strip-side={stripSide}
      data-feature-strip-placement={between ? 'desktop-seam' : undefined}
      role="navigation"
      aria-label={jointMode ? 'Assembly joints' : 'Modeling features'}
      data-assembly-joints={jointMode ? '' : undefined}
    >
      {jointMode && joints.map((joint) => {
        const invalid = !!joint.invalid;
        return (
          <button
            key={joint.id}
            type="button"
            data-joint-id={joint.id}
            data-joint-type={joint.type}
            data-joint-status={joint.status || 'ok'}
            data-joint-value={joint.type === 'angle' ? joint.value : undefined}
            aria-label={joint.name || JOINT_TYPE_LABEL[joint.type] || 'Joint'}
            aria-invalid={invalid || undefined}
            title={joint.title || joint.name}
            onClick={() => onSelectJoint?.(joint)}
            className={`${JOINT_CHIP_BOX} transition-colors active:opacity-80 ${chipTone(false, false, invalid)}`}
          >
            <JointGlyph type={joint.type} size={16} />
          </button>
        );
      })}
      {!jointMode && features.map((f) => {
        const active = activeId === f.id;
        const failed = !!failedIds?.has?.(f.id);
        const typeIndex = chipTypeIndex(f);
        const separateLive = featureShowsSeparateBody(f, bodyCount);
        return (
          <button
            key={f.id}
            type="button"
            data-feature-chip={f.kind}
            data-feature-id={f.id}
            data-feature-type-index={typeIndex || undefined}
            data-contour-id={f.contourId || undefined}
            data-contour-unused={f.unused ? '' : undefined}
            data-feature-external={f.external ? '1' : undefined}
            data-feature-separate={separateLive ? '1' : undefined}
            data-feature-failed={failed ? '1' : undefined}
            data-feature-depends={failedTitles?.[f.id]?.dependsOn || undefined}
            aria-pressed={active}
            aria-label={f.unused ? `${f.chipLabel} unused` : f.chipLabel}
            aria-invalid={failed || undefined}
            aria-description={f.external ? 'External copy, not linked' : undefined}
            title={chipTitle(f, failed, bodyCount, failedTitles)}
            onClick={() => onJump?.(f)}
            className={`relative shrink-0 rounded-lg p-1.5 flex items-center justify-center
              border transition-colors active:opacity-80 ${chipTone(active, f.external, failed)}`}
          >
            <FeatureGlyph kind={f.kind} size={16} />
            <UnusedMark on={f.unused} />
            <TypeBadge index={typeIndex} />
            <SeparateBodyMarker on={separateLive} />
          </button>
        );
      })}
    </div>
  );
}
