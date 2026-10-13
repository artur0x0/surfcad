/**
 * Planes a joint can name.
 *
 * Origin planes are the part frame: XY, YZ, and ZX through the origin.
 * A workplane is a literal construction frame in the script, named by its
 * binding. A sketch plane is a saved contour that has a literal frame,
 * named by the contour id. Neither id is a character offset. A host
 * query (`workplaneFromFace`) has no frame here, so it is not a plane.
 */
import { listConstructionPlanes, listSavedContours } from './savedContours.js';

function unit(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-12)) return null;
  return [x / len, y / len, z / len];
}

function frameOf(center, normal, x, y) {
  return {
    center: center.slice(),
    normal: normal.slice(),
    x: x.slice(),
    y: y.slice(),
  };
}

/**
 * Quad size of a confirmed construction plane, and of the Plane-tool
 * preview of the plane Confirm would write.
 */
export const CONSTRUCTION_PLANE_SIZE = 48;

/** XY / YZ / ZX through the part origin. Ids never change. */
export const ORIGIN_JOINT_PLANES = Object.freeze([
  Object.freeze({
    id: 'origin:xy',
    name: 'XY',
    at: Object.freeze([0, 0, 0]),
    n: Object.freeze([0, 0, 1]),
    plane: Object.freeze(frameOf([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0])),
  }),
  Object.freeze({
    id: 'origin:yz',
    name: 'YZ',
    at: Object.freeze([0, 0, 0]),
    n: Object.freeze([1, 0, 0]),
    plane: Object.freeze(frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1])),
  }),
  Object.freeze({
    id: 'origin:zx',
    name: 'ZX',
    at: Object.freeze([0, 0, 0]),
    n: Object.freeze([0, 1, 0]),
    plane: Object.freeze(frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, -1])),
  }),
]);

export function workplaneJointId(name) {
  return `workplane:${name}`;
}

export function contourJointId(id) {
  return `contour:${id}`;
}

function recordFromFrame(id, name, plane) {
  const n = unit(plane?.normal);
  const center = plane?.center;
  const x = plane?.x;
  const y = plane?.y;
  if (!id || !n || !Array.isArray(center) || center.length < 3 || !Array.isArray(x) || !Array.isArray(y)) {
    return null;
  }
  const at = [Number(center[0]) || 0, Number(center[1]) || 0, Number(center[2]) || 0];
  return {
    id,
    name: name || id,
    at,
    n,
    plane: frameOf(at, n, x.map(Number), y.map(Number)),
  };
}

/**
 * Planes on one part, in pick order: origins, then workplanes, then sketches.
 * A repeated binding keeps the later frame. The id stays the name.
 */
export function jointPlanesFromScript(script) {
  const byId = new Map();
  for (const row of ORIGIN_JOINT_PLANES) {
    byId.set(row.id, recordFromFrame(row.id, row.name, row.plane));
  }
  for (const plane of listConstructionPlanes(script || '')) {
    const rec = recordFromFrame(workplaneJointId(plane.name), plane.name, plane.plane);
    if (rec) byId.set(rec.id, rec);
  }
  for (const contour of listSavedContours(script || '')) {
    if (!contour?.plane) continue;
    const rec = recordFromFrame(contourJointId(contour.id), contour.name || contour.label, contour.plane);
    if (rec) byId.set(rec.id, rec);
  }
  return [...byId.values()];
}

/** Point and unit normal stored on a plane reference. */
export function planeReferenceKey(id, plane) {
  const rec = recordFromFrame(id, id, plane);
  if (!rec) return null;
  return { id: rec.id, at: rec.at, n: rec.n };
}

function workplaneQuads(entry) {
  return (entry?.planes || []).map((plane) => ({
    ...plane,
    jointPlaneId: workplaneJointId(plane.name),
  }));
}

function originPlaneQuads(seen) {
  const extra = [];
  for (const row of ORIGIN_JOINT_PLANES) {
    if (seen.has(row.id)) continue;
    extra.push({
      id: row.id,
      name: row.name,
      plane: row.plane,
      jointPlaneId: row.id,
    });
    seen.add(row.id);
  }
  return extra;
}

/**
 * Quads while the Plane tool is open: the part's user planes, then the
 * three reference planes. Sketch planes stay out. The rail toggle is a
 * separate hold; this list is what that hold paints for the tool.
 * `references: false` drops XY/YZ/ZX while a face stays selected. User
 * planes stay. The hold itself is unchanged, so closing the tool still
 * restores the rail.
 */
export function planesForWorkplaneTool(entry, { references = true } = {}) {
  const work = workplaneQuads(entry);
  if (!references) return work;
  const seen = new Set(work.map((plane) => plane.jointPlaneId));
  return [...work, ...originPlaneQuads(seen)];
}

/**
 * Quads for the planes overlay. Workplanes keep the script id the contour
 * tools select. `jointPlaneId` is the stable id a joint stores. Origin and
 * sketch quads are added while a joint card is picking.
 */
export function planesForJointOverlay(entry, picking) {
  const work = workplaneQuads(entry);
  if (!picking) return work;
  const seen = new Set(work.map((plane) => plane.jointPlaneId));
  const extra = originPlaneQuads(seen);
  for (const contour of entry?.contours || []) {
    const rec = contour?.plane
      ? recordFromFrame(contourJointId(contour.id), contour.name || contour.label, contour.plane)
      : null;
    if (!rec || seen.has(rec.id)) continue;
    extra.push({
      id: rec.id,
      name: rec.name,
      plane: rec.plane,
      jointPlaneId: rec.id,
    });
    seen.add(rec.id);
  }
  return [...work, ...extra];
}
