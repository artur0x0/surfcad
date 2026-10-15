/**
 * Command registry for the live-tab agent.
 *
 * A command is `{ name, schema, run(ctx, args), uiEntry?, example }`.
 * `schema` is a JSON-schema-ish description of the args object. `example`
 * is one valid args object. `run` returns `{ result }` or `{ error: { code, message } }`.
 * `uiEntry`, when set, is a `data-*` attribute name or a helper id, or a
 * list of them when one command drives several controls. Visible mode uses
 * it to flash matching `data-ui-action` / data-* controls; handlers are
 * unchanged (no parallel DOM-click path).
 *
 * Names are snake_case. Appending a name stays on bridge v1. Renaming one
 * bumps the version. Commerce is not registered here; see `exempt.js`.
 */

const NAME_RE = /^[a-z][a-z0-9_]*$/;
const DATA_ATTR_RE = /^data-[a-z0-9-]+$/;
const HELPER_ID_RE = /^[A-Za-z][A-Za-z0-9]*$/;

import { NO_ARGS_SCHEMA as STRICT_NO_ARGS } from './schemas/common.js';

/** Args object for a command that reads nothing. */
export const NO_ARGS_SCHEMA = STRICT_NO_ARGS;

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

function assertJsonObject(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (!isJsonValue(value)) throw new Error(`${label} is not JSON`);
  return JSON.parse(JSON.stringify(value));
}

function assertUiEntry(uiEntry, name) {
  if (uiEntry == null) return;
  const list = Array.isArray(uiEntry) ? uiEntry : [uiEntry];
  const ok = list.length > 0 && list.every((entry) => (
    typeof entry === 'string' && (DATA_ATTR_RE.test(entry) || HELPER_ID_RE.test(entry))
  ));
  if (!ok) {
    throw new Error(`agent command ${name} uiEntry must be a data-* selector or helper id, or a list of them`);
  }
}

function assertCommand(command) {
  if (command == null || typeof command !== 'object') {
    throw new Error('agent command must be an object');
  }
  const name = command.name;
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`agent command name must be snake_case, got ${JSON.stringify(name)}`);
  }
  if (command.schema == null || command.schema.type !== 'object') {
    throw new Error(`agent command ${name} schema must be a JSON object schema`);
  }
  assertJsonObject(command.schema, `agent command ${name} schema`);
  assertJsonObject(command.example, `agent command ${name} example`);
  if (typeof command.run !== 'function') {
    throw new Error(`agent command ${name} needs run(ctx, args)`);
  }
  if (command.checkArgs != null && typeof command.checkArgs !== 'function') {
    throw new Error(`agent command ${name} checkArgs must be a function`);
  }
  if (command.immediate != null && typeof command.immediate !== 'boolean') {
    throw new Error(`agent command ${name} immediate must be boolean`);
  }
  assertUiEntry(command.uiEntry, name);
}

/**
 * @param {Array<object>} commands Registration order is the public order.
 */
export function defineCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('agent registry needs at least one command');
  }
  const seen = new Set();
  const list = [];
  for (const command of commands) {
    assertCommand(command);
    if (seen.has(command.name)) throw new Error(`duplicate agent command: ${command.name}`);
    seen.add(command.name);
    const schema = assertJsonObject(command.schema, `agent command ${command.name} schema`);
    const example = assertJsonObject(command.example, `agent command ${command.name} example`);
    const entry = {
      name: command.name,
      schema,
      example,
      run: command.run,
      immediate: command.immediate === true,
    };
    if (typeof command.checkArgs === 'function') entry.checkArgs = command.checkArgs;
    if (Array.isArray(command.uiEntry)) entry.uiEntry = Object.freeze(command.uiEntry.slice());
    else if (command.uiEntry != null) entry.uiEntry = command.uiEntry;
    list.push(Object.freeze(entry));
  }
  const byName = new Map(list.map((command) => [command.name, command]));
  return Object.freeze({
    names: Object.freeze(list.map((command) => command.name)),
    get(name) {
      return byName.get(name) || null;
    },
    /** `{ name, schema, example }` for every command, in registration order. */
    catalog() {
      return list.map((command) => ({
        name: command.name,
        schema: JSON.parse(JSON.stringify(command.schema)),
        example: JSON.parse(JSON.stringify(command.example)),
      }));
    },
  });
}
