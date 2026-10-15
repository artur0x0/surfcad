/**
 * Live tab bridge for a browser agent (Playwright, Claude-in-Chrome).
 *
 * The object sits on `window.surfcad` in the page, on the main thread.
 * The worker lockdown replaces `fetch` and the other host globals, so an
 * agent cannot drive the open tab from inside the sandbox.
 *
 * The stable entry is `call(name, argsJson)`. It resolves to a JSON
 * envelope `{ v, ok, result?, error? }`. Command names are snake_case.
 * Convenience methods are thin wrappers over that dispatcher.
 *
 * A call that changes the script is one undo step on the active part, the
 * same stack as the editor Undo button. `run` of the text `set_script`
 * just wrote does not add a second step, so Undo once removes that edit.
 * `run` of a buffer that is not yet the head (a typed edit that has not
 * committed) is that one step. Both calls write the editor and wait until
 * the viewport has run the script.
 *
 * On in dev. Elsewhere, the page URL `?agent=1` or localStorage
 * `surfcadAgent` = `1` opts in. Flag off, nothing is installed.
 *
 * Command bodies live in `src/agent/commands/`. This file owns the envelope,
 * the queue, and the one-undo mutate. `list_commands` is appended on v1.
 */

import { v1Registry } from '../agent/commands/index.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { emptyPartHistory, pushPartHistory } from './partHistory.js';

export const AGENT_STORAGE_KEY = 'surfcadAgent';

/** Envelope `v` and `window.surfcad.version`. Additive changes stay on this number. */
export const AGENT_BRIDGE_VERSION = 1;

/**
 * Command names, in the order an MCP tool list would publish them.
 * Snake case, stable. A new name may be appended on v1. Renaming one bumps the version.
 * The array is the registry's public order, including `list_commands`.
 */
export const AGENT_COMMANDS = v1Registry.names;

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

function pass(result) {
  return { v: AGENT_BRIDGE_VERSION, ok: true, result };
}

function fail(code, message) {
  return { v: AGENT_BRIDGE_VERSION, ok: false, error: { code, message } };
}

function bridgeError(error) {
  const err = new Error(error?.message || 'Agent bridge failed');
  err.code = error?.code || 'internal';
  return err;
}

/** True for data that `JSON.stringify` keeps without dropping or reshaping it. */
function isJsonValue(value) {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return true;
  if (kind === 'number') return Number.isFinite(value);
  if (kind !== 'object') return false;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return false;
  if (Array.isArray(value)) return value.every(isJsonValue);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(value).every((key) => isJsonValue(value[key]));
}

/**
 * `argsJson` is a JSON string (what an MCP relay sends) or a plain object.
 * The object path is cloned through JSON so a typed array cannot leak through.
 */
function parseArgs(argsJson) {
  if (argsJson == null || argsJson === '') return { ok: true, args: {} };
  if (typeof argsJson === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      return { ok: false, code: 'bad_json', message: 'args are not valid JSON' };
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 'bad_args', message: 'args must be a JSON object' };
    }
    return { ok: true, args: parsed };
  }
  if (!isJsonValue(argsJson) || Array.isArray(argsJson)) {
    return { ok: false, code: 'bad_args', message: 'args are not a JSON object' };
  }
  return { ok: true, args: JSON.parse(JSON.stringify(argsJson)) };
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
    lastErrors = errors.slice();
    lastStatus = statusFrom(outcome, script);
    return {
      ok: outcome?.ok === true,
      errors: lastErrors.slice(),
      status: copyStatus(lastStatus),
    };
  }

  /**
   * Write `text`, run it, and record exactly one undo step when it differs
   * from the head. The history snapshot is taken before `execute`, because
   * the first real run seeds an assembly and replaces the stack.
   */
  async function mutate(text, message) {
    const before = cloneAgentHistory(host.readHistory());
    host.setEditor(text);
    let outcome;
    try {
      outcome = await host.execute(text);
    } catch (err) {
      outcome = failedExecute(err);
    }
    host.writeHistory(commitAgentStep(before, text, message));
    return remember(outcome, text);
  }

  function failedExecute(err) {
    return {
      ok: false,
      errors: [String(err?.message || err)],
      volume: null,
      bbox: null,
      partName: '',
    };
  }

  /**
   * Handlers the command bodies call. Session state (last run, the queue,
   * one-undo mutate) stays here. The host methods are the ones App and
   * Viewport published.
   */
  const ctx = {
    getScript: () => host.getScript(),
    setEditor: (src) => host.setEditor(src),
    readHistory: () => host.readHistory(),
    writeHistory: (history) => host.writeHistory(history),
    execute: (src) => host.execute(src),
    screenshot: () => host.screenshot(),
    mutate,
    remember,
    readStatus: () => copyStatus(lastStatus),
    readErrors: () => lastErrors.slice(),
    cloneHistory: cloneAgentHistory,
    failedExecute,
    listCommands: () => v1Registry.catalog(),
  };

  function toEnvelope(out) {
    if (out && out.error) return fail(out.error.code, out.error.message);
    return pass(out ? out.result : undefined);
  }

  /**
   * Stable dispatcher. `argsJson` is a JSON string or a plain JSON object.
   * Resolves to `{ v, ok, result? , error? }`. A script that fails to build
   * is still `ok: true`: the CAD outcome is `result.ok` / `result.errors`.
   * Envelope `ok: false` means the command itself was refused.
   * Reads (`get_script`, `status`, `errors`, `list_commands`) do not wait
   * for a queued mutation. `set_script`, `run`, `screenshot`, and `undo` do.
   */
  function call(name, argsJson) {
    if (typeof name !== 'string' || !AGENT_COMMANDS.includes(name)) {
      const label = typeof name === 'string' ? name : typeof name;
      return Promise.resolve(fail('unknown_command', `Unknown command: ${label}`));
    }
    const parsed = parseArgs(argsJson);
    if (!parsed.ok) return Promise.resolve(fail(parsed.code, parsed.message));
    const args = parsed.args;
    const command = v1Registry.get(name);

    if (typeof command.checkArgs === 'function') {
      const refused = command.checkArgs(args);
      if (refused) return Promise.resolve(fail(refused.code, refused.message));
    }

    if (command.immediate) return Promise.resolve(toEnvelope(command.run(ctx, args)));

    return enqueue(async () => {
      try {
        return toEnvelope(await command.run(ctx, args));
      } catch (err) {
        return fail('internal', String(err?.message || err));
      }
    });
  }

  async function unwrap(envPromise) {
    const env = await envPromise;
    if (!env.ok) throw bridgeError(env.error);
    return env.result;
  }

  return {
    version: AGENT_BRIDGE_VERSION,
    commands: AGENT_COMMANDS,
    call,

    getScript() {
      return unwrap(call('get_script')).then((result) => result.source);
    },
    setScript(source) {
      return unwrap(call('set_script', { source }));
    },
    run() {
      return unwrap(call('run'));
    },
    status() {
      return unwrap(call('status'));
    },
    errors() {
      return unwrap(call('errors')).then((result) => result.errors);
    },
    screenshot() {
      return unwrap(call('screenshot', { format: 'png' })).then((result) => result.dataUrl);
    },
    undo() {
      return unwrap(call('undo'));
    },
    listCommands() {
      return unwrap(call('list_commands')).then((result) => result.commands);
    },
  };
}
