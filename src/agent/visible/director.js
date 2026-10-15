import { visibleTargetsForCommand } from './commandHints.js';
import { elementClientCenter, resolveUiEntryElement } from './resolveTarget.js';

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * @param {ReturnType<import('./overlay.js').createAgentVisibleOverlay>} overlay
 * @param {() => import('./options.js').DEFAULT_AGENT_VISIBLE_OPTIONS} readOptions
 */
export function createAgentVisibleDirector(overlay, readOptions) {
  async function cueTargets(name, args, uiEntry) {
    const opts = readOptions();
    if (!opts.enabled) return;
    const hints = visibleTargetsForCommand(name, args, uiEntry);
    const seen = new Set();
    for (const hint of hints) {
      const el = hint.el || (hint.selector ? document.querySelector(hint.selector) : null);
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const { x, y } = elementClientCenter(el);
      if (opts.cursor) await overlay.moveCursorTo({ x, y });
      if (opts.ripple) await overlay.rippleAt({ x, y });
      if (opts.highlight) await overlay.flashHighlight(el);
    }
    const entries = Array.isArray(uiEntry) ? uiEntry : (uiEntry ? [uiEntry] : []);
    if (!hints.length && entries.length) {
      for (const entry of entries) {
        const el = resolveUiEntryElement(entry);
        if (!el) continue;
        const { x, y } = elementClientCenter(el);
        if (opts.cursor) await overlay.moveCursorTo({ x, y });
        if (opts.highlight) await overlay.flashHighlight(el);
      }
    }
    if (opts.stepDelayMs > 0) await sleep(opts.stepDelayMs);
  }

  return {
    async before({ name, args, command }) {
      const opts = readOptions();
      if (!opts.enabled) return;
      await cueTargets(name, args || {}, command?.uiEntry);
    },
    async after({ name, args, command, envelope }) {
      const opts = readOptions();
      if (!opts.enabled || !envelope?.ok) return;
      if (name.startsWith('select_')) {
        await overlay.flashRegion('[data-agent-viewport]', { ms: 360 });
      }
      if (name === 'confirm_feature' || name === 'edit_feature') {
        await overlay.flashRegion('[data-feature-strip]', { ms: 420 });
      }
      const featureId = typeof args?.featureId === 'string' ? args.featureId : null;
      if (featureId) {
        await overlay.flashRegion(`[data-feature-id="${CSS.escape(featureId)}"]`, { ms: 420 });
      }
      if (command?.uiEntry && (name.startsWith('insert_') || name === 'invoke_helper')) {
        const el = resolveUiEntryElement(command.uiEntry);
        if (el) await overlay.flashHighlight(el, { ms: 280 });
      }
    },
  };
}
