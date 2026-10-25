/**
 * Trailing Move / Rotate features as one rigid matrix.
 *
 * A part whose script ends in whole-body move() / rotateAbout() calls keeps
 * the mesh from before those calls. The viewport poses that mesh; export,
 * booleans and any other consumer that needs the moved vertices bake the
 * matrix. A move that is not at the end, a multi-body move, or an `at` that
 * is not the running centroid is not represented here — the kernel runs.
 */
import { findFeatureBlocks } from './featureBlockId.js';
import { MOVE_BEGIN, MOVE_END, ROTATE_BEGIN, ROTATE_END } from './helperPaletteSnippets.js';

/** Column-major 4×4, the same layout Manifold.transform uses. */
export const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

/** Squared millimetres. The same exact gate move() uses for `{ at }`. */
export const RIGID_AT_EPS2 = 1e-4;

const MOVE_STMT = /^([A-Za-z_$][\w$]*)\s*=\s*move\(\s*\1\s*,\s*\[([^\]]*)\]\s*,\s*\{\s*bodies\s*:\s*\[\s*\{\s*at\s*:\s*\[([^\]]*)\](?:\s*,\s*tri\s*:\s*\d+)?\s*\}\s*\]\s*\}\s*\)\s*;?$/;
const ROTATE_STMT = /^([A-Za-z_$][\w$]*)\s*=\s*rotateAbout\(\s*\1\s*,\s*('[^']*'|"[^"]*"|\[[^\]]*\])\s*,\s*([^,]+)\s*,\s*(null|\[[^\]]*\])\s*,\s*\{\s*bodies\s*:\s*\[\s*\{\s*at\s*:\s*\[([^\]]*)\](?:\s*,\s*tri\s*:\s*\d+)?\s*\}\s*\]\s*\}\s*\)\s*;?$/;
const SYNC_STMT = /^(?:let|const|var)\s+part\s*=\s*([A-Za-z_$][\w$]*)\s*;?$|^part\s*=\s*([A-Za-z_$][\w$]*)\s*;?$/;

export function matrixIsIdentity(matrix, eps = 1e-9) {
  if (!Array.isArray(matrix) || matrix.length < 16) return true;
  for (let i = 0; i < 16; i += 1) {
    const expected = (i % 5 === 0) ? 1 : 0;
    if (Math.abs(Number(matrix[i]) - expected) > eps) return false;
  }
  return true;
}

/** `a * b` in column-major order: apply `b` first, then `a`. */
export function multiplyMatrices(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] = a[row] * b[col * 4]
        + a[4 + row] * b[col * 4 + 1]
        + a[8 + row] * b[col * 4 + 2]
        + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function translationMatrix(dx, dy, dz) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    dx, dy, dz, 1,
  ];
}

/** Column-major 4×4 turning `angleDeg` about a unit axis through `pivot`. */
export function rotateAboutMatrix(axis, angleDeg, pivot) {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const t = (Number(angleDeg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const u = 1 - c;
  const r00 = c + x * x * u;
  const r01 = x * y * u - z * s;
  const r02 = x * z * u + y * s;
  const r10 = y * x * u + z * s;
  const r11 = c + y * y * u;
  const r12 = y * z * u - x * s;
  const r20 = z * x * u - y * s;
  const r21 = z * y * u + x * s;
  const r22 = c + z * z * u;
  const px = pivot[0];
  const py = pivot[1];
  const pz = pivot[2];
  const tx = px - (r00 * px + r01 * py + r02 * pz);
  const ty = py - (r10 * px + r11 * py + r12 * pz);
  const tz = pz - (r20 * px + r21 * py + r22 * pz);
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    tx, ty, tz, 1,
  ];
}

export function transformPoint(matrix, point) {
  if (!Array.isArray(point) || point.length < 3) return point;
  const x = Number(point[0]);
  const y = Number(point[1]);
  const z = Number(point[2]);
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

/** Rotate a direction. Rigid matrices have no scale, so the vector is re-unitized by the caller when it is a normal. */
export function transformNormal(matrix, normal) {
  if (!Array.isArray(normal) || normal.length < 3) return normal;
  const x = Number(normal[0]);
  const y = Number(normal[1]);
  const z = Number(normal[2]);
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
}

function unit3(v) {
  if (!Array.isArray(v) || v.length < 3) return v;
  const len = Math.hypot(Number(v[0]), Number(v[1]), Number(v[2]));
  if (!(len > 1e-12)) return v;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function transformBBox(matrix, bbox) {
  if (!bbox?.min || !bbox?.max) return bbox || null;
  if (!matrix || matrixIsIdentity(matrix)) {
    return {
      min: [Number(bbox.min[0]), Number(bbox.min[1]), Number(bbox.min[2])],
      max: [Number(bbox.max[0]), Number(bbox.max[1]), Number(bbox.max[2])],
    };
  }
  const xs = [Number(bbox.min[0]), Number(bbox.max[0])];
  const ys = [Number(bbox.min[1]), Number(bbox.max[1])];
  const zs = [Number(bbox.min[2]), Number(bbox.max[2])];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const p = transformPoint(matrix, [x, y, z]);
        for (let i = 0; i < 3; i += 1) {
          if (p[i] < min[i]) min[i] = p[i];
          if (p[i] > max[i]) max[i] = p[i];
        }
      }
    }
  }
  return { min, max };
}

/**
 * Copy of `mesh` with vertices (and only vertices) moved by `matrix`.
 * The same object comes back when the matrix is identity, so callers can
 * keep the GPU buffers. Run tables, face ids and triangle indices are shared.
 */
export function bakeRigidMesh(mesh, matrix) {
  if (!mesh?.vertProperties || !matrix || matrixIsIdentity(matrix)) return mesh;
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const out = new Float32Array(src.length);
  const n = Math.floor(src.length / np);
  for (let i = 0; i < n; i += 1) {
    const p = transformPoint(matrix, [src[i * np], src[i * np + 1], src[i * np + 2]]);
    const base = i * np;
    out[base] = p[0];
    out[base + 1] = p[1];
    out[base + 2] = p[2];
    for (let k = 3; k < np; k += 1) out[base + k] = src[base + k];
  }
  const baked = { ...mesh, vertProperties: out };
  delete baked.featureRigid;
  return baked;
}

function parseVec(text) {
  const parts = String(text || '').split(',').map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

function parseAxis(token) {
  const text = String(token || '').trim();
  const named = {
    "'x'": [1, 0, 0], '"x"': [1, 0, 0],
    "'y'": [0, 1, 0], '"y"': [0, 1, 0],
    "'z'": [0, 0, 1], '"z"': [0, 0, 1],
    "'-x'": [-1, 0, 0], '"-x"': [-1, 0, 0],
    "'-y'": [0, -1, 0], '"-y"': [0, -1, 0],
    "'-z'": [0, 0, -1], '"-z"': [0, 0, -1],
  };
  if (named[text]) return named[text];
  if (text.startsWith('[')) return parseVec(text.slice(1, -1));
  return null;
}

function blockStatements(blockText) {
  return String(blockText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'));
}

function parseRigidBlock(block) {
  const lines = blockStatements(block.text);
  const opLine = lines.find((line) => MOVE_STMT.test(line) || ROTATE_STMT.test(line));
  if (!opLine) return null;
  const extras = lines.filter((line) => line !== opLine);
  const move = opLine.match(MOVE_STMT);
  if (move) {
    const body = move[1];
    for (const extra of extras) {
      const sync = extra.match(SYNC_STMT);
      const name = sync && (sync[1] || sync[2]);
      if (!name || name !== body) return null;
    }
    const delta = parseVec(move[2]);
    const at = parseVec(move[3]);
    if (!delta || !at) return null;
    return { kind: 'move', body, delta, at };
  }
  const turn = opLine.match(ROTATE_STMT);
  if (!turn) return null;
  const body = turn[1];
  for (const extra of extras) {
    const sync = extra.match(SYNC_STMT);
    const name = sync && (sync[1] || sync[2]);
    if (!name || name !== body) return null;
  }
  const axis = parseAxis(turn[2]);
  const angle = Number(String(turn[3]).trim());
  const center = String(turn[4]).trim() === 'null' ? null : parseVec(String(turn[4]).replace(/^\[|\]$/g, ''));
  const at = parseVec(turn[5]);
  if (!axis || !Number.isFinite(angle) || (center == null && String(turn[4]).trim() !== 'null') || !at) return null;
  if (String(turn[4]).trim() !== 'null' && !center) return null;
  return { kind: 'rotate', body, axis, angle, center, at };
}

function stripTrailingReturn(src) {
  let cursor = src.length;
  while (cursor > 0 && /\s/.test(src[cursor - 1])) cursor -= 1;
  const head = src.slice(0, cursor);
  const match = head.match(/return\s+([A-Za-z_$][\w$]*)\s*;?$/);
  if (!match) return { cursor, returnName: null };
  const at = match.index;
  const before = head.slice(0, at);
  if (before.trim() && !/[;{}]\s*$/.test(before) && !/\n\s*$/.test(before)) {
    return { cursor, returnName: null };
  }
  let next = at;
  while (next > 0 && /\s/.test(src[next - 1])) next -= 1;
  return { cursor: next, returnName: match[1] };
}

/**
 * Peel trailing move / rotate blocks off `script`.
 * `prefix` is the script that produces the unmoved solid (it returns the
 * binding those blocks receive). `ops` is empty when nothing trailing is a
 * rigid feature; `suffixStart` is where the first peeled block begins.
 * Returns null only for a non-string. A block that is not a pure rigid
 * call stays in the prefix so the caller rebuilds.
 */
export function splitTrailingRigid(script) {
  if (typeof script !== 'string') return null;
  const blocks = [
    ...findFeatureBlocks(script, MOVE_BEGIN, MOVE_END).map((block) => ({ ...block, kind: 'move' })),
    ...findFeatureBlocks(script, ROTATE_BEGIN, ROTATE_END).map((block) => ({ ...block, kind: 'rotate' })),
  ].sort((a, b) => a.start - b.start);
  const tail = stripTrailingReturn(script);
  let cursor = tail.cursor;
  const ops = [];
  let suffixStart = null;
  while (blocks.length) {
    let probe = cursor;
    while (probe > 0 && /\s/.test(script[probe - 1])) probe -= 1;
    const index = blocks.findIndex((block) => script.slice(block.end, probe).trim() === '');
    if (index < 0) break;
    const block = blocks[index];
    const op = parseRigidBlock(block);
    if (!op) break;
    ops.unshift(op);
    suffixStart = block.start;
    blocks.splice(index, 1);
    cursor = block.start;
  }
  if (!ops.length) {
    return { prefix: script, ops: [], suffixStart: null, returnName: tail.returnName };
  }
  let prefix = script.slice(0, cursor).replace(/\s+$/, '');
  const binding = ops[0].body;
  const returnName = tail.returnName || binding;
  if (!new RegExp(`return\\s+${returnName}\\s*;?\\s*$`).test(prefix)) {
    prefix += `\nreturn ${returnName};\n`;
  } else if (!prefix.endsWith('\n')) {
    prefix += '\n';
  }
  return { prefix, ops, suffixStart, returnName };
}

/**
 * Compose `ops` onto `baseCentroid` (the unmoved vertex centroid).
 * Each `at` must match the running centroid within the move() exact gate.
 * Returns null when a later feature would not be a single rigid matrix.
 */
export function rigidMatrixForOps(ops, baseCentroid) {
  if (!Array.isArray(ops) || !ops.length) return null;
  if (!Array.isArray(baseCentroid) || baseCentroid.length < 3) return null;
  let centroid = [Number(baseCentroid[0]), Number(baseCentroid[1]), Number(baseCentroid[2])];
  if (centroid.some((n) => !Number.isFinite(n))) return null;
  let matrix = IDENTITY_MATRIX.slice();
  for (const op of ops) {
    const at = op?.at;
    if (!Array.isArray(at) || at.length < 3) return null;
    const dx = centroid[0] - Number(at[0]);
    const dy = centroid[1] - Number(at[1]);
    const dz = centroid[2] - Number(at[2]);
    if (![dx, dy, dz].every(Number.isFinite) || dx * dx + dy * dy + dz * dz > RIGID_AT_EPS2) return null;
    if (op.kind === 'move') {
      const delta = op.delta;
      if (!Array.isArray(delta) || delta.length < 3) return null;
      const step = translationMatrix(Number(delta[0]), Number(delta[1]), Number(delta[2]));
      matrix = multiplyMatrices(step, matrix);
      centroid = [centroid[0] + Number(delta[0]), centroid[1] + Number(delta[1]), centroid[2] + Number(delta[2])];
    } else if (op.kind === 'rotate') {
      const pivot = op.center || centroid.slice();
      if (!Array.isArray(op.axis) || !Number.isFinite(op.angle)) return null;
      const step = rotateAboutMatrix(op.axis, op.angle, pivot);
      matrix = multiplyMatrices(step, matrix);
      centroid = transformPoint(step, centroid);
    } else {
      return null;
    }
  }
  return { matrix, centroid };
}

function quatMul(a, b) {
  const ax = a[0]; const ay = a[1]; const az = a[2]; const aw = a[3];
  const bx = b[0]; const by = b[1]; const bz = b[2]; const bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotateByQuat(q, point) {
  const x = q[0]; const y = q[1]; const z = q[2]; const w = q[3];
  const vx = point[0]; const vy = point[1]; const vz = point[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/** Unit quaternion from the upper 3×3 of a column-major rigid matrix. */
export function quaternionFromMatrix(matrix) {
  const m00 = matrix[0]; const m10 = matrix[1]; const m20 = matrix[2];
  const m01 = matrix[4]; const m11 = matrix[5]; const m21 = matrix[6];
  const m02 = matrix[8]; const m12 = matrix[9]; const m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let x; let y; let z; let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

/** `{ t, q }` of a rigid matrix. Identity in, identity pose out. */
export function matrixToPlacement(matrix) {
  if (!matrix || matrixIsIdentity(matrix)) return { t: [0, 0, 0], q: [0, 0, 0, 1] };
  return {
    t: [matrix[12], matrix[13], matrix[14]],
    q: quaternionFromMatrix(matrix),
  };
}

/**
 * Assembly placement, then the feature rigid. The mesh stays in prefix
 * space; this is the pose the viewport writes onto the object.
 */
export function composePlacementWithMatrix(placement, matrix) {
  const t = Array.isArray(placement?.t) ? placement.t : [0, 0, 0];
  const q = Array.isArray(placement?.q) ? placement.q : [0, 0, 0, 1];
  if (!matrix || matrixIsIdentity(matrix)) {
    return {
      t: [Number(t[0]) || 0, Number(t[1]) || 0, Number(t[2]) || 0],
      q: [Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0, Number(q[3] ?? 1)],
    };
  }
  const feature = matrixToPlacement(matrix);
  const rotated = rotateByQuat(q, feature.t);
  return {
    t: [(Number(t[0]) || 0) + rotated[0], (Number(t[1]) || 0) + rotated[1], (Number(t[2]) || 0) + rotated[2]],
    q: quatMul(q, feature.q),
  };
}

/** Face record in moved part space. Drawing keeps the unmoved record. */
export function poseFaceRecord(face, matrix) {
  if (!face || !matrix || matrixIsIdentity(matrix)) return face;
  const next = { ...face };
  if (Array.isArray(face.center)) next.center = transformPoint(matrix, face.center);
  if (Array.isArray(face.at)) next.at = transformPoint(matrix, face.at);
  if (Array.isArray(face.normal)) next.normal = unit3(transformNormal(matrix, face.normal));
  if (Array.isArray(face.n)) next.n = unit3(transformNormal(matrix, face.n));
  if (Array.isArray(face.group)) next.group = face.group.map((row) => poseFaceRecord(row, matrix));
  if (face.axis && typeof face.axis === 'object') {
    next.axis = {
      ...face.axis,
      ...(Array.isArray(face.axis.at) ? { at: transformPoint(matrix, face.axis.at) } : {}),
      ...(Array.isArray(face.axis.dir) ? { dir: unit3(transformNormal(matrix, face.axis.dir)) } : {}),
    };
  }
  return next;
}

/** Edge record (`va` / `vb` / `mid` / normals) in moved part space. */
export function poseEdgeRecord(edge, matrix) {
  if (!edge || !matrix || matrixIsIdentity(matrix)) return edge;
  const point = (value) => (Array.isArray(value) ? transformPoint(matrix, value) : value);
  const dir = (value) => (Array.isArray(value) ? unit3(transformNormal(matrix, value)) : value);
  return {
    ...edge,
    va: point(edge.va),
    vb: point(edge.vb),
    mid: point(edge.mid),
    at: point(edge.at),
    normal: dir(edge.normal),
    n: dir(edge.n),
    dir: dir(edge.dir),
  };
}

/**
 * Agent / joint face rows. The cached catalog stays on the unmoved mesh;
 * this returns rows whose `at` / `n` / axis follow the feature rigid.
 * `ensureAxis` still reads the unmoved geometry, then the axis is posed.
 */
export function poseAgentCatalog(rows, matrix) {
  if (!Array.isArray(rows) || !matrix || matrixIsIdentity(matrix)) return rows;
  return rows.map((row) => {
    const posed = poseFaceRecord(row, matrix);
    if (typeof row.ensureAxis !== 'function') return posed;
    posed.ensureAxis = () => {
      row.ensureAxis();
      if (row.axis) posed.axis = poseFaceRecord({ axis: row.axis }, matrix).axis;
      return posed;
    };
    return posed;
  });
}

/** Joint fingerprints (`at` / `n`) and fitted axes, copied. */
export function poseJointCatalog(catalog, matrix) {
  if (!catalog || !matrix || matrixIsIdentity(matrix)) return catalog;
  const faces = Array.isArray(catalog.faces)
    ? catalog.faces.map((face) => poseFaceRecord(face, matrix))
    : catalog.faces;
  const axes = Array.isArray(catalog.axes)
    ? catalog.axes.map((axis) => ({
      ...axis,
      ...(Array.isArray(axis.at) ? { at: transformPoint(matrix, axis.at) } : {}),
      ...(Array.isArray(axis.dir) ? { dir: unit3(transformNormal(matrix, axis.dir)) } : {}),
    }))
    : catalog.axes;
  return { ...catalog, faces, axes };
}
