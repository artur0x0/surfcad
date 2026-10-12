/**
 * Analyze session. Owns the open study, writes it through studyScript,
 * and runs feaClient.solve(). The desktop chip and the phone sheet both
 * read the panel this hook returns. This module does not post a Manifold build
 * and does not call preemptInflight.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { paintPickFromClick } from '../utils/facePaint.js';
import { boundingBox, detectFeaProfile, refineMode } from './deviceProfile.js';
import { createFeaClient } from './feaClient.js';
import { feaDebugEnabled, initialFeaProgress, logFeaTiming, reduceFeaProgress } from './feaProgress.js';
import { studyForAssemblySolve, studyForSolve } from './renderFaceIds.js';
import { setProbeOverlay } from './probeOverlay.js';
import { probeQuantityName, probeUnit, readTetProbe } from './probeSample.js';
import { probeShellAt, shellSheetFromScript } from './sheetMidsurface.js';
import { activePlot, initialResultsView, reduceResultsView } from './resultsView.js';
import { bindStressField, bindVectorField, setStressSkinSource } from './stressMap.js';
import { feaTapAction, studyMemberIds } from './feaPickGate.js';
import { composeFeaStudy, FEA_STUDY_BEGIN, readFeaStudy, scriptOutsideFeaStudy } from './studyScript.js';
import {
  applyFacePick,
  customSeed,
  emptyDraft,
  freshStudy,
  libraryOptions,
  majorityFaceId,
  meshArraysFromGeometry,
  solverRequestMaterial,
  studyFaceFromPick,
  studyScopeKind,
  studyWithContactEnabled,
  studyWithContactKind,
  studyWithContactMu,
  studyWithCustomMaterial,
  studyWithForceDirection,
  studyWithLoadVector,
  studyWithMaterialId,
  studyWithRefine,
  studyWithResolvedParts,
  studyWithScope,
  studyWithType,
  studyWithoutFixture,
  studyWithoutLoad,
} from './studyPanel.js';
import { sliderFromLoad, studyForPreview } from './preview/loadDrag.js';
import { createPreviewController } from './preview/previewController.js';
import { previewFits } from './preview/resolution.js';
import { probePreviewGpu, runGpuPreview } from './preview/webgpuPreview.js';

const FACE_ANGLE_DEG = 3;
const PROBE_CAP = 24;

function probeReading(probe, record, quantity, modeIndex) {
  if (!probe || !record) return null;
  const point = record.frame === 'world' ? probe.world : probe.local;
  if (!point) return null;
  if (record.kind === 'shell') return probeShellAt(record, point, probe.normal, quantity, modeIndex);
  return readTetProbe(point, probe.faceId, record, quantity, modeIndex);
}

function commitRunReport(prev, event) {
  const next = reduceFeaProgress(prev, event);
  if (next !== prev && prev.status !== next.status && (next.status === 'done' || next.status === 'stopped')) {
    logFeaTiming(next);
  }
  return next;
}

const EMPTY_PREVIEW = {
  available: false,
  showing: false,
  loadIndex: 0,
  magnitude: 200,
  angle: 0,
  materialIndex: 0,
  ms: null,
  bytes: null,
  resolution: null,
  nx: 0,
  ny: 0,
  nz: 0,
  min: null,
  p95: null,
  max: null,
  fast: false,
};

export function useFeaStudy({
  enabled = true,
  compact: _ = false,
  paintOpen = false,
  getScript,
  script = '',
  onCommit,
  assemblyLocked,
  getSolid,
  getAssembly,
  getPartScript,
  getPartId,
  onHighlight,
  onContactHighlight,
  onClaim,
}) {
  const [open, setOpen] = useState(false);
  const studyRef = useRef(freshStudy(detectFeaProfile()));
  const [study, setStudy] = useState(studyRef.current);
  const [draft, setDraft] = useState(emptyDraft);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runReport, setRunReport] = useState(() => initialFeaProgress());
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(EMPTY_PREVIEW);
  const [plot, setPlotState] = useState('stress');
  const [modeIndex, setModeIndex] = useState(0);
  const [animate, setAnimateState] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [assemblyParts, setAssemblyParts] = useState([]);
  const [view, setView] = useState(initialResultsView);
  const [probes, setProbes] = useState([]);
  const [probeVersion, setProbeVersion] = useState(0);
  const writtenRef = useRef(null);
  const clientRef = useRef(null);
  const runAbortRef = useRef(null);
  const stressFieldRef = useRef(null);
  const contactFieldRef = useRef(null);
  const displacementFieldRef = useRef(null);
  const modeMagnitudesRef = useRef(null);
  const modeVectorsRef = useRef(null);
  const modeGeometryRef = useRef(null);
  const probeMapRef = useRef(new Map());
  const probeSerialRef = useRef(0);
  const viewRef = useRef(view);
  const plotRef = useRef(plot);
  const modeIndexRef = useRef(modeIndex);
  const solvedOutsideRef = useRef(null);
  const markStaleRef = useRef(() => {});
  const draftRef = useRef(draft);
  const openRef = useRef(open);
  const previewRef = useRef(preview);
  const previewDragRef = useRef(false);
  const materialDirtyRef = useRef(false);
  const previewFieldRef = useRef(null);
  const previewNodalRef = useRef(null);
  const previewMeshRef = useRef(null);
  const previewRebindRef = useRef(false);
  const gpuRef = useRef(null);
  const controllerRef = useRef(null);
  const applyPreviewRef = useRef(() => {});
  draftRef.current = draft;
  openRef.current = open;
  previewRef.current = preview;
  viewRef.current = view;
  plotRef.current = plot;
  modeIndexRef.current = modeIndex;
  const getScriptRef = useRef(getScript);
  const onCommitRef = useRef(onCommit);
  const lockedRef = useRef(assemblyLocked);
  const getSolidRef = useRef(getSolid);
  const getAssemblyRef = useRef(getAssembly);
  const getPartScriptRef = useRef(getPartScript);
  const getPartIdRef = useRef(getPartId);
  const analyzedRef = useRef('');
  const [analyzedPartId, setAnalyzedPartId] = useState('');
  const onHighlightRef = useRef(onHighlight);
  const onContactRef = useRef(onContactHighlight);
  const onClaimRef = useRef(onClaim);
  getScriptRef.current = getScript;
  onCommitRef.current = onCommit;
  lockedRef.current = assemblyLocked;
  getSolidRef.current = getSolid;
  getAssemblyRef.current = getAssembly;
  getPartScriptRef.current = getPartScript;
  getPartIdRef.current = getPartId;
  onHighlightRef.current = onHighlight;
  onContactRef.current = onContactHighlight;
  onClaimRef.current = onClaim;

  const scriptOf = (partId) => (
    typeof getPartScriptRef.current === 'function' ? (getPartScriptRef.current(partId) || '') : ''
  );

  const readRows = () => {
    const rows = typeof getAssemblyRef.current === 'function' ? (getAssemblyRef.current() || []) : [];
    setAssemblyParts(rows.map((row) => ({
      id: String(row.id),
      name: row.name || String(row.id),
    })));
    return rows;
  };

  const clearFields = () => {
    stressFieldRef.current = null;
    displacementFieldRef.current = null;
    contactFieldRef.current = null;
    probeMapRef.current = new Map();
  };

  markStaleRef.current = () => {
    clearFields();
    setResult((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev));
  };

  const rebindPreview = useCallback(() => {
    if (previewRebindRef.current) return;
    const nodal = previewNodalRef.current;
    const solid = getSolidRef.current?.();
    const geometry = solid?.geometry;
    if (!nodal || !geometry || geometry === previewFieldRef.current?.geometry) return;
    const positions = geometry.attributes?.position?.array;
    const verts = positions ? positions.length / 3 : 0;
    if (verts && nodal.length !== verts) {
      previewFieldRef.current = null;
      setPreview((prev) => (prev.showing ? { ...prev, showing: false } : prev));
      return;
    }
    const bound = bindStressField(geometry, nodal, solid.faceIDs);
    if (!bound) return;
    const source = {
      geometry,
      field: bound,
      scale: previewFieldRef.current?.scale || { p95: null, yield_MPa: null },
      onStale: () => rebindPreview(),
    };
    previewRebindRef.current = true;
    previewFieldRef.current = source;
    setStressSkinSource(source);
    previewRebindRef.current = false;
  }, []);

  applyPreviewRef.current = (result) => {
    if (!openRef.current || !result?.nodal) return;
    const mesh = previewMeshRef.current;
    const solid = getSolidRef.current?.();
    const geometry = solid?.geometry || mesh?.geometry;
    const faceIDs = solid?.faceIDs || mesh?.faceIDs;
    if (!geometry) return;
    const bound = bindStressField(geometry, result.nodal, faceIDs);
    if (!bound) return;
    previewNodalRef.current = result.nodal;
    const source = {
      geometry,
      field: bound,
      scale: { p95: result.p95, yield_MPa: mesh?.yieldMPa ?? null },
      onStale: () => rebindPreview(),
    };
    previewFieldRef.current = source;
    setStressSkinSource(source);
    setPreview((prev) => ({
      ...prev,
      showing: true,
      ms: result.ms,
      bytes: result.bytes,
      resolution: result.resolution,
      nx: result.nx,
      ny: result.ny,
      nz: result.nz,
      min: result.min,
      p95: result.p95,
      max: result.max,
      fast: result.fast === true,
    }));
  };

  const previewJob = useCallback(() => {
    const solid = getSolidRef.current?.();
    const mesh = meshArraysFromGeometry(solid?.geometry, solid?.faceIDs);
    if (!mesh) return null;
    const state = previewRef.current;
    const options = libraryOptions();
    const currentId = studyRef.current?.material?.id || '';
    const pickedId = state.materialIndex >= 0 ? (options[state.materialIndex]?.id || '') : '';
    const materialId = materialDirtyRef.current ? pickedId : currentId;
    const drafted = studyForPreview(studyRef.current, {
      loadIndex: state.loadIndex,
      magnitude: state.magnitude,
      angle: state.angle,
      materialId,
    });
    if (!drafted) return null;
    const resolved = solverRequestMaterial(drafted);
    if (!resolved.ok) return null;
    previewMeshRef.current = {
      geometry: solid.geometry,
      faceIDs: solid.faceIDs,
      yieldMPa: resolved.material.yield_MPa ?? null,
    };
    return {
      positions: mesh.positions,
      indices: mesh.indices,
      faceIDs: mesh.faceIDs,
      study: drafted,
      material: resolved.material,
      bbox: boundingBox(mesh.positions),
    };
  }, []);

  const replaceStudy = useCallback((next) => {
    studyRef.current = next;
    setStudy(next);
    // Material, fixture, and load edits all come through here. The last
    // colours belong to the previous study, so they come off.
    clearFields();
    setResult((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev));
  }, []);

  // The viewport reconciles overlay meshes to this study. Passing the
  // selection (not a flat triangle list) is what lets a cleared face drop
  // its own overlay instead of stacking another transparent copy.
  const noteAnalyzedPart = () => {
    const raw = typeof getPartIdRef.current === 'function' ? getPartIdRef.current() : '';
    const id = raw != null && raw !== '' ? String(raw) : '';
    analyzedRef.current = id;
    setAnalyzedPartId(id);
    return id;
  };

  const highlightContext = () => {
    const rows = typeof getAssemblyRef.current === 'function' ? (getAssemblyRef.current() || []) : [];
    const analyzed = analyzedRef.current;
    return {
      analyzedPartId: analyzed,
      memberIds: studyMemberIds(studyRef.current, rows, analyzed),
      screen: viewRef.current?.screen || 'setup',
    };
  };

  const paintHighlight = useCallback((next) => {
    onHighlightRef.current?.(next ?? null, highlightContext());
  }, []);

  const commitStudy = useCallback((next) => {
    replaceStudy(next);
    paintHighlight(next);
    const base = typeof getScriptRef.current === 'function' ? (getScriptRef.current() || '') : '';
    let composed;
    try {
      composed = composeFeaStudy(base, next);
    } catch (err) {
      setNotice(err?.message || 'Could not write the study');
      return false;
    }
    if (composed === base) return true;
    if (lockedRef.current?.()) {
      setNotice('An assembly is opening — save the study again once it finishes.');
      return false;
    }
    writtenRef.current = composed;
    const wrote = onCommitRef.current?.(composed);
    if (wrote === false) {
      writtenRef.current = null;
      setNotice('Could not write the study into the part script.');
      return false;
    }
    setNotice('');
    return true;
  }, [paintHighlight, replaceStudy]);

  const close = useCallback(() => {
    previewDragRef.current = false;
    controllerRef.current?.cancel();
    previewFieldRef.current = null;
    previewNodalRef.current = null;
    setPreview((prev) => ({ ...prev, showing: false }));
    setOpen(false);
    onHighlightRef.current?.([]);
  }, []);

  const openPanel = useCallback(() => {
    if (!enabled) return;
    onClaimRef.current?.();
    const text = typeof getScriptRef.current === 'function' ? (getScriptRef.current() || '') : '';
    const stored = readFeaStudy(text);
    let read = stored || freshStudy(detectFeaProfile());
    let refreshedStudy = false;
    const rows = readRows();
    if (stored && studyScopeKind(read) !== 'part' && rows.length > 1) {
      const refreshed = studyWithScope(read, read.scope, rows, scriptOf);
      if (refreshed.ok && JSON.stringify(refreshed.study) !== JSON.stringify(stored)) {
        read = refreshed.study;
        refreshedStudy = true;
      }
    }
    writtenRef.current = text.includes('// @fea-study ') ? text : null;
    noteAnalyzedPart();
    studyRef.current = read;
    setStudy(read);
    setDraft((prev) => ({
      ...emptyDraft(),
      target: prev.target,
      magnitudeN: prev.magnitudeN,
      direction: prev.direction,
      pressureMPa: prev.pressureMPa,
      customMode: !read.material?.id,
      custom: customSeed(read),
    }));
    clearFields();
    previewFieldRef.current = null;
    previewNodalRef.current = null;
    previewDragRef.current = false;
    solvedOutsideRef.current = null;
    setPlotState('stress');
    setDismissed(false);
    setView(initialResultsView());
    setResult(null);
    setRunReport(initialFeaProgress());
    setPreview((prev) => ({ ...EMPTY_PREVIEW, available: prev.available }));
    setNotice('');
    setOpen(true);
    paintHighlight(read);
    if (refreshedStudy) commitStudy(read);
  }, [commitStudy, enabled, paintHighlight]);

  const toggle = useCallback(() => {
    if (open) close();
    else openPanel();
  }, [close, open, openPanel]);

  useEffect(() => {
    if (!enabled && open) close();
  }, [close, enabled, open]);

  useEffect(() => {
    if (paintOpen && open) close();
  }, [close, open, paintOpen]);

  useEffect(() => {
    if (!open) return;
    const text = typeof script === 'string' ? script : '';
    if (writtenRef.current != null && text === writtenRef.current) return;
    const live = typeof getScriptRef.current === 'function' ? (getScriptRef.current() || '') : text;
    if (writtenRef.current != null && live === writtenRef.current) return;
    const outside = scriptOutsideFeaStudy(live);
    if (solvedOutsideRef.current != null && outside !== solvedOutsideRef.current) {
      solvedOutsideRef.current = outside;
      clearFields();
      setResult((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev));
    }
    const read = readFeaStudy(live);
    if (!read) {
      // A missing block means this part has no study. An invalid block is
      // left alone so a mid-edit parse failure does not wipe the panel.
      if (!live.includes(FEA_STUDY_BEGIN)) {
        noteAnalyzedPart();
        const fresh = freshStudy(detectFeaProfile());
        studyRef.current = fresh;
        setStudy(fresh);
        writtenRef.current = null;
        clearFields();
        setResult(null);
        paintHighlight(null);
      }
      return;
    }
    const prevAnalyzed = analyzedRef.current;
    noteAnalyzedPart();
    if (prevAnalyzed && analyzedRef.current !== prevAnalyzed) {
      clearFields();
      setResult(null);
    }
    readRows();
    writtenRef.current = live;
    studyRef.current = read;
    setStudy(read);
    paintHighlight(read);
  }, [open, paintHighlight, script]);

  const setMaterialId = useCallback((id) => {
    const next = studyWithMaterialId(studyRef.current, id);
    if (!next.ok) {
      setNotice(next.errors[0] || 'Unknown material');
      return;
    }
    setDraft((prev) => ({ ...prev, customMode: false }));
    const rows = readRows();
    const resolved = studyScopeKind(next.study) === 'part'
      ? next
      : studyWithResolvedParts(next.study, rows, scriptOf);
    commitStudy(resolved.ok ? resolved.study : next.study);
  }, [commitStudy]);

  const setCustomMode = useCallback((on) => {
    setDraft((prev) => ({
      ...prev,
      customMode: !!on,
      custom: on ? customSeed(studyRef.current) : prev.custom,
    }));
    if (!on && studyRef.current.material && !studyRef.current.material.id) {
      const next = studyWithMaterialId(studyRef.current, 'al-6061-t6');
      if (next.ok) commitStudy(next.study);
    }
  }, [commitStudy]);

  const setCustomField = useCallback((field, value) => {
    const custom = { ...draftRef.current.custom, [field]: value };
    setDraft((prev) => ({ ...prev, customMode: true, custom }));
    let next = studyWithCustomMaterial(studyRef.current, custom);
    if (next.ok && studyScopeKind(next.study) !== 'part') {
      next = studyWithResolvedParts(next.study, readRows(), scriptOf);
    }
    if (next.ok) commitStudy(next.study);
    else setNotice(next.errors[0] || 'Enter E, ν, and yield');
  }, [commitStudy]);

  const setTarget = useCallback((target) => {
    setDraft((prev) => ({ ...prev, target }));
  }, []);

  const setRefine = useCallback((refine) => {
    const next = studyWithRefine(studyRef.current, refine);
    if (next.ok) commitStudy(next.study);
    else setNotice(next.errors[0] || 'Could not set refine');
  }, [commitStudy]);

  const setMagnitude = useCallback((magnitudeN) => {
    setDraft((prev) => ({ ...prev, magnitudeN: Number(magnitudeN) }));
  }, []);

  const setDirection = useCallback((direction) => {
    setDraft((prev) => ({ ...prev, direction }));
    const next = studyWithForceDirection(studyRef.current, direction);
    if (next.ok && next.changed) commitStudy(next.study);
    else if (!next.ok) setNotice(next.errors[0] || 'Could not set the load direction');
  }, [commitStudy]);

  const setPressure = useCallback((pressureMPa) => {
    setDraft((prev) => ({ ...prev, pressureMPa: Number(pressureMPa) }));
  }, []);

  const removeFixture = useCallback((index) => {
    const next = studyWithoutFixture(studyRef.current, index);
    if (next.ok) commitStudy(next.study);
  }, [commitStudy]);

  const removeLoad = useCallback((index) => {
    const next = studyWithoutLoad(studyRef.current, index);
    if (next.ok) commitStudy(next.study);
  }, [commitStudy]);

  const setStudyScope = useCallback((scope) => {
    const next = studyWithScope(studyRef.current, scope, readRows(), scriptOf);
    if (!next.ok) {
      setNotice(next.errors[0] || 'Could not change the study scope');
      return;
    }
    commitStudy(next.study);
  }, [commitStudy]);

  const toggleScopePart = useCallback((partId) => {
    const rows = readRows();
    const id = String(partId);
    const ids = rows.map((row) => String(row.id));
    const kind = studyScopeKind(studyRef.current);
    const current = kind === 'parts'
      ? (studyRef.current.scope?.ids || []).map(String)
      : (kind === 'assembly' ? ids : []);
    const nextIds = current.includes(id)
      ? current.filter((row) => row !== id)
      : current.concat(id).filter((row) => ids.includes(row));
    const unique = ids.filter((row) => nextIds.includes(row));
    const scope = unique.length >= 2 && unique.length === ids.length
      ? { kind: 'assembly' }
      : (unique.length >= 2 ? { kind: 'parts', ids: unique } : { kind: 'part' });
    const next = studyWithScope(studyRef.current, scope, rows, scriptOf);
    if (next.ok) commitStudy(next.study);
    else setNotice(next.errors[0] || 'Could not change the parts in this study');
  }, [commitStudy]);

  const setContactEnabled = useCallback((index, enabled) => {
    const next = studyWithContactEnabled(studyRef.current, index, enabled);
    if (next.ok) commitStudy(next.study);
    else setNotice(next.errors[0] || 'Could not change that contact');
  }, [commitStudy]);

  const setContactKind = useCallback((index, kind) => {
    const next = studyWithContactKind(studyRef.current, index, kind);
    if (next.ok) commitStudy(next.study);
    else setNotice(next.errors[0] || 'Could not change that contact');
  }, [commitStudy]);

  const setContactMu = useCallback((index, mu) => {
    const next = studyWithContactMu(studyRef.current, index, mu);
    if (next.ok) commitStudy(next.study);
    else setNotice(next.errors[0] || 'Could not change that friction coefficient');
  }, [commitStudy]);

  const probeAt = useCallback((clickData) => {
    if (clickData?.removeProbeId != null) {
      setProbes((prev) => prev.filter((probe) => probe.id !== clickData.removeProbeId));
      return true;
    }
    const geometry = clickData?.geometry;
    const record = probeMapRef.current.get(geometry);
    const local = clickData?.localPoint;
    if (!record || !local || local.length < 3) return false;
    const world = clickData.hitPoint;
    const draft = {
      geometry,
      faceId: Number(clickData.faceId),
      local: [Number(local[0]), Number(local[1]), Number(local[2])],
      world: world && world.length >= 3
        ? [Number(world[0]), Number(world[1]), Number(world[2])]
        : [Number(local[0]), Number(local[1]), Number(local[2])],
      normal: clickData.faceNormal || null,
    };
    const quantity = probeQuantityName(viewRef.current?.kind, plotRef.current);
    const reading = probeReading(draft, record, quantity, modeIndexRef.current);
    if (!reading || !Number.isFinite(reading.value)) return false;
    setProbes((prev) => {
      if (prev.length >= PROBE_CAP) return prev;
      const id = probeSerialRef.current + 1;
      probeSerialRef.current = id;
      return prev.concat({ ...draft, id });
    });
    return true;
  }, []);

  const tapAction = useCallback((hitPartId) => {
    const rows = typeof getAssemblyRef.current === 'function' ? (getAssemblyRef.current() || []) : [];
    return feaTapAction({
      screen: viewRef.current?.screen,
      scopeKind: studyScopeKind(studyRef.current),
      memberIds: studyMemberIds(studyRef.current, rows, analyzedRef.current),
      hitPartId,
    });
  }, []);

  const pick = useCallback((clickData) => {
    try {
      if (!studyRef.current) return false;
      if (clickData?.addPartId) {
        const rows = typeof getAssemblyRef.current === 'function' ? (getAssemblyRef.current() || []) : [];
        const id = String(clickData.addPartId);
        if (!rows.some((row) => String(row?.id) === id)) return false;
        const action = feaTapAction({
          screen: viewRef.current?.screen,
          scopeKind: studyScopeKind(studyRef.current),
          memberIds: studyMemberIds(studyRef.current, rows, analyzedRef.current),
          hitPartId: id,
        });
        if (action !== 'add-part') return false;
        toggleScopePart(id);
        return true;
      }
      const screenNow = viewRef.current?.screen;
      if (screenNow && screenNow !== 'setup') {
        if (screenNow === 'results') {
          const rows = typeof getAssemblyRef.current === 'function' ? (getAssemblyRef.current() || []) : [];
          const members = studyMemberIds(studyRef.current, rows, analyzedRef.current);
          const hit = clickData?.partId;
          if (hit != null && hit !== '' && !members.includes(String(hit))) return false;
          return probeAt(clickData);
        }
        return false;
      }
      const solid = getSolidRef.current?.();
      let geometry = clickData?.geometry || solid?.geometry;
      let faceIDs = solid?.faceIDs;
      if (clickData?.geometry && solid?.geometry && clickData.geometry !== solid.geometry) {
        geometry = clickData.geometry;
        const attr = geometry.attributes?.faceID;
        const mapped = attr?.array?.length ? attr.array : null;
        if (!mapped) return false;
        faceIDs = mapped;
      }
      const picked = paintPickFromClick({
        geometry,
        faceIDs,
        seedFaceIndex: clickData?.seedFaceIndex,
        faceNormal: clickData?.faceNormal,
        angleTolerance: FACE_ANGLE_DEG,
      });
      if (!picked?.key) return false;
      const face = studyFaceFromPick(picked, majorityFaceId(picked.indices, faceIDs));
      if (!face) return false;
      if (studyScopeKind(studyRef.current) !== 'part' && clickData?.partId) {
        face.part = String(clickData.partId);
      }
      const next = applyFacePick(studyRef.current, draftRef.current, face);
      if (!next.ok) {
        setNotice(next.errors[0] || 'Could not use that face');
        return false;
      }
      commitStudy(next.study);
      return true;
    } catch (err) {
      console.error('[FEA] ignored a bad pick', err);
      return false;
    }
  }, [commitStudy, probeAt, toggleScopePart]);

  const pickIfOpen = useCallback((clickData) => {
    if (!openRef.current) return false;
    return pick(clickData);
  }, [pick]);

  const run = useCallback(async () => {
    previewDragRef.current = false;
    controllerRef.current?.cancel();
    previewFieldRef.current = null;
    previewNodalRef.current = null;
    setPreview((prev) => (prev.showing ? { ...prev, showing: false } : prev));
    if (lockedRef.current?.()) {
      setNotice('An assembly is opening — run the study again once it finishes.');
      return;
    }
    const resolved = solverRequestMaterial(studyRef.current);
    if (!resolved.ok) {
      setNotice(resolved.errors[0] || 'Pick a material');
      return;
    }
    const solid = getSolidRef.current?.();
    const geometry = solid?.geometry || null;
    const mesh = meshArraysFromGeometry(geometry, solid?.faceIDs);
    const rows = readRows();
    const kind = studyScopeKind(studyRef.current);
    const selected = kind === 'parts'
      ? rows.filter((row) => (studyRef.current.scope?.ids || []).map(String).includes(String(row.id)))
      : (kind === 'assembly' ? rows : []);
    const assemblyRun = kind !== 'part' && selected.length > 0;
    const assemblyPartsForSolve = assemblyRun
      ? selected.map((row) => {
        const copied = meshArraysFromGeometry(row.geometry, row.faceIDs);
        if (!copied) return null;
        return {
          id: String(row.id),
          name: row.name || String(row.id),
          matrix: row.matrix || null,
          position: row.position || null,
          quaternion: row.quaternion || null,
          scale: row.scale || null,
          translation: row.translation || null,
          geometry: row.geometry,
          faceIDs: copied.faceIDs,
          positions: copied.positions,
          indices: copied.indices,
        };
      }).filter(Boolean)
      : [];
    setDismissed(false);
    if (!mesh && !assemblyPartsForSolve.length) {
      clearFields();
      setResult({
        source: 'tet10',
        min: null,
        p95: null,
        max: null,
        safetyFactor: null,
        warnings: [{ code: 'empty-mesh', msg: 'The part has no triangles to mesh.' }],
        yield_MPa: resolved.material.yield_MPa ?? null,
        stale: false,
      });
      setNotice('');
      return;
    }
    const profile = detectFeaProfile();
    const controller = new AbortController();
    runAbortRef.current = controller;
    const startedAt = Date.now();
    setRunReport(reduceFeaProgress(
      reduceFeaProgress(initialFeaProgress(startedAt), { type: 'start', now: startedAt }),
      { type: 'stage', stage: 'loading-mesher', now: startedAt },
    ));
    setRunning(true);
    setView((prev) => reduceResultsView(prev, {
      type: 'run',
      kind: studyRef.current?.type === 'modal' ? 'modal' : 'static',
    }));
    setNotice('');
    try {
      if (!clientRef.current) clientRef.current = await createFeaClient({ profile });
      if (controller.signal.aborted) {
        const abort = new Error('FEA solve cancelled');
        abort.name = 'AbortError';
        throw abort;
      }
      const liveForShell = typeof getScriptRef.current === 'function' ? (getScriptRef.current() || '') : '';
      const solved = await clientRef.current.solve(assemblyPartsForSolve.length ? {
        study: studyForAssemblySolve(studyRef.current, assemblyPartsForSolve, assemblyPartsForSolve[0]),
        parts: assemblyPartsForSolve.map((part) => ({
          id: part.id,
          name: part.name,
          matrix: part.matrix,
          position: part.position,
          quaternion: part.quaternion,
          scale: part.scale,
          translation: part.translation,
          positions: part.positions,
          indices: part.indices,
          faceIDs: part.faceIDs,
        })),
        material: resolved.material,
        profile,
      } : {
        study: studyForSolve(studyRef.current, geometry, solid?.faceIDs),
        mesh,
        material: resolved.material,
        profile,
        sheetSpec: shellSheetFromScript(liveForShell),
      }, {
        signal: controller.signal,
        onProgress: (event) => {
          setRunReport((prev) => commitRunReport(prev, event));
        },
      });
      const nodal = solved?.nodal instanceof Float32Array ? solved.nodal : null;
      const magnitude = solved?.displacement instanceof Float32Array ? solved.displacement : null;
      const modal = solved?.source === 'modal';
      modeMagnitudesRef.current = modal && solved.modeMagnitudes instanceof Float32Array ? solved.modeMagnitudes : null;
      modeVectorsRef.current = modal && solved.modeVectors instanceof Float32Array ? solved.modeVectors : null;
      modeGeometryRef.current = modal ? { geometry, faceIDs: solid?.faceIDs, count: magnitude?.length || 0 } : null;
      const nowRows = typeof getAssemblyRef.current === 'function' ? (getAssemblyRef.current() || []) : [];
      const now = getSolidRef.current?.()?.geometry;
      const moved = assemblyPartsForSolve.length
        ? assemblyPartsForSolve.some((part) => {
          const live = nowRows.find((row) => String(row.id) === part.id);
          return !live || live.geometry !== part.geometry;
        })
        : (!geometry || now !== geometry);
      const onStale = () => markStaleRef.current();
      const govStat = (solved.partStats || []).find((part) => part.id === solved.governingPart);
      const scaleYield = govStat && govStat.yield_MPa != null ? govStat.yield_MPa : (resolved.material.yield_MPa ?? null);
      let bound = !moved && nodal ? bindStressField(geometry, nodal, solid?.faceIDs) : null;
      let dispBound = !moved && magnitude ? bindStressField(geometry, magnitude, solid?.faceIDs) : null;
      let stressParts = [];
      let dispParts = [];
      let stressGeometry = geometry;
      if (assemblyPartsForSolve.length && !moved) {
        const stressFields = [];
        const dispFields = [];
        for (const part of solved.parts || []) {
          const row = assemblyPartsForSolve.find((item) => item.id === part.id);
          if (!row) continue;
          const partNodal = part.nodal instanceof Float32Array ? part.nodal : null;
          const partDisp = part.displacement instanceof Float32Array ? part.displacement : null;
          const partBound = partNodal ? bindStressField(row.geometry, partNodal, row.faceIDs) : null;
          const partDispBound = partDisp ? bindStressField(row.geometry, partDisp, row.faceIDs) : null;
          if (partBound) stressFields.push({ geometry: row.geometry, field: partBound });
          if (partDispBound) dispFields.push({ geometry: row.geometry, field: partDispBound });
        }
        const primary = stressFields.find((part) => part.geometry === now)
          || stressFields.find((part) => part.geometry === geometry)
          || stressFields[0];
        const primaryDisp = dispFields.find((part) => part.geometry === now)
          || dispFields.find((part) => part.geometry === geometry)
          || dispFields[0];
        bound = primary ? primary.field : null;
        dispBound = primaryDisp ? primaryDisp.field : null;
        stressGeometry = primary ? primary.geometry : geometry;
        stressParts = primary ? stressFields.filter((part) => part.geometry !== primary.geometry) : [];
        dispParts = primaryDisp ? dispFields.filter((part) => part.geometry !== primaryDisp.geometry) : [];
      }
      let contactBound = null;
      let contactParts = [];
      let contactGeometry = stressGeometry;
      if (assemblyPartsForSolve.length && !moved && solved.contactActive === true) {
        const contactFields = [];
        for (const part of solved.parts || []) {
          const row = assemblyPartsForSolve.find((item) => item.id === part.id);
          if (!row) continue;
          const partContact = part.contact instanceof Float32Array ? part.contact : null;
          const partBound = partContact ? bindStressField(row.geometry, partContact, row.faceIDs) : null;
          if (partBound) contactFields.push({ geometry: row.geometry, field: partBound });
        }
        const primaryContact = contactFields.find((part) => part.geometry === now)
          || contactFields.find((part) => part.geometry === geometry)
          || contactFields[0];
        contactBound = primaryContact ? primaryContact.field : null;
        contactGeometry = primaryContact ? primaryContact.geometry : stressGeometry;
        contactParts = primaryContact
          ? contactFields.filter((part) => part.geometry !== primaryContact.geometry)
          : [];
      }
      const pressureMax = Number(solved.contactPressureMax);
      contactFieldRef.current = contactBound ? {
        geometry: contactGeometry,
        field: contactBound,
        ramp: 'displacement',
        scale: { min: 0, max: Number.isFinite(pressureMax) ? Math.max(pressureMax, 0) : 0 },
        contactOverlay: true,
        parts: contactParts,
        onStale,
      } : null;
      const probeMap = new Map();
      if (assemblyPartsForSolve.length) {
        for (const part of solved.parts || []) {
          const row = assemblyPartsForSolve.find((item) => item.id === part.id);
          if (row?.geometry && part.probe) probeMap.set(row.geometry, part.probe);
        }
      } else if (geometry && solved.probe) {
        probeMap.set(geometry, solved.probe);
      }
      probeMapRef.current = probeMap;
      setProbeVersion((version) => version + 1);
      const liveScript = typeof getScriptRef.current === 'function' ? (getScriptRef.current() || '') : '';
      solvedOutsideRef.current = scriptOutsideFeaStudy(liveScript);
      stressFieldRef.current = bound ? {
        geometry: stressGeometry,
        field: bound,
        scale: { p95: solved.p95, yield_MPa: scaleYield },
        parts: stressParts,
        onStale,
      } : null;
      const vectorCount = (magnitude?.length || 0) * 3;
      const vectorBound = modal && modeVectorsRef.current && vectorCount
        ? bindVectorField(geometry, modeVectorsRef.current.subarray(0, vectorCount), solid?.faceIDs)
        : null;
      displacementFieldRef.current = dispBound ? {
        geometry: stressGeometry,
        field: dispBound,
        ramp: 'displacement',
        scale: { min: solved.displacementMin, max: solved.displacementMax },
        vectors: vectorBound,
        animate: false,
        parts: dispParts,
        onStale,
      } : null;
      setAnimateState(false);
      setModeIndex(0);
      setPlotState(modal ? 'displacement' : 'stress');
      setDismissed(false);
      setResult({
        source: solved.source,
        field: solved.field,
        units: solved.units,
        min: solved.min,
        p95: solved.p95,
        max: solved.max,
        displacementMin: solved.displacementMin ?? null,
        displacementMax: solved.displacementMax ?? null,
        frequenciesHz: Array.isArray(solved.frequenciesHz) ? solved.frequenciesHz : null,
        effectiveMass: Array.isArray(solved.effectiveMass) ? solved.effectiveMass : null,
        modeIndex: 0,
        safetyFactor: solved.safetyFactor != null ? solved.safetyFactor : (solved.fos ?? null),
        warnings: Array.isArray(solved.warnings) ? solved.warnings : [],
        yield_MPa: scaleYield,
        governingPart: solved.governingPart || null,
        governingName: solved.governingName || null,
        contactActive: solved.contactActive === true,
        contactOpen: solved.contactOpen ?? 0,
        contactStick: solved.contactStick ?? 0,
        contactSlip: solved.contactSlip ?? 0,
        contactPressureMin: solved.contactPressureMin ?? null,
        contactPressureMax: solved.contactPressureMax ?? null,
        partStats: solved.partStats || null,
        stale: moved || !bound,
        stats: solved.stats || null,
        solver: solved.solver || null,
      });
      setRunReport((prev) => commitRunReport(prev, {
        type: 'finish',
        now: Date.now(),
        dofs: solved?.stats?.dofs ?? null,
        stageTimings: solved?.stageTimings || null,
        meshReused: solved?.meshReused === true,
        source: solved?.source || '',
        refineCount: solved?.refineCount || 0,
        converged: solved?.converged === true,
        refineNote: solved?.refineNote || '',
        showPeakMemory: feaDebugEnabled(),
        peakMemoryBytes: solved?.stats?.peakMemoryBytes,
      }));
      setView((prev) => reduceResultsView(prev, {
        type: 'finish',
        source: solved?.source || '',
        stale: moved || !bound,
      }));
    } catch (err) {
      if (err?.outcome === 'worker-died') {
        const dead = clientRef.current;
        clientRef.current = null;
        try { dead?.dispose?.(); } catch { /* worker already gone */ }
      }
      const outcome = err?.name === 'AbortError'
        ? 'cancelled'
        : (err?.outcome === 'worker-died' ? 'worker-died' : 'error');
      const error = outcome === 'cancelled' ? 'cancelled' : (err?.message || 'The study did not run');
      setRunReport((prev) => commitRunReport(prev, {
        type: 'stop',
        now: Date.now(),
        outcome,
        error,
      }));
      setView((prev) => reduceResultsView(prev, { type: 'stop', outcome }));
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => {
    runAbortRef.current?.abort();
    clientRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (runReport.status !== 'running') return undefined;
    const id = setInterval(() => {
      setRunReport((prev) => reduceFeaProgress(prev, { type: 'tick', now: Date.now() }));
    }, 200);
    return () => clearInterval(id);
  }, [runReport.status]);

  const setPlot = useCallback((next) => {
    setPlotState(activePlot(next));
  }, []);

  const setStudyType = useCallback((type) => {
    const next = studyWithType(studyRef.current, type);
    if (!next.ok) {
      setNotice(next.errors[0] || 'Unknown study type');
      return;
    }
    commitStudy(next.study);
  }, [commitStudy]);

  const setAnimate = useCallback((on) => {
    setAnimateState(on === true);
  }, []);

  const setMode = useCallback((index) => {
    const packed = modeMagnitudesRef.current;
    const vectors = modeVectorsRef.current;
    const live = modeGeometryRef.current;
    const count = live?.count || 0;
    if (!packed || !vectors || !live?.geometry || !(count > 0)) return;
    const last = Math.max(0, Math.floor(packed.length / count) - 1);
    const mode = Math.max(0, Math.min(last, index | 0));
    const mag = new Float32Array(packed.subarray(mode * count, (mode + 1) * count));
    const vec = new Float32Array(vectors.subarray(mode * count * 3, (mode + 1) * count * 3));
    const bound = bindStressField(live.geometry, mag, live.faceIDs);
    if (!bound) return;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < mag.length; i += 1) {
      const value = mag[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 0;
    displacementFieldRef.current = {
      geometry: live.geometry,
      field: bound,
      ramp: 'displacement',
      scale: { min, max },
      vectors: bindVectorField(live.geometry, vec, live.faceIDs),
      animate: false,
      onStale: () => markStaleRef.current(),
    };
    setModeIndex(mode);
    setResult((prev) => (prev ? {
      ...prev,
      displacementMin: min,
      displacementMax: max,
      modeIndex: mode,
    } : prev));
  }, []);

  const backToSetup = useCallback(() => {
    setPlotState('stress');
    setDismissed(true);
    setProbes([]);
    setView((prev) => reduceResultsView(prev, { type: 'back' }));
    paintHighlight(studyRef.current);
  }, [paintHighlight]);

  const removeProbe = useCallback((id) => {
    setProbes((prev) => prev.filter((probe) => probe.id !== id));
  }, []);

  const clearProbes = useCallback(() => {
    setProbes([]);
  }, []);

  useEffect(() => {
    if (!result?.stale) return;
    setView((prev) => reduceResultsView(prev, { type: 'stale' }));
  }, [result]);

  const screen = view.screen;
  const results = screen !== 'setup';

  // Arrows are part of the highlight reconcile. Leaving setup drops them;
  // coming back builds them again from the stored direction.
  useEffect(() => {
    if (!open) return;
    paintHighlight(studyRef.current);
  }, [open, screen, paintHighlight]);

  useEffect(() => {
    if (screen === 'results') return;
    setProbes([]);
  }, [screen]);

  useEffect(() => {
    if (!open || screen !== 'results') {
      setProbeOverlay([]);
      return;
    }
    setProbeOverlay(probes.map((probe, index) => ({
      id: probe.id,
      number: index + 1,
      position: probe.world,
    })));
  }, [open, screen, probes]);

  const probeRows = useMemo(() => {
    const quantity = probeQuantityName(view.kind, activePlot(plot));
    const records = probeVersion >= 0 ? probeMapRef.current : null;
    return probes.map((probe) => {
      const record = records?.get(probe.geometry) || null;
      const reading = probeReading(probe, record, quantity, modeIndex);
      return {
        id: probe.id,
        quantity,
        unit: probeUnit(quantity),
        x: probe.local[0],
        y: probe.local[1],
        z: probe.local[2],
        value: reading && Number.isFinite(reading.value) ? reading.value : NaN,
        weights: reading?.weights || null,
        nodal: reading?.nodal || null,
        mix: reading?.mix || '',
      };
    });
  }, [probes, plot, modeIndex, view.kind, probeVersion]);

  useEffect(() => {
    if (!open) {
      onContactRef.current?.([]);
      return;
    }
    const multi = studyScopeKind(study) !== 'part';
    const pairs = multi ? (study?.contacts || []).filter((contact) => contact.enabled !== false) : [];
    onContactRef.current?.(pairs);
  }, [open, study]);

  useEffect(() => {
    if (!open) {
      setStressSkinSource(null);
      return;
    }
    if (preview.showing && previewFieldRef.current) {
      setStressSkinSource(previewFieldRef.current);
      return;
    }
    if (screen !== 'results') {
      setStressSkinSource(null);
      return;
    }
    const modalResult = result?.source === 'modal';
    const shown = activePlot(plot);
    const src = modalResult || shown === 'displacement'
      ? displacementFieldRef.current
      : shown === 'contact'
        ? contactFieldRef.current
        : stressFieldRef.current;
    setStressSkinSource(src ? { ...src, animate: modalResult && animate } : null);
  }, [open, screen, plot, result, preview.showing, preview.ms, animate, modeIndex]);

  useEffect(() => {
    controllerRef.current = createPreviewController({
      profile: () => detectFeaProfile(),
      fits: (job) => {
        const limits = gpuRef.current?.limits;
        const box = job?.bbox;
        if (!limits || !box) return false;
        return previewFits(box.dx, box.dy, box.dz, 128, limits);
      },
      solve: (job) => runGpuPreview(gpuRef.current, {
        ...job,
        tol: job.phase === 'drag' ? 1e-3 : 1e-4,
        maxIter: job.phase === 'drag' ? 16 : 24,
      }),
      onResult: (solved) => applyPreviewRef.current(solved),
      onError: (err) => setNotice(err?.message || 'Preview failed'),
    });
    return () => controllerRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    probePreviewGpu().then((hit) => {
      if (dead) return;
      gpuRef.current = hit?.ok ? hit : null;
      setPreview((prev) => ({ ...prev, available: !!hit?.ok }));
    });
    return () => {
      dead = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || previewDragRef.current) return;
    const ids = libraryOptions().map((option) => option.id);
    const slider = sliderFromLoad(study, previewRef.current.loadIndex, ids);
    setPreview((prev) => {
      if (
        prev.loadIndex === slider.loadIndex
        && prev.magnitude === slider.magnitude
        && prev.angle === slider.angle
        && prev.materialIndex === slider.materialIndex
      ) return prev;
      return { ...prev, ...slider };
    });
  }, [open, study]);

  const previewBegin = useCallback(() => {
    previewDragRef.current = true;
  }, []);

  const previewInput = useCallback((patch) => {
    if (!gpuRef.current?.ok) return;
    previewDragRef.current = true;
    if (Object.prototype.hasOwnProperty.call(patch, 'materialIndex')) materialDirtyRef.current = true;
    previewRef.current = { ...previewRef.current, ...patch };
    setPreview((prev) => ({ ...prev, ...patch }));
    const job = previewJob();
    if (!job) return;
    controllerRef.current?.push(job);
  }, [previewJob]);

  const previewCommit = useCallback(() => {
    previewDragRef.current = false;
    const state = previewRef.current;
    const options = libraryOptions();
    const materialId = options[state.materialIndex]?.id || '';
    const drafted = studyForPreview(studyRef.current, {
      loadIndex: state.loadIndex,
      magnitude: state.magnitude,
      angle: state.angle,
      materialId,
    });
    if (drafted) {
      let next = studyWithLoadVector(
        studyRef.current,
        state.loadIndex,
        drafted.loads[state.loadIndex].vector,
      );
      if (next.ok && materialDirtyRef.current && materialId) {
        next = studyWithMaterialId(next.study, materialId);
      }
      materialDirtyRef.current = false;
      if (next.ok) commitStudy(next.study);
    }
    const job = previewJob();
    if (job && gpuRef.current?.ok) controllerRef.current?.flush(job);
  }, [commitStudy, previewJob]);

  const selectPreviewLoad = useCallback((index) => {
    const ids = libraryOptions().map((option) => option.id);
    const slider = sliderFromLoad(studyRef.current, index, ids);
    previewRef.current = { ...previewRef.current, ...slider };
    setPreview((prev) => ({ ...prev, ...slider }));
  }, []);

  useEffect(() => () => {
    const client = clientRef.current;
    clientRef.current = null;
    client?.dispose?.();
    controllerRef.current?.cancel();
    openRef.current = false;
    stressFieldRef.current = null;
    displacementFieldRef.current = null;
    contactFieldRef.current = null;
    probeMapRef.current = new Map();
    setProbeOverlay([]);
    previewFieldRef.current = null;
    setStressSkinSource(null);
    onHighlightRef.current?.(null);
  }, []);

  const progress = running ? (runReport.stage || 'running') : '';

  const api = {
    open: !!open && !!enabled,
    study,
    draft,
    result,
    running,
    progress,
    runReport,
    notice,
    toggle,
    close,
    setMaterialId,
    setStudyType,
    setCustomMode,
    setCustomField,
    setTarget,
    refine: refineMode(study, detectFeaProfile()),
    setRefine,
    setMagnitude,
    setDirection,
    setPressure,
    removeFixture,
    removeLoad,
    assemblyParts,
    analyzedPartId,
    memberIds: studyMemberIds(study, assemblyParts, analyzedPartId),
    tapAction,
    setStudyScope,
    toggleScopePart,
    setContactEnabled,
    setContactKind,
    setContactMu,
    pick: pickIfOpen,
    run,
    cancel,
    preview,
    previewBegin,
    previewInput,
    previewCommit,
    selectPreviewLoad,
    results,
    screen,
    viewKind: view.kind,
    plot: activePlot(plot),
    setPlot,
    modeIndex,
    setMode,
    probeRows,
    removeProbe,
    clearProbes,
    animate,
    setAnimate,
    dismissed,
    backToSetup,
  };

  return api;
}
