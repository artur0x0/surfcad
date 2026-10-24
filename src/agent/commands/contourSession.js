/**
 * A saved contour reopened in the sketch, shared by edit_feature /
 * confirm_feature / cancel_feature (open_feature on a contour chip) and by
 * sketch_edit (one call). The sketch is the only writer of a saved contour,
 * so every path patches the live sketch and ends with the same commit the
 * rail checkmark performs; whatever happens, no sketch is left open.
 */
import { trackFeatureUsed } from '../../utils/analytics.js';
import { normalizeSketchTool } from '../sketchAgent.js';
import { runContourCommitMutate } from './contourCommitMutate.js';

/**
 * The agent's open feature session when it is a saved contour that
 * open_feature reopened in the contour sketch: `{ contourId, sketchOpen }`.
 * Null for every other session (sheet, viewport card, hole card) and when
 * the sketch has since been closed.
 */
export function openContourSketchSession(ctx) {
  const read = ctx.readFeatureSession;
  if (typeof read !== 'function') return null;
  const session = read();
  if (!session?.contourId || session.sketchOpen !== true) return null;
  return session;
}

/** Profile keys edit_feature forwards to the open contour sketch. */
export const CONTOUR_PROFILE_KEYS = Object.freeze([
  'tool', 'points', 'radius', 'segments', 'width', 'height', 'centered', 'centers',
  'polygon_preset', 'polygonPreset', 'params',
]);

export const CONTOUR_EDIT_HINT = 'A saved contour takes profile params: points [[u, v], …] (polyline), radius and segments (circle), width, height and centered (rectangle), polygon_preset and radius (polygon), or tool to switch. Extrude, revolve, loft and sweep values belong to the feature that uses the contour.';

/**
 * Map an edit_feature params bag onto the contour sketch the session opened:
 * the tool is explicit, or inferred from the keys, else the current one. Only
 * the keys given are patched, so the saved values stay for the rest. Points
 * replace a solved sketch (its dimensions and constraints no longer describe
 * the new geometry), so `contour: null` drops that spec.
 */
export function contourSketchPatch(bag, currentTool, label = 'edit_feature') {
  const src = bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {};
  const ignored = Object.keys(src).filter((key) => !CONTOUR_PROFILE_KEYS.includes(key));
  let tool = src.tool != null ? normalizeSketchTool(src.tool) : null;
  if (src.tool != null && !tool) {
    return { error: { code: 'bad_args', message: `${label}: unknown sketch tool ${String(src.tool)}. ${CONTOUR_EDIT_HINT}` } };
  }
  if (!tool) {
    if (Array.isArray(src.points)) tool = 'polyline';
    else if (src.width != null || src.height != null || src.centered != null || src.centers != null) tool = 'rectangle';
    else if (src.polygon_preset != null || src.polygonPreset != null) tool = 'polygon';
    else if (src.radius != null || src.segments != null) tool = currentTool === 'polygon' ? 'polygon' : 'circle';
    else tool = normalizeSketchTool(currentTool || 'circle') || 'circle';
  }
  const params = {};
  if (tool === 'rectangle') {
    if (src.width != null) params.width = Number(src.width);
    if (src.height != null) params.height = Number(src.height);
    if (src.centered != null) params.centered = !!src.centered;
    if (src.centers != null) params.centers = !!src.centers;
  } else if (tool === 'circle') {
    if (src.radius != null) params.radius = Number(src.radius);
    if (src.segments != null) params.segments = Math.round(Number(src.segments));
  } else if (tool === 'polygon') {
    if (src.polygon_preset != null) params.polygonPreset = String(src.polygon_preset);
    if (src.polygonPreset != null) params.polygonPreset = String(src.polygonPreset);
    if (src.radius != null) params.radius = Number(src.radius);
  } else if (tool === 'polyline' || tool === 'cursor') {
    if (Array.isArray(src.points)) {
      const points = src.points.map((row) => [Number(row?.[0]), Number(row?.[1])]);
      if (points.length < 3 || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        return { error: { code: 'bad_args', message: `${label}: points needs at least three [u, v] number pairs. ${CONTOUR_EDIT_HINT}` } };
      }
      params.points = points;
      params.contour = null;
    }
  }
  const extra = src.params;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(params, extra);
  for (const key of Object.keys(params)) {
    if (key !== 'contour' && key !== 'points' && key !== 'polygonPreset' && typeof params[key] === 'number' && !Number.isFinite(params[key])) {
      return { error: { code: 'bad_args', message: `${label}: ${key} must be a number. ${CONTOUR_EDIT_HINT}` } };
    }
  }
  if (!Object.keys(params).length && tool === (normalizeSketchTool(currentTool || '') || tool)) {
    return { error: { code: 'bad_args', message: `${label}: nothing to change on the contour. ${CONTOUR_EDIT_HINT}` } };
  }
  return { tool, params, ignored };
}

/**
 * Patch the open contour sketch with a profile bag (the edit_feature params,
 * or one sketch_edit `profile` op). Returns `{ result: { sketch, ignored?,
 * hint? } }` or `{ error }`; the sketch stays open either way so the caller
 * can go on or close it.
 */
export function patchOpenContourSketch(ctx, sketch, bag, label = 'edit_feature') {
  const patch = contourSketchPatch(bag, sketch?.tool, label);
  if (patch.error) return { error: patch.error };
  const add = ctx.sketchAdd;
  if (typeof add !== 'function') {
    return { error: { code: 'internal', message: 'sketchAdd handler is missing' } };
  }
  const out = add({ tool: patch.tool, params: patch.params });
  if (out?.error) return { error: out.error };
  return {
    result: {
      sketch: { tool: patch.tool, params: patch.params },
      ...(patch.ignored.length ? { ignored: patch.ignored, hint: CONTOUR_EDIT_HINT } : {}),
    },
  };
}

/** Close the reopened contour sketch without writing, and drop the feature session. */
export function closeOpenContourSketch(ctx) {
  ctx.sketchCancel?.();
  ctx.dismissFeatureConfirmSession?.();
}

/**
 * Save and close the contour sketch open_feature reopened: the same commit
 * as the rail checkmark / sketch_commit, which rewrites the @contour
 * statement by id and runs the part. Whatever happens, the sketch does not
 * stay open behind the agent. Returns the confirm_feature-shaped result.
 */
export async function commitOpenContourSketch(ctx, sketch) {
  const prepareSketch = ctx.prepareSketchCommit;
  if (typeof prepareSketch !== 'function') {
    closeOpenContourSketch(ctx);
    return { error: { code: 'internal', message: 'prepareSketchCommit handler is missing' } };
  }
  const committed = await runContourCommitMutate(ctx, { prepare: prepareSketch, fromSlot: false });
  if (committed.error) {
    closeOpenContourSketch(ctx);
    const message = committed.error.message || 'Contour edit could not be saved';
    return {
      error: {
        ...committed.error,
        message: `${message} The contour sketch was closed without saving. ${CONTOUR_EDIT_HINT}`,
      },
    };
  }
  ctx.dismissFeatureConfirmSession?.();
  const res = committed.result || {};
  if (res.written) trackFeatureUsed('contour');
  return {
    result: {
      ok: res.ok === true,
      id: `contour:${sketch.contourId}`,
      errors: res.errors || [],
      status: res.status,
      unchanged: res.unchanged === true,
      sketchClosed: true,
    },
  };
}
