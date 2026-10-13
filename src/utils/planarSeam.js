/**
 * A fillet boolean can leave a needle between two copies of a cap vertex.
 * The needle is about 0.001mm tall, its normal is sideways, and flat shading
 * draws it as a seam through the face. On a bent sheet the same needle is
 * shorter than a bend chord (~0.9 mm), not the long ruling of a box edge.
 * It is not the curved blend.
 *
 * Drop it from the drawn mesh only when every vertex already lies on another
 * triangle of that face. A thin fillet facet is the only cover of its own
 * surface, so it stays.
 */

const FIN_HEIGHT_MM = 0.002;
// The height test is what keeps a real fillet facet: that facet is the only
// cover of its surface and it is taller than FIN_HEIGHT_MM. A 1 mm floor
// left bend-chord needles, and a 0.05 mm floor still left the tangency
// needles on a sheet-thickness fillet (longest edge about 0.03 mm). Those
// already lie on the wall. Flat shading draws them as a seam.
const FIN_MIN_EDGE_MM = 0.005;
const COVER_MM = 0.02;
const COVER_AREA = 0.05;

function triSpan(positions, indices, t) {
  const i0 = indices[t * 3];
  const i1 = indices[t * 3 + 1];
  const i2 = indices[t * 3 + 2];
  const ax = positions[i1 * 3] - positions[i0 * 3];
  const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
  const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
  const bx = positions[i2 * 3] - positions[i0 * 3];
  const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
  const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const area = 0.5 * Math.hypot(cx, cy, cz);
  const e12x = positions[i2 * 3] - positions[i1 * 3];
  const e12y = positions[i2 * 3 + 1] - positions[i1 * 3 + 1];
  const e12z = positions[i2 * 3 + 2] - positions[i1 * 3 + 2];
  const longest = Math.sqrt(Math.max(
    ax * ax + ay * ay + az * az,
    bx * bx + by * by + bz * bz,
    e12x * e12x + e12y * e12y + e12z * e12z,
  ));
  return { area, longest, i0, i1, i2 };
}

/** Long triangle shorter than FIN_HEIGHT_MM. The curved fillet is taller. */
export function isPlanarFin(positions, indices, t) {
  const span = triSpan(positions, indices, t);
  if (!(span.longest > FIN_MIN_EDGE_MM)) return false;
  const height = (2 * span.area) / span.longest;
  return height < FIN_HEIGHT_MM;
}

function distPointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);

  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(ax + v * abx - px, ay + v * aby - py, az + v * abz - pz);
  }

  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(ax + w * acx - px, ay + w * acy - py, az + w * acz - pz);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Math.hypot(
      bx + w * (cx - bx) - px,
      by + w * (cy - by) - py,
      bz + w * (cz - bz) - pz,
    );
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return Math.hypot(
    ax + abx * v + acx * w - px,
    ay + aby * v + acy * w - py,
    az + abz * v + acz * w - pz,
  );
}

function coverBuckets(covers) {
  const cell = 4;
  const inv = 1 / cell;
  const buckets = new Map();
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    const x0 = Math.floor(c.minX * inv);
    const x1 = Math.floor(c.maxX * inv);
    const y0 = Math.floor(c.minY * inv);
    const y1 = Math.floor(c.maxY * inv);
    const z0 = Math.floor(c.minZ * inv);
    const z1 = Math.floor(c.maxZ * inv);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const key = `${x}|${y}|${z}`;
          let list = buckets.get(key);
          if (!list) {
            list = [];
            buckets.set(key, list);
          }
          list.push(c);
        }
      }
    }
  }
  return { buckets, inv };
}

function posAt(positions, i) {
  if (typeof positions.getX === 'function') {
    return [positions.getX(i), positions.getY(i), positions.getZ(i)];
  }
  const o = i * 3;
  return [positions[o], positions[o + 1], positions[o + 2]];
}

/**
 * Outline of a highlighted face, as flat xyz pairs: only the true boundary
 * of the picked region.
 *
 * Index edges lie about that boundary. A boolean leaves copies of a vertex
 * (split verts), and `dropPlanarFins` removes zero-width needles, leaving
 * T-junctions: either way an interior diagonal has one picked triangle per
 * index edge. So:
 *   1. Weld picked vertices within OUTLINE_WELD_MM so split copies of one
 *      vertex are one id. Several raw edges can share that key: a
 *      duplicate-vertex seam, or a sliver whose real boundary welds onto a
 *      neighbour's diagonal (the loft cap's corner sits 0.006 mm off the
 *      edge, inside this weld).
 *   2. A raw edge is boundary when the point OUTLINE_SIDE_MM past its
 *      midpoint (in the owner's plane, away from the owner) is not on
 *      another picked triangle — a neighbour that shares an endpoint counts
 *      (the old check skipped it and drew the needle's diagonal) — and its
 *      midpoint is not on a picked triangle that has neither endpoint and
 *      reaches past the edge (an overlapping duplicate-vertex seam; a sliver
 *      fanned along the inside does not). The key is drawn if any of its raw
 *      edges still clears that test. Skipping the key whenever more than one
 *      triangle touched it hid the sliver's boundary, so the rectangle
 *      outline stopped mid-side. When only one end of the sliver welds,
 *      the sliver and the real side stay two keys and can both draw, a
 *      few thousandths of a millimetre apart.
 *
 * `positions` is a tightly packed xyz array or a three.js BufferAttribute.
 */
const OUTLINE_WELD_MM = COVER_MM;
const OUTLINE_SIDE_MM = COVER_MM;
/** Side point hits a neighbour across a curved seam up to ~30° (sin 30° · side). */
const OUTLINE_PAST_MM = 1e-4;
const OUTLINE_SIDE_TOL_MM = COVER_MM * 0.5;

export function highlightBoundaryPositions(positions, index, faceIndices) {
  if (!positions || !index || !faceIndices?.length) return [];
  // 1. Weld the picked vertices.
  const weldInv = 1 / OUTLINE_WELD_MM;
  const weld2 = OUTLINE_WELD_MM * OUTLINE_WELD_MM;
  const cells = new Map();
  const canon = new Map();
  const canonPos = [];
  const weldOf = (vi) => {
    let id = canon.get(vi);
    if (id !== undefined) return id;
    const p = posAt(positions, vi);
    const cx = Math.floor(p[0] * weldInv);
    const cy = Math.floor(p[1] * weldInv);
    const cz = Math.floor(p[2] * weldInv);
    for (let dx = -1; dx <= 1 && id === undefined; dx++) {
      for (let dy = -1; dy <= 1 && id === undefined; dy++) {
        for (let dz = -1; dz <= 1 && id === undefined; dz++) {
          const list = cells.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const q = canonPos[list[i]];
            const ex = q[0] - p[0];
            const ey = q[1] - p[1];
            const ez = q[2] - p[2];
            if (ex * ex + ey * ey + ez * ez <= weld2) { id = list[i]; break; }
          }
        }
      }
    }
    if (id === undefined) {
      id = canonPos.length;
      canonPos.push(p);
      const key = `${cx}|${cy}|${cz}`;
      let list = cells.get(key);
      if (!list) {
        list = [];
        cells.set(key, list);
      }
      list.push(id);
    }
    canon.set(vi, id);
    return id;
  };

  const edges = new Map();
  const covers = [];
  const pad = COVER_MM;
  for (let f = 0; f < faceIndices.length; f++) {
    const t = faceIndices[f];
    const base = t * 3;
    const i0 = index[base];
    const i1 = index[base + 1];
    const i2 = index[base + 2];
    const a = posAt(positions, i0);
    const b = posAt(positions, i1);
    const c = posAt(positions, i2);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 2e-8)) continue; // zero-area: no boundary of its own
    const cover = {
      f,
      i0, i1, i2,
      ax: a[0], ay: a[1], az: a[2],
      bx: b[0], by: b[1], bz: b[2],
      cx: c[0], cy: c[1], cz: c[2],
      nx: nx / nl, ny: ny / nl, nz: nz / nl,
      minX: Math.min(a[0], b[0], c[0]) - pad,
      maxX: Math.max(a[0], b[0], c[0]) + pad,
      minY: Math.min(a[1], b[1], c[1]) - pad,
      maxY: Math.max(a[1], b[1], c[1]) + pad,
      minZ: Math.min(a[2], b[2], c[2]) - pad,
      maxZ: Math.max(a[2], b[2], c[2]) + pad,
    };
    covers.push(cover);
    const w = [weldOf(i0), weldOf(i1), weldOf(i2)];
    const raw = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const u = w[k];
      const v = w[(k + 1) % 3];
      if (u === v) continue;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      const piece = { cover, ia: raw[k], ib: raw[(k + 1) % 3], opp: raw[(k + 2) % 3], t };
      const rec = edges.get(key);
      if (!rec) edges.set(key, { pieces: [piece] });
      else rec.pieces.push(piece);
    }
  }

  const grid = coverBuckets(covers);
  const tol = OUTLINE_SIDE_TOL_MM;
  const coveredByOther = (px, py, pz, owner) => {
    const list = grid.buckets.get(`${Math.floor(px * grid.inv)}|${Math.floor(py * grid.inv)}|${Math.floor(pz * grid.inv)}`);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === owner) continue;
      if (px < c.minX || px > c.maxX || py < c.minY || py > c.maxY || pz < c.minZ || pz > c.maxZ) continue;
      if (distPointTri(px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, c.cx, c.cy, c.cz) <= tol) return true;
    }
    return false;
  };

  const cover2 = COVER_MM * COVER_MM;
  const midpointOnOther = (px, py, pz, ia, ib, sx, sy, sz) => {
    const list = grid.buckets.get(`${Math.floor(px * grid.inv)}|${Math.floor(py * grid.inv)}|${Math.floor(pz * grid.inv)}`);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.i0 === ia || c.i1 === ia || c.i2 === ia || c.i0 === ib || c.i1 === ib || c.i2 === ib) continue;
      if (px < c.minX || px > c.maxX || py < c.minY || py > c.maxY || pz < c.minZ || pz > c.maxZ) continue;
      // It must reach past the edge (an overlapping copy), not be a sliver
      // fanned along the inside of a true boundary.
      const out0 = (c.ax - px) * sx + (c.ay - py) * sy + (c.az - pz) * sz;
      const out1 = (c.bx - px) * sx + (c.by - py) * sy + (c.bz - pz) * sz;
      const out2 = (c.cx - px) * sx + (c.cy - py) * sy + (c.cz - pz) * sz;
      if (Math.max(out0, out1, out2) <= OUTLINE_PAST_MM) continue;
      const dd = distPointTri(px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, c.cx, c.cy, c.cz);
      if (dd * dd <= cover2) return true;
    }
    return false;
  };

  // True boundary of one raw edge, or null when the side tests say it is
  // inside the picked face. Returns the segment plus how far its midpoint
  // sits outside the owner, so a sliver can prefer the outer edge.
  const boundaryPiece = (piece) => {
    const a = posAt(positions, piece.ia);
    const b = posAt(positions, piece.ib);
    const o = posAt(positions, piece.opp);
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const ez = b[2] - a[2];
    const el = Math.hypot(ex, ey, ez);
    if (!(el > 1e-9)) return null;
    const c = piece.cover;
    // In-plane normal to the edge, pointing away from the owner triangle.
    let sx = c.ny * ez - c.nz * ey;
    let sy = c.nz * ex - c.nx * ez;
    let sz = c.nx * ey - c.ny * ex;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl;
    sy /= sl;
    sz /= sl;
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const mz = (a[2] + b[2]) * 0.5;
    if ((o[0] - mx) * sx + (o[1] - my) * sy + (o[2] - mz) * sz > 0) {
      sx = -sx;
      sy = -sy;
      sz = -sz;
    }
    const d = OUTLINE_SIDE_MM;
    if (coveredByOther(mx + sx * d, my + sy * d, mz + sz * d, c)) return null;
    // A duplicate-vertex seam whose other copy overlaps this edge: the
    // midpoint already lies on a picked triangle that has neither endpoint.
    if (midpointOnOther(mx, my, mz, piece.ia, piece.ib, sx, sy, sz)) return null;
    const ox = (c.ax + c.bx + c.cx) / 3;
    const oy = (c.ay + c.by + c.cy) / 3;
    const oz = (c.az + c.bz + c.cz) / 3;
    const outward = (mx - ox) * sx + (my - oy) * sy + (mz - oz) * sz;
    return { seg: [a[0], a[1], a[2], b[0], b[1], b[2]], outward };
  };

  const kept = [];
  for (const rec of edges.values()) {
    // Several raw edges can weld to one key: a duplicate-vertex seam (two
    // triangles, both fail the side test) or a sliver whose boundary welds
    // onto a neighbour's diagonal (the boundary passes, the diagonal does
    // not). Draw the raw edge that still clears the side test. Counting
    // owners and skipping n≠1 hid that boundary — the loft rectangle stopped
    // mid-side.
    let best = null;
    for (let i = 0; i < rec.pieces.length; i++) {
      const hit = boundaryPiece(rec.pieces[i]);
      if (!hit) continue;
      if (!best || hit.outward > best.outward) best = hit;
    }
    if (best) kept.push(best.seg);
  }
  const out = [];
  for (let i = 0; i < kept.length; i++) out.push(...kept[i]);
  return out;
}

function vertexOnCover(positions, buckets, inv, vi) {
  const px = positions[vi * 3];
  const py = positions[vi * 3 + 1];
  const pz = positions[vi * 3 + 2];
  const list = buckets.get(`${Math.floor(px * inv)}|${Math.floor(py * inv)}|${Math.floor(pz * inv)}`);
  if (!list) return false;
  const cover2 = COVER_MM * COVER_MM;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (px < c.minX || px > c.maxX || py < c.minY || py > c.maxY || pz < c.minZ || pz > c.maxZ) continue;
    const d = distPointTri(px, py, pz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, c.cx, c.cy, c.cz);
    if (d * d <= cover2) return true;
  }
  return false;
}

/**
 * Drop planar-seam fins from a drawn mesh. `positions` is tightly packed xyz.
 * A fin is dropped only when each vertex already lies on another triangle of
 * real area, so the face under it is unchanged. Face ids stay aligned with
 * the kept triangles; `keep` lists the source triangle of each kept one.
 * Returns the same index array when there is nothing to drop.
 */
export function dropPlanarFins(positions, indices, faceIDs = null) {
  const nTri = Math.floor(indices.length / 3);
  const spans = new Array(nTri);
  const fin = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const span = triSpan(positions, indices, t);
    spans[t] = span;
    if (span.longest > FIN_MIN_EDGE_MM && (2 * span.area) / span.longest < FIN_HEIGHT_MM) fin[t] = 1;
  }
  let nFin = 0;
  for (let t = 0; t < nTri; t++) if (fin[t]) nFin++;
  if (!nFin) return { indices, faceIDs, dropped: 0 };

  const pad = COVER_MM;
  const covers = [];
  for (let t = 0; t < nTri; t++) {
    if (fin[t] || spans[t].area <= COVER_AREA) continue;
    const i0 = spans[t].i0;
    const i1 = spans[t].i1;
    const i2 = spans[t].i2;
    const ax = positions[i0 * 3];
    const ay = positions[i0 * 3 + 1];
    const az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3];
    const by = positions[i1 * 3 + 1];
    const bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3];
    const cy = positions[i2 * 3 + 1];
    const cz = positions[i2 * 3 + 2];
    covers.push({
      ax, ay, az, bx, by, bz, cx, cy, cz,
      minX: Math.min(ax, bx, cx) - pad,
      maxX: Math.max(ax, bx, cx) + pad,
      minY: Math.min(ay, by, cy) - pad,
      maxY: Math.max(ay, by, cy) + pad,
      minZ: Math.min(az, bz, cz) - pad,
      maxZ: Math.max(az, bz, cz) + pad,
    });
  }

  const grid = coverBuckets(covers);
  const keep = [];
  for (let t = 0; t < nTri; t++) {
    if (!fin[t]) {
      keep.push(t);
      continue;
    }
    const span = spans[t];
    const covered = vertexOnCover(positions, grid.buckets, grid.inv, span.i0)
      && vertexOnCover(positions, grid.buckets, grid.inv, span.i1)
      && vertexOnCover(positions, grid.buckets, grid.inv, span.i2);
    if (!covered) keep.push(t);
  }
  if (keep.length === nTri) return { indices, faceIDs, dropped: 0 };
  const next = new Uint32Array(keep.length * 3);
  const fids = faceIDs && faceIDs.length ? new Array(keep.length) : null;
  for (let i = 0; i < keep.length; i++) {
    const t = keep[i];
    next[i * 3] = indices[t * 3];
    next[i * 3 + 1] = indices[t * 3 + 1];
    next[i * 3 + 2] = indices[t * 3 + 2];
    if (fids) fids[i] = faceIDs[t];
  }
  return { indices: next, faceIDs: fids, dropped: nTri - keep.length, keep };
}
