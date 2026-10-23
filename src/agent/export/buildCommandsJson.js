/**
 * Build the machine-readable bridge command catalog for MCP tool generation.
 */

import { V1_COMMANDS } from '../commands/index.js';
import { metaForCommand } from './commandMeta.js';
import { RETURN_NOTE, takesReturnArg } from '../returnMode.js';
import { groupForCommand } from './commandGroups.js';
import { ambiguousArgProperties, validateArgsSchema } from './schemaPolicy.js';
import { STATUS_SCHEMA, MUTATE_RESULT_SCHEMA, NO_ARGS_SCHEMA } from '../schemas/common.js';

export const BRIDGE_VERSION = 1;
export const COMMANDS_JSON_PATH = 'src/agent/commands.json';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function uiEntryExport(command) {
  if (command.uiEntry == null) return null;
  if (Array.isArray(command.uiEntry)) return command.uiEntry.slice();
  return command.uiEntry;
}

/**
 * @param {object} command Registry command row
 * @param {object} [raw] Original registration (may carry export overrides)
 */
export function buildCommandEntry(command, raw) {
  const meta = { ...metaForCommand(command.name), ...(raw?.export || {}) };
  const args = cloneJson(command.schema);
  // The registry added `return` to this schema (commands/index.js); the
  // description says so once, here, instead of in 70+ meta strings.
  const description = takesReturnArg(command.name) ? `${meta.description}${RETURN_NOTE}` : meta.description;
  const entry = {
    name: command.name,
    description,
    args,
    result: cloneJson(meta.result || { type: 'object', additionalProperties: true }),
    errors: [...(meta.errors || ['bad_args', 'internal'])],
    mutates: meta.mutates === true,
    destructive: meta.destructive === true,
    confirm: meta.confirm === true,
    group: groupForCommand(command.name),
    immediate: command.immediate === true,
    uiEntry: uiEntryExport(command),
    example: cloneJson(command.example),
  };
  return entry;
}

export function buildCommandsDocument() {
  const byName = new Map(V1_COMMANDS.map((raw) => [raw.name, raw]));
  const commands = [];
  const schemaErrors = [];
  const ambiguous = [];

  for (const command of V1_COMMANDS) {
    if (command.catalog === false) continue;
    const reg = command;
    const name = reg.name;
    const policy = validateArgsSchema(name, reg.schema);
    if (!policy.ok) {
      schemaErrors.push(`${name}: ${policy.reasons.join('; ')}`);
    }
    const amb = ambiguousArgProperties(reg.schema);
    if (amb.length) ambiguous.push({ name, properties: amb });
    commands.push(buildCommandEntry(reg, byName.get(name)));
  }

  return {
    document: Object.freeze({
      version: BRIDGE_VERSION,
      bridgeVersion: BRIDGE_VERSION,
      generatedBy: 'npm run export:agent',
      count: commands.length,
      $defs: Object.freeze({
        status: cloneJson(STATUS_SCHEMA),
        mutateResult: cloneJson(MUTATE_RESULT_SCHEMA),
        noArgs: cloneJson(NO_ARGS_SCHEMA),
      }),
      commands,
    }),
    schemaErrors,
    ambiguous,
  };
}

export function serializeCommandsDocument(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
