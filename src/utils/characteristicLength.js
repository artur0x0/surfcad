/**
 * Characteristic length of one part, in millimetres.
 *
 * L is the longest side of the part's overall extents. A gap between bodies
 * is inside that box, so it counts. Scripts stay millimetres. L is not
 * written into `.surf.json` (save drops unknown fields).
 *
 * Empty, cleared, or degenerate parts use 100 mm, the same reference the
 * length-slider defaults were written against.
 *
 * Fillet and chamfer do not read L. Their size is 2 mm in every display unit.
 */

export const REFERENCE_LENGTH_MM = 100;

/**
 * @param {{ bounds?: { size?: ArrayLike<number> }, size?: ArrayLike<number> }} [input]
 * @returns {number}
 */
export function characteristicLengthMm({ bounds, size } = {}) {
  const dims = size || bounds?.size;
  if (!dims) return REFERENCE_LENGTH_MM;
  let longest = 0;
  for (let i = 0; i < dims.length; i++) {
    const n = Number(dims[i]);
    if (Number.isFinite(n) && n > longest) longest = n;
  }
  return longest > 0 ? longest : REFERENCE_LENGTH_MM;
}

/**
 * Axis-aligned box of a BufferGeometry's position attribute.
 * @param {import('three').BufferGeometry | null | undefined} geom
 * @returns {{ min: number[], max: number[], size: number[] } | null}
 */
export function boundsFromGeometry(geom) {
  const attr = geom?.attributes?.position;
  const arr = attr?.array;
  if (!arr || arr.length < 3) return null;
  const item = attr.itemSize || 3;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (let i = 0; i + 2 < arr.length; i += item) {
    const x = arr[i];
    const y = arr[i + 1];
    const z = arr[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    any = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!any) return null;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

const byMesh = new WeakMap();
const byPart = new Map();

/**
 * Remember L for a rebuilt part. Keyed by mesh identity and by part id.
 * A new run is a new mesh object, so the previous solid's entry dies with it.
 * @returns {number}
 */
export function rememberCharacteristicLength({ partId, meshData, bounds, size } = {}) {
  const lengthMm = characteristicLengthMm({ bounds, size });
  const record = { meshData: meshData ?? null, characteristicLengthMm: lengthMm };
  if (meshData) byMesh.set(meshData, record);
  if (partId != null && partId !== '') byPart.set(partId, record);
  return lengthMm;
}

/** L for a mesh or a part. Missing entries are the 100 mm reference. */
export function characteristicLengthFor({ partId, meshData } = {}) {
  if (meshData && byMesh.has(meshData)) return byMesh.get(meshData).characteristicLengthMm;
  if (partId != null && byPart.has(partId)) return byPart.get(partId).characteristicLengthMm;
  return REFERENCE_LENGTH_MM;
}

/** The viewport record for a part, or null when that part has no solid. */
export function characteristicLengthRecord(partId) {
  if (partId == null) return null;
  return byPart.get(partId) ?? null;
}

/** Drop a cleared part. The next reader uses 100 mm. */
export function forgetCharacteristicLength(partId) {
  if (partId == null) return;
  const record = byPart.get(partId);
  if (record?.meshData) byMesh.delete(record.meshData);
  byPart.delete(partId);
}
