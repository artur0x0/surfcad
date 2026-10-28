import { defineCommands } from '../registry.js';
import { withReturnArg } from '../returnMode.js';
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
import { setPartVisibleCommand } from './setPartVisible.js';
import { cameraSetCommand } from './cameraSet.js';
import { cameraFitCommand } from './cameraFit.js';
import { zoomToSelectionCommand } from './zoomToSelection.js';
import { listFacesCommand } from './listFaces.js';
import { listBodiesCommand } from './listBodies.js';
import { geometryWorkersCommand } from './geometryWorkers.js';
import { gitTimingsCommand } from './gitTimings.js';
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
import { sketchEditCommand } from './sketchEdit.js';
import { sketchCancelCommand } from './sketchCancel.js';
import { sketchUndoCommand } from './sketchUndo.js';
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
import { setSketchOverlayCommand } from './viewportDisplay.js';
import { listSketchEntitiesCommand } from './listSketchEntities.js';
import {
  createAssemblyCommand,
  createPartCommand,
  renamePartCommand,
  openAssemblyCommand,
  openPartCommand,
  insertPartCommand,
  listAssembliesCommand,
  deletePartCommand,
  deleteAssemblyCommand,
  renameAssemblyCommand,
} from './document.js';
import { partGetTransformCommand, partSetTransformCommand } from './partTransform.js';
import {
  gitMoveToRepoCommand,
  gitSaveCommand,
  gitUpgradeVaultCommand,
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
  jointCreateCommand,
  jointDeleteCommand,
  listJointsCommand,
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
import {
  paintOpenCommand,
  paintCloseCommand,
  paintSetColorCommand,
  paintFacesCommand,
  paintPartCommand,
  paintUndoCommand,
  paintClearCommand,
  paintConfirmCommand,
  paintCancelCommand,
  paintStateCommand, paintCommand } from './paint.js';
import {
  measureOpenCommand,
  measureCloseCommand,
  measureSetUnitCommand,
  measurePickCommand,
  measureClearCommand,
  measureStateCommand,
} from './measure.js';
import {
  feaOpenCommand,
  feaCloseCommand,
  feaSetMaterialCommand,
  feaSetTargetCommand,
  feaSetFixtureCommand,
  feaFixCommand,
  feaSetForceCommand,
  feaSetPressureCommand,
  feaRemoveFixtureCommand,
  feaRemoveLoadCommand,
  feaRunCommand,
  feaCancelCommand,
  feaBackToSetupCommand,
  feaStateCommand,
  feaResultsCommand,
  feaPickCommand,
} from './fea.js';
import { exportPartCommand, exportDownloadCommand } from './export.js';
import {
  crossSectionToggleCommand,
  crossSectionExpandCommand,
  crossSectionPlaneCommand,
  crossSectionOffsetCommand,
  crossSectionStateCommand,
} from './xsection.js';
import { cadSelectAllCommand } from './cadSelectAll.js';
import { sketchDeleteEntityCommand } from './sketchDeleteEntity.js';
import { agentPromptCommand } from './agentPrompt.js';

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
 * H13 measure and paint follow H14.
 * FEA study bridge and H16 export (STL/3MF/STEP) follow H13.
 * Cross-section view, editor select-all, and sketch entity delete follow FEA.
 * The in-viewer agent prompt follows those.
 */
const V1_COMMAND_LIST = [
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
  listBodiesCommand,
  geometryWorkersCommand,
  gitTimingsCommand,
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
  setPartVisibleCommand,
  cameraSetCommand,
  cameraFitCommand,
  zoomToSelectionCommand,
  sketchBeginCommand,
  sketchAcceptPlaneCommand,
  sketchAddCommand,
  sketchCommitCommand,
  sketchEditCommand,
  sketchCancelCommand,
  sketchUndoCommand,
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
  setSketchOverlayCommand,
  listSketchEntitiesCommand,
  createAssemblyCommand,
  createPartCommand,
  renamePartCommand,
  renameAssemblyCommand,
  partGetTransformCommand,
  partSetTransformCommand,
  openAssemblyCommand,
  openPartCommand,
  insertPartCommand,
  listAssembliesCommand,
  deletePartCommand,
  deleteAssemblyCommand,
  jointOpenCommand,
  jointSetParamsCommand,
  jointPickCommand,
  jointCommitCommand,
  jointCancelCommand,
  jointSelectCommand,
  jointEditCommand,
  jointCreateCommand,
  jointDeleteCommand,
  listJointsCommand,
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
  paintOpenCommand,
  paintCloseCommand,
  paintSetColorCommand,
  paintFacesCommand,
  paintPartCommand,
  paintUndoCommand,
  paintClearCommand,
  paintConfirmCommand,
  paintCommand,
  paintCancelCommand,
  paintStateCommand,
  measureOpenCommand,
  measureCloseCommand,
  measureSetUnitCommand,
  measurePickCommand,
  measureClearCommand,
  measureStateCommand,
  crossSectionToggleCommand,
  crossSectionExpandCommand,
  crossSectionPlaneCommand,
  crossSectionOffsetCommand,
  crossSectionStateCommand,
  cadSelectAllCommand,
  sketchDeleteEntityCommand,
  agentPromptCommand,
  feaOpenCommand,
  feaCloseCommand,
  feaSetMaterialCommand,
  feaSetTargetCommand,
  feaSetFixtureCommand,
  feaFixCommand,
  feaSetForceCommand,
  feaSetPressureCommand,
  feaRemoveFixtureCommand,
  feaRemoveLoadCommand,
  feaRunCommand,
  feaCancelCommand,
  feaBackToSetupCommand,
  feaStateCommand,
  feaResultsCommand,
  feaPickCommand,
  gitMoveToRepoCommand,
  gitSaveCommand,
  gitUpgradeVaultCommand,
  gitAddToRepoCommand,
  gitBehindResolveCommand,
  gitBranchCreateCommand,
  gitBranchSwitchCommand,
  gitBranchDeleteCommand,
  gitForceOverwriteCommand,
  gitListBranchesCommand,
  exportPartCommand,
  exportDownloadCommand,
];

/**
 * Every command whose result carries `status` (the mutating tools, undo,
 * redo, and status) takes `return` (returnMode.js); it is added here, once,
 * so the registry schema, list_commands, and commands.json agree.
 */
export const V1_COMMANDS = Object.freeze(V1_COMMAND_LIST.map(withReturnArg));

export const v1Registry = defineCommands(V1_COMMANDS);
