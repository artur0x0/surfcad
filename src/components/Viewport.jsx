// components/Viewport.jsx
/* eslint-disable react-hooks/exhaustive-deps -- legacy: deps arrays below are tuned for
   three.js render-loop stability (scene/camera/controls live in refs); adding the flagged
   refs would rebind listeners/materials per render. Revisit deliberately, not via lint. */
import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import {
  WebGLRenderer,
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
import { applyTrackballFeel } from '../utils/trackballFeel';
import { installPageZoomLock } from '../utils/pageZoomLock';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import Toolbar from './Toolbar';
import PuzzleUnlock from './PuzzleUnlock';
import ProfileChip from './ProfileChip';
import CrossSectionPanel from './CrossSectionPanel';
import HelperInsertPalette from './HelperInsertPalette';
import ErrorPopup from './ErrorPopup';
import { FeatureDeleteToast } from './FeatureEditDelete';
import ContourModeRail from './ContourModeRail';
import ContourModeChip from './ContourModeChip';
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
  enterSheetMetalMode,
  pushSheetHistory,
  reopenSheetMetalMode,
  setSheetTool,
  sheetTap,
  sheetToolsFor,
} from '../utils/sheetMetal/sheetMetalMode';
import { buildSheetOverlay, disposeSheetOverlay, sheetPickFromHits, syncSheetEdgeLineResolution } from '../utils/sheetMetal/sheetOverlay';
import { ensureBodyMaterial } from '../utils/sheetMetal/sheetMaterial';
import { makeDefaultPartMaterial } from '../utils/partMaterial';
import DraftModeChip from './DraftModeChip';
import CutModeChip from './CutModeChip';
import BooleanModeChip from './BooleanModeChip';
import MoveModeChip from './MoveModeChip';
import MoveFaceModeChip from './MoveFaceModeChip';
import DeleteFaceModeChip from './DeleteFaceModeChip';
import { buildCrossSectionPreview, defaultTopPlaneFrame } from '../utils/crossSectionSubstrate';
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
  listSavedContours,
  pickContourByRay,
  savedContourRings,
  withAutoPickedContour,
} from '../utils/savedContours';
import { shouldClearViewportScript } from '../utils/helperPaletteSnippets';
import { mintContourIdentity } from '../utils/namedContour';
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
  enterContourState,
  intersectRayPlane,
  isExtrudeEntry,
  isLoftEntry,
  isRevolveEntry,
  isSweepEntry,
  isWorkplaneEntry,
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
  saveContourArc,
  saveContourConstraint,
  saveContourDimension,
} from '../utils/contourMode';
import { SKETCH_HIT_PX, anchorOnEntity, pickContourScreen, planeUvToWorld } from '../utils/contourPick';
import { beginConstraintEdit, beginDimensionEdit } from '../utils/contourGesture';
import { localPoint, worldPoint } from '../utils/partPose';
import {
  CONTOUR_PICK_COLOR,
  contourEntityColor,
  contourPaintModel,
  highlightContourPaint,
  savedContourStatus,
} from '../utils/contourStatus';
import {
  applyDraggedContour,
  contourPointDragAllowed,
  dragContourPoint,
  planContourDragRelease,
} from '../utils/contourDrag';
import ContourGestureCard from './ContourGestureCard';
import ContourTags from './ContourTags';
import {
  holdContourOverlays,
  releaseContourOverlays,
  useTemporaryVisibility,
} from '../hooks/useTemporaryVisibility';
import { buildSweepPathPreview } from '../utils/edgeSweepPath';
import {
  buildFilletBlendPreview,
  enterFilletState,
  enterChamferState,
  validateFilletAccept,
  validateChamferAccept,
  defaultFilletParams,
  solidMinExtent,
  hasFilletModeBlock,
  hasChamferModeBlock,
} from '../utils/filletMode';
import {
  applyContourEditSeed,
  contourFieldsFromState,
  creationDialogFor,
  editPreviewScript,
  featureDependents,
  dependentToastLines,
  openFeatureEdit,
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
  cutNormalFromScript,
  MOVE_MODE_NEED_BODY,
} from '../utils/moveMode';
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
  featureEdgesOf,
  featureGraphFor,
  pruneSolidCacheIn,
  releaseGeometryIn,
  solidEntryForGeometry,
} from '../utils/partSolidCache';
import {
  characteristicLengthMm,
  forgetCharacteristicLength,
  rememberCharacteristicLength,
} from '../utils/characteristicLength';
import { adjacentBlendSize } from '../utils/adjacentBlend';
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
  toggleEdgeSelectionPropagated,
  popLastEdgeSelection,
  selectionEdgeKey,
  pathLengthFromEdges,
  sweepBlendHardMax,
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
  resolvedPaintColor,
  unmatchedColorCount,
} from '../utils/facePaint';
import { formatViewerTitle, sanitizePartName } from '../utils/assembly.js';
import { createCuttingPlaneWidget, updateCuttingPlaneWidget } from '../utils/cuttingPlaneWidget';
import { AxesHelper } from 'three';
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
import { fitView, meshWorldBox, unionWorldBox, VIEW_PRESETS, VIEW_SNAP_MARGIN } from '../utils/viewCamera';
import { listFeatureSheetTargets } from '../utils/featureSheetWriteback';
import {
  boxCornerPoints,
  createSheetCameraSession,
  featureSheetClearanceNdc,
  featureSheetCoveredFraction,
} from '../utils/featureSheetCamera';
import { boundsSketchBox, createFaceSketchAim, faceSketchBox } from '../utils/faceSketchCamera';
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

/** Unpromoted draft handles stay cyan. A promoted contour uses status colours. */
const POLYLINE_POINT_COLOR = 0x22d3ee;
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
  scene?.remove(obj);
  const disposeOne = (node) => {
    node.geometry?.dispose?.();
    const mat = node.material;
    if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
    else mat?.dispose?.();
  };
  if (typeof obj.traverse === 'function') {
    obj.traverse((child) => {
      if (child !== obj) disposeOne(child);
    });
  }
  disposeOne(obj);
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
  + ' bg-gray-900/80 surface-glass-chip border border-gray-500/50 text-gray-100';

/**
 * Title chip. With `onRename` it is also the rename control: click (or Enter /
 * Space on the focused chip) swaps in an input. Enter or blur commits, Escape
 * reverts. An empty or all-junk name commits nothing, so the part falls back to
 * "Untitled" rather than becoming nameless.
 *
 * `inline` sits in the CAD title row (part, then "in", then the assembly).
 * The floating form is the game puzzle name, alone at the top.
 * `noun` is "Part" or "Assembly" — same commit rules, different label.
 */
function ViewportTitleChip({ children, value = null, onRename = null, inline = false, noun = 'Part' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    if (!onRename) return;
    setDraft(value || '');
    setEditing(true);
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = sanitizePartName(draft);
    if (next && next !== (value || '')) onRename(next);
  };

  const shell = TITLE_CHIP;
  const role = noun === 'Assembly' ? 'assembly' : 'part';
  const renameTitle = noun === 'Assembly' ? 'Click to rename this assembly' : 'Click to rename this part';
  const shown = value || (noun === 'Assembly' ? '' : 'Untitled');
  const frame = inline
    ? `relative z-10 min-w-0 max-w-[min(14rem,42vw)] ${onRename ? 'pointer-events-auto' : 'pointer-events-none'}`
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
          className={`${shell} w-48 outline-none border-blue-400/80 bg-gray-900`}
          style={{ fontSize: '16px' }}
          aria-label={noun === 'Assembly' ? 'Assembly name' : 'Part name'}
          data-title-chip="input"
          data-title-role={role}
          {...(role === 'assembly' ? { 'data-assembly-name': '' } : {})}
        />
      ) : onRename ? (
        <button
          type="button"
          onClick={start}
          className={`${shell} hover:border-blue-400/70 hover:text-white cursor-text`}
          title={renameTitle}
          aria-label={`${noun} name: ${shown}. Click to rename.`}
          data-title-chip="button"
          data-title-role={role}
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
  /** Same click-to-edit as the part chip. Writes the document name. */
  onRenameAssembly = null,
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
  onInsertHelper = null,
  /** A palette tap is opening a sheet or mode (App: edit the picked part). */
  onFeatureOpen = null,
  onCommitContourProfile = null,
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
   * `{ script, ok, scriptLine, featureId, featureBlock }`. App maps a failure
   * to its feature block (tracked id first, stack line second) for the strip
   * and sheet red border.
   */
  onRunOutcome = null,
  /** True while any feature session is open. App hides the feature strip. */
  onFeatureSessionChange = null,
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
  onFeatureEditAccept = null,
  onFeatureEditCancel = null,
  onFeatureEditDelete = null,
  onFeatureEditScript = null,
  onFeatureEditPick = null,
  /** Another card took the pane. Close the edit card and write nothing. */
  onFeatureEditDismiss = null,
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
  const ghostMeshRef = useRef(null);
  const raycasterRef = useRef(new Raycaster());
  const mouseRef = useRef(new Vector2());
  const highlightMeshRef = useRef(null);
  /** Face highlights for an open joint card. Keyed by part id so a second pick does not drop the first. */
  const jointHighlightRef = useRef(new Map());
  const clearJointHighlightsRef = useRef(() => {});
  const paintJointHighlightRef = useRef(() => {});
  const cuttingPlaneWidgetRef = useRef(null);
  const axisHelperRef = useRef(null);
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
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
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
  const partLabelsRef = useRef(null);
  const featureSessionRef = useRef(false);
  const featureEditRef = useRef(null);
  const beginFeatureEditRef = useRef(null);
  const commitFeatureEditRef = useRef(() => false);
  const cancelFeatureEditRef = useRef(() => {});
  const executeScriptRef = useRef(null);
  const onCommitFeatureEditRef = useRef(onCommitFeatureEdit);
  onCommitFeatureEditRef.current = onCommitFeatureEdit;
  const onDeleteFeatureEditRef = useRef(onDeleteFeatureEdit);
  onDeleteFeatureEditRef.current = onDeleteFeatureEdit;
  const [helperEdit, setHelperEdit] = useState(null);
  const [featureEditBanner, setFeatureEditBanner] = useState('');
  const [featureDeleteToast, setFeatureDeleteToast] = useState(null);
  const cadBodyStickyRef = useRef(false);
  const showCadBodyHighlightRef = useRef(() => false);
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
  const edgeModeToastShownRef = useRef(false);
  const edgeModeToastTimerRef = useRef(null);
  const [edgeModeToast, setEdgeModeToast] = useState(null);
  /** Slice 24/25/26/28/30: contour-mode shell (Profile-in-mode; Extrude / Revolve / Loft / Sweep commit a solid). */
  const [contourMode, setContourMode] = useState(null);
  /** Plane card is the first step. Drawing keeps the rail and drops the card. */
  const [contourPlaneOpen, setContourPlaneOpen] = useState(false);
  const contourPlaneOpenRef = useRef(false);
  const [contourFaceAim, setContourFaceAim] = useState('');
  const [contourUndoDepth, setContourUndoDepth] = useState(0);
  const [faceSketchNonce, setFaceSketchNonce] = useState(0);
  const faceSketchNormalRef = useRef(null);
  const sketchHistRef = useRef(emptySketchHistory());
  const applyingSketchUndoRef = useRef(false);
  const faceSketchFinishRef = useRef(() => {});
  const requestFaceSketchAim = (normal) => {
    if (!Array.isArray(normal) || normal.length < 3) return;
    faceSketchNormalRef.current = [Number(normal[0]), Number(normal[1]), Number(normal[2])];
    setFaceSketchNonce((n) => n + 1);
  };
  const [selectedPlaneId, setSelectedPlaneId] = useState(null);
  const [armedContourId, setArmedContourId] = useState(null);
  const [sceneReady, setSceneReady] = useState(false);
  const contourModeRef = useRef(null);
  const workplaneOverlayRef = useRef(null);
  const constructionPlaneRef = useRef(null);
  const savedContoursRef = useRef([]);
  const savedContourHostPlaneRef = useRef(null);
  /** Editor part's overlay translation and id (contour / plane picks hit only its overlays). */
  const savedContourOffsetRef = useRef([0, 0, 0]);
  const editorOverlayPartIdRef = useRef(null);
  const polylineDraftRef = useRef(null);
  const contourStatusRef = useRef(null);
  /** Touch drag consumes the synthetic click that would otherwise add a point. */
  const polylineSuppressClickRef = useRef(false);
  /** Scratch for projecting handles to screen space (no per-frame alloc). */
  const polylineProjectScratch = useRef(new Vector3());
  /** Index of the draft point under the cursor (-1 = none). */
  const polylinePointHoverRef = useRef(-1);
  /** Live right-drag: { index, plane, moved } while a point is being moved. */
  const polylinePointDragRef = useRef(null);
  /** TrackballControls noRotate/noPan saved while a point handle is grabbed. */
  const polylineControlsLockRef = useRef(null);
  const extrudePreviewRef = useRef(null);
  const revolvePreviewRef = useRef(null);
  const loftPreviewRef = useRef(null);
  const sweepPreviewRef = useRef(null);
  const contourGhostMatsRef = useRef(null);
  const [contourToast, setContourToast] = useState(null);
  const contourToastTimerRef = useRef(null);
  /** Slice 27: Fillet-in-mode (enter without edges; Accept commits sweep fillet). */
  const [filletMode, setFilletMode] = useState(null);
  const filletModeRef = useRef(null);
  const [shellMode, setShellMode] = useState(null);
  const shellModeRef = useRef(null);
  /** Paint session. Null when the popup is closed. Colors stay here until Confirm. */
  const [paintMode, setPaintMode] = useState(null);
  const paintModeRef = useRef(null);
  const [feaActive, setFeaActive] = useState(false);
  const feaPickRef = useRef(null);
  const feaToggleRef = useRef(() => {});
  const feaCloseRef = useRef(() => {});
  /** One Fix/Force/Pressure overlay per (entry, face). Reconciled, not stacked. */
  const feaFaceOverlaysRef = useRef(new Map());
  const feaHighlightStudyRef = useRef(null);
  const exitPaintModeRef = useRef(() => {});
  const applyLivePaintTapRef = useRef(() => {});
  /** SCS sheet metal: picker popup (S1) + mode state (stage, sku, partId). */
  const [sheetMetalPicker, setSheetMetalPicker] = useState(null);
  const [sheetMetalMode, setSheetMetalMode] = useState(null);
  const sheetMetalModeRef = useRef(null);
  sheetMetalModeRef.current = sheetMetalMode;
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
  const [moveFaceMode, setMoveFaceMode] = useState(null);
  const moveFaceModeRef = useRef(null);
  const [deleteFaceMode, setDeleteFaceMode] = useState(null);
  const deleteFaceModeRef = useRef(null);
  /** Kernel centroids from the last execute. move() matches these, not the viewport average. */
  const bodyCentroidsRef = useRef([]);
  const movePreviewRef = useRef(null);
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
  /** Bottom feature card owns the camera. Game never sets this. */
  const sheetCameraOwnedRef = useRef(false);
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
    msg == null ? null : { text: String(msg), undo: opts?.undo !== false }
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
    if (executionError) setFeatureDeleteToast(null);
  }, [executionError]);
  
  // Cross-section state
  const [crossSectionEnabled, setCrossSectionEnabled] = useState(false);
  const [crossSectionPlane, setCrossSectionPlane] = useState({
    normal: [0, 0, 1],
    originOffset: 0,
    showPlane: true
  });
  const [modelBounds, setModelBounds] = useState(null);
  // Mouse handlers must resolve the workplane against live bounds without
  // rebinding listeners on every recompute.
  const modelBoundsRef = useRef(null);
  modelBoundsRef.current = modelBounds;
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
  const filletSheetOpen = mode !== 'game' && !!filletMode;
  const shellSheetOpen = mode !== 'game' && !!shellMode;
  const draftSheetOpen = mode !== 'game' && !!draftMode;
  const moveFaceSheetOpen = mode !== 'game' && !!moveFaceMode;
  const deleteFaceSheetOpen = mode !== 'game' && !!deleteFaceMode;
  const cutSheetOpen = mode !== 'game' && !!cutMode;
  const booleanSheetOpen = mode !== 'game' && !!booleanMode;
  const moveSheetOpen = mode !== 'game' && !!moveMode;
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
    && !contourSession
    && !filletSheetOpen
    && !shellSheetOpen
    && !draftSheetOpen
    && !moveFaceSheetOpen
    && !deleteFaceSheetOpen
    && !cutSheetOpen
    && !booleanSheetOpen
    && !moveSheetOpen
    && !sheetMetalSheetOpen
    && !helperSheetOpen
    && !paintSheetOpen
    && !feaActive;
  const edgeSheetOpen = mode !== 'game'
    && !helperCardOpen
    && !editSheetOpen
    && pickMode === 'edge'
    && !contourMode
    && !filletMode
    && !shellMode
    && !draftMode
    && !moveFaceMode
    && !deleteFaceMode
    && !cutMode
    && !booleanMode
    && !moveMode
    && !sheetMetalMode
    && !sheetMetalPicker
    && !feaActive
    && !measurementEnabled
    && !paintMode && selectedEdges.length > 0;
  const featureCardKind = filletSheetOpen
    ? 'fillet'
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
  sheetCameraOwnedRef.current = featureCardKind !== '';
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
  
  // Measurement tool and axis helper state. measurementEnabled is declared
  // above measureSheetOpen; the card kind is computed before this point.
  const [axisHelperEnabled, setAxisHelperEnabled] = useState(false);
  // Re-frame the part after each successful run, preserving the current orbit direction.
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);

  pickModeRef.current = pickMode;
  showPlanesRef.current = showPlanes;
  showContoursRef.current = showContours;
  tangentPropRef.current = tangentProp;
  cachedMeshDataRef.current = cachedMeshData;
  contourModeRef.current = contourMode;
  contourPlaneOpenRef.current = contourPlaneOpen;
  filletModeRef.current = filletMode;
  shellModeRef.current = shellMode;
  paintModeRef.current = paintMode;
  draftModeRef.current = draftMode;
  cutModeRef.current = cutMode;
  booleanModeRef.current = booleanMode;
  moveModeRef.current = moveMode;
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
  partLabelsRef.current = partLabels || {};
  getBooleanContextRef.current = getBooleanContext;
  const onRunOutcomeRef = useRef(null);
  onRunOutcomeRef.current = onRunOutcome;
  featureSessionRef.current = !!(
    contourMode || filletMode || shellMode || draftMode || cutMode
    || booleanMode || moveMode || moveFaceMode || deleteFaceMode
    || paintMode
    || feaActive
  );

  useEffect(() => {
    onFeatureSessionChangeRef.current?.(featureSessionRef.current);
  }, [
    contourMode, filletMode, shellMode, draftMode, cutMode,
    booleanMode, moveMode, moveFaceMode, deleteFaceMode, paintMode, feaActive,
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
    /** Short note in the picker toast slot (cross-part writes). */
    notify: (msg) => {
      if (msg) showShellToast(msg);
    },
    softFailMove: (msg) => {
      showShellToast(msg || 'Move refused — double-click a body, then Confirm.');
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
    /** Close every other card without writing, so the edit card can open alone. */
    yieldToFeatureEditCard: () => yieldToFeatureEditCardRef.current(),
    placeAssembly: (payload) => placeAssemblyRef.current(payload),
    /** Move the pick mesh onto a part the user just touched. */
    swapPickPart: (payload) => swapPickPartRef.current(payload),
    /** Highlight the whole active solid. Parts-row and body picks use this. */
    showCadBodyHighlight: () => showCadBodyHighlightRef.current(),
    /** Install one part's solid and rebuild face, edge, and contour graphs. */
    adoptActiveSolid: (payload) => adoptActiveSolidRef.current(payload),
    /** True while a bottom feature card owns the camera. Game is never. */
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
  }));

  // Clear face highlight
  const clearHighlight = useCallback(() => {
    if (highlightMeshRef.current) {
      if (Array.isArray(highlightMeshRef.current)) {
        highlightMeshRef.current.forEach(mesh => {
          sceneRef.current.remove(mesh);
          mesh.geometry?.dispose();
          mesh.material?.dispose();
        });
        highlightMeshRef.current = [];
      } else {
        sceneRef.current.remove(highlightMeshRef.current);
        highlightMeshRef.current.geometry?.dispose();
        highlightMeshRef.current.material?.dispose();
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
        const color = picked ? 0xff9900 : (status ? contourEntityColor(status) : 0x3f3f46);
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
          color: 0x22d3ee,
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

  const applyContourPartGhost = useCallback((on) => {
    const mesh = resultRef.current;
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (on) {
      contourGhostMatsRef.current = true;
      for (const m of mats) {
        if (!m) continue;
        if (m.userData._contourPrev == null) {
          m.userData._contourPrev = {
            transparent: m.transparent,
            opacity: m.opacity,
            depthWrite: m.depthWrite,
          };
        }
        // Dim in place so the part stays recognizable (not a grey void).
        m.transparent = true;
        m.opacity = 0.4;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
    } else if (contourGhostMatsRef.current) {
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
        const size = 48;
        const geom = new PlaneGeometry(size, size);
        const selected = entry.editor && p.id === entry.selectedId;
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
        quad.userData = { planeId: p.id, plane, kind: 'constructionPlane', partId: entry.partId };
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
  const paintPolylineDraft = useCallback((plane, points, { wire = true, pointColors = null, pointIds = null } = {}) => {
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
      const pos = new Float32Array(world.length * 3);
      for (let i = 0; i < world.length; i++) {
        pos[i * 3] = world[i][0];
        pos[i * 3 + 1] = world[i][1];
        pos[i * 3 + 2] = world[i][2];
      }
      line = makeSketchLine(pos, {
        color: POLYLINE_POINT_COLOR,
        opacity: 0.9,
        resolution: edgeLineResolution(),
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

  /** Promoted contour wire, one colour per entity. Cyan stays on an unpromoted draft. */
  const paintContourStatusWire = useCallback((plane, segments) => {
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

  /** Move one handle (and its wire vertex) without rebuilding the draft. */
  const movePolylineHandle = useCallback((index, worldPoint) => {
    const group = polylineDraftRef.current;
    const handle = group?.userData?.handles?.[index];
    if (!handle) return;
    const ox = group.position?.x || 0;
    const oy = group.position?.y || 0;
    const oz = group.position?.z || 0;
    handle.position.set(worldPoint[0] - ox, worldPoint[1] - oy, worldPoint[2] - oz);
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
      if (v.z > 1) continue; // behind the camera
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

  /**
   * Hovering a handle hands the right button to the point, not the camera:
   * TrackballControls pans on right-drag, which would fight the move.
   */
  const setPolylinePointHover = useCallback((index) => {
    if (polylinePointHoverRef.current === index) return;
    polylinePointHoverRef.current = index;
    const controls = controlsRef.current;
    if (index >= 0 && controls && !polylineControlsLockRef.current) {
      polylineControlsLockRef.current = { noRotate: controls.noRotate, noPan: controls.noPan };
      controls.noRotate = true;
      controls.noPan = true;
    } else if (index < 0 && !polylinePointDragRef.current) {
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

  const exitContourMode = useCallback(() => {
    faceSketchRef.current?.cancel();
    setContourFaceAim('');
    releaseContourOverlays(overlayVis);
    cancelFeatureEditRef.current?.('contour');
    setContourMode(null);
    contourModeRef.current = null;
    contourPlaneOpenRef.current = false;
    setContourPlaneOpen(false);
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

  const enterContourMode = useCallback(({ entry } = {}) => {
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
    const armed = saved.find((c) => c.id === armedContourId);
    next = armed ? applySavedContour(next, armed) : withAutoPickedContour(next, saved);
    contourPlaneOpenRef.current = true;
    setContourPlaneOpen(true);
    sketchHistRef.current = emptySketchHistory();
    setContourUndoDepth(0);
    setContourFaceAim('');
    setContourMode(next);
    // Soft-fail / refuse only — no informational toast on successful feature UI open.
    if (next.enterRefuse) showContourToast(next.enterRefuse);
    applyContourPartGhost(true);
  }, [selectedFace, selectedPlaneId, armedContourId, applyContourPartGhost, clearFilletBlendPreview, clearEdgeHover, clearEdgeHighlight, getHelperBuffer, currentScript]);

  const confirmContourProfile = useCallback(() => {
    const state = contourModeRef.current;
    if (!state) return;
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
    });
    if (ok) {
      exitContourMode();
    }
  }, [onCommitContourProfile, selectedEdges, modelBounds, exitContourMode]);

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
    const neighbors = featureEdgesRef.current;
    const next = entry === 'chamferEdges'
      ? enterChamferState(picked, { neighbors })
      : enterFilletState(picked, { neighbors });
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

  /** Solid geometry of a part: the pick mesh when active, else its assembly mesh. */
  const pickPartGeometry = (partId) => {
    const active = activePartIdRef.current;
    if (partId == null || partId === '' || active == null || String(partId) === String(active)) {
      return resultRef.current?.geometry || null;
    }
    return assemblyExtrasRef.current?.get(String(partId))?.geometry || null;
  };

  const acceptFillet = useCallback(() => {
    const state = filletModeRef.current;
    if (!state) return;
    const editing = featureEditRef.current;
    if (editing && (editing.kind === 'fillet' || editing.kind === 'chamfer')) {
      const edges = (selectedEdges && selectedEdges.length) ? selectedEdges : (state.lastEdges || []);
      const chamfer = state.entry === 'chamferEdges';
      if (edges.length) {
        const gate = chamfer
          ? validateChamferAccept(edges, state.params)
          : validateFilletAccept(edges, state.params);
        if (!gate.ok) {
          showFilletToast(gate.message);
          return;
        }
      }
      const selectedIds = [...new Set(edges.map((edge) => edge.boundaryId).filter((id) => Number.isFinite(id)))];
      const missingIds = editing.clearMissing
        ? []
        : (editing.missingEdges || []).map((edge) => edge.id).filter((id) => Number.isFinite(id));
      const storedIds = (editing.session?.edges || []).map((edge) => edge.id).filter((id) => Number.isFinite(id));
      const nextIds = [...selectedIds, ...missingIds].sort((a, b) => a - b);
      const sameEdges = !editing.clearMissing
        && JSON.stringify(nextIds) === JSON.stringify(storedIds.slice().sort((a, b) => a - b));
      const fields = chamfer
        ? { ...(editing.session?.fields || {}), chamfer: Number(state.params.chamfer) }
        : {
          ...(editing.session?.fields || {}),
          radius: Number(state.params.radius),
        };
      const ok = commitFeatureEditRef.current?.({
        fields,
        edgeIds: sameEdges ? undefined : nextIds,
        clearMissing: !!editing.clearMissing,
      });
      if (ok) {
        edgeRematchToastSuppressRef.current = true;
        clearEdgeHover();
        clearEdgeHighlight();
        setSelectedEdges([]);
        exitFilletMode();
      }
      return;
    }
    const edges = (selectedEdges && selectedEdges.length)
      ? selectedEdges
      : (state.lastEdges || []);
    const chamfer = state.entry === 'chamferEdges';
    const activeId = activePartIdRef.current;
    // Picks may span parts. Validate each part's chain before anything is
    // written: one bad part fails the whole Accept.
    const plan = planMultiPartEdgeAccept({
      edges,
      activeId,
      // An untouched size is the adjacent-edge seed. Each part reseeds it
      // against its own edges. A typed size applies to every part.
      validate: (list) => {
        const partEdges = featureEdgesOf(pickPartGeometry(list[0]?.partId ?? activeId));
        if (chamfer) {
          const params = state.sizeTouched
            ? state.params
            : { ...state.params, chamfer: adjacentBlendSize(list, partEdges).defaultMm };
          return validateChamferAccept(list, params);
        }
        return validateFilletAccept(list, partEdgeParams(state.params, list, {
          touched: !!state.radiusTouched,
          seed: (picks) => defaultFilletParams(picks, { neighbors: partEdges }).radius,
        }));
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
      });
      if (ok) {
        edgeRematchToastSuppressRef.current = true;
        clearEdgeHover();
        clearEdgeHighlight();
        setSelectedEdges([]);
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
    });
    if (!ok) filletQualityWatchRef.current = null;
    if (ok) {
      edgeRematchToastSuppressRef.current = true;
      // Keep Face/Edge (and Plane/Contour) — exitFilletMode restores pre-Fillet pick.
      clearEdgeHover();
      clearEdgeHighlight();
      setSelectedEdges([]);
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
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
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

  const enterPaintMode = useCallback(() => {
    if (mode === 'game') return;
    feaCloseRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
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
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    setDraftMode(null);
    draftModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
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

  const filletPreviewParams = useCallback((mode) => (
    mode.entry === 'chamferEdges'
      ? {
        ...(mode.params || {}),
        strategy: 'sweep',
        profile: 'chamfer',
        radius: mode.params?.chamfer,
      }
      : mode.params
  ), []);
  const filletBlendPayload = useMemo(() => {
    if (!filletMode) return null;
    return buildFilletBlendPreview(filletActiveEdges, filletPreviewParams(filletMode));
  }, [filletMode, filletActiveEdges, filletPreviewParams]);
  // Chip status across every part with picks: each part's chain must build.
  const filletChipStatus = useMemo(() => {
    if (!filletMode) return { ok: false, componentCount: 0 };
    if (filletPartCount <= 1) {
      return {
        ok: filletBlendPayload?.ok === true,
        componentCount: filletBlendPayload?.componentCount || 0,
      };
    }
    let ok = true;
    let componentCount = 0;
    for (const group of groupEdgesByPart(selectedEdges, activePartIdRef.current)) {
      const payload = buildFilletBlendPreview(group.edges, filletPreviewParams(filletMode));
      if (payload?.ok !== true) ok = false;
      componentCount += payload?.componentCount || 0;
    }
    return { ok, componentCount };
  }, [filletMode, filletPartCount, filletBlendPayload, selectedEdges, filletPreviewParams]);
  useEffect(() => {
    if (!filletMode) {
      clearFilletBlendPreview();
      return;
    }
    if (!filletActiveEdges.length) {
      clearFilletBlendPreview();
      return;
    }
    const neighbors = featureEdgesRef.current;
    if (filletMode.entry === 'chamferEdges') {
      if (!filletMode.sizeTouched) {
        const seeded = adjacentBlendSize(filletActiveEdges, neighbors).defaultMm;
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
      const seeded = defaultFilletParams(filletActiveEdges, { neighbors });
      if (Number(filletMode.params?.radius) !== seeded.radius) {
        setFilletMode((prev) => (
          prev && !prev.radiusTouched
            ? { ...prev, params: { ...prev.params, radius: seeded.radius } }
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

  const savedContours = useMemo(
    () => listSavedContours(currentScript || ''),
    [currentScript],
  );

  const constructionPlanes = useMemo(
    () => listConstructionPlanes(currentScript || ''),
    [currentScript],
  );

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
    const pickedId = contourMode?.pickedContourId || armedContourId;
    paintSavedContourGhosts(entries.map((entry) => ({ ...entry, pickedId })));
  }, [
    contourMode,
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

  useEffect(() => {
    if (!showPlanes) {
      clearConstructionPlanes();
      return;
    }
    paintConstructionPlanes(partOverlayEntries().map((entry) => ({ ...entry, selectedId: selectedPlaneId })));
  }, [selectedPlaneId, showPlanes, paintConstructionPlanes, clearConstructionPlanes, partOverlayEntries, meshEpoch, overlayEpoch, sceneReady]);

  useEffect(() => () => {
    clearConstructionPlanes();
  }, [clearConstructionPlanes]);

  // Live workplane + makeCrossSection profile (+ Extrude / Revolve / Loft solid) preview.
  useEffect(() => {
    if (!contourMode) {
      clearWorkplaneOverlay();
      clearPolylineDraft();
      clearContourStatusWire();
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      applyContourPartGhost(false);
      return;
    }
    // No face pick: snap the default +Z plane to the part top so the live
    // solid sits on the workplane (same intent as facesByNormal on Confirm).
    // Same resolver the polyline hit-test uses — see contourWorkplaneFace.
    const planeFace = contourWorkplaneFace(contourMode, modelBounds);
    const plane = planeFromContourFace(planeFace);
    // The sketch plane square is not drawn. Start drawing still aims the camera.
    clearWorkplaneOverlay();
    applyContourPartGhost(true);
    if (isWorkplaneEntry(contourMode.entry)) {
      clearXsPreview();
      clearPolylineDraft();
      clearContourStatusWire();
      clearExtrudePreview();
      clearRevolvePreview();
      clearLoftPreview();
      clearSweepPreview();
      return;
    }
    const pts = contourMode.params?.contour?.points?.map((p) => p.at) || contourMode.params?.points;
    const loftDraw = selectedLoftDrawFrame(contourMode) || plane;
    const drawPlane = isLoftEntry(contourMode.entry) ? loftDraw : plane;
    const paint = highlightContourPaint(
      contourMode.params?.contour ? contourPaintModel(contourMode.params.contour) : null,
      contourMode.params?.contour,
      (contourMode.gesture === 'dimension' || contourMode.gesture === 'constraints')
        ? contourMode.picks
        : null,
    );
    if (contourMode.tool === 'polyline' && (!Array.isArray(pts) || pts.length < 3)) {
      clearXsPreview();
      clearExtrudePreview();
      clearRevolvePreview();
      paintPolylineDraft(drawPlane, pts || [], {
        wire: !paint,
        pointColors: paint?.pointColors || null,
        pointIds: paint?.pointIds || null,
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
    // A closed polyline draws its own outline, but the grab handles must stay
    // on the points — that is the whole window in which the user wants to nudge
    // them. Handles only, no duplicate wire.
    if (contourMode.tool === 'polyline' && Array.isArray(pts) && pts.length) {
      paintPolylineDraft(drawPlane, pts, {
        wire: false,
        pointColors: paint?.pointColors || null,
        pointIds: paint?.pointIds || null,
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
  }, [contourMode, modelBounds, selectedEdges, paintPolylineDraft, paintContourStatusWire, paintExtrudePreview, paintRevolvePreview, paintLoftPreview, paintSweepPreview, applyContourPartGhost, clearWorkplaneOverlay, clearPolylineDraft, clearContourStatusWire, clearExtrudePreview, clearRevolvePreview, clearLoftPreview, clearSweepPreview, clearXsPreview, setXsPreview]);

  useEffect(() => () => {
    clearWorkplaneOverlay();
    clearPolylineDraft();
    clearContourStatusWire();
    clearExtrudePreview();
    clearRevolvePreview();
    clearLoftPreview();
    clearSweepPreview();
    applyContourPartGhost(false);
    clearSavedContourGhosts();
    if (contourToastTimerRef.current) clearTimeout(contourToastTimerRef.current);
  }, [clearWorkplaneOverlay, clearPolylineDraft, clearContourStatusWire, clearExtrudePreview, clearRevolvePreview, clearLoftPreview, clearSweepPreview, applyContourPartGhost, clearSavedContourGhosts]);

  // Contour mode: planar face tap updates the workplane; non-planar is a loud refuse.
  useEffect(() => {
    if (!contourModeRef.current || !selectedFace) return;
    const resolved = resolveContourWorkplane(selectedFace);
    if (!resolved.ok) {
      showContourToast(resolved.message);
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
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
    // The plane card keeps the feature-sheet slide. Aim waits for Start drawing.
    if (contourPlaneOpenRef.current) return;
    requestFaceSketchAim(resolved.face?.normal || resolved.plane?.normal);
  }, [selectedFace, onFaceSelected, clearHighlight]);

  // Start drawing: look along the sketch-plane normal. A highlighted face
  // is framed; any other plane frames the part. The highlight drops when
  // the tween ends. The plane card has already dropped its slide snapshot.
  useEffect(() => {
    if (!faceSketchNonce) return undefined;
    const state = contourModeRef.current;
    const normal = faceSketchNormalRef.current;
    if (!state || !normal || contourPlaneOpenRef.current) return undefined;
    const meshes = highlightMeshRef.current;
    const list = Array.isArray(meshes) ? meshes.filter(Boolean) : (meshes ? [meshes] : []);
    const faceMeshes = list.filter((mesh) => mesh.name === 'highlight');
    const box = faceSketchBox(faceMeshes.length ? faceMeshes : list)
      || boundsSketchBox(modelBoundsRef.current);
    if (!box) {
      clearHighlight();
      setSelectedFace(null);
      onFaceSelected?.(null);
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
  }, [faceSketchNonce, clearHighlight, onFaceSelected]);

  // Drawing undo. The plane card is not a step. Start drawing seeds the
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
    contourPlaneOpenRef.current = true;
    setContourPlaneOpen(true);
  }, []);

  const startContourDrawing = useCallback(() => {
    const state = contourModeRef.current;
    if (!state) return;
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
  }, []);

  const onContourBack = useCallback(() => {
    if ((sketchHistRef.current?.depth || 0) > 0) {
      undoContourSketch();
      return;
    }
    reopenContourPlane();
  }, [undoContourSketch, reopenContourPlane]);

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

  // Clear cutting plane widget
  const clearCuttingPlane = () => {
    if (cuttingPlaneWidgetRef.current && sceneRef.current) {
      sceneRef.current.remove(cuttingPlaneWidgetRef.current);
      cuttingPlaneWidgetRef.current.children.forEach(child => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
      cuttingPlaneWidgetRef.current = null;
    }
  };

  // Handle cross-section toggle
  const handleCrossSectionToggle = async (enabled) => {
    if (enabled) {
      try {
        if (!manifoldContext.isReady || !currentScript) return;
        setCrossSectionEnabled(true);
      } catch (error) {
        console.error('[CrossSection] Failed to enable:', error);
      }
    } else {
      // Disable and restore original
      setCrossSectionEnabled(false);
      clearCuttingPlane();
    }
  };

  // Handle plane changes for cross-section preview
  const handlePlaneChange = async (plane) => {
    setCrossSectionPlane(plane);
    
    if (!crossSectionEnabled || !cachedMeshData) return;
    
    try {
      const normal = new Vector3(...plane.normal).normalize();
      const normalArray = [normal.x, normal.y, normal.z];
      
      // Call worker to trim the cached manifold
      const { mesh: trimmedMesh } = await manifoldContext.trimByPlane(
        normalArray, 
        plane.originOffset
      );
      if (trimmedMesh && cachedMeshDataRef.current?.sheetMetal) trimmedMesh.sheetMetal = true;

      // Render the trimmed result
      renderMeshData(trimmedMesh);
      
      // Update cutting plane widget visibility
      if (plane.showPlane) {
        if (cuttingPlaneWidgetRef.current) {
          updateCuttingPlaneWidget(cuttingPlaneWidgetRef.current, plane);
        } else {
          const widget = createCuttingPlaneWidget({
            normal: plane.normal,
            originOffset: plane.originOffset,
            size: Math.max(...(modelBounds?.size || [200, 200, 200]))
          });
          sceneRef.current.add(widget);
          cuttingPlaneWidgetRef.current = widget;
        }
      } else {
        clearCuttingPlane();
      }
      
    } catch (error) {
      console.error('[CrossSection] Error applying plane:', error);
      setExecutionError(error.message);
    }
  };

  useEffect(() => {
    if (crossSectionEnabled && cachedMeshData) {
      handlePlaneChange(crossSectionPlane);
    } else if (!crossSectionEnabled && cachedMeshData) {
      // Restore original mesh when cross-section is disabled
      renderMeshData(cachedMeshData);
      clearCuttingPlane();
    }
  }, [crossSectionEnabled]);

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
    feaCloseRef.current();
    exitPaintModeRef.current();
    exitSheetMetalChromeRef.current();
    exitContourMode();
    setFilletMode(null);
    filletModeRef.current = null;
    clearFilletBlendPreview();
    setShellMode(null);
    shellModeRef.current = null;
    if (cutModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setCutMode(null);
    cutModeRef.current = null;
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
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
      color: 0x22d3ee,
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
    scene.add(group);
    cutPiecesPreviewRef.current = group;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [hideCutBaseMesh, removeCutPreviewGroup]);

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
    if (booleanModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current) clearHighlight();
    setBooleanMode(null);
    booleanModeRef.current = null;
    setMoveMode(null);
    moveModeRef.current = null;
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
      mesh.position.copy(host.position);
      mesh.raycast = () => {};
      mesh.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER;
      mesh.userData.booleanRemotePart = pick.partId;
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
    // Pieces are in the target part's frame; the pick mesh carries its offset.
    if (resultRef.current) group.position.copy(resultRef.current.position);
    scene.add(group);
    booleanPiecesPreviewRef.current = group;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [hideBooleanBaseMesh, removeBooleanPreviewGroup]);

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
    // A section replaces the drawn mesh. Highlights use the unsectioned body
    // the script will boolean, so the pick stays on the real solid.
    if (crossSectionEnabled && cachedMeshDataRef.current?.vertProperties) {
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
    scene.add(mesh);
    movePreviewRef.current = mesh;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [clearMovePreview, getHelperBuffer]);

  const exitMoveMode = useCallback(() => {
    cancelFeatureEditRef.current?.('move');
    const was = moveModeRef.current;
    clearMovePreview();
    setMoveMode(null);
    moveModeRef.current = null;
    if (was) clearHighlight();
    if (shellToastTimerRef.current) {
      clearTimeout(shellToastTimerRef.current);
      shellToastTimerRef.current = null;
    }
    setShellToast(null);
  }, [clearHighlight, clearMovePreview]);

  const enterMoveMode = useCallback(() => {
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
    scene.add(mesh);
    moveFacePreviewRef.current = mesh;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);
  }, [hideMoveFaceBase, removeMoveFacePreview]);

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
    if (!sheetMetalMode) {
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

  const commitDeleteFaceState = useCallback((next) => {
    deleteFaceModeRef.current = next;
    setDeleteFaceMode(next);
    paintDeleteFacePicks(next);
  }, [paintDeleteFacePicks]);

  const enterDeleteFaceMode = useCallback(() => {
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
    const slop = resolveEdgePickSlopPx();
    const cam = cameraRef.current.position;
    const opts = {
      projectScratchA: edgePickScratchA.current,
      projectScratchB: edgePickScratchB.current,
      cameraPosition: [cam.x, cam.y, cam.z],
    };
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
   * Right-button (desktop) or one-finger (touch) drag of a polyline handle.
   * A gesture selects and does not drag. A fixed point and a contour already
   * in conflict consume the event so the camera does not pan.
   */
  const beginPolylinePointDrag = useCallback((event, { touch = false } = {}) => {
    const state = contourModeRef.current;
    if (!state || state.tool !== 'polyline' || state.gesture) return false;
    if (pickModeRef.current === 'edge') return false;
    const index = pickPolylinePointAtClient(event.clientX, event.clientY);
    if (index < 0) return false;
    const spec = state.params?.contour || null;
    const pointId = spec?.points?.[index]?.id || null;
    const frozen = !!(spec && pointId && !contourPointDragAllowed(spec, pointId));
    event.preventDefault();
    polylinePointDragRef.current = {
      index,
      plane: selectedLoftDrawFrame(state) || contourWorkplane(state, modelBoundsRef.current),
      moved: false,
      touch,
      frozen,
      pointId,
      lastSpec: spec,
    };
    if (touch) polylineSuppressClickRef.current = true;
    setPolylinePointHover(index);
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    paintPolylineHandleStates();
    return true;
  }, [pickPolylinePointAtClient, setPolylinePointHover, paintPolylineHandleStates]);

  /**
   * Handle mouse down - record position for drag detection
   */
  const handleMouseDown = useCallback((event) => {
    mouseDownPosRef.current = { x: event.clientX, y: event.clientY };
    isDraggingRef.current = false;

    // Right button on a placed point picks it up (left button keeps adding).
    if (event.button !== 2) return;
    beginPolylinePointDrag(event, { touch: false });
  }, [beginPolylinePointDrag]);

  /**
   * Project the cursor onto the draft's workplane.
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
    const world = intersectRayPlane([o.x, o.y, o.z], [d.x, d.y, d.z], plane);
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
      // Safari's project() can sit a hair past ±1 for a point that is on screen.
      if (p.z < -1.02 || p.z > 1.02) return null;
      return {
        x: (p.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-p.y * 0.5 + 0.5) * rect.height + rect.top,
      };
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
      for (const child of wire?.children || []) {
        const pts = child.userData?.localPts;
        const id = child.userData?.entityId;
        if (!id || !pts || pts.length < 2) continue;
        let d = Infinity;
        for (let i = 1; i < pts.length; i += 1) {
          const a = screenOfLocal(child, pts[i - 1]);
          const b = screenOfLocal(child, pts[i]);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const L2 = dx * dx + dy * dy;
          let t = L2 > 1e-12 ? ((clientX - a.x) * dx + (clientY - a.y) * dy) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          d = Math.min(d, Math.hypot(clientX - (a.x + t * dx), clientY - (a.y + t * dy)));
        }
        const kind = child.userData.entityKind === 'arc' ? 'arc' : 'line';
        if (kind === 'arc' && d <= bestArcD) {
          bestArcD = d;
          bestArc = { kind: 'arc', id, label: id };
        } else if (kind === 'line' && d <= bestLineD) {
          bestLineD = d;
          bestLine = { kind: 'line', id, label: id };
        }
      }
      drawn = bestArc || bestLine;
    }
    const hit = drawn || pickContourScreen(model, project, clientX, clientY, SKETCH_HIT_PX);
    if (!hit) return null;
    const px = ((clientX - rect.left) / rect.width) * 2 - 1;
    const py = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera({ x: px, y: py }, camera);
    const origin = raycasterRef.current.ray.origin;
    const dir = raycasterRef.current.ray.direction;
    let rayO = [origin.x, origin.y, origin.z];
    let rayD = [dir.x, dir.y, dir.z];
    if (pose) {
      rayO = localPoint(rayO, pose);
      const ahead = localPoint([origin.x + dir.x, origin.y + dir.y, origin.z + dir.z], pose);
      rayD = [ahead[0] - rayO[0], ahead[1] - rayO[1], ahead[2] - rayO[2]];
    }
    let at = null;
    const landed = intersectRayPlane(rayO, rayD, plane);
    if (landed) {
      try {
        at = anchorOnEntity(model, hit, worldToPlaneUV(landed, plane));
      } catch { /* a missed UV still selects the entity */ }
    }
    return at ? { ...hit, at } : hit;
  }, []);

  const saveContourBlock = useCallback((state) => {
    if (!state?.params?.contour) return state;
    // Feature edit of an old inline profile still rewrites that feature
    // on the rail Confirm. Pointer-up must not insert a second contour.
    if (featureEditRef.current?.dialog === 'contour') return state;
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
    });
    if (ok === false) return null;
    return { ...state, contourId, contourName };
  }, [getHelperBuffer, onCommitContourProfile]);

  /** Unpromoted draft: write the dragged UV once, on release. No script write. */
  const commitPolylinePointDrag = useCallback((uv, index) => {
    setContourMode((prev) => {
      if (!prev || prev.tool !== 'polyline' || prev.params?.contour) return prev;
      const points = (prev.params?.points || []).map(
        (pt, i) => (i === index ? [uv[0], uv[1]] : pt),
      );
      const next = { ...prev, params: { ...prev.params, points } };
      return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
    });
  }, []);

  /** Promoted contour: seeds on release. The script changes only if a block exists. */
  const commitPromotedPointDrag = useCallback((spec) => {
    const prev = contourModeRef.current;
    if (!prev || !spec) return;
    const next = applyDraggedContour(prev, spec);
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
    (spec?.points || []).forEach((point, index) => {
      if (!point?.at) return;
      movePolylineHandle(index, planeUvToWorld(point.at, plane));
    });
    const paint = contourPaintModel(spec);
    if (paint) paintContourStatusWire(plane, paint.segments);
  }, [movePolylineHandle, paintContourStatusWire]);

  const endPolylinePointDrag = useCallback((event) => {
    const drag = polylinePointDragRef.current;
    if (!drag) return;
    polylinePointDragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    if (!drag.frozen && drag.moved) {
      if (drag.pointId && drag.lastSpec) commitPromotedPointDrag(drag.lastSpec);
      else if (drag.lastUv) commitPolylinePointDrag(drag.lastUv, drag.index);
    }
    // A release outside the canvas has no meaningful hover.
    const stillOver = event
      && pickPolylinePointAtClient(event.clientX, event.clientY) === drag.index;
    setPolylinePointHover(stillOver ? drag.index : -1);
    paintPolylineHandleStates();
  }, [commitPolylinePointDrag, commitPromotedPointDrag, pickPolylinePointAtClient,
    setPolylinePointHover, paintPolylineHandleStates]);

  /**
   * Handle mouse move - detect if dragging
   */
  const handleMouseMove = useCallback((event) => {
    // Live point drag owns the pointer: move the handle, skip camera/pick work.
    const drag = polylinePointDragRef.current;
    if (drag) {
      // Touch is driven by pointermove. The synthetic mousemove must not solve twice.
      if (drag.touch && event.type === 'mousemove') return;
      if (!drag.frozen) {
        const hit = polylinePlanePointAtClient(event.clientX, event.clientY, drag.plane);
        if (hit && drag.pointId && drag.lastSpec) {
          const result = dragContourPoint(drag.lastSpec, drag.pointId, hit.uv);
          if (result.moved && result.spec) {
            drag.moved = true;
            drag.lastSpec = result.spec;
            drag.lastUv = result.uv;
            showDraggedContour(drag.plane, result.spec);
          }
        } else if (hit) {
          drag.moved = true;
          drag.lastUv = hit.uv;
          movePolylineHandle(drag.index, hit.world);
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
    if (contourModeRef.current?.tool === 'polyline' && pickModeRef.current !== 'edge') {
      setPolylinePointHover(pickPolylinePointAtClient(event.clientX, event.clientY));
    } else if (polylinePointHoverRef.current !== -1) {
      setPolylinePointHover(-1);
    }
  }, [selectedEdges, highlightHoverEdge, clearEdgeHover, pickEdgeAtClient,
    polylinePlanePointAtClient, movePolylineHandle, pickPolylinePointAtClient,
    setPolylinePointHover, showDraggedContour]);

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

  const handleMouseUp = useCallback((event) => {
    if (polylinePointDragRef.current) {
      endPolylinePointDrag(event);
      return;
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
    if (event.button !== 0) return;
    // Slice Mobile C: long-press already opened the sheet — suppress the click.
    if (featureLongPressFiredRef.current) {
      featureLongPressFiredRef.current = false;
      isDraggingRef.current = false;
      return;
    }
    // A finger tap wobbles a few pixels. That is still a sketch pick.
    // A real orbit moves further and must not also select.
    if (isDraggingRef.current) {
      const down = mouseDownPosRef.current;
      const moved = down
        ? Math.hypot(event.clientX - down.x, event.clientY - down.y)
        : Infinity;
      const sketchTap = !!contourModeRef.current?.gesture && moved <= SKETCH_HIT_PX;
      isDraggingRef.current = false;
      if (!sketchTap) return;
    }
    
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
    // edge handles, features). A miss does nothing.
    if (sheetMetalModeRef.current) {
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

    // Slice 24: polyline tool — tap the workplane to add UV points (cheap draw).
    if (contourModeRef.current?.tool === 'polyline' && pickModeRef.current !== 'edge') {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      pendingClickDataRef.current = null;
      // MUST match the painted overlay (contourWorkplaneFace): resolving a
      // different fallback here is what put tapped points off-cursor.
      // Tapping a handle almost always means "grab this", not "stack a second
      // point on top of it" — say so instead of silently doing the wrong thing.
      if (pickPolylinePointAtClient(event.clientX, event.clientY) >= 0) {
        showContourToast('Right-drag this point to move it — tap elsewhere to add one.', { undo: false });
        return;
      }
      const plane = selectedLoftDrawFrame(contourModeRef.current)
        || contourWorkplane(contourModeRef.current, modelBoundsRef.current);
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const origin = raycasterRef.current.ray.origin;
      const dir = raycasterRef.current.ray.direction;
      const hit = intersectRayPlane(
        [origin.x, origin.y, origin.z],
        [dir.x, dir.y, dir.z],
        plane,
      );
      if (!hit) {
        showContourToast('Could not hit the workplane — orbit so the plane faces the camera.');
        return;
      }
      let uv;
      try {
        uv = worldToPlaneUV(hit, plane);
      } catch (e) {
        showContourToast(e.message || 'Could not project onto the workplane.');
        return;
      }
      if (!uv.every(Number.isFinite)) {
        showContourToast('Workplane tap produced a non-finite UV — refusing the point.');
        return;
      }
      setContourMode((prev) => {
        if (!prev || prev.tool !== 'polyline') return prev;
        const points = [...(prev.params?.points || []), [uv[0], uv[1]]];
        const next = { ...prev, params: { ...prev.params, points } };
        return isLoftEntry(prev.entry) ? writeLoftSelected(next, { params: next.params }) : next;
      });
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
    if (!moveFaceModeRef.current && !deleteFaceModeRef.current && !cutModeRef.current && !booleanModeRef.current && !paintModeRef.current && !feaPickRef.current && showContoursRef.current && !moveModeRef.current && contourModeRef.current?.tool !== 'polyline') {
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
    const planeHits = (showPlanesRef.current && constructionPlaneRef.current)
      ? raycasterRef.current.intersectObject(constructionPlaneRef.current, true)
        .filter((hit) => (overlayHitPartId(hit.object) ?? null) === (editorOverlayPartIdRef.current ?? null))
      : [];
    const partChoiceHit = resolvePartPick(collectPartHits());
    const planeD = planeHits[0]?.distance ?? Infinity;
    const solidD = partChoiceHit.hit?.distance ?? Infinity;
    // Cut taps a body or a piece. A construction plane that sits on the cut
    // (the XY plane through a centered part) must not swallow that click.
    if (!cutModeRef.current && !booleanModeRef.current && !paintModeRef.current && !feaPickRef.current && planeHits.length && !moveModeRef.current && !moveFaceModeRef.current && !deleteFaceModeRef.current && planeD <= solidD + 0.5) {
      const ud = planeHits[0].object.userData?.plane
        ? planeHits[0].object.userData
        : planeHits[0].object.parent?.userData;
      if (ud?.plane) {
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
        feaPickRef.current({ removeProbeId: marker.object.userData.probeId });
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
    
  }, [onFaceSelected, measurementEnabled, clearHighlight, clearEdgeHover, clearEdgeHighlight,
    pickEdgeAtClient, endPolylinePointDrag, pickPolylinePointAtClient, pickContourAtClient, commitBooleanState,
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
        area: 0,
        triangleCount: (last.indices || []).length,
        selectionMode: 'coplanar',
      };
    const payload = list.length > 1 ? { ...base, group: lite } : { ...base };
    const classified = classifySelectedFace(payload) || payload;
    const span = faceSliderFrame(faceData?.vertices, classified.normal, classified.center);
    if (span) classified.span = span;
    setSelectedFace(classified);
    onFaceSelected?.(classified);
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
  }, [clearHighlight, highlightFace, onFaceSelected]);

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
      const sectioned = !!(crossSectionEnabled && cachedMeshDataRef.current?.vertProperties);
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
      if (moveModeRef.current) {
        // Same resolver as the rest of the viewport: one click is the full
        // face and does not change the body. Two clicks set that body as
        // the move target. Not a legacy picker, and no viewport arrows.
        if (clickCount >= 2) {
          const bodies = meshBodyComponents(positions, index);
          const hit = bodyContainingTriangle(bodies, seedFaceIndex);
          if (!hit) {
            showShellToast(MOVE_MODE_NEED_BODY);
            return;
          }
          const prev = moveModeRef.current.target;
          const same = prev && cutBodyKey(prev) === cutBodyKey(hit);
          const buf = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || '';
          const target = same ? null : {
            at: resolveMoveBodyAt(hit.at, bodyCentroidsRef.current, buf),
            minTri: hit.minTri,
            triangles: hit.triangles.slice(),
          };
          const next = { ...moveModeRef.current, target };
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
            const next = {
              ...moveModeRef.current,
              faceNormal: [nx / len, ny / len, nz / len],
            };
            moveModeRef.current = next;
            setMoveMode(next);
            paintMovePreview(next);
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
  }, [onFaceSelected, clearHighlight, clearEdgeHighlight, highlightFace, publishFacePicks, paintDraftPicks, commitCutState, paintMovePreview, commitMoveFaceState, commitDeleteFaceState, getHelperBuffer, commitBooleanState, crossSectionEnabled]);

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
      if (contourModeRef.current || filletModeRef.current || shellModeRef.current || draftModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current || sheetMetalModeRef.current || helperCardOpenRef.current || paintModeRef.current) return;
      if (measurementEnabled) return;
      CLEAR_LP();
      featureLongPressFiredRef.current = false;
      featureLongPressOriginRef.current = { x: event.clientX, y: event.clientY };
      featureLongPressTimerRef.current = setTimeout(() => {
        featureLongPressTimerRef.current = null;
        const origin = featureLongPressOriginRef.current;
        featureLongPressOriginRef.current = null;
        if (!origin || !featureSheetEnabledRef.current) return;
        if (contourModeRef.current || filletModeRef.current || shellModeRef.current || draftModeRef.current || moveModeRef.current || moveFaceModeRef.current || deleteFaceModeRef.current || sheetMetalModeRef.current || helperCardOpenRef.current || paintModeRef.current) return;
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
      if (contourModeRef.current?.tool === 'polyline') event.preventDefault();
    };
    const onWindowMouseUp = (event) => {
      if (polylinePointDragRef.current && !polylinePointDragRef.current.touch) {
        endPolylinePointDrag(event);
      }
    };
    const onTouchDown = (event) => {
      if (event.pointerType !== 'touch') return;
      beginPolylinePointDrag(event, { touch: true });
    };
    const onTouchMove = (event) => {
      if (event.pointerType !== 'touch' || !polylinePointDragRef.current?.touch) return;
      handleMouseMove(event);
    };
    const onTouchUp = (event) => {
      if (!polylinePointDragRef.current?.touch) return;
      endPolylinePointDrag(event);
    };

    const onDblClick = (event) => {
      event.preventDefault();
    };
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onTouchDown, { passive: false });
    canvas.addEventListener('pointermove', onTouchMove);
    canvas.addEventListener('pointerup', onTouchUp);
    canvas.addEventListener('pointercancel', onTouchUp);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('pointerup', onTouchUp);
    window.addEventListener('pointercancel', onTouchUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onTouchDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchUp);
      canvas.removeEventListener('pointercancel', onTouchUp);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('pointerup', onTouchUp);
      window.removeEventListener('pointercancel', onTouchUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, endPolylinePointDrag, beginPolylinePointDrag]);

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
      || booleanMode || moveMode || moveFaceMode || deleteFaceMode
      || paintMode || feaActive || sheetMetalMode || sheetMetalPicker
      || helperCardOpen || editSheetOpen
    );
    if (!other) return undefined;
    exitMeasureModeRef.current();
    return undefined;
  }, [
    measurementEnabled, contourMode, filletMode, shellMode, draftMode, cutMode,
    booleanMode, moveMode, moveFaceMode, deleteFaceMode, paintMode, feaActive,
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
    let orbitControls = null;
    
    const getContainerSize = () => {
      const size = {
        width: container.clientWidth,
        height: container.clientHeight
      };
      return size;
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

      const renderer = new WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true
      });

      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
          // Set this from automation to be notified the instant a mesh lands in the scene.
          // Fires from renderMeshData with the exact meshData object that was painted.
          onRendered: null,
          _lastRenderedMesh: null,
          _renderCount: 0,
          lastRenderedIs: (mesh) => window.__VIEWPORT__?._lastRenderedMesh === mesh,
          // Run a script exactly as the Run button does -- validate, execute in the worker,
          // render into the live scene, auto-fit. Resolves { error, mesh } so a headless
          // caller can tell a fresh build from a failure without reading React state.
          executeScript: async (s, opts) => {
            stageExecErrorRef.current = null;
            try {
              await executeScript(s, opts);
            } catch (e) {
              stageExecErrorRef.current = String(e?.message || e);
            }
            const err = stageExecErrorRef.current;
            const mesh = err ? null : (window.__MANIFOLD_CONTEXT__?.lastResult?.mesh ?? null);
            // Identity check against the render choke point: the object we painted is the
            // object the worker just returned, or this run did not reach the screen at all.
            return {
              error: err,
              mesh,
              onScreen: !!mesh && window.__VIEWPORT__?._lastRenderedMesh === mesh,
              sceneTris: __tris(),
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
              up: cam.up.toArray(),
              target: ctl ? ctl.target.toArray() : null,
              near: cam.near, far: cam.far, fov: cam.fov, aspect: cam.aspect,
              zoom: cam.zoom, view: cam.view ? { ...cam.view } : null,
              te: pe ? { te0: pe[0], te5: pe[5], te8: pe[8], te9: pe[9] } : null,
              bbox: b && !b.isEmpty() ? { min: b.min.toArray(), max: b.max.toArray() } : null,
            };
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
            const r = rendererRef.current, c = cameraRef.current;
            if (!r || !c) return false;
            r.setSize(w, h);
            r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            c.aspect = w / h;
            c.updateProjectionMatrix();
            renderer.render(sceneRef.current, c);
            return true;
          },
          setAxes: (on) => { setAxisHelperEnabled(!!on); return true; },
          stageContourSketch: () => {
            const meshes = highlightMeshRef.current;
            return {
              aim: containerRef.current?.getAttribute('data-contour-face-aim') || '',
              highlights: Array.isArray(meshes) ? meshes.length : (meshes ? 1 : 0),
              planePreset: contourModeRef.current?.planePreset || '',
              tool: contourModeRef.current?.tool || '',
              points: Array.isArray(contourModeRef.current?.params?.points)
                ? contourModeRef.current.params.points.length
                : 0,
              undoDepth: sketchHistRef.current?.depth || 0,
              open: !!contourModeRef.current,
              planeCard: contourPlaneOpenRef.current,
              planeSquare: !!workplaneOverlayRef.current,
              gesture: contourModeRef.current?.gesture || '',
              dimensionEdit: contourModeRef.current?.dimensionEdit || null,
              constraintEdit: contourModeRef.current?.constraintEdit || null,
              dimensions: contourModeRef.current?.params?.contour?.dimensions?.length || 0,
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
                  };
                  return dot;
                });
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
        };
      }

      const controls = new TrackballControls(camera, renderer.domElement);
      applyTrackballFeel(controls);
      controls.enableRotate = true;
      orbitControls = controls;
      controlsRef.current = controls;

      // Add axis helper
      const axisHelper = new AxesHelper(50);
      sceneRef.current.add(axisHelper);
      axisHelperRef.current = axisHelper;
      axisHelperRef.current.visible = axisHelperEnabled;

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
      
      if (cameraRef.current) {
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
      }
      
      if (rendererRef.current) {
        rendererRef.current.setSize(width, height);

        // Keep LineMaterial screen-space widths correct after canvas resize.
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
        
        if (controlsRef.current) {
          controlsRef.current.update();
        }
        
        if (sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
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
      if (orbitControls) {
        orbitControls.dispose();
        if (controlsRef.current === orbitControls) controlsRef.current = null;
        orbitControls = null;
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
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
      clearCuttingPlane();
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
    const preset = VIEW_PRESETS[key] || VIEW_PRESETS.iso;
    if (!resultRef.current?.geometry || !cameraRef.current) return false;
    holdSheetSlide();
    const ok = fitView({
      camera: cameraRef.current,
      controls: controlsRef.current,
      geometry: resultRef.current.geometry,
      dir: preset.dir,
      up: preset.up,
      margin,
    });
    if (ok) console.log(`[Viewport] Snapped to ${preset.label}`);
    return ok;
  }, []);

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

  const handleAxisHelperToggle = () => {
    setAxisHelperEnabled(prev => {
      const newValue = !prev;
      if (axisHelperRef.current) {
        axisHelperRef.current.visible = newValue;
      }
      return newValue;
    });
  };

  assemblyColorsRef.current = assemblyColors || null;
  applyFaceSkinRef.current = (host) => {
    if (!host) return;
    const painting = paintModeRef.current;
    const colors = painting ? (painting.session || null) : assemblyColorsRef.current;
    const rainbow = readFaceColorDebugFlag();
    const surfId = host.userData?.surfId || null;
    const entry = surfId && colors ? colors[surfId] : null;
    const wants = rainbow || !!(entry && (entry.part || (Array.isArray(entry.faces) && entry.faces.length)));
    if (!wants) {
      detachFaceColorSkin(host);
      if (host === resultRef.current) applyStressSkinRef.current(host);
      return;
    }
    const cached = solidEntryForGeometry(solidCacheRef.current, host.geometry);
    syncFaceColorSkin(host, {
      geometry: host.geometry,
      faceIDs: cached?.faceIDs || null,
      surfId,
      colors,
      rainbow,
    });
    if (host === resultRef.current) applyStressSkinRef.current(host);
  };

  applyStressSkinRef.current = (host) => {
    if (host) syncStressSkin(host);
  };

  // Helper to render mesh data from the worker
  const renderMeshData = useCallback((meshData) => {
    if (!meshData || !resultRef.current) return;
    // A new script result replaces the solid. Drop any Pieces clone so the
    // viewport shows that result in the normal body color.
    clearCutPiecePreviewRef.current();

    // The needle between two copies of a cap vertex is not part of the
    // face: buildSolidGeometry drops it so the seam is not drawn and is not
    // an edge of the face graph. A solid already built for this mesh data
    // (another assembly part, or this part before a switch) is reused.
    const solid = cachedSolidGeometry(solidCacheRef.current, meshData);
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
    graphTimingRef.current = { ...prevTiming, faceMs, seamMs };
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

  function paintFeaFaces(study) {
    const next = study && typeof study === 'object' && !Array.isArray(study) ? study : null;
    feaHighlightStudyRef.current = next;
    const synced = syncFeaFaceHighlights(feaFaceOverlaysRef.current, next, feaPartHosts());
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
    paintFeaFaces(feaHighlightStudyRef.current);
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
    const script = scriptOverride ?? currentScript ?? '';
    const noShadow = opts.noShadow === true;

    if (!sceneRef.current) return false;

    // A blank / comment-only / construction-plane-only run empties the viewport.
    // The clear has to be total: anything still holding the previous solid — the
    // worker's cached manifold, the context's lastResult, the pick topology, the
    // solid-derived overlays — would hand the last object back through
    // cross-section, model info, quoting, game compare or the stage hooks.
    if (shouldClearViewportScript(script)) {
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
      // Overlays drawn from that solid (cut plane, section/path previews, the
      // fillet blend ghost, f#/e# labels) must not outlive it on screen.
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
    setExecutionError(null);

    // Do NOT clear face/edge selection here — a failed Auto-Run must keep the
    // chip in sync (false "0 selected" was caused by wiping selection up-front).
    // Clear only after a successful rebuild (geometry changed → stale edges).

    try {
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
      const prepared = await resolvePartMeshes(meshPartId, script);
      if (prepared.missing.length) {
        throw new Error(missingMeshMessage(prepared.missing));
      }
      
      // An assembly open may have taken the worker during import loading.
      // Do not post this preview in front of the build the spinner awaits.
      if (opts.editPreview && assemblyRunLockRef?.current) {
        return false;
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
          ? 'Unable to generate clean fillet, please try smaller size.'
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
      if (!preservePicks) {
        clearHighlight();
        setSelectedFace(null);
        onFaceSelected?.(null);
      }
      featureEdgesRef.current = [];
      featureEdgesSourceRef.current = null;
      syncFeatureEdges(resultRef.current?.geometry ?? null);
      graphsBoundMeshRef.current = meshData;
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
      
      console.log('[Viewport] Script executed successfully');
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
        contourGraphMs: (g.coherentMs || 0) + (g.seamMs || 0),
        featureMs: g.featureMs ?? null,
        topoMs: g.topoMs ?? null,
        annotateMs: g.annotateMs ?? null,
        coherentMs: g.coherentMs ?? null,
        seamMs: g.seamMs ?? null,
      };
      if (typeof window !== 'undefined') window.__SURFCAD_RUN_TIMING = report;
      if (!opts.editPreview) onRunOutcomeRef.current?.({ script, ok: true, scriptLine: null });
      if (soloRunFailedRef.current) {
        soloRunFailedRef.current = false;
        syncFailedPartOutlinesRef.current();
      }
      // Truthy object: callers that only check success keep working; game compare needs nonce.
      return { ok: true, nonce, mesh: meshData, bodyCount: bodyCentroidsRef.current.length };

    } catch (error) {
      if (opts.editPreview) {
        console.error('Edit preview failed:', error);
        return false;
      }
      filletQualityWatchRef.current = null;
      console.error('Error executing script:', error);
      const msg = error.message || 'Script execution failed';
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

  cancelFeatureEditRef.current = (kind) => {
    const edit = featureEditRef.current;
    if (!edit || edit.opening || !editKindMatches(edit, kind)) return;
    const full = edit.previewed ? edit.script : '';
    featureEditRef.current = null;
    setHelperEdit(null);
    setFeatureEditBanner('');
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
    if (moveFaceModeRef.current) exitMoveFaceMode();
    if (deleteFaceModeRef.current) exitDeleteFaceMode();
    if (sheetMetalModeRef.current) {
      sheetMetalModeRef.current = null;
      setSheetMetalMode(null);
    }
  };

  const deleteFeatureFromEdit = () => {
    const edit = featureEditRef.current;
    if (!edit?.feature) return;
    const script = (typeof getHelperBuffer === 'function' ? getHelperBuffer() : '') || edit.script || '';
    const lines = dependentToastLines(featureDependents(script, edit.feature));
    const ok = onDeleteFeatureEditRef.current?.(edit.feature);
    if (!ok) return;
    dismissFeatureEditAfterDelete();
    setFeatureDeleteToast(lines.length ? lines : null);
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
    const session0 = openFeatureEdit(text, feature);
    if (!session0.ok) {
      showContourToast(session0.message || 'Could not open that feature.');
      return false;
    }
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
      let session = session0;
      try {
        if (needsPreview && !editPreviewBlocked()) {
          const preview = editPreviewScript(text, feature);
          const ran = await executeScriptRef.current?.(preview, { editPreview: true });
          if (!featureEditRef.current) return;
          featureEditRef.current.previewed = !!ran;
          if (ran && session0.ok) {
            session = openFeatureEdit(text, feature, {
              edges: featureEdgesRef.current || [],
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
          if (moveFaceModeRef.current) exitMoveFaceMode();
          if (deleteFaceModeRef.current) exitDeleteFaceMode();
          if (paintModeRef.current) exitPaintModeRef.current();
          if (helperCardOpenRef.current) setHelperCardOpen(false);
          if (feaActive) feaCloseRef.current();
          setSheetMetalPicker(null);
          if (next) setSheetMetalMode(next);
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
          const next = {
            ...emptyMoveState(),
            dx: Number(active.fields?.dx) || 0,
            dy: Number(active.fields?.dy) || 0,
            dz: Number(active.fields?.dz) || 0,
            target: Array.isArray(at) ? { at: at.slice() } : null,
          };
          moveModeRef.current = next;
          setMoveMode(next);
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
    const { geometry: geom } = cachedSolidGeometry(solidCacheRef.current, meshData);
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
      const { geometry: geom } = cachedSolidGeometry(solidCacheRef.current, solid.mesh);
      if (mesh.geometry !== geom) {
        releaseGeometryIn(solidCacheRef.current, mesh.geometry);
        mesh.geometry = geom;
      }
      ensureBodyMaterial(mesh, solid.mesh);
      applyPartPose(mesh, solidPlacement(solid));
      mesh.userData.surfId = solid.surfId || null;
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
      const { geometry: geom } = cachedSolidGeometry(solidCacheRef.current, solid.mesh);
      if (mesh.geometry !== geom) {
        releaseGeometryIn(solidCacheRef.current, mesh.geometry);
        mesh.geometry = geom;
      }
      ensureBodyMaterial(mesh, solid.mesh);
      applyPartPose(mesh, solidPlacement(solid));
      mesh.userData.surfId = solid.surfId || null;
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
      const geom = new BufferGeometry();
      const chunks = [];
      for (const solid of solids) {
        const src = solid.mesh?.vertProperties;
        if (!src) continue;
        const np = solid.mesh.numProp || 3;
        const pose = solidPlacement(solid);
        const n = Math.floor(src.length / np);
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const w = shiftLocalPoint([src[i * np], src[i * np + 1], src[i * np + 2]], pose.t, pose.q);
          arr[i * 3] = w[0];
          arr[i * 3 + 1] = w[1];
          arr[i * 3 + 2] = w[2];
        }
        chunks.push(arr);
      }
      let total = 0;
      for (const chunk of chunks) total += chunk.length;
      if (total > 0) {
        const all = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          all.set(chunk, offset);
          offset += chunk.length;
        }
        geom.setAttribute('position', new BufferAttribute(all, 3));
        fitView({
          camera: cameraRef.current,
          controls: controlsRef.current,
          geometry: geom,
        });
        geom.dispose();
      }
    }
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
  const paintUnmatched = paintMode
    ? unmatchedColorCount(paintMode.session, paintSurfId(), paintFacesNow())
    : 0;

  const titleParts = formatViewerTitle(
    currentFilename,
    typeof assemblyName === 'string' ? assemblyName : '',
    { partSelected: cadPartSelected !== false },
  );

  const titlePlace = 'left-1/2 -translate-x-1/2 max-w-[min(36rem,calc(100%-2rem))]';

  return (
    <div
      ref={containerRef}
      className="viewport-shell relative w-full h-full bg-[#1e1e1e] overflow-hidden"
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
              className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-gray-100 hover:bg-white/10"
              onClick={() => chooseAmbiguousPart(item.partId)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      {/* G9: circular profile chip — top-right of the CAD viewport. Desktop's only chip. */}
      {mode !== 'game' && (
        <ProfileChip variant="viewport" onAccount={onAccount} onSignedOut={onSignedOut} onClearLocalCadData={onClearLocalCadData} vaultName={profileVaultName} />
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

      {/* Title row. Game: puzzle name. CAD: part, then "in", then assembly. */}
      {mode === 'game' && (
        <ViewportTitleChip>{gamePuzzleTitle || 'Puzzle'}</ViewportTitleChip>
      )}
      {mode !== 'game' && (
        showCadTitle ? (
        <div
          className={`pointer-events-none absolute top-4 z-10 flex items-center gap-2 ${titlePlace}`}
          data-viewer-title=""
          data-viewer-title-text={titleParts.text}
        >
          {titleParts.part ? (
            <ViewportTitleChip inline value={currentFilename} onRename={onRenameFile}>
              {titleParts.part}
            </ViewportTitleChip>
          ) : null}
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
              onRename={onRenameAssembly}
            >
              {titleParts.assembly}
            </ViewportTitleChip>
          ) : null}
        </div>
        ) : (
          <div data-viewer-title-empty="" hidden />
        )
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
      {onInsertHelper && !paintMode && !feaActive && !contourMode && !filletMode && !shellMode && !draftMode && !cutMode && !booleanMode && !moveMode && !moveFaceMode && !sheetMetalPicker && !deleteFaceMode && !sheetMetalMode && (
        <HelperInsertPalette
          layout={mode === 'game' ? 'game' : 'cad'}
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
          onEnterContourMode={enterContourMode}
          onEnterFilletMode={enterFilletMode}
          onEnterShellMode={enterShellMode}
          onEnterDraftMode={enterDraftMode}
          onEnterCutMode={enterCutMode}
          onEnterBooleanMode={enterBooleanMode}
          onEnterMoveMode={enterMoveMode}
          onEnterMoveFaceMode={enterMoveFaceMode}
          onEnterDeleteFaceMode={enterDeleteFaceMode}
          onOpenSheetMetal={mode !== 'game' && onBindSheetMetal
            ? () => {
              feaCloseRef.current();
              setSheetMetalPicker({ willCreatePart: getSheetMetalReady ? !getSheetMetalReady() : false });
            }
            : null}
          onOpenJoints={mode !== 'game' ? onOpenJoints : null}
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
      {sheetMetalMode && mode !== 'game' && (
        <SheetMetalRail
          onExit={() => {
            cancelFeatureEditRef.current?.('sheetMetal');
            setSheetMetalMode(null);
          }}
          tools={sheetMetalMode.stage === 'edit' ? sheetToolsFor(sheetMetalMode.spec) : []}
          tool={sheetMetalMode.tool}
          onSelectTool={(id) => setSheetMetalMode((prev) => (prev ? setSheetTool(prev, id) : prev))}
        />
      )}
      {sheetMetalMode && mode !== 'game' && (
        <SheetMetalFlow
          mode={sheetMetalMode}
          setMode={(fn) => setSheetMetalMode((prev) => (prev ? fn(prev) : prev))}
          onCommit={(spec, meta) => {
            if (sheetMetalMode.reopen) {
              setSheetMetalMode((prev) => (prev ? pushSheetHistory(prev, spec) : prev));
              return true;
            }
            return onCommitSheetMetal?.(spec, { ...meta, partId: sheetMetalMode.partId }) ?? false;
          }}
          onConfirm={() => {
            const mode = sheetMetalModeRef.current;
            const edit = featureEditRef.current;
            if (!mode?.reopen || edit?.kind !== 'sheetMetal') return;
            const ok = commitFeatureEditRef.current?.({
              fields: { ...(edit.session?.fields || {}) },
              spec: mode.spec,
            });
            if (!ok) return;
            sheetMetalModeRef.current = null;
            setSheetMetalMode(null);
          }}
          onExit={() => {
            cancelFeatureEditRef.current?.('sheetMetal');
            setSheetMetalMode(null);
          }}
          onDeleteFeature={featureEditRef.current?.dialog === 'sheetMetal' ? featureEditDelete : null}
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

      {/* Contour rail: tools, Back undoes, Confirm finishes, X exits. */}
      {contourMode && (
        <ContourModeRail
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
          onBack={exitContourMode}
        />
      )}

      {/* Cross-Section Panel */}
        <CrossSectionPanel
          enabled={crossSectionEnabled}
          onToggle={handleCrossSectionToggle}
          onPlaneChange={handlePlaneChange}
          onZoomToFit={handleZoomToFit}
          onSnapView={handleViewSnap}
          bounds={modelBounds}
          measurementEnabled={measurementEnabled}
          onMeasurementToggle={handleMeasurementToggle}
          axisHelperEnabled={axisHelperEnabled}
          onAxisHelperToggle={handleAxisHelperToggle}
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
          onAnalyzeToggle={() => feaToggleRef.current?.()}
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
            onDismiss={() => setExecutionError(null)}
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
            const result = isConstraint
              ? removeContourConstraint(prev, id)
              : removeContourDimension(prev, id);
            if (result.error) {
              showContourToast(result.error);
              return;
            }
            const stored = saveContourBlock(result.state);
            setContourMode(stored || result.state);
          }}
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

      {/* Plane card. Start drawing accepts the plane and leaves the rail up. */}
      {contourMode && contourPlaneOpen && !contourMode.gesture && mode !== 'game' && (
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
              ? `planar n=[${contourMode.planeFace.normal.map((v) => Number(v).toFixed(2)).join(', ')}]`
              : 'default +Z top'
          }
          planePreset={contourMode.planePreset || 'z'}
          planeAngles={contourMode.planeAngles || { x: 0, y: 0, z: 0 }}
          constructionPlanes={constructionPlanes}
          pickedPlaneId={selectedPlaneId || ''}
          onPlanePreset={(axis) => setContourMode((prev) => {
            if (!prev) return prev;
            const center = prev.planeBase?.center
              || prev.planeFace?.center
              || contourHostCenter(modelBounds);
            return applyContourPlaneEdit(prev, {
              preset: axis,
              base: axisPresetFrame(axis, center),
              angles: { x: 0, y: 0, z: 0 },
            });
          })}
          onPlaneAngles={(angles) => setContourMode((prev) => {
            if (!prev) return prev;
            const center = prev.planeBase?.center
              || prev.planeFace?.center
              || contourHostCenter(modelBounds);
            const base = prev.planeBase || axisPresetFrame(prev.planePreset || 'z', center);
            return applyContourPlaneEdit(prev, { angles, base });
          })}
          onPickWorkplane={(plane, id) => {
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
          onConfirm={startContourDrawing}
          onCancel={exitContourMode}
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
          params={{
            ...filletMode.params,
            _sweepMax: (filletBlendPayload?.sweepMax > 0
              ? filletBlendPayload.sweepMax
              : sweepBlendHardMax(pathLengthFromEdges(filletActiveEdges.length ? filletActiveEdges : selectedEdges))),
            _blendMax: adjacentBlendSize(
              filletActiveEdges.length ? filletActiveEdges : selectedEdges,
              featureEdgesRef.current,
            ).maxMm,
            _blendMin: adjacentBlendSize(
              filletActiveEdges.length ? filletActiveEdges : selectedEdges,
              featureEdgesRef.current,
            ).minMm,
          }}
          pathOk={filletChipStatus.ok}
          componentCount={filletChipStatus.componentCount}
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
        onContactHighlight={paintFeaContacts}
        onHighlight={(study) => {
          paintFeaFaces(study);
        }}
        onClaim={releaseModesForFea}
        onActive={setFeaActive}
        pickRef={feaPickRef}
        toggleRef={feaToggleRef}
        closeRef={feaCloseRef}
      />

      {/* Paint on the shared card. Game mounts no card. */}
      {paintMode && mode !== 'game' && (
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
          compact={isMobile}
          lengthMm={characteristicLengthMm({ bounds: modelBounds })}
          onAccept={onFeatureEditAccept}
          onCancel={onFeatureEditCancel}
          onDelete={onFeatureEditDelete}
          onEditScript={onFeatureEditScript}
          onPickFeature={onFeatureEditPick}
        />
      )}

      {/* Standalone edge pick — same card, no Confirm. X clears and leaves edge pick.
          Hidden in fillet, contour, and game. Numbered badges stay on the edges. */}
      {mode !== 'game' && !helperCardOpen && pickMode === 'edge' && !contourMode && !filletMode && !shellMode && !draftMode && !moveFaceMode && !deleteFaceMode && !cutMode && !booleanMode && !moveMode && !sheetMetalMode && !sheetMetalPicker && !feaActive && !editSheetOpen && !paintMode && !measurementEnabled && selectedEdges.length > 0 && (
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

      {contourToast && createPortal(
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[min(22rem,calc(100%-2rem))]">
          <ErrorPopup
            tone="cyan"
            onDismiss={() => setContourToast(null)}
            onUndo={contourToast.undo ? onUndo : undefined}
            canUndo={canUndo}
            className="px-3 py-2 pointer-events-auto"
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
      
      <canvas ref={canvasRef} />
    </div>
  );
});

export default Viewport;
