/**
 * H5 feature strip: resolve strip chips to script markers and rollback anchors.
 */

import { parseFeatureMarkers } from '../utils/featureMarkers.js';
import { buildFeatureTree } from './state/featureTree.js';
import {
  resolveRollback,
  rollbackAnchorAtGap,
} from '../utils/featureSkip.js';

function chipIndexArg(index) {
  const i = Number(index);
  if (!Number.isInteger(i)) return null;
  return i;
}

/**
 * @param {string} script
 * @param {{ index?: number, id?: string }} target
 * @returns {{ chip: object, feature: object | null, contourId?: string } | { error: { code: string, message: string } }}
 */
export function resolveStripTarget(script, target = {}) {
  const text = typeof script === 'string' ? script : '';
  const tree = buildFeatureTree({ script: text });
  const hasId = target.id != null && String(target.id) !== '';
  const hasIndex = target.index != null && target.index !== '';
  if (hasId && hasIndex) {
    return { error: { code: 'bad_args', message: 'Pass id or index, not both' } };
  }
  if (!hasId && !hasIndex) {
    return { error: { code: 'bad_args', message: 'Needs feature id or index' } };
  }
  let chip;
  if (hasId) {
    const id = String(target.id);
    chip = tree.features.find((row) => row.id === id);
    if (!chip) {
      return { error: { code: 'unknown_feature', message: `No feature with id: ${id}` } };
    }
  } else {
    const i = chipIndexArg(target.index);
    if (i == null || i < 0 || i >= tree.features.length) {
      return {
        error: {
          code: 'bad_index',
          message: `Feature index out of range: ${target.index} (${tree.features.length} features)`,
        },
      };
    }
    chip = tree.features[i];
  }
  if (chip.kind === 'contour' || String(chip.id).startsWith('contour:')) {
    const contourId = String(chip.id).replace(/^contour:/, '');
    return { chip, feature: null, contourId };
  }
  const markers = parseFeatureMarkers(text);
  const feature = markers.find((row) => row.id === chip.id)
    || markers.find((row) => row.kind === chip.kind && row.index === chip.index);
  if (!feature) {
    return {
      error: {
        code: 'unknown_feature',
        message: `Feature ${chip.id} has no marked block in the active script`,
      },
    };
  }
  return { chip, feature };
}

/**
 * @param {string} script
 * @param {{ index?: number, id?: string, clear?: boolean, start?: boolean }} target
 * @param {string | null | undefined} currentAnchor
 */
export function resolveRollbackTarget(script, target = {}, currentAnchor = undefined) {
  const text = typeof script === 'string' ? script : '';
  if (target.clear === true) {
    return { anchor: undefined, rollbackAnchor: null };
  }
  if (target.start === true) {
    return { anchor: null, rollbackAnchor: null };
  }
  const { ids } = resolveRollback(text, currentAnchor);
  const hasId = target.id != null && String(target.id) !== '';
  const hasIndex = target.index != null && target.index !== '';
  if (!hasId && !hasIndex) {
    return { error: { code: 'bad_args', message: 'rollback_to needs id, index, clear, or start' } };
  }
  if (hasId && hasIndex) {
    return { error: { code: 'bad_args', message: 'Pass id or index, not both' } };
  }
  if (hasId) {
    const id = String(target.id);
    const { anchor: resolved } = resolveRollback(text, id);
    if (resolved === undefined) {
      return { error: { code: 'unknown_feature', message: `Rollback anchor unknown for id: ${id}` } };
    }
    return { anchor: resolved, rollbackAnchor: resolved };
  }
  const gap = chipIndexArg(target.index);
  if (gap == null || gap < 0 || gap > ids.length) {
    return {
      error: {
        code: 'bad_index',
        message: `Rollback gap index out of range: ${target.index} (0..${ids.length})`,
      },
    };
  }
  const anchor = rollbackAnchorAtGap(ids, gap);
  const display = anchor === undefined ? null : anchor;
  return { anchor, rollbackAnchor: display };
}
