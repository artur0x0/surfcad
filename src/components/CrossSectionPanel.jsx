// components/CrossSectionPanel.jsx
/* eslint-disable react-hooks/exhaustive-deps -- see Viewport note; same ref-backed pattern */
import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { FlipHorizontal, Check, CornerDownRight, Gauge, Maximize2, Ruler, Move3d, Spline, RectangleHorizontal, Layers3, NotebookPen, Palette, AlignHorizontalSpaceAround, X } from 'lucide-react';
import TrianglesCenterlineDashedVertical from './icons/TrianglesCenterlineDashedVertical';
import ViewSnapControl from './ViewSnapControl';
import { PLANE_PRESETS } from '../utils/crossSection';
import { RAIL_NO_CLIP_CLASS, RAIL_PAIR_HEIGHT_ATTR, RAIL_RIGHT_MAX_CLASS } from '../utils/railPair';
import { sectionThumbRange } from '../utils/sliderRange';
import { lengthFromThumb, lengthSnap, thumbFromLength, THUMB_COUNT } from '../utils/sliderMap';
import { formatDisplayLength, formatDisplayNumber } from '../utils/displayUnit';
import { useDisplayUnit } from '../hooks/useDisplayUnit';

const CrossSectionPanel = forwardRef(({ 
  enabled,
  /** Live enabled flag for agent bridge (updates before React re-render). */
  enabledRef = null,
  onToggle,
  onPlaneChange,
  onZoomToFit,
  /** Contour mode only. Aims the camera along the sketch plane and zoom-fits. */
  onNormalToSketch = null,
  onSnapView,
  bounds,
  measurementEnabled,
  onMeasurementToggle,
  axisHelperEnabled,
  onAxisHelperToggle,
  /** Slice 12: 'face' | 'edge' pick mode */
  pickMode = 'face',
  onPickModeChange = null,
  /** Plane / sketch overlays. Independent of Face/Edge. Default off. Session only. */
  showPlanes = false,
  showContours = false,
  onShowPlanesChange = null,
  onShowContoursChange = null,
  /** Paint. Same slot the patch-colour toggle used. Hidden in game. */
  showPaint = false,
  paintActive = false,
  onPaintToggle = null,
  /** Analyze. Inspection group, next to Paint. Hidden in game. */
  showAnalyze = false,
  analyzeActive = false,
  onAnalyzeToggle = null,
  /** Wall-thickness heatmap. Inspection group, immediately after Analyze. Hidden in game. */
  showWall = false,
  wallActive = false,
  onWallToggle = null,
  /** Stack tools vertically on the right edge. Both shells pass this now — desktop
   *  matches phone; the wrapping-row fallback is kept for any other caller. */
  verticalRail = false,
}, ref) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [planeType, setPlaneType] = useState('XY');
  const [offset, setOffset] = useState(0);
  const [customNormal, setCustomNormal] = useState([0, 0, 1]);
  const [isCustom, setIsCustom] = useState(false);

  // Thumb ends. Before bounds, the fallback box is ±100 and the outer third continues past it.
  const [offsetRange, setOffsetRange] = useState(() => sectionThumbRange(-100, 100));
  const placedBounds = useRef(false);
  /** Agent bridge: synchronous view until React state catches up. */
  const agentSnapRef = useRef(null);
  const [displayUnit] = useDisplayUnit();

  const patchAgentSnap = (patch) => {
    agentSnapRef.current = { ...(agentSnapRef.current || {}), ...patch };
  };

  const normalsClose = (a, b) => {
    if (!a || !b || a.length !== 3 || b.length !== 3) return false;
    return Math.abs(a[0] - b[0]) < 1e-6
      && Math.abs(a[1] - b[1]) < 1e-6
      && Math.abs(a[2] - b[2]) < 1e-6;
  };

  const liveMatchesSnap = (snap) => {
    if (!snap) return true;
    const optionsOpen = !!enabled && !isCollapsed;
    const liveNormal = isCustom ? customNormal : PLANE_PRESETS[planeType].normal;
    const enabledOk = snap.enabled == null || snap.enabled === !!enabled;
    const optionsOk = snap.optionsOpen == null || snap.optionsOpen === optionsOpen;
    const planeOk = snap.preset == null || snap.isCustom || snap.preset === planeType;
    const customOk = snap.isCustom == null || snap.isCustom === isCustom;
    const offsetOk = snap.offset == null || snap.offset === offset;
    const normalOk = snap.normal == null || normalsClose(snap.normal, liveNormal);
    return enabledOk && optionsOk && planeOk && customOk && offsetOk && normalOk;
  };

  useEffect(() => {
    const snap = agentSnapRef.current;
    if (!snap) return;
    if (liveMatchesSnap(snap)) agentSnapRef.current = null;
  }, [enabled, isCollapsed, planeType, isCustom, customNormal, offset]);

  useEffect(() => {
    if (bounds) {
      // Calculate range based on bounding box and current normal
      const normal = isCustom ? customNormal : PLANE_PRESETS[planeType].normal;
      const range = calculateOffsetRange(bounds, normal);
      setOffsetRange(range);

      // On first bounds calculation, set offset to center
      if (!placedBounds.current) {
        placedBounds.current = true;
        setOffset(range.center);
        patchAgentSnap({
          offset: range.center,
          originOffset: range.center,
          normal: [...normal],
        });

        // Also notify parent of the centered position
        onPlaneChange?.({
          normal,
          originOffset: range.center,
          showPlane: !isCollapsed,
        });
      } else if (offset < range.min || offset > range.max) {
        // If offset is out of new range, re-center
        setOffset(range.center);
        patchAgentSnap({
          offset: range.center,
          originOffset: range.center,
          normal: [...normal],
        });

        onPlaneChange?.({
          normal,
          originOffset: range.center,
          showPlane: !isCollapsed,
        });
      }
    }
  }, [bounds, planeType, isCustom, customNormal, isCollapsed]);

  const calculateOffsetRange = (bounds, normal) => {
    if (!bounds) return { min: -100, max: 100, center: 0 };
    
    // Project bounding box onto normal
    const corners = [
      [bounds.min[0], bounds.min[1], bounds.min[2]],
      [bounds.max[0], bounds.min[1], bounds.min[2]],
      [bounds.min[0], bounds.max[1], bounds.min[2]],
      [bounds.max[0], bounds.max[1], bounds.min[2]],
      [bounds.min[0], bounds.min[1], bounds.max[2]],
      [bounds.max[0], bounds.min[1], bounds.max[2]],
      [bounds.min[0], bounds.max[1], bounds.max[2]],
      [bounds.max[0], bounds.max[1], bounds.max[2]]
    ];

    const projections = corners.map(corner => 
      corner[0] * normal[0] + corner[1] * normal[1] + corner[2] * normal[2]
    );

    const min = Math.min(...projections);
    const max = Math.max(...projections);
    return sectionThumbRange(min, max);
  };

  const handlePresetChange = (preset) => {
    console.log(`Handling preset change to ${preset}`)
    setPlaneType(preset);
    setIsCustom(false);
    const normal = PLANE_PRESETS[preset].normal;
    
    // Sync rotation boxes with preset normal
    setCustomNormal([...normal]);
    
    // Re-center position
    const newOffset = offsetRange.center;
    setOffset(newOffset);
    patchAgentSnap({
      preset,
      plane: preset,
      isCustom: false,
      normal: [...normal],
      offset: newOffset,
      originOffset: newOffset,
    });
    
    onPlaneChange?.({
      normal,
      originOffset: newOffset,
      showPlane: true
    });
  };

  const handleOffsetChange = (newOffset) => {
    const value = parseFloat(newOffset);
    setOffset(value);
    
    const normal = isCustom ? customNormal : PLANE_PRESETS[planeType].normal;
    patchAgentSnap({ offset: value, originOffset: value, normal: [...normal] });
    onPlaneChange?.({
      normal,
      originOffset: value,
      showPlane: true
    });
  };

  const handleCustomNormalChange = (axis, value) => {
    if (String(value).trim() === formatDisplayNumber(customNormal[axis])) return;
    const newNormal = [...customNormal];
    const n = Number(value);
    newNormal[axis] = Number.isFinite(n) ? n : 0;
    setCustomNormal(newNormal);
    
    // Auto-activate custom if any value is non-zero
    const hasNonZero = newNormal.some(v => v !== 0);
    setIsCustom(hasNonZero);
    
    if (hasNonZero) {
      patchAgentSnap({
        isCustom: true,
        preset: null,
        plane: 'custom',
        normal: [...newNormal],
        offset,
        originOffset: offset,
      });
      onPlaneChange?.({
        normal: newNormal,
        originOffset: offset,
        showPlane: true
      });
    }
  };

const handleButtonClick = () => {
  if (!enabled) {
    // Turn on and expand
    onToggle?.(true);
    requestAnimationFrame(() => {
      handlePresetChange('XY');
      setIsCollapsed(false);
    })    
  } else {
    // Turn off and collapse
    onToggle?.(false);
    setIsCollapsed(true);
  }
};

  const handleChevronClick = () => {
    // The checkmark accepts: the options close and the preview hides.
    // The clip already on screen stays. Opening the options shows it again.
    const opening = isCollapsed;
    setIsCollapsed(!opening);
    onPlaneChange?.({
      previewOnly: true,
      showPlane: opening,
    });
  };

  const readAgentState = useCallback(() => {
    const snap = agentSnapRef.current;
    let liveEnabled = !!enabled;
    if (snap?.enabled != null) liveEnabled = snap.enabled;
    else if (enabledRef?.current != null) liveEnabled = !!enabledRef.current;
    const optionsOpen = snap?.optionsOpen != null
      ? snap.optionsOpen
      : (liveEnabled && !isCollapsed);
    const liveCustom = snap?.isCustom != null ? snap.isCustom : isCustom;
    const livePreset = snap?.preset != null ? snap.preset : planeType;
    const liveNormal = snap?.normal != null
      ? snap.normal
      : (liveCustom ? customNormal : PLANE_PRESETS[livePreset].normal);
    const liveOffset = snap?.offset != null ? snap.offset : offset;
    return {
      enabled: liveEnabled,
      optionsOpen,
      preset: liveCustom ? null : livePreset,
      plane: liveCustom ? 'custom' : livePreset,
      offset: liveOffset,
      originOffset: snap?.originOffset != null ? snap.originOffset : liveOffset,
      normal: [...liveNormal],
      offsetMin: offsetRange.min,
      offsetMax: offsetRange.max,
      offsetCenter: offsetRange.center,
    };
  }, [enabled, enabledRef, isCollapsed, planeType, isCustom, customNormal, offset, offsetRange]);

  const agentSetEnabled = useCallback((target) => {
    patchAgentSnap({ enabled: target, optionsOpen: target ? true : false });
    if (target) {
      onToggle?.(true);
      setIsCollapsed(false);
      handlePresetChange('XY');
      return;
    }
    onToggle?.(false);
    setIsCollapsed(true);
  }, [onToggle, handlePresetChange]);

  const agentSetOptionsOpen = useCallback((open) => {
    const snap = agentSnapRef.current;
    let liveEnabled = !!enabled;
    if (snap?.enabled != null) liveEnabled = snap.enabled;
    else if (enabledRef?.current != null) liveEnabled = !!enabledRef.current;
    if (!liveEnabled) return false;
    patchAgentSnap({ optionsOpen: open });
    const nextCollapsed = !open;
    if (nextCollapsed !== isCollapsed) {
      setIsCollapsed(nextCollapsed);
    }
    onPlaneChange?.({
      previewOnly: true,
      showPlane: !!open,
    });
    return true;
  }, [enabled, enabledRef, isCollapsed, onPlaneChange]);

  const agentSetPreset = useCallback((preset) => {
    if (!PLANE_PRESETS[preset]) return;
    const normal = PLANE_PRESETS[preset].normal;
    const newOffset = offsetRange.center;
    patchAgentSnap({
      preset,
      plane: preset,
      isCustom: false,
      normal: [...normal],
      offset: newOffset,
      originOffset: newOffset,
    });
    handlePresetChange(preset);
  }, [handlePresetChange, offsetRange]);

  const agentSetOffset = useCallback((value) => {
    const clamped = Math.min(offsetRange.max, Math.max(offsetRange.min, value));
    const normal = isCustom ? customNormal : PLANE_PRESETS[planeType].normal;
    patchAgentSnap({ offset: clamped, originOffset: clamped, normal: [...normal] });
    handleOffsetChange(clamped);
  }, [handleOffsetChange, offsetRange, isCustom, customNormal, planeType]);

  const clearAgentSnap = useCallback(() => {
    agentSnapRef.current = null;
  }, []);

  useImperativeHandle(ref, () => ({
    readAgentState,
    agentSetEnabled,
    agentSetOptionsOpen,
    agentSetPreset,
    agentSetOffset,
    clearAgentSnap,
  }), [readAgentState, agentSetEnabled, agentSetOptionsOpen, agentSetPreset, agentSetOffset, clearAgentSnap]);

  if (isCollapsed || !enabled) {
    return (
      <div
        data-rail-pair="right"
        data-rail-height={verticalRail ? RAIL_PAIR_HEIGHT_ATTR : undefined}
        className={`absolute bottom-2.5 right-2.5 bg-white/60 backdrop-blur-sm p-2 rounded-lg shadow-lg z-40 ${
        verticalRail
          // Content height, NOT the paired 26rem: a fixed cap cropped
          // Cross-section off the bottom (bottom-anchored). It grows upward, so
          // its natural height is the correct one.
          ? `flex flex-col gap-1 ${RAIL_NO_CLIP_CLASS} ${RAIL_RIGHT_MAX_CLASS}`
          : 'flex flex-wrap justify-end gap-2 max-w-[calc(100%-1rem)]'
      }`}>
        <ViewSnapControl onSnap={onSnapView} />
        {/* Zoom-to-fit sits directly under view-change (playtest). */}
        <button
          type="button"
          onClick={onZoomToFit}
          className="p-2 rounded text-blue-600 hover:bg-blue-100 active:bg-blue-200"
          title="Zoom to Fit"
          aria-label="Zoom to Fit"
          data-zoom-to-fit=""
          data-ui-action="data-zoom-to-fit"
        >
          <Maximize2 size={20} />
        </button>
        {typeof onNormalToSketch === 'function' && (
          <button
            type="button"
            onClick={onNormalToSketch}
            className="p-2 rounded text-blue-600 hover:bg-blue-100 active:bg-blue-200"
            title="Normal to sketch"
            aria-label="Normal to sketch"
            data-normal-to-sketch=""
            data-ui-action="data-normal-to-sketch"
          >
            {/* lucide-react 0.469 has no RightAngle. CornerDownRight is the right-angle corner. */}
            <CornerDownRight size={20} />
          </button>
        )}

        {/* Pick selectors — icons only; idle matches zoom/ruler (no filled tan/opaque frame) */}
        {typeof onPickModeChange === 'function' && (
          <>
            <div
              className={verticalRail ? 'h-px w-full bg-gray-300/80 my-0.5' : 'w-px self-stretch bg-gray-300/80 mx-0.5'}
              aria-hidden
            />
            <div className={`flex items-center gap-1 ${verticalRail ? 'flex-col' : 'flex-row'}`}>
              <div
                className={`flex gap-1 ${verticalRail ? 'flex-col' : 'flex-row'}`}
                role="group"
                aria-label="Pick mode"
                data-selector-group="pick-mode"
              >
                <button
                  type="button"
                  onClick={() => onPickModeChange('face')}
                  className={`p-2 rounded ${
                    pickMode === 'face'
                      ? 'text-green-600 bg-green-100'
                      : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
                  }`}
                  title="Face pick mode — tap a face for Hole / features"
                  aria-label="Face pick mode"
                  aria-pressed={pickMode === 'face'}
                  data-ui-action="data-pick-mode-face"
                >
                  {/* Skinny rectangle = one flat face. Planes use Layers3, sketches NotebookPen. */}
                  <RectangleHorizontal size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => onPickModeChange('edge')}
                  className={`p-2 rounded ${
                    pickMode === 'edge'
                      ? 'text-green-600 bg-green-100'
                      : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
                  }`}
                  title="Edge pick mode — tap near edges for Fillet/Chamfer"
                  aria-label="Edge pick mode"
                  aria-pressed={pickMode === 'edge'}
                  data-ui-action="data-pick-mode-edge"
                >
                  <Spline size={20} />
                </button>
              </div>
              <div
                className={`flex gap-1 ${verticalRail ? 'flex-col' : 'flex-row'}`}
                role="group"
                aria-label="Plane and contour display"
                data-selector-group="plane-contour"
              >
                <button
                  type="button"
                  onClick={() => onShowPlanesChange?.(!showPlanes)}
                  className={`p-2 rounded ${
                    showPlanes
                      ? 'text-green-600 bg-green-100'
                      : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
                  }`}
                  title={showPlanes
                    ? 'Plane overlays on — tap to hide workplanes'
                    : 'Plane overlays off — tap to show workplanes'}
                  aria-label="Plane display"
                  aria-pressed={!!showPlanes}
                  data-overlay-toggle="plane"
                  data-ui-action="data-overlay-toggle-plane"
                >
                  <Layers3 size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => onShowContoursChange?.(!showContours)}
                  className={`p-2 rounded ${
                    showContours
                      ? 'text-green-600 bg-green-100'
                      : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
                  }`}
                  title={showContours
                    ? 'Sketch overlays on — tap to hide saved contours'
                    : 'Sketch overlays off — tap to show saved contours'}
                  aria-label="Contour display"
                  aria-pressed={!!showContours}
                  data-overlay-toggle="contour"
                  data-ui-action="data-overlay-toggle-contour"
                >
                  <NotebookPen size={20} />
                </button>
                {showPaint && (
                  <button
                    type="button"
                    onClick={() => onPaintToggle?.()}
                    className={`p-2 rounded ${
                      paintActive
                        ? 'text-green-600 bg-green-100'
                        : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
                    }`}
                    title={paintActive ? 'Leave paint mode' : 'Paint faces'}
                    aria-label={paintActive ? 'Leave paint mode' : 'Paint'}
                    aria-pressed={!!paintActive}
                    data-paint-chip=""
                    data-paint-chip-state={paintActive ? 'on' : 'off'}
                    data-ui-action="data-paint-chip"
                  >
                    <Palette size={20} />
                  </button>
                )}
              </div>
            </div>
            <div
              className={verticalRail ? 'h-px w-full bg-gray-300/80 my-0.5' : 'w-px self-stretch bg-gray-300/80 mx-0.5'}
              aria-hidden
            />
          </>
        )}

        <div
          className={`flex gap-1 ${verticalRail ? 'flex-col' : 'flex-row'}`}
          role="group"
          aria-label="Inspection"
          data-selector-group="inspection"
        >
        {showAnalyze && (
          <button
            type="button"
            onClick={() => onAnalyzeToggle?.()}
            className={`p-2 rounded ${
              analyzeActive
                ? 'text-green-600 bg-green-100'
                : 'text-blue-600 hover:bg-gray-100 active:bg-blue-100'
            }`}
            title={analyzeActive ? 'Leave analyze' : 'Analyze'}
            aria-label={analyzeActive ? 'Leave analyze' : 'Analyze'}
            aria-pressed={!!analyzeActive}
            data-analyze-chip=""
            data-analyze-chip-state={analyzeActive ? 'on' : 'off'}
            data-ui-action="data-analyze-chip"
          >
            <Gauge size={20} />
          </button>
        )}
        {showWall && (
          <button
            type="button"
            onClick={() => onWallToggle?.()}
            className={`p-2 rounded font-ui ${
              wallActive
                ? 'surface-success text-on-dark'
                : 'text-on-light'
            }`}
            title={wallActive ? 'Hide wall thickness' : 'Show wall thickness'}
            aria-label={wallActive ? 'Hide wall thickness' : 'Show wall thickness'}
            aria-pressed={!!wallActive}
            data-wall-heatmap=""
            data-wall-heatmap-state={wallActive ? 'on' : 'off'}
            data-ui-action="data-wall-heatmap"
          >
            <AlignHorizontalSpaceAround size={20} />
          </button>
        )}
        <button
          onClick={onAxisHelperToggle}
          className={`p-2 rounded ${axisHelperEnabled ? 'text-green-600 bg-green-100' : 'text-blue-600'} hover:bg-gray-100 active:bg-blue-100`}
          title={axisHelperEnabled ? 'Hide Axis Helper' : 'Show Axis Helper'}
          aria-pressed={!!axisHelperEnabled}
          data-ui-action="data-axis-helper-toggle"
        >
          <Move3d size={20} />
        </button>
        <button
          type="button"
          onClick={onMeasurementToggle}
          className={`p-2 rounded ${measurementEnabled ? 'text-green-600 bg-green-100' : 'text-blue-600'} hover:bg-gray-100 active:bg-blue-100`}
          title={measurementEnabled ? 'Disable Measurement' : 'Enable Measurement'}
          aria-label={measurementEnabled ? 'Disable Measurement' : 'Enable Measurement'}
          aria-pressed={!!measurementEnabled}
          data-measure-toggle=""
          data-measure-toggle-state={measurementEnabled ? 'on' : 'off'}
          data-ui-action="data-measure-toggle"
        >
          <Ruler size={20} />
        </button>
        <button
          onClick={handleButtonClick}
          className={`p-2 rounded ${enabled ? 'text-green-600 bg-green-100' : 'text-blue-600'} hover:bg-gray-100 active:bg-blue-100`}
          title={enabled ? 'Disable Cross Section' : 'Enable Cross Section'}
          aria-pressed={!!enabled}
          data-ui-action="data-cross-section-toggle"
        >
          <FlipHorizontal size={20} />
        </button>
        {/* Opens the cross-section options, so it wears a section cut — two
            arrowheads on a dashed centreline — not a generic chevron. */}
        {enabled && (
          <button
            onClick={handleChevronClick}
            className="p-2 rounded hover:bg-gray-100 text-gray-600"
            title="Cross-section options"
            aria-label="Show cross-section options"
            data-ui-action="data-cross-section-expand"
          >
            <TrianglesCenterlineDashedVertical size={20} />
          </button>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-2.5 right-2.5 bg-white/50 backdrop-blur-sm rounded-lg shadow-lg p-3 z-40 w-72" data-cross-section-popup="">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <ViewSnapControl onSnap={onSnapView} />
        <button
          type="button"
          onClick={onZoomToFit}
          className="p-2 rounded text-blue-600 hover:bg-blue-100"
          title="Zoom to Fit"
          aria-label="Zoom to Fit"
          data-zoom-to-fit=""
          data-ui-action="data-zoom-to-fit"
        >
          <Maximize2 size={20} />
        </button>
        <button
          onClick={onAxisHelperToggle}
          className={`p-2 rounded ${axisHelperEnabled ? 'text-green-600 bg-green-100' : 'text-blue-600'} hover:bg-gray-100`}
          title={axisHelperEnabled ? 'Hide Axis Helper' : 'Show Axis Helper'}
          data-ui-action="data-axis-helper-toggle"
        >
          <Move3d size={20} />
        </button>
        <button
          type="button"
          onClick={onMeasurementToggle}
          className={`p-2 rounded ${measurementEnabled ? 'text-green-600 bg-green-100' : 'text-blue-600'} hover:bg-gray-100`}
          title={measurementEnabled ? 'Disable Measurement' : 'Enable Measurement'}
          aria-label={measurementEnabled ? 'Disable Measurement' : 'Enable Measurement'}
          aria-pressed={!!measurementEnabled}
          data-measure-toggle=""
          data-measure-toggle-state={measurementEnabled ? 'on' : 'off'}
          data-ui-action="data-measure-toggle"
        >
          <Ruler size={20} />
        </button>
        <button
          onClick={handleButtonClick}
          className="p-2 rounded text-gray-700 hover:bg-gray-200 active:bg-gray-300"
          title="Dismiss — turn off cross section"
          aria-label="Dismiss cross section"
          data-cross-section-dismiss=""
          data-ui-action="data-cross-section-toggle"
        >
          <X size={20} />
        </button>
        {/* Closing the options panel is "I'm done here", so: a checkmark. */}
        <button
          onClick={handleChevronClick}
          className="p-2 rounded hover:bg-gray-100 text-green-600"
          title="Done — close cross-section options"
          aria-label="Done, close cross-section options"
          data-ui-action="data-cross-section-expand"
        >
          <Check size={20} />
        </button>
      </div>

      <div className="space-y-3">
        {/* Preset Planes */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Plane
          </label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(PLANE_PRESETS).map(([key]) => (
              <button
                key={key}
                onClick={() => handlePresetChange(key)}
                data-ui-action="data-cross-section-plane"
                className={`px-3 py-2 rounded text-xs font-medium transition-colors ${
                  planeType === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* Position Slider. The box edge is two-thirds of the thumb; the rest continues past it. */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Position: {formatDisplayLength(offset, displayUnit)}
          </label>
          <input
            type="range"
            min={0}
            max={THUMB_COUNT}
            step={1}
            value={Math.round(thumbFromLength(offset - offsetRange.center, { max: offsetRange.reach, signed: true }))}
            onChange={(e) => {
              const delta = lengthFromThumb(e.target.value, {
                max: offsetRange.reach,
                signed: true,
                snap: lengthSnap(displayUnit, Math.abs(offsetRange.reach) * 2),
              });
              handleOffsetChange(offsetRange.center + delta);
            }}
            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
            data-section-offset=""
            data-slider-curve="shaped"
            aria-label="Section position"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatDisplayLength(offsetRange.min, displayUnit)}</span>
            <button
              onClick={() => handleOffsetChange(offsetRange.center)}
              className="text-gray-600 hover:text-gray-900 font-medium"
              data-ui-action="data-section-offset"
            >
              Center
            </button>
            <span>{formatDisplayLength(offsetRange.max, displayUnit)}</span>
          </div>
        </div>

        {/* Rotation */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Rotation
          </label>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              value={formatDisplayNumber(customNormal[0])}
              onChange={(e) => handleCustomNormalChange(0, e.target.value)}
              placeholder="X"
              step="0.1"
              disabled={Math.abs(customNormal[0]) === 1}
              className={`border border-gray-300 rounded px-2 py-1 text-xs ${
                Math.abs(customNormal[0]) === 1
                  ? 'bg-gray-100 text-chrome-secondary cursor-not-allowed'
                  : 'bg-white text-gray-700'
              }`}
            />
            <input
              type="number"
              value={formatDisplayNumber(customNormal[1])}
              onChange={(e) => handleCustomNormalChange(1, e.target.value)}
              placeholder="Y"
              step="0.1"
              disabled={Math.abs(customNormal[1]) === 1}
              className={`border border-gray-300 rounded px-2 py-1 text-xs ${
                Math.abs(customNormal[1]) === 1
                  ? 'bg-gray-100 text-chrome-secondary cursor-not-allowed'
                  : 'bg-white text-gray-700'
              }`}
            />
            <input
              type="number"
              value={formatDisplayNumber(customNormal[2])}
              onChange={(e) => handleCustomNormalChange(2, e.target.value)}
              placeholder="Z"
              step="0.1"
              disabled={Math.abs(customNormal[2]) === 1}
              className={`border border-gray-300 rounded px-2 py-1 text-xs ${
                Math.abs(customNormal[2]) === 1
                  ? 'bg-gray-100 text-chrome-secondary cursor-not-allowed'
                  : 'bg-white text-gray-700'
              }`}
            />
          </div>
        </div>

      </div>
    </div>
  );
});

CrossSectionPanel.displayName = 'CrossSectionPanel';

export default CrossSectionPanel;
