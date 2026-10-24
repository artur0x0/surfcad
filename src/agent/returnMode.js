/**
 * The `return` argument: how much of the part status a tool result carries.
 *
 * Every command whose result carries `status` (the mutating tools, `undo`,
 * `redo`, and `status` itself) takes `return: "status" | "summary" | "full"`.
 * The dispatcher strips it before the command runs and reshapes `status`
 * afterwards, so no command body knows about it:
 *
 * - `status`  drops `status.script` (the whole script was echoed on every call).
 * - `summary` drops the script and adds `status.features`, the feature strip rows.
 * - `full`    is the unchanged result. The bridge default, so the UI, the
 *             goldens, and existing agents see no change; the MCP server
 *             defaults to `status` and says so in each tool description.
 *
 * `get_script` reads the script when it is wanted.
 */

import { parseFeatureMarkers } from '../utils/featureMarkers.js';
import { metaForCommand } from './export/commandMeta.js';

export const RETURN_MODES = Object.freeze(['status', 'summary', 'full']);

/** The `return` property, shared by every command that takes it. */
export const RETURN_ARG_SCHEMA = Object.freeze({
  type: 'string',
  enum: RETURN_MODES,
  description: 'How much of status to return: "status" drops status.script, "summary" drops it and adds status.features (the feature strip), "full" keeps the whole script. Over MCP the default is "status"; in the page it is "full". Read the script with get_script.',
});

/** Appended to the description of every command that takes `return`. */
export const RETURN_NOTE = ' Takes return: "status" | "summary" | "full" (MCP default "status": status.script is omitted; "summary" adds status.features; "full" echoes the script).';

/** Does this command take the `return` argument? Its result carries `status`. */
export function takesReturnArg(name) {
  if (name === 'status') return true;
  return metaForCommand(name)?.mutates === true;
}

/** A registry command with `return` added to its args schema (one place for 70+ commands). */
export function withReturnArg(command) {
  if (!command || !takesReturnArg(command.name)) return command;
  const schema = command.schema || {};
  const properties = schema.properties || {};
  if (properties.return) return command;
  return Object.freeze({
    ...command,
    schema: Object.freeze({
      ...schema,
      properties: Object.freeze({ ...properties, return: RETURN_ARG_SCHEMA }),
    }),
  });
}

/**
 * Split `return` off the args. `mode` is null when the caller did not pass it.
 * @param {Record<string, unknown>} args
 * @returns {{ args: Record<string, unknown>, mode: string | null, error?: { code: string, message: string } }}
 */
export function takeReturnMode(args) {
  if (!args || typeof args !== 'object' || !Object.prototype.hasOwnProperty.call(args, 'return')) {
    return { args: args || {}, mode: null };
  }
  const { return: mode, ...rest } = args;
  if (mode == null) return { args: rest, mode: null };
  if (typeof mode !== 'string' || !RETURN_MODES.includes(mode)) {
    return {
      args: rest,
      mode: null,
      error: { code: 'bad_args', message: `return must be one of ${RETURN_MODES.join(', ')}` },
    };
  }
  return { args: rest, mode };
}

/**
 * Feature strip rows for a script, the same ids `feature_tree` reports.
 * `featureMs` (`status.featureMs`) adds each block's kernel time as `ms`.
 */
export function featureSummary(script, featureMs = null) {
  const ms = featureMs && typeof featureMs === 'object' ? featureMs : null;
  return parseFeatureMarkers(typeof script === 'string' ? script : '').map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    chipLabel: row.chipLabel,
    index: row.index,
    ...(ms && Number.isFinite(Number(ms[row.id])) ? { ms: Number(ms[row.id]) } : {}),
  }));
}

function shapeStatus(status, mode) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return status;
  const { script, ...rest } = status;
  if (mode === 'summary') return { ...rest, features: featureSummary(script, rest.featureMs) };
  return rest;
}

/**
 * Reshape a command result for `mode`. `status` is the status object itself;
 * every other command carries it as `result.status`. Results without a
 * status object are returned as they are.
 */
export function applyReturnMode(name, result, mode) {
  if (!mode || mode === 'full') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (name === 'status') return shapeStatus(result, mode);
  if (!result.status || typeof result.status !== 'object') return result;
  return { ...result, status: shapeStatus(result.status, mode) };
}
