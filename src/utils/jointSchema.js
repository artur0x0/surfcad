/**
 * Assembly joints and the rigid placement on a part row.
 *
 * A joint names parts by surf id and stores a face, edge, axis, or
 * plane in the part frame. A plane key is a stable id plus a point and
 * a unit normal. It never stores script text. Status (ok, broken,
 * conflict) is computed later and is not a file field.
 *
 * `position` stays the translation. `placement` is `{ t, q }` with a
 * unit quaternion, vector part first. Version stays 1.
 */
import { isSurfId } from './git/surfId.js';

export const JOINT_TYPES = Object.freeze([
  'coincident', 'concentric', 'distance', 'angle', 'symmetric', 'fixed',
]);

export const IDENTITY_QUATERNION = Object.freeze([0, 0, 0, 1]);

const JOINT_KEYS = new Set(['id', 'name', 'type', 'value', 'opposed', 'sense', 'a', 'a2', 'b', 'b2']);
const REF_KEYS = new Set(['part', 'kind', 'key']);
const FACE_FIELDS = new Set(['at', 'n', 'area', 'src', 'ord']);
const AXIS_FIELDS = new Set(['at', 'dir', 'radius']);
const EDGE_FIELDS = new Set(['at', 'dir', 'length', 'faces']);
const PLANE_FIELDS = new Set(['id', 'at', 'n']);
const PLACEMENT_KEYS = new Set(['t', 'q']);
const REF_KINDS = new Set(['face', 'edge', 'axis', 'plane']);

function isVec3(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function copyVec3(value) {
  return [value[0], value[1], value[2]];
}

function isZeroVec(value) {
  return value[0] === 0 && value[1] === 0 && value[2] === 0;
}

function isIdentityQuat(value) {
  return value[0] === 0 && value[1] === 0 && value[2] === 0 && value[3] === 1;
}

function quatLength(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return Math.hypot(value[0], value[1], value[2], value[3]);
}

/** Unit quaternion, or null when the value is not a finite 4-vector. */
export function unitQuaternion(value) {
  const len = quatLength(value);
  if (!(len > 1e-8)) return null;
  return [value[0] / len, value[1] / len, value[2] / len, value[3] / len];
}

function nearlyUnit(value) {
  const len = quatLength(value);
  return len != null && Math.abs(len - 1) <= 1e-3;
}

function nearlyUnitDir(value) {
  if (!isVec3(value)) return false;
  const len = Math.hypot(value[0], value[1], value[2]);
  return Math.abs(len - 1) <= 1e-3;
}

function unitDir(value) {
  if (!isVec3(value)) return null;
  const len = Math.hypot(value[0], value[1], value[2]);
  if (!(len > 1e-8)) return null;
  return [value[0] / len, value[1] / len, value[2] / len];
}

function faceKeyErrors(key, at) {
  const errors = [];
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(key)) {
    if (!FACE_FIELDS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isVec3(key.at)) errors.push(`${at}.at must be [x, y, z] numbers`);
  if (!isVec3(key.n)) errors.push(`${at}.n must be [x, y, z] numbers`);
  if (typeof key.area !== 'number' || !Number.isFinite(key.area) || !(key.area > 0)) {
    errors.push(`${at}.area must be a number greater than 0`);
  }
  const hasSrc = key.src !== undefined;
  const hasOrd = key.ord !== undefined;
  if (hasSrc !== hasOrd) errors.push(`${at} src and ord are set together`);
  if (hasSrc && (!Number.isInteger(key.src) || key.src >= 0)) {
    errors.push(`${at}.src must be a negative integer`);
  }
  if (hasOrd && (!Number.isInteger(key.ord) || key.ord < 0)) {
    errors.push(`${at}.ord must be a non-negative integer`);
  }
  return errors;
}

function copyFaceKey(key) {
  const out = {
    at: copyVec3(key.at),
    n: copyVec3(key.n),
    area: key.area,
  };
  if (key.src !== undefined) {
    out.src = key.src;
    out.ord = key.ord;
  }
  return out;
}

function axisKeyErrors(key, at) {
  const errors = [];
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(key)) {
    if (!AXIS_FIELDS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isVec3(key.at)) errors.push(`${at}.at must be [x, y, z] numbers`);
  if (!isVec3(key.dir)) errors.push(`${at}.dir must be [x, y, z] numbers`);
  else if (!nearlyUnitDir(key.dir)) errors.push(`${at}.dir must be a unit direction`);
  if (typeof key.radius !== 'number' || !Number.isFinite(key.radius) || !(key.radius > 0)) {
    errors.push(`${at}.radius must be a number greater than 0`);
  }
  return errors;
}

function copyAxisKey(key) {
  return { at: copyVec3(key.at), dir: unitDir(key.dir), radius: key.radius };
}

function edgeKeyErrors(key, at) {
  const errors = [];
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(key)) {
    if (!EDGE_FIELDS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isVec3(key.at)) errors.push(`${at}.at must be [x, y, z] numbers`);
  if (!isVec3(key.dir)) errors.push(`${at}.dir must be [x, y, z] numbers`);
  else if (!nearlyUnitDir(key.dir)) errors.push(`${at}.dir must be a unit direction`);
  if (typeof key.length !== 'number' || !Number.isFinite(key.length) || !(key.length > 0)) {
    errors.push(`${at}.length must be a number greater than 0`);
  }
  if (!Array.isArray(key.faces) || key.faces.length !== 2) {
    errors.push(`${at}.faces must be two face keys`);
  } else {
    errors.push(...faceKeyErrors(key.faces[0], `${at}.faces[0]`));
    errors.push(...faceKeyErrors(key.faces[1], `${at}.faces[1]`));
  }
  return errors;
}

function copyEdgeKey(key) {
  return {
    at: copyVec3(key.at),
    dir: unitDir(key.dir),
    length: key.length,
    faces: [copyFaceKey(key.faces[0]), copyFaceKey(key.faces[1])],
  };
}

function planeKeyErrors(key, at) {
  const errors = [];
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(key)) {
    if (!PLANE_FIELDS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (typeof key.id !== 'string' || !key.id || /\s/.test(key.id)) {
    errors.push(`${at}.id must be a plane id`);
  }
  if (!isVec3(key.at)) errors.push(`${at}.at must be [x, y, z] numbers`);
  if (!isVec3(key.n)) errors.push(`${at}.n must be [x, y, z] numbers`);
  else if (!nearlyUnitDir(key.n)) errors.push(`${at}.n must be a unit direction`);
  return errors;
}

function copyPlaneKey(key) {
  return { id: String(key.id), at: copyVec3(key.at), n: unitDir(key.n) };
}

function keyErrors(kind, key, at) {
  if (kind === 'face') return faceKeyErrors(key, at);
  if (kind === 'axis') return axisKeyErrors(key, at);
  if (kind === 'edge') return edgeKeyErrors(key, at);
  if (kind === 'plane') return planeKeyErrors(key, at);
  return [`${at} has no key for this kind`];
}

function copyKey(kind, key) {
  if (kind === 'face') return copyFaceKey(key);
  if (kind === 'axis') return copyAxisKey(key);
  if (kind === 'plane') return copyPlaneKey(key);
  return copyEdgeKey(key);
}

function planarKind(kind) {
  return kind === 'face' || kind === 'plane';
}

function kindsOk(type, aKind, bKind) {
  if (type === 'coincident' || type === 'distance' || type === 'symmetric') {
    return planarKind(aKind) && planarKind(bKind);
  }
  if (type === 'concentric') {
    return (aKind === 'axis' || aKind === 'edge') && (bKind === 'axis' || bKind === 'edge');
  }
  if (type === 'angle') return REF_KINDS.has(aKind) && REF_KINDS.has(bKind);
  return false;
}

/** Geometry references a joint names. `fixed` is the part only. */
export function jointRefs(joint) {
  if (!joint) return [];
  if (joint.type === 'symmetric') return [joint.a, joint.a2, joint.b, joint.b2].filter(Boolean);
  if (joint.type === 'fixed') return joint.a ? [joint.a] : [];
  return [joint.a, joint.b].filter(Boolean);
}

function referenceErrors(ref, at, { geometry }) {
  const errors = [];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(ref)) {
    if (!REF_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isSurfId(ref.part)) errors.push(`${at}.part must be a surf id`);
  if (!geometry) {
    if (ref.kind !== undefined) errors.push(`${at}.kind is omitted on a fixed joint`);
    if (ref.key !== undefined) errors.push(`${at}.key is omitted on a fixed joint`);
    return errors;
  }
  if (!REF_KINDS.has(ref.kind)) errors.push(`${at}.kind must be face, edge, axis, or plane`);
  else errors.push(...keyErrors(ref.kind, ref.key, `${at}.key`));
  return errors;
}

function copyReference(ref, { geometry }) {
  const out = { part: String(ref.part) };
  if (!geometry) return out;
  out.kind = ref.kind;
  out.key = copyKey(ref.kind, ref.key);
  return out;
}

/**
 * Problems in a joints array. `liveIds` is the surf ids on part rows.
 * A surf id that is not one of those is reported here; load and save
 * prune those joints before validating.
 */
export function assemblyJointErrors(joints, liveIds) {
  const errors = [];
  if (!Array.isArray(joints)) {
    errors.push('joints must be an array');
    return errors;
  }
  if (!joints.length) {
    errors.push('joints must be omitted when empty');
    return errors;
  }
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  const seen = new Set();
  joints.forEach((joint, i) => {
    const at = `joints[${i}]`;
    if (!joint || typeof joint !== 'object' || Array.isArray(joint)) {
      errors.push(`${at} must be an object`);
      return;
    }
    for (const k of Object.keys(joint)) {
      if (!JOINT_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
    }
    if (!isSurfId(joint.id)) errors.push(`${at}.id must be a surf id`);
    else if (seen.has(joint.id)) errors.push(`${at}.id duplicates ${joint.id}`);
    if (joint.id) seen.add(joint.id);
    if (typeof joint.name !== 'string' || !joint.name.trim()) {
      errors.push(`${at}.name must be a non-empty string`);
    }
    if (!JOINT_TYPES.includes(joint.type)) {
      errors.push(`${at}.type must be coincident, concentric, distance, angle, symmetric, or fixed`);
      return;
    }
    const relational = joint.type !== 'fixed';
    const needsValue = joint.type === 'distance' || joint.type === 'angle';
    if (needsValue) {
      if (typeof joint.value !== 'number' || !Number.isFinite(joint.value)) {
        errors.push(`${at}.value must be a finite number`);
      }
      if (joint.sense !== 1 && joint.sense !== -1) {
        errors.push(`${at}.sense must be 1 or -1`);
      }
    } else if (joint.value !== undefined) {
      errors.push(`${at}.value is omitted on ${joint.type}`);
    }
    if (joint.type === 'coincident') {
      if (joint.opposed !== undefined && typeof joint.opposed !== 'boolean') {
        errors.push(`${at}.opposed must be a boolean`);
      }
    } else if (joint.opposed !== undefined) {
      errors.push(`${at}.opposed is omitted on ${joint.type}`);
    }
    if (!needsValue && joint.sense !== undefined) {
      errors.push(`${at}.sense is omitted on ${joint.type}`);
    }
    errors.push(...referenceErrors(joint.a, `${at}.a`, { geometry: relational }));
    if (relational) {
      errors.push(...referenceErrors(joint.b, `${at}.b`, { geometry: true }));
      if (joint.a && joint.b && isSurfId(joint.a.part) && joint.a.part === joint.b.part) {
        errors.push(`${at} needs two parts`);
      }
      if (joint.type !== 'symmetric'
        && joint.a && joint.b && REF_KINDS.has(joint.a.kind) && REF_KINDS.has(joint.b.kind)
        && !kindsOk(joint.type, joint.a.kind, joint.b.kind)) {
        errors.push(`${at} ${joint.type} does not fit these references`);
      }
    } else if (joint.b !== undefined) {
      errors.push(`${at}.b is omitted on a fixed joint`);
    }
    if (joint.type === 'symmetric') {
      errors.push(...referenceErrors(joint.a2, `${at}.a2`, { geometry: true }));
      errors.push(...referenceErrors(joint.b2, `${at}.b2`, { geometry: true }));
      const faces = [joint.a, joint.a2, joint.b, joint.b2];
      if (faces.some((ref) => ref && REF_KINDS.has(ref.kind) && !planarKind(ref.kind))) {
        errors.push(`${at} symmetric does not fit these references`);
      }
      if (isSurfId(joint.a?.part) && isSurfId(joint.a2?.part) && joint.a.part !== joint.a2.part) {
        errors.push(`${at}.a2 must be the same part as a`);
      }
      if (isSurfId(joint.b?.part) && isSurfId(joint.b2?.part) && joint.b.part !== joint.b2.part) {
        errors.push(`${at}.b2 must be the same part as b`);
      }
    } else {
      if (joint.a2 !== undefined) errors.push(`${at}.a2 is omitted on ${joint.type}`);
      if (joint.b2 !== undefined) errors.push(`${at}.b2 is omitted on ${joint.type}`);
    }
    if (isSurfId(joint.a?.part) && !live.has(joint.a.part)) {
      errors.push(`${at}.a.part is not a part in this file`);
    }
    if (isSurfId(joint.a2?.part) && !live.has(joint.a2.part)) {
      errors.push(`${at}.a2.part is not a part in this file`);
    }
    if (isSurfId(joint.b?.part) && !live.has(joint.b.part)) {
      errors.push(`${at}.b.part is not a part in this file`);
    }
    if (isSurfId(joint.b2?.part) && !live.has(joint.b2.part)) {
      errors.push(`${at}.b2.part is not a part in this file`);
    }
  });
  return errors;
}

function cleanJoint(joint) {
  const named = [joint?.a?.part, joint?.a2?.part, joint?.b?.part, joint?.b2?.part].filter(isSurfId);
  if (assemblyJointErrors([joint], named).length) {
    return null;
  }
  const relational = joint.type !== 'fixed';
  const out = {
    id: String(joint.id),
    name: String(joint.name).trim(),
    type: joint.type,
  };
  if (joint.type === 'distance' || joint.type === 'angle') {
    out.value = joint.value;
    out.sense = joint.sense;
  }
  if (joint.type === 'coincident') out.opposed = joint.opposed !== false;
  out.a = copyReference(joint.a, { geometry: relational });
  if (joint.type === 'symmetric') out.a2 = copyReference(joint.a2, { geometry: true });
  if (relational) out.b = copyReference(joint.b, { geometry: true });
  if (joint.type === 'symmetric') out.b2 = copyReference(joint.b2, { geometry: true });
  return out;
}

/**
 * Joints worth keeping. Dangling surf ids and malformed joints are
 * dropped. Null when nothing remains. Order is the stored order.
 * The first copy of a duplicate id wins.
 */
export function normalizeAssemblyJoints(joints, parts) {
  if (!Array.isArray(joints) || !joints.length) return null;
  const live = new Set((parts || []).map((part) => part?.surfId).filter(isSurfId));
  const seen = new Set();
  const out = [];
  for (const joint of joints) {
    const clean = cleanJoint(joint);
    if (!clean || seen.has(clean.id)) continue;
    if (!live.has(clean.a.part)) continue;
    if (clean.a2 && !live.has(clean.a2.part)) continue;
    if (clean.b && !live.has(clean.b.part)) continue;
    if (clean.b2 && !live.has(clean.b2.part)) continue;
    seen.add(clean.id);
    out.push(clean);
  }
  return out.length ? out : null;
}

/** Surf ids named by a normalized joint list. */
export function jointedSurfIds(joints) {
  const ids = new Set();
  for (const joint of joints || []) {
    if (joint?.a?.part) ids.add(joint.a.part);
    if (joint?.a2?.part) ids.add(joint.a2.part);
    if (joint?.b?.part) ids.add(joint.b.part);
    if (joint?.b2?.part) ids.add(joint.b2.part);
  }
  return ids;
}

/**
 * Explicit `{ t, q }` when the row stores a usable placement.
 * A missing quaternion is identity. A bad quaternion is null.
 */
export function canonicalPlacement(part) {
  const raw = part?.placement;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isVec3(raw.t)) return null;
  const q = raw.q == null ? IDENTITY_QUATERNION : unitQuaternion(raw.q);
  if (!q) return null;
  return { t: copyVec3(raw.t), q };
}

/**
 * In-memory pose. An explicit placement wins. Otherwise `position`
 * with an identity quaternion, or the origin when the row stores neither.
 * This is not written back by itself.
 */
export function partPlacement(part) {
  const explicit = canonicalPlacement(part);
  if (explicit) return explicit;
  const position = part?.position;
  if (Array.isArray(position) && position.length >= 3) {
    const t = [Number(position[0]), Number(position[1]), Number(position[2])];
    if (t.every(Number.isFinite)) return { t, q: [0, 0, 0, 1] };
  }
  return { t: [0, 0, 0], q: [0, 0, 0, 1] };
}

/**
 * Fields to store on a row. `position` is `t` when that translation is
 * not the origin, and also when a legacy row already stored `[0, 0, 0]`.
 * `placement` is written when the quaternion is not identity, or when a
 * joint names this part.
 */
export function poseFieldsForPart(part, jointed, storedPosition) {
  const explicit = canonicalPlacement(part);
  const position = Array.isArray(storedPosition) ? storedPosition : null;
  if (!explicit && !position && !jointed) return {};
  const t = explicit ? explicit.t : (position || [0, 0, 0]);
  const q = explicit ? explicit.q : [0, 0, 0, 1];
  const out = {};
  if (jointed || !isIdentityQuat(q)) {
    out.placement = { t: t.slice(), q: q.slice() };
    if (!isZeroVec(t)) out.position = t.slice();
    return out;
  }
  if (explicit) {
    if (!isZeroVec(t)) out.position = t.slice();
    else if (position) out.position = [0, 0, 0];
    return out;
  }
  if (position) out.position = position.slice();
  return out;
}

/** Problems in `parts[].placement`. */
export function placementErrors(placement, at) {
  const errors = [];
  if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
    errors.push(`${at} must be an object`);
    return errors;
  }
  for (const k of Object.keys(placement)) {
    if (!PLACEMENT_KEYS.has(k)) errors.push(`${at} unknown key "${k}"`);
  }
  if (!isVec3(placement.t)) errors.push(`${at}.t must be [x, y, z] numbers`);
  if (!Array.isArray(placement.q) || placement.q.length !== 4) {
    errors.push(`${at}.q must be a unit quaternion [x, y, z, w]`);
  } else if (!nearlyUnit(placement.q)) {
    errors.push(`${at}.q must be a unit quaternion [x, y, z, w]`);
  }
  return errors;
}

/**
 * Drop joints whose part surf id is not on a row. A joint that is not
 * an object stays so validation can reject it. Empty `joints` is omitted.
 * `.surf.json` part ids are the surf ids.
 */
export function pruneDanglingSurfJoints(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.joints)) return raw;
  if (!Array.isArray(raw.parts)) return raw;
  const live = new Set(raw.parts.map((part) => part?.id).filter((id) => isSurfId(id)));
  let dropped = false;
  const joints = [];
  for (const joint of raw.joints) {
    if (!joint || typeof joint !== 'object' || Array.isArray(joint)) {
      joints.push(joint);
      continue;
    }
    const a = joint.a?.part;
    const b = joint.b?.part;
    if ((isSurfId(a) && !live.has(a)) || (b != null && isSurfId(b) && !live.has(b))) {
      dropped = true;
      continue;
    }
    joints.push(joint);
  }
  if (!dropped) return raw;
  const next = { ...raw };
  if (joints.length) next.joints = joints;
  else delete next.joints;
  return next;
}
