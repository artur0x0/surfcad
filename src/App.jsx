import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import CodeEditor from './components/CodeEditor';
import Viewport from './components/Viewport';
import { BrandMark, BrandWordmark } from './components/brand/BrandWordmark';
import { clearLoadingTheme, readLoadingTheme } from './utils/loadingTheme';
import PromptInput from './components/PromptInput';
import SplitDivider from './components/SplitDivider';
import ScriptEditorDrawer from './components/ScriptEditorDrawer';
import MobileStageToggle from './components/MobileStageToggle';
import FeatureStrip from './components/FeatureStrip';
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
  deleteFeatureBlock,
  listFeatureSheetTargets,
  pickDefaultFeatureSheetTarget,
  isFeatureSheetEditable,
  liveSheetFeature,
} from './utils/featureSheetWriteback';
import { confirmFeatureEdit, deleteFeatureEdit } from './utils/featureEdit';
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
  newLocalPartId,
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
  needsAssemblyLeaveGuard,
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
import { editedPartIdsSinceSnapshot, liveEditorOverride, snapshotPartScripts } from './agent/state/editedSinceLoad';
import { buildFeatureTree } from './agent/state/featureTree';
import { resolveRollbackTarget, resolveStripTarget } from './agent/featureStripAgent';
import { buildPartsState } from './agent/state/parts';
import { decidePartVisible } from './agent/state/partVisible';
import { createdPartFromDocs, scriptRequestsRun } from './agent/state/createPart.js';
import { assemblyOpenFailure, resolveAssemblyOpenName } from './agent/state/openAssemblyName.js';
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
  cadStripsShowJoints,
  acceptJointPick,
  cardFromJoint,
  dismissJointEdit,
  jointHighlightEntries,
  draftFromPicks,
  jointPickSlot,
  quickAngleCard,
  resolvePartChange,
  emptyClickCadSelection,
  jointChips,
  jointsChromeMounted,
  nextJointName,
  pushAssemblyHistory,
  redoJointStrip,
  seedAssemblyHistory,
  shouldArmJointPick,
  stripRedoLabel,
  stripUndoLabel,
  undoJointStrip,
} from './joints/jointUi';
import { characteristicLengthFor } from './utils/characteristicLength';
import { fallbackOffscreenDistance, offscreenRange } from './utils/sliderMap';
import JointCard from './components/JointCard';
import {
  applyAssemblyOpenHold,
  createAssemblyOpenController,
  runTrackedAssemblyOpen,
} from './utils/assemblyOpenOverlay';
import { featureWriteTarget, leftoverPickSolids, shouldSyncScript } from './utils/pickRetarget';
import { shouldRebuildOnEditorClose } from './utils/scriptEditorClose';
import { clearPaintColors, commitPaintColors, removeUnmatchedColors } from './utils/facePaint';
import {
  deletePartScript,
  loadAssemblyDocumentStatus,
  loadAssemblySidecar,
  loadPartAssets,
  loadPartScripts,
  loadPartSyncFlags,
  saveAssemblyDocument,
  saveAssemblySidecar,
  savePartScript,
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
  listVaultAssemblies,
  takenAssemblyNames,
  resolveAssemblyFolderName,
  listVaultBrowseItems,
  openVaultAssembly,
  planInsertVaultAssemblyParts,
  planOpenVaultPart,
  planCopyToAssembly,
  allocateVaultPartPath,
  findAssemblyPart,
  partRepoPath,
  stampMissingSurfIds,
  rekeyWorkingCopyToTip,
  retireImplicitVaultWriteOps,
  readVaultPart,
  showAddToRepo,
  isExternalPartPath,
  mintSurfId,
  withSurfId,
  readSurfId,
  backfillSurfIds,
  applyIdPromotion,
  migrateAssemblyRecords,
  migrateLocalPartIds,
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
  baselineAfterPartSave,
  baselineAfterPartRename,
  suggestNewPartPath,
  partPathAllowedFor,
  vaultSegment,
  assemblyFilePath,
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
  SAVE_QUEUED_COPY,
  noRepoYetError,
  gitOpCatchResult,
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
  moveToGit,
  putAsset,
  placeLocalMeshParts,
  remapMeshRecords,
  collectMeshCommitAssets,
  partMeshRecordsFromBaseline,
  meshVaultSaveAllowed,
} from './utils/git';
import PartFeed from './components/PartFeed';
import manifoldContext from './utils/ManifoldWorker';
import DEFAULT_SCRIPT from './utils/defaultScript';
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
  newPartStarterScript,
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
import { composeBooleanCommit, validateBooleanAccept } from './utils/booleanMode';
import { crossPartSubtractWrites, externalBodyRotationBlock, planCrossPartSubtract } from './utils/externalCopy';
import { FEATURE_MARKER_KINDS } from './utils/featureMarkers';
import { composeMoveCommit } from './utils/moveMode';
import { composeMoveFaceCommit } from './utils/moveFaceMode';
import { composeDeleteFaceCommit } from './utils/deleteFaceMode';

function failureSkipStamp(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows.map((row) => `${row?.id || ''}:${row?.threw ? 1 : 0}:${row?.dependsOn || ''}`).join('|');
}

const App = () => {
  const [currentScript, setCurrentScript] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [selectedFace, setSelectedFace] = useState(null);
  const [currentFilename, setCurrentFilename] = useState(null);
  /** Assembly list. Scripts live beside it, never inside the document. */
  const [assemblyDoc, setAssemblyDoc] = useState(null);
  const [partScripts, setPartScripts] = useState({});
  const [partRuns, setPartRuns] = useState({});
  const assemblyRef = useRef(null);
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
  /** Assembly-open spinner. Hidden until ~150ms; cleared on every exit. */
  const [assemblyOpenUi, setAssemblyOpenUi] = useState(null);
  const [assemblyOpenToast, setAssemblyOpenToast] = useState(null);
  const assemblyOpenCtrlRef = useRef(null);
  const assemblyOpenProgressRef = useRef(null);
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
  const handleRunOutcome = ({
    script, ok, scriptLine, featureId, featureBlock, skipped, message, detail,
  } = {}) => {
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
  const openFeatureSheetFor = (feature) => {
    if (!feature) return;
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
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
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
    const result = deleteFeatureBlock(buf, live);
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
    if (result.run) {
      setTimeout(() => {
        handleGameRun();
      }, 0);
    }
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
    agentSnapshotDocKeyRef.current = `${doc.name ?? ''}\0${doc.source ?? ''}\0${(doc.parts || []).map((row) => row.id).join('\n')}`;
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
          await ensureGitVaultRef.current();
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
        await runTrackedAssemblyOpen(assemblyOpenCtrlRef.current, {
          name: plan.name || 'assembly',
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
            let scripts = await loadPartScripts(doc.parts.map((part) => part.id), {
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
            if (!readOnly && !bootWouldClobber(loaded.doc, doc) && (migrated.changed || localIds.changed || Object.keys(flags).length)) {
              try {
                await saveAssemblyDocument(doc);
                if (migrated.changed || localIds.changed) {
                  for (const [id, text] of Object.entries(scripts)) {
                    const part = (doc.parts || []).find((row) => row.id === id);
                    await savePartScript(
                      id,
                      text,
                      typeof part?.isSynced === 'boolean' ? { isSynced: part.isSynced } : {},
                    );
                  }
                }
                if (localIds.changed) {
                  for (const { from } of localIds.pairs) {
                    try { await deletePartScript(from); } catch { /* ignore */ }
                  }
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
  }, [manifoldReady, bootResume, githubConnected, user]);

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
      savePartScript(idAtSchedule, scriptAtSchedule);
    }, 600);
    return () => clearTimeout(timer);
  }, [currentScript, currentFilename, manifoldReady, editorInitialScript, appMode]);

  // Agent `dirty.unsaved`: baseline scripts at open (reset when the assembly identity changes).
  useEffect(() => {
    if (!assemblyDoc || editorInitialScript === null || appMode === 'game') return;
    const key = `${assemblyDoc.name ?? ''}\0${assemblyDoc.source ?? ''}\0${(assemblyDoc.parts || []).map((row) => row.id).join('\n')}`;
    if (agentSnapshotDocKeyRef.current === key && agentScriptSnapshotRef.current) return;
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
        savePartScript(id, live);
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
  }, [currentScript, currentFilename, manifoldReady, editorInitialScript]);

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
    partScriptsRef.current = next;
    setPartScripts(next);
  };

  const commitPartRuns = (runs) => {
    partRunsRef.current = runs || {};
    setPartRuns(partRunsRef.current);
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
    if (!bootReadOnlyRef.current || opts.force) {
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
    return id ? String(id) : '__cad__';
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
    const key = partId ? String(partId) : '__cad__';
    const next = historyForPart(partHistoriesRef.current, key, script ?? '');
    partHistoriesRef.current[key] = next;
    applyPartHistory(next);
  };

  const dropPartHistory = (partId) => {
    if (partId == null) return;
    delete partHistoriesRef.current[String(partId)];
  };

  // The editor buffer is this part's latest script. Keep it on that part's
  // stack before the active id changes, so a later Undo cannot see another part.
  const stashPartHistory = (partId, script) => {
    if (appModeRef.current === 'game' || partId == null || typeof script !== 'string') return;
    const key = String(partId);
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
    const otherIds = doc.parts
      .filter((part) => part.visible !== false && part.id !== viewId)
      .map((part) => part.id);
    const willBuildActive = !!(viewId && activeVisible && typeof scripts[viewId] === 'string');
    const buildTotal = otherIds.length + (willBuildActive ? 1 : 0);
    let buildStep = 0;
    const noteBuild = () => {
      buildStep += 1;
      const report = assemblyOpenProgressRef.current;
      if (typeof report === 'function') report({ index: buildStep, total: buildTotal });
    };
    let other;
    try {
      other = await runAssemblyParts({
          doc,
          scripts,
          ids: otherIds,
          execute: (script, execOpts) => {
            noteBuild();
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
      } catch (err) {
        console.error('[App] assembly run failed', err);
        return false;
      }
      if (gen !== refreshGenRef.current) return false;

      const runs = { ...(other.runs || {}) };
      if (willBuildActive) {
        noteBuild();
        const runOpts = {
          noShadow: true,
          preservePicks: opts.preservePicks === true,
          partId: viewId,
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
          runs[viewId] = {
            ok: true,
            mesh: run.mesh,
            error: null,
            bodyCount,
            volume: geom.volume,
            bbox: geom.bbox,
          };
        } else if (run && run.ok === false) {
          runs[viewId] = { ok: false, mesh: null, error: run.error || 'Script failed' };
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

      if (gen !== refreshGenRef.current) return false;
      // Hidden rows were not re-run. Keep their last solid so the parts-list
      // thumbnail stays; composeViewportParts still leaves them out of the view.
      const keptRuns = preserveHiddenPartRuns(doc, runs, partRunsRef.current);
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
    revealPartOnRibbon(active.id, picked.ok ? picked.script : '');
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
          placement: partPlacement(partNow),
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
      viewportRef.current?.adoptActiveSolid?.({
        mesh: cachedMesh,
        position: partPosition(part) || [0, 0, 0],
        placement: partPlacement(part),
        partId: id,
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
          placement: partPlacement(part),
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
        placement: partPlacement(part),
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
    || viewportRef.current?.agentReadHoleEdit?.()?.open
    || viewportRef.current?.agentReadFeatureEdit?.()?.open
  );

  const dismissAgentFeatureSession = () => {
    viewportRef.current?.agentCancelFeatureEdit?.();
    viewportRef.current?.agentCancelHoleEdit?.();
    closeFeatureSheet();
    setFeatureStripActiveId(null);
    agentFeatureDraftRef.current = null;
    agentFeatureTargetRef.current = null;
    agentFeatureSessionRef.current = null;
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

    if (viewportRef.current?.agentReadHoleEdit?.()?.open) {
      const holePayload = viewportRef.current?.agentHoleConfirmPayload?.();
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

    const vpEdit = viewportRef.current?.agentReadFeatureEdit?.();
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
      await runTrackedAssemblyOpen(assemblyOpenCtrlRef.current, {
        name: doc.name,
        total: doc.parts.length,
        retry: () => { void handleLoadAssembly(text, filename); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const scripts = await loadPartScripts(doc.parts.map((part) => part.id), {
            onProgress: (update) => progress({ ...update, name: doc.name }),
          });
          if (!signal()) return;
          rememberScripts(scripts);
          const saved = rememberAssembly(doc);
          const keep = new Set(saved.parts.map((part) => String(part.id)));
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
    if (!doc || doc.source !== 'git' || !baseline?.headSha) return null;
    const gen = ++gitCheckGenRef.current;
    try {
      const vault = await ensureGitVault();
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
      gitAdapterRef.current = wantReal
        ? createGithubAdapter({ token })
        : createMockGithubAdapter({ login: 'local-user', persist: true });
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

  /** Branch the working copy is on (baseline), else the vault default. */
  const gitWorkingBranch = () => {
    const baseline = gitBaselineRef.current;
    const vault = gitVaultRef.current;
    return baseline?.branch || vault?.defaultBranch || 'main';
  };

  /** True when git Save would be enabled (content ≠ tip, or first-commit chrome). */
  const isGitWorkingCopyDirty = () => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return false;
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
    for (const key of Object.keys(partHistoriesRef.current)) {
      if (key !== '__game__' && !keep.has(key)) delete partHistoriesRef.current[key];
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
      const key = String(id);
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
      const hist = partHistoriesRef.current[String(active.id)];
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
   * G6 Move to Git: find-or-create the vault (rename field), write the
   * IndexedDB parts + assembly into the layout as one commit, then switch the
   * working copy to Git mode with a clean baseline.
   */
  const handleMoveToGit = async ({ vaultName = DEFAULT_VAULT_NAME, sharedIds = [] } = {}) => {
    const doc = assemblyRef.current;
    if (!doc) return { status: 'error', error: 'No assembly' };
    if (doc.source === 'git') return { status: 'error', error: 'Already in Git mode' };
    try {
      const live = liveEditorScript(doc);
      if (live.liveId) {
        savePartScript(live.liveId, live.liveScript);
        rememberScripts({ ...partScriptsRef.current, [live.liveId]: live.liveScript });
      }
      const result = await moveToGit(ensureGitAdapter(), {
        vaultName,
        storedName: storedVaultName(),
        doc,
        scripts: partScriptsRef.current,
        sharedIds,
        ...live,
      });
      if (result.status !== 'moved') return result;
      // Carry runs / leftovers / undo history / CAD pick over to the new ids.
      const remap = (map) => {
        const next = { ...(map || {}) };
        for (const { from, to } of result.idMap) {
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
      const pick = result.idMap.find((m) => m.from === cadPartIdRef.current);
      if (pick) rememberCadPart(pick.to);
      gitVaultRef.current = {
        repo: result.vault.repo,
        defaultBranch: result.vault.defaultBranch,
        headSha: result.sha,
        private: result.vault.private,
      };
      await noteResolvedVault(result.vault.repo);
      await applyCommittedWorkspace({ doc: result.doc, scripts: result.scripts });
      rememberGitBaseline(result.baseline);
      if (result.sha) await gitSync().setLastSyncedSha(result.vault.repo, result.sha, 'main');
      rememberGitBehind(null, { showToast: false, resetResolved: true });
      setGitBehindToast(null);
      refreshAssemblyRef.current?.(undefined, { persistActive: false });
      return result;
    } catch (err) {
      return { status: 'error', error: err.message || 'Move to Git failed' };
    }
  };

  const handleListVaultAssemblies = async () => {
    const vault = await ensureGitVault({ create: false });
    return listVaultAssemblies(gitAdapterRef.current, vault.repo, gitWorkingBranch());
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
    const filled = backfillSurfIds(opened.doc, store.pathIndexFor(vault.repo));
    const migrated = migrateAssemblyRecords({ doc: filled.doc, scripts: opened.scripts });
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
      for (const { from } of localIds.pairs) {
        try { deletePartScript(from); } catch { /* ignore */ }
      }
    }
    const reconciled = reconcileSyncedFromTip(localIds.doc, localIds.scripts);
    const openedDocIn = reconciled.doc;
    const openedScriptsIn = localIds.scripts;
    if (previous?.source === 'git') {
      const aligned = rekeyWorkingCopyToTip(previous, partScriptsRef.current, openedDocIn, {
        histories: partHistoriesRef.current,
        meshMeta: partMeshMetaRef.current,
        cadPartId: cadPartIdRef.current,
      });
      if (aligned.pairs.length) {
        rekeyRuntime(aligned.pairs);
        partMeshMetaRef.current = aligned.meshMeta;
        setPartMeshMeta(aligned.meshMeta);
        for (const { from } of aligned.pairs) {
          try { await deletePartScript(from); } catch { /* ignore */ }
        }
      }
    }
    for (const part of openedDocIn.parts || []) {
      if (part.surfId && partRepoPath(part)) store.rememberPathId(vault.repo, partRepoPath(part), part.surfId);
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
    for (const [id, script] of Object.entries(openedScripts)) {
      const part = (openedDoc.parts || []).find((row) => row.id === id);
      const mesh = meshRecords[id];
      await savePartScript(id, script, {
        ...(typeof part?.isSynced === 'boolean' ? { isSynced: part.isSynced } : {}),
        ...(mesh || {}),
      });
      if (mesh?.assets) rememberPartAssets(id, mesh.assets);
    }
    if (Object.keys(meshRecords).length) {
      const nextMeta = { ...partMeshMetaRef.current, ...meshRecords };
      partMeshMetaRef.current = nextMeta;
      setPartMeshMeta(nextMeta);
    }
    rememberScripts(openedScripts);
    rememberSidecar(emptyWorkingSidecar());
    let saved = rememberAssembly(openedDoc);
    noteRecentAssembly(saved.name);
    const baseline = captureBaseline({
      assemblyPath: deletedOverlay.removed ? assemblyFilePath(saved.name) : opened.baseline.assemblyPath,
      assemblyName: saved.name,
      doc: saved,
      scripts: openedScripts,
      assets: opened.baseline?.assets,
      branch,
      headSha: opened.baseline.headSha,
    });
    if (!deletedOverlay.removed && opened.baseline.legacyCleanup) {
      baseline.legacyCleanup = opened.baseline.legacyCleanup;
    }
    rememberGitBaseline(baseline);
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

  const handleOpenVaultAssembly = async (name) => {
    try {
      await runTrackedAssemblyOpen(assemblyOpenCtrlRef.current, {
        name: name || 'assembly',
        retry: () => { void handleOpenVaultAssembly(name); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const vault = await ensureGitVault();
          if (!signal()) return;
          const branch = gitWorkingBranch();
          const tip = (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha || null;
          const store = gitSync();
          await store.ready();
          const opened = await openVaultAssembly(
            gitAdapterRef.current,
            vault.repo,
            name,
            {
              branch,
              headSha: tip,
              pathIndex: store.pathIndexFor(vault.repo),
              onProgress: (update) => progress({ ...update, name: update.name || name }),
            },
          );
          if (!signal()) return;
          const adopted = await adoptVaultOpening(opened, vault);
          if (!signal()) return;
          const saved = adopted.saved;
          const openedScripts = adopted.scripts;
          // G4: check remote on open (usually current; catches a race with a push).
          void checkGitRemoteBehind({ showToast: true, reason: 'open' });
          const keep = new Set(saved.parts.map((part) => String(part.id)));
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
      const vault = await ensureGitVault();
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
   */
  const handleSwitchBranch = async (branchName) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    const name = vaultSegment(doc.name) || doc.name;
    if (!name) return { status: 'error', error: 'No assembly open' };
    const current = gitWorkingBranch();
    if (!branchName || branchName === current) {
      return { status: 'same', branch: current };
    }
    try {
      const opened = await runTrackedAssemblyOpen(assemblyOpenCtrlRef.current, {
        name,
        retry: () => { void handleSwitchBranch(branchName); },
        load: async ({ progress, signal }) => {
          refreshGenRef.current += 1;
          const vault = await ensureGitVault();
          if (!signal()) return null;
          const store = gitSync();
          await store.ready();
          const loaded = await switchVaultBranch(
            gitAdapterRef.current, vault.repo, name, branchName, {
              onProgress: (update) => progress({ ...update, name: update.name || name }),
              pathIndex: store.pathIndexFor(vault.repo),
            },
          );
          if (!signal()) return null;
          const adopted = await adoptVaultOpening(loaded, vault);
          if (!signal()) return null;
          const saved = adopted.saved;
          rememberGitBehind(null, { showToast: false, resetResolved: true });
          setGitBehindToast(null);
          void checkGitRemoteBehind({ showToast: true, reason: 'branch-switch' });
          const keep = new Set(saved.parts.map((part) => String(part.id)));
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
    return hidePendingDeletedAssemblies(browse, ops);
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
    const keptIds = new Set(Object.keys(scripts));
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

  const handlePreviewDeleteAssembly = async (name) => {
    try {
      const { entries, tip } = await vaultEntriesForDelete();
      return previewDeleteAssembly(entries, name, { openDoc: assemblyRef.current, tipEntries: tip });
    } catch (err) {
      return { status: 'error', error: err?.message || 'Could not check this assembly' };
    }
  };

  /**
   * One outbox commit. The cache snapshot is swapped only after the next
   * tree is built. Failure toasts Retry/Revert and Revert puts that snapshot back.
   * The promise waits for the local IndexedDB document and part-script
   * writes, then the queued git sync. A later call retries that failed op.
   */
  const handleDeleteAssembly = async (name, mode = 'keep') => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') return { status: 'error', error: 'Not in Git mode' };
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
  const handleInsertVaultAssemblyParts = async (sourceName) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    try {
      const vault = await ensureGitVault();
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
        scripts[add.id] = add.content;
        if (!parts.some((p) => p.id === add.id)) {
          parts = [...parts, {
            id: add.id,
            name: add.name,
            visible: true,
            order: parts.length,
            ...(add.surfId ? { surfId: add.surfId } : {}),
            // Existing linked path, not a newly assigned copy path.
            ...(add.fromPath ? { path: add.fromPath } : {}),
          }];
        }
        activeId = add.id;
      }
      const inserted = withInsertedGroup(
        { ...doc, source: 'git', activeId, parts },
        {
          name: planned.sourceName,
          source: planned.sourcePath,
          partIds: planned.additions.map((add) => add.surfId).filter(Boolean),
        },
      );
      rememberScripts(scripts);
      const saved = rememberAssembly(inserted);
      for (const add of planned.additions) {
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

  /** G11: open/add a single vault part into the current assembly (remap if needed). */
  const handleOpenVaultPart = async (path) => {
    const doc = assemblyRef.current;
    if (!doc || doc.source !== 'git') {
      return { status: 'error', error: 'Not in Git mode' };
    }
    try {
      const vault = await ensureGitVault();
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
    const groups = replaceGroupPartId(doc.groups, part.surfId, plan.surfId);
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
        placement: partPlacement(nextPart),
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

  const handleGitCommit = async (message) => {
    const doc = assemblyRef.current;
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
    try {
      const vault = await ensureGitVault({ create: true });
      const branch = gitWorkingBranch();
      const store = gitSync();
      let baseline = gitBaselineRef.current;
      const sidecar = gitSidecarRef.current;
      if (!baseline && sidecar.renameFrom && sidecar.renameFrom !== vaultSegment(doc.name)) {
        try {
          const tip = (await gitAdapterRef.current.getBranch(vault.repo, branch))?.sha || vault.headSha || null;
          const opened = await openVaultAssembly(
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
      };
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
      const vault = await ensureGitVault();
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
        });
        if (reloaded.kind === 'assembly') {
          // Replace assembly document; keep scripts for ids still present.
          const nextDoc = reloaded.doc;
          const keepScripts = {};
          for (const part of nextDoc.parts || []) {
            keepScripts[part.id] = reloaded.scripts[part.id] ?? scripts[part.id] ?? '';
          }
          // Fetch any part scripts the remote assembly lists that we do not have.
          for (const part of nextDoc.parts || []) {
            if (keepScripts[part.id] === '' || keepScripts[part.id] == null) {
              const got = await readVaultPart(gitAdapterRef.current, vault.repo, part.id, branch);
              if (got) keepScripts[part.id] = got.content;
            }
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
    const parts = doc.parts || [];
    const allLocal = parts.length > 0
      && parts.every((p) => {
        const path = partRepoPath(p);
        return !path || String(p.id).startsWith('local:');
      });
    if (allLocal) return undefined; // true first-commit; keep null baseline
    const name = vaultSegment(doc.name) || doc.name;
    if (!name) return undefined;
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
        const opened = await openVaultAssembly(
          gitAdapterRef.current,
          vault.repo,
          openName,
          { branch, headSha: tip, pathIndex: store.pathIndexFor(vault.repo) },
        );
        if (cancelled || gitBaselineRef.current) return;
        for (const hit of opened.identities?.cached || []) {
          if (hit.path && hit.id) await store.rememberPathId(vault.repo, hit.path, hit.id);
        }
        const beforeScripts = partScriptsRef.current || {};
        const aligned = rekeyWorkingCopyToTip(assemblyRef.current, beforeScripts, opened.doc, {
          histories: partHistoriesRef.current,
          meshMeta: partMeshMetaRef.current,
          cadPartId: cadPartIdRef.current,
        });
        let doc = aligned.doc;
        let scriptsNow = aligned.scripts;
        if (aligned.pairs.length) {
          rekeyRuntime(aligned.pairs);
          partMeshMetaRef.current = aligned.meshMeta;
          setPartMeshMeta(aligned.meshMeta);
          rememberScripts(scriptsNow);
          rememberAssembly(doc);
          for (const { from, to } of aligned.pairs) {
            const text = scriptsNow[to];
            if (typeof text === 'string') savePartScript(to, text);
            try { deletePartScript(from); } catch { /* ignore */ }
          }
        }
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
          partHistoriesRef.current = localIds.histories || partHistoriesRef.current;
          if (localIds.selection?.cadPartId && localIds.selection.cadPartId !== cadPartIdRef.current) {
            cadPartIdRef.current = localIds.selection.cadPartId;
          }
        }
        if (migrated.changed || localIds.changed) {
          rememberScripts(scriptsNow);
          for (const [id, text] of Object.entries(scriptsNow)) {
            if (text !== beforeScripts[id] && text !== aligned.scripts[id]) savePartScript(id, text);
          }
          for (const { from } of localIds.pairs) {
            try { deletePartScript(from); } catch { /* ignore */ }
          }
        }
        const reconciled = reconcileSyncedFromTip(doc, opened.scripts);
        if (reconciled.changed || migrated.changed || localIds.changed || aligned.pairs.length) {
          doc = reconciled.doc;
          rememberAssembly(doc);
          for (const part of doc.parts || []) {
            if (part.isSynced !== true) continue;
            const text = partScriptsRef.current[part.id];
            if (typeof text === 'string') savePartScript(part.id, text, { isSynced: true });
          }
        }
        await retireImplicitVaultWriteOps(store, vault.repo, branch);
        if (cancelled || gitBaselineRef.current) return;
        if (!store.getLastSyncedSha(vault.repo, branch) && opened.baseline?.headSha) {
          await store.setLastSyncedSha(vault.repo, opened.baseline.headSha, branch);
        }
        rememberGitBaseline(opened.baseline);
        gitVaultRef.current = { ...vault, headSha: opened.baseline?.headSha };
        void checkGitRemoteBehind({ showToast: true, reason: 'reseed' });
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
  const handleNewAssembly = async () => {
    const seedId = newLocalPartId();
    const starter = DEFAULT_SCRIPT;
    const source = githubConnected ? 'git' : 'local';
    const name = nextAssemblyName(await collectTakenAssemblyNames());
    const seedDoc = serializeAssembly({
      source,
      name,
      activeId: seedId,
      parts: [{
        id: seedId,
        name: DEFAULT_PART_NAME,
        visible: true,
        order: 0,
        ...(source === 'git' ? { isSynced: false } : {}),
      }],
    });
    refreshGenRef.current += 1;
    partMeshMetaRef.current = {};
    setPartMeshMeta({});
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

  const handleAddPart = async (partName, opts = {}) => {
    const doc = assemblyRef.current;
    if (!doc) return;
    const live = codeEditorRef.current?.getContent?.();
    const prev = doc.activeId;
    const scripts = { ...partScriptsRef.current };
    if (prev && !suppressPartSaveRef.current && typeof live === 'string') {
      scripts[prev] = live;
      savePartScript(prev, live);
      stashPartHistory(prev, live);
    }
    let id;
    let name;
    const rawName = String(partName ?? '').trim();
    id = doc.source === 'git' ? mintSurfId() : newLocalPartId();
    const takenNames = (doc.parts || []).map((part) => part.name);
    name = rawName
      ? nextNumberedName(rawName, takenNames, { bareFirst: true })
      : nextNumberedName('Part', takenNames);
    const order = doc.parts.length;
    const rowPosition = newPartRowPosition(order, {
      fromAgent: opts.fromAgent,
      position: opts.position,
    });
    let starter = typeof opts?.script === 'string' && opts.script.trim()
      ? wrapRawScript(opts.script)
      : newPartStarterScript();
    let surfId = null;
    if (doc.source === 'git') {
      surfId = id;
      starter = withSurfId(starter, surfId);
    }
    const part = {
      id,
      name,
      visible: true,
      order,
      ...(rowPosition != null ? { position: rowPosition } : {}),
      ...(surfId ? { surfId, isSynced: false } : {}),
    };
    scripts[id] = starter;
    const nextDoc = { ...doc, activeId: id, parts: [...doc.parts, part] };
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
    setPendingPartIds((prev) => new Set(prev).add(id));
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
    } finally {
      setPendingPartIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDeletePart = (id, opts = {}) => {
    const doc = assemblyRef.current;
    if (!doc || id == null) return;
    const key = String(id);
    const part = doc.parts.find((row) => row.id === key);
    if (!part) return;
    if (opts.fromRepo && doc.source === 'git') {
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
      rememberScripts(nextScripts);
      deletePartScript(key);
      forgetPartAssets(key);
      if (partMeshMetaRef.current[key]) {
        const nextMeta = { ...partMeshMetaRef.current };
        delete nextMeta[key];
        partMeshMetaRef.current = nextMeta;
        setPartMeshMeta(nextMeta);
      }
      dropPartHistory(key);
      delete partLeftoversRef.current[key];
      rememberAssembly(nextDoc);
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
          placement: partPlacement(nextPart),
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
      const picked = scriptForRow(nextDoc, nextScripts, nextActive);
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
    applyDeleteLocal(tentativeDoc, tentativeScripts);
  };

  const handleGameRun = async () => {
    if (appModeRef.current !== 'game') {
      const code = codeEditorRef.current?.getContent?.();
      if (code == null) return;
      setCurrentScript(code);
      await refreshAssemblyRef.current?.(code);
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
      partHistoriesRef.current[w.id] = pushPartHistory(
        historyForPart(partHistoriesRef.current, w.id, prevScript),
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
    const ok = codeEditorRef.current?.insertHelper?.(
      helperId,
      params,
      faceContext,
      edgeContext,
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
    const others = Array.isArray(payload?.otherParts) ? payload.otherParts : [];
    const doc = assemblyRef.current;
    const editorId = doc?.activeId ?? null;
    const buf = codeEditorRef.current?.getContent?.() || '';
    let editorBuffer = null;
    let writes = [];
    const editFeature = payload?.editFeature || null;
    if (editFeature) {
      // Same composer as a new fillet. The block replaces this feature
      // instead of appending a second one onto the solid it already cut.
      const edited = replaceEditedBlend(buf, editFeature, {
        chamfer,
        edges: payload?.edges,
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
        ? composeChamferCommit(buf, payload || {})
        : composeFilletCommit(buf, payload || {});
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
            edges: payload?.edges || [],
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
    const seedId = newLocalPartId();
    const source = githubConnected ? 'git' : 'local';
    const name = nextAssemblyName(await collectTakenAssemblyNames());
    const text = typeof script === 'string' ? script : '';
    const seedDoc = serializeAssembly({
      source,
      name,
      activeId: seedId,
      parts: [{
        id: seedId,
        name: DEFAULT_PART_NAME,
        visible: true,
        order: 0,
        ...(source === 'git' ? { isSynced: false } : {}),
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
   * A fresh part (empty or the 20 mm starter cube) takes the default base
   * flange in place, and a refreshGen bump drops a pending cube auto-run.
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
    const result = composeShellCommit(buf, payload || {});
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
    const result = composeDraftCommit(buf, payload?.state || payload || {});
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
    const result = composeCutCommit(buf, payload?.state || payload || {}, payload?.mesh || null);
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
    const result = composeBooleanCommit(
      buf,
      state,
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
    const result = composeDeleteFaceCommit(buf, payload?.state || payload || {});
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
    const result = composeMoveFaceCommit(buf, payload?.state || payload || {});
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

  const handleCodeGenerated = (code, promptMessage) => {
    // Only add to history if a prompt message if not empty
    const addToHistory = promptMessage && promptMessage.length > 0;
    codeEditorRef.current?.loadContent(code, promptMessage || 'Code generated', addToHistory);
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
    if (appModeRef.current === 'game' || featureSessionRef.current) return;
    jointPicksRef.current = [];
    viewportRef.current?.clearJointHighlights?.();
    publishJointCard(draftFromPicks(null, [], { joints: assemblyRef.current?.joints || [] }));
  };

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
    const mesh = meshForPart(partId);
    if (!mesh?.vertProperties) return;
    viewportRef.current?.swapPickPart?.({
      partId,
      mesh,
      position: partPosition(part) || [0, 0, 0],
      placement: partPlacement(part),
    });
  };

  const handleTitleAssemblyActivate = () => {
    if (featureSessionRef.current || appModeRef.current === 'game') return;
    const doc = assemblyRef.current;
    if (!doc) return;
    const focusId = cadPartIdRef.current ?? doc.activeId ?? null;
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
    if (!part?.surfId) {
      viewportRef.current?.notify?.(raw && part ? 'This part has no surf id' : 'This part has no surf id');
      rememberCadPart(null);
      return;
    }
    if (!raw.key) return;
    const pick = {
      partId: part.id,
      surfId: part.surfId,
      partName: part.name || part.id,
      kind: raw.kind,
      planar: !!raw.planar,
      axis: !!raw.axis,
      key: raw.key,
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
    finishJointWrite(result, scripts, { resetPicks: true });
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

  const finishJointWrite = (result, scripts, { resetPicks = false } = {}) => {
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
    finishJointWrite(result, scripts, { resetPicks: card.mode !== 'edit' });
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
    rememberCadPart(null);
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
    finishJointWrite(result, scripts);
  };

  const handleFaceSelected = (faceData) => {
    setSelectedFace(faceData);
  };

  const handleClearFaceSelection = () => {
    viewportRef.current?.clearFaceSelection();
    setSelectedFace(null);
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

  // Rename one part by id (Parts feed row). The title follows when that part
  // is the one it shows. The name is read by save/export and by the
  // OAuth-redirect snapshot, so nothing else to write.
  const handleRenamePart = async (id, name) => {
    const doc = assemblyRef.current;
    if (!doc) return { status: 'error', code: 'no_assembly', error: 'No assembly loaded' };
    let nextName = sanitizePartName(name);
    if (!nextName) return { status: 'error', code: 'bad_args', error: 'Enter a part name' };
    const part = findAssemblyPart(doc, id);
    if (!part) return { status: 'error', code: 'unknown_part', error: `Unknown part id: ${id}` };
    id = part.id;
    if (part.name === nextName) {
      return { status: 'unchanged', from: id, to: id, name: nextName };
    }
    const otherNames = (doc.parts || []).filter((row) => row.id !== id).map((row) => row.name);
    if (otherNames.includes(nextName)) {
      nextName = nextNumberedName(nextName, otherNames, { bareFirst: true });
    }
    const nextDoc = renamePart(doc, id, nextName);
    if (nextDoc === doc) return { status: 'unchanged', from: id, to: id, name: part.name };
    rememberAssembly(nextDoc);
    if (renameTargetId(nextDoc, cadPartIdRef.current) === id) {
      setCurrentFilename(nextDoc.parts.find((row) => row.id === id)?.name || null);
    }
    return { status: 'renamed', from: id, to: id, name: nextName, git: false };
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
    if (!doc) return;
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
        id = mintSurfId();
      } else {
        id = newLocalPartId();
      }
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
    if (reported && !failure) {
      if (run?.empty) {
        return {
          ok: true, errors: [], volume: null, bbox: null, partName, runFailure: null, bodyCount: 0,
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
          ...(geom.bodyCount === 0 ? { bodyCount: 0 } : {}),
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
    };
    if (reported) result.runFailure = failure || null;
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
      const text = wrapRawScript(typeof src === 'string' ? src : '');
      codeEditorRef.current?.setTextOnly?.(text);
      const id = assemblyRef.current?.activeId;
      if (id) revealPartOnRibbon(id, text);
      else setCurrentScript(text);
    },
    readHistory() {
      const id = appModeRef.current === 'game'
        ? '__game__'
        : (assemblyRef.current?.activeId ? String(assemblyRef.current.activeId) : '__cad__');
      const existing = partHistoriesRef.current[id];
      if (existing && Array.isArray(existing.commits)) return existing;
      return { commits: [], head: -1 };
    },
    writeHistory(history) {
      const id = appModeRef.current === 'game'
        ? '__game__'
        : (assemblyRef.current?.activeId ? String(assemblyRef.current.activeId) : '__cad__');
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
      const epochBefore = runOutcomeEpochRef.current;
      const ran = await refreshAssemblyRef.current?.(text);
      return agentCadRunOutcome(epochBefore, ran);
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
      const content = composeHelperInsert(
        buffer,
        helperId,
        null,
        params,
        faceContext,
        edgeContext,
      );
      if (typeof content !== 'string') {
        return {
          error: {
            code: 'insert_failed',
            message: describeHelperRefusal(item, { params, faceContext, edgeContext }),
          },
        };
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
  const showJoints = !sheetRibbonOpen && jointsChromeMounted({ appMode, featureSession }) && cadStripsShowJoints(cadPartId);
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
  const liveJointChips = showJoints ? jointChips(assemblyDoc, jointLive) : null;
  const sketchOpen = sketchStrip != null;
  const jointCardNode = jointCreateOpen && appMode !== 'game'
    ? (
      <JointCard
        card={jointCard}
        distanceRangeMm={(() => {
          const parts = assemblyDoc?.parts || [];
          let longest = 0;
          let seen = false;
          for (const pick of jointCard?.picks || []) {
            const part = parts.find((row) => row?.surfId && row.surfId === pick?.surfId);
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
  const hasLocalPartIds = gitParts.some((p) => !partRepoPath(p));
  const needsFirstCommitChrome = (
    assemblyDoc?.source === 'git'
    && !gitBaseline
    && hasLocalPartIds
  );
  const dirtyBaseline = gitBaseline || (
    needsFirstCommitChrome
      ? firstCommitBaseline({
        branch: gitVaultRef.current?.defaultBranch || 'main',
        headSha: gitVaultRef.current?.headSha || null,
      })
      : null
  );
  const gitDirtyIds = (
    assemblyDoc?.source === 'git' && dirtyBaseline
  ) ? dirtyPartIds(assemblyDoc, partScripts, dirtyBaseline, {
    liveId: assemblyDoc.activeId,
    liveScript: liveDirtyScript,
  }) : (
    // Awaiting tip reseed: only local: rows; repo paths stay clean until
    // baseline arrives and a real content diff can run.
    assemblyDoc?.source === 'git'
      ? new Set(gitParts.filter((p) => !partRepoPath(p)).map((p) => p.id))
      : new Set()
  );
  const sourceDirty = (
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
      const offerRepo = assemblyDoc.source === 'git' && showAddToRepo(row);
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
      && cadStripsShowJoints(cadPartIdRef.current);
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
    const ran = await refreshAssemblyRef.current?.(scriptText);
    return agentCadRunOutcome(epochBefore, ran);
  };
  fillAgentHost(agentHostRef, {
    cadSelectAll() {
      handleSelectAll();
      return { ok: true };
    },
    readFeatureTree() {
      const doc = assemblyRef.current;
      const script = codeEditorRef.current?.getContent?.() ?? '';
      const key = doc?.activeId ? String(doc.activeId) : '__cad__';
      const rollbackAnchor = Object.prototype.hasOwnProperty.call(rollbackAnchors, key)
        ? rollbackAnchors[key]
        : null;
      return buildFeatureTree({
        script,
        failedIds: sheetFailedIds,
        rollbackAnchor: rollbackAnchor ?? null,
        activeChipId: featureStripActiveId,
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
      return buildDirtyState({
        workspaceDirty: !!sourceDirty,
        partIds: gitDirtyIds,
        assemblyDirty: dirtyBaseline && assemblyDoc
          ? isAssemblyDirty(assemblyDoc, dirtyBaseline)
          : false,
        renamePending: !!dirtyBaseline?.renamePending,
        legacyCleanup: !!dirtyBaseline?.legacyCleanup,
        undoStackDirty,
        editedSinceLoad,
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
      if (!doc) return buildPartsState({});
      return buildPartsState({
        activeId: doc.activeId,
        assemblyName: assemblyName(doc),
        parts: doc.parts.map((row) => ({
          id: row.id,
          name: row.name,
          visible: row.visible,
          ...(partRepoPath(row) ? { path: partRepoPath(row) } : {}),
        })),
      });
    },
    readActivePartSurfId() {
      const doc = assemblyRef.current;
      const part = doc?.parts?.find((row) => row.id === doc?.activeId);
      return part?.surfId || null;
    },
    readActivePartStatus() {
      const doc = assemblyRef.current;
      const id = doc?.activeId != null ? String(doc.activeId) : '';
      const part = id ? doc?.parts?.find((row) => row.id === id) : null;
      const partName = part?.name || '';
      const script = id
        ? (codeEditorRef.current?.getContent?.() ?? partScriptsRef.current[id] ?? '')
        : '';
      const base = {
        partId: id,
        partName,
        script,
        runState: 'not_run_yet',
        volume: null,
        bbox: null,
        featureCount: agentFeatureCount(script),
        bodyCount: null,
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
      const part = findAssemblyPart(doc, partId);
      if (!part) {
        return { error: { code: 'unknown_part', message: `Unknown part id: ${partId}` } };
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
        const part = findAssemblyPart(doc, id);
        if (!part) {
          return { error: { code: 'unknown_part', message: `Unknown part id: ${id}` } };
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
          placement: partPlacement(part),
        });
      }
      viewportRef.current?.showCadBodyHighlight?.();
      return { partIds: resolved };
    },
    async agentCreateAssembly() {
      const before = assemblyRef.current;
      await handleNewAssembly();
      await ensureLocalSurfIds();
      const after = assemblyRef.current;
      if (before && after) recordAgentAssemblyStep(before);
      return {
        result: {
          assemblyName: after?.name ?? '',
          activeId: after?.activeId ?? null,
          partCount: after?.parts?.length ?? 0,
        },
      };
    },
    agentGetPartTransform({ partId }) {
      const doc = assemblyRef.current;
      const part = findAssemblyPart(doc, partId);
      if (!part) {
        return { error: { code: 'unknown_part', message: `Unknown part id: ${partId}` } };
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
      const part = findAssemblyPart(doc, partId);
      if (!part) {
        return { error: { code: 'unknown_part', message: `Unknown part id: ${partId}` } };
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
      const pose = poseFieldsForPart(draft, jointed.has(part.surfId), t);
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
            placement: partPlacement(nextPart),
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
      await handleAddPart(name, { script, deferVault: true, fromAgent: true, position });
      const runScript = scriptRequestsRun(script);
      // handleAddPart schedules a deferred auto-run. A script must finish
      // before this call returns, so drop that timer and run it here.
      if (runScript) refreshGenRef.current += 1;
      await ensureLocalSurfIds();
      const after = assemblyRef.current;
      const created = createdPartFromDocs(before, after);
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
      if (!runScript) return { result: { partId, partCount } };
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
    async agentOpenAssembly({ name }) {
      const before = assemblyRef.current;
      if (!before || before.source !== 'git') {
        return { error: { code: 'git_only', message: 'open_assembly needs a git-backed assembly' } };
      }
      const requested = typeof name === 'string' ? name : '';
      let names = null;
      try {
        const listed = await handleListVaultAssemblies();
        names = Array.isArray(listed) ? listed : null;
      } catch (err) {
        if (err?.message === NO_REPO_YET_COPY || err?.code === 'git_blocked') {
          return { error: { code: 'git_blocked', message: NO_REPO_YET_COPY } };
        }
        names = null;
      }
      let openName = requested;
      if (names) {
        const decision = resolveAssemblyOpenName(requested, names);
        if (decision?.error) return { error: decision.error };
        openName = decision.name;
      }
      const opened = await handleOpenVaultAssembly(openName);
      if (opened?.status === 'error') {
        return { error: assemblyOpenFailure(opened, requested, names) };
      }
      const after = assemblyRef.current;
      if (after && after !== before) recordAgentAssemblyStep(before);
      return { result: { name: after?.name || openName, activeId: after?.activeId ?? null } };
    },
    async agentOpenPart({ path }) {
      const before = assemblyRef.current;
      if (!before || before.source !== 'git') {
        return { error: { code: 'git_only', message: 'open_part needs a git-backed assembly' } };
      }
      const opened = await handleOpenVaultPart(path);
      if (opened?.status === 'error') {
        return { error: { code: opened.code || 'open_failed', message: opened.error || 'Could not open part' } };
      }
      recordAgentAssemblyStep(before);
      return { result: { path: opened.path, mode: opened.mode } };
    },
    async agentInsertAssemblyParts({ sourceName }) {
      const before = assemblyRef.current;
      if (!before || before.source !== 'git') {
        return { error: { code: 'git_only', message: 'insert_part with source_assembly needs git mode' } };
      }
      const inserted = await handleInsertVaultAssemblyParts(sourceName);
      if (inserted?.status === 'error') {
        return { error: { code: inserted.code || 'insert_failed', message: inserted.error || 'Could not insert parts' } };
      }
      if (inserted?.status === 'inserted') recordAgentAssemblyStep(before);
      return { result: inserted };
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
      return handleGitCommit(draft);
    },
    async agentGitAddToRepo({ partId }) {
      if (!partId) return { status: 'error', error: 'part_id required' };
      const part = findAssemblyPart(assemblyRef.current, partId);
      if (!part) {
        return { status: 'error', code: 'unknown_part', error: `Unknown part id: ${partId}` };
      }
      return handleAddToRepo(part.id);
    },
    /** -> { known, writesGit } — writesGit when the rename moves a vault file. */
    readAgentPartRename(partId) {
      const doc = assemblyRef.current;
      const part = findAssemblyPart(doc, partId);
      if (!part) return { known: false, writesGit: false };
      return {
        known: true,
        writesGit: false,
      };
    },
    async agentRenamePart({ partId, name }) {
      const before = assemblyRef.current;
      const part = findAssemblyPart(before, partId);
      if (!part) {
        return { error: { code: 'unknown_part', message: `Unknown part id: ${partId}` } };
      }
      const out = await handleRenamePart(part.id, name);
      if (out?.status === 'error') {
        return { error: { code: out.code || 'rename_failed', message: out.error || 'Could not rename part' } };
      }
      let sync = null;
      if (out?.written) {
        const flushed = await out.written;
        sync = flushed?.status || null;
        if (flushed?.status === 'conflict' || flushed?.status === 'failed') {
          return {
            error: {
              code: 'git_error',
              message: flushed.error || 'The rename is queued but the repo refused it',
              details: { from: out.from, to: out.to, sync },
            },
          };
        }
      }
      if (out?.status === 'renamed') recordAgentAssemblyStep(before);
      const after = assemblyRef.current;
      const afterPart = findAssemblyPart(after, part.id);
      const previousPath = partRepoPath(part);
      const nextPath = out?.path || partRepoPath(afterPart);
      return {
        result: {
          status: out?.status || 'renamed',
          partId: part.id,
          previousId: part.id,
          name: afterPart?.name ?? out?.name ?? null,
          ...(nextPath ? { path: nextPath } : {}),
          moved: !!(nextPath && previousPath && nextPath !== previousPath),
          git: out?.git === true,
          ...(sync ? { sync } : {}),
        },
      };
    },
    async agentGitBehindResolve({ action, path, kind }) {
      const doc = assemblyRef.current;
      if (!doc || doc.source !== 'git') {
        return { status: 'error', error: 'Not in Git mode' };
      }
      let resolvedPath = path;
      let resolvedKind = kind === 'assembly' ? 'assembly' : (kind === 'part' ? 'part' : null);
      if (!resolvedPath) {
        if (behindMarkers.assemblyBehind && gitAssemblyPath) {
          resolvedPath = gitAssemblyPath;
          resolvedKind = 'assembly';
        } else if (behindPartIdSet.size) {
          resolvedPath = behindPartIdSet.values().next().value;
          resolvedKind = 'part';
        }
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
      handleOpenJoints();
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
        if (!part.surfId) {
          return { error: { code: 'no_surf_id', message: `Part has no surf id: ${part.id}` } };
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
      rememberCadPart(null);
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
        return { ok: false, message: result.message || 'Joint commit refused' };
      }
      const unchanged = assemblySnapshotsEqual(doc, result.doc);
      finishJointWrite(result, scripts, { resetPicks: card.mode !== 'edit' });
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
      const outcome = await agentRunOutcome(undone.code);
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
          status: {
            volume: outcome.volume ?? null,
            bbox: outcome.bbox ?? null,
            partName: outcome.partName || '',
            featureCount: agentFeatureCount(undone.code),
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
      const outcome = await agentRunOutcome(redone.code);
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
          status: {
            volume: outcome.volume ?? null,
            bbox: outcome.bbox ?? null,
            partName: outcome.partName || '',
            featureCount: agentFeatureCount(redone.code),
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
          return {
            result: {
              id: resolved.chip.id,
              kind: resolved.chip.kind,
              index: resolved.chip.index,
            },
          };
        }
        agentFeatureSessionRef.current = null;
        agentFeatureTargetRef.current = null;
        return { error: { code: 'edit_failed', message: 'Could not open contour for edit' } };
      }
      openFeatureSheetFor(resolved.feature);
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
      const bag = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
      const prev = agentFeatureDraftRef.current && typeof agentFeatureDraftRef.current === 'object'
        ? agentFeatureDraftRef.current
        : {};
      agentFeatureDraftRef.current = { ...prev, ...bag };
      const holeEdit = viewportRef.current?.agentReadHoleEdit?.();
      if (holeEdit?.open) {
        const patched = viewportRef.current?.agentPatchHoleCard?.(bag);
        if (patched?.error) return patched;
      }
      const vpEdit = viewportRef.current?.agentReadFeatureEdit?.();
      if (vpEdit?.open) {
        const patched = viewportRef.current?.agentPatchFeatureEdit?.(bag);
        if (patched?.error) return patched;
      }
      return { result: { params: agentFeatureDraftRef.current } };
    },
    prepareFeatureConfirm: () => prepareAgentFeatureConfirm(),
    dismissFeatureConfirmSession: () => dismissAgentFeatureSession(),
    cancelFeature() {
      if (!agentFeatureSessionActive()) {
        return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      }
      dismissAgentFeatureSession();
      return { result: { cancelled: true } };
    },
    deleteFeature(args = {}) {
      if (!focusWritePart(null)) {
        return { error: { code: 'no_write_part', message: 'No writable part for feature delete' } };
      }
      const buf = codeEditorRef.current?.getContent?.() ?? '';
      if (args?.id == null && args?.index == null) {
        const vpEdit = viewportRef.current?.agentReadFeatureEdit?.();
        if (vpEdit?.open && vpEdit.feature) {
          const ok = handleDeleteFeatureEdit(vpEdit.feature, {});
          if (!ok) {
            return { error: { code: 'delete_failed', message: 'Could not delete the open feature' } };
          }
          viewportRef.current?.agentDismissFeatureEdit?.();
          agentFeatureDraftRef.current = null;
          return { result: { deletedId: vpEdit.feature.id } };
        }
        const sheet = featureSheetRef.current;
        if (sheet?.mode === 'edit' && sheet.feature) {
          handleFeatureSheetDelete(sheet.feature);
          agentFeatureDraftRef.current = null;
          return { result: { deletedId: sheet.feature.id } };
        }
        return { error: { code: 'bad_args', message: 'delete_feature needs id or index when no edit is open' } };
      }
      const resolved = resolveStripTarget(buf, args);
      if (resolved.error) return resolved;
      handleFeatureSheetDelete(resolved.feature);
      agentFeatureDraftRef.current = null;
      agentFeatureTargetRef.current = null;
      return { result: { deletedId: resolved.chip.id } };
    },
    rollbackTo(args = {}) {
      if (!focusWritePart(null)) {
        return { error: { code: 'no_write_part', message: 'No writable part for rollback' } };
      }
      const key = editorRollbackKey();
      const buf = codeEditorRef.current?.getContent?.() ?? '';
      const current = storedRollback(key);
      const resolved = resolveRollbackTarget(buf, args, current);
      if (resolved.error) return resolved;
      handleEditorRollbackAnchor(resolved.anchor);
      const stored = storedRollback(key);
      const display = stored === undefined ? null : stored;
      return { result: { rollbackAnchor: display } };
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
        defaultScripts: [DEFAULT_SCRIPT, newPartStarterScript()],
        liveId: assemblyDoc.activeId,
        liveScript: liveDirtyScript,
      }) : true}
      onDeletePart={handleDeletePart}
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
      canCommit={assemblyDoc?.source === 'git' && !!sourceDirty && gitSession.phase === 'connected'}
      onGitCommit={handleGitCommit}
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
              onJointPick={handleJointPick}
              jointCard={jointCardNode}
              cadPartSelected={cadPartId != null}
              onRunOutcome={handleRunOutcome}
              rollbackAnchor={appMode === 'game' ? undefined : editorRollbackAnchor}
              getBooleanContext={assemblyPartContext}
              onFeatureSessionChange={handleFeatureSession}
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

    const aiRow = appMode !== 'game' && (
              <div className="hidden" data-ai-prompt-row="hidden">
                <PromptInput
                  onCodeGenerated={handleCodeGenerated}
                  currentCode={codeEditorRef.current?.getContent() || ''}
                  selectedFace={selectedFace}
                  onClearFaceSelection={handleClearFaceSelection}
                  isMobile={isMobile}
                />
              </div>
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
                aria-hidden={!isCadStage}
              >
                {viewportEl}
                {/* Slice Mobile C.2: CAD feature strip HORIZONTAL under top ribbon. */}
                {isCadStage && (
                  <div
                    className="absolute inset-x-0 top-20 z-20 pointer-events-auto flex"
                    data-cad-feature-strip=""
                    data-feature-strip-placement="under-ribbon-horizontal"
                    data-feature-strip-gap="name-2x"
                    data-feature-bar-row="full"
                  >
                    <FeatureStrip
                      orientation="horizontal"
                      script={stripScript}
                      joints={sketchOpen || sheetRibbonOpen ? null : liveJointChips}
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
                      onSelectJoint={sketchOpen || sheetRibbonOpen ? undefined : handleSelectJoint}
                      onSelectEntity={sketchOpen ? onSketchSelect : undefined}
                      onSelectSheet={sketchOpen ? undefined : onSheetSelect}
                      onUndo={sketchOpen ? onSketchUndo : stripUndo}
                      onRedo={sketchOpen ? undefined : stripRedo}
                      canUndo={sketchOpen ? !!sketchStrip.canUndo : stripCanUndo}
                      canRedo={sketchOpen ? false : stripCanRedo}
                      undoLabel={sketchOpen ? 'Undo' : undoLabel}
                      redoLabel={sketchOpen ? 'Redo' : redoLabel}
                    />
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
                {aiRow}
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
                {aiRow}
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
        <div className="relative flex-1 min-w-0">
          {/* Desktop CAD viewer feature bar (horizontal under title) — replaces
              the old vertical seam strip between editor and viewer. */}
          {appMode !== 'game' && (
            <div
              className="absolute inset-x-0 top-14 z-20 pointer-events-auto flex px-2"
              data-desktop-feature-strip=""
              data-cad-feature-strip="desktop"
              data-feature-strip-placement="viewer-under-title-horizontal"
              data-feature-strip-gap="name-2x"
              data-feature-bar-row="full"
            >
              <FeatureStrip
                orientation="horizontal"
                script={stripScript}
                joints={sketchOpen || sheetRibbonOpen ? null : liveJointChips}
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
                onSelectJoint={sketchOpen || sheetRibbonOpen ? undefined : handleSelectJoint}
                onSelectEntity={sketchOpen ? onSketchSelect : undefined}
                onSelectSheet={sketchOpen ? undefined : onSheetSelect}
                onUndo={sketchOpen ? onSketchUndo : stripUndo}
                onRedo={sketchOpen ? undefined : stripRedo}
                canUndo={sketchOpen ? !!sketchStrip.canUndo : stripCanUndo}
                canRedo={sketchOpen ? false : stripCanRedo}
                undoLabel={sketchOpen ? 'Undo' : undoLabel}
                redoLabel={sketchOpen ? 'Redo' : redoLabel}
              />
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
              {/* AI prompt row is HIDDEN, not removed: it stays mounted (and keeps
                  its state and handlers) while we design a tighter integration
                  into the editor itself. Drop the `hidden` to bring it back. */}
              <div className="flex-shrink-0 hidden" data-ai-prompt-row="hidden">
                <PromptInput
                  onCodeGenerated={handleCodeGenerated}
                  currentCode={codeEditorRef.current?.getContent() || ''}
                  selectedFace={selectedFace}
                  onClearFaceSelection={handleClearFaceSelection}
                  isMobile={false}
                />
              </div>
            </ScriptEditorDrawer>
          )}
        </div>

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
