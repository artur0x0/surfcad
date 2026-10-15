import { resolveUiEntryElement } from './resolveTarget.js';

/**
 * Extra highlight targets derived from command args (feature id, helper id, …).
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {string | undefined} uiEntry
 * @returns {Array<{ el?: Element | null, selector?: string }>}
 */
export function visibleTargetsForCommand(name, args, uiEntry) {
  const out = [];
  const primary = resolveUiEntryElement(uiEntry);
  if (primary) out.push({ el: primary });

  const featureId = typeof args?.featureId === 'string' ? args.featureId
    : (typeof args?.id === 'string' && name.includes('feature') ? args.id : null);
  if (featureId) {
    out.push({ selector: `[data-feature-id="${CSS.escape(featureId)}"]` });
  }

  if (name === 'set_script' || name === 'run') {
    out.push({ selector: '[data-editor-ribbon]' });
  }

  if (name.startsWith('sketch_') || name.startsWith('slot_')) {
    out.push({ selector: '[data-agent-viewport]' });
    out.push({ selector: '[data-contour-tool]' });
  }

  if (name.startsWith('select_')) {
    out.push({ selector: '[data-agent-viewport]' });
  }

  if (name === 'camera_fit' || name === 'zoom_to_selection') {
    out.push({ selector: '[data-agent-viewport]' });
  }

  return out;
}
