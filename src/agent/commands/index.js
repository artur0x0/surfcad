import { defineCommands } from '../registry.js';
import { getScriptCommand } from './getScript.js';
import { setScriptCommand } from './setScript.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { errorsCommand } from './errors.js';
import { screenshotCommand } from './screenshot.js';
import { undoCommand } from './undo.js';
import { listCommandsCommand } from './listCommands.js';

/**
 * Public order. The first seven names are the original v1 tool list.
 * `list_commands` is appended. A later command is appended after it.
 */
export const V1_COMMANDS = Object.freeze([
  getScriptCommand,
  setScriptCommand,
  runCommand,
  statusCommand,
  errorsCommand,
  screenshotCommand,
  undoCommand,
  listCommandsCommand,
]);

export const v1Registry = defineCommands(V1_COMMANDS);
