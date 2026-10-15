/**
 * Live tab bridge for a browser agent (Playwright, Claude-in-Chrome).
 *
 * The object sits on `window.surfcad` in the page, on the main thread.
 * The worker lockdown replaces `fetch` and the other host globals, so an
 * agent cannot drive the open tab from inside the sandbox.
 *
 * A call that changes the script is one undo step on the active part, the
 * same stack as the editor Undo button. `run()` of the text `setScript`
 * just wrote does not add a second step, so Undo once removes that edit.
 * `run()` of a buffer that is not yet the head (a typed edit that has not
 * committed) is that one step. Both calls write the editor and wait until
 * the viewport has run the script.
 *
 * On in dev. Elsewhere, the page URL `?agent=1` or localStorage
 * `surfcadAgent` = `1` opts in. Flag off, nothing is installed.
 */

import { parseFeatureMarkers } from './featureMarkers.js';
import { emptyPartHistory, pushPartHistory, undoPartHistory } from './partHistory.js';

export const AGENT_STORAGE_KEY = 'surfcadAgent';

const EMPTY_STATUS = Object.freeze({
  volume: null,
  bbox: null,
  partName: '',
  featureCount: 0,
});

/**
 * @param {{ dev?: boolean, location?: { search?: string } | null, localStorage?: { getItem?: (key: string) => string | null } | null }} [env]
 */
export function agentBridgeEnabled(env = {}) {
  if (env.dev === true) return true;
  const loc = Object.prototype.hasOwnProperty.call(env, 'location')
    ? env.location
    : (typeof location !== 'undefined' ? location : null);
  const store = Object.prototype.hasOwnProperty.call(env, 'localStorage')
    ? env.localStorage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  let query = false;
  try {
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    query = new URLSearchParams(search).get('agent') === '1';
  } catch {
    query = false;
  }
  let stored = false;
  try {
    stored = !!(store && typeof store.getItem === 'function' && store.getItem(AGENT_STORAGE_KEY) === '1');
  } catch {
    stored = false;
  }
  return query || stored;
}

/** Plain `{ min, max }` arrays, or null when the box is missing or non-finite. */
export function cloneAgentBbox(bbox) {
  if (!bbox || bbox.min == null || bbox.max == null) return null;
  const min = [Number(bbox.min[0]), Number(bbox.min[1]), Number(bbox.min[2])];
  const max = [Number(bbox.max[0]), Number(bbox.max[1]), Number(bbox.max[2])];
  if (![...min, ...max].every((n) => Number.isFinite(n))) return null;
  return { min, max };
}

export function agentFeatureCount(script) {
  return parseFeatureMarkers(typeof script === 'string' ? script : '').length;
}

/** Copy the stack so a later seed wipe cannot mutate the snapshot. */
export function cloneAgentHistory(history) {
  const base = history && Array.isArray(history.commits) ? history : emptyPartHistory();
  const head = Number.isInteger(base.head) ? base.head : -1;
  return { commits: base.commits.slice(), head };
}

/**
 * One undo step when `code` differs from the head. The same text is not a
 * second step (`pushPartHistory`).
 */
export function commitAgentStep(history, code, message) {
  return pushPartHistory(cloneAgentHistory(history), code, message);
}

function errorMessages(errors) {
  if (typeof errors === 'string') return errors ? [errors] : [];
  if (!Array.isArray(errors)) return [];
  const out = [];
  for (const item of errors) {
    if (typeof item === 'string' && item) out.push(item);
    else if (item && typeof item.message === 'string' && item.message) out.push(item.message);
  }
  return out;
}

function statusFrom(outcome, script) {
  const text = typeof script === 'string' ? script : '';
  const ok = outcome?.ok === true;
  const volume = Number(outcome?.volume);
  return {
    volume: ok && Number.isFinite(volume) ? volume : null,
    bbox: ok ? cloneAgentBbox(outcome?.bbox) : null,
    partName: typeof outcome?.partName === 'string' ? outcome.partName : '',
    featureCount: agentFeatureCount(text),
  };
}

function copyStatus(status) {
  const src = status || EMPTY_STATUS;
  return {
    volume: src.volume == null ? null : src.volume,
    bbox: src.bbox ? { min: src.bbox.min.slice(), max: src.bbox.max.slice() } : null,
    partName: src.partName || '',
    featureCount: src.featureCount || 0,
  };
}

/**
 * @param {{
 *   getScript: () => string,
 *   setEditor: (src: string) => void,
 *   readHistory: () => { commits: unknown[], head: number },
 *   writeHistory: (history: { commits: unknown[], head: number }) => void,
 *   execute: (src: string) => Promise<{ ok?: boolean, errors?: unknown, volume?: number, bbox?: object, partName?: string }>,
 *   screenshot: () => string | Promise<string>,
 * }} host
 */
export function createSurfcadBridge(host) {
  let chain = Promise.resolve();
  let lastErrors = [];
  let lastStatus = copyStatus(EMPTY_STATUS);

  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
  }

  function remember(outcome, script) {
    const errors = outcome?.ok === true ? [] : errorMessages(outcome?.errors);
    lastErrors = errors;
    lastStatus = statusFrom(outcome, script);
    return {
      ok: outcome?.ok === true,
      errors: errors.slice(),
      status: copyStatus(lastStatus),
    };
  }

  /**
   * Write `text`, run it, and record exactly one undo step when it differs
   * from the head. The history snapshot is taken before `execute`, because
   * the first real run seeds an assembly and replaces the stack.
   */
  function mutate(text, message) {
    return enqueue(async () => {
      const before = cloneAgentHistory(host.readHistory());
      host.setEditor(text);
      const outcome = await host.execute(text);
      host.writeHistory(commitAgentStep(before, text, message));
      return remember(outcome, text);
    });
  }

  return {
    getScript() {
      const text = host.getScript();
      return typeof text === 'string' ? text : '';
    },

    setScript(src) {
      if (typeof src !== 'string') {
        return Promise.resolve({
          ok: false,
          errors: ['setScript expects a string'],
          status: copyStatus(lastStatus),
        });
      }
      return mutate(src, 'Agent script');
    },

    run() {
      return mutate(host.getScript(), 'Agent run');
    },

    status() {
      return copyStatus(lastStatus);
    },

    errors() {
      return lastErrors.slice();
    },

    screenshot() {
      return Promise.resolve(host.screenshot()).then((png) => {
        if (typeof png !== 'string' || !png.startsWith('data:image/png')) {
          throw new Error('screenshot failed');
        }
        return png;
      });
    },

    /**
     * One step back on the active part, then the restored script runs.
     * Resolves to the same `{ ok, errors, status }` shape as `run()`.
     */
    undo() {
      return enqueue(async () => {
        const before = cloneAgentHistory(host.readHistory());
        const undone = undoPartHistory(before);
        if (undone.code == null) {
          return {
            ok: false,
            errors: ['Nothing to undo'],
            status: copyStatus(lastStatus),
          };
        }
        host.setEditor(undone.code);
        const outcome = await host.execute(undone.code);
        host.writeHistory(undone.history);
        return remember(outcome, undone.code);
      });
    },
  };
}
