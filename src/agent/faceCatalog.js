import { faceColorKey } from '../utils/faceColorMatch.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { resolveViewportFaceClick } from '../utils/selectFace.js';
import { fitJointAxis } from '../utils/jointResolve.js';
import { faceMetricsFromIndices } from './jointFaceExpand.js';

/** Per-triangle Manifold face ids from a BufferGeometry, when present. */
export function faceIDsForGeometry(geometry) {
  const attr = geometry?.getAttribute?.('faceID');
  const arr = attr?.array;
  return arr?.length ? arr : null;
}

function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-12)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function canonicalAxisDir(dir) {
  const d = unit(dir);
  if (!d) return null;
  const flip = d[2] < 0 || (Math.abs(d[2]) < 1e-6 && (d[1] < 0 || (Math.abs(d[1]) < 1e-6 && d[0] < 0)));
  return flip ? [-d[0], -d[1], -d[2]] : d;
}

function axisSig(axis) {
  if (!axis?.dir || !(Number(axis.radius) > 0)) return null;
  const d = canonicalAxisDir(axis.dir);
  const r = Math.round(Number(axis.radius) * 1e6) / 1e6;
  return `${r}:${d[0].toFixed(5)},${d[1].toFixed(5)},${d[2].toFixed(5)}`;
}

function axesCompatible(a, b) {
  if (!a || !b) return false;
  return axisSig(a) === axisSig(b);
}

function mergeTris(into, tris) {
  for (const t of tris || []) into.add(t);
}

/** When fitJointAxis fails on tessellated walls, fit a simple cylinder to the points. */
function fallbackCylinderAxis(positions, indexArr, tris) {
  if (!tris?.length || !positions || !indexArr) return null;
  const seen = new Set();
  const pts = [];
  for (let i = 0; i < tris.length; i += 1) {
    const t = tris[i];
    for (let k = 0; k < 3; k += 1) {
      const vi = indexArr[t * 3 + k];
      if (seen.has(vi)) continue;
      seen.add(vi);
      pts.push([positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]]);
    }
  }
  if (pts.length < 6) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= pts.length;
  cy /= pts.length;
  cz /= pts.length;
  let spanX = 0;
  let spanY = 0;
  let spanZ = 0;
  for (const p of pts) {
    spanX = Math.max(spanX, Math.abs(p[0] - cx));
    spanY = Math.max(spanY, Math.abs(p[1] - cy));
    spanZ = Math.max(spanZ, Math.abs(p[2] - cz));
  }
  let dir = [0, 0, 1];
  if (spanX >= spanY && spanX >= spanZ) dir = [1, 0, 0];
  else if (spanY >= spanZ) dir = [0, 1, 0];
  const radial = (p) => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const along = dx * dir[0] + dy * dir[1] + dz * dir[2];
    const px = dx - along * dir[0];
    const py = dy - along * dir[1];
    const pz = dz - along * dir[2];
    return Math.hypot(px, py, pz);
  };
  let radius = 0;
  for (const p of pts) radius += radial(p);
  radius /= pts.length;
  if (!(radius > 0.5)) return null;
  return { at: [cx, cy, cz], dir, radius };
}

function rowFromIndices(geometry, indices, selectionMode, kind, positions, indexArr, axisHint = null) {
  const metrics = faceMetricsFromIndices(geometry, indices, selectionMode);
  if (!metrics) return null;
  let axis = axisHint || null;
  if (!axis && kind === 'cylindrical' && positions && indexArr && indices.length >= 4) {
    axis = fitJointAxis(positions, indexArr, indices)
      || fallbackCylinderAxis(positions, indexArr, indices);
  }
  return {
    tris: indices,
    at: metrics.center,
    n: metrics.normal,
    area: metrics.area,
    kind: axis ? 'cylindrical' : kind,
    axis,
  };
}

function isCylindricalCandidate(face, positions, index) {
  const nz = Math.abs(face.n?.[2] ?? 0);
  if (nz > 0.85) return false;
  const tris = face.tris || [];
  if (tris.length >= 4 && fitJointAxis(positions, index, tris)) return true;
  // Tessellated cylinder walls are many small coplanar facets (graph kind planar).
  if (nz < 0.45) {
    const area = Number(face.area) || 0;
    if (area > 250) return false;
    return true;
  }
  return false;
}

function isPlanarPatch(face, positions, index) {
  if (isCylindricalCandidate(face, positions, index)) return false;
  const nz = Math.abs(face.n?.[2] ?? 0);
  if (nz > 0.85) return true;
  if (face?.kind === 'planar') return true;
  return nz >= 0.45;
}

function mergePlanarByFaceId(raw, geometry, ids) {
  const positions = geometry?.attributes?.position?.array;
  const index = geometry?.index?.array;
  const groups = new Map();
  for (const face of raw) {
    if (positions && index && !isPlanarPatch(face, positions, index)) continue;
    const seed = face.tris?.[0];
    const fid = (ids && seed != null && Number.isFinite(ids[seed]))
      ? ids[seed]
      : `patch:${face.id ?? seed}`;
    let group = groups.get(fid);
    if (!group) {
      group = { tris: new Set(), seedN: face.n };
      groups.set(fid, group);
    }
    mergeTris(group.tris, face.tris);
  }
  const rows = [];
  for (const group of groups.values()) {
    const tris = [...group.tris].sort((a, b) => a - b);
    if (!tris.length) continue;
    const resolved = resolveViewportFaceClick({
      geometry,
      seedFaceIndex: tris[0],
      faceNormal: group.seedN,
      clickCount: 1,
      faceIDs: ids,
      legacy: false,
    });
    const indices = resolved.indices?.length ? resolved.indices : tris;
    const row = rowFromIndices(
      geometry,
      indices,
      resolved.selectionMode,
      resolved.kind || 'planar',
      positions,
      index,
    );
    if (row) rows.push(row);
  }
  return rows;
}

function mergeWallsByAxis(raw, geometry) {
  const positions = geometry?.attributes?.position?.array;
  const index = geometry?.index?.array;
  if (!positions || !index) return [];

  const candidates = raw.filter((face) => isCylindricalCandidate(face, positions, index));
  const allTris = new Set();
  for (const face of candidates) mergeTris(allTris, face.tris);
  const combined = [...allTris];
  if (combined.length >= 4) {
    const axisAll = fitJointAxis(positions, index, combined)
      || fallbackCylinderAxis(positions, index, combined);
    if (axisAll) {
      const row = rowFromIndices(
        geometry,
        combined,
        'angular-tolerance',
        'cylindrical',
        positions,
        index,
        axisAll,
      );
      if (row) return [row];
    }
  }

  const groups = [];
  for (const face of candidates) {
    const ft = face.tris || [];
    if (!ft.length) continue;
    let placed = false;
    for (const group of groups) {
      const merged = [...group.tris, ...ft];
      if (merged.length < 4) continue;
      const ax = fitJointAxis(positions, index, merged);
      if (!ax) continue;
      if (!group.axis || axesCompatible(group.axis, ax)) {
        group.tris = merged;
        group.axis = ax;
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({
        tris: [...ft],
        axis: ft.length >= 4 ? fitJointAxis(positions, index, ft) : null,
      });
    }
  }

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const union = [...groups[i].tris, ...groups[j].tris];
        if (union.length < 4) continue;
        const ax = fitJointAxis(positions, index, union);
        if (!ax) continue;
        if (axesCompatible(groups[i].axis || ax, ax) && axesCompatible(groups[j].axis || ax, ax)) {
          groups[i] = { tris: union, axis: ax };
          groups.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  const rows = [];
  for (const group of groups) {
    if (!group.tris?.length) continue;
    const row = rowFromIndices(
      geometry,
      group.tris,
      'angular-tolerance',
      'cylindrical',
      positions,
      index,
      group.axis,
    );
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * One fingerprint per analytic surface — tessellation facets merge like a viewport tap.
 */
export function agentFaceFingerprints(geometry, faceIDs) {
  const raw = fingerprintsFromGeometry(geometry, faceIDs);
  if (!raw.length || !geometry) return raw;

  const ids = faceIDs || faceIDsForGeometry(geometry);
  const planar = mergePlanarByFaceId(raw, geometry, ids);
  const walls = mergeWallsByAxis(raw, geometry);
  const out = [...planar, ...walls].map((row, i) => ({ id: i, ...row }));

  return out.length ? out : raw;
}

/**
 * Agent face catalog: one row per analytic surface (merged tessellation facets).
 */
export function catalogFingerprintsForAgent(geometry, faceIDs) {
  const ids = faceIDs || faceIDsForGeometry(geometry);
  return agentFaceFingerprints(geometry, ids);
}

export function agentFaceKey(face) {
  return faceColorKey(face);
}
