/**
 * Re-resolve a joint reference in the part frame.
 *
 * A face uses matchFaceKeys and the paint tolerances. An axis matches
 * direction within 8° (unsigned), point-to-axis within 1 mm, and radius
 * within ±25%. An edge matches midpoint, direction, length, and both
 * adjacent face keys. A plane matches its stable id. Two candidates or
 * none are broken. The confirmed key is not rewritten. A plane that is
 * still in the script is solved from that plane's current frame.
 */
import { buildPartGraphPatches } from './partGraphPatches.js';
import {
  FACE_MATCH_AREA_FRAC,
  FACE_MATCH_AT_MM,
  FACE_MATCH_NORMAL_DEG,
  faceFingerprints,
  matchFaceKeys,
} from './faceColorMatch.js';
import { partSurfId } from './git/surfId.js';
import { jointPlanesFromScript } from './jointPlanes.js';
import { dropPlanarFins } from './planarSeam.js';
import { triangleSources } from './partSolidCache.js';

const NORMAL_COS = Math.cos((FACE_MATCH_NORMAL_DEG * Math.PI) / 180);
const AT_MM = FACE_MATCH_AT_MM;

const KIND_NOUN = { face: 'face', axis: 'axis', edge: 'edge', plane: 'plane' };
const KIND_TITLE = { face: 'Face', axis: 'Axis', edge: 'Edge', plane: 'Plane' };

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const len = Math.hypot(Number(v[0]), Number(v[1]), Number(v[2]));
  if (!(len > 1e-12)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pointToAxis(point, origin, direction) {
  const delta = sub(point, origin);
  const along = dot(delta, direction);
  return Math.hypot(
    delta[0] - direction[0] * along,
    delta[1] - direction[1] * along,
    delta[2] - direction[2] * along,
  );
}

function classify(hits) {
  if (hits.length === 1) return { status: 'ok' };
  if (hits.length > 1) return { status: 'ambiguous' };
  return { status: 'missing' };
}

/** One face key against current fingerprints. Does not pick a nearest. */
export function matchJointFace(faces, key) {
  if (!Array.isArray(faces)) return { status: 'unresolved' };
  const hit = matchFaceKeys(faces, [{ key }]);
  if (hit.matched.length === 1) return { status: 'ok' };
  if (hit.ambiguous.length) return { status: 'ambiguous' };
  return { status: 'missing' };
}

/** Axis key against fitted axes. Direction is unsigned. */
export function matchJointAxis(axes, key) {
  if (!Array.isArray(axes)) return { status: 'unresolved' };
  const dir = unit(key?.dir);
  const at = key?.at;
  const radius = Number(key?.radius);
  if (!dir || !Array.isArray(at) || !(radius > 0)) return { status: 'missing' };
  const hits = [];
  for (const axis of axes) {
    const cand = unit(axis?.dir);
    const origin = axis?.at;
    const candRadius = Number(axis?.radius);
    if (!cand || !Array.isArray(origin) || !(candRadius > 0)) continue;
    if (Math.abs(dot(dir, cand)) < NORMAL_COS) continue;
    if (pointToAxis(at, origin, cand) > AT_MM) continue;
    if (Math.abs(candRadius - radius) / radius > FACE_MATCH_AREA_FRAC) continue;
    hits.push(axis);
    if (hits.length > 1) break;
  }
  return classify(hits);
}

/** Edge key against current edges, including both adjacent faces. */
export function matchJointEdge(edges, key) {
  if (!Array.isArray(edges)) return { status: 'unresolved' };
  const dir = unit(key?.dir);
  const at = key?.at;
  const length = Number(key?.length);
  const faces = key?.faces;
  if (!dir || !Array.isArray(at) || !(length > 0) || !Array.isArray(faces) || faces.length !== 2) {
    return { status: 'missing' };
  }
  const hits = [];
  for (const edge of edges) {
    const cand = unit(edge?.dir);
    if (!cand || !Array.isArray(edge?.at)) continue;
    if (dist(at, edge.at) > AT_MM) continue;
    if (Math.abs(dot(dir, cand)) < NORMAL_COS) continue;
    const candLength = Number(edge?.length);
    if (!(candLength > 0) || Math.abs(candLength - length) / length > FACE_MATCH_AREA_FRAC) continue;
    const pool = Array.isArray(edge.faces) ? edge.faces : [];
    const a = matchFaceKeys(pool, [{ key: faces[0] }]);
    const b = matchFaceKeys(pool, [{ key: faces[1] }]);
    if (a.matched.length !== 1 || b.matched.length !== 1) continue;
    if (a.matched[0].face === b.matched[0].face) continue;
    hits.push(edge);
    if (hits.length > 1) break;
  }
  return classify(hits);
}

/**
 * One plane id against the part's planes. Geometry is not a fingerprint:
 * the hit carries the plane's current point and normal. An omitted list
 * leaves the confirmed key in the solve. A present list that misses is broken.
 */
export function matchJointPlane(planes, key) {
  if (!Array.isArray(planes)) return { status: 'unresolved' };
  const id = typeof key?.id === 'string' ? key.id : '';
  if (!id) return { status: 'missing' };
  const hits = [];
  for (const plane of planes) {
    if (plane?.id !== id) continue;
    const n = unit(plane.n);
    const at = plane.at;
    if (!n || !Array.isArray(at) || at.length < 3) continue;
    hits.push({
      id,
      at: [Number(at[0]) || 0, Number(at[1]) || 0, Number(at[2]) || 0],
      n,
    });
    if (hits.length > 1) break;
  }
  if (hits.length === 1) return { status: 'ok', key: hits[0] };
  if (hits.length > 1) return { status: 'ambiguous' };
  return { status: 'missing' };
}

/**
 * One reference. `catalog.faces` / `axes` / `edges` / `planes` omitted
 * means this run did not supply that kind, so the confirmed key stays
 * in the solve. A present array that misses is broken. A plane is read
 * even when the mesh catalog is unresolved.
 */
export function resolveReference(ref, catalog) {
  if (!ref) return { status: 'missing' };
  if (catalog?.failed) return { status: 'failed' };
  if (ref.kind === 'plane') return matchJointPlane(catalog?.planes, ref.key);
  if (!catalog || catalog.unresolved) return { status: 'unresolved' };
  if (ref.kind === 'face') return matchJointFace(catalog.faces, ref.key);
  if (ref.kind === 'axis') return matchJointAxis(catalog.axes, ref.key);
  if (ref.kind === 'edge') return matchJointEdge(catalog.edges, ref.key);
  return { status: 'missing' };
}

export function referenceFailure(ref, status, name) {
  const who = name || ref?.part || 'part';
  const noun = KIND_NOUN[ref?.kind] || 'reference';
  const title = KIND_TITLE[ref?.kind] || 'Reference';
  if (status === 'ambiguous') return `More than one ${noun} matches on ${who}`;
  if (status === 'failed') return `Part run failed on ${who}`;
  return `${title} not found on ${who}`;
}

function triangleNormal(positions, indices, t) {
  const i0 = indices[t * 3] * 3;
  const i1 = indices[t * 3 + 1] * 3;
  const i2 = indices[t * 3 + 2] * 3;
  const ax = positions[i1] - positions[i0];
  const ay = positions[i1 + 1] - positions[i0 + 1];
  const az = positions[i1 + 2] - positions[i0 + 2];
  const bx = positions[i2] - positions[i0];
  const by = positions[i2 + 1] - positions[i0 + 1];
  const bz = positions[i2 + 2] - positions[i0 + 2];
  return unit([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
}

/**
 * Cylinder axis of one patch: normals are radial, so pairs of them cross
 * along the axis. Radius variance under 25% of the mean keeps it.
 * A flat face does not fit. estimateCylinderAxis is not used.
 */
function fitPatchAxis(positions, indices, tris) {
  if (!tris || tris.length < 4) return null;
  const normals = [];
  for (let i = 0; i < tris.length; i += 1) {
    const n = triangleNormal(positions, indices, tris[i]);
    if (n) normals.push(n);
  }
  if (normals.length < 4) return null;
  let axis = [0, 0, 0];
  const step = Math.max(1, Math.floor(normals.length / 3));
  for (let i = 0; i < normals.length; i += 1) {
    let c = cross(normals[i], normals[(i + step) % normals.length]);
    if (dot(c, axis) < 0) c = [-c[0], -c[1], -c[2]];
    axis = [axis[0] + c[0], axis[1] + c[1], axis[2] + c[2]];
  }
  axis = unit(axis);
  if (!axis) return null;
  let align = 0;
  for (const n of normals) align += Math.abs(dot(n, axis));
  if (align / normals.length > 0.35) return null;
  const seen = new Set();
  const points = [];
  for (let i = 0; i < tris.length; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const vi = indices[tris[i] * 3 + k];
      if (seen.has(vi)) continue;
      seen.add(vi);
      points.push([positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]]);
    }
  }
  if (points.length < 6) return null;
  const origin = [0, 0, 0];
  for (const p of points) {
    origin[0] += p[0];
    origin[1] += p[1];
    origin[2] += p[2];
  }
  origin[0] /= points.length;
  origin[1] /= points.length;
  origin[2] /= points.length;
  let radius = 0;
  const radii = [];
  for (const p of points) {
    const r = pointToAxis(p, origin, axis);
    radii.push(r);
    radius += r;
  }
  radius /= radii.length;
  if (!(radius > 1e-6)) return null;
  let variance = 0;
  for (const r of radii) variance += (r - radius) ** 2;
  variance = Math.sqrt(variance / radii.length);
  if (variance > FACE_MATCH_AREA_FRAC * radius) return null;
  return { at: origin, dir: axis, radius };
}

/** Axis of one picked patch. A flat face returns null. estimateCylinderAxis is not used. */
export function fitJointAxis(positions, indices, tris) {
  return fitPatchAxis(positions, indices, tris);
}

/**
 * Face fingerprints, and cylinder axes when a patch fits. Null when the mesh has none.
 *
 * The graph is the one a pick uses. Planar fins are dropped, and each triangle
 * keeps the Manifold run it came from. Sheet metal is a union of flange boxes
 * and bend zones, and face ids restart inside each of those solids. A bend
 * and a flange that share an edge and a reused id stay separate faces. Without
 * the run id they become one face, and Confirm says the face was not found.
 */
export function catalogFromMeshData(mesh) {
  const src = mesh?.vertProperties;
  const rawIndex = mesh?.triVerts;
  if (!src || !rawIndex || !rawIndex.length) return null;
  const np = mesh.numProp || 3;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i += 1) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const indicesIn = rawIndex instanceof Uint32Array ? rawIndex : Uint32Array.from(rawIndex);
  const rawFaces = mesh.faceID || mesh.faceIDs || null;
  const fin = dropPlanarFins(positions, indicesIn, rawFaces);
  const indices = fin.indices;
  const nKept = Math.floor(indices.length / 3);
  const triSource = triangleSources(mesh, fin.keep, nKept);
  const graph = buildPartGraphPatches({
    positions,
    indices,
    faceIDs: fin.faceIDs && fin.faceIDs.length ? fin.faceIDs : null,
    triSource,
    featureTessellation: mesh.featureTessellation || null,
  });
  const faces = faceFingerprints(graph, triSource, { positions, indices });
  if (!faces.length) return null;
  const axes = [];
  const patches = graph?.patches || [];
  for (let i = 0; i < patches.length; i += 1) {
    const axis = fitPatchAxis(positions, indices, patches[i]?.tris);
    if (axis) axes.push(axis);
  }
  const out = { faces };
  if (axes.length) out.axes = axes;
  return out;
}

/**
 * Catalogs for a refresh. A failed run is marked failed and its leftover
 * mesh is not read. A hidden part uses the cached solid. A mesh that yields
 * no fingerprints stays unresolved so the confirmed key is not dropped.
 * Planes come from the part script: origins always, plus workplanes and
 * sketch planes. They stay on an unresolved mesh so a plane joint can
 * still resolve.
 */
export function catalogsFromRuns({ parts, runs, leftovers, scripts } = {}) {
  const catalogs = {};
  for (const part of parts || []) {
    const sid = partSurfId(part);
    if (!sid) continue;
    const run = runs?.[part.id];
    const failed = !!(
      run
      && run.ok === false
      && !run.empty
      && !run.skipped
      && !run.missing
    );
    if (failed) {
      catalogs[sid] = { failed: true };
      continue;
    }
    const hidden = part.visible === false;
    const planes = jointPlanesFromScript(scripts?.[part.id]);
    const mesh = hidden ? leftovers?.[part.id] : (run?.ok ? run.mesh : null);
    const built = catalogFromMeshData(mesh);
    if (!built) {
      catalogs[sid] = { unresolved: true, hidden, planes };
      continue;
    }
    catalogs[sid] = { ...built, hidden, planes };
  }
  return catalogs;
}
