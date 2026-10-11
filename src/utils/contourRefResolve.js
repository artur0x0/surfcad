/**
 * Re-resolve contour references against rebuilt boundary edges.
 *
 * A match is the unordered face pair. The midpoint separates two edges
 * that share that pair: only an edge within 0.001 mm is that one. A single
 * edge with the pair follows a move, and its midpoint is rewritten with the
 * geom. A different pair is never a match, even when its midpoint is nearer.
 *
 * A miss keeps the cached geom and sets broken. The statement is not
 * rewritten. A vertex follows its edge. A face whose bound edge is missing,
 * or whose loop no longer has the same boundary, stays on the cached loop.
 * solveContour stays pure: this module does not read a mesh.
 */

import { emitSolveContour } from './contourScript.js';
import { projectPoint, projectReference } from './contourRef.js';
import { chainSegments } from './contourRefPick.js';
import { upsertNamedContour } from './namedContour.js';
import { listSavedContours } from './savedContours.js';

const MID_TOL_MM = 1e-3;

function dist3(a, b) {
  return Math.hypot((a?.[0] || 0) - (b?.[0] || 0), (a?.[1] || 0) - (b?.[1] || 0), (a?.[2] || 0) - (b?.[2] || 0));
}

function dist2(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a[0] || 0) - (b[0] || 0), (a[1] || 0) - (b[1] || 0));
}

function round4(n) {
  const r = Math.round(Number(n) * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}

function pairKey(a, b) {
  const lo = Math.min(Number(a), Number(b));
  const hi = Math.max(Number(a), Number(b));
  return `${lo}:${hi}`;
}

function cloneGeom(geom) {
  if (!geom || typeof geom !== 'object') return geom;
  if (geom.kind === 'line') return { kind: 'line', a: geom.a.slice(), b: geom.b.slice() };
  if (geom.kind === 'point') return { kind: 'point', at: geom.at.slice() };
  if (geom.kind === 'polyline') return { kind: 'polyline', points: geom.points.map((p) => p.slice()) };
  if (geom.kind === 'arc') {
    const copy = { kind: 'arc', center: geom.center.slice(), radius: geom.radius, sweep: geom.sweep };
    if (geom.full) copy.full = true;
    if (geom.start != null) copy.start = geom.start;
    if (geom.end != null) copy.end = geom.end;
    return copy;
  }
  return geom;
}

function cloneRef(ref) {
  const copy = { ...ref };
  if (Array.isArray(ref.mid)) copy.mid = ref.mid.slice();
  if (ref.boundary) {
    copy.boundary = {
      faceA: ref.boundary.faceA,
      faceB: ref.boundary.faceB,
      mid: ref.boundary.mid.slice(),
    };
  }
  if (ref.geom) copy.geom = cloneGeom(ref.geom);
  if (Array.isArray(ref.loop)) copy.loop = ref.loop.map((p) => p.slice());
  return copy;
}

function keepBroken(ref) {
  const copy = cloneRef(ref);
  copy.broken = true;
  return copy;
}

function boundaryWorld(edge) {
  const chains = chainSegments(edge?.segments || []);
  return chains[0] || null;
}

/**
 * The boundary with this face pair. One edge follows a move. Two edges
 * that share the pair match only the stored midpoint, so a neighbour is
 * not a retarget.
 * @returns {object|null}
 */
export function matchBoundaryEdge(edges, faceA, faceB, mid) {
  if (faceA == null || faceB == null || !Array.isArray(mid)) return null;
  const key = pairKey(faceA, faceB);
  const same = (edges || []).filter((edge) => pairKey(edge?.faceA, edge?.faceB) === key);
  if (!same.length) return null;
  if (same.length === 1) return same[0];
  return same.find((edge) => dist3(edge.mid, mid) <= MID_TOL_MM) || null;
}

function projectChain(plane, world) {
  try {
    return projectReference(plane, world);
  } catch {
    return null;
  }
}

function projectUv(plane, world) {
  try {
    return projectPoint(plane, world);
  } catch {
    return null;
  }
}

function loopOf(edges, plane) {
  const segments = [];
  for (const edge of edges) {
    for (const seg of edge.segments || []) segments.push(seg);
  }
  const chains = chainSegments(segments);
  if (!chains.length) return null;
  let best = chains[0];
  for (const chain of chains) {
    if (chain.length > best.length) best = chain;
  }
  const loop = [];
  for (const point of best) {
    const uv = projectUv(plane, point);
    if (!uv) return null;
    loop.push(uv);
  }
  return loop.length >= 2 ? loop : null;
}

function loopClosed(pts) {
  return Array.isArray(pts) && pts.length >= 2 && dist2(pts[0], pts[pts.length - 1]) <= MID_TOL_MM;
}

/** A different point count or a loop that opened is a missing boundary. */
function sameBoundaryLoop(cached, next) {
  if (!Array.isArray(cached) || cached.length < 2) return true;
  if (!Array.isArray(next) || next.length !== cached.length) return false;
  return loopClosed(cached) === loopClosed(next);
}

function roundedGeom(geom) {
  if (!geom) return null;
  if (geom.kind === 'line') return { kind: 'line', a: geom.a.map(round4), b: geom.b.map(round4) };
  if (geom.kind === 'point') return { kind: 'point', at: geom.at.map(round4) };
  if (geom.kind === 'polyline') return { kind: 'polyline', points: geom.points.map((p) => p.map(round4)) };
  if (geom.kind === 'arc') {
    return {
      kind: 'arc',
      center: geom.center.map(round4),
      radius: round4(geom.radius),
      sweep: geom.sweep,
      full: !!geom.full,
      start: geom.start == null ? null : round4(geom.start),
      end: geom.end == null ? null : round4(geom.end),
    };
  }
  return geom;
}

function sameLive(prev, next) {
  const mid = JSON.stringify((prev.mid || []).map(round4)) === JSON.stringify((next.mid || []).map(round4));
  const geom = JSON.stringify(roundedGeom(prev.geom)) === JSON.stringify(roundedGeom(next.geom));
  const loop = JSON.stringify((prev.loop || []).map((p) => p.map(round4)))
    === JSON.stringify((next.loop || []).map((p) => p.map(round4)));
  const boundary = JSON.stringify((prev.boundary?.mid || []).map(round4))
    === JSON.stringify((next.boundary?.mid || []).map(round4));
  const wasBroken = !!prev.broken;
  const nowBroken = !!next.broken;
  return mid && geom && loop && boundary && wasBroken === nowBroken;
}

function resolveEdge(ref, edges, plane) {
  const hit = matchBoundaryEdge(edges, ref.faceA, ref.faceB, ref.mid);
  if (!hit) return keepBroken(ref);
  const world = boundaryWorld(hit);
  const projected = world && world.length >= 2 ? projectChain(plane, world) : null;
  if (!projected?.geom || projected.broken) return keepBroken(ref);
  const copy = cloneRef(ref);
  delete copy.broken;
  copy.mid = hit.mid.slice();
  copy.geom = projected.geom;
  return copy;
}

function resolveVertex(ref, edges, plane) {
  const hit = matchBoundaryEdge(edges, ref.faceA, ref.faceB, ref.mid);
  if (!hit) return keepBroken(ref);
  const world = boundaryWorld(hit);
  if (!world || world.length < 2) return keepBroken(ref);
  if (dist3(world[0], world[world.length - 1]) <= MID_TOL_MM) return keepBroken(ref);
  const edgeProjected = projectChain(plane, world);
  if (!edgeProjected?.geom || edgeProjected.broken) return keepBroken(ref);
  const end = Number(ref.end) === 1 ? 1 : 0;
  const at = end === 0 ? world[0] : world[world.length - 1];
  const projected = projectChain(plane, [at]);
  if (!projected?.geom || projected.geom.kind !== 'point') return keepBroken(ref);
  const copy = cloneRef(ref);
  delete copy.broken;
  copy.mid = hit.mid.slice();
  copy.end = end;
  copy.geom = projected.geom;
  return copy;
}

function resolveFace(ref, edges, plane) {
  const bound = ref.boundary;
  if (!bound) return keepBroken(ref);
  const hit = matchBoundaryEdge(edges, bound.faceA, bound.faceB, bound.mid);
  const owned = (edges || []).filter((edge) => (
    Number(edge?.faceA) === Number(ref.faceId) || Number(edge?.faceB) === Number(ref.faceId)
  ));
  if (!hit || !owned.includes(hit)) return keepBroken(ref);
  const world = boundaryWorld(hit);
  const projected = world && world.length >= 2 ? projectChain(plane, world) : null;
  if (!projected?.geom || projected.broken) return keepBroken(ref);
  const loop = loopOf(owned, plane);
  if (!loop || !sameBoundaryLoop(ref.loop, loop)) return keepBroken(ref);
  const copy = cloneRef(ref);
  delete copy.broken;
  copy.boundary = { faceA: hit.faceA, faceB: hit.faceB, mid: hit.mid.slice() };
  copy.geom = projected.geom;
  copy.loop = loop;
  return copy;
}

function resolveOne(ref, edges, plane) {
  if (!ref) return keepBroken(ref || { broken: true });
  if (ref.kind === 'vertex') return resolveVertex(ref, edges, plane);
  if (ref.kind === 'face') return resolveFace(ref, edges, plane);
  return resolveEdge(ref, edges, plane);
}

/**
 * Project every ref. With no mesh, each one is broken and the cached geom
 * stays; `pendingMesh` tells the caller not to soft-fail a run and not to
 * write the statement.
 *
 * @returns {{ spec: object, broken: boolean, changed: boolean, pendingMesh?: boolean }}
 */
export function resolveContourSpec(spec, edges, plane, { meshReady = false } = {}) {
  const refs = Array.isArray(spec?.refs) ? spec.refs : [];
  if (!refs.length) return { spec, broken: false, changed: false };
  if (!meshReady || !plane?.center) {
    return {
      spec: { ...spec, refs: refs.map(keepBroken) },
      broken: true,
      changed: false,
      pendingMesh: !meshReady || !plane?.center,
    };
  }
  const next = refs.map((ref) => resolveOne(ref, edges, plane));
  const broken = next.some((ref) => ref.broken);
  const changed = next.some((ref, i) => !sameLive(refs[i], ref));
  return { spec: { ...spec, refs: next }, broken, changed };
}

/**
 * Match every saved contour that carries refs.
 * A broken reference leaves the buffer alone. A successful geom change
 * rewrites that contour statement.
 *
 * @returns {{ ok: boolean, buffer: string, changed: boolean, broken: string[], displays: object[], message: string|null, skipped?: boolean }}
 */
export function resolveContourScript(buffer, edges, { meshReady = false } = {}) {
  const text = String(buffer || '');
  const saved = listSavedContours(text);
  const displays = [];
  const brokenNames = [];
  const pending = [];
  for (const row of saved) {
    const spec = row?.params?.contour;
    if (!spec?.refs?.length) continue;
    const outcome = resolveContourSpec(spec, edges, row.plane, { meshReady });
    displays.push({
      id: row.id,
      name: row.name,
      refs: outcome.spec.refs,
      broken: !!outcome.broken && !outcome.pendingMesh,
    });
    if (!meshReady) continue;
    if (!row.plane?.center) continue;
    if (outcome.pendingMesh) continue;
    if (outcome.broken) brokenNames.push(row.name);
    else if (outcome.changed) pending.push({ row, spec: outcome.spec });
  }
  if (!meshReady) {
    return {
      ok: true,
      skipped: true,
      buffer: text,
      changed: false,
      broken: [],
      displays,
      message: null,
    };
  }
  if (brokenNames.length) {
    return {
      ok: false,
      buffer: text,
      changed: false,
      broken: brokenNames,
      displays,
      message: brokenNames.map((name) => `${name} reference is broken`).join('. '),
    };
  }
  let next = text;
  let changed = false;
  for (const item of pending) {
    let profile;
    try {
      profile = emitSolveContour(item.spec);
    } catch {
      continue;
    }
    const written = upsertNamedContour(next, {
      id: item.row.id,
      name: item.row.name,
      frame: item.row.plane,
      profileExpr: profile,
    });
    if (!written.ok) continue;
    next = written.buffer;
    changed = true;
  }
  return {
    ok: true,
    buffer: next,
    changed,
    broken: [],
    displays,
    message: null,
  };
}
