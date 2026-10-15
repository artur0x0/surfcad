import { defineCommands } from '../registry.js';
import { getScriptCommand } from './getScript.js';
import { setScriptCommand } from './setScript.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { errorsCommand } from './errors.js';
import { screenshotCommand } from './screenshot.js';
import { undoCommand } from './undo.js';
import { listCommandsCommand } from './listCommands.js';
import { featureTreeCommand } from './featureTree.js';
import { selectionCommand } from './selection.js';
import { modeCommand } from './mode.js';
import { dirtyCommand } from './dirty.js';
import { toastsCommand } from './toasts.js';
import { partsCommand } from './parts.js';
import { cameraCommand } from './camera.js';

/**
 * Public order. The first seven names are the original v1 tool list.
 * `list_commands` is next. H2 state readers are appended after it.
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
  featureTreeCommand,
  selectionCommand,
  modeCommand,
  dirtyCommand,
  toastsCommand,
  partsCommand,
  cameraCommand,
]);

export const v1Registry = defineCommands(V1_COMMANDS);
