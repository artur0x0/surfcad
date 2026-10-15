/**
 * Viewport side of H9 pick sessions.
 *
 * The bridge commands talk to these host handlers. They read and write the
 * same state a tap does: `selectedEdges`, the face pick group, and each
 * picker card's mode state. Writes take the whole list and leave the
 * consumer as if those faces or edges had been tapped on, in order.
 *
 * `getDeps()` is read on every call. The Viewport rebuilds the deps each
 * render so Accept runs the closure that saw the latest picks.
 */

import { shellFaceKey } from '../../utils/shellMode.js';
import { selectionEdgeKey } from '../../utils/selectEdge.js';
import { applyDraftFaceTap } from '../../utils/draftMode.js';
import { emptyMoveFaceState } from '../../utils/moveFaceMode.js';
import { emptyDeleteFaceState } from '../../utils/deleteFaceMode.js';
import { PICK_TOOLS, pickTargetFrom, SKETCH_PICK_KINDS } from './tools.js';

function isSketchTarget(target) {
  return target === 'contour' || target === 'holeCentres';
}

function faceEntry(face) {
  return {
    center: face.center.map(Number),
    normal: face.normal.map(Number),
    indices: Array.isArray(face.indices) ? face.indices.slice() : undefined,
  };
}

function isFace(face) {
  return !!face && Array.isArray(face.center) && Array.isArray(face.normal);
}

export function faceRows(list) {
  const out = [];
  for (const face of Array.isArray(list) ? list : []) {
    if (!isFace(face)) continue;
    const id = shellFaceKey(face);
    if (id) out.push({ id, entry: faceEntry(face) });
  }
  return out;
}

export function edgeRows(list) {
  const out = [];
  for (const edge of Array.isArray(list) ? list : []) {
    const id = selectionEdgeKey(edge);
    if (id) out.push({ id, entry: edge });
  }
  return out;
}

function toastText(toast) {
  if (!toast) return null;
  if (typeof toast === 'string') return toast;
  return typeof toast.text === 'string' && toast.text ? toast.text : null;
}

function selectionKind(d) {
  return d.pickMode() === 'edge' ? 'edge' : 'face';
}

function draftFaces(state) {
  if (!state) return [];
  return [state.neutral, ...(state.drafts || [])].filter(isFace);
}

/** Card state with `params` applied, the same fields the card inputs set. */
export function patchToolParams(tool, state, params) {
  if (!state || !params) return state;
  if (tool === 'filletEdges') {
    return { ...state, params: { ...state.params, ...params }, radiusTouched: true };
  }
  if (tool === 'chamferEdges') {
    return { ...state, params: { ...state.params, ...params }, sizeTouched: true };
  }
  if (tool === 'shell') return { ...state, params: { ...state.params, ...params } };
  if (tool === 'addDraft' || tool === 'moveFace') return { ...state, ...params };
  return state;
}

/**
 * Face card state holding exactly `faces`, built the way taps build it.
 * Draft: the first face is the neutral plane, the rest are drafted.
 */
export function faceCardState(tool, state, faces) {
  if (tool === 'moveFace') return { ...state, faces: emptyMoveFaceState(faces).faces };
  if (tool === 'deleteFace') return { ...state, faces: emptyDeleteFaceState(faces).faces };
  if (tool === 'addDraft') {
    let next = { ...state, neutral: null, drafts: [], replaceNeutral: false };
    for (const face of faces) next = applyDraftFaceTap(next, face);
    return next;
  }
  return state;
}

/**
 * @param {() => {
 *   modes: () => object,
 *   opening: () => boolean,
 *   editing: () => boolean,
 *   hasMesh: () => boolean,
 *   toast: () => unknown,
 *   selectedEdges: () => object[],
 *   facePicks: () => object[] | null,
 *   selectedFace: () => object | null,
 *   toolState: (tool: string) => object | null,
 *   commitToolState: (tool: string, next: object) => void,
 *   resolveFaces: (keys: unknown[]) => { groups?: object[][], error?: object },
 *   resolveEdges: (keys: unknown[]) => { groups?: object[][], error?: object },
 *   pickMode: () => string,
 *   setPickMode: (kind: 'face' | 'edge') => void,
 *   writeFaces: (faces: object[], opts: { selection: boolean }) => void,
 *   writeEdges: (edges: object[], opts: { selection: boolean }) => void,
 *   enter: (tool: string) => void,
 *   accept: (tool: string) => void,
 *   exit: (tool: string) => void,
 * }} getDeps
 */
export function createViewportPickHost(getDeps) {
  const deps = () => getDeps();

  function target() {
    const d = deps();
    const sketch = typeof d.sketchPickInfo === 'function' ? d.sketchPickInfo() : null;
    if (sketch?.target) return { target: sketch.target, kind: sketch.kind, busy: null };
    return pickTargetFrom(d.modes());
  }

  // The group ref updates on write; selectedFace on the next render. Only a
  // write this host made waits for that render, so a stale group cannot stall.
  let pendingFaces = null;

  function selectionFaceRead(d) {
    const group = d.facePicks();
    const face = d.selectedFace();
    const shown = face ? (Array.isArray(face.group) ? face.group.length : 1) : 0;
    if (pendingFaces) {
      const sameLast = !pendingFaces.last || (isFace(face) && shellFaceKey(face) === pendingFaces.last);
      if (shown !== pendingFaces.count || !sameLast) return { entries: faceRows(group), settled: false };
      pendingFaces = null;
    }
    if (!isFace(face)) return { entries: [], settled: true };
    if (Array.isArray(group) && group.length) return { entries: faceRows(group), settled: true };
    return { entries: faceRows([face]), settled: true };
  }

  function read() {
    const d = deps();
    const now = target();
    const tool = now.target;
    if (isSketchTarget(tool) && typeof d.sketchPickRead === 'function') {
      return d.sketchPickRead();
    }
    if (!tool) return { target: null, entries: [], settled: true };
    const kind = tool === 'selection' ? selectionKind(d) : PICK_TOOLS[tool].kind;
    if (kind === 'edge') return { target: tool, entries: edgeRows(d.selectedEdges()), settled: true };
    if (tool === 'moveFace' || tool === 'deleteFace') {
      return { target: tool, entries: faceRows(d.toolState(tool)?.faces), settled: true };
    }
    if (tool === 'addDraft') return { target: tool, entries: faceRows(draftFaces(d.toolState(tool))), settled: true };
    return { target: tool, ...selectionFaceRead(d) };
  }

  const host = {
    pickInfo() {
      const d = deps();
      const now = target();
      return {
        ...now,
        kind: now.target === 'selection' ? selectionKind(d) : now.kind,
        opening: !!d.opening(),
        editing: now.target && now.target !== 'selection' ? !!d.editing() : false,
        hasMesh: !!d.hasMesh(),
        toast: toastText(d.toast()),
      };
    },

    pickEnter({ tool = null, kind = null } = {}) {
      const d = deps();
      if (tool) {
        if (!PICK_TOOLS[tool]) return { error: { code: 'bad_args', message: `Unknown picker: ${tool}` } };
        d.enter(tool);
        return { ok: true };
      }
      if (SKETCH_PICK_KINDS.includes(kind)) {
        const sketch = typeof d.sketchPickInfo === 'function' ? d.sketchPickInfo() : null;
        if (!sketch?.target) {
          return { error: { code: 'bad_args', message: 'Open a contour gesture or hole centres sketch before picking sketch entities' } };
        }
        if (typeof d.sketchPickEnter !== 'function') {
          return { error: { code: 'internal', message: 'sketch pick enter is missing' } };
        }
        return d.sketchPickEnter({ kind });
      }
      if (kind !== 'face' && kind !== 'edge') {
        return { error: { code: 'bad_args', message: 'kind must be face, edge, or a sketch kind (point, line, arc, ref)' } };
      }
      d.setPickMode(kind);
      return { ok: true };
    },

    pickResolve({ kind, keys }) {
      const d = deps();
      if (SKETCH_PICK_KINDS.includes(kind)) {
        if (typeof d.sketchPickResolve !== 'function') {
          return { error: { code: 'internal', message: 'sketch pick resolve is missing' } };
        }
        return d.sketchPickResolve({ kind, keys });
      }
      if (!d.hasMesh()) return { error: { code: 'no_mesh', message: 'No mesh to pick on' } };
      const out = kind === 'face' ? d.resolveFaces(keys) : d.resolveEdges(keys);
      if (out?.error) return { error: out.error };
      const groups = (out?.groups || []).map((list) => (kind === 'face' ? faceRows(list) : edgeRows(list)));
      return { groups };
    },

    pickRead: read,

    pickWrite({ entries }) {
      const d = deps();
      const now = target();
      const tool = now.target;
      if (!tool) return { error: { code: 'pick_closed', message: 'No picker is open' } };
      if (isSketchTarget(tool) && typeof d.sketchPickWrite === 'function') {
        return d.sketchPickWrite({ entries });
      }
      const list = (Array.isArray(entries) ? entries : []).map((row) => row.entry);
      const kind = tool === 'selection' ? selectionKind(d) : PICK_TOOLS[tool].kind;
      const written = (rows) => ({ count: rows.length, ids: rows.map((row) => row.id) });
      if (kind === 'edge') {
        d.writeEdges(list, { selection: tool === 'selection' });
        return written(edgeRows(list));
      }
      if (tool === 'moveFace' || tool === 'deleteFace' || tool === 'addDraft') {
        const next = faceCardState(tool, d.toolState(tool), list);
        d.commitToolState(tool, next);
        return written(faceRows(tool === 'addDraft' ? draftFaces(next) : next.faces));
      }
      d.writeFaces(list, { selection: tool === 'selection' });
      const rows = faceRows(list);
      pendingFaces = { count: rows.length, last: rows.length ? rows[rows.length - 1].id : null };
      return written(rows);
    },

    pickParams({ params }) {
      const d = deps();
      const tool = target().target;
      if (!tool || tool === 'selection') {
        return { error: { code: 'bad_args', message: 'params need a picker card' } };
      }
      const state = d.toolState(tool);
      if (!state) return { error: { code: 'pick_closed', message: `${tool} is not open` } };
      d.commitToolState(tool, patchToolParams(tool, state, params));
      return { ok: true };
    },

    pickAccept() {
      const tool = target().target;
      if (!tool || tool === 'selection') return { error: { code: 'no_card', message: 'No picker card is open' } };
      deps().accept(tool);
      return { ok: true };
    },

    pickExit() {
      const tool = target().target;
      if (!tool || tool === 'selection') return { ok: false };
      deps().exit(tool);
      return { ok: true };
    },
  };

  const notReady = { error: { code: 'internal', message: 'Viewport not ready' } };
  const guarded = {};
  for (const [name, fn] of Object.entries(host)) {
    guarded[name] = (...args) => {
      if (!getDeps()) {
        if (name === 'pickInfo') return { target: null, kind: null, busy: 'loading', opening: false, editing: false, hasMesh: false, toast: null };
        if (name === 'pickRead') return { target: null, entries: [], settled: true };
        return notReady;
      }
      return fn(...args);
    };
  }
  return guarded;
}
