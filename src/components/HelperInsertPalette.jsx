import React, { useEffect, useRef, useState } from 'react';
import {
  Blocks,
  Box,
  Cylinder,
  Circle,
  Torus,
  Hexagon,
  Squircle,
  TriangleRight,
  Grid3x3,
  Bolt,
  Drill,
  PackageOpen,
  Boxes,
  Cone,
  Focus,
  AlignVerticalJustifyCenter,
  FlipHorizontal2,
  Layers3,
  ArrowUpFromLine,
  Rotate3d,
  Pyramid,
  NotebookPen,
  Route,
  Scissors,
  Move,
  RotateCw,
  SquareArrowOutUpRight,
  SquareX,
} from 'lucide-react';
import SquareRoundCorner from './icons/SquareRoundCorner';
import RectangleCircle from './icons/RectangleCircle';
import Angle from './icons/Angle';
import SheetMetalPlate from './icons/SheetMetalPlate';
import {
  HELPERS_NEED_BODY,
  HELPER_PALETTE_ITEMS,
  isBufferEmpty,
  itemsByGroup,
  paletteRailSections,
} from '../utils/helperPaletteSnippets.js';
import {
  RAIL_PAIR_HEIGHT_ATTR,
  RAIL_DESKTOP_FULL_ATTR,
  leftRailPositionClasses,
  useLeftRailFit,
} from '../utils/railPair';
import { resolveFaceModal } from '../utils/faceFeaturePlacement';
import { canBuildFilletAlongPath, resolveFilletStrategy } from '../utils/filletAlongPath';
import { isContourEntry } from '../utils/contourMode';
import { blockParamsPending, isBlockSolidId } from '../utils/blockSolid';
import { isFilletEntry, isChamferEntry } from '../utils/filletMode';
import HelperParamModal from './HelperParamModal';

const ICONS = {
  cube: Box,
  cylinder: Cylinder,
  sphere: Circle,
  tube: Torus,
  hexPrism: Hexagon,
  roundedBox: Squircle,
  filletEdges: SquareRoundCorner,
  chamferEdges: TriangleRight,
  hole: Drill,
  holePattern: Grid3x3,
  clearanceHole: Bolt,
  tapDrillHole: Drill,
  cboreHole: Cylinder,
  cskHole: Cone,
  shell: PackageOpen,
  cut: Scissors,
  boolean: RectangleCircle,
  move: Move,
  rotate: RotateCw,
  moveFace: SquareArrowOutUpRight,
  deleteFace: SquareX,
  addDraft: Angle,
  center: Focus,
  align: AlignVerticalJustifyCenter,
  mirror: FlipHorizontal2,
  // One Array button; Grid / Polar / Points is a param inside it.
  array3D: Boxes,
  // Workplane matches the right rail's plane-visibility toggle (both Layers3),
  // and Create contour matches its sketch-visibility toggle (both NotebookPen):
  // the tool that makes the thing wears the icon that shows the thing.
  workplane: Layers3,
  makeExtrude: ArrowUpFromLine,
  makeRevolve: Rotate3d,
  makeLoft: Pyramid,
  // Sweep inherited Route from the retired Path button — a sweep *is* a path.
  makeSweep: Route,
  crossSection: NotebookPen,
};

/** Mobile-first group captions (full names stay on the data model). */
const GROUP_SHORT_LABEL = {
  Primitives: 'Block',
  Build: 'Build',
  Shape: 'Shape',
  Advanced: 'Adv',
  Features: 'Polish',
  Transforms: 'Move',
};

/**
 * Slice 09/10/11 — left vertical helper insert palette.
 * Both layouts use one rail: Block, Build, Shape, Polish, Move. Shape is the
 * old Model section (Profile / Workplane / Extrude / Revolve / Sweep / Loft).
 * Tap opens HelperParamModal; with selectedFace / selectedEdges, face/edge
 * features get an aware sheet (or refuse). Confirm → onInsert(id, params, faceContext, edgeContext).
 * Slice 24/25/26/28/30: Extrude / Revolve / Loft / Sweep / Profile call onEnterContourMode.
 * Extrude / Revolve / Loft / Sweep Confirm commits the solid; Profile stays Profile-only.
 * Slice 27: Fillet enters edge-pick mode (no pre-select / no soft-fail).
 * Shell: face-pick mode (opening face + wall); not the axis Opening sheet.
 * Slice 29: groups Block / Adv / Feat / Xform on the game rail.
 * Advanced Confirm unions onto `part` when a solid is already in the script.
 */
const HelperInsertPalette = ({
  onInsert,
  getBuffer,
  selectedFace = null,
  selectedEdges = null,
  onRequestEdgeMode = null,
  onStaleEdgesClear = null,
  onProfilePreview = null,
  onPathPreview = null,
  onBlockPreview = null,
  /** Before a tap opens a sheet or mode: App loads the picked part into the editor. */
  onOpen = null,
  onEnterContourMode = null,
  /** CAD Hole opens the params card, then the plane. Game keeps the helper sheet. */
  onEnterHoleMode = null,
  onEnterFilletMode = null,
  onEnterShellMode = null,
  onEnterDraftMode = null,
  onEnterCutMode = null,
  onEnterBooleanMode = null,
  onEnterMoveMode = null,
  onEnterRotateMode = null,
  onEnterMirrorMode = null,
  onEnterMoveFaceMode = null,
  onEnterDeleteFaceMode = null,
  /** Desktop CAD viewport: stretch the rail under the feature strip with gap-2. */
  desktopFullRail = false,
  /** SCS sheet metal (CAD): opens the material / gauge picker. */
  onOpenSheetMetal = null,
  /** CAD: last Move button. Opens the joint create card. */
  onOpenJoints = null,
  compact = false,
  /** Both layouts share Block / Build / Shape / Polish / Move. */
  layout = 'game',
  /** Reopen this palette item with the feature's saved fields. Confirm edits in place. */
  editSession = null,
  onEditConfirm = null,
  onEditDelete = null,
  onEditCancel = null,
  /** CAD only. True while the helper card is open, so the camera can slide. */
  onHelperCard = null,
  lengthMm = 100,
  bounds = null,
  minExtent = null,
  onMeasure = null,
}) => {
  const grouped = itemsByGroup();
  // Content-height capped just below the part-name chip; narrows when no scroll.
  const { railRef, fits, widthClass } = useLeftRailFit();
  const iconSize = 20;
  const pad = 'p-2';
  const [pending, setPending] = useState(null);
  const [bufferSnapshot, setBufferSnapshot] = useState('');
  const [faceSnapshot, setFaceSnapshot] = useState(null);
  const [edgeSnapshot, setEdgeSnapshot] = useState(null);
  const [modalMode, setModalMode] = useState('default'); // default | params | refuse
  const [refuseMessage, setRefuseMessage] = useState(null);
  const [refuseTitle, setRefuseTitle] = useState(null);
  const onBlockPreviewRef = useRef(onBlockPreview);
  onBlockPreviewRef.current = onBlockPreview;
  const onHelperCardRef = useRef(onHelperCard);
  onHelperCardRef.current = onHelperCard;
  // CAD uses the feature card. Game keeps the docked sheet and does not slide.
  const useCard = layout !== 'game';
  const signalCard = (open) => {
    // Game never opens the card. Closing still clears a flag set in CAD.
    if (open && !useCard) return;
    onHelperCardRef.current?.(!!open);
  };
  // Leaving the rail (another mode mounts over it) must drop the ghost.
  useEffect(() => () => {
    onBlockPreviewRef.current?.(null);
    onHelperCardRef.current?.(false);
  }, []);

  const featureEditOpenRef = useRef(false);
  // Feature edit reuses this sheet. Defaults are the saved block, not the palette's.
  // Clearing the session (Delete confirmed) must close this sheet too.
  useEffect(() => {
    if (!editSession?.helperId) {
      if (!featureEditOpenRef.current) return;
      featureEditOpenRef.current = false;
      setPending(null);
      setFaceSnapshot(null);
      setEdgeSnapshot(null);
      setRefuseMessage(null);
      setRefuseTitle(null);
      setModalMode('default');
      onBlockPreviewRef.current?.(null);
      onHelperCardRef.current?.(false);
      return;
    }
    featureEditOpenRef.current = true;
    const item = HELPER_PALETTE_ITEMS.find((h) => h.id === editSession.helperId);
    if (!item) return;
    const fields = editSession.fields || {};
    setPending({
      ...item,
      _featureEdit: editSession.feature || true,
      params: (item.params || []).map((p) => (
        Object.prototype.hasOwnProperty.call(fields, p.name) ? { ...p, default: fields[p.name] } : p
      )),
    });
    setBufferSnapshot(typeof editSession.script === 'string' ? editSession.script : '');
    setFaceSnapshot(null);
    setEdgeSnapshot(null);
    setRefuseMessage(null);
    setRefuseTitle(null);
    setModalMode('default');
    if (layout !== 'game') onHelperCardRef.current?.(true);
  }, [editSession, layout]);

  const openParams = (item) => {
    // First, so the buffer snapshot, preview and Confirm are all the picked part's.
    onOpen?.(item);
    // Labeled slots with no builder stay a refuse — Sweep is a real contour entry.
    if (item.placeholder) {
      setPending(null);
      setFaceSnapshot(null);
      setEdgeSnapshot(null);
      setRefuseTitle(item.label);
      setRefuseMessage(`${item.label} is not available yet.`);
      setModalMode('refuse');
      signalCard(true);
      return;
    }
    setRefuseTitle(null);
    // Hole is a contour entry so the sketch keeps that id. The card comes first.
    // Game has no card handler and keeps the docked helper sheet.
    if (item.id === 'hole' && typeof onEnterHoleMode === 'function') {
      onEnterHoleMode();
      return;
    }
    if (item.id !== 'hole' && isContourEntry(item.id) && typeof onEnterContourMode === 'function') {
      onEnterContourMode({ entry: item.id });
      return;
    }
    // Slice 27: Fillet enters edge-pick mode even with no prior selection.
    if ((isFilletEntry(item.id) || isChamferEntry(item.id)) && typeof onEnterFilletMode === 'function') {
      onEnterFilletMode({ entry: item.id });
      return;
    }
    // Shell enters face-pick mode (opening face + wall). Axis Opening select
    // was confusing — face pick maps to hollow(..., { center, normal }).
    if (item.id === 'shell' && typeof onEnterShellMode === 'function') {
      onEnterShellMode({ entry: 'shell' });
      return;
    }
    // Draft enters neutral-plane face-pick mode. The pull is the neutral
    // face normal — not a world-axis guess, and not addDraft().
    if (item.id === 'addDraft' && typeof onEnterDraftMode === 'function') {
      onEnterDraftMode({ entry: 'addDraft' });
      return;
    }
    // Cut enters plane + body pick. A face plane stays that face; explicit
    // XY / YZ / ZX is chosen in the chip. Not a world-axis guess.
    if (item.id === 'cut' && typeof onEnterCutMode === 'function') {
      onEnterCutMode({ entry: 'cut' });
      return;
    }
    // Boolean enters body pick. Union, difference, or intersect. Intersect
    // then lists leftover pieces. Not a second tool.
    if (item.id === 'boolean' && typeof onEnterBooleanMode === 'function') {
      onEnterBooleanMode({ entry: 'boolean' });
      return;
    }
    // Move enters body-pick mode. Deltas live on the chip. The axis helper
    // stays a visual AxesHelper — it does not move a body.
    if (item.id === 'move' && typeof onEnterMoveMode === 'function') {
      onEnterMoveMode({ entry: 'move' });
      return;
    }
    // Rotate enters the same body-pick mode: axis, angle, and center live on
    // the chip, and the body turns as a preview until Confirm.
    if (item.id === 'rotate' && typeof onEnterRotateMode === 'function') {
      onEnterRotateMode({ entry: 'rotate' });
      return;
    }
    // Mirror enters the same body-pick mode. The plane is XY, YZ, ZX, a
    // workplane, or a planar face. The copy is a preview until Confirm.
    if (item.id === 'mirror' && typeof onEnterMirrorMode === 'function') {
      onEnterMirrorMode({ entry: 'mirror' });
      return;
    }
    // Move Face offsets picked faces. It is not the body move() helper.
    if (item.id === 'moveFace' && typeof onEnterMoveFaceMode === 'function') {
      onEnterMoveFaceMode({ entry: 'moveFace' });
      return;
    }
    // Delete Face removes picked faces and heals by extending neighbors.
    if (item.id === 'deleteFace' && typeof onEnterDeleteFaceMode === 'function') {
      onEnterDeleteFaceMode({ entry: 'deleteFace' });
      return;
    }
    // Workplane enters plane-only contour mode (Face / construction plane +
    // offset + rotate). Fallback one-shot still wraps strip markers.
    if (item.id === 'workplane') {
      if (typeof onEnterContourMode === 'function') {
        onEnterContourMode({ entry: 'workplane' });
        return;
      }
      onInsert?.('workplane', {}, selectedFace, null);
      return;
    }
    const buf = typeof getBuffer === 'function' ? getBuffer() : '';
    setBufferSnapshot(typeof buf === 'string' ? buf : '');
    // No seed cube: a helper that needs a body is refused on an empty part
    // instead of inventing a hidden 40×30×20 host (bike PR 3).
    if (HELPERS_NEED_BODY.has(item.id) && isBufferEmpty(buf)) {
      setPending(item);
      setFaceSnapshot(null);
      setEdgeSnapshot(null);
      setRefuseTitle('Add a body first');
      setRefuseMessage(`${item.label} needs a body. Insert a Block (cube, cylinder, …) or a Shape (extrude, revolve, …) first, then ${item.label}.`);
      setModalMode('refuse');
      signalCard(true);
      return;
    }
    // Auto-switch to edge pick when opening chamfer/path with no edges yet.
    if ((item.id === 'chamferEdges' || item.id === 'sweepPath')
      && !(selectedEdges && selectedEdges.length)
      && typeof onRequestEdgeMode === 'function') {
      onRequestEdgeMode();
    }
    const resolved = resolveFaceModal(item, selectedFace, selectedEdges);
    if (resolved.mode === 'refuse') {
      setPending(item);
      setFaceSnapshot(resolved.face || null);
      setEdgeSnapshot(resolved.edges || selectedEdges);
      setRefuseMessage(resolved.message);
      setModalMode('refuse');
      signalCard(true);
      return;
    }
    if (resolved.mode === 'params') {
      setPending(resolved.item);
      setFaceSnapshot(resolved.face || null);
      setEdgeSnapshot(resolved.edges || selectedEdges);
      setRefuseMessage(null);
      setModalMode('params');
      signalCard(true);
      return;
    }
    setPending(item);
    setFaceSnapshot(null);
    setEdgeSnapshot(null);
    setRefuseMessage(null);
    setModalMode('default');
    signalCard(true);
  };

  const close = () => {
    setPending(null);
    setFaceSnapshot(null);
    setEdgeSnapshot(null);
    setRefuseMessage(null);
    setRefuseTitle(null);
    setModalMode('default');
    onProfilePreview?.(null);
    onPathPreview?.(null);
    onBlockPreview?.(null);
    signalCard(false);
  };

  const sections = paletteRailSections(layout, grouped).map((section) => ({
    key: section.key,
    label: GROUP_SHORT_LABEL[section.key] || section.key,
    section: section.key.toLowerCase(),
    items: section.items,
  }));

  return (
    <>
      <div
        ref={railRef}
        className={`absolute left-2 lg:left-4 z-10 flex flex-col gap-1
          bg-white/60 backdrop-blur-sm rounded-lg shadow-lg
          ${widthClass} ${leftRailPositionClasses({ desktopFull: desktopFullRail })}
          p-2`}
        role="group"
        aria-label="Helper insert palette"
        data-rail-pair="left"
        data-rail-height={desktopFullRail ? RAIL_DESKTOP_FULL_ATTR : RAIL_PAIR_HEIGHT_ATTR}
        data-rail-fit={fits ? 'fits' : 'scroll'}
        data-palette-layout={layout === 'cad' ? 'cad' : 'game'}
      >
        {sections.map((section, gi) => (
          <div
            key={section.key}
            className="flex flex-col gap-0.5"
            data-palette-section={section.section}
          >
            {gi > 0 && (
              <div className="border-t border-gray-300/70 my-0.5 mx-0.5" aria-hidden />
            )}
            <div
              className={`text-[9px] font-semibold uppercase tracking-wide text-gray-500 px-1 truncate ${
                compact ? 'leading-3' : 'leading-4'
              }`}
            >
              {section.label}
            </div>
            {section.items.map((item) => {
              const Icon = ICONS[item.id] || Box;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openParams(item)}
                  title={item.title}
                  aria-label={
                    item.placeholder
                      ? `${item.label} placeholder: ${item.title}`
                      : `Insert ${item.label}: ${item.title}`
                  }
                  className={`${pad} rounded text-blue-700 hover:bg-blue-100 active:bg-blue-200
                    flex items-center justify-center transition-colors`}
                  data-ui-action={item.id}
                >
                  <Icon size={iconSize} strokeWidth={2} />
                </button>
              );
            })}
            {section.section === 'shape' && onOpenSheetMetal && (
              <button
                type="button"
                onClick={() => onOpenSheetMetal()}
                title="Sheet Metal — design against SendCutSend stock"
                aria-label="Sheet Metal: pick SendCutSend material and gauge"
                data-sheet-metal-button="1"
                data-ui-action="data-sheet-metal-button"
                className={`${pad} rounded text-blue-700 hover:bg-blue-100 active:bg-blue-200
                    flex items-center justify-center transition-colors`}
              >
                <SheetMetalPlate size={iconSize} strokeWidth={2} data-sheet-metal-icon="" />
              </button>
            )}
            {section.section === 'transforms' && onOpenJoints && (
              <button
                type="button"
                onClick={() => onOpenJoints()}
                title="Joints"
                aria-label="Joints"
                data-joints-button="1"
                data-ui-action="data-joints-button"
                className={`${pad} rounded text-blue-700 hover:bg-blue-100 active:bg-blue-200
                    flex items-center justify-center transition-colors`}
              >
                <Blocks size={iconSize} strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
      </div>

      {modalMode === 'refuse' && refuseMessage && (
        <HelperParamModal
          item={null}
          refuseMessage={refuseMessage}
          refuseTitle={refuseTitle}
          onCancel={close}
          useCard={useCard}
          compact={compact}
        />
      )}

      {pending && modalMode !== 'refuse' && (
        <HelperParamModal
          item={pending}
          useCard={useCard}
          compact={compact}
          onDelete={pending?._featureEdit ? onEditDelete : null}
          buffer={bufferSnapshot}
          faceInfo={faceSnapshot}
          edgeInfo={edgeSnapshot}
          lengthMm={lengthMm}
          bounds={bounds}
          minExtent={minExtent}
          onMeasure={onMeasure}
          onCancel={() => {
            if (pending?._featureEdit) onEditCancel?.();
            close();
          }}
          onValuesChange={(values, item) => {
            if (isBlockSolidId(item?.id)) {
              onProfilePreview?.(null);
              onPathPreview?.(null);
              if (!blockParamsPending(values)) onBlockPreview?.({ id: item.id, params: values });
              return;
            }
            onBlockPreview?.(null);
            if (item?.id === 'crossSection') {
              onPathPreview?.(null);
              onProfilePreview?.({
                face: faceSnapshot,
                params: values,
              });
              return;
            }
            if (item?.id === 'sweepPath') {
              onProfilePreview?.(null);
              onPathPreview?.({
                edges: edgeSnapshot,
                params: values,
              });
              return;
            }
            // Fillet Strategy=sweep (default / auto→sweep) → same path preview as Path.
            if (
              item?.id === 'filletEdges'
              && resolveFilletStrategy(values?.strategy, edgeSnapshot) === 'sweep'
            ) {
              onProfilePreview?.(null);
              onPathPreview?.({
                edges: edgeSnapshot,
                params: values,
              });
              return;
            }
            onProfilePreview?.(null);
            onPathPreview?.(null);
          }}
          onConfirm={(params) => {
            const id = pending.id;
            const faceCtx = faceSnapshot;
            const edgeCtx = edgeSnapshot;
            const isEdgeFeature = id === 'filletEdges' || id === 'chamferEdges';
            const isSweepPath = id === 'sweepPath';
            const scope = params?.edgeScope
              || (edgeCtx && edgeCtx.length ? 'selected' : (faceCtx ? 'face' : 'allConvex'));
            // Soft-fail: selected-edge scope with no edges — clear + prompt, never emit JS.
            if (isEdgeFeature && scope === 'selected' && !(edgeCtx && edgeCtx.length)) {
              close();
              onStaleEdgesClear?.(
                'No edges selected — re-pick after geometry changes, then Fillet/Chamfer.',
              );
              return;
            }
            if (isSweepPath && !(edgeCtx && edgeCtx.length)) {
              close();
              onStaleEdgesClear?.(
                'No edges selected — re-pick a contiguous chain or loop, then Path.',
              );
              return;
            }
            // Fillet Strategy=sweep (default / auto→sweep) soft-fails like Path.
            if (id === 'filletEdges' && resolveFilletStrategy(params?.strategy, edgeCtx) === 'sweep') {
              const gate = canBuildFilletAlongPath(edgeCtx);
              if (!gate.ok) {
                close();
                onStaleEdgesClear?.(gate.message);
                return;
              }
            }
            if (pending?._featureEdit) {
              const kept = onEditConfirm?.({
                feature: pending._featureEdit === true ? null : pending._featureEdit,
                fields: params,
              });
              if (kept === false) return;
              close();
              return;
            }
            close();
            onInsert?.(id, params, faceCtx, edgeCtx);
          }}
        />
      )}
    </>
  );
};

export default HelperInsertPalette;
