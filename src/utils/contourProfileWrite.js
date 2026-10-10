/**
 * Dimension Confirm writes the named contour and nothing else.
 * It does not Auto-Run and it does not leave contour mode.
 *
 * The write is `const c1 = makeCrossSection(frame, solveContour(...)); // @contour id=c1`.
 * An Extrude, Revolve, Loft, or Sweep block is left alone.
 * An open contour stays in the session and is not emitted.
 */

import { emitSolveContour } from './contourScript.js';
import { solveContour } from './contourSolve.js';
import { specFromSolved } from './contourGesture.js';
import { hasNamedContour, upsertNamedContour } from './namedContour.js';
import {
  contourExtrudeOwnedRegion,
  contourLoftOwnedRegion,
  contourProfileOwnedRegion,
  contourRevolveOwnedRegion,
  contourSweepOwnedRegion,
  hasContourExtrudeBlock,
  hasContourLoftBlock,
  hasContourProfileBlock,
  hasContourRevolveBlock,
  hasContourSweepBlock,
  planeFromContourFace,
} from './contourMode.js';

/**
 * True when this contour statement is already in the script.
 * With no id, a legacy profile or solid marker block still counts so an
 * old script can answer "is there a block?". Pointer-up from the editor
 * passes the contour id and does not treat a feature block as the contour.
 */
export function contourBlockReady(buffer, entry, loftSelected = 0, contourId = null) {
  if (contourId) return hasNamedContour(buffer, contourId);
  return !!slotFor(buffer, entry, loftSelected)?.region;
}

function slotFor(buffer, entry, loftSelected) {
  if (entry === 'makeExtrude' && hasContourExtrudeBlock(buffer)) {
    return { region: contourExtrudeOwnedRegion(buffer), index: 0 };
  }
  if (entry === 'makeRevolve' && hasContourRevolveBlock(buffer)) {
    return { region: contourRevolveOwnedRegion(buffer), index: 0 };
  }
  if (entry === 'makeSweep' && hasContourSweepBlock(buffer)) {
    return { region: contourSweepOwnedRegion(buffer), index: 0 };
  }
  if (entry === 'makeLoft' && hasContourLoftBlock(buffer)) {
    return {
      region: contourLoftOwnedRegion(buffer),
      index: Math.max(0, Number(loftSelected) || 0),
    };
  }
  if (hasContourProfileBlock(buffer)) {
    return { region: contourProfileOwnedRegion(buffer), index: 0 };
  }
  return null;
}

/**
 * @returns {{ ok: true, buffer: string, written: boolean, contourId?: string, contourName?: string, message?: string } | { ok: false, message: string }}
 */
export function writeContourProfileBlock(buffer, payload = {}) {
  const params = payload.params || {};
  const contour = params.contour;
  if (!contour) return { ok: false, message: 'No contour to save.' };
  let solved;
  try {
    solved = solveContour(contour);
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
  const spec = specFromSolved(solved);
  if (!solved.contours?.length) {
    return {
      ok: true,
      buffer: String(buffer || ''),
      written: false,
      message: 'Open contour — the dimension stays here until the contour closes.',
    };
  }
  const planar = payload.face && payload.face.type === 'planar' ? payload.face : null;
  const saved = upsertNamedContour(buffer, {
    id: payload.contourId || null,
    name: payload.contourName || null,
    frame: planeFromContourFace(planar),
    profileExpr: emitSolveContour(spec),
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    buffer: saved.buffer,
    written: true,
    contourId: saved.id,
    contourName: saved.name,
  };
}
