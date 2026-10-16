import { defineCommands } from '../registry.js';
import { getScriptCommand } from './getScript.js';
import { setScriptCommand } from './setScript.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { errorsCommand } from './errors.js';
import { screenshotCommand } from './screenshot.js';
import { undoCommand } from './undo.js';
import { redoCommand } from './redo.js';
import { historyCommand } from './history.js';
import { listCommandsCommand } from './listCommands.js';
import { featureTreeCommand } from './featureTree.js';
import { selectionCommand } from './selection.js';
import { modeCommand } from './mode.js';
import { dirtyCommand } from './dirty.js';
import { toastsCommand } from './toasts.js';
import { partsCommand } from './parts.js';
import { cameraCommand } from './camera.js';
import { selectClearCommand } from './selectClear.js';
import { selectFacesCommand } from './selectFaces.js';
import { selectEdgesCommand } from './selectEdges.js';
import { selectPartsCommand } from './selectParts.js';
import { setActivePartCommand } from './setActivePart.js';
import { cameraSetCommand } from './cameraSet.js';
import { cameraFitCommand } from './cameraFit.js';
import { zoomToSelectionCommand } from './zoomToSelection.js';
import { listFacesCommand } from './listFaces.js';
import { listEdgesCommand } from './listEdges.js';
import { listFeatureEdgesCommand } from './listFeatureEdges.js';
import { invokeHelperCommand, buildHelperPaletteCommands } from './invokeHelper.js';
import {
  openFeatureCommand,
  activateFeatureCommand,
  editFeatureCommand,
  confirmFeatureCommand,
  cancelFeatureCommand,
  deleteFeatureCommand,
  rollbackToCommand,
} from './featureStrip.js';
import { sketchBeginCommand } from './sketchBegin.js';
import { sketchAcceptPlaneCommand } from './sketchAcceptPlane.js';
import { sketchAddCommand } from './sketchAdd.js';
import { sketchCommitCommand } from './sketchCommit.js';
import { sketchCancelCommand } from './sketchCancel.js';
import { sketchDimensionCommand } from './sketchDimension.js';
import { sketchConstrainCommand } from './sketchConstrain.js';
import { slotOpenCommand } from './slotOpen.js';
import { slotAssignContourCommand } from './slotAssignContour.js';
import { slotSetParamsCommand } from './slotSetParams.js';
import { slotCommitCommand } from './slotCommit.js';
import { slotCancelCommand } from './slotCancel.js';
import { agentSetVisibleCommand } from './agentSetVisible.js';
import {
  pickBeginCommand,
  pickNextCommand,
  pickUndoCommand,
  pickClearCommand,
  pickDoneCommand,
  pickCancelCommand,
  pickStateCommand,
  pickFacesCommand,
  pickEdgesCommand,
  pickPointsCommand,
} from './pick.js';
import {
  holeOpenCommand,
  holeSetParamsCommand,
  holeBeginCentresCommand,
  holeCommitCommand,
  holeCancelCommand,
} from './hole.js';
import {
  planeSetCommand,
  workplaneSelectCommand,
  setActiveWorkplaneCommand,
} from './plane.js';
import { listSketchEntitiesCommand } from './listSketchEntities.js';
import {
  createAssemblyCommand,
  createPartCommand,
  openAssemblyCommand,
  openPartCommand,
  insertPartCommand,
} from './document.js';
import {
  gitMoveToRepoCommand,
  gitSaveCommand,
  gitAddToRepoCommand,
  gitBehindResolveCommand,
  gitBranchCreateCommand,
  gitBranchSwitchCommand,
  gitBranchDeleteCommand,
  gitForceOverwriteCommand,
  gitListBranchesCommand,
} from './git.js';
import {
  jointOpenCommand,
  jointSetParamsCommand,
  jointPickCommand,
  jointCommitCommand,
  jointCancelCommand,
  jointSelectCommand,
  jointEditCommand,
} from './joint.js';
import {
  sheetOpenCommand,
  sheetStartCommand,
  sheetSetToolCommand,
  sheetSetParamsCommand,
  sheetPickCommand,
  sheetCommitCommand,
  sheetCancelCommand,
  sheetExitCommand,
  sheetCheckCommand,
  sheetRefoldCommand,
  sheetDoneCommand,
  sheetEditCommand,
  sheetBeginHoleCommand,
} from './sheet.js';
import { exportPartCommand, exportDownloadCommand } from './export.js';

const HELPER_COMMANDS = buildHelperPaletteCommands();

/**
 * Public order. The first seven names are the original v1 tool list.
 * `list_commands` is next. H2 state readers are appended after it.
 * H3 selection and camera writers follow the readers.
 * H4 helper inserts and grouped edge catalog follow H3.
 * H5 feature strip / rollback commands follow H4.
 * H6 sketch and H8 slot helpers follow H3 writers.
 * H9 pick sessions follow H8.
 * H10 hole card, plane/workplane, sketch point picks follow H9.
 * H11 parts, assemblies, and joints follow H10.
 * H12 git ribbon commands follow H11.
 * H14 sheet-metal flow follows H12.
 * H16 export (STL/3MF/STEP) follows H14.
 */
export const V1_COMMANDS = Object.freeze([
  getScriptCommand,
  setScriptCommand,
  runCommand,
  statusCommand,
  errorsCommand,
  screenshotCommand,
  undoCommand,
  redoCommand,
  historyCommand,
  listCommandsCommand,
  agentSetVisibleCommand,
  featureTreeCommand,
  selectionCommand,
  modeCommand,
  dirtyCommand,
  toastsCommand,
  partsCommand,
  cameraCommand,
  listFacesCommand,
  listEdgesCommand,
  listFeatureEdgesCommand,
  invokeHelperCommand,
  ...HELPER_COMMANDS,
  openFeatureCommand,
  activateFeatureCommand,
  editFeatureCommand,
  confirmFeatureCommand,
  cancelFeatureCommand,
  deleteFeatureCommand,
  rollbackToCommand,
  selectClearCommand,
  selectFacesCommand,
  selectEdgesCommand,
  selectPartsCommand,
  setActivePartCommand,
  cameraSetCommand,
  cameraFitCommand,
  zoomToSelectionCommand,
  sketchBeginCommand,
  sketchAcceptPlaneCommand,
  sketchAddCommand,
  sketchCommitCommand,
  sketchCancelCommand,
  sketchDimensionCommand,
  sketchConstrainCommand,
  slotOpenCommand,
  slotAssignContourCommand,
  slotSetParamsCommand,
  slotCommitCommand,
  slotCancelCommand,
  pickBeginCommand,
  pickNextCommand,
  pickUndoCommand,
  pickClearCommand,
  pickDoneCommand,
  pickCancelCommand,
  pickStateCommand,
  pickFacesCommand,
  pickEdgesCommand,
  pickPointsCommand,
  holeOpenCommand,
  holeSetParamsCommand,
  holeBeginCentresCommand,
  holeCommitCommand,
  holeCancelCommand,
  planeSetCommand,
  workplaneSelectCommand,
  setActiveWorkplaneCommand,
  listSketchEntitiesCommand,
  createAssemblyCommand,
  createPartCommand,
  openAssemblyCommand,
  openPartCommand,
  insertPartCommand,
  jointOpenCommand,
  jointSetParamsCommand,
  jointPickCommand,
  jointCommitCommand,
  jointCancelCommand,
  jointSelectCommand,
  jointEditCommand,
  sheetOpenCommand,
  sheetStartCommand,
  sheetSetToolCommand,
  sheetSetParamsCommand,
  sheetPickCommand,
  sheetCommitCommand,
  sheetCancelCommand,
  sheetExitCommand,
  sheetCheckCommand,
  sheetRefoldCommand,
  sheetDoneCommand,
  sheetEditCommand,
  sheetBeginHoleCommand,
  gitMoveToRepoCommand,
  gitSaveCommand,
  gitAddToRepoCommand,
  gitBehindResolveCommand,
  gitBranchCreateCommand,
  gitBranchSwitchCommand,
  gitBranchDeleteCommand,
  gitForceOverwriteCommand,
  gitListBranchesCommand,
  exportPartCommand,
  exportDownloadCommand,
]);

export const v1Registry = defineCommands(V1_COMMANDS);
