// components/Viewport.jsx
/* eslint-disable react-hooks/exhaustive-deps -- legacy: deps arrays below are tuned for
   three.js render-loop stability (scene/camera/controls live in refs); adding the flagged
   refs would rebind listeners/materials per render. Revisit deliberately, not via lint. */
import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  Scene,
  PerspectiveCamera,
  PointLight,
  Mesh as ThreeMesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
  ExtrudeGeometry,
  Shape,
  Quaternion,
  BufferGeometry,
  BufferAttribute,
  Raycaster,
  Vector2,
  Vector3,
  Vector4,
  Matrix4,
  Triangle,
  LineSegments,
  EdgesGeometry,
  Line,
  LineBasicMaterial,
  ShaderMaterial,
  FrontSide,
  SphereGeometry,
  Group,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Color,
  Box3,
} from 'three';
import {
  BLOCK_PREVIEW_EDGE_ANGLE,
  makeBlockPreviewSkinMaterial,
  makePreviewSkinMaterial,
  makePreviewOutlineMaterial,
  PREVIEW_COLORS,
  PREVIEW_OPACITY,
  PREVIEW_RENDER_ORDER,
} from '../utils/previewStyle';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { fillAgentHost } from '../agent/host';
import {
  allowFeaturePopup,
  featurePopupAllowed,
  registerFeaturePopupDismiss,
  setAuthorizedFeatureEdit,
} from '../agent/agentFeaturePopupGate.js';
import { encodeCanvasImage } from '../agent/screenshotImage';
import { kernelExceptionDetail } from '../agent/state/formatErrors';
import { kernelCrashRecord } from '../workers/kernelCrash.js';
import { viewportToastRows } from '../agent/state/toasts';
import { buildAgentMode } from '../agent/state/mode';
import { buildCameraState } from '../agent/state/camera';
import { buildSelection } from '../agent/state/selection';
import { applyTrackballFeel, trackballRotateSpeedForPointer } from '../utils/trackballFeel';
import { installPageZoomLock } from '../utils/pageZoomLock';
import { readViewportContainerSize, resizeViewportRenderer } from '../utils/viewportResize';
import {
  createViewportWebGLRenderer,
  disposeViewportRenderer,
  installWebglContextLossHandlers,
  WebGLUnavailableNotice,
} from '../utils/viewportWebgl.js';
import { installViewportGestureZoom } from '../utils/viewportGestureZoom';
import { formatDisplayNumber } from '../utils/displayUnit';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import Toolbar from './Toolbar';
import PuzzleUnlock from './PuzzleUnlock';
import { BrandHeaderMark } from './brand/BrandWordmark';
import AboutModal from './AboutModal';
import ProfileChip from './ProfileChip';
import CrossSectionPanel from './CrossSectionPanel';
import HelperInsertPalette from './HelperInsertPalette';
import HoleCard from './HoleCard';
import ErrorPopup from './ErrorPopup';
import { FeatureDeleteConfirm, FeatureDeleteToast } from './FeatureEditDelete';
import ContourModeRail from './ContourModeRail';
import ContourModeChip from './ContourModeChip';
import ContourEditBar from './ContourEditBar';
import ContourDeleteDialog from './ContourDeleteDialog';
import FeatureSlotCard from './FeatureSlotCard';
import FeatureSheet from './FeatureSheet';
import FeatureEditSheet from './FeatureEditSheet';
import FilletModeChip from './FilletModeChip';
import MeasureModeChip from './MeasureModeChip';
import ShellModeChip from './ShellModeChip';
import { PaintModeChip } from './PaintModeChip';
import { FeaStudyHost } from './fea/FeaStudyHost';
import { getProbeOverlay, subscribeProbeOverlay } from '../fea/probeOverlay.js';
import SheetMetalPicker from './sheetMetal/SheetMetalPicker';
import SheetMetalRail from './sheetMetal/SheetMetalRail';
import SheetMetalFlow from './sheetMetal/SheetMetalFlow';
import {
  baseDraftSpec,
  draftPreviewSpec,
  editSheetChip,
  enterSheetMetalMode,
  pushSheetHistory,
  reopenSheetMetalMode,
  setSheetTool,
  sheetDoneSpec,
  sheetHolesFromSketch,
  sheetPanelFrame,
  sheetTap,
  sheetToolsFor,
} from '../utils/sheetMetal/sheetMetalMode';
import { readSheetMetalSpec } from '../utils/sheetMetal/sheetMetalScript';
import { sheetRibbonChips } from '../utils/sheetMetal/sheetRibbon';
import { parseFeatureMarkers } from '../utils/featureMarkers';
import { buildSheetOverlay, disposeSheetOverlay, sheetPickFromHits, syncSheetEdgeLineResolution } from '../utils/sheetMetal/sheetOverlay';
import { referencePickEdges, sheetContourEdges, sheetSpecInScript } from '../utils/sheetMetal/sheetContourEdges';
import { ensureBodyMaterial } from '../utils/sheetMetal/sheetMaterial';
import { createSheetAgentHandlers } from '../agent/sheetAgentHost.js';
import { createPaintMeasureAgentHandlers } from '../agent/paintMeasureAgentHost.js';
import { createFeaAgentHandlers } from '../agent/feaAgentHost.js';
import { createXsectionAgentHandlers } from '../agent/xsectionAgentHost.js';
import { makeDefaultPartMaterial } from '../utils/partMaterial';
import DraftModeChip from './DraftModeChip';
import CutModeChip from './CutModeChip';
import BooleanModeChip from './BooleanModeChip';
import MoveModeChip from './MoveModeChip';
import RotateModeChip from './RotateModeChip';
import MirrorModeChip from './MirrorModeChip';
import MoveFaceModeChip from './MoveFaceModeChip';
import DeleteFaceModeChip from './DeleteFaceModeChip';
import { buildCrossSectionPreview, defaultTopPlaneFrame } from '../utils/crossSectionSubstrate';
import {
  clearCrossSectionOnMesh,
  collectCrossSectionTargets,
  crossSectionPlaneKey,
  isAssemblyCrossSectionScope,
  summarizeCrossSection,
} from '../utils/crossSectionView.js';
import {
  beginSectionClip,
  endSectionClip,
  nextSectionSpec,
  SECTION_PLANE_COLOR,
  sectionClipSession,
  syncSectionClipMeshes,
} from '../utils/sectionClip.js';
import { setFailedPartOutline } from '../utils/failedPartOutline';
import {
  directionToPartLocal,
  overlayHitPartId,
  partOverlayPose,
  partOverlaySources,
  toPartLocal,
} from '../utils/partOverlays';
import { applyPartPose } from '../utils/partPose';
import {
  applySavedContour,
  listConstructionPlanes,
  resolveConstructionPlane,
  listSavedContours,
  pickContourByRay,
  savedContourRings,
  withAutoPickedContour,
} from '../utils/savedContours';
import { shouldClearViewportScript } from '../utils/helperPaletteSnippets';
import { rollbackClearsPart } from '../utils/featureSkip';
import { hasNamedContour, mintContourIdentity } from '../utils/namedContour';
import { contourFeatureUsers, contourUsedByText, deleteContourStatement } from '../utils/contourUsers';
import {
  addFeatureStation,
  assignFeatureSlot,
  emptyFeatureSlotCard,
  featureSlotCardFromEdit,
  buildFeatureSlotPreview,
  featureSlotCommitPayload,
  featureSlotGhostId,
  featureSlotReady,
  clearFeatureSlotRefs,
  removeFeatureStation,
  renameFeatureSlotRefs,
  setFeatureStationOffset,
} from '../utils/featureSlotCard';
import {
  blockGeomKey,
  blockParamsPending,
  blockSpec,
  isBlockSolidId,
} from '../utils/blockSolid';
import {
  addLoftProfile,
  armLoftStationPlanePick,
  buildContourPreview,
  buildExtrudeSolidPreview,
  buildLoftSolidPreview,
  buildRevolveSolidPreview,
  buildSweepSolidPreview,
  activeContourFace,
  contourWorkplaneFace,
  contourWorkplane,
  applyContourPlaneEdit,
  axisPresetFrame,
  contourHostCenter,
  cursorSketchEmpty,
  enterContourState,
  intersectRayPlane,
  isExtrudeEntry,
  isHoleEntry,
  isLoftEntry,
  isRevolveEntry,
  isSolidContourEntry,
  isSweepEntry,
  isWorkplaneEntry,
  planeCardCommit,
  planeFromContourFace,
  removeLoftProfile,
  resolveContourWorkplane,
  clearLoftStationPlane,
  selectedLoftDrawFrame,
  setLoftStationPlane,
  resolveExtrudeAxis,
  resolveRevolveAxis,
  selectLoftProfile,
  setLoftProfileOffset,
  switchContourTool,
  toolToProfileParams,
  validateContourProfile,
  validateExtrudeParams,
  validateLoftProfiles,
  validateRevolveParams,
  validateSweepPath,
  worldToPlaneUV,
  writeLoftSelected,
  applyContourPick,
  armContourGesture,
  previewContourDimension,
  removeContourConstraint,
  removeContourDimension,
  removeContourRef,
  saveContourArc,
  saveContourConstraint,
  saveContourDimension,
} from '../utils/contourMode';
import {
  defaultHoleCard,
  holeCardFromSpec,
  holeCentresSketch,
  holeSketchContour,
  holeSpecFromCard,
  materializeHoleRectangleCenters,
} from '../utils/holeCard';
import { readCentersContour, readContourHole } from '../utils/holeContour';
import { SKETCH_HIT_PX, anchorOnEntity, pickContourScreen, planeUvToWorld } from '../utils/contourPick';
import {
  CONTOUR_REF_COLOR,
  edgeReferenceHit,
  faceOutlineHit,
  materializeReference,
  referenceEdgesForPart,
  referencePaintSegments,
  referencePickAllowed,
  vertexHit,
} from '../utils/contourRefPick';
import { resolveContourScript } from '../utils/contourRefResolve';
import { beginConstraintEdit, beginDimensionEdit, promoteContourState } from '../utils/contourGesture';
import { applySketchConstrain, applySketchDimension } from '../agent/sketchGestureAgent.js';
import { contourChips, deleteContourEntity } from '../utils/contourStrip';
import { entityDeleteChip, selectSketchChip, sketchActiveId, sketchHighlightPicks } from '../utils/contourSketchStrip';
import { localPoint, worldPoint } from '../utils/partPose';
import {
  CONTOUR_IDLE_COLOR,
  CONTOUR_PICK_COLOR,
  CONTOUR_STATUS_COLOR,
  contourEntityColor,
  contourPaintModel,
  highlightContourPaint,
  savedContourStatus,
} from '../utils/contourStatus';
import {
  applyDraggedContour,
  applyPolylineSegmentInsert,
  clearPolylineShape,
  contourPointDragAllowed,
  contourShapeDragAllowed,
  dragContourPoint,
  dragContourShape,
  dragSketchParam,
  dragSketchShape,
  insertContourPoint,
  isPolylineDot,
  isPolylineDoubleTap,
  planContourDragRelease,
  planPolylinePointRemoval,
  POLYLINE_SAME_TAP_MS,
  segmentForSnap,
  sketchHandles,
  sketchSegments,
  sketchShapeAt,
} from '../utils/contourDrag';
import ContourEntityCard from './ContourEntityCard';
import {
  applyContourSnap,
  contourSnapAllowed,
  placeSnappedContourPoint,
  promoteDrawnSnap,
  promoteSnappedPolyline,
  referenceSnapHits,
  snapContourPoint,
} from '../utils/contourSnap';
import ContourGestureCard from './ContourGestureCard';
import ContourStatusLegend from './ContourStatusLegend';
import ContourTags from './ContourTags';
import {
  holdContourOverlays,
  holdJointPlanes,
  releaseContourOverlays,
  releaseJointPlanes,
  useTemporaryVisibility,
} from '../hooks/useTemporaryVisibility';
import {
  CONSTRUCTION_PLANE_SIZE,
  planeReferenceKey,
  planesForJointOverlay,
  planesForWorkplaneTool,
} from '../utils/jointPlanes';
import { buildSweepPathPreview } from '../utils/edgeSweepPath';
import {
  buildFilletBlendPreview,
  enterFilletState,
  enterChamferState,
  validateFilletAccept,
  validateChamferAccept,
  defaultFilletRadius,
  solidMinExtent,
  hasFilletModeBlock,
  hasChamferModeBlock,
  filletAccumulationFor,
} from '../utils/filletMode';
import {
  applyContourEditSeed,
  contourFieldsFromState,
  creationDialogFor,
  editPreviewScript,
  featureDeletePlan,
  openFeatureEdit,
  partDeclarationDeletePlan,
} from '../utils/featureEdit';
import {
  enterShellState,
  validateShellAccept,
  normalizeShellParams,
  toggleShellFaceSelection,
  popLastShellFace,
} from '../utils/shellMode';
import {
  emptyDraftState,
  applyDraftFaceTap,
  popLastDraftFace,
  clearDraftFaces,
  setDraftAngle,
  setDraftFlip,
  validateDraftAccept,
} from '../utils/draftMode';
import {
  emptyCutState,
  applyCutTap,
  popLastCutPick,
  clearCutPicks,
  setCutPlaneSource,
  setCutOriginOffset,
  setCutPickTarget,
  cutPlaneFromState,
  validateCutAccept,
  meshBodyComponents,
  bodyContainingTriangle,
  classifyCutBody,
  trianglePieceSide,
  cutBodyKey,
  cutPointsMatch,
  CUT_PIECE_COLORS,
  CUT_PIECE_OPACITY,
} from '../utils/cutMode';
import {
  emptyBooleanState,
  applyBooleanTap,
  popLastBooleanPick,
  clearBooleanPicks,
  setBooleanOp,
  setBooleanPickTarget,
  booleanOp,
  booleanSlot,
  booleanPieceHidden,
  validateBooleanAccept,
  noteBooleanPartHidden,
  booleanPicksInOrder,
  booleanPreviewRequest,
  BOOLEAN_PIECE_COLORS,
} from '../utils/booleanMode';
import {
  emptyMoveState,
  clearMoveTarget,
  validateMoveAccept,
  movePreviewOffset,
  resolveMoveBodyAt,
  snapMoveBodyAt,
  seedMoveDeltasFromLastMove,
  attachMoveTargetMesh,
  cutNormalFromScript,
  MOVE_MODE_NEED_BODY,
} from '../utils/moveMode';
import {
  emptyRotateState,
  clearRotateTarget,
  validateRotateAccept,
  rotatePreviewMap,
  resolveRotateBodyAt,
  seedRotateFromLastRotate,
  attachRotateTargetMesh,
  axisToVector,
  ROTATE_MODE_NEED_BODY,
} from '../utils/rotateMode';
import {
  emptyMirrorState,
  clearMirrorTarget,
  validateMirrorAccept,
  mirrorPreviewMap,
  resolveMirrorBodyAt,
  attachMirrorTargetMesh,
  setMirrorNamedPlane,
  setMirrorFacePlane,
  setMirrorWorkplane,
  mirrorPlaneFromHit,
  mirrorSelectedPlaneId,
  mirrorStateFromFields,
  MIRROR_MODE_NEED_BODY,
} from '../utils/mirrorMode';
import {
  emptyMoveFaceState,
  toggleMoveFaceSelection,
  popLastMoveFace,
  clearMoveFaces,
  setMoveFaceDistance,
  setMoveFaceFlip,
  validateMoveFaceAccept,
} from '../utils/moveFaceMode';
import {
  emptyDeleteFaceState,
  toggleDeleteFaceSelection,
  popLastDeleteFace,
  clearDeleteFaces,
  validateDeleteFaceAccept,
} from '../utils/deleteFaceMode';
import {
  PREWARM_MAX_TRIS,
  cachedSolidGeometry,
  contactSeamFor,
  createSolidCache,
  contourBoundariesFor,
  featureGraphFor,
  pruneSolidCacheIn,
  releaseGeometryIn,
  solidCacheStats,
  liveSolidEntryForGeometry,
  solidEntryForGeometry,
} from '../utils/partSolidCache';
import {
  characteristicLengthMm,
  forgetCharacteristicLength,
  rememberCharacteristicLength,
} from '../utils/characteristicLength';
import { faceSliderFrame } from '../utils/helperSheetRange';
import {
  directionOffscreenMm,
  moveFaceRange,
  scaleFreshContour,
  shellWallRange,
} from '../utils/sliderRange';
import {
  FACE_HIGHLIGHT_RENDER_ORDER,
  detachFaceColorSkin,
  readFaceColorDebugFlag,
  setFaceColorSkinVisible,
  syncFaceColorSkin,
} from '../utils/faceColorSkin';
import { paintFeaContactHighlights } from '../fea/contactHighlight';
import { syncFeaFaceHighlights } from '../fea/faceHighlight';
import { detachStressSkin, subscribeStressSkin, syncFeaStressSkins, syncStressSkin } from '../fea/stressSkin';
import { dropPlanarFins, highlightBoundaryPositions } from '../utils/planarSeam';
import { classifySelectedFace } from '../utils/faceFeaturePlacement';
import { classifyFilletEdges, countDegenerateTriangles } from '../utils/filletEdgeClass';
import {
  pickNearestEdgeScreen,
  propagateTangentEdges,
  resolveEdgePickSlopPx,
  EDGE_FILLET_HIT_RADIUS_PX,
  toggleEdgeSelectionPropagated,
  popLastEdgeSelection,
  selectionEdgeKey,
  projectWorldToCanvas,
  distPointToSegment2D,
  edgeTrackPoint,
  edgePolyline,
} from '../utils/selectEdge';
import {
  applyActivePartAnchor,
  resolveActivePartOverlay,
  shiftLocalPoint,
} from '../utils/activePartOverlay';
import {
  emptyClickClearsSelection,
  featureHideKeepsPicks,
  resolvePartPick,
  shouldSyncScript,
} from '../utils/pickRetarget';
import { fitJointAxis } from '../utils/jointResolve';
import { jointHighlightSlot } from '../joints/jointUi';
import {
  activePartEdges,
  edgePartId,
  foreignPartEdgeGroups,
  groupEdgesByPart,
  partEdgeParams,
  planMultiPartEdgeAccept,
  retargetKeepsEdgePicks,
} from '../utils/multiPartEdges';
import {
  stampBoundaryOnSelection,
  filletOverlayTargets,
} from '../utils/boundaryEdgeIds';
import { get3MFBase64FromMesh } from '../utils/exportModel';
import { missingMeshMessage, resolvePartMeshes } from '../utils/meshAssets';
import { calculateQuote } from '../utils/quoting';
import { resolveViewportFaceClick, selectGraphFace, warmFaceGraph } from '../utils/selectFace';
import { listDroppedFacePaints } from '../utils/faceColorMatch';
import {
  fingerprintsFromGeometry,
  PAINT_DOUBLE_TAP_MS,
  PAINT_SWATCHES,
  clonePaintSession,
  livePaintChanged,
  livePaintClear,
  livePaintPart,
  livePaintTap,
  livePaintUndo,
  livePaintUnmatched,
  paintKeysForTriangles,
  paintPickFromClick,
  paintPicksAfterMeshChange,
  paintPicksAfterPartChange,
  colorEntryForPlacement,
  resolvedPaintColor,
  unmatchedColorCount,
} from '../utils/facePaint';
import { formatViewerTitle, sanitizePartName } from '../utils/assembly.js';
import { createCuttingPlaneWidget, disposeCuttingPlaneWidget, syncSectionPreview, updateCuttingPlaneWidget } from '../utils/cuttingPlaneWidget';
import { AxesHelper } from 'three';
import { applyTriadAxisColors } from '../utils/triadAxis';
import { createDeltaLines, disposeMeasurementLines } from '../utils/measurementTool';
import {
  boundsOfTriangles,
  buildEdgeMeasurePick,
  buildFaceMeasurePick,
  buildPartMeasurePick,
  buildPointMeasurePick,
  classifyMeasurePointer,
  measureAnchor,
  measureChainIsCircular,
  measurePointerOnEdge,
  measureSeedFromSelection,
  pointSegmentDistance,
  segmentParameter2D,
  toggleMeasurePick,
  triangleGroupStats,
} from '../utils/measurePicks';
import {
  animateCameraPose,
  applyCameraPose,
  fitView,
  meshWorldBox,
  MODEL_VIEWS,
  modelViewPreset,
  unionWorldBox,
  VIEW_PRESETS,
  VIEW_SNAP_MARGIN,
} from '../utils/viewCamera';
import { expandResolvedEdgesForHelper } from '../agent/expandEdgeSelection.js';
import { resolveEdgeKeys, resolveFaceKeys } from '../agent/resolvePickIds.js';
import { ambiguousFaceError } from '../agent/pick/candidates.js';
import { createViewportPickHost } from '../agent/pick/viewportPicks.js';
import { createSketchPickHandlers } from '../agent/pick/sketchViewportPicks.js';
import { planePatchFromArgs } from '../agent/sketchPlaneAgent.js';
import { buildEdgeList, buildFaceList, buildNamedEdgeList } from '../agent/state/listPickables.js';
import { describeJointPick } from '../agent/jointPickDescribe.js';
import { agentFaceCatalog, findAgentFace } from '../agent/faceCatalog.js';
import {
  poseAgentCatalog,
  poseEdgeRecord,
  poseFaceRecord,
  transformPoint,
} from '../utils/rigidSuffix.js';
import { describeFaceTable, edgeNamesForPicks, resolveEdgeNames, resolveFaceNames, stampedFaceTable, stampedNameForTriangles } from '../utils/faceIdentity.js';
import { dropMoldJobs, dropWallJobs, requestMoldAnalysis, requestWallField } from '../molding/wallFieldClient.js';
import { MOLD_PULL_PLANES, unitPull } from '../molding/pullReference.js';
import { thicknessLegendModel } from '../molding/thicknessColor.js';
import { detachThicknessSkin, syncThicknessSkin } from '../molding/thicknessSkin.js';
import { detachPartingSkin, syncPartingSkin } from '../molding/partingSkin.js';
import { splitLegendModel } from '../molding/sideActions.js';
import { detachSideActionSkin } from '../molding/sideActionSkin.js';
import { moldDraftLegendModel } from '../molding/moldDraft.js';
import { detachMoldDraftSkin, syncMoldDraftSkin } from '../molding/moldDraftSkin.js';
import { dfmReport } from '../molding/dfmReport.js';
import { heuristicFillFlags, studyStiffnessHint, suggestResins } from '../molding/resinSuggest.js';
import { fetchMoldingResinLibrary } from '../utils/moldingResinLibraryClient.js';
import { boundsFromPositions, postMoldingQuote, quoteBodyFromAnalysis } from '../utils/moldingQuoteClient.js';
import { PAY_FOR_REVIEW_MESSAGE, checkoutUrlAllowed, clearReviewLabel, leadBody, partnerUnlocked, pollReviewStatus, postMoldingLead, postReviewCheckout, readReviewLabel, rememberReviewLabel } from '../utils/moldingLeadClient.js';
import WallLegend from './molding/WallLegend';
import PartingLegend from './molding/PartingLegend';
import MoldDraftLegend from './molding/MoldDraftLegend';
import DfmReportPanel from './molding/DfmReportPanel';
import MoldQuotePanel from './molding/MoldQuotePanel';
import PullReference from './molding/PullReference';
import MoldResultsPane from './molding/MoldResultsPane';
import MoldProgress from './molding/MoldProgress';
import { annotateFeatureEdges } from '../utils/boundaryEdgeIds.js';
import { buildFeatureEdges } from '../utils/selectEdge.js';
import { featureBlockText, listFeatureSheetTargets } from '../utils/featureSheetWriteback';
import {
  boxCornerPoints,
  createSheetCameraSession,
  featureSheetClearanceNdc,
  featureSheetCoveredFraction,
} from '../utils/featureSheetCamera';
import { createFaceSketchAim, sketchAimBox } from '../utils/faceSketchCamera';
import {
  makeSketchLine,
  sketchPointScaleFromDistance,
  SKETCH_POINT_RADIUS,
} from '../utils/sketchLine';
import { emptySketchHistory, observeSketchEdit, undoSketchEdit } from '../utils/contourSketchHistory';

import { validateScript, formatValidationErrors } from '../utils/scriptValidator';
import manifoldContext from '../utils/ManifoldWorker';
import { formatGameTime } from '../utils/gamePuzzle';

/**
 * Screen-space fat-line widths (WebGL ignores LineBasicMaterial.linewidth > 1).
 * Thinned from the playtest orange (core 4 / halo 14, halo opacity cap 0.38)
 * so a selected silhouette stays readable on the solid. Hit slop is unchanged.
 */
const EDGE_CORE_PX = 2.5;
const EDGE_HALO_PX = 8;
const EDGE_HOVER_CORE_PX = 2;
const EDGE_HOVER_HALO_PX = 6;
/** Selection core opacity. Was 1 (fully opaque orange). */
const EDGE_SELECT_OPACITY = 0.72;

/** Free sketch handles. Same blue as a solver-free degree of freedom. */
const POLYLINE_POINT_COLOR = CONTOUR_STATUS_COLOR.under;
const POLYLINE_POINT_HOVER_COLOR = 0xfbbf24;
const POLYLINE_POINT_DRAG_COLOR = 0xf97316;
/** Handle scale targets; the render loop eases toward these (never snaps). */
const POLYLINE_POINT_SCALE = 1;
const POLYLINE_POINT_HOVER_SCALE = 1.5;
const POLYLINE_POINT_DRAG_SCALE = 1.9;

/** Screen-facing f{id} / e{id} chip. depthTest off so it stays readable on the part. */
function makeFilletIdSprite(text, worldH) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 192, 96);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(8, 12, 176, 72);
  ctx.fillStyle = text.startsWith('e') ? '#bbf7d0' : '#7dd3fc';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 96, 50);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new SpriteMaterial({
    map: tex,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(worldH * 2, worldH, 1);
  sprite.renderOrder = 30;
  sprite.frustumCulled = false;
  sprite.raycast = () => {};
  return sprite;
}

/** Small numbered disc for an Analyze probe. The sphere takes the tap. */
function makeProbeNumberSprite(text, worldH) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 47, 73, 0.92)';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#67e8f9';
  ctx.stroke();
  ctx.fillStyle = '#ecfeff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new SpriteMaterial({
    map: tex,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(worldH, worldH, 1);
  sprite.renderOrder = 29;
  sprite.frustumCulled = false;
  sprite.raycast = () => {};
  return sprite;
}

function disposeProbeGroup(group) {
  if (!group) return;
  group.parent?.remove(group);
  group.traverse((child) => {
    if (child === group) return;
    child.geometry?.dispose?.();
    const mat = child.material;
    if (mat?.map) mat.map.dispose();
    if (Array.isArray(mat)) mat.forEach((item) => item?.dispose?.());
    else mat?.dispose?.();
  });
}

/** Dispose LineSegments2 Group (halo+core) or legacy LineSegments. */
function disposeEdgeOverlayObject(scene, obj) {
  if (!obj) return;
  // scene.remove misses an overlay that was reparented (paintEdgeLines adds
  // to the scene, then a ghost group adopts the lines). The old lines stay
  // in that group and the next solve paints another copy.
  if (typeof obj.removeFromParent === 'function') obj.removeFromParent();
  else scene?.remove(obj);
  const disposeOne = (node) => {
    try { node.geometry?.dispose?.(); } catch { /* already disposed */ }
    const mat = node.material;
    try {
      if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
      else mat?.dispose?.();
    } catch { /* a shared preview material disposes once */ }
  };
  if (typeof obj.traverse === 'function') {
    obj.traverse((child) => {
      if (child !== obj) disposeOne(child);
    });
  }
  disposeOne(obj);
}

const SKETCH_PREVIEW_NAMES = new Set([
  'crossSectionPreview',
  'contourExtrudePreview',
  'contourExtrudePreviewGroup',
  'contourRevolvePreview',
  'contourRevolvePreviewGroup',
  'contourLoftPreview',
  'contourLoftPreviewGroup',
  'contourSweepPreview',
  'contourSweepPreviewGroup',
]);

const SKETCH_HIGHLIGHT_NAMES = new Set([
  'highlight',
  'edgeSelection',
  'edgeSelectionOtherPart',
  'edgeHover',
  'contourSelected',
]);

const SKETCH_WIRE_NAMES = new Set([
  'contourStatusWire',
  'contourRefWire',
  'contourPolylineDraft',
]);

/** Drop named overlays. A child whose parent is also named is disposed with that parent. */
function dropNamedOverlays(scene, names) {
  if (!scene || !names?.size) return;
  const doomed = [];
  scene.traverse((obj) => {
    if (obj?.name && names.has(obj.name)) doomed.push(obj);
  });
  const doomedSet = new Set(doomed);
  for (const obj of doomed) {
    let parent = obj.parent;
    let nested = false;
    while (parent) {
      if (doomedSet.has(parent)) {
        nested = true;
        break;
      }
      parent = parent.parent;
    }
    if (!nested) disposeEdgeOverlayObject(scene, obj);
  }
}

/** Assembly pose is on the mesh, not in the script. Overlays and picks apply it. */
function solidPlacement(solid) {
  if (solid?.placement?.t && solid?.placement?.q) return solid.placement;
  const p = solid?.position || [0, 0, 0];
  return { t: p, q: [0, 0, 0, 1] };
}

function meshPose(mesh) {
  if (!mesh?.position) return null;
  const p = mesh.position;
  const q = mesh.quaternion;
  const t = [p.x || 0, p.y || 0, p.z || 0];
  const quat = q ? [q.x || 0, q.y || 0, q.z || 0, q.w ?? 1] : [0, 0, 0, 1];
  const moved = t[0] !== 0 || t[1] !== 0 || t[2] !== 0;
  const rotated = Math.hypot(quat[0], quat[1], quat[2]) > 1e-12;
  if (!moved && !rotated) return null;
  return { t, q: quat };
}

function shiftEdgeForWorld(edge, mesh) {
  const pose = meshPose(mesh);
  if (!pose || !edge) return edge;
  const s = (v) => (v ? shiftLocalPoint(v, pose.t, pose.q) : v);
  return { ...edge, va: s(edge.va), vb: s(edge.vb), mid: s(edge.mid) };
}

/** Sheet pick segments follow the part pose. Normals rotate; positions shift. */
function orientPickEdge(edge, mesh) {
  const shifted = shiftEdgeForWorld(edge, mesh);
  const pose = meshPose(mesh);
  if (!pose || !edge) return shifted;
  const spin = (normal) => {
    if (!normal) return normal;
    const origin = shiftLocalPoint([0, 0, 0], pose.t, pose.q);
    const tip = shiftLocalPoint(normal, pose.t, pose.q);
    return [tip[0] - origin[0], tip[1] - origin[1], tip[2] - origin[2]];
  };
  return { ...shifted, n0: spin(edge.n0), n1: spin(edge.n1) };
}

function geometryFromMeshData(meshData) {
  const geometry = new BufferGeometry();
  const np = meshData.numProp || 3;
  const src = meshData.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const fin = dropPlanarFins(positions, new Uint32Array(meshData.triVerts));
  geometry.setIndex(new BufferAttribute(fin.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function removeContactSeam(mesh) {
  const prev = mesh?.getObjectByName?.('contactSeam');
  if (!prev) return;
  mesh.remove(prev);
  prev.geometry?.dispose?.();
  prev.material?.dispose?.();
}

/**
 * The flush cut is each body's own contour, drawn as a 1px black line on
 * that contour. Not lifted onto the side face, and not a second edge.
 * A small view-space bias keeps the line from losing the depth test against
 * the face it lies on (far plane is 2000). Only contactSeamSegments qualify,
 * so an uncut body and a one-sided cut grow nothing.
 */
function attachContactSeam(mesh, meshData) {
  removeContactSeam(mesh);
  if (!mesh || !meshData?.vertProperties || !meshData?.triVerts) return;
  // Same mesh data, same seam: a part switch back does not re-scan it.
  const segs = contactSeamFor(meshData);
  if (!segs.length) return;
  const pos = new Float32Array(segs.length * 6);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const o = i * 6;
    pos[o] = s.a[0];
    pos[o + 1] = s.a[1];
    pos[o + 2] = s.a[2];
    pos[o + 3] = s.b[0];
    pos[o + 4] = s.b[1];
    pos[o + 5] = s.b[2];
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  const material = new ShaderMaterial({
    vertexShader: `
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        mvPosition.z += 0.5;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: false,
  });
  const line = new LineSegments(geom, material);
  line.name = 'contactSeam';
  line.raycast = () => {};
  line.frustumCulled = false;
  line.renderOrder = 3;
  mesh.add(line);
}

/** Plane + picked bodies. Drop list is not part of the key: hiding does not re-cut. */
function cutPreviewKey(state) {
  const plane = cutPlaneFromState(state);
  const bodies = state?.bodies || [];
  if (!plane || !bodies.length) return '';
  const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
  const bodyKey = bodies.map((b) => (b.at || []).map(r3).join(',')).join(';');
  if (plane.source === 'face') {
    return ['face', plane.center.map(r3).join(','), plane.normal.map(r3).join(','), r3(plane.faceOffset), bodyKey].join('|');
  }
  return [plane.source, r3(plane.originOffset), bodyKey].join('|');
}

/** Same object cut() would receive. Offset is omitted when it is 0. */
function cutPreviewPlanePayload(state) {
  const plane = cutPlaneFromState(state);
  if (!plane) return null;
  if (plane.source === 'face') {
    const payload = { center: plane.center.slice(), normal: plane.normal.slice() };
    const off = Number(plane.faceOffset);
    if (Number.isFinite(off) && off !== 0) payload.offset = off;
    return payload;
  }
  return { normal: plane.normal.slice(), originOffset: Number(plane.originOffset) || 0 };
}

function cutPreviewPieceHidden(state, piece) {
  if (!piece?.selected) return false;
  return (state?.drop || []).some((d) => {
    if (d.side !== piece.side || !Array.isArray(d.at) || !Array.isArray(piece.at)) return false;
    if (cutPointsMatch(d.at, piece.at)) return true;
    const dx = d.at[0] - piece.at[0];
    const dy = d.at[1] - piece.at[1];
    const dz = d.at[2] - piece.at[2];
    return dx * dx + dy * dy + dz * dz <= 1e-4;
  });
}

function geometryFromPreviewMesh(mesh) {
  const np = mesh?.numProp || 3;
  const src = mesh?.vertProperties;
  const tris = mesh?.triVerts;
  if (!src?.length || !tris?.length) return null;
  const n = Math.floor(src.length / np);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setIndex(new BufferAttribute(Uint32Array.from(tris), 1));
  geom.computeVertexNormals();
  return geom;
}

/** Shared top title. Puzzle name in game; filename on mobile CAD. */

const TITLE_CHIP = 'text-xs font-medium text-center truncate px-3 py-1.5 rounded-lg shadow'
  + ' bg-chrome-surface/80 surface-glass-chip border border-gray-500/50 text-chrome-text';

/**
 * Title chip. With `onRename` and `renameOnDoubleClick`, a double-click (or
 * Enter / Space on the focused chip) swaps in an input. Enter or blur commits,
 * Escape reverts. An empty or all-junk name commits nothing, so the part falls
 * back to "Untitled" rather than becoming nameless.
 *
 * `onActivate` is the single-click action (select bodies, enter assembly mode).
 * `inline` sits in the CAD title row (part, then "in", then the assembly).
 * The floating form is the game puzzle name, alone at the top.
 * `noun` is "Part" or "Assembly" — same commit rules, different label.
 */

/** Dispose an object's geometry and material(s), and its children's. */
function disposeObjectTree(obj) {
  if (!obj) return;
  obj.geometry?.dispose?.();
  const material = obj.material;
  if (Array.isArray(material)) material.forEach((item) => item?.dispose?.());
  else material?.dispose?.();
  const kids = obj.children ? [...obj.children] : [];
  for (const kid of kids) disposeObjectTree(kid);
}

function ViewportTitleChip({
  children,
  value = null,
  onActivate = null,
  onRename = null,
  renameOnDoubleClick = false,
  inline = false,
  noun = 'Part',
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startRename = () => {
    if (!onRename) return;
    setDraft(value || '');
    setEditing(true);
  };

  const onChipClick = () => {
    if (onActivate) onActivate();
    else if (onRename && !renameOnDoubleClick) startRename();
  };

  const onChipDoubleClick = () => {
    if (onRename && renameOnDoubleClick) startRename();
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = sanitizePartName(draft);
    if (next && next !== (value || '')) onRename(next);
  };

  const shell = TITLE_CHIP;
  const role = noun === 'Assembly' ? 'assembly' : 'part';
  const renameTitle = noun === 'Assembly'
    ? 'Double-click to rename this assembly'
    : 'Double-click to rename this part';
  const activateTitle = noun === 'Assembly'
    ? 'Enter assembly mode (joints and placements)'
    : 'Select all bodies in this part';
  const shown = value || (noun === 'Assembly' ? '' : 'Untitled');
  const frame = inline
    ? `viewer-title-chip-frame relative z-10 ${onRename || onActivate ? 'pointer-events-auto' : 'pointer-events-none'}`
    : `absolute top-4 left-1/2 -translate-x-1/2 z-10 max-w-[min(20rem,calc(100%-2rem))] ${
      onRename ? '' : 'pointer-events-none'
    }`;

  return (
    <div className={frame}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            e.stopPropagation(); // viewport hotkeys must not eat the typing
          }}
          className={`${shell} w-48 outline-none border-blue-400/80 bg-chrome-surface`}
          style={{ fontSize: '16px' }}
          aria-label={noun === 'Assembly' ? 'Assembly name' : 'Part name'}
          data-title-chip="input"
          data-title-role={role}
          {...(role === 'assembly' ? { 'data-assembly-name': '' } : {})}
        />
      ) : (onActivate || onRename) ? (
        <button
          type="button"
          onClick={onChipClick}
          onDoubleClick={onChipDoubleClick}
          className={`${shell} hover:border-blue-400/70 hover:text-white ${onRename ? 'cursor-text' : 'cursor-pointer'}`}
          title={onRename && renameOnDoubleClick ? `${activateTitle}. ${renameTitle}.` : (onActivate ? activateTitle : renameTitle)}
          aria-label={onRename && renameOnDoubleClick
            ? `${noun} name: ${shown}. ${activateTitle} Double-click to rename.`
            : `${noun} name: ${shown}. ${onActivate ? activateTitle : 'Click to rename.'}`}
          data-title-chip="button"
          data-title-role={role}
          data-title-activate={onActivate ? '' : undefined}
          {...(role === 'assembly' ? { 'data-assembly-name': '' } : {})}
        >
          {children}
        </button>
      ) : (
        <div
          className={shell}
          data-title-chip="static"
          data-title-role={role}
          {...(role === 'assembly' ? { 'data-assembly-name': '' } : {})}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Execution limits
const EXECUTION_LIMITS = {
  timeoutMs: 30000,      // 30 seconds max execution time
  memoryLimitMB: 512,    // 512 MB memory limit
};

const Viewport = forwardRef(({ 
  onAccount,
  onSignedOut = null,
  onClearLocalCadData = null,
  profileVaultName = null,
  currentScript, 
  onFaceSelected,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentFilename,
  /** False when nothing is open: the part / assembly chips stay off the screen. */
  showCadTitle = true,
  /** Assembly document name. Blank documents resolve to Assembly before this. */
  assemblyName = '',
  onRenameFile = null,
  /** Single tap on the part chip: select all bodies in that part. */
  onTitlePartActivate = null,
  /** Single tap on the assembly chip: assembly mode (joints), not rename. */
  onTitleAssemblyActivate = null,
  mode = 'cad',
  ghostMeshData = null,
  onStartGame,
  onExitGame,
  onRun,
  /** CAD strip Select all — App owns the editor ref, so it passes the action. */
  onSelectAll = null,
  onHint,
  onPickPuzzle,
  gameElapsedMs = 0,
  gameSuccess = false,
  gamePuzzleTitle = null,
  gameBestTimeMs = null,
  isMobile = false,
  /** CAD viewport only (not Parts or Script stages on a phone). */
  brandHeader = false,
  onInsertHelper = null,
  /** A palette tap is opening a sheet or mode (App: edit the picked part). */
  onFeatureOpen = null,
  onCommitContourProfile = null,
  /** Hole Accept. Empty centres return true and write nothing. */
  onCommitHole = null,
  /** A successful reference match rewrites geom in the contour statement. */
  onContourRefsResolved = null,
  onDeleteContour = null,
  onCommitFillet = null,
  onCommitFeatureEdit = null,
  /** Delete from the open feature-edit dialog. False leaves the dialog up. */
  onDeleteFeatureEdit = null,
  /**
   * True while an assembly open owns the worker. Feature-edit preview and
   * the cancel/unchanged restore must not post in front of that build, and
   * must not set or clear the lock.
   */
  assemblyRunLockRef = null,
  onCommitShell = null,
  onCommitDraft = null,
  onCommitCut = null,
  onCommitBoolean = null,
  /**
   * Cross-part Boolean: `{ parts: { [id]: { script, name, position, ok } } }`
   * so the intersect Pieces preview can run the frozen copies the same way
   * Confirm will write them.
   */
  getBooleanContext = null,
  onCommitMove = null,
  onCommitRotate = null,
  onCommitMirror = null,
  onCommitMoveFace = null,
  onCommitDeleteFace = null,
  /** S1 sheet metal: active part's SendCutSend binding (or null). */
  sheetMetalBinding = null,
  /** S1: () => boolean — can sheet metal write into the editor part as-is? */
  getSheetMetalReady = null,
  /** S1: (skuRecord) => { ok, partId } — bind SKU to the part (or a new one). */
  onBindSheetMetal = null,
  /** CAD: Blocks, the last Move button, opens the joint create card. */
  onOpenJoints = null,
  /** True while the joint create card is open (pressed tint on Blocks). */
  jointCardOpen = false,
  /** S2+: (spec, { partId, step }) => boolean — write the sheet-metal block. */
  onCommitSheetMetal = null,
  getHelperBuffer = null,
  /** Mobile CAD mid-strip host (CodeEditor). Null on desktop and in game. */
  cadToolbarHost = null,
  /** CAD Run. When set, the strip runs the assembly instead of one script. */
  onRunAssembly = null,
  /** Slice Mobile C: long-press on body opens feature sheet (mobile CAD only). */
  featureSheetEnabled = false,
  onFeatureLongPress = null,
  /** Face / edge / body hit. App retargets the CAD part and may sync Monaco. */
  onPickRetarget = null,
  /** Empty canvas click. App clears cadPartId and leaves activeId. */
  onCadEmptyClick = null,
  /** Create card is open: a face or edge tap arms a joint instead of selecting. */
  jointPicking = false,
  onJointPick = null,
  /** Joint create card. Game does not mount it. fullLeft stays off. */
  jointCard = null,
  /** False: the title is the assembly name only, with no "in". */
  cadPartSelected = true,
  /**
   * Every run of a script here reports its outcome:
   * `{ script, ok, scriptLine, featureId, featureBlock, skipped }`. App maps a
   * failure to its feature block (tracked id first, stack line second) for
   * the strip and sheet red border. `skipped` names dependents omitted with it.
   */
  onRunOutcome = null,
  /**
   * Rollback bar for this run. `null` blanks from the start, a feature id
   * blanks everything after that feature, and omission runs the whole script.
   */
  rollbackAnchor = undefined,
  /** True while any feature session is open. App hides the feature strip. */
  onFeatureSessionChange = null,
  /** True while any feature card is open, so the agent prompt can slide away. */
  onFeatureCardChange = null,
  /**
   * Sketch chips for the phone and desktop bars. Null while the plane card
   * is open and after contour mode closes.
   */
  onSketchStripChange = null,
  /**
   * Sheet chips for the phone and desktop bars. Null when sheet metal
   * is closed. Sketch chips still replace this list.
   */
  onSheetStripChange = null,
  /** id → display name for the which-part chip. */
  partLabels = null,
  /** Saved assembly colors, keyed by surf id. Empty skips the face skin. */
  assemblyColors = null,
  /** Paint Confirm / Clear / Remove unmatched. Writes assembly colors. */
  onCommitPaint = null,
  /** Write the FEA study comment block. False leaves the in-memory study. */
  onCommitFea = null,
  /** Part script for a study material lookup. The active part is the editor. */
  getPartScript = null,
  /**
   * Fallback feature editor and the picker (`FeatureEditSheet`).
   * null | { mode: 'picker' } | { mode: 'edit', feature }.
   * Game and a hidden phone stage pass null.
   */
  featureEdit = null,
  featureEditScript = '',
  featureEditFailedIds = null,
  /** Dependent titles for the feature sheet (`failedFeatureTitles`). */
  featureEditFailedTitles = null,
  onFeatureEditAccept = null,
  onFeatureEditCancel = null,
  onFeatureEditDelete = null,
  onFeatureEditScript = null,
  onFeatureEditPick = null,
  /** Another card took the pane. Close the edit card and write nothing. */
  onFeatureEditDismiss = null,
  /**
   * Live-tab agent host. This component publishes `screenshot` (the same
   * `capturePng` the imperative handle exposes). App publishes the rest.
   * Flag off, the ref is still filled and nothing is mounted on screen.
   */
  agentHostRef = null,
  /** M1 local WebSocket pairing UI (profile menu when on). */
  agentBridgeLive = false,
}, ref) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const resultRef = useRef(null);
  const assemblyGroupRef = useRef(null);
  const assemblyExtrasRef = useRef(new Map());
  const assemblyColorsRef = useRef(assemblyColors);
  const partSurfIdRef = useRef(new Map());
  /** Part instances: row id → definition id (the script the row places). Rows of one definition share one geometry. */
  const partDefinitionRef = useRef(new Map());
  const definitionOf = (id) => (id == null ? id : (partDefinitionRef.current.get(String(id)) ?? id));
  const applyFaceSkinRef = useRef(() => {});
  const applyStressSkinRef = useRef(() => {});
  /** Built solid geometry per mesh data (pick mesh + other parts). */
  const solidCacheRef = useRef(null);
  if (!solidCacheRef.current) solidCacheRef.current = createSolidCache();
  /** Idle pre-build of other parts' graphs; bumped to cancel a stale pass. */
  const prewarmGenRef = useRef(0);
  const clearAssemblyExtrasRef = useRef(() => {});
  const prewarmPartGraphsRef = useRef(() => {});
  const placeAssemblyRef = useRef(() => false);
  const readDroppedPaintsRef = useRef(() => []);
  const ghostMeshRef = useRef(null);
  const raycasterRef = useRef(new Raycaster());
  const mouseRef = useRef(new Vector2());
  const highlightMeshRef = useRef(null);
  /** Face highlights for an open joint card. Keyed by part id so a second pick does not drop the first. */
  const jointHighlightRef = useRef(new Map());
  const clearJointHighlightsRef = useRef(() => {});
  const paintJointHighlightRef = useRef(() => {});
  const cuttingPlaneWidgetRef = useRef(null);
  const executionAbortRef = useRef(null);
  // Mirrors the last execution error for the dev-only __VIEWPORT__ hook (the real handler
  // stores it in state, which a headless caller cannot read synchronously).
  const stageExecErrorRef = useRef(null);

  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);
  const lastClickTimeRef = useRef(0);
  const pendingClickDataRef = useRef(null);
  // Multi-face pick. Each entry is { center, normal, indices }.
  // Shell (in mode) accumulates every tap — no shift — and toggles a face
  // that is already selected, same as the edge picker. Draft still shift-adds.
  // Shell and Draft read the list off selectedFace.group; every other feature
  // keeps using the LAST pick.
  const facePickGroupRef = useRef(null);
  // Null until a press starts on the canvas. A leftover {0,0} made the first
  // mouseup — including a rollback-bar release over this canvas — look like a tap.
  const mouseDownPosRef = useRef(null);
  const isDraggingRef = useRef(false);
  /** Slice Mobile C: pointer-hold opens feature sheet without conflicting with orbit. */
  const featureLongPressTimerRef = useRef(null);
  const featureLongPressOriginRef = useRef(null);
  const featureLongPressFiredRef = useRef(false);
  const featureSheetEnabledRef = useRef(featureSheetEnabled);
  featureSheetEnabledRef.current = featureSheetEnabled;
  const onFeatureLongPressRef = useRef(onFeatureLongPress);
  onFeatureLongPressRef.current = onFeatureLongPress;
  const measurementLinesRef = useRef(null);
  const measureMarkerRef = useRef(null);
  const feaProbeGroupRef = useRef(null);
  const measureEdgeRef = useRef(null);
  const measurePicksRef = useRef([]);
  const measurementEnabledRef = useRef(false);
  const measureLastTapRef = useRef({ t: 0, x: 0, y: 0, pickId: null });
  const measureTapTimerRef = useRef(null);
  const pendingMeasureRef = useRef(null);
  const exitMeasureModeRef = useRef(() => {}); 

  // Configuration for click detection
  const MULTI_CLICK_DELAY = 300; // ms to wait for additional clicks
  const ANGLE_TOLERANCE_DEGREES = 3; // Angular tolerance for double-click selection
  const DRAG_THRESHOLD = 3; // pixels - movement beyond this is considered a drag
  
  const [selectedFace, setSelectedFace] = useState(null);
  const selectedFaceRef = useRef(null);
  selectedFaceRef.current = selectedFace;
  /** Slice 12: 'face' | 'edge' — mutually exclusive pick modes. */
  const [pickMode, setPickMode] = useState('face');
  /**
   * Plane / sketch overlay visibility. Independent of Face/Edge.
   * Session only — not stored. Both default off.
   * enterContourMode holds the keys that tool picks; exitContourMode releases them.
   */
  const [showPlanes, setShowPlanes] = useState(false);
  const [showContours, setShowContours] = useState(false);
  const [selectedEdges, setSelectedEdges] = useState([]);
  /** Slice B+C: latest selection for orbit-synced HTML edge chips (animate loop). */
  const selectedEdgesRef = useRef([]);
  selectedEdgesRef.current = selectedEdges;
  const edgeChipElsRef = useRef(new Map());
  const edgeChipProjectTmpRef = useRef(new Vector3());
  const featureEdgesRef = useRef([]);
  const graphTimingRef = useRef(null);
  const runTimingStartRef = useRef(0);
  /** Geometry identity that featureEdgesRef was built from — invalidate on replace. */
  const featureEdgesSourceRef = useRef(null);
  /** Mesh object the face/edge/contour graphs were last built for. */
  const graphsBoundMeshRef = useRef(null);
  /** Part id the pick graphs and overlays are bound to. Null outside an assembly. */
  const activePartIdRef = useRef(null);
  const onPickRetargetRef = useRef(null);
  const onFeatureSessionChangeRef = useRef(null);
  const onSketchStripChangeRef = useRef(null);
  const onSheetStripChangeRef = useRef(null);
  const getHelperBufferRef = useRef(null);
  const undoContourSketchRef = useRef(null);
  const selectSketchEntityRef = useRef(null);
  const selectSheetChipRef = useRef(null);
  const pendingSheetChipRef = useRef(null);
  const partLabelsRef = useRef(null);
  const featureSessionRef = useRef(false);
  const featureEditRef = useRef(null);
  const beginFeatureEditRef = useRef(null);
  const beginContourEditRef = useRef(null);
  const commitFeatureEditRef = useRef(() => false);
  const cancelFeatureEditRef = useRef(() => {});
  const executeScriptRef = useRef(null);
  const onCommitFeatureEditRef = useRef(onCommitFeatureEdit);
  onCommitFeatureEditRef.current = onCommitFeatureEdit;
  const onDeleteFeatureEditRef = useRef(onDeleteFeatureEdit);
  onDeleteFeatureEditRef.current = onDeleteFeatureEdit;
  const [helperEdit, setHelperEdit] = useState(null);
  const helperEditRef = useRef(null);
  helperEditRef.current = helperEdit;
  const [featureEditBanner, setFeatureEditBanner] = useState('');
  const [featureDeleteToast, setFeatureDeleteToast] = useState(null);
  const [featureDeleteConfirm, setFeatureDeleteConfirm] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const cadBodyStickyRef = useRef(false);
  const showCadBodyHighlightRef = useRef(() => false);
  const agentClearSelectionRef = useRef(() => {});
  const agentSelectFacesRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh to select on' } }));
  const agentSelectEdgesRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh to select on' } }));
  const agentSetCameraRef = useRef(() => ({ ok: false }));
  const agentFitCameraRef = useRef(() => false);
  const agentZoomToSelectionRef = useRef(() => ({ error: { code: 'no_selection', message: 'No selection' } }));
  const agentListFacesRef = useRef(() => ({ faces: [], partId: null }));
  const agentMoldFitRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const agentMoldWallMapRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const wallMapOnRef = useRef(false);
  const wallFieldRef = useRef(null);
  const wallJobGenRef = useRef(0);
  const moldJobGenRef = useRef(0);
  const moldAnalysisRef = useRef(null);
  const [moldProgress, setMoldProgress] = useState(null);
  const moldProgressRef = useRef(null);
  const putMoldProgress = (value) => {
    const next = typeof value === 'function' ? value(moldProgressRef.current) : value;
    moldProgressRef.current = next;
    setMoldProgress(next);
  };
  const clearWallMapRef = useRef(() => {});
  const applyWallSkinRef = useRef(() => {});
  const [wallLegend, setWallLegend] = useState(null);
  const agentMoldPartingRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const partingOnRef = useRef(false);
  const partingFieldRef = useRef(null);
  const clearPartingRef = useRef(() => {});
  const applyPartingSkinRef = useRef(() => {});
  const [partingLegend, setPartingLegend] = useState(null);
  const pullReferenceRef = useRef({ mode: 'auto', plane: null, pull: null });
  const [pullReference, setPullReference] = useState({ mode: 'auto', plane: null, pull: null });
  const applySharedPullRef = useRef(() => ({ mode: 'auto' }));
  function sharedMoldPull() {
    const ref = pullReferenceRef.current;
    if (!ref || ref.mode === 'auto' || !ref.pull) return null;
    return ref.pull;
  }
  applySharedPullRef.current = async (next) => {
    const choice = next?.mode;
    if (choice !== 'auto' && choice !== 'plane' && choice !== 'face') {
      return { error: { code: 'bad_args', message: 'mode must be auto, plane, or face' } };
    }
    let pull = null;
    let plane = null;
    if (choice === 'plane') {
      const row = MOLD_PULL_PLANES[next.plane];
      if (!row) return { error: { code: 'bad_args', message: 'plane must be top, front, or right' } };
      plane = row.id;
      pull = row.normal.slice();
    } else if (choice === 'face') {
      pull = unitPull(next.pull);
      if (next.pull != null && !pull) {
        return { error: { code: 'bad_args', message: 'pull must be a non-zero [x, y, z] vector' } };
      }
    }
    const stored = { mode: choice, plane, pull };
    pullReferenceRef.current = stored;
    setPullReference(stored);
    partingFieldRef.current = null;
    selectedSideGroupRef.current = null;
    moldDraftFieldRef.current = null;
    dfmFieldRef.current = null;
    quoteFieldRef.current = null;
    moldAnalysisRef.current = null;
    dropMoldJobs();
    const geometry = resultRef.current?.geometry;
    const waiting = choice === 'face' && !pull;
    if (!geometry?.attributes?.position) {
      return {
        mode: choice,
        plane,
        pull,
        waiting,
        pullSource: pull ? 'override' : 'search',
      };
    }
    const tool = partingOnRef.current ? 'parting'
      : moldDraftOnRef.current ? 'draft'
          : dfmOnRef.current ? 'dfm'
            : quoteOnRef.current ? 'quote'
              : 'pull';
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, pull, tool);
    const analyzed = await promise;
    if (gen != null && moldJobGenRef.current !== gen) {
      return {
        mode: choice,
        plane,
        pull,
        waiting,
        pullSource: pull ? 'override' : 'search',
      };
    }
    if (analyzed?.dropped) {
      return {
        mode: choice,
        plane,
        pull,
        waiting,
        pullSource: pull ? 'override' : 'search',
      };
    }
    if (analyzed?.error) {
      if (gen != null) endMoldProgress(gen);
      return analyzed;
    }
    rememberMoldAnalysis(geometry, analyzed);
    if (partingOnRef.current && analyzed.parting) {
      const selected = selectedSideGroupRef.current;
      partingFieldRef.current = {
        geometry,
        parting: analyzed.parting,
        sideActions: analyzed.sideActions || null,
      };
      setPartingLegend(splitLegendModel(analyzed.parting, analyzed.sideActions, selected));
      syncPartingSkin(resultRef.current, analyzed.parting, analyzed.sideActions, selected);
    }
    if (moldDraftOnRef.current && analyzed.moldDraft) {
      moldDraftFieldRef.current = { geometry, moldDraft: analyzed.moldDraft };
      setMoldDraftLegend(moldDraftLegendModel(analyzed.moldDraft));
      syncMoldDraftSkin(resultRef.current, analyzed.moldDraft);
    }
    if (dfmOnRef.current) {
      const report = analyzed.dfm || dfmReport(analyzed);
      if (report) {
        dfmFieldRef.current = { geometry, report };
        setDfmReportState(report);
      }
    }
    if (gen != null) endMoldProgress(gen);
    return {
      mode: choice,
      plane,
      pull: analyzed.pull,
      pullSource: analyzed.pullSource,
      fit: analyzed.fit,
      undercutCount: analyzed.undercutCount,
      undercutArea: analyzed.undercutArea,
      draftedArea: analyzed.draftedArea,
      waiting,
    };
  };
  const agentMoldSideActionsRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const clearSideActionsRef = useRef(() => {});
  const applySideActionSkinRef = useRef(() => {});
  const selectedSideGroupRef = useRef(null);
  const agentMoldDraftRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const moldDraftOnRef = useRef(false);
  const moldDraftFieldRef = useRef(null);
  const clearMoldDraftRef = useRef(() => {});
  const applyMoldDraftSkinRef = useRef(() => {});
  const [moldDraftLegend, setMoldDraftLegend] = useState(null);
  const pullToolsOn = mode !== 'game' && !!(partingLegend || moldDraftLegend);
  const agentMoldDfmRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const dfmOnRef = useRef(false);
  const dfmFieldRef = useRef(null);
  const clearDfmRef = useRef(() => {});
  const refreshDfmRef = useRef(() => {});
  const [dfmReportState, setDfmReportState] = useState(null);
  const agentMoldQuoteRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }));
  const agentMoldFirmQuoteRef = useRef(() => ({ error: { code: 'no_mesh', message: 'Open the budgetary quote first' } }));
  const agentMoldHumanReviewRef = useRef(() => ({ error: { code: 'no_mesh', message: 'Open the budgetary quote first' } }));
  const agentMoldPayReviewRef = useRef(() => ({ error: { code: 'no_mesh', message: 'Open the budgetary quote first' } }));
  const reviewReturnSeenRef = useRef(new Set());
  const reviewPollRef = useRef(0);
  const startReviewPollRef = useRef(async () => {});
  const quoteOnRef = useRef(false);
  const quoteFieldRef = useRef(null);
  const quoteSeqRef = useRef(0);
  const clearQuoteRef = useRef(() => {});
  const refreshQuoteRef = useRef(() => {});
  const [moldQuote, setMoldQuote] = useState(null);
  const moldQuoteRef = useRef(null);
  moldQuoteRef.current = moldQuote;
  useEffect(() => {
    if (mode === 'game') {
      clearWallMapRef.current();
      clearPartingRef.current();
      clearSideActionsRef.current();
      clearMoldDraftRef.current();
      clearDfmRef.current();
      clearQuoteRef.current();
    }
  }, [mode]);
  useEffect(() => () => {
    reviewPollRef.current += 1;
  }, []);
  const agentReadBodiesRef = useRef(() => ({ partId: null, bodies: [] }));
  const agentResolveMoveAnchorRef = useRef(() => ({ error: { code: 'no_mesh', message: 'No mesh' } }));
  const agentDescribeJointPickRef = useRef(() => ({
    error: { code: 'no_mesh', message: 'No mesh for that part' },
  }));
  const agentListEdgesRef = useRef(() => ({ edges: [], partId: null }));
  const agentListFeatureEdgesRef = useRef(() => ({ edges: [], partId: null }));
  /** Edge identity: annotate edge rows with their named edge (set once the per-part lookups exist). */
  const withEdgeNamesRef = useRef((edges) => edges);
  const filletPartGeometryRef = useRef(() => null);
  const agentSketchBeginRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentSketchAcceptPlaneRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentSketchAddRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentSketchCancelRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPrepareSketchCommitRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPrepareHoleCommitRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPrepareSketchDimensionRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPrepareSketchConstrainRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPendingSketchGestureRef = useRef(null);
  const agentSlotOpenRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentSlotAssignContourRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentSlotSetParamsRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentSlotCancelRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPrepareSlotCommitRef = useRef(() => ({ error: { code: 'internal', message: 'Viewport not ready' } }));
  const agentPickDepsRef = useRef(null);
  const agentPickHostRef = useRef(null);
  const agentSketchPickRef = useRef(null);
  if (!agentPickHostRef.current) agentPickHostRef.current = createViewportPickHost(() => agentPickDepsRef.current);
  if (!agentSketchPickRef.current) {
    agentSketchPickRef.current = createSketchPickHandlers(() => agentPickDepsRef.current);
  }
  const swapPickPartRef = useRef(() => false);
  const ambiguousPickRef = useRef(null);
  const [partChoice, setPartChoice] = useState(null);
  const adoptActiveSolidRef = useRef(() => false);
  /**
   * Failed parts (red outline + tint on their solid). `failedPartIdsRef` is
   * set by each assembly placement; `soloRunFailedRef` covers a run outside
   * an assembly that restored the last good mesh.
   */
  const failedPartIdsRef = useRef(new Set());
  const soloRunFailedRef = useRef(false);
  const syncFailedPartOutlinesRef = useRef(() => {});
  syncFailedPartOutlinesRef.current = () => {
    const failed = failedPartIdsRef.current;
    for (const [id, mesh] of assemblyExtrasRef.current) {
      setFailedPartOutline(mesh, failed.has(String(id)));
    }
    const active = activePartIdRef.current;
    if (resultRef.current) {
      setFailedPartOutline(
        resultRef.current,
        active != null && active !== '' ? failed.has(String(active)) : soloRunFailedRef.current,
      );
    }
  };
  /** Per-triangle Manifold faceID from the last worker mesh (not a per-vertex attribute). */
  const faceIDsRef = useRef(null);
  const boundaryTopoRef = useRef(null);
  /** Sheet-aware edges for contour references. Fillet keeps boundaryTopoRef. */
  const contourTopoRef = useRef(null);
  /** Spec of the solid on screen. Contour edges come from this, not the mesh. */
  const sheetSpecRef = useRef(null);
  /** Previous spec while a run is resolving. Undefined means no swap is open. */
  const sheetSpecRollbackRef = useRef(undefined);
  const sheetPartIdRef = useRef(undefined);
  const idLabelGroupRef = useRef(null);
  const edgeHighlightRef = useRef(null);
  /** Fillet / Chamfer picks kept on other parts, drawn at that part's position. */
  const edgeHighlightForeignRef = useRef([]);
  const edgeHoverRef = useRef(null);
  /** Slice 21: plane+profile preview overlay while HelperParamModal is open. */
  const xsPreviewRef = useRef(null);
  /** Saved makeCrossSection wires while contour mode is open. */
  const savedContourGhostRef = useRef(null);
  const pathPreviewRef = useRef(null);
  const edgePickScratchA = useRef(new Vector3());
  const edgePickScratchB = useRef(new Vector3());
  const pickModeRef = useRef('face');
  const showPlanesRef = useRef(false);
  const showContoursRef = useRef(false);
  const overlayVis = useTemporaryVisibility({
    planes: {
      get: () => showPlanesRef.current,
      set: (value) => {
        showPlanesRef.current = value;
        setShowPlanes(value);
      },
    },
    contours: {
      get: () => showContoursRef.current,
      set: (value) => {
        showContoursRef.current = value;
        setShowContours(value);
      },
    },
  });
  const onShowPlanesChange = (next) => overlayVis.choose('planes', next);
  const onShowContoursChange = (next) => overlayVis.choose('contours', next);
  useEffect(() => {
    if (!jointPicking) return undefined;
    holdJointPlanes(overlayVis);
    return () => releaseJointPlanes(overlayVis);
  }, [jointPicking, overlayVis]);
  const edgeModeToastShownRef = useRef(false);
  const edgeModeToastTimerRef = useRef(null);
  const [edgeModeToast, setEdgeModeToast] = useState(null);
  /** Slice 24/25/26/28/30: contour-mode shell (Profile-in-mode; Extrude / Revolve / Loft / Sweep commit a solid). */
  const [contourMode, setContourMode] = useState(null);
  const [contourSnap, setContourSnap] = useState(null);
  const contourSnapRef = useRef(null);
  useEffect(() => {
    if (contourSnapAllowed(contourMode)) return;
    if (!contourSnapRef.current) return;
    contourSnapRef.current = null;
    setContourSnap(null);
  }, [contourMode]);
  /** Plane card is the first step. Drawing keeps the rail and drops the card. */
  const [contourPlaneOpen, setContourPlaneOpen] = useState(false);
  const contourPlaneOpenRef = useRef(false);
  const [featureSlots, setFeatureSlots] = useState(null);
  const [holeCard, setHoleCard] = useState(null);
  const holeCardRef = useRef(null);
  holeCardRef.current = holeCard;
  const holeSpecRef = useRef(null);
  const holeEditRef = useRef(null);
  const confirmHoleEditRef = useRef(() => {});
  const holeCentresEditRef = useRef(null);
  const agentHoleBeginCentresRef = useRef(() => {});
  const agentFinishHoleSketchRef = useRef(() => {});
  const constructionPlanesRef = useRef([]);
  const sheetHoleSketchRef = useRef(null);
  const featureSlotsRef = useRef(null);
  featureSlotsRef.current = featureSlots;
  const slotReturnRef = useRef(null);
  const contourEditRef = useRef(null);
  const [contourEdit, setContourEdit] = useState(null);
  const [contourDeleteConfirm, setContourDeleteConfirm] = useState(null);
  const [sketchDeleteConfirm, setSketchDeleteConfirm] = useState(null);
  const [slotHoverId, setSlotHoverId] = useState(null);
  const closeFeatureSlotsRef = useRef(() => {});
  const exitContourModeRef = useRef(() => {});
  const finishContourCommitRef = useRef(() => {});
  const [contourFaceAim, setContourFaceAim] = useState('');
  const [contourUndoDepth, setContourUndoDepth] = useState(0);
  const [faceSketchNonce, setFaceSketchNonce] = useState(0);
  const faceSketchNormalRef = useRef(null);
  const sketchHistRef = useRef(emptySketchHistory());
  const applyingSketchUndoRef = useRef(false);
  const faceSketchFinishRef = useRef(() => {});
  const onFaceSelectedRef = useRef(null);
  onFaceSelectedRef.current = onFaceSelected;
  /** Explicit Normal to sketch aims even while the plane card is open. */
  const faceSketchForceRef = useRef(false);
  const requestFaceSketchAim = (normal, { force = false } = {}) => {
    if (!Array.isArray(normal) || normal.length < 3) return;
    faceSketchForceRef.current = !!force;
    faceSketchNormalRef.current = [Number(normal[0]), Number(normal[1]), Number(normal[2])];
    setFaceSketchNonce((n) => n + 1);
  };
  const [selectedPlaneId, setSelectedPlaneId] = useState(null);
  const [armedContourId, setArmedContourId] = useState(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const contourModeRef = useRef(null);
  /** Last agent/UI write not yet flushed through React state. */
  const contourLiveWriteRef = useRef(null);
  const workplaneOverlayRef = useRef(null);
  const constructionPlaneRef = useRef(null);
  const savedContoursRef = useRef([]);
  const savedContourHostPlaneRef = useRef(null);
  /** Editor part's overlay translation and id (contour / plane picks hit only its overlays). */
  const savedContourOffsetRef = useRef([0, 0, 0]);
  const editorOverlayPartIdRef = useRef(null);
  const polylineDraftRef = useRef(null);
  const contourStatusRef = useRef(null);
  const contourRefRef = useRef(null);
  /** Touch drag consumes the synthetic click that would otherwise add a point. */
  const polylineSuppressClickRef = useRef(false);
  /** Scratch for projecting handles to screen space (no per-frame alloc). */
  const polylineProjectScratch = useRef(new Vector3());
  /** Index of the draft point under the cursor (-1 = none). */
  const polylinePointHoverRef = useRef(-1);
  /** Live right-drag: { index, plane, moved } while a point or line is being moved. */
  const polylinePointDragRef = useRef(null);
  /** Second tap on the same polyline dot, inside POLYLINE_DOUBLE_TAP_MS, removes it. */
  const polylineDotTapRef = useRef(null);
  /** Contour id a double-tap is deleting when the editor session is not open. */
  const shapeDeleteIdRef = useRef(null);
  /** TrackballControls noRotate/noPan saved while a point handle is grabbed. */
  const polylineControlsLockRef = useRef(null);
  /**
   * Dimension and Constrain only. A tap must not orbit: Trackball starts a
   * one-finger rotate on pointerdown, and a phone finger moves a few pixels
   * before mouseup. Part edges sit on the silhouette, so that rotate swings
   * them off the finger and the 12px pick misses. noRotate stays on until
   * the finger leaves the tap slop; a real drag orbits from there. Pan is
   * not held. Arc, the plane card, and the slot cards do not take this hold.
   */
  const tapOrbitHoldRef = useRef(null);
  /**
   * Pointerdown on a sketch drag handle. Rotate and pan stay off for the
   * whole gesture (not only until tap slop) and come back on release.
   * A compatibility mousemove after a finger lift must not grab them again.
   */
  const sketchDragHoldRef = useRef(null);
  const sketchHoverMuteRef = useRef(0);
  const extrudePreviewRef = useRef(null);
  const revolvePreviewRef = useRef(null);
  const loftPreviewRef = useRef(null);
  const sweepPreviewRef = useRef(null);
  const contourGhostMatsRef = useRef(null);
  const [contourToast, setContourToast] = useState(null);
  const contourToastTimerRef = useRef(null);
  const featureDeleteToastTimerRef = useRef(null);
  /** Slice 27: Fillet-in-mode (enter without edges; Accept commits sweep fillet). */
  const [filletMode, setFilletMode] = useState(null);
  const filletModeRef = useRef(null);
  const [shellMode, setShellMode] = useState(null);
  const shellModeRef = useRef(null);
  /** Paint session. Null when the popup is closed. Colors stay here until Confirm. */
  const [paintMode, setPaintMode] = useState(null);
  const paintModeRef = useRef(null);
  const [feaActive, setFeaActive] = useState(false);
  const feaActiveRef = useRef(false);
  feaActiveRef.current = feaActive;
  const feaPanelRef = useRef(null);
  const feaPickRef = useRef(null);
  const feaTapActionRef = useRef(null);
  const feaToggleRef = useRef(() => {});
  const feaCloseRef = useRef(() => {});
  /** One Fix/Force/Pressure overlay per (entry, face). Reconciled, not stacked. */
  const feaFaceOverlaysRef = useRef(new Map());
  const feaHighlightStudyRef = useRef(null);
  const feaHighlightMetaRef = useRef(null);
  const exitPaintModeRef = useRef(() => {});
  /** cancel_feature on a card an edit opened: leave that mode the way its X does (set once the exits exist). */
  const exitFeatureEditModeRef = useRef(() => false);
  const applyLivePaintTapRef = useRef(() => {});
  /** SCS sheet metal: picker popup (S1) + mode state (stage, sku, partId). */
  const [sheetMetalPicker, setSheetMetalPicker] = useState(null);
  const [sheetMetalMode, setSheetMetalMode] = useState(null);
  const [sheetRibbonActiveId, setSheetRibbonActiveId] = useState(null);
  const sheetMetalModeRef = useRef(null);
  sheetMetalModeRef.current = sheetMetalMode;
  const sheetMetalPickerRef = useRef(null);
  sheetMetalPickerRef.current = sheetMetalPicker;
  const agentSheetHostRef = useRef(null);
  const agentPaintMeasureHostRef = useRef(null);
  const agentFeaHostRef = useRef(null);
  const agentXsectionHostRef = useRef(null);
  const crossSectionPanelRef = useRef(null);
  const crossSectionEnabledRef = useRef(false);
  const crossSectionAppliedGenRef = useRef(0);
  const crossSectionAppliedRef = useRef(null);
  const crossSectionPlaneRef = useRef({
    normal: [0, 0, 1],
    originOffset: 0,
    showPlane: true,
  });
  const refreshSectionClipRef = useRef(() => {});
  const endSectionViewRef = useRef(() => {});
  const applySketchEntityDeleteRef = useRef(null);
  const enterPaintModeRef = useRef(() => {});
  const acceptPaintRef = useRef(() => {});
  const patchPaintRef = useRef(() => {});
  const storeLivePaintRef = useRef(() => {});
  const paintWholePartRef = useRef(() => {});
  const undoLivePaintRef = useRef(() => {});
  const clearLivePaintRef = useRef(() => {});
  const paintSurfIdRef = useRef(() => null);
  const handleMeasurementToggleRef = useRef(() => {});
  const commitMeasurePicksRef = useRef(() => {});
  const syncFeatureEdgesRef = useRef(() => {});
  const exitSheetMetalChromeRef = useRef(() => {});
  exitSheetMetalChromeRef.current = () => {
    if (!sheetMetalModeRef.current && !sheetMetalPicker) return;
    cancelFeatureEditRef.current?.('sheetMetal');
    sheetMetalModeRef.current = null;
    setSheetMetalMode(null);
    setSheetMetalPicker(null);
  };
  const sheetMetalOverlayRef = useRef(null);
  const [draftMode, setDraftMode] = useState(null);
  const draftModeRef = useRef(null);
  const [cutMode, setCutMode] = useState(null);
  const cutModeRef = useRef(null);
  const [booleanMode, setBooleanMode] = useState(null);
  const booleanModeRef = useRef(null);
  const booleanPiecesPreviewRef = useRef(null);
  /** Picks on parts that are not the pick mesh, drawn from their soup. */
  const booleanRemotePicksRef = useRef(null);
  const getBooleanContextRef = useRef(null);
  const booleanBaseMaterialRef = useRef(null);
  const booleanBaseHiddenMatRef = useRef(null);
  const booleanPreviewGenRef = useRef(0);
  const booleanPieceCountRef = useRef(0);
  const [booleanPieceCount, setBooleanPieceCount] = useState(0);
  const paintBooleanPicksRef = useRef(() => {});
  const [moveMode, setMoveMode] = useState(null);
  const moveModeRef = useRef(null);
  const [rotateMode, setRotateMode] = useState(null);
  const rotateModeRef = useRef(null);
  const clearRotatePreviewRef = useRef(() => {});
  const [mirrorMode, setMirrorMode] = useState(null);
  const mirrorModeRef = useRef(null);
  const clearMirrorPreviewRef = useRef(() => {});
  const releaseMirrorPlanesRef = useRef(() => {});
  const dropMirrorModeRef = useRef(() => {});
  const mirrorPreviewRef = useRef(null);
  const [moveFaceMode, setMoveFaceMode] = useState(null);
  const moveFaceModeRef = useRef(null);
  const [deleteFaceMode, setDeleteFaceMode] = useState(null);
  const deleteFaceModeRef = useRef(null);
  /** Kernel centroids from the last execute. move() matches these, not the viewport average. */
  const bodyCentroidsRef = useRef([]);
  /** Trailing Move / Rotate of the active part. The mesh stays unmoved. */
  const featureRigidRef = useRef(null);
  const movePreviewRef = useRef(null);
  const rotatePreviewRef = useRef(null);
  const moveFacePreviewRef = useRef(null);
  const moveFaceBaseMaterialRef = useRef(null);
  const moveFaceHiddenMatRef = useRef(null);
  const moveFaceLiveKeyRef = useRef('');
  const moveFacePreviewGenRef = useRef(0);
  const moveFacePreviewTimerRef = useRef(null);
  const blockPreviewRef = useRef(null);
  const blockPreviewGenRef = useRef(0);
  const blockPreviewTimerRef = useRef(null);
  const blockPreviewKeyRef = useRef('');
  const blockPreviewGeomKeyRef = useRef('');
  const blockPreviewMeshRef = useRef(null);
  const clearBlockPreviewRef = useRef(() => {});
  const clearMoveFacePreviewRef = useRef(() => {});
  const clearDeleteFacePreviewRef = useRef(() => {});
  const cutPlaneWidgetRef = useRef(null);
  const cutPiecesPreviewRef = useRef(null);
  const cutBaseMaterialRef = useRef(null);
  const cutBaseHiddenMatRef = useRef(null);
  const cutLiveKeyRef = useRef('');
  const cutLivePiecesRef = useRef(null);
  const cutPreviewGenRef = useRef(0);
  const cutPreviewTimerRef = useRef(null);
  const clearCutPiecePreviewRef = useRef(() => {});
  const [shellToast, setShellToast] = useState(null);
  const shellToastTimerRef = useRef(null);
  /** Slice C: restore Face/Edge after Fillet Accept / exit (do not snap to default). */
  const filletPriorPickModeRef = useRef('face');
  const filletBlendPreviewRef = useRef(null);

  /** Live pose of one part's solid (pick mesh or assembly mesh). */
  const overlayAnchorForRef = useRef(() => ({ t: [0, 0, 0], q: [0, 0, 0, 1] }));
  overlayAnchorForRef.current = (partId, rowPosition = null, rowQuaternion = null) => {
    const mesh = resultRef.current;
    return partOverlayPose(partId, {
      activeId: activePartIdRef.current,
      activePosition: mesh?.position ? [mesh.position.x, mesh.position.y, mesh.position.z] : null,
      activeQuaternion: mesh?.quaternion
        ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
        : null,
      solidPose: (id) => {
        const extra = assemblyExtrasRef.current?.get(id);
        if (!extra?.position) return null;
        return {
          t: [extra.position.x, extra.position.y, extra.position.z],
          q: extra.quaternion
            ? [extra.quaternion.x, extra.quaternion.y, extra.quaternion.z, extra.quaternion.w]
            : [0, 0, 0, 1],
        };
      },
      rowPosition,
      rowQuaternion,
    });
  };
  const contourAnchor = useCallback(() => {
    const mesh = resultRef.current;
    if (!mesh?.position) return null;
    return {
      t: [mesh.position.x, mesh.position.y, mesh.position.z],
      q: mesh.quaternion
        ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
        : [0, 0, 0, 1],
    };
  }, []);
  const anchorToActivePart = useCallback((obj) => {
    const mesh = resultRef.current;
    const t = mesh?.position ? [mesh.position.x, mesh.position.y, mesh.position.z] : [0, 0, 0];
    const q = mesh?.quaternion
      ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
      : null;
    return applyActivePartAnchor(obj, t, q);
  }, []);

  /**
   * Assembly translation changed, or a new part became active. Overlays keep
   * local coordinates and only the anchor moves, so a preview cannot stay
   * on the part that occupies the origin.
   */
  const syncAnchoredOverlays = useCallback(() => {
    const mesh = resultRef.current;
    const position = mesh?.position ? [mesh.position.x, mesh.position.y, mesh.position.z] : [0, 0, 0];
    const quaternion = mesh?.quaternion
      ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
      : null;
    const visit = (obj) => {
      if (!obj) return;
      if (obj.userData?.anchorToActivePart) applyActivePartAnchor(obj, position, quaternion);
      else if (obj.userData && Object.prototype.hasOwnProperty.call(obj.userData, 'overlayPartId')) {
        // Contours / work planes: that part's own pose, not the active part's.
        const at = overlayAnchorForRef.current(
          obj.userData.overlayPartId,
          obj.userData.rowPosition,
          obj.userData.rowQuaternion,
        );
        applyPartPose(obj, at);
      }
      const kids = obj.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) visit(kids[i]);
    };
    const roots = [
      edgeHighlightRef.current,
      edgeHoverRef.current,
      filletBlendPreviewRef.current,
      idLabelGroupRef.current,
      pathPreviewRef.current,
      xsPreviewRef.current,
      extrudePreviewRef.current,
      revolvePreviewRef.current,
      loftPreviewRef.current,
      sweepPreviewRef.current,
      blockPreviewRef.current,
      workplaneOverlayRef.current,
      constructionPlaneRef.current,
      polylineDraftRef.current,
      savedContourGhostRef.current,
      measurementLinesRef.current,
      movePreviewRef.current,
      rotatePreviewRef.current,
      mirrorPreviewRef.current,
      moveFacePreviewRef.current,
      cutPiecesPreviewRef.current,
      booleanPiecesPreviewRef.current,
      booleanRemotePicksRef.current,
    ];
    const highlights = highlightMeshRef.current;
    if (Array.isArray(highlights)) roots.push(...highlights);
    else if (highlights) roots.push(highlights);
    for (const mesh of jointHighlightRef.current.values()) roots.push(mesh);
    for (const root of roots) visit(root);
  }, []);
  const [filletToast, setFilletToast] = useState(null);
  const filletToastTimerRef = useRef(null);
  /** Bumps when the solid mesh is replaced so pick overlays recompute. */
  const [meshEpoch, setMeshEpoch] = useState(0);
  /** Bumps after each assembly placement so part overlays re-read scripts and poses. */
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  /** Set on Fillet Accept with preDeg; next successful run reports NEW scrap only. */
  const filletQualityWatchRef = useRef(null);
  const [filletScrapNotice, setFilletScrapNotice] = useState(null);
  /** Successful Fillet Accept already left the mode; don't toast a false re-pick. */
  const edgeRematchToastSuppressRef = useRef(false);
  /** G1 tangent chain propagation for Edge pick — ON by default (circular / fillet loops). */
  const [tangentProp, setTangentProp] = useState(true);
  const tangentPropRef = useRef(true);
  /**
   * Bottom feature card owns the camera. Game never sets this, and desktop
   * never does either: the slide is for the phone bottom sheet only.
   */
  const sheetCameraOwnedRef = useRef(false);
  /**
   * The feature-card camera slide runs only in the mobile layout. The phone
   * card covers the part, so the slide lifts the faces and edges clear of
   * it. The desktop card sits in the pane with room above it, and the model
   * must stay where the user left it when a card opens or closes. `isMobile`
   * is App's single 768px media-query flag, read live so a resize mid-card
   * takes effect on the next tick.
   */
  const isMobileRef = useRef(isMobile === true);
  isMobileRef.current = isMobile === true;
  const featureCardKindRef = useRef('');
  const yieldToFeatureEditCardRef = useRef(() => {});
  const onFeatureEditDismissRef = useRef(onFeatureEditDismiss);
  onFeatureEditDismissRef.current = onFeatureEditDismiss;
  const sheetCameraRef = useRef(null);
  if (!sheetCameraRef.current) {
    sheetCameraRef.current = createSheetCameraSession({
      getCamera: () => cameraRef.current,
      getControls: () => controlsRef.current,
      setControls: (next) => { controlsRef.current = next; },
      reducedMotion: () => typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      enabled: () => isMobileRef.current,
      getVisibleFrame: () => {
        const pane = containerRef.current;
        if (!pane || typeof pane.getBoundingClientRect !== 'function') return null;
        const card = pane.querySelector('[data-feature-card]');
        if (!card) return null;
        const canvas = canvasRef.current;
        const canvasBox = canvas && typeof canvas.getBoundingClientRect === 'function'
          ? canvas.getBoundingClientRect()
          : null;
        const paneRect = canvasBox && canvasBox.width > 0 && canvasBox.height > 0
          ? canvasBox
          : pane.getBoundingClientRect();
        return { paneRect, cardRect: card.getBoundingClientRect() };
      },
    });
  }
  const faceSketchRef = useRef(null);
  if (!faceSketchRef.current) {
    faceSketchRef.current = createFaceSketchAim({
      getCamera: () => cameraRef.current,
      getControls: () => controlsRef.current,
      setControls: (next) => { controlsRef.current = next; },
      reducedMotion: () => typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onDone: () => faceSketchFinishRef.current(),
    });
  }
  const sheetSlideDeltaRef = useRef(() => 0);
  sheetSlideDeltaRef.current = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const container = containerRef.current;
    if (!camera || !controls?.target || !container) return 0;
    const card = container.querySelector('[data-feature-card]');
    const paneBox = container.getBoundingClientRect();
    const cardBox = card ? card.getBoundingClientRect() : null;
    const pose = meshPose(resultRef.current);
    const face = selectedFaceRef.current;
    const edges = selectedEdgesRef.current;
    const bounds = modelBoundsRef.current;
    const points = [];
    const push = (arr) => {
      if (!arr || arr.length < 3) return;
      const w = pose ? shiftLocalPoint(arr, pose.t, pose.q) : arr;
      points.push(new Vector3(w[0], w[1], w[2]));
    };
    if (face?.center) push(face.center);
    else if (edges?.[0]?.mid) push(edges[0].mid);
    else if (!bounds?.min) points.push(new Vector3(...(pose?.t || [0, 0, 0])));
    if (bounds?.min && bounds?.max) {
      for (const corner of boxCornerPoints(bounds, null)) push([corner.x, corner.y, corner.z]);
    }
    if (!points.length) points.push(new Vector3(0, 0, 0));
    return featureSheetClearanceNdc({
      camera,
      controls,
      points,
      cardFraction: featureSheetCoveredFraction(paneBox, cardBox),
    });
  };

  /**
   * Toast payload. Errors carry an Undo affordance so a bad Accept is one tap
   * from reverted — the scrap notice used to just *say* "Undo restores the
   * solid" and leave the user to find the button.
   *
   * Most toasts are refusals, so `undo` defaults ON; purely informational
   * hints opt out with `{ undo: false }`. The button still only renders when
   * `canUndo` says there is history to pop.
   */
  const toastPayload = (msg, opts) => (
    msg == null ? null : { text: String(msg), undo: opts?.undo !== false, deleted: !!opts?.deleted }
  );

  const armEdgeModeToastClear = () => {
    if (edgeModeToastTimerRef.current) clearTimeout(edgeModeToastTimerRef.current);
    edgeModeToastTimerRef.current = setTimeout(() => {
      edgeModeToastTimerRef.current = null;
      setEdgeModeToast(null);
    }, 2800);
  };
  const armContourToastClear = () => {
    if (contourToastTimerRef.current) clearTimeout(contourToastTimerRef.current);
    contourToastTimerRef.current = setTimeout(() => {
      contourToastTimerRef.current = null;
      setContourToast(null);
    }, 3200);
  };
  const showContourToast = (msg, opts) => {
    setContourToast(toastPayload(msg, opts));
    armContourToastClear();
  };
  const armFilletToastClear = () => {
    if (filletToastTimerRef.current) clearTimeout(filletToastTimerRef.current);
    filletToastTimerRef.current = setTimeout(() => {
      filletToastTimerRef.current = null;
      setFilletToast(null);
    }, 3200);
  };
  const showFilletToast = (msg, opts) => {
    setFilletToast(toastPayload(msg, opts));
    armFilletToastClear();
  };
  const armShellToastClear = () => {
    if (shellToastTimerRef.current) clearTimeout(shellToastTimerRef.current);
    shellToastTimerRef.current = setTimeout(() => {
      shellToastTimerRef.current = null;
      setShellToast(null);
    }, 3200);
  };
  const showShellToast = (msg, opts) => {
    setShellToast(toastPayload(msg, opts));
    armShellToastClear();
  };
  const [materials, setMaterials] = useState([]);
  const materialsRef = useRef(materials);
  materialsRef.current = materials;
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionError, setExecutionError] = useState(null);
  useEffect(() => {
    if (!executionError) return;
    if (featureDeleteToastTimerRef.current) {
      clearTimeout(featureDeleteToastTimerRef.current);
      featureDeleteToastTimerRef.current = null;
    }
    setFeatureDeleteToast(null);
  }, [executionError]);
  
  // Cross-section state
  const [crossSectionEnabled, setCrossSectionEnabled] = useState(false);
  crossSectionEnabledRef.current = crossSectionEnabled;
  const [modelBounds, setModelBounds] = useState(null);
  // Mouse handlers must resolve the workplane against live bounds without
  // rebinding listeners on every recompute.
  const modelBoundsRef = useRef(null);
  modelBoundsRef.current = modelBounds;
  agentSheetHostRef.current = createSheetAgentHandlers({
    appMode: mode,
    modeRef: sheetMetalModeRef,
    pickerRef: sheetMetalPickerRef,
    setMode: setSheetMetalMode,
    setPicker: setSheetMetalPicker,
    onBindSheetMetal,
    onCommitSheetMetal,
    getHelperBuffer,
    cancelFeatureEdit: (kind) => cancelFeatureEditRef.current?.(kind),
    selectSheetChip: (chip) => selectSheetChipRef.current?.(chip),
    beginFeatureEdit: (marker, script) => beginFeatureEditRef.current?.(marker, script) === true,
    characteristicLengthMm,
    modelBoundsRef,
    willCreatePart: () => (getSheetMetalReady ? !getSheetMetalReady() : false),
  });
  // After modelBounds. The dep array is evaluated during render; reading the
  // state earlier is a temporal dead zone and the production bundle white-screens.
  const [helperCardOpen, setHelperCardOpen] = useState(false);
  const helperCardOpenRef = useRef(false);
  helperCardOpenRef.current = helperCardOpen;
  const helperSheetOpen = mode !== 'game' && helperCardOpen;
  const contourSession = mode !== 'game' && !!contourMode;
  const gestureSheetOpen = contourSession && !contourPlaneOpen
    && (contourMode?.gesture === 'dimension' || contourMode?.gesture === 'constraints');
  const contourSheetOpen = (contourSession && contourPlaneOpen) || gestureSheetOpen;
  const featureSlotSheetOpen = mode !== 'game' && !!featureSlots && !contourMode;
  const filletSheetOpen = mode !== 'game' && !!filletMode;
  const shellSheetOpen = mode !== 'game' && !!shellMode;
  const draftSheetOpen = mode !== 'game' && !!draftMode;
  const moveFaceSheetOpen = mode !== 'game' && !!moveFaceMode;
  const deleteFaceSheetOpen = mode !== 'game' && !!deleteFaceMode;
  const cutSheetOpen = mode !== 'game' && !!cutMode;
  const booleanSheetOpen = mode !== 'game' && !!booleanMode;
  const moveSheetOpen = mode !== 'game' && !!moveMode;
  const rotateSheetOpen = mode !== 'game' && !!rotateMode;
  const mirrorSheetOpen = mode !== 'game' && !!mirrorMode;
  const sheetMetalSheetOpen = mode !== 'game' && (!!sheetMetalMode || !!sheetMetalPicker);
  const sheetMetalCardKey = sheetMetalPicker
    ? 'picker'
    : sheetMetalMode?.exportOpen
      ? 'export'
      : sheetMetalMode?.draft?.kind
        ? String(sheetMetalMode.draft.kind)
        : (sheetMetalMode?.stage || 'edit');
  const paintSheetOpen = mode !== 'game' && !!paintMode;
  const feaSheetOpen = mode !== 'game' && feaActive;
  const [measurementEnabled, setMeasurementEnabled] = useState(false);
  const [measurePicks, setMeasurePicks] = useState([]);
  measurementEnabledRef.current = measurementEnabled;
  const measureSheetOpen = mode !== 'game' && measurementEnabled;
  const featureEditRequested = mode !== 'game'
    && !!featureEdit
    && (featureEdit.mode === 'edit' || featureEdit.mode === 'picker');
  const editSheetOpen = featureEditRequested
    && !featureSlots
    && !contourSession
    && !filletSheetOpen
    && !shellSheetOpen
    && !draftSheetOpen
    && !moveFaceSheetOpen
    && !deleteFaceSheetOpen
    && !cutSheetOpen
    && !booleanSheetOpen
    && !moveSheetOpen
    && !rotateSheetOpen
    && !sheetMetalSheetOpen
    && !helperSheetOpen
    && !paintSheetOpen
    && !feaActive;
  const edgeSheetOpen = mode !== 'game'
    && !helperCardOpen
    && !editSheetOpen
    && pickMode === 'edge'
    && !contourMode
    && !featureSlots
    && !filletMode
    && !shellMode
    && !draftMode
    && !moveFaceMode
    && !deleteFaceMode
    && !cutMode
    && !booleanMode
    && !moveMode
    && !rotateMode
    && !mirrorMode
    && !sheetMetalMode
    && !sheetMetalPicker
    && !feaActive
    && !measurementEnabled
    && !paintMode && selectedEdges.length > 0;
  const featureCardKind = filletSheetOpen
    ? 'fillet'
    : featureSlotSheetOpen
      ? `slots:${featureSlots.kind}`
      : contourSheetOpen
        ? 'contour'
      : shellSheetOpen
        ? 'shell'
        : draftSheetOpen
          ? 'draft'
          : moveFaceSheetOpen
            ? 'moveFace'
            : deleteFaceSheetOpen
              ? 'deleteFace'
              : cutSheetOpen
                ? 'cut'
                : booleanSheetOpen
                  ? 'boolean'
                  : moveSheetOpen
                    ? 'move'
                    : rotateSheetOpen
                      ? 'rotate'
                      : mirrorSheetOpen
                        ? 'mirror'
                    : sheetMetalSheetOpen
                      ? `sheetMetal:${sheetMetalCardKey}`
                      : paintSheetOpen
                        ? 'paint'
                        : feaSheetOpen
                          ? 'fea'
                          : helperSheetOpen
                          ? 'helper'
                          : editSheetOpen
                            ? `edit:${featureEdit.mode}:${featureEdit.feature?.id || 'picker'}`
                            : edgeSheetOpen
                              ? 'edge'
                              : measureSheetOpen
                                ? 'measure'
                                : (mode !== 'game' && jointCard)
                                  ? 'joint'
                                  : '';
  featureCardKindRef.current = featureCardKind;
  sheetCameraOwnedRef.current = featureCardKind !== '' && isMobile === true;
  const featurePopupOpen = mode !== 'game' && (
    featureCardKind !== '' || (!!holeCard && !contourMode)
  );
  const onFeatureCardChangeRef = useRef(onFeatureCardChange);
  onFeatureCardChangeRef.current = onFeatureCardChange;
  useEffect(() => {
    onFeatureCardChangeRef.current?.(featurePopupOpen);
    return () => {
      if (featurePopupOpen) onFeatureCardChangeRef.current?.(false);
    };
  }, [featurePopupOpen]);
  // A view snap or zoom-to-fit wins over the card slide. Close still restores
  // the snapshot taken when the card opened.
  const sheetSlideArmedRef = useRef(true);
  const holdSheetSlide = () => {
    sheetSlideArmedRef.current = false;
    // A snap with no card open must not freeze the next card's restore pose.
    if (featureCardKindRef.current) sheetCameraRef.current?.slideBy(0);
  };
  useEffect(() => {
    if (!featureCardKind) return undefined;
    sheetSlideArmedRef.current = true;
    let alive = true;
    const tick = () => {
      if (!alive || !sheetSlideArmedRef.current) return;
      // Focused-field edit shrinks the card over the keyboard. Another slide
      // would pan from the pose the full card already set. Close still restores.
      if (pane?.querySelector('[data-feature-card][data-feature-field-edit]')) return;
      sheetCameraRef.current?.slideBy(sheetSlideDeltaRef.current());
    };
    const raf = requestAnimationFrame(tick);
    const pane = containerRef.current;
    const ro = new ResizeObserver(tick);
    if (pane) ro.observe(pane);
    const card = pane?.querySelector('[data-feature-card]');
    if (card) ro.observe(card);
    const watch = requestAnimationFrame(() => {
      const next = pane?.querySelector('[data-feature-card]');
      if (next) ro.observe(next);
      tick();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(watch);
      ro.disconnect();
      // A different open card keeps the first snapshot. Close and unmount restore.
      const next = featureCardKindRef.current;
      if (!next || next === featureCardKind) sheetCameraRef.current?.restore();
    };
  }, [featureCardKind]);
  useEffect(() => {
    if (!featureCardKind) return undefined;
    const raf = requestAnimationFrame(() => {
      if (!sheetSlideArmedRef.current) return;
      sheetCameraRef.current?.slideBy(sheetSlideDeltaRef.current());
    });
    return () => cancelAnimationFrame(raf);
  }, [featureCardKind, selectedFace, selectedEdges, modelBounds]);
  useEffect(() => {
    if (!featureCardKind || String(featureCardKind).startsWith('edit:')) return undefined;
    onFeatureEditDismissRef.current?.();
    return undefined;
  }, [featureCardKind]);
  const [cachedMeshData, setCachedMeshData] = useState(null);
  /** Always-current mesh for failed Auto-Run restore (state alone is stale in closures). */
  const cachedMeshDataRef = useRef(null);
  
  // measurementEnabled is declared above measureSheetOpen; the card kind is
  // computed before this point.
  // Re-frame the part after each successful run, preserving the current orbit direction.
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);

  pickModeRef.current = pickMode;
  showPlanesRef.current = showPlanes;
  showContoursRef.current = showContours;
  tangentPropRef.current = tangentProp;
  cachedMeshDataRef.current = cachedMeshData;
  if (contourLiveWriteRef.current != null && contourLiveWriteRef.current !== contourMode) {
    // Keep the live sketch; a slower render of the previous tool must not
    // clobber sketch_add (h10 pick_points arc a0).
  } else {
    contourModeRef.current = contourMode;
    contourLiveWriteRef.current = null;
  }
  contourPlaneOpenRef.current = contourPlaneOpen;
  filletModeRef.current = filletMode;
  shellModeRef.current = shellMode;
  paintModeRef.current = paintMode;
  draftModeRef.current = draftMode;
  cutModeRef.current = cutMode;
  booleanModeRef.current = booleanMode;
  moveModeRef.current = moveMode;
  rotateModeRef.current = rotateMode;
  mirrorModeRef.current = mirrorMode;
  moveFaceModeRef.current = moveFaceMode;
  deleteFaceModeRef.current = deleteFaceMode;
  onPickRetargetRef.current = onPickRetarget;
  const onCadEmptyClickRef = useRef(null);
  onCadEmptyClickRef.current = onCadEmptyClick;
  const onJointPickRef = useRef(null);
  onJointPickRef.current = onJointPick;
  const jointPickingRef = useRef(false);
  jointPickingRef.current = !!jointPicking;
  onFeatureSessionChangeRef.current = onFeatureSessionChange;
  onSketchStripChangeRef.current = onSketchStripChange;
  onSheetStripChangeRef.current = onSheetStripChange;
  getHelperBufferRef.current = getHelperBuffer;
  partLabelsRef.current = partLabels || {};
  getBooleanContextRef.current = getBooleanContext;
  const onRunOutcomeRef = useRef(null);
  onRunOutcomeRef.current = onRunOutcome;
  const rollbackAnchorRef = useRef(rollbackAnchor);
  rollbackAnchorRef.current = rollbackAnchor;
  const onContourRefsResolvedRef = useRef(null);
  onContourRefsResolvedRef.current = onContourRefsResolved;
  featureSessionRef.current = !!(
    contourMode || filletMode || shellMode || draftMode || cutMode
    || booleanMode || moveMode || rotateMode || moveFaceMode || deleteFaceMode
    || paintMode
    || feaActive
  );

  useEffect(() => {
    onFeatureSessionChangeRef.current?.(featureSessionRef.current);
  }, [
    contourMode, filletMode, shellMode, draftMode, cutMode,
    booleanMode, moveMode, rotateMode, moveFaceMode, deleteFaceMode, paintMode, feaActive,
  ]);

  useEffect(() => {
    if (mode === 'game') {
      exitPaintModeRef.current();
      feaCloseRef.current();
      exitMeasureModeRef.current();
    }
  }, [mode]);

  useEffect(() => {
    if (helperCardOpen && feaActive) feaCloseRef.current();
  }, [helperCardOpen, feaActive]);

  useEffect(() => {
    if (!paintMode) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      exitPaintModeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paintMode]);

  useImperativeHandle(ref, () => ({
    executeScript,
    /** Clear player attempt mesh (game mode enter: ghost-only until Run). */
    clearAttempt: () => {
      // Game enter nulls contour mode without exitContourMode.
      releaseContourOverlays(overlayVis);
      clearHighlight();
      disposeEdgeOverlayObject(sceneRef.current, edgeHighlightRef.current);
      edgeHighlightRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, edgeHoverRef.current);
      edgeHoverRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, xsPreviewRef.current);
      xsPreviewRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, pathPreviewRef.current);
      pathPreviewRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, workplaneOverlayRef.current);
      workplaneOverlayRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, polylineDraftRef.current);
      polylineDraftRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, extrudePreviewRef.current);
      extrudePreviewRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, revolvePreviewRef.current);
      revolvePreviewRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, loftPreviewRef.current);
      loftPreviewRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, sweepPreviewRef.current);
      sweepPreviewRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, filletBlendPreviewRef.current);
      filletBlendPreviewRef.current = null;
      setContourMode(null);
      contourModeRef.current = null;
      contourPlaneOpenRef.current = false;
      setContourPlaneOpen(false);
      setFilletMode(null);
      filletModeRef.current = null;
      setShellMode(null);
      shellModeRef.current = null;
      setDraftMode(null);
      draftModeRef.current = null;
      setCutMode(null);
      cutModeRef.current = null;
      setBooleanMode(null);
      booleanModeRef.current = null;
      setMoveMode(null);
      moveModeRef.current = null;
      clearRotatePreviewRef.current();
      setRotateMode(null);
      rotateModeRef.current = null;
      dropMirrorModeRef.current();
      clearMoveFacePreviewRef.current();
      setMoveFaceMode(null);
      moveFaceModeRef.current = null;
      clearDeleteFacePreviewRef.current();
      setDeleteFaceMode(null);
      deleteFaceModeRef.current = null;
      setContourToast(null);
      setFilletToast(null);
      setShellToast(null);
      setSelectedFace(null);
      setSelectedEdges([]);
      onFaceSelected?.(null);
      setCachedMeshData(null);
      stageExecErrorRef.current = null;
      setExecutionError(null);
      setModelBounds(null);
      if (resultRef.current) {
        removeContactSeam(resultRef.current);
        resultRef.current.geometry?.dispose();
        resultRef.current.geometry = new BufferGeometry();
        resultRef.current.position.set(0, 0, 0);
      }
      clearAssemblyExtrasRef.current();
      featureEdgesRef.current = [];
      featureEdgesSourceRef.current = null;
    },
    /** Frame ghost with phone-friendly margin (puzzle enter / switch). */
    frameGhost: () => {
      const geom = ghostMeshRef.current?.geometry;
      // Skip empty BufferGeometry ghosts (cleared state) before fitView bbox work.
      if (!geom?.attributes?.position || !cameraRef.current) return false;
      return fitView({
        camera: cameraRef.current,
        controls: controlsRef.current,
        geometry: geom,
        margin: 1.55,
      });
    },
    clearFaceSelection: () => {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
    },
    clearEdgeSelection: () => {
      disposeEdgeOverlayObject(sceneRef.current, edgeHighlightRef.current);
      edgeHighlightRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, edgeHoverRef.current);
      edgeHoverRef.current = null;
      setSelectedEdges([]);
    },
    /** Soft-fail: clear stale edges + toast — never paired with emitting broken JS. */
    softFailStaleEdges: (msg) => {
      disposeEdgeOverlayObject(sceneRef.current, edgeHighlightRef.current);
      edgeHighlightRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, edgeHoverRef.current);
      edgeHoverRef.current = null;
      disposeEdgeOverlayObject(sceneRef.current, pathPreviewRef.current);
      pathPreviewRef.current = null;
      setSelectedEdges([]);
      setEdgeModeToast(toastPayload(msg || 'Re-pick edges after geometry changes'));
      armEdgeModeToastClear();
    },
    setPickMode: (mode) => setPickMode(mode === 'edge' ? 'edge' : 'face'),
    /** Slice 24: loud-fail toast while contour mode is open. */
    softFailContour: (msg) => {
      showContourToast(msg || 'Contour mode refused — check the workplane / profile.');
    },
    /** Slice 27: loud-fail toast — keep the path visible (do not clear edges). */
    softFailFillet: (msg) => {
      showFilletToast(msg || (filletModeRef.current?.entry === 'chamferEdges'
        ? 'Chamfer refused — pick edges (disjoint sets chamfer independently), then Accept.'
        : 'Fillet refused — pick edges (disjoint sets fillet independently), then Accept.'));
    },
    softFailShell: (msg) => {
      showShellToast(msg || 'Shell refused — tap a face or choose Closed, then Confirm.');
    },
    softFailDraft: (msg) => {
      showShellToast(msg || 'Draft refused — tap the neutral face, then the faces to draft.');
    },
    softFailCut: (msg) => {
      showShellToast(msg || 'Cut refused — pick a plane and the bodies to cut.');
    },
    softFailBoolean: (msg) => {
      showShellToast(msg || 'Boolean refused — pick a target and a tool body.');
    },
    /** Short note in the picker toast slot (cross-part writes). `{ undo: false }` hides the Undo button. */
    notify: (msg, opts) => {
      if (msg) showShellToast(msg, opts);
    },
    softFailMove: (msg) => {
      showShellToast(msg || 'Move refused — double-click a body, then Confirm.');
    },
    softFailRotate: (msg) => {
      showShellToast(msg || 'Rotate refused — double-click a body, then Confirm.');
    },
    softFailMirror: (msg) => {
      showShellToast(msg || 'Mirror refused — double-click a body and pick a plane, then Confirm.');
    },
    softFailMoveFace: (msg) => {
      showShellToast(msg || 'Move Face refused — tap a face, then Confirm.');
    },
    softFailDeleteFace: (msg) => {
      showShellToast(msg || 'Delete Face refused — tap a face, then Confirm.');
    },
    // Updated to use cached mesh when available
    export3MF: async () => {
      if (cachedMeshData?.vertProperties) {
        return get3MFBase64FromMesh(cachedMeshData);
      }
      throw new Error('No model available to export');
    },
    calculateQuote: async (options) => {
      return await calculateQuote(currentScript, options);
    },
    zoomToFit: handleZoomToFit,
    getCurrentMeshData: () => cachedMeshData,
    /**
     * Place visible assembly solids that are not the active part, and move
     * the active solid when the row stores a position. Graphs rebind to the
     * active mesh only. Other visible parts and failed-row leftovers raycast;
     * a pick retargets onto that part before the graphs are used.
     */
    beginFeatureEdit: (feature, script) => beginFeatureEditRef.current?.(feature, script) === true,
    /** Open a saved contour in the contour editor. The strip uses this. */
    beginContourEdit: (contourId) => beginContourEditRef.current?.(contourId) === true,
    /** Sketch-strip Undo. The bar has no redo stack. */
    undoContourSketch: () => undoContourSketchRef.current?.(),
    /** Sketch-strip chip. A dimension or constraint opens its card. */
    selectSketchEntity: (chip) => selectSketchEntityRef.current?.(chip),
    /** Sheet-ribbon chip. Highlights that chip. Does not open its card. */
    selectSheetChip: (chip) => selectSheetChipRef.current?.(chip),
    /** Close every other card without writing, so the edit card can open alone. */
    yieldToFeatureEditCard: () => yieldToFeatureEditCardRef.current(),
    placeAssembly: (payload) => placeAssemblyRef.current(payload),
    /** Face colors on the meshes just placed that this run will not draw. */
    readDroppedPaints: (colors) => readDroppedPaintsRef.current(colors),
    /** Move the pick mesh onto a part the user just touched. */
    swapPickPart: (payload) => swapPickPartRef.current(payload),
    /** Highlight the whole active solid. Parts-row and body picks use this. */
    showCadBodyHighlight: () => showCadBodyHighlightRef.current(),
    /** Install one part's solid and rebuild face, edge, and contour graphs. */
    adoptActiveSolid: (payload) => adoptActiveSolidRef.current(payload),
    /** True while a bottom feature card owns the camera: phone layout only. Game and desktop are never. */
    featureSheetCameraOwned: () => sheetCameraOwnedRef.current,
    /** Drop joint-pick face highlights. A part id drops one side; omit it to drop both. */
    clearJointHighlights: (partId) => clearJointHighlightsRef.current(partId),
    /** Repaint the faces of a joint a strip chip just reopened. */
    showJointPickHighlights: (entries) => {
      clearJointHighlightsRef.current();
      const meshFor = (partId) => {
        if (String(activePartIdRef.current) === String(partId)) return resultRef.current;
        return assemblyExtrasRef.current.get(String(partId)) || assemblyExtrasRef.current.get(partId) || null;
      };
      for (const entry of Array.isArray(entries) ? entries : []) {
        const mesh = meshFor(entry?.partId);
        const positions = mesh?.geometry?.attributes?.position;
        const index = mesh?.geometry?.index?.array;
        if (!positions || !index || !entry?.tris?.length) continue;
        paintJointHighlightRef.current(entry.partId, entry.tris, positions, index, entry.at || null);
      }
      const cam = cameraRef.current;
      if (rendererRef.current && sceneRef.current && cam) {
        rendererRef.current.render(sceneRef.current, cam);
      }
    },
    describeJointPick: (args) => agentDescribeJointPickRef.current(args),
    /**
     * Viewport image. One render, then encode on this thread. Options
     * (max_width, scale, jpeg) downscale here before the data URL is built.
     * Omit them for the historical full-size PNG.
     */
    capturePng: (opts) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera) return null;
      // On a phone an open feature card pans the view with a projection
      // offset so the model sits in the band above the card. A capture is the
      // whole frame: render it centered on the target, then put the offset
      // back. Desktop never sets the offset, so the capture is the live view.
      const view = camera.view?.enabled ? { ...camera.view } : null;
      if (view) {
        camera.clearViewOffset();
        camera.updateProjectionMatrix();
      }
      try {
        renderer.render(scene, camera);
        return encodeCanvasImage(renderer.domElement, opts || {});
      } catch {
        return null;
      } finally {
        if (view) {
          camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        }
      }
    },
  }));

  // Same capture as capturePng. The call happens after commit, when the
  // imperative handle is current.
  if (agentHostRef) {
    fillAgentHost(agentHostRef, {
      screenshot: (opts) => ref?.current?.capturePng?.(opts) ?? null,
      readViewportSelection() {
        return buildSelection({
          activePartId: activePartIdRef.current,
          face: selectedFaceRef.current,
          edges: selectedEdgesRef.current,
          armedContourId,
          selectedPlaneId,
        });
      },
      readSketchHistory() {
        const depth = sketchHistRef.current?.depth || 0;
        const entries = [];
        for (let index = 0; index <= depth; index += 1) {
          entries.push({
            index,
            label: index === 0 ? 'Sketch start' : 'Sketch edit',
            current: index === depth,
          });
        }
        return { depth, entries };
      },
      agentSketchUndo() {
        const depthBefore = sketchHistRef.current?.depth || 0;
        if (depthBefore <= 0) return { ok: false };
        undoContourSketchRef.current?.();
        const depthAfter = sketchHistRef.current?.depth || 0;
        if (depthAfter >= depthBefore) return { ok: false };
        const tool = contourModeRef.current?.tool || null;
        return {
          ok: true,
          depthBefore,
          depthAfter,
          tool,
        };
      },
      readMode() {
        const viewportFeatureEditSummary = () => {
          const edit = featureEditRef.current;
          if (edit?.feature) {
            return { mode: 'edit', feature: edit.feature, dialog: edit.dialog || null, opening: !!edit.opening };
          }
          const helper = helperEditRef.current;
          if (helper?.feature) return { mode: 'edit', feature: helper.feature, dialog: 'helper' };
          return null;
        };
        // The ref, not the last paint. sketch_add and cancel write it
        // before React flushes; a mode() on the next agent call must see
        // that, or a closed peek still reports contour.
        const contourLive = contourModeRef.current;
        return buildAgentMode({
          appMode: mode,
          contour: contourLive
            ? {
              ...contourLive,
              planeOpen: !!contourPlaneOpenRef.current,
            }
            : null,
          featureSlots: featureSlots ? { kind: featureSlots.kind } : null,
          fillet: filletMode
            ? { entry: filletMode.entry, edgeCount: selectedEdges.length }
            : null,
          shell: !!shellMode,
          draft: !!draftMode,
          cut: !!cutMode,
          boolean: !!booleanMode,
          move: !!moveMode,
          rotate: !!rotateMode,
          moveFace: !!moveFaceMode,
          deleteFace: !!deleteFaceMode,
          paint: !!paintMode,
          measure: measurementEnabled,
          fea: !!(feaActiveRef.current || feaPanelRef.current?.open),
          sheetMetal: sheetMetalMode,
          sheetMetalPicker: !!sheetMetalPicker,
          holeCard: !!holeCard,
          jointPicking: !!jointPicking,
          // The App sheet, else the viewport's own edit (fillet card, helper
          // card, contour reopen): `featureEdit` alone was the sheet prop, so
          // mode.featureEdit stayed null while open_feature had a card up
          // (Pi 5 C4).
          featureEdit: featureEdit || viewportFeatureEditSummary(),
        });
      },
      readCamera() {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera) return buildCameraState({});
        return buildCameraState({
          position: camera.position,
          quaternion: camera.quaternion,
          target: controls?.target,
          zoom: camera.zoom,
          fov: camera.fov,
        });
      },
      readViewportToasts() {
        return viewportToastRows({
          executionError: stageExecErrorRef.current || executionError,
          shellToast,
        });
      },
      clearSelection: () => agentClearSelectionRef.current(),
      selectFaces: (args) => agentSelectFacesRef.current(args),
      selectEdges: (args) => agentSelectEdgesRef.current(args),
      ...agentPickHostRef.current,
      setCamera: (args) => agentSetCameraRef.current(args),
      fitCamera: () => agentFitCameraRef.current(),
      zoomToSelection: () => agentZoomToSelectionRef.current(),
      listFaces: (args) => agentListFacesRef.current(args),
      moldFit: (args) => agentMoldFitRef.current(args),
      moldPull: (args) => applySharedPullRef.current(args),
      moldWallMap: (args) => agentMoldWallMapRef.current(args),
      moldParting: (args) => agentMoldPartingRef.current(args),
      moldSideActions: (args) => agentMoldSideActionsRef.current(args),
      moldDraft: (args) => agentMoldDraftRef.current(args),
      moldDfm: (args) => agentMoldDfmRef.current(args),
      moldQuote: (args) => agentMoldQuoteRef.current(args),
      moldRequestFirmQuote: (args) => agentMoldFirmQuoteRef.current(args),
      moldRequestHumanReview: (args) => agentMoldHumanReviewRef.current(args),
      moldPayHumanReview: (args) => agentMoldPayReviewRef.current(args),
      readBodies: () => agentReadBodiesRef.current(),
      resolveMoveAnchor: (args) => agentResolveMoveAnchorRef.current(args),
      listEdges: (args) => agentListEdgesRef.current(args),
      listFeatureEdges: (args) => agentListFeatureEdgesRef.current(args),
      agentReadFeatureEdit() {
        const edit = featureEditRef.current;
        const helper = helperEditRef.current;
        if (edit?.feature) {
          return {
            open: true,
            feature: {
              id: edit.feature.id,
              kind: edit.feature.kind,
              index: edit.feature.index,
            },
            fields: { ...(edit.session?.fields || {}), ...(helper?.fields || {}) },
          };
        }
        if (helper?.feature) {
          return {
            open: true,
            feature: {
              id: helper.feature.id,
              kind: helper.feature.kind,
              index: helper.feature.index,
            },
            fields: { ...(helper.fields || {}) },
          };
        }
        return { open: false };
      },
      agentPatchFeatureEdit(fields) {
        const bag = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
        const edit = featureEditRef.current;
        const helper = helperEditRef.current;
        if (!edit?.feature && !helper?.feature) {
          return { error: { code: 'no_feature_edit', message: 'No viewport feature edit is open' } };
        }
        if (edit?.feature) {
          edit.session = {
            ...edit.session,
            fields: { ...(edit.session?.fields || {}), ...bag },
          };
        }
        if (helper?.feature) {
          setHelperEdit((prev) => (prev ? { ...prev, fields: { ...(prev.fields || {}), ...bag } } : prev));
        }
        return { ok: true };
      },
      agentConfirmFeatureEdit({ fields } = {}) {
        const edit = featureEditRef.current;
        if (!edit?.feature) return false;
        const bag = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
        const draft = {
          fields: { ...(edit.session?.fields || {}), ...bag },
        };
        return commitFeatureEditRef.current?.(draft) ?? false;
      },
      agentCancelFeatureEdit() {
        const edit = featureEditRef.current;
        if (!edit?.feature) return;
        const dialog = edit.dialog || edit.kind;
        cancelFeatureEditRef.current?.(dialog);
        // The card the edit opened (Fillet, Chamfer, Shell, …) is a viewport
        // mode; the UI's X leaves it, so cancel_feature leaves it too (B12:
        // the viewport stayed in chamfer mode with no edit open).
        exitFeatureEditModeRef.current(dialog);
      },
      /**
       * Close the edit after the agent's confirm wrote the script through
       * mutate. Cancel would re-run the pre-edit script as a preview and paint
       * the old solid over the new one; this restores only when the buffer is
       * unchanged (an unchanged confirm), the same rule as the UI commit.
       */
      agentSettleFeatureEdit() {
        const edit = featureEditRef.current;
        if (!edit?.feature) return false;
        const live = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
        const full = edit.previewed && live === edit.script ? edit.script : '';
        featureEditRef.current = null;
        setHelperEdit(null);
        setFeatureEditBanner('');
        setFeatureDeleteConfirm(null);
        if (full && assemblyRunLockRef?.current !== true) executeScriptRef.current?.(full, { editPreview: true });
        return true;
      },
      /** Drop the edit with no run: the caller is about to write and run the script. */
      agentDismissFeatureEdit() {
        featureEditRef.current = null;
        setHelperEdit(null);
        setFeatureEditBanner('');
        setFeatureDeleteConfirm(null);
      },
      agentReadHoleEdit() {
        const edit = holeEditRef.current;
        if (!edit) return { open: false };
        return {
          open: true,
          feature: edit.feature || null,
          card: holeCardRef.current,
        };
      },
      agentPatchHoleCard(patch) {
        if (!holeEditRef.current) {
          return { error: { code: 'no_feature_edit', message: 'No hole edit session is open' } };
        }
        const bag = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
        setHoleCard((prev) => ({ ...(prev || defaultHoleCard()), ...bag }));
        return { ok: true };
      },
      holeOpen() {
        if (mode === 'game') {
          return { error: { code: 'bad_view', message: 'Hole is not available in game mode' } };
        }
        if (!allowFeaturePopup()) return { result: { open: false, suppressed: true } };
        if (contourModeRef.current || holeCardRef.current) {
          return { error: { code: 'picker_busy', message: 'Close the open sketch or hole card first' } };
        }
        holeSpecRef.current = null;
        holeEditRef.current = null;
        holeCentresEditRef.current = null;
        setHoleCard(defaultHoleCard());
        return { result: { open: true } };
      },
      holeSetParams({ patch } = {}) {
        if (!holeCardRef.current) {
          return { error: { code: 'no_hole_card', message: 'Call hole_open before hole_set_params' } };
        }
        const bag = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
        setHoleCard((prev) => ({ ...(prev || defaultHoleCard()), ...bag }));
        return { result: { ok: true } };
      },
      holeBeginCentres() {
        if (!holeCardRef.current) {
          return { error: { code: 'no_hole_card', message: 'Call hole_open before hole_begin_centres' } };
        }
        agentHoleBeginCentresRef.current?.();
        return { result: { centres: true } };
      },
      holeCancel() {
        if (holeCardRef.current) {
          holeSpecRef.current = null;
          holeEditRef.current = null;
          holeCentresEditRef.current = null;
          setHoleCard(null);
          return { result: { cancelled: true, card: true } };
        }
        if (contourModeRef.current && isHoleEntry(contourModeRef.current.entry)) {
          agentSketchCancelRef.current?.();
          return { result: { cancelled: true, sketch: true } };
        }
        return { error: { code: 'no_hole_card', message: 'No hole card or hole sketch is open' } };
      },
      finishHoleCommit() {
        if (contourModeRef.current && isHoleEntry(contourModeRef.current.entry)) {
          agentFinishHoleSketchRef.current?.();
        }
        holeSpecRef.current = null;
        holeEditRef.current = null;
        holeCentresEditRef.current = null;
        setHoleCard(null);
      },
      planeSet(args = {}) {
        if (!contourModeRef.current || !contourPlaneOpenRef.current) {
          return { error: { code: 'plane_card_open', message: 'The plane card is not open' } };
        }
        const applied = planePatchFromArgs(
          contourModeRef.current,
          args,
          contourHostCenter(modelBoundsRef.current),
        );
        if (applied.error) return applied;
        contourModeRef.current = applied.state;
        setContourMode(applied.state);
        return { result: { ok: true } };
      },
      workplaneSelect({ plane_id } = {}) {
        if (!contourModeRef.current || !contourPlaneOpenRef.current) {
          return { error: { code: 'plane_card_open', message: 'The plane card is not open' } };
        }
        const hit = resolveConstructionPlane(constructionPlanesRef.current, plane_id);
        if (!hit?.plane) {
          return { error: { code: 'unknown_plane', message: `Unknown workplane id: ${plane_id}` } };
        }
        releaseWorkplaneFaceRef.current();
        setSelectedPlaneId(hit.id || null);
        setContourMode((prev) => (prev
          ? applyContourPlaneEdit(prev, {
            preset: 'workplane',
            base: hit.plane,
            angles: { x: 0, y: 0, z: 0 },
          })
          : prev));
        return { result: { plane_id: hit.id } };
      },
      setSketchOverlayVisible({ enabled } = {}) {
        const next = enabled == null ? !showContoursRef.current : !!enabled;
        setShowContours(next);
        return { result: { enabled: next } };
      },
      setActiveWorkplane({ plane_id, clear } = {}) {
        if (clear === true) {
          setSelectedPlaneId(null);
          return { result: { plane_id: null } };
        }
        if (plane_id != null) {
          const hit = resolveConstructionPlane(constructionPlanesRef.current, plane_id);
          if (!hit) {
            return { error: { code: 'unknown_plane', message: `Unknown workplane id: ${plane_id}` } };
          }
          setSelectedPlaneId(hit.id);
          return { result: { plane_id: hit.id } };
        }
        return { error: { code: 'bad_args', message: 'set_active_workplane needs plane_id or clear' } };
      },
      listSketchEntities() {
        const fn = agentSketchPickRef.current?.listSketchEntities;
        return typeof fn === 'function' ? fn() : { error: { code: 'internal', message: 'listSketchEntities missing' } };
      },
      agentConfirmHoleEdit() {
        if (!holeEditRef.current) return false;
        confirmHoleEditRef.current?.();
        return !holeEditRef.current;
      },
      agentCancelHoleEdit() {
        if (!holeEditRef.current) return;
        holeSpecRef.current = null;
        holeEditRef.current = null;
        setHoleCard(null);
      },
      agentHoleConfirmPayload() {
        const edit = holeEditRef.current;
        if (!edit) return null;
        const parsed = holeSpecFromCard(holeCardRef.current || defaultHoleCard());
        if (!parsed.ok) {
          return { error: { code: 'edit_failed', message: parsed.message } };
        }
        const featureId = edit.featureId || edit.feature?.id;
        if (!featureId) {
          return { error: { code: 'edit_failed', message: 'Hole confirm refused' } };
        }
        return { featureId, spec: parsed.spec };
      },
      readHelperEdgeContext: () => withEdgeNamesRef.current(selectedEdgesRef.current || []),
      sketchBegin: (args) => agentSketchBeginRef.current(args),
      sketchAcceptPlane: (args) => agentSketchAcceptPlaneRef.current(args),
      sketchAdd: (args) => agentSketchAddRef.current(args),
      sketchCancel: () => agentSketchCancelRef.current(),
      prepareSketchCommit: () => agentPrepareSketchCommitRef.current(),
      prepareHoleCommit: () => agentPrepareHoleCommitRef.current(),
      sheetOpen: () => agentSheetHostRef.current?.sheetOpen(),
      sheetStart: (args) => agentSheetHostRef.current?.sheetStart(args),
      sheetSetTool: (args) => agentSheetHostRef.current?.sheetSetTool(args),
      sheetSetParams: (args) => agentSheetHostRef.current?.sheetSetParams(args),
      sheetApplyPicks: (args) => agentSheetHostRef.current?.sheetApplyPicks(args),
      sheetCancel: () => agentSheetHostRef.current?.sheetCancel(),
      sheetExit: () => agentSheetHostRef.current?.sheetExit(),
      sheetCheck: () => agentSheetHostRef.current?.sheetCheck(),
      sheetRefold: () => agentSheetHostRef.current?.sheetRefold(),
      sheetBeginHole: () => agentSheetHostRef.current?.sheetBeginHole(),
      sheetEdit: (args) => agentSheetHostRef.current?.sheetEdit(args),
      prepareSheetCommit: () => agentSheetHostRef.current?.prepareSheetCommit(),
      finishSheetCommit: (prepared) => agentSheetHostRef.current?.finishSheetCommit(prepared),
      prepareSheetDone: () => agentSheetHostRef.current?.prepareSheetDone(),
      finishSheetDone: (prepared) => agentSheetHostRef.current?.finishSheetDone(prepared),
      paintOpen: () => agentPaintMeasureHostRef.current?.paintOpen(),
      paintClose: () => agentPaintMeasureHostRef.current?.paintClose(),
      paintCancel: () => agentPaintMeasureHostRef.current?.paintCancel(),
      paintSetColor: (args) => agentPaintMeasureHostRef.current?.paintSetColor(args),
      paintFaces: (args) => agentPaintMeasureHostRef.current?.paintFaces(args),
      paintPart: () => agentPaintMeasureHostRef.current?.paintPart(),
      paintUndo: () => agentPaintMeasureHostRef.current?.paintUndo(),
      paintClear: () => agentPaintMeasureHostRef.current?.paintClear(),
      paintConfirm: () => agentPaintMeasureHostRef.current?.paintConfirm(),
      paintState: () => agentPaintMeasureHostRef.current?.paintState(),
      measureOpen: () => agentPaintMeasureHostRef.current?.measureOpen(),
      measureClose: () => agentPaintMeasureHostRef.current?.measureClose(),
      measureSetUnit: (args) => agentPaintMeasureHostRef.current?.measureSetUnit(args),
      measurePick: (args) => agentPaintMeasureHostRef.current?.measurePick(args),
      measureClear: () => agentPaintMeasureHostRef.current?.measureClear(),
      measureState: () => agentPaintMeasureHostRef.current?.measureState(),
      feaOpen: () => agentFeaHostRef.current?.feaOpen(),
      feaClose: () => agentFeaHostRef.current?.feaClose(),
      feaSetMaterial: (args) => agentFeaHostRef.current?.feaSetMaterial(args),
      feaSetTarget: (args) => agentFeaHostRef.current?.feaSetTarget(args),
      feaSetFixture: (args) => agentFeaHostRef.current?.feaSetFixture(args),
      feaSetForce: (args) => agentFeaHostRef.current?.feaSetForce(args),
      feaSetPressureLoad: (args) => agentFeaHostRef.current?.feaSetPressureLoad(args),
      feaRemoveFixture: (args) => agentFeaHostRef.current?.feaRemoveFixture(args),
      feaRemoveLoad: (args) => agentFeaHostRef.current?.feaRemoveLoad(args),
      feaRun: () => agentFeaHostRef.current?.feaRun(),
      feaCancel: () => agentFeaHostRef.current?.feaCancel(),
      feaBackToSetup: () => agentFeaHostRef.current?.feaBackToSetup(),
      feaState: (args) => agentFeaHostRef.current?.feaState(args),
      feaResults: (args) => agentFeaHostRef.current?.feaResults(args),
      feaPick: (args) => agentFeaHostRef.current?.feaPick(args),
      crossSectionToggle: (args) => agentXsectionHostRef.current?.crossSectionToggle(args),
      crossSectionExpand: (args) => agentXsectionHostRef.current?.crossSectionExpand(args),
      crossSectionPlane: (args) => agentXsectionHostRef.current?.crossSectionPlane(args),
      crossSectionOffset: (args) => agentXsectionHostRef.current?.crossSectionOffset(args),
      crossSectionState: () => agentXsectionHostRef.current?.crossSectionState(),
      sketchDeleteEntity({ id } = {}) {
        const fn = applySketchEntityDeleteRef.current;
        if (typeof fn !== 'function') {
          return { error: { code: 'internal', message: 'sketchDeleteEntity missing' } };
        }
        const contour = contourModeRef.current;
        if (!contour) {
          return { error: { code: 'no_sketch', message: 'No open sketch session' } };
        }
        const ok = fn(id);
        if (!ok) {
          return { error: { code: 'unknown_entity', message: `No sketch entity with id ${id}` } };
        }
        const hist = sketchHistRef.current?.depth ?? 0;
        return { result: { ok: true, id, sketchDepth: hist } };
      },
      prepareSketchDimension: (args) => agentPrepareSketchDimensionRef.current(args),
      prepareSketchConstrain: (args) => agentPrepareSketchConstrainRef.current(args),
      finishSketchGesture: () => {
        const pending = agentPendingSketchGestureRef.current;
        agentPendingSketchGestureRef.current = null;
        if (pending) {
          contourModeRef.current = pending;
          setContourMode(pending);
        }
      },
      slotOpen: (args) => agentSlotOpenRef.current(args),
      slotAssignContour: (args) => agentSlotAssignContourRef.current(args),
      slotSetParams: (args) => agentSlotSetParamsRef.current(args),
      slotCancel: () => agentSlotCancelRef.current(),
      prepareSlotCommit: () => agentPrepareSlotCommitRef.current(),
      finishContourCommit: (args) => finishContourCommitRef.current?.(args),
    });
  }

  // Clear face highlight. A highlight carries its boundary edges as a child
  // LineSegments with its own geometry and material: those go too, or every
  // rebuild (each run, each body highlight) leaks one GPU geometry.
  const clearHighlight = useCallback(() => {
    if (highlightMeshRef.current) {
      if (Array.isArray(highlightMeshRef.current)) {
        highlightMeshRef.current.forEach(mesh => {
          sceneRef.current.remove(mesh);
          disposeObjectTree(mesh);
        });
        highlightMeshRef.current = [];
      } else {
        sceneRef.current.remove(highlightMeshRef.current);
        disposeObjectTree(highlightMeshRef.current);
        highlightMeshRef.current = null;
      }
    }
    // Losing the highlight IS losing the face selection — drop the accumulated
    // multi-pick with it (processClick reads the group before calling this, so
    // an additive click still sees the previous picks).
    facePickGroupRef.current = null;
  }, []);

  faceSketchFinishRef.current = () => {
    clearHighlight();
    setSelectedFace(null);
    onFaceSelected?.(null);
    setContourFaceAim('done');
  };

  const clearEdgeHighlight = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, edgeHighlightRef.current);
    edgeHighlightRef.current = null;
    for (const obj of edgeHighlightForeignRef.current) disposeEdgeOverlayObject(sceneRef.current, obj);
    edgeHighlightForeignRef.current = [];
  }, []);

  const clearEdgeHover = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, edgeHoverRef.current);
    edgeHoverRef.current = null;
  }, []);

  /**
   * Assembly translation of a part in the viewport. The active part (or an
   * untagged pick) reads the pick mesh. Another part reads its own mesh.
   * A part that is not drawn (hidden) returns null.
   */
  const partOffsetFor = useCallback((partId) => {
    const active = activePartIdRef.current;
    if (partId == null || partId === '' || !active || String(partId) === String(active)) {
      const mesh = resultRef.current;
      return {
        t: mesh?.position ? [mesh.position.x, mesh.position.y, mesh.position.z] : [0, 0, 0],
        q: mesh?.quaternion
          ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
          : [0, 0, 0, 1],
      };
    }
    const extra = assemblyExtrasRef.current.get(String(partId)) || assemblyExtrasRef.current.get(partId);
    if (!extra || extra.visible === false) return null;
    return {
      t: [extra.position.x, extra.position.y, extra.position.z],
      q: extra.quaternion
        ? [extra.quaternion.x, extra.quaternion.y, extra.quaternion.z, extra.quaternion.w]
        : [0, 0, 0, 1],
    };
  }, []);

  /**
   * Slice B+C: project on-geometry track points to canvas so numbered edge
   * chips stick to the selected edge under orbit (not world-floating).
   */
  const updateEdgeChips = useCallback(() => {
    const cam = cameraRef.current;
    const container = containerRef.current;
    const map = edgeChipElsRef.current;
    if (!cam || !container || !map.size) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const tmp = edgeChipProjectTmpRef.current;
    const edges = selectedEdgesRef.current || [];
    const live = new Set();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const key = selectionEdgeKey(e);
      // A pick kept on another part (Fillet / Chamfer) tracks that part's
      // position. A hidden part has no position here, so its chip hides.
      const shift = partOffsetFor(e.partId);
      if (!shift) continue;
      live.add(key);
      const el = map.get(key);
      if (!el) continue;
      const track = edgeTrackPoint(e);
      if (!track) {
        el.style.visibility = 'hidden';
        continue;
      }
      const worldTrack = track ? shiftLocalPoint(track, shift.t, shift.q) : track;
      const scr = projectWorldToCanvas(cam, worldTrack, w, h, tmp);
      if (!scr) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y}px`;
    }
    for (const [key, el] of map) {
      if (!live.has(key) && el) el.style.visibility = 'hidden';
    }
  }, [partOffsetFor]);

  const edgeLineResolution = useCallback(() => {
    const r = rendererRef.current;
    if (r) {
      const sz = r.getSize(new Vector2());
      return sz;
    }
    const el = containerRef.current;
    return new Vector2(el?.clientWidth || 1, el?.clientHeight || 1);
  }, []);

  /**
   * Fat screen-space edge overlay: translucent halo + opaque core via LineSegments2.
   * WebGL ignores LineBasicMaterial.linewidth>1 on most GPUs (esp. mobile); dual-pass
   * LineMaterial stays cheap (2 draw calls, shared segment list, no CPU tube tessellation).
   */
  const paintEdgeLines = useCallback((edges, {
    color, name, opacity = 1, corePx = EDGE_CORE_PX, haloPx = EDGE_HALO_PX,
    position = null,
    quaternion = null,
  }) => {
    if (!edges?.length || !sceneRef.current) return null;
    const positions = [];
    for (const e of edges) {
      // Slice B+C: draw the dense pre-RDP polyline so the halo sticks to the
      // real edge instead of floating on chord shortcuts through air.
      const poly = edgePolyline(e);
      if (!poly || poly.length < 2) {
        if (!e.va || !e.vb) continue;
        positions.push(e.va[0], e.va[1], e.va[2], e.vb[0], e.vb[1], e.vb[2]);
        continue;
      }
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1];
        const b = poly[i];
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
    if (!positions.length) return null;
    const res = edgeLineResolution();
    const posArr = positions; // flat xyz pairs for LineSegmentsGeometry.setPositions

    const makeSeg = (linewidth, op, renderOrder) => {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(posArr);
      const mat = new LineMaterial({
        color,
        linewidth,
        transparent: true,
        opacity: op,
        depthTest: false,
        depthWrite: false,
        worldUnits: false,
      });
      mat.resolution.set(res.x, res.y);
      const line = new LineSegments2(geom, mat);
      line.renderOrder = renderOrder;
      line.frustumCulled = false;
      return line;
    };

    const group = new Group();
    group.name = name;
    // Soft transparent halo first (under), then brighter core on top.
    group.add(makeSeg(haloPx, Math.min(0.2, opacity * 0.28), 10));
    group.add(makeSeg(corePx, opacity, 11));
    if (position) {
      // Another part's picks: fixed at that part's pose, not the pick mesh.
      applyPartPose(group, { t: position, q: quaternion || [0, 0, 0, 1] });
    } else {
      anchorToActivePart(group);
    }
    sceneRef.current.add(group);
    return group;
  }, [edgeLineResolution, anchorToActivePart]);

  const clearXsPreview = useCallback(() => {
    if (!xsPreviewRef.current) return;
    disposeEdgeOverlayObject(sceneRef.current, xsPreviewRef.current);
    xsPreviewRef.current = null;
  }, []);

  const clearSavedContourGhosts = useCallback(() => {
    if (!savedContourGhostRef.current) return;
    disposeEdgeOverlayObject(sceneRef.current, savedContourGhostRef.current);
    savedContourGhostRef.current = null;
  }, []);

  /**
   * Wire ghosts for every saved contour. The picked ghost stays amber.
   * Every other ghost uses the contour status colour (under / full / conflict).
   * An old circle, rectangle, or point-list profile has no status and stays
   * the idle zinc.
   */
  const paintSavedContourGhosts = useCallback((entries) => {
    clearSavedContourGhosts();
    if (!entries?.length || !sceneRef.current) return;
    const root = new Group();
    root.name = 'savedContourGhosts';
    // One group per part, in that part's local frame, moved with that part.
    for (const entry of entries) {
      const buckets = new Map();
      const pushSeg = (key, color, opacity, name, seg) => {
        if (!buckets.has(key)) buckets.set(key, { color, opacity, name, segs: [] });
        buckets.get(key).segs.push(seg);
      };
      for (const contour of entry.contours || []) {
        const rings = savedContourRings(contour, entry.hostPlane);
        const picked = entry.editor && contour.id === entry.pickedId;
        const status = picked ? null : savedContourStatus(contour);
        const color = picked ? 0xff9900 : (status ? contourEntityColor(status) : CONTOUR_IDLE_COLOR);
        const opacity = picked ? 0.75 : (status === 'conflict' ? 0.9 : 0.55);
        const name = picked ? 'contourSelected' : `contour${status || 'Idle'}`;
        for (const ring of rings) {
          if (!ring || ring.length < 2) continue;
          for (let i = 0; i < ring.length; i++) {
            pushSeg(name, color, opacity, name, { va: ring[i], vb: ring[(i + 1) % ring.length] });
          }
        }
      }
      const group = new Group();
      group.name = 'savedContourGhostsPart';
      group.userData = {
        overlayPartId: entry.partId,
        rowPosition: entry.position,
        rowQuaternion: entry.quaternion,
      };
      for (const bucket of buckets.values()) {
        const painted = paintEdgeLines(bucket.segs, {
          color: bucket.color,
          name: bucket.name,
          // Local to the part group below, not anchored to the pick mesh.
          position: [0, 0, 0],
          opacity: bucket.opacity,
          corePx: bucket.name === 'contourSelected' ? EDGE_CORE_PX : 1.5,
          haloPx: bucket.name === 'contourSelected' ? EDGE_HALO_PX : 5,
        });
        if (painted) group.add(painted);
      }
      if (!group.children.length) continue;
      const at = overlayAnchorForRef.current(entry.partId, entry.position, entry.quaternion);
      applyPartPose(group, at);
      root.add(group);
    }
    if (!root.children.length) return;
    sceneRef.current.add(root);
    savedContourGhostRef.current = root;
  }, [clearSavedContourGhosts, paintEdgeLines]);

  /**
   * Slice 21: draw profile outline(s) on the cross-section plane while editing params.
   * @param {{ face: object|null, params: object }|null} payload
   */
  const setXsPreview = useCallback((payload) => {
    clearXsPreview();
    if (!payload || !sceneRef.current) return;
    const preview = buildCrossSectionPreview(payload.face || null, payload.params || {});
    if (!preview?.rings?.length) return;
    const group = new Group();
    group.name = 'crossSectionPreview';
    if (!payload.hideRings) {
      const resolution = edgeLineResolution();
      for (const ring of preview.rings) {
        if (!ring || ring.length < 2) continue;
        const flat = [];
        for (const p of ring) flat.push(p[0], p[1], p[2]);
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) {
          flat.push(first[0], first[1], first[2]);
        }
        const loop = makeSketchLine(flat, {
          color: CONTOUR_STATUS_COLOR.under,
          opacity: 0.95,
          resolution,
        });
        loop.renderOrder = 12;
        group.add(loop);
      }
    }
    // Plane axes hint (short u/v ticks at origin)
    const { plane } = preview;
    if (plane) {
      const axisLen = 4;
      const axisMat = new LineBasicMaterial({
        color: 0xa5f3fc,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.55,
      });
      const makeAxis = (dir) => {
        const a = plane.center;
        const b = [
          a[0] + axisLen * dir[0],
          a[1] + axisLen * dir[1],
          a[2] + axisLen * dir[2],
        ];
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array([
          a[0], a[1], a[2], b[0], b[1], b[2],
        ]), 3));
        const line = new LineSegments(g, axisMat);
        line.renderOrder = 12;
        line.frustumCulled = false;
        return line;
      };
      group.add(makeAxis(plane.x));
      group.add(makeAxis(plane.y));
    }
    anchorToActivePart(group);
    sceneRef.current.add(group);
    xsPreviewRef.current = group;
  }, [clearXsPreview, anchorToActivePart, edgeLineResolution]);

  // Dispose cross-section preview on unmount (route change / modal still open).
  useEffect(() => () => clearXsPreview(), [clearXsPreview]);

  const clearWorkplaneOverlay = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, workplaneOverlayRef.current);
    workplaneOverlayRef.current = null;
  }, []);

  /**
   * Plane tool: the new plane, before Confirm. Same quad the confirmed
   * construction plane uses, translucent, at the frame the inputs describe.
   * The sketch plane square stays undrawn.
   */
  const paintPlaneToolPreview = useCallback((plane) => {
    clearWorkplaneOverlay();
    if (!plane?.center || !plane?.normal || !plane?.x || !plane?.y || !sceneRef.current) return;
    const size = CONSTRUCTION_PLANE_SIZE;
    const geom = new PlaneGeometry(size, size);
    const mat = makePreviewSkinMaterial();
    // Coplanar with the picked face. Depth test would lose the fight and
    // the preview would not be there.
    mat.depthTest = false;
    const quad = new ThreeMesh(geom, mat);
    quad.name = 'planeToolPreview';
    quad.position.set(plane.center[0], plane.center[1], plane.center[2]);
    const q = new Quaternion();
    q.setFromRotationMatrix(new Matrix4().makeBasis(
      new Vector3(plane.x[0], plane.x[1], plane.x[2]),
      new Vector3(plane.y[0], plane.y[1], plane.y[2]),
      new Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
    ));
    quad.quaternion.copy(q);
    quad.renderOrder = PREVIEW_RENDER_ORDER.skin;
    quad.frustumCulled = false;
    quad.userData = {
      kind: 'planeToolPreview',
      normal: [plane.normal[0], plane.normal[1], plane.normal[2]],
      size,
    };
    const group = new Group();
    group.name = 'planeToolPreview';
    group.add(quad);
    anchorToActivePart(group);
    sceneRef.current.add(group);
    workplaneOverlayRef.current = group;
  }, [clearWorkplaneOverlay, anchorToActivePart]);

  /** Restore orbit/pan after a point grab (hover or drag) releases. */
  const unlockOrbitForPointDrag = useCallback(() => {
    const saved = polylineControlsLockRef.current;
    const controls = controlsRef.current;
    if (saved && controls) {
      controls.noRotate = saved.noRotate;
      controls.noPan = saved.noPan;
    }
    polylineControlsLockRef.current = null;
  }, []);

  const clearPolylineDraft = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, polylineDraftRef.current);
    polylineDraftRef.current = null;
    polylinePointHoverRef.current = -1;
    polylinePointDragRef.current = null;
    unlockOrbitForPointDrag();
  }, [unlockOrbitForPointDrag]);

  const clearExtrudePreview = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, extrudePreviewRef.current);
    extrudePreviewRef.current = null;
  }, []);

  /**
   * Slice 25: live Extrude solid (Three.js ExtrudeGeometry on the workplane).
   * Local Z = plane normal; w0 applies sense (out / in / both).
   */
  const paintExtrudePreview = useCallback((payload) => {
    clearExtrudePreview();
    if (!payload?.plane || !payload?.contours?.length || !sceneRef.current) return;
    const loop = payload.contours[0];
    if (!loop || loop.length < 3) return;
    const shape = new Shape();
    shape.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i++) {
      const u = Number(loop[i][0]);
      const v = Number(loop[i][1]);
      if (!Number.isFinite(u) || !Number.isFinite(v)) return;
      shape.lineTo(u, v);
    }
    shape.closePath();
    const geom = new ExtrudeGeometry(shape, {
      depth: payload.distance,
      bevelEnabled: false,
      curveSegments: 1,
    });
    // Unlit, like every other preview: a lit material turned the faces angled
    // away from the lights dark and muddy (see utils/previewStyle.js).
    const mat = makePreviewSkinMaterial();
    const mesh = new ThreeMesh(geom, mat);
    mesh.name = 'contourExtrudePreview';
    mesh.renderOrder = PREVIEW_RENDER_ORDER.skin;
    mesh.frustumCulled = false;
    const { plane, w0 } = payload;
    const n = plane.normal;
    const x = plane.x;
    const y = plane.y;
    const c = plane.center;
    mesh.matrix.set(
      x[0], y[0], n[0], c[0] + w0 * n[0],
      x[1], y[1], n[1], c[1] + w0 * n[1],
      x[2], y[2], n[2], c[2] + w0 * n[2],
      0, 0, 0, 1,
    );
    mesh.matrixAutoUpdate = false;
    const group = new Group();
    group.name = 'contourExtrudePreviewGroup';
    group.add(mesh);
    // Start and end loops, exactly like Loft's station rings — the skin alone
    // reads as a smear without them.
    const outlineMat = makePreviewOutlineMaterial();
    for (const w of [w0, w0 + Number(payload.distance)]) {
      if (!Number.isFinite(w)) continue;
      const pos = new Float32Array((loop.length + 1) * 3);
      for (let i = 0; i <= loop.length; i++) {
        const [u, v] = loop[i % loop.length];
        for (let k = 0; k < 3; k++) {
          pos[i * 3 + k] = c[k] + u * x[k] + v * y[k] + w * n[k];
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      const line = new Line(g, outlineMat);
      line.renderOrder = PREVIEW_RENDER_ORDER.outline;
      line.frustumCulled = false;
      group.add(line);
    }
    anchorToActivePart(group);
    sceneRef.current.add(group);
    extrudePreviewRef.current = group;
  }, [clearExtrudePreview, anchorToActivePart]);

  const clearRevolvePreview = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, revolvePreviewRef.current);
    revolvePreviewRef.current = null;
  }, []);

  /**
   * Slice 26: live Revolve solid (surface of revolution on an in-plane axis).
   * Local X=radial, Y=axis, Z=plane normal; sense offsets the start angle.
   * Identity remap: axis through the workplane origin; clamp r<0 to match
   * makeRevolve / Manifold's positive-X clip (centered circle → sphere).
   */
  const paintRevolvePreview = useCallback((payload) => {
    clearRevolvePreview();
    if (!payload?.contours?.length || !payload?.center || !sceneRef.current) return;
    const radial = payload.radial;
    const axis = payload.axis;
    const out = payload.plane?.normal;
    const c = payload.center;
    if (!radial || !axis || !out || !c) return;
    const loop = payload.contours[0];
    if (!loop || loop.length < 3) return;
    const pts = [];
    for (const p of loop) {
      const r = Number(p[0]);
      const h = Number(p[1]);
      if (!Number.isFinite(r) || !Number.isFinite(h)) return;
      pts.push([Math.max(0, r), h]);
    }
    if (pts.length < 3) return;
    const f0 = pts[0];
    const f1 = pts[pts.length - 1];
    if (Math.hypot(f0[0] - f1[0], f0[1] - f1[1]) > 1e-6) pts.push([f0[0], f0[1]]);
    const angle = Number(payload.angle);
    if (!(angle > 0) || !Number.isFinite(angle)) return;
    const start = (Number(payload.startDeg) || 0) * (Math.PI / 180);
    const span = angle * (Math.PI / 180);
    const segs = Math.max(16, Math.round(48 * Math.max(0.2, angle / 360)));
    const n = pts.length;
    const positions = new Float32Array((segs + 1) * n * 3);
    let w = 0;
    for (let j = 0; j <= segs; j++) {
      const th = start + (j / segs) * span;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      for (let i = 0; i < n; i++) {
        positions[w++] = pts[i][0] * ct;
        positions[w++] = pts[i][1];
        positions[w++] = pts[i][0] * st;
      }
    }
    const indices = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + n;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mat = makePreviewSkinMaterial();
    const mesh = new ThreeMesh(geom, mat);
    mesh.name = 'contourRevolvePreview';
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    // Local: X=radial, Y=axis, Z=plane normal.
    mesh.matrix.set(
      radial[0], axis[0], out[0], c[0],
      radial[1], axis[1], out[1], c[1],
      radial[2], axis[2], out[2], c[2],
      0, 0, 0, 1,
    );
    mesh.matrixAutoUpdate = false;
    const group = new Group();
    group.name = 'contourRevolvePreviewGroup';
    group.add(mesh);
    anchorToActivePart(group);
    sceneRef.current.add(group);
    revolvePreviewRef.current = group;
  }, [clearRevolvePreview, anchorToActivePart]);

  const clearLoftPreview = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, loftPreviewRef.current);
    loftPreviewRef.current = null;
  }, []);

  /**
   * Slice 28: live Loft solid (linear skin between offset stations) + profile rings.
   * Stations live on copies of the workplane offset along the normal.
   */
  const paintLoftPreview = useCallback((payload) => {
    clearLoftPreview();
    if (!payload?.stations?.length || !sceneRef.current) return;
    const group = new Group();
    group.name = 'contourLoftPreviewGroup';
    const ringMat = makePreviewOutlineMaterial();
    const skinMat = makePreviewSkinMaterial();
    const worldRing = (station) => {
      const plane = station.plane;
      return (station.ring || []).map((uv) => [
        plane.center[0] + uv[0] * plane.x[0] + uv[1] * plane.y[0],
        plane.center[1] + uv[0] * plane.x[1] + uv[1] * plane.y[1],
        plane.center[2] + uv[0] * plane.x[2] + uv[1] * plane.y[2],
      ]);
    };
    for (const station of payload.stations) {
      const ring = worldRing(station);
      if (ring.length < 3) continue;
      const pos = new Float32Array((ring.length + 1) * 3);
      for (let i = 0; i < ring.length; i++) {
        pos[i * 3] = ring[i][0];
        pos[i * 3 + 1] = ring[i][1];
        pos[i * 3 + 2] = ring[i][2];
      }
      pos[ring.length * 3] = ring[0][0];
      pos[ring.length * 3 + 1] = ring[0][1];
      pos[ring.length * 3 + 2] = ring[0][2];
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      const line = new Line(g, ringMat);
      line.renderOrder = 11;
      line.frustumCulled = false;
      group.add(line);
    }
    for (let s = 0; s < payload.stations.length - 1; s++) {
      const a = worldRing(payload.stations[s]);
      const b = worldRing(payload.stations[s + 1]);
      const n = Math.min(a.length, b.length);
      if (n < 3) continue;
      const positions = new Float32Array(n * 2 * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = a[i][0];
        positions[i * 3 + 1] = a[i][1];
        positions[i * 3 + 2] = a[i][2];
        positions[(n + i) * 3] = b[i][0];
        positions[(n + i) * 3 + 1] = b[i][1];
        positions[(n + i) * 3 + 2] = b[i][2];
      }
      const indices = [];
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        indices.push(i, n + i, i1, n + i, n + i1, i1);
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      const mesh = new ThreeMesh(geom, skinMat);
      mesh.name = 'contourLoftPreview';
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    if (group.children.length) {
      anchorToActivePart(group);
      sceneRef.current.add(group);
      loftPreviewRef.current = group;
    }
  }, [clearLoftPreview, anchorToActivePart]);

  const clearSweepPreview = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, sweepPreviewRef.current);
    sweepPreviewRef.current = null;
  }, []);

  /**
   * Slice 30: live Sweep skin along the path (profile stations, not a manifold).
   * Rings are already in world space. Invalid path → caller passes null.
   */
  const paintSweepPreview = useCallback((payload) => {
    clearSweepPreview();
    if (!payload?.stations?.length || !sceneRef.current) return;
    const group = new Group();
    group.name = 'contourSweepPreviewGroup';
    const ringMat = makePreviewOutlineMaterial();
    const skinMat = makePreviewSkinMaterial();
    const addSkin = (a, b) => {
      const n = Math.min(a?.length || 0, b?.length || 0);
      if (n < 3) return;
      const positions = new Float32Array(n * 2 * 3);
      for (let i = 0; i < n; i++) {
        if (!a[i] || !b[i]) return;
        positions[i * 3] = a[i][0];
        positions[i * 3 + 1] = a[i][1];
        positions[i * 3 + 2] = a[i][2];
        positions[(n + i) * 3] = b[i][0];
        positions[(n + i) * 3 + 1] = b[i][1];
        positions[(n + i) * 3 + 2] = b[i][2];
      }
      const indices = [];
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        indices.push(i, n + i, i1, n + i, n + i1, i1);
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      const mesh = new ThreeMesh(geom, skinMat);
      mesh.name = 'contourSweepPreview';
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      group.add(mesh);
    };
    const rings = [];
    for (const station of payload.stations) {
      const ring = station.ring;
      if (!ring || ring.length < 3) continue;
      rings.push(ring);
      const pos = new Float32Array((ring.length + 1) * 3);
      for (let i = 0; i < ring.length; i++) {
        pos[i * 3] = ring[i][0];
        pos[i * 3 + 1] = ring[i][1];
        pos[i * 3 + 2] = ring[i][2];
      }
      pos[ring.length * 3] = ring[0][0];
      pos[ring.length * 3 + 1] = ring[0][1];
      pos[ring.length * 3 + 2] = ring[0][2];
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      const line = new Line(g, ringMat);
      line.renderOrder = 11;
      line.frustumCulled = false;
      group.add(line);
    }
    for (let s = 0; s < rings.length - 1; s++) addSkin(rings[s], rings[s + 1]);
    if (payload.closed && rings.length > 2) addSkin(rings[rings.length - 1], rings[0]);
    if (group.children.length) {
      anchorToActivePart(group);
      sceneRef.current.add(group);
      sweepPreviewRef.current = group;
    }
  }, [clearSweepPreview, anchorToActivePart]);

  // A sketch leaves the part material alone. Slice 24 dimmed every solid to
  // opacity 0.4 for the whole contour pose. Sheet-metal contour references
  // are strokes on the part, so that dim has no remaining job. The restore
  // path still clears a leftover from an older session.
  const applyContourPartGhost = useCallback((on) => {
    const mesh = resultRef.current;
    if (!mesh || on) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (contourGhostMatsRef.current) {
      for (const m of mats) {
        const prev = m?.userData?._contourPrev;
        if (!prev) continue;
        m.transparent = prev.transparent;
        m.opacity = prev.opacity;
        m.depthWrite = prev.depthWrite;
        m.needsUpdate = true;
        delete m.userData._contourPrev;
      }
      contourGhostMatsRef.current = null;
    }
  }, []);

  const clearConstructionPlanes = useCallback(() => {
    if (!constructionPlaneRef.current) return;
    disposeEdgeOverlayObject(sceneRef.current, constructionPlaneRef.current);
    constructionPlaneRef.current = null;
  }, []);

  const paintConstructionPlanes = useCallback((entries) => {
    clearConstructionPlanes();
    if (!entries?.length || !sceneRef.current) return;
    const root = new Group();
    root.name = 'constructionPlanes';
    // One group per part, in that part's local frame, moved with that part.
    for (const entry of entries) {
      const group = new Group();
      group.name = 'constructionPlanesPart';
      group.userData = {
        overlayPartId: entry.partId,
        rowPosition: entry.position,
        rowQuaternion: entry.quaternion,
      };
      for (const p of entry.planes || []) {
        const plane = p.plane;
        if (!plane?.center || !plane?.x || !plane?.y || !plane?.normal) continue;
        const size = CONSTRUCTION_PLANE_SIZE;
        const geom = new PlaneGeometry(size, size);
        const jointId = p.jointPlaneId || p.id;
        const picked = entry.jointPlaneIds instanceof Set
          && entry.jointPlaneIds.has(`${entry.partId}:${jointId}`);
        const selected = picked || (entry.editor && p.id === entry.selectedId);
        // Same translucent recipe as the tool previews, amber when active.
        const mat = makePreviewSkinMaterial(selected
          ? { color: PREVIEW_COLORS.selected, opacity: PREVIEW_OPACITY.selected }
          : { color: PREVIEW_COLORS.outline, opacity: PREVIEW_OPACITY.ghost });
        const quad = new ThreeMesh(geom, mat);
        quad.position.set(plane.center[0], plane.center[1], plane.center[2]);
        const q = new Quaternion();
        q.setFromRotationMatrix(new Matrix4().makeBasis(
          new Vector3(plane.x[0], plane.x[1], plane.x[2]),
          new Vector3(plane.y[0], plane.y[1], plane.y[2]),
          new Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
        ));
        quad.quaternion.copy(q);
        quad.renderOrder = 7;
        quad.frustumCulled = false;
        quad.userData = {
          planeId: p.id,
          jointPlaneId: p.jointPlaneId || p.id,
          plane,
          kind: 'constructionPlane',
          partId: entry.partId,
        };
        group.add(quad);
      }
      if (!group.children.length) continue;
      const at = overlayAnchorForRef.current(entry.partId, entry.position, entry.quaternion);
      applyPartPose(group, at);
      root.add(group);
    }
    if (!root.children.length) return;
    sceneRef.current.add(root);
    constructionPlaneRef.current = root;
  }, [clearConstructionPlanes]);

  /**
   * Per-frame handle animation: ease every handle toward its state's scale, and
   * breathe the one under the cursor so it reads as grabbable rather than drawn.
   * Scale (not colour) is animated here — colour is a state change, not motion.
   */
  const animatePolylineHandles = useCallback(() => {
    const handles = polylineDraftRef.current?.userData?.handles;
    if (!handles?.length) return;
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    const dragIndex = polylinePointDragRef.current?.index ?? -1;
    const hoverIndex = polylinePointHoverRef.current;
    const pulse = 1 + Math.sin(performance.now() / 160) * 0.08;
    for (let i = 0; i < handles.length; i++) {
      let state = POLYLINE_POINT_SCALE;
      if (i === dragIndex) state = POLYLINE_POINT_DRAG_SCALE;
      else if (i === hoverIndex) state = POLYLINE_POINT_HOVER_SCALE * pulse;
      let screen = 1;
      if (camera && canvas) {
        handles[i].getWorldPosition(polylineProjectScratch.current);
        const dist = camera.position.distanceTo(polylineProjectScratch.current);
        screen = sketchPointScaleFromDistance(
          dist,
          camera.fov,
          canvas.clientHeight,
          camera.zoom,
        );
      }
      // Screen size tracks the camera immediately. Only the hover grow eases.
      const grown = handles[i].userData.growScale ?? POLYLINE_POINT_SCALE;
      const nextGrow = Math.abs(state - grown) < 0.002 ? state : grown + (state - grown) * 0.25;
      handles[i].userData.growScale = nextGrow;
      handles[i].scale.setScalar(screen * nextGrow);
    }
  }, []);

  /** Recolor handles for the current hover / drag state (scale is animated). */
  const paintPolylineHandleStates = useCallback(() => {
    const draft = polylineDraftRef.current;
    const handles = draft?.userData?.handles;
    if (!handles) return;
    const colors = draft.userData.pointColors;
    const dragIndex = polylinePointDragRef.current?.index ?? -1;
    const hoverIndex = polylinePointHoverRef.current;
    for (let i = 0; i < handles.length; i++) {
      const mat = handles[i].material;
      if (!mat) continue;
      if (i === dragIndex) mat.color.setHex(POLYLINE_POINT_DRAG_COLOR);
      else if (i === hoverIndex) mat.color.setHex(POLYLINE_POINT_HOVER_COLOR);
      else mat.color.setHex(colors?.[i] ?? POLYLINE_POINT_COLOR);
    }
  }, []);

  /**
   * Draft polyline: one grab handle per tapped point + the connecting wire.
   *
   * Points are kept as individual meshes with their own material and a
   * `pointIndex`, because they are interactive: hover grows them, right-drag
   * moves them (see beginPolylinePointDrag). Handle geometry is rebuilt only
   * when the point list changes — a live drag mutates positions in place so
   * the wire follows the cursor at frame rate instead of through React.
   */
  const paintPolylineDraft = useCallback((plane, points, { wire = true, pointColors = null, pointIds = null, dashed = false, closed = false } = {}) => {
    // A repaint (point added, undone, plane re-picked) rebuilds the handles;
    // carry the hover across it so the grab target does not flicker back to
    // idle under a stationary cursor.
    const keepHover = polylinePointHoverRef.current;
    clearPolylineDraft();
    if (!plane || !points?.length || !sceneRef.current) return;
    const group = new Group();
    group.name = 'contourPolylineDraft';
    const world = points.map(([u, v]) => [
      plane.center[0] + u * plane.x[0] + v * plane.y[0],
      plane.center[1] + u * plane.x[1] + v * plane.y[1],
      plane.center[2] + u * plane.x[2] + v * plane.y[2],
    ]);
    const handles = [];
    for (let i = 0; i < world.length; i++) {
      const p = world[i];
      // Per-point material: hover / drag tint one handle, not the whole draft.
      const mat = new MeshBasicMaterial({
        color: pointColors?.[i] ?? POLYLINE_POINT_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
      });
      const s = new ThreeMesh(new SphereGeometry(SKETCH_POINT_RADIUS, 12, 12), mat);
      s.position.set(p[0], p[1], p[2]);
      s.renderOrder = 16;
      s.frustumCulled = false;
      s.userData.pointIndex = i;
      s.userData.pointId = pointIds?.[i] || '';
      s.userData.picked = pointColors?.[i] === CONTOUR_PICK_COLOR;
      handles.push(s);
      group.add(s);
    }
    let line = null;
    if (wire && world.length >= 2) {
      const stroke = closed && world.length >= 3 ? [...world, world[0]] : world;
      const pos = new Float32Array(stroke.length * 3);
      for (let i = 0; i < stroke.length; i++) {
        pos[i * 3] = stroke[i][0];
        pos[i * 3 + 1] = stroke[i][1];
        pos[i * 3 + 2] = stroke[i][2];
      }
      line = makeSketchLine(pos, {
        color: POLYLINE_POINT_COLOR,
        opacity: 0.9,
        resolution: edgeLineResolution(),
        dashed,
      });
      group.add(line);
    }
    group.userData.handles = handles;
    group.userData.line = line;
    group.userData.plane = plane;
    group.userData.pointColors = pointColors;
    anchorToActivePart(group);
    sceneRef.current.add(group);
    polylineDraftRef.current = group;
    polylinePointHoverRef.current = keepHover < handles.length ? keepHover : -1;
    paintPolylineHandleStates();
  }, [clearPolylineDraft, paintPolylineHandleStates, anchorToActivePart, edgeLineResolution]);

  const clearContourStatusWire = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, contourStatusRef.current);
    contourStatusRef.current = null;
  }, []);

  /** Promoted contour wire, one colour per entity. Blue stays on an unpromoted draft. */
  const paintContourStatusWire = useCallback((plane, segments, { dashed = false } = {}) => {
    clearContourStatusWire();
    if (!plane || !segments?.length || !sceneRef.current) return;
    const group = new Group();
    group.name = 'contourStatusWire';
    for (const seg of segments) {
      if (!seg?.uvs || seg.uvs.length < 2) continue;
      const pos = new Float32Array(seg.uvs.length * 3);
      for (let i = 0; i < seg.uvs.length; i++) {
        const world = planeUvToWorld(seg.uvs[i], plane);
        pos[i * 3] = world[0];
        pos[i * 3 + 1] = world[1];
        pos[i * 3 + 2] = world[2];
      }
      const line = makeSketchLine(pos, {
        color: seg.color,
        opacity: 0.95,
        resolution: edgeLineResolution(),
        dashed,
      });
      line.userData.entityId = seg.id || '';
      line.userData.entityKind = seg.kind || 'line';
      line.userData.localPts = Array.from({ length: seg.uvs.length }, (_, i) => [
        pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2],
      ]);
      line.userData.picked = !!seg.picked;
      group.add(line);
    }
    if (!group.children.length) return;
    anchorToActivePart(group);
    sceneRef.current.add(group);
    contourStatusRef.current = group;
  }, [clearContourStatusWire, anchorToActivePart, edgeLineResolution]);

  const clearContourRefWire = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, contourRefRef.current);
    contourRefRef.current = null;
  }, []);

  /** Dashed references under the sketch strokes. No point handles. */
  const paintContourRefWire = useCallback((plane, segments) => {
    clearContourRefWire();
    if (!plane || !segments?.length || !sceneRef.current) return;
    const group = new Group();
    group.name = 'contourRefWire';
    for (const seg of segments) {
      if (!seg?.uvs || seg.uvs.length < 2) continue;
      const pos = new Float32Array(seg.uvs.length * 3);
      for (let i = 0; i < seg.uvs.length; i += 1) {
        const world = planeUvToWorld(seg.uvs[i], plane);
        pos[i * 3] = world[0];
        pos[i * 3 + 1] = world[1];
        pos[i * 3 + 2] = world[2];
      }
      const line = makeSketchLine(pos, {
        color: seg.picked ? CONTOUR_PICK_COLOR : (seg.color ?? CONTOUR_REF_COLOR),
        opacity: seg.broken ? 0.95 : (seg.picked ? 0.95 : 0.72),
        resolution: edgeLineResolution(),
        dashed: true,
        renderOrder: 14,
      });
      line.userData.entityId = seg.id || '';
      line.userData.entityKind = 'ref';
      group.add(line);
    }
    if (!group.children.length) return;
    anchorToActivePart(group);
    sceneRef.current.add(group);
    contourRefRef.current = group;
  }, [clearContourRefWire, anchorToActivePart, edgeLineResolution]);

  /**
   * Move one handle (and its wire vertex) without rebuilding the draft.
   * `worldPoint` is plane-local. The group already carries the part pose,
   * so subtracting the anchor would shift a posed part a second time.
   */
  const movePolylineHandle = useCallback((index, worldPoint) => {
    const group = polylineDraftRef.current;
    const handle = group?.userData?.handles?.[index];
    if (!handle) return;
    handle.position.set(worldPoint[0], worldPoint[1], worldPoint[2]);
    const line = group.userData.line;
    const handles = group.userData.handles;
    if (line?.geometry?.setPositions && handles?.length >= 2) {
      const flat = [];
      for (const handle of handles) {
        flat.push(handle.position.x, handle.position.y, handle.position.z);
      }
      line.geometry.setPositions(flat);
    }
  }, []);

  /**
   * Nearest draft point within the edge-pick slop, in screen space so the
   * grab target stays finger-sized however far the camera is.
   * @returns {number} point index, or -1
   */
  const pickPolylinePointAtClient = useCallback((clientX, clientY) => {
    const group = polylineDraftRef.current;
    const handles = group?.userData?.handles;
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!handles?.length || !camera || !canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const slop = resolveEdgePickSlopPx();
    let best = -1;
    let bestD = slop * slop;
    for (let i = 0; i < handles.length; i++) {
      handles[i].getWorldPosition(polylineProjectScratch.current);
      const v = polylineProjectScratch.current.project(camera);
      // z > 1 is past the far plane, not behind the camera. Those handles are
      // still drawn (frustum culling is off) and must stay grabbable.
      if (v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }, []);

  /** Nearest sketch segment within the same slop, skipping a point the caller already hit. */
  const pickSketchLineAtClient = useCallback((clientX, clientY) => {
    const state = contourModeRef.current;
    const segments = sketchSegments(state);
    const handles = polylineDraftRef.current?.userData?.handles;
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!segments.length || !handles?.length || !camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const slop = resolveEdgePickSlopPx();
    const screenOf = (handle) => {
      if (!handle) return null;
      handle.getWorldPosition(polylineProjectScratch.current);
      const v = polylineProjectScratch.current.project(camera);
      if (v.z < -1) return null;
      return {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
      };
    };
    const handleFor = (segment, end) => {
      if (segment.kind === 'polyline') {
        return handles[end === 'a' ? segment.indexA : segment.indexB] || null;
      }
      const id = end === 'a' ? segment.pointA : segment.pointB;
      return handles.find((handle) => handle.userData?.pointId === id) || null;
    };
    let best = null;
    let bestD = slop;
    for (const segment of segments) {
      const a = screenOf(handleFor(segment, 'a'));
      const b = screenOf(handleFor(segment, 'b'));
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 1e-12 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
      if (d <= bestD) {
        bestD = d;
        best = segment;
      }
    }
    return best;
  }, []);

  /**
   * Hovering a handle hands the right button to the point, not the camera:
   * TrackballControls pans on right-drag, which would fight the move.
   */
  const setPolylinePointHover = useCallback((index) => {
    if (polylinePointHoverRef.current === index) return;
    polylinePointHoverRef.current = index;
    const controls = controlsRef.current;
    if (index >= 0 && controls && !polylineControlsLockRef.current
      && performance.now() >= sketchHoverMuteRef.current) {
      polylineControlsLockRef.current = { noRotate: controls.noRotate, noPan: controls.noPan };
      controls.noRotate = true;
      controls.noPan = true;
    } else if (index < 0 && !polylinePointDragRef.current && !sketchDragHoldRef.current) {
      unlockOrbitForPointDrag();
    }
    if (canvasRef.current) {
      canvasRef.current.style.cursor = index >= 0 ? 'grab' : '';
    }
    paintPolylineHandleStates();
  }, [paintPolylineHandleStates, unlockOrbitForPointDrag]);

  const clearFilletBlendPreview = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, filletBlendPreviewRef.current);
    filletBlendPreviewRef.current = null;
  }, []);

  /**
   * Slice 27: live sweep-fillet blend (path + swept wedge). Branched
   * selections keep their polylines visible. Disjoint simple components each
   * get their own wedge rings (independent fillets).
   */
  const paintFilletBlendPreview = useCallback((payload) => {
    clearFilletBlendPreview();
    if (!payload || !sceneRef.current) return;
    const group = new Group();
    group.name = 'filletBlendPreview';

    const addPolyline = (pts, color, opacity = 0.95) => {
      if (!pts || pts.length < 2) return;
      const pos = new Float32Array(pts.length * 3);
      for (let i = 0; i < pts.length; i++) {
        pos[i * 3] = pts[i][0];
        pos[i * 3 + 1] = pts[i][1];
        pos[i * 3 + 2] = pts[i][2];
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(pos, 3));
      const line = new Line(geom, new LineBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity,
      }));
      line.renderOrder = 16;
      line.frustumCulled = false;
      group.add(line);
    };

    const addWedgeMesh = (rings, closed) => {
      if (!rings || rings.length < 2) return;
      const n = rings[0].length;
      if (n < 3) return;
      const positions = new Float32Array(rings.length * n * 3);
      let w = 0;
      for (const ring of rings) {
        for (let i = 0; i < n; i++) {
          const p = ring[i] || ring[0];
          positions[w++] = p[0];
          positions[w++] = p[1];
          positions[w++] = p[2];
        }
      }
      const indices = [];
      for (let j = 0; j < rings.length - 1; j++) {
        for (let i = 0; i < n; i++) {
          const i1 = (i + 1) % n;
          const a = j * n + i;
          const b = a + n;
          indices.push(a, b, j * n + i1, b, b + i1 - i, j * n + i1);
        }
      }
      if (closed && rings.length > 2) {
        const last = rings.length - 1;
        for (let i = 0; i < n; i++) {
          const i1 = (i + 1) % n;
          const a = last * n + i;
          const b = i;
          indices.push(a, b, last * n + i1, b, i1, last * n + i1);
        }
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      const mat = makePreviewSkinMaterial({ color: PREVIEW_COLORS.blendSkin });
      const mesh = new ThreeMesh(geom, mat);
      mesh.name = 'filletBlendWedge';
      mesh.renderOrder = 10;
      mesh.frustumCulled = false;
      group.add(mesh);
    };

    const multi = Array.isArray(payload.components) && payload.components.length > 1;
    if (multi) {
      for (const part of payload.components) {
        if (part?.preview?.points?.length) {
          addPolyline(part.preview.points, part.ok ? 0x22c55e : 0xf97316, 0.98);
        } else {
          for (const poly of part?.polylines || []) {
            addPolyline(poly, part?.ok ? 0x22c55e : 0xf97316, 0.9);
          }
        }
        if (payload.ok && part?.ok) addWedgeMesh(part.rings, part.closed);
      }
    } else {
      if (payload.preview?.points?.length) {
        addPolyline(payload.preview.points, payload.ok ? 0x22c55e : 0xf97316, 0.98);
      } else {
        for (const poly of payload.polylines || []) addPolyline(poly, 0xf97316, 0.9);
      }
      if (payload.ok) addWedgeMesh(payload.rings, payload.closed);
    }

    if (group.children.length) {
      anchorToActivePart(group);
      sceneRef.current.add(group);
      filletBlendPreviewRef.current = group;
    }
  }, [clearFilletBlendPreview, anchorToActivePart]);

  const exitContourMode = useCallback((reason) => {
    if (sheetHoleSketchRef.current) {
      sheetHoleSketchRef.current = null;
      setSheetMetalMode((prev) => (prev?.holeSketch ? { ...prev, holeSketch: null } : prev));
    }
    holeCentresEditRef.current = null;
    contourEditRef.current = null;
    setContourEdit(null);
    setContourDeleteConfirm(null);
    setSketchDeleteConfirm(null);
    faceSketchRef.current?.cancel();
    setContourFaceAim('');
    const keepCard = reason === 'slot' && featureSlotsRef.current;
    if (keepCard) holdContourOverlays(overlayVis, featureSlotsRef.current.kind);
    else releaseContourOverlays(overlayVis);
    cancelFeatureEditRef.current?.('contour');
    // Close the live sketch before the next agent call. A seed update still
    // queued from reopening a contour must not paint the sketch back, and
    // mode() reads the ref rather than the last render.
    contourLiveWriteRef.current = null;
    contourModeRef.current = null;
    contourPlaneOpenRef.current = false;
    flushSync(() => {
      setContourMode(null);
      setContourPlaneOpen(false);
    });
    contourLiveWriteRef.current = null;
    contourModeRef.current = null;
    contourPlaneOpenRef.current = false;
    sketchHistRef.current = emptySketchHistory();
    setContourUndoDepth(0);
    setPickMode('face');
    clearXsPreview();
    clearWorkplaneOverlay();
    clearPolylineDraft();
    clearExtrudePreview();
    clearRevolvePreview();
    clearLoftPreview();
    clearSweepPreview();
    disposeEdgeOverlayObject(sceneRef.current, pathPreviewRef.current);
    pathPreviewRef.current = null;
    applyContourPartGhost(false);
    clearSavedContourGhosts();
    if (contourToastTimerRef.current) {
      clearTimeout(contourToastTimerRef.current);
      contourToastTimerRef.current = null;
    }
    setContourToast(null);
  }, [clearXsPreview, clearWorkplaneOverlay, clearPolylineDraft, clearExtrudePreview, clearRevolvePreview, clearLoftPreview, clearSweepPreview, applyContourPartGhost, clearSavedContourGhosts]);

  const closeFeatureSlots = useCallback(() => {
    slotReturnRef.current = null;
    featureSlotsRef.current = null;
    setFeatureSlots(null);
    setSlotHoverId(null);
    if (!contourModeRef.current) releaseContourOverlays(overlayVis);
  }, []);
  closeFeatureSlotsRef.current = closeFeatureSlots;
  exitContourModeRef.current = exitContourMode;
  agentFinishHoleSketchRef.current = () => exitContourModeRef.current();
  finishContourCommitRef.current = ({ payload, fromSlot } = {}) => {
    if (fromSlot) {
      closeFeatureSlotsRef.current();
      return;
    }
    if (slotReturnRef.current && featureSlotsRef.current && payload?.entry === 'crossSection') {
      const read = getHelperBufferRef.current;
      const text = (typeof read === 'function' ? read() : '') || currentScript || '';
      const saved = listSavedContours(text);
      const created = saved.length ? saved[saved.length - 1] : null;
      if (created) {
        setFeatureSlots((prev) => assignFeatureSlot(prev, slotReturnRef.current, created));
      }
      slotReturnRef.current = null;
      exitContourModeRef.current?.('slot');
      return;
    }
    if (contourModeRef.current) {
      exitContourModeRef.current?.();
    }
  };

  useEffect(() => {
    if (!featureSlots) return undefined;
    if (
      paintMode || filletMode || shellMode || draftMode || cutMode || booleanMode
      || moveMode || rotateMode || moveFaceMode || deleteFaceMode || sheetMetalMode || sheetMetalPicker
      || feaActive || helperCardOpen
    ) {
      closeFeatureSlots();
    }
    return undefined;
  }, [
    featureSlots,
    helperCardOpen,
    paintMode,
    filletMode,
    shellMode,
    draftMode,
    cutMode,
    booleanMode,
    moveMode,
    rotateMode,
    moveFaceMode,
    deleteFaceMode,
    sheetMetalMode,
    sheetMetalPicker,
    feaActive,
    closeFeatureSlots,
  ]);

  const openFeatureSlots = useCallback((entry, seeded = null) => {
    if (!allowFeaturePopup()) return;
    if (!isSolidContourEntry(entry) || mode === 'game') return;
    slotReturnRef.current = null;
    if (contourModeRef.current) exitContourMode();
    holdContourOverlays(overlayVis, entry);
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setSheetMetalMode(null);
    setSheetMetalPicker(null);
    setHelperCardOpen(false);
    const next = seeded?.kind === entry ? seeded : emptyFeatureSlotCard(entry);
    featureSlotsRef.current = next;
    setFeatureSlots(next);
    setSlotHoverId(null);
  }, [
    mode,
    exitContourMode,
    clearFilletBlendPreview,
    clearEdgeHover,
    clearEdgeHighlight,
  ]);

  const confirmFeatureSlots = useCallback(() => {
    const card = featureSlotsRef.current;
    if (!featureSlotReady(card)) return;
    const ok = onCommitContourProfile?.({
      partId: activePartIdRef.current,
      ...featureSlotCommitPayload(card),
    });
    if (ok) closeFeatureSlots();
  }, [onCommitContourProfile, closeFeatureSlots]);

  const cancelContourEditor = useCallback(() => {
    const back = !!(slotReturnRef.current && featureSlotsRef.current);
    slotReturnRef.current = null;
    exitContourMode(back ? 'slot' : undefined);
  }, [exitContourMode]);

  const enterContourMode = useCallback(({ entry, centresEdit = null, keepSheet = false, sheetSketch = null } = {}) => {
    if (!allowFeaturePopup()) return;
    if (isSolidContourEntry(entry) && mode !== 'game') {
      openFeatureSlots(entry);
      return;
    }
    holdContourOverlays(overlayVis, entry);
    feaCloseRef.current();
    exitPaintModeRef.current();
    if (!keepSheet) exitSheetMetalChromeRef.current();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    disposeEdgeOverlayObject(sceneRef.current, pathPreviewRef.current);
    pathPreviewRef.current = null;
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || currentScript || '';
    const saved = listSavedContours(buf);
    const planes = listConstructionPlanes(buf);
    const armedPlane = planes.find((p) => p.id === selectedPlaneId);
    const faceArg = selectedFace || (armedPlane ? {
      type: 'planar',
      center: armedPlane.plane.center.slice(),
      normal: armedPlane.plane.normal.slice(),
      area: 400,
      triangleCount: 2,
      selectionMode: 'coplanar',
      planeFrame: {
        center: armedPlane.plane.center.slice(),
        normal: armedPlane.plane.normal.slice(),
        x: armedPlane.plane.x.slice(),
        y: armedPlane.plane.y.slice(),
      },
    } : null);
    let next = scaleFreshContour(
      enterContourState(entry, faceArg),
      characteristicLengthMm({ bounds: modelBoundsRef.current }),
    );
    if (entry === 'hole' && holeSpecRef.current && !centresEdit) {
      next = { ...next, holeSpec: holeSpecRef.current };
    }
    if (entry !== 'hole') {
      const armed = saved.find((c) => c.id === armedContourId);
      next = armed ? applySavedContour(next, armed) : withAutoPickedContour(next, saved);
    }
    if (centresEdit) {
      next = holeCentresSketch(next, centresEdit);
      contourEditRef.current = null;
      setContourEdit(null);
    } else if (sheetSketch?.frame) {
      next = holeCentresSketch(next, { frame: sheetSketch.frame, contour: { points: [] } });
      contourEditRef.current = null;
      setContourEdit(null);
    }
    const planeOpen = !centresEdit && !sheetSketch;
    contourPlaneOpenRef.current = planeOpen;
    sketchHistRef.current = emptySketchHistory();
    setContourUndoDepth(0);
    setContourFaceAim('');
    flushSync(() => {
      setContourPlaneOpen(planeOpen);
      setContourMode(next);
    });
    contourPlaneOpenRef.current = planeOpen;
    contourModeRef.current = next;
    if (centresEdit?.frame?.normal) {
      overlayVis.end('planes');
      requestFaceSketchAim(centresEdit.frame.normal);
    } else if (sheetSketch?.frame?.normal) {
      overlayVis.end('planes');
      requestFaceSketchAim(sheetSketch.frame.normal);
    }
    // Soft-fail / refuse only — no informational toast on successful feature UI open.
    if (next.enterRefuse) showContourToast(next.enterRefuse);
    applyContourPartGhost(true);
  }, [mode, openFeatureSlots, selectedFace, selectedPlaneId, armedContourId, applyContourPartGhost, clearFilletBlendPreview, clearEdgeHover, clearEdgeHighlight, getHelperBuffer, currentScript]);

  const sheetHoleSketch = sheetMetalMode?.holeSketch || null;
  useEffect(() => {
    if (!sheetHoleSketch) return;
    if (sheetHoleSketchRef.current) return;
    const frame = sheetPanelFrame(sheetMetalMode?.spec, sheetHoleSketch.panel);
    if (!frame) {
      showContourToast('Hole could not find its panel.');
      setSheetMetalMode((prev) => (prev ? { ...prev, holeSketch: null } : prev));
      return;
    }
    sheetHoleSketchRef.current = sheetHoleSketch;
    enterContourMode({ entry: 'hole', keepSheet: true, sheetSketch: { frame } });
  }, [sheetHoleSketch, sheetMetalMode?.spec, enterContourMode]);

  const beginHoleSketch = useCallback(() => {
    const parsed = holeSpecFromCard(holeCardRef.current || defaultHoleCard());
    if (!parsed.ok) {
      showContourToast(parsed.message);
      return;
    }
    holeSpecRef.current = parsed.spec;
    holeEditRef.current = null;
    setHoleCard(null);
    enterContourMode({ entry: 'hole' });
  }, [enterContourMode, showContourToast]);
  agentHoleBeginCentresRef.current = beginHoleSketch;

  const confirmHoleEdit = useCallback(() => {
    const edit = holeEditRef.current;
    if (!edit) return;
    const parsed = holeSpecFromCard(holeCardRef.current || defaultHoleCard());
    if (!parsed.ok) {
      showContourToast(parsed.message);
      return;
    }
    const ok = onCommitHole?.({
      editSpec: true,
      featureId: edit.featureId,
      spec: parsed.spec,
      partId: activePartIdRef.current,
    });
    if (!ok) return;
    holeEditRef.current = null;
    holeSpecRef.current = null;
    setHoleCard(null);
  }, [onCommitHole, showContourToast]);
  confirmHoleEditRef.current = confirmHoleEdit;

  const editHoleCentres = useCallback(() => {
    const edit = holeEditRef.current;
    if (!edit?.contourId) {
      showContourToast('That contour is not in this part.');
      return;
    }
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || currentScript || '';
    const saved = readCentersContour(buf, edit.contourId);
    if (!saved) {
      showContourToast('That contour is not in this part.');
      return;
    }
    holeCentresEditRef.current = saved;
    holeSpecRef.current = null;
    setHoleCard(null);
    enterContourMode({ entry: 'hole', centresEdit: saved });
  }, [enterContourMode, getHelperBuffer, currentScript, showContourToast]);

  useEffect(() => {
    if (!holeCard) return;
    if (
      contourMode || filletMode || shellMode || draftMode || cutMode
      || booleanMode || moveMode || rotateMode || moveFaceMode || deleteFaceMode
      || featureSlots || sheetMetalMode || sheetMetalPicker || paintMode
    ) {
      setHoleCard(null);
    }
  }, [
    holeCard, contourMode, filletMode, shellMode, draftMode, cutMode,
    booleanMode, moveMode, rotateMode, moveFaceMode, deleteFaceMode, featureSlots,
    sheetMetalMode, sheetMetalPicker, paintMode,
  ]);

  useEffect(() => {
    if (!isHoleEntry(contourMode?.entry) || contourPlaneOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelContourEditor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contourMode, contourPlaneOpen, cancelContourEditor]);

  const beginNewContour = useCallback((slot) => {
    if (!featureSlotsRef.current || !slot) return;
    slotReturnRef.current = slot;
    contourEditRef.current = null;
    setContourEdit(null);
    enterContourMode({ entry: 'crossSection' });
  }, [enterContourMode]);

  const openSavedContour = useCallback((contourId) => {
    if (!contourId || mode === 'game') return false;
    const fromEditor = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const buf = hasNamedContour(fromEditor, contourId)
      ? fromEditor
      : (hasNamedContour(currentScript, contourId) ? currentScript : fromEditor);
    const saved = listSavedContours(buf).find((row) => row.id === contourId);
    if (!saved) {
      showContourToast('That contour is not in this part.');
      return false;
    }
    const session = {
      id: saved.id,
      name: saved.name,
      usedBy: contourUsedByText(buf, saved.name),
    };
    const meshReady = !!(contourTopoRef.current?.edges && cachedMeshDataRef.current?.vertProperties);
    const resolved = resolveContourScript(buf, contourTopoRef.current?.edges || [], { meshReady });
    if (resolved.ok && resolved.changed) onContourRefsResolvedRef.current?.(resolved.buffer);
    const display = (resolved.displays || []).find((row) => row.id === saved.id);
    contourEditRef.current = session;
    setContourEdit(session);
    enterContourMode({ entry: 'crossSection' });
    // enterContourMode flushSyncs a fresh sketch onto the ref. Put the saved
    // contour there before paint: mode() and cancel_feature read the ref, and
    // a later functional update was leaving the peek open.
    const opened = contourModeRef.current;
    if (opened) {
      const applied = applySavedContour(opened, saved);
      const contour = applied.params?.contour;
      const refs = display?.refs || contour?.refs;
      const next = {
        ...applied,
        entry: 'crossSection',
        contourId: saved.id,
        contourName: saved.name,
        params: contour ? { ...applied.params, contour: { ...contour, refs } } : applied.params,
      };
      contourLiveWriteRef.current = next;
      contourModeRef.current = next;
      setContourMode(next);
    }
    contourPlaneOpenRef.current = false;
    setContourPlaneOpen(false);
    // The contour is already accepted. Drop the plane-card preview.
    overlayVis.end('planes');
    if (saved.plane?.normal) {
      setContourFaceAim('');
      requestFaceSketchAim(saved.plane.normal);
    }
    return true;
  }, [mode, getHelperBuffer, currentScript, enterContourMode, overlayVis]);

  const editSlotContour = useCallback((slot) => {
    const card = featureSlotsRef.current;
    if (!card || !slot) return;
    const ref = slot.role === 'station'
      ? card.stations?.[slot.index]
      : (slot.role === 'path' ? card.path : card.profile);
    if (!ref?.contourId) return;
    slotReturnRef.current = slot;
    if (!openSavedContour(ref.contourId)) slotReturnRef.current = null;
  }, [openSavedContour]);

  beginContourEditRef.current = (contourId) => {
    if (!allowFeaturePopup()) return false;
    slotReturnRef.current = null;
    featureSlotsRef.current = null;
    setFeatureSlots(null);
    setSlotHoverId(null);
    if (mode !== 'game') {
      const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || currentScript || '';
      const saved = readCentersContour(buf, contourId);
      if (saved) {
        holeCentresEditRef.current = saved;
        holeEditRef.current = null;
        setHoleCard(null);
        enterContourMode({ entry: 'hole', centresEdit: saved });
        return true;
      }
    }
    return openSavedContour(contourId) === true;
  };

  const confirmContourProfile = useCallback(() => {
    const state = contourModeRef.current;
    if (!state) return;
    if (isHoleEntry(state.entry)) {
      if (sheetHoleSketchRef.current && sheetMetalModeRef.current?.spec) {
        const sketch = sheetHoleSketchRef.current;
        const contour = holeSketchContour(state) || { points: [] };
        const built = sheetHolesFromSketch(sheetMetalModeRef.current.spec, sketch, contour);
        if (!built.ok) {
          showContourToast(built.message);
          return;
        }
        if (!built.empty) {
          const ok = onCommitSheetMetal?.({ ...built.spec }, {
            partId: sheetMetalModeRef.current.partId,
            step: 'hole',
          });
          if (!ok) return;
          sheetHoleSketchRef.current = null;
          setSheetMetalMode((prev) => (prev ? {
            ...prev,
            spec: built.spec,
            holeSketch: null,
            draft: null,
          } : prev));
        }
        exitContourMode();
        return;
      }
      if (holeCentresEditRef.current) {
        const contour = holeSketchContour(state) || { points: [] };
        const ok = onCommitHole?.({
          editCentres: true,
          partId: activePartIdRef.current,
          contourId: holeCentresEditRef.current.id,
          contour,
          frame: planeFromContourFace(activeContourFace(state, modelBounds)),
          planeOffset: Number(state.planeOffset) || 0,
        });
        if (ok) exitContourMode();
        return;
      }
      const contour = holeSketchContour(state);
      if (!contour?.points?.length) {
        exitContourMode();
        return;
      }
      const commitFace = activeContourFace(state, modelBounds);
      const ok = onCommitHole?.({
        partId: activePartIdRef.current,
        frame: planeFromContourFace(commitFace),
        contour,
        spec: state.holeSpec || {},
        planeOffset: Number(state.planeOffset) || 0,
      });
      if (ok) exitContourMode();
      return;
    }
    // Nothing drawn. Confirm must not toast, and must not emit an empty
    // polygon or the loft station's circle.
    if (
      cursorSketchEmpty(state)
      && !isSolidContourEntry(state.entry)
      && !isWorkplaneEntry(state.entry)
    ) return;
    if (contourEditRef.current) {
      const edit = contourEditRef.current;
      if (state.tool === 'path') {
        const pts = state.params?.points;
        if (!Array.isArray(pts) || pts.length < 2) {
          showContourToast('Path needs at least 2 points.');
          return;
        }
      } else {
        const gate = validateContourProfile(state.tool, state.params);
        if (!gate.ok) {
          showContourToast(gate.message);
          return;
        }
      }
      const commitFace = activeContourFace(state, modelBounds);
      const ok = onCommitContourProfile?.({
        editContour: true,
        partId: activePartIdRef.current,
        contourId: edit.id,
        contourName: state.contourName || edit.name,
        face: state.planeFace || commitFace,
        tool: state.tool,
        params: state.params,
        planeOffset: Number(state.planeOffset) || 0,
      });
      if (!ok) return;
      const back = !!(slotReturnRef.current && featureSlotsRef.current);
      if (back) {
        const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
        const saved = listSavedContours(buf).find((row) => row.id === edit.id);
        if (saved) setFeatureSlots((prev) => renameFeatureSlotRefs(prev, edit.id, saved));
      }
      slotReturnRef.current = null;
      exitContourMode(back ? 'slot' : undefined);
      return;
    }
    if (slotReturnRef.current && featureSlotsRef.current) {
      const slot = slotReturnRef.current;
      const gate = validateContourProfile(state.tool, state.params);
      if (!gate.ok) {
        showContourToast(gate.message);
        return;
      }
      const commitFace = activeContourFace(state, modelBounds);
      const ok = onCommitContourProfile?.({
        partId: activePartIdRef.current,
        face: state.planeFace || commitFace,
        tool: state.tool,
        params: state.params,
        entry: 'crossSection',
        saveAsPath: slot.role === 'path',
        planeOffset: Number(state.planeOffset) || 0,
      });
      if (!ok) return;
      const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
      const saved = listSavedContours(buf);
      const created = saved.length ? saved[saved.length - 1] : null;
      slotReturnRef.current = null;
      if (created) setFeatureSlots((prev) => assignFeatureSlot(prev, slot, created));
      exitContourMode('slot');
      return;
    }
    if (!isWorkplaneEntry(state.entry)) {
      const gate = validateContourProfile(state.tool, state.params);
      if (!gate.ok) {
        showContourToast(gate.message);
        return;
      }
    }
    const commitFace = activeContourFace(state, modelBounds);
    if (isExtrudeEntry(state.entry)) {
      const extGate = validateExtrudeParams(state.extrude);
      if (!extGate.ok) {
        showContourToast(extGate.message);
        return;
      }
      const axis = resolveExtrudeAxis(
        planeFromContourFace(commitFace),
        extGate.normalized.direction,
      );
      if (!axis.ok) {
        showContourToast(axis.message);
        return;
      }
    }
    if (isRevolveEntry(state.entry)) {
      const revGate = validateRevolveParams(state.revolve);
      if (!revGate.ok) {
        showContourToast(revGate.message);
        return;
      }
      const axis = resolveRevolveAxis(
        planeFromContourFace(commitFace),
        revGate.normalized.axis,
      );
      if (!axis.ok) {
        showContourToast(axis.message);
        return;
      }
    }
    if (isLoftEntry(state.entry)) {
      const loftGate = validateLoftProfiles(state.loft?.profiles);
      if (!loftGate.ok) {
        showContourToast(loftGate.message);
        return;
      }
    }
    if (isSweepEntry(state.entry)) {
      const pathGate = validateSweepPath(selectedEdges, state.sweep);
      if (!pathGate.ok) {
        showContourToast(pathGate.message);
        return;
      }
    }
    const loftState = isLoftEntry(state.entry)
      ? writeLoftSelected(state, {
        tool: state.tool,
        params: { ...(state.params || {}) },
      })
      : state;
    if (featureEditRef.current?.dialog === 'contour') {
      const ok = commitFeatureEditRef.current?.({
        fields: {
          ...(featureEditRef.current.session?.fields || {}),
          ...contourFieldsFromState(loftState),
        },
      });
      if (ok) exitContourMode();
      return;
    }
    const ok = onCommitContourProfile?.({
      partId: activePartIdRef.current,
      face: loftState.planeFace || commitFace,
      tool: loftState.tool,
      params: loftState.params,
      entry: loftState.entry,
      extrude: loftState.extrude,
      revolve: loftState.revolve,
      loft: loftState.loft,
      sweep: loftState.sweep,
      edges: selectedEdges,
      combine: loftState.combine === 'subtract' ? 'subtract' : 'add',
      // Merge bodies is an Add option; Subtract always cuts.
      merge: loftState.combine === 'subtract' ? true : loftState.merge !== false,
      contourId: loftState.contourId || null,
      contourName: loftState.contourName || null,
      planeOffset: Number(loftState.planeOffset) || 0,
    });
    if (ok) {
      exitContourMode();
    }
  }, [onCommitContourProfile, onCommitHole, onCommitSheetMetal, selectedEdges, modelBounds, exitContourMode, getHelperBuffer]);

  const commitContourDelete = useCallback((withFeatures) => {
    const edit = contourEditRef.current;
    const contourId = edit?.id || shapeDeleteIdRef.current;
    if (!contourId) return;
    const ok = onDeleteContour?.({
      partId: activePartIdRef.current,
      contourId,
      withFeatures: !!withFeatures,
    });
    if (!ok) return;
    shapeDeleteIdRef.current = null;
    setContourDeleteConfirm(null);
    const text = withFeatures ? 'Deleted the contour and its features.' : 'Deleted contour.';
    const showDeleted = () => {
      setContourToast({ text, undo: true, deleted: true });
      if (contourToastTimerRef.current) clearTimeout(contourToastTimerRef.current);
      contourToastTimerRef.current = setTimeout(() => {
        contourToastTimerRef.current = null;
        setContourToast(null);
      }, 3200);
    };
    if (!edit) {
      setContourMode((prev) => (prev ? clearPolylineShape(prev, { dropIdentity: true }) : prev));
      showDeleted();
      return;
    }
    const back = !!(slotReturnRef.current && featureSlotsRef.current);
    if (back) setFeatureSlots((prev) => clearFeatureSlotRefs(prev, edit.id));
    slotReturnRef.current = null;
    exitContourMode(back ? 'slot' : undefined);
    // exitContourMode clears the contour toast. Set the Undo toast after it
    // so the last update in this click is the one that stays.
    showDeleted();
  }, [onDeleteContour, exitContourMode]);

  /**
   * Delete a saved polyline that fell under the auto-closed minimum.
   * No feature users: one undo, immediately. Users: the same red confirm
   * as contour Delete, then one undo of the shape and those features.
   * A missing statement clears the sketch and does not toast a refusal.
   */
  const requestShapeDelete = useCallback((contourId) => {
    const id = contourId ? String(contourId) : '';
    if (!id) return;
    shapeDeleteIdRef.current = id;
    const fromEditor = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const buf = hasNamedContour(fromEditor, id)
      ? fromEditor
      : (hasNamedContour(currentScript, id) ? currentScript : fromEditor);
    const plan = deleteContourStatement(buf, id, { withFeatures: false });
    if (plan.confirm) {
      setContourDeleteConfirm({ count: plan.count, label: plan.message });
      return;
    }
    if (!plan.ok) {
      shapeDeleteIdRef.current = null;
      setContourMode((prev) => (prev ? clearPolylineShape(prev, { dropIdentity: true }) : prev));
      return;
    }
    commitContourDelete(false);
  }, [getHelperBuffer, currentScript, commitContourDelete]);

  const requestContourDelete = useCallback(() => {
    const edit = contourEditRef.current;
    if (!edit) return;
    const fromEditor = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const buf = hasNamedContour(fromEditor, edit.id)
      ? fromEditor
      : (hasNamedContour(currentScript, edit.id) ? currentScript : fromEditor);
    const plan = deleteContourStatement(buf, edit.id, { withFeatures: false });
    if (plan.confirm) {
      setContourDeleteConfirm({ count: plan.count, label: plan.message });
      return;
    }
    if (!plan.ok) {
      showContourToast(plan.message);
      return;
    }
    commitContourDelete(false);
  }, [getHelperBuffer, currentScript, commitContourDelete]);

  /** One sketch step. The script stays until the contour is confirmed. */
  const applySketchEntityDelete = useCallback((id) => {
    let prev = contourModeRef.current;
    if (!prev || !id) return false;
    // An unpromoted circle, rectangle or polygon is the one 'shape' chip.
    // Promoting it first renames it to arcs and lines, so the delete would
    // find nothing and quietly keep the shape (#511 regression).
    if (id !== 'shape') prev = promoteContourState(prev) || prev;
    const result = deleteContourEntity(prev, id);
    if (!result.removed.length) return false;
    let next = { ...result.state, entityCard: null };
    if (isLoftEntry(next.entry) && next.loft?.profiles?.length) {
      const selected = Math.max(0, Math.min(next.loft.selected || 0, next.loft.profiles.length - 1));
      const profiles = next.loft.profiles.map((profile, index) => (
        index === selected ? { ...profile, tool: next.tool, params: next.params } : { ...profile }
      ));
      next = { ...next, loft: { ...next.loft, profiles, selected } };
    }
    setSketchDeleteConfirm(null);
    setContourMode(next);
    setContourToast({ text: 'Deleted.', undo: true, deleted: true, sketch: true });
    if (contourToastTimerRef.current) clearTimeout(contourToastTimerRef.current);
    contourToastTimerRef.current = setTimeout(() => {
      contourToastTimerRef.current = null;
      setContourToast(null);
    }, 3200);
    return true;
  }, []);
  applySketchEntityDeleteRef.current = applySketchEntityDelete;

  const requestSketchEntityDelete = useCallback(() => {
    const prev = contourModeRef.current;
    const id = prev?.entityCard;
    if (!prev || !id) return;
    const preview = deleteContourEntity(prev, id);
    if (!preview.removed.length) return;
    if (preview.label) {
      const chip = entityDeleteChip(prev);
      setSketchDeleteConfirm({
        id,
        label: preview.label,
        title: chip?.label ? `Delete ${chip.label.toLowerCase()}` : 'Delete',
      });
      return;
    }
    applySketchEntityDelete(id);
  }, [applySketchEntityDelete]);

  const exitFilletMode = useCallback(() => {
    cancelFeatureEditRef.current?.('fillet');
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    // Dismiss without Accept must not leave sticky edge picks.
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    if (filletToastTimerRef.current) {
      clearTimeout(filletToastTimerRef.current);
      filletToastTimerRef.current = null;
    }
    setFilletToast(null);
    // Restore pre-Fillet Face/Edge (Plane/Contour toggles were never cleared).
    const restore = filletPriorPickModeRef.current === 'edge' ? 'edge' : 'face';
    pickModeRef.current = restore;
    setPickMode(restore);
  }, [clearFilletBlendPreview, clearEdgeHover, clearEdgeHighlight]);

  const enterFilletMode = useCallback((opts = {}) => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    const entry = opts?.entry === 'chamferEdges' ? 'chamferEdges' : 'filletEdges';
    const picked = Array.isArray(opts.edges) ? opts.edges : selectedEdges;
    // Snapshot before exitContourMode, which forces face pick.
    filletPriorPickModeRef.current = pickModeRef.current === 'edge' ? 'edge' : 'face';
    exitContourMode();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('edge');
    clearHighlight();
    setSelectedFace(null);
    onFaceSelected?.(null);
    const next = entry === 'chamferEdges'
      ? enterChamferState(picked)
      : enterFilletState(picked);
    if (opts.params) {
      next.params = { ...next.params, ...opts.params };
      if (entry === 'chamferEdges') next.sizeTouched = true;
      else next.radiusTouched = true;
    }
    if (opts.missingLabel) next.missingLabel = opts.missingLabel;
    setFilletMode(next);
    filletModeRef.current = next;
    if (Array.isArray(opts.edges)) setSelectedEdges(opts.edges);
    setTangentProp(true);
    // No informational toast on successful Fillet/Chamfer UI open — soft-fail/accept gates still toast.
  }, [exitContourMode, onFaceSelected, selectedEdges, clearHighlight]);

  const acceptFillet = useCallback(() => {
    const state = filletModeRef.current;
    if (!state) return;
    // Edit Confirm is the create Accept path. A separate rewrite collapsed
    // disconnected corners into one makeSweepPath and the worker threw.
    const editing = featureEditRef.current;
    const editingBlend = editing && (editing.kind === 'fillet' || editing.kind === 'chamfer')
      ? editing
      : null;
    const closeBlendEdit = () => {
      if (!editingBlend) return;
      const live = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
      const restore = editingBlend.previewed && live === editingBlend.script ? live : '';
      featureEditRef.current = null;
      setHelperEdit(null);
      setFeatureEditBanner('');
      if (restore && assemblyRunLockRef?.current !== true) {
        executeScriptRef.current?.(restore, { editPreview: true });
      }
    };
    // Edge identity: every picked edge carries the name of the chain it lies
    // on, so Accept writes edgesNamed instead of ids or a literal wire.
    const edges = withEdgeNamesRef.current((selectedEdges && selectedEdges.length)
      ? selectedEdges
      : (state.lastEdges || []));
    const chamfer = state.entry === 'chamferEdges';
    const activeId = activePartIdRef.current;
    // Picks may span parts. Validate each part's chain before anything is
    // written: one bad part fails the whole Accept.
    const plan = planMultiPartEdgeAccept({
      edges,
      activeId,
      // An untouched size is 2 mm on every part. A typed size applies to every part.
      validate: (list) => {
        if (chamfer) {
          const params = state.sizeTouched
            ? state.params
            : { ...state.params, chamfer: defaultFilletRadius() };
          return validateChamferAccept(list, params);
        }
        // The part's geometry lets a branched pick prove its faces are flat
        // (box corners) instead of being refused as a junction.
        return validateFilletAccept(list, {
          ...partEdgeParams(state.params, list, {
            touched: !!state.radiusTouched,
            seed: () => defaultFilletRadius(),
          }),
          geometry: filletPartGeometryRef.current(edgePartId(list[0], activeId)),
        });
      },
      partName: (id) => partLabelsRef.current?.[id] || id,
    });
    if (!plan.ok) {
      showFilletToast(plan.message);
      return;
    }
    const onActive = (id) => !activeId || !id || String(id) === String(activeId);
    const own = plan.groups.find((group) => onActive(group.partId)) || null;
    // Other parts: same kind of block, written into that part's own script
    // (App writes it in the background as one step on that part's stack).
    // Their points and face ids are in that part's frame and mesh.
    const otherParts = plan.groups
      .filter((group) => !onActive(group.partId))
      .map((group) => {
        const geometry = assemblyExtrasRef.current.get(group.partId)?.geometry || null;
        return {
          partId: group.partId,
          edges: group.edges,
          params: group.gate.normalized,
          filletClass: !chamfer && geometry
            ? classifyFilletEdges(group.edges, { radius: group.gate.normalized.radius, geometry }).klass
            : null,
        };
      });
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    if (chamfer) {
      const ok = onCommitFillet?.({
        entry: 'chamferEdges',
        partId: activeId,
        edges: own ? own.edges : [],
        params: own ? own.gate.normalized : state.params,
        commitMode: hasChamferModeBlock(buf) ? 'append' : 'replace',
        otherParts,
        editFeature: editingBlend?.feature || null,
      });
      if (ok) {
        edgeRematchToastSuppressRef.current = true;
        clearEdgeHover();
        clearEdgeHighlight();
        setSelectedEdges([]);
        closeBlendEdit();
        exitFilletMode();
      }
      return;
    }
    // No picks on the active part: nothing to classify on this mesh.
    const edgeClass = own
      ? classifyFilletEdges(own.edges, {
        radius: own.gate.normalized.radius,
        geometry: resultRef.current?.geometry,
      })
      : { klass: null };
    if (own) {
      filletQualityWatchRef.current = {
        preDeg: countDegenerateTriangles(resultRef.current?.geometry),
      };
    }
    const ok = onCommitFillet?.({
      partId: activeId,
      edges: own ? own.edges : [],
      params: own ? own.gate.normalized : state.params,
      filletClass: edgeClass.klass,
      geometry: own ? resultRef.current?.geometry : null,
      commitMode: hasFilletModeBlock(buf) ? 'append' : 'replace',
      otherParts,
      editFeature: editingBlend?.feature || null,
    });
    if (!ok) filletQualityWatchRef.current = null;
    if (ok) {
      edgeRematchToastSuppressRef.current = true;
      // Keep Face/Edge (and Plane/Contour) — exitFilletMode restores pre-Fillet pick.
      clearEdgeHover();
      clearEdgeHighlight();
      setSelectedEdges([]);
      closeBlendEdit();
      exitFilletMode();
    }
  }, [onCommitFillet, selectedEdges, getHelperBuffer, exitFilletMode, clearEdgeHover, clearEdgeHighlight]);

  const exitShellMode = useCallback(() => {
    cancelFeatureEditRef.current?.('shell');
    setShellMode(null);
    shellModeRef.current = null;
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, []);

  const enterShellMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const next = enterShellState(selectedFace);
    next.params = {
      ...next.params,
      wall: shellWallRange(
        characteristicLengthMm({ bounds: modelBoundsRef.current }),
        solidMinExtent(resultRef.current?.geometry),
      ).defaultMm,
    };
    setShellMode(next);
    shellModeRef.current = next;
  }, [exitContourMode, selectedFace, clearFilletBlendPreview, clearEdgeHover, clearEdgeHighlight, clearHighlight]);

  const repaintFaceSkins = () => {
    const apply = applyFaceSkinRef.current;
    if (resultRef.current) apply(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) apply(mesh);
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  };

  const exitPaintMode = useCallback(() => {
    paintModeRef.current = null;
    setPaintMode(null);
    clearHighlight();
    repaintFaceSkins();
  }, [clearHighlight]);
  exitPaintModeRef.current = exitPaintMode;

  const enterPaintMode = useCallback((opts = {}) => {
    // Headless: the agent paints while an in-viewer prompt is being worked.
    // The session runs (taps, undo, confirm), the card is not mounted, so
    // the feature-popup gate that holds agent cards back does not refuse it.
    const headless = opts?.headless === true;
    if (!headless && !allowFeaturePopup()) return;
    if (mode === 'game') return;
    closeFeatureSlotsRef.current();
    feaCloseRef.current();
    clearWallMapRef.current();
    clearPartingRef.current();
    clearSideActionsRef.current();
    clearMoldDraftRef.current();
    clearDfmRef.current();
    clearQuoteRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    cancelFeatureEditRef.current?.('sheetMetal');
    setSheetMetalMode(null);
    sheetMetalModeRef.current = null;
    setSheetMetalPicker(null);
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const base = clonePaintSession(assemblyColorsRef.current);
    const next = {
      color: PAINT_SWATCHES[0],
      custom: '',
      baseline: base,
      session: clonePaintSession(base),
      undo: [],
      lastTap: null,
      ...(headless ? { headless: true } : {}),
    };
    paintModeRef.current = next;
    setPaintMode(next);
    clearHighlight();
  }, [
    mode, exitContourMode, clearFilletBlendPreview, clearHighlight, clearEdgeHover, clearEdgeHighlight,
  ]);

  // Analyze takes the canvas the way Paint does. Other mode chips close first.
  // This does not post a build and does not touch the assembly-open lock.
  const releaseModesForFea = useCallback(() => {
    closeFeatureSlotsRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    cancelFeatureEditRef.current?.('sheetMetal');
    setSheetMetalMode(null);
    sheetMetalModeRef.current = null;
    setSheetMetalPicker(null);
    exitPaintMode();
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
  }, [exitContourMode, clearFilletBlendPreview, clearHighlight, exitPaintMode, clearEdgeHover, clearEdgeHighlight]);

  const acceptShell = useCallback(() => {
    const state = shellModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'shell') {
      const wall = Number(state.params?.wall);
      if (!(wall > 0)) {
        showShellToast('Wall thickness must be greater than 0.');
        return;
      }
      const openingMode = state.params?.openingMode === 'none' ? 'none' : 'face';
      const draft = {
        fields: { ...(featureEditRef.current.session?.fields || {}), wall, openingMode },
      };
      if (featureEditRef.current.clearMissing) draft.faces = featureEditRef.current.resolvedFaces || [];
      const ok = commitFeatureEditRef.current?.(draft);
      if (ok) {
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
        exitShellMode();
      }
      return;
    }
    const liveFace = selectedFace
      ? (selectedFace.type ? selectedFace : classifySelectedFace(selectedFace))
      : null;
    const face = liveFace || state.lastFace || null;
    const gate = validateShellAccept(face, state.params);
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitShell?.({
      partId: activePartIdRef.current,
      face: gate.face,
      params: gate.normalized,
      // One Shell feature. Replacing the marked block keeps a single hollow()
      // even when the script already has one — appending would shell the
      // already thin body. Extra openings are further taps on this picker.
      commitMode: 'replace',
    });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitShellMode();
    }
  }, [onCommitShell, selectedFace, exitShellMode, onFaceSelected, clearHighlight]);

  // Keep lastFace in sync while the user picks opening faces in Shell mode.
  useEffect(() => {
    if (!shellMode) return;
    if (!selectedFace) return;
    const classified = selectedFace.type
      ? selectedFace
      : classifySelectedFace(selectedFace);
    if (!classified) return;
    setShellMode((prev) => {
      if (!prev) return prev;
      const next = { ...prev, lastFace: classified };
      shellModeRef.current = next;
      return next;
    });
  }, [shellMode, selectedFace]);

  // Live sweep-fillet blend as edges accumulate. The payload is memoized so the
  // chip's pathOk flag and the painter share ONE build per input (Slice 27 nit:
  // the chip used to re-run buildFilletBlendPreview on every render just for .ok).
  // Fillet / Chamfer picks can span parts. The live blend and the seeded
  // radius read the active part's picks only: those are the points in the
  // pick mesh's frame. Easy/hard class is computed on Accept, not shown.
  // Picks kept on other parts are still highlighted and still written on Accept.
  const filletActiveEdges = useMemo(
    () => activePartEdges(selectedEdges, activePartIdRef.current),
    // meshEpoch: a retarget swaps the active part without touching the picks.
    [selectedEdges, meshEpoch],
  );
  const filletPartCount = useMemo(
    () => groupEdgesByPart(selectedEdges, activePartIdRef.current).length,
    [selectedEdges, meshEpoch],
  );

  // The geometry a part's picks sit on: the live result for the active part,
  // the assembly extra for any other. Box-corner picks read it to prove the
  // faces around a junction are flat.
  const filletPartGeometry = useCallback((partId) => (
    (partId == null || partId === '' || String(partId) === String(activePartIdRef.current))
      ? resultRef.current?.geometry || null
      : assemblyExtrasRef.current?.get(partId)?.geometry || null
  ), []);
  filletPartGeometryRef.current = filletPartGeometry;
  const filletPreviewParams = useCallback((mode, geometry = filletPartGeometry(null)) => (
    mode.entry === 'chamferEdges'
      ? {
        ...(mode.params || {}),
        strategy: 'sweep',
        profile: 'chamfer',
        radius: mode.params?.chamfer,
      }
      : { ...(mode.params || {}), geometry }
  ), [filletPartGeometry]);
  const filletBlendPayload = useMemo(() => {
    if (!filletMode) return null;
    return buildFilletBlendPreview(filletActiveEdges, filletPreviewParams(filletMode));
    // meshEpoch: a new run is a new geometry for the same picks.
  }, [filletMode, filletActiveEdges, filletPreviewParams, meshEpoch]);
  // Chip status across every part with picks: each part's chain must build.
  const filletChipStatus = useMemo(() => {
    if (!filletMode) return { ok: false, componentCount: 0, boxCorners: 0, joins: '' };
    // A pick on an earlier fillet's arcs of the same radius extends that
    // block (filletAccumulate.js); the card says so.
    let joins = '';
    if (filletMode.entry !== 'chamferEdges' && filletBlendPayload?.ok === true) {
      try {
        const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
        const hit = filletAccumulationFor(buf, withEdgeNamesRef.current(filletActiveEdges), filletMode.params || {});
        joins = hit ? hit.id : '';
      } catch { joins = ''; }
    }
    if (filletPartCount <= 1) {
      return {
        ok: filletBlendPayload?.ok === true,
        componentCount: filletBlendPayload?.componentCount || 0,
        boxCorners: filletBlendPayload?.boxCorners || 0,
        joins,
      };
    }
    let ok = true;
    let componentCount = 0;
    let boxCorners = 0;
    for (const group of groupEdgesByPart(selectedEdges, activePartIdRef.current)) {
      const payload = buildFilletBlendPreview(
        group.edges,
        filletPreviewParams(filletMode, filletPartGeometry(group.partId)),
      );
      if (payload?.ok !== true) ok = false;
      componentCount += payload?.componentCount || 0;
      boxCorners += payload?.boxCorners || 0;
    }
    return { ok, componentCount, boxCorners, joins };
  }, [filletMode, filletPartCount, filletBlendPayload, selectedEdges, filletPreviewParams, filletPartGeometry, filletActiveEdges, getHelperBuffer]);
  useEffect(() => {
    if (!filletMode) {
      clearFilletBlendPreview();
      return;
    }
    if (!filletActiveEdges.length) {
      clearFilletBlendPreview();
      return;
    }
    if (filletMode.entry === 'chamferEdges') {
      if (!filletMode.sizeTouched) {
        const seeded = defaultFilletRadius();
        if (Number(filletMode.params?.chamfer) !== seeded) {
          setFilletMode((prev) => (
            prev && !prev.sizeTouched
              ? { ...prev, params: { ...prev.params, chamfer: seeded } }
              : prev
          ));
          return;
        }
      }
      paintFilletBlendPreview(filletBlendPayload);
      return;
    }
    if (!filletMode.radiusTouched) {
      const seeded = defaultFilletRadius();
      if (Number(filletMode.params?.radius) !== seeded) {
        setFilletMode((prev) => (
          prev && !prev.radiusTouched
            ? { ...prev, params: { ...prev.params, radius: seeded } }
            : prev
        ));
        return;
      }
    }
    paintFilletBlendPreview(filletBlendPayload);
  }, [filletMode, filletActiveEdges, filletBlendPayload, paintFilletBlendPreview, clearFilletBlendPreview]);

  const clearIdLabels = useCallback(() => {
    const group = idLabelGroupRef.current;
    if (group && sceneRef.current) sceneRef.current.remove(group);
    if (group) {
      group.traverse((obj) => {
        if (obj.material) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
    }
    idLabelGroupRef.current = null;
  }, []);

  useEffect(() => () => {
    clearFilletBlendPreview();
    if (filletToastTimerRef.current) clearTimeout(filletToastTimerRef.current);
  }, [clearFilletBlendPreview]);

  const savedContours = useMemo(() => {
    const script = currentScript || '';
    return listSavedContours(script).map((row) => ({
      ...row,
      unused: contourFeatureUsers(script, row.name).length === 0,
    }));
  }, [currentScript]);

  const constructionPlanes = useMemo(
    () => listConstructionPlanes(currentScript || ''),
    [currentScript],
  );
  constructionPlanesRef.current = constructionPlanes;

  const savedContourHostPlane = useMemo(() => {
    if (modelBounds?.max && Number.isFinite(Number(modelBounds.max[2]))) {
      return defaultTopPlaneFrame([
        Number(modelBounds.center?.[0]) || 0,
        Number(modelBounds.center?.[1]) || 0,
        Number(modelBounds.max[2]),
      ]);
    }
    return defaultTopPlaneFrame([0, 0, 0]);
  }, [modelBounds]);

  /**
   * Contours and work planes of every visible part, each from its own
   * script (the editor part from the live buffer) and in its own frame.
   */
  const partOverlayEntries = useCallback(() => {
    const ctx = getBooleanContextRef.current?.() || {};
    const editorId = ctx.activeId ?? activePartIdRef.current ?? null;
    const sources = partOverlaySources({
      parts: ctx.parts || null,
      editorId,
      editorScript: currentScript || '',
    });
    const hostPlaneFor = (id) => {
      const geom = (id == null || id === activePartIdRef.current)
        ? resultRef.current?.geometry
        : assemblyExtrasRef.current?.get(id)?.geometry;
      if (geom?.attributes?.position) {
        if (!geom.boundingBox) geom.computeBoundingBox();
        const b = geom.boundingBox;
        if (b && !b.isEmpty()) {
          return defaultTopPlaneFrame([(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z]);
        }
      }
      return id == null || id === editorId ? savedContourHostPlane : defaultTopPlaneFrame([0, 0, 0]);
    };
    return sources.map((src) => ({
      ...src,
      contours: src.editor ? savedContours : listSavedContours(src.script),
      planes: src.editor ? constructionPlanes : listConstructionPlanes(src.script),
      hostPlane: hostPlaneFor(src.partId),
    }));
  }, [currentScript, savedContours, constructionPlanes, savedContourHostPlane]);

  useEffect(() => {
    const entries = partOverlayEntries();
    const editor = entries.find((entry) => entry.editor) || null;
    savedContoursRef.current = savedContours;
    savedContourHostPlaneRef.current = editor?.hostPlane || savedContourHostPlane;
    editorOverlayPartIdRef.current = editor ? editor.partId : null;
    savedContourOffsetRef.current = editor
      ? overlayAnchorForRef.current(editor.partId, editor.position, editor.quaternion)
      : { t: [0, 0, 0], q: [0, 0, 0, 1] };
    if (!showContours) {
      clearSavedContourGhosts();
      return;
    }
    const pickedId = featureSlotGhostId(featureSlots, slotHoverId)
      || contourMode?.pickedContourId
      || armedContourId;
    // The script still has the pre-solve contour until the rail checkmark.
    // Painting it again leaves the old orange highlight and the gray ghost
    // on top of the live solve.
    const liveId = (
      contourMode?.params?.contour
      && !contourPlaneOpen
      && (contourMode.contourId || contourMode.pickedContourId)
    ) || null;
    paintSavedContourGhosts(entries.map((entry) => ({
      ...entry,
      pickedId,
      contours: liveId && entry.editor
        ? (entry.contours || []).filter((contour) => contour.id !== liveId)
        : entry.contours,
    })));
  }, [
    contourMode,
    contourPlaneOpen,
    featureSlots,
    slotHoverId,
    armedContourId,
    savedContours,
    savedContourHostPlane,
    showContours,
    paintSavedContourGhosts,
    clearSavedContourGhosts,
    partOverlayEntries,
    meshEpoch,
    overlayEpoch,
    sceneReady,
  ]);

  const jointPlanePickKey = (jointCard?.picks || [])
    .filter((pick) => pick?.kind === 'plane' && pick.key?.id)
    .map((pick) => `${pick.partId}:${pick.key.id}`)
    .join('|');

  const holePlaneCard = isHoleEntry(contourMode?.entry) && contourPlaneOpen;
  const planeToolOpen = isWorkplaneEntry(contourMode?.entry) || holePlaneCard;
  const mirrorPlanesOpen = !!mirrorMode;
  // A selected face hides XY/YZ/ZX. The rail hold stays on, so closing the
  // tool still restores whatever visibility the planes toggle had before.
  const planeFaceSelected = planeToolOpen && !!selectedFace;
  const releaseWorkplaneFaceRef = useRef(() => {});
  releaseWorkplaneFaceRef.current = () => {
    if (!isWorkplaneEntry(contourModeRef.current?.entry)) return;
    clearHighlight();
    setSelectedFace(null);
    onFaceSelectedRef.current?.(null);
  };

  useEffect(() => {
    if (!showPlanes) {
      clearConstructionPlanes();
      return;
    }
    const picked = new Set(jointPlanePickKey ? jointPlanePickKey.split('|') : []);
    paintConstructionPlanes(partOverlayEntries().map((entry) => ({
      ...entry,
      planes: jointPicking
        ? planesForJointOverlay(entry, true)
        : (planeToolOpen || mirrorPlanesOpen
          ? planesForWorkplaneTool(entry, { references: !planeFaceSelected })
          : planesForJointOverlay(entry, false)),
      selectedId: selectedPlaneId,
      jointPlaneIds: picked,
    })));
  }, [
    selectedPlaneId,
    showPlanes,
    planeToolOpen,
    mirrorPlanesOpen,
    planeFaceSelected,
    jointPicking,
    jointPlanePickKey,
    paintConstructionPlanes,
    clearConstructionPlanes,
    partOverlayEntries,
    meshEpoch,
    overlayEpoch,
    sceneReady,
  ]);

  useEffect(() => () => {
    clearConstructionPlanes();
  }, [clearConstructionPlanes]);

  /**
   * Dimension re-solve, point drag, and undo rebuild the live sketch.
   * Preview meshes and the saved-contour highlight are not part of that
   * rebuild, so the previous shape stays unless these are dropped first.
   * Face highlights held by highlightMeshRef stay: Select plane frames
   * them, and clearHighlight() is what releases the face pick.
   * keepSketch leaves the handles and the status wire during a drag.
   */
  const clearStaleSolveOverlays = useCallback(({ keepSketch = false } = {}) => {
    clearXsPreview();
    clearExtrudePreview();
    clearRevolvePreview();
    clearLoftPreview();
    clearSweepPreview();
    clearEdgeHover();
    const sweep = isSweepEntry(contourModeRef.current?.entry);
    if (!sweep) clearEdgeHighlight();
    const live = !!(
      contourModeRef.current?.params?.contour
      && !contourPlaneOpenRef.current
    );
    const names = new Set(SKETCH_PREVIEW_NAMES);
    for (const name of SKETCH_HIGHLIGHT_NAMES) {
      if (name === 'highlight') continue;
      if (sweep && (name === 'edgeSelection' || name === 'edgeSelectionOtherPart')) continue;
      if (name === 'contourSelected' && !live) continue;
      names.add(name);
    }
    if (!keepSketch) {
      for (const name of SKETCH_WIRE_NAMES) names.add(name);
    }
    const scene = sceneRef.current;
    dropNamedOverlays(scene, names);
    const kept = new Set();
    const meshes = highlightMeshRef.current;
    const list = Array.isArray(meshes) ? meshes : (meshes ? [meshes] : []);
    for (const mesh of list) {
      if (mesh) kept.add(mesh);
    }
    if (scene) {
      const orphans = [];
      scene.traverse((obj) => {
        if (obj?.name === 'highlight' && !kept.has(obj)) orphans.push(obj);
      });
      const orphanSet = new Set(orphans);
      for (const obj of orphans) {
        let parent = obj.parent;
        let nested = false;
        while (parent) {
          if (orphanSet.has(parent)) {
            nested = true;
            break;
          }
          parent = parent.parent;
        }
        if (!nested) disposeEdgeOverlayObject(scene, obj);
      }
    }
    if (!keepSketch) {
      for (const ref of [contourStatusRef, contourRefRef, polylineDraftRef]) {
        if (ref.current && !ref.current.parent) ref.current = null;
      }
    }
  }, [
    clearXsPreview,
    clearExtrudePreview,
    clearRevolvePreview,
    clearLoftPreview,
    clearSweepPreview,
    clearEdgeHover,
    clearEdgeHighlight,
  ]);

  // Live workplane + makeCrossSection profile (+ Extrude / Revolve / Loft solid) preview.
  useEffect(() => {
    if (!contourMode) {
      clearWorkplaneOverlay();
      clearPolylineDraft();
      clearContourStatusWire();
      clearContourRefWire();
      clearXsPreview();
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      applyContourPartGhost(false);
      dropNamedOverlays(sceneRef.current, new Set([
        ...SKETCH_PREVIEW_NAMES,
        'contourSelected',
        ...SKETCH_WIRE_NAMES,
      ]));
      return;
    }
    clearStaleSolveOverlays();
    // No face pick: snap the default +Z plane to the part top so the live
    // solid sits on the workplane (same intent as facesByNormal on Confirm).
    // Same resolver the polyline hit-test uses — see contourWorkplaneFace.
    const planeFace = contourWorkplaneFace(contourMode, modelBounds);
    const plane = planeFromContourFace(planeFace);
    // The sketch plane square is not drawn. Select plane still aims the camera.
    clearWorkplaneOverlay();
    applyContourPartGhost(true);
    if (isWorkplaneEntry(contourMode.entry)) {
      clearXsPreview();
      clearPolylineDraft();
      clearContourStatusWire();
      clearContourRefWire();
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      // A face tap or an X/Y/Z pick stores planeFace. Until then there is
      // no new plane to preview. Offset and angles are already in that frame.
      if (contourMode.planeFace) paintPlaneToolPreview(planeFromContourFace(contourMode.planeFace));
      return;
    }
    if (isHoleEntry(contourMode.entry)) {
      clearXsPreview();
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      const holeHandles = sketchHandles(contourMode);
      const holePts = holeHandles.map((h) => h.at);
      const holeIds = holeHandles.map((h) => h.id);
      const holeParams = contourMode.params || {};
      const holeRectangle = !holeParams.contour
        && holeParams.width != null
        && holeParams.height != null
        && !(Array.isArray(holeParams.points) && holeParams.points.length);
      const holePicks = sketchHighlightPicks(contourMode);
      const holeRefs = referencePaintSegments(contourMode.params?.contour, holePicks);
      if (holeRefs.length) paintContourRefWire(plane, holeRefs);
      else clearContourRefWire();
      const holePaint = highlightContourPaint(
        contourMode.params?.contour ? contourPaintModel(contourMode.params.contour) : null,
        contourMode.params?.contour,
        holePicks,
      );
      if (holePts.length) {
        paintPolylineDraft(plane, holePts, {
          wire: !holePaint && holePts.length >= 2,
          pointColors: holePaint?.pointColors || null,
          pointIds: holeIds,
          dashed: true,
          closed: holeRectangle,
        });
      } else {
        clearPolylineDraft();
      }
      if (holePaint) paintContourStatusWire(plane, holePaint.segments, { dashed: true });
      else clearContourStatusWire();
      return;
    }
    const handles = sketchHandles(contourMode);
    const pts = handles.map((h) => h.at);
    const handleIds = handles.map((h) => h.id);
    const loftDraw = selectedLoftDrawFrame(contourMode) || plane;
    const drawPlane = isLoftEntry(contourMode.entry) ? loftDraw : plane;
    const highlightPicks = sketchHighlightPicks(contourMode);
    const refSegs = referencePaintSegments(contourMode.params?.contour, highlightPicks);
    if (refSegs.length) paintContourRefWire(drawPlane, refSegs);
    else clearContourRefWire();
    const paint = highlightContourPaint(
      contourMode.params?.contour ? contourPaintModel(contourMode.params.contour) : null,
      contourMode.params?.contour,
      highlightPicks,
    );
    const openPolyline = contourMode.tool === 'polyline'
      && !contourMode.params?.contour
      && pts.length < 3;
    if (openPolyline) {
      clearXsPreview();
      clearExtrudePreview();
      clearRevolvePreview();
      paintPolylineDraft(drawPlane, pts, {
        wire: !paint,
        pointColors: paint?.pointColors || null,
        pointIds: handleIds,
      });
      if (paint) paintContourStatusWire(drawPlane, paint.segments);
      else clearContourStatusWire();
      clearSweepPreview();
      if (isLoftEntry(contourMode.entry)) {
        const solid = buildLoftSolidPreview(planeFace, contourMode.loft?.profiles);
        if (solid) paintLoftPreview(solid);
        else clearLoftPreview();
      } else {
        clearLoftPreview();
      }
      return;
    }
    // Grab handles stay on every sketch, whichever tool is selected.
    // A closed profile draws its own outline, so the handles do not add a
    // second wire. Solver-locked points still paint; the drag refuses them.
    if (handles.length) {
      paintPolylineDraft(drawPlane, pts, {
        wire: false,
        pointColors: paint?.pointColors || null,
        pointIds: handleIds,
      });
    } else {
      clearPolylineDraft();
    }
    if (paint) paintContourStatusWire(drawPlane, paint.segments);
    else clearContourStatusWire();
    if (isLoftEntry(contourMode.entry)) {
      clearXsPreview();
      clearExtrudePreview();
      clearRevolvePreview();
      const solid = buildLoftSolidPreview(planeFace, contourMode.loft?.profiles);
      if (solid) paintLoftPreview(solid);
      else clearLoftPreview();
      clearSweepPreview();
    } else if (buildContourPreview(planeFace, contourMode.tool, contourMode.params)) {
      setXsPreview({
        face: planeFace,
        params: toolToProfileParams(contourMode.tool, contourMode.params),
        hideRings: !!paint,
      });
      if (isExtrudeEntry(contourMode.entry)) {
        clearRevolvePreview();
        clearLoftPreview();
        const solid = buildExtrudeSolidPreview(
          planeFace,
          contourMode.tool,
          contourMode.params,
          contourMode.extrude,
        );
        if (solid) paintExtrudePreview(solid);
        else clearExtrudePreview();
        clearSweepPreview();
      } else if (isRevolveEntry(contourMode.entry)) {
        clearExtrudePreview();
        clearLoftPreview();
        clearSweepPreview();
        const solid = buildRevolveSolidPreview(
          planeFace,
          contourMode.tool,
          contourMode.params,
          contourMode.revolve,
        );
        if (solid) paintRevolvePreview(solid);
        else clearRevolvePreview();
      } else if (isSweepEntry(contourMode.entry)) {
        clearExtrudePreview();
        clearRevolvePreview();
        clearLoftPreview();
        const solid = buildSweepSolidPreview(
          planeFace,
          contourMode.tool,
          contourMode.params,
          selectedEdges,
          contourMode.sweep,
        );
        if (solid) paintSweepPreview(solid);
        else clearSweepPreview();
      } else {
        clearExtrudePreview();
        clearRevolvePreview();
        clearLoftPreview();
        clearSweepPreview();
      }
    } else {
      clearXsPreview();
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
    }
  }, [contourMode, modelBounds, selectedEdges, paintPolylineDraft, paintContourStatusWire, paintContourRefWire, paintExtrudePreview, paintRevolvePreview, paintLoftPreview, paintSweepPreview, applyContourPartGhost, clearWorkplaneOverlay, paintPlaneToolPreview, clearPolylineDraft, clearContourStatusWire, clearContourRefWire, clearExtrudePreview, clearRevolvePreview, clearLoftPreview, clearSweepPreview, clearXsPreview, setXsPreview, clearStaleSolveOverlays]);

  // Slot cards never set a solid contour entry, so the effect above clears
  // the solid. Paint it again from the filled contours and the card params.
  // Declared after that effect so a same-commit clear does not win.
  useEffect(() => {
    if (mode === 'game' || !featureSlots) return;
    if (contourMode && isSolidContourEntry(contourMode.entry)) return;
    const returning = slotReturnRef.current;
    const live = contourMode && returning && !isWorkplaneEntry(contourMode.entry)
      ? {
        slot: returning,
        tool: contourMode.tool,
        params: contourMode.params,
        face: activeContourFace(contourMode, modelBounds),
      }
      : null;
    const built = buildFeatureSlotPreview(featureSlots, savedContours, live);
    if (!built) {
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      return;
    }
    if (built.kind === 'extrude') {
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      paintExtrudePreview(built.payload);
    } else if (built.kind === 'revolve') {
      clearExtrudePreview();
      clearLoftPreview();
      clearSweepPreview();
      paintRevolvePreview(built.payload);
    } else if (built.kind === 'loft') {
      clearExtrudePreview();
      clearRevolvePreview();
      clearSweepPreview();
      paintLoftPreview(built.payload);
    } else if (built.kind === 'sweep') {
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      paintSweepPreview(built.payload);
    }
  }, [
    mode,
    featureSlots,
    contourMode,
    savedContours,
    modelBounds,
    paintExtrudePreview,
    paintRevolvePreview,
    paintLoftPreview,
    paintSweepPreview,
    clearExtrudePreview,
    clearRevolvePreview,
    clearLoftPreview,
    clearSweepPreview,
  ]);

  useEffect(() => () => {
    clearWorkplaneOverlay();
    clearPolylineDraft();
    clearContourStatusWire();
    clearContourRefWire();
    clearExtrudePreview();
    clearRevolvePreview();
    clearLoftPreview();
    clearSweepPreview();
    applyContourPartGhost(false);
    clearSavedContourGhosts();
    if (contourToastTimerRef.current) clearTimeout(contourToastTimerRef.current);
  }, [clearWorkplaneOverlay, clearPolylineDraft, clearContourStatusWire, clearContourRefWire, clearExtrudePreview, clearRevolvePreview, clearLoftPreview, clearSweepPreview, applyContourPartGhost, clearSavedContourGhosts]);

  // Contour mode: planar face tap updates the workplane; non-planar is a loud refuse.
  useEffect(() => {
    if (!contourModeRef.current || !selectedFace) return;
    const resolved = resolveContourWorkplane(selectedFace);
    if (!resolved.ok) {
      showContourToast(resolved.message);
      clearHighlight();
      setSelectedFace(null);
      onFaceSelectedRef.current?.(null);
      return;
    }
    setContourMode((prev) => {
      if (!prev) return prev;
      const frame = planeFromContourFace(resolved.face);
      if (isLoftEntry(prev.entry) && prev.loft?.picking === 'face') {
        return setLoftStationPlane(prev, frame, { kind: 'face', label: 'Face' });
      }
      return applyContourPlaneEdit(prev, {
        preset: 'face',
        base: frame,
        angles: { x: 0, y: 0, z: 0 },
      });
    });
    // The plane card keeps the feature-sheet slide. Aim waits for Select plane.
    // onFaceSelected stays a ref. The sketch-strip publish re-renders App and
    // hands this callback a new identity; depending on it restarted the
    // Select-plane tween on every frame, so the camera never settled and the
    // highlight never cleared.
    if (contourPlaneOpenRef.current) return;
    requestFaceSketchAim(resolved.face?.normal || resolved.plane?.normal);
  }, [selectedFace, clearHighlight]);

  // Select plane: look along the sketch-plane normal. A highlighted face
  // is framed; any other plane frames the part in world space. Normal
  // (force) always frames that part, so a placement offset cannot leave
  // the solid off to the side of a local-bounds aim. The highlight drops
  // when the tween ends. The plane card has already dropped its slide snapshot.
  // onFaceSelected is a ref. A fresh callback identity must not re-run this
  // effect: the highlight is already cleared, and the second aim frames the part.
  useEffect(() => {
    if (!faceSketchNonce) return undefined;
    const state = contourModeRef.current;
    const normal = faceSketchNormalRef.current;
    const force = faceSketchForceRef.current;
    faceSketchForceRef.current = false;
    if (!state || !normal) return undefined;
    if (contourPlaneOpenRef.current && !force) return undefined;
    const box = sketchAimBox({
      force,
      highlightMeshes: highlightMeshRef.current,
      partMesh: resultRef.current,
      bounds: modelBoundsRef.current,
    });
    if (!box) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelectedRef.current?.(null);
      setContourFaceAim('done');
      return undefined;
    }
    const started = faceSketchRef.current?.aim({ box, normal });
    if (!started) {
      setContourFaceAim('done');
      return undefined;
    }
    if (faceSketchRef.current?.isAnimating()) setContourFaceAim('run');
    return undefined;
  }, [faceSketchNonce, clearHighlight]);

  // Drawing undo. The plane card is not a step. Select plane seeds the
  // accepted plane as the baseline. Later tool, profile, plane, and
  // loft-station edits push a step. An undo replace does not push.
  useEffect(() => {
    if (applyingSketchUndoRef.current) {
      applyingSketchUndoRef.current = false;
      return;
    }
    if (contourPlaneOpen || !contourMode) {
      sketchHistRef.current = emptySketchHistory();
      setContourUndoDepth(0);
      return;
    }
    const next = observeSketchEdit(sketchHistRef.current, contourMode);
    sketchHistRef.current = next;
    setContourUndoDepth(next.depth);
  }, [contourMode, contourPlaneOpen]);

  const undoContourSketch = useCallback(() => {
    const popped = undoSketchEdit(sketchHistRef.current);
    if (!popped) return;
    applyingSketchUndoRef.current = true;
    sketchHistRef.current = popped.history;
    setContourUndoDepth(popped.history.depth);
    setContourMode(popped.state);
  }, []);

  const reopenContourPlane = useCallback(() => {
    faceSketchRef.current?.cancel();
    setContourFaceAim('');
    overlayVis.begin('planes');
    contourPlaneOpenRef.current = true;
    setContourPlaneOpen(true);
  }, [overlayVis]);

  const startContourDrawing = useCallback(() => {
    const state = contourModeRef.current;
    if (!state) return;
    // Accepting the plane hides the workplane quads. A toggle the user set stays.
    overlayVis.end('planes');
    // A pending slide tick must not snapshot again after the card unmounts.
    holdSheetSlide();
    sheetCameraRef.current?.abandon();
    const seeded = observeSketchEdit(emptySketchHistory(), state);
    sketchHistRef.current = seeded;
    setContourUndoDepth(seeded.depth);
    contourPlaneOpenRef.current = false;
    setContourPlaneOpen(false);
    const normal = contourWorkplaneFace(state, modelBoundsRef.current)?.normal;
    setContourFaceAim('');
    requestFaceSketchAim(normal);
  }, [overlayVis]);

  const onContourBack = useCallback(() => {
    if ((sketchHistRef.current?.depth || 0) > 0) {
      undoContourSketch();
      return;
    }
    reopenContourPlane();
  }, [undoContourSketch, reopenContourPlane]);

  const selectSketchEntity = useCallback((chip) => {
    setContourMode((prev) => (prev ? selectSketchChip(prev, chip) : prev));
  }, []);
  undoContourSketchRef.current = undoContourSketch;
  selectSketchEntityRef.current = selectSketchEntity;

  const selectSheetChip = useCallback((chip) => {
    if (!chip?.sheet || !chip.id) return;
    if (sheetMetalModeRef.current) {
      setSheetRibbonActiveId(chip.id);
      setSheetMetalMode((prev) => (prev ? editSheetChip(prev, chip) : prev));
      return;
    }
    const read = getHelperBufferRef.current;
    const text = (typeof read === 'function' ? read() : '') || currentScript || '';
    const marker = parseFeatureMarkers(text).find((feature) => (
      feature.kind === 'sheetMetal' && (!chip.markerId || feature.id === chip.markerId)
    ));
    if (!marker) return;
    pendingSheetChipRef.current = chip;
    const opened = beginFeatureEditRef.current?.(marker, text) === true;
    if (!opened) pendingSheetChipRef.current = null;
  }, [currentScript]);
  selectSheetChipRef.current = selectSheetChip;

  useEffect(() => {
    const publish = onSheetStripChangeRef.current;
    if (!publish) return;
    if (mode === 'game' || !sheetMetalMode) {
      publish(null);
      return;
    }
    const read = getHelperBufferRef.current;
    const script = (typeof read === 'function' ? read() : '') || currentScript || '';
    const items = sheetRibbonChips(script, {
      stage: sheetMetalMode.stage,
      spec: sheetMetalMode.spec,
    });
    const activeId = items.some((item) => item.id === sheetRibbonActiveId) ? sheetRibbonActiveId : null;
    if (sheetRibbonActiveId && activeId == null) setSheetRibbonActiveId(null);
    publish({ items, activeId });
  }, [mode, sheetMetalMode, sheetRibbonActiveId, currentScript]);

  // An editor undo rewrites the script without going through the sheet card.
  // The open sheet then reads that spec back, so one undo drops every edge
  // of the feature that was just confirmed.
  useEffect(() => {
    const current = sheetMetalModeRef.current;
    if (!current || current.stage !== 'edit') return;
    const spec = readSheetMetalSpec(currentScript || '');
    if (JSON.stringify(spec || null) === JSON.stringify(current.spec || null)) return;
    setSheetMetalMode((prev) => {
      if (!prev || prev.stage !== 'edit') return prev;
      const next = readSheetMetalSpec(currentScript || '');
      if (JSON.stringify(next || null) === JSON.stringify(prev.spec || null)) return prev;
      if (!next) return { ...prev, spec: null, draft: null, hotEdge: null, toast: null };
      return { ...prev, spec: next, draft: null, hotEdge: null, toast: null };
    });
  }, [currentScript]);

  useEffect(() => {
    const publish = onSketchStripChangeRef.current;
    if (!publish) return;
    if (!contourMode || contourPlaneOpen) {
      publish(null);
      return;
    }
    publish({
      entities: contourChips(contourMode),
      activeId: sketchActiveId(contourMode),
      canUndo: (sketchHistRef.current?.depth || 0) > 0,
    });
  }, [contourMode, contourPlaneOpen, contourUndoDepth]);

  const clearPathPreview = useCallback(() => {
    if (!pathPreviewRef.current) return;
    disposeEdgeOverlayObject(sceneRef.current, pathPreviewRef.current);
    pathPreviewRef.current = null;
  }, []);

  /**
   * Slice 22: ordered path preview (gradient + direction arrows), distinct from orange selection halo.
   * @param {{ edges: object[], params?: object }|null} payload
   */
  const setPathPreview = useCallback((payload) => {
    clearPathPreview();
    if (!payload?.edges?.length || !sceneRef.current) return;
    const preview = buildSweepPathPreview(payload.edges, {
      reverse: !!payload.params?.reverse,
    });
    if (!preview?.points?.length) return;

    const group = new Group();
    group.name = 'sweepPathPreview';

    // Gradient polyline (green → magenta) showing order/direction.
    const pts = preview.points;
    const colors = preview.colors || [];
    const positions = new Float32Array(pts.length * 3);
    const colorArr = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      positions[i * 3] = pts[i][0];
      positions[i * 3 + 1] = pts[i][1];
      positions[i * 3 + 2] = pts[i][2];
      const c = colors[i] || [0.66, 0.33, 0.97];
      colorArr[i * 3] = c[0];
      colorArr[i * 3 + 1] = c[1];
      colorArr[i * 3 + 2] = c[2];
    }
    const lineGeom = new BufferGeometry();
    lineGeom.setAttribute('position', new BufferAttribute(positions, 3));
    lineGeom.setAttribute('color', new BufferAttribute(colorArr, 3));
    const lineMat = new LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.98,
    });
    const line = new Line(lineGeom, lineMat);
    line.renderOrder = 13;
    line.frustumCulled = false;
    group.add(line);

    // Direction chevrons (arrows) along the path.
    const arrowMat = new LineBasicMaterial({
      color: 0xe879f9,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    for (const ar of preview.arrows || []) {
      const arrPos = new Float32Array([
        ar.left[0], ar.left[1], ar.left[2],
        ar.tip[0], ar.tip[1], ar.tip[2],
        ar.right[0], ar.right[1], ar.right[2],
        ar.tip[0], ar.tip[1], ar.tip[2],
      ]);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(arrPos, 3));
      const seg = new LineSegments(g, arrowMat);
      seg.renderOrder = 14;
      seg.frustumCulled = false;
      group.add(seg);
    }

    // Start / end markers (numbered cue via size: start larger).
    const startMat = new MeshBasicMaterial({
      color: 0x22c55e,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    const endMat = new MeshBasicMaterial({
      color: 0xa855f7,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    const markers = preview.markers || [];
    if (markers.length) {
      const s = markers[0];
      const startMesh = new ThreeMesh(new SphereGeometry(0.55, 10, 10), startMat);
      startMesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
      startMesh.renderOrder = 15;
      startMesh.frustumCulled = false;
      group.add(startMesh);
    }
    if (markers.length > 1 && !preview.closed) {
      const e = markers[markers.length - 1];
      const endMesh = new ThreeMesh(new SphereGeometry(0.45, 10, 10), endMat);
      endMesh.position.set(e.pos[0], e.pos[1], e.pos[2]);
      endMesh.renderOrder = 15;
      endMesh.frustumCulled = false;
      group.add(endMesh);
    }

    anchorToActivePart(group);
    sceneRef.current.add(group);
    pathPreviewRef.current = group;
  }, [clearPathPreview, anchorToActivePart]);

  // Sweep contour: path order preview (green → magenta) while edges accumulate.
  // Other contour entries clear it. A null contour mode leaves the Path modal preview alone.
  useEffect(() => {
    if (!contourMode || !isSweepEntry(contourMode.entry)) {
      if (contourMode) clearPathPreview();
      return;
    }
    const overlay = resolveActivePartOverlay({
      edges: selectedEdges,
      activeId: activePartIdRef.current,
    });
    if (overlay.foreign) {
      clearPathPreview();
      return;
    }
    setPathPreview({
      edges: selectedEdges,
      params: { reverse: !!contourMode.sweep?.reverse },
    });
  }, [contourMode, selectedEdges, setPathPreview, clearPathPreview]);

  useEffect(() => () => clearPathPreview(), [clearPathPreview]);

  const highlightSelectedEdges = useCallback((edges) => {
    clearEdgeHighlight();
    const activePart = activePartIdRef.current;
    const style = {
      color: 0xff9900,
      opacity: EDGE_SELECT_OPACITY,
      corePx: EDGE_CORE_PX,
      haloPx: EDGE_HALO_PX,
    };
    // Picks on the active part ride its anchor. Fillet / Chamfer picks kept
    // on another part are drawn in that part's frame, at its position, so
    // they never land on whatever part sits at the origin.
    edgeHighlightRef.current = paintEdgeLines(activePartEdges(edges, activePart), {
      ...style,
      name: 'edgeSelection',
    });
    const foreign = [];
    for (const group of foreignPartEdgeGroups(edges, activePart)) {
      const pose = partOffsetFor(group.partId);
      if (!pose) continue;
      const obj = paintEdgeLines(group.edges, {
        ...style,
        name: 'edgeSelectionOtherPart',
        position: pose.t,
        quaternion: pose.q,
      });
      if (obj) {
        obj.userData.edgeSelectionPart = group.partId;
        foreign.push(obj);
      }
    }
    edgeHighlightForeignRef.current = foreign;
  }, [clearEdgeHighlight, paintEdgeLines, partOffsetFor]);

  const highlightHoverEdge = useCallback((edge, selectedKeys) => {
    clearEdgeHover();
    if (!edge) return;
    // Do not pre-highlight an already-selected edge (selection orange wins).
    if (selectedKeys?.has(selectionEdgeKey(edge))) return;
    edgeHoverRef.current = paintEdgeLines([edge], {
      color: 0xffcc66,
      name: 'edgeHover',
      opacity: 0.9,
      corePx: EDGE_HOVER_CORE_PX,
      haloPx: EDGE_HOVER_HALO_PX,
    });
  }, [clearEdgeHover, paintEdgeLines]);

  // Paint edge selection highlight when selectedEdges changes (idempotent: clear then draw).
  useEffect(() => {
    highlightSelectedEdges(selectedEdges);
    // Chips re-bind via refs on render; project once so they appear before the next frame.
    requestAnimationFrame(() => updateEdgeChips());
  }, [selectedEdges, highlightSelectedEdges, updateEdgeChips]);

  /**
   * Pick graph for Edge, Fillet, and Sweep path.
   * Sharp creases only, collapsed to silhouette chains (#46 dihedral gate).
   * Shallow loft-wall seams stay out so tangent-on cannot flood the mesh.
   */
  const syncFeatureEdges = useCallback((geom) => {
    if (featureEdgesSourceRef.current === geom && featureEdgesRef.current) return;
    // Same geometry + faceIDs → same graph. A part switch back onto a solid
    // that is already built (or pre-built in idle time) is a cache hit.
    const graph = featureGraphFor(geom ?? null, faceIDsRef.current);
    boundaryTopoRef.current = graph.topo;
    const sheetTopo = sheetContourEdges(sheetSpecRef.current);
    contourTopoRef.current = sheetTopo || contourBoundariesFor(geom ?? null, faceIDsRef.current);
    featureEdgesRef.current = graph.featureEdges;
    const partId = activePartIdRef.current;
    if (partId && featureEdgesRef.current) {
      for (const edge of featureEdgesRef.current) edge.partId = partId;
    }
    featureEdgesSourceRef.current = geom ?? null;
    const prev = graphTimingRef.current || {};
    graphTimingRef.current = graph.cached
      ? { ...prev, featureMs: 0, topoMs: 0, annotateMs: 0, coherentMs: 0, edgeGraphCached: true }
      : { ...prev, ...(graph.timing || {}), edgeGraphCached: false };
  }, []);

  // Fillet mode: face ids (fN) and boundary-edge ids (eN) for the Accept helpers.
  const filletActive = !!filletMode;
  useEffect(() => {
    clearIdLabels();
    if (!filletActive || !sceneRef.current) return undefined;
    featureEdgesSourceRef.current = null;
    const geom = resultRef.current?.geometry;
    const note = (msg) => {
      setFilletToast(toastPayload(msg));
      if (filletToastTimerRef.current) clearTimeout(filletToastTimerRef.current);
      filletToastTimerRef.current = setTimeout(() => {
        filletToastTimerRef.current = null;
        setFilletToast(null);
      }, 3200);
    };
    try {
      if (geom) syncFeatureEdges(geom);
      setSelectedEdges((prev) => stampBoundaryOnSelection(prev, featureEdgesRef.current));
    } catch (err) {
      note(err?.message || 'Fillet could not read edges on this solid.');
      return undefined;
    }
    const topo = boundaryTopoRef.current;
    if (!topo) {
      if (geom) note('This solid has no face ids — Fillet cannot pick edges.');
      return undefined;
    }
    const targets = filletOverlayTargets(topo);
    if (!targets.edges.length) {
      note('No pickable edges on this solid. Shallow blend tessellation stays out of the pick graph.');
    }
    const dims = modelBounds?.size;
    const span = dims ? Math.max(dims[0], dims[1], dims[2]) : 40;
    const worldH = Math.max(1.6, span * 0.055);
    const group = new Group();
    group.name = 'filletIdLabels';
    try {
      for (const face of targets.faces) {
        if (!face?.center) continue;
        const sprite = makeFilletIdSprite(`f${face.id}`, worldH);
        if (!sprite) continue;
        const n = face.normal || [0, 0, 1];
        sprite.position.set(
          face.center[0] + n[0] * worldH * 0.35,
          face.center[1] + n[1] * worldH * 0.35,
          face.center[2] + n[2] * worldH * 0.35,
        );
        group.add(sprite);
      }
      for (const edge of targets.edges) {
        if (!edge?.mid) continue;
        const sprite = makeFilletIdSprite(`e${edge.id}`, worldH * 0.85);
        if (!sprite) continue;
        sprite.position.set(edge.mid[0], edge.mid[1], edge.mid[2]);
        group.add(sprite);
      }
    } catch (err) {
      clearIdLabels();
      note(err?.message || 'Could not label edges — pick still uses the sharp set.');
      return undefined;
    }
    anchorToActivePart(group);
    sceneRef.current.add(group);
    idLabelGroupRef.current = group;
    return () => clearIdLabels();
  }, [filletActive, cachedMeshData, modelBounds, syncFeatureEdges, clearIdLabels, anchorToActivePart]);

  const rebuildFeatureEdges = useCallback(() => {
    syncFeatureEdges(resultRef.current?.geometry ?? null);
  }, [syncFeatureEdges]);

  const wasFilletActiveRef = useRef(false);
  useEffect(() => {
    const leftFillet = wasFilletActiveRef.current && !filletActive;
    wasFilletActiveRef.current = filletActive;
    if (pickMode !== 'edge') return;
    if (filletActive) return;
    if (contourMode && isSweepEntry(contourMode.entry)) {
      rebuildFeatureEdges();
      return;
    }
    // Leaving Fillet restores prior Face/Edge; when still in Edge, drop sharp-only cache.
    if (leftFillet) {
      featureEdgesSourceRef.current = null;
      rebuildFeatureEdges();
    }
  }, [filletActive, contourMode, pickMode, rebuildFeatureEdges]);

  const pickSweepPath = useCallback(() => {
    setPickMode('edge');
    clearHighlight();
    setSelectedFace(null);
    onFaceSelected?.(null);
    rebuildFeatureEdges();
    setTangentProp(true);
    // Path-pick is visible via Edge mode + rail; skip instructional toast.
  }, [onFaceSelected, rebuildFeatureEdges, clearHighlight]);

  const pickSweepPlane = useCallback(() => {
    setPickMode('face');
    clearEdgeHover();
  }, [clearEdgeHover]);

  const sectionHosts = () => {
    const hosts = [];
    if (resultRef.current) hosts.push(resultRef.current);
    const extras = assemblyExtrasRef.current;
    if (extras) {
      for (const mesh of extras.values()) hosts.push(mesh);
    }
    return hosts;
  };

  // Clear cutting plane widget, including one left on a scene that was rebuilt.
  const clearCuttingPlane = () => {
    const widget = cuttingPlaneWidgetRef.current;
    if (!widget) return;
    disposeCuttingPlaneWidget(widget);
    cuttingPlaneWidgetRef.current = null;
  };

  const crossSectionTargets = useCallback(() => collectCrossSectionTargets({
    assemblyRunLockRef,
    resultRef,
    assemblyExtrasRef,
    solidCache: solidCacheRef.current,
    activePartIdRef,
  }), [assemblyRunLockRef, assemblyExtrasRef]);

  // A previous trim swapped the drawn mesh. Put that geometry back before clipping.
  const healSectionGeometry = () => {
    for (const mesh of sectionHosts()) {
      if (!mesh?.userData?.crossSectionRestore && !mesh?.userData?.crossSectionTrimmedMeshData) continue;
      clearCrossSectionOnMesh(mesh, solidCacheRef.current);
      if (mesh.geometry) applyFaceSkinRef.current?.(mesh);
    }
  };

  // World-space clip on every part material. The preview plane is only
  // there while the options are open. Accept hides it; the clip stays.
  const refreshSectionClip = (plane) => {
    if (!crossSectionEnabledRef.current) return;
    const spec = plane || crossSectionPlaneRef.current;
    if (!spec?.normal) return;
    const renderer = rendererRef.current;
    if (renderer) renderer.localClippingEnabled = true;
    healSectionGeometry();
    beginSectionClip(spec.normal, spec.originOffset);
    syncSectionClipMeshes(sectionHosts());
    const scene = sceneRef.current;
    const dims = modelBoundsRef.current?.size;
    const size = Math.max(80, ...(Array.isArray(dims) && dims.length ? dims : [200, 200, 200]));
    cuttingPlaneWidgetRef.current = syncSectionPreview(scene, cuttingPlaneWidgetRef.current, {
      showPlane: spec.showPlane !== false,
      normal: spec.normal,
      originOffset: spec.originOffset,
      size,
      color: SECTION_PLANE_COLOR,
    });
    const unit = new Vector3(...spec.normal);
    if (unit.lengthSq() < 1e-20) unit.set(0, 0, 1);
    else unit.normalize();
    const originOffset = Number(spec.originOffset) || 0;
    crossSectionAppliedRef.current = {
      normal: [unit.x, unit.y, unit.z],
      originOffset,
      planeKey: crossSectionPlaneKey([unit.x, unit.y, unit.z], originOffset),
      gen: ++crossSectionAppliedGenRef.current,
    };
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  };
  refreshSectionClipRef.current = refreshSectionClip;

  const endSectionView = () => {
    endSectionClip();
    healSectionGeometry();
    clearCuttingPlane();
    crossSectionAppliedRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) renderer.localClippingEnabled = false;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  };
  endSectionViewRef.current = endSectionView;

  // View-only. Enabling does not wait on the worker and does not require a solid.
  const handleCrossSectionToggle = (enabled) => {
    const on = !!enabled;
    crossSectionEnabledRef.current = on;
    if (on) {
      const spec = { ...crossSectionPlaneRef.current, showPlane: true };
      crossSectionPlaneRef.current = spec;
      setCrossSectionEnabled(true);
      refreshSectionClip(spec);
    } else {
      setCrossSectionEnabled(false);
      endSectionView();
    }
  };

  const handlePlaneChange = (plane) => {
    if (!plane) return;
    // Accept hides the preview of the clip already on screen. It does not
    // re-read the panel preset, which can lag the cut the user is looking at.
    const next = nextSectionSpec(crossSectionPlaneRef.current, plane);
    crossSectionPlaneRef.current = next;
    if (!crossSectionEnabledRef.current) return;
    refreshSectionClip(next);
  };

  useEffect(() => {
    if (!crossSectionEnabled) return;
    refreshSectionClipRef.current(crossSectionPlaneRef.current);
  }, [crossSectionEnabled, cachedMeshData, overlayEpoch, sceneReady, modelBounds]);

  // Picked triangles plus their outline. A duplicate-vertex seam is not an outline edge.
  const highlightFace = useCallback((faceIndices, geometry, positions, index, color = 0xffff00, name = 'highlight') => {
    const highlightPositions = [];

    faceIndices.forEach(faceIdx => {
      const i0 = index[faceIdx * 3];
      const i1 = index[faceIdx * 3 + 1];
      const i2 = index[faceIdx * 3 + 2];
      const v1 = new Vector3().fromBufferAttribute(positions, i0);
      const v2 = new Vector3().fromBufferAttribute(positions, i1);
      const v3 = new Vector3().fromBufferAttribute(positions, i2);
      highlightPositions.push(
        v1.x, v1.y, v1.z,
        v2.x, v2.y, v2.z,
        v3.x, v3.y, v3.z
      );
    });

    // Index-shared edges cancel. A seam whose copies do not share an index
    // cancels too, when its midpoint already lies on this face.
    const boundaryEdgePositions = highlightBoundaryPositions(positions, index, faceIndices);
    
    // Create highlight mesh
    const highlightGeometry = new BufferGeometry();
    highlightGeometry.setAttribute('position', new BufferAttribute(new Float32Array(highlightPositions), 3));
    const indices = [];
    for (let i = 0; i < faceIndices.length * 3; i++) {
      indices.push(i);
    }
    highlightGeometry.setIndex(indices);
    
    // The fill sits exactly on the part's triangles but runs a different
    // shader (MeshBasic vs the part's MeshNormal), so equal depth is not
    // guaranteed per pixel — mobile GPUs z-fight it into stripes. Pull it a
    // hair toward the camera and never write depth.
    const highlightMesh = new ThreeMesh(highlightGeometry, new MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, depthTest: true, depthWrite: false, side: 2,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }));
    highlightMesh.name = name;
    highlightMesh.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER;
    anchorToActivePart(highlightMesh);
    
    // Create boundary edge lines only
    if (boundaryEdgePositions.length > 0) {
      const edgeGeometry = new BufferGeometry();
      edgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(boundaryEdgePositions), 3));
      const edgesLine = new LineSegments(edgeGeometry, new LineBasicMaterial({ 
        color, linewidth: 3, depthTest: true
      }));
      edgesLine.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER + 1;
      highlightMesh.add(edgesLine);
    }
    
    sceneRef.current.add(highlightMesh);
    
    if (!highlightMeshRef.current) {
      highlightMeshRef.current = [];
    }
    highlightMeshRef.current.push(highlightMesh);
  }, []);

  const disposeHighlightObject = useCallback((mesh) => {
    if (!mesh) return;
    sceneRef.current?.remove(mesh);
    const drop = (obj) => {
      obj.geometry?.dispose?.();
      const material = obj.material;
      if (Array.isArray(material)) material.forEach((item) => item?.dispose?.());
      else material?.dispose?.();
      const kids = obj.children ? [...obj.children] : [];
      for (const kid of kids) drop(kid);
    };
    drop(mesh);
  }, []);

  const clearJointHighlights = useCallback((partId = null) => {
    const map = jointHighlightRef.current;
    const token = partId == null ? null : String(partId);
    const ids = token == null
      ? [...map.keys()]
      : [...map.keys()].filter((key) => key === token || key.startsWith(`${token}@`));
    for (const id of ids) {
      disposeHighlightObject(map.get(id));
      map.delete(id);
    }
  }, [disposeHighlightObject]);
  clearJointHighlightsRef.current = clearJointHighlights;

  /**
   * Yellow face highlight that stays on the part it was picked on.
   * A later pick on another part must not move or drop it. Add and X clear it.
   */
  const paintJointHighlight = useCallback((partId, faceIndices, positions, index, at = null) => {
    if (!partId || !sceneRef.current || !faceIndices?.length || !positions || !index) return;
    const highlightPositions = [];
    faceIndices.forEach((faceIdx) => {
      const i0 = index[faceIdx * 3];
      const i1 = index[faceIdx * 3 + 1];
      const i2 = index[faceIdx * 3 + 2];
      const v1 = new Vector3().fromBufferAttribute(positions, i0);
      const v2 = new Vector3().fromBufferAttribute(positions, i1);
      const v3 = new Vector3().fromBufferAttribute(positions, i2);
      highlightPositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
    });
    const boundaryEdgePositions = highlightBoundaryPositions(positions, index, faceIndices);
    const highlightGeometry = new BufferGeometry();
    highlightGeometry.setAttribute('position', new BufferAttribute(new Float32Array(highlightPositions), 3));
    const indices = [];
    for (let i = 0; i < faceIndices.length * 3; i++) indices.push(i);
    highlightGeometry.setIndex(indices);
    const highlightMesh = new ThreeMesh(highlightGeometry, new MeshBasicMaterial({
      color: 0xffff00, transparent: true, opacity: 0.3, depthTest: true, depthWrite: false, side: 2,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }));
    highlightMesh.name = 'joint-pick';
    highlightMesh.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER;
    highlightMesh.userData.overlayPartId = String(partId);
    highlightMesh.userData.anchorToActivePart = false;
    if (boundaryEdgePositions.length > 0) {
      const edgeGeometry = new BufferGeometry();
      edgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(boundaryEdgePositions), 3));
      const edgesLine = new LineSegments(edgeGeometry, new LineBasicMaterial({
        color: 0xffff00, linewidth: 3, depthTest: true,
      }));
      edgesLine.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER + 1;
      highlightMesh.add(edgesLine);
    }
    applyPartPose(highlightMesh, overlayAnchorForRef.current(partId));
    const id = jointHighlightSlot(partId, at);
    disposeHighlightObject(jointHighlightRef.current.get(id));
    sceneRef.current.add(highlightMesh);
    jointHighlightRef.current.set(id, highlightMesh);
  }, [disposeHighlightObject]);
  paintJointHighlightRef.current = paintJointHighlight;

  useEffect(() => {
    if (jointPicking) return undefined;
    clearJointHighlights();
    return undefined;
  }, [jointPicking, clearJointHighlights]);

  const showCadBodyHighlight = useCallback(() => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    if (!geom || !positions || !index?.length) return false;
    const count = Math.floor(index.length / 3);
    const indices = [];
    for (let i = 0; i < count; i++) indices.push(i);
    cadBodyStickyRef.current = true;
    clearHighlight();
    highlightFace(indices, geom, positions, index, 0x22d3ee, 'cad-body');
    return true;
  }, [clearHighlight, highlightFace]);
  showCadBodyHighlightRef.current = showCadBodyHighlight;

  // Below highlightFace on purpose. These dep arrays run during render; listing
  // highlightFace above its const throws and the viewport never mounts.
  const paintDraftPicks = useCallback((state) => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    clearHighlight();
    if (!state) return;
    if (geom && positions && index && state.neutral?.indices?.length) {
      highlightFace(state.neutral.indices, geom, positions, index, 0x22d3ee, 'draft-neutral');
    }
    const drafted = (state.drafts || []).flatMap((f) => f.indices || []);
    if (geom && positions && index && drafted.length) {
      highlightFace(drafted, geom, positions, index, 0xfbbf24, 'draft-faces');
    }
  }, [clearHighlight, highlightFace]);

  const exitDraftMode = useCallback(() => {
    cancelFeatureEditRef.current?.('draft');
    const was = draftModeRef.current;
    setDraftMode(null);
    draftModeRef.current = null;
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight]);

  const enterDraftMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const picks = facePickGroupRef.current?.picks || [];
    let seed = null;
    if (picks.length === 1) seed = picks[0];
    else if (selectedFace && Array.isArray(selectedFace.center) && Array.isArray(selectedFace.normal)) {
      seed = {
        center: selectedFace.center,
        normal: selectedFace.normal,
        indices: undefined,
      };
    }
    const next = emptyDraftState(seed);
    setDraftMode(next);
    draftModeRef.current = next;
    paintDraftPicks(next);
  }, [exitContourMode, selectedFace, clearFilletBlendPreview, clearEdgeHover, clearEdgeHighlight, clearHighlight, paintDraftPicks]);

  const commitDraftState = useCallback((next) => {
    draftModeRef.current = next;
    setDraftMode(next);
    paintDraftPicks(next);
  }, [paintDraftPicks]);

  const acceptDraft = useCallback(() => {
    const state = draftModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'draft') {
      const angle = Number(state.angle);
      if (!(angle > 0)) {
        showShellToast('Draft angle must be greater than 0.');
        return;
      }
      const ok = commitFeatureEditRef.current?.({
        fields: { ...(featureEditRef.current.session?.fields || {}), angle, flip: !!state.flip },
      });
      if (ok) {
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
        exitDraftMode();
      }
      return;
    }
    const gate = validateDraftAccept(state);
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitDraft?.({ state, partId: activePartIdRef.current });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitDraftMode();
    }
  }, [onCommitDraft, exitDraftMode, onFaceSelected, clearHighlight]);

  const clearCutPlaneWidget = useCallback(() => {
    const widget = cutPlaneWidgetRef.current;
    if (!widget || !sceneRef.current) return;
    sceneRef.current.remove(widget);
    widget.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    cutPlaneWidgetRef.current = null;
  }, []);

  useEffect(() => {
    if (!cutMode) clearCutPlaneWidget();
  }, [cutMode, clearCutPlaneWidget]);

  const syncCutPlaneWidget = useCallback((state) => {
    const plane = cutPlaneFromState(state);
    if (!plane || !sceneRef.current) {
      clearCutPlaneWidget();
      return;
    }
    const size = Math.max(40, ...(modelBoundsRef.current?.size || [40]));
    if (cutPlaneWidgetRef.current) {
      updateCuttingPlaneWidget(cutPlaneWidgetRef.current, {
        normal: plane.normal,
        originOffset: plane.originOffset,
      });
      return;
    }
    const widget = createCuttingPlaneWidget({
      normal: plane.normal,
      originOffset: plane.originOffset,
      size: size * 1.4,
      color: SECTION_PLANE_COLOR,
      opacity: 0.22,
    });
    sceneRef.current.add(widget);
    cutPlaneWidgetRef.current = widget;
  }, [clearCutPlaneWidget]);

  const removeCutPreviewGroup = useCallback(() => {
    const group = cutPiecesPreviewRef.current;
    if (!group) return;
    sceneRef.current?.remove(group);
    group.traverse((obj) => {
      if (obj === group) return;
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    cutPiecesPreviewRef.current = null;
  }, []);

  const restoreCutBaseMesh = useCallback(() => {
    const mesh = resultRef.current;
    if (mesh && cutBaseMaterialRef.current) {
      mesh.material = cutBaseMaterialRef.current;
      cutBaseMaterialRef.current = null;
      setFaceColorSkinVisible(mesh, true);
    }
  }, []);

  const clearCutPiecePreview = useCallback(() => {
    cutPreviewGenRef.current += 1;
    cutLiveKeyRef.current = '';
    cutLivePiecesRef.current = null;
    if (cutPreviewTimerRef.current) {
      clearTimeout(cutPreviewTimerRef.current);
      cutPreviewTimerRef.current = null;
    }
    removeCutPreviewGroup();
    restoreCutBaseMesh();
  }, [removeCutPreviewGroup, restoreCutBaseMesh]);
  clearCutPiecePreviewRef.current = clearCutPiecePreview;

  // Leaving Pieces, Dismiss, or another mode that drops cut mode: the clone
  // never touched the script, and the viewport goes back to the whole model.
  useEffect(() => {
    if (cutMode?.pick === 'pieces') return;
    clearCutPiecePreview();
  }, [cutMode, clearCutPiecePreview]);

  const hideCutBaseMesh = useCallback(() => {
    const mesh = resultRef.current;
    if (!mesh) return;
    if (!cutBaseHiddenMatRef.current) {
      cutBaseHiddenMatRef.current = new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
    }
    if (!cutBaseMaterialRef.current) cutBaseMaterialRef.current = mesh.material;
    mesh.material = cutBaseHiddenMatRef.current;
    setFaceColorSkinVisible(mesh, false);
  }, []);

  const paintLiveCutPieces = useCallback((state, pieces) => {
    const scene = sceneRef.current;
    if (!scene) return;
    removeCutPreviewGroup();
    hideCutBaseMesh();
    const group = new Group();
    group.name = 'cutPiecesPreview';
    const addMesh = (geom, material) => {
      const pieceMesh = new ThreeMesh(geom, material);
      pieceMesh.raycast = () => {};
      group.add(pieceMesh);
      return pieceMesh;
    };
    let colorI = 0;
    for (const piece of pieces || []) {
      const geom = geometryFromPreviewMesh(piece.mesh);
      if (!geom) continue;
      if (!piece.selected) {
        addMesh(geom, makeDefaultPartMaterial());
        continue;
      }
      const color = CUT_PIECE_COLORS[colorI % CUT_PIECE_COLORS.length];
      colorI += 1;
      const hidden = cutPreviewPieceHidden(state, piece);
      if (hidden) {
        geom.dispose();
        continue;
      }
      // Opaque depth, then a front-face tint. The tint blends with the
      // background; the other piece is already in the depth buffer.
      const depthGeom = geom.clone();
      addMesh(depthGeom, new MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        side: FrontSide,
      }));
      addMesh(geom, new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: CUT_PIECE_OPACITY,
        depthWrite: false,
        depthTest: true,
        side: FrontSide,
      }));
    }
    // Pieces are in the part's frame; the pick mesh carries its pose.
    anchorToActivePart(group);
    scene.add(group);
    cutPiecesPreviewRef.current = group;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, hideCutBaseMesh, removeCutPreviewGroup]);

  const ensureLiveCutPreview = useCallback((state) => {
    const key = cutPreviewKey(state);
    if (!key) {
      clearCutPiecePreview();
      return;
    }
    if (cutLiveKeyRef.current === key && cutLivePiecesRef.current) {
      paintLiveCutPieces(state, cutLivePiecesRef.current);
      return;
    }
    const gen = ++cutPreviewGenRef.current;
    cutLiveKeyRef.current = '';
    cutLivePiecesRef.current = null;
    removeCutPreviewGroup();
    restoreCutBaseMesh();
    if (cutPreviewTimerRef.current) clearTimeout(cutPreviewTimerRef.current);
    const plane = cutPreviewPlanePayload(state);
    const bodies = (state.bodies || []).map((b) => ({ at: b.at }));
    cutPreviewTimerRef.current = setTimeout(() => {
      cutPreviewTimerRef.current = null;
      if (gen !== cutPreviewGenRef.current) return;
      manifoldContext.previewCut({ plane, bodies }).then((payload) => {
        if (gen !== cutPreviewGenRef.current) return;
        const live = cutModeRef.current;
        if (!live || live.pick !== 'pieces' || cutPreviewKey(live) !== key) return;
        cutLiveKeyRef.current = key;
        cutLivePiecesRef.current = payload?.pieces || [];
        paintLiveCutPieces(live, cutLivePiecesRef.current);
      }).catch((err) => {
        if (gen !== cutPreviewGenRef.current) return;
        clearCutPiecePreview();
        showShellToast(err?.message || 'Cut preview failed');
      });
    }, 60);
  }, [clearCutPiecePreview, paintLiveCutPieces, removeCutPreviewGroup, restoreCutBaseMesh]);

  const paintCutPicks = useCallback((state) => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    clearHighlight();
    if (!state || !geom || !positions || !index) {
      clearCutPiecePreview();
      return;
    }
    const plane = cutPlaneFromState(state);
    if (state.pick === 'pieces' && plane && (state.bodies || []).length) {
      ensureLiveCutPreview(state);
      return;
    }
    clearCutPiecePreview();
    const keepTris = [];
    const dropTris = [];
    for (const body of state.bodies || []) {
      const info = classifyCutBody(body, plane, positions, index);
      for (const tri of body.triangles || []) {
        const side = trianglePieceSide(tri, body, info, plane, positions, index);
        const dropped = (state.drop || []).some((d) => d.key === cutBodyKey(body) && d.side === side);
        (dropped ? dropTris : keepTris).push(tri);
      }
    }
    if (keepTris.length) highlightFace(keepTris, geom, positions, index, 0x22d3ee, 'cut-bodies');
    if (dropTris.length) highlightFace(dropTris, geom, positions, index, 0xf97316, 'cut-drop');
  }, [clearHighlight, highlightFace, clearCutPiecePreview, ensureLiveCutPreview]);

  const exitCutMode = useCallback(() => {
    cancelFeatureEditRef.current?.('cut');
    const was = cutModeRef.current;
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    clearCutPlaneWidget();
    clearCutPiecePreview();
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearCutPlaneWidget, clearCutPiecePreview]);

  const commitCutState = useCallback((next) => {
    cutModeRef.current = next;
    setCutMode(next);
    paintCutPicks(next);
    syncCutPlaneWidget(next);
  }, [paintCutPicks, syncCutPlaneWidget]);

  const enterCutMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (booleanModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const next = emptyCutState();
    const face = selectedFace && Array.isArray(selectedFace.center) && Array.isArray(selectedFace.normal)
      ? selectedFace
      : null;
    const classified = face ? (face.type ? face : classifySelectedFace(face)) : null;
    if (classified && classified.type === 'planar') {
      next.planeFace = {
        center: classified.center.map(Number),
        normal: classified.normal.map(Number),
      };
      next.pick = 'bodies';
    }
    commitCutState(next);
  }, [
    exitContourMode,
    selectedFace,
    clearFilletBlendPreview,
    clearEdgeHover,
    clearEdgeHighlight,
    commitCutState,
  ]);

  const acceptCut = useCallback(() => {
    const state = cutModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'cut') {
      const ok = commitFeatureEditRef.current?.({
        fields: {
          ...(featureEditRef.current.session?.fields || {}),
          originOffset: Number(state.originOffset) || 0,
        },
      });
      if (ok) exitCutMode();
      return;
    }
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    const bodyCount = meshBodyComponents(positions, index).length;
    const gate = validateCutAccept(state, { positions, index, bodyCount });
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitCut?.({ state, mesh: { positions, index, bodyCount }, partId: activePartIdRef.current });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitCutMode();
    }
  }, [onCommitCut, exitCutMode, onFaceSelected, clearHighlight]);

  const clearBooleanRemotePicks = useCallback(() => {
    const group = booleanRemotePicksRef.current;
    if (!group) return;
    group.parent?.remove(group);
    group.traverse((obj) => {
      if (obj === group) return;
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    booleanRemotePicksRef.current = null;
  }, []);

  /**
   * A Boolean pick on a part that is not the pick mesh right now. Drawn from
   * the triangles stored with that pick, at that part's assembly position.
   * A hidden part has no mesh here, so its picks are kept but not drawn.
   */
  const paintBooleanRemotePicks = useCallback((state) => {
    clearBooleanRemotePicks();
    const scene = sceneRef.current;
    if (!scene || !state) return;
    const active = String(activePartIdRef.current ?? '__active__');
    const group = new Group();
    group.name = 'booleanRemotePicks';
    for (const pick of booleanPicksInOrder(state)) {
      if (String(pick.partId) === active) continue;
      const soup = pick.body?.soup;
      const host = assemblyExtrasRef.current.get(pick.partId);
      if (!soup || !soup.length || !host) continue;
      const geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(new Float32Array(soup), 3));
      const mesh = new ThreeMesh(geom, new MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: FrontSide,
      }));
      // The soup is in that part's frame; its assembly mesh carries the pose.
      applyPartPose(mesh, {
        t: [host.position.x, host.position.y, host.position.z],
        q: host.quaternion
          ? [host.quaternion.x, host.quaternion.y, host.quaternion.z, host.quaternion.w]
          : [0, 0, 0, 1],
      });
      mesh.raycast = () => {};
      mesh.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER;
      mesh.userData.booleanRemotePart = pick.partId;
      // syncAnchoredOverlays re-poses it from that part, not the active one.
      mesh.userData.overlayPartId = pick.partId;
      group.add(mesh);
    }
    if (!group.children.length) return;
    scene.add(group);
    booleanRemotePicksRef.current = group;
  }, [clearBooleanRemotePicks]);

  const removeBooleanPreviewGroup = useCallback(() => {
    const group = booleanPiecesPreviewRef.current;
    if (!group) return;
    sceneRef.current?.remove(group);
    group.traverse((obj) => {
      if (obj === group) return;
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    booleanPiecesPreviewRef.current = null;
  }, []);

  const restoreBooleanBaseMesh = useCallback(() => {
    const mesh = resultRef.current;
    if (mesh && booleanBaseMaterialRef.current) {
      mesh.material = booleanBaseMaterialRef.current;
      booleanBaseMaterialRef.current = null;
      setFaceColorSkinVisible(mesh, true);
    }
  }, []);

  const clearBooleanPiecePreview = useCallback(() => {
    booleanPreviewGenRef.current += 1;
    removeBooleanPreviewGroup();
    restoreBooleanBaseMesh();
    if (booleanPieceCountRef.current !== 0) {
      booleanPieceCountRef.current = 0;
      setBooleanPieceCount(0);
    }
  }, [removeBooleanPreviewGroup, restoreBooleanBaseMesh]);

  // clearAttempt and the other modes null the state without exitBooleanMode.
  // Drop the piece clone when the chip is gone.
  useEffect(() => {
    if (booleanMode) return;
    clearBooleanPiecePreview();
    clearBooleanRemotePicks();
  }, [booleanMode, clearBooleanPiecePreview, clearBooleanRemotePicks]);

  const hideBooleanBaseMesh = useCallback(() => {
    const mesh = resultRef.current;
    if (!mesh) return;
    if (!booleanBaseHiddenMatRef.current) {
      booleanBaseHiddenMatRef.current = new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
    }
    if (!booleanBaseMaterialRef.current) booleanBaseMaterialRef.current = mesh.material;
    mesh.material = booleanBaseHiddenMatRef.current;
    setFaceColorSkinVisible(mesh, false);
  }, []);

  const paintBooleanPieces = useCallback((state, pieces) => {
    const scene = sceneRef.current;
    if (!scene) return;
    removeBooleanPreviewGroup();
    hideBooleanBaseMesh();
    const group = new Group();
    group.name = 'booleanPiecesPreview';
    const partId = activePartIdRef.current;
    let colorI = 0;
    const shown = (pieces || []).filter((piece) => piece.selected);
    for (const piece of shown) {
      const geom = geometryFromPreviewMesh(piece.mesh);
      if (!geom) continue;
      const color = BOOLEAN_PIECE_COLORS[colorI % BOOLEAN_PIECE_COLORS.length];
      colorI += 1;
      const hidden = booleanPieceHidden(state, partId, piece.at);
      const mesh = new ThreeMesh(geom, new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: hidden ? 0 : 0.78,
        depthWrite: !hidden,
        depthTest: true,
        side: FrontSide,
      }));
      mesh.userData.booleanPieceAt = piece.at;
      mesh.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER;
      mesh.raycast = ThreeMesh.prototype.raycast;
      group.add(mesh);
    }
    // Pieces are in the target part's frame; the pick mesh carries its pose
    // (translation and rotation).
    anchorToActivePart(group);
    scene.add(group);
    booleanPiecesPreviewRef.current = group;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, hideBooleanBaseMesh, removeBooleanPreviewGroup]);

  const ensureBooleanPreview = useCallback((state) => {
    const partId = activePartIdRef.current;
    const ctx = getBooleanContextRef.current?.() || {};
    const req = booleanPreviewRequest(state, partId, ctx);
    if (booleanOp(state?.op) !== 'intersect' || state?.pick !== 'pieces' || !req.ok) {
      clearBooleanPiecePreview();
      if (state?.pick === 'pieces' && req && !req.ok && req.message) showShellToast(req.message);
      return;
    }
    // Pieces live on the target. Put its mesh under the cursor first so the
    // piece taps and the drop list are that part's.
    if (req.targetPartId && partId != null
      && String(req.targetPartId) !== String(partId)
      && req.targetPartId !== '__active__') {
      onPickRetargetRef.current?.({ partId: String(req.targetPartId), kind: 'face', syncScript: false });
      // The swap repaints Boolean picks on the new mesh, which lands back
      // here with the target active. Nothing more to do on this pass.
      if (String(activePartIdRef.current) !== String(req.targetPartId)) clearBooleanPiecePreview();
      return;
    }
    if (!resultRef.current?.geometry?.attributes?.position?.count) {
      clearBooleanPiecePreview();
      return;
    }
    const gen = ++booleanPreviewGenRef.current;
    const bodies = req.bodies;
    manifoldContext.previewBoolean({
      op: 'intersect',
      bodies,
      tools: req.tools,
      targetScript: req.targetScript,
    }).then((payload) => {
      if (gen !== booleanPreviewGenRef.current) return;
      const live = booleanModeRef.current;
      if (!live || live.pick !== 'pieces' || booleanOp(live.op) !== 'intersect') return;
      const pieces = payload?.pieces || [];
      const n = pieces.filter((p) => p.selected).length;
      booleanPieceCountRef.current = n;
      setBooleanPieceCount(n);
      paintBooleanPieces(live, pieces);
    }).catch((err) => {
      if (gen !== booleanPreviewGenRef.current) return;
      clearBooleanPiecePreview();
      showShellToast(err?.message || 'Boolean preview failed');
    });
  }, [clearBooleanPiecePreview, paintBooleanPieces]);

  const paintBooleanPicks = useCallback((state) => {
    let geom = resultRef.current?.geometry;
    let positions = geom?.attributes?.position;
    let index = geom?.index?.array;
    let owned = null;
    // A leftover trim replaces the drawn mesh. Highlights use the unsectioned
    // body the script will boolean. A view-only clip leaves the real solid
    // on screen, so the pick uses that geometry.
    if (resultRef.current?.userData?.crossSectionTrimmedMeshData && cachedMeshDataRef.current?.vertProperties) {
      owned = geometryFromMeshData(cachedMeshDataRef.current);
      geom = owned;
      positions = owned.attributes?.position;
      index = owned.index?.array;
    }
    clearHighlight();
    if (!state) {
      owned?.dispose?.();
      clearBooleanPiecePreview();
      clearBooleanRemotePicks();
      return;
    }
    if (state.pick === 'pieces' && booleanOp(state.op) === 'intersect') {
      owned?.dispose?.();
      clearBooleanRemotePicks();
      ensureBooleanPreview(state);
      return;
    }
    clearBooleanPiecePreview();
    paintBooleanRemotePicks(state);
    const slot = booleanSlot(state, activePartIdRef.current);
    const tris = slot.bodies.flatMap((b) => b.triangles || []);
    if (geom && positions && index && tris.length) {
      highlightFace(tris, geom, positions, index, 0x22d3ee, 'boolean-bodies');
    }
    owned?.dispose?.();
  }, [clearHighlight, highlightFace, clearBooleanPiecePreview, ensureBooleanPreview, crossSectionEnabled,
    paintBooleanRemotePicks, clearBooleanRemotePicks]);
  paintBooleanPicksRef.current = paintBooleanPicks;

  const exitBooleanMode = useCallback(() => {
    cancelFeatureEditRef.current?.('boolean');
    const was = booleanModeRef.current;
    setBooleanMode(null);
    booleanModeRef.current = null;
    clearBooleanPiecePreview();
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearBooleanPiecePreview]);

  const commitBooleanState = useCallback((next) => {
    booleanModeRef.current = next;
    setBooleanMode(next);
    paintBooleanPicks(next);
  }, [paintBooleanPicks]);

  const enterBooleanMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current) {
      clearHighlight();
      clearCutPlaneWidget();
      clearCutPiecePreview();
    }
    setCutMode(null);
    cutModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const next = emptyBooleanState();
    commitBooleanState(next);
  }, [
    exitContourMode,
    clearFilletBlendPreview,
    clearCutPlaneWidget,
    clearCutPiecePreview,
    clearEdgeHover,
    clearEdgeHighlight,
    commitBooleanState,
  ]);

  const acceptBoolean = useCallback(() => {
    const state = booleanModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'boolean') {
      const ok = commitFeatureEditRef.current?.({
        fields: { ...(featureEditRef.current.session?.fields || {}), op: state.op || 'union' },
      });
      if (ok) exitBooleanMode();
      return;
    }
    const partId = activePartIdRef.current;
    const gate = validateBooleanAccept(state, partId, { pieceCount: booleanPieceCountRef.current });
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitBoolean?.({
      state,
      partId,
      mesh: { pieceCount: booleanPieceCountRef.current },
    });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitBooleanMode();
    }
  }, [onCommitBoolean, exitBooleanMode, onFaceSelected, clearHighlight]);

  const clearMovePreview = useCallback(() => {
    const mesh = movePreviewRef.current;
    movePreviewRef.current = null;
    if (!mesh) return;
    if (sceneRef.current) sceneRef.current.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }, []);

  const paintMovePreview = useCallback((state) => {
    clearMovePreview();
    const tris = state?.target?.triangles;
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    const scene = sceneRef.current;
    if (!tris?.length || !positions || !index || !scene) return;
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const offset = movePreviewOffset(state, buf);
    if (!offset) return;
    const [dx, dy, dz] = offset;
    if (dx === 0 && dy === 0 && dz === 0) return;
    const pos = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = index[t * 3 + k];
        pos.push(positions.getX(v) + dx, positions.getY(v) + dy, positions.getZ(v) + dz);
      }
    }
    if (pos.length < 9) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.computeVertexNormals();
    const mesh = new ThreeMesh(geometry, new MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
      side: FrontSide,
    }));
    mesh.name = 'move-preview';
    mesh.raycast = () => {};
    // The ghost is local vertices plus a local delta; the part's pose puts it
    // on the part, not on whichever part sits at the origin.
    anchorToActivePart(mesh);
    scene.add(mesh);
    movePreviewRef.current = mesh;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, clearMovePreview, getHelperBuffer]);

  const syncMoveTargetFromMesh = useCallback((state) => {
    if (!state?.target?.at) return state;
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    if (!positions || !index) return state;
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const bodies = meshBodyComponents(positions, index);
    const seeded = seedMoveDeltasFromLastMove(state, buf, state.target.at);
    return {
      ...seeded,
      target: attachMoveTargetMesh(seeded.target, bodies, bodyCentroidsRef.current, buf),
    };
  }, [getHelperBuffer]);

  const exitMoveMode = useCallback(() => {
    cancelFeatureEditRef.current?.('move');
    const was = moveModeRef.current;
    clearMovePreview();
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearMovePreview]);

  const enterMoveMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current) {
      clearHighlight();
      clearCutPlaneWidget();
      clearCutPiecePreview();
    }
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    if (rotateModeRef.current) clearHighlight();
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    if (moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const next = emptyMoveState();
    moveModeRef.current = next;
    setMoveMode(next);
    clearHighlight();
  }, [
    exitContourMode,
    clearFilletBlendPreview,
    clearCutPlaneWidget,
    clearCutPiecePreview,
    clearEdgeHover,
    clearEdgeHighlight,
    clearHighlight,
  ]);

  const acceptMove = useCallback(() => {
    const state = moveModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'move') {
      const ok = commitFeatureEditRef.current?.({
        fields: {
          ...(featureEditRef.current.session?.fields || {}),
          dx: Number(state.dx) || 0,
          dy: Number(state.dy) || 0,
          dz: Number(state.dz) || 0,
        },
      });
      if (ok) exitMoveMode();
      return;
    }
    const gate = validateMoveAccept(state);
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitMove?.({ state, partId: activePartIdRef.current });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitMoveMode();
    }
  }, [onCommitMove, exitMoveMode, onFaceSelected, clearHighlight]);

  const clearRotatePreview = useCallback(() => {
    const mesh = rotatePreviewRef.current;
    rotatePreviewRef.current = null;
    if (!mesh) return;
    if (sceneRef.current) sceneRef.current.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }, []);
  clearRotatePreviewRef.current = clearRotatePreview;

  /**
   * Ghost of the picked body at the card's axis, angle, and center. Local
   * vertices turned by rotatePreviewMap, then posed with the part like the
   * Move ghost, so it draws on the part and not on whichever part sits at
   * the origin.
   */
  const paintRotatePreview = useCallback((state) => {
    clearRotatePreview();
    const tris = state?.target?.triangles;
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    const scene = sceneRef.current;
    if (!tris?.length || !positions || !index || !scene) return;
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const map = rotatePreviewMap(state, buf);
    if (!map) return;
    const pos = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = index[t * 3 + k];
        const p = map([positions.getX(v), positions.getY(v), positions.getZ(v)]);
        pos.push(p[0], p[1], p[2]);
      }
    }
    if (pos.length < 9) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.computeVertexNormals();
    const mesh = new ThreeMesh(geometry, new MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
      side: FrontSide,
    }));
    mesh.name = 'rotate-preview';
    mesh.raycast = () => {};
    anchorToActivePart(mesh);
    scene.add(mesh);
    rotatePreviewRef.current = mesh;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, clearRotatePreview, getHelperBuffer]);

  const syncRotateTargetFromMesh = useCallback((state) => {
    if (!state?.target?.at) return state;
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    if (!positions || !index) return state;
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const bodies = meshBodyComponents(positions, index);
    const seeded = seedRotateFromLastRotate(state, buf, state.target.at);
    return {
      ...seeded,
      target: attachRotateTargetMesh(seeded.target, bodies, bodyCentroidsRef.current, buf),
    };
  }, [getHelperBuffer]);

  const updateRotateMode = useCallback((patch) => {
    const prev = rotateModeRef.current;
    if (!prev) return;
    const updated = { ...prev, ...patch };
    rotateModeRef.current = updated;
    setRotateMode(updated);
    paintRotatePreview(updated);
  }, [paintRotatePreview]);

  const exitRotateMode = useCallback(() => {
    cancelFeatureEditRef.current?.('rotate');
    const was = rotateModeRef.current;
    clearRotatePreview();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearRotatePreview]);

  const enterRotateMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current) {
      clearHighlight();
      clearCutPlaneWidget();
      clearCutPiecePreview();
    }
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    if (moveModeRef.current) {
      clearHighlight();
      clearMovePreview();
    }
    setMoveMode(null);
    moveModeRef.current = null;
    dropMirrorModeRef.current();
    if (moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const next = emptyRotateState();
    rotateModeRef.current = next;
    setRotateMode(next);
    clearHighlight();
  }, [
    exitContourMode,
    clearFilletBlendPreview,
    clearCutPlaneWidget,
    clearCutPiecePreview,
    clearMovePreview,
    clearEdgeHover,
    clearEdgeHighlight,
    clearHighlight,
  ]);

  const acceptRotate = useCallback(() => {
    const state = rotateModeRef.current;
    if (!state) return;
    const gate = validateRotateAccept(state);
    if (featureEditRef.current?.kind === 'rotate') {
      if (!gate.ok) {
        showShellToast(gate.message);
        return;
      }
      const ok = commitFeatureEditRef.current?.({
        fields: {
          ...(featureEditRef.current.session?.fields || {}),
          angle: gate.angle,
          axis: gate.axis,
          center: gate.center,
        },
      });
      if (ok) exitRotateMode();
      return;
    }
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitRotate?.({ state, partId: activePartIdRef.current });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitRotateMode();
    }
  }, [onCommitRotate, exitRotateMode, onFaceSelected, clearHighlight]);

  const clearMirrorPreview = useCallback(() => {
    const mesh = mirrorPreviewRef.current;
    mirrorPreviewRef.current = null;
    if (!mesh) return;
    if (sceneRef.current) sceneRef.current.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }, []);
  clearMirrorPreviewRef.current = clearMirrorPreview;
  dropMirrorModeRef.current = () => {
    clearMirrorPreviewRef.current();
    releaseMirrorPlanesRef.current();
    releaseMirrorPlanesRef.current = () => {};
    setMirrorMode(null);
    mirrorModeRef.current = null;
    setSelectedPlaneId(null);
  };

  /**
   * Ghost of the picked body reflected across the card's plane. Local
   * vertices mapped by mirrorPreviewMap, then posed with the part like the
   * Move ghost.
   */
  const paintMirrorPreview = useCallback((state) => {
    clearMirrorPreview();
    const tris = state?.target?.triangles;
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    const scene = sceneRef.current;
    if (!tris?.length || !positions || !index || !scene) return;
    const map = mirrorPreviewMap(state);
    if (!map) return;
    const pos = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = index[t * 3 + k];
        const p = map([positions.getX(v), positions.getY(v), positions.getZ(v)]);
        pos.push(p[0], p[1], p[2]);
      }
    }
    if (pos.length < 9) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.computeVertexNormals();
    const mesh = new ThreeMesh(geometry, new MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
      side: FrontSide,
    }));
    mesh.name = 'mirror-preview';
    mesh.raycast = () => {};
    anchorToActivePart(mesh);
    scene.add(mesh);
    mirrorPreviewRef.current = mesh;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, clearMirrorPreview]);

  const syncMirrorTargetFromMesh = useCallback((state) => {
    if (!state?.target?.at) return state;
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    if (!positions || !index) return state;
    const bodies = meshBodyComponents(positions, index);
    return {
      ...state,
      target: attachMirrorTargetMesh(state.target, bodies, bodyCentroidsRef.current),
    };
  }, []);

  const commitMirrorState = useCallback((next) => {
    if (!next) return;
    mirrorModeRef.current = next;
    setMirrorMode(next);
    setSelectedPlaneId(mirrorSelectedPlaneId(next));
    paintMirrorPreview(next);
  }, [paintMirrorPreview]);

  const exitMirrorMode = useCallback(() => {
    cancelFeatureEditRef.current?.('mirror');
    const was = mirrorModeRef.current;
    dropMirrorModeRef.current();
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight]);

  const enterMirrorMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current) {
      clearHighlight();
      clearCutPlaneWidget();
      clearCutPiecePreview();
    }
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    if (moveModeRef.current) {
      clearHighlight();
      clearMovePreview();
    }
    setMoveMode(null);
    moveModeRef.current = null;
    if (rotateModeRef.current) clearHighlight();
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    if (moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    clearMoveFacePreviewRef.current();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    dropMirrorModeRef.current();
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const next = emptyMirrorState();
    mirrorModeRef.current = next;
    setMirrorMode(next);
    overlayVis.begin('planes');
    releaseMirrorPlanesRef.current = () => overlayVis.end('planes');
    clearHighlight();
  }, [
    exitContourMode,
    clearFilletBlendPreview,
    clearCutPlaneWidget,
    clearCutPiecePreview,
    clearMovePreview,
    clearEdgeHover,
    clearEdgeHighlight,
    clearHighlight,
    overlayVis,
  ]);

  const acceptMirror = useCallback(() => {
    const state = mirrorModeRef.current;
    if (!state) return;
    const gate = validateMirrorAccept(state);
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const editing = featureEditRef.current && (featureEditRef.current.kind === 'mirror' || featureEditRef.current.dialog === 'mirror');
    const ok = onCommitMirror?.({ state, partId: activePartIdRef.current });
    if (!ok) return;
    if (editing) {
      featureEditRef.current = null;
      setHelperEdit(null);
      setFeatureEditBanner('');
    }
    clearHighlight();
    setSelectedFace(null);
    onFaceSelected?.(null);
    exitMirrorMode();
  }, [onCommitMirror, exitMirrorMode, onFaceSelected, clearHighlight]);

  const removeMoveFacePreview = useCallback(() => {
    if (moveFacePreviewTimerRef.current) {
      clearTimeout(moveFacePreviewTimerRef.current);
      moveFacePreviewTimerRef.current = null;
    }
    const preview = moveFacePreviewRef.current;
    moveFacePreviewRef.current = null;
    if (preview) {
      sceneRef.current?.remove(preview);
      preview.geometry?.dispose?.();
      preview.material?.dispose?.();
    }
    const mesh = resultRef.current;
    if (mesh && moveFaceBaseMaterialRef.current) {
      mesh.material = moveFaceBaseMaterialRef.current;
      moveFaceBaseMaterialRef.current = null;
      setFaceColorSkinVisible(mesh, true);
    }
  }, []);

  const clearMoveFacePreview = useCallback(() => {
    moveFacePreviewGenRef.current += 1;
    moveFaceLiveKeyRef.current = '';
    removeMoveFacePreview();
  }, [removeMoveFacePreview]);
  clearMoveFacePreviewRef.current = clearMoveFacePreview;

  const hideMoveFaceBase = useCallback(() => {
    const mesh = resultRef.current;
    if (!mesh) return;
    if (!moveFaceHiddenMatRef.current) {
      moveFaceHiddenMatRef.current = new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
    }
    if (!moveFaceBaseMaterialRef.current) moveFaceBaseMaterialRef.current = mesh.material;
    mesh.material = moveFaceHiddenMatRef.current;
    setFaceColorSkinVisible(mesh, false);
  }, []);

  const paintMoveFacePreview = useCallback((meshData) => {
    const scene = sceneRef.current;
    removeMoveFacePreview();
    if (!scene || !meshData) return;
    const geom = geometryFromPreviewMesh(meshData);
    if (!geom) return;
    hideMoveFaceBase();
    const mesh = new ThreeMesh(geom, makePreviewSkinMaterial());
    mesh.name = 'move-face-preview';
    mesh.raycast = () => {};
    anchorToActivePart(mesh);
    scene.add(mesh);
    moveFacePreviewRef.current = mesh;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, hideMoveFaceBase, removeMoveFacePreview]);

  const ensureMoveFacePreview = useCallback((state) => {
    const dist = Number(state?.distance);
    const faces = state?.faces || [];
    if (!faces.length || !Number.isFinite(dist) || dist === 0) {
      clearMoveFacePreview();
      return;
    }
    const payloadFaces = faces.map((f) => ({ center: f.center, normal: f.normal }));
    const key = JSON.stringify({ payloadFaces, dist, flip: !!state.flip });
    if (moveFaceLiveKeyRef.current === key && moveFacePreviewRef.current) return;
    const gen = ++moveFacePreviewGenRef.current;
    moveFaceLiveKeyRef.current = '';
    removeMoveFacePreview();
    moveFacePreviewTimerRef.current = setTimeout(() => {
      moveFacePreviewTimerRef.current = null;
      if (gen !== moveFacePreviewGenRef.current) return;
      manifoldContext.previewMoveFace({
        faces: payloadFaces,
        distance: dist,
        flip: !!state.flip,
      }).then((payload) => {
        if (gen !== moveFacePreviewGenRef.current) return;
        const live = moveFaceModeRef.current;
        if (!live) return;
        moveFaceLiveKeyRef.current = key;
        paintMoveFacePreview(payload?.mesh);
      }).catch((err) => {
        if (gen !== moveFacePreviewGenRef.current) return;
        removeMoveFacePreview();
        showShellToast(err?.message || 'Move Face preview failed');
      });
    }, 60);
  }, [clearMoveFacePreview, paintMoveFacePreview, removeMoveFacePreview]);

  const removeBlockPreviewMesh = useCallback(() => {
    disposeEdgeOverlayObject(sceneRef.current, blockPreviewRef.current);
    blockPreviewRef.current = null;
    if (containerRef.current?.dataset?.blockPreview) {
      delete containerRef.current.dataset.blockPreview;
    }
  }, []);

  const clearBlockPreview = useCallback(() => {
    blockPreviewGenRef.current += 1;
    blockPreviewKeyRef.current = '';
    blockPreviewGeomKeyRef.current = '';
    blockPreviewMeshRef.current = null;
    if (blockPreviewTimerRef.current) {
      clearTimeout(blockPreviewTimerRef.current);
      blockPreviewTimerRef.current = null;
    }
    removeBlockPreviewMesh();
  }, [removeBlockPreviewMesh]);
  clearBlockPreviewRef.current = clearBlockPreview;

  /**
   * SCS sheet metal overlay: plane quads / live spec preview / edge handles,
   * anchored to the active part. The part's own mesh hides while the flow is
   * open (the overlay is the draft) and comes back on exit.
   */
  const sheetMetalTapRef = useRef(null);
  sheetMetalTapRef.current = (pick) => {
    const lengthMm = characteristicLengthMm({ bounds: modelBoundsRef.current });
    setSheetMetalMode((prev) => (prev ? sheetTap(prev, pick, lengthMm) : prev));
  };
  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__SHEET__ = {
      tap: (pick) => sheetMetalTapRef.current?.(pick),
      state: () => {
        const m = sheetMetalModeRef.current;
        if (!m) return null;
        return {
          stage: m.stage,
          reopen: !!m.reopen,
          step: Number.isInteger(m.step) ? m.step : null,
          bends: m.spec?.bends?.length || 0,
          tabs: m.spec?.tabs?.length || 0,
          holes: m.spec?.holes?.length || 0,
          tool: m.tool || '',
        };
      },
    };
  }
  useEffect(() => {
    const scene = sceneRef.current;
    disposeSheetOverlay(scene, sheetMetalOverlayRef.current);
    sheetMetalOverlayRef.current = null;
    const mesh = resultRef.current;
    const sketchingHoles = !!sheetMetalMode?.holeSketch;
    if (!sheetMetalMode || sketchingHoles) {
      if (mesh && mesh.userData.sheetMetalHidden) {
        mesh.visible = true;
        delete mesh.userData.sheetMetalHidden;
      }
      if (containerRef.current?.dataset) delete containerRef.current.dataset.sheetMetal;
    } else {
      if (mesh && mesh.visible) {
        mesh.visible = false;
        mesh.userData.sheetMetalHidden = true;
      }
      const group = buildSheetOverlay({
        ...sheetMetalMode,
        previewSpec: sheetMetalMode.stage === 'base'
          ? baseDraftSpec(sheetMetalMode)
          : draftPreviewSpec(sheetMetalMode),
        draft: sheetMetalMode.stage === 'base' ? { id: 'base' } : sheetMetalMode.draft,
      });
      if (group && scene) {
        anchorToActivePart(group);
        const host = containerRef.current;
        syncSheetEdgeLineResolution(group, host?.clientWidth || 390, host?.clientHeight || 844);
        scene.add(group);
        sheetMetalOverlayRef.current = group;
      }
      if (containerRef.current?.dataset) containerRef.current.dataset.sheetMetal = sheetMetalMode.stage;
    }
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera && scene) renderer.render(scene, camera);
  }, [sheetMetalMode, anchorToActivePart]);

  /**
   * Live Block solid, painted like every other preview (utils/previewStyle):
   * unlit translucent cyan skin plus a brighter cyan crease outline, Add and
   * Subtract alike, so it never reads as committed CAD. Subtract also skips
   * the depth test, so a cutter inside the host is still obvious. Neither
   * mesh raycasts, and neither replaces the part.
   */
  const paintBlockPreview = useCallback((meshData, combine) => {
    const scene = sceneRef.current;
    removeBlockPreviewMesh();
    if (!scene || !meshData) return;
    const geom = geometryFromPreviewMesh(meshData);
    if (!geom) return;
    const subtract = combine === 'subtract';
    const group = new Group();
    group.name = 'blockSolidPreview';
    const skin = new ThreeMesh(geom, makeBlockPreviewSkinMaterial({ subtract }));
    skin.name = 'blockSolidPreviewSkin';
    skin.raycast = () => {};
    skin.renderOrder = PREVIEW_RENDER_ORDER.skin;
    skin.frustumCulled = false;
    group.add(skin);
    const outline = new LineSegments(
      new EdgesGeometry(geom, BLOCK_PREVIEW_EDGE_ANGLE),
      makePreviewOutlineMaterial(),
    );
    outline.name = 'blockSolidPreviewOutline';
    outline.raycast = () => {};
    outline.renderOrder = PREVIEW_RENDER_ORDER.outline;
    outline.frustumCulled = false;
    group.add(outline);
    anchorToActivePart(group);
    scene.add(group);
    blockPreviewRef.current = group;
    if (containerRef.current) {
      containerRef.current.dataset.blockPreview = subtract ? 'subtract' : 'add';
    }
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [anchorToActivePart, removeBlockPreviewMesh]);

  const setBlockPreview = useCallback((payload) => {
    if (!payload || !isBlockSolidId(payload.id)) {
      clearBlockPreview();
      return;
    }
    if (blockParamsPending(payload.params)) return;
    let spec;
    try {
      spec = blockSpec(payload.id, payload.params);
    } catch {
      clearBlockPreview();
      return;
    }
    const geomKey = blockGeomKey(spec);
    const fullKey = `${geomKey}|${spec.combine}`;
    if (blockPreviewKeyRef.current === fullKey && blockPreviewRef.current) return;
    if (blockPreviewGeomKeyRef.current === geomKey && blockPreviewMeshRef.current) {
      blockPreviewKeyRef.current = fullKey;
      paintBlockPreview(blockPreviewMeshRef.current, spec.combine);
      return;
    }
    const gen = ++blockPreviewGenRef.current;
    blockPreviewKeyRef.current = '';
    if (blockPreviewTimerRef.current) clearTimeout(blockPreviewTimerRef.current);
    blockPreviewTimerRef.current = setTimeout(() => {
      blockPreviewTimerRef.current = null;
      if (gen !== blockPreviewGenRef.current) return;
      manifoldContext.previewBlock({ id: spec.id, params: payload.params }).then((res) => {
        if (gen !== blockPreviewGenRef.current) return;
        const mesh = res?.mesh;
        if (!mesh) {
          removeBlockPreviewMesh();
          return;
        }
        blockPreviewKeyRef.current = fullKey;
        blockPreviewGeomKeyRef.current = geomKey;
        blockPreviewMeshRef.current = mesh;
        paintBlockPreview(mesh, spec.combine);
      }).catch((err) => {
        if (gen !== blockPreviewGenRef.current) return;
        removeBlockPreviewMesh();
        blockPreviewKeyRef.current = '';
        blockPreviewGeomKeyRef.current = '';
        blockPreviewMeshRef.current = null;
        showShellToast(err?.message || 'Block preview failed');
      });
    }, 60);
  }, [clearBlockPreview, paintBlockPreview, removeBlockPreviewMesh]);

  const paintMoveFacePicks = useCallback((state) => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    clearHighlight();
    const shown = [...new Set((state?.faces || []).flatMap((f) => f.indices || []))];
    if (geom && positions && index && shown.length) {
      highlightFace(shown, geom, positions, index, 0xffff00, 'move-face');
    }
  }, [clearHighlight, highlightFace]);

  const exitMoveFaceMode = useCallback(() => {
    cancelFeatureEditRef.current?.('moveFace');
    const was = moveFaceModeRef.current;
    clearMoveFacePreview();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearMoveFacePreview]);

  const commitMoveFaceState = useCallback((next) => {
    moveFaceModeRef.current = next;
    setMoveFaceMode(next);
    paintMoveFacePicks(next);
  }, [paintMoveFacePicks]);

  const enterMoveFaceMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current) {
      clearHighlight();
      clearCutPlaneWidget();
      clearCutPiecePreview();
    }
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    if (moveModeRef.current) {
      clearHighlight();
      clearMovePreview();
    }
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    if (deleteFaceModeRef.current) clearHighlight();
    clearDeleteFacePreviewRef.current();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const picks = facePickGroupRef.current?.picks;
    let seed = [];
    if (Array.isArray(picks) && picks.length) seed = picks;
    else if (selectedFace && Array.isArray(selectedFace.center) && Array.isArray(selectedFace.normal)) {
      seed = [selectedFace];
    }
    const nextFace = emptyMoveFaceState(seed);
    nextFace.distance = moveFaceRange(
      characteristicLengthMm({ bounds: modelBoundsRef.current }),
      solidMinExtent(resultRef.current?.geometry),
    ).defaultMm;
    commitMoveFaceState(nextFace);
  }, [
    exitContourMode,
    selectedFace,
    clearFilletBlendPreview,
    clearCutPlaneWidget,
    clearCutPiecePreview,
    clearMovePreview,
    clearEdgeHover,
    clearEdgeHighlight,
    commitMoveFaceState,
  ]);

  const acceptMoveFace = useCallback(() => {
    const state = moveFaceModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'moveFace') {
      const draft = {
        fields: {
          ...(featureEditRef.current.session?.fields || {}),
          distance: Number(state.distance),
          flip: !!state.flip,
        },
      };
      if (featureEditRef.current.clearMissing) draft.faces = featureEditRef.current.resolvedFaces || [];
      const ok = commitFeatureEditRef.current?.(draft);
      if (ok) exitMoveFaceMode();
      return;
    }
    const gate = validateMoveFaceAccept(state);
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitMoveFace?.({ state, partId: activePartIdRef.current });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitMoveFaceMode();
    }
  }, [onCommitMoveFace, exitMoveFaceMode, onFaceSelected, clearHighlight]);

  useEffect(() => {
    if (!moveFaceMode) {
      clearMoveFacePreview();
      return;
    }
    ensureMoveFacePreview(moveFaceMode);
  }, [moveFaceMode, clearMoveFacePreview, ensureMoveFacePreview]);

  // A tap only adds or removes a face. deleteFace runs on Confirm, not here,
  // so a heal that cannot stay closed does not throw on the click.
  const clearDeleteFacePreview = useCallback(() => {}, []);
  clearDeleteFacePreviewRef.current = clearDeleteFacePreview;

  const paintDeleteFacePicks = useCallback((state) => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    clearHighlight();
    const shown = [...new Set((state?.faces || []).flatMap((f) => f.indices || []))];
    if (geom && positions && index && shown.length) {
      highlightFace(shown, geom, positions, index, 0xffff00, 'delete-face');
    }
  }, [clearHighlight, highlightFace]);

  const exitDeleteFaceMode = useCallback(() => {
    cancelFeatureEditRef.current?.('deleteFace');
    const was = deleteFaceModeRef.current;
    clearDeleteFacePreview();
    setDeleteFaceMode(null);
    deleteFaceModeRef.current = null;
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearDeleteFacePreview]);

  yieldToFeatureEditCardRef.current = () => {
    if (contourModeRef.current) exitContourMode();
    if (filletModeRef.current) exitFilletMode();
    if (shellModeRef.current) exitShellMode();
    if (draftModeRef.current) exitDraftMode();
    if (cutModeRef.current) exitCutMode();
    if (booleanModeRef.current) exitBooleanMode();
    if (moveModeRef.current) exitMoveMode();
    if (rotateModeRef.current) exitRotateMode();
    if (mirrorModeRef.current) exitMirrorMode();
    if (moveFaceModeRef.current) exitMoveFaceMode();
    if (deleteFaceModeRef.current) exitDeleteFaceMode();
    exitSheetMetalChromeRef.current();
    if (paintModeRef.current) exitPaintModeRef.current();
    if (helperCardOpenRef.current) setHelperCardOpen(false);
    if (feaActive) feaCloseRef.current();
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    if (pickModeRef.current === 'edge') {
      pickModeRef.current = 'face';
      setPickMode('face');
    }
  };

  useEffect(() => registerFeaturePopupDismiss(() => {
    featureEditRef.current = null;
    setHelperEdit(null);
    holeEditRef.current = null;
    holeSpecRef.current = null;
    holeCentresEditRef.current = null;
    if (holeCardRef.current) setHoleCard(null);
    if (featureSlotsRef.current) {
      featureSlotsRef.current = null;
      setFeatureSlots(null);
    }
    yieldToFeatureEditCardRef.current();
    if (measurementEnabledRef.current) exitMeasureModeRef.current?.();
  }), []);

  const commitDeleteFaceState = useCallback((next) => {
    deleteFaceModeRef.current = next;
    setDeleteFaceMode(next);
    paintDeleteFacePicks(next);
  }, [paintDeleteFacePicks]);

  const enterDeleteFaceMode = useCallback(() => {
    if (!allowFeaturePopup()) return;
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current) {
      clearHighlight();
      clearCutPlaneWidget();
      clearCutPiecePreview();
    }
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    if (moveModeRef.current) {
      clearHighlight();
      clearMovePreview();
    }
    setMoveMode(null);
    moveModeRef.current = null;
    clearRotatePreviewRef.current();
    setRotateMode(null);
    rotateModeRef.current = null;
    dropMirrorModeRef.current();
    if (moveFaceModeRef.current) clearHighlight();
    clearMoveFacePreview();
    setMoveFaceMode(null);
    moveFaceModeRef.current = null;
    setPickMode('face');
    clearEdgeHover();
    clearEdgeHighlight();
    setSelectedEdges([]);
    const picks = facePickGroupRef.current?.picks;
    let seed = [];
    if (Array.isArray(picks) && picks.length) seed = picks;
    else if (selectedFace && Array.isArray(selectedFace.center) && Array.isArray(selectedFace.normal)) {
      seed = [selectedFace];
    }
    commitDeleteFaceState(emptyDeleteFaceState(seed));
  }, [
    exitContourMode,
    selectedFace,
    clearFilletBlendPreview,
    clearCutPlaneWidget,
    clearCutPiecePreview,
    clearMovePreview,
    clearMoveFacePreview,
    clearEdgeHover,
    clearEdgeHighlight,
    commitDeleteFaceState,
  ]);

  const acceptDeleteFace = useCallback(() => {
    const state = deleteFaceModeRef.current;
    if (!state) return;
    if (featureEditRef.current?.kind === 'deleteFace') {
      const faces = state.faces || [];
      const draft = {
        fields: { ...(featureEditRef.current.session?.fields || {}), faceCount: faces.length },
      };
      const stored = featureEditRef.current.session?.faces || [];
      if (featureEditRef.current.clearMissing || faces.length !== stored.length) draft.faces = faces;
      const ok = commitFeatureEditRef.current?.(draft);
      if (ok) exitDeleteFaceMode();
      return;
    }
    const gate = validateDeleteFaceAccept(state);
    if (!gate.ok) {
      showShellToast(gate.message);
      return;
    }
    const ok = onCommitDeleteFace?.({ state, partId: activePartIdRef.current });
    if (ok) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      exitDeleteFaceMode();
    }
  }, [onCommitDeleteFace, exitDeleteFaceMode, onFaceSelected, clearHighlight]);

  const clearMeasurementLines = useCallback(() => {
    if (measurementLinesRef.current && sceneRef.current) {
      sceneRef.current.remove(measurementLinesRef.current);
      disposeMeasurementLines(measurementLinesRef.current);
      measurementLinesRef.current = null;
    }
  }, []);

  const clearMeasureDecor = useCallback(() => {
    clearMeasurementLines();
    if (measureMarkerRef.current) {
      disposeEdgeOverlayObject(sceneRef.current, measureMarkerRef.current);
      measureMarkerRef.current = null;
    }
    if (measureEdgeRef.current) {
      disposeEdgeOverlayObject(sceneRef.current, measureEdgeRef.current);
      measureEdgeRef.current = null;
    }
  }, [clearMeasurementLines]);

  /**
   * Cyan faces, violet parts, amber edges, pink points, and the X/Y/Z
   * staircase between the last two picks. Local coordinates, anchored to
   * the active part.
   */
  const paintMeasurePicks = useCallback((picks) => {
    clearHighlight();
    clearMeasureDecor();
    if (!measurementEnabledRef.current || !sceneRef.current) return;
    const list = Array.isArray(picks) ? picks : [];
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    const markers = new Group();
    markers.name = 'measure-markers';
    const edgeDraw = [];
    for (const pick of list) {
      if ((pick.kind === 'face' || pick.kind === 'part') && positions && index && pick.indices?.length) {
        highlightFace(
          pick.indices,
          geom,
          positions,
          index,
          pick.kind === 'part' ? 0x7c3aed : 0x22d3ee,
          `measure-${pick.kind}`,
        );
      } else if (pick.kind === 'edge' && pick.draw?.length) {
        edgeDraw.push(...pick.draw);
      } else if (pick.kind === 'point' && pick.position) {
        const marker = new ThreeMesh(
          new SphereGeometry(1.1, 14, 14),
          new MeshBasicMaterial({ color: 0xf472b6, depthTest: false, depthWrite: false }),
        );
        marker.position.set(pick.position[0], pick.position[1], pick.position[2]);
        marker.renderOrder = 24;
        marker.raycast = () => {};
        markers.add(marker);
      }
    }
    if (markers.children.length) {
      anchorToActivePart(markers);
      sceneRef.current.add(markers);
      measureMarkerRef.current = markers;
    }
    if (edgeDraw.length) {
      measureEdgeRef.current = paintEdgeLines(edgeDraw, {
        color: 0xfbbf24,
        name: 'measure-edges',
        corePx: 4,
        haloPx: 9,
      });
    }
    if (list.length >= 2) {
      const prev = list[list.length - 2];
      const last = list[list.length - 1];
      const from = measureAnchor(prev);
      const to = measureAnchor(last);
      if (from && to) {
        const lines = createDeltaLines(from, to, prev?.normal || null);
        anchorToActivePart(lines);
        sceneRef.current.add(lines);
        measurementLinesRef.current = lines;
      }
    }
  }, [clearHighlight, clearMeasureDecor, highlightFace, paintEdgeLines]);

  useEffect(() => {
    if (!measurementEnabled) {
      clearMeasureDecor();
      return undefined;
    }
    paintMeasurePicks(measurePicks);
    return undefined;
  }, [measurementEnabled, measurePicks, paintMeasurePicks, clearMeasureDecor]);

  const paintFeaProbes = useCallback((list) => {
    const scene = sceneRef.current;
    if (feaProbeGroupRef.current) {
      disposeProbeGroup(feaProbeGroupRef.current);
      feaProbeGroupRef.current = null;
    }
    if (!scene || !list?.length) return;
    const cam = cameraRef.current;
    const dist = cam ? cam.position.length() : 80;
    const worldH = Math.max(1.2, dist * 0.035);
    const group = new Group();
    group.name = 'fea-probes';
    for (const probe of list) {
      const position = probe.position;
      if (!position || position.length < 3) continue;
      const marker = new ThreeMesh(
        new SphereGeometry(worldH * 0.42, 14, 14),
        new MeshBasicMaterial({ color: 0x67e8f9, depthTest: false, depthWrite: false }),
      );
      marker.name = 'fea-probe-marker';
      marker.userData.probeId = probe.id;
      marker.position.set(position[0], position[1], position[2]);
      marker.renderOrder = 28;
      marker.frustumCulled = false;
      group.add(marker);
      const sprite = makeProbeNumberSprite(String(probe.number), worldH * 1.15);
      if (sprite) {
        sprite.position.set(position[0], position[1] + worldH * 0.85, position[2]);
        group.add(sprite);
      }
    }
    if (!group.children.length) return;
    scene.add(group);
    feaProbeGroupRef.current = group;
  }, []);

  useEffect(() => {
    const draw = () => paintFeaProbes(getProbeOverlay());
    draw();
    const unsubscribe = subscribeProbeOverlay(draw);
    return () => {
      unsubscribe();
      paintFeaProbes([]);
    };
  }, [paintFeaProbes]);


  /** Shared screen-space edge pick. Occlusion raycast is opt-in (click path);
   *  hover skips it to avoid full mesh intersect on every mousemove (iPhone jank). */
  const pickEdgeAtClient = useCallback((clientX, clientY, { occlude = true } = {}) => {
    if (!canvasRef.current || !cameraRef.current || !resultRef.current) return null;
    syncFeatureEdges(resultRef.current.geometry);
    const shift = meshPose(resultRef.current);
    const localEdges = featureEdgesRef.current;
    const pickEdges = shift ? localEdges.map((edge) => shiftEdgeForWorld(edge, resultRef.current)) : localEdges;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    // Fillet / chamfer only. Other edge picks keep the 32 / 40px slop.
    // Short edges grow to a 44px hit (22px each side); the stroke width does not.
    const filletPick = !!filletModeRef.current;
    const slop = filletPick
      ? Math.max(resolveEdgePickSlopPx(), EDGE_FILLET_HIT_RADIUS_PX)
      : resolveEdgePickSlopPx();
    const cam = cameraRef.current.position;
    const opts = {
      projectScratchA: edgePickScratchA.current,
      projectScratchB: edgePickScratchB.current,
      cameraPosition: [cam.x, cam.y, cam.z],
    };
    if (filletPick) opts.minHitLengthPx = EDGE_FILLET_HIT_RADIUS_PX;
    if (occlude) {
      // Raycast mesh for occlusion — reject back-face edges behind the hit.
      mouseRef.current.x = (px / rect.width) * 2 - 1;
      mouseRef.current.y = -(py / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const hits = raycasterRef.current.intersectObject(resultRef.current);
      if (hits.length > 0) {
        const p = hits[0].point;
        opts.meshHitPoint = [p.x, p.y, p.z];
      }
    }
    const picked = pickNearestEdgeScreen(
      pickEdges,
      cameraRef.current,
      rect.width,
      rect.height,
      px,
      py,
      slop,
      opts,
    );
    if (!picked || pickEdges === localEdges) return picked;
    return localEdges.find((edge) => edge.key === picked.key) || null;
  }, [syncFeatureEdges]);

  /** Face and owning body for one mesh hit. Patch id is the lowest triangle. */
  const measureHitGeometry = useCallback((hit) => {
    const mesh = resultRef.current;
    const geometry = mesh?.geometry;
    const positions = geometry?.attributes?.position;
    const index = geometry?.index?.array;
    if (!hit?.face || !geometry || !positions?.array || !index) return { face: null, part: null };
    const seed = hit.faceIndex;
    const graph = selectGraphFace(geometry, seed, faceIDsRef.current);
    const indices = graph.indices?.length ? graph.indices : [seed];
    const stats = triangleGroupStats(positions.array, index, indices);
    const partId = activePartIdRef.current || '';
    const face = buildFaceMeasurePick({
      partId,
      patchId: String(Math.min(...indices)),
      center: stats.center,
      normal: stats.normal,
      points: stats.points,
      indices,
    });
    const bodies = meshBodyComponents(positions, index);
    const body = bodyContainingTriangle(bodies, seed);
    let part = null;
    if (body?.triangles?.length) {
      const bounds = boundsOfTriangles(positions.array, index, body.triangles);
      part = buildPartMeasurePick({
        partId,
        bodyKey: cutBodyKey(body),
        center: bounds.center,
        size: bounds.size,
        indices: body.triangles,
      });
    }
    return { face, part };
  }, []);

  /**
   * One tap's point, edge, or face, plus the part a second tap in the same
   * place selects. Screen endpoints win over the edge; the edge wins over
   * the face. A miss returns null and leaves the set alone.
   */
  const readMeasurePointer = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const mesh = resultRef.current;
    if (!canvas || !camera || !mesh?.geometry) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    mouseRef.current.x = (px / rect.width) * 2 - 1;
    mouseRef.current.y = -(py / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, camera);
    const hits = raycasterRef.current.intersectObject(mesh, false);
    const hit = hits.find((item) => item.face) || null;
    const edge = pickEdgeAtClient(clientX, clientY, { occlude: true });
    let edgeDist = Infinity;
    let vertexDist = Infinity;
    let vertexT = 0.5;
    let vertexAt = null;
    if (edge?.va && edge?.vb) {
      const shift = meshPose(mesh);
      const lift = (p) => (shift ? shiftLocalPoint(p, shift.t, shift.q) : p);
      const sa = projectWorldToCanvas(camera, lift(edge.va), rect.width, rect.height, edgePickScratchA.current);
      const sb = projectWorldToCanvas(camera, lift(edge.vb), rect.width, rect.height, edgePickScratchB.current);
      if (sa && sb) {
        edgeDist = distPointToSegment2D(px, py, sa.x, sa.y, sb.x, sb.y);
        vertexT = segmentParameter2D(px, py, sa.x, sa.y, sb.x, sb.y);
        const da = Math.hypot(px - sa.x, py - sa.y);
        const db = Math.hypot(px - sb.x, py - sb.y);
        vertexDist = Math.min(da, db);
        vertexAt = da <= db ? edge.va : edge.vb;
      }
      if (hit?.point) {
        const gap = pointSegmentDistance(
          [hit.point.x, hit.point.y, hit.point.z],
          lift(edge.va),
          lift(edge.vb),
        );
        if (!measurePointerOnEdge({ edgeGap: gap, hasFace: true })) {
          edgeDist = Infinity;
          vertexDist = Infinity;
          vertexAt = null;
        }
      }
      // A circle's chords are a few pixels. Every vertex would otherwise be a point.
      if (vertexAt && measureChainIsCircular(propagateTangentEdges(featureEdgesRef.current, edge))) {
        vertexDist = Infinity;
        vertexAt = null;
      }
    }
    const kind = classifyMeasurePointer({
      vertexDist,
      vertexT,
      edgeDist,
      edgeSlop: resolveEdgePickSlopPx(),
      hasFace: !!hit,
    });
    const partId = activePartIdRef.current || '';
    let primary = null;
    const geom = hit ? measureHitGeometry(hit) : { face: null, part: null };
    if (kind === 'point' && vertexAt) {
      primary = buildPointMeasurePick({ partId, position: vertexAt });
    } else if (kind === 'edge' && edge) {
      let chain = propagateTangentEdges(featureEdgesRef.current, edge);
      if (!chain.length || chain.length > 128) chain = [edge];
      const canon = chain.reduce((best, item) => (
        String(item.key) < String(best.key) ? item : best
      ), chain[0]);
      primary = buildEdgeMeasurePick({
        partId,
        edge: canon,
        chain,
      });
    } else if (kind === 'face') {
      primary = geom.face;
    }
    if (!primary && !geom.part) return null;
    return { primary, part: geom.part };
  }, [pickEdgeAtClient, measureHitGeometry]);

  const commitMeasurePicks = useCallback((next) => {
    const list = Array.isArray(next) ? next : [];
    measurePicksRef.current = list;
    setMeasurePicks(list);
  }, []);

  /** Sticky tap. A second tap on the same spot, inside the double-tap window, selects the part. */
  const applyMeasurePointer = useCallback((event) => {
    const built = readMeasurePointer(event.clientX, event.clientY);
    if (!built) return;
    const now = Date.now();
    const prev = measureLastTapRef.current;
    const sameSpot = !!prev
      && (now - prev.t) < (MULTI_CLICK_DELAY + 20)
      && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 22;
    measureLastTapRef.current = { t: now, x: event.clientX, y: event.clientY, pickId: built.primary?.id || null };
    if (sameSpot && built.part) {
      if (measureTapTimerRef.current) {
        clearTimeout(measureTapTimerRef.current);
        measureTapTimerRef.current = null;
      }
      pendingMeasureRef.current = null;
      commitMeasurePicks(toggleMeasurePick(measurePicksRef.current, built.part));
      return;
    }
    if (measureTapTimerRef.current) {
      clearTimeout(measureTapTimerRef.current);
      measureTapTimerRef.current = null;
      const queued = pendingMeasureRef.current;
      pendingMeasureRef.current = null;
      if (queued) commitMeasurePicks(toggleMeasurePick(measurePicksRef.current, queued));
    }
    if (!built.primary) return;
    pendingMeasureRef.current = built.primary;
    measureTapTimerRef.current = setTimeout(() => {
      measureTapTimerRef.current = null;
      const queued = pendingMeasureRef.current;
      pendingMeasureRef.current = null;
      if (queued) commitMeasurePicks(toggleMeasurePick(measurePicksRef.current, queued));
    }, MULTI_CLICK_DELAY);
  }, [readMeasurePointer, commitMeasurePicks]);

  /**
   * Drag one sketch point. Cursor and Polyline use the left button as well
   * as touch, so a tap-drag moves the point. Other tools keep the right
   * button. A gesture selects and does not drag. A solver-locked point and
   * a contour already in conflict consume the event so the camera does not pan.
   */
  const beginPolylinePointDrag = useCallback((event, { touch = false, cursorTap = false } = {}) => {
    const state = contourModeRef.current;
    if (polylinePointDragRef.current) return true;
    if (contourPlaneOpenRef.current) return false;
    if (!state || state.gesture) return false;
    if (pickModeRef.current === 'edge') return false;
    const handles = sketchHandles(state);
    if (!handles.length) return false;
    const index = pickPolylinePointAtClient(event.clientX, event.clientY);
    if (index < 0 || index >= handles.length) return false;
    const spec = state.params?.contour || null;
    const pointId = handles[index].id || spec?.points?.[index]?.id || null;
    const frozen = !!(spec && pointId && !contourPointDragAllowed(spec, pointId));
    event.preventDefault();
    polylinePointDragRef.current = {
      index,
      plane: selectedLoftDrawFrame(state) || contourWorkplane(state, modelBoundsRef.current),
      moved: false,
      touch,
      cursorTap,
      frozen,
      pointId,
      lastSpec: spec,
      kind: handles[index].kind,
      baseParams: state.params,
      down: { x: event.clientX, y: event.clientY },
    };
    if (touch) polylineSuppressClickRef.current = true;
    setPolylinePointHover(index);
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    paintPolylineHandleStates();
    return true;
  }, [pickPolylinePointAtClient, setPolylinePointHover, paintPolylineHandleStates]);

  /**
   * Project the cursor onto the draft's workplane, in the part frame.
   * The stroke is anchored to the mesh. An unposed hit already includes an
   * in-plane translation, and anchoring the handle adds it again, so the
   * dot lands off the finger by the full pose.
   * @returns {{ uv: number[], world: number[] }|null}
   */
  const polylinePlanePointAtClient = useCallback((clientX, clientY, plane) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera || !plane) return null;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, camera);
    const o = raycasterRef.current.ray.origin;
    const d = raycasterRef.current.ray.direction;
    let rayO = [o.x, o.y, o.z];
    let rayD = [d.x, d.y, d.z];
    const pose = meshPose(resultRef.current);
    if (pose) {
      rayO = localPoint(rayO, pose);
      const ahead = localPoint([o.x + d.x, o.y + d.y, o.z + d.z], pose);
      rayD = [ahead[0] - rayO[0], ahead[1] - rayO[1], ahead[2] - rayO[2]];
    }
    const world = intersectRayPlane(rayO, rayD, plane);
    if (!world) return null;
    let uv;
    try {
      uv = worldToPlaneUV(world, plane);
    } catch {
      return null;
    }
    if (!uv.every(Number.isFinite)) return null;
    return { uv, world };
  }, []);

  /**
   * Cursor hit on an edge or the interior. A point handle is not this hit.
   * @returns {{ kind: string, hit: string, plane: object, uv: number[] }|null}
   */
  const sketchShapeAtClient = useCallback((clientX, clientY) => {
    const state = contourModeRef.current;
    if (!state || state.tool !== 'cursor' || state.gesture) return null;
    if (pickModeRef.current === 'edge' || contourPlaneOpenRef.current) return null;
    const plane = selectedLoftDrawFrame(state) || contourWorkplane(state, modelBoundsRef.current);
    const hit = polylinePlanePointAtClient(clientX, clientY, plane);
    if (!hit) return null;
    const slopPx = resolveEdgePickSlopPx();
    const beside = polylinePlanePointAtClient(clientX + slopPx, clientY, plane);
    let slop = 1;
    if (beside) slop = Math.hypot(beside.uv[0] - hit.uv[0], beside.uv[1] - hit.uv[1]);
    if (!(slop > 1e-6)) slop = 1;
    const shape = sketchShapeAt(state, hit.uv, slop);
    if (!shape) return null;
    return { ...shape, plane, uv: hit.uv };
  }, [polylinePlanePointAtClient]);

  /** Translate the whole shape. A point hit has already been claimed. */
  const beginSketchShapeDrag = useCallback((event, { touch = false } = {}) => {
    if (polylinePointDragRef.current) return true;
    const hit = sketchShapeAtClient(event.clientX, event.clientY);
    if (!hit) return false;
    const state = contourModeRef.current;
    const spec = state?.params?.contour || null;
    const frozen = !!(spec && !contourShapeDragAllowed(spec));
    event.preventDefault();
    const preview = xsPreviewRef.current;
    polylinePointDragRef.current = {
      shape: true,
      index: -1,
      plane: hit.plane,
      moved: false,
      touch,
      cursorTap: true,
      frozen,
      pointId: null,
      lastSpec: null,
      baseSpec: spec,
      kind: hit.kind,
      baseParams: state?.params,
      originUv: [hit.uv[0], hit.uv[1]],
      down: { x: event.clientX, y: event.clientY },
      previewBase: preview ? preview.position.clone() : null,
    };
    if (touch) polylineSuppressClickRef.current = true;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    return true;
  }, [sketchShapeAtClient]);

  const offsetSketchPreview = useCallback((drag, du, dv) => {
    const group = xsPreviewRef.current;
    const base = drag?.previewBase;
    const plane = drag?.plane;
    if (!group || !base || !plane?.x || !plane?.y) return;
    const local = new Vector3(
      du * plane.x[0] + dv * plane.y[0],
      du * plane.x[1] + dv * plane.y[1],
      du * plane.x[2] + dv * plane.y[2],
    );
    local.applyQuaternion(group.quaternion);
    group.position.copy(base).add(local);
  }, []);

  /**
   * Handle mouse down - record position for drag detection
   */
  const handleMouseDown = useCallback((event) => {
    mouseDownPosRef.current = { x: event.clientX, y: event.clientY };
    isDraggingRef.current = false;
    // The synthetic mouse after a touch is the same tap. It must not start
    // a second drag, or one finger-up would count as two taps.
    if (polylineSuppressClickRef.current) return;

    const tool = contourModeRef.current?.tool;
    // Cursor drags a point, or the whole shape when the point is missed.
    // Polyline still drags a point and inserts on a segment tap.
    if (event.button === 0 && (tool === 'cursor' || tool === 'polyline')) {
      if (beginPolylinePointDrag(event, { touch: false, cursorTap: true })) return;
      if (tool === 'cursor' && beginSketchShapeDrag(event, { touch: false })) return;
      return;
    }
    // Right button on a placed point picks it up (left button keeps adding).
    if (event.button !== 2) return;
    beginPolylinePointDrag(event, { touch: false });
  }, [beginPolylinePointDrag, beginSketchShapeDrag]);

  const publishContourSnap = useCallback((snap) => {
    const next = snap?.screen ? {
      role: snap.role,
      targetKey: snap.key || '',
      screen: { x: snap.screen.x, y: snap.screen.y },
    } : null;
    const prev = contourSnapRef.current;
    if (!next && !prev) return;
    if (
      next && prev
      && next.role === prev.role
      && next.targetKey === prev.targetKey
      && Math.hypot(next.screen.x - prev.screen.x, next.screen.y - prev.screen.y) < 1.5
    ) return;
    contourSnapRef.current = next;
    setContourSnap(next);
  }, []);

  /**
   * Screen-space snap for a polyline draw or a point drag. Dimension,
   * Constrain, Arc, and Cursor keep the pointer for their own picks.
   */
  const readContourSnap = useCallback((clientX, clientY, { excludePointId = null } = {}) => {
    const state = contourModeRef.current;
    if (!contourSnapAllowed(state)) return null;
    if (pickModeRef.current === 'edge') return null;
    const drag = polylinePointDragRef.current;
    const draggingPoint = !!(drag?.pointId || drag?.kind === 'polyline');
    if (!draggingPoint && state.tool !== 'polyline') return null;
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return null;
    const plane = selectedLoftDrawFrame(state) || contourWorkplane(state, modelBoundsRef.current);
    if (!plane?.center || !plane.x || !plane.y) return null;
    const rect = canvas.getBoundingClientRect();
    const pose = meshPose(resultRef.current);
    const scratch = polylineProjectScratch.current;
    const projectWorld = (world) => {
      const p = scratch.set(world[0], world[1], world[2]).project(camera);
      if (p.z < -1.02 || p.z > 1.02) return null;
      return {
        x: (p.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-p.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    };
    const projectUv = (uv) => {
      let local;
      try { local = planeUvToWorld(uv, plane); } catch { return null; }
      const world = pose ? worldPoint(local, pose) : local;
      return projectWorld(world);
    };
    const cam = camera.position;
    const references = [];
    for (const hit of referenceSnapHits(contourTopoRef.current?.edges)) {
      const ref = materializeReference(plane, hit);
      if (!ref?.geom) continue;
      const mid = hit.mid || hit.worldPoints[Math.floor(hit.worldPoints.length / 2)];
      const worldMid = mid && pose ? worldPoint(mid, pose) : mid;
      const bias = worldMid
        ? Math.hypot(worldMid[0] - cam.x, worldMid[1] - cam.y, worldMid[2] - cam.z)
        : 0;
      references.push({ ...ref, bias });
    }
    let model = state.params?.contour || null;
    if (!model && state.tool === 'polyline' && Array.isArray(state.params?.points)) {
      const pts = state.params.points;
      model = {
        points: pts.map((uv, i) => ({ id: `p${i}`, at: [Number(uv?.[0]) || 0, Number(uv?.[1]) || 0] })),
        lines: [],
        arcs: [],
      };
      for (let i = 1; i < model.points.length; i += 1) {
        model.lines.push({ id: `e${i - 1}`, a: `p${i - 1}`, b: `p${i}` });
      }
    }
    return snapContourPoint({
      x: clientX,
      y: clientY,
      model,
      references,
      projectUv,
      excludePointId,
    });
  }, []);

  const pickContourAtClient = useCallback((clientX, clientY) => {
    const state = contourModeRef.current;
    const model = state?.params?.contour;
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!state || !model || !canvas || !camera) return null;
    const plane = selectedLoftDrawFrame(state) || contourWorkplane(state, modelBoundsRef.current);
    if (!plane?.center || !plane.x || !plane.y) return null;
    const rect = canvas.getBoundingClientRect();
    const mesh = resultRef.current;
    const pose = mesh?.position ? {
      t: [mesh.position.x, mesh.position.y, mesh.position.z],
      q: mesh.quaternion
        ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
        : [0, 0, 0, 1],
    } : null;
    const projectWorld = (world) => {
      const p = polylineProjectScratch.current.set(world[0], world[1], world[2]).project(camera);
      const x = (p.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-p.y * 0.5 + 0.5) * rect.height + rect.top;
      // Safari's project() can sit a hair past ±1 for a point that is on screen.
      // Past the far plane (z > 1) still draws, so a tap there has to count.
      if (p.z < -1.02) return null;
      if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 4 || y > rect.bottom + 4) return null;
      return { x, y };
    };
    const project = (uv) => {
      const local = planeUvToWorld(uv, plane);
      const world = pose ? worldPoint(local, pose) : local;
      return projectWorld(world);
    };
    const scratch = polylineProjectScratch.current;
    const screenOfLocal = (obj, local) => {
      scratch.set(local[0], local[1], local[2]);
      obj.localToWorld(scratch);
      const world = [scratch.x, scratch.y, scratch.z];
      return projectWorld(world);
    };
    // The stroke is drawn in the part pose. Hitting the drawn pixels, not the
    // unposed plane, is what makes a tap on the visible line register.
    let drawn = null;
    let drawnD = SKETCH_HIT_PX;
    const handles = polylineDraftRef.current?.userData?.handles || [];
    for (const handle of handles) {
      if (!handle.userData?.pointId) continue;
      handle.getWorldPosition(scratch);
      const q = projectWorld([scratch.x, scratch.y, scratch.z]);
      if (!q) continue;
      const d = Math.hypot(clientX - q.x, clientY - q.y);
      if (d <= drawnD) {
        drawnD = d;
        drawn = { kind: 'point', id: handle.userData.pointId, label: handle.userData.pointId };
      }
    }
    if (!drawn) {
      const wire = contourStatusRef.current;
      wire?.updateMatrixWorld?.(true);
      let bestLine = null;
      let bestLineD = SKETCH_HIT_PX;
      let bestArc = null;
      let bestArcD = SKETCH_HIT_PX;
      let bestEnd = null;
      let bestEndD = SKETCH_HIT_PX;
      for (const child of wire?.children || []) {
        const pts = child.userData?.localPts;
        const id = child.userData?.entityId;
        if (!id || !pts || pts.length < 2) continue;
        let d = Infinity;
        let endA = null;
        let endB = null;
        for (let i = 1; i < pts.length; i += 1) {
          const a = screenOfLocal(child, pts[i - 1]);
          const b = screenOfLocal(child, pts[i]);
          if (!a || !b) continue;
          if (i === 1) endA = a;
          endB = b;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const L2 = dx * dx + dy * dy;
          let t = L2 > 1e-12 ? ((clientX - a.x) * dx + (clientY - a.y) * dy) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          d = Math.min(d, Math.hypot(clientX - (a.x + t * dx), clientY - (a.y + t * dy)));
        }
        const kind = child.userData.entityKind === 'arc' ? 'arc' : 'line';
        if (kind === 'line') {
          const line = (model.lines || []).find((item) => item.id === id);
          const ends = [[line?.a, endA], [line?.b, endB]];
          for (const [pointId, screen] of ends) {
            if (!pointId || !screen) continue;
            const ed = Math.hypot(clientX - screen.x, clientY - screen.y);
            if (ed <= bestEndD) {
              bestEndD = ed;
              bestEnd = { kind: 'point', id: pointId, label: pointId };
            }
          }
        }
        if (kind === 'arc' && d <= bestArcD) {
          bestArcD = d;
          bestArc = { kind: 'arc', id, label: id };
        } else if (kind === 'line' && d <= bestLineD) {
          bestLineD = d;
          bestLine = { kind: 'line', id, label: id };
        }
      }
      // A corner is the point. The stroke passes through it, and the point
      // is what a distance to a hole needs.
      drawn = bestEnd || bestArc || bestLine;
    }
    const hit = drawn || pickContourScreen(model, project, clientX, clientY, SKETCH_HIT_PX);
    const pxNdc = ((clientX - rect.left) / rect.width) * 2 - 1;
    const pyNdc = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera({ x: pxNdc, y: pyNdc }, camera);
    const origin = raycasterRef.current.ray.origin;
    const dir = raycasterRef.current.ray.direction;
    let rayO = [origin.x, origin.y, origin.z];
    let rayD = [dir.x, dir.y, dir.z];
    if (pose) {
      rayO = localPoint(rayO, pose);
      const ahead = localPoint([origin.x + dir.x, origin.y + dir.y, origin.z + dir.z], pose);
      rayD = [ahead[0] - rayO[0], ahead[1] - rayO[1], ahead[2] - rayO[2]];
    }
    let tap = null;
    const landed = intersectRayPlane(rayO, rayD, plane);
    if (landed) {
      try { tap = worldToPlaneUV(landed, plane); } catch { /* the pick still selects */ }
    }
    if (hit) {
      let at = null;
      if (tap) {
        try { at = anchorOnEntity(model, hit, tap); } catch { /* a missed UV still selects */ }
      }
      return at ? { ...hit, at } : hit;
    }
    // Sketch missed. Vertices, then this part's edges, then a face outline.
    if (!referencePickAllowed(state.gesture) || !resultRef.current) return null;
    syncFeatureEdges(resultRef.current.geometry);
    const topo = contourTopoRef.current;
    const edges = topo?.edges || [];
    const projectLocal = (local) => projectWorld(pose ? worldPoint(local, pose) : local);
    const vertex = vertexHit(edges, projectLocal, clientX, clientY, SKETCH_HIT_PX);
    let partHit = vertex;
    const cam = camera.position;
    const opts = {
      projectScratchA: edgePickScratchA.current,
      projectScratchB: edgePickScratchB.current,
      cameraPosition: [cam.x, cam.y, cam.z],
    };
    const hits = raycasterRef.current.intersectObject(resultRef.current);
    if (hits.length > 0) {
      const p = hits[0].point;
      opts.meshHitPoint = [p.x, p.y, p.z];
    }
    const pickScreen = (pickEdges) => pickNearestEdgeScreen(
      pickEdges,
      camera,
      rect.width,
      rect.height,
      clientX - rect.left,
      clientY - rect.top,
      SKETCH_HIT_PX,
      opts,
    );
    if (!partHit && topo?.sheet) {
      // Model edges only. A mesh face outline on this part binds a hole chord
      // when the tapped flange edge is a naked triangle.
      // Collinear skins share a screen line. The front-face hit picks the
      // nearer skin; fillet picks do not set this tie.
      opts.collinearTiePx = 0.75;
      opts.collinearPoint = opts.meshHitPoint || opts.cameraPosition;
      const modelEdges = referencePickEdges(topo) || [];
      const pickEdges = modelEdges.map((edge) => orientPickEdge(edge, resultRef.current));
      const picked = pickScreen(pickEdges);
      const local = picked && modelEdges.find((edge) => edge.key === picked.key);
      partHit = edgeReferenceHit(topo, local);
    } else if (!partHit) {
      const localEdges = referenceEdgesForPart(featureEdgesRef.current, activePartIdRef.current);
      const shift = meshPose(resultRef.current);
      const pickEdges = shift ? localEdges.map((edge) => shiftEdgeForWorld(edge, resultRef.current)) : localEdges;
      const picked = pickScreen(pickEdges);
      const local = picked && (pickEdges === localEdges
        ? picked
        : localEdges.find((edge) => edge.key === picked.key));
      partHit = edgeReferenceHit(topo, local);
    }
    if (!partHit && !topo?.sheet && resultRef.current) {
      const faceHits = raycasterRef.current.intersectObject(resultRef.current);
      const seed = faceHits[0]?.faceIndex;
      if (seed != null) {
        const encoded = topo?.triFace?.[seed];
        let faceId = Number.isFinite(Number(encoded)) ? Number(encoded) : null;
        if (faceId == null) {
          const graph = selectGraphFace(resultRef.current.geometry, seed, faceIDsRef.current);
          const indices = graph.indices?.length ? graph.indices : [seed];
          faceId = Infinity;
          for (const tri of indices) {
            const raw = Number(faceIDsRef.current?.[tri]);
            if (Number.isFinite(raw) && raw < faceId) faceId = raw;
          }
          if (!(faceId < Infinity)) faceId = null;
        }
        if (faceId != null) partHit = faceOutlineHit(edges, faceId, projectLocal, clientX, clientY);
      }
    }
    if (!partHit) return null;
    const ref = materializeReference(plane, partHit);
    if (tap && ref) ref.tap = tap;
    return { kind: 'reference', ref };
  }, [syncFeatureEdges]);

  const saveContourBlock = useCallback((state) => {
    if (!state?.params?.contour) return state;
    // Feature edit of an old inline profile still rewrites that feature
    // on the rail Confirm. Pointer-up must not insert a second contour.
    if (featureEditRef.current?.dialog === 'contour') return state;
    // An open edit saves on the rail checkmark. Pointer-up must not write,
    // so X can discard the session.
    if (contourEditRef.current) return state;
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const minted = state.contourId ? null : mintContourIdentity(buf);
    const contourId = state.contourId || minted.id;
    const contourName = state.contourName || minted.name;
    const commitFace = activeContourFace(state, modelBoundsRef.current);
    const ok = onCommitContourProfile?.({
      contourBlock: true,
      contourId,
      contourName,
      partId: activePartIdRef.current,
      face: state.planeFace || commitFace,
      tool: state.tool,
      params: state.params,
      entry: state.entry,
      loft: state.loft,
      planeOffset: Number(state.planeOffset) || 0,
    });
    if (ok === false) return null;
    return { ...state, contourId, contourName };
  }, [getHelperBuffer, onCommitContourProfile]);

  /** Unpromoted circle, rectangle, or polygon: write the size once, on release. */
  const commitSketchParam = useCallback((patch) => {
    setContourMode((prev) => {
      if (!prev || prev.params?.contour || !patch) return prev;
      const params = { ...(prev.params || {}), ...patch };
      const next = { ...prev, params };
      return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params }) : next;
    });
  }, []);

  /** Unpromoted draft: write the dragged UV once, on release. No script write. */
  const commitPolylinePointDrag = useCallback((uv, index) => {
    setContourMode((prev) => {
      if (!prev || prev.params?.contour || !Array.isArray(prev.params?.points)) return prev;
      const points = (prev.params?.points || []).map(
        (pt, i) => (i === index ? [uv[0], uv[1]] : pt),
      );
      const next = { ...prev, params: { ...prev.params, points } };
      return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
    });
  }, []);

  /** Promoted contour: seeds on release. The script changes only if a block exists. */
  const commitPromotedPointDrag = useCallback((spec, snap = null, pointId = null) => {
    const prev = contourModeRef.current;
    if (!prev || !spec) return;
    let storedSpec = spec;
    if (snap && pointId) {
      const applied = applyContourSnap(spec, pointId, snap);
      if (applied?.spec) storedSpec = applied.spec;
    }
    const next = applyDraggedContour(prev, storedSpec);
    const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const plan = planContourDragRelease({
      buffer: buf,
      entry: next.entry,
      moved: true,
      contourId: next.contourId,
    });
    if (!plan.write) {
      setContourMode(next);
      return;
    }
    const stored = saveContourBlock(next);
    setContourMode(stored || next);
  }, [getHelperBuffer, saveContourBlock]);

  const showDraggedContour = useCallback((plane, spec) => {
    // The drag does not go through the contour effect until pointer-up.
    // Previews and the old highlight would otherwise sit on the pre-drag shape.
    clearStaleSolveOverlays({ keepSketch: true });
    (spec?.points || []).forEach((point, index) => {
      if (!point?.at) return;
      movePolylineHandle(index, planeUvToWorld(point.at, plane));
    });
    const paint = contourPaintModel(spec);
    if (paint) paintContourStatusWire(plane, paint.segments);
  }, [movePolylineHandle, paintContourStatusWire, clearStaleSolveOverlays]);

  const removePolylineDot = useCallback((pointId) => {
    const state = contourModeRef.current;
    if (!state || state.gesture || !pointId) return;
    const plan = planPolylinePointRemoval(state, pointId);
    if (plan.action === 'none') return;
    if (plan.action === 'delete-shape') {
      if (plan.contourId) {
        requestShapeDelete(plan.contourId);
        return;
      }
      setContourMode(plan.state);
      return;
    }
    const next = plan.state;
    if (next?.params?.contour && next.contourId && !contourEditRef.current) {
      const stored = saveContourBlock(next);
      setContourMode(stored || next);
      return;
    }
    setContourMode(next);
  }, [requestShapeDelete, saveContourBlock]);

  const notePolylineDotTap = useCallback((pointId, source = 'mouse') => {
    const state = contourModeRef.current;
    if (!state || state.gesture || !pointId) return false;
    const handle = sketchHandles(state).find((item) => item.id === pointId);
    if (!isPolylineDot(state, handle)) return false;
    const now = Date.now();
    const prev = polylineDotTapRef.current;
    // A finger-up notes the touch, then the synthetic mouse arrives. That
    // second note is the same tap. Two mouseups are a double-tap.
    if (
      prev?.source === 'touch'
      && source === 'mouse'
      && prev.id === pointId
      && now - prev.at <= POLYLINE_SAME_TAP_MS
    ) return false;
    polylineDotTapRef.current = { id: pointId, at: now, source };
    if (!isPolylineDoubleTap(prev, pointId, now, source)) return false;
    polylineDotTapRef.current = null;
    removePolylineDot(pointId);
    return true;
  }, [removePolylineDot]);

  const endPolylinePointDrag = useCallback((event) => {
    const drag = polylinePointDragRef.current;
    if (!drag) return;
    polylinePointDragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    if (drag.shape && !drag.moved && drag.previewBase && xsPreviewRef.current) {
      xsPreviewRef.current.position.copy(drag.previewBase);
    }
    if (!drag.frozen && drag.moved) {
      if (drag.shape && drag.lastSpec) commitPromotedPointDrag(drag.lastSpec);
      else if (drag.shape && drag.paramPatch) commitSketchParam(drag.paramPatch);
      else if (drag.pointId && drag.lastSpec) commitPromotedPointDrag(drag.lastSpec, drag.snap, drag.pointId);
      else if (drag.snap && drag.kind === 'polyline' && drag.lastUv) {
        const points = drag.baseParams?.points || [];
        const spec = promoteSnappedPolyline(points, drag.index, drag.lastUv, drag.snap);
        commitPromotedPointDrag(spec);
      } else if (drag.paramPatch) commitSketchParam(drag.paramPatch);
      else if (drag.lastUv) commitPolylinePointDrag(drag.lastUv, drag.index);
    } else if (!drag.moved && drag.pointId && (drag.touch || drag.cursorTap)) {
      notePolylineDotTap(drag.pointId, drag.touch ? 'touch' : 'mouse');
    }
    publishContourSnap(null);
    // A finger has no hover after lift. A mouse cursor still on the handle keeps the grab.
    if (drag.touch) sketchHoverMuteRef.current = performance.now() + 700;
    const stillOver = !drag.touch && event
      && pickPolylinePointAtClient(event.clientX, event.clientY) === drag.index;
    setPolylinePointHover(stillOver ? drag.index : -1);
    paintPolylineHandleStates();
  }, [commitPolylinePointDrag, commitPromotedPointDrag, commitSketchParam,
    notePolylineDotTap, pickPolylinePointAtClient, setPolylinePointHover, paintPolylineHandleStates,
    publishContourSnap]);

  /**
   * Handle mouse move - detect if dragging
   */
  const handleMouseMove = useCallback((event) => {
    // Live point drag owns the pointer: move the handle, skip camera/pick work.
    const drag = polylinePointDragRef.current;
    if (drag) {
      // Touch is driven by pointermove. The synthetic mousemove must not solve twice.
      if (drag.touch && event.type === 'mousemove') return;
      // A tap wobbles. That is still a tap, so a double-tap can remove the dot.
      if ((drag.touch || drag.cursorTap) && drag.down) {
        const slop = Math.hypot(event.clientX - drag.down.x, event.clientY - drag.down.y);
        if (slop <= 6) return;
      }
      if (!drag.frozen && drag.shape) {
        const hit = polylinePlanePointAtClient(event.clientX, event.clientY, drag.plane);
        if (hit && drag.originUv) {
          const du = hit.uv[0] - drag.originUv[0];
          const dv = hit.uv[1] - drag.originUv[1];
          if (drag.baseSpec) {
            const result = dragContourShape(drag.baseSpec, [du, dv]);
            if (result.moved && result.spec) {
              drag.moved = true;
              drag.lastSpec = result.spec;
              showDraggedContour(drag.plane, result.spec);
            }
          } else {
            const shaped = dragSketchShape(drag.kind, drag.baseParams, [du, dv]);
            if (shaped?.moved) {
              drag.moved = true;
              drag.paramPatch = shaped.params;
              shaped.handles.forEach((handle, i) => {
                movePolylineHandle(i, planeUvToWorld(handle.at, drag.plane));
              });
              offsetSketchPreview(drag, du, dv);
            } else if (drag.previewBase && xsPreviewRef.current) {
              xsPreviewRef.current.position.copy(drag.previewBase);
            }
          }
        }
      } else if (!drag.frozen) {
        const hit = polylinePlanePointAtClient(event.clientX, event.clientY, drag.plane);
        const excludePointId = drag.pointId || (drag.kind === 'polyline' ? `p${drag.index}` : null);
        const snap = (drag.pointId || drag.kind === 'polyline')
          ? readContourSnap(event.clientX, event.clientY, { excludePointId })
          : null;
        drag.snap = snap;
        publishContourSnap(snap);
        const uv = snap?.uv || hit?.uv;
        if (uv && drag.pointId && drag.lastSpec) {
          const result = dragContourPoint(drag.lastSpec, drag.pointId, uv);
          if (result.moved && result.spec) {
            drag.moved = true;
            drag.lastSpec = result.spec;
            drag.lastUv = result.uv;
            showDraggedContour(drag.plane, result.spec);
          }
        } else if (hit && (drag.kind === 'rectangle' || drag.kind === 'circle' || drag.kind === 'polygon')) {
          const shaped = dragSketchParam(drag.kind, drag.baseParams, drag.index, hit.uv);
          if (shaped) {
            drag.moved = true;
            drag.paramPatch = shaped.params;
            shaped.handles.forEach((handle, i) => {
              movePolylineHandle(i, planeUvToWorld(handle.at, drag.plane));
            });
          }
        } else if (uv) {
          drag.moved = true;
          drag.lastUv = uv;
          const world = snap
            ? planeUvToWorld(uv, drag.plane)
            : hit.world;
          movePolylineHandle(drag.index, world);
        }
      }
      return;
    }

    if (mouseDownPosRef.current) {
      const dx = event.clientX - mouseDownPosRef.current.x;
      const dy = event.clientY - mouseDownPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
      }
    }

    // Optional Edge-mode pre-highlight: teach the fat hit target (nearest edge).
    if (
      pickModeRef.current === 'edge'
      && !isDraggingRef.current
      && canvasRef.current
      && cameraRef.current
      && resultRef.current
    ) {
      const edge = pickEdgeAtClient(event.clientX, event.clientY, { occlude: false });
      const selectedKeys = new Set(
        (Array.isArray(selectedEdges) ? selectedEdges : []).map((e) => selectionEdgeKey(e)),
      );
      highlightHoverEdge(edge, selectedKeys);
    } else if (pickModeRef.current !== 'edge') {
      clearEdgeHover();
    }

    // Teach the grab: handles grow and warm as the cursor reaches them.
    // The mouse events a browser synthesizes after touch must not re-lock orbit.
    // A hover keeps showing the snap ring. isDragging stays set after an orbit
    // until the button comes up, and that must not hide the ring.
    const snapHover = !event.buttons && !polylinePointDragRef.current;
    if ((snapHover || !isDraggingRef.current) && contourSnapAllowed(contourModeRef.current) && contourModeRef.current?.tool === 'polyline') {
      publishContourSnap(readContourSnap(event.clientX, event.clientY));
    } else if (!polylinePointDragRef.current) {
      publishContourSnap(null);
    }
    if (performance.now() < sketchHoverMuteRef.current) {
      if (polylinePointHoverRef.current !== -1) setPolylinePointHover(-1);
    } else if (!contourModeRef.current?.gesture && sketchHandles(contourModeRef.current).length && pickModeRef.current !== 'edge') {
      setPolylinePointHover(pickPolylinePointAtClient(event.clientX, event.clientY));
    } else if (polylinePointHoverRef.current !== -1) {
      setPolylinePointHover(-1);
    }
  }, [selectedEdges, highlightHoverEdge, clearEdgeHover, pickEdgeAtClient,
    polylinePlanePointAtClient, movePolylineHandle, pickPolylinePointAtClient,
    setPolylinePointHover, showDraggedContour, readContourSnap, publishContourSnap,
    offsetSketchPreview]);

  /**
   * Handle mouse up - process click only if not dragging
   */
  const collectPartHits = useCallback(() => {
    const hits = [];
    const pushMesh = (mesh, partId) => {
      if (!mesh?.geometry?.attributes?.position?.count || partId == null || partId === '') return;
      const found = raycasterRef.current.intersectObject(mesh, false);
      for (const hit of found) {
        hits.push({
          partId: String(partId),
          distance: hit.distance,
          point: [hit.point.x, hit.point.y, hit.point.z],
          faceIndex: hit.faceIndex,
          face: hit.face,
          mesh,
        });
      }
    };
    if (activePartIdRef.current) pushMesh(resultRef.current, activePartIdRef.current);
    for (const [id, mesh] of assemblyExtrasRef.current) {
      pushMesh(mesh, mesh?.userData?.assemblyPartId || id);
    }
    return hits;
  }, []);

  const retargetPickPart = useCallback((partId) => {
    if (partId == null || partId === '') return false;
    cadBodyStickyRef.current = false;
    if (String(partId) === String(activePartIdRef.current || '')) return true;
    onPickRetargetRef.current?.({ partId: String(partId), kind: 'face', syncScript: false });
    return String(activePartIdRef.current || '') === String(partId);
  }, []);

  const showPartChoice = useCallback((choice, event, kind) => {
    if (!choice?.ambiguous) {
      setPartChoice(null);
      ambiguousPickRef.current = null;
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect ? event.clientX - rect.left : event.clientX;
    const top = rect ? event.clientY - rect.top : event.clientY;
    ambiguousPickRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      kind,
      additive: !!(event.shiftKey || event.metaKey || event.ctrlKey),
    };
    setPartChoice({
      choices: choice.choices.map((item) => ({
        partId: item.partId,
        name: partLabelsRef.current?.[item.partId] || item.partId,
      })),
      left,
      top,
      kind,
    });
  }, []);

  const dismissPartChoice = useCallback(() => {
    setPartChoice(null);
    ambiguousPickRef.current = null;
  }, []);

  const clearGeomSelection = useCallback(() => {
    cadBodyStickyRef.current = false;
    clearHighlight();
    setSelectedFace(null);
    onFaceSelected?.(null);
    clearEdgeHighlight();
    clearEdgeHover();
    setSelectedEdges([]);
  }, [clearHighlight, clearEdgeHighlight, clearEdgeHover, onFaceSelected]);

  /** A tap on a line or arc, with no gesture open, selects that chip. */
  const selectContourStrokeAtClient = useCallback((clientX, clientY) => {
    const state = contourModeRef.current;
    if (!state?.params?.contour || state.gesture || contourPlaneOpenRef.current) return false;
    const hit = pickContourAtClient(clientX, clientY);
    if (!hit || (hit.kind !== 'line' && hit.kind !== 'arc')) return false;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickCountRef.current = 0;
    pendingClickDataRef.current = null;
    const chip = state.params.contour.polyline && hit.kind === 'line'
      ? { id: 'polyline', kind: 'polyline', label: 'Polyline' }
      : { id: hit.id, kind: hit.kind, label: hit.label };
    setContourMode((prev) => (prev ? selectSketchChip(prev, chip) : prev));
    return true;
  }, [pickContourAtClient]);

  const handleMouseUp = useCallback((event) => {
    if (polylinePointDragRef.current) {
      const shapeTap = !!(polylinePointDragRef.current.shape && !polylinePointDragRef.current.moved);
      endPolylinePointDrag(event);
      // A shape grab that did not move is still a tap, so a line chip can open.
      if (!shapeTap) return;
    }
    // A touch drag already released on pointerup. Swallow the synthetic click.
    if (polylineSuppressClickRef.current) {
      polylineSuppressClickRef.current = false;
      isDraggingRef.current = false;
      mouseDownPosRef.current = null;
      return;
    }
    // Only the left button places points / picks faces; the right button is
    // the point-move gesture and must never drop a stray point on release.
    if (event.button !== 0) {
      mouseDownPosRef.current = null;
      return;
    }
    // Slice Mobile C: long-press already opened the sheet — suppress the click.
    if (featureLongPressFiredRef.current) {
      featureLongPressFiredRef.current = false;
      isDraggingRef.current = false;
      return;
    }
    // A mouseup that did not start on the canvas is not a tap. Releasing the
    // rollback bar (its triangle sits over this canvas) must keep the part.
    // Only a press that begins and ends on empty space clears the selection.
    if (!mouseDownPosRef.current && !isDraggingRef.current) return;
    // A finger tap wobbles a few pixels. That is still a sketch pick.
    // A real orbit moves further and must not also select.
    if (isDraggingRef.current) {
      const down = mouseDownPosRef.current;
      const moved = down
        ? Math.hypot(event.clientX - down.x, event.clientY - down.y)
        : Infinity;
      const sketchTap = !!contourModeRef.current?.gesture && moved <= SKETCH_HIT_PX;
      isDraggingRef.current = false;
      mouseDownPosRef.current = null;
      if (!sketchTap) return;
    }
    mouseDownPosRef.current = null;
    
    if (!canvasRef.current || !cameraRef.current) return;
    // Face/edge pick still needs a part mesh; polyline workplane taps and
    // sheet metal (its own overlay) do not.
    if (!resultRef.current && contourModeRef.current?.tool !== 'polyline' && !sheetMetalModeRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    mouseRef.current.x = (px / rect.width) * 2 - 1;
    mouseRef.current.y = -(py / rect.height) * 2 + 1;

    // SCS sheet metal owns the canvas: taps hit only its overlay (planes,
    // edge handles, features). A miss does nothing. The centres sketch
    // owns the canvas while it is open.
    if (sheetMetalModeRef.current && !sheetMetalModeRef.current.holeSketch) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      const overlay = sheetMetalOverlayRef.current;
      if (!overlay) return;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const pick = sheetPickFromHits(raycasterRef.current.intersectObject(overlay, true));
      if (!pick) return;
      if (pick.point) {
        const o = overlay.position;
        pick.point = [pick.point[0] - o.x, pick.point[1] - o.y, pick.point[2] - o.z];
      }
      sheetMetalTapRef.current?.(pick);
      return;
    }

    // Dimension, Arc, and Constrain select the sketch, not the solid under it.
    if (contourModeRef.current?.gesture) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      const hit = pickContourAtClient(event.clientX, event.clientY);
      if (hit) setContourMode((prev) => (prev ? applyContourPick(prev, hit) : prev));
      return;
    }

    // Polyline owns the tap before a line chip can. A segment inserts a
    // point. A point is a double-tap or a drag, never a stacked point.
    if (contourModeRef.current?.tool === 'polyline' && pickModeRef.current !== 'edge') {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      const pointIndex = pickPolylinePointAtClient(event.clientX, event.clientY);
      if (pointIndex >= 0) {
        const pointId = sketchHandles(contourModeRef.current)[pointIndex]?.id;
        if (pointId) notePolylineDotTap(pointId);
        return;
      }
      const plane = selectedLoftDrawFrame(contourModeRef.current)
        || contourWorkplane(contourModeRef.current, modelBoundsRef.current);
      const snap = readContourSnap(event.clientX, event.clientY);
      const hit = polylinePlanePointAtClient(event.clientX, event.clientY, plane);
      const segment = pickSketchLineAtClient(event.clientX, event.clientY)
        || segmentForSnap(contourModeRef.current, snap);
      if (segment && (hit || snap)) {
        publishContourSnap(null);
        setContourMode((prev) => (
          prev ? applyPolylineSegmentInsert(prev, segment, hit?.uv || snap?.uv, snap) : prev
        ));
        return;
      }
      if (!hit && !snap) {
        showContourToast('Could not hit the workplane — orbit so the plane faces the camera.');
        return;
      }
      const uv = snap?.uv || hit.uv;
      publishContourSnap(null);
      setContourMode((prev) => {
        if (!prev || prev.tool !== 'polyline') return prev;
        if (prev.params?.contour) {
          if (snap) {
            const placed = placeSnappedContourPoint(prev.params.contour, uv, snap);
            const applied = placed.pointId
              ? applyContourSnap(placed.spec, placed.pointId, snap)
              : { spec: placed.spec };
            return applyDraggedContour(prev, applied.spec || placed.spec);
          }
          const spec = insertContourPoint(prev.params.contour, uv);
          return applyDraggedContour(prev, spec);
        }
        if (snap) {
          try {
            const spec = promoteDrawnSnap(prev.params?.points || [], uv, snap);
            return applyDraggedContour(prev, spec);
          } catch {
            const points = [...(prev.params?.points || []), [uv[0], uv[1]]];
            const next = { ...prev, params: { ...prev.params, points } };
            return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
          }
        }
        const points = [...(prev.params?.points || []), [uv[0], uv[1]]];
        const next = { ...prev, params: { ...prev.params, points } };
        return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
      });
      return;
    }

    // A tap on a line or arc, with no gesture open, selects that chip.
    // A polyline segment selects the one polyline chip.
    if (selectContourStrokeAtClient(event.clientX, event.clientY)) return;

    // An unpromoted polyline segment, in any other tool, selects that one chip.
    if (
      contourModeRef.current
      && contourModeRef.current.tool !== 'polyline'
      && !contourModeRef.current.gesture
      && !contourPlaneOpenRef.current
      && !contourModeRef.current.params?.contour
      && Array.isArray(contourModeRef.current.params?.points)
      && contourModeRef.current.params.points.length >= 2
      && pickSketchLineAtClient(event.clientX, event.clientY)
    ) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      setContourMode((prev) => (
        prev ? selectSketchChip(prev, { id: 'shape', kind: 'polyline', label: 'Polyline' }) : prev
      ));
      return;
    }

    // A handle on a circle, rectangle, polygon, or arc is a grab, not a face pick.
    // The plane card is for choosing a plane. A profile rim sits on the face,
    // and swallowing that tap kept the face from being selected. An empty
    // Cursor sketch has no rim, so that same tap selects the face.
    if (
      contourModeRef.current
      && contourModeRef.current.tool !== 'polyline'
      && !contourModeRef.current.gesture
      && !contourPlaneOpenRef.current
      && pickModeRef.current !== 'edge'
      && sketchHandles(contourModeRef.current).length
      && pickPolylinePointAtClient(event.clientX, event.clientY) >= 0
    ) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      return;
    }

    if (!resultRef.current) return;

    // Measure owns the tap: point, edge, face, or a second tap for the part.
    // Picks stay until Clear, a second tap on the same one, or X.
    if (measurementEnabled) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      dismissPartChoice();
      applyMeasurePointer(event);
      return;
    }

    // Slice 12 hotfix: Edge mode short-circuits face selection entirely.
    // Screen-space pick with finger slop — no mesh-face hit required.
    // A hit on another part retargets first so the edge graph is that part's.
    // Paint keeps the face-graph pick, even if the right rail is on edges.
    if (pickModeRef.current === 'edge' && !paintModeRef.current && !feaPickRef.current) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const choice = resolvePartPick(collectPartHits());
      showPartChoice(choice, event, 'edge');
      if (choice.partId && !retargetPickPart(choice.partId)) {
        clearEdgeHover();
        return;
      }

      const slop = resolveEdgePickSlopPx();
      const edge = pickEdgeAtClient(event.clientX, event.clientY);
      if (!edge) {
        console.log('[Edge Selection] No feature edge within', slop, 'px');
        clearEdgeHover();
        if (!choice.partId && emptyClickClearsSelection({ featureSession: featureSessionRef.current })) {
          clearGeomSelection();
          onCadEmptyClickRef.current?.();
        }
        return;
      }
      clearEdgeHover();
      if (jointPickingRef.current && edge.radius > 0 && edge.dir && edge.mid) {
        onJointPickRef.current?.({
          partId: activePartIdRef.current,
          kind: 'axis',
          planar: false,
          axis: true,
          key: { at: edge.mid.slice(), dir: edge.dir.slice(), radius: edge.radius },
        });
      }
      setSelectedEdges((prev) => toggleEdgeSelectionPropagated(prev, edge, {
        propagate: tangentPropRef.current,
        featureEdges: featureEdgesRef.current,
      }));
      // Clear face selection so modes do not fight
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
      if (shouldSyncScript({ kind: 'edge', featureSession: featureSessionRef.current })) {
        onPickRetargetRef.current?.({
          partId: activePartIdRef.current,
          kind: 'edge',
          syncScript: true,
        });
      }
      return;
    }

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const ray = raycasterRef.current.ray;
    const origin = [ray.origin.x, ray.origin.y, ray.origin.z];
    const dir = [ray.direction.x, ray.direction.y, ray.direction.z];
    const camDist = Math.hypot(ray.origin.x, ray.origin.y, ray.origin.z) || 80;
    // Intersect pieces are the leftover solids, not the original triangles.
    // Raycast that clone first. A miss keeps the hide list.
    if (booleanModeRef.current?.pick === 'pieces') {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      const group = booleanPiecesPreviewRef.current;
      const pieceHits = group
        ? raycasterRef.current.intersectObject(group, true)
        : [];
      if (pieceHits.length) {
        const at = pieceHits[0].object.userData?.booleanPieceAt;
        const tap = applyBooleanTap(booleanModeRef.current, {
          at,
          partId: activePartIdRef.current,
        });
        if (tap.toast) showShellToast(tap.toast);
        commitBooleanState(tap.state);
        return;
      }
      // No piece under the cursor. Fall through so another part can be picked.
    }
    // Cut, Boolean, and Paint own the canvas: a saved contour under the cursor
    // must not eat the tap (same as a construction plane sitting on the cut).
    if (!moveFaceModeRef.current && !deleteFaceModeRef.current && !cutModeRef.current && !booleanModeRef.current && !paintModeRef.current && !feaPickRef.current && showContoursRef.current && !moveModeRef.current && !rotateModeRef.current && !mirrorModeRef.current && contourModeRef.current?.tool !== 'polyline') {
      // Saved contours are in the editor part's frame.
      const hitC = pickContourByRay(
        toPartLocal(origin, savedContourOffsetRef.current),
        directionToPartLocal(dir, savedContourOffsetRef.current),
        savedContoursRef.current,
        savedContourHostPlaneRef.current,
        Math.max(1.5, camDist * 0.02),
      );
      if (hitC) {
        setArmedContourId(hitC.id);
        setContourMode((prev) => {
          if (!prev) return prev;
          if (isLoftEntry(prev.entry) && prev.loft?.picking === 'face' && hitC.plane) {
            return setLoftStationPlane(prev, hitC.plane, {
              kind: 'contour',
              ref: hitC.id,
              label: hitC.label || hitC.name || 'Sketch',
            });
          }
          return applySavedContour(prev, hitC);
        });
        return;
      }
    }
    // Only the editor part's planes are pickable: another part's plane is in
    // that part's frame and would edit the wrong script.
    const planeHitsAll = (showPlanesRef.current && constructionPlaneRef.current)
      ? raycasterRef.current.intersectObject(constructionPlaneRef.current, true)
      : [];
    const planeHits = jointPickingRef.current
      ? planeHitsAll
      : planeHitsAll.filter((hit) => (overlayHitPartId(hit.object) ?? null) === (editorOverlayPartIdRef.current ?? null));
    const partChoiceHit = resolvePartPick(collectPartHits());
    const planeD = planeHits[0]?.distance ?? Infinity;
    const solidD = partChoiceHit.hit?.distance ?? Infinity;
    // Mirror picks the plane the copy is reflected across: a user workplane
    // or XY / YZ / ZX. A plane quad sits in front of the body from the
    // default camera, and taking that hit ate the double-click that selects
    // the body. The plane is the pick only when the ray misses the solid.
    // A click on the solid stays a body or face pick, the same as Move.
    if (mirrorModeRef.current && planeHits.length && !(partChoiceHit.hit && Number.isFinite(solidD))) {
      const ud = planeHits[0].object.userData?.plane
        ? planeHits[0].object.userData
        : planeHits[0].object.parent?.userData;
      if (ud?.plane) {
        const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
        const picked = mirrorPlaneFromHit(ud, buf);
        if (picked) {
          if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
          }
          clickCountRef.current = 0;
          pendingClickDataRef.current = null;
          const next = picked.planeSource === 'workplane'
            ? setMirrorWorkplane(mirrorModeRef.current, picked.workplane)
            : setMirrorNamedPlane(mirrorModeRef.current, picked.planeSource);
          commitMirrorState(next);
          return;
        }
      }
    }
    // Cut taps a body or a piece. A construction plane that sits on the cut
    // (the XY plane through a centered part) must not swallow that click.
    if (!cutModeRef.current && !booleanModeRef.current && !paintModeRef.current && !feaPickRef.current && planeHits.length && !moveModeRef.current && !rotateModeRef.current && !mirrorModeRef.current && !moveFaceModeRef.current && !deleteFaceModeRef.current && planeD <= solidD + 0.5) {
      const ud = planeHits[0].object.userData?.plane
        ? planeHits[0].object.userData
        : planeHits[0].object.parent?.userData;
      if (ud?.plane) {
        if (jointPickingRef.current) {
          const partId = ud.partId || overlayHitPartId(planeHits[0].object);
          const key = planeReferenceKey(ud.jointPlaneId || ud.planeId, ud.plane);
          if (partId && key) {
            onJointPickRef.current?.({
              partId,
              kind: 'plane',
              planar: true,
              axis: false,
              key,
            });
          }
          return;
        }
        setSelectedPlaneId(ud.planeId || null);
        setContourMode((prev) => {
          if (!prev) return prev;
          if (isLoftEntry(prev.entry) && prev.loft?.picking === 'face') {
            return setLoftStationPlane(prev, ud.plane, {
              kind: 'workplane',
              ref: ud.planeId || null,
              label: 'Workplane',
            });
          }
          return applyContourPlaneEdit(prev, {
            preset: 'workplane',
            base: ud.plane,
            angles: { x: 0, y: 0, z: 0 },
          });
        });
        releaseWorkplaneFaceRef.current();
        return;
      }
    }
    // A probe marker sits on the surface. A tap on it removes that probe
    // and must not fall through into a new sample or a setup face pick.
    if (feaPickRef.current && feaProbeGroupRef.current) {
      const markerHits = raycasterRef.current.intersectObject(feaProbeGroupRef.current, true);
      const marker = markerHits.find((hit) => hit.object?.userData?.probeId != null);
      if (marker && marker.distance <= solidD + 1e-4) {
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        clickCountRef.current = 0;
        pendingClickDataRef.current = null;
        try {
          feaPickRef.current({ removeProbeId: marker.object.userData.probeId });
        } catch (err) {
          console.error('[FEA] ignored a bad pick', err);
        }
        return;
      }
    }
    // Handle click on empty space (only if not dragging)
    if (!partChoiceHit.partId) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      dismissPartChoice();

      if (measurementEnabled) {
        console.log("[Measurement] Keeping face selected for measurement");
      } else if (!emptyClickClearsSelection({ featureSession: featureSessionRef.current })) {
        // Preserve shell face selection — stray taps must not wipe the set.
        // Preserve draft face selection — stray taps must not wipe the set.
        // Preserve cut body selection — stray taps must not wipe the set.
        // A feature session keeps its picks. Hiding that part does too.
      } else {
        clearGeomSelection();
        onCadEmptyClickRef.current?.();
      }
      return;
    }

    if (feaPickRef.current && partChoiceHit.partId) {
      let action = 'pick';
      try {
        action = feaTapActionRef.current
          ? feaTapActionRef.current(partChoiceHit.partId)
          : (String(partChoiceHit.partId) === String(activePartIdRef.current || '') ? 'pick' : 'ignore');
      } catch (err) {
        console.error('[FEA] ignored a bad pick', err);
        return;
      }
      if (action === 'ignore' || action === 'add-part') {
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        clickCountRef.current = 0;
        pendingClickDataRef.current = null;
        if (action === 'add-part') {
          try {
            feaPickRef.current({ addPartId: partChoiceHit.partId });
          } catch (err) {
            console.error('[FEA] ignored a bad pick', err);
          }
        }
        return;
      }
    }

    try {
    showPartChoice(partChoiceHit, event, 'face');
    if (!retargetPickPart(partChoiceHit.partId)) return;
    const again = resultRef.current?.geometry?.attributes?.position
      ? raycasterRef.current.intersectObject(resultRef.current, false)
      : [];
    if (!again.length) {
      if (emptyClickClearsSelection({ featureSession: featureSessionRef.current }) && !measurementEnabled) {
        clearGeomSelection();
        onCadEmptyClickRef.current?.();
      }
      return;
    }

    // Capture intersection data on the part that now owns the pick mesh.
    const intersection = again[0];
    const geometry = resultRef.current.geometry;
    const clickedFace = intersection.face;
    if (!clickedFace || !geometry?.attributes?.position || !geometry.index) return;
    const seedFaceIndex = intersection.faceIndex;
    const positions = geometry.attributes.position;
    const index = geometry.index.array;
    
    const localHit = intersection.point.clone();
    resultRef.current.worldToLocal(localHit);
    const faceIds = faceIDsRef.current;
    const clickData = {
      clickedFace,
      seedFaceIndex,
      geometry,
      positions,
      index,
      faceNormal: [clickedFace.normal.x, clickedFace.normal.y, clickedFace.normal.z],
      hitPoint: [intersection.point.x, intersection.point.y, intersection.point.z],
      localPoint: [localHit.x, localHit.y, localHit.z],
      faceId: faceIds && seedFaceIndex != null ? Number(faceIds[seedFaceIndex]) : null,
      // Shift (or ⌘/Ctrl) adds this face to the pick instead of replacing it.
      additive: !!(event.shiftKey || event.metaKey || event.ctrlKey),
      partId: activePartIdRef.current,
    };

    // Paint applies on this mouseup. One tap is one face. A second tap on
    // that face inside the double-tap window upgrades it to the body. The
    // delayed processClick path must not also run, or the tap is counted twice.
    if (feaPickRef.current) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      feaPickRef.current(clickData);
      return;
    }

    if (paintModeRef.current) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      applyLivePaintTapRef.current(clickData);
      return;
    }

    // Multi-click detection
    const now = Date.now();
    if (now - lastClickTimeRef.current > MULTI_CLICK_DELAY) {
      clickCountRef.current = 0;
    }
    
    clickCountRef.current++;
    lastClickTimeRef.current = now;
    pendingClickDataRef.current = clickData;
    
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    
    // Process click after delay
    clickTimerRef.current = setTimeout(() => {
      processClick();
    }, MULTI_CLICK_DELAY);
    } catch (err) {
      if (feaPickRef.current) {
        console.error('[FEA] ignored a bad pick', err);
        return;
      }
      throw err;
    }

  }, [onFaceSelected, measurementEnabled, clearHighlight, clearEdgeHover, clearEdgeHighlight,
    pickEdgeAtClient, endPolylinePointDrag, pickPolylinePointAtClient, polylinePlanePointAtClient,
    pickContourAtClient, selectContourStrokeAtClient, commitBooleanState,
    collectPartHits, retargetPickPart, showPartChoice, dismissPartChoice, clearGeomSelection,
    applyMeasurePointer]);


  /**
   * Commit a shell/draft face list: highlight every selected face and expose
   * the group on selectedFace. clearHighlight() drops the ref, so restore it
   * after. An empty list clears the highlight — used by Undo-to-zero and Clear.
   */
  const publishFacePicks = useCallback((picks, geometry, positions, index, faceData = null) => {
    const list = Array.isArray(picks) ? picks : [];
    const lite = list.map((f) => ({ center: f.center, normal: f.normal }));
    const shown = [...new Set(list.flatMap((f) => f.indices || []))];
    clearHighlight();
    facePickGroupRef.current = list.length ? { picks: list } : null;
    if (!list.length) {
      setSelectedFace(null);
      onFaceSelected?.(null);
      setShellMode((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, lastFace: null };
        shellModeRef.current = updated;
        return updated;
      });
      return;
    }
    const last = list[list.length - 1];
    const sameTap = faceData
      && Array.isArray(faceData.center)
      && faceData.center.length === 3
      && faceData.center.every((v, i) => Math.abs(v - last.center[i]) < 1e-6);
    const base = sameTap
      ? faceData
      : {
        center: last.center,
        normal: last.normal,
        area: Number(last.area) > 0 ? Number(last.area) : 0,
        indices: Array.isArray(last.indices) ? last.indices.slice() : undefined,
        triangleCount: (last.indices || []).length,
        selectionMode: 'coplanar',
      };
    const payload = list.length > 1 ? { ...base, group: lite } : { ...base };
    // Face identity: the stamped face that owns the pick names it, so the
    // composer can resolve the pick by name instead of by normal and centre.
    const pickTris = Array.isArray(base.indices) && base.indices.length ? base.indices : shown;
    const named = geometry ? stampedNameForTriangles(stampedFaceTable(geometry, faceIDsRef.current), pickTris) : null;
    if (named) {
      payload.name = named.name;
      payload.feature = named.feature;
      payload.role = named.role;
      if (named.names) payload.names = named.names;
    }
    const classified = classifySelectedFace(payload) || payload;
    const span = faceSliderFrame(faceData?.vertices, classified.normal, classified.center);
    if (span) classified.span = span;
    setSelectedFace(classified);
    onFaceSelected?.(classified);
    if (pullReferenceRef.current.mode === 'face' && Array.isArray(classified?.normal)) {
      applySharedPullRef.current({ mode: 'face', pull: classified.normal });
    }
    if (jointPickingRef.current && list.length === 1) {
      const pos = positions?.array || null;
      const idx = index?.array || index;
      const axis = (pos && idx && last.indices) ? fitJointAxis(pos, idx, last.indices) : null;
      const area = Number(classified.area) || 0;
      let described = null;
      if (axis) {
        described = { kind: 'axis', planar: false, axis: true, key: axis };
      } else if (classified.type === 'planar' && area > 0) {
        described = {
          kind: 'face',
          planar: true,
          axis: false,
          key: { at: classified.center.slice(), n: classified.normal.slice(), area },
        };
      }
      if (described) {
        onJointPickRef.current?.({ partId: activePartIdRef.current, ...described });
        if (positions && index && shown.length) {
          paintJointHighlightRef.current(
            activePartIdRef.current,
            shown,
            positions,
            index,
            classified.center,
          );
        }
      }
    }
    setShellMode((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, lastFace: classified };
      shellModeRef.current = updated;
      return updated;
    });
    if (geometry && positions && index && shown.length) {
      highlightFace(shown, geometry, positions, index, 0xffff00);
    }
  }, [clearHighlight, highlightFace, onFaceSelected, commitMirrorState, getHelperBuffer]);

  /**
   * Process the pending click based on click count
   * This is called after the multi-click delay has passed
   */
  const processClick = useCallback(() => {
    const clickData = pendingClickDataRef.current;
    if (!clickData) return;

    if (paintModeRef.current || measurementEnabledRef.current) {
      clickCountRef.current = 0;
      clickTimerRef.current = null;
      pendingClickDataRef.current = null;
      return;
    }

    const { clickedFace, seedFaceIndex, geometry, positions, index, faceNormal, additive, hitPoint } = clickData;
    const clickCount = clickCountRef.current;
    const legacyTapNow = !!(
      shellModeRef.current || draftModeRef.current || cutModeRef.current
      || booleanModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current
    );
    const pickKind = (!legacyTapNow && clickCount >= 2) ? 'body' : 'face';
    // A face tap on the part already under the pick mesh still selects it.
    // Joint picking (the create card) is the only path that does not.
    onPickRetargetRef.current?.({
      partId: clickData.partId || activePartIdRef.current,
      kind: pickKind,
      syncScript: shouldSyncScript({ kind: pickKind, featureSession: featureSessionRef.current }),
    });

    if (booleanModeRef.current && booleanModeRef.current.pick !== 'pieces') {
      const sectioned = !!resultRef.current?.userData?.crossSectionTrimmedMeshData;
      let owned = null;
      let point = hitPoint;
      let basePositions = null;
      let baseIndex = null;
      if (sectioned && resultRef.current && Array.isArray(hitPoint)) {
        owned = geometryFromMeshData(cachedMeshDataRef.current);
        basePositions = owned.attributes?.position;
        baseIndex = owned.index?.array;
        const local = resultRef.current.worldToLocal(new Vector3(hitPoint[0], hitPoint[1], hitPoint[2]));
        point = [local.x, local.y, local.z];
      }
      const tap = applyBooleanTap(booleanModeRef.current, {
        triangle: seedFaceIndex,
        point,
        sectioned,
        positions: sectioned ? null : positions,
        index: sectioned ? null : index,
        basePositions,
        baseIndex,
        partId: activePartIdRef.current,
      });
      owned?.dispose?.();
      clickCountRef.current = 0;
      clickTimerRef.current = null;
      pendingClickDataRef.current = null;
      if (tap.toast) showShellToast(tap.toast);
      commitBooleanState(tap.state);
      return;
    }
    
    // Reset click tracking
    clickCountRef.current = 0;
    clickTimerRef.current = null;
    pendingClickDataRef.current = null;
    
    // Shell, Draft, and Cut keep tap-to-add / tap-to-remove. A double click
    // there must stay the old tolerance walk — not the owning body — so
    // confirm still writes the face that was tapped.
    const legacyTap = !!(shellModeRef.current || draftModeRef.current || cutModeRef.current) || !!booleanModeRef.current;
    const resolved = resolveViewportFaceClick({
      geometry,
      seedFaceIndex,
      faceNormal,
      clickCount,
      faceIDs: faceIDsRef.current,
      angleTolerance: ANGLE_TOLERANCE_DEGREES,
      legacy: legacyTap || !!moveFaceModeRef.current || !!deleteFaceModeRef.current,
    });
    const faceIndices = resolved.indices;
    const selectionMode = resolved.selectionMode;
    if (legacyTap) {
      console.log(`[Face Selection] ${clickCount}-click picker tap: ${faceIndices.length} triangles (${selectionMode})`);
    } else if (clickCount >= 2) {
      console.log(`[Face Selection] Double-click: body, ${faceIndices.length} triangles`);
    } else {
      console.log(`[Face Selection] Single-click: face (${resolved.kind}), ${faceIndices.length} triangles`);
    }
    
    // Calculate face data (center, area, vertices) from selected triangles
    let centerSum = new Vector3();
    let totalArea = 0;
    const allVertices = [];
    
    faceIndices.forEach(faceIdx => {
      const i0 = index[faceIdx * 3];
      const i1 = index[faceIdx * 3 + 1];
      const i2 = index[faceIdx * 3 + 2];
      const v1 = new Vector3().fromBufferAttribute(positions, i0);
      const v2 = new Vector3().fromBufferAttribute(positions, i1);
      const v3 = new Vector3().fromBufferAttribute(positions, i2);
      const triangle = new Triangle(v1, v2, v3);
      const area = triangle.getArea();
      const triCenter = new Vector3().add(v1).add(v2).add(v3).divideScalar(3);
      centerSum.add(triCenter.multiplyScalar(area));
      totalArea += area;
      allVertices.push([v1.x, v1.y, v1.z], [v2.x, v2.y, v2.z], [v3.x, v3.y, v3.z]);
    });
    
    const center = centerSum.divideScalar(totalArea);
    const normal = clickedFace.normal.clone();
    const faceData = {
      center: [center.x, center.y, center.z],
      normal: [normal.x, normal.y, normal.z],
      area: totalArea,
      vertices: allVertices,
      triangleCount: faceIndices.length,
      selectionMode // Include selection mode in face data for UI display
    };
    
    // Normal face selection mode — clear edges so modes do not fight
      clearEdgeHighlight();
      setSelectedEdges([]);
      // Read the accumulated multi-pick BEFORE clearHighlight() drops it.
      const entry = {
        center: faceData.center,
        normal: faceData.normal,
        indices: faceIndices.slice(),
      };
      let picks;
      if (moveModeRef.current || rotateModeRef.current || mirrorModeRef.current) {
        // Same resolver as the rest of the viewport: one click is the full
        // face and does not change the body. Two clicks set that body as
        // the move, rotate, or mirror target. Not a legacy picker, and no viewport arrows.
        const mirroring = !!mirrorModeRef.current;
        const rotating = !mirroring && !moveModeRef.current && !!rotateModeRef.current;
        if (clickCount >= 2) {
          const bodies = meshBodyComponents(positions, index);
          const hit = bodyContainingTriangle(bodies, seedFaceIndex);
          if (!hit) {
            showShellToast(mirroring ? MIRROR_MODE_NEED_BODY : rotating ? ROTATE_MODE_NEED_BODY : MOVE_MODE_NEED_BODY);
            return;
          }
          const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
          if (mirroring) {
            const prevMirror = mirrorModeRef.current.target;
            const sameMirror = prevMirror && cutBodyKey(prevMirror) === cutBodyKey(hit);
            const mirrorTarget = sameMirror ? null : {
              at: resolveMirrorBodyAt(hit.at, bodyCentroidsRef.current),
              minTri: hit.minTri,
              triangles: hit.triangles.slice(),
            };
            const nextMirror = { ...mirrorModeRef.current, target: mirrorTarget };
            mirrorModeRef.current = nextMirror;
            setMirrorMode(nextMirror);
            clearHighlight();
            if (mirrorTarget) {
              highlightFace(mirrorTarget.triangles, geometry, positions, index, 0x22d3ee, 'mirror-body');
            }
            paintMirrorPreview(nextMirror);
            return;
          }
          if (rotating) {
            const prevRotate = rotateModeRef.current.target;
            const sameBody = prevRotate && cutBodyKey(prevRotate) === cutBodyKey(hit);
            const rotateTarget = sameBody ? null : {
              at: resolveRotateBodyAt(hit.at, bodyCentroidsRef.current, buf),
              minTri: hit.minTri,
              triangles: hit.triangles.slice(),
            };
            let nextRotate = { ...rotateModeRef.current, target: rotateTarget };
            if (rotateTarget) nextRotate = seedRotateFromLastRotate(nextRotate, buf, rotateTarget.at);
            rotateModeRef.current = nextRotate;
            setRotateMode(nextRotate);
            clearHighlight();
            if (rotateTarget) {
              highlightFace(rotateTarget.triangles, geometry, positions, index, 0x22d3ee, 'rotate-body');
            }
            paintRotatePreview(nextRotate);
            return;
          }
          const prev = moveModeRef.current.target;
          const same = prev && cutBodyKey(prev) === cutBodyKey(hit);
          const target = same ? null : {
            at: resolveMoveBodyAt(hit.at, bodyCentroidsRef.current, buf),
            minTri: hit.minTri,
            triangles: hit.triangles.slice(),
          };
          let next = { ...moveModeRef.current, target };
          if (target) {
            next = seedMoveDeltasFromLastMove(next, buf, target.at);
          }
          moveModeRef.current = next;
          setMoveMode(next);
          clearHighlight();
          if (target) {
            highlightFace(target.triangles, geometry, positions, index, 0x22d3ee, 'move-body');
          }
          paintMovePreview(next);
          return;
        }
        publishFacePicks([entry], geometry, positions, index, faceData);
        {
          let nx = 0;
          let ny = 0;
          let nz = 0;
          for (const faceIdx of faceIndices) {
            const i0 = index[faceIdx * 3];
            const i1 = index[faceIdx * 3 + 1];
            const i2 = index[faceIdx * 3 + 2];
            const ax = positions.getX(i1) - positions.getX(i0);
            const ay = positions.getY(i1) - positions.getY(i0);
            const az = positions.getZ(i1) - positions.getZ(i0);
            const bx = positions.getX(i2) - positions.getX(i0);
            const by = positions.getY(i2) - positions.getY(i0);
            const bz = positions.getZ(i2) - positions.getZ(i0);
            nx += ay * bz - az * by;
            ny += az * bx - ax * bz;
            nz += ax * by - ay * bx;
          }
          const len = Math.hypot(nx, ny, nz);
          if (len > 1e-12) {
            const normal = [nx / len, ny / len, nz / len];
            if (mirroring) {
              const next = setMirrorFacePlane(mirrorModeRef.current, {
                center: faceData.center,
                normal,
              });
              mirrorModeRef.current = next;
              setMirrorMode(next);
              setSelectedPlaneId(mirrorSelectedPlaneId(next));
              paintMirrorPreview(next);
            } else if (rotating) {
              const next = { ...rotateModeRef.current, faceNormal: normal };
              rotateModeRef.current = next;
              setRotateMode(next);
              paintRotatePreview(next);
            } else {
              const next = { ...moveModeRef.current, faceNormal: normal };
              moveModeRef.current = next;
              setMoveMode(next);
              paintMovePreview(next);
            }
          }
        }
        return;
      }
      if (moveFaceModeRef.current) {
        // Same sticky tap as Shell. A double click stays the legacy face walk,
        // not the owning body, so Confirm still writes the tapped face.
        const next = toggleMoveFaceSelection(moveFaceModeRef.current, entry);
        commitMoveFaceState(next);
        return;
      }
      if (deleteFaceModeRef.current) {
        // Sticky tap: add the face, or remove it if it is already picked.
        // This does not run deleteFace. Confirm writes the call.
        const next = toggleDeleteFaceSelection(deleteFaceModeRef.current, entry);
        commitDeleteFaceState(next);
        return;
      }
      if (cutModeRef.current) {
        // Cut: plane, bodies, and pieces are sticky taps. No shift-click.
        const geom = geometry;
        const tap = applyCutTap(cutModeRef.current, {
          triangle: seedFaceIndex,
          point: clickData.hitPoint,
          face: entry,
          positions: geom?.attributes?.position,
          index: geom?.index?.array,
        });
        if (tap.toast) showShellToast(tap.toast);
        commitCutState(tap.state);
        return;
      }
      if (draftModeRef.current) {
        // Draft: first tap is the neutral face. Later taps toggle drafted faces.
        // Tap the neutral face again to replace it, not to draft it. No modifier.
        const next = applyDraftFaceTap(draftModeRef.current, entry);
        draftModeRef.current = next;
        setDraftMode(next);
        paintDraftPicks(next);
        return;
      }
      if (shellModeRef.current) {
        // Shell: every tap adds. Tap an already-selected face to remove it.
        // No shift / ctrl. Same model as toggleEdgeSelection.
        picks = toggleShellFaceSelection(facePickGroupRef.current?.picks, entry);
      } else {
        const prev = additive ? (facePickGroupRef.current?.picks || []) : [];
        picks = [...prev, entry];
      }
      publishFacePicks(picks, geometry, positions, index, faceData);
      if (picks.length > 1 && !shellModeRef.current) {
        console.log(`[Face Selection] ${picks.length} faces picked (shift-click to add more)`);
      }
  }, [onFaceSelected, clearHighlight, clearEdgeHighlight, highlightFace, publishFacePicks, paintDraftPicks, commitCutState, paintMovePreview, paintRotatePreview, paintMirrorPreview, commitMoveFaceState, commitDeleteFaceState, getHelperBuffer, commitBooleanState, crossSectionEnabled, notePolylineDotTap]);

  const chooseAmbiguousPart = useCallback((partId) => {
    const pending = ambiguousPickRef.current;
    setPartChoice(null);
    ambiguousPickRef.current = null;
    if (!partId) return;
    retargetPickPart(partId);
    if (!pending) return;
    if (pending.kind === 'edge') {
      const edge = pickEdgeAtClient(pending.clientX, pending.clientY);
      if (edge) {
        clearEdgeHover();
        setSelectedEdges((prev) => toggleEdgeSelectionPropagated(prev, edge, {
          propagate: tangentPropRef.current,
          featureEdges: featureEdgesRef.current,
        }));
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
      }
      if (shouldSyncScript({ kind: 'edge', featureSession: featureSessionRef.current })) {
        onPickRetargetRef.current?.({ partId, kind: 'edge', syncScript: true });
      }
      return;
    }
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera || !resultRef.current?.geometry?.attributes?.position) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current.x = ((pending.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((pending.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, camera);
    const hits = raycasterRef.current.intersectObject(resultRef.current, false);
    if (!hits.length || !hits[0].face) return;
    const intersection = hits[0];
    const geometry = resultRef.current.geometry;
    const clickedFace = intersection.face;
    clickCountRef.current = 1;
    lastClickTimeRef.current = Date.now();
    pendingClickDataRef.current = {
      clickedFace,
      seedFaceIndex: intersection.faceIndex,
      geometry,
      positions: geometry.attributes.position,
      index: geometry.index.array,
      faceNormal: [clickedFace.normal.x, clickedFace.normal.y, clickedFace.normal.z],
      hitPoint: [intersection.point.x, intersection.point.y, intersection.point.z],
      additive: !!pending.additive,
      partId: activePartIdRef.current,
    };
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      processClick();
    }, MULTI_CLICK_DELAY);
  }, [retargetPickPart, pickEdgeAtClient, clearEdgeHover, clearHighlight, onFaceSelected, processClick]);

  // Slice Mobile C: long-press (~450ms, no drag) on the part opens a feature sheet.
  // Pointer events cover touch + mouse; cancelled on move past drag threshold or when
  // Contour/Fillet/measure modes own the canvas. Desktop leaves featureSheetEnabled false.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const CLEAR_LP = () => {
      if (featureLongPressTimerRef.current) {
        clearTimeout(featureLongPressTimerRef.current);
        featureLongPressTimerRef.current = null;
      }
      featureLongPressOriginRef.current = null;
    };

    const onPointerDown = (event) => {
      if (!featureSheetEnabledRef.current) return;
      if (event.button != null && event.button !== 0) return;
      if (contourModeRef.current || filletModeRef.current || shellModeRef.current || draftModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current || sheetMetalModeRef.current || helperCardOpenRef.current || paintModeRef.current) return;
      if (measurementEnabled) return;
      CLEAR_LP();
      featureLongPressFiredRef.current = false;
      featureLongPressOriginRef.current = { x: event.clientX, y: event.clientY };
      featureLongPressTimerRef.current = setTimeout(() => {
        featureLongPressTimerRef.current = null;
        const origin = featureLongPressOriginRef.current;
        featureLongPressOriginRef.current = null;
        if (!origin || !featureSheetEnabledRef.current) return;
        if (contourModeRef.current || filletModeRef.current || shellModeRef.current || draftModeRef.current || moveModeRef.current || rotateModeRef.current || mirrorModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current || sheetMetalModeRef.current || helperCardOpenRef.current || paintModeRef.current) return;
        featureLongPressFiredRef.current = true;
        onFeatureLongPressRef.current?.({ clientX: origin.x, clientY: origin.y });
      }, 450);
    };

    const onPointerMove = (event) => {
      const origin = featureLongPressOriginRef.current;
      if (!origin) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.hypot(dx, dy) > 10) CLEAR_LP();
    };

    const onPointerEnd = () => {
      CLEAR_LP();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerEnd);
    canvas.addEventListener('pointercancel', onPointerEnd);
    canvas.addEventListener('pointerleave', onPointerEnd);

    return () => {
      CLEAR_LP();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      canvas.removeEventListener('pointerleave', onPointerEnd);
    };
  }, [measurementEnabled]);

  // --- Event listener setup ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Right-drag must not raise the browser menu over the sketch, and a drag
    // that ends off-canvas still has to release (window-level mouseup).
    const onContextMenu = (event) => {
      if (sketchHandles(contourModeRef.current).length) event.preventDefault();
    };
    const onWindowMouseUp = (event) => {
      if (polylinePointDragRef.current && !polylinePointDragRef.current.touch) {
        endPolylinePointDrag(event);
      }
    };
    // Touch rotate records a delta even while noRotate is set, and the
    // next update() would apply it. A zero-speed update consumes that
    // delta. onTouchEnd also clears it, after this listener.
    const settleTouchRotate = (controls, noRotateAfter) => {
      const speed = controls.rotateSpeed;
      controls.rotateSpeed = 0;
      controls.noRotate = false;
      try {
        controls.update();
      } finally {
        controls.rotateSpeed = speed;
        controls.noRotate = noRotateAfter;
      }
    };
    // Mouse rotate does not record a delta while noRotate is set, so the
    // circle is still (0, 0). A zero-speed update after one move consumes
    // that jump. The next move orbits from the finger.
    const seedMouseRotate = (event) => {
      const controls = controlsRef.current;
      if (!controls || !event || !Number.isFinite(event.pageX)) return;
      const speed = controls.rotateSpeed;
      controls.rotateSpeed = 0;
      controls.noRotate = false;
      try {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerId: event.pointerId,
          pointerType: 'mouse',
          clientX: event.clientX,
          clientY: event.clientY,
          pageX: event.pageX,
          pageY: event.pageY,
          button: event.button,
          buttons: event.buttons,
        }));
        controls.update();
      } finally {
        controls.rotateSpeed = speed;
      }
    };
    const releaseTapOrbitHold = (event) => {
      const hold = tapOrbitHoldRef.current;
      if (!hold) return;
      tapOrbitHoldRef.current = null;
      const controls = controlsRef.current;
      if (!controls) return;
      if (hold.pointerType === 'touch') {
        settleTouchRotate(controls, false);
        return;
      }
      if (event) seedMouseRotate(event);
      controls.noRotate = false;
    };
    const pointerHitsSketchDrag = (event) => {
      if (event.button != null && event.button !== 0 && event.button !== 2) return false;
      if (contourPlaneOpenRef.current) return false;
      const state = contourModeRef.current;
      if (!state || state.gesture) return false;
      if (pickModeRef.current === 'edge') return false;
      if (!sketchHandles(state).length) return false;
      if (pickPolylinePointAtClient(event.clientX, event.clientY) >= 0) return true;
      return state.tool === 'cursor' && !!sketchShapeAtClient(event.clientX, event.clientY);
    };
    const releaseSketchDragHold = (event) => {
      const hold = sketchDragHoldRef.current;
      if (!hold) return;
      if (event && event.pointerId != null && event.pointerId !== hold.pointerId) return;
      sketchDragHoldRef.current = null;
      const controls = controlsRef.current;
      if (controls && hold.pointerType === 'touch') settleTouchRotate(controls, true);
      // The point drag's own mouseup still owns the hover lock.
      if (polylinePointDragRef.current) return;
      if (hold.pointerType !== 'touch' && polylinePointHoverRef.current >= 0) return;
      unlockOrbitForPointDrag();
    };
    // Capture so this runs before TrackballControls records the gesture.
    const onTapOrbitDown = (event) => {
      if (event.button != null && event.button !== 0 && event.button !== 2) return;
      const controls = controlsRef.current;
      if (!controls) return;
      // A sketch handle owns the whole drag. Dimension/Constrain keep the tap slop.
      if (pointerHitsSketchDrag(event)) {
        if (sketchDragHoldRef.current && event.pointerId !== sketchDragHoldRef.current.pointerId) {
          releaseSketchDragHold();
        }
        if (!polylineControlsLockRef.current) {
          polylineControlsLockRef.current = { noRotate: controls.noRotate, noPan: controls.noPan };
        }
        controls.noRotate = true;
        controls.noPan = true;
        sketchDragHoldRef.current = {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
        };
        return;
      }
      if (event.button != null && event.button !== 0) return;
      const gesture = contourModeRef.current?.gesture;
      const tapSlop = gesture === 'dimension' || gesture === 'constraints';
      if (!tapSlop) {
        // A feature card, Arc, and empty canvas do not keep a rotate lock.
        // Sketch-handle grabs already returned above.
        if (!polylinePointDragRef.current && !sketchDragHoldRef.current) {
          unlockOrbitForPointDrag();
          controls.noRotate = false;
        }
        return;
      }
      if (tapOrbitHoldRef.current && event.pointerId !== tapOrbitHoldRef.current.pointerId) {
        releaseTapOrbitHold(event);
        return;
      }
      if (tapOrbitHoldRef.current) return;
      tapOrbitHoldRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
      };
      controls.noRotate = true;
    };
    const onTapOrbitMove = (event) => {
      const drag = sketchDragHoldRef.current;
      if (drag && event.pointerId === drag.pointerId) return;
      const hold = tapOrbitHoldRef.current;
      if (!hold || event.pointerId !== hold.pointerId) return;
      const moved = Math.hypot(event.clientX - hold.x, event.clientY - hold.y);
      if (moved <= SKETCH_HIT_PX) return;
      releaseTapOrbitHold(event);
    };
    const onTouchDown = (event) => {
      if (event.pointerType !== 'touch') return;
      // A touch drag marks the following click as synthetic. If that click
      // never arrives, the next tap was thrown away. A new touch is a new gesture.
      if (!polylinePointDragRef.current) {
        polylineSuppressClickRef.current = false;
        isDraggingRef.current = false;
        mouseDownPosRef.current = null;
      }
      if (contourModeRef.current?.tool === 'cursor') {
        if (!beginPolylinePointDrag(event, { touch: true, cursorTap: true })) {
          beginSketchShapeDrag(event, { touch: true });
        }
        return;
      }
      beginPolylinePointDrag(event, { touch: true });
    };
    const onTouchMove = (event) => {
      if (event.pointerType !== 'touch') return;
      if (polylinePointDragRef.current?.touch) {
        handleMouseMove(event);
        return;
      }
      // A finger has no hover. Show the snap ring while it is still down on empty space.
      if (contourSnapAllowed(contourModeRef.current) && contourModeRef.current?.tool === 'polyline') {
        publishContourSnap(readContourSnap(event.clientX, event.clientY));
      }
    };
    const onTouchUp = (event) => {
      const hold = tapOrbitHoldRef.current;
      if (!hold || event.pointerId === hold.pointerId) releaseTapOrbitHold(event);
      releaseSketchDragHold(event);
      if (event.pointerType !== 'touch' || !polylinePointDragRef.current?.touch) return;
      const shapeTap = !!(polylinePointDragRef.current.shape && !polylinePointDragRef.current.moved);
      const x = event.clientX;
      const y = event.clientY;
      endPolylinePointDrag(event);
      if (shapeTap) selectContourStrokeAtClient(x, y);
    };

    const onDblClick = (event) => {
      event.preventDefault();
    };
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onTapOrbitDown, { capture: true });
    canvas.addEventListener('pointermove', onTapOrbitMove, { capture: true });
    canvas.addEventListener('pointerdown', onTouchDown, { passive: false });
    canvas.addEventListener('pointermove', onTouchMove);
    canvas.addEventListener('pointerup', onTouchUp);
    canvas.addEventListener('pointercancel', onTouchUp);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('pointerup', onTouchUp);
    window.addEventListener('pointercancel', onTouchUp);

    return () => {
      releaseTapOrbitHold();
      releaseSketchDragHold();
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onTapOrbitDown, { capture: true });
      canvas.removeEventListener('pointermove', onTapOrbitMove, { capture: true });
      canvas.removeEventListener('pointerdown', onTouchDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchUp);
      canvas.removeEventListener('pointercancel', onTouchUp);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('pointerup', onTouchUp);
      window.removeEventListener('pointercancel', onTouchUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, endPolylinePointDrag, beginPolylinePointDrag, beginSketchShapeDrag, sketchShapeAtClient, selectContourStrokeAtClient, pickPolylinePointAtClient, pickSketchLineAtClient, unlockOrbitForPointDrag, readContourSnap, publishContourSnap]);

  // Click / toast timer cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup click timer on unmount
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      if (edgeModeToastTimerRef.current) {
        clearTimeout(edgeModeToastTimerRef.current);
        edgeModeToastTimerRef.current = null;
      }
      if (measureTapTimerRef.current) {
        clearTimeout(measureTapTimerRef.current);
        measureTapTimerRef.current = null;
      }
      clearMeasureDecor();
    };
  }, [clearMeasureDecor]);

  useEffect(() => {
    if (!measurementEnabled) return undefined;
    const other = !!(
      contourMode || filletMode || shellMode || draftMode || cutMode
      || booleanMode || moveMode || rotateMode || moveFaceMode || deleteFaceMode
      || paintMode || feaActive || sheetMetalMode || sheetMetalPicker
      || helperCardOpen || editSheetOpen
    );
    if (!other) return undefined;
    exitMeasureModeRef.current();
    return undefined;
  }, [
    measurementEnabled, contourMode, filletMode, shellMode, draftMode, cutMode,
    booleanMode, moveMode, rotateMode, moveFaceMode, deleteFaceMode, paintMode, feaActive,
    sheetMetalMode, sheetMetalPicker, helperCardOpen, editSheetOpen,
  ]);

  // Page-zoom lock. Its own effect so StrictMode's extra mount removes the
  // document listeners (same cleanup shape as the orbit loop, #237). The
  // canvas touch stream is not cancelled, so TrackballControls still runs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return installPageZoomLock(canvas);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return installViewportGestureZoom(canvas, {
      getCamera: () => cameraRef.current,
      getControls: () => controlsRef.current,
    });
  }, []);

  // Initialize Three.js scene
  useEffect(() => {
    console.log('[Viewport] Initializing Three.js scene');
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    let initialized = false;
    // This effect's own loop. StrictMode runs cleanup between two mounts in dev;
    // the id and the flag stop the first loop, and the loop closes over its own
    // controls instead of controlsRef (a later mount overwrites the ref).
    let rafId = 0;
    let loopAlive = true;
    let removeWebglContextLoss = () => {};
    let orbitControls = null;
    let orbitPointerDom = null;
    let onPointerDownRotateSpeed = null;
    let axisHelper = null;

    const getContainerSize = () => readViewportContainerSize(container);

    const syncLineMaterialResolution = (width, height) => {
      for (const root of [
        edgeHighlightRef.current,
        edgeHoverRef.current,
        sheetMetalOverlayRef.current,
        polylineDraftRef.current,
        contourStatusRef.current,
        xsPreviewRef.current,
      ]) {
        if (!root || typeof root.traverse !== 'function') continue;
        root.traverse((child) => {
          if (child.material?.resolution) {
            child.material.resolution.set(width, height);
          }
        });
      }
    };

    const initScene = () => {
      if (initialized) return;
      
      let { width, height } = getContainerSize();
      
      if (width === 0 || height === 0) {
        return;
      }
      
      initialized = true;

      const scene = new Scene();
      // Match Monaco / body (#1e1e1e) — not Tailwind gray-900 (#111827).
      scene.background = new Color(0x1e1e1e);
      const camera = new PerspectiveCamera(45, width / height, 0.1, 2000);
      camera.position.set(300, 300, 300);
      camera.lookAt(0, 0, 0);
      const light = new PointLight(0xffffff, 1);
      camera.add(light);
      scene.add(camera);

      sceneRef.current = scene;
      cameraRef.current = camera;
      setSceneReady(true);

      // three.js throws "Error creating WebGL context." when the browser
      // cannot make a context (no GPU, acceleration off, blocklisted driver).
      // Stay inside this effect so the app-wide error boundary does not
      // replace the editor. Scene and camera stay; the draw loop does not start.
      const renderer = createViewportWebGLRenderer(canvasRef.current);
      if (!renderer) {
        setWebglUnavailable(true);
        return;
      }
      removeWebglContextLoss = installWebglContextLossHandlers(canvasRef.current, {
        onLost: () => setWebglUnavailable(true),
        onRestored: () => setWebglUnavailable(false),
      });

      resizeViewportRenderer({
        renderer,
        camera,
        width,
        height,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        updateStyle: false,
      });
      renderer.setClearColor(0x1e1e1e, 1);
      rendererRef.current = renderer;

      // Dev/automation hook used by headless review tooling (harness/stage_shot.mjs).
      // Drives the exact same execute -> render path the Run button uses, and lets a
      // script position the camera deterministically for reproducible screenshots.
      const __tris = () => {
        const g = resultRef.current?.geometry;
        if (!g) return 0;
        return g.index ? Math.ceil(g.index.count / 3)
          : (g.attributes?.position ? Math.ceil(g.attributes.position.count / 3) : 0);
      };
      if (import.meta.env?.DEV) {
        window.__VIEWPORT__ = {
          ready: () => !!(sceneRef.current && rendererRef.current && resultRef.current),
          // Feature memoisation on the primary geometry worker: `{ clear: true }`
          // empties it, `{ enabled: false }` turns it off; the reply is its
          // stats (golden:feature-memoisation forces a cold run with it).
          featureMemo: (opts) => manifoldContext.featureMemo(opts || {}),
          // Face identity: the named faces and edges of the active part's
          // mesh (golden:face-identity reads this). Plain data, no triangles.
          faceTable: () => {
            const geom = resultRef.current?.geometry;
            if (!geom) return null;
            return describeFaceTable(stampedFaceTable(geom, faceIDsRef.current));
          },
          cadBodySticky: () => cadBodyStickyRef.current,
          jointHighlightCount: () => jointHighlightRef.current.size,
          assemblyPartPositions: () => {
            const out = [];
            const push = (mesh) => {
              if (!mesh?.userData?.surfId || !mesh.position) return;
              out.push({
                surfId: String(mesh.userData.surfId),
                t: [mesh.position.x, mesh.position.y, mesh.position.z],
              });
            };
            const group = sceneRef.current?.getObjectByName('assembly-parts');
            if (group) {
              for (const child of group.children) push(child);
            }
            push(resultRef.current);
            return out;
          },
          // Every part mesh the scene holds (the pick mesh and the other
          // assembly parts) with what decides whether it draws:
          // golden:adjacent-part-visible reads this after a part switch.
          partMeshStates: () => {
            const describe = (mesh, role) => {
              const g = mesh?.geometry;
              const pos = g?.attributes?.position;
              if (g && pos && !g.boundingSphere) g.computeBoundingSphere();
              const mat = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
              let parentVisible = true;
              let inScene = false;
              for (let p = mesh?.parent; p; p = p.parent) {
                if (p.visible === false) parentVisible = false;
                if (p === sceneRef.current) inScene = true;
              }
              return {
                role,
                partId: role === 'active'
                  ? (activePartIdRef.current ?? null)
                  : (mesh?.userData?.assemblyPartId ?? null),
                surfId: mesh?.userData?.surfId ?? null,
                leftover: mesh?.userData?.leftover === true,
                inScene,
                visible: mesh?.visible !== false,
                parentVisible,
                frustumCulled: mesh?.frustumCulled !== false,
                layers: mesh?.layers?.mask ?? null,
                renderOrder: mesh?.renderOrder ?? 0,
                vertices: pos ? pos.count : 0,
                indices: g?.index ? g.index.count : 0,
                boundingSphere: g?.boundingSphere
                  ? { c: g.boundingSphere.center.toArray(), r: g.boundingSphere.radius }
                  : null,
                position: mesh?.position ? mesh.position.toArray() : null,
                material: mat ? {
                  opacity: mat.opacity,
                  transparent: !!mat.transparent,
                  depthWrite: mat.depthWrite !== false,
                  depthTest: mat.depthTest !== false,
                  visible: mat.visible !== false,
                } : null,
              };
            };
            const out = [describe(resultRef.current, 'active')];
            for (const mesh of assemblyExtrasRef.current.values()) out.push(describe(mesh, 'extra'));
            return out;
          },
          // One render and the renderer's own count of what it drew.
          // GPU buffer cache: geometries built (each uploads on its first
          // frame), runs that reused one, geometries disposed and held, what
          // the renderer holds, and what the scene reaches (a gap between
          // the last two is a leak). golden:gpu-upload-cache reads this.
          gpuStats: () => {
            const renderer = rendererRef.current;
            const scene = sceneRef.current;
            const camera = cameraRef.current;
            if (renderer && scene && camera) renderer.render(scene, camera);
            const inScene = new Set();
            scene?.traverse?.((obj) => { if (obj.geometry) inScene.add(obj.geometry); });
            return {
              ...solidCacheStats(),
              rendererGeometries: renderer?.info?.memory?.geometries ?? null,
              sceneGeometries: inScene.size,
            };
          },
          renderInfo: () => {
            const renderer = rendererRef.current;
            const scene = sceneRef.current;
            const camera = cameraRef.current;
            if (!renderer || !scene || !camera) return null;
            renderer.render(scene, camera);
            const r = renderer.info.render;
            return {
              calls: r.calls,
              triangles: r.triangles,
              near: camera.near,
              far: camera.far,
              position: camera.position.toArray(),
            };
          },
          crossSectionTargetIds: () => collectCrossSectionTargets({
            assemblyRunLockRef,
            resultRef,
            assemblyExtrasRef,
            solidCache: solidCacheRef.current,
            activePartIdRef,
          }).map((t) => t.partId),
          crossSectionTrimmedPartIds: () => collectCrossSectionTargets({
            assemblyRunLockRef,
            resultRef,
            assemblyExtrasRef,
            solidCache: solidCacheRef.current,
            activePartIdRef,
          })
            .filter((t) => t.mesh?.userData?.crossSectionTrimmedMeshData)
            .map((t) => t.partId),
          // Set this from automation to be notified the instant a mesh lands in the scene.
          // Fires from renderMeshData with the exact meshData object that was painted.
          onRendered: null,
          _lastRenderedMesh: null,
          _renderCount: 0,
          // What the scene still holds besides the solids: previews, edge wires,
          // highlights. A golden reads this after an edit or a hide to prove
          // nothing from a closed card or a hidden part is left over.
          featureEditOpening: () => !!featureEditRef.current?.opening,
          // Largest extent of the block preview skin, mm (null when no preview).
          blockPreviewSize: () => {
            const skin = blockPreviewRef.current?.getObjectByName?.('blockSolidPreviewSkin');
            const g = skin?.geometry;
            if (!g?.attributes?.position) return null;
            g.computeBoundingBox();
            const b = g.boundingBox;
            if (!b || b.isEmpty()) return null;
            return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
          },
          sceneInventory: () => {
            const scene = sceneRef.current;
            const out = { blockPreview: !!blockPreviewRef.current, dataBlockPreview: containerRef.current?.dataset?.blockPreview ?? null, objects: [] };
            if (!scene) return out;
            scene.traverse((obj) => {
              if (obj === scene || obj.visible === false) return;
              const type = obj.type || obj.constructor?.name || '';
              if (!/Line|Mesh|Points|Sprite/.test(type)) return;
              let parent = obj.parent;
              let hidden = false;
              while (parent && parent !== scene) {
                if (parent.visible === false) { hidden = true; break; }
                parent = parent.parent;
              }
              if (hidden) return;
              const pos = obj.geometry?.attributes?.position;
              out.objects.push({
                name: obj.name || '',
                type,
                parent: obj.parent?.name || '',
                vertices: pos ? pos.count : 0,
                isResult: obj === resultRef.current,
              });
            });
            return out;
          },
          lastRenderedIs: (mesh) => window.__VIEWPORT__?._lastRenderedMesh === mesh,
          // World-space box of one scene object by name, or of the active solid
          // for 'active-solid'. A preview on a placed part must land on that
          // part; golden:placed-part-previews compares these two boxes.
          worldBounds: (name) => {
            const obj = name === 'active-solid'
              ? resultRef.current
              : sceneRef.current?.getObjectByName(name);
            if (!obj) return null;
            obj.updateMatrixWorld(true);
            const box = new Box3().setFromObject(obj, true);
            if (box.isEmpty()) return null;
            return {
              min: [box.min.x, box.min.y, box.min.z],
              max: [box.max.x, box.max.y, box.max.z],
            };
          },
          // Run a script exactly as the Run button does -- validate, execute in the worker,
          // render into the live scene, auto-fit. Resolves { error, mesh } so a headless
          // caller can tell a fresh build from a failure without reading React state.
          executeScript: async (s, opts) => {
            stageExecErrorRef.current = null;
            let ran;
            try {
              ran = await executeScript(s, opts);
            } catch (e) {
              stageExecErrorRef.current = String(e?.message || e);
            }
            // A skipped feature still returns the recovered solid and sets the
            // popup text. That text is for the agent toast, not a hard fail.
            const recovered = !!(ran && ran.ok === true && ran.mesh);
            const err = recovered ? null : stageExecErrorRef.current;
            const mesh = err ? null : (ran?.mesh ?? window.__MANIFOLD_CONTEXT__?.lastResult?.mesh ?? null);
            // Identity check against the render choke point: the object we painted is the
            // object the worker just returned, or this run did not reach the screen at all.
            const solidBounds = () => {
              const g = resultRef.current?.geometry;
              if (!g?.attributes?.position) return null;
              g.computeBoundingBox();
              const box = g.boundingBox;
              if (!box || box.isEmpty()) return null;
              return {
                min: [box.min.x, box.min.y, box.min.z],
                max: [box.max.x, box.max.y, box.max.z],
              };
            };
            return {
              error: err,
              mesh,
              onScreen: !!mesh && window.__VIEWPORT__?._lastRenderedMesh === mesh,
              sceneTris: __tris(),
              bounds: solidBounds(),
            };
          },
          // az/el in degrees, z-up world (the app models parts with +Z up). Delegates to
          // the same fitView the UI buttons use, so an automated capture frames the part
          // exactly as a manual snap would.
          stageFit: ({ az = 35, el = 20, margin = 1.15, assembly = false } = {}) => {
            const cam = cameraRef.current, ctl = controlsRef.current, res = resultRef.current;
            if (!cam || !res) return false;
            holdSheetSlide();
            const azr = (az * Math.PI) / 180, elr = (el * Math.PI) / 180;
            let box = null;
            if (assembly) {
              const meshes = [];
              if (res.geometry) meshes.push(res);
              for (const mesh of assemblyExtrasRef.current.values()) meshes.push(mesh);
              box = unionWorldBox(meshes);
            }
            if (!box && !res.geometry) return false;
            const ok = fitView({
              camera: cam, controls: ctl,
              geometry: box ? undefined : res.geometry,
              box: box || undefined,
              dir: [Math.cos(elr) * Math.cos(azr), Math.cos(elr) * Math.sin(azr), Math.sin(elr)],
              up: [0, 0, 1], margin,
            });
            renderer.render(sceneRef.current, cam);
            return ok;
          },
          stageSnap: (key, margin = VIEW_SNAP_MARGIN) => {
            const known = Object.prototype.hasOwnProperty.call(VIEW_PRESETS, key) ? key : 'iso';
            const ok = handleViewSnap(known, margin);
            renderer.render(sceneRef.current, cameraRef.current);
            return ok;
          },
          stageRetarget: (world, dolly = 1) => {
            const cam = cameraRef.current;
            const ctl = controlsRef.current;
            if (!cam || !ctl || !world) return false;
            // A damped wheel is still zooming. Settle it, then hold this frame.
            const prevStatic = ctl.staticMoving;
            ctl.staticMoving = true;
            for (let i = 0; i < 4; i += 1) ctl.update();
            ctl.staticMoving = prevStatic;
            const offset = cam.position.clone().sub(ctl.target);
            const scale = Number(dolly) > 0 ? Number(dolly) : 1;
            const next = new Vector3(world[0], world[1], world[2]);
            ctl.noZoom = true;
            ctl.noRotate = true;
            ctl.noPan = true;
            ctl.target.copy(next);
            cam.position.copy(next).add(offset.multiplyScalar(scale));
            ctl.update();
            return cam.position.distanceTo(ctl.target);
          },
          sketchPoints: () => {
            const handles = polylineDraftRef.current?.userData?.handles || [];
            const scratch = new Vector3();
            return handles.map((handle) => {
              handle.getWorldPosition(scratch);
              return {
                id: handle.userData?.pointId || '',
                world: [scratch.x, scratch.y, scratch.z],
              };
            });
          },
          project: (x, y, z) => {
            const cam = cameraRef.current;
            const glRenderer = rendererRef.current;
            if (!cam || !glRenderer?.domElement) return null;
            const rect = glRenderer.domElement.getBoundingClientRect();
            const projected = new Vector3(x, y, z).project(cam);
            return {
              x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
              y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
              behind: projected.z > 1,
            };
          },
          // Center canvas pixel after a render. Used to check face color.
          stageSampleCenter: () => {
            const glRenderer = rendererRef.current;
            const cam = cameraRef.current;
            const scene = sceneRef.current;
            if (!glRenderer || !cam || !scene) return null;
            glRenderer.render(scene, cam);
            const gl = glRenderer.getContext();
            const w = gl.drawingBufferWidth;
            const h = gl.drawingBufferHeight;
            const buf = new Uint8Array(4);
            gl.readPixels(Math.floor(w / 2), Math.floor(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            return [buf[0], buf[1], buf[2]];
          },
          // The Zoom-to-Fit button. Frames every visible part, not the active one.
          stageZoomToFit: () => {
            handleZoomToFit();
            const cam = cameraRef.current;
            if (cam && sceneRef.current) renderer.render(sceneRef.current, cam);
            return true;
          },
          // NDC bounds of each visible part after the current camera. Hidden
          // rows are absent. `inside` is every corner inside the frame.
          stageVisibleFraming: () => {
            const cam = cameraRef.current;
            if (!cam) return { ok: false, parts: [] };
            cam.updateMatrixWorld();
            const mvp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
            const p = new Vector4();
            const project = (box) => {
              let minU = Infinity;
              let maxU = -Infinity;
              let minV = Infinity;
              let maxV = -Infinity;
              for (let i = 0; i < 8; i++) {
                p.set(
                  i & 1 ? box.max.x : box.min.x,
                  i & 2 ? box.max.y : box.min.y,
                  i & 4 ? box.max.z : box.min.z,
                  1
                ).applyMatrix4(mvp);
                if (!isFinite(p.x) || !isFinite(p.y) || Math.abs(p.w) < 1e-12) continue;
                const u = p.x / p.w;
                const v = p.y / p.w;
                minU = Math.min(minU, u);
                maxU = Math.max(maxU, u);
                minV = Math.min(minV, v);
                maxV = Math.max(maxV, v);
              }
              const extent = Math.max(Math.abs(minU), Math.abs(maxU), Math.abs(minV), Math.abs(maxV));
              return {
                minU: +minU.toFixed(3),
                maxU: +maxU.toFixed(3),
                minV: +minV.toFixed(3),
                maxV: +maxV.toFixed(3),
                extent: Number.isFinite(extent) ? +extent.toFixed(3) : null,
                inside: Number.isFinite(extent) && extent <= 1.02,
              };
            };
            const parts = [];
            const push = (mesh, id) => {
              const box = meshWorldBox(mesh);
              if (!box) return;
              parts.push({ id: id == null ? null : String(id), ...project(box) });
            };
            push(resultRef.current, activePartIdRef.current);
            for (const [id, mesh] of assemblyExtrasRef.current) push(mesh, id);
            const meshes = [];
            if (resultRef.current) meshes.push(resultRef.current);
            for (const mesh of assemblyExtrasRef.current.values()) meshes.push(mesh);
            const union = unionWorldBox(meshes);
            return {
              ok: parts.length > 0 && parts.every((part) => part.inside),
              parts,
              target: controlsRef.current?.target?.toArray?.() || null,
              union: union && !union.isEmpty()
                ? { min: union.min.toArray(), max: union.max.toArray() }
                : null,
            };
          },
          stageAutoFit: (on) => { setAutoFitEnabled(!!on); return true; },
          // Framing assertion for automated review: projects the part's 8 bounding-box
          // corners through the live camera and reports whether they land inside the
          // viewport and how much of it the part covers. A snap that silently no-ops, a
          // part rendered off-screen tiny, or geometry clipped by near/far all fail here
          // with a readable reason -- which pixels alone would not reliably tell us.
          stageVerifyFraming: () => {
            const cam = cameraRef.current, res = resultRef.current;
            if (!cam || !res?.geometry?.attributes?.position) return { ok: false, problems: ['no camera or geometry'] };
            const g = res.geometry;
            g.computeBoundingBox();
            const b = g.boundingBox;
            if (!b || b.isEmpty()) return { ok: false, problems: ['empty bounding box'] };

            cam.updateMatrixWorld();      // this fork refreshes matrixWorldInverse inside updateMatrixWorld()
            const mvp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
            const p = new Vector4();
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            let behindNear = 0, beyondFar = 0, invalid = 0;
            const nearZ = -(cam.far + cam.near) / (cam.far - cam.near);
            const farZ = 1;
            for (let i = 0; i < 8; i++) {
              p.set(
                i & 1 ? b.max.x : b.min.x,
                i & 2 ? b.max.y : b.min.y,
                i & 4 ? b.max.z : b.min.z,
                1
              ).applyMatrix4(mvp);
              if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) || Math.abs(p.w) < 1e-12) { invalid++; continue; }
              const u = p.x / p.w, vv = p.y / p.w, z = p.z / p.w;
              minU = Math.min(minU, u); maxU = Math.max(maxU, u);
              minV = Math.min(minV, vv); maxV = Math.max(maxV, vv);
              if (z < nearZ - 1e-3) behindNear++;
              if (z > farZ + 1e-3) beyondFar++;
            }
            if (invalid === 8) return { ok: false, problems: ['projection produced no finite corners'] };

            const problems = [];
            if (behindNear === 8) problems.push('part is entirely in front of the near plane');
            if (beyondFar === 8) problems.push('part is entirely beyond the far plane');
            // The part's largest projected extent, as a fraction of the half-frame. A correct
            // fit sits in [~0.5, ~1.0]: the biggest dimension fills the frame (minus the margin
            // factor) and nothing spills outside it. This is the right test, not total frame
            // coverage -- a long thin part viewed down its long axis legitimately covers a small
            // fraction of the frame while being framed perfectly.
            const extent = Math.max(Math.abs(minU), Math.abs(maxU), Math.abs(minV), Math.abs(maxV));
            if (!Number.isFinite(extent)) problems.push('non-finite projection');
            else if (extent > 1.05) problems.push(`part projects outside the frame (largest extent ${extent.toFixed(2)} of half-frame)`);
            else if (extent < 0.40) problems.push(`part fills only ${(extent * 100).toFixed(0)}% of the frame (not fitted)`);
            const covU = Math.max(0, Math.min(1, maxU) - Math.max(-1, minU));
            const covV = Math.max(0, Math.min(1, maxV) - Math.max(-1, minV));
            // Normalised to [0..1]: the visible NDC box is [-1,1]^2, an area of 4. Reported
            // for context only -- it is expected to be small for slender parts.
            const coverage = (covU * covV) / 4;

            return {
              ok: problems.length === 0,
              problems,
              extent: Number.isFinite(extent) ? +extent.toFixed(3) : null,
              u: [minU, maxU].map((x) => +x.toFixed(3)),
              v: [minV, maxV].map((x) => +x.toFixed(3)),
              coverage: +coverage.toFixed(3),
              tris: Math.ceil((g.index ? g.index.count : g.attributes.position.count) / 3),
            };
          },
          // Framing state for automated assertions (headless callers cannot read refs).
          stageCamera: () => {
            const cam = cameraRef.current, ctl = controlsRef.current, res = resultRef.current;
            if (!cam) return null;
            const g = res?.geometry;
            g?.computeBoundingBox();
            const b = g?.boundingBox;
            // zoom/view/projection-matrix readouts for headless forensics. For this fork the
            // verified identities are te[5] = zoom / tan(fov_deg * PI/180 / 2) and te[0] =
            // te[5] / aspect (near cancels out — makePerspective scales width with near).
            // Measured once: te = {1.293, 2.414} <=> exactly fov 45, aspect 1.867 — so a
            // mismatch here means someone mutated fov/aspect/zoom, not that the fit is bad.
            const pe = cam.projectionMatrix?.elements || null;
            return {
              position: cam.position.toArray(),
              quaternion: cam.quaternion.toArray(),
              up: cam.up.toArray(),
              target: ctl ? ctl.target.toArray() : null,
              near: cam.near, far: cam.far, fov: cam.fov, aspect: cam.aspect,
              zoom: cam.zoom, view: cam.view ? { ...cam.view } : null,
              te: pe ? { te0: pe[0], te5: pe[5], te8: pe[8], te9: pe[9] } : null,
              bbox: b && !b.isEmpty() ? { min: b.min.toArray(), max: b.max.toArray() } : null,
            };
          },
          stageActivePose: () => {
            const mesh = resultRef.current;
            if (!mesh?.position) return null;
            return {
              t: [mesh.position.x, mesh.position.y, mesh.position.z],
              q: mesh.quaternion
                ? [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w]
                : [0, 0, 0, 1],
            };
          },
          stageSetActivePose: (t, q) => {
            const mesh = resultRef.current;
            if (!mesh?.position?.set) return false;
            const pose = {
              t: Array.isArray(t) ? t : [0, 0, 0],
              q: Array.isArray(q) ? q : [0, 0, 0, 1],
            };
            applyPartPose(mesh, pose);
            syncAnchoredOverlays();
            const renderer = rendererRef.current;
            const scene = sceneRef.current;
            const camera = cameraRef.current;
            if (renderer && scene && camera) renderer.render(scene, camera);
            return true;
          },
          stageProject: (world) => {
            const cam = cameraRef.current;
            const canvas = canvasRef.current;
            if (!cam || !canvas || !world) return null;
            cam.updateMatrixWorld();
            const v = new Vector3(world[0], world[1], world[2]);
            v.project(cam);
            if (!Number.isFinite(v.x) || v.z < -1 || v.z > 1) return null;
            const rect = canvas.getBoundingClientRect();
            return {
              x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
              y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
            };
          },
          // Fullscreen the viewport and hide every non-canvas element (toolbars, panels,
          // editor, modals) so captures show only the part on a clean background.
          stageIsolate: ({ bg = '#0d1116' } = {}) => {
            const container = containerRef.current, canvas = canvasRef.current;
            if (!container || !canvas) return false;
            const keep = new Set();
            for (let el = canvas; el; el = el.parentElement) keep.add(el);
            for (const el of document.querySelectorAll('body *')) {
              if (keep.has(el)) continue;
              el.style.setProperty('display', 'none', 'important');
            }
            for (const ch of Array.from(container.children)) {
              if (ch !== canvas) ch.style.setProperty('display', 'none', 'important');
            }
            container.style.setProperty('position', 'fixed', 'important');
            container.style.setProperty('inset', '0', 'important');
            container.style.setProperty('width', '100vw', 'important');
            container.style.setProperty('height', '100vh', 'important');
            container.style.setProperty('margin', '0', 'important');
            container.style.setProperty('border', 'none', 'important');
            container.style.setProperty('z-index', '2147483647', 'important');
            container.style.setProperty('background', bg, 'important');
            canvas.style.setProperty('display', 'block', 'important');
            canvas.style.setProperty('width', '100vw', 'important');
            canvas.style.setProperty('height', '100vh', 'important');
            return true;
          },
          stageSize: (w, h) => {
            const r = rendererRef.current;
            const c = cameraRef.current;
            if (!r || !c) return false;
            resizeViewportRenderer({
              renderer: r,
              camera: c,
              width: w,
              height: h,
              pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
              updateStyle: false,
            });
            renderer.render(sceneRef.current, c);
            return true;
          },
          setAxes: (on) => {
            if (axisHelper) axisHelper.visible = !!on;
            return true;
          },
          stageContourSketch: () => {
            const meshes = highlightMeshRef.current;
            return {
              aim: containerRef.current?.getAttribute('data-contour-face-aim') || '',
              highlights: Array.isArray(meshes) ? meshes.length : (meshes ? 1 : 0),
              planePreset: contourModeRef.current?.planePreset || '',
              planeOffset: Number(contourModeRef.current?.planeOffset) || 0,
              planeCenter: Array.isArray(contourModeRef.current?.planeFace?.planeFrame?.center)
                ? contourModeRef.current.planeFace.planeFrame.center.slice()
                : null,
              entry: contourModeRef.current?.entry || '',
              tool: contourModeRef.current?.tool || '',
              sketchLines: (() => {
                const rows = [];
                const walk = (group) => {
                  group?.traverse?.((child) => {
                    if (!child?.userData || child.userData.sketchDashed == null) return;
                    const color = child.material?.color?.getHex?.();
                    rows.push({
                      name: group.name || '',
                      dashed: child.userData.sketchDashed === true,
                      color: Number.isFinite(color) ? color : null,
                    });
                  });
                };
                walk(polylineDraftRef.current);
                walk(contourStatusRef.current);
                return rows;
              })(),
              points: Array.isArray(contourModeRef.current?.params?.points)
                ? contourModeRef.current.params.points.length
                : 0,
              undoDepth: sketchHistRef.current?.depth || 0,
              open: !!contourModeRef.current,
              planeCard: contourPlaneOpenRef.current,
              partOpacity: (() => {
                const mesh = resultRef.current;
                if (!mesh) return null;
                const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
                if (!mats.length) return null;
                return Math.min(...mats.map((m) => Number(m.opacity)));
              })(),
              partTransparent: (() => {
                const mesh = resultRef.current;
                if (!mesh) return false;
                const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
                return mats.some((m) => m.transparent === true);
              })(),
              planeSquare: !!workplaneOverlayRef.current,
              planePreview: (() => {
                const colors = [];
                constructionPlaneRef.current?.traverse?.((child) => {
                  if (child.userData?.kind !== 'constructionPlane') return;
                  const hex = child.material?.color?.getHex?.();
                  if (Number.isFinite(hex)) colors.push(hex);
                });
                return colors;
              })(),
              placements: (contourModeRef.current?.params?.contour?.dimensions || []).map((dim) => ({
                id: dim.id,
                kind: dim.kind,
                placement: Number.isFinite(Number(dim.placement)) ? Number(dim.placement) : null,
              })),
              gesture: contourModeRef.current?.gesture || '',
              dimensionEdit: contourModeRef.current?.dimensionEdit || null,
              constraintEdit: contourModeRef.current?.constraintEdit || null,
              dimensions: contourModeRef.current?.params?.contour?.dimensions?.length || 0,
              dimensionValues: (contourModeRef.current?.params?.contour?.dimensions || [])
                .map((dim) => Number(dim.value)),
              uvs: (() => {
                const contourPts = contourModeRef.current?.params?.contour?.points;
                if (Array.isArray(contourPts) && contourPts.length) {
                  return contourPts.map((p) => ({ id: p.id, u: p.at?.[0], v: p.at?.[1] }));
                }
                const raw = contourModeRef.current?.params?.points;
                if (!Array.isArray(raw)) return [];
                return raw.map((uv, i) => ({ id: `p${i}`, u: uv?.[0], v: uv?.[1] }));
              })(),
              dims: (contourModeRef.current?.params?.contour?.dimensions || []).map((dim) => ({
                id: dim.id,
                kind: dim.kind,
                value: dim.value,
                side: dim.side == null ? null : (dim.side < 0 ? -1 : 1),
              })),
              radius: Number.isFinite(Number(contourModeRef.current?.params?.radius))
                ? Number(contourModeRef.current.params.radius)
                : null,
              width: Number.isFinite(Number(contourModeRef.current?.params?.width))
                ? Number(contourModeRef.current.params.width)
                : null,
              height: Number.isFinite(Number(contourModeRef.current?.params?.height))
                ? Number(contourModeRef.current.params.height)
                : null,
              origin: (() => {
                const o = contourModeRef.current?.params?.origin;
                return [Number(o?.[0]) || 0, Number(o?.[1]) || 0];
              })(),
              constraints: contourModeRef.current?.params?.contour?.constraints?.length || 0,
              picked: (contourModeRef.current?.picks || []).map((pick) => ({
                kind: pick.kind,
                id: pick.id,
              })),
              pickHighlights: {
                points: (polylineDraftRef.current?.userData?.handles || [])
                  .filter((handle) => handle.userData?.picked)
                  .map((handle) => handle.userData.pointId),
                lines: (() => {
                  const ids = [];
                  contourStatusRef.current?.traverse?.((child) => {
                    if (child.userData?.picked && child.userData?.entityId) ids.push(child.userData.entityId);
                  });
                  return [...new Set(ids)];
                })(),
              },
              dots: (() => {
                const camera = cameraRef.current;
                const canvas = canvasRef.current;
                const handles = polylineDraftRef.current?.userData?.handles || [];
                if (!camera || !canvas) return [];
                const rect = canvas.getBoundingClientRect();
                return handles.map((handle) => {
                  handle.getWorldPosition(polylineProjectScratch.current);
                  const v = polylineProjectScratch.current.project(camera);
                  const dot = {
                    id: handle.userData?.pointId || '',
                    x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
                    y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
                    color: handle.material?.color?.getHex?.() ?? null,
                  };
                  return dot;
                });
              })(),
              lines: (() => {
                const out = [];
                const take = (root) => {
                  root?.traverse?.((child) => {
                    if (!child.userData?.sketchLinePx) return;
                    const color = child.material?.color?.getHex?.();
                    if (!Number.isFinite(color)) return;
                    out.push({
                      id: child.userData.entityId || '',
                      kind: child.userData.entityKind || 'line',
                      color,
                    });
                  });
                };
                take(contourStatusRef.current);
                take(xsPreviewRef.current);
                take(polylineDraftRef.current);
                return out;
              })(),
              sketchLinePx: (() => {
                let px = 0;
                const visit = (root) => {
                  root?.traverse?.((child) => {
                    const width = child.material?.linewidth;
                    if (child.material?.isLineMaterial && width) px = width;
                  });
                };
                visit(contourStatusRef.current);
                visit(polylineDraftRef.current);
                visit(xsPreviewRef.current);
                return px;
              })(),
              sketchPointPx: (() => {
                const handle = polylineDraftRef.current?.userData?.handles?.[0];
                const camera = cameraRef.current;
                const canvas = canvasRef.current;
                if (!handle || !camera || !canvas) return 0;
                handle.getWorldPosition(polylineProjectScratch.current);
                const dist = camera.position.distanceTo(polylineProjectScratch.current);
                const height = canvas.clientHeight || 1;
                const zoom = camera.zoom || 1;
                const worldPerPx = (2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist)
                  / (height * zoom);
                if (!(worldPerPx > 0)) return 0;
                return (SKETCH_POINT_RADIUS * handle.scale.x * 2) / worldPerPx;
              })(),
            };
          },
          stagePlaneTool: () => {
            const planes = [];
            constructionPlaneRef.current?.traverse?.((child) => {
              if (child.userData?.kind !== 'constructionPlane') return;
              planes.push(child.userData.jointPlaneId || child.userData.planeId || '');
            });
            let mesh = null;
            workplaneOverlayRef.current?.traverse?.((child) => {
              if (child.isMesh && child.userData?.kind === 'planeToolPreview') mesh = child;
            });
            const at = new Vector3();
            if (mesh) mesh.getWorldPosition(at);
            return {
              toggle: !!showPlanesRef.current,
              planes,
              preview: mesh ? {
                present: true,
                transparent: mesh.material?.transparent === true,
                opacity: Number.isFinite(mesh.material?.opacity) ? mesh.material.opacity : null,
                depthWrite: mesh.material?.depthWrite === true,
                size: mesh.userData.size ?? null,
                center: [at.x, at.y, at.z],
                normal: mesh.userData.normal || null,
              } : { present: false },
            };
          },
          stageContourOverlays: () => {
            const scene = sceneRef.current;
            const counts = { preview: 0, highlight: 0, ghost: 0, names: [] };
            if (!scene) return counts;
            scene.traverse((obj) => {
              const name = obj.name || '';
              if (!name) return;
              const preview = /Preview|crossSectionPreview/.test(name);
              const highlight = name === 'highlight'
                || name === 'edgeSelection'
                || name === 'edgeSelectionOtherPart'
                || name === 'edgeHover'
                || name === 'contourSelected';
              const ghost = name === 'savedContourGhosts'
                || name === 'savedContourGhostsPart'
                || name === 'contourSelected'
                || /^contour(under|full|conflict|Idle)$/.test(name);
              if (!preview && !highlight && !ghost) return;
              counts.names.push(name);
              if (preview) counts.preview += 1;
              if (highlight) counts.highlight += 1;
              if (ghost) counts.ghost += 1;
            });
            return counts;
          },
        };
      }

      const controls = new TrackballControls(camera, renderer.domElement);
      applyTrackballFeel(controls);
      controls.enableRotate = true;
      orbitControls = controls;
      controlsRef.current = controls;

      onPointerDownRotateSpeed = (event) => {
        controls.rotateSpeed = trackballRotateSpeedForPointer(event.pointerType);
      };
      orbitPointerDom = renderer.domElement;
      orbitPointerDom.addEventListener('pointerdown', onPointerDownRotateSpeed);

      // The rail triad button is gone. The helper stays a visual AxesHelper
      // (it does not move a body) and stays hidden.
      axisHelper = new AxesHelper(50);
      applyTriadAxisColors(axisHelper);
      axisHelper.visible = false;
      sceneRef.current.add(axisHelper);

      const animate = () => {
        if (!loopAlive) return;
        rafId = requestAnimationFrame(animate);

        if (!sheetCameraRef.current?.isRestoring() && !faceSketchRef.current?.isAnimating()) {
          controlsRef.current?.update();
        }

        animatePolylineHandles();
        updateEdgeChips();

        if (scene && camera) {
          try {
            renderer.render(scene, camera);
          } catch (error) {
            // Log debug info only on error
            const meshCount = sceneRef.current.children.filter(c => c.type === 'Mesh').length;
            const hasMaterials = resultRef.current?.material && Array.isArray(resultRef.current.material);
            const hasGeometry = resultRef.current?.geometry?.attributes?.position;
            
            console.error('[Animate] Render error:', error.message);
            console.error('[Animate] Scene state:', {
              meshCount,
              hasMaterials,
              hasGeometry,
              resultMaterial: resultRef.current?.material?.length || 'none',
              sceneChildren: sceneRef.current.children.length,
              highlightMeshes: Array.isArray(highlightMeshRef.current) ? highlightMeshRef.current.length : (highlightMeshRef.current ? 1 : 0)
            });
          }
        }
      };
      animate();
    };

    const handleResize = () => {
      if (!initialized) return;

      const { width, height } = getContainerSize();
      if (width === 0 || height === 0) return;

      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (!renderer || !camera) return;

      resizeViewportRenderer({
        renderer,
        camera,
        width,
        height,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        updateStyle: false,
      });
      syncLineMaterialResolution(width, height);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (sceneRef.current) {
        renderer.render(sceneRef.current, camera);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!initialized) {
        initScene();
      } else {
        handleResize();
      }
    });

    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    initScene();

    return () => {
      loopAlive = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
      if (orbitPointerDom && onPointerDownRotateSpeed) {
        orbitPointerDom.removeEventListener('pointerdown', onPointerDownRotateSpeed);
        orbitPointerDom = null;
        onPointerDownRotateSpeed = null;
      }
      if (orbitControls) {
        orbitControls.dispose();
        if (controlsRef.current === orbitControls) controlsRef.current = null;
        orbitControls = null;
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      removeWebglContextLoss();
      removeWebglContextLoss = () => {};
      disposeViewportRenderer(rendererRef.current);
      rendererRef.current = null;
      if (resultRef.current?.geometry) {
        resultRef.current.geometry.dispose();
      }
      clearAssemblyExtrasRef.current();
      clearBlockPreviewRef.current();
      if (ghostMeshRef.current) {
        sceneRef.current?.remove(ghostMeshRef.current);
        ghostMeshRef.current.geometry?.dispose();
        ghostMeshRef.current.material?.dispose();
        ghostMeshRef.current = null;
      }
      clearHighlight();
      endSectionViewRef.current();
      feaHighlightStudyRef.current = null;
      const synced = syncFeaFaceHighlights(feaFaceOverlaysRef.current, null, []);
      feaFaceOverlaysRef.current = synced.overlays;
    };
  }, []);

  // Initialize materials
  useEffect(() => {
    const defineMaterials = () => {
      const matls = [
        makeDefaultPartMaterial(),
        new MeshLambertMaterial({ color: 'red', flatShading: true }),
        new MeshLambertMaterial({ color: 'blue', flatShading: true })
      ];
      setMaterials(matls);

      const result = new ThreeMesh(undefined, matls);
      
      const scene = sceneRef.current;
      if (!scene) return;

      scene.add(result);
      resultRef.current = result;
    };
    defineMaterials();
  }, []);

  // Ghost target overlay for game mode (translucent; distinct from player attempt)
  useEffect(() => {
    let cancelled = false;

    const clearGhost = () => {
      if (ghostMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(ghostMeshRef.current);
        ghostMeshRef.current.geometry?.dispose();
        ghostMeshRef.current.material?.dispose();
        ghostMeshRef.current = null;
      }
    };

    if (!ghostMeshData?.vertProperties || !ghostMeshData?.triVerts) {
      clearGhost();
      return () => { cancelled = true; };
    }

    const tryAdd = () => {
      if (cancelled) return;
      if (!sceneRef.current) {
        requestAnimationFrame(tryAdd);
        return;
      }

      clearGhost();

      const geometry = new BufferGeometry();
      const vertProperties = new Float32Array(ghostMeshData.vertProperties);
      const triVerts = new Uint32Array(ghostMeshData.triVerts);
      geometry.setAttribute('position', new BufferAttribute(vertProperties, 3));
      geometry.setIndex(new BufferAttribute(triVerts, 1));
      geometry.computeVertexNormals();

      // Grey translucent ghost (slice 05) — tip copy must say grey, not cyan.
      const material = new MeshLambertMaterial({
        color: 0x9ca3af,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        flatShading: true,
        side: 2,
        wireframe: false,
        emissive: 0x4b5563,
        emissiveIntensity: 0.12,
      });

      const mesh = new ThreeMesh(geometry, material);
      mesh.name = 'ghostTarget';
      mesh.renderOrder = 1;
      sceneRef.current.add(mesh);
      ghostMeshRef.current = mesh;

      // Frame the ghost when there is no attempt solid yet
      const attemptEmpty = !resultRef.current?.geometry?.attributes?.position?.count;
      if (attemptEmpty && cameraRef.current && fitView) {
        fitView({
          camera: cameraRef.current,
          controls: controlsRef.current,
          geometry,
          // Phone viewports need more margin so the ghost isn't edge-clipped.
          margin: 1.55,
        });
      }
    };

    tryAdd();

    return () => {
      cancelled = true;
      clearGhost();
    };
  }, [ghostMeshData]);

  // Zoom to fit every visible part (keeps the current orbit direction).
  // Hidden rows are not in the scene, so they are not in the box. One
  // visible part is that part's own box.
  const handleNormalToSketch = useCallback(() => {
    const state = contourModeRef.current;
    if (!state) return;
    const plane = selectedLoftDrawFrame(state) || contourWorkplane(state, modelBoundsRef.current);
    const normal = plane?.normal;
    if (!Array.isArray(normal)) return;
    holdSheetSlide();
    setContourFaceAim('');
    requestFaceSketchAim(normal, { force: true });
  }, []);

  const handleZoomToFit = useCallback(() => {
    if (!cameraRef.current) return;
    const meshes = [];
    if (resultRef.current) meshes.push(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) meshes.push(mesh);
    const box = unionWorldBox(meshes);
    if (!box) return;
    holdSheetSlide();
    if (fitView({ camera: cameraRef.current, controls: controlsRef.current, box })) {
      console.log('[Viewport] Zoomed to fit');
    }
  }, []);

  // Snap to a canonical view (iso / front / right / top) and re-fit in the same gesture.
  // Mobile B.1: default view presets (top/right/front/iso/…) frame with more margin
  // than Zoom-to-Fit. Game puzzle enter keeps its own 1.55 framing.
  const handleViewSnap = useCallback((key, margin = VIEW_SNAP_MARGIN) => {
    if (!resultRef.current?.geometry || !cameraRef.current) return false;
    holdSheetSlide();
    // Frame the assembly as placed (every visible part's world box), or the
    // selected part alone when one is picked. The active part's local box
    // aimed at its origin, so a transformed part needed a camera_fit after.
    const meshes = cadBodyStickyRef.current
      ? [resultRef.current]
      : [resultRef.current, ...assemblyExtrasRef.current.values()];
    const box = unionWorldBox(meshes);
    // side / front_of_model read the framed box's longest horizontal extent.
    const preset = VIEW_PRESETS[key] || modelViewPreset(key, box) || VIEW_PRESETS.iso;
    const ok = fitView({
      camera: cameraRef.current,
      controls: controlsRef.current,
      ...(box ? { box } : { geometry: resultRef.current.geometry }),
      dir: preset.dir,
      up: preset.up,
      margin,
    });
    if (ok) console.log(`[Viewport] Snapped to ${preset.label}`);
    return ok;
  }, []);

  agentClearSelectionRef.current = () => {
    clearGeomSelection();
  };

  agentSelectFacesRef.current = ({ keys, names }) => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position;
    const index = geom?.index?.array;
    if (!geom || !positions || !index?.length) {
      return { error: { code: 'no_mesh', message: 'No mesh to select faces on' } };
    }
    syncFeatureEdges(geom);
    const picks = [];
    const pickedNames = [];
    if (Array.isArray(names) && names.length) {
      // Face identity: a name selects the stamped face's own triangles, the
      // exact face the helper built, even when the face graph merged it
      // with a neighbour (a rounded box's top and its band).
      const byName = resolveFaceNames(stampedFaceTable(geom, faceIDsRef.current), names);
      if (byName.error) return byName;
      picks.push(...byName.picks);
      pickedNames.push(...byName.names);
    }
    if (Array.isArray(keys) && keys.length) {
      const fingerprints = fingerprintsFromGeometry(geom, faceIDsRef.current);
      const resolved = resolveFaceKeys(fingerprints, keys);
      if (resolved.error) return resolved;
      picks.push(...resolved.picks);
    }
    if (!picks.length) return { error: { code: 'bad_args', message: 'select_faces needs keys or names' } };
    publishFacePicks(picks, geom, positions, index);
    return pickedNames.length ? { count: picks.length, names: pickedNames } : { count: picks.length };
  };

  const prepareAgentEdgePick = (geom) => {
    syncFeatureEdges(geom);
    const fingerprints = fingerprintsFromGeometry(geom, faceIDsRef.current);
    const rawEdges = buildFeatureEdges(geom);
    const topo = boundaryTopoRef.current;
    const annotated = topo?.edges?.length
      ? annotateFeatureEdges(rawEdges, topo)
      : rawEdges;
    const table = stampedFaceTable(geom, faceIDsRef.current);
    return { fingerprints, rawEdges, topo, annotated, table };
  };

  /** A string key with `~` is an edge name (`plate.top~boss.side`, `[k]`, `*`). */
  const isEdgeNameKey = (key) => typeof key === 'string' && key.includes('~');

  const expandAgentEdgeKeys = (prep, keys) => {
    const list = Array.isArray(keys) ? keys : [];
    const graph = {
      coherent: featureEdgesRef.current || [],
      annotated: prep.annotated,
      topo: prep.topo,
    };
    const resolvedRows = [];
    // Edge identity: names resolve on the stamped table, the same way
    // select_edges { names } does; eN ids and face-key pairs keep working.
    const names = list.filter(isEdgeNameKey);
    if (names.length) {
      const byName = resolveEdgeNames(prep.table, prep.rawEdges, names);
      if (byName.error) return byName;
      const partId = activePartIdRef.current;
      resolvedRows.push(...byName.edges.map((row) => (partId ? { ...row, partId: String(partId) } : row)));
    }
    const others = list.filter((key) => !isEdgeNameKey(key));
    if (others.length) {
      const resolved = resolveEdgeKeys(
        prep.rawEdges,
        others,
        activePartIdRef.current,
        prep.fingerprints,
        prep.topo,
      );
      if (resolved.error) return resolved;
      resolvedRows.push(...resolved.edges);
    }
    const edges = expandResolvedEdgesForHelper(resolvedRows, graph);
    if (!edges.length) {
      return { error: { code: 'unknown_edge', message: 'Edge key did not resolve to pickable geometry' } };
    }
    return { edges };
  };

  agentSelectEdgesRef.current = ({ keys, names }) => {
    const geom = resultRef.current?.geometry;
    if (!geom) {
      return { error: { code: 'no_mesh', message: 'No mesh to select edges on' } };
    }
    const prep = prepareAgentEdgePick(geom);
    const edges = [];
    const pickedNames = [];
    if (Array.isArray(names) && names.length) {
      // Face identity: `a~b` is every feature-edge segment where the two
      // named faces meet.
      const byName = resolveEdgeNames(stampedFaceTable(geom, faceIDsRef.current), prep.rawEdges, names);
      if (byName.error) return byName;
      edges.push(...byName.edges);
      pickedNames.push(...byName.names);
    }
    if (Array.isArray(keys) && keys.length) {
      const out = expandAgentEdgeKeys(prep, keys);
      if (out.error) return out;
      edges.push(...out.edges);
    }
    if (!edges.length) return { error: { code: 'bad_args', message: 'select_edges needs keys or names' } };
    setSelectedEdges(edges);
    highlightSelectedEdges(edges);
    return pickedNames.length ? { count: edges.length, names: pickedNames } : { count: edges.length };
  };

  const atKeyIndex = (error, index) => ({
    ...error,
    message: `${error.message} (key at index ${index})`,
    details: { ...(error.details || {}), index },
  });

  // H9 pick sessions. Same state a tap writes; see agent/pick/viewportPicks.js.
  const agentPickModeRefs = {
    filletEdges: filletModeRef,
    chamferEdges: filletModeRef,
    shell: shellModeRef,
    addDraft: draftModeRef,
    moveFace: moveFaceModeRef,
    deleteFace: deleteFaceModeRef,
  };
  agentPickDepsRef.current = {
    modes: () => ({
      game: mode === 'game',
      fillet: filletModeRef.current,
      shell: !!shellModeRef.current,
      draft: !!draftModeRef.current,
      moveFace: !!moveFaceModeRef.current,
      deleteFace: !!deleteFaceModeRef.current,
      cut: !!cutModeRef.current,
      boolean: !!booleanModeRef.current,
      move: !!moveModeRef.current,
      rotate: !!rotateModeRef.current,
      mirror: !!mirrorModeRef.current,
      contour: !!contourModeRef.current,
      featureSlot: !!featureSlotsRef.current,
      paint: !!paintModeRef.current,
      measure: !!measurementEnabledRef.current,
      sheetMetal: !!(sheetMetalModeRef.current || sheetMetalPicker),
      hole: !!holeCardRef.current,
      joints: !!jointPickingRef.current,
      fea: feaActive,
      featureEdit: !!featureEditRef.current,
    }),
    opening: () => !!featureEditRef.current?.opening,
    editing: () => !!featureEditRef.current?.feature,
    hasMesh: () => !!resultRef.current?.geometry,
    toast: () => filletToast || shellToast,
    selectedEdges: () => selectedEdgesRef.current,
    facePicks: () => facePickGroupRef.current?.picks || null,
    selectedFace: () => selectedFaceRef.current,
    toolState: (tool) => agentPickModeRefs[tool]?.current || null,
    commitToolState: (tool, next) => {
      if (tool === 'moveFace') commitMoveFaceState(next);
      else if (tool === 'deleteFace') commitDeleteFaceState(next);
      else if (tool === 'addDraft') {
        draftModeRef.current = next;
        setDraftMode(next);
        paintDraftPicks(next);
      } else if (tool === 'shell') {
        shellModeRef.current = next;
        setShellMode(next);
      } else if (agentPickModeRefs[tool]) {
        filletModeRef.current = next;
        setFilletMode(next);
      }
    },
    resolveFaces: (keys) => {
      const geom = resultRef.current?.geometry;
      syncFeatureEdges(geom);
      const fingerprints = fingerprintsFromGeometry(geom, faceIDsRef.current);
      const groups = [];
      for (let i = 0; i < keys.length; i++) {
        const out = resolveFaceKeys(fingerprints, [keys[i]]);
        if (out.error?.code === 'ambiguous_face') return { error: ambiguousFaceError(fingerprints, keys[i], i) };
        if (out.error) return { error: atKeyIndex(out.error, i) };
        groups.push(out.picks);
      }
      return { groups };
    },
    resolveEdges: (keys) => {
      const prep = prepareAgentEdgePick(resultRef.current?.geometry);
      const groups = [];
      for (let i = 0; i < keys.length; i++) {
        const out = expandAgentEdgeKeys(prep, [keys[i]]);
        if (out.error) return { error: atKeyIndex(out.error, i) };
        groups.push(out.edges);
      }
      return { groups };
    },
    pickMode: () => pickModeRef.current,
    // The Face / Edge toggle, without its first-use toast.
    setPickMode: (kind) => {
      pickModeRef.current = kind;
      setPickMode(kind);
      if (kind === 'edge') {
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
        rebuildFeatureEdges();
      } else {
        clearEdgeHover();
        clearEdgeHighlight();
      }
    },
    writeFaces: (faces, { selection }) => {
      const geom = resultRef.current?.geometry;
      if (selection) {
        clearEdgeHighlight();
        setSelectedEdges([]);
      }
      publishFacePicks(faces, geom, geom?.attributes?.position, geom?.index?.array);
    },
    writeEdges: (edges, { selection }) => {
      if (selection) {
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
      }
      clearEdgeHover();
      setSelectedEdges(edges);
      if (edges.length) highlightSelectedEdges(edges);
      else clearEdgeHighlight();
    },
    enter: (tool) => {
      onFeatureOpen?.({ id: tool });
      if (tool === 'filletEdges' || tool === 'chamferEdges') enterFilletMode({ entry: tool });
      else if (tool === 'shell') enterShellMode();
      else if (tool === 'addDraft') enterDraftMode();
      else if (tool === 'moveFace') enterMoveFaceMode();
      else if (tool === 'deleteFace') enterDeleteFaceMode();
    },
    accept: (tool) => {
      if (tool === 'holeCentres') confirmContourProfile();
      else if (tool === 'filletEdges' || tool === 'chamferEdges') acceptFillet();
      else if (tool === 'shell') acceptShell();
      else if (tool === 'addDraft') acceptDraft();
      else if (tool === 'moveFace') acceptMoveFace();
      else if (tool === 'deleteFace') acceptDeleteFace();
    },
    exit: (tool) => {
      if (tool === 'filletEdges' || tool === 'chamferEdges') exitFilletMode();
      else if (tool === 'shell') exitShellMode();
      else if (tool === 'addDraft') exitDraftMode();
      else if (tool === 'moveFace') exitMoveFaceMode();
      else if (tool === 'deleteFace') exitDeleteFaceMode();
    },
    contourState: () => contourModeRef.current,
    contourPlaneOpen: () => contourPlaneOpenRef.current,
    commitContourState: (next) => {
      contourLiveWriteRef.current = next;
      contourModeRef.current = next;
      setContourMode(next);
    },
    sketchPickInfo: () => agentSketchPickRef.current.sketchPickInfo(),
    sketchPickRead: () => agentSketchPickRef.current.sketchPickRead(),
    sketchPickResolve: (args) => agentSketchPickRef.current.sketchPickResolve(args),
    sketchPickWrite: (args) => agentSketchPickRef.current.sketchPickWrite(args),
    sketchPickEnter: (args) => agentSketchPickRef.current.sketchPickEnter(args),
  };

  agentSetCameraRef.current = async ({ view, position, target, fov, up }) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera) return { ok: false };
    if (view === 'normal_to_sketch') {
      handleNormalToSketch();
      return { ok: true };
    }
    if (typeof view === 'string' && (VIEW_PRESETS[view] || MODEL_VIEWS[view])) {
      const ok = handleViewSnap(view);
      return ok ? { ok: true } : { ok: false };
    }
    const visible = agentHostRef?.current?.readAgentVisible?.();
    const ease = visible?.enabled === true && visible?.easeCamera !== false;
    const renderFrame = () => {
      if (rendererRef.current && sceneRef.current && camera) {
        rendererRef.current.render(sceneRef.current, camera);
      }
    };
    if (ease && (position || target || fov)) {
      const animated = await animateCameraPose({
        camera,
        controls,
        position,
        target,
        fov,
        up,
        durationMs: 420,
        onFrame: renderFrame,
      });
      if (animated) {
        renderFrame();
        return { ok: true };
      }
    }
    const ok = applyCameraPose({ camera, controls, position, target, fov, up });
    if (ok) renderFrame();
    return { ok };
  };

  agentFitCameraRef.current = () => {
    handleZoomToFit();
    return !!cameraRef.current;
  };

  const meshGeometryForAgentPart = (partId) => {
    const active = activePartIdRef.current;
    if (partId == null || partId === '' || String(partId) === String(active)) {
      return resultRef.current?.geometry ?? null;
    }
    const mesh = assemblyExtrasRef.current.get(String(partId))
      || assemblyExtrasRef.current.get(partId);
    return mesh?.geometry ?? null;
  };

  const faceIDsForAgentPart = (partId, geom) => {
    const active = activePartIdRef.current;
    if (partId == null || partId === '' || String(partId) === String(active)) {
      return faceIDsRef.current;
    }
    const attr = geom?.getAttribute?.('faceID');
    return attr?.array?.length ? attr.array : null;
  };

  /**
   * Edge identity: the named edge each picked or feature edge lies on, per
   * part (indices are per geometry, so rows are grouped by partId and
   * annotated against that part's stamped table). The Fillet and Chamfer
   * emitters write `edgesNamed` from `edgeName`; the edit card resolves
   * stored names against these rows.
   */
  const withEdgeNames = (edges) => {
    const list = Array.isArray(edges) ? edges : [];
    if (!list.length) return list;
    const byPart = new Map();
    list.forEach((edge, i) => {
      const pid = edge?.partId != null && edge.partId !== '' ? String(edge.partId) : '';
      let rows = byPart.get(pid);
      if (!rows) { rows = []; byPart.set(pid, rows); }
      rows.push(i);
    });
    const out = list.slice();
    for (const [pid, indices] of byPart) {
      const geom = meshGeometryForAgentPart(pid || null);
      if (!geom) continue;
      let table = null;
      try { table = stampedFaceTable(geom, faceIDsForAgentPart(pid || null, geom)); } catch { table = null; }
      if (!table?.edges?.length) continue;
      const named = edgeNamesForPicks(table, indices.map((i) => list[i]));
      indices.forEach((i, k) => { out[i] = named[k]; });
    }
    return out;
  };
  withEdgeNamesRef.current = withEdgeNames;

  const featureRigidForAgentPart = (partId) => {
    const active = activePartIdRef.current;
    if (partId == null || partId === '' || String(partId) === String(active)) {
      return featureRigidRef.current || cachedMeshDataRef.current?.featureRigid || null;
    }
    const extra = assemblyExtrasRef.current.get(partId);
    return extra?.userData?.featureRigid || null;
  };

  const poseListedEdges = (listed, matrix) => {
    if (!listed || !matrix || !Array.isArray(listed.edges)) return listed;
    return {
      ...listed,
      edges: listed.edges.map((edge) => {
        const row = poseEdgeRecord(edge, matrix);
        if (row.faceKeyA) row.faceKeyA = poseFaceRecord(row.faceKeyA, matrix);
        if (row.faceKeyB) row.faceKeyB = poseFaceRecord(row.faceKeyB, matrix);
        return row;
      }),
    };
  };

  const agentCatalogForPart = (partId) => {
    const geom = meshGeometryForAgentPart(partId);
    if (!geom) return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    const faceIDs = faceIDsForAgentPart(partId, geom);
    const cacheEntry = liveSolidEntryForGeometry(solidCacheRef.current, geom);
    const catalog = poseAgentCatalog(
      agentFaceCatalog(geom, faceIDs, cacheEntry),
      featureRigidForAgentPart(partId),
    );
    return { geom, faceIDs, catalog };
  };

  /**
   * Bodies of the active part's mesh, in mesh component order, each with the
   * centroid `move()` takes as `{ at }` (snapped to the kernel centroid the
   * worker reported). `body_index` on insert_move indexes this list.
   */
  const agentMeshBodies = () => {
    const geom = resultRef.current?.geometry;
    if (!geom?.attributes?.position || !geom.index) return null;
    const kernel = bodyCentroidsRef.current || [];
    const rigid = featureRigidRef.current;
    return meshBodyComponents(geom.attributes.position, geom.index).map((body, index) => {
      const at = rigid ? transformPoint(rigid, body.at) : body.at;
      return {
        index,
        at: snapMoveBodyAt(at, kernel),
        triangles: body.triangles,
        triangleCount: body.triangles.length,
      };
    });
  };
  agentReadBodiesRef.current = () => {
    const partId = activePartIdRef.current != null && activePartIdRef.current !== '' ? String(activePartIdRef.current) : null;
    const bodies = agentMeshBodies();
    if (!bodies) return { partId, bodies: [] };
    return {
      partId,
      bodies: bodies.map((body) => ({ index: body.index, at: body.at.slice(), triangleCount: body.triangleCount })),
    };
  };
  /**
   * The body insert_move names: by `body_index` (list_bodies), by a centroid
   * `at`, by a face (`face` key or `face_id` from list_faces), else the
   * selected face. Nothing picked is `no_body`; the origin is never assumed.
   */
  agentResolveMoveAnchorRef.current = ({
    at = null, face = null, faceId = null, bodyIndex = null, useSelection = false,
  } = {}) => {
    const bodies = agentMeshBodies();
    if (!bodies) return { error: { code: 'no_mesh', message: 'Run the part before insert_move; it has no mesh yet' } };
    const needBody = {
      code: 'no_body',
      message: 'insert_move needs a body: pass body_index or at (from list_bodies), face or face_id (from list_faces), or select a face first.',
    };
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const byTriangle = (tri) => bodies.find((body) => body.triangles.includes(tri)) || null;
    const picked = (body) => ({ at: body.at.slice(), bodyIndex: body.index });
    if (bodyIndex != null) {
      const body = Number.isInteger(bodyIndex) ? bodies[bodyIndex] : null;
      if (!body) {
        return { error: { code: 'no_body', message: `body_index ${JSON.stringify(bodyIndex)} is not one of the ${bodies.length} bodies; call list_bodies` } };
      }
      return picked(body);
    }
    if (at != null) {
      const point = Array.isArray(at) ? at.slice(0, 3).map(Number) : [];
      if (point.length < 3 || point.some((v) => !Number.isFinite(v))) {
        return { error: { code: 'bad_args', message: 'at must be [x, y, z] in mm' } };
      }
      const snapped = snapMoveBodyAt(point, bodyCentroidsRef.current || []);
      const body = bodies.find((row) => d2(row.at, snapped) <= 1e-4) || null;
      if (!body) {
        return { error: { code: 'no_body', message: `at ${JSON.stringify(point)} is not a body centroid; call list_bodies and pass one of its at points` } };
      }
      return picked(body);
    }
    if (faceId != null || (face && typeof face === 'object')) {
      const resolved = agentCatalogForPart(null);
      if (resolved.error) return resolved;
      const hit = findAgentFace(resolved.catalog, { faceId, key: face });
      if (hit.error) return hit;
      const tri = Array.isArray(hit.face?.tris) ? hit.face.tris[0] : null;
      const body = tri != null ? byTriangle(tri) : null;
      if (!body) return { error: needBody };
      return picked(body);
    }
    if (useSelection) {
      const sel = selectedFaceRef.current;
      const tris = sel?.triangles || sel?.indices || sel?.tris;
      const tri = Array.isArray(tris) && tris.length ? tris[0] : null;
      const body = tri != null ? byTriangle(tri) : null;
      if (!body) return { error: needBody };
      return picked(body);
    }
    return { error: needBody };
  };
  agentListFacesRef.current = ({ partId } = {}) => {
    const resolved = agentCatalogForPart(partId);
    if (resolved.error) return resolved;
    const listed = buildFaceList(resolved.catalog);
    return {
      partId: partId != null && partId !== '' ? String(partId) : (activePartIdRef.current || null),
      ...listed,
    };
  };

  agentMoldFitRef.current = async ({ partId, pull } = {}) => {
    const geom = meshGeometryForAgentPart(partId);
    if (!geom) return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    const chosen = pull != null ? pull : sharedMoldPull();
    const faceIDs = faceIDsForAgentPart(partId, geom);
    const token = `fit-${moldJobGenRef.current + 1}-${Date.now()}`;
    const show = !moldProgressRef.current;
    if (show) putMoldProgress({ tool: 'pull', stage: 'Pull direction', percent: 0, gen: token });
    const message = moldAnalysisMessage(geom, faceIDs);
    if (!message) {
      if (show) putMoldProgress((cur) => (cur && cur.gen === token ? null : cur));
      return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    }
    const analyzed = await requestMoldAnalysis({
      ...message,
      pull: chosen,
      onProgress: (info) => {
        if (!show) return;
        putMoldProgress((cur) => (cur && cur.gen === token
          ? { tool: 'pull', stage: info.stage, percent: info.percent, gen: token }
          : cur));
      },
    });
    if (show) putMoldProgress((cur) => (cur && cur.gen === token ? null : cur));
    if (analyzed?.error) return analyzed;
    if (analyzed?.dropped) {
      return { error: { code: 'internal', message: 'Mold analysis was cancelled' } };
    }
    const packed = { ...analyzed };
    delete packed.dfm;
    return {
      partId: partId != null && partId !== '' ? String(partId) : (activePartIdRef.current || null),
      frame: 'local',
      ...packed,
    };
  };

  agentDescribeJointPickRef.current = ({ partId, key, kind, faceId } = {}) => {
    const resolved = agentCatalogForPart(partId);
    if (resolved.error) return resolved;
    return describeJointPick({
      key,
      kind,
      faceId,
      geometry: resolved.geom,
      faceIDs: resolved.faceIDs,
      catalog: resolved.catalog,
    });
  };

  agentListEdgesRef.current = ({ partId } = {}) => {
    const geom = meshGeometryForAgentPart(partId);
    if (!geom) return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    syncFeatureEdges(geom);
    const fingerprints = fingerprintsFromGeometry(geom, faceIDsRef.current);
    const rawEdges = buildFeatureEdges(geom);
    const listed = buildEdgeList(rawEdges, fingerprints, stampedFaceTable(geom, faceIDsForAgentPart(partId, geom)));
    return {
      partId: partId != null && partId !== '' ? String(partId) : (activePartIdRef.current || null),
      raw: true,
      ...poseListedEdges(listed, featureRigidForAgentPart(partId)),
    };
  };

  agentListFeatureEdgesRef.current = ({ partId } = {}) => {
    const geom = meshGeometryForAgentPart(partId);
    if (!geom) return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    // Edge identity: one row per named edge of the mesh that is shown (the
    // rollback bar included), with face keys from the list_faces catalog.
    const faceIDs = faceIDsForAgentPart(partId, geom);
    const table = stampedFaceTable(geom, faceIDs);
    const fingerprints = fingerprintsFromGeometry(geom, faceIDs);
    const listed = buildNamedEdgeList(table, fingerprints, buildFeatureEdges(geom));
    return {
      partId: partId != null && partId !== '' ? String(partId) : (activePartIdRef.current || null),
      grouped: true,
      named: true,
      ...poseListedEdges(listed, featureRigidForAgentPart(partId)),
    };
  };

  agentSketchBeginRef.current = (args = {}) => {
    if (mode === 'game') {
      return { error: { code: 'bad_view', message: 'Sketch is not available in game mode' } };
    }
    const entry = args.entry === 'workplane' ? 'workplane' : 'crossSection';
    if (contourModeRef.current) {
      return { error: { code: 'sketch_open', message: 'Close the open sketch before starting another' } };
    }
    if (featureSlotsRef.current && isSolidContourEntry(featureSlotsRef.current.kind)) {
      return { error: { code: 'slot_open', message: 'Close the feature slot card before opening a sketch' } };
    }
    const preset = args.plane;
    if (preset === 'x' || preset === 'y' || preset === 'z') {
      setSelectedFace(null);
      clearHighlight();
      onFaceSelected?.(null);
      setSelectedPlaneId(null);
    }
    enterContourMode({ entry });
    const accept = args.accept_plane !== false;
    const offset = args.offset;
    if (accept || offset != null) {
      const scheduleAutoAcceptPlane = () => {
        let attempts = 120;
        const tick = () => {
          if (!contourModeRef.current) return;
          if (offset != null && contourPlaneOpenRef.current) {
            setContourMode((prev) => {
              if (!prev) return prev;
              const next = applyContourPlaneEdit(prev, { offset });
              contourModeRef.current = next;
              return next;
            });
          }
          if (accept && contourPlaneOpenRef.current) {
            startContourDrawing();
            return;
          }
          if (attempts-- > 0) window.setTimeout(tick, 16);
        };
        window.setTimeout(tick, 0);
      };
      scheduleAutoAcceptPlane();
    }
    return { result: { entry, accept_plane: accept } };
  };

  agentSketchAcceptPlaneRef.current = (args = {}) => {
    if (!contourModeRef.current) {
      return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
    }
    if (!contourPlaneOpenRef.current) {
      return { result: { ok: true, already: true } };
    }
    if (args.offset != null) {
      setContourMode((prev) => {
        if (!prev) return prev;
        const next = applyContourPlaneEdit(prev, { offset: args.offset });
        contourModeRef.current = next;
        return next;
      });
    }
    startContourDrawing();
    return { result: { ok: true } };
  };

  agentSketchAddRef.current = ({ tool, params }) => {
    const prev = contourModeRef.current;
    if (!prev) {
      return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
    }
    if (contourPlaneOpenRef.current) {
      return { error: { code: 'plane_card_open', message: 'Call sketch_accept_plane before sketch_add' } };
    }
    if (tool === 'arc' || tool === 'dimension' || tool === 'constraints') {
      const next = armContourGesture(prev, tool);
      contourLiveWriteRef.current = next;
      contourModeRef.current = next;
      setContourMode(next);
      return { result: { tool, gesture: tool } };
    }
    const switched = switchContourTool(prev, tool);
    let next = {
      ...switched,
      params: { ...(switched.params || {}), ...(params || {}) },
    };
    if (isHoleEntry(next.entry) && next.tool === 'rectangle') {
      next = materializeHoleRectangleCenters(next);
    }
    // Write the live sketch before React flushes. pick_points reads the
    // ref on the next agent call; cadPartId/ribbon renders must not leave
    // it on the previous tool (unknown_entity for arc a0).
    contourLiveWriteRef.current = next;
    contourModeRef.current = next;
    setContourMode(next);
    return { result: { tool } };
  };

  const agentContourGesturePlan = (applied, meta) => {
    if (applied?.error) return { error: applied.error };
    const state = applied.state;
    if (!state?.params?.contour) {
      return { error: { code: 'no_contour', message: 'Contour gesture did not produce a profile' } };
    }
    if (contourPlaneOpenRef.current) {
      return { error: { code: 'plane_card_open', message: 'Call sketch_accept_plane before sketch gestures' } };
    }
    if (contourEditRef.current) {
      // Editing a saved contour: the gesture stays live in the sketch and the
      // rail checkmark / sketch_commit rewrites the contour by id, the same
      // way a pointer gesture does (saveContourBlock skips the write too).
      // sketch_edit and sketch_dimension / sketch_constrain on a reopened
      // contour land here.
      contourLiveWriteRef.current = state;
      contourModeRef.current = state;
      setContourMode(state);
      return { live: true, result: meta };
    }
    const buf = (typeof getHelperBufferRef.current === 'function' ? getHelperBufferRef.current() : '') || '';
    const minted = state.contourId ? null : mintContourIdentity(buf);
    const contourId = state.contourId || minted?.id;
    const contourName = state.contourName || minted?.name;
    if (!contourId) {
      return { error: { code: 'internal', message: 'Could not mint contour id' } };
    }
    const commitFace = activeContourFace(state, modelBoundsRef.current);
    const nextState = { ...state, contourId, contourName };
    agentPendingSketchGestureRef.current = nextState;
    return {
      payload: {
        partId: activePartIdRef.current,
        face: state.planeFace || commitFace,
        tool: state.tool,
        params: state.params,
        entry: state.entry,
        contourBlock: true,
        contourId,
        contourName,
        planeOffset: Number(state.planeOffset) || 0,
      },
      result: meta,
    };
  };

  agentPrepareSketchDimensionRef.current = (args = {}) => {
    if (!contourModeRef.current) {
      return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
    }
    if (mode === 'game') {
      return { error: { code: 'bad_view', message: 'Sketch is not available in game mode' } };
    }
    const applied = applySketchDimension(contourModeRef.current, args);
    return agentContourGesturePlan(applied, {
      dimensionId: applied.dimensionId,
      kind: applied.kind,
    });
  };

  agentPrepareSketchConstrainRef.current = (args = {}) => {
    if (!contourModeRef.current) {
      return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
    }
    if (mode === 'game') {
      return { error: { code: 'bad_view', message: 'Sketch is not available in game mode' } };
    }
    const applied = applySketchConstrain(contourModeRef.current, args);
    return agentContourGesturePlan(applied, {
      constraintId: applied.constraintId,
      kind: applied.kind,
    });
  };

  agentSketchCancelRef.current = () => {
    if (!contourModeRef.current && !contourPlaneOpenRef.current) {
      return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
    }
    cancelContourEditor();
    return { result: { ok: true } };
  };

  agentPrepareHoleCommitRef.current = () => {
    const state = contourModeRef.current;
    if (!state || !isHoleEntry(state.entry)) {
      return { error: { code: 'no_hole_sketch', message: 'Hole centres sketch is not open' } };
    }
    if (contourPlaneOpenRef.current) {
      return { error: { code: 'plane_card_open', message: 'Call sketch_accept_plane before hole_commit' } };
    }
    if (holeCentresEditRef.current) {
      const contour = holeSketchContour(state) || { points: [] };
      return {
        payload: {
          editCentres: true,
          partId: activePartIdRef.current,
          contourId: holeCentresEditRef.current.id,
          contour,
          frame: planeFromContourFace(activeContourFace(state, modelBoundsRef.current)),
          planeOffset: Number(state.planeOffset) || 0,
        },
      };
    }
    const contour = holeSketchContour(state);
    if (!contour?.points?.length) {
      return { empty: true, payload: null };
    }
    return {
      payload: {
        partId: activePartIdRef.current,
        frame: planeFromContourFace(activeContourFace(state, modelBoundsRef.current)),
        contour,
        spec: state.holeSpec || holeSpecRef.current || {},
        planeOffset: Number(state.planeOffset) || 0,
      },
    };
  };

  agentPrepareSketchCommitRef.current = () => {
    const state = contourModeRef.current;
    if (!state) {
      return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
    }
    if (contourPlaneOpenRef.current) {
      return { error: { code: 'plane_card_open', message: 'Call sketch_accept_plane before sketch_commit' } };
    }
    if (isHoleEntry(state.entry)) {
      return agentPrepareHoleCommitRef.current();
    }
    if (
      cursorSketchEmpty(state)
      && !isSolidContourEntry(state.entry)
      && !isWorkplaneEntry(state.entry)
    ) {
      return { error: { code: 'empty_sketch', message: 'Sketch has no profile to commit' } };
    }
    if (!isWorkplaneEntry(state.entry)) {
      const gate = validateContourProfile(state.tool, state.params);
      if (!gate.ok) {
        return {
          error: {
            code: 'invalid_profile',
            message: gate.message || 'Invalid sketch profile',
          },
        };
      }
    }
    const bounds = modelBoundsRef.current;
    const commitFace = activeContourFace(state, bounds);
    if (contourEditRef.current) {
      // A reopened saved contour: the same payload as the rail checkmark, so
      // saveEditedContour rewrites the statement by id, live gestures
      // included, instead of composing a second contour next to it.
      const edit = contourEditRef.current;
      return {
        payload: {
          editContour: true,
          partId: activePartIdRef.current,
          contourId: edit.id,
          contourName: state.contourName || edit.name,
          face: state.planeFace || commitFace,
          tool: state.tool,
          params: state.params,
          planeOffset: Number(state.planeOffset) || 0,
        },
      };
    }
    if (slotReturnRef.current && featureSlotsRef.current) {
      const slot = slotReturnRef.current;
      return {
        payload: {
          partId: activePartIdRef.current,
          face: state.planeFace || commitFace,
          tool: state.tool,
          params: state.params,
          entry: 'crossSection',
          saveAsPath: slot.role === 'path',
          planeOffset: Number(state.planeOffset) || 0,
        },
      };
    }
    const loftState = isLoftEntry(state.entry)
      ? writeLoftSelected(state, {
        tool: state.tool,
        params: { ...(state.params || {}) },
      })
      : state;
    return {
      payload: {
        partId: activePartIdRef.current,
        face: loftState.planeFace || commitFace,
        tool: loftState.tool,
        params: loftState.params,
        entry: loftState.entry,
        extrude: loftState.extrude,
        revolve: loftState.revolve,
        loft: loftState.loft,
        sweep: loftState.sweep,
        edges: selectedEdgesRef.current || [],
        combine: loftState.combine === 'subtract' ? 'subtract' : 'add',
        merge: loftState.combine === 'subtract' ? true : loftState.merge !== false,
        contourId: loftState.contourId || null,
        contourName: loftState.contourName || null,
        planeOffset: Number(loftState.planeOffset) || 0,
      },
    };
  };

  agentSlotOpenRef.current = ({ kind }) => {
    if (mode === 'game') {
      return { error: { code: 'bad_view', message: 'Feature slots are not available in game mode' } };
    }
    if (!isSolidContourEntry(kind)) {
      return { error: { code: 'bad_args', message: 'Unknown feature slot kind' } };
    }
    if (contourModeRef.current) {
      return { error: { code: 'sketch_open', message: 'Close the open sketch before opening a slot card' } };
    }
    openFeatureSlots(kind);
    return { result: { kind } };
  };

  agentSlotAssignContourRef.current = ({ contour_id, role = 'profile', index = 0 }) => {
    const card = featureSlotsRef.current;
    if (!card) {
      return { error: { code: 'no_slot', message: 'Feature slot card is not open' } };
    }
    const read = getHelperBufferRef.current;
    const text = (typeof read === 'function' ? read() : '') || currentScript || '';
    const saved = listSavedContours(text).find(
      (row) => row.id === contour_id || row.name === contour_id,
    );
    if (!saved) {
      return { error: { code: 'unknown_contour', message: `Contour not found: ${contour_id}` } };
    }
    const slot = role === 'station'
      ? { role: 'station', index: Number(index) || 0 }
      : { role };
    const next = assignFeatureSlot(card, slot, saved);
    featureSlotsRef.current = next;
    setFeatureSlots(next);
    return { result: { contour_id: saved.id, contour_name: saved.name, role } };
  };

  agentSlotSetParamsRef.current = (args = {}) => {
    const card = featureSlotsRef.current;
    if (!card) {
      return { error: { code: 'no_slot', message: 'Feature slot card is not open' } };
    }
    let next = card;
    if (card.kind === 'makeExtrude' && card.extrude) {
      next = {
        ...next,
        extrude: {
          ...card.extrude,
          ...(args.distance != null ? { distance: Number(args.distance) } : {}),
          ...(args.sense != null ? { sense: args.sense } : {}),
          ...(args.direction != null ? { direction: args.direction } : {}),
        },
      };
    }
    if (card.kind === 'makeRevolve' && card.revolve) {
      next = {
        ...next,
        revolve: {
          ...card.revolve,
          ...(args.angle != null ? { angle: Number(args.angle) } : {}),
          ...(args.axis != null ? { axis: args.axis } : {}),
          ...(args.segments != null ? { segments: Math.round(Number(args.segments)) } : {}),
          ...(args.sense != null ? { sense: args.sense } : {}),
        },
      };
    }
    if (card.kind === 'makeSweep' && card.sweep) {
      next = {
        ...next,
        sweep: {
          ...card.sweep,
          ...(args.reverse != null ? { reverse: !!args.reverse } : {}),
          ...(args.closed != null ? { closed: !!args.closed } : {}),
        },
      };
    }
    if (args.combine != null) {
      next = { ...next, combine: args.combine === 'subtract' ? 'subtract' : 'add' };
    }
    if (args.merge != null) {
      next = { ...next, merge: !!args.merge };
    }
    if (args.station_index != null && args.station_offset != null && next.stations) {
      next = setFeatureStationOffset(
        next,
        Number(args.station_index) || 0,
        Number(args.station_offset) || 0,
      );
    }
    featureSlotsRef.current = next;
    setFeatureSlots(next);
    return { result: { kind: next.kind } };
  };

  agentSlotCancelRef.current = () => {
    if (!featureSlotsRef.current) {
      return { error: { code: 'no_slot', message: 'Feature slot card is not open' } };
    }
    closeFeatureSlotsRef.current();
    return { result: { ok: true } };
  };

  agentPrepareSlotCommitRef.current = () => {
    const card = featureSlotsRef.current;
    if (!card) {
      return { error: { code: 'no_slot', message: 'Feature slot card is not open' } };
    }
    if (!featureSlotReady(card)) {
      return { error: { code: 'slot_not_ready', message: 'Fill every required contour slot first' } };
    }
    return {
      payload: {
        ...featureSlotCommitPayload(card),
        partId: activePartIdRef.current,
      },
      fromSlot: true,
    };
  };

  agentZoomToSelectionRef.current = () => {
    const geom = resultRef.current?.geometry;
    const positions = geom?.attributes?.position?.array;
    const index = geom?.index?.array;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!geom || !camera || !controls) {
      return { error: { code: 'no_mesh', message: 'No mesh to frame' } };
    }
    const box = new Box3();
    const face = selectedFaceRef.current;
    const edges = selectedEdgesRef.current || [];
    if (face?.indices?.length && positions && index) {
      const bounds = boundsOfTriangles(positions, index, face.indices);
      if (bounds?.min && bounds?.max) {
        box.min.set(bounds.min[0], bounds.min[1], bounds.min[2]);
        box.max.set(bounds.max[0], bounds.max[1], bounds.max[2]);
      }
    } else if (edges.length) {
      const scratch = new Vector3();
      for (const edge of edges) {
        if (edge?.va) {
          scratch.set(edge.va[0], edge.va[1], edge.va[2]);
          box.expandByPoint(scratch);
        }
        if (edge?.vb) {
          scratch.set(edge.vb[0], edge.vb[1], edge.vb[2]);
          box.expandByPoint(scratch);
        }
      }
    }
    if (box.isEmpty()) {
      return { error: { code: 'no_selection', message: 'No face or edge selection to frame' } };
    }
    holdSheetSlide();
    const ok = fitView({ camera, controls, box });
    return ok ? { ok: true } : { ok: false };
  };

  const exitMeasureMode = useCallback(() => {
    if (measureTapTimerRef.current) {
      clearTimeout(measureTapTimerRef.current);
      measureTapTimerRef.current = null;
    }
    pendingMeasureRef.current = null;
    measurePicksRef.current = [];
    setMeasurePicks([]);
    setMeasurementEnabled(false);
    clearMeasureDecor();
    clearHighlight();
  }, [clearMeasureDecor, clearHighlight]);
  exitMeasureModeRef.current = exitMeasureMode;

  const handleMeasurementToggle = () => {
    if (measurementEnabled) {
      exitMeasureMode();
      return;
    }
    if (!allowFeaturePopup()) return;
    const seed = measureSeedFromSelection(
      selectedFace,
      facePickGroupRef.current,
      activePartIdRef.current,
    );
    releaseModesForFea();
    if (helperCardOpenRef.current) setHelperCardOpen(false);
    onFeatureEditCancel?.();
    measurePicksRef.current = seed;
    setMeasurePicks(seed);
    setMeasurementEnabled(true);
  };

  assemblyColorsRef.current = assemblyColors || null;
  readDroppedPaintsRef.current = (colors) => {
    const map = colors && typeof colors === 'object' && !Array.isArray(colors) ? colors : null;
    if (!map) return [];
    const parts = [];
    const push = (mesh) => {
      const surfId = mesh?.userData?.surfId;
      const geometry = mesh?.geometry;
      if (!surfId || !geometry?.attributes?.position?.count) return;
      try {
        const cached = solidEntryForGeometry(solidCacheRef.current, geometry);
        const faces = fingerprintsFromGeometry(geometry, cached?.faceIDs || null);
        if (!faces.length) return;
        parts.push({ surfId: String(surfId), faces });
      } catch {
        /* A graph miss must not fail the run. That part is omitted. */
      }
    };
    push(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) push(mesh);
    return listDroppedFacePaints(parts, map);
  };

  function pullKeyOf(value) {
    if (!Array.isArray(value) || value.length < 3) return 'auto';
    return [0, 1, 2].map((i) => {
      const n = Number(value[i]);
      return Number.isFinite(n) ? n.toFixed(6) : '0';
    }).join(',');
  }

  function endMoldProgress(gen) {
    putMoldProgress((cur) => (cur && cur.gen === gen ? null : cur));
  }

  function moldAnalysisMessage(geometry, faceIDs) {
    const positions = geometry?.attributes?.position?.array;
    const indices = geometry?.index?.array;
    if (!positions || !indices || indices.length < 3) return null;
    let stamped = null;
    try {
      const table = stampedFaceTable(geometry, faceIDs);
      if (table?.triFace && table.faces?.length) {
        stamped = {
          triFace: table.triFace,
          normals: table.faces.map((face) => face.normal),
          names: table.faces.map((face) => face.name),
        };
      }
    } catch {
      stamped = null;
    }
    let patches = null;
    try {
      const graph = warmFaceGraph(geometry, faceIDs);
      patches = graph?.patches || null;
    } catch {
      patches = null;
    }
    return { positions, indices, stamped, patches };
  }

  function rememberMoldAnalysis(geometry, analyzed) {
    if (!analyzed || analyzed.error || analyzed.dropped) return;
    if (analyzed.parting) {
      partingFieldRef.current = {
        geometry,
        parting: analyzed.parting,
        sideActions: analyzed.sideActions || null,
      };
    }
    if (analyzed.moldDraft) {
      moldDraftFieldRef.current = { geometry, moldDraft: analyzed.moldDraft };
    }
    const report = analyzed.dfm || dfmReport(analyzed);
    if (report) dfmFieldRef.current = { geometry, report };
    const quote = quoteFieldRef.current;
    if (!quote || quote.geometry !== geometry) quoteFieldRef.current = { geometry, analysis: analyzed };
    else quote.analysis = analyzed;
  }

  function loadMoldAnalysis(geometry, faceIDs, pull, tool) {
    const key = `${geometry?.uuid || ''}|${pullKeyOf(pull)}`;
    const slot = moldAnalysisRef.current;
    if (slot?.key === key && slot.result && !slot.result.error && !slot.result.dropped) {
      return { gen: null, promise: Promise.resolve(slot.result) };
    }
    if (slot?.key === key && slot.promise) {
      return { gen: moldJobGenRef.current, promise: slot.promise };
    }
    if (slot?.promise) dropMoldJobs();
    const gen = moldJobGenRef.current + 1;
    moldJobGenRef.current = gen;
    putMoldProgress({ tool, stage: 'Pull direction', percent: 0, gen });
    const message = moldAnalysisMessage(geometry, faceIDs);
    if (!message) {
      endMoldProgress(gen);
      return {
        gen,
        promise: Promise.resolve({ error: { code: 'no_mesh', message: 'No mesh for that part' } }),
      };
    }
    let promise;
    promise = requestMoldAnalysis({
      ...message,
      pull,
      onProgress: (info) => {
        if (moldJobGenRef.current !== gen) return;
        putMoldProgress({ tool, stage: info.stage, percent: info.percent, gen });
      },
    }).then((result) => {
      const current = moldAnalysisRef.current;
      if (current?.promise === promise) {
        moldAnalysisRef.current = {
          key,
          promise: null,
          result: result && !result.error && !result.dropped ? result : null,
        };
      }
      return result;
    });
    moldAnalysisRef.current = { key, promise, result: null };
    return { gen, promise };
  }

  const wallFieldMessage = (geometry) => {
    const positions = geometry?.attributes?.position?.array;
    const indices = geometry?.index?.array;
    if (!positions || !indices || indices.length < 3) return null;
    let stamped = null;
    try {
      const table = stampedFaceTable(geometry, faceIDsRef.current);
      if (table?.triFace && table.faces?.length) {
        stamped = {
          triFace: table.triFace,
          normals: table.faces.map((face) => face.normal),
        };
      }
    } catch {
      stamped = null;
    }
    return { positions, indices, stamped };
  };

  const wallLegendPayload = (wall) => {
    const legend = wall ? thicknessLegendModel(wall) : null;
    return {
      on: true,
      nominal: legend?.nominalMm ?? null,
      max: wall?.max ?? null,
      thinMm: legend?.thinMm ?? null,
      thickMm: legend?.thickMm ?? null,
    };
  };

  const clearWallMap = () => {
    wallJobGenRef.current += 1;
    dropWallJobs();
    wallMapOnRef.current = false;
    wallFieldRef.current = null;
    setWallLegend(null);
    detachThicknessSkin(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) detachThicknessSkin(mesh);
    putMoldProgress((cur) => (cur && cur.tool === 'wall' ? null : cur));
  };
  clearWallMapRef.current = clearWallMap;

  const clearParting = () => {
    partingOnRef.current = false;
    partingFieldRef.current = null;
    selectedSideGroupRef.current = null;
    setPartingLegend(null);
    detachPartingSkin(resultRef.current);
    detachSideActionSkin(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) {
      detachPartingSkin(mesh);
      detachSideActionSkin(mesh);
    }
    putMoldProgress((cur) => (cur && cur.tool === 'parting' ? null : cur));
  };
  clearPartingRef.current = clearParting;

  const clearSideActions = () => {
    detachSideActionSkin(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) detachSideActionSkin(mesh);
    putMoldProgress((cur) => (cur && cur.tool === 'side' ? null : cur));
  };
  clearSideActionsRef.current = clearSideActions;

  const clearMoldDraft = () => {
    moldDraftOnRef.current = false;
    moldDraftFieldRef.current = null;
    setMoldDraftLegend(null);
    detachMoldDraftSkin(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) detachMoldDraftSkin(mesh);
    putMoldProgress((cur) => (cur && cur.tool === 'draft' ? null : cur));
  };
  clearMoldDraftRef.current = clearMoldDraft;

  const paintWallField = (wall, geometry, pending) => {
    clearParting();
    clearSideActions();
    clearMoldDraft();
    wallMapOnRef.current = true;
    wallFieldRef.current = { geometry, wall, pending: !!pending };
    setWallLegend(thicknessLegendModel(wall));
    syncThicknessSkin(resultRef.current, wall);
  };

  const showParting = (parting, geometry, sideActions = null) => {
    clearWallMap();
    clearMoldDraft();
    detachSideActionSkin(resultRef.current);
    partingOnRef.current = true;
    const groups = sideActions?.groups || [];
    const selected = groups.some((group) => group.id === selectedSideGroupRef.current)
      ? selectedSideGroupRef.current
      : null;
    selectedSideGroupRef.current = selected;
    partingFieldRef.current = { geometry, parting, sideActions };
    setPartingLegend(splitLegendModel(parting, sideActions, selected));
    syncPartingSkin(resultRef.current, parting, sideActions, selected);
  };

  applyWallSkinRef.current = (host) => {
    if (!host) return;
    if (!wallMapOnRef.current || host !== resultRef.current) {
      detachThicknessSkin(host);
      return;
    }
    const geometry = host.geometry;
    const cached = wallFieldRef.current;
    if (cached && cached.geometry === geometry && (cached.pending || cached.wall)) {
      if (cached.wall) syncThicknessSkin(host, cached.wall);
      return;
    }
    const message = wallFieldMessage(geometry);
    if (!message) {
      clearWallMap();
      return;
    }
    const gen = wallJobGenRef.current + 1;
    wallJobGenRef.current = gen;
    wallFieldRef.current = { geometry, pending: true };
    dropMoldJobs();
    moldAnalysisRef.current = null;
    putMoldProgress({ tool: 'wall', stage: 'Wall thickness', percent: 0, gen });
    requestWallField({
      ...message,
      onProgress: (info) => {
        if (wallJobGenRef.current !== gen || !wallMapOnRef.current) return;
        putMoldProgress({ tool: 'wall', stage: info.stage, percent: info.percent, gen });
      },
      onCoarse: (coarse) => {
        if (wallJobGenRef.current !== gen || !wallMapOnRef.current) return;
        if (resultRef.current?.geometry !== geometry) return;
        if (coarse?.error || coarse?.wall?.nominal == null) return;
        paintWallField(coarse.wall, geometry, true);
      },
    }).then((analyzed) => {
      if (wallJobGenRef.current !== gen || !wallMapOnRef.current) return;
      if (resultRef.current?.geometry !== geometry) return;
      if (analyzed?.dropped || analyzed?.error || analyzed?.wall?.nominal == null) {
        if (!analyzed?.dropped) clearWallMap();
        return;
      }
      paintWallField(analyzed.wall, geometry, false);
      if (wallJobGenRef.current === gen) endMoldProgress(gen);
    }).catch(() => {
      if (wallJobGenRef.current !== gen || !wallMapOnRef.current) return;
      clearWallMap();
    });
  };

  applyPartingSkinRef.current = (host) => {
    if (!host) return;
    if (!partingOnRef.current || host !== resultRef.current) {
      detachPartingSkin(host);
      return;
    }
    const geometry = host.geometry;
    const cached = partingFieldRef.current;
    if (cached && cached.geometry === geometry && cached.parting) {
      syncPartingSkin(host, cached.parting, cached.sideActions, selectedSideGroupRef.current);
      return;
    }
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'parting');
    promise.then((analyzed) => {
      if (!partingOnRef.current || resultRef.current?.geometry !== geometry) return;
      if (gen != null && moldJobGenRef.current !== gen) return;
      if (analyzed?.dropped) return;
      if (analyzed?.error || !analyzed?.parting) {
        clearParting();
        if (gen != null) endMoldProgress(gen);
        return;
      }
      rememberMoldAnalysis(geometry, analyzed);
      setPartingLegend(splitLegendModel(analyzed.parting, analyzed.sideActions, selectedSideGroupRef.current));
      syncPartingSkin(host, analyzed.parting, analyzed.sideActions, selectedSideGroupRef.current);
      if (gen != null) endMoldProgress(gen);
    }).catch(() => {
      if (gen != null && moldJobGenRef.current === gen) clearParting();
    });
  };

  agentMoldWallMapRef.current = async ({ on } = {}) => {
    const next = typeof on === 'boolean' ? on : !wallMapOnRef.current;
    if (!next) {
      clearWallMap();
      return { on: false };
    }
    const geometry = resultRef.current?.geometry;
    const message = wallFieldMessage(geometry);
    if (!message) {
      return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    }
    const gen = wallJobGenRef.current + 1;
    wallJobGenRef.current = gen;
    wallMapOnRef.current = true;
    wallFieldRef.current = { geometry, pending: true };
    clearParting();
    clearSideActions();
    clearMoldDraft();
    dropMoldJobs();
    moldAnalysisRef.current = null;
    putMoldProgress({ tool: 'wall', stage: 'Wall thickness', percent: 0, gen });
    let analyzed;
    try {
      analyzed = await requestWallField({
        ...message,
        onProgress: (info) => {
          if (wallJobGenRef.current !== gen || !wallMapOnRef.current) return;
          putMoldProgress({ tool: 'wall', stage: info.stage, percent: info.percent, gen });
        },
        onCoarse: (coarse) => {
          if (wallJobGenRef.current !== gen || !wallMapOnRef.current) return;
          if (resultRef.current?.geometry !== geometry) return;
          if (coarse?.error || coarse?.wall?.nominal == null) return;
          paintWallField(coarse.wall, geometry, true);
        },
      });
    } catch (err) {
      if (wallJobGenRef.current === gen) clearWallMap();
      return { error: { code: 'internal', message: err?.message || 'Wall field failed' } };
    }
    if (analyzed?.dropped || wallJobGenRef.current !== gen || !wallMapOnRef.current) {
      if (!wallMapOnRef.current) return { on: false };
      return wallLegendPayload(wallFieldRef.current?.wall);
    }
    if (analyzed?.error) {
      clearWallMap();
      return analyzed;
    }
    if (analyzed.wall?.nominal == null) {
      clearWallMap();
      return { error: { code: 'no_mesh', message: 'No wall thickness on that mesh' } };
    }
    paintWallField(analyzed.wall, geometry, false);
    if (wallJobGenRef.current === gen) endMoldProgress(gen);
    return wallLegendPayload(analyzed.wall);
  };

  const sideActionPayload = (sideActions, selected) => {
    const groups = Array.isArray(sideActions?.groups) ? sideActions.groups : [];
    return {
      count: sideActions?.count || 0,
      slides: sideActions?.slideCount || 0,
      lifters: sideActions?.lifterCount || 0,
      groups: groups.map((group) => ({
        id: group.id,
        kind: group.kind,
        pull: group.pull,
        area: group.area,
        regions: group.regionIds?.length || 0,
        clear: group.clear !== false,
      })),
      selected: selected ?? null,
    };
  };

  const partingPayload = (analyzed, selected) => ({
    on: true,
    pull: analyzed?.pull,
    cavity: analyzed?.parting?.counts?.cavity,
    core: analyzed?.parting?.counts?.core,
    parting: analyzed?.parting?.counts?.parting,
    lines: analyzed?.parting?.lines?.length || 0,
    sideActions: sideActionPayload(analyzed?.sideActions, selected),
  });

  const selectSideGroup = (group) => {
    const cached = partingFieldRef.current;
    if (!cached?.parting) return { error: { code: 'no_mesh', message: 'No parting split on that mesh' } };
    const groups = cached.sideActions?.groups || [];
    const next = group == null || selectedSideGroupRef.current === group ? null : group;
    if (next != null && !groups.some((row) => row.id === next)) {
      return { error: { code: 'bad_args', message: 'group is not a side action on this part' } };
    }
    selectedSideGroupRef.current = next;
    setPartingLegend(splitLegendModel(cached.parting, cached.sideActions, next));
    syncPartingSkin(resultRef.current, cached.parting, cached.sideActions, next);
    const analyzed = moldAnalysisRef.current?.result;
    return partingPayload(analyzed && analyzed.parting ? analyzed : {
      parting: cached.parting,
      sideActions: cached.sideActions,
    }, next);
  };

  agentMoldPartingRef.current = async ({ on, group } = {}) => {
    const selecting = Number.isInteger(group) || group === null;
    if (on === false) {
      clearParting();
      return { on: false };
    }
    if (selecting && on !== true && partingOnRef.current && partingFieldRef.current?.parting) {
      return selectSideGroup(group);
    }
    const next = typeof on === 'boolean' ? on : !partingOnRef.current;
    if (!next) {
      clearParting();
      return { on: false };
    }
    const geometry = resultRef.current?.geometry;
    if (!geometry?.attributes?.position) {
      return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    }
    clearWallMap();
    clearMoldDraft();
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'parting');
    const analyzed = await promise;
    if (gen != null && moldJobGenRef.current !== gen) return { on: !!partingOnRef.current };
    if (analyzed?.dropped) return { on: !!partingOnRef.current };
    if (analyzed?.error) {
      if (gen != null) endMoldProgress(gen);
      return analyzed;
    }
    if (!analyzed.parting) {
      if (gen != null) endMoldProgress(gen);
      return { error: { code: 'no_mesh', message: 'No parting split on that mesh' } };
    }
    if (Number.isInteger(group)) {
      const exists = (analyzed.sideActions?.groups || []).some((row) => row.id === group);
      if (!exists) {
        if (gen != null) endMoldProgress(gen);
        return { error: { code: 'bad_args', message: 'group is not a side action on this part' } };
      }
      selectedSideGroupRef.current = group;
    } else if (group === null) {
      selectedSideGroupRef.current = null;
    }
    rememberMoldAnalysis(geometry, analyzed);
    showParting(analyzed.parting, geometry, analyzed.sideActions);
    if (gen != null) endMoldProgress(gen);
    return partingPayload(analyzed, selectedSideGroupRef.current);
  };

  applySideActionSkinRef.current = (host) => {
    if (host) detachSideActionSkin(host);
  };

  agentMoldSideActionsRef.current = async (args = {}) => {
    if (args?.on === false) {
      return {
        on: false,
        replacedBy: 'mold_parting',
        message: 'Side actions are part of core and cavity. Call mold_parting with { on: false } to hide that colouring.',
      };
    }
    const result = await agentMoldPartingRef.current({ on: true, group: args?.group });
    if (result?.error) return result;
    const sides = result.sideActions || {};
    return {
      on: true,
      replacedBy: 'mold_parting',
      count: sides.count || 0,
      slides: sides.slides || 0,
      lifters: sides.lifters || 0,
      groups: sides.groups || [],
      selected: sides.selected ?? null,
    };
  };

  const showMoldDraft = (moldDraft, geometry) => {
    clearWallMap();
    clearParting();
    clearSideActions();
    moldDraftOnRef.current = true;
    moldDraftFieldRef.current = { geometry, moldDraft };
    setMoldDraftLegend(moldDraftLegendModel(moldDraft));
    syncMoldDraftSkin(resultRef.current, moldDraft);
  };

  applyMoldDraftSkinRef.current = (host) => {
    if (!host) return;
    if (!moldDraftOnRef.current || host !== resultRef.current) {
      detachMoldDraftSkin(host);
      return;
    }
    const geometry = host.geometry;
    const cached = moldDraftFieldRef.current;
    if (cached && cached.geometry === geometry && cached.moldDraft) {
      syncMoldDraftSkin(host, cached.moldDraft);
      return;
    }
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'draft');
    promise.then((analyzed) => {
      if (!moldDraftOnRef.current || resultRef.current?.geometry !== geometry) return;
      if (gen != null && moldJobGenRef.current !== gen) return;
      if (analyzed?.dropped) return;
      if (analyzed?.error || !analyzed?.moldDraft) {
        clearMoldDraft();
        if (gen != null) endMoldProgress(gen);
        return;
      }
      rememberMoldAnalysis(geometry, analyzed);
      setMoldDraftLegend(moldDraftLegendModel(analyzed.moldDraft));
      syncMoldDraftSkin(host, analyzed.moldDraft);
      if (gen != null) endMoldProgress(gen);
    }).catch(() => {
      if (gen != null && moldJobGenRef.current === gen) clearMoldDraft();
    });
  };

  agentMoldDraftRef.current = async ({ on } = {}) => {
    const next = typeof on === 'boolean' ? on : !moldDraftOnRef.current;
    if (!next) {
      clearMoldDraft();
      return { on: false };
    }
    const geometry = resultRef.current?.geometry;
    if (!geometry?.attributes?.position) {
      return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    }
    clearWallMap();
    clearParting();
    clearSideActions();
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'draft');
    const analyzed = await promise;
    if (gen != null && moldJobGenRef.current !== gen) return { on: !!moldDraftOnRef.current };
    if (analyzed?.dropped) return { on: !!moldDraftOnRef.current };
    if (analyzed?.error) {
      if (gen != null) endMoldProgress(gen);
      return analyzed;
    }
    if (!analyzed.moldDraft) {
      if (gen != null) endMoldProgress(gen);
      return { error: { code: 'no_mesh', message: 'No mold draft on that mesh' } };
    }
    rememberMoldAnalysis(geometry, analyzed);
    showMoldDraft(analyzed.moldDraft, geometry);
    if (gen != null) endMoldProgress(gen);
    return {
      on: true,
      violations: analyzed.moldDraft.violationCount,
      minDeg: analyzed.moldDraft.minDeg,
      minDraftDeg: analyzed.moldDraft.minDraftDeg,
      pins: analyzed.moldDraft.ejectors.pinCount,
      sleeves: analyzed.moldDraft.ejectors.sleeveCount,
    };
  };

  const clearDfm = () => {
    dfmOnRef.current = false;
    dfmFieldRef.current = null;
    setDfmReportState(null);
    putMoldProgress((cur) => (cur && cur.tool === 'dfm' ? null : cur));
  };
  clearDfmRef.current = clearDfm;

  const publishDfm = (geometry, analyzed) => {
    const report = analyzed?.dfm || dfmReport(analyzed);
    if (!report) {
      clearDfm();
      return { error: { code: 'no_mesh', message: 'No DFM report on that mesh' } };
    }
    dfmOnRef.current = true;
    dfmFieldRef.current = { geometry, report };
    setDfmReportState(report);
    return { on: true, ...report };
  };

  refreshDfmRef.current = (host) => {
    if (!dfmOnRef.current || !host || host !== resultRef.current) return;
    const geometry = host.geometry;
    if (!geometry?.attributes?.position) {
      clearDfm();
      return;
    }
    const cached = dfmFieldRef.current;
    if (cached && cached.geometry === geometry) return;
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'dfm');
    promise.then((analyzed) => {
      if (!dfmOnRef.current || resultRef.current?.geometry !== geometry) return;
      if (gen != null && moldJobGenRef.current !== gen) return;
      if (analyzed?.dropped) return;
      if (analyzed?.error) {
        clearDfm();
        return;
      }
      rememberMoldAnalysis(geometry, analyzed);
      publishDfm(geometry, analyzed);
      if (gen != null) endMoldProgress(gen);
    }).catch(() => {
      if (gen != null && moldJobGenRef.current === gen) clearDfm();
    });
  };

  agentMoldDfmRef.current = async ({ on } = {}) => {
    const next = typeof on === 'boolean' ? on : !dfmOnRef.current;
    if (!next) {
      clearDfm();
      return { on: false };
    }
    const geometry = resultRef.current?.geometry;
    if (!geometry?.attributes?.position) {
      return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    }
    const cached = dfmFieldRef.current;
    if (cached && cached.geometry === geometry && cached.report) {
      clearQuoteRef.current();
      dfmOnRef.current = true;
      setDfmReportState(cached.report);
      return { on: true, ...cached.report };
    }
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'dfm');
    const analyzed = await promise;
    if (gen != null && moldJobGenRef.current !== gen) return { on: !!dfmOnRef.current };
    if (analyzed?.dropped) return { on: !!dfmOnRef.current };
    if (analyzed?.error) {
      if (gen != null) endMoldProgress(gen);
      return analyzed;
    }
    rememberMoldAnalysis(geometry, analyzed);
    clearQuoteRef.current();
    const published = publishDfm(geometry, analyzed);
    if (gen != null) endMoldProgress(gen);
    return published;
  };

  const clearQuote = () => {
    reviewPollRef.current += 1;
    reviewReturnSeenRef.current.clear();
    quoteSeqRef.current += 1;
    quoteOnRef.current = false;
    quoteFieldRef.current = null;
    setMoldQuote(null);
    putMoldProgress((cur) => (cur && cur.tool === 'quote' ? null : cur));
  };
  clearQuoteRef.current = clearQuote;

  function keptReview(source) {
    return {
      reviewFeeUsd: Number.isFinite(source?.reviewFeeUsd) ? source.reviewFeeUsd : null,
      reviewPayable: source?.reviewPayable === true,
      payForReview: source?.payForReview === true,
    };
  }

  function noteReviewReturn(vendors, fallback) {
    let flag = '';
    try {
      flag = new URLSearchParams(window.location.search).get('moldReview') || '';
    } catch {
      flag = '';
    }
    // The query only decides whether to ask the server. It is not payment.
    if (flag !== 'return') return;
    const list = Array.isArray(vendors) ? vendors : [];
    const stored = readReviewLabel();
    const label = stored && list.some((row) => row.anonLabel === stored) ? stored : fallback;
    if (!label || !list.some((row) => row.anonLabel === label)) return;
    if (reviewReturnSeenRef.current.has(label)) return;
    reviewReturnSeenRef.current.add(label);
    void startReviewPollRef.current(label);
  }

  const resinHintFromPart = (geometry, analysis) => {
    const bounds = boundsFromPositions(geometry?.attributes?.position);
    return {
      fill: heuristicFillFlags({
        bounds,
        wall: analysis?.wall,
        geometry,
        stressField: typeof feaPanelRef.current?.nodalStress === 'function'
          ? feaPanelRef.current.nodalStress()
          : null,
      }),
      study: studyStiffnessHint(feaPanelRef.current),
      wall: analysis?.wall || null,
    };
  };

  const resinSuggestion = (hint, library) => {
    if (!library || library.error) {
      return { status: 'unavailable', ...hint, suggestions: [] };
    }
    return {
      status: 'ready',
      ...hint,
      suggestions: suggestResins(library.resins, hint),
    };
  };

  const publishQuote = async (geometry, analysis, opts) => {
    const quantity = opts.quantity;
    const cavityCount = opts.cavityCount;
    const grade = opts.grade || '';
    const selected = opts.selected || '';
    const hint = resinHintFromPart(geometry, analysis);
    const body = quoteBodyFromAnalysis(geometry, analysis, {
      quantity,
      cavityCount,
      grade: grade || undefined,
    });
    if (body.error) {
      quoteSeqRef.current += 1;
      quoteOnRef.current = true;
      quoteFieldRef.current = { geometry, analysis };
      setMoldQuote({
        quantity,
        cavityCount,
        grade,
        selected: '',
        status: 'error',
        quote: null,
        error: body.error,
        revealed: moldQuoteRef.current?.revealed || {},
        suggestion: { status: 'unavailable', ...hint, suggestions: [] },
        ...keptReview(moldQuoteRef.current),
      });
      return { error: body.error };
    }
    const seq = quoteSeqRef.current + 1;
    quoteSeqRef.current = seq;
    quoteOnRef.current = true;
    quoteFieldRef.current = { geometry, analysis };
    setMoldQuote((prev) => ({
      quantity,
      cavityCount,
      grade,
      selected: prev?.selected || selected,
      status: 'loading',
      quote: prev?.quote || null,
      error: null,
      revealed: prev?.revealed || {},
      leadMessage: prev?.leadMessage || null,
      leadError: null,
      suggestion: { status: 'loading', ...hint, suggestions: [] },
      ...keptReview(prev),
    }));
    const libraryPromise = fetchMoldingResinLibrary();
    const result = await postMoldingQuote(body);
    const library = await libraryPromise;
    if (seq !== quoteSeqRef.current || !quoteOnRef.current) return { on: false };
    const suggestion = resinSuggestion(hint, library);
    if (result?.error) {
      setMoldQuote({
        quantity,
        cavityCount,
        grade,
        selected: '',
        status: 'error',
        quote: null,
        error: result.error,
        revealed: moldQuoteRef.current?.revealed || {},
        suggestion,
        ...keptReview(moldQuoteRef.current),
      });
      return { error: result.error };
    }
    const vendors = Array.isArray(result?.vendors) ? result.vendors : [];
    const keep = vendors.some((row) => row.anonLabel === (selected || moldQuoteRef.current?.selected))
      ? (selected || moldQuoteRef.current?.selected)
      : (vendors[0]?.anonLabel || '');
    setMoldQuote({
      quantity,
      cavityCount,
      grade,
      selected: keep,
      status: 'ready',
      quote: result,
      error: null,
      revealed: moldQuoteRef.current?.revealed || {},
      leadMessage: moldQuoteRef.current?.leadMessage || null,
      suggestion,
      ...keptReview(moldQuoteRef.current),
    });
    noteReviewReturn(vendors, keep);
    return {
      on: true,
      disclaimer: result?.disclaimer,
      quantity: result?.quantity,
      cavityCount: result?.cavityCount,
      vendors,
    };
  };

  refreshQuoteRef.current = (host) => {
    if (!quoteOnRef.current || !host || host !== resultRef.current) return;
    const geometry = host.geometry;
    if (!geometry?.attributes?.position) {
      clearQuote();
      return;
    }
    const cached = quoteFieldRef.current;
    if (cached && cached.geometry === geometry && cached.analysis) return;
    const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'quote');
    promise.then((analyzed) => {
      if (!quoteOnRef.current || resultRef.current?.geometry !== geometry) return;
      if (gen != null && moldJobGenRef.current !== gen) return;
      if (analyzed?.dropped) return;
      if (analyzed?.error) {
        clearQuote();
        return;
      }
      rememberMoldAnalysis(geometry, analyzed);
      const prev = moldQuoteRef.current;
      if (gen != null) endMoldProgress(gen);
      publishQuote(geometry, analyzed, {
        quantity: prev?.quantity ?? 1,
        cavityCount: prev?.cavityCount ?? 1,
        grade: prev?.grade || '',
        selected: prev?.selected || '',
      });
    }).catch(() => {
      if (gen != null && moldJobGenRef.current === gen) clearQuote();
    });
  };

  agentMoldQuoteRef.current = async ({ on, quantity, cavityCount, grade } = {}) => {
    const next = typeof on === 'boolean' ? on : !quoteOnRef.current;
    if (!next) {
      clearQuote();
      return { on: false };
    }
    const geometry = resultRef.current?.geometry;
    if (!geometry?.attributes?.position) {
      return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
    }
    const prev = moldQuoteRef.current;
    const nextQuantity = quantity == null ? (prev?.quantity ?? 1) : quantity;
    const nextCavity = cavityCount == null ? (prev?.cavityCount ?? 1) : cavityCount;
    const nextGrade = grade == null ? (prev?.grade || '') : grade;
    let analysis = quoteFieldRef.current?.geometry === geometry ? quoteFieldRef.current.analysis : null;
    if (!analysis) {
      const { gen, promise } = loadMoldAnalysis(geometry, faceIDsRef.current, sharedMoldPull(), 'quote');
      analysis = await promise;
      if (gen != null && moldJobGenRef.current !== gen) return { on: !!quoteOnRef.current };
      if (analysis?.dropped) return { on: !!quoteOnRef.current };
      if (analysis?.error) {
        if (gen != null) endMoldProgress(gen);
        return analysis;
      }
      rememberMoldAnalysis(geometry, analysis);
      if (gen != null) endMoldProgress(gen);
    }
    clearDfm();
    return publishQuote(geometry, analysis, {
      quantity: nextQuantity,
      cavityCount: nextCavity,
      grade: nextGrade,
      selected: prev?.selected || '',
    });
  };

  const requestLead = async (type, anonLabel) => {
    const current = moldQuoteRef.current;
    if (!current?.quote) {
      return { error: { code: 'no_mesh', message: 'Open the budgetary quote first' } };
    }
    const label = anonLabel || current.selected;
    const vendor = (current.quote.vendors || []).find((row) => row.anonLabel === label);
    if (!vendor) {
      return { error: { code: 'bad_args', message: 'Pick a vendor from the quote' } };
    }
    setMoldQuote((prev) => (prev ? { ...prev, leadBusy: true, leadError: null } : prev));
    const result = await postMoldingLead(leadBody(type, vendor, current.quote));
    if (!moldQuoteRef.current) return { on: false };
    if (result?.error) {
      setMoldQuote((prev) => (prev ? {
        ...prev,
        leadBusy: false,
        leadError: result.error.message,
      } : prev));
      return { error: result.error };
    }
    const unlocked = partnerUnlocked(result);
    setMoldQuote((prev) => {
      if (!prev) return prev;
      const revealed = { ...(prev.revealed || {}) };
      if (unlocked) revealed[label] = result.displayName;
      return {
        ...prev,
        leadBusy: false,
        leadError: null,
        leadMessage: unlocked ? null : (result.message || PAY_FOR_REVIEW_MESSAGE),
        revealed,
        reviewFeeUsd: Number.isFinite(result.reviewFeeUsd) ? result.reviewFeeUsd : prev.reviewFeeUsd,
        reviewPayable: unlocked ? false : Number.isFinite(result.reviewFeeUsd),
        payForReview: unlocked ? false : result.payForReview === true,
      };
    });
    return {
      type,
      anonLabel: label,
      revealed: unlocked,
      reviewFeePaid: unlocked,
      reviewFeeUsd: result.reviewFeeUsd,
      ...(unlocked ? { displayName: result.displayName } : {
        payForReview: true,
        message: result.message || PAY_FOR_REVIEW_MESSAGE,
      }),
    };
  };

  const applyReviewResult = (label, result) => {
    if (!moldQuoteRef.current || result?.error) {
      if (result?.error) {
        setMoldQuote((prev) => (prev ? {
          ...prev,
          leadBusy: false,
          leadError: result.error.message,
        } : prev));
      }
      return result?.error ? { error: result.error } : { on: false };
    }
    const unlocked = partnerUnlocked(result);
    setMoldQuote((prev) => {
      if (!prev) return prev;
      const revealed = { ...(prev.revealed || {}) };
      if (unlocked) revealed[label] = result.displayName;
      return {
        ...prev,
        leadBusy: false,
        leadError: null,
        revealed,
        reviewFeeUsd: Number.isFinite(result.reviewFeeUsd) ? result.reviewFeeUsd : prev.reviewFeeUsd,
        reviewPayable: unlocked ? false : (Number.isFinite(result.reviewFeeUsd) || prev.reviewPayable === true),
        payForReview: unlocked ? false : (result.payForReview === true || prev.payForReview === true),
        leadMessage: unlocked ? null : (result.message || prev.leadMessage || PAY_FOR_REVIEW_MESSAGE),
      };
    });
    return {
      anonLabel: label,
      revealed: unlocked,
      reviewFeePaid: unlocked,
      reviewFeeUsd: result.reviewFeeUsd,
      ...(result.url ? { url: result.url } : {}),
      ...(unlocked ? { displayName: result.displayName } : {}),
    };
  };

  const runReviewPoll = async (label) => {
    const token = reviewPollRef.current + 1;
    reviewPollRef.current = token;
    setMoldQuote((prev) => (prev ? {
      ...prev,
      leadError: null,
      leadMessage: 'Checking the review payment.',
    } : prev));
    const result = await pollReviewStatus(label);
    if (reviewPollRef.current !== token || !moldQuoteRef.current) return { on: false };
    if (partnerUnlocked(result)) {
      clearReviewLabel();
      return applyReviewResult(label, result);
    }
    const code = result?.error?.code;
    const quiet = code === 'no_lead' || code === 'unknown_partner';
    setMoldQuote((prev) => (prev ? {
      ...prev,
      leadBusy: false,
      leadError: result?.error && !quiet ? result.error.message : null,
      leadMessage: PAY_FOR_REVIEW_MESSAGE,
      payForReview: true,
      reviewPayable: Number.isFinite(result?.reviewFeeUsd) ? true : prev.reviewPayable === true,
      reviewFeeUsd: Number.isFinite(result?.reviewFeeUsd) ? result.reviewFeeUsd : prev.reviewFeeUsd,
    } : prev));
    return result?.error ? { error: result.error } : {
      anonLabel: label,
      revealed: false,
      reviewFeePaid: false,
      payForReview: true,
      message: PAY_FOR_REVIEW_MESSAGE,
    };
  };
  startReviewPollRef.current = runReviewPoll;

  const payReview = async (anonLabel) => {
    const current = moldQuoteRef.current;
    if (!current?.quote) {
      return { error: { code: 'no_mesh', message: 'Open the budgetary quote first' } };
    }
    const label = anonLabel || current.selected;
    const vendor = (current.quote.vendors || []).find((row) => row.anonLabel === label);
    if (!vendor) {
      return { error: { code: 'bad_args', message: 'Pick a vendor from the quote' } };
    }
    setMoldQuote((prev) => (prev ? { ...prev, leadBusy: true, leadError: null } : prev));
    let result = await postReviewCheckout(label);
    if (!moldQuoteRef.current) return { on: false };
    if (result?.error?.code === 'no_lead') {
      const review = await postMoldingLead(leadBody('human_review', vendor, current.quote));
      if (!moldQuoteRef.current) return { on: false };
      if (review?.error) {
        setMoldQuote((prev) => (prev ? {
          ...prev,
          leadBusy: false,
          leadError: review.error.message,
        } : prev));
        return { error: review.error };
      }
      if (partnerUnlocked(review)) return applyReviewResult(label, review);
      result = await postReviewCheckout(label);
      if (!moldQuoteRef.current) return { on: false };
    }
    const packed = applyReviewResult(label, result);
    const url = checkoutUrlAllowed(result?.url);
    if (url && !partnerUnlocked(result)) {
      rememberReviewLabel(label);
      window.location.assign(url);
    }
    return packed;
  };
  agentMoldFirmQuoteRef.current = ({ anonLabel } = {}) => requestLead('firm_quote', anonLabel);
  agentMoldHumanReviewRef.current = ({ anonLabel } = {}) => requestLead('human_review', anonLabel);
  agentMoldPayReviewRef.current = ({ anonLabel } = {}) => payReview(anonLabel);

  applyFaceSkinRef.current = (host) => {
    if (!host) return;
    const painting = paintModeRef.current;
    const colors = painting ? (painting.session || null) : assemblyColorsRef.current;
    const rainbow = readFaceColorDebugFlag();
    const surfId = host.userData?.surfId || null;
    const rowId = host.userData?.assemblyPartId
      ?? (host === resultRef.current ? activePartIdRef.current : null);
    const definitionId = rowId != null ? definitionOf(rowId) : null;
    const entry = colorEntryForPlacement(colors, surfId, definitionId);
    const wants = rainbow || !!(entry && (entry.part || (Array.isArray(entry.faces) && entry.faces.length)));
    if (!wants) {
      detachFaceColorSkin(host);
      if (host === resultRef.current) applyStressSkinRef.current(host);
      applyWallSkinRef.current(host);
      applyPartingSkinRef.current(host);
      applySideActionSkinRef.current(host);
      applyMoldDraftSkinRef.current(host);
      refreshDfmRef.current(host);
      refreshQuoteRef.current(host);
      if (crossSectionEnabledRef.current) syncSectionClipMeshes(host);
      return;
    }
    const cached = solidEntryForGeometry(solidCacheRef.current, host.geometry);
    syncFaceColorSkin(host, {
      geometry: host.geometry,
      faceIDs: cached?.faceIDs || null,
      surfId,
      definitionId,
      colors,
      rainbow,
    });
    if (host === resultRef.current) applyStressSkinRef.current(host);
    applyWallSkinRef.current(host);
    applyPartingSkinRef.current(host);
    applySideActionSkinRef.current(host);
    applyMoldDraftSkinRef.current(host);
    refreshDfmRef.current(host);
    refreshQuoteRef.current(host);
    if (crossSectionEnabledRef.current) syncSectionClipMeshes(host);
  };

  applyStressSkinRef.current = (host) => {
    if (host) syncStressSkin(host);
    if (host && crossSectionEnabledRef.current) syncSectionClipMeshes(host);
  };

  // Helper to render mesh data from the worker
  const renderMeshData = useCallback((meshData) => {
    if (!meshData || !resultRef.current) return;
    delete resultRef.current.userData.crossSectionRestore;
    delete resultRef.current.userData.crossSectionTrimmedMeshData;
    // A new script result replaces the solid. Drop any Pieces clone so the
    // viewport shows that result in the normal body color.
    clearCutPiecePreviewRef.current();

    // The needle between two copies of a cap vertex is not part of the
    // face: buildSolidGeometry drops it so the seam is not drawn and is not
    // an edge of the face graph. A solid already built for this mesh data
    // (another assembly part, or this part before a switch) is reused.
    // Scoped by definition: every instance of a part shares the geometry.
    const tUpload = performance.now();
    const solid = cachedSolidGeometry(solidCacheRef.current, meshData, definitionOf(activePartIdRef.current));
    const uploadMs = performance.now() - tUpload;
    const geometry = solid.geometry;
    faceIDsRef.current = solid.faceIDs;

    // Sheet parts take the gray metal. Everything else keeps the shared
    // off-white material array. The array itself is never disposed.
    if (meshData?.sheetMetal || materialsRef.current?.length) {
      ensureBodyMaterial(resultRef.current, meshData, materialsRef.current);
    }

    const prevGeometry = resultRef.current.geometry;
    resultRef.current.geometry = geometry;
    if (prevGeometry !== geometry) releaseGeometryIn(solidCacheRef.current, prevGeometry);
    pruneSolidCacheIn(solidCacheRef.current, resultRef.current, assemblyExtrasRef.current);
    // New mesh, including after fillet. Coplanar caps join here; the blend
    // stays its own patch.
    const tFace = performance.now();
    warmFaceGraph(geometry, faceIDsRef.current);
    const faceMs = performance.now() - tFace;
    const tSeam = performance.now();
    attachContactSeam(resultRef.current, meshData);
    const seamMs = performance.now() - tSeam;
    const prevTiming = graphTimingRef.current || {};
    graphTimingRef.current = { ...prevTiming, faceMs, seamMs, uploadMs };
    setMeshEpoch((n) => n + 1);
    // New solid geometry: rebuild (or drop) the failed outline on it.
    syncFailedPartOutlinesRef.current();

    // Dev-only: the single choke point where geometry reaches the scene. Report the exact
    // meshData object we just painted so automation can prove, by identity, that what is on
    // screen is the part it submitted -- no polling, no timers, no retry logic.
    if (import.meta.env?.DEV && window.__VIEWPORT__) {
      const hook = window.__VIEWPORT__;
      hook._lastRenderedMesh = meshData;
      hook._renderCount = (hook._renderCount || 0) + 1;
      try { hook.onRendered?.(meshData); } catch (e) { console.warn('[stage] onRendered failed:', e?.message); }
    }

    applyFaceSkinRef.current(resultRef.current);
    applyStressSkinRef.current(resultRef.current);
    refreshSectionClipRef.current();

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }, []);

  function feaStressHosts() {
    const hosts = [];
    if (resultRef.current) hosts.push(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) hosts.push(mesh);
    return hosts;
  }

  /** Column-major matrixWorld, else position, quaternion, and scale. */
  function feaPartFrame(mesh) {
    if (typeof mesh?.updateMatrixWorld === 'function') mesh.updateMatrixWorld(true);
    const elements = mesh?.matrixWorld?.elements;
    if (elements && elements.length >= 16) {
      const matrix = new Array(16);
      for (let i = 0; i < 16; i += 1) matrix[i] = Number(elements[i]) || 0;
      return { matrix };
    }
    const p = mesh?.position;
    const q = mesh?.quaternion;
    const s = mesh?.scale;
    return {
      position: [p?.x || 0, p?.y || 0, p?.z || 0],
      quaternion: [q?.x || 0, q?.y || 0, q?.z || 0, q?.w ?? 1],
      scale: [s?.x ?? 1, s?.y ?? 1, s?.z ?? 1],
    };
  }

  function feaAssemblyParts() {
    const parts = [];
    const activeId = activePartIdRef.current;
    if (activeId && resultRef.current?.geometry?.attributes?.position?.count) {
      parts.push({
        id: String(activeId),
        name: partLabelsRef.current?.[activeId] || String(activeId),
        geometry: resultRef.current.geometry,
        faceIDs: faceIDsRef.current,
        ...feaPartFrame(resultRef.current),
      });
    }
    for (const [id, mesh] of assemblyExtrasRef.current) {
      const cached = solidEntryForGeometry(solidCacheRef.current, mesh.geometry);
      parts.push({
        id: String(id),
        name: partLabelsRef.current?.[id] || String(id),
        geometry: mesh.geometry,
        faceIDs: cached?.faceIDs || mesh.geometry?.attributes?.faceID?.array || null,
        ...feaPartFrame(mesh),
      });
    }
    return parts;
  }

  function feaPartHosts() {
    const hosts = [];
    const activeId = activePartIdRef.current;
    if (activeId && resultRef.current) {
      hosts.push({
        id: String(activeId),
        active: true,
        mesh: resultRef.current,
        faceIDs: faceIDsRef.current,
      });
    }
    for (const [id, mesh] of assemblyExtrasRef.current) {
      const cached = solidEntryForGeometry(solidCacheRef.current, mesh.geometry);
      hosts.push({
        id: String(id),
        active: false,
        mesh,
        faceIDs: cached?.faceIDs || mesh.geometry?.attributes?.faceID?.array || null,
      });
    }
    return hosts;
  }

  function paintFeaContacts(pairs) {
    paintFeaContactHighlights(feaPartHosts(), pairs);
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function paintFeaFaces(study, meta) {
    const next = study && typeof study === 'object' && !Array.isArray(study) ? study : null;
    feaHighlightStudyRef.current = next;
    if (meta && typeof meta === 'object') feaHighlightMetaRef.current = meta;
    const synced = syncFeaFaceHighlights(
      feaFaceOverlaysRef.current,
      next,
      feaPartHosts(),
      feaHighlightMetaRef.current || {},
    );
    feaFaceOverlaysRef.current = synced.overlays;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // The study publishes a new field without a mesh rebuild (Run, close, stale).
  useEffect(() => {
    const sync = () => {
      syncFeaStressSkins(feaStressHosts());
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (renderer && scene && camera) renderer.render(scene, camera);
    };
    const unsubscribe = subscribeStressSkin(sync);
    sync();
    return unsubscribe;
  }, []);

  // A rebuilt solid or a moved assembly part invalidates overlay triangles.
  // The last study is re-applied so a disposed mesh cannot leave a stale fill.
  useEffect(() => {
    if (!feaHighlightStudyRef.current && feaFaceOverlaysRef.current.size === 0) return;
    paintFeaFaces(feaHighlightStudyRef.current, feaHighlightMetaRef.current);
  }, [meshEpoch, overlayEpoch]);

  // Colors can arrive without a new mesh (a document load). Empty skips the work.
  useEffect(() => {
    const apply = applyFaceSkinRef.current;
    if (resultRef.current?.geometry?.attributes?.position?.count) apply(resultRef.current);
    for (const mesh of assemblyExtrasRef.current.values()) apply(mesh);
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  }, [assemblyColors]);

  // Calculate model bounds from mesh data
  const calculateBoundsFromMesh = (meshData) => {
    const vertProperties = meshData.vertProperties;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    
    for (let i = 0; i < vertProperties.length; i += 3) {
      min[0] = Math.min(min[0], vertProperties[i]);
      min[1] = Math.min(min[1], vertProperties[i + 1]);
      min[2] = Math.min(min[2], vertProperties[i + 2]);
      max[0] = Math.max(max[0], vertProperties[i]);
      max[1] = Math.max(max[1], vertProperties[i + 1]);
      max[2] = Math.max(max[2], vertProperties[i + 2]);
    }
    
    return {
      min,
      max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
    };
  };

  /**
   * Execute script using the sandbox worker
   */
  const executeScript = useCallback(async (scriptOverride, opts = {}) => {
    let script = scriptOverride ?? currentScript ?? '';
    const submitted = script;
    const noShadow = opts.noShadow === true;

    if (!sceneRef.current) return false;

    // A blank / comment-only / construction-plane-only run empties the viewport.
    // The clear has to be total: anything still holding the previous solid — the
    // worker's cached manifold, the context's lastResult, the pick topology, the
    // solid-derived overlays — would hand the last object back through
    // cross-section, model info, quoting, game compare or the stage hooks.
    const anchor = Object.prototype.hasOwnProperty.call(opts, 'rollbackAnchor')
      ? opts.rollbackAnchor
      : rollbackAnchorRef.current;
    // A bar at the start blanks `let part` and the trailing `return part`.
    // That copy is an empty part: clear the solid, do not ask the worker.
    if (shouldClearViewportScript(script) || rollbackClearsPart(script, anchor)) {
      stageExecErrorRef.current = null;
      onRunOutcomeRef.current?.({ script, ok: true, scriptLine: null });
      setExecutionError(null);
      setCachedMeshData(null);
      cachedMeshDataRef.current = null;
      setModelBounds(null);
      forgetCharacteristicLength(activePartIdRef.current);
      clearHighlight();
      clearEdgeHighlight();
      clearEdgeHover();
      setSelectedFace(null);
      setSelectedEdges([]);
      onFaceSelected?.(null);
      // Pick topology belongs to the gone solid — drop it with the mesh.
      featureEdgesRef.current = [];
      featureEdgesSourceRef.current = null;
      faceIDsRef.current = null;
      boundaryTopoRef.current = null;
      contourTopoRef.current = null;
      // Overlays drawn from that solid (cut plane, path previews, the
      // fillet blend ghost, f#/e# labels) must not outlive it on screen.
      // The section plane belongs to the tool: it comes back while the tool is on.
      clearIdLabels();
      clearCuttingPlane();
      clearXsPreview();
      clearPathPreview();
      clearFilletBlendPreview();
      if (resultRef.current) {
        removeContactSeam(resultRef.current);
        detachStressSkin(resultRef.current);
        resultRef.current.geometry?.dispose();
        resultRef.current.geometry = new BufferGeometry();
      }
      setMeshEpoch((n) => n + 1);
      // Nothing executed, so no run will overwrite these — forget them here.
      manifoldContext.clearResult().catch((e) => {
        console.warn('[Viewport] clearResult failed:', e?.message || e);
      });
      if (window.__VIEWPORT__) window.__VIEWPORT__._lastRenderedMesh = null;
      refreshSectionClipRef.current();
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (renderer && scene && camera) renderer.render(scene, camera);
      return { ok: true, cleared: true };
    }

    if (!script) return false;
    runTimingStartRef.current = performance.now();
    graphTimingRef.current = {};
    
    // Cancel any pending execution
    if (executionAbortRef.current) {
      executionAbortRef.current.aborted = true;
    }
    const abortController = { aborted: false };
    executionAbortRef.current = abortController;
    
    setIsExecuting(true);
    stageExecErrorRef.current = null;
    setExecutionError(null);

    // Do NOT clear face/edge selection here — a failed Auto-Run must keep the
    // chip in sync (false "0 selected" was caused by wiping selection up-front).
    // Clear only after a successful rebuild (geometry changed → stale edges).

    try {
      const prevMesh = cachedMeshDataRef.current;
      const publishRefDisplay = (displays) => {
        const open = contourModeRef.current;
        if (!open?.contourId || !displays?.length) return;
        const hit = displays.find((row) => row.id === open.contourId);
        if (!hit) return;
        setContourMode((prev) => {
          if (!prev?.params?.contour || prev.contourId !== hit.id) return prev;
          return {
            ...prev,
            params: {
              ...prev.params,
              contour: { ...prev.params.contour, refs: hit.refs },
            },
          };
        });
      };
      const failBrokenRefs = (outcome) => {
        const msg = outcome?.message || 'A contour reference is broken';
        stageExecErrorRef.current = msg;
        setExecutionError(msg);
        publishRefDisplay(outcome?.displays);
        if (!opts.editPreview) {
          onRunOutcomeRef.current?.({
            script: submitted,
            ok: false,
            scriptLine: null,
            message: msg,
          });
        }
      };
      // A soft-restart or assembly preempt clears isReady until init()
      // finishes. Wait for that instead of failing the next script.
      if (!manifoldContext.isReady && typeof manifoldContext.whenReady === 'function') {
        await manifoldContext.whenReady();
      }
      if (abortController.aborted) {
        console.log('[Viewport] Execution aborted while the sandbox restarted');
        return false;
      }
      if (!manifoldContext.isReady) {
        throw new Error('Manifold Sandbox not initialized');
      }
      
      // Step 1: Validate script for dangerous patterns (client-side pre-check)
      console.log('[Viewport] Validating script...');
      const validation = validateScript(script);
      if (!validation.valid) {
        throw new Error(formatValidationErrors(validation.errors));
      }
      
      if (abortController.aborted) {
        console.log('[Viewport] Execution aborted during validation');
        return false;
      }

      // Step 2: Resolve meshes on this thread. The worker cannot touch
      // IndexedDB. importMesh names come from the part record; legacy
      // __importedManifolds names still come from SurfDB. An assembly run
      // names the part; the ref still points at the previous solid until
      // placeAssembly.
      const meshPartId = opts.partId != null ? opts.partId : activePartIdRef.current;
      if (opts.partId != null) activePartIdRef.current = opts.partId;
      if (opts.partId != null && opts.definitionId) {
        partDefinitionRef.current.set(String(opts.partId), String(opts.definitionId));
      }
      // Mesh assets belong to the definition the row places.
      const prepared = await resolvePartMeshes(definitionOf(meshPartId), script);
      if (prepared.missing.length) {
        throw new Error(missingMeshMessage(prepared.missing));
      }
      
      // An assembly open may have taken the worker during import loading.
      // Do not post this preview in front of the build the spinner awaits.
      if (opts.editPreview && assemblyRunLockRef?.current) {
        return false;
      }

      // Match references against the mesh this part already has. A miss
      // soft-fails before the worker runs and leaves the statement alone.
      const readyTopo = contourTopoRef.current;
      const meshReady = !!(readyTopo?.edges && prevMesh?.vertProperties);
      let rewroteRefs = false;
      if (meshReady) {
        const before = resolveContourScript(script, readyTopo.edges, { meshReady: true });
        if (!before.ok) {
          failBrokenRefs(before);
          return false;
        }
        if (before.changed && before.buffer !== script) {
          script = before.buffer;
          onContourRefsResolvedRef.current?.(script);
          rewroteRefs = true;
          publishRefDisplay(before.displays);
        }
      }

      // Step 3: Execute script in sandbox worker (nonce ties compare to this solid)
      console.log('[Viewport] Executing script in sandbox worker...');
      const nonce = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await manifoldContext.executeScript(script, {
        timeoutMs: EXECUTION_LIMITS.timeoutMs,
        memoryLimitMB: EXECUTION_LIMITS.memoryLimitMB,
        nonce,
        importedModels: prepared.importedModels,
        ...(anchor === null || typeof anchor === 'string' ? { rollbackAnchor: anchor } : {}),
      });
      
      if (abortController.aborted) {
        console.log('[Viewport] Execution aborted after worker returned');
        return false;
      }
      
      const { mesh: meshData, memoryUsedMB, bodyCentroids } = result;
      bodyCentroidsRef.current = Array.isArray(bodyCentroids) ? bodyCentroids : [];
      
      if (!meshData || !meshData.vertProperties) {
        throw new Error('Script must return a Manifold object');
      }

      // Calculate bounds from mesh
      const bounds = calculateBoundsFromMesh(meshData);
      setModelBounds(bounds);
      rememberCharacteristicLength({ partId: meshPartId, meshData, bounds });

      // Cache mesh data for cross-section operations
      setCachedMeshData(meshData);
      cachedMeshDataRef.current = meshData;

      // Render the result
      renderMeshData(meshData);

      if (filletQualityWatchRef.current) {
        const preDeg = Number(filletQualityWatchRef.current.preDeg) || 0;
        filletQualityWatchRef.current = null;
        // C3: loft meshes already carry thousands of skinny tris — only banner
        // when Accept *introduces* a meaningful scrap delta (not the baseline).
        const degenerates = countDegenerateTriangles(resultRef.current?.geometry);
        const introduced = degenerates - preDeg;
        // Loft baselines already carry thousands of skinny tris; only banner a
        // large NEW scrap delta (not a modest re-tessellation bump).
        const scrapy = introduced > Math.max(300, 0.1 * Math.max(preDeg, 1));
        setFilletScrapNotice(scrapy
          ? 'Unable to generate clean fillet, please try a different size.'
          : null);
      } else {
        setFilletScrapNotice(null);
      }

      // Geometry replaced → previous face/edge picks are stale. Clear intentionally
      // and nudge the user when they were in edge pick mode.
      // Slice 27: in Fillet mode keep the picked wire — Accept uses literals, so
      // second Accept can replace the same marked block without a re-pick.
      // Slice 30: Sweep Confirm does the same (edge literals + makeSweepPath).
      // Clearing the path on Auto-Run made a second Confirm a loud empty-path fail.
      const inFilletMode = !!filletModeRef.current;
      const keepSweepPath = isSweepEntry(contourModeRef.current?.entry);
      const liveEdges = selectedEdgesRef.current || [];
      const activePart = activePartIdRef.current;
      const foreignEdges = !!(activePart && liveEdges.some((edge) => edge.partId && edge.partId !== activePart));
      // Fillet / Chamfer keep picks on other parts; highlightSelectedEdges
      // draws those at their own part's position.
      const hadEdges = liveEdges.length > 0 && (!foreignEdges || inFilletMode);
      const wasEdgeMode = pickModeRef.current === 'edge';
      const preservePicks = opts.preservePicks === true && featureHideKeepsPicks(featureSessionRef.current);
      const savedFaces = preservePicks ? facePickGroupRef.current : null;
      // Face identity: a face pick that carries a stamped name is found
      // again on the new mesh once the graphs below are rebuilt, so a second
      // use_selection insert gets the face that was picked instead of
      // no_selection. A pick without a name (unstamped geometry) still clears.
      const namedPick = !preservePicks ? selectedFaceRef.current : null;
      if (!preservePicks) {
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
      }
      featureEdgesRef.current = [];
      featureEdgesSourceRef.current = null;
      sheetSpecRollbackRef.current = { spec: sheetSpecRef.current, partId: sheetPartIdRef.current };
      sheetSpecRef.current = sheetSpecInScript(script);
      sheetPartIdRef.current = meshPartId;
      syncFeatureEdges(resultRef.current?.geometry ?? null);
      graphsBoundMeshRef.current = meshData;
      const builtTopo = contourTopoRef.current;
      if (builtTopo?.edges) {
        const after = resolveContourScript(script, builtTopo.edges, { meshReady: true });
        if (!after.ok) {
          if (rewroteRefs) onContourRefsResolvedRef.current?.(submitted);
          if (prevMesh?.vertProperties) {
            if (sheetSpecRollbackRef.current !== undefined) {
              sheetSpecRef.current = sheetSpecRollbackRef.current.spec;
              sheetPartIdRef.current = sheetSpecRollbackRef.current.partId;
              sheetSpecRollbackRef.current = undefined;
            }
            renderMeshData(prevMesh);
            setCachedMeshData(prevMesh);
            cachedMeshDataRef.current = prevMesh;
            setModelBounds(calculateBoundsFromMesh(prevMesh));
            featureEdgesSourceRef.current = null;
            syncFeatureEdges(resultRef.current?.geometry ?? null);
            graphsBoundMeshRef.current = prevMesh;
          } else {
            sheetSpecRollbackRef.current = undefined;
          }
          failBrokenRefs(after);
          return false;
        }
        sheetSpecRollbackRef.current = undefined;
        if (after.changed && after.buffer !== script) {
          script = after.buffer;
          onContourRefsResolvedRef.current?.(script);
        }
        publishRefDisplay(after.displays);
      } else {
        sheetSpecRollbackRef.current = undefined;
      }
      if (preservePicks) {
        facePickGroupRef.current = savedFaces;
        if (hadEdges) highlightSelectedEdges(liveEdges);
        const geom = resultRef.current?.geometry;
        const positions = geom?.attributes?.position;
        const index = geom?.index?.array;
        const shown = [...new Set((savedFaces?.picks || []).flatMap((face) => face.indices || []))];
        if (geom && positions && index && shown.length) {
          const savedGroup = facePickGroupRef.current;
          clearHighlight();
          facePickGroupRef.current = savedGroup;
          highlightFace(shown, geom, positions, index, 0xffff00);
        }
        if (containerRef.current) containerRef.current.setAttribute('data-feature-picks', 'kept');
      } else if (foreignEdges && !inFilletMode) {
        clearEdgeHighlight();
        clearEdgeHover();
        clearFilletBlendPreview();
        setSelectedEdges([]);
      } else if (inFilletMode || keepSweepPath) {
        clearEdgeHover();
        // Re-paint the kept selection on the new mesh (world va/vb still draw).
        // The selectedEdges effect only fires on reference change, which a kept
        // wire does not produce across an Auto-Run — repaint explicitly so the
        // orange halo cannot go stale against the replaced geometry.
        if (hadEdges) highlightSelectedEdges(liveEdges);
        if (inFilletMode) {
          setSelectedEdges((prev) => stampBoundaryOnSelection(prev, featureEdgesRef.current));
        }
      } else {
        clearEdgeHighlight();
        clearEdgeHover();
        setSelectedEdges([]);
        if (edgeRematchToastSuppressRef.current) {
          edgeRematchToastSuppressRef.current = false;
        } else if (wasEdgeMode && hadEdges) {
          setEdgeModeToast(toastPayload('Geometry updated — re-pick edges'));
          armEdgeModeToastClear();
        }
      }

      if (!preservePicks && typeof namedPick?.name === 'string' && namedPick.name) {
        const geom = resultRef.current?.geometry;
        const positions = geom?.attributes?.position;
        const index = geom?.index?.array;
        if (geom && positions && index?.length) {
          const wanted = Array.isArray(namedPick.names) && namedPick.names.length > 1 ? namedPick.names : [namedPick.name];
          const found = resolveFaceNames(stampedFaceTable(geom, faceIDsRef.current), wanted);
          if (!found.error && found.picks.length) {
            publishFacePicks(found.picks, geom, positions, index);
            if (containerRef.current) containerRef.current.setAttribute('data-feature-picks', 'renamed');
          }
        }
      }

      if (!preservePicks && cadBodyStickyRef.current) showCadBodyHighlightRef.current?.();

      // Auto scale: re-frame the part after every successful run so the new geometry is
      // never left off-screen or tiny. Keeps the user's current orbit direction.
      if (autoFitEnabled && !opts.editPreview) {
        const bounds = calculateBoundsFromMesh(meshData);
        if (bounds) handleZoomToFit();
      }
      
      if (booleanModeRef.current) paintBooleanPicksRef.current(booleanModeRef.current);

      if (memoryUsedMB) {
        console.log(`[Viewport] Memory after execution: ${memoryUsedMB.toFixed(1)}MB`);
      }
      
      const rolledBack = Array.isArray(result?.rolledBack) ? result.rolledBack : [];
      // Per-block kernel time from the worker's tracker (feature_tree `ms`).
      const featureTimings = Array.isArray(result?.featureTimings) ? result.featureTimings : [];
      // Feature memoisation report (status.cache, feature_tree `cached`).
      const featureCache = result?.featureCache && typeof result.featureCache === 'object' ? result.featureCache : null;
      if (rolledBack.length) {
        console.log(`[Viewport] Rolled back ${rolledBack.join(', ')}; those features did not run.`);
      } else {
        console.log('[Viewport] Script executed successfully');
      }
      const g = graphTimingRef.current || {};
      const workerTiming = result.timing || {};
      const totalMs = performance.now() - runTimingStartRef.current;
      const report = {
        seq: (typeof window !== 'undefined' ? (window.__SURFCAD_RUN_TIMING?.seq || 0) : 0) + 1,
        totalMs,
        workerExecMs: workerTiming.execMs ?? null,
        serializeMs: workerTiming.serializeMs ?? null,
        transferMs: workerTiming.transferMs ?? null,
        roundTripMs: workerTiming.roundTripMs ?? null,
        faceGraphMs: g.faceMs ?? null,
        edgeGraphMs: (g.featureMs || 0) + (g.topoMs || 0) + (g.annotateMs || 0),
        uploadMs: g.uploadMs ?? null,
        contourGraphMs: (g.coherentMs || 0) + (g.seamMs || 0),
        featureMs: g.featureMs ?? null,
        topoMs: g.topoMs ?? null,
        annotateMs: g.annotateMs ?? null,
        coherentMs: g.coherentMs ?? null,
        seamMs: g.seamMs ?? null,
      };
      if (typeof window !== 'undefined') window.__SURFCAD_RUN_TIMING = report;
      if (import.meta.env?.DEV || globalThis.__SURFCAD_MESH_TIMING) {
        console.info('[mesh] run', report);
      }
      if (!opts.editPreview) {
        const skip = result?.featureSkip;
        if (skip && typeof skip.featureId === 'string' && skip.featureId) {
          // The new mesh is the recovered solid. Keep the original error
          // visible and mark the chips, without the leftover-part outline.
          const msg = typeof skip.message === 'string' && skip.message ? skip.message : 'Script execution failed';
          stageExecErrorRef.current = msg;
          setExecutionError(msg);
          onRunOutcomeRef.current?.({
            script,
            ok: false,
            scriptLine: Number.isFinite(skip.scriptLine) ? skip.scriptLine : null,
            featureId: skip.featureId,
            featureBlock: typeof skip.featureBlock === 'string' ? skip.featureBlock : null,
            skipped: Array.isArray(skip.skipped) ? skip.skipped : [],
            message: msg,
            // A block the watchdog killed: the part was rebuilt without it.
            ...(typeof skip.code === 'string' && skip.code ? { code: skip.code } : {}),
            ...(skip.timeout && typeof skip.timeout === 'object' ? { timeout: skip.timeout } : {}),
            ...(typeof skip.hint === 'string' && skip.hint ? { hint: skip.hint } : {}),
            featureTimings,
            featureCache,
          });
        } else {
          onRunOutcomeRef.current?.({
            script,
            ok: true,
            scriptLine: null,
            ...(rolledBack.length ? { rolledBack } : {}),
            featureTimings,
            featureCache,
          });
        }
      }
      if (soloRunFailedRef.current) {
        soloRunFailedRef.current = false;
        syncFailedPartOutlinesRef.current();
      }
      // Truthy object: callers that only check success keep working; game compare needs nonce.
      return {
        ok: true,
        nonce,
        mesh: meshData,
        bodyCount: bodyCentroidsRef.current.length,
        volume: Number.isFinite(result?.volume) ? result.volume : null,
        boundingBox: result?.boundingBox ?? null,
        bbox: result?.boundingBox ?? null,
        bodyCentroids: bodyCentroidsRef.current,
        meshKey: result?.meshKey || null,
        scriptKey: result?.scriptKey || null,
        salt: result?.salt,
        featureRigid: result?.featureRigid || meshData.featureRigid || null,
        baseCentroid: result?.baseCentroid || null,
        baseBBox: result?.baseBBox || null,
        unmoved: result?.unmoved === true,
        rolledBack,
      };

    } catch (error) {
      if (opts.editPreview) {
        console.error('Edit preview failed:', error);
        return false;
      }
      filletQualityWatchRef.current = null;
      console.error('Error executing script:', error);
      const msg = error.message || 'Script execution failed';
      const detail = kernelExceptionDetail(error, msg);
      // A kernel crash (wasm abort, out of memory, watchdog): the worker was
      // replaced; the record rides on the outcome so status, errors, and
      // the part row say so.
      const crash = kernelCrashRecord(error);
      stageExecErrorRef.current = msg;
      setExecutionError(msg);
      // The worker names the marked feature block that was running
      // (featureId, every engine) and the script line of the failing call
      // (when the stack has one); App marks that feature's chip.
      if (!abortController.aborted) {
        onRunOutcomeRef.current?.({
          script,
          ok: false,
          scriptLine: Number.isFinite(error?.scriptLine) ? error.scriptLine : null,
          featureId: typeof error?.featureId === 'string' ? error.featureId : null,
          featureBlock: typeof error?.featureBlock === 'string' ? error.featureBlock : null,
          skipped: Array.isArray(error?.featureSkip?.skipped) ? error.featureSkip.skipped : [],
          message: msg,
          detail,
          ...(crash ? { crash } : {}),
          // A timed-out block that still left no solid after it was skipped.
          ...(typeof error?.code === 'string' && error.code && !crash ? { code: error.code } : {}),
          ...(error?.timeout && typeof error.timeout === 'object' ? { timeout: error.timeout } : {}),
          ...(typeof error?.hint === 'string' && error.hint ? { hint: error.hint } : {}),
        });
      }

      // Soft-fail stale edge IDs: clear selection + prompt re-pick (never leave armed chip).
      const staleEdges = /Selected edges not found|stale selection|re-pick after geometry/i.test(msg);
      if (staleEdges) {
        clearEdgeHighlight();
        clearEdgeHover();
        setSelectedEdges([]);
        setEdgeModeToast(toastPayload('Selected edges not found — re-pick after geometry changes'));
        armEdgeModeToastClear();
      }

      // A single-script failure still restores the last good mesh.
      // An assembly part must not: noShadow drops the solid and does not
      // rebuild graphs from that previous mesh.
      const prev = noShadow ? null : cachedMeshDataRef.current;
      // The restored last good mesh is stale: draw it as a failed part.
      soloRunFailedRef.current = !!prev?.vertProperties;
      if (prev?.vertProperties && resultRef.current) {
        renderMeshData(prev);
        sheetSpecRollbackRef.current = undefined;
        featureEdgesSourceRef.current = null;
        syncFeatureEdges(resultRef.current?.geometry ?? null);
        // Re-paint edge highlight from current selection (effect also runs).
        if (pickModeRef.current === 'edge') {
          // highlightSelectedEdges is invoked via selectedEdges effect
        }
      } else if (resultRef.current) {
        // assembly-fail: omit this part, drop the cached solid, do not rebuild graphs
        setCachedMeshData(null);
        cachedMeshDataRef.current = null;
        removeContactSeam(resultRef.current);
        resultRef.current.geometry?.dispose();
        resultRef.current.geometry = new BufferGeometry();
        resultRef.current.position.set(0, 0, 0);
        clearHighlight();
        clearEdgeHighlight();
        clearEdgeHover();
        setSelectedFace(null);
        setSelectedEdges([]);
        onFaceSelected?.(null);
        featureEdgesRef.current = [];
        featureEdgesSourceRef.current = null;
        graphsBoundMeshRef.current = null;
        faceIDsRef.current = null;
        if (!noShadow) {
          setEdgeModeToast(toastPayload('Run failed — selection cleared (no prior solid)'));
          armEdgeModeToastClear();
        }
      }
      return noShadow ? { ok: false, error: msg } : false;
    } finally {
      setIsExecuting(false);
      if (executionAbortRef.current === abortController) {
        executionAbortRef.current = null;
      }
    }
  }, [currentScript, materials, onFaceSelected, renderMeshData, clearHighlight, clearEdgeHighlight, clearEdgeHover, autoFitEnabled, handleZoomToFit, selectedEdges, syncFeatureEdges]);

  executeScriptRef.current = executeScript;

  const editKindMatches = (edit, kind) => {
    if (!edit || !kind) return false;
    if (edit.kind === kind || edit.dialog === kind) return true;
    if (kind === 'fillet' && (edit.kind === 'fillet' || edit.kind === 'chamfer')) return true;
    if (kind === 'contour' && edit.dialog === 'contour') return true;
    return false;
  };

  const editPreviewBlocked = () => assemblyRunLockRef?.current === true;

  exitFeatureEditModeRef.current = (dialog) => {
    switch (dialog) {
      case 'fillet':
      case 'chamfer':
        if (!filletModeRef.current) return false;
        exitFilletMode();
        return true;
      case 'shell':
        if (!shellModeRef.current) return false;
        exitShellMode();
        return true;
      case 'draft':
        if (!draftModeRef.current) return false;
        exitDraftMode();
        return true;
      case 'cut':
        if (!cutModeRef.current) return false;
        exitCutMode();
        return true;
      case 'boolean':
        if (!booleanModeRef.current) return false;
        exitBooleanMode();
        return true;
      case 'move':
        if (!moveModeRef.current) return false;
        exitMoveMode();
        return true;
      case 'rotate':
        if (!rotateModeRef.current) return false;
        exitRotateMode();
        return true;
      case 'mirror':
        if (!mirrorModeRef.current) return false;
        exitMirrorMode();
        return true;
      case 'moveFace':
        if (!moveFaceModeRef.current) return false;
        exitMoveFaceMode();
        return true;
      case 'deleteFace':
        if (!deleteFaceModeRef.current) return false;
        exitDeleteFaceMode();
        return true;
      default:
        return false;
    }
  };

  cancelFeatureEditRef.current = (kind) => {
    const edit = featureEditRef.current;
    if (!edit || edit.opening || !editKindMatches(edit, kind)) return;
    const full = edit.previewed ? edit.script : '';
    featureEditRef.current = null;
    setHelperEdit(null);
    setFeatureEditBanner('');
    setFeatureDeleteConfirm(null);
    if (full && !editPreviewBlocked()) executeScriptRef.current?.(full, { editPreview: true });
  };

  commitFeatureEditRef.current = (draft) => {
    const edit = featureEditRef.current;
    if (!edit) return false;
    const ok = onCommitFeatureEditRef.current?.({ feature: edit.feature, draft });
    if (!ok) return false;
    const live = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
    const full = edit.previewed && live === edit.script ? edit.script : '';
    featureEditRef.current = null;
    setHelperEdit(null);
    setFeatureEditBanner('');
    if (full && !editPreviewBlocked()) executeScriptRef.current?.(full, { editPreview: true });
    return true;
  };

  const dismissFeatureEditAfterDelete = () => {
    // Clear the session before the mode exits. Those exits call cancel, which
    // would otherwise rebuild the preview of the script we just deleted.
    featureEditRef.current = null;
    setHelperEdit(null);
    setFeatureEditBanner('');
    if (contourModeRef.current) exitContourMode();
    if (filletModeRef.current) exitFilletMode();
    if (shellModeRef.current) exitShellMode();
    if (draftModeRef.current) exitDraftMode();
    if (cutModeRef.current) exitCutMode();
    if (booleanModeRef.current) exitBooleanMode();
    if (moveModeRef.current) exitMoveMode();
    if (rotateModeRef.current) exitRotateMode();
    if (mirrorModeRef.current) exitMirrorMode();
    if (moveFaceModeRef.current) exitMoveFaceMode();
    if (deleteFaceModeRef.current) exitDeleteFaceMode();
    if (sheetMetalModeRef.current) {
      sheetMetalModeRef.current = null;
      setSheetMetalMode(null);
    }
  };

  const deleteFeatureFromEdit = (withDependents = false, confirmed = withDependents) => {
    const edit = featureEditRef.current;
    if (!edit?.feature) return;
    const script = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || edit.script || '';
    if (!confirmed) {
      const plan = featureDeletePlan(script, edit.feature);
      if (plan.confirm) {
        // A base feature (it declares `part`) is deleted on its own after the
        // confirm; the later features that still name `part` go red.
        setFeatureDeleteConfirm({
          count: plan.count,
          label: plan.message,
          base: !!plan.base,
          withDependents: !plan.base,
        });
        return;
      }
      if (!plan.ok) {
        showContourToast(plan.message);
        return;
      }
    }
    setFeatureDeleteConfirm(null);
    const ok = onDeleteFeatureEditRef.current?.(edit.feature, { withDependents: !!withDependents });
    if (!ok) return;
    dismissFeatureEditAfterDelete();
    setFeatureDeleteToast(['Deleted.']);
    if (featureDeleteToastTimerRef.current) clearTimeout(featureDeleteToastTimerRef.current);
    featureDeleteToastTimerRef.current = setTimeout(() => {
      featureDeleteToastTimerRef.current = null;
      setFeatureDeleteToast(null);
    }, 3200);
  };

  const featureEditDelete = featureEditRef.current ? deleteFeatureFromEdit : null;

  const liveGraphFaces = () => {
    const geom = resultRef.current?.geometry;
    if (!geom) return [];
    const graph = warmFaceGraph(geom, faceIDsRef.current);
    return (graph?.patches || []).map((patch) => ({
      center: patch.center,
      normal: patch.normal,
      indices: patch.tris,
      id: patch.id,
    }));
  };

  beginFeatureEditRef.current = (feature, script) => {
    const dialog = creationDialogFor(feature?.kind);
    if (!dialog) return false;
    const text = typeof script === 'string' ? script : '';
    if (mode !== 'game' && feature?.kind === 'hole') {
      const opened = readContourHole(text, feature.id);
      if (opened) {
        if (!allowFeaturePopup()) return false;
        holeEditRef.current = { ...opened, feature };
        holeCentresEditRef.current = null;
        holeSpecRef.current = null;
        featureEditRef.current = null;
        setHelperEdit(null);
        setFeatureEditBanner('');
        if (featureSlotsRef.current) {
          featureSlotsRef.current = null;
          setFeatureSlots(null);
        }
        if (contourModeRef.current) exitContourMode();
        setHoleCard(holeCardFromSpec(opened.spec));
        return true;
      }
      holeEditRef.current = null;
      setHoleCard(null);
    }
    if (mode !== 'game' && isSolidContourEntry(dialog.entry)) {
      if (!allowFeaturePopup()) return false;
      const session0 = openFeatureEdit(text, feature);
      const block = session0.block || featureBlockText(text, feature);
      featureEditRef.current = null;
      setHelperEdit(null);
      setFeatureEditBanner('');
      openFeatureSlots(dialog.entry, featureSlotCardFromEdit({
        ...(session0.ok ? session0 : { fields: {} }),
        entry: dialog.entry,
        kind: feature.kind,
        feature: session0.feature || feature,
        block,
      }, listSavedContours(text)));
      return true;
    }
    const session0 = openFeatureEdit(text, feature);
    if (!session0.ok) {
      showContourToast(session0.message || 'Could not open that feature.');
      return false;
    }
    if (!allowFeaturePopup()) return false;
    const needsPreview = ['fillet', 'chamfer', 'shell', 'draft', 'cut', 'moveFace', 'deleteFace', 'sweep'].includes(feature.kind);
    featureEditRef.current = {
      feature: session0.feature || feature,
      kind: feature.kind,
      dialog: dialog.dialog,
      script: text,
      previewed: false,
      opening: true,
      session: session0,
      clearMissing: false,
      missingEdges: session0.missingEdges || [],
      missingFaces: session0.missingFaces || [],
      resolvedFaces: session0.resolvedFaces || [],
    };
    setHelperEdit(null);
    setFeatureEditBanner('');
    const launch = async () => {
      setAuthorizedFeatureEdit(true);
      const pendingSheet = pendingSheetChipRef.current;
      pendingSheetChipRef.current = null;
      let session = session0;
      try {
        if (needsPreview && !editPreviewBlocked()) {
          const preview = editPreviewScript(text, feature);
          const ran = await executeScriptRef.current?.(preview, { editPreview: true });
          if (!featureEditRef.current) return;
          featureEditRef.current.previewed = !!ran;
          if (ran && session0.ok) {
            session = openFeatureEdit(text, feature, {
              // Named refs resolve against the live edges' names (edge identity).
              edges: withEdgeNamesRef.current(featureEdgesRef.current || []),
              faces: liveGraphFaces(),
            });
            if (session.ok && featureEditRef.current) {
              featureEditRef.current.session = session;
              featureEditRef.current.missingEdges = session.missingEdges || [];
              featureEditRef.current.missingFaces = session.missingFaces || [];
              featureEditRef.current.resolvedFaces = session.resolvedFaces || [];
              featureEditRef.current.feature = session.feature || feature;
            }
          }
        }
        if (!featureEditRef.current) return;
        if (!allowFeaturePopup()) {
          featureEditRef.current = null;
          return;
        }
        const active = session.ok ? session : session0;
        const label = [active.missingEdgeLabel, active.missingFaceLabel].filter(Boolean).join(' · ');
        if (dialog.dialog !== 'fillet' && dialog.dialog !== 'chamfer') setFeatureEditBanner(label);
        if (dialog.dialog === 'fillet' || dialog.dialog === 'chamfer') {
          const chamfer = feature.kind === 'chamfer';
          enterFilletMode({
            entry: chamfer ? 'chamferEdges' : 'filletEdges',
            edges: active.resolvedEdges || [],
            params: chamfer ? { chamfer: active.fields?.chamfer } : { radius: active.fields?.radius },
            missingLabel: label,
          });
        } else if (dialog.dialog === 'contour') {
          enterContourMode({ entry: dialog.entry });
          setContourMode((prev) => applyContourEditSeed(prev, active));
          if (feature.kind === 'sweep') setSelectedEdges(active.resolvedEdges || []);
        } else if (dialog.dialog === 'helper') {
          setHelperEdit({
            helperId: dialog.helperId,
            feature: featureEditRef.current.feature,
            fields: active.fields || {},
            script: text,
          });
        } else if (dialog.dialog === 'sheetMetal' && active.spec) {
          const binding = sheetMetalBinding?.sku && sheetMetalBinding.sku === active.spec.sku
            ? sheetMetalBinding
            : null;
          const next = reopenSheetMetalMode(active.spec, activePartIdRef.current, binding);
          if (contourModeRef.current) exitContourMode();
          if (filletModeRef.current) exitFilletMode();
          if (shellModeRef.current) exitShellMode();
          if (draftModeRef.current) exitDraftMode();
          if (cutModeRef.current) exitCutMode();
          if (booleanModeRef.current) exitBooleanMode();
          if (moveModeRef.current) exitMoveMode();
          if (rotateModeRef.current) exitRotateMode();
          if (mirrorModeRef.current) exitMirrorMode();
          if (moveFaceModeRef.current) exitMoveFaceMode();
          if (deleteFaceModeRef.current) exitDeleteFaceMode();
          if (paintModeRef.current) exitPaintModeRef.current();
          if (helperCardOpenRef.current) setHelperCardOpen(false);
          if (feaActive) feaCloseRef.current();
          setSheetMetalPicker(null);
          const opened = pendingSheet?.sheet ? editSheetChip(next, pendingSheet) : next;
          if (opened) {
            setSheetMetalMode(opened);
            if (pendingSheet?.id) setSheetRibbonActiveId(pendingSheet.id);
          }
        } else if (dialog.dialog === 'shell') {
          enterShellMode();
          const face = (active.resolvedFaces || [])[0] || null;
          const next = enterShellState(face);
          next.params = {
            ...next.params,
            wall: active.fields?.wall,
            openingMode: active.fields?.openingMode === 'none' ? 'none' : 'face',
          };
          next.lastFace = face;
          shellModeRef.current = next;
          setShellMode(next);
          if ((active.resolvedFaces || []).some((item) => item.indices?.length)) {
            const geom = resultRef.current?.geometry;
            publishFacePicks(active.resolvedFaces, geom, geom?.attributes?.position, geom?.index?.array);
          }
        } else if (dialog.dialog === 'draft') {
          enterDraftMode();
          const ref = active.reference;
          const neutral = ref
            ? liveGraphFaces().find((face) => {
              if (!face.center || !face.normal) return false;
              const dc = Math.hypot(face.center[0] - ref.center[0], face.center[1] - ref.center[1], face.center[2] - ref.center[2]);
              const dot = face.normal[0] * ref.normal[0] + face.normal[1] * ref.normal[1] + face.normal[2] * ref.normal[2];
              return dc < 1 && dot > 0.98;
            }) || null
            : null;
          const next = {
            ...emptyDraftState(neutral),
            angle: active.fields?.angle,
            flip: !!active.fields?.flip,
            drafts: active.resolvedFaces || [],
            neutral,
          };
          draftModeRef.current = next;
          setDraftMode(next);
          paintDraftPicks(next);
        } else if (dialog.dialog === 'cut') {
          enterCutMode();
          const next = { ...emptyCutState(), originOffset: Number(active.fields?.originOffset) || 0 };
          cutModeRef.current = next;
          setCutMode(next);
        } else if (dialog.dialog === 'boolean') {
          enterBooleanMode();
          const next = { ...emptyBooleanState(), op: active.fields?.op || 'union' };
          booleanModeRef.current = next;
          setBooleanMode(next);
        } else if (dialog.dialog === 'move') {
          enterMoveMode();
          const at = active.fields?.at;
          let next = {
            ...emptyMoveState(),
            dx: Number(active.fields?.dx) || 0,
            dy: Number(active.fields?.dy) || 0,
            dz: Number(active.fields?.dz) || 0,
            target: Array.isArray(at) ? { at: at.slice() } : null,
          };
          next = syncMoveTargetFromMesh(next);
          moveModeRef.current = next;
          setMoveMode(next);
          if (next.target?.triangles?.length) {
            const geom = resultRef.current?.geometry;
            const positions = geom?.attributes?.position;
            const index = geom?.index?.array;
            if (positions && index) {
              highlightFace(next.target.triangles, geom, positions, index, 0x22d3ee, 'move-body');
            }
          }
          paintMovePreview(next);
        } else if (dialog.dialog === 'rotate') {
          enterRotateMode();
          const at = active.fields?.at;
          const axis = active.fields?.axis;
          const center = active.fields?.center;
          let next = {
            ...emptyRotateState(),
            angle: Number(active.fields?.angle) || 0,
            target: Array.isArray(at) ? { at: at.slice() } : null,
          };
          if (axis === 'x' || axis === 'y' || axis === 'z') {
            next.axis = axis;
          } else if (axisToVector(axis)) {
            next.axis = 'custom';
            next.axisVec = axisToVector(axis);
          }
          if (Array.isArray(center) && center.length >= 3) {
            next.centerMode = 'custom';
            next.center = center.slice(0, 3).map(Number);
          }
          next = syncRotateTargetFromMesh(next);
          rotateModeRef.current = next;
          setRotateMode(next);
          if (next.target?.triangles?.length) {
            const geom = resultRef.current?.geometry;
            const positions = geom?.attributes?.position;
            const index = geom?.index?.array;
            if (positions && index) {
              highlightFace(next.target.triangles, geom, positions, index, 0x22d3ee, 'rotate-body');
            }
          }
          paintRotatePreview(next);
        } else if (dialog.dialog === 'mirror') {
          enterMirrorMode();
          let next = mirrorStateFromFields(active.fields);
          next = syncMirrorTargetFromMesh(next);
          mirrorModeRef.current = next;
          setMirrorMode(next);
          setSelectedPlaneId(mirrorSelectedPlaneId(next));
          if (next.target?.triangles?.length) {
            const geom = resultRef.current?.geometry;
            const positions = geom?.attributes?.position;
            const index = geom?.index?.array;
            if (positions && index) {
              highlightFace(next.target.triangles, geom, positions, index, 0x22d3ee, 'mirror-body');
            }
          }
          paintMirrorPreview(next);
        } else if (dialog.dialog === 'moveFace') {
          enterMoveFaceMode();
          commitMoveFaceState({
            ...emptyMoveFaceState(active.resolvedFaces || []),
            distance: active.fields?.distance,
            flip: !!active.fields?.flip,
          });
        } else if (dialog.dialog === 'deleteFace') {
          enterDeleteFaceMode();
          commitDeleteFaceState(emptyDeleteFaceState(active.resolvedFaces || []));
        }
      } finally {
        setAuthorizedFeatureEdit(false);
        if (featureEditRef.current) featureEditRef.current.opening = false;
      }
    };
    void launch();
    return true;
  };

  clearAssemblyExtrasRef.current = () => {
    const group = assemblyGroupRef.current;
    prewarmGenRef.current += 1;
    for (const mesh of assemblyExtrasRef.current.values()) {
      detachFaceColorSkin(mesh);
      group?.remove(mesh);
      releaseGeometryIn(solidCacheRef.current, mesh.geometry);
      if (mesh.material?.dispose) mesh.material.dispose();
    }
    assemblyExtrasRef.current.clear();
    pruneSolidCacheIn(solidCacheRef.current, resultRef.current, assemblyExtrasRef.current);
  };

  /**
   * Pre-build face and edge graphs of the other visible parts in idle time,
   * one part per slice, so the first pick that retargets onto one of them
   * finds its graphs ready. Graphs are cached by geometry; nothing here
   * touches the pick mesh, the selection, or the active part's graphs.
   * A new placement cancels a pass in flight. Very large parts are skipped.
   */
  prewarmPartGraphsRef.current = () => {
    const gen = ++prewarmGenRef.current;
    const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? (fn) => window.requestIdleCallback(fn, { timeout: 3000 })
      : (fn) => setTimeout(() => fn(null), 120);
    // One graph per slice (face, then edges, then seam) keeps each idle task short.
    const jobs = [];
    for (const mesh of assemblyExtrasRef.current.values()) {
      const geom = mesh?.geometry;
      if (!geom?.index || mesh.userData?.leftover) continue;
      if (geom.index.count / 3 > PREWARM_MAX_TRIS) continue;
      jobs.push({ geom, kind: 'face' }, { geom, kind: 'edge' }, { geom, kind: 'seam' });
    }
    const step = (deadline) => {
      if (gen !== prewarmGenRef.current) return;
      // Not while the user is orbiting or dragging, and not into a busy frame.
      const busy = isDraggingRef.current
        || (deadline && !deadline.didTimeout && deadline.timeRemaining() < 8);
      if (!busy) {
        const job = jobs.shift();
        const entry = job ? solidEntryForGeometry(solidCacheRef.current, job.geom) : null;
        if (entry) {
          try {
            if (job.kind === 'face') warmFaceGraph(job.geom, entry.faceIDs);
            else if (job.kind === 'edge') featureGraphFor(job.geom, entry.faceIDs);
            else contactSeamFor(entry.meshData);
          } catch (err) {
            console.warn('[Viewport] part graph prewarm skipped:', err?.message || err);
          }
        }
      }
      if (jobs.length) idle(step);
    };
    if (jobs.length) idle(step);
  };

  /**
   * Show this part's solid as the pick mesh and rebuild face, edge, and
   * contour graphs on it before a pick. Contours are buildCoherentEdges
   * inside syncFeatureEdges. Other assembly meshes raycast; a hit retargets
   * onto that part and rebinds these graphs before the pick is resolved.
   */
  adoptActiveSolidRef.current = ({ mesh, position, placement, partId }) => {
    if (!resultRef.current || !mesh?.vertProperties) return false;
    if (partId !== undefined) activePartIdRef.current = partId ?? null;
    featureRigidRef.current = mesh?.featureRigid || null;
    if (resultRef.current) resultRef.current.userData.featureRigid = featureRigidRef.current;
    if (partId != null && partSurfIdRef.current.has(String(partId))) {
      resultRef.current.userData.surfId = partSurfIdRef.current.get(String(partId));
    }
    // Fillet / Chamfer picks accumulate across parts: a switch keeps the
    // edges already picked on the previous part (each edge carries its part).
    const keepEdges = retargetKeepsEdgePicks({ filletMode: filletModeRef.current });
    if (paintModeRef.current?.picks?.length) {
      const kept = paintPicksAfterMeshChange(cachedMeshDataRef.current === mesh, paintModeRef.current.picks);
      if (kept !== paintModeRef.current.picks) {
        const next = { ...paintModeRef.current, picks: kept };
        paintModeRef.current = next;
        setPaintMode(next);
      }
    }
    clearHighlight();
    clearEdgeHighlight();
    clearEdgeHover();
    clearFilletBlendPreview();
    clearIdLabels();
    setSelectedFace(null);
    if (!keepEdges) setSelectedEdges([]);
    onFaceSelected?.(null);
    const same = cachedMeshDataRef.current === mesh
      && resultRef.current.geometry?.attributes?.position;
    if (!same) {
      renderMeshData(mesh);
      setCachedMeshData(mesh);
      cachedMeshDataRef.current = mesh;
    } else {
      warmFaceGraph(resultRef.current.geometry, faceIDsRef.current);
      applyFaceSkinRef.current(resultRef.current);
    }
    applyPartPose(resultRef.current, placement || { t: Array.isArray(position) ? position : [0, 0, 0], q: [0, 0, 0, 1] });
    if (partId !== undefined && partId !== sheetPartIdRef.current) {
      sheetPartIdRef.current = partId ?? null;
      sheetSpecRef.current = sheetSpecInScript(currentScript || '');
    }
    featureEdgesSourceRef.current = null;
    syncFeatureEdges(resultRef.current.geometry ?? null);
    graphsBoundMeshRef.current = mesh;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    syncAnchoredOverlays();
    if (keepEdges && selectedEdgesRef.current?.length) {
      // Repaint now (no frame without the kept picks), then hand the effects
      // a new reference so the blend preview re-reads the active part.
      highlightSelectedEdges(selectedEdgesRef.current);
      setSelectedEdges((prev) => (prev.length ? prev.slice() : prev));
    }
    if (renderer && scene && camera) renderer.render(scene, camera);
    if (booleanModeRef.current) paintBooleanPicksRef.current(booleanModeRef.current);
    return true;
  };

  const upsertAssemblyExtra = (id, meshData, position, placement = null) => {
    if (!id || !meshData?.vertProperties || !sceneRef.current) return;
    if (!assemblyGroupRef.current) {
      const group = new Group();
      group.name = 'assembly-parts';
      sceneRef.current.add(group);
      assemblyGroupRef.current = group;
    }
    const group = assemblyGroupRef.current;
    let mesh = assemblyExtrasRef.current.get(id);
    if (!mesh) {
      mesh = new ThreeMesh(undefined, makeDefaultPartMaterial());
      mesh.name = 'assembly-part';
      mesh.userData.assemblyPartId = id;
      group.add(mesh);
      assemblyExtrasRef.current.set(id, mesh);
    }
    // The solid this part just showed as the pick mesh: same cached
    // geometry, handed over instead of rebuilt.
    const { geometry: geom } = cachedSolidGeometry(solidCacheRef.current, meshData, definitionOf(id));
    if (mesh.geometry !== geom) {
      releaseGeometryIn(solidCacheRef.current, mesh.geometry);
      mesh.geometry = geom;
    }
    ensureBodyMaterial(mesh, meshData);
    applyPartPose(mesh, placement || { t: position || [0, 0, 0], q: [0, 0, 0, 1] });
  };

  swapPickPartRef.current = ({ partId, mesh, position, placement }) => {
    if (!partId || !mesh?.vertProperties || !resultRef.current) return false;
    const prevId = activePartIdRef.current;
    if (paintModeRef.current) {
      const kept = paintPicksAfterPartChange(prevId, partId, paintModeRef.current.picks);
      if (kept !== paintModeRef.current.picks) {
        const next = { ...paintModeRef.current, picks: kept };
        paintModeRef.current = next;
        setPaintMode(next);
      }
    }
    if (prevId && String(prevId) === String(partId) && cachedMeshDataRef.current === mesh) {
      activePartIdRef.current = partId;
      applyPartPose(resultRef.current, placement || { t: position || [0, 0, 0], q: [0, 0, 0, 1] });
      return true;
    }
    const prevMesh = cachedMeshDataRef.current;
    const prevPose = meshPose(resultRef.current) || {
      t: [resultRef.current.position.x, resultRef.current.position.y, resultRef.current.position.z],
      q: [0, 0, 0, 1],
    };
    if (prevId && String(prevId) !== String(partId) && prevMesh?.vertProperties) {
      const prevSurf = resultRef.current.userData?.surfId || partSurfIdRef.current.get(String(prevId)) || null;
      upsertAssemblyExtra(prevId, prevMesh, prevPose.t, prevPose);
      const parked = assemblyExtrasRef.current.get(prevId);
      if (parked) {
        parked.userData.surfId = prevSurf;
        applyFaceSkinRef.current(parked);
      }
    }
    const extra = assemblyExtrasRef.current.get(partId);
    if (extra) {
      setFailedPartOutline(extra, false);
      detachFaceColorSkin(extra);
      assemblyGroupRef.current?.remove(extra);
      // Its geometry is usually the cached solid this switch is about to show.
      releaseGeometryIn(solidCacheRef.current, extra.geometry);
      if (extra.material?.dispose) extra.material.dispose();
      assemblyExtrasRef.current.delete(partId);
    }
    adoptActiveSolidRef.current({
      mesh,
      position: position || [0, 0, 0],
      placement: placement || { t: position || [0, 0, 0], q: [0, 0, 0, 1] },
      partId,
    });
    // The part left behind and the part picked keep their failed state.
    syncFailedPartOutlinesRef.current();
    resultRef.current.updateMatrixWorld(true);
    return true;
  };

  placeAssemblyRef.current = (payload) => {
    const scene = sceneRef.current;
    if (!scene || !resultRef.current) return false;
    const solids = Array.isArray(payload?.solids) ? payload.solids : [];
    const activeId = payload?.activeId ?? null;
    const prevVisible = new Set(assemblyExtrasRef.current.keys());
    const prevActive = activePartIdRef.current;
    if (resultRef.current.geometry?.attributes?.position?.count && prevActive) {
      prevVisible.add(prevActive);
    }
    activePartIdRef.current = activeId;
    if (paintModeRef.current) {
      const kept = paintPicksAfterPartChange(prevActive, activeId, paintModeRef.current.picks);
      if (kept !== paintModeRef.current.picks) {
        const next = { ...paintModeRef.current, picks: kept };
        paintModeRef.current = next;
        setPaintMode(next);
        clearHighlight();
      }
    }
    const surfIds = new Map();
    const rememberSurf = (solid) => {
      if (solid?.id != null && solid.surfId) surfIds.set(String(solid.id), solid.surfId);
      if (solid?.id != null && solid.definitionId) partDefinitionRef.current.set(String(solid.id), String(solid.definitionId));
    };
    for (const solid of solids) rememberSurf(solid);
    for (const solid of (Array.isArray(payload?.leftovers) ? payload.leftovers : [])) rememberSurf(solid);
    partSurfIdRef.current = surfIds;
    if (activeId != null) {
      resultRef.current.userData.surfId = surfIds.get(String(activeId)) || null;
    }
    const blankActive = payload?.blankActive === true;
    // Visible parts whose latest run failed: App's list, else the leftovers
    // (a failed part's last good mesh).
    const failedIds = Array.isArray(payload?.failedIds)
      ? payload.failedIds
      : (Array.isArray(payload?.leftovers) ? payload.leftovers.map((solid) => solid?.id) : []);
    failedPartIdsRef.current = new Set(failedIds.filter((id) => id != null).map(String));
    soloRunFailedRef.current = false;
    if (!assemblyGroupRef.current) {
      const group = new Group();
      group.name = 'assembly-parts';
      scene.add(group);
      assemblyGroupRef.current = group;
    }
    const group = assemblyGroupRef.current;
    applyPartPose(group, { t: [0, 0, 0], q: [0, 0, 0, 1] });
    const keep = new Set();
    let placeUploadMs = 0;
    const timeGeom = (meshData, scope) => {
      const t0 = performance.now();
      const hit = cachedSolidGeometry(solidCacheRef.current, meshData, scope);
      placeUploadMs += performance.now() - t0;
      return hit;
    };
    for (const solid of solids) {
      if (!solid || solid.id === activeId) continue;
      if (!solid.mesh?.vertProperties || !solid.mesh?.triVerts) continue;
      keep.add(solid.id);
      let mesh = assemblyExtrasRef.current.get(solid.id);
      if (!mesh) {
        mesh = new ThreeMesh(undefined, makeDefaultPartMaterial());
        mesh.name = 'assembly-part';
        mesh.userData.assemblyPartId = solid.id;
        group.add(mesh);
        assemblyExtrasRef.current.set(solid.id, mesh);
      }
      mesh.userData.leftover = false;
      // Part instances: rows of one definition share one geometry, so the
      // cache scope is the definition, not the row.
      const { geometry: geom } = timeGeom(solid.mesh, solid.definitionId ?? solid.id);
      if (mesh.geometry !== geom) {
        releaseGeometryIn(solidCacheRef.current, mesh.geometry);
        mesh.geometry = geom;
        delete mesh.userData.crossSectionRestore;
        delete mesh.userData.crossSectionTrimmedMeshData;
      }
      ensureBodyMaterial(mesh, solid.mesh);
      applyPartPose(mesh, solidPlacement(solid));
      mesh.userData.surfId = solid.surfId || null;
      mesh.userData.featureRigid = solid.featureRigid || solid.mesh?.featureRigid || null;
      applyFaceSkinRef.current(mesh);
    }
    const leftoverList = Array.isArray(payload?.leftovers) ? payload.leftovers : [];
    for (const solid of leftoverList) {
      if (!solid?.id || !solid.mesh?.vertProperties || !solid.mesh?.triVerts) continue;
      if (solid.id === activeId && !blankActive) continue;
      keep.add(solid.id);
      let mesh = assemblyExtrasRef.current.get(solid.id);
      if (!mesh) {
        mesh = new ThreeMesh(undefined, makeDefaultPartMaterial());
        mesh.name = 'assembly-part';
        mesh.userData.assemblyPartId = solid.id;
        group.add(mesh);
        assemblyExtrasRef.current.set(solid.id, mesh);
      }
      mesh.userData.assemblyPartId = solid.id;
      mesh.userData.leftover = true;
      const { geometry: geom } = timeGeom(solid.mesh, solid.definitionId ?? solid.id);
      if (mesh.geometry !== geom) {
        releaseGeometryIn(solidCacheRef.current, mesh.geometry);
        mesh.geometry = geom;
        delete mesh.userData.crossSectionRestore;
        delete mesh.userData.crossSectionTrimmedMeshData;
      }
      ensureBodyMaterial(mesh, solid.mesh);
      applyPartPose(mesh, solidPlacement(solid));
      mesh.userData.surfId = solid.surfId || null;
      mesh.userData.featureRigid = solid.featureRigid || solid.mesh?.featureRigid || null;
      applyFaceSkinRef.current(mesh);
    }
    for (const [id, mesh] of assemblyExtrasRef.current) {
      if (keep.has(id)) continue;
      setFailedPartOutline(mesh, false);
      detachFaceColorSkin(mesh);
      group.remove(mesh);
      releaseGeometryIn(solidCacheRef.current, mesh.geometry);
      if (mesh.material?.dispose) mesh.material.dispose();
      assemblyExtrasRef.current.delete(id);
    }
    if (blankActive) {
      // assembly-fail: the active part is hidden or failed. No previous solid.
      setCachedMeshData(null);
      cachedMeshDataRef.current = null;
      detachFaceColorSkin(resultRef.current);
      detachStressSkin(resultRef.current);
      resultRef.current.userData.surfId = null;
      featureRigidRef.current = null;
      bodyCentroidsRef.current = [];
      delete resultRef.current.userData.featureRigid;
      removeContactSeam(resultRef.current);
      releaseGeometryIn(solidCacheRef.current, resultRef.current.geometry);
      resultRef.current.geometry = new BufferGeometry();
      applyPartPose(resultRef.current, { t: [0, 0, 0], q: [0, 0, 0, 1] });
      clearFilletBlendPreview();
      clearIdLabels();
      // Mid-feature hide keeps the picked faces and edges. The mesh is gone
      // until the part is shown again; the pick status stays.
      if (!featureHideKeepsPicks(featureSessionRef.current)) {
        clearEdgeHighlight();
        clearEdgeHover();
      }
      featureEdgesRef.current = [];
      featureEdgesSourceRef.current = null;
      graphsBoundMeshRef.current = null;
      faceIDsRef.current = null;
    } else {
      const active = solids.find((solid) => solid.id === activeId);
      const pose = solidPlacement(active);
      bodyCentroidsRef.current = Array.isArray(active?.bodyCentroids)
        ? active.bodyCentroids
        : bodyCentroidsRef.current;
      featureRigidRef.current = active?.featureRigid || active?.mesh?.featureRigid || null;
      resultRef.current.userData.featureRigid = featureRigidRef.current;
      applyPartPose(resultRef.current, pose);
      if (active?.mesh?.vertProperties && graphsBoundMeshRef.current !== active.mesh) {
        adoptActiveSolidRef.current({ mesh: active.mesh, position: pose.t, placement: pose, partId: activeId });
      } else if (activeId) {
        // The graph was built for this mesh before the part id was known
        // (the run finishes, then the assembly is placed). Tag it now so a
        // later switch can tell these edges from the other part's.
        for (const edge of featureEdgesRef.current || []) edge.partId = activeId;
        const sid = partSurfIdRef.current.get(String(activeId));
        if (sid) resultRef.current.userData.surfId = sid;
        applyFaceSkinRef.current(resultRef.current);
      }
    }
    pruneSolidCacheIn(solidCacheRef.current, resultRef.current, assemblyExtrasRef.current);
    prewarmPartGraphsRef.current();
    syncAnchoredOverlays();
    setOverlayEpoch((n) => n + 1);
    if (autoFitEnabled && solids.length && cameraRef.current) {
      const box = new Box3();
      let framed = false;
      for (const solid of solids) {
        const local = solid.localBBox || solid.bbox;
        const pose = solidPlacement(solid);
        if (local?.min && local?.max) {
          const xs = [Number(local.min[0]), Number(local.max[0])];
          const ys = [Number(local.min[1]), Number(local.max[1])];
          const zs = [Number(local.min[2]), Number(local.max[2])];
          for (const x of xs) {
            for (const y of ys) {
              for (const z of zs) {
                const w = shiftLocalPoint([x, y, z], pose.t, pose.q);
                box.expandByPoint(new Vector3(w[0], w[1], w[2]));
                framed = true;
              }
            }
          }
          continue;
        }
        const src = solid.mesh?.vertProperties;
        if (!src) continue;
        const np = solid.mesh.numProp || 3;
        const n = Math.floor(src.length / np);
        for (let i = 0; i < n; i += 1) {
          const w = shiftLocalPoint([src[i * np], src[i * np + 1], src[i * np + 2]], pose.t, pose.q);
          box.expandByPoint(new Vector3(w[0], w[1], w[2]));
          framed = true;
        }
      }
      if (framed && !box.isEmpty()) {
        fitView({
          camera: cameraRef.current,
          controls: controlsRef.current,
          box,
        });
      }
    }
    if (typeof window !== 'undefined') window.__SURFCAD_PLACE_UPLOAD_MS = placeUploadMs;
    syncFailedPartOutlinesRef.current();
    group.updateMatrixWorld(true);
    if (containerRef.current) {
      containerRef.current.setAttribute('data-assembly-solids', String(solids.length));
      containerRef.current.setAttribute('data-failed-parts', [...failedPartIdsRef.current].join(','));
      containerRef.current.setAttribute('data-assembly-active', blankActive ? 'omitted' : 'shown');
      if (blankActive && featureHideKeepsPicks(featureSessionRef.current)) {
        containerRef.current.setAttribute('data-feature-picks', 'kept');
      }
    }
    refreshSectionClipRef.current();
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
    if (booleanModeRef.current) {
      const nowVisible = new Set(keep);
      if (!blankActive && activeId) nowVisible.add(activeId);
      let next = booleanModeRef.current;
      for (const id of prevVisible) {
        if (!nowVisible.has(id)) next = noteBooleanPartHidden(next, id);
      }
      if (blankActive && activeId) next = noteBooleanPartHidden(next, activeId);
      booleanModeRef.current = next;
      setBooleanMode(next);
      paintBooleanPicksRef.current(next);
    }
    return true;
  };

  /**
   * Download the current model as 3mf
   * Uses cached mesh data when available to avoid re-execution
   */
  /**
   * CAD strip Run. `executeScript()` with no argument already falls back to the
   * live `currentScript`, which App refreshes on every keystroke, so this runs
   * exactly what is in the editor right now.
   */
  const runCadScript = useCallback(async () => {
    if (onRunAssembly) {
      setIsExecuting(true);
      try {
        await onRunAssembly();
      } finally {
        setIsExecuting(false);
      }
      return;
    }
    executeScript();
  }, [executeScript, onRunAssembly]);

  const paintSurfId = () => (
    resultRef.current?.userData?.surfId
    || partSurfIdRef.current.get(String(activePartIdRef.current || ''))
    || null
  );
  const paintFacesNow = () => fingerprintsFromGeometry(resultRef.current?.geometry, faceIDsRef.current);
  const patchPaint = (partial) => {
    const prev = paintModeRef.current;
    if (!prev) return;
    const next = { ...prev, ...partial };
    paintModeRef.current = next;
    setPaintMode(next);
  };
  const storeLivePaint = (result) => {
    const prev = paintModeRef.current;
    if (!prev || !result) return;
    const next = {
      ...prev,
      session: result.session,
      undo: result.undo,
      lastTap: result.lastTap,
    };
    paintModeRef.current = next;
    setPaintMode(next);
    repaintFaceSkins();
  };
  applyLivePaintTapRef.current = (clickData) => {
    const state = paintModeRef.current;
    if (!state || !clickData) return;
    const color = resolvedPaintColor(state.color, state.custom);
    const surfId = paintSurfId();
    if (!color || !surfId) return;
    const { seedFaceIndex, geometry, faceNormal } = clickData;
    const pick = paintPickFromClick({
      geometry,
      faceIDs: faceIDsRef.current,
      seedFaceIndex,
      faceNormal,
      angleTolerance: ANGLE_TOLERANCE_DEGREES,
    });
    if (!pick?.key) return;
    const now = Date.now();
    const keyJson = JSON.stringify(pick.key);
    const last = state.lastTap;
    const upgrade = last
      && last.surfId === surfId
      && last.keyJson === keyJson
      && now - last.at <= PAINT_DOUBLE_TAP_MS;
    let bodyKeys = null;
    if (upgrade) {
      const body = resolveViewportFaceClick({
        geometry,
        seedFaceIndex,
        faceNormal,
        clickCount: 2,
        faceIDs: faceIDsRef.current,
        angleTolerance: ANGLE_TOLERANCE_DEGREES,
        legacy: false,
      });
      bodyKeys = paintKeysForTriangles(geometry, faceIDsRef.current, body?.indices || []);
    }
    const result = livePaintTap(state, {
      surfId,
      color,
      key: pick.key,
      bodyKeys,
      faces: paintFacesNow(),
      now,
    });
    storeLivePaint(result);
    clearEdgeHighlight();
    setSelectedEdges([]);
  };
  const acceptPaint = () => {
    const state = paintModeRef.current;
    if (!state || mode === 'game') return;
    if (!resolvedPaintColor(state.color, state.custom)) return;
    if (livePaintChanged(state.session, state.baseline)) {
      const wrote = onCommitPaint?.({ op: 'session', colors: state.session });
      if (wrote === false) return;
    }
    // The assembly colors update in this same turn. Do not repaint from the
    // old map first, or the skin flashes back before Confirm lands.
    paintModeRef.current = null;
    setPaintMode(null);
    clearHighlight();
  };
  const paintWholePart = () => {
    const state = paintModeRef.current;
    if (!state) return;
    const color = resolvedPaintColor(state.color, state.custom);
    const surfId = paintSurfId();
    if (!color || !surfId) return;
    storeLivePaint(livePaintPart(state, { surfId, color }));
  };
  const undoLivePaint = () => {
    const state = paintModeRef.current;
    if (!state) return;
    storeLivePaint(livePaintUndo(state));
  };
  const clearLivePaint = () => {
    const state = paintModeRef.current;
    if (!state) return;
    storeLivePaint(livePaintClear(state));
  };
  const removeUnmatchedPaint = () => {
    const state = paintModeRef.current;
    const surfId = paintSurfId();
    if (!state || !surfId) return;
    storeLivePaint(livePaintUnmatched(state, { surfId, faces: paintFacesNow() }));
  };
  enterPaintModeRef.current = enterPaintMode;
  exitPaintModeRef.current = exitPaintMode;
  acceptPaintRef.current = acceptPaint;
  patchPaintRef.current = patchPaint;
  storeLivePaintRef.current = storeLivePaint;
  paintWholePartRef.current = paintWholePart;
  undoLivePaintRef.current = undoLivePaint;
  clearLivePaintRef.current = clearLivePaint;
  paintSurfIdRef.current = paintSurfId;
  handleMeasurementToggleRef.current = handleMeasurementToggle;
  commitMeasurePicksRef.current = commitMeasurePicks;
  syncFeatureEdgesRef.current = syncFeatureEdges;
  agentPaintMeasureHostRef.current = createPaintMeasureAgentHandlers({
    appMode: mode,
    paintModeRef,
    measurementEnabledRef,
    measurePicksRef,
    enterPaintModeRef,
    exitPaintModeRef,
    acceptPaintRef,
    patchPaintRef,
    storeLivePaintRef,
    paintWholePartRef,
    undoLivePaintRef,
    clearLivePaintRef,
    paintSurfIdRef,
    handleMeasurementToggleRef,
    exitMeasureModeRef,
    commitMeasurePicksRef,
    getMesh: () => resultRef.current,
    // paint_open waits on this instead of opening nothing.
    paintOpenBlocked: () => (featurePopupAllowed() ? null : 'prompt_working'),
    faceIDsRef,
    activePartIdRef,
    featureEdgesRef,
    boundaryTopoRef,
    syncFeatureEdgesRef,
  });
  agentFeaHostRef.current = createFeaAgentHandlers({
    appMode: mode,
    panelRef: feaPanelRef,
    feaToggleRef,
    feaCloseRef,
    feaActiveRef,
    getMesh: () => resultRef.current,
    faceIDsRef,
    activePartIdRef,
  });
  agentXsectionHostRef.current = createXsectionAgentHandlers({
    panelRef: crossSectionPanelRef,
    enabledRef: crossSectionEnabledRef,
    getMesh: () => {
      const active = resultRef.current;
      if (active?.geometry?.attributes?.position?.count) return active;
      for (const mesh of assemblyExtrasRef.current.values()) {
        if (mesh?.geometry?.attributes?.position?.count) return mesh;
      }
      return active;
    },
    getAppliedPlane: () => crossSectionAppliedRef.current,
    getAppliedGen: () => crossSectionAppliedGenRef.current,
    getDiagnostics: () => {
      const targets = crossSectionTargets();
      const summary = summarizeCrossSection(targets);
      const applied = crossSectionAppliedRef.current;
      return {
        assemblyScope: isAssemblyCrossSectionScope(assemblyRunLockRef, assemblyExtrasRef),
        targetPartIds: targets.map((t) => t.partId),
        trimmedPartIds: targets
          .filter((t) => t.mesh?.userData?.crossSectionTrimmedMeshData)
          .map((t) => t.partId),
        geometryMutated: sectionHosts().some((mesh) => !!(
          mesh?.userData?.crossSectionRestore || mesh?.userData?.crossSectionTrimmedMeshData
        )),
        planeInScene: !!(
          cuttingPlaneWidgetRef.current
          && cuttingPlaneWidgetRef.current.parent === sceneRef.current
        ),
        planeColor: cuttingPlaneWidgetRef.current?.userData?.color ?? null,
        clippedMaterials: sectionClipSession()?.materials?.size ?? 0,
        remainingVolume: summary.remainingVolume,
        capCount: summary.capCount,
        parts: summary.parts,
        appliedPlane: applied,
        appliedGen: applied?.gen ?? crossSectionAppliedGenRef.current,
      };
    },
  });
  const paintUnmatched = paintMode
    ? unmatchedColorCount(paintMode.session, paintSurfId(), paintFacesNow())
    : 0;

  const titleParts = formatViewerTitle(
    currentFilename,
    typeof assemblyName === 'string' ? assemblyName : '',
    { partSelected: cadPartSelected !== false },
  );

  // Contour mode keeps the part-in-assembly row in layout so the status
  // legend can sit on that same box. The chips themselves are hidden.
  const hideCadTitle = mode !== 'game' && !!contourMode;
  const contourLegend = hideCadTitle && !isWorkplaneEntry(contourMode.entry);

  return (
    <div
      ref={containerRef}
      className="viewport-shell relative w-full h-full bg-[#1e1e1e] overflow-hidden"
      data-agent-viewport=""
      data-contour-face-aim={contourFaceAim || undefined}
    >
      {partChoice?.choices?.length > 1 && (
        <div
          data-which-part-chip=""
          className="absolute z-30 w-44 rounded-lg surface-glass-chip border border-white/15 p-2 shadow-lg"
          style={{ left: partChoice.left, top: partChoice.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-300">
            Which part?
          </div>
          {partChoice.choices.map((item) => (
            <button
              key={item.partId}
              type="button"
              data-which-part={item.partId}
              className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-chrome-text hover:bg-white/10"
              onClick={() => chooseAmbiguousPart(item.partId)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      {/* G9: circular profile chip — top-right of the CAD viewport. Desktop's only chip. */}
      {mode !== 'game' && (
        <ProfileChip
          variant="viewport"
          onAccount={onAccount}
          onSignedOut={onSignedOut}
          onClearLocalCadData={onClearLocalCadData}
          vaultName={profileVaultName}
          agentBridgeLive={agentBridgeLive}
          stackedTitle={!!(showCadTitle && !hideCadTitle && titleParts.assembly)}
        />
      )}

      {/* Five taps in this corner enter the puzzle. The IO tray is gone, so the corner itself is the target. */}
      <PuzzleUnlock enabled={mode !== 'game'} onUnlock={onStartGame} />

      {/* CAD chrome lives in the editor mid-strip in BOTH shells (desktop matches
          phone now): rendered here so Run can execute the live buffer without
          a round trip via App. Upload and Download are on the Parts ribbon.
          Order is the part-row cart button. */}
      {mode !== 'game' && cadToolbarHost && createPortal(
        <Toolbar
          mode="cad"
          variant="strip"
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          isExecuting={isExecuting}
          onExitGame={onExitGame}
          onRun={onRun}
          onRunScript={runCadScript}
          onSelectAll={onSelectAll}
          onHint={onHint}
          onPickPuzzle={onPickPuzzle}
          gameElapsedMs={gameElapsedMs}
          gameSuccess={gameSuccess}
          gameBestTimeMs={gameBestTimeMs}
        />,
        cadToolbarHost,
      )}

      {/* Title row. Game: puzzle name. CAD: part, then "in", then assembly.
          Up to 768px that title stacks (part, then "in" plus the assembly)
          in the gap between the wordmark and the profile chip. Wider
          screens keep one centred row. Contour mode keeps the row laid
          out and hides the chips, and centres the status legend on that box. */}
      {mode === 'game' && (
        <ViewportTitleChip>{gamePuzzleTitle || 'Puzzle'}</ViewportTitleChip>
      )}
      {mode !== 'game' && (brandHeader || showCadTitle) && (
        <div
          className="pointer-events-none absolute top-4 lg:top-2 z-20 flex min-h-9 items-center gap-2 left-2 right-2 lg:left-4 lg:right-4 pr-11"
          data-viewer-header-row=""
        >
          {brandHeader ? (
            <div
              className="relative z-10 inline-flex shrink-0 items-center self-center pointer-events-auto"
              data-brand-header-host=""
            >
              <button
                type="button"
                data-brand-about-trigger=""
                aria-label="About SurfCAD"
                className="inline-flex shrink-0 items-center rounded-md p-0.5
                  text-chrome-text hover:bg-white/10 focus-visible:outline focus-visible:outline-2
                  focus-visible:outline-offset-2 focus-visible:outline-cyan-400/80"
                onClick={() => setAboutOpen(true)}
              >
                <BrandHeaderMark />
              </button>
            </div>
          ) : null}
          {showCadTitle ? (
            <div
              className="viewer-title-slot"
              data-viewer-title=""
              data-viewer-title-text={titleParts.text}
              data-viewer-title-hidden={hideCadTitle ? '' : undefined}
            >
              <div className="relative z-30 w-full min-w-0 max-w-full" data-viewer-title-pills="">
                <div
                  data-viewer-title-chips=""
                  className={`viewer-title-chips pointer-events-auto ${hideCadTitle ? 'invisible' : ''}`}
                  {...(hideCadTitle ? { inert: '' } : {})}
                >
                  {titleParts.part ? (
                    <div className="viewer-title-line" data-viewer-title-line="part">
                      <ViewportTitleChip
                        inline
                        value={currentFilename}
                        onActivate={onTitlePartActivate}
                        onRename={onRenameFile}
                        renameOnDoubleClick
                      >
                        {titleParts.part}
                      </ViewportTitleChip>
                    </div>
                  ) : null}
                  {titleParts.connector || titleParts.assembly ? (
                    <div className="viewer-title-line" data-viewer-title-line="assembly">
                      {titleParts.connector ? (
                        <span
                          className="shrink-0 text-xs font-medium text-gray-300"
                          data-title-in=""
                        >
                          {titleParts.connector}
                        </span>
                      ) : null}
                      {titleParts.assembly ? (
                        <ViewportTitleChip
                          inline
                          noun="Assembly"
                          value={titleParts.assembly}
                          onActivate={onTitleAssemblyActivate}
                        >
                          {titleParts.assembly}
                        </ViewportTitleChip>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {contourLegend ? (
                  <ContourStatusLegend className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" />
                ) : null}
              </div>
            </div>
          ) : (
            <div data-viewer-title-empty="" hidden />
          )}
        </div>
      )}
      {mode !== 'game' && !showCadTitle && !brandHeader && contourLegend && (
        <ContourStatusLegend className="absolute left-1/2 top-4 z-20 -translate-x-1/2" />
      )}

      {mode === 'game' && gameSuccess && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-emerald-900/85 surface-glass-chip border border-emerald-400/60 text-white px-5 py-3 rounded-xl shadow-xl text-center">
            <div className="text-sm font-semibold">Match!</div>
            <div className="text-2xl font-mono tabular-nums mt-1">{formatGameTime(gameElapsedMs)}</div>
            <div className="text-[11px] text-emerald-200/80 mt-1">lower is better</div>
          </div>
        </div>
      )}
      
      {/* Left helper rail. Block, Build, Shape, Polish, Move. */}
      {onInsertHelper && !paintMode && !feaActive && !contourMode && !filletMode && !shellMode && !draftMode && !cutMode && !booleanMode && !moveMode && !rotateMode && !mirrorMode && !moveFaceMode && !sheetMetalPicker && !deleteFaceMode && !sheetMetalMode && (
        <HelperInsertPalette
          layout={mode === 'game' ? 'game' : 'cad'}
          desktopFullRail={mode !== 'game' && !isMobile}
          onInsert={onInsertHelper}
          onOpen={onFeatureOpen}
          getBuffer={getHelperBuffer}
          selectedFace={selectedFace}
          selectedEdges={selectedEdges}
          onRequestEdgeMode={() => setPickMode('edge')}
          onStaleEdgesClear={(msg) => {
            clearEdgeHighlight();
            clearEdgeHover();
            clearPathPreview();
            setSelectedEdges([]);
            setEdgeModeToast(toastPayload(msg || 'Re-pick edges after geometry changes'));
            armEdgeModeToastClear();
          }}
          onProfilePreview={setXsPreview}
          onPathPreview={setPathPreview}
          onBlockPreview={setBlockPreview}
          onEnterContourMode={(payload) => {
            if (isSolidContourEntry(payload?.entry)) openFeatureSlots(payload.entry);
            else enterContourMode(payload);
          }}
          onEnterHoleMode={mode !== 'game' ? () => {
            holeSpecRef.current = null;
            holeEditRef.current = null;
            holeCentresEditRef.current = null;
            setHoleCard(defaultHoleCard());
          } : null}
          onEnterFilletMode={enterFilletMode}
          onEnterShellMode={enterShellMode}
          onEnterDraftMode={enterDraftMode}
          onEnterCutMode={enterCutMode}
          onEnterBooleanMode={enterBooleanMode}
          onEnterMoveMode={enterMoveMode}
          onEnterRotateMode={enterRotateMode}
          onEnterMirrorMode={enterMirrorMode}
          onEnterMoveFaceMode={enterMoveFaceMode}
          onEnterDeleteFaceMode={enterDeleteFaceMode}
          onOpenSheetMetal={mode !== 'game' && onBindSheetMetal
            ? () => {
              feaCloseRef.current();
              setSheetMetalPicker({ willCreatePart: getSheetMetalReady ? !getSheetMetalReady() : false });
            }
            : null}
          onOpenJoints={mode !== 'game' ? onOpenJoints : null}
          jointsOpen={mode !== 'game' && !!jointCardOpen}
          compact={isMobile}
          onHelperCard={setHelperCardOpen}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          bounds={modelBounds}
          minExtent={solidMinExtent(resultRef.current?.geometry)}
          onMeasure={(direction) => directionOffscreenMm(
            cameraRef.current,
            modelBoundsRef.current,
            direction,
          )}
          editSession={helperEdit}
          onEditConfirm={({ fields }) => commitFeatureEditRef.current?.({
            fields: { ...(featureEditRef.current?.session?.fields || {}), ...fields },
          })}
          onEditDelete={helperEdit ? featureEditDelete : null}
          onEditCancel={() => cancelFeatureEditRef.current?.(featureEditRef.current?.kind || 'helper')}
        />
      )}

      {/* SCS sheet metal: left rail swaps like contour mode. */}
      {sheetMetalMode && !sheetMetalMode.holeSketch && mode !== 'game' && (
        <SheetMetalRail
          desktopFullRail={!isMobile}
          onExit={() => {
            cancelFeatureEditRef.current?.('sheetMetal');
            setSheetMetalMode(null);
          }}
          tools={sheetMetalMode.stage === 'edit' ? sheetToolsFor(sheetMetalMode.spec) : []}
          tool={sheetMetalMode.tool}
          onSelectTool={(id) => setSheetMetalMode((prev) => (prev ? setSheetTool(prev, id) : prev))}
        />
      )}
      {sheetMetalMode && !sheetMetalMode.holeSketch && mode !== 'game' && (
        <SheetMetalFlow
          mode={sheetMetalMode}
          setMode={(fn) => setSheetMetalMode((prev) => (prev ? fn(prev) : prev))}
          onSketch={() => setSheetMetalMode((prev) => {
            const draft = prev?.draft;
            if (!draft || draft.kind !== 'hole' || !draft.isNew) return prev;
            return {
              ...prev,
              draft: null,
              toast: null,
              holeSketch: {
                panel: draft.panel,
                type: draft.type || 'hole',
                d: draft.d,
                ...(draft.thread ? { thread: draft.thread } : {}),
                ...(draft.type === 'countersink' ? { cskDia: draft.cskDia, cskAngle: draft.cskAngle ?? 82 } : {}),
              },
            };
          })}
          onCommit={(spec, meta) => {
            if (sheetMetalMode.reopen && !meta?.write) {
              setSheetMetalMode((prev) => (prev ? pushSheetHistory(prev, spec) : prev));
              return true;
            }
            return onCommitSheetMetal?.(spec, { ...meta, partId: sheetMetalMode.partId }) ?? false;
          }}
          onDone={() => {
            const current = sheetMetalModeRef.current;
            if (!current || current.stage !== 'edit' || current.draft || current.exportOpen) return;
            const edit = featureEditRef.current;
            // Reopen still owns a feature-edit session. That writer leaves the
            // script byte-identical when the spec matches, and it does not pop
            // the in-memory step stack.
            if (current.reopen && edit?.kind === 'sheetMetal') {
              const ok = commitFeatureEditRef.current?.({
                fields: { ...(edit.session?.fields || {}) },
                spec: current.spec,
              });
              if (!ok) return;
              sheetMetalModeRef.current = null;
              setSheetMetalMode(null);
              return;
            }
            const read = getHelperBufferRef.current;
            const script = typeof read === 'function' ? read() : '';
            const decision = sheetDoneSpec(current, readSheetMetalSpec(script));
            if (!decision.close) return;
            if (decision.write) {
              const ok = onCommitSheetMetal?.(decision.spec, { partId: current.partId, step: 'done' });
              if (ok === false) return;
            }
            cancelFeatureEditRef.current?.('sheetMetal');
            sheetMetalModeRef.current = null;
            setSheetMetalMode(null);
          }}
          onExit={() => {
            cancelFeatureEditRef.current?.('sheetMetal');
            setSheetMetalMode(null);
          }}
          onDeleteFeature={featureEditRef.current?.dialog === 'sheetMetal' ? featureEditDelete : null}
          onUndo={() => {
            onUndo?.();
            const read = getHelperBufferRef.current;
            const script = typeof read === 'function' ? read() : '';
            const spec = readSheetMetalSpec(script);
            setSheetMetalMode((prev) => {
              if (!prev) return prev;
              if (!spec) return { ...prev, spec: null, draft: null, hotEdge: null, toast: null };
              return { ...prev, stage: 'edit', spec, draft: null, hotEdge: null, toast: null };
            });
          }}
          canUndo={canUndo}
          compact={isMobile}
          mesh={cachedMeshData}
          script={sheetMetalMode.exportOpen && typeof getHelperBuffer === 'function' ? getHelperBuffer() : null}
          partName={partLabelsRef.current?.[sheetMetalMode.partId] || ''}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
        />
      )}
      {sheetMetalPicker && mode !== 'game' && (
        <SheetMetalPicker
          binding={sheetMetalBinding}
          willCreatePart={!!sheetMetalPicker.willCreatePart}
          compact={isMobile}
          onCancel={() => setSheetMetalPicker(null)}
          onStart={(record) => {
            const start = onBindSheetMetal?.(record);
            const finish = (bound) => {
              setSheetMetalPicker(null);
              if (!bound?.ok) return;
              const next = enterSheetMetalMode(record, bound.partId, bound.spec || null);
              // Re-binding a part that already has sheet metal re-thicknesses it now.
              if (next?.stage === 'edit' && next.spec) {
                onCommitSheetMetal?.(next.spec, { partId: bound.partId, step: 'rebind' });
              }
              setSheetMetalMode(next);
            };
            if (start && typeof start.then === 'function') {
              start.then(finish, () => setSheetMetalPicker(null));
              return;
            }
            finish(start);
          }}
        />
      )}

      {contourMode && contourEdit && !contourPlaneOpen && mode !== 'game' && (
        <ContourEditBar
          name={contourMode.contourName || contourEdit.name}
          usedBy={contourEdit.usedBy || 'Unused'}
          tool={contourMode.tool}
          params={contourMode.params || {}}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onName={(contourName) => setContourMode((prev) => (prev ? { ...prev, contourName } : prev))}
          onParam={(key, value) => setContourMode((prev) => (
            prev ? { ...prev, params: { ...(prev.params || {}), [key]: value } } : prev
          ))}
          onDelete={requestContourDelete}
        />
      )}
      <ContourDeleteDialog
        open={!!contourDeleteConfirm}
        label={contourDeleteConfirm?.label || ''}
        onCancel={() => setContourDeleteConfirm(null)}
        onConfirm={() => commitContourDelete(true)}
      />
      <ContourDeleteDialog
        open={!!sketchDeleteConfirm}
        title={sketchDeleteConfirm?.title || 'Delete'}
        message="This also removes the dimensions and constraints that name it."
        label={sketchDeleteConfirm?.label || ''}
        testId="sketch-entity"
        onCancel={() => setSketchDeleteConfirm(null)}
        onConfirm={() => applySketchEntityDelete(sketchDeleteConfirm?.id)}
      />
      <FeatureDeleteConfirm
        open={!!featureDeleteConfirm}
        label={featureDeleteConfirm?.label || ''}
        base={!!featureDeleteConfirm?.base}
        onCancel={() => setFeatureDeleteConfirm(null)}
        onConfirm={() => {
          const pending = featureDeleteConfirm;
          if (pending?.sheetFeature) {
            setFeatureDeleteConfirm(null);
            onFeatureEditDelete?.(pending.sheetFeature);
            return;
          }
          deleteFeatureFromEdit(pending?.withDependents !== false, true);
        }}
      />

      {/* Contour rail: tools, Back undoes, Confirm finishes, X exits.
          Workplane writes from the card, so it has no Plane rail. */}
      {contourMode && planeCardCommit(contourMode.entry).rail && (
        <ContourModeRail
          desktopFullRail={!isMobile}
          tool={contourMode.tool}
          gesture={contourMode.gesture || null}
          entry={contourMode.entry}
          compact={isMobile}
          canUndo={contourUndoDepth > 0}
          onSelectTool={(id) => setContourMode((prev) => {
            if (!prev) return prev;
            if (id === 'arc' || id === 'dimension' || id === 'constraints') return armContourGesture(prev, id);
            return switchContourTool(prev, id);
          })}
          onUndo={onContourBack}
          onConfirm={confirmContourProfile}
          onBack={cancelContourEditor}
        />
      )}

      {mode !== 'game' && (moldProgress || wallLegend || partingLegend || moldDraftLegend || dfmReportState || moldQuote) && (
        <MoldResultsPane compact={isMobile}>
          <MoldProgress progress={moldProgress} />
          {pullToolsOn && (
            <PullReference
              mode={pullReference.mode}
              plane={pullReference.plane}
              waiting={pullReference.mode === 'face' && !pullReference.pull}
              onAuto={() => applySharedPullRef.current({ mode: 'auto' })}
              onPlane={() => applySharedPullRef.current({ mode: 'plane', plane: pullReference.plane || 'top' })}
              onFace={() => applySharedPullRef.current({ mode: 'face' })}
              onPickPlane={(plane) => applySharedPullRef.current({ mode: 'plane', plane })}
            />
          )}
          <WallLegend legend={wallLegend} />
          <PartingLegend
            legend={partingLegend}
            onSelectGroup={(id) => agentMoldPartingRef.current({ group: id })}
          />
          <MoldDraftLegend legend={moldDraftLegend} />
          <DfmReportPanel report={dfmReportState} />
          <MoldQuotePanel
            state={moldQuote}
            onQuantity={(quantity) => agentMoldQuoteRef.current({ on: true, quantity })}
            onCavity={(cavityCount) => agentMoldQuoteRef.current({ on: true, cavityCount })}
            onGrade={(grade) => agentMoldQuoteRef.current({ on: true, grade })}
            onSelect={(selected) => {
              setMoldQuote((prev) => (prev ? { ...prev, selected } : prev));
            }}
            onFirmQuote={() => agentMoldFirmQuoteRef.current({})}
            onHumanReview={() => agentMoldHumanReviewRef.current({})}
            onPayReview={() => agentMoldPayReviewRef.current({})}
          />
        </MoldResultsPane>
      )}

      {/* Cross-Section Panel */}
        <CrossSectionPanel
          ref={crossSectionPanelRef}
          enabled={crossSectionEnabled}
          enabledRef={crossSectionEnabledRef}
          onToggle={handleCrossSectionToggle}
          onPlaneChange={handlePlaneChange}
          onZoomToFit={handleZoomToFit}
          onNormalToSketch={contourMode ? handleNormalToSketch : null}
          onSnapView={handleViewSnap}
          bounds={modelBounds}
          measurementEnabled={measurementEnabled}
          onMeasurementToggle={handleMeasurementToggle}
          pickMode={pickMode}
          showPlanes={showPlanes}
          showContours={showContours}
          onShowPlanesChange={onShowPlanesChange}
          onShowContoursChange={onShowContoursChange}
          showPaint={mode !== 'game'}
          paintActive={!!paintMode}
          onPaintToggle={() => (paintMode ? exitPaintMode() : enterPaintMode())}
          showAnalyze={mode !== 'game'}
          analyzeActive={feaActive}
          onAnalyzeToggle={() => {
            clearWallMapRef.current();
            clearPartingRef.current();
            clearSideActionsRef.current();
            clearMoldDraftRef.current();
            clearDfmRef.current();
            clearQuoteRef.current();
            feaToggleRef.current?.();
          }}
          showWall={mode !== 'game'}
          wallActive={!!wallLegend}
          wallPending={moldProgress?.tool === 'wall' || !!wallFieldRef.current?.pending}
          onWallToggle={() => agentMoldWallMapRef.current({})}
          showParting={mode !== 'game'}
          partingActive={!!partingLegend}
          partingPending={moldProgress?.tool === 'parting'}
          onPartingToggle={() => agentMoldPartingRef.current({})}
          showMoldDraft={mode !== 'game'}
          moldDraftActive={!!moldDraftLegend}
          moldDraftPending={moldProgress?.tool === 'draft'}
          onMoldDraftToggle={() => agentMoldDraftRef.current({})}
          showDfm={mode !== 'game'}
          dfmActive={!!dfmReportState}
          dfmPending={moldProgress?.tool === 'dfm'}
          onDfmToggle={() => agentMoldDfmRef.current({})}
          showQuote={mode !== 'game'}
          quoteActive={!!moldQuote}
          quotePending={moldProgress?.tool === 'quote'}
          onQuoteToggle={() => agentMoldQuoteRef.current({})}
          onPickModeChange={(mode) => {
            const next = mode === 'edge' ? 'edge' : 'face';
            if (next === 'edge') feaCloseRef.current();
            setPickMode(next);
            if (next === 'edge') {
              clearHighlight();
              setSelectedFace(null);
              onFaceSelected?.(null);
              rebuildFeatureEdges();
              if (!edgeModeToastShownRef.current) {
                edgeModeToastShownRef.current = true;
                setEdgeModeToast(toastPayload('Edge pick on — tap near an edge (tangent loops on)', { undo: false }));
                armEdgeModeToastClear();
              }
            } else {
              clearEdgeHover();
              clearEdgeHighlight();
              if (edgeModeToastTimerRef.current) {
                clearTimeout(edgeModeToastTimerRef.current);
                edgeModeToastTimerRef.current = null;
              }
              setEdgeModeToast(null);
              // keep selectedEdges until user clears / face-picks
            }
          }}
          verticalRail
        />
      
      {executionError && createPortal(
        <div
          className="fixed top-16 inset-x-3 z-50 pointer-events-auto"
          data-execution-error=""
        >
          <ErrorPopup
            tone="error"
            layout="stacked"
            title="Error"
            onDismiss={() => {
              stageExecErrorRef.current = null;
              setExecutionError(null);
            }}
            onUndo={onUndo}
            canUndo={canUndo}
            className="p-3"
          >
            {executionError}
          </ErrorPopup>
        </div>,
        document.body,
      )}
      
      {/* Slice Mobile C.1: face-selected info popup removed (was under-title B.1).
          Selection still drives the left palette / PromptInput; no empty reserved band. */}

      {contourMode?.params?.contour && (
        <ContourTags
          model={contourMode.params.contour}
          plane={selectedLoftDrawFrame(contourMode) || contourWorkplane(contourMode, modelBounds)}
          cameraRef={cameraRef}
          canvasRef={canvasRef}
          selectedId={contourMode.tagId || null}
          getAnchor={contourAnchor}
          onPlace={(id, placement) => {
            const prev = contourModeRef.current;
            const contour = prev?.params?.contour;
            if (!prev || !contour || !Number.isFinite(placement)) return;
            const dimensions = (contour.dimensions || []).map((item) => (
              item.id === id ? { ...item, placement } : item
            ));
            if (!dimensions.some((item) => item.id === id)) return;
            const next = {
              ...prev,
              params: { ...prev.params, contour: { ...contour, dimensions } },
            };
            const stored = saveContourBlock(next);
            setContourMode(stored || next);
          }}
          onSelect={(id) => {
            const prev = contourModeRef.current;
            if (!prev) return;
            const contour = prev.params?.contour;
            const dim = (contour?.dimensions || []).find((item) => item.id === id);
            if (dim) {
              setContourMode(beginDimensionEdit(prev, id));
              return;
            }
            const con = (contour?.constraints || []).find((item) => item.id === id);
            if (con) {
              setContourMode(beginConstraintEdit(prev, id));
              return;
            }
            setContourMode({ ...prev, tagId: prev.tagId === id ? null : id });
          }}
          onClose={() => setContourMode((prev) => (prev ? { ...prev, tagId: null } : prev))}
          onDelete={(id) => {
            const prev = contourModeRef.current;
            if (!prev) return;
            const contour = prev.params?.contour;
            const isConstraint = (contour?.constraints || []).some((con) => con.id === id);
            const isRef = (contour?.refs || []).some((ref) => ref.id === id);
            const result = isConstraint
              ? removeContourConstraint(prev, id)
              : isRef
                ? removeContourRef(prev, id)
                : removeContourDimension(prev, id);
            if (result.error) {
              showContourToast(result.error);
              return;
            }
            if (result.warning) showContourToast(result.warning);
            const stored = saveContourBlock(result.state);
            setContourMode(stored || result.state);
          }}
        />
      )}

      {contourMode && !contourPlaneOpen && mode !== 'game' && (
        <ContourEntityCard
          chip={entityDeleteChip(contourMode)}
          compact={isMobile}
          onCancel={() => setContourMode((prev) => (prev?.entityCard ? { ...prev, entityCard: null } : prev))}
          onDelete={requestSketchEntityDelete}
        />
      )}

      {contourMode && contourMode.gesture && mode !== 'game' && (
        <ContourGestureCard
          gesture={contourMode.gesture}
          model={contourMode.params?.contour || null}
          picks={contourMode.picks || []}
          note={contourMode.gestureNote || ''}
          compact={isMobile}
          ignoreNameId={contourMode.dimensionEdit || contourMode.dimensionLive?.id || null}
          editDimension={contourMode.gesture === 'dimension' && contourMode.dimensionEdit
            ? (contourMode.params?.contour?.dimensions || []).find((item) => item.id === contourMode.dimensionEdit) || null
            : null}
          editConstraint={contourMode.gesture === 'constraints' && contourMode.constraintEdit
            ? (contourMode.params?.contour?.constraints || []).find((item) => item.id === contourMode.constraintEdit) || null
            : null}
          onRemovePick={(pick) => setContourMode((prev) => (prev ? applyContourPick(prev, pick) : prev))}
          onCancel={() => setContourMode((prev) => {
            if (!prev?.gesture) return prev;
            const next = armContourGesture(prev, prev.gesture);
            return next ? { ...next, dimensionEdit: null, constraintEdit: null } : next;
          })}
          onDelete={() => {
            const prev = contourModeRef.current;
            const dimId = prev?.dimensionEdit;
            const conId = prev?.constraintEdit;
            if (!prev || (!dimId && !conId)) return;
            const result = dimId
              ? removeContourDimension(prev, dimId)
              : removeContourConstraint(prev, conId);
            if (result.error) {
              showContourToast(result.error);
              return;
            }
            if (result.warning) showContourToast(result.warning);
            const next = {
              ...result.state,
              gesture: null,
              dimensionEdit: null,
              constraintEdit: null,
              picks: [],
              dimensionLive: null,
            };
            const stored = saveContourBlock(next);
            setContourMode(stored || next);
          }}
          onLive={(draft) => {
            const prev = contourModeRef.current;
            if (!prev || prev.gesture !== 'dimension') return;
            const result = previewContourDimension(prev, draft);
            if (!result.state || result.state === prev) return;
            setContourMode(result.state);
          }}
          onApply={(draft) => {
            const prev = contourModeRef.current;
            if (!prev) return;
            const result = prev.gesture === 'arc'
              ? saveContourArc(prev, draft.radiusMm)
              : prev.gesture === 'constraints'
                ? saveContourConstraint(prev, draft)
                : saveContourDimension(prev, draft);
            if (result.error) {
              showContourToast(result.error);
              setContourMode({ ...prev, gestureNote: result.error });
              return;
            }
            const editing = (prev.gesture === 'dimension' && !!prev.dimensionEdit)
              || (prev.gesture === 'constraints' && !!prev.constraintEdit);
            const next = editing
              ? {
                ...result.state,
                gesture: null,
                dimensionEdit: null,
                constraintEdit: null,
                picks: [],
                dimensionLive: null,
              }
              : { ...result.state, dimensionEdit: null, constraintEdit: null };
            const stored = saveContourBlock(next);
            setContourMode(stored || next);
          }}
        />
      )}

      {holeCard && !contourMode && mode !== 'game' && !filletMode && !shellMode && !draftMode && !cutMode && !booleanMode && !moveMode && !rotateMode && !moveFaceMode && !deleteFaceMode && !featureSlots && !sheetMetalMode && !paintMode && (
        <HoleCard
          card={holeCard}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onChange={setHoleCard}
          editing={!!holeEditRef.current}
          onNext={holeEditRef.current ? confirmHoleEdit : beginHoleSketch}
          onEditCentres={editHoleCentres}
          onDelete={() => {
            const feature = holeEditRef.current?.feature;
            if (!feature) return;
            const ok = onDeleteFeatureEdit?.(feature);
            if (!ok) return;
            holeEditRef.current = null;
            holeSpecRef.current = null;
            setHoleCard(null);
          }}
          onCancel={() => {
            holeSpecRef.current = null;
            holeEditRef.current = null;
            setHoleCard(null);
          }}
        />
      )}

      {featureSlotSheetOpen && (
        <FeatureSlotCard
          card={featureSlots}
          contours={savedContours}
          hoverId={slotHoverId}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onHover={setSlotHoverId}
          onPick={(slot, contour) => {
            setSlotHoverId(contour?.id || null);
            setFeatureSlots((prev) => assignFeatureSlot(prev, slot, contour));
          }}
          onNew={beginNewContour}
          onEdit={editSlotContour}
          onOffset={(index, offset) => setFeatureSlots((prev) => setFeatureStationOffset(prev, index, offset))}
          onExtrudeChange={(extrude) => setFeatureSlots((prev) => (prev ? { ...prev, extrude } : prev))}
          onRevolveChange={(revolve) => setFeatureSlots((prev) => (prev ? { ...prev, revolve } : prev))}
          onSweepChange={(sweep) => setFeatureSlots((prev) => (prev ? { ...prev, sweep } : prev))}
          onAddStation={() => setFeatureSlots((prev) => addFeatureStation(prev))}
          onRemoveStation={(index) => setFeatureSlots((prev) => removeFeatureStation(prev, index))}
          onCombine={(combine) => setFeatureSlots((prev) => (
            prev ? { ...prev, combine: combine === 'subtract' ? 'subtract' : 'add' } : prev
          ))}
          onMerge={(merge) => setFeatureSlots((prev) => (
            prev ? { ...prev, merge: merge !== false } : prev
          ))}
          onConfirm={confirmFeatureSlots}
          onCancel={closeFeatureSlots}
        />
      )}

      {/* Plane card. Contour Select plane leaves the rail up. Workplane Add plane writes and closes. */}
      {contourMode && contourPlaneOpen && !contourMode.gesture && mode !== 'game' && !isSolidContourEntry(contourMode.entry) && (
        <ContourModeChip
          tool={contourMode.tool}
          entry={contourMode.entry}
          params={contourMode.params}
          extrude={contourMode.extrude || {}}
          revolve={contourMode.revolve || {}}
          loft={contourMode.loft || {}}
          sweep={contourMode.sweep || {}}
          sweepPath={isSweepEntry(contourMode.entry)
            ? validateSweepPath(selectedEdges, contourMode.sweep)
            : null}
          pickMode={pickMode}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          planeLabel={
            contourMode.planeFace
              ? `planar n=[${contourMode.planeFace.normal.map((v) => formatDisplayNumber(v)).join(', ')}]`
              : 'default +Z top'
          }
          planePreset={contourMode.planePreset || 'z'}
          planeAngles={contourMode.planeAngles || { x: 0, y: 0, z: 0 }}
          constructionPlanes={constructionPlanes}
          pickedPlaneId={selectedPlaneId || ''}
          onPlanePreset={(axis) => {
            releaseWorkplaneFaceRef.current();
            setContourMode((prev) => {
              if (!prev) return prev;
              const center = prev.planeBase?.center
                || prev.planeFace?.center
                || contourHostCenter(modelBounds);
              return applyContourPlaneEdit(prev, {
                preset: axis,
                base: axisPresetFrame(axis, center),
                angles: { x: 0, y: 0, z: 0 },
              });
            });
          }}
          onPlaneAngles={(angles) => setContourMode((prev) => {
            if (!prev) return prev;
            const center = prev.planeBase?.center
              || prev.planeFace?.center
              || contourHostCenter(modelBounds);
            const base = prev.planeBase || axisPresetFrame(prev.planePreset || 'z', center);
            return applyContourPlaneEdit(prev, { angles, base });
          })}
          onPickWorkplane={(plane, id) => {
            releaseWorkplaneFaceRef.current();
            setSelectedPlaneId(id || null);
            setContourMode((prev) => (prev
              ? applyContourPlaneEdit(prev, {
                preset: 'workplane',
                base: plane,
                angles: { x: 0, y: 0, z: 0 },
              })
              : prev));
          }}
          onPickFace={() => {
            setPickMode('face');
            setContourMode((prev) => (prev ? { ...prev, planePreset: 'face' } : prev));
          }}
          planeOffset={contourMode.planeOffset ?? 0}
          onPlaneOffset={(offset) => setContourMode((prev) => {
            if (!prev) return prev;
            const center = prev.planeBase?.center
              || prev.planeFace?.center
              || contourHostCenter(modelBounds);
            const base = prev.planeBase || axisPresetFrame(prev.planePreset || 'z', center);
            return applyContourPlaneEdit(prev, {
              offset,
              base,
              angles: prev.planeAngles || { x: 0, y: 0, z: 0 },
              preset: prev.planePreset,
              keepAngles: true,
            });
          })}
          tangentOn={tangentProp}
          edgeCount={selectedEdges.length}
          onToggleTangent={() => setTangentProp((v) => !v)}
          onPopEdge={() => setSelectedEdges((prev) => popLastEdgeSelection(prev))}
          onClearEdges={() => {
            clearEdgeHover();
            clearEdgeHighlight();
            setSelectedEdges([]);
          }}
          onParamChange={(next) => setContourMode((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, params: next };
            return isLoftEntry(prev.entry) ? writeLoftSelected(updated, { params: next }) : updated;
          })}
          onExtrudeChange={(next) => setContourMode((prev) => (prev ? { ...prev, extrude: next } : prev))}
          onRevolveChange={(next) => setContourMode((prev) => (prev ? { ...prev, revolve: next } : prev))}
          onSweepChange={(next) => setContourMode((prev) => (prev ? { ...prev, sweep: next } : prev))}
          onPickPath={pickSweepPath}
          onPickPlane={pickSweepPlane}
          onSelectLoftProfile={(i) => setContourMode((prev) => (prev ? selectLoftProfile(prev, i) : prev))}
          onAddLoftProfile={() => setContourMode((prev) => (prev ? addLoftProfile(prev) : prev))}
          onLoftUseOffset={() => setContourMode((prev) => (prev ? clearLoftStationPlane(prev) : prev))}
          onLoftPickFace={() => setContourMode((prev) => (prev ? armLoftStationPlanePick(prev) : prev))}
          onLoftPickWorkplane={(frame, id, name) => setContourMode((prev) => (
            prev ? setLoftStationPlane(prev, frame, { kind: 'workplane', ref: id, label: name || 'Workplane' }) : prev
          ))}
          onLoftPickSketch={(contour) => setContourMode((prev) => (
            prev && contour?.plane
              ? setLoftStationPlane(prev, contour.plane, {
                kind: 'contour',
                ref: contour.id,
                label: contour.label || contour.name || 'Sketch',
              })
              : prev
          ))}
          onRemoveLoftProfile={(i) => setContourMode((prev) => (prev ? removeLoftProfile(prev, i) : prev))}
          onLoftOffsetChange={(offset) => setContourMode((prev) => (prev ? setLoftProfileOffset(prev, offset) : prev))}
          savedContours={savedContours}
          pickedContourId={contourMode.pickedContourId || null}
          onPickSaved={(id) => {
            const hit = savedContours.find((c) => c.id === id);
            if (!hit) return;
            setContourMode((prev) => {
              if (!prev) return prev;
              if (isLoftEntry(prev.entry) && prev.loft?.picking === 'face' && hit.plane) {
                return setLoftStationPlane(prev, hit.plane, {
                  kind: 'contour',
                  ref: hit.id,
                  label: hit.label || hit.name || 'Sketch',
                });
              }
              return applySavedContour(prev, hit);
            });
          }}
          combine={contourMode.combine === 'subtract' ? 'subtract' : 'add'}
          onCombineChange={(combine) => setContourMode((prev) => (
            prev ? { ...prev, combine: combine === 'subtract' ? 'subtract' : 'add' } : prev
          ))}
          merge={contourMode.merge !== false}
          onMergeChange={(merge) => setContourMode((prev) => (
            prev ? { ...prev, merge: merge !== false } : prev
          ))}
          onConfirm={planeCardCommit(contourMode.entry).writes ? confirmContourProfile : startContourDrawing}
          onCancel={cancelContourEditor}
          onDelete={featureEditRef.current?.dialog === 'contour' ? featureEditDelete : null}
          onUndoPoint={() => setContourMode((prev) => {
            if (!prev || prev.tool !== 'polyline') return prev;
            const points = (prev.params?.points || []).slice(0, -1);
            const next = { ...prev, params: { ...prev.params, points } };
            return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
          })}
          onClearPoints={() => setContourMode((prev) => {
            if (!prev || prev.tool !== 'polyline') return prev;
            const next = { ...prev, params: { ...prev.params, points: [] } };
            return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
          })}
        />
      )}

      {featureEditBanner && !filletMode ? (
        <div
          className="absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-amber-400/70 bg-amber-950/80 px-2 py-1 text-[11px] text-amber-100"
          data-feature-edit-missing=""
        >
          <span>{featureEditBanner}</span>
          <button
            type="button"
            className="underline"
            data-feature-edit-clear-missing=""
            onClick={() => {
              if (featureEditRef.current) {
                featureEditRef.current.clearMissing = true;
                featureEditRef.current.missingEdges = [];
                featureEditRef.current.missingFaces = [];
              }
              setFeatureEditBanner('');
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      {/* Slice 27: Fillet / Chamfer on the shared card. Game mounts no card. */}
      {filletMode && mode !== 'game' && (
        <FilletModeChip
          kind={filletMode.entry === 'chamferEdges' ? 'chamfer' : 'fillet'}
          edgeCount={selectedEdges.length}
          partCount={filletPartCount}
          tangentOn={tangentProp}
          params={filletMode.params}
          pathOk={filletChipStatus.ok}
          componentCount={filletChipStatus.componentCount}
          boxCorners={filletChipStatus.boxCorners || 0}
          joinsFeature={filletChipStatus.joins || ''}
          compact={isMobile}
          onToggleTangent={() => setTangentProp((v) => !v)}
          onClear={() => {
            clearEdgeHover();
            clearEdgeHighlight();
            setSelectedEdges([]);
          }}
          onAccept={acceptFillet}
          onBack={() => {
            clearEdgeHover();
            setSelectedEdges((prev) => popLastEdgeSelection(prev));
          }}
          onDismiss={exitFilletMode}
          missingLabel={filletMode.missingLabel || ''}
          onClearMissing={() => {
            if (featureEditRef.current) {
              featureEditRef.current.clearMissing = true;
              featureEditRef.current.missingEdges = [];
            }
            setFeatureEditBanner('');
            setFilletMode((prev) => (prev ? { ...prev, missingLabel: '' } : prev));
          }}
          onDelete={featureEditRef.current?.dialog === 'fillet' || featureEditRef.current?.dialog === 'chamfer' ? featureEditDelete : null}
          onParamChange={(next, extra) => setFilletMode((prev) => (
            prev
              ? {
                ...prev,
                params: { ...prev.params, ...next },
                radiusTouched: extra?.radiusTouched ? true : prev.radiusTouched,
                sizeTouched: extra?.sizeTouched ? true : prev.sizeTouched,
              }
              : prev
          ))}
        />
      )}

      
      {/* Shell on the shared card. Game mounts no card. */}
      {shellMode && mode !== 'game' && (
        <ShellModeChip
          face={selectedFace
            ? (selectedFace.type ? selectedFace : classifySelectedFace(selectedFace))
            : (shellMode.lastFace || null)}
          params={normalizeShellParams(shellMode.params || {})}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          minExtent={solidMinExtent(resultRef.current?.geometry)}
          onParamChange={(next) => setShellMode((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, params: { ...prev.params, ...next } };
            shellModeRef.current = updated;
            return updated;
          })}
          onUndoFace={() => {
            const geom = resultRef.current?.geometry;
            publishFacePicks(
              popLastShellFace(facePickGroupRef.current?.picks),
              geom,
              geom?.attributes?.position,
              geom?.index?.array,
            );
          }}
          onClearFace={() => {
            publishFacePicks([], resultRef.current?.geometry, null, null);
          }}
          onConfirm={acceptShell}
          onDelete={featureEditRef.current?.dialog === 'shell' ? featureEditDelete : null}
          onDismiss={exitShellMode}
        />
      )}

      <FeaStudyHost
        enabled={mode !== 'game'}
        compact={!!isMobile}
        paintOpen={!!paintMode}
        script={currentScript}
        getScript={() => (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || currentScript || ''}
        onCommit={onCommitFea}
        assemblyLocked={() => assemblyRunLockRef?.current === true}
        getSolid={() => ({
          geometry: resultRef.current?.geometry,
          faceIDs: faceIDsRef.current,
        })}
        getAssembly={feaAssemblyParts}
        getPartScript={getPartScript}
        getPartId={() => getBooleanContextRef.current?.()?.activeId ?? activePartIdRef.current}
        onContactHighlight={paintFeaContacts}
        onHighlight={(study, meta) => {
          paintFeaFaces(study, meta);
        }}
        onClaim={releaseModesForFea}
        onActive={setFeaActive}
        pickRef={feaPickRef}
        tapActionRef={feaTapActionRef}
        toggleRef={feaToggleRef}
        closeRef={feaCloseRef}
        panelRef={feaPanelRef}
      />

      {/* Paint on the shared card. Game mounts no card. */}
      {paintMode && !paintMode.headless && mode !== 'game' && (
        <PaintModeChip
          compact={isMobile}
          color={paintMode.color}
          custom={paintMode.custom}
          canUndo={(paintMode.undo || []).length > 0}
          canClear={livePaintChanged(paintMode.session, paintMode.baseline)}
          canConfirm={!!resolvedPaintColor(paintMode.color, paintMode.custom)}
          unmatched={paintUnmatched}
          onSwatch={(hex) => patchPaint({ color: hex, custom: '' })}
          onCustom={(custom) => patchPaint({ custom })}
          onPart={paintWholePart}
          onUndo={undoLivePaint}
          onClear={clearLivePaint}
          onConfirm={acceptPaint}
          onDismiss={exitPaintMode}
          onRemoveUnmatched={removeUnmatchedPaint}
        />
      )}

      {/* Draft on the shared card. Game mounts no card. */}
      {draftMode && mode !== 'game' && (
        <DraftModeChip
          neutral={draftMode.neutral}
          drafts={draftMode.drafts}
          replaceNeutral={draftMode.replaceNeutral}
          angle={draftMode.angle}
          flip={draftMode.flip}
          compact={isMobile}
          onAngle={(angle) => commitDraftState(setDraftAngle(draftModeRef.current, angle))}
          onFlip={(flip) => commitDraftState(setDraftFlip(draftModeRef.current, flip))}
          onUndo={() => commitDraftState(popLastDraftFace(draftModeRef.current))}
          onClear={() => commitDraftState(clearDraftFaces(draftModeRef.current))}
          onConfirm={acceptDraft}
          onDelete={featureEditRef.current?.dialog === 'draft' ? featureEditDelete : null}
          onDismiss={exitDraftMode}
        />
      )}

      {/* Cut on the shared card. Game mounts no card. */}
      {cutMode && mode !== 'game' && (
        <CutModeChip
          state={cutMode}
          compact={isMobile}
          bounds={modelBounds}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onPlaneSource={(source) => commitCutState(setCutPlaneSource(cutModeRef.current, source))}
          onOffset={(originOffset) => commitCutState(setCutOriginOffset(cutModeRef.current, originOffset))}
          onPickTarget={(pick) => commitCutState(setCutPickTarget(cutModeRef.current, pick))}
          onUndo={() => commitCutState(popLastCutPick(cutModeRef.current))}
          onClear={() => commitCutState(clearCutPicks(cutModeRef.current))}
          onConfirm={acceptCut}
          onDelete={featureEditRef.current?.dialog === 'cut' ? featureEditDelete : null}
          onDismiss={exitCutMode}
        />
      )}

      {/* Boolean on the shared card. Game mounts no card. The card stays z-20, under the section rail. */}
      {booleanMode && mode !== 'game' && (
        <BooleanModeChip
          state={booleanMode}
          partId={activePartIdRef.current}
          compact={isMobile}
          pieceCount={booleanPieceCount}
          partNames={partLabels}
          onOp={(op) => commitBooleanState(setBooleanOp(booleanModeRef.current, op))}
          onPickTarget={(pick) => commitBooleanState(setBooleanPickTarget(booleanModeRef.current, pick))}
          onUndo={() => commitBooleanState(popLastBooleanPick(booleanModeRef.current, activePartIdRef.current))}
          onClear={() => commitBooleanState(clearBooleanPicks(booleanModeRef.current, activePartIdRef.current))}
          onConfirm={acceptBoolean}
          onDelete={featureEditRef.current?.dialog === 'boolean' ? featureEditDelete : null}
          onDismiss={exitBooleanMode}
        />
      )}

      {/* Joint create card. Placed joints are edited from the feature strip. */}
      {mode !== 'game' && jointCard}

      {/* Move on the shared card. Game mounts no card. */}
      {moveMode && mode !== 'game' && (
        <MoveModeChip
          target={moveMode.target}
          dx={moveMode.dx}
          dy={moveMode.dy}
          dz={moveMode.dz}
          direction={moveMode.direction}
          distance={moveMode.distance}
          cutNormal={cutNormalFromScript((typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '')}
          faceNormal={moveMode.faceNormal}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onMeasure={(direction) => directionOffscreenMm(
            cameraRef.current,
            modelBoundsRef.current,
            direction,
          )}
          onDelta={(axis, value) => {
            const prev = moveModeRef.current;
            if (!prev) return;
            const updated = { ...prev, [axis]: value };
            moveModeRef.current = updated;
            setMoveMode(updated);
            paintMovePreview(updated);
          }}
          onDirection={(direction, cutNormal) => {
            const prev = moveModeRef.current;
            if (!prev) return;
            const updated = { ...prev, direction, cutNormal: cutNormal || prev.cutNormal };
            moveModeRef.current = updated;
            setMoveMode(updated);
            paintMovePreview(updated);
          }}
          onClear={() => {
            const next = clearMoveTarget(moveModeRef.current);
            moveModeRef.current = next;
            setMoveMode(next);
            clearMovePreview();
            clearHighlight();
          }}
          onConfirm={acceptMove}
          onDelete={featureEditRef.current?.dialog === 'move' ? featureEditDelete : null}
          onDismiss={exitMoveMode}
          labelBuffer={(typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || ''}
        />
      )}

      {/* Rotate on the shared card. Game mounts no card. */}
      {rotateMode && mode !== 'game' && (
        <RotateModeChip
          target={rotateMode.target}
          axis={rotateMode.axis}
          axisVec={rotateMode.axisVec}
          faceNormal={rotateMode.faceNormal}
          angle={rotateMode.angle}
          centerMode={rotateMode.centerMode}
          center={rotateMode.center}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onAngle={(value) => updateRotateMode({ angle: value })}
          onAxis={(axis) => updateRotateMode({ axis })}
          onAxisVec={(i, value) => {
            const prev = rotateModeRef.current;
            if (!prev) return;
            const axisVec = Array.isArray(prev.axisVec) ? prev.axisVec.slice(0, 3) : [0, 0, 1];
            axisVec[i] = value;
            updateRotateMode({ axisVec });
          }}
          onCenterMode={(centerMode) => updateRotateMode({ centerMode })}
          onCenter={(i, value) => {
            const prev = rotateModeRef.current;
            if (!prev) return;
            const center = Array.isArray(prev.center) ? prev.center.slice(0, 3) : [0, 0, 0];
            center[i] = value;
            updateRotateMode({ center });
          }}
          onClear={() => {
            const next = clearRotateTarget(rotateModeRef.current);
            rotateModeRef.current = next;
            setRotateMode(next);
            clearRotatePreview();
            clearHighlight();
          }}
          onConfirm={acceptRotate}
          onDelete={featureEditRef.current?.dialog === 'rotate' ? featureEditDelete : null}
          onDismiss={exitRotateMode}
          labelBuffer={(typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || ''}
        />
      )}

      {/* Mirror on the shared card. Game mounts no card. */}
      {mirrorMode && mode !== 'game' && (
        <MirrorModeChip
          target={mirrorMode.target}
          planeSource={mirrorMode.planeSource}
          facePlane={mirrorMode.facePlane}
          workplane={mirrorMode.workplane}
          workplanes={listConstructionPlanes((typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '')}
          compact={isMobile}
          onNamedPlane={(named) => commitMirrorState(setMirrorNamedPlane(mirrorModeRef.current, named))}
          onFace={() => {
            const prev = mirrorModeRef.current;
            if (!prev?.facePlane) return;
            commitMirrorState(setMirrorFacePlane(prev, prev.facePlane));
          }}
          onWorkplane={(plane) => commitMirrorState(setMirrorWorkplane(mirrorModeRef.current, plane))}
          onClear={() => {
            const next = clearMirrorTarget(mirrorModeRef.current);
            commitMirrorState(next);
            clearHighlight();
          }}
          onConfirm={acceptMirror}
          onDelete={featureEditRef.current?.dialog === 'mirror' ? featureEditDelete : null}
          onDismiss={exitMirrorMode}
        />
      )}

      {/* Move Face on the shared card. Game mounts no card. */}
      {moveFaceMode && mode !== 'game' && (
        <MoveFaceModeChip
          faces={moveFaceMode.faces}
          distance={moveFaceMode.distance}
          flip={moveFaceMode.flip}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          minExtent={solidMinExtent(resultRef.current?.geometry)}
          onDistance={(distance) => commitMoveFaceState(setMoveFaceDistance(moveFaceModeRef.current, distance))}
          onFlip={(flip) => commitMoveFaceState(setMoveFaceFlip(moveFaceModeRef.current, flip))}
          onUndo={() => commitMoveFaceState(popLastMoveFace(moveFaceModeRef.current))}
          onClear={() => commitMoveFaceState(clearMoveFaces(moveFaceModeRef.current))}
          onConfirm={acceptMoveFace}
          onDelete={featureEditRef.current?.dialog === 'moveFace' ? featureEditDelete : null}
          onDismiss={exitMoveFaceMode}
        />
      )}

      {/* Delete Face on the shared card. Game mounts no card. */}
      {deleteFaceMode && mode !== 'game' && (
        <DeleteFaceModeChip
          faces={deleteFaceMode.faces}
          compact={isMobile}
          onUndo={() => commitDeleteFaceState(popLastDeleteFace(deleteFaceModeRef.current))}
          onClear={() => commitDeleteFaceState(clearDeleteFaces(deleteFaceModeRef.current))}
          onConfirm={acceptDeleteFace}
          onDelete={featureEditRef.current?.dialog === 'deleteFace' ? featureEditDelete : null}
          onDismiss={exitDeleteFaceMode}
        />
      )}

      {/* Slice B+C: numbered edge-selector chips anchored to on-geometry track
          points; left/top updated every frame via updateEdgeChips (orbit-safe). */}
      {(pickMode === 'edge' || !!filletMode || !!contourMode) && selectedEdges.length > 0 && (
        <div
          className="absolute inset-0 z-[15] pointer-events-none overflow-hidden"
          data-edge-chip-layer=""
          aria-hidden="true"
        >
          {selectedEdges.map((e, i) => {
            const key = selectionEdgeKey(e);
            return (
              <div
                key={key}
                ref={(el) => {
                  const map = edgeChipElsRef.current;
                  if (el) map.set(key, el);
                  else map.delete(key);
                }}
                data-edge-chip={i + 1}
                data-edge-chip-key={key}
                className="absolute -translate-x-1/2 -translate-y-1/2
                  min-w-[1.25rem] h-5 px-1.5 rounded-md
                  bg-amber-950/90 border border-amber-400/80
                  text-amber-100 text-[10px] font-bold font-sans
                  flex items-center justify-center shadow-lg
                  surface-glass-chip"
                style={{ left: 0, top: 0, visibility: 'hidden' }}
                title={`Selected edge ${i + 1}`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback feature editor and the picker. Game mounts no card. */}
      {editSheetOpen && (
        <FeatureEditSheet
          feature={featureEdit.mode === 'edit' ? featureEdit.feature : null}
          features={featureEdit.mode === 'picker'
            ? listFeatureSheetTargets(featureEditScript || '')
            : null}
          script={featureEditScript || ''}
          failedIds={featureEditFailedIds}
          failedTitles={featureEditFailedTitles}
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onAccept={onFeatureEditAccept}
          onCancel={onFeatureEditCancel}
          onDelete={(feature) => {
            // The same base-feature confirm as the edit dialog. Other sheet
            // deletes stay immediate (the Undo toast covers them).
            const base = partDeclarationDeletePlan(featureEditScript || '', feature);
            if (base) {
              setFeatureDeleteConfirm({
                count: base.count,
                label: base.message,
                base: true,
                sheetFeature: feature,
              });
              return;
            }
            onFeatureEditDelete?.(feature);
          }}
          onEditScript={onFeatureEditScript}
          onPickFeature={onFeatureEditPick}
        />
      )}

      {/* Standalone edge pick — same card, no Confirm. X clears and leaves edge pick.
          Hidden in fillet, contour, and game. Numbered badges stay on the edges. */}
      {mode !== 'game' && !helperCardOpen && pickMode === 'edge' && !contourMode && !filletMode && !shellMode && !draftMode && !moveFaceMode && !deleteFaceMode && !cutMode && !booleanMode && !moveMode && !rotateMode && !sheetMetalMode && !sheetMetalPicker && !feaActive && !editSheetOpen && !paintMode && !measurementEnabled && selectedEdges.length > 0 && (
        <FeatureSheet
          cardAttrs={{ 'data-edge-selector': 'standalone' }}
          title={`Edge pick · ${selectedEdges.length} selected`}
          subtitle="Tap near an edge to toggle · Fillet / Chamfer uses this set"
          compact={isMobile}
          onCancel={() => {
            clearEdgeHover();
            clearEdgeHighlight();
            setSelectedEdges([]);
            setPickMode('face');
          }}
        >
          <div className="mt-1.5 flex items-center gap-3 font-sans flex-wrap">
            <button
              type="button"
              className={`text-[11px] underline ${tangentProp ? 'text-cyan-300' : 'text-gray-300'}`}
              onClick={() => setTangentProp((v) => !v)}
              title="When on, picking one edge adds G1-connected (tangent) edges in the loop"
              aria-pressed={tangentProp}
            >
              Tangent {tangentProp ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="text-[11px] text-gray-200 underline"
              onClick={() => {
                clearEdgeHover();
                setSelectedEdges((prev) => popLastEdgeSelection(prev));
              }}
              title="Undo last selected edge"
              aria-label="Undo last selected edge"
            >
              Undo
            </button>
            <button
              type="button"
              className="text-[11px] text-gray-200 underline"
              onClick={() => {
                clearEdgeHover();
                clearEdgeHighlight();
                setSelectedEdges([]);
              }}
              title="Clear all selected edges"
            >
              Clear
            </button>
          </div>
        </FeatureSheet>
      )}

      {featureDeleteToast && !executionError ? (
        <FeatureDeleteToast
          lines={featureDeleteToast}
          canUndo={canUndo}
          onUndo={onUndo}
          onDismiss={() => setFeatureDeleteToast(null)}
        />
      ) : null}

      {edgeModeToast && createPortal(
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]">
          <ErrorPopup
            tone="amber"
            onDismiss={() => setEdgeModeToast(null)}
            onUndo={edgeModeToast.undo ? onUndo : undefined}
            canUndo={canUndo}
            className="px-3 py-2 pointer-events-auto"
          >
            {edgeModeToast.text}
          </ErrorPopup>
        </div>,
        document.body,
      )}

      {contourSnap && createPortal(
        <div
          data-contour-snap={contourSnap.role}
          data-contour-snap-target={contourSnap.targetKey}
          className="pointer-events-none fixed z-[80]"
          style={{
            left: contourSnap.screen.x,
            top: contourSnap.screen.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              border: '2px solid #f59e0b',
              boxShadow: '0 0 0 2px rgba(0,0,0,0.55)',
              background: 'rgba(245, 158, 11, 0.22)',
            }}
          />
        </div>,
        document.body,
      )}

      {contourToast && createPortal(
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]"
          data-contour-toast=""
          {...(contourToast.deleted ? { 'data-delete-undo-toast': '' } : {})}
          {...(contourToast.sketch ? { 'data-sketch-delete-toast': '' } : {})}
        >
          <ErrorPopup
            tone="cyan"
            onDismiss={() => setContourToast(null)}
            onUndo={contourToast.sketch ? undoContourSketch : (contourToast.undo ? onUndo : undefined)}
            canUndo={contourToast.sketch ? contourUndoDepth > 0 : canUndo}
            roomy={!!contourToast.deleted}
            className={contourToast.deleted ? 'pointer-events-auto' : 'px-3 py-2 pointer-events-auto'}
          >
            {contourToast.text}
          </ErrorPopup>
        </div>,
        document.body,
      )}

      {filletScrapNotice && createPortal(
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(18rem,calc(100%-2rem))]">
          <ErrorPopup
            tone="scrap"
            role="status"
            data-fillet-scrap="1"
            onDismiss={() => setFilletScrapNotice(null)}
            onUndo={onUndo}
            canUndo={canUndo}
            className="px-3 py-2 pointer-events-auto"
          >
            {filletScrapNotice}
          </ErrorPopup>
        </div>,
        document.body,
      )}

      {filletToast && createPortal(
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]">
          <ErrorPopup
            tone="warn"
            onDismiss={() => setFilletToast(null)}
            onUndo={filletToast.undo ? onUndo : undefined}
            canUndo={canUndo}
            className="px-3 py-2 pointer-events-auto"
          >
            {filletToast.text}
          </ErrorPopup>
        </div>,
        document.body,
      )}

      {shellToast && createPortal(
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]">
          <ErrorPopup
            tone="cyan"
            onDismiss={() => setShellToast(null)}
            onUndo={shellToast.undo ? onUndo : undefined}
            canUndo={canUndo}
            className="px-3 py-2 pointer-events-auto"
          >
            {shellToast.text}
          </ErrorPopup>
        </div>,
        document.body,
      )}

      {/* Measure on the shared card. Game mounts no card. X writes nothing. */}
      {measurementEnabled && mode !== 'game' && (
        <MeasureModeChip
          picks={measurePicks}
          compact={isMobile}
          onClear={() => commitMeasurePicks([])}
          onDismiss={exitMeasureMode}
        />
      )}

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      
      {webglUnavailable ? <WebGLUnavailableNotice /> : null}
      <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" />
    </div>
  );
});

export default Viewport;
