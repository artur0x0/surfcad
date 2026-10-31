/**
 * Closed-mesh volume. The signed sum of scalar triples, in mm³, divided by
 * 6, then by 1000 to reach cm³. Winding either way is the same volume.
 */

function coordsOf(positions) {
  if (ArrayBuffer.isView(positions) || Array.isArray(positions)) return positions;
  if (positions && (ArrayBuffer.isView(positions.array) || Array.isArray(positions.array))) {
    return positions.array;
  }
  return null;
}

function indexOf(indices) {
  if (indices == null) return null;
  if (ArrayBuffer.isView(indices) || Array.isArray(indices)) return indices;
  if (ArrayBuffer.isView(indices.array) || Array.isArray(indices.array)) return indices.array;
  return null;
}

/**
 * @param {ArrayLike<number> | { array: ArrayLike<number> }} positions
 * @param {ArrayLike<number> | { array: ArrayLike<number> } | null} [indices]
 * @returns {number | null} cm³, or null when the mesh has no volume
 */
export function solidVolumeCm3(positions, indices = null) {
  const pos = coordsOf(positions);
  if (!pos || pos.length < 9 || pos.length % 3 !== 0) return null;
  const idx = indexOf(indices);
  if (indices != null && !idx) return null;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
  if (triCount < 1) return null;
  let sum = 0;
  for (let tri = 0; tri < triCount; tri += 1) {
    const ia = idx ? idx[tri * 3] : tri * 3;
    const ib = idx ? idx[tri * 3 + 1] : tri * 3 + 1;
    const ic = idx ? idx[tri * 3 + 2] : tri * 3 + 2;
    const ax = pos[ia * 3];
    const ay = pos[ia * 3 + 1];
    const az = pos[ia * 3 + 2];
    const bx = pos[ib * 3];
    const by = pos[ib * 3 + 1];
    const bz = pos[ib * 3 + 2];
    const cx = pos[ic * 3];
    const cy = pos[ic * 3 + 1];
    const cz = pos[ic * 3 + 2];
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return null;
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  const cm3 = Math.abs(sum) / 6 / 1000;
  if (!Number.isFinite(cm3) || cm3 <= 0) return null;
  return Math.round(cm3 * 1e6) / 1e6;
}
