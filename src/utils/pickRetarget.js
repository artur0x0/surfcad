/**
 * Which part a viewport click edits.
 *
 * Face, edge, and body picks retarget the CAD part. The script pane stays
 * on its current buffer until a body click, a Parts-row click, or opening
 * the Script or Parts stage. A feature session also syncs that buffer so
 * Accept still writes the single part that was just touched.
 *
 * Hidden parts are not candidates. A failed row contributes no shadow solid
 * and does not rebuild graphs, but leftover triangles from its last success
 * stay pickable.
 */
import { composeViewportParts, partDefinitionId } from './assembly.js';
import { partSurfId } from './git/surfId.js';
import { partPlacement } from './jointSchema.js';

/** Hits closer than this along the ray (model units) are the same seam. */
export const AMBIGUOUS_HIT_GAP = 1;

/**
 * Nearest part along a ray. A second part inside the gap is ambiguous:
 * the nearest hit still wins, and the caller shows a which-part chip.
 *
 * @param {{ partId: string, distance: number }[]} hits
 * @param {number} [gap]
 */
export function resolvePartPick(hits, gap = AMBIGUOUS_HIT_GAP) {
  const list = (Array.isArray(hits) ? hits : []).filter((hit) => (
    hit
    && hit.partId != null
    && hit.partId !== ''
    && Number.isFinite(hit.distance)
  ));
  if (!list.length) {
    return { partId: null, hit: null, ambiguous: false, choices: [] };
  }
  const sorted = list.slice().sort((a, b) => a.distance - b.distance);
  const nearest = sorted[0];
  const choices = [];
  const seen = new Set();
  for (const hit of sorted) {
    if (hit.distance - nearest.distance > gap) break;
    const id = String(hit.partId);
    if (seen.has(id)) continue;
    seen.add(id);
    choices.push({ partId: id, distance: hit.distance, hit });
  }
  return {
    partId: String(nearest.partId),
    hit: nearest,
    ambiguous: choices.length > 1,
    choices,
  };
}

/**
 * The part a feature write, feature sheet or Undo acts on.
 *
 * A face / edge pick moves the CAD selection (`pickedId`, App's cadPartId)
 * and the viewer to that part but leaves the editor on `doc.activeId`. Every
 * writer used to write the editor buffer, so a Block confirmed on a picked
 * part B landed in A. The target is the part the viewer shows: the viewport's
 * own part for this payload (`payloadPartId`) when it is a row, else the
 * picked part, else the editor's. `load` is true when that is not the
 * editor's part, so the caller loads it into the editor (its own script and
 * Undo stack) before it writes.
 *
 * @returns {{ id: string|null, load: boolean }}
 */
export function featureWriteTarget(doc, { pickedId = null, payloadPartId = null } = {}) {
  if (!doc || !Array.isArray(doc.parts)) return { id: null, load: false };
  const active = doc.activeId ?? null;
  const isRow = (id) => id != null && doc.parts.some((row) => row.id === id);
  const id = isRow(payloadPartId) ? payloadPartId : isRow(pickedId) ? pickedId : active;
  return { id, load: id != null && id !== active };
}

/**
 * Monaco follows a body click, opening Script or Parts, or a pick made
 * while a feature session is open. A face or edge pick outside a feature
 * leaves the script pane pinned.
 */
export function shouldSyncScript({ kind = null, featureSession = false, surface = null } = {}) {
  if (surface === 'script' || surface === 'parts') return true;
  if (kind === 'body') return true;
  if (featureSession && (kind === 'face' || kind === 'edge')) return true;
  return false;
}

/** Empty space clears the geometric selection. A feature session keeps its picks. */
export function emptyClickClearsSelection({ featureSession = false } = {}) {
  return !featureSession;
}

export function featureSessionActive(modes) {
  if (!modes) return false;
  return !!(
    modes.contour || modes.fillet || modes.shell || modes.draft || modes.cut
    || modes.boolean || modes.move || modes.moveFace || modes.deleteFace
  );
}

/** Entering a feature hides the feature strip. */
export function featureStripHidden(sessionActive) {
  return !!sessionActive;
}

/** Hiding a part mid-feature does not clear that part's picks. */
export function featureHideKeepsPicks(sessionActive) {
  return !!sessionActive;
}

/**
 * Hidden parts are not pickable. A visible solid is. A red row is pickable
 * only when leftover geometry is still present.
 */
export function partIsPickable(part) {
  if (!part || part.visible === false || part.hidden === true) return false;
  const mesh = part.mesh?.vertProperties ? part.mesh : null;
  const leftover = part.leftover?.vertProperties ? part.leftover : null;
  return !!(mesh || leftover);
}

/**
 * Failed visible parts whose last successful mesh is still stored.
 * These are not composed solids and they are not a shadow on the pick mesh.
 */
export function leftoverPickSolids(doc, runs, stored) {
  const drawn = new Set((composeViewportParts(doc, runs) || []).map((solid) => solid.id));
  const out = [];
  for (const part of doc?.parts || []) {
    if (!part || part.visible === false || drawn.has(part.id)) continue;
    const run = runs?.[part.id];
    const failed = !!(
      run
      && run.ok === false
      && !run.empty
      && !run.skipped
      && !run.missing
    );
    if (!failed) continue;
    const mesh = stored?.[part.id];
    if (!mesh?.vertProperties) continue;
    const pose = partPlacement(part);
    out.push({
      id: part.id,
      definitionId: partDefinitionId(part),
      surfId: partSurfId(part),
      mesh,
      position: pose.t,
      placement: pose,
      leftover: true,
    });
  }
  return out;
}
