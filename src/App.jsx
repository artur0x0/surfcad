/* eslint-disable no-use-before-define -- callback bodies close over later consts; re-enabled at lastCommit reload */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import CodeEditor from './components/CodeEditor';
import Viewport from './components/Viewport';
import { BrandMark, BrandWordmark } from './components/brand/BrandWordmark';
import { clearLoadingTheme, readLoadingTheme } from './utils/loadingTheme';
import { solidCacheStats } from './utils/partSolidCache.js';
import PromptInput from './components/PromptInput';
import { agentPromptContext } from './agent/agentPromptLive.js';
import { allowFeaturePopup, registerFeaturePopupDismiss } from './agent/agentFeaturePopupGate.js';
import { beginAgentJointSession } from './agent/jointPromptGate.js';
import { featureEditOpenPlan, featureEditParamError } from './agent/featureEditParams.js';
import SplitDivider from './components/SplitDivider';
import ScriptEditorDrawer from './components/ScriptEditorDrawer';
import MobileStageToggle from './components/MobileStageToggle';
import FeatureStrip from './components/FeatureStrip';
import JointsRow from './components/JointsRow';
import { FeatureDeleteToast } from './components/FeatureEditDelete';
import { failedFeatureFromOutcome, failedFeatureIds, failedFeatureTitles } from './utils/featureFailure';
import {
  commitScriptAtRollback,
  repairScriptReturns,
  rollbackAnchorAfterInsert,
  rollbackAnchorsAfterOpen,
  rollbackClearsPart,
  rollbackInsertCaret,
} from './utils/featureSkip';
import { failedPartIdsFor } from './utils/failedPartOutline';
import { bodyCountOfWorkerMesh } from './utils/meshBodyComponents';
import ErrorPopup from './components/ErrorPopup';
import GitBehindToast from './components/GitBehindToast';
import AssemblyOpenSpinner, { AssemblyOpenFailureToast } from './components/AssemblyOpenSpinner';
import { landingMobileStage, linkedMobileStage } from './utils/mobileStage';
import {
  writeFeatureSheetParams,
  listFeatureSheetTargets,
  pickDefaultFeatureSheetTarget,
  isFeatureSheetEditable,
  liveSheetFeature,
} from './utils/featureSheetWriteback';
import { confirmFeatureEdit, deleteFeatureEdit, partDeclarationDeletePlan } from './utils/featureEdit';
import QuoteModal from './components/QuoteModal';
import { calculateQuote } from './utils/quoting';
import OrderModal from './components/OrderModal';
import LoginModal from './components/LoginModal';
import AccountModal from './components/AccountModal';
import { useAuth } from './hooks/useAuth';
import { useAuthState } from './hooks/useAuthState';
import { CartChromeProvider, useCart } from './hooks/useCart';
import CartSheet from './components/CartSheet';
import CartDrop from './components/CartDrop';
import CheckoutPage from './components/checkout/CheckoutPage';
import SiteFooter from './components/SiteFooter';
import { track, trackFeatureCommits, trackPaletteFeature } from './utils/analytics';
import { 
  importFile,
  isBackendFormat,
} from './utils/importModel';
import {
  downloadMeshExport,
  downloadModelFromMesh,
  meshExportBase64,
} from './utils/exportModel';
import { encodeMesh } from './utils/meshFormat';
import {
  checkRawUpload,
  checkStoredMesh,
  dedupedImportName,
  forgetPartAssets,
  importMeshScript,
  meshAssetName,
  rememberPartAssets,
  resolvePartMeshes,
  selectedPartDownload,
} from './utils/meshAssets';
import { 
  hasCheckoutReturnFlag, 
  hasPendingCheckout,
  restoreCheckoutState, 
  clearCheckoutState,
  clearCheckoutReturnFlag 
} from './utils/checkoutStorage';
import { 
  hasPendingEditorState,
  restoreEditorState, 
  clearEditorState 
} from './utils/editorStorage';
import { saveEditorDraft, loadEditorDraft } from './utils/editorDraft';
import { clearLocalCadData } from './utils/clearLocalCadData';
import { ensurePartThumbnails } from './utils/partThumbnails';
import { clearCachePlan, runClearLocalCache } from './utils/clearLocalCache';
import { gitDirtyLiveScript, isAssemblyDirty } from './utils/git/gitWorkspace';
import { repoKeyOf } from './utils/git/syncStore';
import ClearCacheDialog from './components/ClearCacheDialog';
import { resolveActiveRestore } from './utils/partScriptRestore';
import {
  assemblyName,
  composeViewportParts,
  dropPartRecord,
  feedRows,
  normalizeRepoPath,
  parseAssemblyDocument,
  partPosition,
  newPartRowPosition,
  geometryFromExecuteResult,
  removePart,
  renamePart,
  renameTargetId,
  sanitizePartName,
  reorderParts,
  preserveHiddenPartRuns,
  scriptForRow,
  serializeAssembly,
  setPartVisible,
  partSheetMetal,
  setPartSheetMetal,
  nextAssemblyName,
  assemblyNameForImport,
  nextNumberedName,
  DEFAULT_PART_NAME,
  DEFAULT_ASSEMBLY_NAME,
  sanitizeAssemblyName,
  needsAssemblyLeaveGuard,
  partDefinitionId,
  definitionStampName,
  definitionStillReferenced,
  normalizeInstanceScripts,
  fanOutInstanceRuns,
} from './utils/assembly';
import {
  copyGroupToAssembly,
  removeGroupParts,
  renameGroup,
  replaceGroupPartId,
  ungroupParts,
  withInsertedGroup,
} from './utils/partGroups';
import { sheetMetalBinding } from './utils/scs/scsCatalog';
import { composeSheetMetalCommit, readSheetMetalSpec, removeSheetMetalBlock, sheetMetalFresh, sheetStarterScript } from './utils/sheetMetal/sheetMetalScript';
import {
  adoptSavedScript,
  editorMountSeedsHistory,
  historyForPart,
  pushPartHistory,
  redoPartHistory,
  undoPartHistory,
} from './utils/partHistory';
import { featureRibbonScript } from './utils/featureRibbonScript';
import {
  wrapRawScript,
  wrapUnmarkedPartScripts,
} from './utils/wrapRawScript';
import { fillAgentHost } from './agent/host';
import { runAgentPrompt } from './agent/agentPromptHost.js';
import {
  agentGitConsentInteractive,
  agentGitRealOptIn,
  agentGitSessionDenied,
  agentGitSetSessionAllow,
  agentGitSetSessionDenied,
} from './agent/gitAgent.js';
import { AGENT_GIT_CONSENT_TIMEOUT_MS } from './agent/commands/git.js';
import AgentGitConsentModal from './components/AgentGitConsentModal';
import { buildDirtyState } from './agent/state/dirty';
import { buildSelection } from './agent/state/selection';
import {
  agentSnapshotDocKey,
  editedPartIdsSinceSnapshot,
  extendPartScriptSnapshot,
  liveEditorOverride,
  snapshotPartScripts,
} from './agent/state/editedSinceLoad';
import { buildFeatureTree } from './agent/state/featureTree';
import { buildJointHealth } from './agent/state/jointHealth.js';
import { resolveRollbackTarget, resolveStripTarget } from './agent/featureStripAgent';
import { buildPartsState, partRunState } from './agent/state/parts';
import { withUnjointedParts } from './agent/state/unjointedParts';
import { reportFeatureGaps } from './utils/featureGaps.js';
import { captureSentryException } from './utils/sentryClient.js';
import { getAnalyticsConsent } from './utils/consent.js';
import { compareWorkingCopyToCommit } from './agent/state/workingCopyUnsaved';
import { findPartById, unknownAssemblyError, unknownPartError } from './agent/state/identity';
import { decidePartVisible } from './agent/state/partVisible';
import { listV2Assemblies, openV2Assembly, overlayWorkingCopyBrowseNames, PART_USE_SCAN_REFUSED, scanOtherAssemblyPartUses } from './utils/git/v2VaultRead';
import { assemblyRows } from './agent/state/assemblyRows';
import { assemblyIdPath, partIdPath, parseIdPath } from './utils/git/idPaths';
import { readSurfName } from './utils/git/surfId';
import { commitPartCreate, createPartQueue, createdPartFromDocs, partCreateKey } from './agent/state/createPart.js';
import { finishedRunBodyCount } from './agent/state/runBodyCount.js';
import { buildToasts } from './agent/state/toasts';
import {
  historyStripTarget,
  summarizeAssemblyHistory,
  summarizePartHistory,
  summarizeSketchHistory,
} from './agent/historyRoute';
import {
  agentBridgeEnabled,
  agentFeatureCount,
  createSurfcadBridge,
} from './utils/agentBridge';
import { buildEffectiveJointCard, jointEditCard } from './agent/jointCardAgent.js';
import AgentVisibleLayer from './components/AgentVisibleLayer';
import AgentBridgeHost from './components/AgentBridgeHost';
import { runAssemblyParts } from './utils/assemblyRun';
import { assetKeyFromAssets, decideMeshShip, runFromShip, shipFieldsFromResult } from './utils/meshShip';
import {
  composePlacementWithMatrix,
  poseEdgeRecord,
  poseFaceRecord,
  splitTrailingRigid,
} from './utils/rigidSuffix';
import { catalogsFromRuns } from './utils/jointResolve';
import { jointedSurfIds, partPlacement, poseFieldsForPart } from './utils/jointSchema';
import {
  AGENT_EULER_ORDER,
  eulerDegreesToQuaternion,
  quaternionToEulerDegrees,
} from './utils/partPose';
import { refreshAssemblyJoints } from './joints/refreshJoints';
import {
  applyJointCard,
  assemblyHistoryCanRedo,
  assemblyHistoryCanUndo,
  assemblyHistoryKey,
  assemblySnapshotsEqual,
  acceptJointPick,
  cardFromJoint,
  dismissJointEdit,
  jointHighlightEntries,
  draftFromPicks,
  jointPickSlot,
  quickAngleCard,
  resolvePartChange,
  emptyClickCadSelection,
  jointChipLabel,
  jointRowChips,
  jointsChromeMounted,
  nextJointName,
  pushAssemblyHistory,
  redoJointStrip,
  seedAssemblyHistory,
  shouldArmJointPick,
  stripRedoLabel,
  stripUndoLabel,
  stripUndoTarget,
  undoJointStrip,
} from './joints/jointUi';
import { characteristicLengthFor } from './utils/characteristicLength';
import { fallbackOffscreenDistance, offscreenRange } from './utils/sliderMap';
import JointCard from './components/JointCard';
import {
  applyAssemblyOpenHold,
  createAssemblyOpenController,
  lookupAssemblyOpenName,
  readVaultAssemblySurf,
  resolveAssemblyOpenName,
  runTrackedAssemblyOpen,
} from './utils/assemblyOpenOverlay';
import { featureDeleteTarget, featureWriteTarget, leftoverPickSolids, shouldSyncScript } from './utils/pickRetarget';
import { shouldRebuildOnEditorClose } from './utils/scriptEditorClose';
import { clearPaintColors, commitPaintColors, removeUnmatchedColors } from './utils/facePaint';
import {
  deletePartScript as deletePartScriptRecord,
  loadAssemblyDocumentStatus,
  loadAssemblySidecar,
  loadPartAssets,
  loadPartScript,
  loadPartScripts as loadPartScriptRecords,
  loadPartSyncFlags,
  saveAssemblyDocument,
  saveAssemblySidecar,
  savePartScript as savePartScriptRecord,
  loadRekeyJournal,
  saveRekeyJournal,
  clearRekeyJournal,
} from './utils/assemblyStore';
import {
  bootUserId,
  bootWouldClobber,
  bootWriteAllowed,
  planReloadAssembly,
  pointerForUser,
  readLastOpenedMap,
  rememberLastOpened,
} from './utils/assemblyBoot';
import { refreshGithubAccessToken } from './utils/git/githubTokenRefresh';
import { gitTimings } from './utils/git/gitTimings';
import {
  createMockGithubAdapter,
  createGithubAdapter,
  findOrCreateVault,
  peekMockVaultName,
  hasGithubToken,
  loadGithubToken,
  clearGithubToken,
  resolveGithubClientId,
  rememberGithubClientId,
  buildAuthorizeUrl,
  createOAuthState,
  githubRedirectUri,
  dirtyPartIds,
  isWorkspaceDirty,
  isUpgradeWorkingCopyDirty,
  listVaultAssemblies,
  takenAssemblyNames,
  resolveAssemblyFolderName,
  listVaultBrowseItems,
  planInsertVaultAssemblyParts,
  planOpenVaultPart,
  planCopyToAssembly,
  allocateVaultPartPath,
  partRepoPath,
  stampMissingSurfIds,
  rekeyWorkingCopyToTip,
  retireImplicitVaultWriteOps,
  readVaultPart,
  showAddToRepo,
  isExternalPartPath,
  mintSurfId,
  withSurfId,
  stripSurfId,
  readSurfId,
  isV2SurfId,
  backfillSurfIds,
  applyIdPromotion,
  migrateAssemblyRecords,
  migrateLocalPartIds,
  collapseWorkingCopyIds,
  persistCollapsedWorkingCopy,
  dualWriteTargets,
  remapFeaForPersist,
  reusePairsFromJournal,
  assemblyRekeyKey,
  WORKING_COPY_DOC_UNSAVED,
  isSurfId,
  partSurfId,
  reconcileSyncedFromTip,
  markPartsSynced,
  baselineAfterAssemblyRename,
  partRowGitChrome,
  overlayPendingPartRenames,
  overlayPendingAssemblyDeletes,
  planDeleteAssembly,
  previewDeleteAssembly,
  projectPendingOps,
  projectFiles,
  commitOpenAssemblyText,
  baselineAfterDelete,
  workingCopyAfterDelete,
  hidePendingDeletedAssemblies,
  readRenameEntries,
  createSyncStore,
  flushSyncQueue,
  captureBaseline,
  captureBaselineFromTip,
  baselineScriptsKeepingTip,
  baselineAfterPartSave,
  baselineAfterPartRename,
  suggestNewPartPath,
  partPathAllowedFor,
  vaultSegment,
  assemblyFilePath,
  assemblyFilePathCandidates,
  assembleCommitFiles,
  listVaultTree,
  listVaultTreePaths,
  VAULT_TREE_UNAVAILABLE,
  VAULT_TREE_UNAVAILABLE_MESSAGE,
  applyOverwriteFiles,
  commitPartToRepo,
  saveLocalOnNewBranch,
  REPO_MOVED_WARNING,
  repoSavedMessage,
  firstCommitBaseline,
  emptyWorkingSidecar,
  normalizeWorkingSidecar,
  recordPendingDeletes,
  recordRenameFrom,
  sidecarIsDirty,
  deletePathsForCommit,
  sidecarAssemblyKeys,
  repoDeletePathsFor,
  NO_REPO_YET_COPY,
  NO_REPO_YET_CODE,
  SAVE_QUEUED_COPY,
  noRepoYetError,
  gitOpCatchResult,
  githubSaveErrorFields,
  checkRemoteBehind,
  behindToastMessage,
  behindToastTarget,
  openBehindToastTarget,
  keepBehindToastTarget,
  remainingBehindMarkers,
  reloadFromRemote,
  advanceBaselineHead,
  checkInMineToBranch,
  listVaultBranches,
  switchVaultBranch,
  createVaultBranch,
  shouldSwitchToCreatedBranch,
  deleteVaultBranch,
  githubCompareUrl,
  canDeleteVaultBranch,
  squashMergeVaultBranch,
  DEFAULT_VAULT_NAME,
  LEGACY_VAULT_NAME,
  storedVaultNameFromUser,
  sanitizeVaultName,
  planMoveToGit,
  putAsset,
  placeLocalMeshParts,
  remapMeshRecords,
  collectMeshCommitAssets,
  partMeshRecordsFromBaseline,
  meshVaultSaveAllowed,
  executePlanSave,
  executePlanSaveConflictChoice,
  executeDeleteV2Assembly,
  executeDeleteV2Part,
  applySaveReload,
  isV2PlanSaveDoc,
  meshesFromPartRecords,
  deleteFromRepoIdsFromPaths,
  mainMovedPlanSavePaths,
  SAVE_CONFLICT_COPY,
} from './utils/git';
import { docNeedsVaultLayout, newAssemblyVaultLayout, vaultLayoutFromDetection } from './utils/git/docVaultLayout.js';
import { titleFocusPartId } from './utils/titleFocus.js';
import { partScriptMatchesCommitted } from './utils/git/planSave';
import { makeBranchTip, scheduleLastCommitFromApp } from './utils/git/lastCommit';
import {
  detectVaultLayout,
  executeUpgrade,
  executeUpgradeConflictChoice,
  applyUpgradeReload,
  adoptUpgradeWorkingCopy,
  upgradePersistIncomplete,
  rollbackFailedUpgradeDocSave,
  workingCopyUnpersistedResult,
  openLegacyAssembly,
  UnsupportedVaultLayoutError,
  listLegacyAssemblyNames,
} from './utils/git/legacyVault';
import { upgradeVaultEnabled, UPGRADE_UNAVAILABLE } from './utils/git/upgradeVaultEnabled';
import PartFeed from './components/PartFeed';
import manifoldContext from './utils/ManifoldWorker';
import DEFAULT_SCRIPT, { blankPartStarter } from './utils/defaultScript';
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
  newPartStarterScript,
  starterCubeScript,
} from './utils/helperPaletteSnippets';
import { describeHelperRefusal } from './agent/helperPaletteAgent';
import {
  DEMO_PUZZLE,
  DEFAULT_PUZZLE_ID,
  GAME_PUZZLES,
  getPuzzle,
  getNextPuzzle,
  MATCH_REL_EPS,
  MATCH_VOL_FLOOR_MM3,
  SUCCESS_CLEAR_MS,
} from './utils/gamePuzzle';
import { getBestTimeMs, recordWin } from './utils/gameWins';
import GameHintsModal from './components/GameHintsModal';
import PuzzlePickerModal from './components/PuzzlePickerModal';
import GameConfetti from './components/GameConfetti';
import { composeContourCommit } from './utils/contourMode';
import { composeHoleOnContour, rewriteCentersContour } from './utils/holeContour';
import { writeContourProfileBlock } from './utils/contourProfileWrite';
import { deleteContourStatement, saveEditedContour } from './utils/contourUsers';
import { hasNamedContour } from './utils/namedContour';
import {
  composeFilletCommit,
  composeChamferCommit,
  hasFilletModeBlock,
  hasChamferModeBlock,
  replaceEditedBlend,
} from './utils/filletMode';
import { composeMultiPartEdgeCommit } from './utils/multiPartEdges';
import { composeShellCommit } from './utils/shellMode';
import { composeDraftCommit } from './utils/draftMode';
import { composeCutCommit } from './utils/cutMode';
import { booleanInsertRefusal, composeBooleanCommit, validateBooleanAccept } from './utils/booleanMode';
import { crossPartSubtractWrites, externalBodyRotationBlock, planCrossPartSubtract } from './utils/externalCopy';
import { FEATURE_MARKER_KINDS } from './utils/featureMarkers';
import { composeMoveCommit } from './utils/moveMode';
import { composeRotateCommit } from './utils/rotateMode';
import { composeMirrorCommit } from './utils/mirrorMode';
import { composeMoveFaceCommit } from './utils/moveFaceMode';
import { composeDeleteFaceCommit } from './utils/deleteFaceMode';

function failureSkipStamp(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows.map((row) => `${row?.id || ''}:${row?.threw ? 1 : 0}:${row?.dependsOn || ''}`).join('|');
}

const App = () => {
  const [currentScript, setCurrentScript] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [, setSelectedFace] = useState(null);
  const [currentFilename, setCurrentFilename] = useState(null);
  /** Assembly list. Scripts live beside it, never inside the document. */
  const [assemblyDoc, setAssemblyDoc] = useState(null);
  const [partScripts, setPartScripts] = useState({});
  const [partRuns, setPartRuns] = useState({});
  const assemblyRef = useRef(null);
  /**
   * Part instances: a row's script, run, undo history and IndexedDB record
   * belong to its definition (`instanceOf`, else the row itself). These
   * map a row id onto that key; everything else in this file keys by row.
   */
  const definitionIdFor = useCallback((id, doc = assemblyRef.current) => {
    if (id == null) return id;
    const key = String(id);
    const row = doc?.parts?.find((part) => String(part?.id) === key);
    return row ? partDefinitionId(row) : key;
  }, []);
  const savePartScript = useCallback(
    (id, script, opts) => savePartScriptRecord(definitionIdFor(id), script, opts),
    [definitionIdFor],
  );
  /** A record goes only when no other row still places its definition. */
  const deletePartScript = useCallback(async (id) => {
    const def = definitionIdFor(id);
    if (definitionStillReferenced(assemblyRef.current?.parts, def, id)) return false;
    return deletePartScriptRecord(def);
  }, [definitionIdFor]);
  /** Scripts for these rows, loaded once per definition and keyed by row. */
  const loadScriptsForParts = useCallback(async (parts, opts) => {
    const rows = Array.isArray(parts) ? parts : [];
    const defs = [...new Set(rows.map((part) => partDefinitionId(part)))];
    const loaded = await loadPartScriptRecords(defs, opts);
    const out = {};
    for (const part of rows) {
      const text = loaded?.[partDefinitionId(part)];
      if (typeof text === 'string') out[part.id] = text;
    }
    return out;
  }, []);
  /** Scripts for these row ids (rows of the open document, else the id is its own definition), keyed by row id. */
  const loadPartScripts = useCallback(async (ids, opts) => {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const defs = [...new Set(list.map((id) => definitionIdFor(id)))];
    const loaded = await loadPartScriptRecords(defs, opts);
    const out = {};
    for (const id of list) {
      const text = loaded?.[definitionIdFor(id)];
      if (typeof text === 'string') out[id] = text;
    }
    return out;
  }, [definitionIdFor]);
  /** Per-part undo keys worth keeping: every row and every definition. */
  const historyKeepKeys = (parts, extra = []) => {
    const keep = new Set(extra);
    for (const part of parts || []) {
      keep.add(String(part.id));
      keep.add(partDefinitionId(part));
    }
    return keep;
  };
  /** Overlapping agent create_assembly calls join this promise (§3.6). */
  const createAssemblyInFlightRef = useRef(null);
  const partCreateQueueRef = useRef(null);
  /** Re-key persist pairs: autosave writes both `from` and `to` while in flight. */
  const persistFlightPairsRef = useRef([]);
  const persistFlightToOnlyRef = useRef(false);
  // rememberAssembly starts the IndexedDB write and returns the doc.
  // Callers that need the write to finish await this promise.
  const assemblyDocPersistRef = useRef(Promise.resolve(null));
  /** Assembly names opened this session, oldest first. The last is current. */
  const recentAssembliesRef = useRef([]);
  const partScriptsRef = useRef({});
  const partRunsRef = useRef({});
  /** Git mode: mock adapter + vault handle + dirty baseline (G2) + Commit (G3). */
  const gitAdapterRef = useRef(null);
  const gitVaultRef = useRef(null);
  const [gitBaseline, setGitBaseline] = useState(null);
  const gitBaselineRef = useRef(null);
  const gitSidecarRef = useRef(emptyWorkingSidecar());
  const [gitSidecar, setGitSidecar] = useState(() => emptyWorkingSidecar());
  /** G4: last remote-behind check + paths the user already resolved. */
  const [gitBehind, setGitBehind] = useState(null); // checkRemoteBehind result | null
  const gitBehindRef = useRef(null);
  const [gitBehindResolved, setGitBehindResolved] = useState([]); // path strings
  const gitBehindResolvedRef = useRef([]);
  const [gitBehindToast, setGitBehindToast] = useState(null); // { message, behindBy } | null
  const [planSaveConflict, setPlanSaveConflict] = useState(null);
  const v2SaveMessageRef = useRef('Save');
  const partFeedRef = useRef(null);
  /** Part ids with an in-flight create or assembly rename (spinner on the row Save icon). */
  const [pendingPartIds, setPendingPartIds] = useState(() => new Set());
  /** Outbox row state: path → queued | sending | failed. Queued is the yellow unsynced dot. */
  const [partSync, setPartSync] = useState({});
  const [renameNotice, setRenameNotice] = useState(null);
  const [syncConflict, setSyncConflict] = useState(null);
  /** Save hit a moved working ref. Yellow warning, not the G13 popup. */
  const [repoMoved, setRepoMoved] = useState(null);
  const [repoSaved, setRepoSaved] = useState(null);
  const repoMovedBusyRef = useRef(false);
  const [repoMovedBusy, setRepoMovedBusy] = useState(false);
  const gitSyncRef = useRef(null);
  const flushGitSyncRef = useRef(async () => ({ status: 'idle' }));
  const gitCheckGenRef = useRef(0);
  /** G7: GitHub App Client ID (from /api/config or VITE_) + connected flag. */
  const [githubClientId, setGithubClientId] = useState(() => resolveGithubClientId());
  const [githubConnected, setGithubConnected] = useState(() => hasGithubToken());
  /** Last successful mesh per part. A failed row can still be picked from this. */
  const partLeftoversRef = useRef({});
  /** CAD pick target. Monaco stays on assembly.activeId until a sync. */
  const cadPartIdRef = useRef(null);
  const [cadPartId, setCadPartId] = useState(null);
  const rememberCadPart = (id) => {
    const next = id || null;
    cadPartIdRef.current = next;
    setCadPartId(next);
  };
  /** Feature ribbon reads cadPartId + currentScript; keep both on the part. */
  const revealPartOnRibbon = (partId, script) => {
    if (partId) rememberCadPart(partId);
    if (typeof script === 'string') setCurrentScript(script);
  };
  const featureSessionRef = useRef(false);
  const [featureSession, setFeatureSession] = useState(false);
  /** Sketch chips after Select plane. Null keeps the part strip. */
  const [sketchStrip, setSketchStrip] = useState(null);
  /** Sheet chips while sheet metal is open. Null keeps the part strip. */
  const [sheetStrip, setSheetStrip] = useState(null);
  const syncCadScriptRef = useRef(() => {});
  /** focusWritePart, for handlers declared above it. */
  const focusWritePartRef = useRef(() => true);
  /** Bumped when the active part changes out from under a pending autosave. */
  const partSaveEpochRef = useRef(0);
  const refreshGenRef = useRef(0);
  /** meshKey the primary worker is holding, so a later move does not warm it. */
  const primaryHoldsRef = useRef(null);
  /** Assembly-open spinner. Hidden until ~150ms; cleared on every exit. */
  const [assemblyOpenUi, setAssemblyOpenUi] = useState(null);
  const [assemblyOpenToast, setAssemblyOpenToast] = useState(null);
  const assemblyOpenCtrlRef = useRef(null);
  const assemblyOpenProgressRef = useRef(null);
  /** Every assembly open (dialog, reload, branch, id) goes through this. */
  const openAssemblyTrackedRef = useRef(async () => {});
  // While an open owns the worker, editor auto-run must not start another
  // script behind (or in front of) the build the spinner is waiting on.
  const assemblyOpenLockRef = useRef(false);
  const finishOpenedPartRef = useRef(async () => {});
  /** idle until auth settles; opening while a reload is in flight; done after. */
  const bootGateRef = useRef('idle');
  /** Reauth reopen must not write IndexedDB, the outbox, or the demo. */
  const bootReadOnlyRef = useRef(false);
  const [bootEpoch, setBootEpoch] = useState(0);
  const [bootResume, setBootResume] = useState('pending');
  const ensureGitVaultRef = useRef(async () => null);
  const openVaultAssemblyRef = useRef(async () => {});
  const gitTokenRef = useRef(null);
  if (assemblyOpenCtrlRef.current == null) {
    assemblyOpenCtrlRef.current = createAssemblyOpenController({
      onChange: (ui) => {
        setAssemblyOpenUi(ui);
        // begin() emits once before the spinner is visible. The open is
        // still current then; only a real hide releases the auto-run lock.
        if (!ui && !assemblyOpenCtrlRef.current?.isOpen?.()) {
          assemblyOpenLockRef.current = false;
        }
      },
      onBegin: () => {
        assemblyOpenLockRef.current = true;
        setAssemblyOpenToast(null);
      },
      onFailure: (fail) => setAssemblyOpenToast({
        generation: fail.generation,
        message: fail.message || 'Could not open assembly',
        retry: fail.retry || null,
      }),
      onRecover: (generation) => setAssemblyOpenToast((prev) => (
        prev && prev.generation === generation ? null : prev
      )),
    });
  }
  const refreshAssemblyRef = useRef(async () => false);
  /** Missing-row placeholder must not become that part's stored script. */
  const suppressPartSaveRef = useRef(false);
  /** Editor column width % (desktop) and editor height px (mobile, null = auto). */
  const [splitPct, setSplitPct] = useState(50);
  const [mobileEditorPxOverride, setMobileEditorPx] = useState(null);
  /** Mobile CAD: 'cad', 'parts', or the full-screen editor ('script'). Session-sticky. */
  const [mobileStage, setMobileStage] = useState(() => {
    try {
      const s = sessionStorage.getItem('3dculos.mobileStage');
      const link = linkedMobileStage(window.location.search, window.location.hash);
      // A stored Script stage is not the landing view. It opens Parts.
      const next = landingMobileStage(s, link);
      if (s === 'script' && next === 'parts') {
        try { sessionStorage.setItem('3dculos.mobileStage', 'parts'); } catch { /* private mode */ }
      }
      return next;
    } catch {
      return 'cad';
    }
  });
  /** Desktop CAD: right-hand script drawer. Closed until a part pencil or Edit script. */
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const setMobileStageSticky = (stage, opts) => {
    const next = stage === 'parts' ? 'parts' : stage === 'script' ? 'script' : 'cad';
    setMobileStage(next);
    try { sessionStorage.setItem('3dculos.mobileStage', next); } catch { /* private mode */ }
    // Back to Parts keeps the editor-close rebuild. Skip the parts-surface sync.
    if (opts?.sync === false) return;
    if (shouldSyncScript({ surface: next })) syncCadScriptRef.current();
  };
  /** Script-stage feature strip: which chip is selected (null = none). */
  const [featureStripActiveId, setFeatureStripActiveId] = useState(null);
  /**
   * Feature block the last viewport run failed in ({ id, kind, typeIndex,
   * block }), or null. The strip draws that chip with a red border while its
   * block text is unchanged; the next good run clears it.
   */
  const [runFailure, setRunFailure] = useState(null);
  const runFailureRef = useRef(null);
  /** Bumps on every viewport outcome so the agent host can tell this run from a stale ref. */
  const runOutcomeEpochRef = useRef(0);
  /** Rollback bar per part. `null` is before every feature. A missing key is the end. */
  const [rollbackAnchors, setRollbackAnchors] = useState({});
  const rollbackAnchorsRef = useRef({});
  rollbackAnchorsRef.current = rollbackAnchors;
  /** Per-part `{ [featureId]: ms }` from the last run the viewport reported (feature_tree `ms`, status.featureMs). */
  const featureTimingsRef = useRef({});
  /** Per-part `{ cache: { blocks, hits, misses, bytes }, cached: { [featureId]: true } }` from the last run (feature memoisation). */
  const featureCacheRef = useRef({});
  const handleRunOutcome = ({
    script, ok, scriptLine, featureId, featureBlock, skipped, message, detail, crash,
    code, timeout, hint, featureTimings, featureCache,
  } = {}) => {
    if (Array.isArray(featureTimings)) {
      const key = assemblyRef.current?.activeId ? definitionIdFor(assemblyRef.current.activeId) : '__cad__';
      const map = {};
      const cached = {};
      for (const row of featureTimings) {
        if (row && typeof row.id === 'string' && Number.isFinite(Number(row.ms))) map[row.id] = Number(row.ms);
        if (row && typeof row.id === 'string' && row.cached === true) cached[row.id] = true;
      }
      featureTimingsRef.current = { ...featureTimingsRef.current, [key]: map };
      const summary = featureCache && typeof featureCache === 'object'
        ? {
          blocks: Number(featureCache.blocks) || 0,
          hits: Number(featureCache.hits) || 0,
          misses: Number(featureCache.misses) || 0,
          bytes: Number(featureCache.bytes) || 0,
        }
        : null;
      featureCacheRef.current = { ...featureCacheRef.current, [key]: { cache: summary, cached } };
    }
    // Tracked block first (works on Safari), the stack's line second.
    const next = ok ? null : failedFeatureFromOutcome(script, { featureId, featureBlock, scriptLine });
    const uiMessage = typeof message === 'string' && message.trim() ? message.trim() : '';
    const uiDetail = typeof detail === 'string' && detail.trim() && detail.trim() !== uiMessage
      ? detail.trim()
      : '';
    let stamped = null;
    if (!ok && (next || uiMessage)) {
      stamped = {
        ...(next || {}),
        ...(typeof featureId === 'string' && featureId && !next?.id ? { id: featureId } : {}),
        ...(uiMessage ? { message: uiMessage } : {}),
        ...(uiDetail ? { detail: uiDetail } : {}),
        ...(crash && typeof crash === 'object' ? { crash } : {}),
        // A block the watchdog killed; the part was rebuilt without it.
        ...(typeof code === 'string' && code ? { code } : {}),
        ...(timeout && typeof timeout === 'object' ? { timeout } : {}),
        ...(typeof hint === 'string' && hint ? { hint } : {}),
        skipped: Array.isArray(skipped) ? skipped : [],
      };
      if (!stamped.id && !stamped.message) stamped = null;
    }
    // Publish before setState. The agent reads this ref when execute resolves,
    // which is before the next render would have copied state into the ref.
    runOutcomeEpochRef.current += 1;
    runFailureRef.current = stamped;
    setRunFailure((prev) => (
      (prev?.id ?? null) === (stamped?.id ?? null)
      && (prev?.kind ?? null) === (stamped?.kind ?? null)
      && (prev?.block ?? null) === (stamped?.block ?? null)
      && (prev?.message ?? null) === (stamped?.message ?? null)
      && (prev?.detail ?? null) === (stamped?.detail ?? null)
      && (prev?.crash?.reason ?? null) === (stamped?.crash?.reason ?? null)
      && (prev?.code ?? null) === (stamped?.code ?? null)
      && (prev?.timeout?.elapsedMs ?? null) === (stamped?.timeout?.elapsedMs ?? null)
      && failureSkipStamp(prev?.skipped) === failureSkipStamp(stamped?.skipped)
        ? prev
        : stamped
    ));
  };
  /**
   * Height of the editor ribbon, MEASURED. The mobile Script-stage strip
   * overlays with `top: ribbonPx` so chips start under the ribbon.
   * ResizeObserver keeps it exact as the ribbon's contents change. The
   * desktop feature bar is a horizontal row under the title (`top-14`),
   * not that spacer.
   */
  const [ribbonPx, setRibbonPx] = useState(44);
  /** Script-stage strip: caret jump only (no FeatureSheet — CAD strip / long-press keep the sheet). */
  const handleFeatureStripJump = (feature) => {
    if (!feature) return;
    // Chips are the picked part's features; jump in that part's buffer.
    focusWritePartRef.current(null);
    setFeatureStripActiveId(feature.id);
    codeEditorRef.current?.revealRange?.(feature.startOffset, feature.endOffset);
    // Jump-only: clear highlight so the chip does not stay stuck cyan.
    setTimeout(() => {
      setFeatureStripActiveId((cur) => (cur === feature.id ? null : cur));
    }, 400);
  };
  /**
   * Desktop CAD viewer feature bar: jump the caret AND open the feature sheet
   * in the viewer. Both panes are on screen here, so editing the feature and
   * seeing the code it owns are not a trade-off the way they are on a phone.
   */
  const handleDesktopFeatureStripJump = (feature) => {
    if (!feature) return;
    if (!allowFeaturePopup()) return;
    focusWritePartRef.current(null);
    setFeatureStripActiveId(feature.id);
    codeEditorRef.current?.revealRange?.(feature.startOffset, feature.endOffset);
    if (feature.kind === 'contour') {
      if (viewportRef.current?.beginContourEdit?.(feature.contourId)) setFeatureSheet(null);
      return;
    }
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    if (viewportRef.current?.beginFeatureEdit?.(feature, buf)) {
      setFeatureSheet(null);
      return;
    }
    viewportRef.current?.yieldToFeatureEditCard?.();
    setFeatureSheet({ mode: 'edit', feature });
  };
  /** Desktop "Edit script": open the drawer and reveal that block. */
  const handleDesktopFeatureSheetEditScript = (feature) => {
    if (!feature) return;
    setFeatureSheet(null);
    setScriptEditorOpen(true);
    // revealRange already selects, scrolls and focuses the editor.
    codeEditorRef.current?.revealRange?.(feature.startOffset, feature.endOffset);
  };
  /**
   * Fallback feature editor and the picker, on the shared bottom card.
   * null | { mode: 'picker' } | { mode: 'edit', feature }
   * A kind with a creation dialog reopens that dialog and leaves this null.
   * Game never opens it.
   */
  const [featureSheet, setFeatureSheet] = useState(null);
  const [featurePopupOpen, setFeaturePopupOpen] = useState(false);
  const featureSheetRef = useRef(null);
  featureSheetRef.current = featureSheet;
  const featureStripActiveIdRef = useRef(null);
  featureStripActiveIdRef.current = featureStripActiveId;
  /** Params staged by agent `edit_feature` before `confirm_feature`. */
  const agentFeatureDraftRef = useRef(null);
  /** Marker feature last opened by agent `open_feature` (direct confirm fallback). */
  const agentFeatureTargetRef = useRef(null);
  /** Agent `open_feature` session; `cancel_feature` may close even before UI refs catch up. */
  const agentFeatureSessionRef = useRef(null);
  const [jointCard, setJointCard] = useState(null);
  const jointCardRef = useRef(null);
  /** Amber `Deleted.` toast after a joint delete; its Undo pops one assembly step. */
  const [jointDeleteToast, setJointDeleteToast] = useState(false);
  const jointDeleteToastTimerRef = useRef(null);
  /** Synchronous joint card for agent pick/commit (React state may lag one frame). */
  const jointCardAgentRef = useRef(null);
  const jointPicksRef = useRef([]);
  const jointCatalogsRef = useRef({});
  const jointLiveRef = useRef({ statuses: {}, messages: {} });
  const [jointLive, setJointLive] = useState({ statuses: {}, messages: {} });
  const assemblyHistoryRef = useRef(null);
  const [assemblyHistTick, setAssemblyHistTick] = useState(0);
  jointCardRef.current = jointCard;
  const publishJointCard = (next) => {
    jointCardAgentRef.current = next;
    flushSync(() => setJointCard(next));
  };
  useEffect(() => {
    if (!jointCard) {
      jointCardAgentRef.current = null;
      return;
    }
    jointCardAgentRef.current = buildEffectiveJointCard(
      jointCard,
      jointPicksRef.current,
      assemblyRef.current,
    );
  }, [jointCard]);
  const closeFeatureSheet = () => {
    setFeatureSheet(null);
    setFeatureStripActiveId(null);
  };
  useEffect(() => registerFeaturePopupDismiss(() => {
    setFeatureSheet(null);
    setFeatureStripActiveId(null);
    setJointCard(null);
    jointCardAgentRef.current = null;
  }), []);
  const openFeatureSheetFor = (feature) => {
    if (!feature) return;
    if (!allowFeaturePopup()) return;
    // The sheet reads and writes the editor buffer: make it the picked part's.
    focusWritePartRef.current(null);
    setFeatureStripActiveId(feature.id);
    if (feature.kind === 'contour') {
      if (viewportRef.current?.beginContourEdit?.(feature.contourId)) setFeatureSheet(null);
      return;
    }
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    if (viewportRef.current?.beginFeatureEdit?.(feature, buf)) {
      setFeatureSheet(null);
      return;
    }
    viewportRef.current?.yieldToFeatureEditCard?.();
    setFeatureSheet({ mode: 'edit', feature });
  };
  const openFeatureSheetFromCad = () => {
    if (!allowFeaturePopup()) return;
    focusWritePartRef.current(null);
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    const features = listFeatureSheetTargets(buf);
    if (!features.length) {
      viewportRef.current?.softFailContour?.(
        'No marked features yet — Extrude / Fillet / Revolve first, then long-press to edit.',
      );
      return;
    }
    if (features.length === 1) {
      openFeatureSheetFor(features[0]);
      return;
    }
    // Prefer a default editable target; still allow picker via strip.
    const preferred = pickDefaultFeatureSheetTarget(buf);
    if (preferred && isFeatureSheetEditable(preferred.kind)) {
      openFeatureSheetFor(preferred);
      return;
    }
    viewportRef.current?.yieldToFeatureEditCard?.();
    setFeatureSheet({ mode: 'picker' });
  };
  const STALE_FEATURE_MSG = 'That feature is not in this part\'s script any more — pick it again.';
  const handleFeatureSheetAccept = (feature, params) => {
    if (!feature) return;
    focusWritePartRef.current(null);
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    // Re-parse markers against live buffer so offsets stay valid after prior edits.
    // Only a block of this kind in THIS buffer. The stale chip's own offsets
    // (another part's script) used to fall through here: "invalid range".
    const live = liveSheetFeature(buf, feature);
    if (!live) {
      viewportRef.current?.softFailContour?.(STALE_FEATURE_MSG);
      return;
    }
    const result = writeFeatureSheetParams(buf, live, params || {});
    if (!result.ok) {
      viewportRef.current?.softFailContour?.(result.message);
      return;
    }
    const wrote = commitFeatureBuffer(
      buf,
      result.buffer,
      `${feature.label || 'Feature'} sheet`,
    );
    if (!wrote) {
      viewportRef.current?.softFailContour?.(
        'Could not write feature params into the editor — try again.',
      );
      return;
    }
    setFeatureSheet(null);
    setFeatureStripActiveId(null);
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
  };
  /**
   * Strip / history edit Confirm. Rewrites that one block. An unchanged
   * confirm does not touch the editor, so the script stays byte-identical
   * and undo does not grow. A real change is one applyBuffer — one undo step.
   */
  const handleCommitFeatureEdit = (payload) => {
    const feature = payload?.feature;
    if (!feature) return false;
    // An open owns the worker. applyBuffer would schedule work beside that
    // build, and handleGameRun would bump the generation the spinner awaits.
    // Leave the dialog open and leave the lock alone.
    if (assemblyOpenLockRef.current) {
      viewportRef.current?.softFailContour?.(
        'An assembly is opening — confirm the edit again once it finishes.',
      );
      return false;
    }
    focusWritePartRef.current(null);
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    const result = confirmFeatureEdit(buf, feature, payload?.draft || {});
    if (!result.ok) {
      viewportRef.current?.softFailContour?.(result.message);
      return false;
    }
    if (!result.changed) return true;
    const wrote = commitFeatureBuffer(
      buf,
      result.buffer,
      `Edit ${feature.label || feature.kind || 'feature'}`,
    );
    if (!wrote) {
      viewportRef.current?.softFailContour?.(
        'Could not write the feature edit into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(async () => {
        await handleGameRun();
        try {
          await window.surfcad?.syncStatusFromRun?.();
        } catch { /* agent off */ }
      }, 0);
    }
    return true;
  };
  /**
   * Rebuild after a UI feature delete, then refresh the agent bridge's cached
   * `status` / `errors` so a paired agent sees the new run without calling run.
   */
  const runAfterFeatureDelete = () => {
    setTimeout(async () => {
      await handleGameRun();
      try {
        await window.surfcad?.syncStatusFromRun?.();
      } catch { /* agent off */ }
    }, 0);
  };
  /**
   * Delete from the open feature-edit dialog. One applyBuffer, so Undo is
   * one step on this part and restores the previous script. The dialog stays
   * up while an assembly open holds the worker.
   */
  const handleDeleteFeatureEdit = (feature, opts) => {
    if (!feature) return false;
    if (assemblyOpenLockRef.current) {
      viewportRef.current?.softFailContour?.(
        'An assembly is opening — delete the feature again once it finishes.',
      );
      return false;
    }
    focusWritePartRef.current(null);
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    const result = deleteFeatureEdit(buf, feature, { withDependents: !!opts?.withDependents });
    if (!result.ok) {
      viewportRef.current?.softFailContour?.(result.message);
      return false;
    }
    const wrote = codeEditorRef.current?.applyBuffer?.(
      result.buffer,
      `Delete ${feature.chipLabel || feature.label || feature.kind || 'feature'}`,
    );
    if (!wrote) {
      viewportRef.current?.softFailContour?.(
        'Could not delete the feature from the editor — try again.',
      );
      return false;
    }
    if (result.run) runAfterFeatureDelete();
    return true;
  };
  const handleFeatureSheetDelete = (feature) => {
    if (!feature) return;
    focusWritePartRef.current(null);
    const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
    // Only a block of this kind in THIS buffer. The stale chip's own offsets
    // (another part's script) used to fall through here: "invalid range".
    const live = liveSheetFeature(buf, feature);
    if (!live) {
      viewportRef.current?.softFailContour?.(STALE_FEATURE_MSG);
      return;
    }
    // Same delete as the edit dialog: drops a dangling `return part;` when the
    // rest is an empty part, so the viewport clears instead of throwing.
    const result = deleteFeatureEdit(buf, live);
    if (!result.ok) {
      viewportRef.current?.softFailContour?.(result.message);
      return;
    }
    const wrote = codeEditorRef.current?.applyBuffer?.(
      result.buffer,
      `Delete ${feature.label || 'feature'}`,
    );
    if (!wrote) {
      viewportRef.current?.softFailContour?.(
        'Could not delete feature from the editor — try again.',
      );
      return;
    }
    setFeatureStripActiveId(null);
    setFeatureSheet(null);
    // Stay on the current stage (CAD stays CAD; Script stays Script).
    if (result.run) runAfterFeatureDelete();
  };
  const handleFeatureSheetEditScript = (feature) => {
    if (!feature) return;
    setFeatureSheet(null);
    setFeatureStripActiveId(feature.id);
    setScriptEditorOpen(true);
    setMobileStageSticky('script');
    // Defer reveal until Script pane is interactive; then clear highlight.
    setTimeout(() => {
      const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
      // The Script stage loaded the picked part; reveal the block as it is there.
      const live = liveSheetFeature(buf, feature);
      if (live) codeEditorRef.current?.revealRange?.(live.startOffset, live.endOffset);
      setFeatureStripActiveId((cur) => (cur === feature.id ? null : cur));
    }, 50);
  };

  // Dev/playtest bridge for Slice Mobile C feature sheets.

  useEffect(() => {
    if (!import.meta.env?.DEV || typeof window === 'undefined') return undefined;
    window.__FEATURE_SHEET__ = {
      open: (idOrKind) => {
        const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
        const features = listFeatureSheetTargets(buf);
        if (!features.length) return false;
        if (!idOrKind) {
          openFeatureSheetFromCad();
          return true;
        }
        const hit = features.find((f) => f.id === idOrKind)
          || features.find((f) => f.kind === idOrKind);
        if (!hit) return false;
        openFeatureSheetFor(hit);
        return true;
      },
      openPicker: () => {
        const buf = codeEditorRef.current?.getContent?.() || currentScript || '';
        if (!listFeatureSheetTargets(buf).length) return false;
        viewportRef.current?.yieldToFeatureEditCard?.();
        setFeatureSheet({ mode: 'picker' });
        return true;
      },
      close: () => {
        setFeatureSheet(null);
        return true;
      },
      delete: () => {
        const st = featureSheet;
        if (!st || st.mode !== 'edit' || !st.feature) return false;
        handleFeatureSheetDelete(st.feature);
        return true;
      },
      state: () => featureSheet,
    };
    return () => {
      try { delete window.__FEATURE_SHEET__; } catch { /* ignore */ }
    };
    // Playtest bridge; open helpers close over latest render via refs-in-effect body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureSheet, currentScript]);

  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderData, setOrderData] = useState(null);
  const [cartCheckout, setCartCheckout] = useState(null);
  const [showCheckoutPage, setShowCheckoutPage] = useState(false);
  const cartCheckoutRef = useRef(null);
  cartCheckoutRef.current = cartCheckout;
  const onCartCheckoutRef = useRef(() => {});
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadNotice, setUploadNotice] = useState(null);
  const partMeshMetaRef = useRef({});
  const [partMeshMeta, setPartMeshMeta] = useState({});
  const [manifoldReady, setManifoldReady] = useState(false);
  const manifoldReadyRef = useRef(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [clearCacheUi, setClearCacheUi] = useState(null);
  const [agentGitConsentUi, setAgentGitConsentUi] = useState(null);
  const agentGitConsentQueueRef = useRef([]);
  const agentGitConsentActiveRef = useRef(null);
  const [accountModalTab, setAccountModalTab] = useState('info');
  const [editorInitialScript, setEditorInitialScript] = useState(null);
  const [initError, setInitError] = useState(null);
  const [appMode, setAppMode] = useState('cad'); // 'cad' | 'game'
  const [ghostMeshData, setGhostMeshData] = useState(null);
  const [showHints, setShowHints] = useState(false);
  const [cadScriptBackup, setCadScriptBackup] = useState(null);
  const [gameLoading, setGameLoading] = useState(false);
  const [gameError, setGameError] = useState(null);
  const [gameElapsedMs, setGameElapsedMs] = useState(0);
  const [gameTimerRunning, setGameTimerRunning] = useState(false);
  const [gameSuccess, setGameSuccess] = useState(false);
  const [currentPuzzle, setCurrentPuzzle] = useState(DEMO_PUZZLE);
  const [showPuzzlePicker, setShowPuzzlePicker] = useState(false);
  const [gameBestTimeMs, setGameBestTimeMs] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [gameRunBusy, setGameRunBusy] = useState(false);
  // Mobile CAD mid-strip portal target (CodeEditor header).
  const [cadToolbarHost, setCadToolbarHost] = useState(null);

  // MUST stay below `cadToolbarHost`: a dependency array is evaluated during
  // render, so reading that binding from above its `const` throws a TDZ
  // ReferenceError and React renders nothing at all (blank screen).
  useEffect(() => {
    const ribbon = cadToolbarHost?.closest?.('[data-editor-ribbon]');
    if (!ribbon) return undefined;
    const sync = () => setRibbonPx(Math.round(ribbon.getBoundingClientRect().height));
    sync();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(sync);
    ro.observe(ribbon);
    return () => ro.disconnect();
  }, [cadToolbarHost]);


  const { user, isAuthenticated, isLoading: authLoading, checkAuth } = useAuth();
  const gitSession = useAuthState();
  const liveScriptRef = useRef({ id: null, script: '' });
  liveScriptRef.current = {
    id: assemblyRef.current?.activeId ?? null,
    script: currentScript,
  };
  const cartChrome = useCart({
    user,
    onNeedLogin: () => setShowLoginModal(true),
    onCheckout: (queue) => onCartCheckoutRef.current(queue),
    assemblyRef,
    partScriptsRef,
    liveScriptRef,
    partRunsRef,
  });
  const noteBootEmptyRef = useRef(gitSession.noteBootEmpty);
  noteBootEmptyRef.current = gitSession.noteBootEmpty;

  // Chip, Open, and this boot all follow gitSession.phase. Pending waits.
  // Reauth (session in, GitHub token missing) must not look connected and
  // must not flip the working copy to a local file browser.
  useEffect(() => {
    if (gitSession.phase === 'pending') {
      setBootResume('pending');
      return;
    }
    if (gitSession.phase === 'connected') {
      setGithubConnected(true);
      bootReadOnlyRef.current = false;
      setBootResume('in');
      return;
    }
    if (gitSession.phase === 'reauth') {
      setGithubConnected(false);
      setBootResume('reauth');
      return;
    }
    setGithubConnected(false);
    bootReadOnlyRef.current = false;
    setBootResume('out');
  }, [gitSession.phase]);

  useEffect(() => {
    if (!assemblyDoc || appMode === 'game') return undefined;
    let cancel = false;
    ensurePartThumbnails({
      parts: assemblyDoc.parts,
      scripts: partScripts,
      runs: partRuns,
    }).catch((err) => {
      if (!cancel) console.warn('[partThumb]', err?.message || err);
    });
    return () => { cancel = true; };
  }, [assemblyDoc, partScripts, partRuns, appMode]);

  const viewportRef = useRef(null);

  const jointEditHighlightKey = jointCard?.mode === 'edit'
    ? `${jointCard.id}|${(jointCard.picks || []).map((pick) => jointPickSlot(pick)).join(';')}`
    : '';
  useEffect(() => {
    if (!jointEditHighlightKey) return undefined;
    const doc = assemblyRef.current;
    const catalogs = catalogsFromRuns({
      parts: doc?.parts,
      runs: partRunsRef.current,
      leftovers: partLeftoversRef.current,
      scripts: partScriptsRef.current,
    });
    const entries = jointHighlightEntries(jointCardRef.current, doc, catalogs);
    viewportRef.current?.showJointPickHighlights?.(entries);
    return undefined;
  }, [jointEditHighlightKey]);

  const codeEditorRef = useRef(null);
  const gameTimerStartRef = useRef(0);
  const successClearTimerRef = useRef(null);
  const gameRunInFlightRef = useRef(false);
  // Latest puzzle id — handleGameRun closes over render-time state; ref lets
  // verdict-time validate that the puzzle did not switch mid-run.
  const currentPuzzleRef = useRef(currentPuzzle);
  currentPuzzleRef.current = currentPuzzle;
  /** False until the editor reports its first buffer (see handleExecute). */
  const editorLiveRef = useRef(false);
  /** Last buffer handed to refreshAssembly. Close must not build it again. */
  const lastAssemblyScriptRef = useRef(null);
  /** Editor auto-run already queued for this exact text. */
  const pendingAutoRunRef = useRef(null);
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;
  const storedRollback = (key) => (
    key && Object.prototype.hasOwnProperty.call(rollbackAnchorsRef.current, key)
      ? rollbackAnchorsRef.current[key]
      : undefined
  );
  const storeRollbackAnchor = (key, anchor) => {
    if (!key) return;
    const prev = rollbackAnchorsRef.current;
    const had = Object.prototype.hasOwnProperty.call(prev, key);
    if (anchor === undefined) {
      if (!had) return;
      const next = { ...prev };
      delete next[key];
      rollbackAnchorsRef.current = next;
      setRollbackAnchors(next);
      return;
    }
    if (had && prev[key] === anchor) return;
    const next = { ...prev, [key]: anchor };
    rollbackAnchorsRef.current = next;
    setRollbackAnchors(next);
  };
  const clearRollbackAnchors = () => {
    if (!Object.keys(rollbackAnchorsRef.current).length) return;
    const next = rollbackAnchorsAfterOpen();
    rollbackAnchorsRef.current = next;
    setRollbackAnchors(next);
  };
  const editorRollbackKey = () => {
    if (appModeRef.current === 'game') return null;
    const id = assemblyRef.current?.activeId;
    return id ? String(id) : '__cad__';
  };
  /**
   * A feature committed before any part is active parks its bar on `__cad__`.
   * Creating or selecting the part that then owns that script takes the bar
   * with it. A part that already has its own bar keeps it.
   */
  const adoptCadRollback = (partId) => {
    if (!partId) return;
    const id = String(partId);
    if (id === '__cad__') return;
    const pending = storedRollback('__cad__');
    if (pending === undefined) return;
    if (storedRollback(id) === undefined) storeRollbackAnchor(id, pending);
    storeRollbackAnchor('__cad__', undefined);
  };

  // iOS Safari keyboard: visualViewport height/offsetTop so the game editor
  // sits above the keyboard without eating the 3D viewport.
  const [vv, setVv] = useState(() => ({
    height: typeof window !== 'undefined'
      ? (window.visualViewport?.height ?? window.innerHeight)
      : 800,
    offsetTop: typeof window !== 'undefined'
      ? (window.visualViewport?.offsetTop ?? 0)
      : 0,
    layoutHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  
  const [history, setHistory] = useState({
    branches: {
      main: {
        commits: [],
        head: -1
      }
    },
    currentBranch: 'main'
  });
  /** One undo stack per part id. Game uses its own key. */
  const partHistoriesRef = useRef({});
  /** Latest main-thread host for window.surfcad. The effect installs once. */
  const agentHostRef = useRef(null);
  /** Scripts at last open / save; drives agent `dirty.unsaved`. */
  const agentScriptSnapshotRef = useRef(null);
  const agentSnapshotDocKeyRef = useRef('');
  const captureAgentScriptSnapshot = ({ useEditor = true } = {}) => {
    const doc = assemblyRef.current;
    if (!doc) return;
    const scripts = partScriptsRef.current || {};
    const liveId = doc.activeId;
    const override = liveEditorOverride({
      editorLive: useEditor === true && editorLiveRef.current === true,
      activeId: liveId,
      script: codeEditorRef.current?.getContent?.(),
    });
    agentScriptSnapshotRef.current = snapshotPartScripts(scripts, override || {});
    agentSnapshotDocKeyRef.current = agentSnapshotDocKey(doc);
  };
  const historyRef = useRef(history);
  historyRef.current = history;

  // Headless review bridge for harness/stage_shot.mjs (dev-only).
  // Lets automation inject a script and run it through the exact same
  // execute -> render path the Run button uses, then report back over CDP.
  useEffect(() => {
    if (!import.meta.env?.DEV || typeof window === 'undefined') return;
    window.__STAGE__ = {
      ready: false,
      requested: false,
      done: false,
      _execSeq: 0,          // monotonic; ++_execSeq must not start from undefined (NaN rejects all callbacks)
      _lastScript: null,
      editorMirror: null,   // 'noop' | 'updated' | 'unavailable' from the last run
      status: null,
      error: null,
      volume: null,
      bbox: null,
      meshData: null,
      request(script) {
        this.requested = true;
        this._script = script;
        return 'queued';
      },
      // Execute `script` through the Run path and PROVE the paint via the render choke
      // point: renderMeshData fires onRendered with the exact meshData object it painted,
      // so the callback for THIS call must deliver the worker's result. If the run is
      // superseded (the editor's one-time mount render of the default script can abort it,
      // or finish LATER and clobber the scene), renderMeshData never runs for us, this
      // promise rejects, and the harness re-asserts instead of screenshotting a stranger's
      // geometry. Resolves with the painted mesh.
      _executeProven(script) {
        const vp = window.__VIEWPORT__;
        const execId = ++window.__STAGE__._execSeq;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            vp.onRendered = null;
            reject(new Error('no render within 25s of submitting the script (execution superseded)'));
          }, 25000);
          vp.onRendered = (painted) => {
            if (window.__STAGE__._execSeq !== execId) return;   // a stale run's paint
            vp.onRendered = null;
            clearTimeout(timer);
            const result = window.__MANIFOLD_CONTEXT__?.lastResult?.mesh ?? null;
            if (!result?.vertProperties?.length || !result?.triVerts?.length) {
              reject(new Error('worker returned no mesh'));
            } else if (painted !== result) {
              reject(new Error('rendered mesh is not the submitted part (painted '
                + `${painted?.triVerts?.length ?? 0} tris vs result ${result.triVerts.length})`));
            } else {
              resolve(result);
            }
          };
          vp.executeScript(script).catch((e) => {
            if (window.__STAGE__._execSeq !== execId) return;
            vp.onRendered = null;
            clearTimeout(timer);
            reject(new Error(String(e?.message || e)));
          });
        });
      },
      // Re-claim the screen after a late clobberer (the mount-time default render finishing
      // after our own paint) by executing the still-stored script again and demanding the
      // on-render proof once more. The default fires only once, so a re-execute always wins.
      async reassert() {
        try {
          const mesh = await this._executeProven(this._script);
          this.meshData = mesh;   // lastRenderedIs must compare against THIS object
          return true;
        }
        catch (e) { this.error = String(e?.message || e); return false; }
      },
      async run() {
        const vp = window.__VIEWPORT__;
        const ctx = window.__MANIFOLD_CONTEXT__;
        this.status = null; this.error = null; this.stack = null;
        this.volume = null; this.bbox = null; this.meshData = null;
        if (!ctx || !ctx.isReady) { this.status = 'error'; this.error = 'manifold context not ready'; this.done = true; return false; }
        if (!vp || !vp.ready()) { this.status = 'error'; this.error = 'viewport not ready'; this.done = true; return false; }

        try {
          const mesh = await this._executeProven(this._script);

          this.meshData = mesh;
          this.status = 'ok';
          try {
            const info = await ctx.getModelInfo(); // worker-side truth, provably ours now
            if (info) { this.volume = info.volume ?? null; this.bbox = info.boundingBox || null; }
          } catch { /* best-effort mirror; worker info optional here */ }
          // Mirror the code we ran into Monaco so the human sees the exact source that
          // produced this picture. No-ops when the buffer already holds it (see setTextOnly).
          this.editorMirror = this.mirrorToEditor();
        } catch (err) {
          this.status = 'error';
          this.error = String(err?.message || err);
          this.stack = err?.stack || null;
        }
        this.done = true;
        return false;
      },
      async fillStats() {
        try {
          const info = await window.__MANIFOLD_CONTEXT__.getModelInfo();
          if (info) { this.volume = info.volume ?? null; this.bbox = info.boundingBox || null; }
        } catch { /* best-effort mirror; worker info optional here */ }
      },
      // ── Stage verification (kernel-truth arbiter for the cadgen pilot) ──
      // Runs a candidate script through the SAME worker the Run button uses and keeps
      // the worker's own report (volume/surfaceArea/status/tris/bbox) beside the mesh.
      // The verdict never depends on the harness's separate npm manifold-3d copy:
      // stageVerify asks the WORKER (bundled built/manifold.wasm) to boolean-compare
      // what its own last execution produced against a staged reference.
      async stageScript(script, timeoutMs = 300000) {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try {
          await ctx.executeScript(script, { timeoutMs });   // worker 'execute' -> lastResult
          const p = ctx.lastResult || {};
          return {
            ok: true,
            volume: p.volume ?? null,
            surfaceArea: p.surfaceArea ?? null,
            status: p.status ?? null,
            tris: p.tris ?? (p.mesh ? p.mesh.triVerts.length / 3 : 0),
            verts: p.mesh ? p.mesh.vertProperties.length / p.mesh.numProp : 0,
            bbox: p.boundingBox ?? null,
          };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) };
        }
      },
      async stageGetLastMesh() {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try { return { ok: true, ...(await ctx.worker.stageGetLastMesh()) }; }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      },
      async stageVerify(reference, opts) {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try { return { ok: true, ...(await ctx.worker.stageVerify(reference, opts || {})) }; }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      },
      async stageReferenceLoad(filename, objString, tolerance, timeoutMs = 180000) {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try { return { ok: true, ...(await ctx.worker.stageReferenceLoad(filename, { objString, tolerance }, { timeoutMs })) }; }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      },
      // Push a reference from raw meshData delivered as a JSON string (keeps the CDP
      // expression a single scalar): { numProp, vertProperties:[...], triVerts:[...] }.
      // Used by the STEP channel: backend /api/convert/step (OCCT) -> meshData -> worker.
      async stageReferenceLoadMesh(filename, meshDataJson, tolerance, timeoutMs = 180000) {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try {
          const meshData = JSON.parse(meshDataJson);
          return { ok: true, ...(await ctx.worker.stageReferenceLoad(filename, { meshData, tolerance }, { timeoutMs })) };
        }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      },
      async stageReferenceList() {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try { return { ok: true, ...(await ctx.worker.stageReferenceList()) }; }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      },
      async stageReferenceClear() {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx || !ctx.isReady) return { ok: false, error: 'manifold context not ready' };
        try { return { ok: true, ...(await ctx.worker.stageReferenceClear()) }; }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      },
      // Nuclear recovery for a wedged worker: a script stuck in a runaway loop survives
      // the execute() promise timeout (the worker thread keeps chewing), so every later
      // message queues behind it forever. Terminate + re-init drops the thread.
      async stageRestartWorker() {
        const ctx = window.__MANIFOLD_CONTEXT__;
        if (!ctx) return { ok: false, error: 'no context' };
        try {
          ctx.worker.terminate();
          ctx.worker.isReady = false;
          ctx.worker.pendingRequests.clear();
          await ctx.worker.init();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) };
        }
      },
      // Show the reviewed source in Monaco so a screenshot is self-explanatory. setTextOnly
      // declines the write when the buffer already holds this exact text, so re-running the
      // same script (the common case mid-review) leaves the editor -- cursor, scroll, undo
      // stack -- completely alone. Never re-executes: that is what keeps this out of a loop
      // with the mount-time run.
      mirrorToEditor(script) {
        try {
          const ed = window.__STAGE_EDITOR__ || null;
          if (!ed || typeof ed.setTextOnly !== 'function') return 'unavailable';
          const wrote = ed.setTextOnly(script);
          this._lastScript = script;
          return wrote ? 'updated' : 'noop';
        } catch { return 'unavailable'; }
      },
    };
    const poll = setInterval(async () => {
      const s = window.__STAGE__;
      if (!s || s.ready || s.done) return;
      const ctx = window.__MANIFOLD_CONTEXT__;
      if (ctx?.isReady && window.__VIEWPORT__?.ready?.()) { s.ready = true; clearInterval(poll); }
    }, 150);
    setTimeout(() => clearInterval(poll), 60000);
  }, []);

  // Initialize ManifoldWorker and handle script restoration.
  // StrictMode remount terminates the first worker; cancelled ignores that
  // rejection so the second mount can init cleanly. Worker init itself times out.
  useEffect(() => {
    let cancelled = false;
    const initManifold = async () => {
      try {
        console.log('[App] Initializing Manifold Sandbox Worker...');

        await manifoldContext.init();
        if (cancelled) return;

        window.ManifoldContext = manifoldContext;

        const helpers = await manifoldContext.getHelperFunctions();
        if (cancelled) return;
        console.log('[App] Available helper functions:', helpers);

        manifoldReadyRef.current = true;
        setManifoldReady(true);
        console.log('[App] Manifold Sandbox Worker ready');
      } catch (error) {
        if (cancelled) return;
        console.error('[App] Failed to initialize Manifold Sandbox:', error);
        manifoldReadyRef.current = false;
        setInitError(error.message || 'Manifold init failed');
      }
    };

    initManifold();

    return () => {
      cancelled = true;
      manifoldReadyRef.current = false;
      // StrictMode remount only — never terminate on pagehide/visibility.
      manifoldContext.terminate();
    };
  }, []);

  // G7: resolve GitHub App Client ID from server config (secret stays server-side).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const cfg = await res.json();
        if (cancelled) return;
        const id = resolveGithubClientId({ configClientId: cfg.githubAppClientId });
        if (id) {
          rememberGithubClientId(id);
          setGithubClientId(id);
        }
      } catch {
        // Offline / no backend — VITE_GITHUB_APP_CLIENT_ID still works.
      }
      // Never force connected off. A late config response used to clear a
      // token the session probe had just restored from the durable bundle.
      if (!cancelled && hasGithubToken()) setGithubConnected(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Restore editor + assembly. Reload opens the last assembly only after
  // auth has settled. A slow /api/auth/me or vault resolve must not paint
  // or save the stock demo (Part (1) in Assembly). IndexedDB `current` is
  // not overwritten on a timeout. Signed out clears the title chip and
  // creates nothing.
  useEffect(() => {
    if (!manifoldReady || bootResume === 'pending') return undefined;
    // Reconnect finished after a read-only reopen. Keep the open document.
    // The source flip below turns it into a vault once the token is back.
    if (bootResume === 'in' && bootGateRef.current === 'done' && assemblyRef.current) {
      bootReadOnlyRef.current = false;
      noteBootEmptyRef.current(false);
      return undefined;
    }
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    const isAuthReturn = params.get('auth') === 'success';
    const isAccountReturn = params.get('account') === 'true';
    const isCheckoutReturn = hasCheckoutReturnFlag();
    const pendingOAuthEditor = hasPendingEditorState();

    let oauthScript = '';
    let filename = null;
    let restoredEditor = false;

    console.log('[App] Initialization check:', {
      isAuthReturn,
      isAccountReturn,
      isCheckoutReturn,
      hasPendingEditor: pendingOAuthEditor,
      hasPendingCheckout: hasPendingCheckout(),
      bootResume,
    });

    if (pendingOAuthEditor) {
      const restored = restoreEditorState();
      clearEditorState();
      console.log('[App] Restored OAuth editor hand-off:', {
        hasScript: !!restored?.currentScript,
        scriptLength: restored?.currentScript?.length,
      });
      if (restored?.currentScript) {
        oauthScript = restored.currentScript;
        restoredEditor = true;
      }
      if (restored?.currentFilename) filename = restored.currentFilename;
    }

    if (isCheckoutReturn || (isAuthReturn && hasPendingCheckout())) {
      const checkoutState = restoreCheckoutState();
      if (checkoutState) {
        setOrderData({
          quoteData: checkoutState.quoteData,
          modelData: checkoutState.modelData,
          restoredStep: checkoutState.currentStep,
          restoredAddress: checkoutState.address,
          restoredGuestEmail: checkoutState.guestEmail,
          lineId: checkoutState.lineId || null,
          script: checkoutState.script || null,
        });
        setShowOrderModal(true);
      }
      clearCheckoutState();
    }
    if (isAccountReturn) setShowAccountModal(true);
    if (isAuthReturn || isAccountReturn || isCheckoutReturn) clearCheckoutReturnFlag();

    const browserStorage = () => {
      try { return globalThis.localStorage; } catch { return null; }
    };

    const clearChip = () => {
      assemblyRef.current = null;
      partScriptsRef.current = {};
      setAssemblyDoc(null);
      setPartScripts({});
      setCurrentFilename(null);
      bootGateRef.current = 'done';
      setEditorInitialScript('');
      setBootEpoch((n) => n + 1);
    };

    const run = async () => {
      if (bootResume === 'out') {
        bootReadOnlyRef.current = false;
        noteBootEmptyRef.current(false);
        clearChip();
        return;
      }
      const reauth = bootResume === 'reauth';
      bootReadOnlyRef.current = reauth;
      bootGateRef.current = 'opening';
      const userId = bootUserId(user);
      const pointer = pointerForUser(readLastOpenedMap(browserStorage()), userId);
      let loaded = await loadAssemblyDocumentStatus();
      if (loaded.status === 'timeout') loaded = await loadAssemblyDocumentStatus();
      if (cancelled) return;
      try {
        const sidecar = normalizeWorkingSidecar(await loadAssemblySidecar());
        gitSidecarRef.current = sidecar;
        setGitSidecar(sidecar);
      } catch (err) {
        console.warn('[App] sidecar load failed', err?.message || err);
      }

      const github = !reauth && !!(githubConnected || hasGithubToken());
      const decide = (vaultStatus) => planReloadAssembly({
        me: 'in',
        refresh: 'idle',
        reauth,
        cacheStatus: loaded.status,
        cachedDoc: loaded.doc,
        pointer,
        userId,
        vaultStatus,
        githubConnected: github,
      });
      let plan = decide(github ? 'idle' : 'unavailable');
      if (plan.action === 'wait' && plan.reason === 'vault-pending') {
        try {
          await ensureGitVaultRef.current({ create: false });
          if (cancelled) return;
          plan = decide('ready');
        } catch (err) {
          console.warn('[App] Vault resolve during reload failed:', err?.message || err);
          if (cancelled) return;
          plan = decide('failed');
        }
      }
      if (cancelled) return;
      if (bootWriteAllowed(plan) || plan.action === 'clear' || plan.action === 'empty') {
        noteBootEmptyRef.current(plan.action === 'empty');
        clearChip();
        return;
      }
      noteBootEmptyRef.current(false);
      if (plan.action === 'wait') {
        bootGateRef.current = 'idle';
        return;
      }

      if (plan.action === 'reopen-vault') {
        setEditorInitialScript('');
        try {
          await openVaultAssemblyRef.current(plan.name);
        } catch (err) {
          console.warn('[App] Reload vault open failed:', err?.message || err);
        }
        if (cancelled) return;
        if (!assemblyRef.current) clearChip();
        else {
          bootGateRef.current = 'done';
          setBootEpoch((n) => n + 1);
        }
        return;
      }

      const genAtStart = refreshGenRef.current;
      try {
        await openAssemblyTrackedRef.current({
          doc: plan.doc,
          retry: () => { window.location.reload(); },
          load: async ({ progress, signal }) => {
            let draft = null;
            if (!restoredEditor) {
              try {
                draft = await loadEditorDraft();
              } catch (err) {
                console.warn('[App] Editor draft restore failed:', err);
                draft = null;
              }
            }
            if (cancelled || !signal()) return;

            let doc = plan.doc;
            if (!doc?.parts?.length) return;
            progress({ name: doc.name, index: 0, total: doc.parts?.length || 0 });
            let scripts = await loadScriptsForParts(doc.parts, {
              onProgress: (update) => progress({ ...update, name: doc.name }),
            });
            const migrated = migrateAssemblyRecords({ doc, scripts });
            if (migrated.changed) {
              doc = migrated.doc;
              scripts = migrated.scripts;
            }
            const flags = await loadPartSyncFlags((doc.parts || []).map((part) => part.id));
            if (Object.keys(flags).length) {
              doc = {
                ...doc,
                parts: (doc.parts || []).map((part) => (
                  typeof flags[part.id] === 'boolean' ? { ...part, isSynced: flags[part.id] } : part
                )),
              };
            }
            const persistSource = { doc, scripts };
            const localIds = migrateLocalPartIds({
              doc,
              scripts,
              histories: partHistoriesRef.current,
              selection: { activeId: doc.activeId, cadPartId: cadPartIdRef.current },
              draftPartId: draft?.partId ?? null,
            });
            if (localIds.changed) {
              doc = localIds.doc;
              scripts = localIds.scripts;
              partHistoriesRef.current = localIds.histories || partHistoriesRef.current;
              if (localIds.selection?.cadPartId && localIds.selection.cadPartId !== cadPartIdRef.current) {
                cadPartIdRef.current = localIds.selection.cadPartId;
              }
              if (draft && localIds.draftPartId !== draft.partId) {
                draft = { ...draft, partId: localIds.draftPartId };
                if (!bootReadOnlyRef.current) {
                  try { await saveEditorDraft(draft); } catch { /* ignore */ }
                }
              }
            }
            const readOnly = plan.readOnly === true || bootReadOnlyRef.current;
            const rekeyJournal = readOnly ? null : await loadRekeyJournal();
            const collapsed = collapseWorkingCopyIds(doc, scripts, {
              readOnly,
              reusePairs: reusePairsFromJournal(rekeyJournal, persistSource.doc),
            });
            if (collapsed.changed) {
              doc = collapsed.doc;
              scripts = collapsed.scripts;
              if (collapsed.pairs.length) {
                const hist = { ...partHistoriesRef.current };
                for (const { from, to } of collapsed.pairs) {
                  if (from && to && from !== to && hist[from] && hist[to] == null) {
                    hist[to] = hist[from];
                    delete hist[from];
                  }
                  if (cadPartIdRef.current === from) cadPartIdRef.current = to;
                }
                partHistoriesRef.current = hist;
              }
              if (draft?.partId) {
                const hit = collapsed.pairs.find((pair) => pair.from === draft.partId);
                if (hit) draft = { ...draft, partId: hit.to };
              }
            }
            const idsChanged = migrated.changed || localIds.changed || collapsed.changed;
            if (!readOnly && !idsChanged && rekeyJournal) {
              try { await clearRekeyJournal(); } catch { /* leftover from a finished persist */ }
            }
            if (!readOnly && !bootWouldClobber(loaded.doc, doc) && (idsChanged || Object.keys(flags).length)) {
              try {
                if (idsChanged) {
                  const persisted = await persistCollapsedWorkingCopy({
                    collapsed: {
                      doc,
                      scripts,
                      pairs: [...localIds.pairs, ...collapsed.pairs],
                    },
                    sourceDoc: persistSource.doc,
                    sourceScripts: persistSource.scripts,
                    heldScripts: persistSource.scripts,
                    save: async (id, text) => {
                      const part = (doc.parts || []).find((row) => row.id === id);
                      return savePartScript(
                        id,
                        text,
                        typeof part?.isSynced === 'boolean' ? { isSynced: part.isSynced } : {},
                      );
                    },
                    load: loadPartScript,
                    remove: async (id) => {
                      try { await deletePartScript(id); } catch { /* ignore */ }
                    },
                    saveDoc: saveAssemblyDocument,
                    live: () => persistSource.scripts,
                    assemblyKey: assemblyRekeyKey(persistSource.doc),
                    saveJournal: saveRekeyJournal,
                    clearJournal: clearRekeyJournal,
                    onFlight: (pairs, opts) => {
                      persistFlightPairsRef.current = Array.isArray(pairs) ? pairs : [];
                      persistFlightToOnlyRef.current = !!(opts && opts.toOnly);
                    },
                    apply: ({ doc: nextDoc, scripts: nextScripts }) => {
                      doc = nextDoc;
                      scripts = nextScripts;
                    },
                  });
                  doc = persisted.doc;
                  scripts = persisted.scripts;
                } else {
                  await saveAssemblyDocument(doc);
                }
              } catch (err) {
                console.warn('[App] Part id migration persist failed:', err?.message || err);
              }
            }
            if (cancelled || !signal()) return;

            const active = doc.parts.find((part) => part.id === doc.activeId) || doc.parts[0];
            doc = serializeAssembly({ ...doc, activeId: active.id });
            const restored = resolveActiveRestore({
              active,
              scripts,
              draft: restoredEditor ? null : draft,
              fallbackScript: oauthScript || '',
            });
            scripts = restored.scripts;
            const nextScript = restored.script;
            let nextFilename = restored.filename || filename || active.name;
            if (!readOnly && restored.persistActive && nextScript) {
              try { await savePartScript(active.id, nextScript); } catch { /* ignore */ }
            }
            if (!nextFilename) nextFilename = active.name;
            if (cancelled || !signal()) return;
            if (genAtStart !== refreshGenRef.current) {
              console.log('[App] Skipping stale IDB hydrate; assembly already replaced');
              return;
            }
            if (gitBaselineRef.current?.headSha) {
              console.log('[App] Skipping IDB hydrate; vault baseline already set');
              return;
            }

            refreshGenRef.current += 1;
            assemblyRef.current = doc;
            partScriptsRef.current = scripts;
            bootGateRef.current = 'done';
            setAssemblyDoc(doc);
            setPartScripts(scripts);
            setBootEpoch((n) => n + 1);
            if (!readOnly && userId && !bootWouldClobber(null, doc)) {
              rememberLastOpened(browserStorage(), userId, doc);
            }
            try {
              const store = gitSync();
              await store.ready();
              if (!cancelled) setPartSync({ ...store.partStates() });
            } catch { /* dot state can wait for the next flush */ }
            if (nextFilename) setCurrentFilename(nextFilename);
            setEditorInitialScript(nextScript);
            if (typeof nextScript === 'string') setCurrentScript(nextScript);
            await finishOpenedPartRef.current(doc, scripts, progress);
          },
        });
      } catch (err) {
        console.warn('[App] Assembly restore failed:', err);
      }
      if (cancelled || bootGateRef.current === 'done') return;
      if (!assemblyRef.current) clearChip();
      else {
        bootGateRef.current = 'done';
        setBootEpoch((n) => n + 1);
        const id = assemblyRef.current.activeId;
        const text = partScriptsRef.current?.[id];
        setEditorInitialScript(typeof text === 'string' ? text : '');
        if (typeof text === 'string') setCurrentScript(text);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [manifoldReady, bootResume, githubConnected, user, savePartScript, deletePartScript, loadScriptsForParts]);

  // Mirror the live CAD buffer into IndexedDB so a reload restores it.
  // Debounced: the editor calls onExecute on every keystroke, and the draft
  // only has to be no older than the last pause in typing.
  // Game mode is excluded — its buffer is puzzle scratch, and restoring it
  // into the CAD editor on the next load would clobber the user's model.
  useEffect(() => {
    if (!manifoldReady || editorInitialScript === null) return undefined;
    if (appMode === 'game' || !editorLiveRef.current) return undefined;
    const epoch = partSaveEpochRef.current;
    // Capture id + buffer at schedule time. Reading activeId only when the
    // timer fires would write the previous part's script into a newly
    // selected / created row after a switch.
    const idAtSchedule = assemblyRef.current?.activeId;
    const scriptAtSchedule = currentScript;
    const filenameAtSchedule = currentFilename;
    const timer = setTimeout(() => {
      if (bootReadOnlyRef.current) return;
      if (epoch !== partSaveEpochRef.current) return;
      if (!idAtSchedule || assemblyRef.current?.activeId !== idAtSchedule) return;
      if (suppressPartSaveRef.current || typeof scriptAtSchedule !== 'string') return;
      saveEditorDraft({
        script: scriptAtSchedule,
        filename: filenameAtSchedule,
        partId: idAtSchedule,
      });
      const next = { ...partScriptsRef.current, [idAtSchedule]: scriptAtSchedule };
      partScriptsRef.current = next;
      setPartScripts(next);
      const flightPairs = persistFlightPairsRef.current;
      const toOnly = persistFlightToOnlyRef.current;
      for (const id of dualWriteTargets(idAtSchedule, flightPairs, toOnly)) {
        savePartScript(id, remapFeaForPersist(scriptAtSchedule, flightPairs, id));
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [currentScript, currentFilename, manifoldReady, editorInitialScript, appMode, savePartScript]);

  // Agent `dirty.unsaved`: baseline scripts at open (reset when the assembly
  // identity changes). A part added later joins the snapshot with its current
  // script; the parts already edited keep their baseline (Pi 5 C1).
  useEffect(() => {
    if (!assemblyDoc || editorInitialScript === null || appMode === 'game') return;
    const key = agentSnapshotDocKey(assemblyDoc);
    const partIds = (assemblyDoc.parts || []).map((row) => row.id);
    if (agentSnapshotDocKeyRef.current === key && agentScriptSnapshotRef.current) {
      const snap = agentScriptSnapshotRef.current;
      if (partIds.some((id) => typeof snap[String(id)] !== 'string')) {
        agentScriptSnapshotRef.current = extendPartScriptSnapshot(snap, partScriptsRef.current || {}, partIds);
      }
      return;
    }
    agentSnapshotDocKeyRef.current = key;
    // Identity changed; Monaco may still hold the previous buffer.
    captureAgentScriptSnapshot({ useEditor: false });
  }, [assemblyDoc, editorInitialScript, appMode]);

  // A reload can beat the debounce (refresh mid-typing). pagehide covers the
  // iOS/Safari case where unload never fires. Flush drafts only — never
  // location.reload, never terminate the WASM worker here (that would force
  // a full remount on every minimize).
  useEffect(() => {
    if (!manifoldReady || editorInitialScript === null) return undefined;
    const flush = () => {
      if (bootReadOnlyRef.current) return;
      if (appModeRef.current === 'game' || !editorLiveRef.current) return;
      const live = codeEditorRef.current?.getContent?.() ?? currentScript;
      const id = assemblyRef.current?.activeId;
      if (typeof live === 'string') {
        saveEditorDraft({ script: live, filename: currentFilename, partId: id || null });
      }
      if (id && !suppressPartSaveRef.current && typeof live === 'string') {
        partScriptsRef.current = { ...partScriptsRef.current, [id]: live };
        const flightPairs = persistFlightPairsRef.current;
        const toOnly = persistFlightToOnlyRef.current;
        for (const key of dualWriteTargets(id, flightPairs, toOnly)) {
          savePartScript(key, remapFeaForPersist(live, flightPairs, key));
        }
      }
    };
    const onPageHide = (event) => {
      flush();
      // event.persisted === true means bfcache; still do not reload/terminate.
      void event;
    };
    const onVisFlush = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisFlush);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisFlush);
    };
  }, [currentScript, currentFilename, manifoldReady, editorInitialScript, savePartScript]);

  // Safari minimize / restore: soft-recover the Manifold worker when the JS
  // world survives but the Worker was killed. If Safari discarded the tab
  // entirely (standalone PWA / memory pressure), that is a real navigation
  // and WASM must re-init — we cannot fake surviving it; see architecture.md.
  useEffect(() => {
    let busy = false;
    let lastCheck = 0;
    const softRecover = async (reason) => {
      if (!manifoldReadyRef.current || busy) return;
      const now = Date.now();
      if (now - lastCheck < 1500) return;
      lastCheck = now;
      busy = true;
      try {
        // #211 put ensureAlive on ManifoldWorker; App talks to ManifoldContext.
        // Guard so a missing method never surfaces as Initialization Failed.
        if (typeof manifoldContext.ensureAlive !== 'function') {
          console.warn('[App] ensureAlive unavailable; skipping soft-recover');
          return;
        }
        const result = await manifoldContext.ensureAlive(reason);
        if (result?.status === 'restarted') {
          manifoldReadyRef.current = true;
          setManifoldReady(true);
          setInitError(null);
          console.log('[App] Manifold worker soft-restarted after', reason);
        }
      } catch (err) {
        console.error('[App] Manifold soft-restart failed:', err);
        manifoldReadyRef.current = false;
        setManifoldReady(false);
        setInitError(err?.message || 'Manifold worker lost after backgrounding');
      } finally {
        busy = false;
      }
    };
    const onPageShow = (event) => {
      // bfcache restore (persisted) or ordinary show after freeze.
      if (event.persisted || manifoldReadyRef.current) {
        void softRecover(event.persisted ? 'bfcache' : 'pageshow');
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void softRecover('visibility');
      }
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Leaving a puzzle puts the assembly back in the viewport. appModeRef is
  // still 'game' during the exit click, so the editor's auto-run skips it.
  const prevAppModeRef = useRef(appMode);
  useEffect(() => {
    const prev = prevAppModeRef.current;
    prevAppModeRef.current = appMode;
    if (prev === 'game' && appMode === 'cad' && assemblyRef.current) {
      const code = codeEditorRef.current?.getContent?.();
      refreshAssemblyRef.current?.(code);
    }
  }, [appMode]);

  // Check for mobile layout
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");

    const checkIsMobile = () => {
        setIsMobile(mediaQuery.matches);
      };

    // Initial check
    checkIsMobile();

    // Media query change (works well on desktop + some mobile scenarios)
    const onMediaChange = (e) => {
      setIsMobile(e.matches);
    };
    mediaQuery.addEventListener("change", onMediaChange);

    // Resize event – critical fallback for iOS Safari rotation
    const onResize = () => {
      // Small delay helps when toolbar sliding causes multiple rapid resizes
      const timer = setTimeout(checkIsMobile, 50);
      return () => clearTimeout(timer);
    };
    window.addEventListener("resize", onResize);

    // Cleanup
    return () => {
      mediaQuery.removeEventListener("change", onMediaChange);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Track visualViewport for mobile keyboard-aware editor height (slice 05).
  useEffect(() => {
    const sync = () => {
      const v = window.visualViewport;
      setVv({
        height: v?.height ?? window.innerHeight,
        offsetTop: v?.offsetTop ?? 0,
        layoutHeight: window.innerHeight,
      });
    };
    sync();
    const vvApi = window.visualViewport;
    vvApi?.addEventListener('resize', sync);
    vvApi?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vvApi?.removeEventListener('resize', sync);
      vvApi?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const clearSuccessTimer = () => {
    if (successClearTimerRef.current) {
      clearTimeout(successClearTimerRef.current);
      successClearTimerRef.current = null;
    }
  };

  const resetGameScoring = () => {
    clearSuccessTimer();
    setGameTimerRunning(false);
    setGameElapsedMs(0);
    setGameSuccess(false);
    gameTimerStartRef.current = 0;
  };

  const startGameTimer = () => {
    clearSuccessTimer();
    setGameSuccess(false);
    gameTimerStartRef.current = performance.now();
    setGameElapsedMs(0);
    setGameTimerRunning(true);
  };

  // Puzzle timer: starts on enter, ticks at 10 Hz, stops on match.
  useEffect(() => {
    if (!gameTimerRunning) return undefined;
    const id = setInterval(() => {
      setGameElapsedMs(performance.now() - gameTimerStartRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [gameTimerRunning]);

  useEffect(() => () => {
    if (successClearTimerRef.current) {
      clearTimeout(successClearTimerRef.current);
      successClearTimerRef.current = null;
    }
  }, []);

  /**
   * CAD → game: always start on first pack puzzle (linear progression).
   * Picker stays secondary via toolbar List (handlePickPuzzle).
   */
  const handleStartGame = () => {
    if (gameLoading) return;
    const first = getPuzzle(DEFAULT_PUZZLE_ID) || GAME_PUZZLES[0] || DEMO_PUZZLE;
    loadPuzzle(first, { autoOpenHint: true });
  };

  const handlePickPuzzle = () => {
    if (gameLoading) return;
    setShowPuzzlePicker(true);
  };

  /**
   * Load a puzzle: rebuild ghost, blank editor, reset timer.
   * Used for first enter, auto-advance, and mid-game picker switches.
   * @param {{ autoOpenHint?: boolean }} [opts]
   */
  const loadPuzzle = async (puzzle, opts = {}) => {
    if (!puzzle?.targetScript || gameLoading) return;
    const enteringFromCad = appMode !== 'game';
    const autoOpenHint = Boolean(opts.autoOpenHint);
    resetGameScoring();
    setGameLoading(true);
    setGameError(null);
    setShowPuzzlePicker(false);
    setShowConfetti(false);
    try {
      if (enteringFromCad) {
        const current = codeEditorRef.current?.getContent?.() ?? currentScript;
        setCadScriptBackup(current);
      }

      const result = await manifoldContext.executeScript(puzzle.targetScript, {
        timeoutMs: 30000,
      });
      if (!result?.mesh?.vertProperties) {
        throw new Error('Ghost target produced no mesh');
      }
      await manifoldContext.storeGameTarget();
      setGhostMeshData(result.mesh);
      setCurrentPuzzle(puzzle);
      setGameBestTimeMs(getBestTimeMs(puzzle.id));
      setAppMode('game');
      // Slice 07: first puzzle auto-opens Hint on enter (Artur playtest).
      const isFirst = puzzle.id === DEFAULT_PUZZLE_ID || puzzle.id === GAME_PUZZLES[0]?.id;
      setShowHints(autoOpenHint || isFirst);
      setGameError(null);

      // Blank Monaco + ghost-only until Run (slice 02.1 / 05).
      // Always '' — never starter/target/demo (remount + loadContent auto-run
      // previously leaked DEMO TARGET / Solo Cup into the editor on enter).
      setCurrentScript('');
      const blankEditor = () => codeEditorRef.current?.setTextOnly?.('');
      blankEditor();
      // Layout swap (viewport top / editor bottom) remounts Monaco after this
      // tick; double window.rAF waits for remount/paint so initialScript cannot
      // stick. (No queueMicrotask — rAF covers the remount tick.)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          blankEditor();
          viewportRef.current?.frameGhost?.();
        });
      });
      viewportRef.current?.clearAttempt?.();
      startGameTimer();
    } catch (err) {
      console.error('[App] Failed to start puzzle:', err);
      setGameError(err.message || 'Failed to start puzzle');
      if (enteringFromCad) {
        setGhostMeshData(null);
        setCadScriptBackup(null);
        setAppMode('cad');
        resetGameScoring();
        manifoldContext.clearGameTarget().catch(() => {});
      }
    } finally {
      setGameLoading(false);
    }
  };

  const handleExitGame = () => {
    resetGameScoring();
    manifoldContext.clearGameTarget().catch(() => {});
    setAppMode('cad');
    setGhostMeshData(null);
    setShowHints(false);
    setShowPuzzlePicker(false);
    setShowConfetti(false);
    setGameError(null);
    setGameBestTimeMs(null);
    const restore = cadScriptBackup || DEFAULT_SCRIPT;
    codeEditorRef.current?.loadContent(restore, 'Back to CAD', true);
    setCadScriptBackup(null);
  };

  const rememberScripts = (next) => {
    const scripts = normalizeInstanceScripts(next, assemblyRef.current);
    partScriptsRef.current = scripts;
    setPartScripts(scripts);
  };

  const commitPartRuns = (runs) => {
    partRunsRef.current = fanOutInstanceRuns(runs || {}, assemblyRef.current);
    setPartRuns(partRunsRef.current);
    // FEATURE-GAP notes in the open parts go to Sentry once per page load,
    // and only when the user accepted all cookies (no script text leaves).
    try {
      reportFeatureGaps(partScriptsRef.current, {
        consent: getAnalyticsConsent() === true,
        capture: captureSentryException,
      });
    } catch { /* reporting never breaks a build */ }
  };

  const syncAssemblyHistory = (doc) => {
    const key = assemblyHistoryKey(doc);
    if (assemblyHistoryRef.current?.key === key) return;
    assemblyHistoryRef.current = { key, ...seedAssemblyHistory(doc) };
    setAssemblyHistTick((tick) => tick + 1);
  };

  const rememberAssembly = (doc, opts = {}) => {
    const clean = serializeAssembly(doc);
    assemblyRef.current = clean;
    setAssemblyDoc(clean);
    syncAssemblyHistory(clean);
    // Reauth boot is read-only, but an explicit upload is a user write.
    if (opts.persist !== false && (!bootReadOnlyRef.current || opts.force)) {
      assemblyDocPersistRef.current = saveAssemblyDocument(clean);
      const id = bootUserId(user);
      if (id) {
        try { rememberLastOpened(globalThis.localStorage, id, clean); } catch { /* private mode */ }
      }
    }
    return clean;
  };

  const rememberSidecar = (next, { persist = true } = {}) => {
    const clean = normalizeWorkingSidecar(next);
    gitSidecarRef.current = clean;
    setGitSidecar(clean);
    if (persist && (!bootReadOnlyRef.current)) {
      void saveAssemblySidecar(clean);
    }
    return clean;
  };

  const recordAgentAssemblyStep = (beforeDoc) => {
    const after = assemblyRef.current;
    if (!beforeDoc || !after) return;
    const base = assemblyHistoryRef.current?.commits?.length
      ? assemblyHistoryRef.current
      : seedAssemblyHistory(beforeDoc);
    assemblyHistoryRef.current = {
      key: assemblyHistoryKey(after),
      ...pushAssemblyHistory(base, beforeDoc, after),
    };
    setAssemblyHistTick((tick) => tick + 1);
  };

  const ensureLocalSurfIds = async () => {
    const doc = assemblyRef.current;
    if (!doc) return;
    const stamped = stampMissingSurfIds(doc, partScriptsRef.current);
    if (!stamped.changed) return;
    for (const part of stamped.doc.parts) {
      const before = (doc.parts || []).find((row) => row.id === part.id);
      if (before?.surfId === part.surfId) continue;
      await savePartScript(part.id, stamped.scripts[part.id] || '');
    }
    rememberScripts(stamped.scripts);
    rememberAssembly(stamped.doc);
    const active = stamped.doc.activeId;
    if (active && stamped.scripts[active]) {
      codeEditorRef.current?.setTextOnly?.(stamped.scripts[active]);
      setCurrentScript(stamped.scripts[active]);
    }
  };

  const historyKey = () => {
    if (appModeRef.current === 'game') return '__game__';
    const id = assemblyRef.current?.activeId;
    return id ? definitionIdFor(id) : '__cad__';
  };

  const applyPartHistory = (entry) => {
    const state = {
      branches: { main: { commits: entry.commits, head: entry.head } },
      currentBranch: 'main',
    };
    historyRef.current = state;
    setHistory(state);
  };

  const focusPartHistory = (partId, script) => {
    if (appModeRef.current === 'game') return;
    const key = partId ? definitionIdFor(partId) : '__cad__';
    const next = historyForPart(partHistoriesRef.current, key, script ?? '');
    partHistoriesRef.current[key] = next;
    applyPartHistory(next);
  };

  const dropPartHistory = (partId) => {
    if (partId == null) return;
    const def = definitionIdFor(partId);
    if (definitionStillReferenced(assemblyRef.current?.parts, def, partId)) return;
    delete partHistoriesRef.current[def];
  };

  // The editor buffer is this part's latest script. Keep it on that part's
  // stack before the active id changes, so a later Undo cannot see another part.
  const stashPartHistory = (partId, script) => {
    if (appModeRef.current === 'game' || partId == null || typeof script !== 'string') return;
    const key = definitionIdFor(partId);
    partHistoriesRef.current[key] = pushPartHistory(
      historyForPart(partHistoriesRef.current, key, script),
      script,
      'Part',
    );
  };

  /**
   * Run every visible part. The active part goes through executeScript so
   * face and edge graphs still rebuild on that solid alone. A failed active
   * part passes noShadow and is omitted. Other parts are meshes beside it.
   */
  const assetKeyForDef = (defId) => {
    const meta = partMeshMetaRef.current?.[String(defId)];
    return assetKeyFromAssets(meta?.assets);
  };

  const previousPartRun = (defId, rowId) => {
    const runs = partRunsRef.current || {};
    return runs[defId] || (rowId != null ? runs[rowId] : null) || null;
  };

  const featureRigidForPart = (partId) => {
    const doc = assemblyRef.current;
    const row = doc?.parts?.find((part) => part.id === partId) || null;
    const def = row ? partDefinitionId(row) : partId;
    const run = previousPartRun(def, partId);
    return run?.featureRigid || run?.mesh?.featureRigid || null;
  };

  /**
   * New features land after a trailing Move / Rotate, so their coordinates
   * are in moved part space. An edit of a block inside the prefix keeps the
   * mesh-local numbers the script already has.
   */
  const matrixForNewFeature = (partId, script, editing) => {
    const matrix = featureRigidForPart(partId);
    if (!matrix) return null;
    if (!editing) return matrix;
    const split = splitTrailingRigid(typeof script === 'string' ? script : '');
    if (!split?.ops.length || split.suffixStart == null) return null;
    const id = typeof editing === 'string' ? editing : (editing.id || editing.featureId || '');
    if (id && typeof script === 'string') {
      const at = script.indexOf(String(id));
      if (at >= 0 && at < split.suffixStart) return null;
    }
    return matrix;
  };

  const placementForMesh = (part) => {
    const asm = partPlacement(part);
    if (!part) return asm;
    return composePlacementWithMatrix(asm, featureRigidForPart(part.id));
  };

  const meshTimingOn = () => !!(import.meta.env?.DEV || globalThis.__SURFCAD_MESH_TIMING);

  /**
   * The primary worker holds the active solid for cross-section. A skipped
   * rebuild still updates that matrix, or warms the solid in the background
   * without copying the mesh back.
   */
  const warmPrimaryMesh = (defId, script, decision) => {
    const meshKey = decision?.meshKey;
    if (!meshKey || typeof script !== 'string') return;
    const gen = refreshGenRef.current;
    const held = primaryHoldsRef.current;
    const same = held && held.meshKey === meshKey && String(held.defId) === String(defId);
    if (same && decision.action !== 'rigid') return;
    if (same && decision.action === 'rigid') {
      manifoldContext.setFeatureRigid(meshKey, decision.featureRigid || null).then((res) => {
        if (res && res.held === false && gen === refreshGenRef.current) {
          primaryHoldsRef.current = null;
          warmPrimaryMesh(defId, script, { ...decision, action: 'reuse' });
        }
      }).catch(() => {});
      return;
    }
    void (async () => {
      let importedModels = {};
      try {
        const prepared = await resolvePartMeshes(defId, script);
        if (prepared?.importedModels) importedModels = prepared.importedModels;
      } catch { /* the warm is best-effort */ }
      if (gen !== refreshGenRef.current) return;
      try {
        const result = await manifoldContext.executeScript(script, {
          timeoutMs: 30000,
          omitMesh: true,
          knownMeshKey: meshKey,
          partId: String(defId),
          importedModels,
        });
        if (gen !== refreshGenRef.current) return;
        if (result && (result.meshOmitted || result.mesh || result.rigidOnly)) {
          primaryHoldsRef.current = { meshKey: result.meshKey || meshKey, defId: String(defId) };
        }
      } catch (err) {
        console.warn('[App] primary mesh warm failed', err?.message || err);
      }
    })();
  };

  const refreshAssembly = async (activeScript, opts = {}) => {
    if (!assemblyRef.current && appModeRef.current !== 'game') {
      const text = typeof activeScript === 'string'
        ? activeScript
        : (codeEditorRef.current?.getContent?.() ?? '');
      // Mount auto-runs an empty buffer. That must not create an assembly.
      // Run, and any later build of a real script, seeds Part (1) first.
      if (text.trim()) await seedOpenAssembly(text);
    }
    const doc = assemblyRef.current;
    if (!doc || appModeRef.current === 'game') return false;
    if (typeof activeScript === 'string') lastAssemblyScriptRef.current = activeScript;
    const persistActive = opts.persistActive !== false && !suppressPartSaveRef.current;
    let scripts = { ...partScriptsRef.current };
    const activeId = doc.activeId;
    const wanted = cadPartIdRef.current;
    const viewId = wanted && doc.parts.some((part) => part.id === wanted) ? wanted : activeId;
    if (typeof activeScript === 'string' && activeId && persistActive) {
      scripts = { ...scripts, [activeId]: activeScript };
      rememberScripts(scripts);
      savePartScript(activeId, activeScript);
    }
    const gen = ++refreshGenRef.current;
    const activePart = doc.parts.find((part) => part.id === viewId);
    const activeVisible = !!(activePart && activePart.visible !== false);
    const willBuildActive = !!(viewId && activeVisible && typeof scripts[viewId] === 'string');
    // Rows that place the same definition as the active row take its run
    // (fanOutInstanceRuns below), so they are not built a second time here.
    // A hidden active row builds nothing, so its definition then builds on
    // the pool through its visible rows like any other.
    const viewDef = activePart ? partDefinitionId(activePart) : null;
    const otherIds = doc.parts
      .filter((part) => part.visible !== false && part.id !== viewId
        && !(willBuildActive && partDefinitionId(part) === viewDef))
      .map((part) => part.id);
    const tAssembly = performance.now();
    const shipNotes = [];
    const noteShip = (id, action, reason, ms) => {
      shipNotes.push({
        id: id == null ? null : String(id),
        action,
        reason: reason || null,
        ms: Math.round(ms * 10) / 10,
      });
    };
    const decisionFor = (part, script) => {
      const def = partDefinitionId(part);
      const anchor = rollbackAnchorsRef.current[String(part.id)];
      if ((anchor === null || typeof anchor === 'string') && rollbackClearsPart(script, anchor)) {
        return { action: 'rebuild', reason: 'rollback' };
      }
      return decideMeshShip({
        script,
        assetKey: assetKeyForDef(def),
        previous: previousPartRun(def, part.id),
      });
    };
    const assignDefRun = (map, def, run) => {
      map[def] = run;
      for (const row of doc.parts) {
        if (partDefinitionId(row) === def) map[row.id] = run;
      }
    };
    const keptByDef = {};
    const rebuildIds = [];
    const seenDef = new Set();
    for (const id of otherIds) {
      const part = doc.parts.find((row) => row.id === id);
      if (!part) continue;
      const def = partDefinitionId(part);
      if (seenDef.has(def)) continue;
      seenDef.add(def);
      const script = typeof scripts[id] === 'string' ? scripts[id] : scripts[def];
      if (typeof script !== 'string') {
        rebuildIds.push(id);
        noteShip(def, 'rebuild', 'missing', 0);
        continue;
      }
      const tDecide = performance.now();
      const decision = decisionFor(part, script);
      if (decision.action === 'reuse' || decision.action === 'rigid') {
        const run = runFromShip(previousPartRun(def, id), decision);
        if (run) {
          run.assetKey = assetKeyForDef(def);
          keptByDef[def] = run;
          noteShip(def, decision.action, decision.reason, performance.now() - tDecide);
          continue;
        }
      }
      noteShip(def, 'rebuild', decision.reason, performance.now() - tDecide);
      for (const rowId of otherIds) {
        const row = doc.parts.find((item) => item.id === rowId);
        if (row && partDefinitionId(row) === def) rebuildIds.push(rowId);
      }
    }
    let activeDecision = null;
    let activeScriptText = willBuildActive ? scripts[viewId] : null;
    if (willBuildActive) {
      const anchor = storedRollback(String(viewId));
      const cleared = (anchor === null || typeof anchor === 'string')
        && rollbackClearsPart(activeScriptText, anchor);
      const tDecide = performance.now();
      activeDecision = cleared
        ? { action: 'rebuild', reason: 'rollback' }
        : decisionFor(activePart, activeScriptText);
      // A deliberate Run re-executes an unchanged script so a cleared feature
      // memo is filled again. A trailing Move / Rotate stays on the matrix.
      if (!cleared && opts.forceActive && activeDecision.action === 'reuse') {
        activeDecision = { action: 'rebuild', reason: 'run' };
      }
      if (!cleared && (activeDecision.action === 'reuse' || activeDecision.action === 'rigid')) {
        noteShip(viewId, activeDecision.action, activeDecision.reason, performance.now() - tDecide);
      } else {
        noteShip(viewId, 'rebuild', activeDecision.reason, performance.now() - tDecide);
        activeDecision = { ...activeDecision, action: 'rebuild' };
      }
    }
    const activeRebuild = willBuildActive && activeDecision?.action === 'rebuild';
    const buildTotal = rebuildIds.length + (activeRebuild ? 1 : 0);
    let buildStep = 0;
    const noteBuild = () => {
      buildStep += 1;
      const report = assemblyOpenProgressRef.current;
      if (typeof report === 'function') report({ index: buildStep, total: Math.max(buildTotal, 1) });
    };
    let other;
    try {
      // Unchanged parts stay on the page. The rest build on the geometry
      // pool; the active part follows on the primary worker when it changed.
      other = await runAssemblyParts({
          doc,
          scripts,
          ids: rebuildIds,
          concurrency: manifoldContext.parallelism(),
          execute: (script, execOpts) => {
            noteBuild();
            const anchor = rollbackAnchorsRef.current[String(execOpts?.partId || '')];
            if ((anchor === null || typeof anchor === 'string') && rollbackClearsPart(script, anchor)) {
              return { ok: true, cleared: true };
            }
            return manifoldContext.executeScript(script, {
              timeoutMs: 30000,
              parallel: true,
              partId: execOpts?.partId,
              importedModels: execOpts?.importedModels,
              ...(anchor === null || typeof anchor === 'string' ? { rollbackAnchor: anchor } : {}),
            });
          },
        });
      } catch (err) {
        console.error('[App] assembly run failed', err);
        return false;
      }
      if (gen !== refreshGenRef.current) return false;

      const runs = { ...(other.runs || {}) };
      for (const [def, run] of Object.entries(keptByDef)) assignDefRun(runs, def, run);
      let activeRan = false;
      if (willBuildActive && activeDecision && activeDecision.action !== 'rebuild') {
        const run = runFromShip(previousPartRun(viewDef, viewId), activeDecision);
        if (run) {
          run.assetKey = assetKeyForDef(viewDef);
          assignDefRun(runs, viewDef, run);
          warmPrimaryMesh(viewDef, activeScriptText, activeDecision);
        }
      } else if (willBuildActive) {
        activeRan = true;
        noteBuild();
        const runOpts = {
          noShadow: true,
          preservePicks: opts.preservePicks === true,
          partId: viewId,
          definitionId: viewDef,
          rollbackAnchor: storedRollback(String(viewId)),
        };
        let run = await viewportRef.current?.executeScript(scripts[viewId], runOpts);
        if (run == null || run === false) {
          await new Promise((resolve) => { setTimeout(resolve, 200); });
          if (gen !== refreshGenRef.current) return false;
          run = await viewportRef.current?.executeScript(scripts[viewId], runOpts);
        }
        if (gen !== refreshGenRef.current) return false;
        if (run?.cleared) {
          runs[viewId] = { ok: false, mesh: null, empty: true, error: null };
        } else if (run?.ok && run.mesh?.vertProperties) {
          const geom = geometryFromExecuteResult(run);
          const bodyCount = geom.bodyCount != null
            ? geom.bodyCount
            : (Array.isArray(run.bodyCentroids) ? run.bodyCentroids.length : undefined);
          const built = {
            ok: true,
            mesh: run.mesh,
            error: null,
            bodyCount,
            volume: geom.volume,
            bbox: geom.bbox,
            assetKey: assetKeyForDef(viewDef),
            ...shipFieldsFromResult(run),
          };
          assignDefRun(runs, viewDef, built);
          if (built.meshKey) {
            primaryHoldsRef.current = { meshKey: built.meshKey, defId: String(viewDef) };
          }
        } else if (run && run.ok === false) {
          const crash = runFailureRef.current?.crash;
          runs[viewId] = {
            ok: false,
            mesh: null,
            error: run.error || 'Script failed',
            ...(crash && typeof crash === 'object' ? { crash } : {}),
          };
          manifoldContext.clearResult().catch(() => {});
        }
      } else if (viewId) {
        runs[viewId] = {
          ok: false,
          mesh: null,
          skipped: !activeVisible,
          missing: typeof scripts[viewId] !== 'string',
          error: typeof scripts[viewId] === 'string' ? null : 'missing',
        };
      }
      for (const part of doc.parts) {
        const run = runs[part.id];
        if (run?.ok && run.assetKey == null) run.assetKey = assetKeyForDef(partDefinitionId(part));
      }

      if (gen !== refreshGenRef.current) return false;
      // Every row of the active definition shows the run that just finished.
      const fanned = fanOutInstanceRuns(runs, doc, viewId);
      // Hidden rows were not re-run. Keep their last solid so the parts-list
      // thumbnail stays; composeViewportParts still leaves them out of the view.
      const keptRuns = preserveHiddenPartRuns(doc, fanned, partRunsRef.current);
      if (
        willBuildActive
        && activeDecision
        && activeDecision.action !== 'rebuild'
        && keptRuns[viewId]?.ok === true
      ) {
        // The mesh stayed on the page, so the viewport does not emit a run
        // outcome. The agent still needs this refresh to count as finished.
        handleRunOutcome({ ok: true, script: activeScriptText });
      }
      for (const [id, run] of Object.entries(keptRuns)) {
        if (run?.ok && run.mesh?.vertProperties) partLeftoversRef.current[id] = run.mesh;
      }
      commitPartRuns(keptRuns);
      let placed = doc;
      if (!assemblyOpenLockRef.current && Array.isArray(doc.joints) && doc.joints.length) {
        let catalogs = {};
        try {
          catalogs = catalogsFromRuns({
            parts: doc.parts,
            runs: keptRuns,
            leftovers: partLeftoversRef.current,
            scripts,
          });
        } catch (err) {
          console.warn('[App] joint re-resolve failed', err?.message || err);
        }
        jointCatalogsRef.current = catalogs;
        const refreshed = refreshAssemblyJoints({ doc, catalogs });
        jointLiveRef.current = { statuses: refreshed.statuses, messages: refreshed.messages };
        setJointLive(jointLiveRef.current);
        if (refreshed.changed) placed = rememberAssembly(refreshed.doc);
      }
      const solids = composeViewportParts(placed, keptRuns);
      const leftovers = leftoverPickSolids(placed, keptRuns, partLeftoversRef.current);
      const activeOk = !!(viewId && keptRuns[viewId]?.ok === true && activeVisible);
      viewportRef.current?.placeAssembly?.({
        solids,
        leftovers,
        activeId: viewId,
        blankActive: !activeOk,
        // Red outline in the viewer, same rule as the Parts feed's red row.
        failedIds: failedPartIdsFor(doc, keptRuns),
      });
      const runTiming = activeRan && typeof window !== 'undefined' ? window.__SURFCAD_RUN_TIMING : null;
      const placeUpload = typeof window !== 'undefined' ? window.__SURFCAD_PLACE_UPLOAD_MS : null;
      const assemblyTiming = {
        seq: (typeof window !== 'undefined' ? (window.__SURFCAD_ASSEMBLY_TIMING?.seq || 0) : 0) + 1,
        totalMs: Math.round((performance.now() - tAssembly) * 10) / 10,
        active: viewId ? String(viewId) : null,
        parts: shipNotes,
        kernelMs: runTiming?.workerExecMs ?? (activeRan ? null : 0),
        transferMs: runTiming?.transferMs ?? (activeRan ? null : 0),
        indexMs: runTiming
          ? Math.round(((runTiming.faceGraphMs || 0) + (runTiming.edgeGraphMs || 0)) * 10) / 10
          : 0,
        uploadMs: Math.round((((runTiming?.uploadMs) || 0) + (placeUpload || 0)) * 10) / 10,
      };
      if (typeof window !== 'undefined') window.__SURFCAD_ASSEMBLY_TIMING = assemblyTiming;
      if (meshTimingOn()) console.info('[mesh] assembly', assemblyTiming);
    return true;
  };
  refreshAssemblyRef.current = refreshAssembly;

  /**
   * Drop a worker run that already started (the seed auto-run, or the part
   * we are leaving). A generation bump only discards its result; the thread
   * keeps chewing and the open's script queues behind it, so the spinner
   * stays up after the rest of the UI is on screen.
   */
  const preemptInflightAssemblyRun = async () => {
    const worker = manifoldContext?.worker;
    if (!worker || typeof worker.preemptInflight !== 'function') return;
    try {
      await worker.preemptInflight();
    } catch (err) {
      console.warn('[App] Could not preempt in-flight part run', err?.message || err);
    }
  };

  const finishOpenedPart = async (saved, scripts, progress) => {
    const opened = { ...(scripts || {}) };
    for (const [id, text] of Object.entries(opened)) {
      if (typeof text !== 'string') continue;
      const repaired = repairScriptReturns(text);
      if (!repaired.changed) continue;
      opened[id] = repaired.buffer;
      const names = repaired.moved.length ? repaired.moved.join(', ') : 'duplicate return';
      console.warn(`[App] Moved feature blocks above return part in ${id}: ${names}`);
      try { await savePartScript(id, repaired.buffer); } catch { /* keep the healed copy in memory */ }
    }
    if (partScriptsRef.current) {
      partScriptsRef.current = { ...partScriptsRef.current, ...opened };
      setPartScripts((prev) => ({ ...(prev || {}), ...opened }));
    }
    clearRollbackAnchors();
    try {
      const ids = (saved?.parts || []).map((part) => part.id);
      const loaded = await loadPartAssets(ids);
      const next = {};
      for (const id of ids) {
        const row = loaded[String(id)];
        if (!row?.assets || typeof row.assets !== 'object' || Array.isArray(row.assets)) continue;
        if (!Object.keys(row.assets).length) continue;
        next[String(id)] = { assets: row.assets, meshSynced: row.meshSynced === true };
        rememberPartAssets(id, row.assets);
      }
      partMeshMetaRef.current = next;
      setPartMeshMeta(next);
    } catch (err) {
      console.warn('[App] Mesh asset hydrate failed:', err?.message || err);
    }
    const active = saved?.parts?.find((part) => part.id === saved.activeId) || saved?.parts?.[0];
    if (!active) return;
    setCurrentFilename(active.name);
    const picked = scriptForRow(saved, opened, active.id);
    if (picked.ok) setCurrentScript(picked.script);
    else setCurrentScript('// This part has no file yet.\n');
    focusPartHistory(active.id, picked.ok ? picked.script : '');
    // Opening an assembly lands in assembly mode: no part is selected, the
    // title is the assembly name, and the ribbon shows the joints. A part is
    // selected by a row tap, a body tap, or an agent set_active_part.
    await applyAssemblyOpenHold();
    const report = typeof progress === 'function' ? progress : null;
    assemblyOpenProgressRef.current = report;
    try {
      // Kill a superseded run before this build posts, or it sits in front
      // of the script the spinner is waiting on.
      await preemptInflightAssemblyRun();
      const note = '// This part has no file yet.\n';
      const script = picked.ok ? picked.script : undefined;
      if (picked.ok) {
        suppressPartSaveRef.current = false;
        if (codeEditorRef.current?.setTextOnly) codeEditorRef.current.setTextOnly(picked.script);
        else setEditorInitialScript(picked.script);
      } else {
        suppressPartSaveRef.current = true;
        if (codeEditorRef.current?.setTextOnly) codeEditorRef.current.setTextOnly(note);
        else setEditorInitialScript(note);
      }
      // This open's own build. Not the editor's 100ms auto-run: that one is
      // dropped when the generation changes, and the spinner used to wait
      // on a refresh that never started.
      const before = refreshGenRef.current;
      const ok = await refreshAssemblyRef.current?.(script, { persistActive: false });
      const superseded = refreshGenRef.current > before + 1;
      if (ok === false && !superseded) {
        const err = new Error(`Could not open ${saved?.name || 'assembly'}`);
        err.assemblyOpen = true;
        throw err;
      }
    } finally {
      if (assemblyOpenProgressRef.current === report) assemblyOpenProgressRef.current = null;
    }
    captureAgentScriptSnapshot();
  };
  finishOpenedPartRef.current = finishOpenedPart;

  const meshForPart = (id) => {
    const run = partRunsRef.current?.[id];
    if (run?.ok && run.mesh?.vertProperties) return run.mesh;
    const leftover = partLeftoversRef.current?.[id];
    if (leftover?.vertProperties) return leftover;
    return null;
  };

  const handleSelectPart = (id, opts = {}) => {
    const doc = assemblyRef.current;
    if (!doc || id == null) return;
    adoptCadRollback(id);
    setJointCard(null);
    jointPicksRef.current = [];
    rememberCadPart(id);
    const partNow = doc.parts.find((row) => row.id === id);
    if (id === doc.activeId) {
      // The title may still show a part picked in the viewer; bring it back.
      setCurrentFilename(partNow?.name || null);
      // A face or edge pick can show another part's mesh while Monaco stays
      // here. Clicking this row brings that mesh back.
      const mesh = meshForPart(id);
      if (mesh?.vertProperties) {
        viewportRef.current?.swapPickPart?.({
          partId: id,
          mesh,
          position: partPosition(partNow) || [0, 0, 0],
          placement: placementForMesh(partNow),
        });
      }
      if (!opts.keepPicks || opts.bodyHighlight) viewportRef.current?.showCadBodyHighlight?.();
      return;
    }
    const live = codeEditorRef.current?.getContent?.();
    const prev = doc.activeId;
    if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
      const nextScripts = { ...partScriptsRef.current, [prev]: live };
      rememberScripts(nextScripts);
      savePartScript(prev, live);
      stashPartHistory(prev, live);
    }
    // Invalidate pending autosave: it still closes over the previous buffer.
    partSaveEpochRef.current += 1;
    // Drop an in-flight refresh of the part we are leaving so it cannot
    // paint that solid back over the one we are about to show.
    refreshGenRef.current += 1;
    const nextDoc = rememberAssembly({ ...doc, activeId: id });
    const part = nextDoc.parts.find((row) => row.id === id);
    setCurrentFilename(part?.name || null);
    const picked = scriptForRow(nextDoc, partScriptsRef.current, id);
    const nextScript = picked.ok ? picked.script : '';
    focusPartHistory(id, nextScript);
    const cachedMesh = meshForPart(id);
    if (!opts.keepPicks && cachedMesh?.vertProperties) {
      // Same swap a viewport pick makes: the part we are leaving is parked
      // as an assembly mesh right now and the picked part's copy is removed,
      // so both stay on screen while the assembly rebuilds behind the
      // switch. adoptActiveSolid alone left the previous part out of the
      // scene until that rebuild placed it again, which on a heavy assembly
      // is seconds (the bike: the Fork vanished when the wheel was picked).
      viewportRef.current?.swapPickPart?.({
        partId: id,
        mesh: cachedMesh,
        position: partPosition(part) || [0, 0, 0],
        placement: placementForMesh(part),
      });
    }
    if (opts.keepPicks) {
      if (picked.ok) {
        suppressPartSaveRef.current = false;
        codeEditorRef.current?.setTextOnly?.(picked.script);
        setCurrentScript(picked.script);
        saveEditorDraft({
          script: picked.script,
          filename: part?.name || null,
          partId: id,
        });
      }
      if (opts.bodyHighlight) viewportRef.current?.showCadBodyHighlight?.();
      return;
    }
    if (picked.ok) {
      suppressPartSaveRef.current = false;
      codeEditorRef.current?.loadContent(picked.script, part?.name || 'Part', false);
      saveEditorDraft({
        script: picked.script,
        filename: part?.name || null,
        partId: id,
      });
      viewportRef.current?.showCadBodyHighlight?.();
      return;
    }
    suppressPartSaveRef.current = true;
    const note = '// This part has no file yet.\n';
    codeEditorRef.current?.setTextOnly?.(note);
    setCurrentScript(note);
    refreshAssemblyRef.current?.(undefined, { persistActive: false });
  };

  const handlePickRetarget = ({ partId, syncScript = false, kind = 'face' } = {}) => {
    if (!partId || !assemblyRef.current) return false;
    if (shouldArmJointPick({
      featureSession: featureSessionRef.current,
      appMode: appModeRef.current,
      kind,
      jointPicking: (jointCardRef.current?.mode === 'create' || jointCardRef.current?.mode === 'edit')
        && appModeRef.current !== 'game'
        && !featureSessionRef.current,
    })) {
      const part = assemblyRef.current.parts.find((row) => row.id === partId);
      const mesh = meshForPart(partId);
      if (mesh?.vertProperties) {
        viewportRef.current?.swapPickPart?.({
          partId,
          mesh,
          position: partPosition(part) || [0, 0, 0],
          placement: placementForMesh(part),
        });
      }
      rememberCadPart(null);
      return true;
    }
    rememberCadPart(partId);
    const part = assemblyRef.current.parts.find((row) => row.id === partId);
    if (part?.name) setCurrentFilename(part.name);
    if (syncScript) {
      handleSelectPart(partId, {
        keepPicks: true,
        bodyHighlight: kind === 'body',
      });
      return true;
    }
    const mesh = meshForPart(partId);
    if (mesh?.vertProperties) {
      viewportRef.current?.swapPickPart?.({
        partId,
        mesh,
        position: partPosition(part) || [0, 0, 0],
        placement: placementForMesh(part),
      });
    }
    return true;
  };

  /** A palette tap opens a Block sheet or feature mode: edit the picked part.
   * One card: the edit card closes and writes nothing. */
  const handleFeatureOpen = () => {
    focusWritePart(null);
    setFeatureSheet((cur) => (cur ? null : cur));
  };

  const agentFeatureSessionActive = () => (
    !!agentFeatureSessionRef.current
    || !!agentFeatureTargetRef.current
    || !!featureSheetRef.current
    || agentHostRef.current?.agentReadHoleEdit?.()?.open
    || agentHostRef.current?.agentReadFeatureEdit?.()?.open
  );

  /**
   * Close the agent's feature session. `cancel` is the card's X (a previewed
   * edit re-runs its script). `settle` follows a confirm that already wrote
   * through mutate: restore only when the buffer is unchanged. `drop` closes
   * with no run because the caller is about to write and run the script.
   */
  const dismissAgentFeatureSession = ({ mode = 'cancel' } = {}) => {
    const host = agentHostRef.current;
    if (mode === 'settle') host?.agentSettleFeatureEdit?.();
    else if (mode === 'drop') host?.agentDismissFeatureEdit?.();
    else host?.agentCancelFeatureEdit?.();
    host?.agentCancelHoleEdit?.();
    closeFeatureSheet();
    setFeatureStripActiveId(null);
    agentFeatureDraftRef.current = null;
    agentFeatureTargetRef.current = null;
    agentFeatureSessionRef.current = null;
  };

  /**
   * delete_feature: resolve the block (id / index, else the open edit), refuse
   * the base feature without `confirm: true`, and hand the bridge the buffer
   * to write through `mutate`, so the part runs and `status` / `errors` are
   * current when the command resolves. The open edit is closed first; the
   * old path returned before the run, so status stayed on the previous
   * script.
   */
  const prepareAgentFeatureDelete = (args = {}) => {
    if (assemblyOpenLockRef.current) {
      return {
        error: {
          code: 'delete_failed',
          message: 'An assembly is opening — delete the feature again once it finishes.',
        },
      };
    }
    // The active part, or args.part_id. A face pick must not retarget this:
    // focusWritePart(null) would load the picked part and index 0 would be
    // that part's first feature.
    if (appModeRef.current !== 'game') {
      const target = featureDeleteTarget(assemblyRef.current, args);
      if (target.error) return { error: target.error };
      if (target.load && !focusWritePart(target.id)) {
        return { error: { code: 'no_write_part', message: 'No writable part for feature delete' } };
      }
    }
    const buf = codeEditorRef.current?.getContent?.() ?? '';
    let feature = null;
    let openEdit = null;
    if (args?.id == null && args?.index == null) {
      const vpEdit = agentHostRef.current?.agentReadFeatureEdit?.();
      const sheet = featureSheetRef.current;
      if (vpEdit?.open && vpEdit.feature) {
        feature = vpEdit.feature;
        openEdit = 'viewport';
      } else if (sheet?.mode === 'edit' && sheet.feature) {
        feature = sheet.feature;
        openEdit = 'sheet';
      } else {
        return { error: { code: 'bad_args', message: 'delete_feature needs id or index when no edit is open' } };
      }
    } else {
      const resolved = resolveStripTarget(buf, args);
      if (resolved.error) return resolved;
      feature = resolved.feature;
    }
    const live = liveSheetFeature(buf, feature);
    if (!live) return { error: { code: 'delete_failed', message: STALE_FEATURE_MSG } };
    const label = live.chipLabel || live.label || live.kind || 'feature';
    const base = partDeclarationDeletePlan(buf, live);
    if (base && args?.confirm !== true) {
      const who = base.count > 0
        ? `${base.count} later feature${base.count === 1 ? ' still uses' : 's still use'} part and will fail`
        : 'later code still uses part and will fail';
      return {
        error: {
          code: 'confirm_required',
          message: `${label} declares part; ${who}. Pass confirm: true to delete it anyway.`,
          details: { featureId: live.id, dependents: base.count },
        },
      };
    }
    const result = deleteFeatureEdit(buf, live);
    if (!result.ok) return { error: { code: 'delete_failed', message: result.message } };
    if (openEdit === 'viewport') agentHostRef.current?.agentDismissFeatureEdit?.();
    setFeatureSheet(null);
    setFeatureStripActiveId(null);
    agentFeatureDraftRef.current = null;
    agentFeatureTargetRef.current = null;
    return {
      source: result.buffer,
      message: `Delete ${label}`,
      featureId: live.id,
      warning: base
        ? `${label} declared part; ${base.count > 0 ? `${base.count} later feature${base.count === 1 ? ' uses' : 's use'}` : 'later code uses'} part and will fail until you fix or undo.`
        : null,
    };
  };
  const prepareAgentFeatureConfirm = () => {
    if (assemblyOpenLockRef.current) {
      return {
        error: {
          code: 'edit_failed',
          message: 'An assembly is opening — confirm the edit again once it finishes.',
        },
      };
    }
    if (!focusWritePart(null)) {
      return { error: { code: 'no_write_part', message: 'No writable part for feature confirm' } };
    }
    const draft = agentFeatureDraftRef.current || {};
    const buf = codeEditorRef.current?.getContent?.() ?? '';

    if (agentHostRef.current?.agentReadHoleEdit?.()?.open) {
      const holePayload = agentHostRef.current?.agentHoleConfirmPayload?.();
      if (holePayload?.error) return holePayload;
      const result = composeHoleOnContour(buf, {
        featureId: holePayload.featureId,
        spec: holePayload.spec,
      });
      if (!result.ok) return { error: { code: 'edit_failed', message: result.message } };
      const changed = !(result.empty || result.changed === false || result.buffer === buf);
      return {
        changed,
        source: changed ? result.buffer : buf,
        featureId: holePayload.featureId,
        kind: 'hole',
        message: 'Hole',
      };
    }

    const vpEdit = agentHostRef.current?.agentReadFeatureEdit?.();
    if (vpEdit?.open && vpEdit.feature) {
      const live = liveSheetFeature(buf, vpEdit.feature) || vpEdit.feature;
      const result = confirmFeatureEdit(buf, live, { fields: { ...(vpEdit.fields || {}), ...draft } });
      if (!result.ok) return { error: { code: 'edit_failed', message: result.message } };
      return {
        changed: !!result.changed,
        source: result.changed ? result.buffer : buf,
        featureId: live.id,
        kind: live.kind || null,
        message: `Edit ${live.label || live.kind || 'feature'}`,
      };
    }

    const sheet = featureSheetRef.current;
    if (sheet?.mode === 'edit' && sheet.feature) {
      const live = liveSheetFeature(buf, sheet.feature);
      if (!live) return { error: { code: 'edit_failed', message: STALE_FEATURE_MSG } };
      const result = writeFeatureSheetParams(buf, live, draft);
      if (!result.ok) return { error: { code: 'edit_failed', message: result.message } };
      const changed = result.buffer !== buf;
      return {
        changed,
        source: result.buffer,
        featureId: live.id,
        kind: live.kind || null,
        message: `${live.label || 'Feature'} sheet`,
      };
    }

    const target = agentFeatureTargetRef.current;
    if (target) {
      const live = liveSheetFeature(buf, target) || target;
      const result = confirmFeatureEdit(buf, live, { fields: draft });
      if (!result.ok) return { error: { code: 'edit_failed', message: result.message } };
      return {
        changed: !!result.changed,
        source: result.changed ? result.buffer : buf,
        featureId: live.id,
        kind: live.kind || null,
        message: `Edit ${live.label || live.kind || 'feature'}`,
      };
    }

    return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
  };

  const handleFeatureSession = (active) => {
    const on = !!active;
    // Opening a feature on a picked part edits that part from the start, so
    // its buffer, commit mode and Undo stack are the ones the feature sees.
    if (on && !featureSessionRef.current) focusWritePart(null);
    // One card. A tool (contour, fillet, …) cancels the edit card
    // without writing. The tool's own X / Confirm is the card that stays.
    if (on) {
      setFeatureSheet((cur) => (cur ? null : cur));
      setJointCard(null);
      jointPicksRef.current = [];
    }
    featureSessionRef.current = on;
    setFeatureSession((prev) => (prev === on ? prev : on));
  };

  const handleSketchStrip = (payload) => {
    setSketchStrip((prev) => (payload == null && prev == null ? prev : payload));
  };
  const handleSheetStrip = (payload) => {
    setSheetStrip((prev) => {
      if (payload == null) return prev == null ? prev : null;
      const items = payload.items || [];
      const prevItems = prev?.items || [];
      const same = prev
        && prev.activeId === payload.activeId
        && prevItems.length === items.length
        && prevItems.every((item, i) => (
          item.id === items[i].id && item.kind === items[i].kind && item.chipLabel === items[i].chipLabel
        ));
      return same ? prev : payload;
    });
  };
  const onSketchUndo = () => viewportRef.current?.undoContourSketch?.();
  const onSketchSelect = (chip) => viewportRef.current?.selectSketchEntity?.(chip);
  const onSheetSelect = (chip) => {
    if (chip?.id) setFeatureStripActiveId(chip.id);
    viewportRef.current?.selectSheetChip?.(chip);
  };

  /**
   * Load the part a feature acts on into the editor before it writes, opens
   * a feature sheet or undoes. A face / edge pick on part B moves the viewer
   * (and the Block preview anchor) to B but leaves the editor on A; every
   * writer writes the editor buffer, so without this a Block confirmed on B
   * landed in A, the strip showed B, and B's sheet Delete hit A's offsets
   * ("invalid range"). Target: the viewport's part for this payload, else the
   * picked part (featureWriteTarget). Loading keeps the picks and focuses that
   * part's own Undo stack. Returns false when that part cannot be loaded.
   */
  const focusWritePart = (payloadPartId = null) => {
    const doc = assemblyRef.current;
    if (!doc || appModeRef.current === 'game') return true;
    const target = featureWriteTarget(doc, { pickedId: cadPartIdRef.current, payloadPartId });
    if (!target.load) return true;
    if (!scriptForRow(doc, partScriptsRef.current, target.id).ok) return false;
    handleSelectPart(target.id, { keepPicks: true });
    return assemblyRef.current?.activeId === target.id;
  };
  focusWritePartRef.current = focusWritePart;
  const PICKED_PART_FAIL = 'Could not open the picked part in the editor — try again.';

  syncCadScriptRef.current = () => {
    const id = cadPartIdRef.current;
    const doc = assemblyRef.current;
    if (!id || !doc || id === doc.activeId) return;
    handleSelectPart(id);
  };

  const handleTogglePartVisible = (id) => {
    const doc = assemblyRef.current;
    if (!doc) return;
    const part = doc.parts.find((row) => row.id === id);
    const next = setPartVisible(doc, id, part?.visible === false);
    rememberAssembly(next);
    const live = codeEditorRef.current?.getContent?.();
    refreshAssemblyRef.current?.(live, {
      persistActive: !suppressPartSaveRef.current,
      preservePicks: featureSessionRef.current,
    });
  };

  const handleReorderParts = (from, to) => {
    if (!assemblyRef.current) return;
    rememberAssembly(reorderParts(assemblyRef.current, from, to));
  };

  const handleLoadAssembly = async (text, filename) => {
    let doc;
    let raw;
    try {
      raw = typeof text === 'string' ? JSON.parse(text) : text;
      doc = parseAssemblyDocument(raw);
    } catch (err) {
      setUploadError(err.message || 'Could not read assembly');
      return;
    }
    const loadedName = assemblyNameForImport(raw, filename, await collectTakenAssemblyNames());
    if (loadedName !== doc.name) doc = serializeAssembly({ ...doc, name: loadedName });
    const migratedIds = migrateLocalPartIds({ doc });
    if (migratedIds.changed) doc = migratedIds.doc;
    try {
      await openAssemblyTrackedRef.current({
        doc,
        total: doc.parts.length,
        retry: () => { void handleLoadAssembly(text, filename); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const scripts = await loadScriptsForParts(doc.parts, {
            onProgress: (update) => progress({ ...update, name: doc.name }),
          });
          if (!signal()) return;
          rememberScripts(scripts);
          const saved = rememberAssembly(doc);
          const keep = historyKeepKeys(saved.parts);
          for (const key of Object.keys(partHistoriesRef.current)) {
            if (key !== '__game__' && !keep.has(key)) delete partHistoriesRef.current[key];
          }
          await finishOpenedPartRef.current(saved, scripts, progress);
        },
      });
    } catch (err) {
      console.warn('[App] Open assembly failed:', err?.message || err);
    }
  };

  const handleResolvePartFile = async (id, text) => {
    if (!id || typeof text !== 'string') return;
    await savePartScript(id, text);
    const scripts = { ...partScriptsRef.current, [id]: text };
    rememberScripts(scripts);
    suppressPartSaveRef.current = false;
    storeRollbackAnchor(String(id), undefined);
    if (assemblyRef.current?.activeId === id) {
      codeEditorRef.current?.loadContent(text, 'Part file', false);
      return;
    }
    refreshAssemblyRef.current?.(codeEditorRef.current?.getContent?.());
  };

  const rememberGitBaseline = (baseline) => {
    gitBaselineRef.current = baseline;
    setGitBaseline(baseline);
  };

  /** After a mesh commit lands, store the vault sha and clear the badge. */
  const applyMeshMarks = async (marks) => {
    if (!marks?.length) return;
    const nextMeta = { ...partMeshMetaRef.current };
    for (const mark of marks) {
      const id = mark?.partId;
      const name = mark?.assetName;
      const sha = mark?.sha;
      if (!id || !name || !sha) continue;
      const assets = { [name]: sha };
      const text = partScriptsRef.current[id];
      if (typeof text === 'string') {
        await savePartScript(id, text, { assets, meshSynced: true });
      }
      rememberPartAssets(id, assets);
      nextMeta[id] = { assets, meshSynced: true };
    }
    partMeshMetaRef.current = nextMeta;
    setPartMeshMeta(nextMeta);
  };

  const rememberGitBehind = (check, { showToast = true, resetResolved = true } = {}) => {
    gitBehindRef.current = check;
    setGitBehind(check);
    if (resetResolved) {
      gitBehindResolvedRef.current = [];
      setGitBehindResolved([]);
    }
    if (check && check.behindBy > 0) {
      if (showToast) {
        setGitBehindToast({
          message: behindToastMessage({ behindBy: check.behindBy }),
          behindBy: check.behindBy,
        });
      }
    } else {
      setGitBehindToast(null);
    }
  };

  const markBehindResolved = (path) => {
    if (!path) return;
    const next = gitBehindResolvedRef.current.includes(path)
      ? gitBehindResolvedRef.current
      : [...gitBehindResolvedRef.current, path];
    gitBehindResolvedRef.current = next;
    setGitBehindResolved(next);
    const markers = remainingBehindMarkers(gitBehindRef.current, next);
    if (!markers.any) setGitBehindToast(null);
  };

  /** G4: compare baseline head to main; show toast + markers when behind. */
  const checkGitRemoteBehind = async ({ showToast = true, reason = 'manual' } = {}) => {
    const doc = assemblyRef.current;
    const baseline = gitBaselineRef.current;
    if (!doc || doc.source !== 'git') return null;
    if (isV2PlanSaveDoc(doc)) {
      const gen = ++gitCheckGenRef.current;
      try {
        const vault = await ensureGitVault({ create: false });
        const store = gitSync();
        const branch = gitWorkingBranch();
        const moved = await mainMovedPlanSavePaths({
          adapter: gitAdapterRef.current,
          repo: vault.repo,
          branch,
          store,
          assemblyId: doc.id,
        });
        if (gen !== gitCheckGenRef.current) return null;
        rememberGitBehind(null, { showToast: false, resetResolved: true });
        setGitBehindToast(null);
        if (!moved.paths.length && !moved.truncated) {
          setPlanSaveConflict(null);
          return null;
        }
        const conflict = {
          model: 'v2',
          status: 'conflict',
          conflict: true,
          paths: moved.paths,
          truncated: moved.truncated === true,
          error: SAVE_CONFLICT_COPY,
          message: SAVE_CONFLICT_COPY,
        };
        if (showToast) setPlanSaveConflict(conflict);
        return conflict;
      } catch (err) {
        console.warn('[git] behind check failed', reason, err);
        return null;
      }
    }
    if (!baseline?.headSha) return null;
    const gen = ++gitCheckGenRef.current;
    try {
      const vault = await ensureGitVault({ create: false });
      const asmPath = baseline.assemblyPath
        || assemblyFilePath(vaultSegment(doc.name) || doc.name);
      const check = await checkRemoteBehind(gitAdapterRef.current, vault.repo, {
        branch: baseline.branch || vault.defaultBranch || 'main',
        baselineSha: baseline.headSha,
        assemblyPath: asmPath,
        partIds: (doc.parts || []).map((p) => p.id),
      });
      if (gen !== gitCheckGenRef.current) return null; // stale
      // Preserve already-resolved paths across focus rechecks of the same remote tip.
      const sameTip = gitBehindRef.current?.remoteSha === check.remoteSha;
      rememberGitBehind(check, {
        showToast: showToast && check.behindBy > 0,
        resetResolved: !sameTip,
      });
      return check;
    } catch (err) {
      console.warn('[git] behind check failed', reason, err);
      return null;
    }
  };

  /**
   * G7: real adapter when a browser token is present; otherwise the mock
   * (goldens / offline). Switching Connect resets the vault handle so the
   * next Open uses the new adapter.
   */
  const ensureGitAdapter = () => {
    const token = loadGithubToken();
    const wantReal = !!token;
    const have = gitAdapterRef.current;
    const haveReal = have?.kind === 'real';
    if (!have || wantReal !== haveReal || gitTokenRef.current !== token) {
      gitTokenRef.current = token;
      // Every adapter call and, on the real adapter, every HTTP request is
      // counted (git_timings, window.__SURFCAD_GIT_TIMINGS).
      gitAdapterRef.current = gitTimings.wrapAdapter(wantReal
        ? createGithubAdapter({ token, fetchImpl: gitTimings.wrapFetch(globalThis.fetch) })
        : createMockGithubAdapter({ login: 'local-user', persist: true }));
      gitVaultRef.current = null; // vault belongs to the previous adapter
    }
    return gitAdapterRef.current;
  };

  const handleGitConnect = () => {
    const clientId = githubClientId || resolveGithubClientId();
    if (!clientId) return;
    const state = createOAuthState();
    const url = buildAuthorizeUrl({
      clientId,
      redirectUri: githubRedirectUri(),
      state,
    });
    if (url) window.location.assign(url);
  };

  const handleGitDisconnect = () => {
    clearGithubToken();
    gitSession.markNeedsReauth();
    setGithubConnected(false);
    gitAdapterRef.current = null;
    gitVaultRef.current = null;
    // G10: leaving GitHub drops vault chrome; IndexedDB keeps working as local autosave.
    const doc = assemblyRef.current;
    if (doc?.source === 'git') {
      rememberAssembly({ ...doc, source: 'local' });
      rememberGitBaseline(null);
      rememberGitBehind(null, { showToast: false, resetResolved: true });
      setGitBehindToast(null);
    }
  };

  const storedVaultName = () => (
    isAuthenticated ? storedVaultNameFromUser(user) : null
  );

  /** Move queued `owner/surfcad` rows onto the resolved repo, then remember the name. */
  const noteResolvedVault = async (vaultRepo) => {
    if (!vaultRepo?.owner || !vaultRepo?.name) return;
    try {
      await gitSync().rekeyRepo(
        { owner: vaultRepo.owner, name: LEGACY_VAULT_NAME },
        vaultRepo,
      );
    } catch (err) {
      console.warn('[git] vault rekey failed', err?.message || err);
    }
    if (!isAuthenticated || vaultRepo.name === storedVaultName()) return;
    const token = loadGithubToken();
    if (!token) return;
    try {
      await fetch('/api/auth/vault-name', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ vaultName: vaultRepo.name, access_token: token }),
      });
    } catch (err) {
      console.warn('[git] vault name write-back failed', err?.message || err);
    }
  };

  /** Look up the vault. Repo creation is opt-in (`create: true`) — Save / Add to repo / Save on new branch only. */
  const ensureGitVault = async ({ create = false } = {}) => {
    const fresh = await refreshGithubAccessToken();
    if (fresh.refreshed || (fresh.ok && fresh.accessToken && fresh.accessToken !== gitTokenRef.current)) {
      gitAdapterRef.current = null;
      gitVaultRef.current = null;
      gitTokenRef.current = '';
    }
    ensureGitAdapter();
    if (gitVaultRef.current) return gitVaultRef.current;
    const VAULT_TIMEOUT_MS = 45000;
    const result = await Promise.race([
      findOrCreateVault(gitAdapterRef.current, {
        storedName: storedVaultName()
          || (gitAdapterRef.current?.kind === 'mock' ? peekMockVaultName() : null),
        create,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(
          'Repo lookup timed out — check network / GitHub Connect and try again',
        )), VAULT_TIMEOUT_MS);
      }),
    ]);
    if (result.status === 'invalid-name' || result.status === 'not-a-vault' || result.status === 'missing') {
      if (result.status === 'missing' && !create) {
        throw noRepoYetError();
      }
      throw new Error(`Vault unavailable (${result.status})`);
    }
    const vault = {
      repo: result.repo,
      defaultBranch: result.defaultBranch || 'main',
      headSha: result.headSha || null,
      private: result.private !== false,
    };
    await noteResolvedVault(vault.repo);
    gitVaultRef.current = vault;
    return vault;
  };
  ensureGitVaultRef.current = ensureGitVault;

  /**
   * v2 first Save may create the repo through writeVaultCommit. Do not call
   * findOrCreateVault({ create: true }) — that still seeds a README index.
   */
  const resolveVaultForPlanSave = async ({ vaultName } = {}) => {
    if (gitVaultRef.current?.repo && !sanitizeVaultName(vaultName)) {
      return { vault: gitVaultRef.current, create: false };
    }
    const requested = sanitizeVaultName(vaultName);
    if (requested && !gitVaultRef.current?.repo) {
      const adapter = ensureGitAdapter();
      const { login } = await adapter.getViewer();
      return {
        vault: {
          repo: { owner: login, name: requested },
          defaultBranch: 'main',
          headSha: null,
          private: true,
        },
        create: true,
      };
    }
    try {
      const vault = await ensureGitVault({ create: false });
      return { vault, create: false };
    } catch (err) {
      if (err?.message !== NO_REPO_YET_COPY && err?.code !== NO_REPO_YET_CODE) throw err;
      const adapter = ensureGitAdapter();
      const { login } = await adapter.getViewer();
      const name = requested
        || storedVaultName()
        || (adapter?.kind === 'mock' ? peekMockVaultName() : null)
        || DEFAULT_VAULT_NAME;
      return {
        vault: {
          repo: { owner: login, name },
          defaultBranch: 'main',
          headSha: null,
          private: true,
        },
        create: true,
      };
    }
  };

  /** Branch the working copy is on (baseline), else the vault default. */
  const gitWorkingBranch = () => {
    const baseline = gitBaselineRef.current;
    const vault = gitVaultRef.current;
    return baseline?.branch || vault?.defaultBranch || 'main';
  };

  /**
   * Store copy of the assembly being opened. Sync, so the blank screen can
   * start before a vault read. Never the assembly already on screen.
   */
  const peekStoredAssemblySurf = (targetId, folderName) => {
    try {
      const repo = gitVaultRef.current?.repo;
      if (!repo) return null;
      const store = gitSync();
      if (targetId && isV2SurfId(targetId)) {
        return store.getAssembly(repo, assemblyIdPath(targetId)) || null;
      }
      if (folderName && !isSurfId(folderName)) {
        for (const path of assemblyFilePathCandidates(folderName)) {
          const text = store.getAssembly(repo, path);
          if (text) return text;
        }
      }
    } catch { /* a store miss stays Untitled until the file read */ }
    return null;
  };

  /**
   * One opener for every assembly load: Open dialog, file import, reload,
   * branch switch, and an id open (agent or any other caller).
   * The label is that assembly's `.surf.json` or store name, never the
   * assembly that is already on screen and never the raw id.
   * The overlay starts from the store copy (or the document being opened).
   * The file read updates the label and does not hold the blank screen back.
   */
  const openAssemblyTracked = async ({
    id = '',
    folder = '',
    branch = '',
    doc = null,
    surf = null,
    adapter = null,
    total = 0,
    retry = null,
    load,
  } = {}) => {
    const targetId = typeof id === 'string' ? id.trim() : '';
    const folderName = typeof folder === 'string' ? folder.trim() : '';
    const storedSurf = surf == null && (targetId || folderName)
      ? peekStoredAssemblySurf(targetId, folderName)
      : null;
    const name = resolveAssemblyOpenName({ id: targetId, doc, surf, storedSurf });
    return runTrackedAssemblyOpen(assemblyOpenCtrlRef.current, {
      name,
      total,
      retry,
      load: async (ctx) => {
        if (surf == null && (targetId || folderName)) {
          void lookupAssemblyOpenName({
            id: targetId,
            doc,
            storedSurf,
            readSurf: async () => {
              try {
                const vault = await ensureGitVault({ create: false });
                const store = gitSync();
                await store.ready();
                const git = adapter || gitAdapterRef.current;
                const ref = branch || gitWorkingBranch();
                let stored = storedSurf;
                if (!stored && targetId) {
                  try { stored = store.getAssembly(vault.repo, assemblyIdPath(targetId)); }
                  catch { stored = null; }
                }
                return await readVaultAssemblySurf(git, vault.repo, {
                  id: targetId,
                  folder: folderName,
                  branch: ref,
                  storedSurf: stored,
                });
              } catch {
                return null;
              }
            },
          }).then((resolved) => {
            if (!ctx.signal()) return;
            ctx.progress({ name: resolved, authoritative: true });
          }).catch(() => {});
        }
        return load(ctx);
      },
    });
  };
  openAssemblyTrackedRef.current = openAssemblyTracked;

  /** True when git Save would be enabled (content ≠ tip, or first-commit chrome). */
  const isGitWorkingCopyDirty = () => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return false;
    if (isV2PlanSaveDoc(doc)) {
      // v2 rows are path-less by design. leftover first-commit (no `path`)
      // would keep Create from switching after a clean Save. Same compare
      // as chrome / `dirty` (AssemblyCommit, not leftover baseline).
      const vault = gitVaultRef.current;
      const branch = gitWorkingBranch();
      const store = gitSync();
      const assemblyCommit = vault?.repo
        ? store.getAssemblyCommit(vault.repo, branch, doc.id)
        : null;
      let liveScript = null;
      if (!suppressPartSaveRef.current) {
        const live = codeEditorRef.current?.getContent?.();
        if (typeof live === 'string') liveScript = live;
      }
      const compared = compareWorkingCopyToCommit({
        doc,
        scripts: partScriptsRef.current,
        liveId: doc.activeId,
        liveScript,
        assemblyCommit,
        pendingSave: !!(vault?.repo && store.getPendingSave(vault.repo, branch)),
        sidecarDirty: sidecarIsDirty(gitSidecarRef.current),
      });
      return compared.unsaved === true || compared.pendingSave === true;
    }
    const baseline = gitBaselineRef.current;
    const parts = doc.parts || [];
    if (sidecarIsDirty(gitSidecarRef.current)) return true;
    if (!baseline) {
      // Path-less rows (stable id, no vault `path` yet) are first-commit dirty.
      return parts.some((p) => !partRepoPath(p));
    }
    let liveScript = null;
    if (!suppressPartSaveRef.current) {
      const live = codeEditorRef.current?.getContent?.();
      if (typeof live === 'string') liveScript = live;
    }
    return isWorkspaceDirty(doc, partScriptsRef.current, baseline, {
      liveId: doc.activeId,
      liveScript,
    });
  };

  const readAgentGitWriteTarget = () => {
    const vault = gitVaultRef.current;
    const repo = vault?.repo
      ? `${vault.repo.owner}/${vault.repo.name}`
      : 'your repo';
    return { repo, branch: gitWorkingBranch() };
  };

  const pumpAgentGitConsent = () => {
    if (agentGitConsentActiveRef.current) return;
    const next = agentGitConsentQueueRef.current.shift();
    if (!next) {
      setAgentGitConsentUi(null);
      return;
    }
    const timer = setTimeout(() => {
      finishAgentGitConsent('timeout');
    }, AGENT_GIT_CONSENT_TIMEOUT_MS);
    agentGitConsentActiveRef.current = { ...next, timer };
    setAgentGitConsentUi({
      command: next.command,
      repo: next.repo,
      branch: next.branch,
    });
  };

  const finishAgentGitConsent = (outcome) => {
    const active = agentGitConsentActiveRef.current;
    if (!active) {
      if (outcome === 'allow' || outcome === 'deny') setAgentGitConsentUi(null);
      return;
    }
    clearTimeout(active.timer);
    agentGitConsentActiveRef.current = null;
    if (outcome === 'allow') {
      agentGitSetSessionAllow();
      active.resolve('allow');
      while (agentGitConsentQueueRef.current.length) {
        agentGitConsentQueueRef.current.shift()?.resolve('allow');
      }
      setAgentGitConsentUi(null);
      return;
    }
    if (outcome === 'deny') {
      agentGitSetSessionDenied();
      active.resolve('deny');
      while (agentGitConsentQueueRef.current.length) {
        agentGitConsentQueueRef.current.shift()?.resolve('deny');
      }
      setAgentGitConsentUi(null);
      return;
    }
    active.resolve('timeout');
    while (agentGitConsentQueueRef.current.length) {
      agentGitConsentQueueRef.current.shift()?.resolve('timeout');
    }
    setAgentGitConsentUi(null);
  };

  /**
   * Show the consent modal and return at once. The bridge call never waits
   * on the user: Allow / Deny land in sessionStorage and the agent retries.
   * -> 'shown' | 'unavailable' (headless / automation)
   */
  const promptAgentGitWriteConsent = ({ command, repo, branch }) => {
    if (!agentGitConsentInteractive()) return 'unavailable';
    if (agentGitConsentActiveRef.current) return 'shown';
    agentGitConsentQueueRef.current.push({ command, repo, branch, resolve: () => {} });
    pumpAgentGitConsent();
    return 'shown';
  };

  const noteRecentAssembly = (name) => {
    const seg = vaultSegment(name);
    if (!seg) return;
    const prev = recentAssembliesRef.current.filter((item) => item !== seg);
    prev.push(seg);
    recentAssembliesRef.current = prev.slice(-12);
  };

  /**
   * Assembly folders a new name must not reuse. Repo tree when GitHub is
   * connected, plus the open baseline and assemblies opened this session.
   * An unsaved local document is not included: New replaces it.
   * `except` drops the assembly being renamed.
   */
  const collectTakenAssemblyNames = async ({ except = '' } = {}) => {
    const local = [];
    if (githubConnected) {
      const baselineName = gitBaselineRef.current?.assemblyName;
      if (baselineName) local.push(baselineName);
      for (const name of recentAssembliesRef.current) local.push(name);
    }
    let tree = [];
    const vault = gitVaultRef.current;
    const adapter = gitAdapterRef.current;
    if (vault?.repo && adapter?.listTree) {
      try {
        tree = await adapter.listTree(vault.repo, gitWorkingBranch()) || [];
      } catch (err) {
        console.warn('[git] assembly names unavailable', err?.message || err);
      }
    }
    return takenAssemblyNames({ tree, local, except });
  };

  const gitSync = () => {
    if (!gitSyncRef.current) gitSyncRef.current = createSyncStore({ persist: true });
    return gitSyncRef.current;
  };

  const persistPendingDeletes = (paths) => {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return gitSidecarRef.current;
    const next = rememberSidecar(recordPendingDeletes(gitSidecarRef.current, list));
    const vault = gitVaultRef.current;
    const doc = assemblyRef.current;
    if (vault?.repo && doc) {
      const store = gitSync();
      const branch = gitWorkingBranch();
      for (const name of sidecarAssemblyKeys(doc, next)) {
        void store.addPendingDeletes(vault.repo, branch, name, list);
      }
    }
    return next;
  };

  const clearWorkingCopySidecar = async () => {
    const prev = gitSidecarRef.current;
    rememberSidecar(emptyWorkingSidecar());
    const vault = gitVaultRef.current;
    if (!vault?.repo) return;
    const store = gitSync();
    const branch = gitWorkingBranch();
    const doc = assemblyRef.current;
    for (const name of sidecarAssemblyKeys(doc, prev)) {
      await store.clearPendingDeletes(vault.repo, branch, name);
    }
  };

  const enqueueGit = (repo, op) => gitSync().enqueue(repo, {
    branch: op?.branch || gitWorkingBranch(),
    ...op,
  });

  const rekeyRuntime = (pairs) => {
    const remap = (map) => {
      const next = { ...(map || {}) };
      for (const { from, to } of pairs) {
        if (from !== to && Object.prototype.hasOwnProperty.call(next, from)) {
          next[to] = next[from];
          delete next[from];
        }
      }
      return next;
    };
    commitPartRuns(remap(partRunsRef.current));
    partLeftoversRef.current = remap(partLeftoversRef.current);
    const histories = remap(partHistoriesRef.current);
    for (const key of Object.keys(partHistoriesRef.current)) delete partHistoriesRef.current[key];
    Object.assign(partHistoriesRef.current, histories);
    for (const { from, to } of pairs) {
      if (cadPartIdRef.current === from) rememberCadPart(to);
    }
  };

  const adoptSyncResult = async (result, { surfaceConflict = true } = {}) => {
    const store = gitSync();
    setPartSync({ ...store.partStates() });
    if (!result) return result;
    if (result.status === 'conflict') {
      // A user Save passes surfaceConflict false and shows the warning toast.
      // Open, reload, and a background flush keep the G13 popup. Never both.
      if (surfaceConflict) setSyncConflict(result);
      return result;
    }
    if (result.partIds?.length && assemblyRef.current && result.status !== 'conflict') {
      const marked = markPartsSynced(assemblyRef.current, result.partIds);
      if (marked.changed) {
        rememberAssembly(marked.doc);
        for (const id of result.partIds) {
          const text = partScriptsRef.current[id];
          if (typeof text === 'string') savePartScript(id, text, { isSynced: true });
        }
      }
    }
    if (result.status === 'failed') {
      if (result.toast) setRenameNotice(result.toast);
      if (result.code === 'not_a_vault' && result.error) setUploadError(result.error);
      return result;
    }
    if (result.status === 'synced') {
      setRenameNotice((prev) => (prev && prev.opId ? null : prev));
      const vault = gitVaultRef.current;
      if (result.promoted && Object.keys(result.promoted).length && assemblyRef.current) {
        const applied = applyIdPromotion(assemblyRef.current, partScriptsRef.current, result.promoted);
        if (applied.changed) {
          rememberScripts(applied.scripts);
          rememberAssembly(applied.doc);
          for (const [path, text] of Object.entries(applied.scripts)) {
            savePartScript(path, text);
          }
        }
      }
      if (result.meshes?.length) await applyMeshMarks(result.meshes);
      if (result.sha && vault?.repo) {
        store.setLastSyncedSha(vault.repo, result.sha, result.branch || gitWorkingBranch());
        const doc = assemblyRef.current;
        const base = gitBaselineRef.current;
        const assetMap = { ...(base?.assets || {}) };
        for (const mark of result.meshes || []) {
          if (mark?.meshPath && mark?.sha) assetMap[mark.meshPath] = mark.sha;
        }
        if (result.assemblyRenameOnly && doc?.source === 'git' && base) {
          rememberGitBaseline(baselineAfterAssemblyRename(base, doc, partScriptsRef.current, {
            headSha: result.sha,
            branch: result.branch || base.branch || gitWorkingBranch(),
          }));
        } else if (result.partRenameOnly && doc?.source === 'git' && base) {
          let next = base;
          for (const rename of result.partRenames || []) {
            next = baselineAfterPartRename(next, {
              from: rename.from,
              to: rename.to,
              name: rename.name,
              surfId: rename.surfId,
              headSha: result.sha,
              branch: result.branch || base.branch || gitWorkingBranch(),
            });
          }
          rememberGitBaseline(next);
        } else if (!result.layoutApplied && doc?.source === 'git' && result.partIds?.length) {
          // Advance only the parts this flush committed. A sibling edit that
          // was not in the outbox keeps its previous baseline.
          const saved = {};
          for (const id of result.partIds) {
            const text = partScriptsRef.current?.[id];
            saved[id] = typeof text === 'string' ? text : '';
          }
          rememberGitBaseline(baselineAfterPartSave(base, {
            doc,
            saved,
            assemblyPath: assemblyFilePath(vaultSegment(doc.name) || doc.name),
            assemblyName: doc.name,
            assets: assetMap,
            branch: base?.branch || result.branch || gitWorkingBranch(),
            headSha: result.sha,
          }));
        } else if (!result.layoutApplied && base) {
          rememberGitBaseline({ ...base, headSha: result.sha, assets: assetMap });
        }
        gitVaultRef.current = { ...vault, headSha: result.sha };
      }
    }
    return result;
  };

  const flushGitOps = async ({ surfaceConflict = true } = {}) => {
    if (assemblyRef.current?.vaultLayout === 'v2') {
      return { status: 'idle' };
    }
    const vault = gitVaultRef.current;
    const adapter = gitAdapterRef.current;
    if (!vault?.repo || !adapter) return { status: 'idle' };
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    const result = await flushSyncQueue({
      store: gitSync(),
      adapter,
      repo: vault.repo,
      branch: gitWorkingBranch(),
      online,
    });
    return adoptSyncResult(result, { surfaceConflict });
  };
  flushGitSyncRef.current = flushGitOps;

  /**
   * After a rename-on-Commit (or any commit that remaps paths), fold the new
   * doc/scripts into the working copy and IndexedDB. Stable ids stay; `path`
   * follows the files that landed in git.
   */
  const applyCommittedWorkspace = async (result) => {
    if (!result?.doc || !result?.scripts) return;
    const nextDoc = result.doc;
    const nextScripts = result.scripts;
    for (const [id, script] of Object.entries(nextScripts)) {
      await savePartScript(id, script);
    }
    // Drop IndexedDB keys for old paths that moved away.
    const keep = new Set(Object.keys(nextScripts));
    for (const id of Object.keys(partScriptsRef.current || {})) {
      if (!keep.has(id)) {
        try { await deletePartScript(id); } catch { /* ignore */ }
      }
    }
    const keepHist = historyKeepKeys(nextDoc.parts, keep);
    for (const key of Object.keys(partHistoriesRef.current)) {
      if (key !== '__game__' && !keepHist.has(key)) delete partHistoriesRef.current[key];
    }
    rememberScripts(nextScripts);
    if (result.moved?.length) {
      const remaps = result.moved.filter((move) => (
        move?.from && move?.to && move.from !== move.to
        && nextDoc.parts?.some((part) => part.id === move.to)
      ));
      if (remaps.length) rekeyRuntime(remaps);
    }
    // Saved text is the undo head (wrap-on-Save must not look unsaved).
    for (const [id, script] of Object.entries(nextScripts)) {
      if (typeof script !== 'string') continue;
      const key = definitionIdFor(id, nextDoc);
      partHistoriesRef.current[key] = adoptSavedScript(
        partHistoriesRef.current[key],
        script,
      );
    }
    // Explicit Save / Move to Git must land in IndexedDB even during reauth
    // (playtest mock has no GitHub token). Otherwise reload restores the
    // pre-save seed and the assembly drops out of git mode.
    const saved = rememberAssembly(nextDoc, { force: true });
    const active = saved.parts.find((part) => part.id === saved.activeId) || saved.parts[0];
    if (active) {
      setCurrentFilename(active.name);
      const picked = scriptForRow(saved, nextScripts, active.id);
      const hist = partHistoriesRef.current[definitionIdFor(active.id, saved)];
      if (hist) applyPartHistory(hist);
      else focusPartHistory(active.id, picked.ok ? picked.script : '');
      if (picked.ok) {
        suppressPartSaveRef.current = false;
        codeEditorRef.current?.loadContent(picked.script, active.name, false);
      }
    }
  };

  /** @returns {Promise<boolean>} true when the source flip applied */
  const handleToggleSource = async () => {
    const doc = assemblyRef.current;
    if (!doc) return false;
    if (doc.source === 'git') {
      rememberAssembly({ ...doc, source: 'local' });
      rememberGitBaseline(null);
      rememberGitBehind(null, { showToast: false, resetResolved: true });
      setGitBehindToast(null);
      return true;
    }
    try {
      await ensureGitVault({ create: false });
    } catch (err) {
      if (err?.message === NO_REPO_YET_COPY) {
        setUploadNotice(NO_REPO_YET_COPY);
      } else {
        setUploadError(err.message || 'Could not open repo');
        return false;
      }
    }
    // Stamp path-less rows before the source flip so joints/paint keep working.
    await ensureLocalSurfIds();
    const live = assemblyRef.current || doc;
    // Keep current rows; paths that are not repo-safe stay until Open replaces them.
    rememberAssembly({ ...live, source: 'git' });
    // No baseline until Open / tip reseed — local: rows show first-commit dirty.
    rememberGitBaseline(null);
    rememberGitBehind(null, { showToast: false, resetResolved: true });
    setGitBehindToast(null);
    return true;
  };

  /** G6: vault name the Move to Git dialog starts with (current vault, else surfcad-vault). */
  const gitDefaultVaultName = () => gitVaultRef.current?.repo?.name || DEFAULT_VAULT_NAME;

  /** Live editor text for the active part, unless the editor shows a placeholder. */
  const liveEditorScript = (doc) => {
    const live = codeEditorRef.current?.getContent?.();
    const liveId = (!suppressPartSaveRef.current && typeof live === 'string') ? doc?.activeId : null;
    return { liveId: liveId || null, liveScript: liveId ? live : null };
  };

  /** G6 preview: where each Local part lands in the vault (no writes). */
  const handlePlanMoveToGit = ({ sharedIds = [] } = {}) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source === 'git') return null;
    try {
      return planMoveToGit(doc, partScriptsRef.current, { sharedIds, ...liveEditorScript(doc) });
    } catch (err) {
      return { error: err.message || 'Cannot plan the move' };
    }
  };

  /**
   * First Save of a local assembly (§3.3 / §3.5 / §6 PR 8): promote the WC to
   * git v2 without assigning vault paths as row ids, then the same planSave /
   * writeVaultCommit path as the Save button (`parts/<id>.js`). Leftover
   * moveToGit still writes v1 folder paths and must not be used here.
   *
   * Reauth boot is read-only, so load-time collapse may not have run. Stamp
   * with ensureLocalSurfIds (same mint as source-toggle), then collapse
   * leftover keys like `seed` / `part1` onto those opaque ids. Switching
   * source never remints a permanent id and never replaces one with a path.
   */
  const handleMoveToGit = async ({ vaultName = DEFAULT_VAULT_NAME } = {}) => {
    const before = assemblyRef.current;
    if (!before) return { status: 'error', error: 'No assembly' };
    if (before.source === 'git') return { status: 'error', error: 'Already in Git mode' };
    if (!before.parts?.length) return { status: 'empty' };
    const name = sanitizeVaultName(vaultName);
    if (!name) return { status: 'invalid-name', vaultName };
    const beforeScripts = { ...partScriptsRef.current };
    let collapsePairs = [];
    const restoreLocal = () => {
      if (collapsePairs.length) {
        rekeyRuntime(collapsePairs.map(({ from, to }) => ({ from: to, to: from })));
      }
      rememberScripts(beforeScripts);
      rememberAssembly(before);
    };
    try {
      await ensureLocalSurfIds();
      const stamped = assemblyRef.current || before;
      const live = liveEditorScript(stamped);
      const scripts = { ...partScriptsRef.current };
      if (live.liveId) {
        scripts[live.liveId] = live.liveScript;
        savePartScript(live.liveId, live.liveScript);
      }
      const collapsed = collapseWorkingCopyIds(stamped, scripts);
      collapsePairs = collapsed.pairs || [];
      if (collapsePairs.length) rekeyRuntime(collapsePairs);
      rememberScripts(collapsed.scripts);
      const assemblyId = isV2SurfId(collapsed.doc.id) ? collapsed.doc.id : mintSurfId();
      // v2 WC is id-only: do not keep a leftover vault path on the row.
      const v2Parts = (collapsed.doc.parts || []).map((part) => {
        if (!part || typeof part !== 'object' || !Object.prototype.hasOwnProperty.call(part, 'path')) {
          return part;
        }
        const next = { ...part };
        delete next.path;
        return next;
      });
      rememberAssembly(serializeAssembly({
        ...collapsed.doc,
        parts: v2Parts,
        id: assemblyId,
        source: 'git',
        vaultLayout: 'v2',
      }));
      const saved = await handleV2PlanSave(
        `Move ${assemblyName(before) || name} to Git`,
        { vaultName: name },
      );
      if (saved.status !== 'committed' && saved.status !== 'clean' && saved.status !== 'branched') {
        restoreLocal();
        return saved;
      }
      refreshAssemblyRef.current?.(undefined, { persistActive: false });
      return {
        ...saved,
        status: 'moved',
        vault: gitVaultRef.current,
      };
    } catch (err) {
      restoreLocal();
      return { status: 'error', error: err.message || 'Move to Git failed' };
    }
  };

  const handleListVaultAssemblies = async (adapter = null) => {
    const vault = await ensureGitVault({ create: false });
    // The feed omits `adapter` and reads the live one. Agent open passes its cache.
    return listVaultAssemblies(adapter || gitAdapterRef.current, vault.repo, gitWorkingBranch());
  };

  /**
   * Open and branch-switch share this. Backfill ids in memory, then recapture
   * the baseline so those ids are not dirty. Overlay only this branch's
   * pending user renames. Never enqueue or flush a git write — load/open
   * are read-only.
   */
  const adoptVaultOpening = async (opened, vault) => {
    const store = gitSync();
    const branch = opened.baseline?.branch || gitWorkingBranch();
    for (const hit of opened.identities?.cached || []) {
      if (hit.path && hit.id) await store.rememberPathId(vault.repo, hit.path, hit.id);
    }
    const previous = assemblyRef.current;
    const filled = opened.vaultLayout === 'legacy'
      ? { doc: opened.doc }
      : backfillSurfIds(opened.doc, store.pathIndexFor(vault.repo));
    const migrated = migrateAssemblyRecords({ doc: filled.doc, scripts: opened.scripts });
    const persistSource = { doc: migrated.doc, scripts: migrated.scripts };
    const stalePairs = [];
    const localIds = migrateLocalPartIds({
      doc: migrated.doc,
      scripts: migrated.scripts,
      histories: partHistoriesRef.current,
      selection: { activeId: migrated.doc?.activeId, cadPartId: cadPartIdRef.current },
    });
    if (localIds.changed) {
      partHistoriesRef.current = localIds.histories || partHistoriesRef.current;
      if (localIds.selection?.cadPartId && localIds.selection.cadPartId !== cadPartIdRef.current) {
        cadPartIdRef.current = localIds.selection.cadPartId;
      }
      stalePairs.push(...localIds.pairs);
    }
    const rekeyJournal = await loadRekeyJournal();
    const collapsed = collapseWorkingCopyIds(localIds.doc, localIds.scripts, {
      pathIndex: store.pathIndexFor(vault.repo),
      usedAssemblyIds: Object.values(store.assemblyIdIndexFor(vault.repo)),
      reusePairs: reusePairsFromJournal(rekeyJournal, persistSource.doc),
    });
    if (collapsed.changed) {
      stalePairs.push(...collapsed.pairs);
    }
    const reconciled = reconcileSyncedFromTip(collapsed.doc, collapsed.scripts);
    const openedDocIn = reconciled.doc;
    const openedScriptsIn = collapsed.scripts;
    let alignedMeshMeta = null;
    if (previous?.source === 'git') {
      const aligned = rekeyWorkingCopyToTip(previous, partScriptsRef.current, openedDocIn, {
        histories: partHistoriesRef.current,
        meshMeta: partMeshMetaRef.current,
        cadPartId: cadPartIdRef.current,
      });
      if (aligned.pairs.length) {
        alignedMeshMeta = aligned.meshMeta;
        stalePairs.push(...aligned.pairs);
      }
    }
    for (const part of openedDocIn.parts || []) {
      const sid = partSurfId(part);
      if (sid && partRepoPath(part)) store.rememberPathId(vault.repo, partRepoPath(part), sid);
    }
    try {
      await store.migrateLocalSurfIds();
    } catch (err) {
      console.warn('[git] local id migration failed', err?.message || err);
    }
    await retireImplicitVaultWriteOps(store, vault.repo, branch);
    const queued = store.pending(vault.repo, branch).concat(store.failed(vault.repo, branch));
    const overlaid = overlayPendingPartRenames(openedDocIn, openedScriptsIn, queued);
    const deletedOverlay = overlayPendingAssemblyDeletes(overlaid.doc, overlaid.scripts, queued);
    let openedDoc = deletedOverlay.doc;
    let openedScripts = deletedOverlay.scripts;
    if (deletedOverlay.removed) {
      const tree = store.getTree(vault.repo, branch);
      const next = workingCopyAfterDelete(
        { ...openedDocIn, name: openedDocIn?.name },
        openedScriptsIn,
        tree || [],
        { assemblyName: vaultSegment(opened.doc?.name) },
        { recent: recentAssembliesRef.current },
      );
      openedDoc = next.doc;
      openedScripts = next.scripts;
    }
    const meshRecords = partMeshRecordsFromBaseline(openedDoc, openedScripts, opened.baseline?.assets);
    const fromIds = [...new Set(stalePairs.map((pair) => pair.from).filter(Boolean))];
    const heldFrom = fromIds.length ? await loadPartScriptRecords(fromIds) : {};
    let saved = null;
    const persisted = await persistCollapsedWorkingCopy({
      collapsed: {
        doc: openedDoc,
        scripts: openedScripts,
        pairs: stalePairs,
      },
      sourceDoc: persistSource.doc,
      sourceScripts: persistSource.scripts,
      heldScripts: heldFrom,
      save: async (id, script) => {
        const part = (openedDoc.parts || []).find((row) => row.id === id);
        const mesh = meshRecords[id];
        const ok = await savePartScript(id, script, {
          ...(typeof part?.isSynced === 'boolean' ? { isSynced: part.isSynced } : {}),
          ...(mesh || {}),
        });
        if (ok !== false && mesh?.assets) rememberPartAssets(id, mesh.assets);
        return ok;
      },
      load: loadPartScript,
      remove: async (id) => {
        try { await deletePartScript(id); } catch { /* ignore */ }
      },
      saveDoc: saveAssemblyDocument,
      assemblyKey: assemblyRekeyKey(persistSource.doc),
      saveJournal: saveRekeyJournal,
      clearJournal: clearRekeyJournal,
      onFlight: (pairs, opts) => {
        persistFlightPairsRef.current = Array.isArray(pairs) ? pairs : [];
        persistFlightToOnlyRef.current = !!(opts && opts.toOnly);
      },
      apply: ({ doc: nextDoc, scripts: nextScripts }) => {
        if (stalePairs.length) rekeyRuntime(stalePairs);
        if (alignedMeshMeta) {
          partMeshMetaRef.current = alignedMeshMeta;
          setPartMeshMeta(alignedMeshMeta);
        }
        openedDoc = nextDoc;
        openedScripts = nextScripts;
        rememberScripts(nextScripts);
        rememberSidecar(emptyWorkingSidecar());
        saved = rememberAssembly(nextDoc, { persist: false });
        rememberGitBaseline(captureBaseline({
          assemblyPath: deletedOverlay.removed ? assemblyFilePath(saved.name) : opened.baseline.assemblyPath,
          assemblyName: saved.name,
          doc: saved,
          scripts: baselineScriptsKeepingTip(
            saved.parts,
            nextScripts,
            opened.baseline?.scripts,
            { openedScripts: opened.scripts },
          ),
          assets: opened.baseline?.assets,
          branch,
          headSha: opened.baseline.headSha,
        }));
      },
    });
    if (persisted.docSaved === false) {
      persistFlightPairsRef.current = [];
      persistFlightToOnlyRef.current = false;
      throw new Error(WORKING_COPY_DOC_UNSAVED);
    }
    openedDoc = persisted.doc;
    openedScripts = persisted.scripts;
    if (Object.keys(meshRecords).length) {
      const nextMeta = { ...partMeshMetaRef.current, ...meshRecords };
      partMeshMetaRef.current = nextMeta;
      setPartMeshMeta(nextMeta);
    }
    rememberScripts(openedScripts);
    rememberSidecar(emptyWorkingSidecar());
    saved = rememberAssembly(openedDoc);
    noteRecentAssembly(saved.name);
    const baseline = captureBaseline({
      assemblyPath: deletedOverlay.removed ? assemblyFilePath(saved.name) : opened.baseline.assemblyPath,
      assemblyName: saved.name,
      doc: saved,
      scripts: baselineScriptsKeepingTip(
        saved.parts,
        openedScripts,
        opened.baseline?.scripts,
        { openedScripts: opened.scripts },
      ),
      assets: opened.baseline?.assets,
      branch,
      headSha: opened.baseline.headSha,
    });
    // The reload reseed opens the live adapter when the document changes
    // and this ref is still empty. Set it before the await so that reseed
    // does not start a second vault read during this open.
    rememberGitBaseline(baseline);
    if (isSurfId(saved.id)) {
      await store.rememberAssemblyId(vault.repo, vaultSegment(saved.name), saved.id);
    }
    const head = opened.baseline.headSha || null;
    const stored = store.getLastSyncedSha(vault.repo, branch);
    const held = queued.length > 0 && !!(stored && head && stored !== head);
    if (!queued.length && head) await store.setLastSyncedSha(vault.repo, head, branch);
    if (held) {
      setSyncConflict({
        status: 'conflict',
        syncHold: true,
        branch,
        lastSyncedSha: stored,
        remoteSha: head,
        baseSha: stored,
        warning: 'The repo moved since the last sync. Nothing was overwritten.',
      });
    }
    gitVaultRef.current = { ...vault, headSha: head || vault.headSha };
    return { saved, scripts: openedScripts, baseline, branch, held };
  };

  const openNamedVaultAssembly = async (adapter, repo, name, opts = {}) => {
    const branch = opts.branch || 'main';
    const store = gitSync();
    const folder = vaultSegment(name);
    const cached = assemblyRef.current;
    const knownAssemblyId = opts.knownAssemblyId
      || store.assemblyIdFor(repo, folder)
      || (cached
        && vaultSegment(cached.name) === folder
        && isSurfId(cached.id)
        ? cached.id
        : undefined);
    const assemblyIdIndex = opts.assemblyIdIndex || store.assemblyIdIndexFor(repo);
    const detected = await detectVaultLayout(adapter, repo, branch);
    if (detected.layout !== 'legacy') {
      throw new UnsupportedVaultLayoutError(detected.layout);
    }
    return openLegacyAssembly(adapter, repo, name, {
      ...opts,
      knownAssemblyId,
      assemblyIdIndex,
    });
  };

  const handleOpenVaultAssembly = async (name, adapter = null) => {
    // The Open dialog passes a v2 row's id; a v1 folder is still a name.
    if (isV2SurfId(name)) return handleOpenV2VaultAssembly(name, adapter);
    try {
      await openAssemblyTrackedRef.current({
        folder: name,
        adapter,
        retry: () => { void handleOpenVaultAssembly(name); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const vault = await ensureGitVault({ create: false });
          if (!signal()) return;
          const branch = gitWorkingBranch();
          // Retry and the feed omit `adapter`, so they stay on the live adapter.
          const git = adapter || gitAdapterRef.current;
          const tip = (await git.getBranch(vault.repo, branch))?.sha || null;
          const store = gitSync();
          await store.ready();
          const opened = await openNamedVaultAssembly(
            git,
            vault.repo,
            name,
            {
              branch,
              headSha: tip,
              pathIndex: store.pathIndexFor(vault.repo),
              onProgress: (update) => progress(update?.name ? update : { ...update, name: undefined }),
            },
          );
          if (!signal()) return;
          const adopted = await adoptVaultOpening(opened, vault);
          if (!signal()) return;
          scheduleLastCommitFromApp({ adapter: git, repo: vault.repo, branch, store, opened, adopted, tip, liveSession: () => ({ repo: gitVaultRef.current?.repo || vault.repo, branch: gitWorkingBranch() }) });
          const saved = adopted.saved;
          const openedScripts = adopted.scripts;
          // G4: check remote on open (usually current; catches a race with a push).
          void checkGitRemoteBehind({ showToast: true, reason: 'open' });
          const keep = historyKeepKeys(saved.parts);
          for (const key of Object.keys(partHistoriesRef.current)) {
            if (key !== '__game__' && !keep.has(key)) delete partHistoriesRef.current[key];
          }
          await finishOpenedPartRef.current(saved, openedScripts, progress);
        },
      });
      return { status: 'opened', name };
    } catch (err) {
      console.warn('[App] Open assembly failed:', err?.message || err);
      if (err?.message === NO_REPO_YET_COPY) setUploadNotice(NO_REPO_YET_COPY);
      return gitOpCatchResult(err, 'Could not open assembly');
    }
  };
  openVaultAssemblyRef.current = handleOpenVaultAssembly;

  const handleAddExistingPart = async (path) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return;
    try {
      const vault = await ensureGitVault({ create: false });
      const id = normalizeRepoPath(path);
      if (!id || !partPathAllowedFor(doc.name, id)) {
        setUploadError('That path is not allowed for this assembly');
        return;
      }
      const got = await readVaultPart(gitAdapterRef.current, vault.repo, id, gitWorkingBranch());
      if (!got) {
        setUploadError(`Missing in vault: ${id}`);
        return;
      }
      const live = codeEditorRef.current?.getContent?.();
      const prev = doc.activeId;
      const scripts = { ...partScriptsRef.current };
      if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
        scripts[prev] = live;
        savePartScript(prev, live);
        stashPartHistory(prev, live);
      }
      scripts[id] = got.content;
      await savePartScript(id, got.content);
      rememberScripts(scripts);
      const existing = doc.parts.some((part) => part.id === id);
      const parts = existing
        ? doc.parts
        : [...doc.parts, {
          id,
          name: id.split('/').pop()?.replace(/\.js$/i, '') || id,
          visible: true,
          order: doc.parts.length,
        }];
      refreshGenRef.current += 1;
      rememberAssembly({ ...doc, source: 'git', activeId: id, parts });
      focusPartHistory(id, got.content);
      suppressPartSaveRef.current = false;
      setCurrentFilename(id.split('/').pop() || id);
      revealPartOnRibbon(id, got.content);
      codeEditorRef.current?.loadContent(got.content, id, false);
    } catch (err) {
      setUploadError(err.message || 'Could not add part');
    }
  };

  /**
   * Add to Repo: instantly commit one local part (plus assembly file) into the
   * vault. Replaces the old lost-reference "Find in repo" flow.
   */
  const handleAddToRepo = async (id) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git' || !id) {
      return { status: 'error', error: 'Not in Git mode' };
    }
    if (isV2PlanSaveDoc(doc)) {
      setPendingPartIds((prev) => new Set(prev).add(String(id)));
      try {
        const row = (doc.parts || []).find((part) => String(part?.id) === String(id));
        const def = row ? partDefinitionId(row) : String(id);
        const live = codeEditorRef.current?.getContent?.();
        const liveId = (!suppressPartSaveRef.current && typeof live === 'string')
          ? doc.activeId : null;
        if (liveId === id && typeof live === 'string') {
          await savePartScript(id, live);
          rememberScripts({ ...partScriptsRef.current, [id]: live });
        } else if (typeof partScriptsRef.current[id] !== 'string') {
          // Instance rows share the definition script. A missing row key is
          // not a missing script — writing a starter would replace it.
          const known = partScriptsRef.current[def];
          if (typeof known === 'string') {
            rememberScripts({ ...partScriptsRef.current, [id]: known });
          } else {
            const starter = newPartStarterScript();
            await savePartScript(id, starter);
            rememberScripts({ ...partScriptsRef.current, [id]: starter });
          }
        }
        return await handleGitCommit('Add to repo');
      } catch (err) {
        return gitOpCatchResult(err, 'Add to Repo failed');
      } finally {
        setPendingPartIds((prev) => {
          const next = new Set(prev);
          next.delete(String(id));
          return next;
        });
      }
    }
    setPendingPartIds((prev) => new Set(prev).add(String(id)));
    try {
      const vault = await ensureGitVault({ create: true });
      let scripts = { ...partScriptsRef.current };
      const live = codeEditorRef.current?.getContent?.();
      const liveId = (!suppressPartSaveRef.current && typeof live === 'string')
        ? doc.activeId : null;
      if (liveId === id && typeof live === 'string') {
        scripts[id] = live;
        await savePartScript(id, live);
        rememberScripts(scripts);
      }
      if (typeof scripts[id] !== 'string') {
        // No local text yet — seed a starter so the path exists in the repo.
        const starter = newPartStarterScript();
        scripts[id] = starter;
        await savePartScript(id, starter);
        rememberScripts(scripts);
      }
      const baseline = gitBaselineRef.current || firstCommitBaseline({
        branch: gitWorkingBranch(),
        headSha: vault.headSha
          || (await gitAdapterRef.current.getBranch(vault.repo, gitWorkingBranch()))?.sha
          || null,
      });
      const result = await commitPartToRepo(gitAdapterRef.current, vault.repo, {
        doc,
        scripts,
        baseline,
        partId: id,
        liveId,
        liveScript: liveId ? live : null,
      });
      if (result.status === 'repo-moved') {
        setUploadError(null);
        setSyncConflict(null);
        setRepoSaved(null);
        setRepoMoved({
          kind: 'part',
          files: result.files,
          message: result.message,
          doc: result.doc,
          scripts: result.scripts,
          baseSha: result.baseSha,
          fromBranch: result.branch,
          partId: result.partId,
          fromId: result.fromId,
          partIds: [
            ...(result.partId ? [result.partId] : []),
            ...(result.siblings || []).map((move) => move.to),
          ],
        });
        return result;
      }
      if (result.status === 'error') {
        setUploadError(result.error || 'Add to Repo failed');
        return result;
      }
      if (result.status === 'clean') {
        if (result.doc) rememberAssembly(result.doc);
        if (result.scripts) rememberScripts(result.scripts);
        return result;
      }
      const moves = [
        ...(result.fromId && result.partId ? [{ from: result.fromId, to: result.partId }] : []),
        ...(result.siblings || []),
      ];
      for (const { from, to } of moves) {
        if (!from || !to || from === to) continue;
        await savePartScript(to, result.scripts?.[to] ?? '', { isSynced: true });
        try { await deletePartScript(from); } catch { /* the new id is the record */ }
      }
      if (moves.length) rekeyRuntime(moves);
      // The committed document, not a locally remapped subset: sibling
      // paths in the working copy must match the blobs that landed in git.
      if (result.doc) rememberAssembly(result.doc);
      rememberScripts(result.scripts || scripts);
      if (result.fromId && (doc.activeId === id || doc.activeId === result.partId)) {
        refreshGenRef.current += 1;
        const text = result.scripts?.[result.partId] ?? scripts[id];
        focusPartHistory(result.partId, text);
        suppressPartSaveRef.current = false;
        setCurrentFilename(String(result.partId).split('/').pop() || result.partId);
        codeEditorRef.current?.loadContent(text, result.partId, false);
      } else if (doc.activeId === id) {
        suppressPartSaveRef.current = false;
      } else {
        refreshAssemblyRef.current?.(codeEditorRef.current?.getContent?.());
      }
      if (result.baseline) {
        rememberGitBaseline(result.baseline);
        gitVaultRef.current = { ...vault, headSha: result.sha };
        captureAgentScriptSnapshot();
      }
      if (result.sha) await gitSync().setLastSyncedSha(vault.repo, result.sha, gitWorkingBranch());
      if (result.status === 'committed' || result.status === 'clean') {
        const partId = result.partId || id;
        const marked = markPartsSynced(assemblyRef.current, [
          partId,
          ...moves.map((move) => move.to),
        ]);
        if (marked.changed) {
          rememberAssembly(marked.doc);
          const text = (result.scripts || partScriptsRef.current)[partId];
          if (typeof text === 'string') await savePartScript(partId, text, { isSynced: true });
        }
      }
      return result;
    } catch (err) {
      const error = err.message || 'Add to Repo failed';
      setUploadError(error);
      return { status: 'error', error };
    } finally {
      setPendingPartIds((prev) => {
        const next = new Set(prev);
        next.delete(String(id));
        return next;
      });
    }
  };


  /** G5: list vault branches with the current working branch marked. */
  const handleListBranches = async () => {
    const vault = await ensureGitVault({ create: false });
    return listVaultBranches(gitAdapterRef.current, vault.repo, {
      current: gitWorkingBranch(),
    });
  };

  /**
   * G5: switch working branch — reload the open assembly from that tip.
   * Dirty working copy is replaced (PartFeed confirms first when dirty).
   * v2 opens by assembly id (openV2Assembly). leftover switchVaultBranch
   * opens by folder name and throws UnsupportedVaultLayoutError on v2.
   */
  const handleSwitchBranch = async (branchName) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    const current = gitWorkingBranch();
    if (!branchName || branchName === current) {
      return { status: 'same', branch: current };
    }
    if (isV2PlanSaveDoc(doc)) {
      const id = doc.id;
      try {
        const opened = await openAssemblyTrackedRef.current({
          id,
          branch: branchName,
          retry: () => { void handleSwitchBranch(branchName); },
          load: async ({ progress, signal }) => {
            refreshGenRef.current += 1;
            const vault = await ensureGitVault({ create: false });
            if (!signal()) return null;
            const store = gitSync();
            await store.ready();
            const git = gitAdapterRef.current;
            const tip = (await git.getBranch(vault.repo, branchName))?.sha || null;
            if (!tip) throw new Error(`Branch not found: ${branchName}`);
            const loaded = await openV2Assembly(git, vault.repo, id, {
              branch: branchName,
              headSha: tip,
            });
            if (!signal()) return null;
            progress({
              name: loaded.doc?.name,
              total: loaded.doc?.parts?.length || 0,
            });
            const adopted = await adoptVaultOpening(loaded, vault);
            if (!signal()) return null;
            await scheduleLastCommitFromApp({
              adapter: git,
              repo: vault.repo,
              branch: branchName,
              store,
              opened: loaded,
              adopted,
              tip,
              liveSession: () => ({
                repo: gitVaultRef.current?.repo || vault.repo,
                branch: gitWorkingBranch(),
              }),
            });
            rememberGitBehind(null, { showToast: false, resetResolved: true });
            setGitBehindToast(null);
            void checkGitRemoteBehind({ showToast: true, reason: 'branch-switch' });
            const saved = adopted.saved;
            const keep = historyKeepKeys(saved.parts);
            for (const key of Object.keys(partHistoriesRef.current)) {
              if (key !== '__game__' && !keep.has(key)) delete partHistoriesRef.current[key];
            }
            await finishOpenedPartRef.current(saved, adopted.scripts, progress);
            return loaded;
          },
        });
        if (!opened) return { status: 'error', error: 'Could not switch branch' };
        return { status: 'switched', branch: branchName, baseline: opened.baseline };
      } catch (err) {
        return gitOpCatchResult(err, 'Could not switch branch');
      }
    }
    const name = vaultSegment(doc.name) || doc.name;
    if (!name) return { status: 'error', error: 'No assembly open' };
    try {
      const opened = await openAssemblyTrackedRef.current({
        folder: name,
        branch: branchName,
        retry: () => { void handleSwitchBranch(branchName); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const vault = await ensureGitVault({ create: false });
          if (!signal()) return null;
          const store = gitSync();
          await store.ready();
          const loaded = await switchVaultBranch(
            gitAdapterRef.current, vault.repo, name, branchName, {
              onProgress: (update) => progress(update?.name ? update : { ...update, name: undefined }),
              pathIndex: store.pathIndexFor(vault.repo),
              openAssembly: openNamedVaultAssembly,
            },
          );
          if (!signal()) return null;
          const adopted = await adoptVaultOpening(loaded, vault);
          if (!signal()) return null;
          const saved = adopted.saved;
          rememberGitBehind(null, { showToast: false, resetResolved: true });
          setGitBehindToast(null);
          void checkGitRemoteBehind({ showToast: true, reason: 'branch-switch' });
          const keep = historyKeepKeys(saved.parts);
          for (const key of Object.keys(partHistoriesRef.current)) {
            if (key !== '__game__' && !keep.has(key)) delete partHistoriesRef.current[key];
          }
          await finishOpenedPartRef.current(saved, adopted.scripts, progress);
          return loaded;
        },
      });
      if (!opened) return { status: 'error', error: 'Could not switch branch' };
      return { status: 'switched', branch: branchName, baseline: opened.baseline };
    } catch (err) {
      return gitOpCatchResult(err, 'Could not switch branch');
    }
  };

  /** G11: browse vault assemblies + parts for Open. */
  const handleListVaultBrowse = async () => {
    const vault = await ensureGitVault({ create: false });
    const browse = await listVaultBrowseItems(gitAdapterRef.current, vault.repo, gitWorkingBranch());
    const branch = gitWorkingBranch();
    const ops = gitSync().pending(vault.repo, branch).concat(gitSync().failed(vault.repo, branch));
    return overlayWorkingCopyBrowseNames(
      hidePendingDeletedAssemblies(browse, ops),
      assemblyRef.current,
    );
  };

  const vaultEntriesForDelete = async () => {
    const vault = await ensureGitVault({ create: false });
    const branch = gitWorkingBranch();
    const remote = await readRenameEntries(gitAdapterRef.current, vault.repo, branch);
    const ops = gitSync().pending(vault.repo, branch).concat(gitSync().failed(vault.repo, branch));
    return { vault, branch, tip: remote, entries: projectPendingOps(remote, ops) };
  };

  const showEmptyAssembly = () => {
    refreshGenRef.current += 1;
    partSaveEpochRef.current += 1;
    suppressPartSaveRef.current = true;
    applyPartHistory({ commits: [], head: -1 });
    setCurrentFilename(null);
    rememberCadPart(null);
    const note = '// No parts.\n';
    saveEditorDraft({ script: note, filename: null, partId: null });
    codeEditorRef.current?.setTextOnly?.(note);
    setCurrentScript(note);
    viewportRef.current?.placeAssembly?.({
      solids: [],
      leftovers: [],
      activeId: null,
      blankActive: true,
      failedIds: [],
    });
  };

  const applyDeleteWorkingCopy = async (next, branch, headSha, files = []) => {
    refreshGenRef.current += 1;
    const scripts = next.scripts || {};
    const previousIds = Object.keys(partScriptsRef.current || {});
    rememberScripts(scripts);
    const saved = rememberAssembly(next.doc);
    await assemblyDocPersistRef.current;
    if (next.kind === 'update' && next.pairs?.length) rekeyRuntime(next.pairs);
    for (const id of previousIds) {
      if (!Object.prototype.hasOwnProperty.call(scripts, id)) {
        try { await deletePartScript(id); } catch { /* ignore */ }
      }
    }
    for (const [id, text] of Object.entries(scripts)) {
      try { await savePartScript(id, text); } catch { /* ignore */ }
    }
    const keptIds = historyKeepKeys(saved.parts, Object.keys(scripts));
    for (const key of Object.keys(partHistoriesRef.current)) {
      if (key !== '__game__' && !keptIds.has(key)) delete partHistoriesRef.current[key];
    }
    const baseline = baselineAfterDelete(captureBaseline({
      assemblyPath: next.assemblyPath || assemblyFilePath(saved.name),
      assemblyName: saved.name,
      doc: saved,
      scripts,
      branch,
      headSha,
    }), {
      kind: next.kind,
      files,
      pairs: next.pairs,
      previous: gitBaselineRef.current,
    });
    rememberGitBaseline(baseline);
    if (next.kind === 'empty' || !saved.parts?.length) {
      showEmptyAssembly();
      return saved;
    }
    noteRecentAssembly(saved.name);
    const active = saved.parts.find((part) => part.id === saved.activeId) || saved.parts[0];
    if (active) {
      setCurrentFilename(active.name);
      const text = scripts[active.id] ?? '';
      focusPartHistory(active.id, text);
      suppressPartSaveRef.current = false;
      if (next.kind === 'switch') {
        // An open already owns the worker. preemptInflight would drop the
        // build the spinner is waiting on (#264).
        if (!assemblyOpenLockRef.current) {
          assemblyOpenLockRef.current = true;
          try {
            await finishOpenedPartRef.current(saved, scripts);
          } finally {
            if (!assemblyOpenCtrlRef.current?.isOpen?.()) assemblyOpenLockRef.current = false;
          }
        }
      } else if (codeEditorRef.current?.loadContent) {
        codeEditorRef.current.loadContent(text, active.name, false);
      }
    }
    return saved;
  };

  const handlePreviewDeleteAssembly = async (name, assemblyId = '') => {
    const doc = assemblyRef.current;
    if (doc?.source === 'git' && doc.vaultLayout === 'v2') {
      const wanted = isV2SurfId(assemblyId) ? assemblyId : '';
      const openMatch = wanted
        ? wanted === doc.id
        : assemblyName(doc) === String(name || '').trim();
      if (openMatch && isV2SurfId(doc.id)) {
        return { partCount: (doc.parts || []).length, referenced: [] };
      }
      if (!wanted) {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
      try {
        const vault = await ensureGitVault({ create: false });
        const file = await gitAdapterRef.current?.readFile(
          vault?.repo,
          assemblyIdPath(wanted),
          gitWorkingBranch(),
        );
        if (!file || file.content == null) return { partCount: 0, referenced: [] };
        const json = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
        return {
          partCount: Array.isArray(json?.parts) ? json.parts.length : 0,
          referenced: [],
        };
      } catch {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
    }
    try {
      const { entries, tip } = await vaultEntriesForDelete();
      return previewDeleteAssembly(entries, name, { openDoc: assemblyRef.current, tipEntries: tip });
    } catch (err) {
      return { status: 'error', error: err?.message || 'Could not check this assembly' };
    }
  };

  /**
   * Confirmed delete of the open v2 assembly. A committed file is one
   * writeVaultCommit. A never-saved assembly is replaced in the working
   * copy and writes nothing. Conflict and pending leave the working copy.
   */
  const deleteOpenV2Assembly = async (doc, mode) => {
    const openId = doc.id;
    const previousName = assemblyName(doc);
    const replaced = async () => {
      const after = await seedAgentAssembly({});
      return {
        status: 'deleted',
        name: previousName,
        id: openId,
        mode,
        nextAssemblyId: after?.id ?? null,
      };
    };
    let vault = null;
    try {
      vault = await ensureGitVault({ create: false });
    } catch (err) {
      if (err?.message !== NO_REPO_YET_COPY && err?.code !== NO_REPO_YET_CODE) {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
    }
    if (!vault?.repo || !gitAdapterRef.current) {
      try {
        return await replaced();
      } catch {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
    }
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    let result;
    try {
      result = await executeDeleteV2Assembly({
        adapter: gitAdapterRef.current,
        repo: vault.repo,
        branch: gitWorkingBranch(),
        store: gitSync(),
        assemblyId: openId,
        openDoc: doc,
        deleteParts: mode === 'drop',
        confirm: true,
        online,
        message: `Delete ${previousName}`,
      });
    } catch {
      return {
        status: 'error',
        error: "Couldn't delete the assembly. Nothing was changed.",
      };
    }
    if (result.status === 'local') {
      try {
        const after = await replaced();
        return { ...after, assemblies: result.assemblies || [] };
      } catch {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
    }
    if (result.status !== 'committed') return result;
    if (result.sha) {
      gitVaultRef.current = {
        ...(gitVaultRef.current || vault),
        headSha: result.sha,
      };
    }
    try {
      const after = await replaced();
      return { ...after, sha: result.sha, assemblies: result.assemblies || [] };
    } catch {
      return {
        status: 'deleted',
        name: previousName,
        id: openId,
        mode,
        sha: result.sha,
        assemblies: result.assemblies || [],
        nextAssemblyId: null,
      };
    }
  };

  /**
   * Confirmed delete of a v2 assembly that is not the open one. One
   * commit when the file is saved. The open working copy stays put.
   */
  const deleteOtherV2Assembly = async (doc, target, mode) => {
    let vault = null;
    try {
      vault = await ensureGitVault({ create: false });
    } catch (err) {
      if (err?.message !== NO_REPO_YET_COPY && err?.code !== NO_REPO_YET_CODE) {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
    }
    if (!vault?.repo || !gitAdapterRef.current) {
      return {
        status: 'error',
        error: "Couldn't delete the assembly. Nothing was changed.",
      };
    }
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    let result;
    try {
      result = await executeDeleteV2Assembly({
        adapter: gitAdapterRef.current,
        repo: vault.repo,
        branch: gitWorkingBranch(),
        store: gitSync(),
        assemblyId: target,
        openDoc: doc,
        deleteParts: mode === 'drop',
        confirm: true,
        online,
        message: `Delete ${target}`,
      });
    } catch {
      return {
        status: 'error',
        error: "Couldn't delete the assembly. Nothing was changed.",
      };
    }
    if (result.status === 'local') {
      return {
        status: 'deleted',
        id: target,
        mode,
        assemblies: result.assemblies || [],
      };
    }
    if (result.status !== 'committed') return result;
    if (result.sha) {
      gitVaultRef.current = {
        ...(gitVaultRef.current || vault),
        headSha: result.sha,
      };
    }
    return {
      status: 'deleted',
      id: target,
      mode,
      sha: result.sha,
      assemblies: result.assemblies || [],
    };
  };

  /**
   * One outbox commit. The cache snapshot is swapped only after the next
   * tree is built. Failure toasts Retry/Revert and Revert puts that snapshot back.
   * The promise waits for the local IndexedDB document and part-script
   * writes, then the queued git sync. A later call retries that failed op.
   */
  const handleDeleteAssembly = async (name, mode = 'keep', assemblyId = '') => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return { status: 'error', error: 'Not in Git mode' };
    // v2: one commit after this confirm, or a working-copy replace when the
    // assembly was never saved. The v1 folder delete below must not run.
    if (doc.vaultLayout === 'v2') {
      const wanted = isV2SurfId(assemblyId) ? assemblyId : '';
      const openId = isV2SurfId(doc.id) ? doc.id : '';
      const nameHit = !wanted && assemblyName(doc) === String(name || '').trim();
      const target = wanted || (nameHit ? openId : '');
      if (!target) {
        return {
          status: 'error',
          error: "Couldn't delete the assembly. Nothing was changed.",
        };
      }
      const dropMode = mode === 'drop' ? 'drop' : 'keep';
      if (target === openId) return deleteOpenV2Assembly(doc, dropMode);
      return deleteOtherV2Assembly(doc, target, dropMode);
    }
    // Feature edit and the editor auto-run already stay off this lock.
    // A delete would preempt the build the open spinner is waiting on.
    if (assemblyOpenLockRef.current) {
      return { status: 'error', error: 'An assembly is opening — try the delete again once it finishes.' };
    }
    try {
      const { vault, branch, entries, tip } = await vaultEntriesForDelete();
      const seg = vaultSegment(name);
      const sameDelete = (op) => op.op === 'delete-assembly' && op.payload?.name === seg;
      // A failed sync is `failed`. A vault refusal puts the same op back to
      // `queued`. Either way the local delete already happened, so retry
      // flushes that op instead of planning a second one.
      const failedOp = gitSync().failed(vault.repo, branch).find(sameDelete);
      const queuedOp = gitSync().pending(vault.repo, branch).find(sameDelete);
      if (failedOp || queuedOp) {
        if (failedOp) await gitSync().requeue(failedOp.id);
        setPartSync({ ...gitSync().partStates() });
        const retried = await flushGitOps();
        if (retried?.status === 'failed') {
          return {
            status: 'failed',
            error: retried.error || retried.toast?.message || 'Could not delete assembly',
          };
        }
        return { status: 'deleted', name: (failedOp || queuedOp).payload?.name || seg || name };
      }
      const live = codeEditorRef.current?.getContent?.();
      const scripts = { ...partScriptsRef.current };
      if (doc.activeId && !suppressPartSaveRef.current && typeof live === 'string') {
        scripts[doc.activeId] = live;
      }
      const plan = planDeleteAssembly(entries, name, mode === 'drop' ? 'drop' : 'keep', {
        scripts,
        openDoc: doc,
        tipEntries: tip,
      });
      const projected = projectFiles(entries, plan.files);
      const next = workingCopyAfterDelete(doc, scripts, projected, plan, {
        recent: recentAssembliesRef.current,
      });
      const written = next.kind === 'update'
        ? await commitOpenAssemblyText(
          plan.files,
          assemblyFilePath(vaultSegment(doc.name) || doc.name),
          next.doc,
          {
            adapter: gitAdapterRef.current,
            repo: vault.repo,
            scripts: next.scripts || scripts,
            branch,
          },
        )
        : { files: plan.files, doc: next.doc, scripts: next.scripts };
      const files = written.files;
      if (written.doc) next.doc = written.doc;
      if (written.scripts) next.scripts = written.scripts;
      if (written.moved?.length) {
        next.pairs = [...(next.pairs || []), ...written.moved];
      }
      const cacheBefore = entries.map((entry) => ({ path: entry.path, content: entry.content ?? '' }));
      const cacheAfter = projectFiles(entries, files);
      const baselineBefore = gitBaselineRef.current;
      const headSha = baselineBefore?.headSha
        || (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha
        || null;
      let swapped = false;
      try {
        await gitSync().putTree(vault.repo, branch, cacheAfter);
        swapped = true;
        await applyDeleteWorkingCopy(next, branch, headSha, files);
        const partIds = [
          ...(next.doc?.parts || []).map((part) => part.id),
          ...plan.moves.map((move) => move.to),
        ];
        await enqueueGit(vault.repo, {
          op: 'delete-assembly',
          message: plan.message,
          partIds,
          files,
          payload: {
            name: plan.assemblyName,
            label: plan.assemblyName,
            mode: plan.mode,
            assemblyPath: plan.assemblyPath,
            legacyPath: plan.legacyPath,
            moves: plan.moves.map((move) => ({
              from: move.from,
              to: move.to,
              surfId: move.surfId,
              name: move.name,
            })),
            pairs: next.pairs || [],
            partId: next.doc?.activeId || plan.moves[0]?.to || null,
            before: {
              doc,
              scripts,
              baseline: baselineBefore,
              cache: cacheBefore,
            },
          },
        });
      } catch (err) {
        if (swapped) {
          try { await gitSync().putTree(vault.repo, branch, cacheBefore); } catch { /* keep the throw */ }
          rememberScripts(scripts);
          rememberAssembly(doc);
          try { await assemblyDocPersistRef.current; } catch { /* keep the throw */ }
          rememberGitBaseline(baselineBefore);
        }
        throw err;
      }
      setPartSync({ ...gitSync().partStates() });
      const result = await flushGitOps();
      if (result?.status === 'failed') {
        return { status: 'failed', error: result.error || result.toast?.message || 'Could not delete assembly' };
      }
      return { status: 'deleted', name: plan.assemblyName };
    } catch (err) {
      return { status: 'error', error: err?.message || 'Could not delete assembly' };
    }
  };

  /**
   * G11: insert another assembly's parts into the current document
   * (shared keep path; other-assembly parts remap under this assembly).
   */
  /**
   * Insert parts into current from a v2 assembly, by id. Every part joins by
   * reference (same id, same `parts/<id>.js`); rows already in the document
   * are skipped; the new rows are filed under one group whose `source` is
   * that assembly's id (`docs/git-save-model.md` §2.1). No git write.
   */
  const insertV2VaultAssemblyParts = async (assemblyId) => {
    const ctx = await agentGitReadContext('insert_part');
    if (ctx.error) return { status: 'error', code: ctx.error.code, error: ctx.error.message };
    let opened;
    try {
      opened = await openV2Assembly(ctx.adapter, ctx.vault.repo, assemblyId, { branch: ctx.branch });
    } catch (err) {
      if (err?.code === 'unknown_assembly') {
        return { status: 'error', code: 'unknown_assembly', error: `Assembly not found: ${assemblyId}` };
      }
      return gitOpCatchResult(err, 'Could not read assembly');
    }
    const sourceName = assemblyName(opened.doc);
    const have = new Set((assemblyRef.current?.parts || []).map((part) => part.id));
    const rows = (opened.doc?.parts || [])
      .filter((part) => isV2SurfId(part?.id) && !have.has(part.id))
      .map((part) => ({
        id: part.id,
        name: part.name,
        script: opened.scripts?.[part.id],
        missing: part.missing === true,
      }));
    if (!rows.length) return { status: 'empty', error: 'No new parts to insert', sourceName };
    const inserted = await insertReferencedParts({ rows });
    if (inserted.error) {
      return { status: 'error', code: inserted.error.code, error: inserted.error.message };
    }
    const grouped = withInsertedGroup(assemblyRef.current, {
      name: sourceName,
      source: assemblyId,
      partIds: inserted.result?.added || [],
    });
    rememberAssembly(grouped);
    refreshGenRef.current += 1;
    return { status: 'inserted', count: rows.length, sourceName };
  };

  const handleInsertVaultAssemblyParts = async (sourceName) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    // The Open dialog passes a v2 row's id; a v1 folder is still a name.
    if (isV2SurfId(sourceName)) {
      try {
        return await insertV2VaultAssemblyParts(sourceName);
      } catch (err) {
        return gitOpCatchResult(err, 'Could not insert parts');
      }
    }
    try {
      const vault = await ensureGitVault({ create: false });
      const planned = await planInsertVaultAssemblyParts(
        gitAdapterRef.current, vault.repo, sourceName, doc,
        { branch: gitWorkingBranch() },
      );
      if (!planned.additions.length) {
        return { status: 'empty', error: 'No new parts to insert' };
      }
      const live = codeEditorRef.current?.getContent?.();
      const prev = doc.activeId;
      const scripts = { ...partScriptsRef.current };
      if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
        scripts[prev] = live;
        savePartScript(prev, live);
        stashPartHistory(prev, live);
      }
      let parts = [...doc.parts];
      let activeId = doc.activeId;
      for (const add of planned.additions) {
        if (add.missing !== true && typeof add.content === 'string') {
          scripts[add.id] = add.content;
        }
        if (!parts.some((p) => p.id === add.id)) {
          parts = [...parts, {
            id: add.id,
            name: add.name,
            visible: true,
            order: parts.length,
            ...(add.surfId ? { surfId: add.surfId } : {}),
            // Existing linked path, not a newly assigned copy path.
            ...(add.fromPath ? { path: add.fromPath } : {}),
            ...(add.missing === true ? { missing: true } : {}),
          }];
        }
        activeId = add.id;
      }
      const inserted = withInsertedGroup(
        { ...doc, source: 'git', activeId, parts },
        {
          name: planned.sourceName,
          source: planned.sourcePath,
          partIds: planned.additions.map((add) => add.surfId || add.id).filter(Boolean),
        },
      );
      rememberScripts(scripts);
      const saved = rememberAssembly(inserted);
      for (const add of planned.additions) {
        if (add.missing === true || typeof add.content !== 'string') continue;
        await savePartScript(add.id, add.content);
      }
      refreshGenRef.current += 1;
      const focus = saved.parts.find((p) => p.id === activeId) || saved.parts[saved.parts.length - 1];
      if (focus) {
        focusPartHistory(focus.id, scripts[focus.id] || '');
        suppressPartSaveRef.current = false;
        setCurrentFilename(focus.name);
        revealPartOnRibbon(focus.id, scripts[focus.id] || '');
        codeEditorRef.current?.loadContent(scripts[focus.id] || '', focus.id, false);
      }
      return { status: 'inserted', count: planned.additions.length, sourceName: planned.sourceName };
    } catch (err) {
      return gitOpCatchResult(err, 'Could not insert parts');
    }
  };

  /**
   * Open a v2 vault part by id into the working copy: the same row loader
   * and reference insert the agent's `open_part` uses. A part already in
   * the document is focused; a new row joins by reference (same id, same
   * `parts/<id>.js`). `name` is the title the Open dialog resolved; without
   * it the row takes the script's `// @name` header. No git write.
   */
  const openV2VaultPart = async (partId, { name = '' } = {}) => {
    const existing = findPartById(assemblyRef.current, partId);
    const loaded = await loadVaultPartRows({ partId });
    if (loaded.error) {
      return { status: 'error', code: loaded.error.code, error: loaded.error.message };
    }
    const label = String(name || '').trim();
    const rows = loaded.rows.map((row) => (
      row.id === partId && !existing && label ? { ...row, name: label } : row
    ));
    const inserted = await insertReferencedParts({ rows });
    if (inserted.error) {
      return { status: 'error', code: inserted.error.code, error: inserted.error.message };
    }
    storeRollbackAnchor(String(partId), undefined);
    return { status: 'opened', path: partIdPath(partId), id: partId, mode: existing ? 'focus' : 'reference' };
  };

  /**
   * G11: open/add a single vault part into the current assembly.
   * `parts/<id>.js` (v2) opens by that id; a v1 folder path is remapped
   * and linked as before.
   */
  const handleOpenVaultPart = async (path, meta = {}) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    const v2Part = parseIdPath(path);
    if (v2Part?.kind === 'part') {
      try {
        return await openV2VaultPart(v2Part.id, meta);
      } catch (err) {
        return gitOpCatchResult(err, 'Could not open part');
      }
    }
    try {
      const vault = await ensureGitVault({ create: false });
      const branch = gitWorkingBranch();
      const got = await readVaultPart(gitAdapterRef.current, vault.repo, path, branch);
      if (!got) return { status: 'error', error: `Missing in vault: ${path}` };
      // Own folder: reference. Another assembly or loose parts/: linked, not copied.
      const plan = planOpenVaultPart(doc, got.path, got.content, partScriptsRef.current);
      const id = plan.id;
      // Reuse add-existing path when already allowed / remapped.
      const live = codeEditorRef.current?.getContent?.();
      const prev = doc.activeId;
      const scripts = { ...partScriptsRef.current };
      if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
        scripts[prev] = live;
        savePartScript(prev, live);
        stashPartHistory(prev, live);
      }
      // Focusing a part already in the document keeps its live script.
      const content = plan.mode === 'focus' || plan.mode === 'reuse-copy' ? (scripts[id] ?? got.content) : got.content;
      scripts[id] = content;
      const existing = doc.parts.some((part) => part.id === id);
      const header = readSurfId(content);
      const parts = existing
        ? doc.parts
        : [...doc.parts, {
          id,
          name: id.split('/').pop()?.replace(/\.js$/i, '') || id,
          visible: true,
          order: doc.parts.length,
          ...(header ? { surfId: header } : {}),
        }];
      const nextDoc = { ...doc, source: 'git', activeId: id, parts };
      rememberScripts(scripts);
      rememberAssembly(nextDoc);
      await savePartScript(id, content);
      refreshGenRef.current += 1;
      focusPartHistory(id, content);
      suppressPartSaveRef.current = false;
      storeRollbackAnchor(String(id), undefined);
      setCurrentFilename(id.split('/').pop() || id);
      revealPartOnRibbon(id, content);
      codeEditorRef.current?.loadContent(content, id, false);
      return { status: 'opened', path: id, mode: plan.mode };
    } catch (err) {
      return gitOpCatchResult(err, 'Could not open part');
    }
  };

  /** Copy a linked external part into this assembly (new id, copiedFrom). */
  const handleCopyPartToAssembly = async (partId) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return { status: 'error', error: 'Not in Git mode' };
    const part = (doc.parts || []).find((row) => row.id === partId);
    if (!part) return { status: 'error', error: 'Part not in assembly' };
    const script = partScriptsRef.current[partId] ?? '';
    const plan = planCopyToAssembly(doc, part, script);
    const scripts = { ...partScriptsRef.current, [plan.id]: plan.content };
    delete scripts[partId];
    const parts = doc.parts.map((row) => (row.id === partId ? {
      ...row,
      id: plan.id,
      name: plan.name,
      surfId: plan.surfId,
      path: undefined,
      copiedFrom: plan.copiedFrom || undefined,
      isSynced: false,
    } : row));
    const activeId = doc.activeId === partId ? plan.id : doc.activeId;
    const groups = replaceGroupPartId(doc.groups, partSurfId(part), plan.surfId);
    const nextDoc = { ...doc, source: 'git', activeId, parts, groups };
    rememberAssembly(nextDoc);
    rememberScripts(scripts);
    await savePartScript(plan.id, plan.content, { isSynced: false });
    await deletePartScript(partId);
    rekeyRuntime([{ from: partId, to: plan.id }]);
    if (doc.activeId === partId) {
      focusPartHistory(plan.id, plan.content);
      setCurrentFilename(plan.name);
      codeEditorRef.current?.loadContent(plan.content, plan.name, false);
    }
    return { status: 'copied', path: plan.path, surfId: plan.surfId, copiedFrom: plan.copiedFrom };
  };

  const handleRenameGroup = async (groupId, name) => {
    const doc = assemblyRef.current;
    if (!doc) return { status: 'error', error: 'No assembly' };
    const before = (doc.groups || []).find((group) => group.id === groupId)?.name;
    const next = renameGroup(doc, groupId, name);
    const after = (next.groups || []).find((group) => group.id === groupId)?.name;
    if (!after || after === before) return { status: 'unchanged' };
    rememberAssembly(next);
    return { status: 'renamed', name: after };
  };

  const handleUngroup = async (groupId) => {
    const doc = assemblyRef.current;
    if (!doc) return { status: 'error', error: 'No assembly' };
    const group = (doc.groups || []).find((row) => row.id === groupId);
    if (!group) return { status: 'error', error: 'Group not found' };
    const next = ungroupParts(doc, groupId);
    rememberAssembly(next);
    return { status: 'ungrouped', name: group.name };
  };

  /** Copy every linked member of a group into this assembly. The group stays. */
  const handleCopyGroup = async (groupId) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return { status: 'error', error: 'Not in Git mode' };
    const group = (doc.groups || []).find((row) => row.id === groupId);
    if (!group) return { status: 'error', error: 'Group not found' };
    const result = copyGroupToAssembly(doc, partScriptsRef.current, groupId);
    if (!result.copies.length) return { status: 'noop', name: group.name };
    rememberScripts(result.scripts);
    rememberAssembly(result.doc);
    for (const copy of result.copies) {
      await savePartScript(copy.id, copy.content);
      await deletePartScript(copy.from);
    }
    rekeyRuntime(result.copies.map((copy) => ({ from: copy.from, to: copy.id })));
    const saved = assemblyRef.current;
    const activeCopy = result.copies.find((copy) => copy.id === saved?.activeId);
    if (activeCopy) {
      focusPartHistory(activeCopy.id, activeCopy.content);
      setCurrentFilename(activeCopy.name);
      codeEditorRef.current?.loadContent(activeCopy.content, activeCopy.name, false);
    }
    return { status: 'copied', count: result.copies.length, name: group.name };
  };

  /**
   * Drop the group's parts from this assembly. Linked files stay in the
   * vault: the outbox write is the assembly file only, never a file delete.
   */
  const handleRemoveGroup = async (groupId) => {
    const doc = assemblyRef.current;
    if (!doc || groupId == null) return { status: 'error', error: 'No assembly' };
    const { doc: nextDoc, removed } = removeGroupParts(doc, groupId);
    if (!removed.length) return { status: 'empty' };
    refreshGenRef.current += 1;
    const drop = new Set(removed.map((part) => part.id));
    const live = codeEditorRef.current?.getContent?.();
    const prevActive = doc.activeId;
    const deletingActive = drop.has(prevActive);
    let scripts = { ...partScriptsRef.current };
    if (!deletingActive && prevActive && !suppressPartSaveRef.current && typeof live === 'string') {
      scripts[prevActive] = live;
      savePartScript(prevActive, live);
    }
    if (deletingActive) {
      partSaveEpochRef.current += 1;
      suppressPartSaveRef.current = true;
    }
    for (const part of removed) {
      scripts = dropPartRecord(scripts, part.id);
    }
    rememberScripts(scripts);
    const saved = rememberAssembly(nextDoc);
    for (const part of removed) {
      deletePartScript(part.id);
      dropPartHistory(part.id);
      delete partLeftoversRef.current[part.id];
    }
    let runs = partRunsRef.current;
    for (const part of removed) runs = dropPartRecord(runs, part.id);
    commitPartRuns(runs);
    const nextActive = saved.activeId;
    if ([...drop].some((id) => cadPartIdRef.current === id)) rememberCadPart(nextActive);
    const nextPart = saved.parts.find((row) => row.id === nextActive);
    const nextRun = nextActive ? runs[nextActive] : null;
    if (deletingActive && nextRun?.ok && nextRun.mesh?.vertProperties) {
      viewportRef.current?.adoptActiveSolid?.({
        mesh: nextRun.mesh,
        position: partPosition(nextPart) || [0, 0, 0],
        placement: placementForMesh(nextPart),
        partId: nextActive,
      });
    }
    viewportRef.current?.placeAssembly?.({
      solids: composeViewportParts(saved, runs),
      leftovers: leftoverPickSolids(saved, runs, partLeftoversRef.current),
      activeId: deletingActive && !(nextRun?.ok && nextRun.mesh) ? null : nextActive,
      blankActive: (deletingActive && !(nextRun?.ok && nextRun.mesh?.vertProperties)) || !nextActive,
      failedIds: failedPartIdsFor(saved, runs),
    });
    if (!nextActive) {
      applyPartHistory({ commits: [], head: -1 });
      const note = '// No parts.\n';
      setCurrentFilename(null);
      saveEditorDraft({ script: note, filename: null, partId: null });
      codeEditorRef.current?.setTextOnly?.(note);
      setCurrentScript(note);
      return { status: 'removed', count: removed.length };
    }
    if (!deletingActive) {
      refreshAssemblyRef.current?.(live, { persistActive: !suppressPartSaveRef.current });
      return { status: 'removed', count: removed.length };
    }
    setCurrentFilename(nextPart?.name || null);
    const picked = scriptForRow(saved, scripts, nextActive);
    focusPartHistory(nextActive, picked.ok ? picked.script : '');
    if (picked.ok) {
      suppressPartSaveRef.current = false;
      if (codeEditorRef.current?.loadContent) {
        codeEditorRef.current.loadContent(picked.script, nextPart?.name || 'Part', false);
      } else {
        setCurrentScript(picked.script);
        refreshAssemblyRef.current?.(picked.script);
      }
    } else {
      const note = '// This part has no file yet.\n';
      codeEditorRef.current?.setTextOnly?.(note);
      setCurrentScript(note);
      refreshAssemblyRef.current?.(undefined, { persistActive: false });
    }
    return { status: 'removed', count: removed.length };
  };

  const handleRenameRetry = async () => {
    const notice = renameNotice;
    if (!notice?.opId || !gitVaultRef.current?.repo) return;
    await gitSync().requeue(notice.opId);
    setRenameNotice(null);
    setPartSync({ ...gitSync().partStates() });
    await flushGitOps();
  };

  const handleRenameRevert = async () => {
    const notice = renameNotice;
    if (!notice?.opId) {
      setRenameNotice(null);
      return;
    }
    const op = gitSync().ops().find((row) => row.id === notice.opId);
    await gitSync().drop(notice.opId);
    const before = op?.payload?.before;
    if (op?.payload?.pairs?.length) {
      rekeyRuntime(op.payload.pairs.map((pair) => ({ from: pair.to, to: pair.from })));
    }
    if (before?.cache && gitVaultRef.current?.repo) {
      await gitSync().putTree(gitVaultRef.current.repo, op.branch || gitWorkingBranch(), before.cache);
    }
    if (before?.doc) {
      const scripts = before.scripts || {};
      rememberScripts(scripts);
      rememberAssembly(before.doc);
      for (const [path, text] of Object.entries(scripts)) savePartScript(path, text);
      if (before.baseline !== undefined) rememberGitBaseline(before.baseline);
      noteRecentAssembly(before.doc.name);
      const active = before.doc.parts?.find((part) => part.id === before.doc.activeId)
        || before.doc.parts?.[0];
      if (active) {
        setCurrentFilename(active.name);
        const text = scripts[active.id] ?? '';
        codeEditorRef.current?.loadContent(text, active.name, false);
      } else {
        showEmptyAssembly();
      }
    }
    setRenameNotice(null);
    setPartSync({ ...gitSync().partStates() });
  };

  /**
   * G11 / git_branch_create: create a branch from the current working tip
   * and switch onto it when the working copy is clean (Parts Create).
   * Dirty Create leaves the session on the current branch so unsaved edits
   * are not discarded; Switch still confirms then reloads.
   * A failed switch still returns status 'created' with switched: false and
   * switchError (the ref exists; the session did not move).
   */
  const handleCreateBranch = async (branchName) => {
    try {
      const vault = await ensureGitVault();
      const from = gitWorkingBranch();
      const created = await createVaultBranch(
        gitAdapterRef.current, vault.repo, branchName,
        { fromBranch: from },
      );
      const doc = assemblyRef.current;
      // A new ref at the same SHA carries the same AssemblyCommit. Copy it
      // before switch so v2 chrome / confirm gates are not "first-commit dirty"
      // on a branch that has no lastCommit row yet.
      if (isV2PlanSaveDoc(doc) && vault.repo && created?.sha) {
        const store = gitSync();
        await store.ready();
        const fromTip = store.getBranchTip(vault.repo, from);
        if (!fromTip?.tipSha || fromTip.tipSha === created.sha) {
          const tip = makeBranchTip({
            repo: vault.repo,
            branch: created.name,
            tipSha: created.sha,
          });
          if (tip) await store.putBranchTip(vault.repo, created.name, tip);
          const commit = store.getAssemblyCommit(vault.repo, from, doc.id);
          if (commit) await store.putAssemblyCommit(vault.repo, created.name, commit);
        }
      }
      if (!shouldSwitchToCreatedBranch({ dirty: isGitWorkingCopyDirty() })) {
        return {
          status: 'created',
          branch: created.name,
          sha: created.sha,
          switched: false,
        };
      }
      const switched = await handleSwitchBranch(created.name);
      if (switched.status === 'error') {
        return {
          status: 'created',
          branch: created.name,
          sha: created.sha,
          switched: false,
          switchError: switched.error || 'Could not switch to the new branch',
        };
      }
      return {
        status: 'created',
        branch: created.name,
        sha: created.sha,
        switched: true,
      };
    } catch (err) {
      return gitOpCatchResult(err, 'Could not create branch');
    }
  };

  /**
   * Branch pane closed: if a vault baseline is active but IndexedDB local:
   * rows leaked into the Parts list, strip them. Keeps repo-path rows (including
   * dirty / Add-to-Repo paths). No-op when clean or when there is no baseline.
   */
  const handleBranchUiClose = () => {
    const doc = assemblyRef.current;
    const baseline = gitBaselineRef.current;
    if (!doc || doc.source !== 'git' || !baseline?.headSha) return;
    const leaked = doc.parts.filter((part) => String(part.id).startsWith('local:'));
    if (!leaked.length) return;
    const nextParts = doc.parts.filter((part) => !String(part.id).startsWith('local:'));
    if (!nextParts.length) return;
    const scripts = { ...partScriptsRef.current };
    for (const part of leaked) {
      delete scripts[part.id];
      try { deletePartScript(part.id); } catch { /* ignore */ }
      dropPartHistory(part.id);
    }
    rememberScripts(scripts);
    let activeId = doc.activeId;
    if (!nextParts.some((part) => part.id === activeId)) {
      activeId = nextParts[0].id;
    }
    refreshGenRef.current += 1;
    const saved = rememberAssembly({ ...doc, source: 'git', activeId, parts: nextParts });
    const focus = saved.parts.find((part) => part.id === saved.activeId) || saved.parts[0];
    if (focus) {
      const picked = scriptForRow(saved, scripts, focus.id);
      focusPartHistory(focus.id, picked.ok ? picked.script : '');
      setCurrentFilename(focus.name);
      if (picked.ok) {
        suppressPartSaveRef.current = false;
        codeEditorRef.current?.loadContent(picked.script, focus.name, false);
      } else {
        suppressPartSaveRef.current = true;
        codeEditorRef.current?.setTextOnly?.('// This part has no file yet.\n');
        refreshAssemblyRef.current?.(undefined, { persistActive: false });
      }
    }
  };

  /** G11: delete a branch (refuses main + current). */
  const handleDeleteBranch = async (branchName) => {
    const current = gitWorkingBranch();
    if (!canDeleteVaultBranch(branchName, { current })) {
      return { status: 'error', error: 'Cannot delete the current branch or main' };
    }
    try {
      const vault = await ensureGitVault();
      await deleteVaultBranch(gitAdapterRef.current, vault.repo, branchName, { current });
      return { status: 'deleted', branch: branchName };
    } catch (err) {
      return gitOpCatchResult(err, 'Could not delete branch');
    }
  };

  /**
   * Open GitHub compare/PR URL for merging `head` into `base` (default main).
   * Used when squash is not clean (Resolve on Git).
   */
  const handleMergeBranch = ({ head = null, base = 'main' } = {}) => {
    const vault = gitVaultRef.current;
    const headBranch = head || gitWorkingBranch();
    if (!vault?.repo) return { status: 'error', error: 'No repo' };
    if (!headBranch || headBranch === base) {
      return { status: 'error', error: 'Pick a branch other than the merge base' };
    }
    const url = githubCompareUrl(vault.repo, { base, head: headBranch });
    if (!url) return { status: 'error', error: 'Could not build compare URL' };
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return { status: 'opened', url, base, head: headBranch };
  };

  /**
   * Squash current (or given) side branch into main when clean; otherwise
   * return conflict so the UI can offer Resolve on Git.
   */
  const handleSquashMerge = async ({ head = null, base = 'main' } = {}) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    const headBranch = head || gitWorkingBranch();
    if (!headBranch || headBranch === base) {
      return { status: 'error', error: 'Already on the merge target' };
    }
    try {
      const vault = await ensureGitVault();
      const result = await squashMergeVaultBranch(gitAdapterRef.current, vault.repo, {
        head: headBranch,
        base,
      });
      if (result.status === 'conflict') {
        return result;
      }
      if (result.status === 'merged' || result.status === 'up-to-date') {
        if (result.status === 'merged') {
          gitVaultRef.current = { ...vault, headSha: result.sha };
        }
        // Land working copy on base after merge.
        const switched = await handleSwitchBranch(base);
        if (switched.status === 'error') {
          return { ...result, switchError: switched.error };
        }
        return { ...result, switched: switched.status };
      }
      return result;
    } catch (err) {
      return gitOpCatchResult(err, 'Merge failed');
    }
  };

  /**
   * Save queues one commit on the current branch. The sync worker pushes it.
   * A moved tip returns conflict (G13) and writes nothing.
   */
  const applyMeshPlacement = async (placed) => {
    if (!placed?.moved?.length) return;
    for (const { from, to } of placed.moved) {
      const text = placed.scripts[to] ?? '';
      const prev = partMeshMetaRef.current[from];
      await savePartScript(to, text, prev
        ? { assets: prev.assets, meshSynced: prev.meshSynced === true, isSynced: false }
        : { isSynced: false });
      try { await deletePartScript(from); } catch { /* the new id is the record */ }
      if (prev?.assets) rememberPartAssets(to, prev.assets);
      forgetPartAssets(from);
    }
    const nextMeta = { ...partMeshMetaRef.current };
    for (const { from, to } of placed.moved) {
      if (!nextMeta[from]) continue;
      nextMeta[to] = nextMeta[from];
      delete nextMeta[from];
    }
    partMeshMetaRef.current = nextMeta;
    setPartMeshMeta(nextMeta);
    rekeyRuntime(placed.moved);
    rememberScripts(placed.scripts);
    rememberAssembly(placed.doc);
    const active = placed.doc.activeId;
    if (placed.moved.some((move) => move.to === active)) {
      const text = placed.scripts[active] ?? '';
      const name = placed.doc.parts.find((part) => part.id === active)?.name || active;
      focusPartHistory(active, text);
      setCurrentFilename(name);
      codeEditorRef.current?.loadContent(text, name, false);
    }
  };

  const v2WorkingCopy = async (doc) => {
    const live = codeEditorRef.current?.getContent?.();
    let scripts = { ...partScriptsRef.current };
    if (!suppressPartSaveRef.current && typeof live === 'string' && doc.activeId) {
      scripts[doc.activeId] = live;
    }
    scripts = normalizeInstanceScripts(scripts, doc);
    const loaded = await loadPartAssets((doc.parts || []).map((part) => part.id));
    const meshes = meshesFromPartRecords({
      ...loaded,
      ...partMeshMetaRef.current,
    });
    const sidecar = gitSidecarRef.current;
    return {
      doc,
      scripts,
      meshes,
      now: Date.now(),
      deleteFromRepo: deleteFromRepoIdsFromPaths(sidecar?.pendingDeletes),
    };
  };

  const adoptV2SaveResult = async (result, { repo, branch, create }) => {
    if (result?.kind === 'delete-assembly') {
      if (result.status === 'pending') {
        setUploadNotice(SAVE_QUEUED_COPY);
        return { ...result, status: 'queued' };
      }
      if (result.status !== 'committed') return result;
      if (repo && result.sha) {
        gitVaultRef.current = {
          ...(gitVaultRef.current || {}),
          repo,
          headSha: result.sha,
        };
      }
      const openId = assemblyRef.current?.id;
      if (!result.assemblyId || !openId || result.assemblyId === openId) {
        try {
          await seedAgentAssembly({});
        } catch { /* the commit already removed the assembly file */ }
      }
      return result;
    }
    if (result?.kind === 'delete-part') {
      if (result.status === 'pending') {
        setUploadNotice(SAVE_QUEUED_COPY);
        return { ...result, status: 'queued' };
      }
      if (result.status !== 'committed') return result;
      if (repo && result.sha) {
        gitVaultRef.current = {
          ...(gitVaultRef.current || {}),
          repo,
          headSha: result.sha,
        };
      }
      const partId = result.partId;
      const cur = assemblyRef.current;
      const row = partId
        ? (cur?.parts || []).find((item) => item.id === partId || partDefinitionId(item) === partId)
        : null;
      if (row) await handleDeletePart(row.id);
      return result;
    }
    if (result.status === 'pending') {
      setUploadNotice(SAVE_QUEUED_COPY);
      return { ...result, status: 'queued' };
    }
    if (result.status === 'conflict') {
      return result;
    }
    if (result.status !== 'committed' && result.status !== 'clean' && result.status !== 'branched') {
      return result;
    }
    if (repo) {
      gitVaultRef.current = {
        ...(gitVaultRef.current || {}),
        repo,
        defaultBranch: gitVaultRef.current?.defaultBranch || 'main',
        headSha: result.sha || gitVaultRef.current?.headSha || null,
        private: gitVaultRef.current?.private !== false,
      };
      if (create && !gitVaultRef.current.repo) gitVaultRef.current.repo = repo;
    }
    const nextBranch = result.branch || branch;
    const savedDoc = assemblyRef.current;
    const live = codeEditorRef.current?.getContent?.();
    let savedScripts = { ...(partScriptsRef.current || {}) };
    if (savedDoc?.activeId && typeof live === 'string' && !suppressPartSaveRef.current) {
      savedScripts[savedDoc.activeId] = live;
    }
    if (savedDoc) savedScripts = normalizeInstanceScripts(savedScripts, savedDoc);
    if (result.status === 'committed' || result.status === 'branched') {
      const prevBaseline = gitBaselineRef.current;
      const writes = (result.files || []).filter((file) => (
        file && typeof file === 'object' && typeof file.path === 'string'
      ));
      const committed = {};
      const asmPath = savedDoc && isV2SurfId(savedDoc.id)
        ? assemblyIdPath(savedDoc.id)
        : prevBaseline?.assemblyPath;
      let assemblyWritten = false;
      for (const file of writes) {
        if (file.delete) continue;
        if (asmPath && file.path === asmPath) assemblyWritten = true;
        if (typeof file.content !== 'string') continue;
        const parsed = parseIdPath(file.path);
        if (parsed?.kind === 'part') committed[parsed.id] = file.content;
      }
      if (savedDoc) {
        rememberGitBaseline(baselineAfterPartSave(prevBaseline, {
          doc: savedDoc,
          saved: committed,
          assemblyPath: asmPath,
          assemblyName: savedDoc.name,
          assets: prevBaseline?.assets ?? null,
          branch: nextBranch || prevBaseline?.branch || 'main',
          headSha: result.sha || prevBaseline?.headSha || null,
          assemblyWritten,
        }));
        const nextSnap = { ...(agentScriptSnapshotRef.current || {}) };
        for (const part of savedDoc.parts || []) {
          const id = part.id;
          const def = partDefinitionId(part);
          const liveText = savedScripts[def] ?? savedScripts[id];
          const committedText = committed[def] ?? committed[id];
          if (typeof committedText !== 'string' || typeof liveText !== 'string') continue;
          const stampName = definitionStampName(savedDoc.parts, def) ?? part.name;
          if (partScriptMatchesCommitted(liveText, committedText, def, stampName)) {
            nextSnap[id] = liveText;
            if (def !== id) nextSnap[def] = liveText;
          }
        }
        agentScriptSnapshotRef.current = nextSnap;
        agentSnapshotDocKeyRef.current = agentSnapshotDocKey(savedDoc);
      } else if (result.sha && repo) {
        rememberGitBaseline(firstCommitBaseline({
          branch: nextBranch || 'main',
          headSha: result.sha,
        }));
      }
      await clearWorkingCopySidecar();
      rememberGitBehind(null, { showToast: false, resetResolved: true });
      setGitBehindToast(null);
      setPlanSaveConflict(null);
      track('git_saved');
    }
    if (savedDoc) {
      // Explicit Save / Move to Git must land in IndexedDB even during reauth
      // (playtest mock has no GitHub token). Do not replace row ids from
      // committed paths — the WC ids stay opaque.
      const synced = markPartsSynced(
        savedDoc,
        (savedDoc.parts || []).map((part) => part.id),
      );
      rememberAssembly(synced.changed ? synced.doc : savedDoc, { force: true });
      for (const [id, text] of Object.entries(savedScripts)) {
        if (typeof text === 'string') await savePartScript(id, text, { isSynced: true });
      }
    }
    if (result.partStillReferenced?.length) {
      const names = result.partStillReferenced
        .map((row) => row.assemblies?.map((item) => item.name || item.id).filter(Boolean).join(', '))
        .filter(Boolean);
      if (names.length) {
        setUploadNotice(`Part file kept; still referenced by ${names.join('; ')}.`);
      }
    }
    return {
      ...result,
      files: (result.files || []).map((file) => (
        file && typeof file === 'object' && typeof file.path === 'string' ? file.path : file
      )),
    };
  };

  const handleV2PlanSave = async (message, { force = false, vaultName } = {}) => {
    const doc = assemblyRef.current;
    if (!isV2PlanSaveDoc(doc)) return { status: 'error', error: 'Not a v2 git assembly' };
    const adapter = ensureGitAdapter();
    if (!meshVaultSaveAllowed({
      source: doc.source,
      readOnly: bootReadOnlyRef.current,
      githubConnected,
      adapterKind: adapter?.kind,
    })) {
      return { status: 'error', error: 'Reconnect GitHub before saving this assembly.' };
    }
    const msg = typeof message === 'string' ? message.trim() : '';
    if (msg) v2SaveMessageRef.current = msg;
    try {
      const { vault, create } = await resolveVaultForPlanSave({ vaultName });
      const branch = gitWorkingBranch();
      const store = gitSync();
      const workingCopy = await v2WorkingCopy(doc);
      workingCopy.repo = vault.repo;
      workingCopy.branch = branch;
      workingCopy.saveTarget = { repo: vault.repo, branch };
      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const result = await gitTimings.measure('save', () => executePlanSave({
        adapter: gitAdapterRef.current,
        repo: vault.repo,
        branch,
        store,
        workingCopy,
        message: msg || v2SaveMessageRef.current,
        force,
        create,
        online,
      }));
      return adoptV2SaveResult(result, { repo: vault.repo, branch, create });
    } catch (err) {
      const tooBig = err?.code === 'file_too_large' || err?.name === 'VaultFileTooLargeError';
      const text = err.toast || err.message || 'Commit failed';
      if (tooBig || err.toast || err.code === VAULT_TREE_UNAVAILABLE) setUploadError(text);
      return {
        status: 'error',
        error: text,
        code: err.code || null,
        ...githubSaveErrorFields(err),
      };
    }
  };

  const handlePlanSaveConflict = async ({ action, paths, message } = {}) => {
    const doc = assemblyRef.current;
    if (!isV2PlanSaveDoc(doc)) {
      return { status: 'error', error: 'Not a v2 git assembly' };
    }
    if (action === 'dismiss') {
      setPlanSaveConflict(null);
      return { status: 'dismissed' };
    }
    try {
      const { vault } = await resolveVaultForPlanSave();
      const branch = gitWorkingBranch();
      const store = gitSync();
      const workingCopy = await v2WorkingCopy(doc);
      workingCopy.repo = vault.repo;
      workingCopy.branch = branch;
      workingCopy.saveTarget = { repo: vault.repo, branch };
      const result = await executePlanSaveConflictChoice({
        action,
        adapter: gitAdapterRef.current,
        repo: vault.repo,
        branch,
        store,
        workingCopy,
        message: (typeof message === 'string' && message.trim()) || v2SaveMessageRef.current,
        paths: paths || planSaveConflict?.paths || [],
      });
      if (result.status === 'reloaded' && result.contents) {
        const applied = applySaveReload(assemblyRef.current, partScriptsRef.current, result.contents);
        rememberScripts(applied.scripts);
        if (applied.doc) rememberAssembly(applied.doc);
        for (const [id, script] of Object.entries(applied.scripts || {})) {
          if (typeof script === 'string') await savePartScript(id, script);
        }
        const active = applied.doc?.parts?.find((part) => part.id === applied.doc.activeId)
          || applied.doc?.parts?.[0];
        if (active && typeof applied.scripts[active.id] === 'string') {
          focusPartHistory(active.id, applied.scripts[active.id]);
          setCurrentFilename(active.name);
          setCurrentScript(applied.scripts[active.id]);
          codeEditorRef.current?.loadContent(applied.scripts[active.id], active.name, false);
        }
        setPlanSaveConflict(null);
        return result;
      }
      if (result.status === 'dismissed') {
        setPlanSaveConflict(null);
        return result;
      }
      return adoptV2SaveResult(result, { repo: vault.repo, branch, create: false });
    } catch (err) {
      return gitOpCatchResult(err, 'Could not resolve');
    }
  };

  /**
   * A git document always carries `vaultLayout`. One persisted before the
   * stamp, or a local document that went git on connect, gets it from the
   * vault here: surfcad.json v2 → 'v2', a v1 tree → 'legacy', no repo yet →
   * 'v2' (the first Save creates a v2 vault). Read-only; nothing is written.
   */
  const ensureDocVaultLayout = async () => {
    const doc = assemblyRef.current;
    if (!docNeedsVaultLayout(doc)) return doc;
    let detected = null;
    try {
      const vault = await ensureGitVault({ create: false });
      detected = await detectVaultLayout(gitAdapterRef.current, vault.repo, gitWorkingBranch());
    } catch (err) {
      if (err?.message !== NO_REPO_YET_COPY) throw err;
    }
    const live = assemblyRef.current;
    if (!live || live.id !== doc.id || !docNeedsVaultLayout(live)) return live;
    return rememberAssembly({ ...live, vaultLayout: vaultLayoutFromDetection(detected) });
  };

  // Heal on connect and after a reload, so the Save button and the dots read
  // the document as v2 before anyone clicks Save.
  useEffect(() => {
    if (authLoading) return undefined;
    if (bootGateRef.current !== 'done') return undefined;
    if (!githubConnected || bootReadOnlyRef.current) return undefined;
    if (!docNeedsVaultLayout(assemblyRef.current)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await ensureDocVaultLayout();
      } catch (err) {
        if (!cancelled) console.warn('[git] vault layout stamp skipped', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [githubConnected, assemblyDoc, authLoading, bootEpoch, bootResume]); // eslint-disable-line react-hooks/exhaustive-deps -- vault helpers via refs

  const handleGitCommit = async (message) => {
    let doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return { status: 'error', error: 'Not in Git mode' };
    const adapter = ensureGitAdapter();
    if (!meshVaultSaveAllowed({
      source: doc.source,
      readOnly: bootReadOnlyRef.current,
      githubConnected,
      adapterKind: adapter?.kind,
    })) {
      return { status: 'error', error: 'Reconnect GitHub before saving this assembly.' };
    }
    if (docNeedsVaultLayout(doc)) {
      // Never let an unstamped document reach the v1 writer; fail closed
      // when the vault cannot be read.
      try {
        doc = await ensureDocVaultLayout();
      } catch (err) {
        return gitOpCatchResult(err, 'Could not read the vault layout');
      }
      if (!doc || doc.source !== 'git') return { status: 'error', error: 'Not in Git mode' };
    }
    if (isV2PlanSaveDoc(doc)) return handleV2PlanSave(message);
    if (doc.vaultLayout === 'legacy' && upgradeVaultEnabled()) {
      return {
        status: 'upgrade_required',
        code: 'upgrade_required',
        error: 'This vault is still v1. Confirm Upgrade vault to rewrite it to v2. Nothing was written.',
        message: 'This vault is still v1. Confirm Upgrade vault to rewrite it to v2. Nothing was written.',
        hint: 'git_upgrade_vault { confirm: true } after the user agrees',
      };
    }
    try {
      const vault = await ensureGitVault({ create: true });
      const branch = gitWorkingBranch();
      const store = gitSync();
      let baseline = gitBaselineRef.current;
      const sidecar = gitSidecarRef.current;
      if (!baseline && sidecar.renameFrom && sidecar.renameFrom !== vaultSegment(doc.name)) {
        try {
          const tip = (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha || vault.headSha || null;
          const opened = await openNamedVaultAssembly(
            gitAdapterRef.current,
            vault.repo,
            sidecar.renameFrom,
            { branch, headSha: tip, pathIndex: store.pathIndexFor(vault.repo) },
          );
          baseline = opened.baseline;
        } catch (err) {
          console.warn('[git] rename-from baseline skipped', err?.message || err);
        }
      }
      if (!baseline) {
        const head = (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha || vault.headSha || null;
        baseline = firstCommitBaseline({ branch, headSha: head });
        if (head && !store.getLastSyncedSha(vault.repo, branch)) {
          await store.setLastSyncedSha(vault.repo, head, branch);
        }
      }
      const live = codeEditorRef.current?.getContent?.();
      let liveId = (!suppressPartSaveRef.current && typeof live === 'string') ? doc.activeId : null;
      let workScripts = { ...partScriptsRef.current };
      if (liveId) workScripts[liveId] = live;
      const tree = await listVaultTree(gitAdapterRef.current, vault.repo, branch);
      const remotePaths = tree.map((entry) => entry?.path ?? entry).filter((path) => typeof path === 'string');
      const placed = placeLocalMeshParts(doc, workScripts, {
        occupied: remotePaths,
      });
      const scriptsBeforeWrap = placed.scripts;
      const movedLive = placed.moved.find((move) => move.from === liveId);
      const nextLiveId = movedLive ? movedLive.to : liveId;
      const wrapIds = dirtyPartIds(placed.doc, scriptsBeforeWrap, baseline, {
        liveId: nextLiveId,
        liveScript: nextLiveId ? scriptsBeforeWrap[nextLiveId] : null,
      });
      workScripts = wrapUnmarkedPartScripts(scriptsBeforeWrap, wrapIds);
      const wrappedChanged = Object.keys(workScripts).some(
        (id) => workScripts[id] !== scriptsBeforeWrap[id],
      );
      const loaded = await loadPartAssets((doc.parts || []).map((part) => part.id));
      const records = remapMeshRecords({
        ...loaded,
        ...partMeshMetaRef.current,
      }, placed.moved);
      const collected = await collectMeshCommitAssets({
        doc: placed.doc,
        scripts: workScripts,
        records,
        baseline,
        tree,
      });
      const notes = [
        ...collected.warnings.map((item) => item.message),
        ...collected.skipped.map((item) => item.message),
      ].filter(Boolean);
      if (notes.length) setUploadNotice(notes.join(' '));
      const vaultDeletes = sidecarAssemblyKeys(placed.doc, sidecar).flatMap((name) => (
        store.getPendingDeletes(vault.repo, branch, name)
      ));
      const deletePaths = deletePathsForCommit(
        recordPendingDeletes(sidecar, vaultDeletes),
        placed.doc,
      );
      // Promote path-less parts once, inside assembleCommitFiles. Adopting
      // result.doc/moved is what keeps the next Save from minting -2 copies.
      const result = await assembleCommitFiles(gitAdapterRef.current, vault.repo, {
        doc: placed.doc,
        scripts: workScripts,
        baseline,
        message,
        liveId: nextLiveId,
        liveScript: nextLiveId ? workScripts[nextLiveId] : null,
        assets: collected.assets,
        remotePaths,
        deletePaths,
      });
      await applyMeshPlacement(placed);
      if (liveId && !movedLive) {
        const savedLive = workScripts[liveId] ?? live;
        savePartScript(liveId, savedLive);
        rememberScripts(workScripts);
      }
      const adopted = collected.marks.filter((mark) => mark.adopted);
      if (adopted.length) await applyMeshMarks(adopted);
      if (result.status === 'clean') return result;
      if (result.doc || wrappedChanged) {
        await applyCommittedWorkspace(result);
        captureAgentScriptSnapshot();
      }
      await enqueueGit(vault.repo, {
        op: 'save',
        branch,
        message: result.message || message,
        partIds: result.partIds?.length
          ? result.partIds
          : (result.doc?.parts || placed.doc.parts || []).map((part) => part.id),
        files: result.files,
        payload: {
          assemblyPath: result.assemblyPath,
          renamed: !!result.renamed,
          moved: result.moved || [],
          meshes: collected.marks.filter((mark) => !mark.adopted),
        },
      });
      setPartSync({ ...store.partStates() });
      const flushed = await flushGitOps({ surfaceConflict: false });
      if (flushed?.status === 'conflict') {
        setSyncConflict(null);
        setUploadError(null);
        setRepoSaved(null);
        setRepoMoved({
          kind: 'assembly',
          files: result.files,
          message: result.message,
          doc: result.doc || assemblyRef.current,
          scripts: result.scripts || { ...partScriptsRef.current },
          baseSha: flushed.lastSyncedSha || flushed.baseSha || baseline.headSha,
          fromBranch: flushed.branch || branch,
          partIds: result.partIds?.length
            ? result.partIds
            : (placed.doc.parts || []).map((part) => part.id),
          opIds: store.pending(vault.repo, branch).map((op) => op.id),
        });
        return { status: 'repo-moved', code: 'non_fast_forward' };
      }
      if (flushed?.status === 'failed') {
        return { status: 'error', error: flushed.error || 'Save failed' };
      }
      if (flushed?.status === 'offline') {
        setUploadNotice(SAVE_QUEUED_COPY);
        track('git_saved');
        return { status: 'queued', branch, files: (result.files || []).map((file) => file.path) };
      }
      await clearWorkingCopySidecar();
      rememberGitBehind(null, { showToast: false, resetResolved: true });
      setGitBehindToast(null);
      track('git_saved');
      return {
        status: 'committed',
        sha: flushed?.sha,
        branch,
        files: (result.files || []).map((file) => file.path),
      };
    } catch (err) {
      const tooBig = err?.code === 'file_too_large' || err?.name === 'VaultFileTooLargeError';
      const message = err.toast || err.message || 'Commit failed';
      if (tooBig || err.toast || err.code === VAULT_TREE_UNAVAILABLE) setUploadError(message);
      return {
        status: 'error',
        error: message,
        code: err.code || null,
        stray: Array.isArray(err.stray) ? err.stray : null,
        ...githubSaveErrorFields(err),
      };
    }
  };

  /**
   * Crash-safe Upgrade re-key: snapshot was taken from IDB, then persist
   * writes `to` and saveDoc before deleting `from`.
   */
  const persistUpgradeWorkingCopy = async ({
    nextDoc,
    nextScripts,
    pairs = [],
    sourceDoc,
    sourceScripts,
    partAssets = null,
  }) => {
    const persisted = await persistCollapsedWorkingCopy({
      collapsed: { doc: nextDoc, scripts: nextScripts, pairs },
      sourceDoc,
      sourceScripts,
      heldScripts: sourceScripts,
      save: async (id, script) => {
        const part = (nextDoc.parts || []).find((row) => row.id === id);
        const from = pairs.find((row) => row.to === id)?.from || id;
        const mesh = partAssets?.[id] || partAssets?.[from];
        return savePartScript(id, script, {
          ...(typeof part?.isSynced === 'boolean' ? { isSynced: part.isSynced } : {}),
          ...(mesh || {}),
        });
      },
      load: loadPartScript,
      remove: async (id) => {
        try { await deletePartScript(id); } catch { /* keep the new key */ }
      },
      saveDoc: saveAssemblyDocument,
      live: () => {
        const liveScripts = { ...partScriptsRef.current };
        const id = assemblyRef.current?.activeId;
        const text = codeEditorRef.current?.getContent?.();
        if (
          id
          && typeof text === 'string'
          && !suppressPartSaveRef.current
          && editorLiveRef.current
          && appModeRef.current !== 'game'
        ) {
          liveScripts[id] = text;
        }
        return liveScripts;
      },
      assemblyKey: assemblyRekeyKey(sourceDoc),
      saveJournal: saveRekeyJournal,
      clearJournal: clearRekeyJournal,
      onFlight: (flightPairs, opts) => {
        persistFlightPairsRef.current = Array.isArray(flightPairs) ? flightPairs : [];
        persistFlightToOnlyRef.current = !!(opts && opts.toOnly);
      },
      apply: ({ doc: appliedDoc, scripts: appliedScripts }) => {
        if (pairs.length) rekeyRuntime(pairs);
        rememberScripts(appliedScripts);
        rememberAssembly(appliedDoc, { persist: false });
      },
    });
    if (persisted.docSaved === false) {
      persistFlightPairsRef.current = [];
      persistFlightToOnlyRef.current = false;
      await rollbackFailedUpgradeDocSave(persisted, {
        sourceDoc,
        restore: async (id, bytes) => {
          try { await savePartScript(id, bytes); } catch { /* same-key snapshot */ }
        },
        remove: async (id) => {
          try { await deletePartScript(id); } catch { /* unreferenced to-key */ }
        },
      });
    }
    return persisted;
  };

  /**
   * Upgrade vault: one commit of remote bytes. Dirty WC → a second commit
   * inside legacyVault/ (PR 7 replaces that follow-up with planSave).
   * Never createRepo. Never flush the outbox.
   */
  const handleUpgradeVault = async ({ overwrite = false, message } = {}) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return {
        status: 'error',
        code: 'git_error',
        error: 'Not in Git mode',
        message: 'Not in Git mode',
        hint: 'Open a git-backed assembly, then retry Upgrade vault.',
      };
    }
    if (!upgradeVaultEnabled()) {
      return { ...UPGRADE_UNAVAILABLE };
    }
    try {
      const vault = await ensureGitVault({ create: false });
      const adapter = gitAdapterRef.current;
      const branch = gitWorkingBranch();
      const store = gitSync();
      const scripts = { ...partScriptsRef.current };
      const live = codeEditorRef.current?.getContent?.();
      const dirty = isUpgradeWorkingCopyDirty({
        sidecar: gitSidecarRef.current,
        doc,
        scripts,
        baseline: gitBaselineRef.current,
        liveId: doc.activeId,
        liveScript: typeof live === 'string' ? live : null,
        editorLive: editorLiveRef.current === true,
      });
      if (dirty && typeof live === 'string' && doc.activeId && editorLiveRef.current === true) {
        scripts[doc.activeId] = live;
      }
      const snapshotStatus = await loadAssemblyDocumentStatus();
      const snapshotDoc = snapshotStatus.status === 'hit' ? snapshotStatus.doc : doc;
      const snapshotIds = [...new Set([
        ...(snapshotDoc?.parts || []).map((part) => part.id),
        ...(doc.parts || []).map((part) => part.id),
      ].filter(Boolean))];
      const snapshotScripts = await loadPartScripts(snapshotIds);
      const assets = await loadPartAssets((doc.parts || []).map((part) => part.id));
      const workingCopy = { dirty, doc, scripts, assets, message };
      const result = await executeUpgrade({
        adapter,
        repo: vault.repo,
        branch,
        store,
        workingCopy,
        followupOverwrite: overwrite === true,
      });
      const adopted = await adoptUpgradeWorkingCopy({
        result,
        workingCopy,
        adapter,
        repo: vault.repo,
        branch,
        store,
        sourceDoc: snapshotDoc,
        journalPairs: reusePairsFromJournal(await loadRekeyJournal(), doc),
        persist: ({ nextDoc, nextScripts, pairs, assets: partAssets }) => persistUpgradeWorkingCopy({
          nextDoc,
          nextScripts,
          pairs,
          sourceDoc: snapshotDoc,
          sourceScripts: snapshotScripts,
          partAssets: partAssets || assets,
        }),
        restoreScripts: async (id, bytes) => {
          try { await savePartScript(id, bytes); } catch { /* same-key snapshot */ }
        },
        removeOrphans: async (ids) => {
          for (const id of ids || []) {
            try { await deletePartScript(id); } catch { /* unreferenced to-key */ }
          }
        },
      });
      if (adopted.status === 'error') {
        setUploadError(adopted.result?.error || adopted.result?.message || 'Could not save the upgraded working copy.');
        return adopted.result;
      }
      if (adopted.persisted) {
        rememberScripts(adopted.persisted.scripts);
        rememberAssembly({ ...adopted.persisted.doc, source: 'git', vaultLayout: 'v2' });
        const recapture = result.status !== 'conflict'
          && (result.status !== 'already_upgraded' || !dirty);
        if (recapture) {
          const head = (await adapter.getBranch(vault.repo, branch))?.sha || result.sha || null;
          rememberGitBaseline(captureBaseline({
            assemblyPath: assemblyFilePath(vaultSegment(adopted.persisted.doc.name) || adopted.persisted.doc.name),
            assemblyName: adopted.persisted.doc.name,
            doc: adopted.persisted.doc,
            scripts: adopted.persisted.scripts,
            assets: adopted.rekey?.assets || assets,
            branch,
            headSha: head,
          }));
          await clearWorkingCopySidecar();
        }
      } else if (result.status === 'already_upgraded') {
        rememberAssembly({ ...assemblyRef.current, vaultLayout: 'v2' });
      }
      return result;
    } catch (err) {
      if (err?.name === 'PersistCrash') {
        setUploadError('Could not save the upgraded working copy. The previous working copy was kept.');
        return workingCopyUnpersistedResult();
      }
      return gitOpCatchResult(err, 'Upgrade vault failed');
    }
  };

  /** §2.9 on the follow-up Save only. Get latest never writes git. */
  const handleUpgradeConflict = async ({ action, files, paths, message, tipSha } = {}) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return {
        status: 'error',
        code: 'git_error',
        error: 'Not in Git mode',
        message: 'Not in Git mode',
      };
    }
    try {
      const vault = await ensureGitVault({ create: false });
      const store = gitSync();
      const branch = gitWorkingBranch();
      const snapshotStatus = await loadAssemblyDocumentStatus();
      const snapshotDoc = snapshotStatus.status === 'hit' ? snapshotStatus.doc : doc;
      const snapshotIds = [...new Set((snapshotDoc?.parts || []).map((part) => part.id).filter(Boolean))];
      const snapshotScripts = await loadPartScripts(snapshotIds);
      const result = await executeUpgradeConflictChoice({
        action,
        adapter: gitAdapterRef.current,
        repo: vault.repo,
        branch,
        files,
        paths,
        message,
        store,
        assemblyId: doc.id,
        tipSha: tipSha || store.getBranchTip?.(vault.repo, branch)?.tipSha || null,
      });
      const persistConflictWorkingCopy = async (nextDoc, nextScripts, pairs = []) => {
        const persisted = await persistUpgradeWorkingCopy({
          nextDoc: { ...nextDoc, source: 'git', vaultLayout: 'v2' },
          nextScripts,
          pairs,
          sourceDoc: snapshotDoc,
          sourceScripts: snapshotScripts,
        });
        if (upgradePersistIncomplete(persisted)) {
          setUploadError('Could not save the upgraded working copy. The previous working copy was kept.');
          return workingCopyUnpersistedResult();
        }
        rememberScripts(persisted.scripts);
        rememberAssembly({ ...persisted.doc, source: 'git', vaultLayout: 'v2' });
        return persisted;
      };
      if (result.status === 'reloaded' && result.contents) {
        const applied = applyUpgradeReload(assemblyRef.current, partScriptsRef.current, result.contents);
        const nextDoc = applied.doc
          ? { ...applied.doc, vaultLayout: 'v2' }
          : { ...assemblyRef.current, vaultLayout: 'v2' };
        const persisted = await persistConflictWorkingCopy(nextDoc, applied.scripts, []);
        if (persisted.status === 'error') return persisted;
        const active = nextDoc?.parts?.find((part) => part.id === nextDoc.activeId)
          || nextDoc?.parts?.[0];
        const text = persisted.scripts?.[active?.id];
        if (active && typeof text === 'string') {
          focusPartHistory(active.id, text);
          setCurrentFilename(active.name);
          setCurrentScript(text);
          codeEditorRef.current?.loadContent(text, active.name, false);
        }
      }
      if (result.status === 'committed' || result.status === 'branched') {
        const persisted = await persistConflictWorkingCopy(
          { ...assemblyRef.current, vaultLayout: 'v2' },
          { ...partScriptsRef.current },
          [],
        );
        if (persisted.status === 'error') return persisted;
      }
      if (result.status === 'branched' && result.branch) {
        const baseline = gitBaselineRef.current;
        if (baseline) {
          rememberGitBaseline({ ...baseline, branch: result.branch, headSha: result.sha || baseline.headSha });
        }
      }
      return result;
    } catch (err) {
      return gitOpCatchResult(err, 'Upgrade follow-up failed');
    }
  };

  /**
   * Fold Overwrite main's commit into the open document so the screen
   * matches the tip and the yellow dots can clear.
   */
  const absorbOverwriteFiles = async (files) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git' || !files?.length) return;
    const applied = applyOverwriteFiles(doc, partScriptsRef.current, files);
    if (!applied.changed) return;
    rememberScripts(applied.scripts);
    const saved = rememberAssembly(applied.doc);
    const written = new Set(
      (files || [])
        .filter((file) => file?.path && !file.delete && typeof file.content === 'string')
        .map((file) => file.path),
    );
    for (const part of saved.parts || []) {
      if (!written.has(part.id)) continue;
      const text = applied.scripts[part.id];
      if (typeof text !== 'string') continue;
      await savePartScript(part.id, text, { isSynced: true });
    }
    const active = saved.parts?.find((part) => part.id === saved.activeId) || saved.parts?.[0];
    if (!active || !written.has(active.id)) return;
    const text = applied.scripts[active.id];
    if (typeof text !== 'string') return;
    focusPartHistory(active.id, text);
    suppressPartSaveRef.current = false;
    setCurrentFilename(active.name);
    setCurrentScript(text);
    codeEditorRef.current?.loadContent(text, active.name, false);
  };

  /**
   * Conflict popup → Overwrite main. The moved-tip guard stays in place for
   * Save and for a background flush. This is the explicit force-write: the
   * queued local files land on the current main tip, then the conflict and
   * the dirty dots clear. No second confirm.
   */
  const handleOverwriteMain = async () => {
    if (isV2PlanSaveDoc(assemblyRef.current)) {
      return handlePlanSaveConflict({ action: 'overwrite' });
    }
    const vault = gitVaultRef.current;
    const adapter = gitAdapterRef.current;
    if (!vault?.repo || !adapter) return { status: 'error', error: 'No repo' };
    try {
      const branch = gitWorkingBranch();
      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const result = await flushSyncQueue({
        store: gitSync(),
        adapter,
        repo: vault.repo,
        branch,
        online,
        force: true,
      });
      if (result.status === 'offline') {
        return { status: 'offline', error: 'You are offline. Local changes stay queued.' };
      }
      if (result.status !== 'synced' && result.status !== 'idle') {
        return { status: 'error', error: result.error || 'Overwrite failed' };
      }
      await absorbOverwriteFiles(result.files);
      await adoptSyncResult(result, { surfaceConflict: false });
      if (result.status === 'synced') await clearWorkingCopySidecar();
      setSyncConflict(null);
      setUploadError(null);
      return {
        status: result.status === 'idle' ? 'idle' : 'synced',
        sha: result.sha,
        branch: result.branch || branch,
      };
    } catch (err) {
      return { status: 'error', error: err?.message || 'Overwrite failed' };
    }
  };

  /**
   * Make a new branch from the local baseline and commit the save that
   * main refused. Switches the working ref so the next save goes there.
   */
  const handleSaveOnNewBranch = async () => {
    const pending = repoMoved;
    if (!pending || repoMovedBusyRef.current) return;
    repoMovedBusyRef.current = true;
    setRepoMovedBusy(true);
    try {
      const vault = await ensureGitVault({ create: true });
      const base = gitBaselineRef.current || {};
      const saved = await saveLocalOnNewBranch(gitAdapterRef.current, vault.repo, {
        doc: pending.doc,
        scripts: pending.scripts,
        baseline: { ...base, headSha: pending.baseSha || base.headSha },
        files: pending.files,
        message: pending.message,
      });
      if (saved.status !== 'committed') {
        setUploadError(saved.error || 'Could not create the branch');
        return;
      }
      const store = gitSync();
      for (const id of pending.opIds || []) {
        await store.setOpStatus(id, 'done');
      }
      const partIds = pending.partIds?.length
        ? pending.partIds
        : (pending.doc?.parts || []).map((part) => part.id);
      await store.setPartsState(vault.repo, partIds, 'clean', pending.fromBranch || 'main');
      await store.setLastSyncedSha(vault.repo, saved.sha, saved.branch);
      if (pending.doc) rememberAssembly(pending.doc);
      if (pending.scripts) {
        rememberScripts(pending.scripts);
        for (const file of pending.files || []) {
          if (file?.delete || typeof file.content !== 'string') continue;
          if (!String(file.path || '').endsWith('.js')) continue;
          await savePartScript(file.path, file.content, { isSynced: true });
        }
      }
      if (pending.fromId) {
        try { await deletePartScript(pending.fromId); } catch { /* remapped id */ }
        const active = pending.doc?.activeId;
        if (active && (pending.fromId === active || pending.doc?.parts?.some((part) => part.id === active))) {
          const text = pending.scripts?.[active] ?? '';
          focusPartHistory(active, text);
          suppressPartSaveRef.current = false;
          setCurrentFilename(String(active).split('/').pop() || active);
          codeEditorRef.current?.loadContent(text, active, false);
        }
      }
      const marked = markPartsSynced(assemblyRef.current, partIds);
      if (marked.changed) rememberAssembly(marked.doc);
      rememberGitBaseline(saved.baseline);
      gitVaultRef.current = { ...vault, headSha: saved.sha };
      setPartSync({ ...store.partStates() });
      setSyncConflict(null);
      setRepoMoved(null);
      setRepoSaved({ branch: saved.branch });
    } catch (err) {
      setUploadError(err?.message || 'Could not create the branch');
    } finally {
      repoMovedBusyRef.current = false;
      setRepoMovedBusy(false);
    }
  };

  /**
   * G4 conflict choice for one behind path: reload | keep | branch.
   * Reload updates working copy + baseline for that path; keep / branch only
   * clear the marker (branch also parks mine on surfcad/<asm>-<date>).
   */
  const handleBehindChoice = async ({ action, path, kind }) => {
    const doc = assemblyRef.current;
    const baseline = gitBaselineRef.current;
    if (!doc || doc.source !== 'git' || !baseline || !path) {
      return { status: 'error', error: 'Not in Git mode' };
    }
    try {
      const vault = await ensureGitVault({ create: false });
      const branch = baseline.branch || vault.defaultBranch || 'main';
      if (action === 'keep') {
        markBehindResolved(path);
        return { status: 'kept', path };
      }
      if (action === 'branch') {
        const live = codeEditorRef.current?.getContent?.();
        const scripts = { ...partScriptsRef.current };
        if (doc.activeId && !suppressPartSaveRef.current && typeof live === 'string') {
          scripts[doc.activeId] = live;
        }
        const result = await checkInMineToBranch(gitAdapterRef.current, vault.repo, {
          doc,
          scripts,
          baseline,
          path,
          kind: kind === 'assembly' ? 'assembly' : 'part',
        });
        markBehindResolved(path);
        return result;
      }
      if (action === 'reload') {
        const live = codeEditorRef.current?.getContent?.();
        const scripts = { ...partScriptsRef.current };
        if (doc.activeId && !suppressPartSaveRef.current && typeof live === 'string') {
          scripts[doc.activeId] = live;
        }
        const reloaded = await reloadFromRemote(gitAdapterRef.current, vault.repo, {
          path,
          kind: kind === 'assembly' ? 'assembly' : 'part',
          branch,
          doc,
          scripts,
          baseline,
          pathIndex: gitSync().pathIndexFor(vault.repo),
          knownAssemblyId: isSurfId(doc?.id) ? doc.id : gitSync().assemblyIdFor(vault.repo, vaultSegment(doc?.name)),
          assemblyIdIndex: gitSync().assemblyIdIndexFor(vault.repo),
        });
        if (reloaded.kind === 'assembly') {
          // Replace assembly document; keep scripts for ids still present.
          const nextDoc = reloaded.doc;
          const keepScripts = {};
          for (const part of nextDoc.parts || []) {
            if (part.missing === true) continue;
            const have = scripts[part.id] ?? reloaded.scripts[part.id];
            if (typeof have === 'string') keepScripts[part.id] = have;
          }
          // Fetch any part scripts the remote assembly lists that we do not have.
          for (const part of nextDoc.parts || []) {
            if (part.missing === true || typeof keepScripts[part.id] === 'string') continue;
            const got = await readVaultPart(
              gitAdapterRef.current,
              vault.repo,
              partRepoPath(part) || part.id,
              branch,
            );
            if (got && typeof got.content === 'string') keepScripts[part.id] = got.content;
          }
          for (const [id, script] of Object.entries(keepScripts)) {
            await savePartScript(id, script);
          }
          rememberScripts(keepScripts);
          const saved = rememberAssembly(nextDoc);
          let nextBaseline = reloaded.baseline;
          // Refresh baseline scripts to match what we loaded.
          nextBaseline = {
            ...nextBaseline,
            scripts: { ...keepScripts },
            partIds: (nextDoc.parts || []).map((p) => p.id),
          };
          markBehindResolved(path);
          const markers = remainingBehindMarkers(gitBehindRef.current, gitBehindResolvedRef.current);
          if (!markers.any && gitBehindRef.current?.remoteSha) {
            nextBaseline = advanceBaselineHead(nextBaseline, gitBehindRef.current.remoteSha);
            rememberGitBehind(null, { showToast: false, resetResolved: true });
            setGitBehindToast(null);
          }
          rememberGitBaseline(nextBaseline);
          clearRollbackAnchors();
          const active = saved.parts.find((p) => p.id === saved.activeId) || saved.parts[0];
          if (active) {
            const picked = scriptForRow(saved, keepScripts, active.id);
            focusPartHistory(active.id, picked.ok ? picked.script : '');
            setCurrentFilename(active.name);
            if (picked.ok) {
              suppressPartSaveRef.current = false;
              codeEditorRef.current?.loadContent(picked.script, active.name, false);
            }
          }
          return { status: 'reloaded', path, kind: 'assembly' };
        }
        // Part reload
        const meshRecord = partMeshRecordsFromBaseline(
          { parts: [{ id: path }] },
          { [path]: reloaded.content },
          reloaded.baseline?.assets,
        )[path];
        await savePartScript(path, reloaded.content, meshRecord || {});
        if (meshRecord?.assets) {
          rememberPartAssets(path, meshRecord.assets);
          const nextMeta = { ...partMeshMetaRef.current, [path]: meshRecord };
          partMeshMetaRef.current = nextMeta;
          setPartMeshMeta(nextMeta);
        }
        const nextScripts = reloaded.scripts;
        rememberScripts(nextScripts);
        let nextBaseline = reloaded.baseline;
        markBehindResolved(path);
        const markers = remainingBehindMarkers(gitBehindRef.current, gitBehindResolvedRef.current);
        if (!markers.any && gitBehindRef.current?.remoteSha) {
          nextBaseline = advanceBaselineHead(nextBaseline, gitBehindRef.current.remoteSha);
          rememberGitBehind(null, { showToast: false, resetResolved: true });
          setGitBehindToast(null);
        }
        rememberGitBaseline(nextBaseline);
        storeRollbackAnchor(String(path), undefined);
        if (doc.activeId === path) {
          suppressPartSaveRef.current = false;
          codeEditorRef.current?.loadContent(reloaded.content, path, false);
        } else {
          refreshAssemblyRef.current?.(codeEditorRef.current?.getContent?.());
        }
        return { status: 'reloaded', path, kind: 'part' };
      }
      return { status: 'error', error: `Unknown action: ${action}` };
    } catch (err) {
      return gitOpCatchResult(err, 'Behind action failed');
    }
  };

  // G4: re-check remote when the window is focused / tab becomes visible.
  useEffect(() => {
    const onFocus = () => {
      if (assemblyRef.current?.source !== 'git' || !gitBaselineRef.current?.headSha) return;
      void checkGitRemoteBehind({ showToast: true, reason: 'focus' });
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- refs + stable helpers

  // G10: GitHub token enables vault/git source; without it, stay on silent IndexedDB (local).
  // No user-facing Local|Git toggle — identity strip is display-only.
  // Wait until auth has settled so a stored vaultName is visible before resolve.
  useEffect(() => {
    if (authLoading) return undefined;
    if (bootGateRef.current !== 'done') return undefined;
    if (bootResume === 'reauth' || bootReadOnlyRef.current) return undefined;
    const doc = assemblyRef.current;
    if (!doc) return undefined;
    if (githubConnected) {
      if (doc.source === 'git') return undefined;
      // Do not create or seed the vault here. Save / git_save does that.
      // Stamp surf ids while still local so legacy rows stay joint/paint-able.
      let cancelled = false;
      (async () => {
        await ensureLocalSurfIds();
        if (cancelled) return;
        const live = assemblyRef.current;
        if (!live || live.source === 'git') return;
        rememberAssembly({ ...live, source: 'git' });
        rememberGitBaseline(null);
        rememberGitBehind(null, { showToast: false, resetResolved: true });
        setGitBehindToast(null);
      })();
      return () => { cancelled = true; };
    }
    if (doc.source === 'git') {
      rememberAssembly({ ...doc, source: 'local' });
      rememberGitBaseline(null);
      rememberGitBehind(null, { showToast: false, resetResolved: true });
      setGitBehindToast(null);
    }
    return undefined;
  }, [githubConnected, assemblyDoc, authLoading, bootEpoch, bootResume]); // eslint-disable-line react-hooks/exhaustive-deps -- vault helpers via refs

  // After reload, baseline is gone but IndexedDB may still hold an in-repo
  // assembly. Reseed baseline from the current branch tip (do not replace the
  // working copy) so dirty = IDB vs tip — in-sync open stays clean.
  useEffect(() => {
    if (authLoading) return undefined;
    if (bootGateRef.current !== 'done') return undefined;
    // Playtest / offline mock has no GitHub token (`reauth`). Still reseed so
    // a reload can compare the IndexedDB working copy to the fake vault tip.
    if (!githubConnected && bootResume !== 'reauth') return undefined;
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return undefined;
    if (gitBaselineRef.current) return undefined;
    if (isV2PlanSaveDoc(doc)) {
      // v2 rows are path-less by design. leftover allLocal / open-by-name
      // would skip reseed or look up assemblies/<Name>/, then lastCommit
      // never binds and every id looks unsaved. Restore the vault handle
      // only; do not replace WC ids from committed paths.
      if (gitVaultRef.current?.repo) return undefined;
      let cancelled = false;
      (async () => {
        try {
          const vault = await ensureGitVault({ create: false });
          if (cancelled) return;
          const store = gitSync();
          await store.ready();
          const branch = gitWorkingBranch();
          const tip = store.getBranchTip(vault.repo, branch);
          const headSha = (typeof tip?.tipSha === 'string' && tip.tipSha)
            || (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha
            || vault.headSha
            || null;
          gitVaultRef.current = { ...vault, headSha };
          if (isV2SurfId(doc.id) && !store.getAssemblyCommit(vault.repo, branch, doc.id)) {
            const opened = await openV2Assembly(gitAdapterRef.current, vault.repo, doc.id, {
              branch,
              headSha,
            });
            if (cancelled) return;
            scheduleLastCommitFromApp({
              adapter: gitAdapterRef.current,
              repo: vault.repo,
              branch,
              store,
              opened,
              workingCopyId: doc.id,
              tip: headSha,
              reload: true,
              liveSession: () => ({
                repo: gitVaultRef.current?.repo || vault.repo,
                branch: gitWorkingBranch(),
              }),
            });
          }
          if (!cancelled) setBootEpoch((n) => n + 1);
        } catch (err) {
          console.warn('[git] v2 vault reseed skipped', err?.message || err);
        }
      })();
      return () => { cancelled = true; };
    }
    const parts = doc.parts || [];
    const allLocal = parts.length > 0
      && parts.every((p) => {
        const path = partRepoPath(p);
        return !path || String(p.id).startsWith('local:');
      });
    if (allLocal) return undefined; // true first-commit; keep null baseline
    const name = vaultSegment(doc.name) || doc.name;
    if (!name) return undefined;
    const workingCopyId = doc.id || null;
    let cancelled = false;
    (async () => {
      try {
        const vault = await ensureGitVault({ create: false });
        if (cancelled || gitBaselineRef.current) return;
        const branch = gitWorkingBranch();
        const store = gitSync();
        await store.ready();
        // reload never writes git. A pending rename opens the old vault
        // folder so the baseline keeps that name and Save can move it.
        const renameFrom = gitSidecarRef.current.renameFrom;
        const openName = renameFrom || name;
        const tip = (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha || null;
        const opened = await openNamedVaultAssembly(
          gitAdapterRef.current,
          vault.repo,
          openName,
          { branch, headSha: tip, pathIndex: store.pathIndexFor(vault.repo) },
        );
        if (cancelled || gitBaselineRef.current) return;
        /* eslint-enable no-use-before-define -- lastCommit reload: do not read inner `let doc` */
        scheduleLastCommitFromApp({ adapter: gitAdapterRef.current, repo: vault.repo, branch, store, opened, workingCopyId, tip, reload: true, liveSession: () => ({ repo: gitVaultRef.current?.repo || vault.repo, branch: gitWorkingBranch() }) });
        /* eslint-disable no-use-before-define */
        for (const hit of opened.identities?.cached || []) {
          if (hit.path && hit.id) await store.rememberPathId(vault.repo, hit.path, hit.id);
        }
        const beforeScripts = partScriptsRef.current || {};
        const persistSource = { doc: assemblyRef.current, scripts: beforeScripts };
        const aligned = rekeyWorkingCopyToTip(assemblyRef.current, beforeScripts, opened.doc, {
          histories: partHistoriesRef.current,
          meshMeta: partMeshMetaRef.current,
          cadPartId: cadPartIdRef.current,
        });
        let doc = aligned.doc;
        let scriptsNow = aligned.scripts;
        const persistPairs = [...aligned.pairs];
        const migrated = migrateAssemblyRecords({ doc, scripts: scriptsNow });
        doc = migrated.doc;
        scriptsNow = migrated.scripts;
        const localIds = migrateLocalPartIds({
          doc,
          scripts: scriptsNow,
          histories: partHistoriesRef.current,
          selection: { activeId: doc?.activeId, cadPartId: cadPartIdRef.current },
        });
        if (localIds.changed) {
          doc = localIds.doc;
          scriptsNow = localIds.scripts;
          persistPairs.push(...localIds.pairs);
        }
        const rekeyJournal = await loadRekeyJournal();
        const collapsed = collapseWorkingCopyIds(doc, scriptsNow, {
          pathIndex: store.pathIndexFor(vault.repo),
          reusePairs: reusePairsFromJournal(rekeyJournal, persistSource.doc),
        });
        if (collapsed.changed) {
          doc = collapsed.doc;
          scriptsNow = collapsed.scripts;
          persistPairs.push(...collapsed.pairs);
        }
        await retireImplicitVaultWriteOps(store, vault.repo, branch);
        if (cancelled) return;
        const idsChanged = migrated.changed || localIds.changed || collapsed.changed || aligned.pairs.length;
        const adoptReseedBaseline = async () => {
          if (gitBaselineRef.current) return;
          if (!store.getLastSyncedSha(vault.repo, branch) && opened.baseline?.headSha) {
            await store.setLastSyncedSha(vault.repo, opened.baseline.headSha, branch);
          }
          rememberGitBaseline(opened.baseline);
          gitVaultRef.current = { ...vault, headSha: opened.baseline?.headSha };
          void checkGitRemoteBehind({ showToast: true, reason: 'reseed' });
        };
        // Tip baseline first, while WC ids still match git. Path-keyed rows
        // look clean when gitBaseline is null, so waitForGitClean can pass
        // and a following set_script never badges dirty.
        await adoptReseedBaseline();
        const switchReseedMemory = async ({ doc: nextDoc, scripts: nextScripts, failedFrom } = {}) => {
          if (aligned.pairs.length) {
            rekeyRuntime(aligned.pairs);
            partMeshMetaRef.current = aligned.meshMeta;
            setPartMeshMeta(aligned.meshMeta);
          }
          if (localIds.changed) {
            partHistoriesRef.current = localIds.histories || partHistoriesRef.current;
            if (localIds.selection?.cadPartId && localIds.selection.cadPartId !== cadPartIdRef.current) {
              cadPartIdRef.current = localIds.selection.cadPartId;
            }
          }
          if (collapsed.pairs.length) rekeyRuntime(collapsed.pairs);
          doc = nextDoc;
          scriptsNow = nextScripts;
          rememberScripts(nextScripts);
          rememberAssembly(nextDoc, { persist: false });
          // Tip doc + persistPairs (skip failed rows). Never stringify nextDoc:
          // that would make a pre-reload rename/hide/removal look clean.
          rememberGitBaseline(captureBaselineFromTip({
            tipDoc: opened.doc,
            tipBaseline: opened.baseline,
            pairs: persistPairs,
            failedFrom,
          }));
          gitVaultRef.current = { ...vault, headSha: opened.baseline?.headSha };
        };
        // Load/reload still do not write git. Memory and collapsed baseline
        // switch only after the IDB doc is saved with the final ids (step 3).
        if (idsChanged) {
          const persisted = await persistCollapsedWorkingCopy({
            collapsed: { doc, scripts: scriptsNow, pairs: persistPairs },
            sourceDoc: persistSource.doc,
            sourceScripts: persistSource.scripts,
            heldScripts: persistSource.scripts,
            save: async (id, text) => savePartScript(id, text),
            load: loadPartScript,
            remove: async (id) => {
              try { await deletePartScript(id); } catch { /* ignore */ }
            },
            saveDoc: saveAssemblyDocument,
            live: () => {
              const scripts = { ...partScriptsRef.current };
              const id = assemblyRef.current?.activeId;
              const text = codeEditorRef.current?.getContent?.();
              if (
                id
                && typeof text === 'string'
                && !suppressPartSaveRef.current
                && editorLiveRef.current
                && appModeRef.current !== 'game'
              ) {
                scripts[id] = text;
              }
              return scripts;
            },
            assemblyKey: assemblyRekeyKey(persistSource.doc),
            saveJournal: saveRekeyJournal,
            clearJournal: clearRekeyJournal,
            onFlight: (pairs, opts) => {
              persistFlightPairsRef.current = Array.isArray(pairs) ? pairs : [];
              persistFlightToOnlyRef.current = !!(opts && opts.toOnly);
            },
            apply: async ({ doc: nextDoc, scripts: nextScripts, failedFrom }) => {
              await switchReseedMemory({ doc: nextDoc, scripts: nextScripts, failedFrom });
            },
          });
          if (persisted.docSaved === false) return;
          doc = persisted.doc;
          scriptsNow = persisted.scripts;
        } else if (rekeyJournal) {
          try { await clearRekeyJournal(); } catch { /* leftover from a finished persist */ }
        }
        await adoptReseedBaseline();
        const reconciled = reconcileSyncedFromTip(doc, opened.scripts);
        if (reconciled.changed || migrated.changed || localIds.changed || collapsed.changed || aligned.pairs.length) {
          doc = reconciled.doc;
          rememberAssembly(doc);
          for (const part of doc.parts || []) {
            if (part.isSynced !== true) continue;
            const text = partScriptsRef.current[part.id];
            if (typeof text === 'string') savePartScript(part.id, text, { isSynced: true });
          }
        }
      } catch (err) {
        // Missing assembly on tip → stay without baseline (local: chrome / first commit).
        console.warn('[git] baseline reseed skipped', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [githubConnected, assemblyDoc, gitBaseline, authLoading, bootEpoch, bootResume]); // eslint-disable-line react-hooks/exhaustive-deps -- vault helpers via refs

  /** Flush working copy to IndexedDB (local Save for assembly leave guard). */
  const handleFlushLocalAssembly = async () => {
    const doc = assemblyRef.current;
    if (!doc) return;
    const live = codeEditorRef.current?.getContent?.();
    const liveId = (!suppressPartSaveRef.current && typeof live === 'string') ? doc.activeId : null;
    if (liveId) {
      await savePartScript(liveId, live);
      rememberScripts({ ...partScriptsRef.current, [liveId]: live });
    }
    const latest = assemblyRef.current;
    if (latest) await saveAssemblyDocument(latest);
  };

  /** Seed a blank assembly (Parts + → Assembly). The folder menu imports or opens. */
  /**
   * A new document starts with no selection and no meshes from the old one.
   * The selected part id, the joint picks and the per-part run and leftover
   * meshes all belonged to the previous assembly; left in place, tapping the
   * assembly chip re-framed the old selected part (the bike's frame) as a
   * ghost inside the new, empty assembly.
   */
  const forgetPreviousAssemblySelection = () => {
    rememberCadPart(null);
    jointPicksRef.current = [];
    viewportRef.current?.clearJointHighlights?.();
    setJointCard((cur) => (cur ? null : cur));
    partRunsRef.current = {};
    partLeftoversRef.current = {};
  };

  const handleNewAssembly = async () => {
    const seedId = mintSurfId();
    const source = githubConnected ? 'git' : 'local';
    const starter = blankPartStarter(source === 'git' ? seedId : null);
    const name = nextAssemblyName(await collectTakenAssemblyNames());
    // Born with its layout: without it Save mis-routes to the v1 writer and
    // the button reads "Nothing to save" (see docs/git-integration.md §7).
    const vaultLayout = newAssemblyVaultLayout(source, assemblyRef.current);
    const seedDoc = serializeAssembly({
      id: mintSurfId(),
      source,
      name,
      activeId: seedId,
      ...(vaultLayout ? { vaultLayout } : {}),
      parts: [{
        id: seedId,
        name: DEFAULT_PART_NAME,
        visible: true,
        order: 0,
        ...(source === 'git' ? { isSynced: false, surfId: seedId } : {}),
      }],
    });
    refreshGenRef.current += 1;
    partMeshMetaRef.current = {};
    setPartMeshMeta({});
    forgetPreviousAssemblySelection();
    // Optimistic: show the seeded assembly immediately, then persist.
    rememberScripts({ [seedId]: starter });
    rememberSidecar(emptyWorkingSidecar());
    rememberAssembly(seedDoc);
    rememberGitBaseline(null);
    rememberGitBehind(null, { showToast: false, resetResolved: true });
    setGitBehindToast(null);
    for (const key of Object.keys(partHistoriesRef.current)) {
      if (key !== '__game__') delete partHistoriesRef.current[key];
    }
    partSaveEpochRef.current += 1;
    focusPartHistory(seedId, starter);
    suppressPartSaveRef.current = false;
    setCurrentFilename(DEFAULT_PART_NAME);
    codeEditorRef.current?.loadContent(starter, DEFAULT_PART_NAME, false);
    saveEditorDraft({ script: starter, filename: DEFAULT_PART_NAME, partId: seedId });
    setPendingPartIds((prev) => new Set(prev).add(seedId));
    try {
      await savePartScript(seedId, starter, source === 'git' ? { isSynced: false } : {});
      track('assembly_created');
    } catch (err) {
      setUploadError(err?.message || 'Could not create assembly');
    } finally {
      setPendingPartIds((prev) => {
        const next = new Set(prev);
        next.delete(seedId);
        return next;
      });
    }
  };

  const applySeededAssembly = async (seedDoc, starter, seedId) => {
    refreshGenRef.current += 1;
    partMeshMetaRef.current = {};
    setPartMeshMeta({});
    forgetPreviousAssemblySelection();
    rememberScripts({ [seedId]: starter });
    rememberSidecar(emptyWorkingSidecar());
    rememberAssembly(seedDoc);
    rememberGitBaseline(null);
    rememberGitBehind(null, { showToast: false, resetResolved: true });
    setGitBehindToast(null);
    for (const key of Object.keys(partHistoriesRef.current)) {
      if (key !== '__game__') delete partHistoriesRef.current[key];
    }
    partSaveEpochRef.current += 1;
    focusPartHistory(seedId, starter);
    suppressPartSaveRef.current = false;
    setCurrentFilename(DEFAULT_PART_NAME);
    codeEditorRef.current?.loadContent(starter, DEFAULT_PART_NAME, false);
    saveEditorDraft({ script: starter, filename: DEFAULT_PART_NAME, partId: seedId });
    setPendingPartIds((prev) => new Set(prev).add(seedId));
    try {
      await savePartScript(seedId, starter, seedDoc.source === 'git' ? { isSynced: false } : {});
      track('assembly_created');
    } catch (err) {
      setUploadError(err?.message || 'Could not create assembly');
    } finally {
      setPendingPartIds((prev) => {
        const next = new Set(prev);
        next.delete(seedId);
        return next;
      });
    }
    await ensureLocalSurfIds();
    return assemblyRef.current;
  };

  /** Agent create_assembly: optional label, no uniquify, no git write. */
  const seedAgentAssembly = async ({ name } = {}) => {
    const seedId = mintSurfId();
    const source = githubConnected ? 'git' : 'local';
    const starter = blankPartStarter(source === 'git' ? seedId : null);
    const raw = typeof name === 'string' ? name.trim() : '';
    const label = raw || DEFAULT_ASSEMBLY_NAME;
    const vaultLayout = newAssemblyVaultLayout(source, assemblyRef.current);
    const seedDoc = serializeAssembly({
      id: mintSurfId(),
      source,
      name: label,
      activeId: seedId,
      ...(vaultLayout ? { vaultLayout } : {}),
      parts: [{
        id: seedId,
        name: DEFAULT_PART_NAME,
        visible: true,
        order: 0,
        ...(source === 'git' ? { isSynced: false, surfId: seedId } : {}),
      }],
    });
    return applySeededAssembly(seedDoc, starter, seedId);
  };

  const agentGitReadContext = async (label) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { error: { code: 'git_only', message: `${label} needs a git-backed assembly` } };
    }
    try {
      const adapter = ensureGitAdapter();
      const vault = await ensureGitVault({ create: false });
      return { doc, adapter, vault, branch: gitWorkingBranch() };
    } catch (err) {
      if (err?.message === NO_REPO_YET_COPY || err?.code === 'git_blocked') {
        setUploadNotice(NO_REPO_YET_COPY);
        return { error: { code: 'git_blocked', message: NO_REPO_YET_COPY } };
      }
      return { error: { code: 'internal', message: err?.message || 'Vault unavailable' } };
    }
  };

  const handleOpenV2VaultAssembly = async (assemblyId, adapter = null) => {
    const id = typeof assemblyId === 'string' ? assemblyId.trim() : '';
    try {
      await openAssemblyTrackedRef.current({
        id,
        adapter,
        retry: () => { void handleOpenV2VaultAssembly(id); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const vault = await ensureGitVault({ create: false });
          if (!signal()) return;
          const branch = gitWorkingBranch();
          const git = adapter || gitAdapterRef.current;
          const store = gitSync();
          await store.ready();
          const { tip, opened } = await gitTimings.measure('open', async () => {
            const head = (await git.getBranch(vault.repo, branch))?.sha || null;
            const result = await openV2Assembly(git, vault.repo, id, {
              branch,
              headSha: head,
            });
            return { tip: head, opened: result };
          });
          if (!signal()) return;
          progress({
            name: opened.doc?.name,
            total: opened.doc?.parts?.length || 0,
          });
          const adopted = await adoptVaultOpening(opened, vault);
          if (!signal()) return;
          scheduleLastCommitFromApp({
            adapter: git,
            repo: vault.repo,
            branch,
            store,
            opened,
            adopted,
            tip,
            liveSession: () => ({
              repo: gitVaultRef.current?.repo || vault.repo,
              branch: gitWorkingBranch(),
            }),
          });
          const saved = adopted.saved;
          const openedScripts = adopted.scripts;
          void checkGitRemoteBehind({ showToast: true, reason: 'open' });
          const keep = historyKeepKeys(saved.parts);
          for (const key of Object.keys(partHistoriesRef.current)) {
            if (key !== '__game__' && !keep.has(key)) delete partHistoriesRef.current[key];
          }
          await finishOpenedPartRef.current(saved, openedScripts, progress);
        },
      });
      return { status: 'opened', assemblyId: id };
    } catch (err) {
      console.warn('[App] Open assembly failed:', err?.message || err);
      if (err?.message === NO_REPO_YET_COPY) setUploadNotice(NO_REPO_YET_COPY);
      if (err?.code === 'unknown_assembly') {
        return { status: 'error', code: 'unknown_assembly', error: err.message };
      }
      return gitOpCatchResult(err, 'Could not open assembly');
    }
  };

  const flushLivePartScript = () => {
    const doc = assemblyRef.current;
    if (!doc) return { ...partScriptsRef.current };
    const live = codeEditorRef.current?.getContent?.();
    const prev = doc.activeId;
    const scripts = { ...partScriptsRef.current };
    if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
      scripts[prev] = live;
      savePartScript(prev, live);
      stashPartHistory(prev, live);
    }
    rememberScripts(scripts);
    return scripts;
  };

  const insertReferencedParts = async ({ rows, copy = false } = {}) => {
    const doc = assemblyRef.current;
    if (!doc) {
      return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
    }
    const scripts = flushLivePartScript();
    let parts = [...doc.parts];
    let activeId = doc.activeId;
    const added = [];
    for (const row of rows || []) {
      if (!row?.id) continue;
      if (copy) {
        const newId = mintSurfId();
        const content = withSurfId(stripSurfId(row.script || ''), newId);
        scripts[newId] = content;
        await savePartScript(newId, content, doc.source === 'git' ? { isSynced: false } : {});
        parts = [...parts, {
          id: newId,
          name: row.name || DEFAULT_PART_NAME,
          visible: true,
          order: parts.length,
          copiedFrom: row.id,
          ...(doc.source === 'git' ? { surfId: newId, isSynced: false } : {}),
        }];
        activeId = newId;
        added.push(newId);
        continue;
      }
      if (parts.some((part) => part.id === row.id)) {
        activeId = row.id;
        if (typeof row.script === 'string' && scripts[row.id] == null) scripts[row.id] = row.script;
        continue;
      }
      if (row.missing === true) {
        parts = [...parts, {
          id: row.id,
          name: row.name || DEFAULT_PART_NAME,
          visible: true,
          order: parts.length,
          missing: true,
        }];
        activeId = row.id;
        added.push(row.id);
        continue;
      }
      if (typeof row.script === 'string') {
        scripts[row.id] = row.script;
        await savePartScript(row.id, row.script);
      }
      parts = [...parts, {
        id: row.id,
        name: row.name || DEFAULT_PART_NAME,
        visible: true,
        order: parts.length,
        ...(doc.source === 'git' ? { surfId: row.id } : {}),
      }];
      activeId = row.id;
      added.push(row.id);
    }
    const nextDoc = { ...doc, activeId, parts };
    rememberScripts(scripts);
    const saved = rememberAssembly(nextDoc);
    refreshGenRef.current += 1;
    const focus = saved.parts.find((part) => part.id === activeId) || saved.parts[saved.parts.length - 1];
    if (focus) {
      const text = scripts[focus.id] || '';
      focusPartHistory(focus.id, text);
      suppressPartSaveRef.current = false;
      setCurrentFilename(focus.name);
      revealPartOnRibbon(focus.id, text);
      codeEditorRef.current?.loadContent(text, focus.id, false);
    }
    return { result: { saved, added, activeId, partCount: saved.parts.length } };
  };

  /**
   * Part instances: a new row that places an existing row's definition.
   * The script, run and undo history are the definition's; the row has its
   * own id, label, pose and visibility. Local and git assemblies alike.
   */
  const agentInsertInstance = async ({ partId, position } = {}) => {
    const before = assemblyRef.current;
    if (!before) return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
    const source = findPartById(before, partId);
    if (!source) return { error: unknownPartError(partId) };
    const scripts = flushLivePartScript();
    const def = partDefinitionId(source);
    const id = mintSurfId();
    const stem = String(source.name || DEFAULT_PART_NAME).replace(/\s*\(\d+\)\s*$/, '') || DEFAULT_PART_NAME;
    const name = nextNumberedName(stem, before.parts.map((row) => row.name), { bareFirst: true });
    const order = before.parts.length;
    const at = newPartRowPosition(order, { position });
    const row = {
      id,
      instanceOf: def,
      name,
      visible: true,
      order,
      ...(at ? { position: at } : {}),
      ...(source.missing === true ? { missing: true } : {}),
      ...(before.source === 'git' ? { surfId: id } : {}),
    };
    if (typeof scripts[source.id] === 'string') scripts[id] = scripts[source.id];
    const nextDoc = rememberAssembly({ ...before, activeId: id, parts: [...before.parts, row] });
    rememberScripts(scripts);
    refreshGenRef.current += 1;
    rememberCadPart(id);
    recordAgentAssemblyStep(before);
    const text = scripts[id] || '';
    focusPartHistory(id, text);
    suppressPartSaveRef.current = false;
    setCurrentFilename(name);
    revealPartOnRibbon(id, text);
    codeEditorRef.current?.loadContent(text, id, false);
    // Place the new row. Its definition's run is fanned onto it and the
    // worker's feature cache already holds the script, so this is cheap.
    await refreshAssemblyRef.current?.(text, { persistActive: false });
    return {
      result: {
        partId: id,
        instanceOf: def,
        added: [id],
        partCount: nextDoc.parts.length,
      },
    };
  };

  const loadVaultPartRows = async ({ partId, assemblyId } = {}) => {
    const before = assemblyRef.current;
    const ctx = await agentGitReadContext(partId || assemblyId ? 'insert_part' : 'open_part');
    if (ctx.error) return { error: ctx.error };
    const rows = [];
    if (assemblyId) {
      try {
        const opened = await openV2Assembly(ctx.adapter, ctx.vault.repo, assemblyId, {
          branch: ctx.branch,
        });
        for (const part of opened.doc?.parts || []) {
          rows.push({
            id: part.id,
            name: part.name,
            script: opened.scripts?.[part.id],
            missing: part.missing === true,
          });
        }
      } catch (err) {
        if (err?.code === 'unknown_assembly') return { error: unknownAssemblyError(assemblyId) };
        return { error: { code: 'internal', message: err?.message || 'Could not read assembly' } };
      }
    }
    if (partId) {
      const existing = findPartById(before, partId);
      let script = existing ? (partScriptsRef.current[partId] || null) : null;
      let missing = existing?.missing === true;
      if (script == null && !missing) {
        let path = null;
        try { path = partIdPath(partId); } catch { /* not a v2 id */ }
        if (!path) return { error: unknownPartError(partId) };
        try {
          const file = await ctx.adapter.readFile(ctx.vault.repo, path, ctx.branch);
          if (file && typeof file.content === 'string') script = file.content;
          else missing = true;
        } catch {
          missing = true;
        }
      }
      if (!existing && script == null) {
        return { error: unknownPartError(partId) };
      }
      if (!rows.some((row) => row.id === partId)) {
        rows.push({
          id: partId,
          // The committed `// @name` header names a part the document does
          // not have yet; the id is never the title.
          name: existing?.name || readSurfName(script || '') || DEFAULT_PART_NAME,
          script,
          missing: script == null,
        });
      }
    }
    if (!rows.length) {
      return { error: { code: 'bad_args', message: 'open_part / insert_part needs part_id and/or assembly_id' } };
    }
    return { rows };
  };

  const handleAddPart = async (partName, opts = {}) => {
    if (!partCreateQueueRef.current) partCreateQueueRef.current = createPartQueue();
    return partCreateQueueRef.current(partCreateKey(partName, opts?.script), async () => {
    const doc = assemblyRef.current;
    if (!doc) return null;
    const order = doc.parts.length;
    const rowPosition = newPartRowPosition(order, {
      fromAgent: opts.fromAgent,
      position: opts.position,
    });
    const id = mintSurfId();
    let starter = typeof opts?.script === 'string' && opts.script.trim()
      ? wrapRawScript(opts.script)
      : newPartStarterScript();
    if (doc.source === 'git') starter = withSurfId(starter, id);
    const planned = commitPartCreate({
      doc,
      scripts: partScriptsRef.current,
      editorText: codeEditorRef.current?.getContent?.(),
      flushEditor: !suppressPartSaveRef.current,
    }, partName, { ...opts, rowPosition, id, starter }, {
      mintId: mintSurfId,
      nextNumberedName,
      wrapRawScript,
      starterScript: newPartStarterScript,
      withSurfId,
    });
    if (!planned?.part) return null;
    const { part, scripts, doc: nextDoc } = planned;
    const prev = doc.activeId;
    if (prev && scripts[prev] !== partScriptsRef.current?.[prev] && !suppressPartSaveRef.current) {
      savePartScript(prev, scripts[prev]);
      stashPartHistory(prev, scripts[prev]);
    }
    const applyNewPart = async (appliedDoc, appliedScripts) => {
      rememberScripts(appliedScripts);
      partSaveEpochRef.current += 1;
      refreshGenRef.current += 1;
      rememberAssembly(appliedDoc);
      focusPartHistory(appliedDoc.activeId || id, appliedScripts[appliedDoc.activeId || id] ?? starter);
      suppressPartSaveRef.current = false;
      const row = appliedDoc.parts.find((p) => p.id === (appliedDoc.activeId || id)) || part;
      setCurrentFilename(row.name);
      revealPartOnRibbon(row.id, appliedScripts[row.id] ?? starter);
      codeEditorRef.current?.loadContent(appliedScripts[row.id] ?? starter, row.name, false);
      saveEditorDraft({ script: appliedScripts[row.id] ?? starter, filename: row.name, partId: row.id });
    };
    setPendingPartIds((prevIds) => new Set(prevIds).add(id));
    let created = part;
    try {
      await applyNewPart(nextDoc, scripts);
      await savePartScript(id, starter, doc.source === 'git' ? { isSynced: false } : {});
      track('part_created');
    } catch (err) {
      const cur = assemblyRef.current;
      if (cur?.parts?.some((p) => p.id === id)) {
        rememberAssembly(removePart(cur, id));
        rememberScripts(dropPartRecord(partScriptsRef.current, id));
      }
      try { await deletePartScript(id); } catch { /* ignore */ }
      setUploadError(err?.message || 'Could not create part');
      created = null;
    } finally {
      setPendingPartIds((prevIds) => {
        const next = new Set(prevIds);
        next.delete(id);
        return next;
      });
    }
    return created;
    });
  };

  const handlePreviewDeletePart = async (partId) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git' || doc.vaultLayout !== 'v2') return { assemblies: [] };
    const key = String(partId);
    const part = (doc.parts || []).find((row) => row.id === key);
    const def = part ? partDefinitionId(part) : key;
    if (!isV2SurfId(def)) return { assemblies: [] };
    let vault = null;
    try {
      vault = await ensureGitVault({ create: false });
    } catch (err) {
      if (err?.message === NO_REPO_YET_COPY || err?.code === NO_REPO_YET_CODE) return { assemblies: [] };
      return { status: 'error', error: PART_USE_SCAN_REFUSED };
    }
    if (!vault?.repo || !gitAdapterRef.current) return { assemblies: [] };
    const scan = await scanOtherAssemblyPartUses(
      gitAdapterRef.current,
      vault.repo,
      gitWorkingBranch(),
      [def],
      { exceptAssemblyId: isV2SurfId(doc.id) ? doc.id : null },
    );
    if (!scan.ok) return { status: 'error', error: PART_USE_SCAN_REFUSED };
    return { assemblies: scan.assemblies };
  };

  const commitDeleteV2Part = async (doc, part, partDef) => {
    let vault = null;
    try {
      vault = await ensureGitVault({ create: false });
    } catch (err) {
      if (err?.message !== NO_REPO_YET_COPY && err?.code !== NO_REPO_YET_CODE) {
        return {
          status: 'error',
          code: 'delete_refused',
          error: "Couldn't delete the part. Nothing was changed.",
        };
      }
    }
    if (!vault?.repo || !gitAdapterRef.current) {
      return { status: 'local', partId: partDef, assemblies: [] };
    }
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    try {
      return await executeDeleteV2Part({
        adapter: gitAdapterRef.current,
        repo: vault.repo,
        branch: gitWorkingBranch(),
        store: gitSync(),
        partId: partDef,
        openDoc: doc,
        confirm: true,
        online,
        message: `Delete ${part?.name || 'part'}`,
      });
    } catch {
      return {
        status: 'error',
        code: 'delete_refused',
        error: "Couldn't delete the part. Nothing was changed.",
      };
    }
  };

  const handleDeletePart = async (id, opts = {}) => {
    const doc = assemblyRef.current;
    if (!doc || id == null) return;
    const key = String(id);
    const part = doc.parts.find((row) => row.id === key);
    if (!part) return;
    const partDef = partDefinitionId(part);
    const definitionStays = definitionStillReferenced(doc.parts, partDef, key);
    // An instance row leaves; its definition's file stays while another
    // row still places it. A v1 repo delete still waits for the next Save.
    if (opts.fromRepo && doc.source === 'git' && !definitionStays && !isV2PlanSaveDoc(doc)) {
      const repoPath = partRepoPath(part);
      if (repoPath) persistPendingDeletes(repoDeletePathsFor(repoPath));
    }

    const live = codeEditorRef.current?.getContent?.();
    const prevActive = doc.activeId;
    const deletingActive = prevActive === key;
    let scripts = { ...partScriptsRef.current };
    if (!deletingActive && prevActive && !suppressPartSaveRef.current && typeof live === 'string') {
      scripts[prevActive] = live;
      savePartScript(prevActive, live);
    }

    const applyDeleteLocal = (nextDoc, nextScripts) => {
      refreshGenRef.current += 1;
      if (deletingActive) {
        partSaveEpochRef.current += 1;
        suppressPartSaveRef.current = true;
      }
      // The document first: the script and run maps are normalised against
      // it, so a definition whose primary row just left keeps its key from
      // the instances that remain.
      rememberAssembly(nextDoc);
      rememberScripts(nextScripts);
      deletePartScript(key);
      if (!definitionStays) forgetPartAssets(partDef);
      if (partMeshMetaRef.current[key]) {
        const nextMeta = { ...partMeshMetaRef.current };
        delete nextMeta[key];
        partMeshMetaRef.current = nextMeta;
        setPartMeshMeta(nextMeta);
      }
      dropPartHistory(key);
      delete partLeftoversRef.current[key];
      const runs = dropPartRecord(partRunsRef.current, key);
      commitPartRuns(runs);
      const nextActive = nextDoc.activeId;
      if (cadPartIdRef.current === key) rememberCadPart(nextActive);
      const nextPart = nextDoc.parts.find((row) => row.id === nextActive);
      const nextRun = nextActive ? runs[nextActive] : null;
      if (deletingActive && nextRun?.ok && nextRun.mesh?.vertProperties) {
        viewportRef.current?.adoptActiveSolid?.({
          mesh: nextRun.mesh,
          position: partPosition(nextPart) || [0, 0, 0],
          placement: placementForMesh(nextPart),
          partId: nextActive,
        });
      }
      viewportRef.current?.placeAssembly?.({
        solids: composeViewportParts(nextDoc, runs),
        leftovers: leftoverPickSolids(nextDoc, runs, partLeftoversRef.current),
        activeId: deletingActive && !(nextRun?.ok && nextRun.mesh) ? null : nextActive,
        blankActive: (deletingActive && !(nextRun?.ok && nextRun.mesh?.vertProperties)) || !nextActive,
        failedIds: failedPartIdsFor(nextDoc, runs),
      });
      if (!nextActive) {
        applyPartHistory({ commits: [], head: -1 });
        const note = '// No parts.\n';
        setCurrentFilename(null);
        saveEditorDraft({ script: note, filename: null, partId: null });
        codeEditorRef.current?.setTextOnly?.(note);
        setCurrentScript(note);
        return;
      }
      if (!deletingActive) {
        refreshAssemblyRef.current?.(live, { persistActive: !suppressPartSaveRef.current });
        return;
      }
      setCurrentFilename(nextPart?.name || null);
      const picked = scriptForRow(nextDoc, partScriptsRef.current, nextActive);
      focusPartHistory(nextActive, picked.ok ? picked.script : '');
      if (picked.ok) {
        suppressPartSaveRef.current = false;
        if (codeEditorRef.current?.loadContent) {
          codeEditorRef.current.loadContent(picked.script, nextPart?.name || 'Part', false);
        } else {
          setCurrentScript(picked.script);
          refreshAssemblyRef.current?.(picked.script);
        }
        return;
      }
      const note = '// This part has no file yet.\n';
      codeEditorRef.current?.setTextOnly?.(note);
      setCurrentScript(note);
      refreshAssemblyRef.current?.(undefined, { persistActive: false });
    };

    const tentativeDoc = removePart(doc, key);
    const tentativeScripts = dropPartRecord(scripts, key);
    if (opts.fromRepo && doc.source === 'git' && !definitionStays && isV2PlanSaveDoc(doc) && isV2SurfId(partDef)) {
      const result = await commitDeleteV2Part(doc, part, partDef);
      if (!result || (result.status !== 'committed' && result.status !== 'local')) return result;
      if (result.sha) {
        gitVaultRef.current = {
          ...(gitVaultRef.current || {}),
          headSha: result.sha,
        };
      }
      applyDeleteLocal(tentativeDoc, tentativeScripts);
      return {
        status: 'deleted',
        assemblies: result.assemblies || [],
        sha: result.sha || null,
      };
    }
    applyDeleteLocal(tentativeDoc, tentativeScripts);
    return { status: 'deleted' };
  };

  const handleGameRun = async () => {
    if (appModeRef.current !== 'game') {
      const code = codeEditorRef.current?.getContent?.();
      if (code == null) return;
      setCurrentScript(code);
      await refreshAssemblyRef.current?.(code, { forceActive: true });
      return;
    }
    if (gameSuccess || gameRunInFlightRef.current) return;
    const code = codeEditorRef.current?.getContent?.();
    if (code == null) return;
    // Capture puzzle identity at Run — loadPuzzle can change currentPuzzle
    // while execute+compare are in flight (~1s+), which would poison wins.
    // Ref tracks live id (closure would stay stale across the await).
    const puzzleIdAtRun = currentPuzzleRef.current?.id || 'unknown';
    gameRunInFlightRef.current = true;
    setGameRunBusy(true);
    setCurrentScript(code);
    try {
      const run = await viewportRef.current?.executeScript(code);
      if (!run || run.cleared) return;
      const nonce = typeof run === 'object' ? run.nonce : undefined;
      try {
        const verdict = await manifoldContext.compareGameMatch({
          relEps: MATCH_REL_EPS,
          volFloor: MATCH_VOL_FLOOR_MM3,
          nonce,
        });
        if (verdict?.ignored) {
          console.log('[App] Ignoring stale match compare', verdict);
          return;
        }
        if (!verdict?.match) {
          console.log('[App] No match', verdict);
          return;
        }
        // Stale — puzzle switched mid-run; do not treat as success / record win.
        const puzzleIdNow = currentPuzzleRef.current?.id || 'unknown';
        if (puzzleIdNow !== puzzleIdAtRun) {
          console.log('[App] Ignoring stale match — puzzle switched mid-run', {
            puzzleIdAtRun,
            puzzleIdNow,
          });
          return;
        }
        if (verdict.reason === 'boolean_failed_vol_fallback' || verdict.warning) {
          console.warn('[App] Match via volume fallback (boolean unstable)', verdict.warning);
          setGameError('Match used volume fallback (boolean unstable)');
        }
        const elapsed = performance.now() - gameTimerStartRef.current;
        setGameTimerRunning(false);
        setGameElapsedMs(elapsed);
        setGameSuccess(true);
        setShowConfetti(true);
        setShowHints(false);

        // Win capture is non-blocking — match UX continues even if POST fails.
        // Use puzzleIdAtRun (not live currentPuzzle) so the win keys the run that matched.
        recordWin({ puzzleId: puzzleIdAtRun, script: code, timeMs: elapsed })
          .then(({ bestTimeMs }) => {
            setGameBestTimeMs(bestTimeMs);
          })
          .catch((err) => {
            console.warn('[App] Win capture failed (non-blocking):', err);
          });

        const next = getNextPuzzle(puzzleIdAtRun);
        clearSuccessTimer();
        // Brief confetti + banner, then auto-advance (or stay on last).
        successClearTimerRef.current = setTimeout(() => {
          successClearTimerRef.current = null;
          setGameSuccess(false);
          setShowConfetti(false);
          if (next) {
            loadPuzzle(next, { autoOpenHint: false });
            return;
          }
          // End of pack: stay on last, blank editor, restart timer.
          setCurrentScript('');
          codeEditorRef.current?.setTextOnly?.('');
          viewportRef.current?.clearAttempt?.();
          gameTimerStartRef.current = performance.now();
          setGameElapsedMs(0);
          setGameTimerRunning(true);
        }, SUCCESS_CLEAR_MS);
      } catch (err) {
        console.warn('[App] Match check failed:', err);
      }
    } finally {
      // Cover execute+compare only so retry Run works after a miss / failed check.
      gameRunInFlightRef.current = false;
      setGameRunBusy(false);
    }
  };

  const handleGameHint = () => {
    setShowHints(true);
  };

  /**
   * Scripts, names, positions, and last-run status of every part, for
   * cross-part writes. The active part's script is the live editor buffer.
   */
  const assemblyPartContext = () => {
    const doc = assemblyRef.current;
    const parts = {};
    if (!doc) return { parts, activeId: null };
    const live = codeEditorRef.current?.getContent?.();
    for (const row of doc.parts) {
      const run = partRunsRef.current?.[row.id];
      const script = row.id === doc.activeId && typeof live === 'string' && !suppressPartSaveRef.current
        ? live
        : partScriptsRef.current[row.id];
      parts[row.id] = {
        script: typeof script === 'string' ? script : null,
        name: row.name || row.id,
        position: partPosition(row) || [0, 0, 0],
        placement: partPlacement(row),
        visible: row.visible !== false,
        ok: !(run && run.ok === false && run.error && !run.skipped),
      };
    }
    return { parts, activeId: doc.activeId ?? null };
  };

  /**
   * Write scripts into parts that are not in the editor. Each write is one
   * feature step on that part's own undo stack. Then every visible part is
   * run again, so the active part's graphs rebuild on the success path and
   * the other parts show their new solids.
   */
  const writeOtherPartScripts = (writes) => {
    const doc = assemblyRef.current;
    if (!doc || !Array.isArray(writes) || !writes.length) return false;
    let scripts = { ...partScriptsRef.current };
    let wrote = 0;
    for (const w of writes) {
      if (!w?.id || typeof w.buffer !== 'string' || w.id === doc.activeId) continue;
      if (!doc.parts.some((row) => row.id === w.id)) continue;
      const prevScript = repairScriptReturns(typeof scripts[w.id] === 'string' ? scripts[w.id] : '').buffer;
      const partKey = String(w.id);
      const stored = storedRollback(partKey);
      const nextBuffer = repairScriptReturns(w.buffer).buffer;
      const placed = (stored === null || typeof stored === 'string')
        ? commitScriptAtRollback(prevScript, nextBuffer, stored)
        : { buffer: nextBuffer, anchor: stored };
      if (stored === null || typeof stored === 'string') storeRollbackAnchor(partKey, placed.anchor);
      scripts = { ...scripts, [w.id]: placed.buffer };
      savePartScript(w.id, placed.buffer);
      partHistoriesRef.current[definitionIdFor(w.id, doc)] = pushPartHistory(
        historyForPart(partHistoriesRef.current, definitionIdFor(w.id, doc), prevScript),
        placed.buffer,
        w.message || 'External copy',
      );
      wrote += 1;
    }
    if (!wrote) return false;
    rememberScripts(scripts);
    refreshAssemblyRef.current?.(codeEditorRef.current?.getContent?.());
    return true;
  };

  /**
   * Subtract mode on a Block or Shape: the active part keeps its own block
   * (already written). Every other visible part the cutter overlaps gets a
   * frozen copy of that cutter, posed into its frame, as one feature step
   * with a yellow-bordered chip. Re-confirming the same feature replaces
   * that copy; a cutter moved off a part drops it there.
   */
  const crossPartSubtract = async (before, after) => {
    const doc = assemblyRef.current;
    if (!doc || appModeRef.current === 'game' || doc.parts.length < 2) return;
    if (typeof before !== 'string' || typeof after !== 'string' || before === after) return;
    const sourceRow = doc.parts.find((row) => row.id === doc.activeId);
    if (!sourceRow) return;
    const ctx = assemblyPartContext();
    const parts = doc.parts.map((row) => ({ id: row.id, ...ctx.parts[row.id] }));
    const source = {
      id: sourceRow.id,
      name: sourceRow.name || sourceRow.id,
      position: partPosition(sourceRow) || [0, 0, 0],
      placement: partPlacement(sourceRow),
    };
    const plan = planCrossPartSubtract({ before, after, source, parts, markers: FEATURE_MARKER_KINDS });
    if (!plan || !plan.candidates.length) return;
    const involved = parts.filter((part) => plan.candidates.some((cand) => String(cand.id) === String(part.id)));
    const rotated = externalBodyRotationBlock(source, involved);
    if (!rotated.ok) {
      viewportRef.current?.notify?.(rotated.message);
      return;
    }
    const probeParts = plan.candidates
      .map((c) => ({ id: c.id, mesh: meshForPart(c.id), offset: c.offset }))
      .filter((p) => p.mesh?.vertProperties);
    let overlapIds = [];
    try {
      const res = await manifoldContext.probeOverlap({ cutterScript: plan.cutterScript, parts: probeParts });
      overlapIds = (res?.overlaps || []).map((o) => String(o.id));
    } catch (err) {
      console.warn('[App] cross-part subtract probe failed', err);
      return;
    }
    // The user may have switched parts while the probe ran.
    if (assemblyRef.current?.activeId !== source.id) return;
    const fresh = assemblyPartContext();
    const freshParts = doc.parts.map((row) => ({ id: row.id, ...fresh.parts[row.id] }));
    const writes = crossPartSubtractWrites(plan, { source, parts: freshParts, overlapIds });
    if (!writes.length) return;
    if (writeOtherPartScripts(writes)) {
      const names = writes
        .filter((w) => w.message === 'External copy')
        .map((w) => fresh.parts[w.id]?.name || w.id);
      if (names.length) viewportRef.current?.notify?.(`Also cut ${names.join(', ')} (external copy).`);
    }
  };

  /**
   * Feature Accept writes through the palette-insert caret. A new block that
   * landed past the bar is moved into that gap, and the bar moves onto it
   * so the new feature runs. An edit of a block that is already there does
   * not move. The bar at the end leaves the buffer alone.
   */
  const commitFeatureBuffer = (before, nextBuffer, message) => {
    if (typeof nextBuffer !== 'string') return false;
    const key = editorRollbackKey();
    const stored = storedRollback(key);
    const beforeFixed = repairScriptReturns(typeof before === 'string' ? before : '').buffer;
    const nextFixed = repairScriptReturns(nextBuffer).buffer;
    const placed = (stored === null || typeof stored === 'string')
      ? commitScriptAtRollback(beforeFixed, nextFixed, stored)
      : { buffer: nextFixed, anchor: stored };
    const wrote = !!codeEditorRef.current?.applyBuffer?.(placed.buffer, message);
    if (wrote) {
      trackFeatureCommits(beforeFixed, placed.buffer);
    }
    if (wrote && key && (stored === null || typeof stored === 'string')) {
      storeRollbackAnchor(key, placed.anchor);
    }
    return wrote;
  };

  /**
   * Slice 09/10/11: palette Confirm → compose at caret with params (+ optional
   * faceContext from selected face), then Auto-Run via handleGameRun.
   */
  const handleInsertHelper = (helperId, params = null, faceContext = null, edgeContext = null) => {
    // The Block preview is drawn on the picked part; Confirm writes there too.
    if (!focusWritePart(null)) {
      viewportRef.current?.notify?.(PICKED_PART_FAIL);
      return;
    }
    const beforeInsert = codeEditorRef.current?.getContent?.() ?? '';
    const rollbackKey = editorRollbackKey();
    const stored = storedRollback(rollbackKey);
    const rolledBack = stored === null || typeof stored === 'string';
    const caret = rolledBack ? rollbackInsertCaret(beforeInsert, stored) : null;
    const placeAtBar = rolledBack && typeof caret === 'number';
    // A palette insert appends after a trailing Move / Rotate. Move and
    // Rotate themselves name the pre-move centroid, so they stay unposed.
    const writeMatrix = helperId === 'move' || helperId === 'rotate'
      ? null
      : matrixForNewFeature(assemblyRef.current?.activeId, beforeInsert, null);
    const posedFace = writeMatrix ? poseFaceRecord(faceContext, writeMatrix) : faceContext;
    const posedEdges = writeMatrix && Array.isArray(edgeContext)
      ? edgeContext.map((edge) => poseEdgeRecord(edge, writeMatrix))
      : edgeContext;
    const ok = codeEditorRef.current?.insertHelper?.(
      helperId,
      params,
      posedFace,
      posedEdges,
      placeAtBar ? caret : undefined,
    );
    if (ok) {
      trackPaletteFeature(helperId);
    }
    if (ok && rollbackKey) {
      if (placeAtBar) {
        const after = codeEditorRef.current?.getContent?.() ?? beforeInsert;
        storeRollbackAnchor(
          rollbackKey,
          rollbackAnchorAfterInsert(beforeInsert, after, stored),
        );
      } else if (rolledBack) {
        storeRollbackAnchor(rollbackKey, undefined);
      }
    }
    if (ok) {
      if (params && params.combine === 'subtract') {
        crossPartSubtract(beforeInsert, codeEditorRef.current?.getContent?.());
      }
      // Defer so Monaco state + currentScript settle before execute+compare.
      setTimeout(() => {
        handleGameRun();
      }, 0);
      return;
    }
    // Soft-fail: empty selected-edge fillet/chamfer/path — clear stale chip and toast
    // without writing any JS. Face-scope / compose-null failures stay quiet.
    const isEdgeFeature = helperId === 'filletEdges' || helperId === 'chamferEdges';
    const isSweepPath = helperId === 'sweepPath';
    const scope = params?.edgeScope
      || (edgeContext && edgeContext.length ? 'selected' : null);
    if (isEdgeFeature && scope === 'selected' && !(edgeContext && edgeContext.length)) {
      viewportRef.current?.softFailStaleEdges?.(
        'No edges selected — re-pick after geometry changes, then Fillet/Chamfer.',
      );
    } else if (isSweepPath && !(edgeContext && edgeContext.length)) {
      viewportRef.current?.softFailStaleEdges?.(
        'No edges selected — re-pick a contiguous chain or loop, then Path.',
      );
    }
  };

  const placeCommitBuffer = (before, nextBuffer) => {
    const key = editorRollbackKey();
    const stored = storedRollback(key);
    const beforeFixed = repairScriptReturns(typeof before === 'string' ? before : '').buffer;
    const nextFixed = repairScriptReturns(nextBuffer).buffer;
    const placed = (stored === null || typeof stored === 'string')
      ? commitScriptAtRollback(beforeFixed, nextFixed, stored)
      : { buffer: nextFixed, anchor: stored };
    return { key, stored, placed };
  };

  const contourCommitMessage = (entry, result) => {
    const solidLabel = entry === 'makeSweep'
      ? 'sweep'
      : entry === 'makeLoft'
        ? 'loft'
        : entry === 'makeRevolve'
          ? 'revolve'
          : 'extrude';
    if (entry === 'workplane') return 'Workplane';
    if (result.run) return `Contour ${solidLabel}`;
    return 'Contour profile';
  };

  const buildContourCommitPlan = (buf, payload = {}) => {
    if (payload?.editContour) {
      const saved = saveEditedContour(buf, payload);
      if (!saved.ok) return { ok: false, message: saved.message };
      return {
        ok: true,
        buffer: saved.buffer,
        run: true,
        empty: false,
        message: 'Contour',
      };
    }
    if (payload?.contourBlock) {
      const saved = writeContourProfileBlock(buf, payload);
      if (!saved.ok) return { ok: false, message: saved.message };
      if (!saved.written) {
        return { ok: true, buffer: buf, run: false, empty: true, message: 'Contour' };
      }
      return {
        ok: true,
        buffer: saved.buffer,
        run: false,
        empty: false,
        message: 'Contour',
      };
    }
    const result = composeContourCommit(buf, payload);
    if (!result.ok) return { ok: false, message: result.message };
    if (result.empty) {
      return {
        ok: true,
        buffer: buf,
        run: false,
        empty: true,
        message: contourCommitMessage(payload?.entry, result),
      };
    }
    return {
      ok: true,
      buffer: result.buffer,
      run: !!result.run,
      empty: false,
      message: contourCommitMessage(payload?.entry, result),
    };
  };

  const prepareAgentSheetMutate = (prepared) => {
    if (!prepared?.write || !prepared?.spec) return { changed: false };
    if (!focusWritePart(prepared.partId)) {
      return { error: { code: 'no_write_part', message: 'No writable part for sheet commit' } };
    }
    const buf = codeEditorRef.current?.getContent?.() ?? '';
    const result = prepared.removeBlock ? removeSheetMetalBlock(buf) : composeSheetMetalCommit(buf, prepared.spec);
    if (!result.ok) {
      return { error: { code: 'commit_failed', message: result.message || 'Sheet metal commit refused' } };
    }
    if (result.buffer === buf) return { changed: false, source: buf, message: 'Sheet metal' };
    const placement = placeCommitBuffer(buf, result.buffer);
    return {
      changed: true,
      source: placement.placed.buffer,
      message: 'Sheet metal',
      placement,
    };
  };

  const prepareAgentHoleMutate = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      return { error: { code: 'no_write_part', message: 'No writable part for hole commit' } };
    }
    const buf = codeEditorRef.current?.getContent?.() ?? '';
    const editing = !!(payload?.editSpec || payload?.editCentres);
    const result = payload?.editCentres
      ? rewriteCentersContour(buf, {
        contourId: payload.contourId,
        contour: payload.contour,
        frame: payload.frame,
        planeOffset: payload.planeOffset,
      })
      : composeHoleOnContour(buf, payload?.editSpec
        ? { featureId: payload.featureId, spec: payload.spec }
        : {
          frame: payload.frame,
          contour: payload.contour,
          spec: payload.spec,
          planeOffset: payload.planeOffset,
        });
    if (!result.ok) {
      return { error: { code: 'commit_failed', message: result.message || 'Hole commit refused' } };
    }
    if (result.empty || result.changed === false || result.buffer === buf) {
      return { changed: false, source: buf, message: 'Hole', featureId: result.featureId ?? null };
    }
    const placement = placeCommitBuffer(buf, result.buffer);
    return {
      changed: true,
      source: placement.placed.buffer,
      message: payload?.editCentres ? 'Hole centres' : 'Hole',
      featureId: result.featureId ?? null,
      placement,
      editing,
      rollbackFeatureId: !editing ? result.featureId : null,
    };
  };

  const applyAgentHoleMutateExtras = (prep) => {
    applyAgentContourRollback(prep.placement);
    if (prep.rollbackFeatureId) {
      const key = editorRollbackKey();
      const stored = storedRollback(key);
      if (stored === undefined && prep.rollbackFeatureId) {
        storeRollbackAnchor(key, prep.rollbackFeatureId);
      }
    }
  };

  const prepareAgentContourMutate = (payload, meta = {}) => {
    if (!focusWritePart(payload?.partId)) {
      return { error: { code: 'no_write_part', message: 'No writable part for contour commit' } };
    }
    const buf = codeEditorRef.current?.getContent?.() ?? '';
    const plan = buildContourCommitPlan(buf, payload);
    if (!plan.ok) {
      return { error: { code: 'commit_failed', message: plan.message || 'Contour commit refused' } };
    }
    const placement = placeCommitBuffer(buf, plan.buffer);
    const changed = placement.placed.buffer !== buf;
    return {
      changed,
      source: placement.placed.buffer,
      message: plan.message,
      runSubtract: plan.run ? buf : null,
      finish: { payload, fromSlot: meta.fromSlot === true },
      placement,
    };
  };

  const applyAgentContourRollback = (placement) => {
    if (!placement) return;
    const { key, stored, placed } = placement;
    if (key && (stored === null || typeof stored === 'string')) {
      storeRollbackAnchor(key, placed.anchor);
    }
  };

  /**
   * Slice 24/25/26/28/30: in-mode Confirm. Profile writes makeCrossSection only
   * (no Auto-Run). Extrude / Revolve / Loft / Sweep write the solid and Auto-Run.
   */
  const handleContourRefsResolved = (buffer) => {
    if (typeof buffer !== 'string') return false;
    return !!codeEditorRef.current?.applyBuffer?.(buffer, 'Contour reference');
  };

  const handleCommitContourProfile = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailContour?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const plan = buildContourCommitPlan(buf, payload || {});
    if (!plan.ok) {
      viewportRef.current?.softFailContour?.(plan.message);
      return false;
    }
    if (plan.empty) return true;
    const wrote = commitFeatureBuffer(buf, plan.buffer, plan.message);
    if (!wrote) {
      viewportRef.current?.softFailContour?.('Could not write Contour into the editor — try again.');
      return false;
    }
    if (plan.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
      crossPartSubtract(buf, codeEditorRef.current?.getContent?.() ?? plan.buffer);
    } else if (payload?.editContour) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /**
   * Hole Accept, or a tap-to-edit confirm. A new hole is one undo and the bar
   * sits on that chip. No centres on a new hole writes nothing. A spec
   * confirm rewrites that hole and leaves the contour. A centres confirm
   * rewrites the one solveContour call and leaves every hole block. An edit
   * that changes nothing skips undo. An edit does not move the bar.
   */
  const handleCommitHole = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailContour?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const editing = !!(payload?.editSpec || payload?.editCentres);
    const result = payload?.editCentres
      ? rewriteCentersContour(buf, {
        contourId: payload.contourId,
        contour: payload.contour,
        frame: payload.frame,
        planeOffset: payload.planeOffset,
      })
      : composeHoleOnContour(buf, payload?.editSpec
        ? { featureId: payload.featureId, spec: payload.spec }
        : {
          frame: payload.frame,
          contour: payload.contour,
          spec: payload.spec,
          planeOffset: payload.planeOffset,
        });
    if (!result.ok) {
      viewportRef.current?.softFailContour?.(result.message);
      return false;
    }
    if (result.empty || result.changed === false || result.buffer === buf) return true;
    const key = editorRollbackKey();
    const stored = storedRollback(key);
    const wrote = commitFeatureBuffer(
      buf,
      result.buffer,
      payload?.editCentres ? 'Hole centres' : 'Hole',
    );
    if (!wrote) {
      viewportRef.current?.softFailContour?.('Could not write Hole into the editor — try again.');
      return false;
    }
    if (!editing && stored === undefined && result.featureId) storeRollbackAnchor(key, result.featureId);
    setTimeout(() => {
      handleGameRun();
    }, 0);
    return true;
  };

  /**
   * Delete a named contour. An unused contour drops its statement. A
   * referenced contour, after confirm, also drops every feature block that
   * names it. One applyBuffer, so Undo restores that whole step.
   */
  const handleDeleteContour = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailContour?.(PICKED_PART_FAIL);
      return false;
    }
    const id = payload?.contourId ? String(payload.contourId) : '';
    let buf = codeEditorRef.current?.getContent?.() || '';
    if (id && !hasNamedContour(buf, id) && hasNamedContour(currentScript, id)) buf = currentScript;
    const saved = deleteContourStatement(buf, id, { withFeatures: !!payload?.withFeatures });
    if (!saved.ok) {
      viewportRef.current?.softFailContour?.(saved.message || 'Could not delete that contour.');
      return false;
    }
    const wrote = codeEditorRef.current?.applyBuffer?.(saved.buffer, 'Delete contour');
    if (!wrote) {
      viewportRef.current?.softFailContour?.(
        'Could not delete the contour from the editor — try again.',
      );
      return false;
    }
    setTimeout(() => {
      handleGameRun();
    }, 0);
    return true;
  };

  /**
   * Slice 27: in-mode Fillet Accept. Writes makeSweepPath + filletAlongPath
   * and Auto-Runs. A second Accept appends to the marked block.
   * Picks can span parts: the editor part is written through the editor;
   * each other part with picks gets its own block in its own script, as one
   * feature step on that part's stack (writeOtherPartScripts). Every part is
   * composed first, so a refusal writes nothing.
   */
  const handleCommitFillet = (payload) => {
    const chamfer = payload?.entry === 'chamferEdges';
    const label = chamfer ? 'Chamfer' : 'Fillet';
    // The viewport's own part is the editor part; other picks stay "others".
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailFillet?.(PICKED_PART_FAIL);
      return false;
    }
    const doc = assemblyRef.current;
    const editorId = doc?.activeId ?? null;
    const buf = codeEditorRef.current?.getContent?.() || '';
    const poseEdges = (edges, matrix) => (
      matrix && Array.isArray(edges) ? edges.map((edge) => poseEdgeRecord(edge, matrix)) : edges
    );
    const editorMatrix = matrixForNewFeature(payload?.partId, buf, payload?.editFeature || null);
    const posedPayload = editorMatrix
      ? { ...payload, edges: poseEdges(payload?.edges, editorMatrix) }
      : payload;
    const poseOther = (group) => {
      if (!group) return group;
      const script = partScriptsRef.current?.[group.partId] || '';
      const matrix = matrixForNewFeature(group.partId, script, payload?.editFeature || null);
      if (!matrix) return group;
      return { ...group, edges: poseEdges(group.edges, matrix) };
    };
    const others = (Array.isArray(payload?.otherParts) ? payload.otherParts : []).map(poseOther);
    let editorBuffer = null;
    let writes = [];
    const editFeature = payload?.editFeature || null;
    if (editFeature) {
      // Same composer as a new fillet. The block replaces this feature
      // instead of appending a second one onto the solid it already cut.
      const edited = replaceEditedBlend(buf, editFeature, {
        chamfer,
        edges: posedPayload?.edges,
        params: payload?.params,
        filletClass: payload?.filletClass ?? null,
        geometry: payload?.geometry ?? null,
      });
      if (!edited.ok) {
        viewportRef.current?.softFailFillet?.(edited.message);
        return false;
      }
      editorBuffer = edited.changed ? edited.buffer : null;
      if (others.length) {
        const ctx = assemblyPartContext();
        const plan = composeMultiPartEdgeCommit({
          chamfer,
          groups: others,
          editorId,
          editorBuffer: edited.buffer,
          parts: ctx.parts,
          compose: chamfer ? composeChamferCommit : composeFilletCommit,
          hasBlock: chamfer ? hasChamferModeBlock : hasFilletModeBlock,
        });
        if (!plan.ok) {
          viewportRef.current?.softFailFillet?.(plan.message);
          return false;
        }
        writes = plan.writes;
      }
    } else if (!others.length) {
      const result = chamfer
        ? composeChamferCommit(buf, posedPayload || {})
        : composeFilletCommit(buf, posedPayload || {});
      if (!result.ok) {
        viewportRef.current?.softFailFillet?.(result.message);
        return false;
      }
      editorBuffer = result.buffer;
    } else {
      const ctx = assemblyPartContext();
      const ownId = payload?.partId ?? editorId;
      const plan = composeMultiPartEdgeCommit({
        chamfer,
        groups: [
          {
            partId: ownId,
            edges: posedPayload?.edges || [],
            params: payload?.params || {},
            filletClass: payload?.filletClass ?? null,
            geometry: payload?.geometry ?? null,
          },
          ...others,
        ],
        editorId,
        editorBuffer: buf,
        parts: ctx.parts,
        compose: chamfer ? composeChamferCommit : composeFilletCommit,
        hasBlock: chamfer ? hasChamferModeBlock : hasFilletModeBlock,
      });
      if (!plan.ok) {
        viewportRef.current?.softFailFillet?.(plan.message);
        return false;
      }
      editorBuffer = plan.editor ? plan.editor.buffer : null;
      writes = plan.writes;
    }
    if (editorBuffer != null) {
      const wrote = commitFeatureBuffer(
        buf,
        editorBuffer,
        editFeature ? `Edit ${editFeature.label || label}` : `${label} mode`,
      );
      if (!wrote) {
        viewportRef.current?.softFailFillet?.(
          `Could not write ${label} into the editor — try again.`,
        );
        return false;
      }
    }
    // writeOtherPartScripts re-runs every visible part with the live editor
    // buffer, so the editor part does not need a second Auto-Run.
    if (writes.length && writeOtherPartScripts(writes)) {
      const live = codeEditorRef.current?.getContent?.();
      if (typeof live === 'string') setCurrentScript(live);
      const names = writes.map((w) => w.name || w.id);
      viewportRef.current?.notify?.(`${label} also written to ${names.join(', ')}.`);
      return true;
    }
    if (editorBuffer != null) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /**
   * S1 sheet metal: Start edits the open part in place. A new Sheet (n)
   * part is created only when an assembly is open and no part is active.
   */
  const getSheetMetalReady = () => !!assemblyRef.current?.activeId;
  const sheetBindLockRef = useRef(false);

  /**
   * Signed-out boot creates no assembly. Start designing is the explicit
   * create: Assembly / Part (1), holding whatever the editor already has.
   * The fresh and busy rules below then decide if that buffer becomes the flange.
   */
  const seedOpenAssembly = async (script) => {
    const seedId = mintSurfId();
    const source = githubConnected ? 'git' : 'local';
    const name = nextAssemblyName(await collectTakenAssemblyNames());
    let text = typeof script === 'string' ? script : '';
    if (source === 'git') text = withSurfId(text, seedId);
    const vaultLayout = newAssemblyVaultLayout(source, assemblyRef.current);
    const seedDoc = serializeAssembly({
      id: mintSurfId(),
      source,
      name,
      activeId: seedId,
      ...(vaultLayout ? { vaultLayout } : {}),
      parts: [{
        id: seedId,
        name: DEFAULT_PART_NAME,
        visible: true,
        order: 0,
        ...(source === 'git' ? { isSynced: false, surfId: seedId } : {}),
      }],
    });
    refreshGenRef.current += 1;
    partMeshMetaRef.current = {};
    setPartMeshMeta({});
    rememberScripts({ [seedId]: text });
    rememberAssembly(seedDoc);
    rememberGitBaseline(null);
    rememberGitBehind(null, { showToast: false, resetResolved: true });
    setGitBehindToast(null);
    for (const key of Object.keys(partHistoriesRef.current)) {
      if (key !== '__game__') delete partHistoriesRef.current[key];
    }
    partSaveEpochRef.current += 1;
    focusPartHistory(seedId, text);
    suppressPartSaveRef.current = false;
    setCurrentFilename(DEFAULT_PART_NAME);
    const current = codeEditorRef.current?.getContent?.() ?? '';
    if (current !== text) {
      codeEditorRef.current?.loadContent(text, DEFAULT_PART_NAME, false);
    }
    saveEditorDraft({ script: text, filename: DEFAULT_PART_NAME, partId: seedId });
    adoptCadRollback(seedId);
    try {
      await savePartScript(seedId, text, source === 'git' ? { isSynced: false } : {});
    } catch (err) {
      setUploadError(err?.message || 'Could not create assembly');
    }
    return assemblyRef.current;
  };

  /**
   * S1 Start designing: bind the SendCutSend SKU on the open part.
   * A fresh part (empty, comments-only, or only `return part`) takes the
   * default base flange in place, and a refreshGen bump drops a pending
   * cube auto-run.
   * A part that already has features is not rewritten here and no Sheet (n)
   * part is created — plane Accept appends one block. An existing sheet
   * block is kept so Viewport can re-thickness it. Spec stays null until
   * Accept when the part does not already have a sheet block.
   * No assembly yet: seed one from the editor buffer, then those same rules.
   */
  const handleBindSheetMetal = async (record) => {
    const binding = sheetMetalBinding(record);
    if (!binding || appModeRef.current === 'game') return { ok: false };
    const starter = sheetStarterScript(record);
    if (!starter?.script) return { ok: false };
    if (sheetBindLockRef.current) return { ok: false };
    sheetBindLockRef.current = true;
    try {
      if (!assemblyRef.current) {
        await seedOpenAssembly(codeEditorRef.current?.getContent?.() ?? '');
        if (!assemblyRef.current?.activeId) return { ok: false };
      }
      let doc = assemblyRef.current;
      let created = false;
      const live = codeEditorRef.current?.getContent?.() ?? '';
      if (!doc.activeId) {
        const names = doc.parts.map((part) => part.name);
        const sheetName = nextNumberedName('Sheet', names);
        // handleAddPart bumps refreshGen before loadContent, so the new part
        // runs this flange and a pending cube auto-run cannot paint over it.
        handleAddPart(sheetName, { script: starter.script });
        if (assemblyRef.current?.activeId === doc.activeId) return { ok: false };
        doc = assemblyRef.current;
        created = true;
      } else if (sheetMetalFresh(live) && !readSheetMetalSpec(live)) {
        // Drop a pending cube auto-run, then write the default flange.
        refreshGenRef.current += 1;
        const wrote = codeEditorRef.current?.applyBuffer?.(starter.script, 'Sheet metal');
        if (!wrote) return { ok: false };
        if (doc.activeId) {
          rememberScripts({ ...partScriptsRef.current, [doc.activeId]: starter.script });
        }
        setTimeout(() => {
          handleGameRun();
        }, 0);
      }
      const partId = doc.activeId;
      rememberAssembly(setPartSheetMetal(doc, partId, binding));
      const hadSheet = !created && !!readSheetMetalSpec(live);
      const spec = hadSheet ? readSheetMetalSpec(codeEditorRef.current?.getContent?.() ?? '') : null;
      return { ok: true, partId, created, spec };
    } finally {
      sheetBindLockRef.current = false;
    }
  };

  /** Sheet-metal step (base flange, bend, tab, hole …): rewrite the one block; Auto-Run. */
  const handleCommitSheetMetal = (spec, meta = {}) => {
    if (!focusWritePart(meta?.partId)) {
      viewportRef.current?.notify?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const result = meta?.removeBlock ? removeSheetMetalBlock(buf) : composeSheetMetalCommit(buf, spec);
    if (!result.ok) {
      viewportRef.current?.notify?.(result.message);
      return false;
    }
    if (result.buffer === buf) return true;
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Sheet metal');
    if (!wrote) {
      viewportRef.current?.notify?.('Could not write sheet metal into the editor — try again.');
      return false;
    }
    setTimeout(() => {
      handleGameRun();
    }, 0);
    return true;
  };

  /**
   * Paint Confirm. Working-copy only. Save / git_save is the git write.
   * Cancel never calls this. Part scripts and isSynced are left as they are.
   */
  const handleCommitPaint = (payload) => {
    const doc = assemblyRef.current;
    if (!doc || !payload) return false;
    if (payload.op === 'session') {
      const next = serializeAssembly({ ...doc, colors: payload.colors || null });
      if (JSON.stringify(next.colors || null) === JSON.stringify(doc.colors || null)) return true;
      rememberAssembly(next);
      return true;
    }
    if (!payload.surfId) return false;
    const before = doc.colors || null;
    let colors = before;
    if (payload.op === 'clear-part') {
      colors = clearPaintColors(before, payload.surfId, { part: true });
    } else if (payload.op === 'clear-faces') {
      colors = clearPaintColors(before, payload.surfId, { keys: payload.keys, faces: payload.faces });
    } else if (payload.op === 'unmatched') {
      colors = removeUnmatchedColors(before, payload.surfId, payload.faces);
    } else if (payload.op === 'part') {
      colors = commitPaintColors(before, payload.surfId, { color: payload.color, part: true });
    } else {
      colors = commitPaintColors(before, payload.surfId, {
        color: payload.color,
        keys: payload.keys,
        faces: payload.faces,
      });
    }
    if (JSON.stringify(colors || null) === JSON.stringify(before || null)) return true;
    rememberAssembly({ ...doc, colors });
    return true;
  };

  /**
   * Write the FEA study comment into the active part. The script drawer can
   * stay closed: the part script is stored here, and a mounted editor only
   * receives the same buffer. Does not post a build of its own and does not
   * call preemptInflight. While an assembly open holds the worker, the write
   * is refused and the lock is left alone. Reauth stays read-only.
   */
  const handleCommitFea = (script) => {
    if (typeof script !== 'string') return false;
    if (assemblyOpenLockRef.current) {
      viewportRef.current?.notify?.('An assembly is opening — save the study again once it finishes.');
      return false;
    }
    const editor = codeEditorRef.current;
    const current = editor?.getContent?.() ?? '';
    if (editor?.applyBuffer) {
      if (script !== current) {
        let wrote = false;
        try {
          wrote = !!editor.applyBuffer(script, 'FEA study');
        } catch {
          wrote = false;
        }
        if (!wrote) {
          editorLiveRef.current = true;
          setCurrentScript(script);
          handleCodeChange(script, 'FEA study');
        }
      }
    } else if (script !== current) {
      editorLiveRef.current = true;
      setCurrentScript(script);
      handleCodeChange(script, 'FEA study');
    }
    if (bootReadOnlyRef.current || suppressPartSaveRef.current) return true;
    const id = assemblyRef.current?.activeId;
    if (!id) return true;
    const next = { ...partScriptsRef.current, [id]: script };
    partScriptsRef.current = next;
    setPartScripts(next);
    savePartScript(id, script);
    saveEditorDraft({ script, filename: currentFilename, partId: id });
    return true;
  };

  /** Active part reads the editor. Every other part reads the stored script. */
  const scriptForFeaPart = (partId) => {
    const id = partId == null ? '' : String(partId);
    if (!id) return '';
    const active = assemblyRef.current?.activeId;
    if (active != null && String(active) === id) {
      const live = codeEditorRef.current?.getContent?.();
      if (typeof live === 'string') return live;
    }
    return partScriptsRef.current?.[id] ?? '';
  };

  /** Shell face-pick Confirm — hollow() + SHELL markers; Auto-Run. */
  const handleCommitShell = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailShell?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const matrix = matrixForNewFeature(payload?.partId, buf, payload?.editFeature || null);
    const posed = matrix && payload?.face
      ? { ...payload, face: poseFaceRecord(payload.face, matrix) }
      : (payload || {});
    const result = composeShellCommit(buf, posed);
    if (!result.ok) {
      viewportRef.current?.softFailShell?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Shell');
    if (!wrote) {
      viewportRef.current?.softFailShell?.(
        'Could not write Shell into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Draft face-pick Confirm — one draftFaces() + DRAFT markers; Auto-Run. */
  const handleCommitDraft = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailDraft?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const matrix = matrixForNewFeature(payload?.partId, buf, payload?.editFeature || null);
    let state = payload?.state || payload || {};
    if (matrix) {
      state = {
        ...state,
        ...(Array.isArray(state.drafts) ? { drafts: state.drafts.map((face) => poseFaceRecord(face, matrix)) } : {}),
        ...(state.neutral ? { neutral: poseFaceRecord(state.neutral, matrix) } : {}),
        ...(Array.isArray(state.pull) ? { pull: poseFaceRecord({ normal: state.pull }, matrix).normal } : {}),
      };
    }
    const result = composeDraftCommit(buf, state);
    if (!result.ok) {
      viewportRef.current?.softFailDraft?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Draft');
    if (!wrote) {
      viewportRef.current?.softFailDraft?.(
        'Could not write Draft into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Cut plane Confirm — one cut() + CUT markers; Auto-Run. */
  const handleCommitCut = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailCut?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const matrix = matrixForNewFeature(payload?.partId, buf, payload?.editFeature || null);
    let state = payload?.state || payload || {};
    if (matrix) {
      state = {
        ...state,
        ...(state.plane ? { plane: poseFaceRecord(state.plane, matrix) } : {}),
        ...(Array.isArray(state.bodies) ? { bodies: state.bodies.map((body) => poseFaceRecord(body, matrix)) } : {}),
      };
    }
    const result = composeCutCommit(buf, state, payload?.mesh || null);
    if (!result.ok) {
      viewportRef.current?.softFailCut?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Cut');
    if (!wrote) {
      viewportRef.current?.softFailCut?.(
        'Could not write Cut into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /**
   * Boolean Confirm — one booleanBodies() + markers; Auto-Run.
   * The first pick's part is written. When that is not the part in the
   * editor, it is loaded first, so the write is one feature step on its
   * own stack. Tool bodies from other parts are frozen copies (externalBody).
   */
  const handleCommitBoolean = (payload) => {
    const state = payload?.state || payload || {};
    const gate = validateBooleanAccept(state, payload?.partId, payload?.mesh || null);
    if (!gate.ok) {
      viewportRef.current?.softFailBoolean?.(gate.message);
      return false;
    }
    const ctx = assemblyPartContext();
    const doc = assemblyRef.current;
    const target = gate.targetPartId;
    if (doc && target && target !== doc.activeId && doc.parts.some((row) => row.id === target)) {
      if (typeof ctx.parts[target]?.script !== 'string') {
        viewportRef.current?.softFailBoolean?.('Boolean: the target part has no script yet.');
        return false;
      }
      handleSelectPart(target, { keepPicks: true });
      if (assemblyRef.current?.activeId !== target) {
        viewportRef.current?.softFailBoolean?.('Could not open the target part — try again.');
        return false;
      }
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const liveDoc = assemblyRef.current;
    let posedState = state;
    if (state?.byPart) {
      const byPart = {};
      let changed = false;
      for (const [partId, slot] of Object.entries(state.byPart)) {
        const script = partId === liveDoc?.activeId
          ? buf
          : (partScriptsRef.current?.[partId] || '');
        const matrix = matrixForNewFeature(partId, script, null);
        if (!matrix || !slot) {
          byPart[partId] = slot;
          continue;
        }
        changed = true;
        byPart[partId] = {
          ...slot,
          bodies: (slot.bodies || []).map((body) => poseFaceRecord(body, matrix)),
        };
      }
      if (changed) posedState = { ...state, byPart };
    }
    const result = composeBooleanCommit(
      buf,
      posedState,
      payload?.partId,
      payload?.mesh || null,
      ctx,
    );
    if (!result.ok) {
      viewportRef.current?.softFailBoolean?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Boolean');
    if (!wrote) {
      viewportRef.current?.softFailBoolean?.(
        'Could not write Boolean into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Delete Face Confirm — one deleteFace() + markers; Auto-Run. */
  const handleCommitDeleteFace = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailDeleteFace?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const matrix = matrixForNewFeature(payload?.partId, buf, payload?.editFeature || null);
    let state = payload?.state || payload || {};
    if (matrix && Array.isArray(state.faces)) {
      state = { ...state, faces: state.faces.map((face) => poseFaceRecord(face, matrix)) };
    }
    const result = composeDeleteFaceCommit(buf, state);
    if (!result.ok) {
      viewportRef.current?.softFailDeleteFace?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Delete Face');
    if (!wrote) {
      viewportRef.current?.softFailDeleteFace?.(
        'Could not write Delete Face into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Move Face Confirm — one moveFace() + markers; Auto-Run. Not body move(). */
  const handleCommitMoveFace = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailMoveFace?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const matrix = matrixForNewFeature(payload?.partId, buf, payload?.editFeature || null);
    let state = payload?.state || payload || {};
    if (matrix && Array.isArray(state.faces)) {
      state = { ...state, faces: state.faces.map((face) => poseFaceRecord(face, matrix)) };
    }
    const result = composeMoveFaceCommit(buf, state);
    if (!result.ok) {
      viewportRef.current?.softFailMoveFace?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Move Face');
    if (!wrote) {
      viewportRef.current?.softFailMoveFace?.(
        'Could not write Move Face into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Move body Confirm — one move() + MOVE markers; Auto-Run. */
  const handleCommitMove = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailMove?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const result = composeMoveCommit(buf, payload?.state || payload || {});
    if (!result.ok) {
      viewportRef.current?.softFailMove?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Move');
    if (!wrote) {
      viewportRef.current?.softFailMove?.(
        'Could not write Move into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Rotate body Confirm — one rotateAbout() + ROTATE markers; Auto-Run. */
  const handleCommitRotate = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailRotate?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const result = composeRotateCommit(buf, payload?.state || payload || {});
    if (!result.ok) {
      viewportRef.current?.softFailRotate?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Rotate');
    if (!wrote) {
      viewportRef.current?.softFailRotate?.(
        'Could not write Rotate into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  /** Mirror body Confirm — one mirror() + MIRROR markers; Auto-Run. */
  const handleCommitMirror = (payload) => {
    if (!focusWritePart(payload?.partId)) {
      viewportRef.current?.softFailMirror?.(PICKED_PART_FAIL);
      return false;
    }
    const buf = codeEditorRef.current?.getContent?.() || '';
    const result = composeMirrorCommit(buf, payload?.state || payload || {});
    if (!result.ok) {
      viewportRef.current?.softFailMirror?.(result.message);
      return false;
    }
    const wrote = commitFeatureBuffer(buf, result.buffer, 'Mirror');
    if (!wrote) {
      viewportRef.current?.softFailMirror?.(
        'Could not write Mirror into the editor — try again.',
      );
      return false;
    }
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
    return true;
  };

  const handleExecute = (script, autoExecute=false) => {
    // The editor has produced a real buffer — the draft autosave may now
    // treat currentScript as authoritative (before this, '' is just "Monaco
    // has not mounted yet" and would overwrite a restored draft with nothing).
    editorLiveRef.current = true;
    setCurrentScript(script);
    // Game mode: never auto-run on Monaco mount/remount (blank-enter / ghost-only).
    if (autoExecute && appModeRef.current !== 'game') {
      // Pass script directly to avoid stale closure. CAD runs the assembly
      // so every visible part is drawn, not only the buffer in Monaco.
      // A generation bump (open / hydrate) drops this scheduled run.
      const scheduledGen = refreshGenRef.current;
      pendingAutoRunRef.current = script;
      setTimeout(() => {
        if (pendingAutoRunRef.current === script) pendingAutoRunRef.current = null;
        // An open is already building this part. A second post queues behind
        // it, or bumps the generation and drops the build the spinner awaits.
        if (assemblyOpenLockRef.current) return;
        if (refreshGenRef.current !== scheduledGen) return;
        refreshAssemblyRef.current?.(script);
      }, 100);
    }
  };

  // Read at Monaco onMount time. A render-time flag would be stale: the
  // mobile shell can mount after set_script has already committed.
  const handleEditorSeed = (script) => {
    const id = historyKey();
    const prev = partHistoriesRef.current[id];
    const history = (prev && Array.isArray(prev.commits))
      ? prev
      : {
        commits: historyRef.current?.branches?.main?.commits || [],
        head: Number.isInteger(historyRef.current?.branches?.main?.head)
          ? historyRef.current.branches.main.head
          : -1,
      };
    if (editorMountSeedsHistory(history)) return true;
    // The live script is already committed. Mark the buffer real so the draft
    // effect can save it, without running or recording the boot script.
    editorLiveRef.current = true;
    if (typeof script === 'string') setCurrentScript(script);
    return false;
  };

  const handleCodeChange = (code, message = 'Code updated') => {
    if (suppressPartSaveRef.current && message === 'Manual edit') {
      suppressPartSaveRef.current = false;
    }
    const id = historyKey();
    const branch = historyRef.current?.branches?.main;
    const prev = partHistoriesRef.current[id] || {
      commits: branch?.commits || [],
      head: Number.isInteger(branch?.head) ? branch.head : -1,
    };
    if (message === 'Initial script' && !editorMountSeedsHistory(prev)) return;
    const pushed = pushPartHistory(prev, code, message);
    partHistoriesRef.current[id] = pushed;
    applyPartHistory(pushed);
    console.log('[App] handleCodeChange added commit:', { message, codeLength: code?.length, partId: id });
  };

  const handleUndo = () => {
    // Undo the part the strip and title show (the picked part).
    if (!focusWritePart(null)) return;
    const id = historyKey();
    const branch = historyRef.current?.branches?.main;
    const current = partHistoriesRef.current[id] || {
      commits: branch?.commits || [],
      head: Number.isInteger(branch?.head) ? branch.head : -1,
    };
    const undone = undoPartHistory(current);
    if (undone.code == null) return;
    partHistoriesRef.current[id] = undone.history;
    applyPartHistory(undone.history);
    console.log('[App] Undoing to commit:', {
      partId: id,
      head: undone.history.head,
      codeLength: undone.code?.length,
    });
    // Restore editor without loadContent autoExecute (CAD-only; game skips).
    // Auto-Run via handleGameRun — same path as palette insert / Confirm.
    // Only this part's stack moves, so the script written here is this part's.
    codeEditorRef.current?.setTextOnly?.(undone.code);
    setTimeout(() => {
      handleGameRun();
    }, 0);
  };

  const handleRedo = () => {
    if (!focusWritePart(null)) return;
    const id = historyKey();
    const branch = historyRef.current?.branches?.main;
    const current = partHistoriesRef.current[id] || {
      commits: branch?.commits || [],
      head: Number.isInteger(branch?.head) ? branch.head : -1,
    };
    const redone = redoPartHistory(current);
    if (redone.code == null) return;
    partHistoriesRef.current[id] = redone.history;
    applyPartHistory(redone.history);
    console.log('[App] Redoing to commit:', {
      partId: id,
      head: redone.history.head,
      codeLength: redone.code?.length,
    });
    // Restore editor without loadContent autoExecute (CAD-only; game skips).
    // Auto-Run via handleGameRun — same path as palette insert / Confirm.
    codeEditorRef.current?.setTextOnly?.(redone.code);
    setTimeout(() => {
      handleGameRun();
    }, 0);
  };

  const canUndo = () => {
    const branch = history.branches[history.currentBranch];
    return branch.head > 0;
  };

  const canRedo = () => {
    const branch = history.branches[history.currentBranch];
    return branch.head < branch.commits.length - 1;
  };

  const paintAssemblyPoses = (doc) => {
    const runs = partRunsRef.current || {};
    const solids = composeViewportParts(doc, runs);
    const leftovers = leftoverPickSolids(doc, runs, partLeftoversRef.current);
    const viewId = doc?.activeId;
    const activeVisible = doc?.parts?.find((row) => row.id === viewId)?.visible !== false;
    const activeOk = !!(viewId && runs[viewId]?.ok === true && activeVisible);
    viewportRef.current?.placeAssembly?.({
      solids,
      leftovers,
      activeId: viewId,
      blankActive: !activeOk,
      failedIds: failedPartIdsFor(doc, runs),
    });
  };

  const handleOpenJoints = () => {
    // The feature-popup gate is closed for the whole prompt run (responding
    // and building). Joints are created during that run, so the session
    // still opens. Game mode and another feature session still refuse.
    if (!beginAgentJointSession({
      game: appModeRef.current === 'game',
      featureSession: !!featureSessionRef.current,
    })) return false;
    jointPicksRef.current = [];
    viewportRef.current?.clearJointHighlights?.();
    publishJointCard(draftFromPicks(null, [], { joints: assemblyRef.current?.joints || [] }));
    return true;
  };

  /** Empty space keeps the selected part (users tap it while rotating). Picks and the joint card still clear. */
  const handleCadEmptyClick = () => {
    if (featureSessionRef.current || appModeRef.current === 'game') return;
    const next = emptyClickCadSelection({
      cadPartId: cadPartIdRef.current,
      activeId: assemblyRef.current?.activeId,
      featureSession: false,
    });
    rememberCadPart(next.cadPartId);
    jointPicksRef.current = [];
    viewportRef.current?.clearJointHighlights?.();
    setJointCard((cur) => (cur ? null : cur));
  };

  const focusPartMeshForTitle = (partId) => {
    const doc = assemblyRef.current;
    if (!doc || partId == null) return;
    const part = doc.parts.find((row) => row.id === partId);
    // Only a part of this document: the run cache can still hold a mesh for
    // a part of the previous one, and swapping it in draws a ghost.
    if (!part) return;
    const mesh = meshForPart(partId);
    if (!mesh?.vertProperties) return;
    viewportRef.current?.swapPickPart?.({
      partId,
      mesh,
      position: partPosition(part) || [0, 0, 0],
      placement: placementForMesh(part),
    });
  };

  const handleTitleAssemblyActivate = () => {
    if (featureSessionRef.current || appModeRef.current === 'game') return;
    const doc = assemblyRef.current;
    if (!doc) return;
    const focusId = titleFocusPartId(doc, cadPartIdRef.current);
    rememberCadPart(null);
    jointPicksRef.current = [];
    viewportRef.current?.clearJointHighlights?.();
    setJointCard((cur) => (cur ? null : cur));
    if (focusId) focusPartMeshForTitle(focusId);
    viewportRef.current?.showCadBodyHighlight?.();
  };

  const handleTitlePartActivate = () => {
    if (featureSessionRef.current || appModeRef.current === 'game') return;
    const doc = assemblyRef.current;
    if (!doc) return;
    const id = renameTargetId(doc, cadPartIdRef.current);
    if (id == null) return;
    if (cadPartIdRef.current === id && id === doc.activeId) {
      focusPartMeshForTitle(id);
      viewportRef.current?.showCadBodyHighlight?.();
      return;
    }
    handleSelectPart(id, {
      keepPicks: cadPartIdRef.current === id,
      bodyHighlight: true,
    });
  };

  const handleJointPick = (raw) => {
    const doc = assemblyRef.current;
    if (!doc || !raw?.partId) return;
    const part = doc.parts.find((row) => row.id === raw.partId);
    const pickSurfId = partSurfId(part);
    if (!pickSurfId) {
      viewportRef.current?.notify?.('This part has no surf id');
      rememberCadPart(null);
      return;
    }
    // A whole-part pick (Ground on the highlighted part) has no key.
    if (!raw.key && raw.kind !== 'part') return;
    const pick = {
      partId: part.id,
      surfId: pickSurfId,
      partName: part.name || part.id,
      kind: raw.kind,
      planar: !!raw.planar,
      axis: !!raw.axis,
      key: raw.key || null,
    };
    if ((jointCardAgentRef.current ?? jointCardRef.current)?.partChange) return;
    const accepted = acceptJointPick(jointPicksRef.current, pick);
    if (accepted.refuse && accepted.message) viewportRef.current?.notify?.(accepted.message);
    jointPicksRef.current = accepted.picks;
    rememberCadPart(null);
    if (accepted.open) {
      setJointCard((cur) => ({
        ...draftFromPicks(
          cur?.mode === 'create' || cur?.mode === 'edit' ? cur : null,
          accepted.picks,
          { joints: doc.joints || [] },
        ),
        mode: cur?.mode === 'edit' ? 'edit' : 'create',
        partChange: accepted.choice || null,
      }));
    }
  };

  const handleResolvePartChange = (action) => {
    const cur = jointCardRef.current;
    const doc = assemblyRef.current;
    if (!cur?.partChange || !doc) return;
    const pending = cur.partChange.pick;
    const before = jointPicksRef.current || [];
    const nextPicks = resolvePartChange(before, pending, action);
    const kept = new Set(nextPicks.map((row) => jointPickSlot(row)));
    if (action === 'discard') {
      viewportRef.current?.clearJointHighlights?.(jointPickSlot(pending));
    }
    for (const row of before) {
      const slot = jointPickSlot(row);
      if (!kept.has(slot)) viewportRef.current?.clearJointHighlights?.(slot);
    }
    jointPicksRef.current = nextPicks;
    setJointCard({
      ...draftFromPicks(
        cur.mode === 'create' || cur.mode === 'edit' ? { ...cur, partChange: null } : null,
        nextPicks,
        { joints: doc.joints || [] },
      ),
      mode: cur.mode === 'edit' ? 'edit' : 'create',
    });
  };

  const handleQuickAngle = (degrees) => {
    const doc = assemblyRef.current;
    const card = jointCardRef.current;
    if (!doc || !card) return;
    const next = quickAngleCard(card, degrees, doc);
    if (!next) return;
    const scripts = partScriptsRef.current;
    const locked = !!assemblyOpenLockRef.current;
    const result = applyJointCard({
      doc,
      scripts,
      card: next,
      action: 'confirm',
      locked,
      preempt: null,
      catalogs: jointCatalogsRef.current,
    });
    if (locked) {
      viewportRef.current?.notify?.(result.message);
      return;
    }
    finishJointWrite(result, scripts, { resetPicks: true, toast: 'added' });
  };

  const handleJointCardChange = (next) => {
    const doc = assemblyRef.current;
    if (!next) return;
    if (Array.isArray(next.picks)) {
      const kept = new Set(next.picks.map((pick) => jointPickSlot(pick)));
      for (const pick of jointPicksRef.current || []) {
        const slot = jointPickSlot(pick);
        if (!kept.has(slot)) viewportRef.current?.clearJointHighlights?.(slot);
      }
      jointPicksRef.current = next.picks;
    }
    if (next.userPickedType && next.type && !next.userNamed) {
      const named = nextJointName(next.type, doc?.joints || []);
      setJointCard({ ...next, name: next.name && next.userNamed ? next.name : named });
      return;
    }
    setJointCard(next);
  };

  const armJointDeleteToast = () => {
    setJointDeleteToast(true);
    if (jointDeleteToastTimerRef.current) clearTimeout(jointDeleteToastTimerRef.current);
    jointDeleteToastTimerRef.current = setTimeout(() => {
      jointDeleteToastTimerRef.current = null;
      setJointDeleteToast(false);
    }, 3200);
  };
  const dismissJointDeleteToast = () => {
    if (jointDeleteToastTimerRef.current) clearTimeout(jointDeleteToastTimerRef.current);
    jointDeleteToastTimerRef.current = null;
    setJointDeleteToast(false);
  };
  /** Toast copy names the joint the way the current joints row shows it. */
  const jointWriteToast = (kind, doc, jointId) => {
    const joints = doc?.joints || [];
    const joint = joints.find((row) => row.id === jointId) || joints[joints.length - 1];
    if (!joint) return;
    const partId = cadPartIdRef.current;
    const viewSurfId = partId ? partSurfId((doc.parts || []).find((row) => row.id === partId)) : null;
    const label = jointChipLabel(joint, doc, viewSurfId);
    viewportRef.current?.notify?.(`${kind === 'edited' ? 'Edited' : 'Added'}: ${label}`, { undo: false });
  };

  const finishJointWrite = (result, scripts, { resetPicks = false, toast = null, jointId = null } = {}) => {
    if (!result?.ok) {
      if (result?.message) {
        viewportRef.current?.notify?.(result.message);
        setJointCard((cur) => (cur ? { ...cur, note: result.message } : cur));
      }
      return;
    }
    if (result.scripts !== scripts) return;
    const before = assemblyRef.current;
    const written = rememberAssembly(result.doc);
    assemblyHistoryRef.current = {
      key: assemblyHistoryRef.current?.key || assemblyHistoryKey(written),
      ...pushAssemblyHistory(assemblyHistoryRef.current, before, written),
    };
    setAssemblyHistTick((tick) => tick + 1);
    jointLiveRef.current = {
      statuses: result.statuses || {},
      messages: result.messages || {},
    };
    setJointLive(jointLiveRef.current);
    paintAssemblyPoses(written);
    if (toast === 'deleted') armJointDeleteToast();
    else if (toast) jointWriteToast(toast, written, jointId);
    if (resetPicks) {
      jointPicksRef.current = [];
      viewportRef.current?.clearJointHighlights?.();
      setJointCard(draftFromPicks(null, [], { joints: written.joints || [] }));
      return;
    }
    if (jointCardRef.current?.mode === 'create') {
      setJointCard((cur) => draftFromPicks(cur, jointPicksRef.current, { joints: written.joints || [] }));
      return;
    }
    setJointCard(null);
  };

  const handleJointConfirm = () => {
    const doc = assemblyRef.current;
    const card = jointCardRef.current;
    if (!doc || !card) return;
    const scripts = partScriptsRef.current;
    const locked = !!assemblyOpenLockRef.current;
    const result = applyJointCard({
      doc,
      scripts,
      card,
      action: 'confirm',
      locked,
      preempt: null,
      catalogs: jointCatalogsRef.current,
    });
    if (locked) {
      viewportRef.current?.notify?.(result.message);
      return;
    }
    finishJointWrite(result, scripts, { resetPicks: card.mode !== 'edit', toast: card.mode === 'edit' ? 'edited' : 'added', jointId: card.id });
  };

  const handleJointCancel = () => {
    dismissJointEdit(assemblyRef.current);
    jointPicksRef.current = [];
    viewportRef.current?.clearJointHighlights?.();
    publishJointCard(null);
  };

  const handleJointUndo = () => {
    const doc = assemblyRef.current;
    const scripts = partScriptsRef.current;
    const step = undoJointStrip({
      history: assemblyHistoryRef.current,
      doc,
      scripts,
    });
    if (!step.changed || step.scripts !== scripts) return false;
    assemblyHistoryRef.current = {
      key: assemblyHistoryRef.current?.key,
      ...step.history,
    };
    const written = rememberAssembly(step.doc);
    setAssemblyHistTick((tick) => tick + 1);
    paintAssemblyPoses(written);
    return true;
  };

  const handleJointRedo = () => {
    const doc = assemblyRef.current;
    const scripts = partScriptsRef.current;
    const step = redoJointStrip({
      history: assemblyHistoryRef.current,
      doc,
      scripts,
    });
    if (!step.changed || step.scripts !== scripts) return false;
    assemblyHistoryRef.current = {
      key: assemblyHistoryRef.current?.key,
      ...step.history,
    };
    const written = rememberAssembly(step.doc);
    setAssemblyHistTick((tick) => tick + 1);
    paintAssemblyPoses(written);
    return true;
  };

  const handleSelectJoint = (chip) => {
    const doc = assemblyRef.current;
    const joint = (doc?.joints || []).find((row) => row.id === chip?.id);
    if (!joint) return;
    const card = cardFromJoint(joint, doc);
    jointPicksRef.current = card.picks;
    setJointCard(card);
  };

  const handleJointDelete = (id) => {
    const doc = assemblyRef.current;
    if (!doc || !id) return;
    const scripts = partScriptsRef.current;
    const locked = !!assemblyOpenLockRef.current;
    const result = applyJointCard({
      doc,
      scripts,
      card: { mode: 'edit', id },
      action: 'delete',
      locked,
      preempt: null,
      catalogs: jointCatalogsRef.current,
    });
    if (locked) {
      viewportRef.current?.notify?.(result.message);
      return;
    }
    finishJointWrite(result, scripts, { toast: 'deleted' });
  };

  const handleFaceSelected = (faceData) => {
    setSelectedFace(faceData);
  };

  // --- Draggable editor/viewport split ---
  // Desktop: percentage width of the editor column. Mobile: an explicit editor
  // height in px that overrides the computed budget until the keyboard opens
  // (the keyboard case still wins — see mobileEditorPx).
  const splitShellRef = useRef(null);
  const handleSplitDragX = (clientX) => {
    const rect = splitShellRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.min(80, Math.max(20, pct)));
  };
  const handleSplitDragY = (clientY) => {
    const rect = splitShellRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const px = rect.bottom - clientY;
    setMobileEditorPx(Math.min(Math.max(px, 120), Math.max(160, rect.height - 160)));
  };

  /** CAD strip Select all — the button is in the strip, the editor is here. */
  const handleSelectAll = () => {
    codeEditorRef.current?.selectAll?.();
  };

  // Rename one part by id (Parts feed row). Working copy only: the id and
  // parts/<id>.js stay put. v2 may repeat a name. v1 still numbers a clash
  // because that name is the file stem. The title follows when that part
  // is the one it shows. Save writes the new // @name and parts[].name.
  const handleRenamePart = async (id, name) => {
    const doc = assemblyRef.current;
    if (!doc) return { status: 'error', code: 'no_assembly', error: 'No assembly loaded' };
    let nextName = sanitizePartName(name);
    if (!nextName) return { status: 'error', code: 'bad_args', error: 'Enter a part name' };
    const part = (doc.parts || []).find((row) => row && row.id === id);
    if (!part) return { status: 'error', code: 'unknown_part', error: `Unknown part id: ${id}` };
    if (part.name === nextName) {
      return { status: 'unchanged', from: id, to: id, name: nextName, moved: false };
    }
    const v2 = doc.source === 'git' && doc.vaultLayout === 'v2';
    if (!v2) {
      const otherNames = (doc.parts || []).filter((row) => row.id !== id).map((row) => row.name);
      if (otherNames.includes(nextName)) {
        nextName = nextNumberedName(nextName, otherNames, { bareFirst: true });
      }
    }
    const nextDoc = renamePart(doc, id, nextName);
    if (nextDoc === doc) return { status: 'unchanged', from: id, to: id, name: part.name, moved: false };
    const renamed = (nextDoc.parts || []).find((row) => row && row.id === id);
    if (!renamed || renamed.id !== part.id) {
      return {
        status: 'error',
        code: 'rename_failed',
        error: "Couldn't rename the part. Nothing was changed.",
      };
    }
    rememberAssembly(nextDoc);
    if (renameTargetId(nextDoc, cadPartIdRef.current) === id) {
      setCurrentFilename(renamed.name || null);
    }
    return { status: 'renamed', from: id, to: id, name: renamed.name, moved: false, git: false };
  };

  // Rename from the viewer title chip. It lands on the part the title shows:
  // a pick on another part moves the title (cadPartId) but not the editor's
  // activeId, so writing to activeId renamed the wrong part.
  const handleRenameFile = (name) => {
    const doc = assemblyRef.current;
    const id = renameTargetId(doc, cadPartIdRef.current);
    if (!doc || id == null) {
      const next = String(name || '').trim();
      if (next) setCurrentFilename(next);
      return;
    }
    handleRenamePart(id, name);
  };

  const handleRenameAssembly = async (name) => {
    const doc = assemblyRef.current;
    if (!doc) return { status: 'error', code: 'no_assembly', error: 'No assembly loaded' };
    // v2: display name only. assemblies/<id>.surf.json does not move.
    // The row goes dirty; the next Save writes the name. v1 still records
    // the old folder so Save can move it.
    if (doc.source === 'git' && doc.vaultLayout === 'v2') {
      const nextName = sanitizeAssemblyName(name);
      if (!nextName) {
        return { status: 'error', code: 'bad_args', error: 'Enter an assembly name' };
      }
      if (!isV2SurfId(doc.id)) {
        return {
          status: 'error',
          error: "Couldn't rename the assembly. Nothing was changed.",
        };
      }
      if (assemblyName(doc) === nextName) {
        return { status: 'unchanged', assemblyId: doc.id, name: nextName, moved: false };
      }
      rememberAssembly({ ...doc, name: nextName });
      return { status: 'renamed', assemblyId: doc.id, name: nextName, moved: false };
    }
    const current = assemblyName(doc);
    const taken = await collectTakenAssemblyNames({ except: current });
    const resolved = resolveAssemblyFolderName(name, taken, { except: current });
    if (!resolved.ok) {
      if (resolved.reason === 'taken') {
        setUploadError('An assembly with that name already exists');
      }
      return;
    }
    const hasVaultName = !!(
      gitBaselineRef.current?.assemblyPath
      || gitBaselineRef.current?.assemblyName
      || (doc.parts || []).some((row) => partRepoPath(row))
    );
    if (hasVaultName) {
      const vaultName = gitBaselineRef.current?.assemblyName || current;
      rememberSidecar(recordRenameFrom(gitSidecarRef.current, vaultName));
    }
    rememberAssembly({ ...doc, name: resolved.name });
  };

  // Handle account button click
  const handleAccount = () => {
    if (isAuthenticated) {
      setAccountModalTab('info');
      setShowAccountModal(true);
    } else {
      setShowLoginModal(true);
    }
  };

  /**
   * Count unpushed outbox rows and unsynced parts from local state.
   * Opens IndexedDB. Does not fetch and does not push.
   */
  const snapshotClearPlan = async () => {
    const doc = assemblyRef.current;
    const vault = gitVaultRef.current;
    const hasRepo = !!(doc?.source === 'git' && vault?.repo && gitAdapterRef.current);
    let outbox = 0;
    let queued = 0;
    try {
      const store = gitSync();
      await store.ready();
      const ops = store.ops();
      outbox = ops.filter((op) => op.status === 'queued' || op.status === 'sending' || op.status === 'failed').length;
      if (hasRepo) {
        const key = repoKeyOf(vault.repo);
        const branch = gitWorkingBranch();
        queued = ops.filter((op) => op.repoKey === key
          && (op.branch || 'main') === branch
          && (op.status === 'queued' || op.status === 'sending')).length;
      }
    } catch (err) {
      console.warn('[ClearLocalCache] plan:', err);
    }
    const unsynced = (doc?.parts || []).filter((part) => part.isSynced === false).length;
    return clearCachePlan({
      source: hasRepo ? 'git' : 'local',
      hasRepo,
      outboxCount: outbox,
      queuedCount: queued,
      unsyncedCount: unsynced,
    });
  };

  /** Profile menu: open the confirm popup. Signed out still works; no fetch. */
  const openClearLocalCache = async () => {
    const plan = await snapshotClearPlan();
    setClearCacheUi({ plan, busy: false, error: '' });
  };

  /**
   * Confirm or Push first. Push first is the normal flush, and only when the
   * plan offers it. The wipe keeps the GitHub session token and does not
   * touch the remote repo. Reload then loads the repo (git) or an empty
   * local workspace (local / signed out).
   */
  const handleClearLocalCadData = async ({ pushFirst = false } = {}) => {
    const plan = clearCacheUi?.plan || await snapshotClearPlan();
    setClearCacheUi((ui) => (ui ? { ...ui, busy: true, error: '' } : ui));
    try {
      const outcome = await runClearLocalCache({
        pushFirst,
        plan,
        push: () => flushGitOps(),
        wipe: async () => {
          suppressPartSaveRef.current = true;
          editorLiveRef.current = false;
          partSaveEpochRef.current += 1;
          refreshGenRef.current += 1;
          await clearLocalCadData();
        },
      });
      if (!outcome.cleared) {
        const status = outcome.result?.status || outcome.reason || 'failed';
        setClearCacheUi((ui) => (ui ? {
          ...ui,
          busy: false,
          error: status === 'no-push'
            ? 'Nothing queued to push.'
            : `Push did not finish (${status}). Local cache was kept.`,
        } : ui));
        return;
      }
      window.location.reload();
    } catch (err) {
      setClearCacheUi((ui) => (ui ? {
        ...ui,
        busy: false,
        error: err?.message || 'Could not clear local cache',
      } : ui));
    }
  };

  /** After profile Sign out / Delete account: drop vault token state and git chrome. */
  const handleProfileSignedOut = () => {
    clearGithubToken();
    setGithubConnected(false);
    gitVaultRef.current = null;
    gitAdapterRef.current = null;
    rememberGitBaseline(null);
    rememberGitBehind(null, { showToast: false, resetResolved: true });
    setGitBehindToast(null);
    const doc = assemblyRef.current;
    if (doc && doc.source === 'git') {
      rememberAssembly({ ...doc, source: 'local' });
    }
  };

  // Handle account modal from order flow
  const handleOpenAccount = (tab = 'info') => {
    setAccountModalTab(tab);
    setShowAccountModal(true);
  };

  // Handle login modal completion
  const handleLoginComplete = async () => {
    setShowLoginModal(false);
    await checkAuth();
  };

  const clearCartCheckout = () => {
    cartCheckoutRef.current = null;
    setCartCheckout(null);
  };

  // Handle quote modal close. Closing cancels the remaining lines.
  const handleQuoteClose = () => {
    setShowQuoteModal(false);
    clearCartCheckout();
  };

  // Cart lines quote their own script. The viewport method quotes the editor.
  const handleGetQuote = async (options) => {
    const session = cartCheckoutRef.current;
    const line = session?.lines?.[session.index];
    if (line) {
      if (!line.script) {
        throw new Error(line.lineError || 'This part is missing. It was left in the cart.');
      }
      try {
        return await calculateQuote(line.script, {
          ...(line.options || {}),
          ...(options || {}),
          quantity: line.qty,
          partId: line.partId,
          lineError: line.lineError || '',
        });
      } catch (err) {
        const message = err?.message || line.lineError || 'Could not quote this part.';
        if (line.lineError && /mesh asset|importMesh/i.test(message)) {
          throw new Error(line.lineError);
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    return viewportRef.current?.calculateQuote(options);
  };

  // Handle start order
  const handleStartOrder = (quoteData, modelData) => {
    const line = cartCheckoutRef.current?.lines?.[cartCheckoutRef.current.index];
    setShowQuoteModal(false);
    setOrderData({
      quoteData,
      modelData,
      lineId: line?.lineId || null,
      script: line?.script || null,
    });
    setShowOrderModal(true);
  };

  // Handle order modal close
  const handleOrderClose = () => {
    setShowOrderModal(false);
    setOrderData(null);
    setShowQuoteModal(false);
    clearCartCheckout();
  };

  const handleCartOrderPlaced = () => {
    const lineId = orderData?.lineId
      || cartCheckoutRef.current?.lines?.[cartCheckoutRef.current.index]?.lineId;
    if (lineId) cartChrome.removeLine(lineId);
  };

  const handleCheckoutNext = () => {
    const prev = cartCheckoutRef.current;
    if (!prev || prev.index + 1 >= prev.lines.length) {
      handleOrderClose();
      return;
    }
    const next = { lines: prev.lines, index: prev.index + 1 };
    cartCheckoutRef.current = next;
    setCartCheckout(next);
    setOrderData(null);
    setShowOrderModal(false);
    setShowQuoteModal(true);
  };

  // Cart checkout is one page. The per-line stepper stays mounted so a
  // checkout already in flight (including an OAuth return) can finish.
  onCartCheckoutRef.current = (plan) => {
    const payable = Array.isArray(plan?.payable) ? plan.payable.length : undefined;
    track('checkout_started', payable != null ? { line_count: payable } : {});
    setShowCheckoutPage(true);
  };

  // Upload creates a new part. It never overwrites the script that is open.
  // The mesh stays in the local asset cache. This does not commit to the vault.
  const handleImport = async (file) => {
    if (!file) return;
    if (isBackendFormat(file.name) && !isAuthenticated) {
      setUploadError('Sign in to import STEP');
      return;
    }
    if (!manifoldReady) {
      setUploadError('Manifold not ready. Please wait...');
      return;
    }
    const doc = assemblyRef.current;
    if (!doc) {
      setUploadError('Open or create an assembly before uploading a model.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadNotice(null);

    try {
      const raw = checkRawUpload(file.size);
      if (!raw.ok) {
        setUploadError(raw.message);
        return;
      }

      const result = await importFile(file, { skipCache: true });
      const mesh = result?.meshData;
      if (!mesh?.vertProperties || !mesh?.triVerts) {
        setUploadError('That file did not produce a mesh.');
        return;
      }
      const bytes = encodeMesh(mesh);
      const stored = checkStoredMesh(bytes.byteLength);
      if (!stored.ok) {
        setUploadError(stored.message);
        return;
      }
      const sha = await putAsset(bytes);

      const live = codeEditorRef.current?.getContent?.();
      const prev = doc.activeId;
      const scripts = { ...partScriptsRef.current };
      if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
        scripts[prev] = live;
        savePartScript(prev, live);
        stashPartHistory(prev, live);
      }

      const name = dedupedImportName(file.name, (doc.parts || []).map((part) => part.name));
      const assetName = meshAssetName(name);
      let id;
      let path;
      if (doc.source === 'git') {
        let taken = (doc.parts || []).map((part) => partRepoPath(part) || part.id);
        const vault = gitVaultRef.current;
        if (vault?.repo && gitAdapterRef.current) {
          try {
            taken = [
              ...taken,
              ...(await listVaultTreePaths(gitAdapterRef.current, vault.repo, gitWorkingBranch())),
            ];
          } catch (err) {
            setUploadError(err?.message || VAULT_TREE_UNAVAILABLE_MESSAGE);
            return { status: 'error', code: err?.code || VAULT_TREE_UNAVAILABLE, error: err?.message };
          }
        }
        path = allocateVaultPartPath(doc.name, name, taken, { layout: 'assembly-folder' });
        if (!path) {
          setUploadError('Could not assign a path for this upload.');
          return;
        }
      }
      id = mintSurfId();
      let starter = importMeshScript(assetName);
      let surfId = null;
      if (doc.source === 'git') {
        surfId = id;
        starter = withSurfId(starter, surfId);
      }
      const order = doc.parts.length;
      const part = {
        id,
        ...(path ? { path } : {}),
        name,
        visible: true,
        order,
        position: order === 0 ? undefined : [order * 40, 0, 0],
        ...(doc.source === 'git' ? { isSynced: false, ...(surfId ? { surfId } : {}) } : {}),
      };
      const assets = { [assetName]: sha };
      scripts[id] = starter;
      rememberScripts(scripts);
      rememberPartAssets(id, assets);
      const nextMeta = {
        ...partMeshMetaRef.current,
        [id]: { assets, meshSynced: false },
      };
      partMeshMetaRef.current = nextMeta;
      setPartMeshMeta(nextMeta);
      partSaveEpochRef.current += 1;
      refreshGenRef.current += 1;
      rememberCadPart(id);
      rememberAssembly({
        ...doc,
        activeId: id,
        parts: [...doc.parts, part],
      }, { force: true });
      focusPartHistory(id, starter);
      suppressPartSaveRef.current = false;
      setCurrentFilename(name);
      try {
        const saved = await savePartScript(id, starter, {
          assets,
          meshSynced: false,
          ...(doc.source === 'git' ? { isSynced: false } : {}),
        });
        if (!saved) throw new Error('Could not save the uploaded part');
        saveEditorDraft({ script: starter, filename: name, partId: id });
        codeEditorRef.current?.loadContent(starter, name, false);
        if (stored.warn) setUploadNotice(stored.message);
      } catch (err) {
        const cur = assemblyRef.current;
        if (cur?.parts?.some((row) => row.id === id)) {
          rememberAssembly(removePart(cur, id), { force: true });
          rememberScripts(dropPartRecord(partScriptsRef.current, id));
        }
        forgetPartAssets(id);
        const dropped = { ...partMeshMetaRef.current };
        delete dropped[id];
        partMeshMetaRef.current = dropped;
        setPartMeshMeta(dropped);
        try { await deletePartScript(id); } catch { /* ignore */ }
        rememberCadPart(prev || null);
        const prevPart = assemblyRef.current?.parts?.find((row) => row.id === prev);
        setCurrentFilename(prevPart?.name || null);
        setUploadNotice(null);
        setUploadError(err?.message || 'Could not save the uploaded part');
      }
    } catch (error) {
      console.error('[App] Import error:', error);
      setUploadError(error.message || 'Failed to import file');
    } finally {
      setIsUploading(false);
    }
  };

  const resolveActivePartExportMesh = async (partIdHint = null) => {
    const doc = assemblyRef.current;
    const id = partIdHint || cadPartIdRef.current || doc?.activeId;
    const part = doc?.parts?.find((row) => row.id === id) || null;
    if (partIdHint && !part) {
      return { error: { code: 'unknown_part', message: `Unknown part id: ${partIdHint}` } };
    }
    const run = id ? partRunsRef.current?.[id] : null;
    const leftover = id ? partLeftoversRef.current?.[id] : null;
    let decision = selectedPartDownload({ part, run, leftover });
    if (!decision.ok && !decision.needsRun) {
      return { error: { code: 'export_failed', message: decision.message } };
    }
    if (!decision.ok) {
      const scripts = { ...partScriptsRef.current };
      const live = codeEditorRef.current?.getContent?.();
      if (id === doc?.activeId && !suppressPartSaveRef.current && typeof live === 'string') {
        scripts[id] = live;
      }
      const result = await runAssemblyParts({
        doc,
        scripts,
        ids: [id],
        execute: (script, execOpts) => {
          const anchor = rollbackAnchorsRef.current[String(execOpts?.partId || '')];
          if ((anchor === null || typeof anchor === 'string') && rollbackClearsPart(script, anchor)) {
            return { ok: true, cleared: true };
          }
          return manifoldContext.executeScript(script, {
            timeoutMs: 30000,
            importedModels: execOpts?.importedModels,
            ...(anchor === null || typeof anchor === 'string' ? { rollbackAnchor: anchor } : {}),
          });
        },
      });
      const ran = result.runs?.[id];
      if (ran?.ok && ran.mesh?.vertProperties) {
        partLeftoversRef.current[id] = ran.mesh;
        decision = { ok: true, mesh: ran.mesh, filename: decision.filename || part?.name };
      } else {
        const why = ran?.error && ran.error !== 'failed' && ran.error !== 'missing'
          ? ran.error
          : (decision.message || 'No model to export');
        return {
          error: {
            code: 'export_failed',
            message: part ? `${part.name} failed: ${why}` : why,
          },
        };
      }
    }
    return {
      mesh: decision.mesh,
      filename: decision.filename || part?.name || 'part',
      partId: id,
    };
  };

  const handleDownloadPart = async () => {
    setIsDownloading(true);
    setUploadError(null);
    setUploadNotice(null);
    try {
      const resolved = await resolveActivePartExportMesh();
      if (resolved.error) {
        setUploadError(resolved.error.message);
        return;
      }
      await downloadModelFromMesh(resolved.mesh, resolved.filename);
    } catch (error) {
      setUploadError(error?.message || 'Could not download part');
    } finally {
      setIsDownloading(false);
    }
  };


  /**
   * CAD outcome after refreshAssembly. A recovered solid is still a failed
   * feature. Only a run that reported success (or an empty part) is ok.
   * A run that never reported omits runFailure so the bridge keeps the
   * previous failure instead of treating a stale ref as this run.
   */
  const agentCadRunOutcome = (epochBefore, ran) => {
    const doc = assemblyRef.current;
    const id = doc?.activeId;
    const part = id ? doc.parts.find((row) => row.id === id) : null;
    const partName = part?.name || '';
    const run = id ? partRunsRef.current?.[id] : null;
    const reported = runOutcomeEpochRef.current !== epochBefore;
    const failure = reported ? runFailureRef.current : null;
    const timingKey = id ? definitionIdFor(id, doc) : '__cad__';
    const featureMs = featureTimingsRef.current[timingKey];
    const memo = featureCacheRef.current[timingKey];
    const timings = {
      ...(featureMs && Object.keys(featureMs).length ? { featureMs } : {}),
      // Feature memoisation on that run (status.cache, status.featureCached).
      ...(memo?.cache ? { cache: memo.cache } : {}),
      ...(memo?.cached && Object.keys(memo.cached).length ? { featureCached: memo.cached } : {}),
    };
    if (reported && !failure) {
      if (run?.empty) {
        return {
          ok: true, errors: [], volume: null, bbox: null, partName, runFailure: null, bodyCount: 0, ...timings,
        };
      }
      if (run?.ok === true && run.mesh?.vertProperties) {
        const geom = geometryFromExecuteResult(run);
        return {
          ok: true,
          errors: [],
          volume: geom.volume,
          bbox: geom.bbox,
          partName,
          runFailure: null,
          bodyCount: finishedRunBodyCount(run, bodyCountOfWorkerMesh(run.mesh)),
          ...timings,
        };
      }
    }
    const pending = failure || (!reported ? runFailureRef.current : null);
    const message = (typeof pending?.message === 'string' && pending.message)
      || (run && run.error)
      || (!reported || ran === false ? 'Run did not finish' : 'Script failed');
    const result = {
      ok: false,
      errors: [String(message)],
      volume: null,
      bbox: null,
      partName,
      ...timings,
    };
    if (reported) result.runFailure = failure || null;
    // The viewport never stamped this run (it bailed early, a later refresh
    // superseded it, or the kernel was mid-restart). The errors above are
    // the previous failure, not this run's: say so instead of passing them
    // off as fresh.
    if (!reported) result.stale = true;
    return result;
  };

  // Browser-agent bridge. Main thread only: the worker lockdown replaces fetch.
  // App publishes the script, history, and toolbar handlers. Viewport merges
  // screenshot onto the same ref. fillAgentHost keeps the other side's keys.
  fillAgentHost(agentHostRef, {
    getScript() {
      return codeEditorRef.current?.getContent?.() ?? '';
    },
    setEditor(src) {
      // The script underneath an open feature card is about to change and
      // run: drop the card and its block preview rather than leave them up.
      if (agentFeatureSessionActive()) dismissAgentFeatureSession({ mode: 'drop' });
      const text = wrapRawScript(typeof src === 'string' ? src : '');
      codeEditorRef.current?.setTextOnly?.(text);
      const id = assemblyRef.current?.activeId;
      if (id) revealPartOnRibbon(id, text);
      else setCurrentScript(text);
    },
    readHistory() {
      const id = historyKey();
      const existing = partHistoriesRef.current[id];
      if (existing && Array.isArray(existing.commits)) return existing;
      return { commits: [], head: -1 };
    },
    writeHistory(history) {
      const id = historyKey();
      const next = {
        commits: Array.isArray(history?.commits) ? history.commits : [],
        head: Number.isInteger(history?.head) ? history.head : -1,
      };
      partHistoriesRef.current[id] = next;
      applyPartHistory(next);
    },
    async execute(script) {
      const text = typeof script === 'string' ? script : '';
      setCurrentScript(text);
      if (appModeRef.current === 'game') {
        return {
          ok: false,
          errors: ['Agent bridge drives the CAD tab'],
          volume: null,
          bbox: null,
          partName: '',
          runFailure: null,
        };
      }
      let epochBefore = runOutcomeEpochRef.current;
      let ran = await refreshAssemblyRef.current?.(text, { forceActive: true });
      let outcome = agentCadRunOutcome(epochBefore, ran);
      if (outcome.stale === true) {
        // Same recovery as agentRunOutcomeSettled: one more run once the
        // kernel is back, so a mutate during a worker restart reports itself.
        try { await manifoldContext.whenReady(); } catch { /* the retry reports */ }
        epochBefore = runOutcomeEpochRef.current;
        ran = await refreshAssemblyRef.current?.(text, { forceActive: true });
        outcome = agentCadRunOutcome(epochBefore, ran);
      }
      const dropped = viewportRef.current?.readDroppedPaints?.(assemblyRef.current?.colors ?? null);
      if (Array.isArray(dropped)) outcome.droppedPaints = dropped;
      return outcome;
    },
    // Toolbar handlers. v1 `run` and `undo` keep the script mutate path.
    // Later commands call these same functions the buttons call.
    undo: handleUndo,
    redo: handleRedo,
    runScript: handleGameRun,
    readRunFailure() {
      return runFailureRef.current;
    },
    prepareHelperInsert({ helperId, params = null, faceContext = null, edgeContext = null } = {}) {
      const item = HELPER_PALETTE_ITEMS.find((row) => row.id === helperId);
      if (!item) {
        return { error: { code: 'unknown_helper', message: `Unknown helper id: ${helperId}` } };
      }
      if (!focusWritePart(null)) {
        return { error: { code: 'no_write_part', message: 'No writable part for helper insert' } };
      }
      const buffer = codeEditorRef.current?.getContent?.() ?? '';
      // The rollback bar: an agent insert lands at the bar like a palette
      // insert, and the bar moves onto the new block, so the block is
      // evaluated (follow-up 6: a cube appended after the bar was blanked
      // as rolled back and status kept the old volume).
      const rollbackKey = editorRollbackKey();
      const stored = storedRollback(rollbackKey);
      const rolledBack = stored === null || typeof stored === 'string';
      const caret = rolledBack ? rollbackInsertCaret(buffer, stored) : null;
      const placeAtBar = rolledBack && typeof caret === 'number';
      if (helperId === 'boolean') {
        // booleanBodies throws once the part is one solid, and the failed
        // block used to stay in the script. Refuse before compose.
        const activeId = assemblyRef.current?.activeId;
        const run = activeId ? partRunsRef.current?.[activeId] : null;
        const why = booleanInsertRefusal(
          finishedRunBodyCount(run, run?.mesh ? bodyCountOfWorkerMesh(run.mesh) : null),
          params,
        );
        if (why) return { error: { code: 'insert_failed', message: why } };
      }
      const content = composeHelperInsert(
        buffer,
        helperId,
        placeAtBar ? caret : null,
        params,
        faceContext,
        edgeContext,
      );
      if (typeof content !== 'string') {
        return {
          error: {
            code: 'insert_failed',
            message: describeHelperRefusal(item, { params, faceContext, edgeContext, buffer }),
          },
        };
      }
      if (rollbackKey) {
        // Same rule as the palette insert (handleInsertHelper): the bar moves
        // onto the block that landed at it; an insert with the bar at the
        // end clears a stale anchor.
        if (placeAtBar) storeRollbackAnchor(rollbackKey, rollbackAnchorAfterInsert(buffer, content, stored));
        else if (rolledBack) storeRollbackAnchor(rollbackKey, undefined);
      }
      return { source: content };
    },
    prepareContourMutate: (payload, meta) => prepareAgentContourMutate(
      { ...payload, partId: payload?.partId ?? assemblyRef.current?.activeId },
      meta,
    ),
    prepareHoleMutate: (payload) => prepareAgentHoleMutate(payload),
    prepareSheetMutate: (prepared) => prepareAgentSheetMutate(prepared),
    applyHoleMutateExtras(prep) {
      applyAgentHoleMutateExtras(prep);
    },
    applyContourMutateExtras(prep) {
      if (!prep) return;
      applyAgentContourRollback(prep.placement);
      if (prep.runSubtract) {
        crossPartSubtract(prep.runSubtract, codeEditorRef.current?.getContent?.() ?? '');
      }
    },
    async agentExportPart({ format, part_id: partId, download } = {}) {
      const kind = String(format || '').toLowerCase();
      if (!['stl', '3mf', 'step'].includes(kind)) {
        return { error: { code: 'bad_args', message: 'export_part needs format stl, 3mf, or step' } };
      }
      const resolved = await resolveActivePartExportMesh(
        typeof partId === 'string' && partId ? partId : null,
      );
      if (resolved.error) return resolved;
      const stem = resolved.filename || 'part';
      try {
        if (download === true) {
          if (kind === '3mf') {
            await downloadModelFromMesh(resolved.mesh, stem);
            return {
              result: {
                format: kind,
                filename: `${stem.replace(/\.(stl|3mf|step|stp)$/i, '') || 'part'}.3mf`,
                downloaded: true,
              },
            };
          }
          const out = await downloadMeshExport(resolved.mesh, kind, stem);
          return { result: out };
        }
        const out = await meshExportBase64(resolved.mesh, kind, stem);
        return { result: out };
      } catch (err) {
        return {
          error: {
            code: 'export_failed',
            message: err?.message || 'Could not export part',
          },
        };
      }
    },
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      const demo = new URLSearchParams(window.location.search).get('agentGitConsentDemo') === '1';
      if (demo) {
        setAgentGitConsentUi({
          command: 'git_save',
          repo: 'demo-owner/demo-vault',
          branch: 'main',
        });
      }
    } catch { /* ignore */ }
    return undefined;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const enabled = agentBridgeEnabled({ dev: import.meta.env.DEV === true });
    if (!enabled || !manifoldReady || editorInitialScript === null) {
      delete window.surfcad;
      return undefined;
    }
    window.surfcad = createSurfcadBridge({
      resolve: () => agentHostRef.current,
    });
    return () => {
      delete window.surfcad;
    };
  }, [manifoldReady, editorInitialScript]);

  // Tailscale / mobile: never leave the user on "Loading..." forever if the
  // CAD engine stalls. A slow /api/auth/me or vault resolve keeps the
  // "Restoring document…" gate; it must not paint the stock cube.
  useEffect(() => {
    if (manifoldReady && editorInitialScript !== null) return undefined;
    if (initError) return undefined;
    const restoring = manifoldReady && editorInitialScript == null;
    const LOADING_WATCHDOG_MS = restoring ? 90000 : 75000;
    const id = setTimeout(() => {
      if (manifoldReady && editorInitialScript == null) {
        setInitError((prev) => prev || 'Could not restore the last assembly. Tap Retry.');
        return;
      }
      setInitError((prev) => prev || 'Still loading after 75s — CAD engine stalled. Tap Retry.');
    }, LOADING_WATCHDOG_MS);
    return () => clearTimeout(id);
  }, [manifoldReady, editorInitialScript, initError]);

  useEffect(() => {
    if (!manifoldReady || editorInitialScript === null) return undefined;
    clearLoadingTheme();
    return undefined;
  }, [manifoldReady, editorInitialScript]);

  // Show error state if initialization failed
  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center max-w-md p-6">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold mb-2">Initialization Failed</h1>
          <p className="text-gray-400 mb-4">{initError}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show loading state while Manifold initializes
  if (!manifoldReady || editorInitialScript === null) {
    const loadingTheme = readLoadingTheme();
    const loadingDark = loadingTheme === 'dark';
    const muted = loadingDark ? 'text-muted-on-splash-dark' : 'text-muted-on-light';
    return (
      <div
        className={`flex h-screen items-center justify-center font-ui ${loadingDark ? 'surface-splash-dark' : 'surface-light'}`}
        data-app-loading=""
        data-app-loading-theme={loadingTheme}
      >
        <div className="flex flex-col items-center px-6 text-center">
          <BrandMark size={72} tone={loadingDark ? 'paper-tile' : 'ink'} />
          <div className="mt-4">
            <BrandWordmark tone={loadingDark ? 'splash-dark' : 'splash'} size={40} />
          </div>
          <p className={`mt-3 text-sm ${muted}`} data-brand-tagline="">
            Don't do CAD. SurfCAD.
          </p>
          <p className={`mt-6 text-xs ${muted}`} data-app-loading-status="">
            {!manifoldReady ? 'Starting CAD engine…' : 'Restoring document…'}
          </p>
        </div>
      </div>
    );
  }

  // Phone shell:
  //  - CAD (Slice Mobile A): dual stage — CAD = fullscreen viewport+rails,
  //    Script = fullscreen editor+toolbar. No cramped Monaco strip.
  //  - Game: still viewport-on-top + Monaco bottom budget (unchanged).
  // Keyboard open pins the shell to visualViewport (slice 05).
  const keyboardOverlap = Math.max(0, vv.layoutHeight - vv.height - vv.offsetTop);
  const keyboardOpen = keyboardOverlap > 80;
  const mobileEditorPx = keyboardOpen
    ? Math.round(Math.min(Math.max(vv.height * 0.36, 120), vv.height * 0.42))
    : (mobileEditorPxOverride != null
      // A dragged height wins over the default budget, but never so far that
      // the viewport or the editor collapses.
      ? Math.round(Math.min(Math.max(mobileEditorPxOverride, 120), Math.max(160, vv.height - 160)))
      : Math.round(Math.min(Math.max(vv.height * 0.32, 160), vv.height * 0.38)));

  const cadHighlightId = cadPartId || assemblyDoc?.activeId || null;
  const sheetRibbonOpen = sketchStrip == null && sheetStrip != null;
  const jointsChrome = jointsChromeMounted({ appMode, featureSession });
  // Strip Undo walks the assembly stack only while the assembly itself is
  // selected (title chip). The strip shows no feature chips then.
  const showJoints = !sheetRibbonOpen && jointsChrome && stripUndoTarget(cadPartId) === 'joint';
  const jointCreateOpen = jointsChromeMounted({ appMode, featureSession })
    && (jointCard?.mode === 'create' || jointCard?.mode === 'edit');
  const jointUndoReady = showJoints && assemblyHistTick >= 0 && assemblyHistoryCanUndo(assemblyHistoryRef.current);
  const jointRedoReady = showJoints && assemblyHistoryCanRedo(assemblyHistoryRef.current);
  const stripUndo = showJoints ? handleJointUndo : handleUndo;
  const stripRedo = showJoints ? handleJointRedo : handleRedo;
  const stripCanUndo = showJoints ? jointUndoReady : canUndo();
  const stripCanRedo = showJoints ? jointRedoReady : canRedo();
  const undoLabel = stripUndoLabel(showJoints ? null : cadPartId);
  const redoLabel = stripRedoLabel(showJoints ? null : cadPartId);
  const sketchOpen = sketchStrip != null;
  // Per-part joints row under the strip (Half A). Scope is the selected part,
  // or the whole assembly while the assembly is selected.
  const jointsRowOpen = jointsChrome && !sketchOpen && !sheetRibbonOpen && !!assemblyDoc;
  const cadPartRow = cadPartId ? (assemblyDoc?.parts || []).find((row) => row.id === cadPartId) || null : null;
  const cadPartSurfId = cadPartRow ? partSurfId(cadPartRow) : null;
  const jointsRowScope = cadPartId ? 'part' : 'assembly';
  const jointsRowChips = !jointsRowOpen
    ? null
    : (cadPartId && !cadPartSurfId ? [] : jointRowChips(assemblyDoc, jointLive, { surfId: cadPartSurfId }));
  const jointsRowPartName = cadPartRow?.name || '';
  const jointsRowNode = jointsRowOpen
    ? (
      <JointsRow
        chips={jointsRowChips}
        scope={jointsRowScope}
        partName={jointsRowPartName}
        activeJointId={jointCard?.mode === 'edit' ? jointCard.id : null}
        onSelectJoint={handleSelectJoint}
        compact={isMobile}
      />
    )
    : null;
  const jointDeleteToastNode = jointDeleteToast && jointsChrome
    ? (
      <FeatureDeleteToast
        lines={['Deleted.']}
        canUndo={assemblyHistTick >= 0 && assemblyHistoryCanUndo(assemblyHistoryRef.current)}
        onUndo={() => {
          handleJointUndo();
          dismissJointDeleteToast();
        }}
        onDismiss={dismissJointDeleteToast}
      />
    )
    : null;
  const jointCardNode = jointCreateOpen && appMode !== 'game'
    ? (
      <JointCard
        card={jointCard}
        distanceRangeMm={(() => {
          const parts = assemblyDoc?.parts || [];
          let longest = 0;
          let seen = false;
          for (const pick of jointCard?.picks || []) {
            const part = parts.find((row) => partSurfId(row) === pick?.surfId);
            if (!part?.id) continue;
            seen = true;
            longest = Math.max(longest, characteristicLengthFor({ partId: part.id }));
          }
          const lengthMm = seen && longest > 0 ? longest : 100;
          return offscreenRange(fallbackOffscreenDistance(lengthMm));
        })()}
        locked={!!assemblyOpenLockRef.current}
        onChange={handleJointCardChange}
        onConfirm={handleJointConfirm}
        onCancel={handleJointCancel}
        onDelete={() => handleJointDelete(jointCard?.id)}
        onQuickAngle={handleQuickAngle}
        onResolvePartChange={handleResolvePartChange}
        groundPart={(() => {
          const part = cadPartId ? (assemblyDoc?.parts || []).find((row) => row.id === cadPartId) : null;
          return part && partSurfId(part) ? { id: part.id, name: part.name || part.id } : null;
        })()}
        onGroundPart={(partId) => handleJointPick({ partId, kind: 'part', planar: false, axis: false, key: null })}
        compact={isMobile}
      />
    )
    : null;
  const liveDirtyScript = gitDirtyLiveScript({
    source: assemblyDoc?.source,
    activeId: assemblyDoc?.activeId,
    highlightId: cadHighlightId,
    editorLive: editorLiveRef.current,
    script: editorLiveRef.current
      ? (codeEditorRef.current?.getContent?.() ?? currentScript)
      : currentScript,
  });
  // Yellow dots only when content differs from baseline, or the row still
  // has no vault path. Do NOT treat a null in-memory baseline as fully dirty
  // — that falsely dotted every in-repo part after reload (#215).
  // firstCommitBaseline is for a true first commit (path-less rows only).
  const gitParts = assemblyDoc?.parts || [];
  const hasLocalPartIds = gitParts.some((p) => !partRepoPath(p) && !isV2SurfId(p?.id));
  const needsFirstCommitChrome = (
    assemblyDoc?.source === 'git'
    && !gitBaseline
    && hasLocalPartIds
    && !isV2PlanSaveDoc(assemblyDoc)
  );
  const dirtyBaseline = gitBaseline || (
    needsFirstCommitChrome
      ? firstCommitBaseline({
        branch: gitVaultRef.current?.defaultBranch || 'main',
        headSha: gitVaultRef.current?.headSha || null,
      })
      : null
  );
  let gitDirtyIds = (
    assemblyDoc?.source === 'git' && dirtyBaseline
  ) ? dirtyPartIds(assemblyDoc, partScripts, dirtyBaseline, {
    liveId: assemblyDoc.activeId,
    liveScript: liveDirtyScript,
  }) : (
    // Awaiting tip reseed: only local: rows; repo paths stay clean until
    // baseline arrives and a real content diff can run. v2 ids are not paths.
    assemblyDoc?.source === 'git'
      ? new Set(gitParts.filter((p) => !partRepoPath(p) && !isV2SurfId(p?.id)).map((p) => p.id))
      : new Set()
  );
  let sourceDirty = (
    assemblyDoc?.source === 'git'
    && (
      needsFirstCommitChrome
      || sidecarIsDirty(gitSidecar)
      || (gitBaseline
        && isWorkspaceDirty(assemblyDoc, partScripts, gitBaseline, {
          liveId: assemblyDoc.activeId,
          liveScript: liveDirtyScript,
        }))
    )
  );
  if (isV2PlanSaveDoc(assemblyDoc)) {
    const vault = gitVaultRef.current;
    const branch = gitWorkingBranch();
    const store = gitSync();
    const assemblyCommit = vault?.repo
      ? store.getAssemblyCommit(vault.repo, branch, assemblyDoc.id)
      : null;
    const compared = compareWorkingCopyToCommit({
      doc: assemblyDoc,
      scripts: partScripts,
      liveId: assemblyDoc.activeId,
      liveScript: liveDirtyScript,
      assemblyCommit,
      pendingSave: !!(vault?.repo && store.getPendingSave(vault.repo, branch)),
      sidecarDirty: sidecarIsDirty(gitSidecar),
    });
    gitDirtyIds = new Set(compared.partIds || []);
    sourceDirty = compared.unsaved === true
      || compared.assemblyDirty === true
      || compared.pendingSave === true;
  }
  const behindMarkers = (
    assemblyDoc?.source === 'git' && gitBehind
  ) ? remainingBehindMarkers(gitBehind, gitBehindResolved) : { assemblyBehind: false, partIds: [], any: false };
  const behindPartIdSet = new Set(behindMarkers.partIds || []);
  const gitAssemblyPath = (
    gitBaseline?.assemblyPath
    || (assemblyDoc?.source === 'git'
      ? assemblyFilePath(vaultSegment(assemblyDoc.name) || assemblyDoc.name)
      : '')
  );
  const partRows = assemblyDoc
    ? feedRows(assemblyDoc, partRuns, partScripts).map((row) => {
      const syncKey = `${gitVaultRef.current?.repo ? `${gitVaultRef.current.repo.owner}/${gitVaultRef.current.repo.name}` : ''}\0${gitWorkingBranch()}\0${row.id}`;
      const sync = partSync[syncKey] || null;
      const chrome = partRowGitChrome({
        inflight: pendingPartIds.has(row.id),
        sync,
        contentDirty: gitDirtyIds.has(row.id),
        renameHeld: !!gitBaseline?.renamePending,
      });
      // v2 dirty is the commit compare. A surf id is not a repo path, so
      // showAddToRepo stays true after Save and keeps the yellow dot.
      const offerRepo = assemblyDoc.source === 'git'
        && !isV2PlanSaveDoc(assemblyDoc)
        && showAddToRepo(row);
      const meshMeta = partMeshMeta[row.id];
      const meshAssets = meshMeta?.assets;
      return {
        ...row,
        meshLocal: !!(meshAssets && typeof meshAssets === 'object' && Object.keys(meshAssets).length),
        meshSynced: meshMeta?.meshSynced === true,
        dirty: chrome.dirty,
        behind: behindPartIdSet.has(row.id),
        pending: chrome.pending,
        syncFailed: chrome.syncFailed,
        external: assemblyDoc.source === 'git' && isExternalPartPath(
          assemblyDoc.name,
          partRepoPath(row) || row.path || row.id,
        ),
        action: offerRepo ? 'add-to-repo' : (assemblyDoc.source === 'git' ? null : row.action),
      };
    })
    : [];
  const stripScript = featureRibbonScript({
    cadPartId,
    activeId: assemblyDoc?.activeId ?? null,
    currentScript,
    partScripts,
    sketchOpen,
    showJoints,
  });
  const stripPartKey = cadHighlightId ? String(cadHighlightId) : '__cad__';
  const editorPartKey = assemblyDoc?.activeId ? String(assemblyDoc.activeId) : '__cad__';
  const anchorOf = (key) => (
    Object.prototype.hasOwnProperty.call(rollbackAnchors, key) ? rollbackAnchors[key] : undefined
  );
  const stripRollbackAnchor = anchorOf(stripPartKey);
  const editorRollbackAnchor = anchorOf(editorPartKey);
  const commitRollback = (key, script) => (anchor) => {
    storeRollbackAnchor(key, anchor);
    if (!script) return;
    viewportRef.current?.executeScript(script, {
      rollbackAnchor: anchor === undefined ? undefined : anchor,
    });
  };
  const handleRollbackAnchor = commitRollback(stripPartKey, stripScript);
  const handleEditorRollbackAnchor = commitRollback(editorPartKey, currentScript);
  const stripFailedIds = failedFeatureIds(stripScript, runFailure);
  const stripFailedTitles = failedFeatureTitles(stripScript, runFailure);
  const scriptStripFailedIds = failedFeatureIds(currentScript, runFailure);
  const scriptStripFailedTitles = failedFeatureTitles(currentScript, runFailure);
  // Live body count for the separate-body chip marker (clears after Boolean union).
  const stripRun = cadHighlightId ? partRuns[cadHighlightId] : null;
  const stripBodyCount = (stripRun?.ok && stripRun.mesh)
    ? (Number.isFinite(stripRun.bodyCount)
      ? stripRun.bodyCount
      : bodyCountOfWorkerMesh(stripRun.mesh))
    : 0;
  // Feature sheets read the editor's script, so match the failure there.
  const sheetFailedIds = failedFeatureIds(currentScript, runFailure);
  const sheetFailedTitles = failedFeatureTitles(currentScript, runFailure);
  const agentHistoryStripContext = () => {
    const ribbonOpen = sketchStrip == null && sheetStrip != null;
    const jointsVisible = !ribbonOpen
      && jointsChromeMounted({ appMode, featureSession })
      && stripUndoTarget(cadPartIdRef.current) === 'joint';
    return {
      sketchOpen: sketchStrip != null,
      showJoints: jointsVisible,
    };
  };
  const agentRunOutcome = async (text) => {
    const scriptText = typeof text === 'string' ? text : '';
    setCurrentScript(scriptText);
    if (appModeRef.current === 'game') {
      return {
        ok: false,
        errors: ['Agent bridge drives the CAD tab'],
        volume: null,
        bbox: null,
        partName: '',
        runFailure: null,
      };
    }
    const epochBefore = runOutcomeEpochRef.current;
    const ran = await refreshAssemblyRef.current?.(scriptText, { forceActive: true });
    return agentCadRunOutcome(epochBefore, ran);
  };
  /**
   * A run that never reported is re-run once after the kernel is ready. The
   * watchdog replaces a worker that blew its budget; an undo or edit that
   * lands during that restart used to come back as the old timeout failure.
   */
  const agentRunOutcomeSettled = async (text) => {
    const first = await agentRunOutcome(text);
    if (first.stale !== true) return first;
    try { await manifoldContext.whenReady(); } catch { /* the retry reports */ }
    return agentRunOutcome(text);
  };
  fillAgentHost(agentHostRef, {
    agentPrompt: runAgentPrompt,
    cadSelectAll() {
      handleSelectAll();
      return { ok: true };
    },
    readFeatureTree() {
      const doc = assemblyRef.current;
      const script = codeEditorRef.current?.getContent?.() ?? '';
      const key = doc?.activeId ? String(doc.activeId) : '__cad__';
      // The ref, not the render's state: an agent reads this right after a
      // store, before the next render has rebuilt this closure.
      const anchors = rollbackAnchorsRef.current || {};
      const rollbackAnchor = Object.prototype.hasOwnProperty.call(anchors, key)
        ? anchors[key]
        : null;
      return buildFeatureTree({
        script,
        failedIds: sheetFailedIds,
        rollbackAnchor: rollbackAnchor ?? null,
        activeChipId: featureStripActiveId,
        featureMs: featureTimingsRef.current[definitionIdFor(key)] || null,
        featureCached: featureCacheRef.current[definitionIdFor(key)]?.cached || null,
      });
    },
    readSelection() {
      const fromViewport = agentHostRef.current?.readViewportSelection;
      const base = typeof fromViewport === 'function' ? fromViewport() : null;
      const doc = assemblyRef.current;
      const activePartId = doc?.activeId ?? base?.activePartId ?? null;
      const cadPick = cadPartIdRef.current;
      return buildSelection({
        activePartId,
        // Viewer/title highlight (`cadPartIdRef`). Falls back to the editor part.
        cadPartId: cadPick ?? activePartId,
        cadPartHighlighted: cadPick != null && cadPick !== activePartId,
        face: base?.face ?? null,
        edges: base?.edges ?? [],
        armedContourId: base?.contour?.armedId ?? null,
        selectedPlaneId: base?.contour?.planeId ?? null,
      });
    },
    readDirty() {
      const doc = assemblyRef.current;
      if (!agentScriptSnapshotRef.current && doc) captureAgentScriptSnapshot({ useEditor: false });
      let undoStackDirty = false;
      const readHistory = agentHostRef.current?.readHistory;
      const editorLive = editorLiveRef.current === true;
      const editorText = codeEditorRef.current?.getContent?.();
      if (editorLive && typeof readHistory === 'function') {
        const hist = readHistory();
        const head = Number.isInteger(hist?.head) ? hist.head : -1;
        const code = head >= 0 && hist?.commits?.[head] ? hist.commits[head].code : '';
        const live = typeof editorText === 'string' ? editorText : '';
        undoStackDirty = live !== code;
      }
      const scripts = partScriptsRef.current || {};
      const liveId = doc?.activeId ?? null;
      const override = liveEditorOverride({
        editorLive,
        activeId: liveId,
        script: editorText,
      });
      const editedSinceLoad = editedPartIdsSinceSnapshot(agentScriptSnapshotRef.current, scripts, {
        ...(override || {}),
        partIds: (doc?.parts || []).map((row) => row.id),
      });
      let partIds = gitDirtyIds;
      let assemblyDirty = dirtyBaseline && assemblyDoc
        ? isAssemblyDirty(assemblyDoc, dirtyBaseline)
        : false;
      let unsaved;
      let pendingSave = false;
      if (doc && isV2PlanSaveDoc(doc)) {
        const vault = gitVaultRef.current;
        const store = gitSync();
        const branch = gitWorkingBranch();
        const assemblyCommit = vault?.repo
          ? store.getAssemblyCommit(vault.repo, branch, doc.id)
          : null;
        pendingSave = !!(vault?.repo && store.getPendingSave(vault.repo, branch));
        const compared = compareWorkingCopyToCommit({
          doc,
          scripts,
          liveId,
          liveScript: typeof editorText === 'string' ? editorText : null,
          assemblyCommit,
          pendingSave,
          sidecarDirty: sidecarIsDirty(gitSidecarRef.current),
        });
        unsaved = compared.unsaved;
        assemblyDirty = compared.assemblyDirty;
        partIds = compared.partIds;
      }
      return buildDirtyState({
        workspaceDirty: !!sourceDirty,
        partIds,
        assemblyDirty,
        renamePending: !!dirtyBaseline?.renamePending,
        legacyCleanup: !!dirtyBaseline?.legacyCleanup,
        undoStackDirty,
        editedSinceLoad,
        pendingSave,
        ...(unsaved === true || unsaved === false ? { unsaved } : {}),
        ...(doc?.vaultLayout === 'legacy' && upgradeVaultEnabled()
          ? { upgradeRequired: true }
          : {}),
      });
    },
    readToasts() {
      const rows = [];
      if (uploadError) rows.push({ id: 'upload', kind: 'error', message: uploadError });
      if (uploadNotice) rows.push({ id: 'upload-notice', kind: 'info', message: uploadNotice });
      if (renameNotice?.message) {
        rows.push({ id: 'rename', kind: 'warn', message: renameNotice.message });
      }
      if (gitBehindToast?.message) {
        rows.push({ id: 'git-behind', kind: 'warn', message: gitBehindToast.message });
      }
      if (repoMoved) rows.push({ id: 'repo-moved', kind: 'warn', message: REPO_MOVED_WARNING });
      if (repoSaved?.branch) {
        rows.push({ id: 'repo-saved', kind: 'info', message: repoSavedMessage(repoSaved.branch) });
      }
      const viewportToasts = agentHostRef.current?.readViewportToasts;
      if (typeof viewportToasts === 'function') rows.push(...viewportToasts());
      return buildToasts(rows);
    },
    readParts() {
      const doc = assemblyRef.current;
      if (!doc) return withUnjointedParts(buildPartsState({}), [], []);
      return withUnjointedParts(buildPartsState({
        assemblyId: doc.id,
        activeId: doc.activeId,
        assemblyName: assemblyName(doc),
        vaultLayout: doc.vaultLayout,
        parts: doc.parts.map((row) => {
          const run = partRunsRef.current?.[row.id];
          return {
            id: row.id,
            name: row.name,
            visible: row.visible,
            ...(typeof row.group === 'string' ? { group: row.group } : {}),
            ...(row.missing === true ? { missing: true } : {}),
            ...(typeof row.instanceOf === 'string' && row.instanceOf ? { instanceOf: row.instanceOf } : {}),
            runState: partRunState(run),
            ...(run?.crash && typeof run.crash === 'object' ? { crash: run.crash } : {}),
          };
        }),
      }), doc.parts, doc.joints);
    },
    readJoints() {
      const joints = assemblyRef.current?.joints;
      return Array.isArray(joints) ? joints : [];
    },
    readJointHealth() {
      // Every joint with the solve state the strip chips show, by part row id.
      const doc = assemblyRef.current;
      const rows = Array.isArray(doc?.parts) ? doc.parts : [];
      const bySurf = new Map();
      for (const row of rows) {
        const id = row?.id != null ? String(row.id) : '';
        if (!id) continue;
        bySurf.set(id, id);
        const surf = partSurfId(row);
        if (surf && !bySurf.has(surf)) bySurf.set(surf, id);
      }
      return buildJointHealth({
        joints: doc?.joints,
        statuses: jointLiveRef.current?.statuses,
        messages: jointLiveRef.current?.messages,
        partIdOf: (surf) => bySurf.get(surf) ?? surf,
      });
    },
    readActivePartSurfId() {
      // The `@surf-id` header names the script, so for a part instance it
      // is the definition's id, not the active row's.
      const doc = assemblyRef.current;
      const part = doc?.parts?.find((row) => row.id === doc?.activeId);
      if (!part) return null;
      const def = partDefinitionId(part);
      if (def !== String(part.id)) {
        const primary = doc.parts.find((row) => String(row.id) === def);
        return primary ? partSurfId(primary) : (isSurfId(def) ? def : null);
      }
      return partSurfId(part);
    },
    readGeometryWorkers() {
      const stats = manifoldContext.poolStats();
      // GPU buffer cache counters (geometries built = uploads, reuses).
      return stats && typeof stats === 'object' ? { ...stats, gpu: solidCacheStats() } : stats;
    },
    readActivePartStatus() {
      const doc = assemblyRef.current;
      const id = doc?.activeId != null ? String(doc.activeId) : '';
      const part = id ? doc?.parts?.find((row) => row.id === id) : null;
      const partName = part?.name || '';
      const script = id
        ? (codeEditorRef.current?.getContent?.() ?? partScriptsRef.current[id] ?? '')
        : '';
      const timingKey = id ? definitionIdFor(id, doc) : '__cad__';
      const featureMs = featureTimingsRef.current[timingKey];
      const memo = featureCacheRef.current[timingKey];
      const base = {
        partId: id,
        partName,
        script,
        runState: 'not_run_yet',
        volume: null,
        bbox: null,
        featureCount: agentFeatureCount(script),
        bodyCount: null,
        ...(featureMs && Object.keys(featureMs).length ? { featureMs } : {}),
        // Feature memoisation on the last run: how many blocks were served
        // from the cache, and which (feature_tree ids).
        ...(memo?.cache ? { cache: memo.cache } : {}),
        ...(memo?.cached && Object.keys(memo.cached).length ? { featureCached: memo.cached } : {}),
      };
      const run = id ? partRunsRef.current?.[id] : null;
      if (!run) return base;
      if (run.empty) {
        return { ...base, runState: 'ok', bodyCount: 0 };
      }
      if (run.ok === true && run.mesh?.vertProperties) {
        const geom = geometryFromExecuteResult(run);
        const bodyCount = geom.bodyCount != null
          ? geom.bodyCount
          : bodyCountOfWorkerMesh(run.mesh);
        return {
          ...base,
          runState: 'ok',
          volume: geom.volume,
          bbox: geom.bbox,
          bodyCount: Number.isFinite(bodyCount) ? bodyCount : null,
        };
      }
      return { ...base, runState: 'failed' };
    },
    setActivePart(partId) {
      const doc = assemblyRef.current;
      const part = findPartById(doc, partId);
      if (!part) {
        return { error: unknownPartError(partId) };
      }
      handleSelectPart(part.id);
      return { ok: true };
    },
    async setPartVisible({ partId, visible } = {}) {
      const decided = decidePartVisible(assemblyRef.current, partId, visible);
      if (decided.error) return { error: decided.error };
      if (decided.changed) {
        rememberAssembly(decided.doc);
        const live = codeEditorRef.current?.getContent?.();
        await refreshAssemblyRef.current?.(live, {
          persistActive: !suppressPartSaveRef.current,
          preservePicks: featureSessionRef.current,
        });
      }
      return { result: decided.result };
    },
    selectParts({ partIds }) {
      const doc = assemblyRef.current;
      if (!doc) return { error: { code: 'unknown_part', message: 'No assembly loaded' } };
      const ids = Array.isArray(partIds) ? partIds : [];
      const resolved = [];
      for (const id of ids) {
        const part = findPartById(doc, id);
        if (!part) {
          return { error: unknownPartError(id) };
        }
        resolved.push(part.id);
      }
      const last = resolved[resolved.length - 1];
      rememberCadPart(last);
      const part = doc.parts.find((row) => row.id === last);
      const mesh = meshForPart(last);
      if (mesh?.vertProperties) {
        viewportRef.current?.swapPickPart?.({
          partId: last,
          mesh,
          position: partPosition(part) || [0, 0, 0],
          placement: placementForMesh(part),
        });
      }
      viewportRef.current?.showCadBodyHighlight?.();
      return { partIds: resolved };
    },
    async agentCreateAssembly({ name } = {}) {
      if (createAssemblyInFlightRef.current) {
        return createAssemblyInFlightRef.current;
      }
      const work = (async () => {
        const before = assemblyRef.current;
        const after = await seedAgentAssembly({ name });
        if (before && after) recordAgentAssemblyStep(before);
        return {
          result: {
            assemblyId: after?.id ?? null,
            assemblyName: after?.name ?? '',
            activeId: after?.activeId ?? null,
            partCount: after?.parts?.length ?? 0,
          },
        };
      })();
      createAssemblyInFlightRef.current = work;
      try {
        return await work;
      } finally {
        if (createAssemblyInFlightRef.current === work) createAssemblyInFlightRef.current = null;
      }
    },
    agentGetPartTransform({ partId }) {
      const doc = assemblyRef.current;
      const part = findPartById(doc, partId);
      if (!part) {
        return { error: unknownPartError(partId) };
      }
      const pose = partPlacement(part);
      return {
        result: {
          part: part.id,
          position: pose.t.slice(),
          rotation: quaternionToEulerDegrees(pose.q),
          eulerOrder: AGENT_EULER_ORDER,
        },
      };
    },
    agentSetPartTransform({ partId, position, rotation }) {
      const doc = assemblyRef.current;
      if (!doc) {
        return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      }
      const part = findPartById(doc, partId);
      if (!part) {
        return { error: unknownPartError(partId) };
      }
      const current = partPlacement(part);
      let t = current.t.slice();
      if (position != null) {
        if (!Array.isArray(position) || position.length < 3) {
          return { error: { code: 'bad_args', message: 'position must be [x, y, z] numbers in mm' } };
        }
        t = [Number(position[0]), Number(position[1]), Number(position[2])];
        if (!t.every(Number.isFinite)) {
          return { error: { code: 'bad_args', message: 'position must be [x, y, z] numbers in mm' } };
        }
      }
      let q = current.q.slice();
      if (rotation != null) {
        const nextQ = eulerDegreesToQuaternion(rotation);
        if (!nextQ) {
          return {
            error: {
              code: 'bad_args',
              message: `rotation must be intrinsic ${AGENT_EULER_ORDER} Euler degrees [rx, ry, rz]`,
            },
          };
        }
        q = nextQ;
      }
      const jointed = jointedSurfIds(doc.joints);
      const draft = { ...part, placement: { t, q } };
      const pose = poseFieldsForPart(draft, jointed.has(partSurfId(part)), t);
      const nextPart = { ...part, ...pose };
      const before = doc;
      const written = rememberAssembly({
        ...doc,
        parts: doc.parts.map((row) => (row.id === part.id ? nextPart : row)),
      });
      recordAgentAssemblyStep(before);
      paintAssemblyPoses(written);
      if (written.activeId === part.id) {
        const mesh = meshForPart(part.id);
        if (mesh?.vertProperties) {
          viewportRef.current?.swapPickPart?.({
            partId: part.id,
            mesh,
            position: partPosition(nextPart) || [0, 0, 0],
            placement: placementForMesh(nextPart),
          });
        }
      }
      const poseOut = partPlacement(nextPart);
      return {
        result: {
          part: part.id,
          position: poseOut.t.slice(),
          rotation: quaternionToEulerDegrees(poseOut.q),
          eulerOrder: AGENT_EULER_ORDER,
        },
      };
    },
    async agentCreatePart({ name, script, position } = {}) {
      const before = assemblyRef.current;
      if (!before) {
        return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      }
      // Agent parts stay path-less in a git assembly: git_save (behind the
      // write consent) paths and commits them with the assembly.
      const createdRow = await handleAddPart(name, { script, deferVault: true, fromAgent: true, position });
      // handleAddPart schedules a deferred auto-run. The new part's script,
      // blank starter included, must finish before this call returns, so
      // drop that timer and run it here: a part create_part returns is never
      // not_run_yet (Pi 5 C3).
      refreshGenRef.current += 1;
      await ensureLocalSurfIds();
      const after = assemblyRef.current;
      const created = (createdRow?.id && after?.parts?.some((row) => row.id === createdRow.id))
        ? (after.parts.find((row) => row.id === createdRow.id) || createdRow)
        : createdPartFromDocs(before, after);
      if (!created) {
        return { error: { code: 'internal', message: 'Could not create part' } };
      }
      let doc = after;
      if (doc.activeId !== created.id) {
        doc = rememberAssembly({ ...after, activeId: created.id });
      }
      if (cadPartIdRef.current !== created.id) rememberCadPart(created.id);
      recordAgentAssemblyStep(before);
      const partId = created.id;
      const partCount = doc?.parts?.length ?? 0;
      const stored = partScriptsRef.current?.[partId];
      const text = typeof stored === 'string' ? stored : '';
      if (text && codeEditorRef.current?.getContent?.() !== text) {
        codeEditorRef.current?.setTextOnly?.(text);
      }
      let outcome;
      try {
        outcome = await agentRunOutcome(text);
      } catch (err) {
        outcome = {
          ok: false,
          errors: [String(err?.message || err || 'Script failed')],
          volume: null,
          bbox: null,
          partName: created.name || '',
          runFailure: null,
        };
      }
      return { result: { partId, partCount, run: outcome, script: text } };
    },
    async agentOpenAssembly({ assemblyId }) {
      const before = assemblyRef.current;
      if (!before || before.source !== 'git') {
        return { error: { code: 'git_only', message: 'open_assembly needs a git-backed assembly' } };
      }
      const ctx = await agentGitReadContext('open_assembly');
      if (ctx.error) return { error: ctx.error };
      let layout = 'v2';
      try {
        const detected = await detectVaultLayout(ctx.adapter, ctx.vault.repo, ctx.branch);
        layout = detected.layout;
      } catch (err) {
        if (err?.message === NO_REPO_YET_COPY || err?.code === 'git_blocked') {
          setUploadNotice(NO_REPO_YET_COPY);
          return { error: { code: 'git_blocked', message: NO_REPO_YET_COPY } };
        }
      }
      if (layout !== 'v2' || !isV2SurfId(assemblyId)) {
        return { error: unknownAssemblyError(assemblyId) };
      }
      const opened = await handleOpenV2VaultAssembly(assemblyId, ctx.adapter);
      if (opened?.status === 'error') {
        if (opened.code === 'unknown_assembly' || opened.code === 'git_blocked') {
          return {
            error: opened.code === 'unknown_assembly'
              ? unknownAssemblyError(assemblyId)
              : { code: 'git_blocked', message: opened.error || NO_REPO_YET_COPY },
          };
        }
        return { error: { code: opened.code || 'open_failed', message: opened.error || 'Could not open assembly' } };
      }
      const after = assemblyRef.current;
      if (after && after !== before) recordAgentAssemblyStep(before);
      return {
        result: {
          assemblyId: after?.id || assemblyId,
          assemblyName: after?.name || '',
          activeId: after?.activeId ?? null,
          partCount: after?.parts?.length ?? 0,
        },
      };
    },
    async agentOpenPart({ partId, assemblyId } = {}) {
      const before = assemblyRef.current;
      const loaded = await loadVaultPartRows({ partId, assemblyId });
      if (loaded.error) return { error: loaded.error };
      const inserted = await insertReferencedParts({ rows: loaded.rows, copy: false });
      if (inserted.error) return { error: inserted.error };
      if (inserted.result?.added?.length) recordAgentAssemblyStep(before);
      const after = assemblyRef.current;
      return {
        result: {
          partId: inserted.result?.activeId ?? null,
          added: inserted.result?.added || [],
          partCount: after?.parts?.length ?? 0,
        },
      };
    },
    async agentInsertPart({ partId, assemblyId, copy, instance, position } = {}) {
      const before = assemblyRef.current;
      if (instance === true) return agentInsertInstance({ partId, position });
      const loaded = await loadVaultPartRows({ partId, assemblyId });
      if (loaded.error) return { error: loaded.error };
      const inserted = await insertReferencedParts({ rows: loaded.rows, copy: copy === true });
      if (inserted.error) return { error: inserted.error };
      if (inserted.result?.added?.length) recordAgentAssemblyStep(before);
      const after = assemblyRef.current;
      return {
        result: {
          partId: inserted.result?.activeId ?? null,
          added: inserted.result?.added || [],
          partCount: after?.parts?.length ?? 0,
          copy: copy === true,
        },
      };
    },
    async agentListAssemblies() {
      const open = assemblyRef.current;
      const openRow = open?.id && isV2SurfId(open.id) ? { id: open.id, name: assemblyName(open) } : null;
      // A local working copy has one assembly: the open one.
      if (!open || open.source !== 'git') {
        return { result: { assemblies: assemblyRows({ open: openRow }) } };
      }
      const ctx = await agentGitReadContext('list_assemblies');
      if (ctx.error) return { error: ctx.error };
      try {
        // Saved v2 assemblies (id paths; empty on a fresh or legacy tree), the
        // open unsaved one, and legacy folders by name. The detector calls a
        // repo with no version marker legacy, so a fresh vault is not v2 yet.
        const detected = await detectVaultLayout(ctx.adapter, ctx.vault.repo, ctx.branch);
        const v2 = await listV2Assemblies(ctx.adapter, ctx.vault.repo, ctx.branch);
        let legacyNames = [];
        if (detected.legacyTree) {
          const tree = await ctx.adapter.listTree(ctx.vault.repo, ctx.branch);
          legacyNames = listLegacyAssemblyNames(tree);
        }
        return { result: { assemblies: assemblyRows({ v2, legacyNames, open: openRow }) } };
      } catch (err) {
        if (err?.message === NO_REPO_YET_COPY || err?.code === 'git_blocked') {
          setUploadNotice(NO_REPO_YET_COPY);
          return { error: { code: 'git_blocked', message: NO_REPO_YET_COPY } };
        }
        return { error: { code: 'internal', message: err?.message || 'Could not list assemblies' } };
      }
    },
    async agentDeletePart({ partId, scope, confirm } = {}) {
      const doc = assemblyRef.current;
      if (!doc) {
        return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      }
      if (scope === 'repo' && confirm !== true) {
        return { error: { code: 'confirm_required', message: 'delete_part scope repo requires confirm: true' } };
      }
      const part = findPartById(doc, partId);
      if (!part) return { error: unknownPartError(partId) };
      let assemblies = [];
      if (doc.source === 'git' && isV2PlanSaveDoc(doc)) {
        const ctx = await agentGitReadContext('delete_part');
        if (ctx.error && ctx.error.code !== 'git_blocked') return { error: ctx.error };
        if (!ctx.error) {
          const scan = await scanOtherAssemblyPartUses(
            ctx.adapter,
            ctx.vault.repo,
            ctx.branch,
            [partDefinitionId(part)],
            { exceptAssemblyId: doc.id },
          );
          if (!scan.ok) {
            return { error: { code: 'delete_refused', message: PART_USE_SCAN_REFUSED } };
          }
          assemblies = scan.assemblies;
        }
      }
      const removed = scope === 'repo'
        ? await handleDeletePart(part.id, { fromRepo: true })
        : await handleDeletePart(part.id);
      if (removed && removed.status && removed.status !== 'deleted') {
        return {
          error: {
            code: removed.code || removed.status || 'delete_refused',
            message: removed.error || removed.message || "Couldn't delete the part. Nothing was changed.",
            details: {
              assemblies: removed.assemblies || assemblies,
              ...(removed.paths ? { paths: removed.paths } : {}),
            },
          },
        };
      }
      return {
        result: {
          partId: part.id,
          scope,
          status: 'removed',
          assemblies: removed?.assemblies || assemblies,
        },
      };
    },
    async agentDeleteAssembly({ assemblyId, deleteParts, confirm } = {}) {
      const doc = assemblyRef.current;
      if (!doc) {
        return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      }
      if (confirm !== true) {
        return { error: { code: 'confirm_required', message: 'delete_assembly requires confirm: true' } };
      }
      const open = doc.id === assemblyId;
      const v2Target = doc.source === 'git' && doc.vaultLayout === 'v2' && isV2SurfId(assemblyId);
      if (!v2Target) {
        if (!open) return { error: unknownAssemblyError(assemblyId) };
        let after = null;
        try {
          after = await seedAgentAssembly({});
        } catch {
          return {
            error: {
              code: 'delete_refused',
              message: "Couldn't delete the assembly. Nothing was changed.",
            },
          };
        }
        if (doc) recordAgentAssemblyStep(doc);
        return {
          result: {
            assemblyId: doc.id,
            status: 'deleted',
            nextAssemblyId: after?.id ?? null,
            assemblies: [],
          },
        };
      }
      const ctx = await agentGitReadContext('delete_assembly');
      if (ctx.error && ctx.error.code !== 'git_blocked') return { error: ctx.error };
      if (ctx.error) {
        if (!open) {
          return {
            error: {
              code: 'delete_refused',
              message: "Couldn't delete the assembly. Nothing was changed.",
            },
          };
        }
        let after = null;
        try {
          after = await seedAgentAssembly({});
        } catch {
          return {
            error: {
              code: 'delete_refused',
              message: "Couldn't delete the assembly. Nothing was changed.",
            },
          };
        }
        return {
          result: {
            assemblyId,
            status: 'deleted',
            nextAssemblyId: after?.id ?? null,
            assemblies: [],
          },
        };
      }
      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const result = await executeDeleteV2Assembly({
        adapter: ctx.adapter,
        repo: ctx.vault.repo,
        branch: ctx.branch,
        store: gitSync(),
        assemblyId,
        openDoc: doc,
        deleteParts: deleteParts === true,
        confirm: true,
        online,
        message: open ? `Delete ${assemblyName(doc)}` : `Delete ${assemblyId}`,
      });
      if (result.status !== 'local' && result.status !== 'committed') {
        return {
          error: {
            code: result.code || result.status || 'delete_refused',
            message: result.error || result.message || "Couldn't delete the assembly. Nothing was changed.",
            details: {
              assemblies: result.assemblies || [],
              ...(result.paths ? { paths: result.paths } : {}),
            },
          },
        };
      }
      if (result.status === 'committed' && result.sha && gitVaultRef.current) {
        gitVaultRef.current = { ...gitVaultRef.current, headSha: result.sha };
      }
      const assemblies = result.assemblies || [];
      if (!open) {
        return {
          result: {
            assemblyId,
            status: 'deleted',
            assemblies,
            ...(result.sha ? { sha: result.sha } : {}),
          },
        };
      }
      let after = null;
      try {
        after = await seedAgentAssembly({});
      } catch {
        if (result.status !== 'committed') {
          return {
            error: {
              code: 'delete_refused',
              message: "Couldn't delete the assembly. Nothing was changed.",
            },
          };
        }
      }
      if (doc) recordAgentAssemblyStep(doc);
      return {
        result: {
          assemblyId,
          status: 'deleted',
          nextAssemblyId: after?.id ?? null,
          assemblies,
          ...(result.sha ? { sha: result.sha } : {}),
        },
      };
    },
    async agentRenameAssembly({ assemblyId, name } = {}) {
      const doc = assemblyRef.current;
      if (!doc) {
        return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      }
      if (doc.id !== assemblyId) {
        return { error: unknownAssemblyError(assemblyId) };
      }
      const nextName = sanitizeAssemblyName(name);
      if (!nextName) {
        return { error: { code: 'bad_args', message: 'rename_assembly needs a non-empty name' } };
      }
      if (doc.source === 'git' && doc.vaultLayout === 'v2') {
        const out = await handleRenameAssembly(nextName);
        if (out?.status === 'error') {
          return {
            error: {
              code: out.code || 'rename_failed',
              message: out.error || "Couldn't rename the assembly. Nothing was changed.",
            },
          };
        }
        if (out?.status === 'renamed') recordAgentAssemblyStep(doc);
        return { result: { assemblyId: doc.id, name: out?.name || nextName, moved: false } };
      }
      if (doc.name !== nextName) {
        rememberAssembly({ ...doc, name: nextName });
        recordAgentAssemblyStep(doc);
      }
      return { result: { assemblyId: doc.id, name: nextName, moved: false } };
    },
    readAgentGitAdapterKind() {
      return ensureGitAdapter()?.kind ?? null;
    },
    readAgentGitRealOptIn() {
      return agentGitRealOptIn();
    },
    readAgentGitSessionDenied() {
      return agentGitSessionDenied();
    },
    readAgentGitWriteTarget() {
      return readAgentGitWriteTarget();
    },
    promptAgentGitWriteConsent(args) {
      return promptAgentGitWriteConsent(args);
    },
    async agentGitMoveToRepo({ vault_name } = {}) {
      const before = assemblyRef.current;
      const clean = typeof vault_name === 'string' ? vault_name.trim() : '';
      const result = await handleMoveToGit({
        vaultName: clean || undefined,
        sharedIds: [],
      });
      if (result.status === 'moved' && before) recordAgentAssemblyStep(before);
      return result;
    },
    async agentGitSave({ message }) {
      const draft = String(message || '').trim();
      if (!draft) return { status: 'error', error: 'Commit message required' };
      const out = await handleGitCommit(draft);
      if (out?.status === 'queued' || out?.status === 'pending') {
        return {
          status: 'pending',
          code: 'pending_save',
          message: out.error || out.message || SAVE_QUEUED_COPY,
        };
      }
      return out;
    },
    async agentGitUpgradeVault() {
      return handleUpgradeVault();
    },
    async agentGitAddToRepo({ partId }) {
      if (!partId) return { status: 'error', error: 'part_id required' };
      const part = findPartById(assemblyRef.current, partId);
      if (!part) {
        return { status: 'error', code: 'unknown_part', error: `Unknown part id: ${partId}` };
      }
      return handleAddToRepo(part.id);
    },
    /** Rename is working-copy only; never a git move. */
    readAgentPartRename(partId) {
      const doc = assemblyRef.current;
      const part = findPartById(doc, partId);
      if (!part) return { known: false, writesGit: false };
      return {
        known: true,
        writesGit: false,
      };
    },
    async agentRenamePart({ partId, name }) {
      const before = assemblyRef.current;
      if (!before) {
        return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      }
      const part = findPartById(before, partId);
      if (!part) {
        return { error: unknownPartError(partId) };
      }
      const out = await handleRenamePart(part.id, name);
      if (out?.status === 'error') {
        return { error: { code: out.code || 'rename_failed', message: out.error || 'Could not rename part' } };
      }
      if (out?.status === 'renamed') recordAgentAssemblyStep(before);
      const after = assemblyRef.current;
      const afterPart = findPartById(after, part.id);
      return {
        result: {
          partId: part.id,
          name: afterPart?.name ?? out?.name ?? null,
          moved: false,
        },
      };
    },
    async agentGitBehindResolve({ action }) {
      const doc = assemblyRef.current;
      if (!doc || doc.source !== 'git') {
        return { status: 'error', error: 'Not in Git mode' };
      }
      if (isV2PlanSaveDoc(doc)) {
        return handlePlanSaveConflict({ action });
      }
      let resolvedPath = null;
      let resolvedKind = null;
      if (behindMarkers.assemblyBehind && gitAssemblyPath) {
        resolvedPath = gitAssemblyPath;
        resolvedKind = 'assembly';
      } else if (behindPartIdSet.size) {
        resolvedPath = behindPartIdSet.values().next().value;
        resolvedKind = 'part';
      }
      if (!resolvedPath) {
        return { status: 'error', error: 'No behind marker for this assembly' };
      }
      if (!resolvedKind) {
        resolvedKind = resolvedPath.endsWith('.surf.json') ? 'assembly' : 'part';
      }
      return handleBehindChoice({ action, path: resolvedPath, kind: resolvedKind });
    },
    async agentGitBranchCreate({ name }) {
      const branchName = String(name || '').trim();
      if (!branchName) return { status: 'error', error: 'Branch name required' };
      return handleCreateBranch(branchName);
    },
    async agentGitBranchSwitch({ branch, confirm }) {
      const target = String(branch || '').trim();
      if (!target) return { status: 'error', error: 'Branch required' };
      // Already on this branch: no reload, nothing discarded — confirm is
      // only for a dirty *switch* that would replace the working copy.
      if (target === gitWorkingBranch()) {
        return handleSwitchBranch(target);
      }
      if (sourceDirty && confirm !== true) {
        return {
          status: 'error',
          code: 'confirm_required',
          error: 'git_branch_switch requires confirm: true while the working copy has uncommitted changes',
        };
      }
      return handleSwitchBranch(target);
    },
    async agentGitBranchDelete({ branch }) {
      const target = String(branch || '').trim();
      if (!target) return { status: 'error', error: 'Branch required' };
      return handleDeleteBranch(target);
    },
    async agentGitForceOverwrite() {
      return handleOverwriteMain();
    },
    async agentGitListBranches() {
      try {
        const items = await handleListBranches();
        return { status: 'ok', branches: items || [], branch: gitWorkingBranch() };
      } catch (err) {
        return gitOpCatchResult(err, 'Could not list branches');
      }
    },
    jointOpen() {
      if (appModeRef.current === 'game' || featureSessionRef.current) {
        return { error: { code: 'bad_view', message: 'Joints are not available right now' } };
      }
      rememberCadPart(null);
      if (handleOpenJoints() !== true) {
        return { result: { open: false, suppressed: true } };
      }
      return { result: { open: true } };
    },
    jointSetParams({ patch } = {}) {
      const doc = assemblyRef.current;
      const card = jointCardAgentRef.current ?? jointCardRef.current;
      if (!card) {
        return { error: { code: 'no_joint_card', message: 'Call joint_open before joint_set_params' } };
      }
      const bag = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
      let next = { ...card, ...bag };
      if (next.userPickedType && next.type && !next.userNamed) {
        const named = nextJointName(next.type, doc?.joints || []);
        next = { ...next, name: next.name && next.userNamed ? next.name : named };
      }
      const settled = buildEffectiveJointCard(next, jointPicksRef.current, doc);
      publishJointCard(settled);
      return {
        result: {
          ok: true,
          type: settled.type ?? null,
          name: settled.name ?? null,
          valueMm: settled.valueMm ?? null,
          sense: settled.sense === -1 ? -1 : 1,
          opposed: settled.opposed !== false,
          mode: settled.mode ?? null,
          pickCount: (settled.picks || []).length,
        },
      };
    },
    jointApplyPicks({ picks } = {}) {
      const doc = assemblyRef.current;
      if (!doc) return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      if (!(jointCardAgentRef.current ?? jointCardRef.current)) {
        return { error: { code: 'no_joint_card', message: 'Call joint_open before joint_pick' } };
      }
      const rows = Array.isArray(picks) ? picks : [];
      const picked = [];
      for (const row of rows) {
        const part = doc.parts.find((p) => p.id === row?.part_id);
        if (!part) {
          return { error: { code: 'unknown_part', message: `Unknown part id: ${row?.part_id}` } };
        }
        if (!partSurfId(part)) {
          return { error: { code: 'no_surf_id', message: `Part has no surf id: ${part.id}` } };
        }
        const partOnly = row?.kind === 'part' || (!row?.key && (row?.face_id == null || row.face_id === ''));
        if (partOnly) {
          const beforeLen = (jointPicksRef.current || []).length;
          handleJointPick({ partId: part.id, kind: 'part', planar: false, axis: false, key: null });
          if ((jointPicksRef.current || []).length <= beforeLen) {
            return { error: { code: 'pick_failed', message: `Joint pick was not accepted for part ${part.id}` } };
          }
          picked.push(part.id);
          continue;
        }
        const described = viewportRef.current?.describeJointPick?.({
          partId: part.id,
          key: row.key,
          kind: row.kind,
          faceId: row.face_id,
        });
        if (!described || described.error) {
          return {
            error: described?.error ?? {
              code: 'pick_failed',
              message: 'Could not classify joint pick on that part',
            },
          };
        }
        const beforeLen = (jointPicksRef.current || []).length;
        handleJointPick({
          partId: part.id,
          kind: described.kind,
          planar: described.planar,
          axis: described.axis,
          key: described.key,
        });
        const afterLen = (jointPicksRef.current || []).length;
        if (afterLen <= beforeLen) {
          return {
            error: {
              code: 'pick_failed',
              message: `Joint pick was not accepted for part ${part.id}`,
            },
          };
        }
        picked.push(part.id);
      }
      const picksNow = jointPicksRef.current || [];
      const openCard = jointCardAgentRef.current ?? jointCardRef.current;
      const settled = openCard
        ? buildEffectiveJointCard(openCard, picksNow, doc)
        : null;
      if (settled) publishJointCard(settled);
      return { result: { picked, count: picksNow.length, pickCount: picksNow.length } };
    },
    jointSelect({ joint_id } = {}) {
      const doc = assemblyRef.current;
      if (!doc) return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      const id = joint_id != null ? String(joint_id) : '';
      if (!id) {
        return { error: { code: 'bad_args', message: 'joint_select needs joint_id' } };
      }
      const joint = (doc.joints || []).find((row) => row.id === id);
      if (!joint) {
        return { error: { code: 'unknown_joint', message: `Unknown joint id: ${id}` } };
      }
      const card = cardFromJoint(joint, doc);
      jointPicksRef.current = card.picks;
      publishJointCard(card);
      return {
        result: {
          joint_id: id,
          type: card.type ?? joint.type,
          name: card.name ?? joint.name,
          mode: card.mode,
          pickCount: (card.picks || []).length,
        },
      };
    },
    jointEdit({ joint_id, patch } = {}) {
      const edited = jointEditCard({
        doc: assemblyRef.current,
        card: jointCardAgentRef.current ?? jointCardRef.current,
        jointId: joint_id,
        patch,
      });
      if (edited.error) return { error: edited.error };
      const next = edited.card;
      if (edited.selected) jointPicksRef.current = next.picks;
      rememberCadPart(null);
      publishJointCard(next);
      return {
        result: {
          ok: true,
          joint_id: next.id ?? null,
          type: next.type ?? null,
          name: next.name ?? null,
          valueMm: next.valueMm ?? null,
          sense: next.sense === -1 ? -1 : 1,
          opposed: next.opposed !== false,
          mode: next.mode ?? 'edit',
        },
      };
    },
    jointDelete({ joint_id } = {}) {
      const doc = assemblyRef.current;
      if (!doc) return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
      const id = joint_id != null ? String(joint_id) : '';
      if (!id) return { error: { code: 'bad_args', message: 'joint_delete needs joint_id' } };
      const joint = (doc.joints || []).find((row) => row.id === id);
      if (!joint) return { error: { code: 'unknown_joint', message: `Unknown joint id: ${id}` } };
      const scripts = partScriptsRef.current;
      const locked = !!assemblyOpenLockRef.current;
      const result = applyJointCard({
        doc,
        scripts,
        card: { mode: 'edit', id },
        action: 'delete',
        locked,
        preempt: null,
        catalogs: jointCatalogsRef.current,
      });
      if (locked) {
        return { error: { code: 'edit_failed', message: result.message || 'Assembly is opening' } };
      }
      if (!result.ok) {
        return { error: { code: 'edit_failed', message: result.message || 'Joint delete failed' } };
      }
      finishJointWrite(result, scripts);
      return {
        result: {
          ok: true,
          jointId: id,
          jointCount: (assemblyRef.current?.joints || []).length,
        },
      };
    },
    prepareJointCommit() {
      const doc = assemblyRef.current;
      const base = jointCardAgentRef.current ?? jointCardRef.current;
      const card = base
        ? buildEffectiveJointCard(base, jointPicksRef.current, doc)
        : null;
      if (card) jointCardAgentRef.current = card;
      if (!doc || !card) {
        return { error: { code: 'no_joint_card', message: 'Joint card is not open' } };
      }
      const scripts = partScriptsRef.current;
      const locked = !!assemblyOpenLockRef.current;
      const result = applyJointCard({
        doc,
        scripts,
        card,
        action: 'confirm',
        locked,
        preempt: null,
        catalogs: jointCatalogsRef.current,
      });
      if (locked) {
        return { error: { code: 'edit_failed', message: result.message || 'Assembly is opening' } };
      }
      if (!result.ok) {
        const refused = { ok: false, message: result.message || 'Joint commit refused' };
        if (result.candidates) refused.candidates = result.candidates;
        return refused;
      }
      const unchanged = assemblySnapshotsEqual(doc, result.doc);
      finishJointWrite(result, scripts, { resetPicks: card.mode !== 'edit', toast: card.mode === 'edit' ? 'edited' : 'added', jointId: card.id });
      rememberCadPart(null);
      const written = assemblyRef.current;
      const joints = written?.joints || [];
      const jointId = card.mode === 'edit' && card.id ? card.id : (joints[joints.length - 1]?.id ?? null);
      return { ok: true, jointId, jointCount: joints.length, unchanged };
    },
    finishJointCommit() {
      if (jointCardRef.current || jointCardAgentRef.current) {
        jointPicksRef.current = [];
        viewportRef.current?.clearJointHighlights?.();
        publishJointCard(null);
      }
    },
    jointCancel() {
      handleJointCancel();
      return { result: { cancelled: true } };
    },
    agentHistory() {
      const ctx = agentHistoryStripContext();
      const target = historyStripTarget(ctx);
      if (target === 'sketch') {
        const readSketch = agentHostRef.current?.readSketchHistory;
        const sketch = typeof readSketch === 'function' ? readSketch() : { depth: 0, entries: [] };
        return summarizeSketchHistory(sketch);
      }
      if (target === 'assembly') {
        return summarizeAssemblyHistory(assemblyHistoryRef.current);
      }
      const id = historyKey();
      const branch = historyRef.current?.branches?.main;
      const current = partHistoriesRef.current[id] || {
        commits: branch?.commits || [],
        head: Number.isInteger(branch?.head) ? branch.head : -1,
      };
      return summarizePartHistory(current.commits, current.head, { partId: id });
    },
    async agentUndo() {
      const ctx = agentHistoryStripContext();
      const target = historyStripTarget(ctx);
      if (target === 'sketch') {
        const undoSketch = agentHostRef.current?.agentSketchUndo;
        const step = typeof undoSketch === 'function' ? undoSketch() : null;
        if (!step?.ok) return { handled: false };
        const label = step.depthAfter === 0 ? 'Sketch start' : 'Sketch edit';
        return {
          handled: true,
          result: {
            ok: true,
            kind: 'sketch',
            applied: { label, depth: step.depthAfter, tool: step.tool },
            reverted: { label: 'Sketch edit', depth: step.depthBefore },
          },
        };
      }
      if (target === 'assembly') {
        if (!assemblyHistoryCanUndo(assemblyHistoryRef.current)) return { handled: false };
        const beforeDoc = assemblyRef.current;
        const jointsBefore = beforeDoc?.joints?.length ?? 0;
        const namesBefore = (beforeDoc?.joints || []).map((row) => row.name || row.id);
        const headBefore = assemblyHistoryRef.current?.head ?? 0;
        const commits = assemblyHistoryRef.current?.commits || [];
        const revertedLabel = commits[headBefore]
          ? summarizeAssemblyHistory(assemblyHistoryRef.current).entries[headBefore]?.label
          : 'Assembly';
        const changed = handleJointUndo();
        if (!changed) return { handled: false };
        const afterDoc = assemblyRef.current;
        const jointsAfter = afterDoc?.joints?.length ?? 0;
        const namesAfter = (afterDoc?.joints || []).map((row) => row.name || row.id);
        const headAfter = assemblyHistoryRef.current?.head ?? 0;
        const appliedLabel = summarizeAssemblyHistory(assemblyHistoryRef.current).entries[headAfter]?.label
          || 'Assembly';
        return {
          handled: true,
          result: {
            ok: true,
            kind: 'assembly',
            joints: jointsAfter,
            applied: { label: appliedLabel, historyHead: headAfter },
            reverted: {
              label: revertedLabel,
              historyHeadBefore: headBefore,
              historyHeadAfter: headAfter,
              jointsBefore,
              jointsAfter,
              jointNamesBefore: namesBefore,
              jointNamesAfter: namesAfter,
            },
          },
        };
      }
      if (!focusWritePart(null)) {
        return {
          handled: true,
          error: { code: 'no_write_part', message: 'No writable part for undo' },
        };
      }
      const id = historyKey();
      const branch = historyRef.current?.branches?.main;
      const current = partHistoriesRef.current[id] || {
        commits: branch?.commits || [],
        head: Number.isInteger(branch?.head) ? branch.head : -1,
      };
      const undone = undoPartHistory(current);
      if (undone.code == null) return { handled: false };
      const reverted = current.commits[current.head];
      const applied = undone.history.commits[undone.history.head];
      partHistoriesRef.current[id] = undone.history;
      applyPartHistory(undone.history);
      codeEditorRef.current?.setTextOnly?.(undone.code);
      const outcome = await agentRunOutcomeSettled(undone.code);
      return {
        handled: true,
        result: {
          ok: outcome.ok === true,
          kind: 'part',
          partId: id,
          applied: { label: applied?.message || 'Step' },
          reverted: { label: reverted?.message || 'Step' },
          errors: outcome.errors || [],
          ...(Object.prototype.hasOwnProperty.call(outcome, 'runFailure')
            ? { runFailure: outcome.runFailure }
            : {}),
          ...(outcome.stale === true ? { stale: true } : {}),
          // The script the undo restored: the bridge echoes this, never a
          // re-read that could still show the undone block.
          restoredScript: undone.code,
          status: {
            volume: outcome.volume ?? null,
            bbox: outcome.bbox ?? null,
            partName: outcome.partName || '',
            featureCount: agentFeatureCount(undone.code),
            bodyCount: outcome.bodyCount ?? null,
            runState: outcome.ok === true ? 'ok' : 'failed',
            ...(outcome.stale === true ? { stale: true } : {}),
          },
        },
      };
    },
    async agentRedo() {
      const ctx = agentHistoryStripContext();
      const target = historyStripTarget(ctx);
      if (target === 'sketch') {
        return { handled: false };
      }
      if (target === 'assembly') {
        if (!assemblyHistoryCanRedo(assemblyHistoryRef.current)) return { handled: false };
        const beforeDoc = assemblyRef.current;
        const jointsBefore = beforeDoc?.joints?.length ?? 0;
        const headBefore = assemblyHistoryRef.current?.head ?? 0;
        const changed = handleJointRedo();
        if (!changed) return { handled: false };
        const afterDoc = assemblyRef.current;
        const jointsAfter = afterDoc?.joints?.length ?? 0;
        const headAfter = assemblyHistoryRef.current?.head ?? 0;
        const appliedLabel = summarizeAssemblyHistory(assemblyHistoryRef.current).entries[headAfter]?.label
          || 'Assembly';
        return {
          handled: true,
          result: {
            ok: true,
            kind: 'assembly',
            joints: jointsAfter,
            applied: { label: appliedLabel, historyHead: headAfter },
            reapplied: {
              historyHeadBefore: headBefore,
              historyHeadAfter: headAfter,
              jointsBefore,
              jointsAfter,
            },
          },
        };
      }
      if (!focusWritePart(null)) {
        return {
          handled: true,
          error: { code: 'no_write_part', message: 'No writable part for redo' },
        };
      }
      const id = historyKey();
      const branch = historyRef.current?.branches?.main;
      const current = partHistoriesRef.current[id] || {
        commits: branch?.commits || [],
        head: Number.isInteger(branch?.head) ? branch.head : -1,
      };
      const redone = redoPartHistory(current);
      if (redone.code == null) return { handled: false };
      const reverted = current.commits[current.head];
      const applied = redone.history.commits[redone.history.head];
      partHistoriesRef.current[id] = redone.history;
      applyPartHistory(redone.history);
      codeEditorRef.current?.setTextOnly?.(redone.code);
      const outcome = await agentRunOutcomeSettled(redone.code);
      return {
        handled: true,
        result: {
          ok: outcome.ok === true,
          kind: 'part',
          partId: id,
          applied: { label: applied?.message || 'Step' },
          reverted: { label: reverted?.message || 'Step' },
          errors: outcome.errors || [],
          ...(Object.prototype.hasOwnProperty.call(outcome, 'runFailure')
            ? { runFailure: outcome.runFailure }
            : {}),
          ...(outcome.stale === true ? { stale: true } : {}),
          restoredScript: redone.code,
          status: {
            volume: outcome.volume ?? null,
            bbox: outcome.bbox ?? null,
            partName: outcome.partName || '',
            featureCount: agentFeatureCount(redone.code),
            bodyCount: outcome.bodyCount ?? null,
            runState: outcome.ok === true ? 'ok' : 'failed',
            ...(outcome.stale === true ? { stale: true } : {}),
          },
        },
      };
    },
    openFeature(args = {}) {
      if (!focusWritePart(null)) {
        return { error: { code: 'no_write_part', message: 'No writable part for feature edit' } };
      }
      const buf = codeEditorRef.current?.getContent?.() ?? '';
      const resolved = resolveStripTarget(buf, args);
      if (resolved.error) return resolved;
      // The popup gate only decides whether a card mounts. While the agent
      // prompt is working, every bridge call is inside withAgentDrivenChange
      // and the gate is closed. Returning here used to look like a successful
      // open and store nothing, so edit_feature reported ok and
      // confirm_feature then failed with no_feature_edit. The session refs
      // are what confirm rewrites; the card is optional.
      const popup = allowFeaturePopup();
      const plan = featureEditOpenPlan({ popupAllowed: popup, contour: !!resolved.contourId });
      if (!plan.keepSession) {
        return { error: { code: 'edit_failed', message: 'Could not open contour for edit' } };
      }
      agentFeatureDraftRef.current = {};
      agentFeatureTargetRef.current = resolved.feature || null;
      agentFeatureSessionRef.current = {
        id: resolved.chip.id,
        kind: resolved.chip.kind,
        index: resolved.chip.index,
      };
      if (resolved.contourId) {
        if (viewportRef.current?.beginContourEdit?.(resolved.contourId)) {
          setFeatureSheet(null);
          setFeatureStripActiveId(resolved.chip.id);
          // A saved contour reopens in the contour sketch, not a card.
          // edit_feature patches that sketch and confirm_feature saves and
          // closes it (readFeatureSession tells the commands which it is).
          agentFeatureSessionRef.current = {
            ...agentFeatureSessionRef.current,
            contourId: resolved.contourId,
          };
          return {
            result: {
              id: resolved.chip.id,
              kind: resolved.chip.kind,
              index: resolved.chip.index,
              contourId: resolved.contourId,
              sketchOpen: true,
            },
          };
        }
        agentFeatureSessionRef.current = null;
        agentFeatureTargetRef.current = null;
        agentFeatureDraftRef.current = null;
        return { error: { code: 'edit_failed', message: 'Could not open contour for edit' } };
      }
      if (plan.openCard) openFeatureSheetFor(resolved.feature);
      return {
        result: {
          id: resolved.chip.id,
          kind: resolved.chip.kind,
          index: resolved.chip.index,
        },
      };
    },
    activateFeature(args = {}) {
      if (args?.clear === true) {
        setFeatureStripActiveId(null);
        return { result: { activeChipId: null } };
      }
      if (args?.id == null && args?.index == null) {
        return { error: { code: 'bad_args', message: 'activate_feature needs id, index, or clear' } };
      }
      const buf = codeEditorRef.current?.getContent?.() ?? '';
      const resolved = resolveStripTarget(buf, args);
      if (resolved.error) return resolved;
      setFeatureStripActiveId(resolved.chip.id);
      return {
        result: {
          activeChipId: resolved.chip.id,
          id: resolved.chip.id,
          index: resolved.chip.index,
        },
      };
    },
    editFeature({ params } = {}) {
      if (!agentFeatureSessionActive()) {
        return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      }
      if (params != null && (typeof params !== 'object' || Array.isArray(params))) {
        return { error: { code: 'bad_args', message: 'edit_feature params must be an object' } };
      }
      const bag = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
      const kind = agentFeatureSessionRef.current?.kind
        || agentHostRef.current?.agentReadFeatureEdit?.()?.feature?.kind
        || featureSheetRef.current?.feature?.kind
        || null;
      const bad = featureEditParamError(kind, bag);
      if (bad) return { error: bad };
      const prev = agentFeatureDraftRef.current && typeof agentFeatureDraftRef.current === 'object'
        ? agentFeatureDraftRef.current
        : {};
      agentFeatureDraftRef.current = { ...prev, ...bag };
      const holeEdit = agentHostRef.current?.agentReadHoleEdit?.();
      if (holeEdit?.open) {
        const patched = agentHostRef.current?.agentPatchHoleCard?.(bag);
        if (patched?.error) return patched;
      }
      const vpEdit = agentHostRef.current?.agentReadFeatureEdit?.();
      if (vpEdit?.open) {
        const patched = agentHostRef.current?.agentPatchFeatureEdit?.(bag);
        if (patched?.error) return patched;
      }
      return { result: { params: agentFeatureDraftRef.current } };
    },
    prepareFeatureConfirm: () => prepareAgentFeatureConfirm(),
    dismissFeatureConfirmSession: () => dismissAgentFeatureSession({ mode: 'settle' }),
    /**
     * The agent's open feature session, for the commands that must know
     * whether open_feature put up a card or reopened a saved contour in the
     * sketch: `{ open, id, kind, index, contourId, sketchOpen, tool }`.
     */
    readFeatureSession() {
      const session = agentFeatureSessionRef.current;
      const contour = agentHostRef.current?.readMode?.()?.contour || null;
      const contourId = session?.contourId || null;
      const sketchOpen = !!(contourId && contour && (contour.contourId == null || contour.contourId === contourId));
      return {
        open: agentFeatureSessionActive(),
        id: session?.id ?? null,
        kind: session?.kind ?? null,
        index: session?.index ?? null,
        contourId,
        sketchOpen,
        tool: sketchOpen ? (contour.tool || null) : null,
      };
    },
    cancelFeature() {
      if (!agentFeatureSessionActive()) {
        return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      }
      dismissAgentFeatureSession();
      return { result: { cancelled: true } };
    },
    prepareFeatureDelete: (args) => prepareAgentFeatureDelete(args),
    async rollbackTo(args = {}) {
      if (!focusWritePart(null)) {
        return { error: { code: 'no_write_part', message: 'No writable part for rollback' } };
      }
      const key = editorRollbackKey();
      const buf = codeEditorRef.current?.getContent?.() ?? '';
      const current = storedRollback(key);
      const resolved = resolveRollbackTarget(buf, args, current);
      if (resolved.error) return resolved;
      // Store the anchor, then run the part the way `execute` does (the
      // refresh reads the stored anchor and records the run), and wait for
      // it, so status, volume and errors describe the rolled-back solid, not
      // the previous run (B14: status kept the rolled-back volume after
      // rollback_to clear until an explicit run).
      storeRollbackAnchor(key, resolved.anchor);
      const epochBefore = runOutcomeEpochRef.current;
      let ran = null;
      try {
        ran = await refreshAssemblyRef.current?.(buf, { forceActive: true });
      } catch {
        ran = null;
      }
      const stored = storedRollback(key);
      const display = stored === undefined ? null : stored;
      const run = agentCadRunOutcome(epochBefore, ran);
      return { result: { rollbackAnchor: display, run, script: buf } };
    },
  });
  const partLabels = {};
  for (const row of assemblyDoc?.parts || []) partLabels[row.id] = row.name || row.id;
  const assemblyLabel = assemblyName(assemblyDoc);

  const openPartScript = (id) => {
    if (id != null) handleSelectPart(id);
    setScriptEditorOpen(true);
    if (isMobile) setMobileStageSticky('script');
  };

  const closeScriptEditor = () => {
    const live = codeEditorRef.current?.getContent?.();
    setScriptEditorOpen(false);
    if (isMobile) setMobileStageSticky('parts', { sync: false });
    if (!shouldRebuildOnEditorClose({
      live,
      lastBuilt: lastAssemblyScriptRef.current,
      pendingAutoRun: pendingAutoRunRef.current,
      assemblyOpenLocked: assemblyOpenLockRef.current,
      game: appModeRef.current === 'game',
    })) return;
    refreshAssemblyRef.current?.(live);
  };

  const agentBridgeLive = agentBridgeEnabled({ dev: import.meta.env.DEV === true })
    && manifoldReady
    && editorInitialScript !== null;

  const showPartFeed = appMode !== 'game' && (assemblyDoc || !isMobile);
  const partFeed = showPartFeed ? (
    <PartFeed
      ref={partFeedRef}
      placement={isMobile ? 'mobile' : 'desktop'}
      isMobile={isMobile}
      source={assemblyDoc?.source ?? 'local'}
      assemblyName={assemblyLabel}
      assemblyId={assemblyDoc?.id || ''}
      onRenameAssembly={handleRenameAssembly}
      onRenamePart={handleRenamePart}
      rows={partRows}
      scripts={partScripts}
      activeId={cadPartId}
      onSelect={handleSelectPart}
      onEditScript={openPartScript}
      onToggleVisible={handleTogglePartVisible}
      onReorder={handleReorderParts}
      onLoadFile={handleLoadAssembly}
      onResolveFile={handleResolvePartFile}
      onAddPart={handleAddPart}
      onUpload={handleImport}
      onDownload={handleDownloadPart}
      isUploading={isUploading}
      isDownloading={isDownloading}
      onNewAssembly={handleNewAssembly}
      onFlushLocalAssembly={handleFlushLocalAssembly}
      assemblyLeaveSafe={assemblyDoc ? !needsAssemblyLeaveGuard(assemblyDoc, {
        sourceDirty: !!sourceDirty,
        hasBaseline: !!gitBaseline,
        source: assemblyDoc.source,
        scripts: partScripts,
        defaultScripts: [DEFAULT_SCRIPT, newPartStarterScript(), starterCubeScript()],
        liveId: assemblyDoc.activeId,
        liveScript: liveDirtyScript,
      }) : true}
      onDeletePart={handleDeletePart}
      onPreviewDeletePart={handlePreviewDeletePart}
      onToggleSource={handleToggleSource}
      onPlanMoveToGit={handlePlanMoveToGit}
      onMoveToGit={handleMoveToGit}
      defaultVaultName={gitDefaultVaultName()}
      sanitizeVaultName={sanitizeVaultName}
      sourceDirty={!!sourceDirty}
      onListVaultAssemblies={handleListVaultAssemblies}
      onListVaultBrowse={handleListVaultBrowse}
      onOpenVaultAssembly={handleOpenVaultAssembly}
      onPreviewDeleteAssembly={handlePreviewDeleteAssembly}
      onDeleteAssembly={handleDeleteAssembly}
      onInsertVaultAssemblyParts={handleInsertVaultAssemblyParts}
      onOpenVaultPart={handleOpenVaultPart}
      onCopyPartToAssembly={handleCopyPartToAssembly}
      onAddInstance={(partId) => { agentInsertInstance({ partId }); }}
      groups={assemblyDoc?.groups || []}
      onRenameGroup={handleRenameGroup}
      onUngroup={handleUngroup}
      onCopyGroup={handleCopyGroup}
      onRemoveGroup={handleRemoveGroup}
      onAddExistingPart={handleAddExistingPart}
      onAddToRepo={handleAddToRepo}
      renameNotice={renameNotice}
      onRenameRetry={handleRenameRetry}
      onRenameRevert={handleRenameRevert}
      syncConflict={syncConflict}
      onSyncConflictClear={() => setSyncConflict(null)}
      planSaveConflict={planSaveConflict}
      onPlanSaveConflict={handlePlanSaveConflict}
      onPlanSaveConflictClear={() => setPlanSaveConflict(null)}
      canCommit={assemblyDoc?.source === 'git' && !!sourceDirty && gitSession.phase === 'connected' || (assemblyDoc?.source === 'git' && assemblyDoc?.vaultLayout === 'v2' && gitSession.phase === 'connected') || (upgradeVaultEnabled() && assemblyDoc?.source === 'git' && assemblyDoc?.vaultLayout === 'legacy' && gitSession.phase === 'connected')}
      vaultLayout={assemblyDoc?.vaultLayout || null}
      upgradeAvailable={upgradeVaultEnabled()}
      onGitCommit={handleGitCommit}
      onUpgradeVault={handleUpgradeVault}
      onUpgradeConflict={handleUpgradeConflict}
      onOverwriteMain={handleOverwriteMain}
      behindPartIds={behindPartIdSet}
      assemblyBehind={!!behindMarkers.assemblyBehind}
      assemblyPath={gitAssemblyPath || ''}
      onBehindChoice={handleBehindChoice}
      currentBranch={assemblyDoc?.source === 'git' ? (gitBaseline?.branch || 'main') : ''}
      onListBranches={handleListBranches}
      onSwitchBranch={handleSwitchBranch}
      onCreateBranch={handleCreateBranch}
      onDeleteBranch={handleDeleteBranch}
      onMergeBranch={handleMergeBranch}
      onSquashMerge={handleSquashMerge}
      onBranchUiClose={handleBranchUiClose}
      githubConnectReady={!!githubClientId}
      githubConnected={githubConnected}
      onGitConnect={handleGitConnect}
      onGitDisconnect={handleGitDisconnect}
      onAccount={handleAccount}
      onSignedOut={handleProfileSignedOut}
      onClearLocalCadData={openClearLocalCache}
      profileVaultName={gitDefaultVaultName()}
      agentBridgeLive={agentBridgeLive}
      suggestNewPartPath={
        assemblyDoc?.source === 'git'
          ? suggestNewPartPath(assemblyDoc.name, assemblyDoc.parts)
          : ''
      }
    />
  ) : null;

  const behindToastChoice = () => behindToastTarget(
    gitBehindRef.current,
    gitBehindResolvedRef.current,
    {
      assemblyName: assemblyName(assemblyRef.current),
      parts: assemblyRef.current?.parts || [],
    },
  );
  const onGitBehindGetLatest = () => {
    openBehindToastTarget(partFeedRef.current, behindToastChoice());
  };
  const onGitBehindKeepMine = async () => {
    await keepBehindToastTarget(partFeedRef.current, behindToastChoice());
    setGitBehindToast(null);
  };

  const assemblyOpenSpinner = assemblyOpenUi && appMode !== 'game' ? (
    <AssemblyOpenSpinner
      name={assemblyOpenUi.name}
      index={assemblyOpenUi.index}
      total={assemblyOpenUi.total}
    />
  ) : null;
  const repoMovedToastEl = (repoMoved || repoSaved) ? (
    <div className="absolute top-4 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2">
      {repoMoved ? (
        <div data-repo-moved-toast="" data-repo-moved-kind={repoMoved.kind}>
          <ErrorPopup
            tone="warn"
            onDismiss={() => { if (!repoMovedBusy) setRepoMoved(null); }}
            className="px-4 py-2"
          >
            <div className="flex flex-col items-start gap-2">
              <span data-repo-moved-msg="">{REPO_MOVED_WARNING}</span>
              <button
                type="button"
                data-repo-moved-branch=""
                disabled={repoMovedBusy}
                className="rounded-md bg-amber-500/30 px-2 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-500/45 disabled:opacity-50"
                onClick={() => { void handleSaveOnNewBranch(); }}
              >
                Make a new branch
              </button>
            </div>
          </ErrorPopup>
        </div>
      ) : (
        <div data-repo-saved-toast="" data-repo-saved-branch={repoSaved.branch}>
          <ErrorPopup
            tone="success"
            onDismiss={() => setRepoSaved(null)}
            className="px-4 py-2"
          >
            {repoSavedMessage(repoSaved.branch)}
          </ErrorPopup>
        </div>
      )}
    </div>
  ) : null;

  const assemblyOpenToastEl = assemblyOpenToast ? (
    <AssemblyOpenFailureToast
      message={assemblyOpenToast.message}
      onRetry={assemblyOpenToast.retry}
      onDismiss={() => setAssemblyOpenToast(null)}
    />
  ) : null;

  const agentGitConsentModal = agentGitConsentUi ? (
    <AgentGitConsentModal
      command={agentGitConsentUi.command}
      repo={agentGitConsentUi.repo}
      branch={agentGitConsentUi.branch}
      onAllow={() => finishAgentGitConsent('allow')}
      onDeny={() => finishAgentGitConsent('deny')}
    />
  ) : null;

  const clearCacheDialog = (
    <ClearCacheDialog
      open={!!clearCacheUi}
      outbox={clearCacheUi?.plan?.outbox || 0}
      unsynced={clearCacheUi?.plan?.unsynced || 0}
      offerPush={!!clearCacheUi?.plan?.offerPush}
      busy={!!clearCacheUi?.busy}
      error={clearCacheUi?.error || ''}
      onCancel={() => { if (!clearCacheUi?.busy) setClearCacheUi(null); }}
      onConfirm={() => { void handleClearLocalCadData({ pushFirst: false }); }}
      onPushFirst={() => { void handleClearLocalCadData({ pushFirst: true }); }}
    />
  );

  const checkoutLine = cartCheckout?.lines?.[cartCheckout.index] || null;
  const checkoutStep = checkoutLine ? {
    index: cartCheckout.index,
    total: cartCheckout.lines.length,
    name: checkoutLine.partName,
    qty: checkoutLine.qty,
    scriptChanged: !!checkoutLine.hashStale,
  } : null;
  const quoteScript = checkoutLine?.script || currentScript;
  const quoteFilename = checkoutLine ? `${checkoutLine.partName}.js` : currentFilename;
  const orderScript = orderData?.script || checkoutLine?.script || currentScript;
  const checkoutHasNext = !!(cartCheckout && cartCheckout.index < cartCheckout.lines.length - 1);
  const partQuote = cartChrome.partQuote;
  const partQuoteModal = partQuote ? (
    <QuoteModal
      key={`add-${partQuote.partId}`}
      mode="add"
      onClose={() => cartChrome.closePartQuote?.()}
      onGetQuote={(options) => calculateQuote(partQuote.script, {
        ...(options || {}),
        partId: partQuote.partId,
      })}
      onAddToCart={(payload) => cartChrome.commitQuotedLine?.(payload)}
      currentScript={partQuote.script}
      currentFilename={partQuote.filename}
      partId={partQuote.partId}
    />
  ) : null;

  const captureViewerShot = () => viewportRef.current?.capturePng?.({ format: 'png' }) ?? null;
  const agentPromptNode = appMode !== 'game' ? (
    <PromptInput
      isMobile={isMobile}
      captureViewer={captureViewerShot}
      promptContext={agentPromptContext({
        partId: cadPartId || assemblyDoc?.activeId || '',
        assemblyId: assemblyDoc?.id || '',
      })}
      featurePopupOpen={featurePopupOpen}
    />
  ) : null;

  let shell;
  if (isMobile) {
    // Keep h-dvh while the keyboard is closed so Monaco can take a real
    // user-gesture focus (iOS often refuses keyboard inside a fixed+overflow
    // shell). Once open, pin to visualViewport so the editor stays visible.
    const mobileShellStyle = keyboardOpen
      ? {
          height: vv.height,
          top: vv.offsetTop,
          left: 0,
          right: 0,
          position: 'fixed',
        }
      : undefined;

    // Stages apply to mobile CAD only. Game keeps the stacked split.
    const useStages = appMode === 'cad';
    const isCadStage = !useStages || mobileStage === 'cad';
    const isScriptStage = useStages && mobileStage === 'script';
    const isPartsStage = useStages && mobileStage === 'parts';

    const viewportEl = (
            <Viewport 
              ref={viewportRef} 
              agentHostRef={agentHostRef}
              agentBridgeLive={agentBridgeLive}
              onAccount={handleAccount}
              onSignedOut={handleProfileSignedOut}
              onClearLocalCadData={openClearLocalCache}
              profileVaultName={gitDefaultVaultName()}
              currentScript={currentScript}
              onFaceSelected={handleFaceSelected}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo()}
              canRedo={canRedo()}
              currentFilename={currentFilename}
              showCadTitle={!!assemblyDoc}
              brandHeader={appMode !== 'game'}
              assemblyName={assemblyLabel}
              onRenameFile={handleRenameFile}
              onTitlePartActivate={handleTitlePartActivate}
              onTitleAssemblyActivate={handleTitleAssemblyActivate}
              onSelectAll={handleSelectAll}
              mode={appMode}
              ghostMeshData={ghostMeshData}
              onStartGame={handleStartGame}
              onExitGame={handleExitGame}
              onRun={handleGameRun}
              onHint={handleGameHint}
              onPickPuzzle={handlePickPuzzle}
              gameElapsedMs={gameElapsedMs}
              gameSuccess={gameSuccess}
              gamePuzzleTitle={currentPuzzle?.title}
              gameBestTimeMs={gameBestTimeMs}
              isMobile={isMobile}
              onInsertHelper={handleInsertHelper}
              onFeatureOpen={handleFeatureOpen}
              onCommitContourProfile={handleCommitContourProfile}
              onCommitHole={handleCommitHole}
              onContourRefsResolved={handleContourRefsResolved}
              onDeleteContour={handleDeleteContour}
              onCommitFillet={handleCommitFillet}
              onCommitFeatureEdit={handleCommitFeatureEdit}
              onDeleteFeatureEdit={handleDeleteFeatureEdit}
              assemblyRunLockRef={assemblyOpenLockRef}
              onCommitShell={handleCommitShell}
              onCommitPaint={handleCommitPaint}
              onCommitFea={handleCommitFea}
              getPartScript={scriptForFeaPart}
              onCommitDraft={handleCommitDraft}
              onCommitCut={handleCommitCut}
              onCommitBoolean={handleCommitBoolean}
              onCommitMove={handleCommitMove}
              onCommitRotate={handleCommitRotate}
              onCommitMirror={handleCommitMirror}
              onCommitMoveFace={handleCommitMoveFace}
              sheetMetalBinding={assemblyDoc ? partSheetMetal(assemblyDoc, assemblyDoc.activeId) : null}
              assemblyColors={assemblyDoc?.colors || null}
              getSheetMetalReady={getSheetMetalReady}
              onBindSheetMetal={handleBindSheetMetal}
              onOpenJoints={handleOpenJoints}
              onCommitSheetMetal={handleCommitSheetMetal}
              onCommitDeleteFace={handleCommitDeleteFace}
              getHelperBuffer={() => codeEditorRef.current?.getContent?.() || ''}
              cadToolbarHost={cadToolbarHost}
              onRunAssembly={() => {
                const code = codeEditorRef.current?.getContent?.();
                if (code == null) return false;
                setCurrentScript(code);
                return refreshAssemblyRef.current?.(code);
              }}
              featureSheetEnabled={useStages && isCadStage && !featureSheet}
              onFeatureLongPress={openFeatureSheetFromCad}
              onPickRetarget={handlePickRetarget}
              onCadEmptyClick={handleCadEmptyClick}
              jointPicking={jointCreateOpen}
            jointCardOpen={jointCreateOpen}
              jointCardOpen={jointCreateOpen}
              onJointPick={handleJointPick}
              jointCard={jointCardNode}
              cadPartSelected={cadPartId != null}
              onRunOutcome={handleRunOutcome}
              rollbackAnchor={appMode === 'game' ? undefined : editorRollbackAnchor}
              getBooleanContext={assemblyPartContext}
              onFeatureSessionChange={handleFeatureSession}
              onFeatureCardChange={setFeaturePopupOpen}
              onSketchStripChange={handleSketchStrip}
            onSheetStripChange={handleSheetStrip}
              partLabels={partLabels}
              featureEdit={appMode === 'game' || (useStages && !isCadStage) ? null : featureSheet}
              featureEditScript={currentScript}
              featureEditFailedIds={sheetFailedIds}
              featureEditFailedTitles={sheetFailedTitles}
              onFeatureEditAccept={handleFeatureSheetAccept}
              onFeatureEditCancel={closeFeatureSheet}
              onFeatureEditDelete={handleFeatureSheetDelete}
              onFeatureEditScript={handleFeatureSheetEditScript}
              onFeatureEditPick={(f) => openFeatureSheetFor(f)}
              onFeatureEditDismiss={() => setFeatureSheet((cur) => (cur ? null : cur))}
            />
    );

    const editorEl = (
                <CodeEditor
                  key={appMode}
                  ref={codeEditorRef}
                  initialScript={appMode === 'game' ? '' : editorInitialScript}
                  onExecute={handleExecute}
                  onCodeChange={handleCodeChange}
                  onEditorSeed={handleEditorSeed}
                  isMobile={isMobile}
                  mode={appMode}
                  onExitGame={handleExitGame}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  canUndo={canUndo()}
                  canRedo={canRedo()}
                  isExecuting={gameRunBusy}
                  onRun={handleGameRun}
                  onHint={handleGameHint}
                  onPickPuzzle={handlePickPuzzle}
                  gameElapsedMs={gameElapsedMs}
                  gameSuccess={gameSuccess}
                  gameBestTimeMs={gameBestTimeMs}
                  onCadToolbarHost={setCadToolbarHost}
                  monacoEndPadClassName={isScriptStage ? 'pr-11' : ''}
                  shown={appMode === 'game' ? true : isScriptStage}
                  onClose={appMode === 'game' ? null : closeScriptEditor}
                  onAccount={handleAccount}
                  onSignedOut={handleProfileSignedOut}
                  onClearLocalCadData={openClearLocalCache}
                  profileVaultName={gitDefaultVaultName()}
              agentBridgeLive={agentBridgeLive}
                />
    );

    shell = (
      <CartChromeProvider value={cartChrome}>
        <AgentVisibleLayer agentHostRef={agentHostRef} />
        <div
          ref={splitShellRef}
          className={`relative flex flex-col bg-chrome-surface overflow-hidden ${keyboardOpen ? '' : 'h-dvh'}`}
          style={mobileShellStyle}
          data-mobile-stage={useStages ? mobileStage : undefined}
        >
          {useStages ? (
            /* CAD dual-stage: both panes stay mounted (WebGL + Monaco + refs).
               Off-stage pane is invisibly full-size so contexts survive.
               Stage toggle is the bottom home-indicator pill (Slice Mobile B). */
            <div className="relative flex-1 min-h-0">
              <div
                className={`absolute inset-0 overflow-hidden ${
                  isCadStage ? '' : 'invisible pointer-events-none'
                }`}
                data-stage-pane="cad"
                data-joints-row-open={jointsRowOpen ? '' : undefined}
                aria-hidden={!isCadStage}
              >
                {viewportEl}
                {agentPromptNode}
                {jointDeleteToastNode}
                {/* Slice Mobile C.2: CAD feature strip HORIZONTAL under the title.
                    Top is --feature-strip-offset-mobile: header top-4, two pills,
                    and --viewer-title-stack-gap twice. */}
                {isCadStage && (
                  <div
                    className="cad-feature-strip-mobile absolute inset-x-0 z-20 pointer-events-auto flex flex-col"
                    data-cad-feature-strip=""
                    data-joints-row-mounted={jointsRowOpen ? '' : undefined}
                    data-feature-strip-placement="under-ribbon-horizontal"
                    data-feature-strip-gap="name-2x"
                    data-feature-bar-row="full"
                  >
                    <FeatureStrip
                      orientation="horizontal"
                      script={stripScript}
                      entities={sketchOpen ? sketchStrip.entities : null}
                      bodyCount={stripBodyCount}
                      failedIds={stripFailedIds}
                      failedTitles={stripFailedTitles}
                      rollbackAnchor={stripRollbackAnchor}
                      onRollback={handleRollbackAnchor}
                      hidden={sketchOpen ? false : featureSession}
                      activeId={sketchOpen ? sketchStrip.activeId : (featureSheet?.feature?.id || featureStripActiveId || (sheetRibbonOpen ? sheetStrip.activeId : null))}
                      hideWhenEmpty
                      onJump={sketchOpen ? undefined : ((f) => openFeatureSheetFor(f))}
                      onSelectEntity={sketchOpen ? onSketchSelect : undefined}
                      onSelectSheet={sketchOpen ? undefined : onSheetSelect}
                      onUndo={sketchOpen ? onSketchUndo : stripUndo}
                      onRedo={sketchOpen ? undefined : stripRedo}
                      canUndo={sketchOpen ? !!sketchStrip.canUndo : stripCanUndo}
                      canRedo={sketchOpen ? false : stripCanRedo}
                      undoLabel={sketchOpen ? 'Undo' : undoLabel}
                      redoLabel={sketchOpen ? 'Redo' : redoLabel}
                    />
                    {jointsRowNode}
                  </div>
                )}
              </div>
              <div
                className={`absolute inset-0 flex flex-col min-h-0 ${
                  isScriptStage ? 'z-40' : 'invisible pointer-events-none'
                }`}
                data-stage-pane="script"
                data-script-sheet=""
                data-script-editor-open={isScriptStage ? 'true' : 'false'}
                aria-hidden={!isScriptStage}
              >
                {/* Script ribbon is full viewport width: editor stack is
                    absolute inset-0 so [data-editor-ribbon] spans the pane.
                    Vertical feature strip overlays on the right, starting
                    BELOW the measured ribbon (no side-by-side shrink). Monaco
                    keeps a w-11 end gutter so chips don't cover code. */}
                <div className="relative flex-1 min-h-0" data-script-stage-body="">
                  <div
                    className="absolute inset-0 z-10 overflow-hidden"
                    data-script-editor-stack=""
                  >
                    <div className="absolute inset-0">
                      {editorEl}
                    </div>
                  </div>
                  {isScriptStage && (
                    <div
                      className="absolute right-0 bottom-0 z-20 flex flex-col pointer-events-none"
                      style={{ top: ribbonPx }}
                      data-script-feature-strip=""
                      data-feature-strip-below-ribbon=""
                      data-feature-strip-ribbon-spacer-h="measured"
                    >
                      <div className="pointer-events-auto flex-1 min-h-0 flex flex-col">
                        <FeatureStrip
                          orientation="vertical"
                          script={currentScript}
                          bodyCount={stripBodyCount}
                          failedIds={scriptStripFailedIds}
                          failedTitles={scriptStripFailedTitles}
                          rollbackAnchor={editorRollbackAnchor}
                          onRollback={handleEditorRollbackAnchor}
                          hidden={featureSession}
                          activeId={featureSheet?.feature?.id || featureStripActiveId || sheetStrip?.activeId || null}
                          onJump={handleFeatureStripJump}
                          onSelectSheet={onSheetSelect}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div
                className={`absolute inset-0 flex min-h-0 flex-col ${
                  isPartsStage ? 'z-10' : 'invisible pointer-events-none'
                }`}
                data-stage-pane="parts"
                aria-hidden={!isPartsStage}
              >
                {partFeed}
              </div>

              {/* Bottom home-indicator stage pill. A feature card hides it
                  (index.css :has([data-feature-card])) and docks to this edge. */}
              <div
                className="absolute left-1/2 -translate-x-1/2 z-30"
                style={{ bottom: 0 }}
                data-mobile-stage-home-indicator=""
              >
                <MobileStageToggle stage={mobileStage} onChange={setMobileStageSticky} />
              </div>
            </div>
          ) : (
            /* Game (and any non-staged mobile): viewport TOP, Monaco BOTTOM. */
            <>
              <div className="flex-1 min-h-0 overflow-hidden">
                {viewportEl}
              </div>
              <SplitDivider orientation="horizontal" onDrag={(x, y) => handleSplitDragY(y)} />
              <div
                className="flex-shrink-0 flex flex-col min-h-0"
                style={{ height: mobileEditorPx }}
              >
                <div className="relative flex-1 min-h-0">
                  <div className="absolute inset-0">
                    {editorEl}
                  </div>
                </div>
              </div>
            </>
          )}

          {clearCacheDialog}
          {agentGitConsentModal}

          {/* Login Modal */}
          {showLoginModal && (
            <LoginModal
              onClose={() => setShowLoginModal(false)}
              onComplete={handleLoginComplete}
              currentScript={currentScript}
              currentFilename={currentFilename}
            />
          )}
          
          {/* Account Modal */}
          {showAccountModal && (
            <AccountModal
              onClose={() => setShowAccountModal(false)}
              user={user}
              selectedTab={accountModalTab}
            />
          )}
          
          {/* Quote Modal */}
          {showQuoteModal && (
            <QuoteModal
              key={checkoutLine?.lineId || 'quote'}
              onClose={handleQuoteClose}
              onGetQuote={handleGetQuote}
              onOrder={handleStartOrder}
              currentScript={quoteScript}
              currentFilename={quoteFilename}
              fixedQuantity={checkoutLine ? checkoutLine.qty : null}
              initialOptions={checkoutLine?.options || null}
              partId={checkoutLine?.partId || null}
              lineError={checkoutLine?.lineError || ''}
              checkoutStep={checkoutStep}
            />
          )}
          {partQuoteModal}
          
          {/* Order Modal */}
          {showOrderModal && orderData && (
            <OrderModal
              key={orderData.lineId || 'order'}
              onClose={handleOrderClose}
              quoteData={orderData.quoteData}
              modelData={orderData.modelData}
              currentScript={orderScript}
              restoredStep={orderData.restoredStep}
              restoredAddress={orderData.restoredAddress}
              restoredGuestEmail={orderData.restoredGuestEmail}
              onOpenAccount={handleAccount}
              checkoutStep={checkoutStep}
              lineId={orderData.lineId || null}
              onOrderPlaced={handleCartOrderPlaced}
              hasNextPart={checkoutHasNext}
              onNextPart={handleCheckoutNext}
            />
          )}
          

          {showPuzzlePicker && (
            <PuzzlePickerModal
              onClose={() => setShowPuzzlePicker(false)}
              onSelect={loadPuzzle}
              currentPuzzleId={appMode === 'game' ? currentPuzzle?.id : null}
              loading={gameLoading}
            />
          )}
          {showHints && (
            <GameHintsModal
              onClose={() => setShowHints(false)}
              puzzle={currentPuzzle}
            />
          )}
          {showConfetti && <GameConfetti durationMs={SUCCESS_CLEAR_MS} />}
          {assemblyOpenSpinner}
          {assemblyOpenToastEl}
          {repoMovedToastEl}
          {gameError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md">
              <ErrorPopup
                tone="banner"
                onDismiss={() => setGameError(null)}
                onUndo={handleUndo}
                canUndo={canUndo()}
                className="px-4 py-2"
              >
                {gameError}
              </ErrorPopup>
            </div>
          )}
          {uploadError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md" data-upload-toast="" data-upload-toast-kind="error">
              <ErrorPopup
                tone="banner"
                onDismiss={() => setUploadError(null)}
                onUndo={handleUndo}
                canUndo={canUndo()}
                className="px-4 py-2"
              >
                Upload Error: {uploadError}
              </ErrorPopup>
            </div>
          )}
          {uploadNotice && !uploadError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md" data-upload-toast="" data-upload-toast-kind="warn">
              <ErrorPopup
                tone="warn"
                onDismiss={() => setUploadNotice(null)}
                className="px-4 py-2"
              >
                {uploadNotice}
              </ErrorPopup>
            </div>
          )}
          {gitBehindToast && !uploadError && !uploadNotice && (
            <GitBehindToast
              message={gitBehindToast.message}
              onGetLatest={onGitBehindGetLatest}
              onKeepMine={onGitBehindKeepMine}
              onDismiss={() => setGitBehindToast(null)}
            />
          )}
        </div>
        <SiteFooter />
        <CartSheet />
        <CartDrop />
        {showCheckoutPage && (
          <CheckoutPage
            assemblyRef={assemblyRef}
            partScriptsRef={partScriptsRef}
            liveScriptRef={liveScriptRef}
            partRunsRef={partRunsRef}
            onClose={() => setShowCheckoutPage(false)}
            onPaid={(lineIds) => {
              for (const id of lineIds || []) {
                if (id) cartChrome.removeLine(id);
              }
            }}
            onOpenAccount={(tab) => {
              setShowCheckoutPage(false);
              handleOpenAccount(tab);
            }}
          />
        )}
      </CartChromeProvider>
    );
  } else {
    shell = (
      <CartChromeProvider value={cartChrome}>
      <AgentVisibleLayer agentHostRef={agentHostRef} />
      <div className="flex h-dvh bg-chrome-surface">
        {appMode !== 'game' && (
          <div data-parts-feed-placement="desktop-left" className="h-full shrink-0">
            {partFeed}
          </div>
        )}
        <div ref={splitShellRef} className="relative flex h-full min-w-0 flex-1">
        {appMode === 'game' && (
        <div className="flex flex-col min-w-0" style={{ width: `${splitPct}%` }}>
          <div className="flex-1 min-h-0">
            <CodeEditor 
              ref={codeEditorRef}
              initialScript=""
              onExecute={handleExecute}
              onCodeChange={handleCodeChange}
              onEditorSeed={handleEditorSeed}
              isMobile={isMobile}
              mode={appMode}
              onExitGame={handleExitGame}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo()}
              canRedo={canRedo()}
              isExecuting={gameRunBusy}
              onRun={handleGameRun}
              onHint={handleGameHint}
              onPickPuzzle={handlePickPuzzle}
              gameElapsedMs={gameElapsedMs}
              gameSuccess={gameSuccess}
              gameBestTimeMs={gameBestTimeMs}
              onCadToolbarHost={setCadToolbarHost}
              onAccount={handleAccount}
              onSignedOut={handleProfileSignedOut}
              onClearLocalCadData={openClearLocalCache}
              profileVaultName={gitDefaultVaultName()}
              agentBridgeLive={agentBridgeLive}
            />
          </div>
        </div>
        )}
        {appMode === 'game' && (
        <SplitDivider orientation="vertical" onDrag={(x) => handleSplitDragX(x)} />
        )}
        <div className="relative flex-1 min-w-0" data-joints-row-open={jointsRowOpen ? '' : undefined}>
          {jointDeleteToastNode}
          {/* Desktop CAD viewer feature bar (horizontal under title) — replaces
              the old vertical seam strip between editor and viewer. The
              per-part joints row stacks directly under it. */}
          {appMode !== 'game' && (
            <div
              className="absolute inset-x-0 top-14 z-20 pointer-events-auto flex flex-col px-2"
              data-desktop-feature-strip=""
              data-joints-row-mounted={jointsRowOpen ? '' : undefined}
              data-cad-feature-strip="desktop"
              data-feature-strip-placement="viewer-under-title-horizontal"
              data-feature-strip-gap="name-2x"
              data-feature-bar-row="full"
            >
              <FeatureStrip
                orientation="horizontal"
                script={stripScript}
                entities={sketchOpen ? sketchStrip.entities : null}
                bodyCount={stripBodyCount}
                failedIds={stripFailedIds}
                failedTitles={stripFailedTitles}
                rollbackAnchor={stripRollbackAnchor}
                onRollback={handleRollbackAnchor}
                hidden={sketchOpen ? false : featureSession}
                activeId={sketchOpen ? sketchStrip.activeId : (featureSheet?.feature?.id || featureStripActiveId || (sheetRibbonOpen ? sheetStrip.activeId : null))}
                hideWhenEmpty
                onJump={sketchOpen ? undefined : handleDesktopFeatureStripJump}
                onSelectEntity={sketchOpen ? onSketchSelect : undefined}
                onSelectSheet={sketchOpen ? undefined : onSheetSelect}
                onUndo={sketchOpen ? onSketchUndo : stripUndo}
                onRedo={sketchOpen ? undefined : stripRedo}
                canUndo={sketchOpen ? !!sketchStrip.canUndo : stripCanUndo}
                canRedo={sketchOpen ? false : stripCanRedo}
                undoLabel={sketchOpen ? 'Undo' : undoLabel}
                redoLabel={sketchOpen ? 'Redo' : redoLabel}
              />
              {jointsRowNode}
            </div>
          )}
          <Viewport 
            ref={viewportRef} 
            agentHostRef={agentHostRef}
            agentBridgeLive={agentBridgeLive}
            onAccount={handleAccount}
            onSignedOut={handleProfileSignedOut}
            onClearLocalCadData={openClearLocalCache}
            profileVaultName={gitDefaultVaultName()}
            currentScript={currentScript}
            onFaceSelected={handleFaceSelected}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo()}
            canRedo={canRedo()}
            currentFilename={currentFilename}
            showCadTitle={!!assemblyDoc}
            brandHeader={appMode !== 'game'}
            assemblyName={assemblyLabel}
            onRenameFile={handleRenameFile}
            onTitlePartActivate={handleTitlePartActivate}
            onTitleAssemblyActivate={handleTitleAssemblyActivate}
            onSelectAll={handleSelectAll}
            mode={appMode}
            ghostMeshData={ghostMeshData}
            onStartGame={handleStartGame}
            onExitGame={handleExitGame}
            onRun={handleGameRun}
            onHint={handleGameHint}
            onPickPuzzle={handlePickPuzzle}
            gameElapsedMs={gameElapsedMs}
            gameSuccess={gameSuccess}
            gamePuzzleTitle={currentPuzzle?.title}
            gameBestTimeMs={gameBestTimeMs}
            isMobile={false}
            onInsertHelper={handleInsertHelper}
            onFeatureOpen={handleFeatureOpen}
            onCommitContourProfile={handleCommitContourProfile}
            onCommitHole={handleCommitHole}
            onContourRefsResolved={handleContourRefsResolved}
            onDeleteContour={handleDeleteContour}
            onCommitFillet={handleCommitFillet}
            onCommitFeatureEdit={handleCommitFeatureEdit}
            onDeleteFeatureEdit={handleDeleteFeatureEdit}
            assemblyRunLockRef={assemblyOpenLockRef}
              onCommitShell={handleCommitShell}
              onCommitPaint={handleCommitPaint}
              onCommitFea={handleCommitFea}
              getPartScript={scriptForFeaPart}
              onCommitDraft={handleCommitDraft}
              onCommitCut={handleCommitCut}
              onCommitBoolean={handleCommitBoolean}
              onCommitMove={handleCommitMove}
              onCommitRotate={handleCommitRotate}
              onCommitMirror={handleCommitMirror}
              onCommitMoveFace={handleCommitMoveFace}
              sheetMetalBinding={assemblyDoc ? partSheetMetal(assemblyDoc, assemblyDoc.activeId) : null}
              assemblyColors={assemblyDoc?.colors || null}
              getSheetMetalReady={getSheetMetalReady}
              onBindSheetMetal={handleBindSheetMetal}
              onOpenJoints={handleOpenJoints}
              onCommitSheetMetal={handleCommitSheetMetal}
              onCommitDeleteFace={handleCommitDeleteFace}
            getHelperBuffer={() => codeEditorRef.current?.getContent?.() || ''}
            cadToolbarHost={cadToolbarHost}
            onRunAssembly={() => {
              const code = codeEditorRef.current?.getContent?.();
              if (code == null) return false;
              setCurrentScript(code);
              return refreshAssemblyRef.current?.(code);
            }}
            onPickRetarget={handlePickRetarget}
            onCadEmptyClick={handleCadEmptyClick}
            jointPicking={jointCreateOpen}
            onJointPick={handleJointPick}
            jointCard={jointCardNode}
            cadPartSelected={cadPartId != null}
            onRunOutcome={handleRunOutcome}
            rollbackAnchor={appMode === 'game' ? undefined : editorRollbackAnchor}
            getBooleanContext={assemblyPartContext}
            onFeatureSessionChange={handleFeatureSession}
            onFeatureCardChange={setFeaturePopupOpen}
            onSketchStripChange={handleSketchStrip}
            onSheetStripChange={handleSheetStrip}
            partLabels={partLabels}
            featureEdit={appMode === 'game' ? null : featureSheet}
            featureEditScript={currentScript}
            featureEditFailedIds={sheetFailedIds}
            featureEditFailedTitles={sheetFailedTitles}
            onFeatureEditAccept={handleFeatureSheetAccept}
            onFeatureEditCancel={closeFeatureSheet}
            onFeatureEditDelete={handleFeatureSheetDelete}
            onFeatureEditScript={handleDesktopFeatureSheetEditScript}
            onFeatureEditPick={(f) => openFeatureSheetFor(f)}
            onFeatureEditDismiss={() => setFeatureSheet((cur) => (cur ? null : cur))}
          />
          {agentPromptNode}
        </div>
        {assemblyOpenSpinner}
        {appMode !== 'game' && (
            <ScriptEditorDrawer open={scriptEditorOpen}>
              <CodeEditor
                ref={codeEditorRef}
                initialScript={editorInitialScript}
                onExecute={handleExecute}
                onCodeChange={handleCodeChange}
                onEditorSeed={handleEditorSeed}
                isMobile={isMobile}
                mode={appMode}
                onExitGame={handleExitGame}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={canUndo()}
                canRedo={canRedo()}
                isExecuting={gameRunBusy}
                onRun={handleGameRun}
                onHint={handleGameHint}
                onPickPuzzle={handlePickPuzzle}
                gameElapsedMs={gameElapsedMs}
                gameSuccess={gameSuccess}
                gameBestTimeMs={gameBestTimeMs}
                onCadToolbarHost={setCadToolbarHost}
                shown={scriptEditorOpen}
                onClose={closeScriptEditor}
                onAccount={handleAccount}
                onSignedOut={handleProfileSignedOut}
                onClearLocalCadData={openClearLocalCache}
                profileVaultName={gitDefaultVaultName()}
              agentBridgeLive={agentBridgeLive}
              />
            </ScriptEditorDrawer>
          )}

        {clearCacheDialog}
        {agentGitConsentModal}

        {/* Login Modal */}
        {showLoginModal && (
          <LoginModal
            onClose={() => setShowLoginModal(false)}
            onComplete={handleLoginComplete}
            currentScript={currentScript}
            currentFilename={currentFilename}
          />
        )}
        
        {/* Account Modal */}
        {showAccountModal && (
          <AccountModal
            onClose={() => setShowAccountModal(false)}
            user={user}
            selectedTab={accountModalTab}
          />
        )}
        
        {/* Quote Modal */}
        {showQuoteModal && (
          <QuoteModal
            key={checkoutLine?.lineId || 'quote'}
            onClose={handleQuoteClose}
            onGetQuote={handleGetQuote}
            onOrder={handleStartOrder}
            currentScript={quoteScript}
            currentFilename={quoteFilename}
            fixedQuantity={checkoutLine ? checkoutLine.qty : null}
            initialOptions={checkoutLine?.options || null}
            partId={checkoutLine?.partId || null}
            lineError={checkoutLine?.lineError || ''}
            checkoutStep={checkoutStep}
          />
        )}
        {partQuoteModal}
        
        {/* Order Modal */}
        {showOrderModal && orderData && (
          <OrderModal
            key={orderData.lineId || 'order'}
            onClose={handleOrderClose}
            quoteData={orderData.quoteData}
            modelData={orderData.modelData}
            currentScript={orderScript}
            restoredStep={orderData.restoredStep}
            restoredAddress={orderData.restoredAddress}
            restoredGuestEmail={orderData.restoredGuestEmail}
            onOpenAccount={handleOpenAccount}
            checkoutStep={checkoutStep}
            lineId={orderData.lineId || null}
            onOrderPlaced={handleCartOrderPlaced}
            hasNextPart={checkoutHasNext}
            onNextPart={handleCheckoutNext}
          />
        )}
        

          {showPuzzlePicker && (
            <PuzzlePickerModal
              onClose={() => setShowPuzzlePicker(false)}
              onSelect={loadPuzzle}
              currentPuzzleId={appMode === 'game' ? currentPuzzle?.id : null}
              loading={gameLoading}
            />
          )}
          {showHints && (
            <GameHintsModal
              onClose={() => setShowHints(false)}
              puzzle={currentPuzzle}
            />
          )}
          {showConfetti && <GameConfetti durationMs={SUCCESS_CLEAR_MS} />}
        {assemblyOpenToastEl}
        {repoMovedToastEl}
        {gameError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md">
              <ErrorPopup
                tone="banner"
                onDismiss={() => setGameError(null)}
                onUndo={handleUndo}
                canUndo={canUndo()}
                className="px-4 py-2"
              >
                {gameError}
              </ErrorPopup>
            </div>
          )}
        {uploadError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md" data-upload-toast="" data-upload-toast-kind="error">
              <ErrorPopup
                tone="banner"
                onDismiss={() => setUploadError(null)}
                onUndo={handleUndo}
                canUndo={canUndo()}
                className="px-4 py-2"
              >
                Upload Error: {uploadError}
              </ErrorPopup>
            </div>
          )}
          {uploadNotice && !uploadError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md" data-upload-toast="" data-upload-toast-kind="warn">
              <ErrorPopup
                tone="warn"
                onDismiss={() => setUploadNotice(null)}
                className="px-4 py-2"
              >
                {uploadNotice}
              </ErrorPopup>
            </div>
          )}
          {gitBehindToast && !uploadError && !uploadNotice && (
            <GitBehindToast
              message={gitBehindToast.message}
              onGetLatest={onGitBehindGetLatest}
              onKeepMine={onGitBehindKeepMine}
              onDismiss={() => setGitBehindToast(null)}
            />
          )}
        </div>
      </div>
      <SiteFooter />
      <CartSheet />
      <CartDrop />
      {showCheckoutPage && (
        <CheckoutPage
          assemblyRef={assemblyRef}
          partScriptsRef={partScriptsRef}
          liveScriptRef={liveScriptRef}
          partRunsRef={partRunsRef}
          onClose={() => setShowCheckoutPage(false)}
          onPaid={(lineIds) => {
            for (const id of lineIds || []) {
              if (id) cartChrome.removeLine(id);
            }
          }}
          onOpenAccount={(tab) => {
            setShowCheckoutPage(false);
            handleOpenAccount(tab);
          }}
        />
      )}
      </CartChromeProvider>
    );
  }

  // One host above the isMobile split. A copy in each shell remounts at 768px
  // and would drop the relay socket and mint a new tabKey.
  return (
    <AgentBridgeHost enabled={agentBridgeLive}>
      {shell}
    </AgentBridgeHost>
  );
};

export default App;
