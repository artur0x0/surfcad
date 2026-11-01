/**
 * H5 feature strip: resolve strip chips to script markers and rollback anchors.
 */

import { parseFeatureMarkers } from '../utils/featureMarkers.js';
import { deleteContourStatement } from '../utils/contourUsers.js';
import { deleteFeatureEdit, partDeclarationDeletePlan } from '../utils/featureEdit.js';
import { liveSheetFeature } from '../utils/featureSheetWriteback.js';
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
    chip = tree.features.find((row) => row.id === id)
      || tree.features.find((row) => row.kind === 'contour' && row.id === `contour:${id}`);
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

const STALE_FEATURE = 'That feature is not in this part\'s script any more — pick it again.';

/**
 * Delete one strip chip. A contour is its `@contour` statement, not a
 * feature block: `contour:<id>`, the bare contour id, or its strip index
 * all drop that statement. A contour something still names needs
 * `confirm: true`, which also drops those features. A marked feature keeps
 * the part-declaration confirm.
 *
 * @param {string} script
 * @param {{ id?: string, index?: number, confirm?: boolean }} args
 */
export function planStripDelete(script, args = {}) {
  const resolved = resolveStripTarget(script, args);
  if (resolved.error) return resolved;
  if (resolved.contourId) {
    const saved = deleteContourStatement(script, resolved.contourId, {
      withFeatures: args.confirm === true,
    });
    if (!saved.ok) {
      if (saved.confirm) {
        return {
          error: {
            code: 'confirm_required',
            message: saved.message,
            details: { featureId: resolved.chip.id, dependents: saved.count },
          },
        };
      }
      return {
        error: { code: 'delete_failed', message: saved.message || 'Could not delete that contour.' },
      };
    }
    return {
      source: saved.buffer,
      message: `Delete ${saved.name || resolved.contourId}`,
      featureId: resolved.chip.id,
    };
  }
  const live = liveSheetFeature(script, resolved.feature);
  if (!live) return { error: { code: 'delete_failed', message: STALE_FEATURE } };
  const label = live.chipLabel || live.label || live.kind || 'feature';
  const base = partDeclarationDeletePlan(script, live);
  if (base && args.confirm !== true) {
    const who = base.count > 0
      ? `${base.count} later feature${base.count === 1 ? ' still uses' : 's still use'} part and will fail`
      : 'later code still uses part and will fail';
    return {
      error: {
        code: 'confirm_required',
        message: `${label} declares part; ${who}. Pass confirm: true to delete it anyway.`,
        details: { featureId: live.id, dependents: base.count },
      },
    };
  }
  const result = deleteFeatureEdit(script, live);
  if (!result.ok) return { error: { code: 'delete_failed', message: result.message } };
  return {
    source: result.buffer,
    message: `Delete ${label}`,
    featureId: live.id,
    warning: base
      ? `${label} declared part; ${base.count > 0 ? `${base.count} later feature${base.count === 1 ? ' uses' : 's use'}` : 'later code uses'} part and will fail until you fix or undo.`
      : null,
  };
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
