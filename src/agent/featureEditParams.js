/**
 * edit_feature params: which keys a feature kind actually applies, and
 * whether open_feature may keep a session when the feature card is suppressed.
 *
 * The catalog schema for `params` is an open object. Strict clients were
 * dropping the nested property list (additionalProperties false, properties
 * empty) and refusing documented calls. The kind check lives here, at
 * runtime, so an unknown key is bad_args instead of a success that confirm
 * cannot write.
 */

import { BLOCK_SOLID_IDS, isBlockSolidId } from '../utils/blockSolid.js';

const PROFILE = Object.freeze([
  'tool', 'points', 'radius', 'segments', 'width', 'height', 'centered', 'centers',
  'polygon_preset', 'polygonPreset', 'contour', 'stations',
]);

const POSE = Object.freeze(['x', 'y', 'z', 'rx', 'ry', 'rz', 'combine']);

const HOLE_CARD = Object.freeze([
  'type', 'size', 'fit', 'dia', 'through', 'depth', 'side',
  'nearKind', 'nearDia', 'nearDepth', 'farKind', 'farDia', 'farDepth', 'u',
]);

const BLOCK_NUM = Object.freeze([
  'width', 'depth', 'height', 'sx', 'sy', 'sz', 'edgeRadius', 'segments',
  'radius', 'wall', 'cornerRadius', 'outerRadius', 'innerRadius',
  'x', 'y', 'z', 'rx', 'ry', 'rz',
]);

function setOf(...groups) {
  return new Set(groups.flat());
}

const BY_KIND = new Map([
  ['move', setOf(['dx', 'dy', 'dz', 'at'])],
  ['rotate', setOf(['angle', 'axis', 'center', 'at'])],
  ['extrude', setOf(['distance', 'sense'], PROFILE)],
  ['revolve', setOf(['angle'], PROFILE)],
  ['profile', setOf(PROFILE)],
  ['loft', setOf(PROFILE)],
  ['sweep', setOf(PROFILE)],
  ['workplane', setOf(['cz'])],
  ['fillet', setOf(['radius'])],
  ['chamfer', setOf(['chamfer'])],
  ['shell', setOf(['wall', 'openingMode'])],
  ['draft', setOf(['angle', 'flip', 'draftDeg', 'pull', 'reference', 'faceScope'])],
  ['cut', setOf(['originOffset', 'keep'])],
  ['boolean', setOf(['op'])],
  ['moveFace', setOf(['distance', 'flip'])],
  ['deleteFace', setOf(['faceCount', 'faces'])],
  ['center', setOf(['cx', 'cy', 'cz', 'body'])],
  ['align', setOf(['body'])],
  ['mirror', setOf(['plane', 'keepOriginal', 'at'])],
  ['array', setOf(['arrayType', 'nx', 'ny', 'nz', 'sx', 'sy', 'sz'])],
  ['polarArray', setOf(['count', 'boltCircleRadius', 'axis'])],
  ['patternPoints', setOf(['points', 'up', 'keepOriginal', 'merge'])],
  ['sheetMetal', setOf(['spec', 'width'])],
  ['code', setOf(['gap', 'why', 'script'])],
  ['hole', setOf(HOLE_CARD)],
  ['clearanceHole', setOf(HOLE_CARD)],
  ['tapDrillHole', setOf(HOLE_CARD)],
  ['holePattern', setOf(['n'], HOLE_CARD)],
  ['cboreHole', setOf(['diaThru'], HOLE_CARD)],
  ['cskHole', setOf(['diaThru'], HOLE_CARD)],
]);

for (const id of BLOCK_SOLID_IDS) {
  const extra = id === 'cube' ? ['center'] : (id === 'tube' ? ['section'] : []);
  BY_KIND.set(id, setOf(POSE, BLOCK_NUM, extra));
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isNum);
}

function numError(kind, key) {
  return { code: 'bad_args', message: `edit_feature: ${kind} param ${key} must be a number` };
}

function vecError(kind, key) {
  return { code: 'bad_args', message: `edit_feature: ${kind} param ${key} must be [x, y, z] in mm` };
}

function paramTypeError(kind, params) {
  if (kind === 'move') {
    for (const key of ['dx', 'dy', 'dz']) {
      if (key in params && !isNum(params[key])) return numError(kind, key);
    }
    if ('at' in params && !isVec3(params.at)) return vecError(kind, 'at');
  }
  if (kind === 'rotate') {
    if ('angle' in params && !isNum(params.angle)) return numError(kind, 'angle');
    if ('at' in params && !isVec3(params.at)) return vecError(kind, 'at');
    if ('center' in params && params.center != null && !isVec3(params.center)) {
      return vecError(kind, 'center');
    }
    if ('axis' in params) {
      const axis = params.axis;
      const named = axis === 'x' || axis === 'y' || axis === 'z' || axis === '-x' || axis === '-y' || axis === '-z';
      if (!named && !isVec3(axis)) {
        return { code: 'bad_args', message: 'edit_feature: rotate param axis must be x, y, z, or [ax, ay, az]' };
      }
    }
  }
  if (kind === 'draft') {
    if ('angle' in params && !isNum(params.angle)) return numError(kind, 'angle');
    if ('draftDeg' in params && !isNum(params.draftDeg)) return numError(kind, 'draftDeg');
    if ('angle' in params && 'draftDeg' in params && params.angle !== params.draftDeg) {
      return { code: 'bad_args', message: 'edit_feature: draft angle and draftDeg disagree' };
    }
    if ('flip' in params && typeof params.flip !== 'boolean') {
      return { code: 'bad_args', message: 'edit_feature: draft param flip must be a boolean' };
    }
    const axis = new Set(['x', '-x', 'y', '-y', 'z', '-z']);
    if ('pull' in params && !axis.has(params.pull)) {
      return { code: 'bad_args', message: "edit_feature: draft param pull must be 'x', 'y', 'z', or a signed axis" };
    }
    if ('reference' in params) {
      const ref = params.reference;
      const named = ref === 'min' || ref === 'mid' || ref === 'max';
      if (!named && !isNum(ref)) {
        return { code: 'bad_args', message: "edit_feature: draft param reference must be 'min', 'mid', 'max', or a number" };
      }
    }
    const scope = new Set(['sides', 'all', 'none', ...axis]);
    if ('faceScope' in params && !scope.has(params.faceScope)) {
      return { code: 'bad_args', message: "edit_feature: draft param faceScope must be 'sides' or an axis" };
    }
  }
  if (isBlockSolidId(kind)) {
    for (const key of BLOCK_NUM) {
      if (key in params && !isNum(params[key])) return numError(kind, key);
    }
    if (kind === 'cube' && 'center' in params && typeof params.center !== 'boolean') {
      return { code: 'bad_args', message: 'edit_feature: cube param center must be a boolean' };
    }
  }
  return null;
}

/**
 * @param {string|null|undefined} kind
 * @param {unknown} params
 * @returns {{ code: string, message: string } | null}
 */
export function featureEditParamError(kind, params) {
  if (params == null) return null;
  if (typeof params !== 'object' || Array.isArray(params)) {
    return { code: 'bad_args', message: 'edit_feature params must be an object' };
  }
  const keys = Object.keys(params);
  if (!keys.length) return null;
  const allowed = typeof kind === 'string' ? BY_KIND.get(kind) : null;
  // A kind with no list (a helper card, a contour sketch) is checked by its
  // own writer. Contour keys are filtered in contourSketchPatch.
  if (!allowed) return null;
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) {
    return {
      code: 'bad_args',
      message: `edit_feature: ${kind} has no param ${unknown.join(', ')}. Use ${[...allowed].join(', ')}.`,
    };
  }
  return paramTypeError(kind, params);
}

/**
 * The popup gate only decides whether a card mounts. The edit session is
 * what confirm_feature rewrites. A saved contour has no headless writer:
 * when the sketch cannot open, the open is an error rather than a success
 * with no session.
 *
 * @param {{ popupAllowed: boolean, contour: boolean }} opts
 * @returns {{ keepSession: boolean, openCard: boolean }}
 */
export function featureEditOpenPlan({ popupAllowed, contour }) {
  if (contour) {
    return popupAllowed === true
      ? { keepSession: true, openCard: true }
      : { keepSession: false, openCard: false };
  }
  return { keepSession: true, openCard: popupAllowed === true };
}
