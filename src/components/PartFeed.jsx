import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye, EyeOff, FolderOpen, GripVertical, Loader2, Pencil, Plus, Save, Trash2, Truck, Upload } from 'lucide-react';
import { partCanDeleteFromRepo, partDeleteChoice, partListDeleteAction, partRepoDeleteConfirmCopy, sanitizeAssemblyName, sanitizePartName } from '../utils/assembly.js';
import { partListSubtitles } from '../utils/git/partListSubtitle.js';
import {
  filterVaultOpenIndex, filterVaultPartItems, groupVaultOpenPartRows, vaultOpenAssemblies, vaultOpenPartRows,
} from '../utils/git/gitWorkspace.js';
import { DEFAULT_VAULT_NAME } from '../utils/git/vault.js';
import { layoutPartFeed } from '../utils/partGroups.js';
import PartGroupBlock from './PartGroupBlock';
import { PARTS_TEXT_INPUT_CLASS, PARTS_TEXT_INPUT_STYLE } from '../utils/partsChrome.js';
import OpenAssemblyChoiceDialog from './OpenAssemblyChoiceDialog';
import DeleteAssemblyDialog, { AssemblyOpenList } from './DeleteAssemblyDialog';
import ProfileChip from './ProfileChip';
import VaultPickerDialog from './VaultPickerDialog';
import { useAuthState } from '../hooks/useAuthState';
import { useCartChrome } from '../hooks/useCart';
import { scriptHash } from '../utils/cart.js';
import { localMeshBadgeTitle, showLocalMeshBadge } from '../utils/meshAssets.js';
import {
  PART_PREVIEW_SIZE,
  blitPartPreview,
  blitPartPreviewUrl,
  meshPreviewKey,
  paintEmptyPreview,
  partPreviewKind,
  peekPartPreview,
  takePartPreview,
} from '../utils/partPreview.js';
import { getPartThumbnail, subscribePartThumbs } from '../utils/partThumbnailStore.js';

// Same ribbon and strip buttons as the script editor top bar
// (CodeEditor `data-editor-ribbon` + Toolbar `variant="strip"`).
const STRIP_BTN = 'shrink-0 p-1.5 flex items-center rounded active:opacity-80 hover:bg-chrome-border/60 text-blue-400';
const STRIP_DIVIDER = 'shrink-0 w-px bg-gray-600 mx-0.5 self-stretch my-1';
const STRIP_ICON = 18;


/**
 * Parts feed. Desktop mounts it to the left of the editor. Mobile mounts it
 * as the Parts stage. Each row is a snapshot of that part's solid and a name.
 * A blue bar marks the selected row (red is kept for a failed script). The eye toggles visibility. Delete drops
 * that part. Load lives in this pane.
 */

/**
 * Assembly name in the ribbon. Same commit rules as the CAD title chip:
 * click edits, Enter or blur commits, Escape reverts, empty commits nothing.
 */
function RibbonAssemblyName({
  name,
  branch = null,
  onRename,
  onBranchClick = null,
  behind = false,
  onBehindClick = null,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const branchLabel = typeof branch === 'string' ? branch.trim() : '';

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    if (!onRename) return;
    setDraft(name || '');
    setEditing(true);
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = sanitizeAssemblyName(draft);
    if (next && next !== (name || '')) onRename(next);
  };

  const label = 'max-w-full truncate bg-chrome-surface px-1.5 text-center text-xs font-medium text-chrome-text';
  const editInput = 'max-w-full min-w-[6rem] truncate bg-chrome-surface px-1.5 text-center text-base font-medium text-chrome-text outline-none';
  const behindBadge = behind ? (
    <button
      type="button"
      data-assembly-behind=""
      title="Remote changed this assembly — click for Reload / Keep mine / Check in mine"
      aria-label="Assembly behind remote"
      className="pointer-events-auto ml-1 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-1 ring-amber-200/80"
      onClick={(event) => {
        event.stopPropagation();
        onBehindClick?.();
      }}
    />
  ) : null;

  if (editing) {
    return (
      <span className="pointer-events-auto inline-flex max-w-full min-w-0 items-center" data-assembly-behind-wrap={behind ? 'true' : 'false'}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            e.stopPropagation();
          }}
          className={`${editInput} pointer-events-auto w-full`}
          style={PARTS_TEXT_INPUT_STYLE}
          aria-label="Assembly name"
          data-assembly-name=""
          data-assembly-rename="input"
        />
        {behindBadge}
      </span>
    );
  }

  const nameBtn = onRename ? (
    <button
      type="button"
      onClick={start}
      className={`${label} min-w-0 cursor-text hover:text-white`}
      title="Click to rename this assembly"
      aria-label={`Assembly name: ${name}. Click to rename.`}
      data-assembly-name=""
      data-assembly-rename="button"
    >
      {name}
    </button>
  ) : (
    <span className={`${label} pointer-events-none min-w-0`} data-assembly-name="" title={name}>
      {name}
    </span>
  );

  const branchChip = branchLabel ? (
    <>
      <span className="shrink-0 px-0.5 text-xs text-gray-500" aria-hidden="true">on</span>
      {onBranchClick ? (
        <button
          type="button"
          data-ui-action="data-git-branches"
          data-assembly-branch=""
          data-git-branches=""
          title={`Branch: ${branchLabel}. Click to manage branches.`}
          aria-label={`On branch ${branchLabel}. Open branch list.`}
          className="pointer-events-auto max-w-[40%] truncate rounded px-1 text-xs font-medium text-blue-300 hover:bg-white/10 hover:text-blue-200"
          onClick={(event) => {
            event.stopPropagation();
            onBranchClick();
          }}
        >
          {branchLabel}
        </button>
      ) : (
        <span className="max-w-[40%] truncate px-1 text-xs font-medium text-blue-300/80" data-assembly-branch="">
          {branchLabel}
        </span>
      )}
    </>
  ) : null;

  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center ${onRename || onBranchClick ? 'pointer-events-auto' : 'pointer-events-none'}`}
      data-assembly-behind-wrap={behind ? 'true' : 'false'}
      data-assembly-title-with-branch={branchLabel ? 'true' : 'false'}
    >
      {nameBtn}
      {branchChip}
      {behindBadge}
    </span>
  );
}

function RowPartName({ id, name, onRename, editing, setEditing }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setDraft(name || '');
      inputRef.current?.select();
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = sanitizePartName(draft);
    if (next && next !== (name || '')) onRename?.(id, next);
  };

  const label = 'truncate text-sm font-medium text-chrome-text';
  const editInput = 'w-full truncate rounded border border-blue-400/80 bg-chrome-surface px-1 text-base font-medium text-chrome-text outline-none';
  if (editing) {
    const stop = (event) => event.stopPropagation();
    return (
      <input
        ref={inputRef}
        value={draft}
        draggable={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={stop}
        onDoubleClick={stop}
        onPointerDown={stop}
        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          e.stopPropagation();
        }}
        className={editInput}
        style={PARTS_TEXT_INPUT_STYLE}
        aria-label="Part name"
        data-part-name-input={id}
      />
    );
  }
  return (
    <div
      className={`${label} ${onRename ? 'cursor-text' : ''}`}
      data-part-name={id}
      title={onRename ? 'Double-click to rename this part' : undefined}
      onDoubleClick={onRename ? (event) => { event.stopPropagation(); setEditing(true); } : undefined}
    >
      {name}
    </div>
  );
}

function PartThumbnail({ mesh, partId, script, visible = true }) {
  const ref = useRef(null);
  const meshRef = useRef(mesh);
  meshRef.current = mesh;
  const previewKey = meshPreviewKey(mesh);
  const hash = typeof script === 'string' && script.trim() ? scriptHash(script) : '';
  const [cached, setCached] = useState(null);
  const readRef = useRef(0);
  const live = partPreviewKind(mesh) === 'manifold';
  const showLive = live && (visible !== false || !cached?.url);
  const kind = showLive || cached?.url ? 'manifold' : 'empty';
  const source = showLive ? 'live' : cached?.url ? cached.from : 'empty';

  useEffect(() => {
    if (!partId || !hash) return undefined;
    let cancel = false;
    const ticket = ++readRef.current;
    getPartThumbnail(partId, script).then((url) => {
      if (cancel || ticket !== readRef.current) return;
      setCached(url ? { url, from: 'cache' } : null);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [partId, hash, script]);

  useEffect(() => {
    if (!partId) return undefined;
    return subscribePartThumbs((ev) => {
      if (String(ev.partId) !== String(partId)) return;
      readRef.current += 1;
      if (ev.forgotten) {
        setCached(null);
        return;
      }
      if (!hash || ev.hash !== hash || !ev.url) return;
      setCached({ url: ev.url, from: 'generated' });
    });
  }, [partId, hash]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    if (!showLive) {
      if (cached?.url) {
        let cancel = false;
        blitPartPreviewUrl(canvas, cached.url).then((ok) => {
          if (cancel || !ref.current) return;
          if (!ok) paintEmptyPreview(ref.current);
        });
        return () => { cancel = true; };
      }
      paintEmptyPreview(canvas);
      return undefined;
    }
    if (!previewKey) {
      paintEmptyPreview(canvas);
      return undefined;
    }
    const cachedBitmap = peekPartPreview(previewKey);
    if (cachedBitmap) {
      blitPartPreview(canvas, cachedBitmap);
      return undefined;
    }
    let cancel = false;
    const frame = requestAnimationFrame(() => {
      if (cancel || !ref.current) return;
      try {
        const shot = takePartPreview(meshRef.current);
        if (cancel || !ref.current) return;
        if (shot?.canvas) blitPartPreview(ref.current, shot.canvas);
        else paintEmptyPreview(ref.current);
      } catch (err) {
        console.error('[PartFeed] preview failed', err);
        if (ref.current) paintEmptyPreview(ref.current);
      }
    });
    return () => {
      cancel = true;
      cancelAnimationFrame(frame);
    };
  }, [previewKey, showLive, cached]);

  return (
    <canvas
      ref={ref}
      width={PART_PREVIEW_SIZE}
      height={PART_PREVIEW_SIZE}
      className="h-12 w-12 shrink-0 rounded-md bg-chrome-background"
      data-part-thumbnail=""
      data-part-preview={kind}
      data-part-preview-key={previewKey || ''}
      data-part-thumb-source={source}
    />
  );
}


const PartFeed = forwardRef(function PartFeed({
  placement = 'desktop',
  source = 'local',
  rows = [],
  scripts = {},
  activeId = null,
  onSelect,
  /** Pencil: make this part active if needed, then open its script. */
  onEditScript = null,
  onToggleVisible,
  onReorder,
  onLoadFile,
  onResolveFile,
  onAddPart,
  onNewAssembly = null,
  onFlushLocalAssembly = null,
  assemblyLeaveSafe = true,
  onDeletePart,
  assemblyName = '',
  onRenameAssembly = null,
  onRenamePart = null,
  sourceDirty = false,
  onListVaultAssemblies = null,
  onListVaultBrowse = null,
  onOpenVaultAssembly = null,
  onPreviewDeleteAssembly = null,
  onDeleteAssembly = null,
  onInsertVaultAssemblyParts = null,
  onOpenVaultPart = null,
  onAddExistingPart = null,
  onAddToRepo = null,
  onCopyPartToAssembly = null,
  groups = [],
  onRenameGroup = null,
  onUngroup = null,
  onCopyGroup = null,
  onRemoveGroup = null,
  renameNotice = null,
  onRenameRetry = null,
  onRenameRevert = null,
  syncConflict = null,
  onSyncConflictClear = null,
  onFindInRepo = null,
  suggestNewPartPath = '',
  canCommit = false,
  onGitCommit = null,
  onOverwriteMain = null,
  // G4 pull/conflicts
  behindPartIds = null,
  assemblyBehind = false,
  assemblyPath = '',
  onBehindChoice = null,
  // G5/G11 branch view
  currentBranch = '',
  onListBranches = null,
  onSwitchBranch = null,
  onCreateBranch = null,
  onDeleteBranch = null,
  onMergeBranch = null,
  onSquashMerge = null,
  onBranchUiClose = null,
  // G6 Local → Git
  onMoveToGit = null,
  defaultVaultName = DEFAULT_VAULT_NAME,
  sanitizeVaultName = null,
  // G7 Connect GitHub (sr-only — profile chip is the visible sign-in control)
  githubConnectReady = false,
  githubConnected = false,
  onGitConnect = null,
  onGitDisconnect = null,
  // Same account menu as the CAD ProfileChip. The chip itself is mobile-only.
  isMobile = false,
  onAccount = null,
  onSignedOut = null,
  onClearLocalCadData = null,
  profileVaultName = null,
  onUpload = null,
  onDownload = null,
  isUploading = false,
  isDownloading = false,
}, ref) {
  const gitSession = useAuthState();
  const cartChrome = useCartChrome();
  const openTarget = gitSession.openTarget;
  const uploadRef = useRef(null);
  const meshBadge = (row) => showLocalMeshBadge({
    signedIn: gitSession.signedIn,
    meshLocal: row.meshLocal === true,
    meshSynced: row.meshSynced === true,
  });
  const [renamingId, setRenamingId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [menuGroupId, setMenuGroupId] = useState(null);
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [pendingRemoveGroup, setPendingRemoveGroup] = useState(null);
  const loadRef = useRef(null);
  const resolveRef = useRef(null);
  const resolveIdRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const cancelBtnRef = useRef(null);
  const [openPicker, setOpenPicker] = useState(null); // null | { kind, items, loading, error, draft }
  const [deleteAssembly, setDeleteAssembly] = useState(null);
  // Blocks a second delete before React re-renders `busy`. State alone
  // loses the double tap that lands in the same turn.
  const deleteInFlightRef = useRef(false);
  const pathInputRef = useRef(null);
  // G3 commit flow: null | { stage: 'message'|'busy'|'ask-force'|'done'|'error', ... }
  const [commitFlow, setCommitFlow] = useState(null);
  useEffect(() => {
    if (!syncConflict) return;
    setCommitFlow({
      stage: 'ask-force',
      draft: '',
      result: {
        status: 'branched',
        branch: syncConflict.branch || 'main',
        baseSha: syncConflict.lastSyncedSha || syncConflict.baseSha || '',
        warning: syncConflict.warning || 'The repo moved since the last sync. Nothing was overwritten.',
        syncHold: true,
      },
      error: '',
    });
  }, [syncConflict]);
  const commitInputRef = useRef(null);
  // G4 conflict choice: null | { path, kind: 'part'|'assembly', name, stage, error, result }
  const [conflictFlow, setConflictFlow] = useState(null);
  // Same object the behind toast calls: open the dialog, or run its keep handler.
  const behindApiRef = useRef({
    openBehindConflict() {},
    async keepBehind() {
      return { status: 'error', error: 'Action unavailable' };
    },
  });
  useImperativeHandle(ref, () => behindApiRef.current, []);
  // G5/G11: null | { stage: 'pane'|'create'|'delete-confirm'|'busy'|'confirm'|'error'|'merge-conflict', ... }
  const [branchFlow, setBranchFlow] = useState(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  // Assembly New/Existing leave guard: null | { pending: 'new'|'existing', stage: 'ask'|'busy'|'commit', error }
  const [leaveGuard, setLeaveGuard] = useState(null);
  const plusMenuRef = useRef(null);
  const folderMenuRef = useRef(null);
  const branchCreateInputRef = useRef(null);
  const behindSet = behindPartIds instanceof Set
    ? behindPartIds
    : new Set(behindPartIds || []);

  const onLoadPicked = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      onLoadFile?.(text, file.name);
    } catch (err) {
      console.error('[PartFeed] load failed', err);
    }
  };

  const onResolvePicked = async (event) => {
    const file = event.target.files?.[0];
    const id = resolveIdRef.current;
    event.target.value = '';
    resolveIdRef.current = null;
    if (!file || !id) return;
    try {
      const text = await file.text();
      onResolveFile?.(id, text, file.name);
    } catch (err) {
      console.error('[PartFeed] resolve failed', err);
    }
  };

  const offerResolve = (id) => {
    if (source === 'git' && (onAddToRepo || onFindInRepo)) {
      void (onAddToRepo || onFindInRepo)?.(id);
      return;
    }
    resolveIdRef.current = id;
    resolveRef.current?.click();
  };

  const closePicker = () => setOpenPicker(null);

  /**
   * Open pickers (git): one repo index per open, filtered client-side.
   * 'open-assembly' lists assemblies only; 'open-part' lists every part in
   * the repo grouped by source assembly (+ loose parts/).
   */
  const loadOpenIndex = async (kind) => {
    const blank = { kind, assemblies: [], parts: [], loading: false, error: '', query: '' };
    setOpenPicker({ ...blank, loading: true });
    try {
      let browse = null;
      if (onListVaultBrowse) {
        browse = await onListVaultBrowse();
      } else {
        const names = (await onListVaultAssemblies?.()) || [];
        browse = { assemblies: names.map((name) => ({ kind: 'assembly', name, label: name })), parts: [] };
      }
      const assemblies = kind === 'open-assembly' ? vaultOpenAssemblies(browse) : [];
      const parts = kind === 'open-part' ? (browse?.parts || []) : [];
      const empty = kind === 'open-assembly' ? !assemblies.length : !parts.length;
      setOpenPicker({
        ...blank,
        assemblies,
        parts,
        error: empty ? (kind === 'open-assembly' ? 'No assemblies in the repo yet.' : 'No parts in the repo yet.') : '',
      });
    } catch (err) {
      setOpenPicker({ ...blank, error: err?.message || 'Could not browse repo' });
    }
  };

  const showReconnectOpen = () => {
    setOpenPicker({ kind: 'reconnect', loading: false, error: '', query: '' });
  };

  const startOpenAssembly = async () => {
    // Same phase as the profile chip. Reauth never falls through to the
    // local file input while the chip still says the account is signed in.
    if (openTarget === 'wait') return;
    if (openTarget === 'reconnect') {
      showReconnectOpen();
      return;
    }
    if (openTarget === 'vault') {
      await loadOpenIndex('open-assembly');
      return;
    }
    loadRef.current?.click();
  };

  const startOpenPart = async () => {
    if (openTarget === 'wait') return;
    if (openTarget === 'reconnect') {
      showReconnectOpen();
      return;
    }
    if (openTarget !== 'vault') return;
    await loadOpenIndex('open-part');
  };

  const askDeleteAssembly = async (name) => {
    setDeleteAssembly({
      name,
      loading: true,
      busy: false,
      busyAction: '',
      error: '',
      partCount: 0,
      referenced: [],
      typed: '',
    });
    try {
      const preview = (await onPreviewDeleteAssembly?.(name)) || { partCount: 0, referenced: [] };
      if (preview.status === 'error') {
        setDeleteAssembly((prev) => (prev?.name === name ? {
          ...prev,
          loading: false,
          error: preview.error || 'Could not check this assembly',
        } : prev));
        return;
      }
      setDeleteAssembly((prev) => (prev?.name === name ? {
        ...prev,
        loading: false,
        partCount: preview.partCount || 0,
        referenced: preview.referenced || [],
        error: '',
      } : prev));
    } catch (err) {
      setDeleteAssembly((prev) => (prev?.name === name ? {
        ...prev,
        loading: false,
        error: err?.message || 'Could not check this assembly',
      } : prev));
    }
  };

  const closeDeleteAssembly = () => {
    if (deleteInFlightRef.current) return;
    setDeleteAssembly(null);
  };

  const deleteAssemblyFailed = (result) => (
    result?.status === 'error' || result?.status === 'failed'
  );

  const runDeleteAssembly = async (mode) => {
    if (deleteInFlightRef.current) return;
    const pending = deleteAssembly;
    if (!pending?.name || pending.loading || pending.busy) return;
    if (mode === 'drop' && String(pending.typed || '').trim() !== pending.name) return;
    deleteInFlightRef.current = true;
    setDeleteAssembly({ ...pending, busy: true, busyAction: mode, error: '' });
    try {
      const result = (await onDeleteAssembly?.(pending.name, mode))
        || { status: 'error', error: 'Delete unavailable' };
      if (deleteAssemblyFailed(result)) {
        setDeleteAssembly((prev) => (prev ? {
          ...prev,
          busy: false,
          busyAction: '',
          error: result.error || 'Could not delete assembly',
        } : prev));
        return;
      }
      setDeleteAssembly(null);
      setOpenPicker((prev) => {
        if (!prev || prev.kind !== 'open-assembly') return prev;
        const assemblies = (prev.assemblies || []).filter((item) => item.name !== pending.name);
        return {
          ...prev,
          assemblies,
          error: assemblies.length ? '' : 'No assemblies in the repo yet.',
        };
      });
    } catch (err) {
      setDeleteAssembly((prev) => (prev ? {
        ...prev,
        busy: false,
        busyAction: '',
        error: err?.message || 'Could not delete assembly',
      } : prev));
    } finally {
      deleteInFlightRef.current = false;
    }
  };

  const askOpenAssemblyChoice = (name) => {
    setOpenPicker({
      kind: 'open-choice',
      assemblyName: name,
      loading: false,
      error: '',
    });
  };

  const runOpenAssembly = async (name) => {
    closePicker();
    await onOpenVaultAssembly?.(name);
  };

  const runInsertAssemblyParts = async (name) => {
    setOpenPicker({
      kind: 'open-choice',
      assemblyName: name,
      loading: true,
      error: '',
    });
    const result = (await onInsertVaultAssemblyParts?.(name))
      || { status: 'error', error: 'Insert unavailable' };
    if (result.status === 'inserted') {
      closePicker();
      return;
    }
    setOpenPicker({
      kind: 'open-choice',
      assemblyName: name,
      loading: false,
      error: result.error || 'Could not insert parts',
    });
  };

  const runOpenPart = async (partPath) => {
    closePicker();
    if (onOpenVaultPart) {
      await onOpenVaultPart(partPath);
      return;
    }
    await onAddExistingPart?.(partPath);
  };

  const startNewPart = () => {
    // Name only — app owns folder + .js. The row id has no sync prefix.
    const draft = String(suggestNewPartPath || '')
      .split('/')
      .pop()
      ?.replace(/\.js$/i, '') || '';
    setOpenPicker({
      kind: 'new-part',
      items: [],
      loading: false,
      error: '',
      draft,
    });
  };

  useEffect(() => {
    if (openPicker?.kind === 'new-part') pathInputRef.current?.select();
  }, [openPicker?.kind]);

  const startCommit = () => {
    if (source !== 'git' || !canCommit) return;
    setCommitFlow({ stage: 'message', draft: '', result: null, error: '' });
  };

  const runNewAssembly = () => {
    if (onNewAssembly) {
      onNewAssembly();
      return;
    }
    // Fallback: local blank via add-part path is unavailable — no-op.
  };

  const runExistingAssembly = () => {
    void startOpenAssembly();
  };

  const proceedAssemblyAction = (pending) => {
    setLeaveGuard(null);
    if (pending === 'new') runNewAssembly();
    else if (pending === 'existing') runExistingAssembly();
  };

  /** Assembly New/Existing: Save|Discard when working copy is not blank/default/known-saved. */
  const requestAssemblyAction = (pending) => {
    setPlusMenuOpen(false);
    setFolderMenuOpen(false);
    // Reauth Open is the reconnect dialog. A Save/Discard guard would write
    // or offer to, and the local file picker must stay closed.
    if (openTarget === 'reconnect') {
      showReconnectOpen();
      return;
    }
    if (openTarget === 'wait') return;
    if (assemblyLeaveSafe) {
      proceedAssemblyAction(pending);
      return;
    }
    setLeaveGuard({ pending, stage: 'ask', error: '' });
  };

  const runLeaveDiscard = () => {
    const pending = leaveGuard?.pending;
    if (!pending) return;
    proceedAssemblyAction(pending);
  };

  const runLeaveSave = async () => {
    const pending = leaveGuard?.pending;
    if (!pending) return;
    if (source === 'git') {
      // Commit = Save in vault mode. Reuse the commit message dialog; after
      // success, continue with the pending New/Existing assembly action.
      if (!canCommit) {
        proceedAssemblyAction(pending);
        return;
      }
      setLeaveGuard({ pending, stage: 'commit', error: '' });
      startCommit();
      return;
    }
    setLeaveGuard({ pending, stage: 'busy', error: '' });
    try {
      await onFlushLocalAssembly?.();
      proceedAssemblyAction(pending);
    } catch (err) {
      setLeaveGuard({ pending, stage: 'ask', error: err?.message || 'Could not save' });
    }
  };


  const closeCommit = () => {
    if (commitFlow?.result?.syncHold) onSyncConflictClear?.();
    setCommitFlow(null);
    if (leaveGuard?.stage === 'commit') {
      setLeaveGuard({ pending: leaveGuard.pending, stage: 'ask', error: '' });
    }
  };

  const closeBranches = () => {
    setBranchFlow(null);
    // Git mode: drop any IndexedDB local: rows that leaked into a vault-backed
    // working copy (stale hydrate / source flip). App no-ops when clean.
    onBranchUiClose?.();
  };

  // G13: slim vault create — { stage: 'form'|'busy'|'done'|'error', vaultName, result, error }
  const [moveFlow, setMoveFlow] = useState(null);
  const closeMove = () => setMoveFlow(null);
  const startMoveToGit = () => {
    setMoveFlow({
      stage: 'form', vaultName: defaultVaultName || DEFAULT_VAULT_NAME, result: null, error: '',
    });
  };
  const moveVaultClean = moveFlow
    ? (sanitizeVaultName ? sanitizeVaultName(moveFlow.vaultName) : String(moveFlow.vaultName || '').trim())
    : '';
  const runMoveToGit = async () => {
    if (!moveFlow || !moveVaultClean) return;
    setMoveFlow((prev) => ({ ...prev, stage: 'busy', error: '' }));
    // G13: no Shared checkboxes — seed every part under this assembly (sharedIds: []).
    const result = (await onMoveToGit?.({ vaultName: moveVaultClean, sharedIds: [] }))
      || { status: 'error', error: 'Create unavailable' };
    if (result.status === 'moved') {
      setMoveFlow((prev) => ({ ...(prev || {}), stage: 'done', result, error: '' }));
      return;
    }
    let error = result.error || 'Could not create repo';
    if (result.status === 'invalid-name') error = 'Enter a repo name (letters, digits, . _ -).';
    else if (result.status === 'not-a-vault') {
      error = `${result.repo?.owner || 'You'}/${result.vaultName} already exists and is not a SurfCAD repo. Pick another name.`;
    } else if (result.status === 'conflict') {
      error = result.assemblyExists
        ? 'This assembly already exists in the repo. Rename the assembly, or pick another repo name.'
        : `These repo files already exist with different content: ${result.paths.join(', ')}`;
    } else if (result.status === 'empty') error = 'Add a part before creating a repo.';
    setMoveFlow((prev) => ({ ...(prev || {}), stage: 'form', result, error }));
  };

  /** G13 conflict popup: open the side branch compare URL on GitHub. */
  const openConflictOnGithub = () => {
    const head = commitFlow?.result?.branch;
    if (!head) return;
    onMergeBranch?.({ head, base: 'main' });
  };

  const refreshBranchPane = async (preserveError = '', { ensureBranch = null } = {}) => {
    setBranchFlow((prev) => ({
      stage: 'pane',
      items: prev?.items || [],
      loading: true,
      error: '',
      pending: null,
    }));
    try {
      let items = (await onListBranches?.()) || [];
      // Create just succeeded but a cached / flaky listBranches may omit the
      // new ref — fold it in so the pane shows it without a full reload.
      if (ensureBranch?.name && !items.some((b) => b.name === ensureBranch.name)) {
        items = [
          ...items,
          {
            name: ensureBranch.name,
            sha: ensureBranch.sha || null,
            current: false,
          },
        ].sort((a, b) => {
          if (a.name === 'main') return -1;
          if (b.name === 'main') return 1;
          return a.name.localeCompare(b.name);
        });
      }
      setBranchFlow({
        stage: 'pane',
        items,
        loading: false,
        error: preserveError || (items.length ? '' : 'No branches yet.'),
        pending: null,
      });
    } catch (err) {
      // Still surface the created branch if list failed after create.
      const fallback = ensureBranch?.name
        ? [{ name: ensureBranch.name, sha: ensureBranch.sha || null, current: false }]
        : [];
      setBranchFlow({
        stage: 'pane', items: fallback, loading: false,
        error: err?.message || 'Could not list branches',
        pending: null,
      });
    }
  };

  /** Title branch chip → branch list pane (Switch / Create / Delete / Merge). */
  const openBranchPane = async () => {
    if (source !== 'git') return;
    await refreshBranchPane();
  };

  const startCreateBranch = () => {
    setBranchFlow({
      stage: 'create', draft: '', items: branchFlow?.items || [], loading: false, error: '', pending: null,
    });
  };

  const startMergeFromPane = async () => {
    const current = currentBranch || 'main';
    if (current === 'main') return;
    if (sourceDirty) {
      setBranchFlow((prev) => ({
        ...(prev || { items: [], loading: false }),
        stage: 'error',
        error: 'Save your changes before merging into main.',
        pending: null,
      }));
      return;
    }
    setBranchFlow((prev) => ({
      ...(prev || { items: [] }),
      stage: 'busy',
      error: '',
      pending: current,
    }));
    const result = (await onSquashMerge?.({ head: current, base: 'main' }))
      || { status: 'error', error: 'Merge unavailable' };
    if (result.status === 'merged' || result.status === 'up-to-date') {
      setBranchFlow(null);
      return;
    }
    if (result.status === 'conflict') {
      setBranchFlow({
        stage: 'merge-conflict',
        items: [],
        loading: false,
        error: '',
        pending: current,
        url: result.url || null,
      });
      return;
    }
    setBranchFlow({
      stage: 'error', items: [], loading: false,
      error: result.error || 'Merge failed',
      pending: current,
    });
  };

  const resolveMergeOnGithub = () => {
    const head = branchFlow?.pending || currentBranch;
    const result = onMergeBranch?.({ head, base: 'main' })
      || { status: 'error', error: 'Could not open compare URL' };
    if (result.status === 'opened') {
      setBranchFlow(null);
      return;
    }
    setBranchFlow((prev) => ({
      ...(prev || {}),
      stage: 'error',
      error: result.error || 'Could not open compare URL',
    }));
  };

  const requestSwitchBranch = (name) => {
    if (!name || name === currentBranch) return;
    if (sourceDirty) {
      setBranchFlow((prev) => ({
        ...(prev || { items: [], loading: false, error: '' }),
        stage: 'confirm',
        pending: name,
      }));
      return;
    }
    void runSwitchBranch(name);
  };

  const runSwitchBranch = async (name) => {
    const target = name || branchFlow?.pending;
    if (!target) return;
    setBranchFlow((prev) => ({
      ...(prev || {}),
      stage: 'busy',
      error: '',
      pending: target,
    }));
    const result = (await onSwitchBranch?.(target)) || { status: 'error', error: 'Switch unavailable' };
    if (result.status === 'switched' || result.status === 'same') {
      setBranchFlow(null);
      return;
    }
    setBranchFlow((prev) => ({
      ...(prev || {}),
      stage: 'error',
      error: result.error || 'Switch failed',
      pending: target,
    }));
  };

  const runCreateBranch = async () => {
    const draft = String(branchFlow?.draft || '').trim();
    if (!draft) {
      setBranchFlow((prev) => ({ ...(prev || {}), error: 'Enter a branch name' }));
      return;
    }
    const priorItems = Array.isArray(branchFlow?.items) ? branchFlow.items : [];
    // Optimistic: show the new branch row immediately with a spinner.
    const optimisticItems = [
      ...priorItems.filter((b) => b.name !== draft),
      { name: draft, sha: null, current: false, pending: true },
    ].sort((a, b) => {
      if (a.name === 'main') return -1;
      if (b.name === 'main') return 1;
      return a.name.localeCompare(b.name);
    });
    setBranchFlow({
      stage: 'pane',
      items: optimisticItems,
      loading: false,
      error: '',
      pending: null,
      draft: '',
    });
    const result = (await onCreateBranch?.(draft)) || { status: 'error', error: 'Create unavailable' };
    if (result.status === 'created') {
      await refreshBranchPane('', {
        ensureBranch: { name: result.branch || draft, sha: result.sha || null },
      });
      return;
    }
    // Failure: drop the ghost row and return to the create form.
    setBranchFlow({
      stage: 'create',
      draft,
      items: priorItems,
      loading: false,
      error: result.error || 'Create failed',
      pending: null,
    });
  };

  const requestDeleteBranch = (name) => {
    if (!name || name === 'main' || name === currentBranch) return;
    setBranchFlow((prev) => ({
      ...(prev || { items: [], loading: false, error: '' }),
      stage: 'delete-confirm',
      pending: name,
    }));
  };

  const runDeleteBranch = async (name) => {
    const target = name || branchFlow?.pending;
    if (!target) return;
    setBranchFlow((prev) => ({
      ...(prev || {}),
      stage: 'busy',
      error: '',
      pending: target,
    }));
    const result = (await onDeleteBranch?.(target)) || { status: 'error', error: 'Delete unavailable' };
    if (result.status === 'deleted') {
      await refreshBranchPane();
      return;
    }
    setBranchFlow({
      stage: 'error', items: [], loading: false,
      error: result.error || 'Delete failed', pending: target,
    });
  };

  useEffect(() => {
    if (branchFlow?.stage === 'create') branchCreateInputRef.current?.focus();
  }, [branchFlow?.stage]);

  useEffect(() => {
    if (!plusMenuOpen && !folderMenuOpen) return undefined;
    const onDoc = (event) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target)) {
        setPlusMenuOpen(false);
      }
      if (folderMenuRef.current && !folderMenuRef.current.contains(event.target)) {
        setFolderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [plusMenuOpen, folderMenuOpen]);

    const runCommit = async () => {
    const draft = commitFlow?.draft || '';
    setCommitFlow({ stage: 'busy', draft, result: null, error: '' });
    const result = (await onGitCommit?.(draft)) || { status: 'error', error: 'Commit unavailable' };
    if (result.status === 'repo-moved') {
      setCommitFlow(null);
      if (leaveGuard?.stage === 'commit') {
        setLeaveGuard((prev) => (prev ? { ...prev, stage: 'ask' } : prev));
      }
      return;
    }
    if (result.status === 'branched' || result.status === 'conflict' || result.syncHold) {
      setCommitFlow({
        stage: 'ask-force',
        draft,
        result: {
          ...result,
          status: 'branched',
          syncHold: true,
          warning: result.warning || 'The repo moved since the last sync. Nothing was overwritten.',
        },
        error: '',
      });
      // Conflict popup first; leave guard waits until stay resolves.
    } else if (result.status === 'error') {
      setCommitFlow({ stage: 'error', draft, result, error: result.error || 'Commit failed' });
      if (leaveGuard?.stage === 'commit') {
        setLeaveGuard({
          ...leaveGuard,
          stage: 'ask',
          error: result.error || 'Commit failed',
          code: result.code || null,
          stray: result.stray || null,
        });
      }
    } else {
      setCommitFlow({ stage: 'done', draft, result, error: '' });
      if (leaveGuard?.stage === 'commit' && leaveGuard.pending) {
        const pending = leaveGuard.pending;
        setLeaveGuard(null);
        // Defer so commit dialog can close before New/Existing opens.
        queueMicrotask(() => proceedAssemblyAction(pending));
      }
    }
  };

  const runForceMerge = async () => {
    if (commitFlow?.stage === 'busy') return;
    const draft = commitFlow?.draft || '';
    const prior = commitFlow?.result || null;
    setCommitFlow({ stage: 'busy', draft, result: prior, error: '' });
    const result = (await onOverwriteMain?.()) || { status: 'error', error: 'Overwrite unavailable' };
    const wrote = result.status === 'synced'
      || result.status === 'committed'
      || result.status === 'idle'
      || result.status === 'clean';
    if (wrote) {
      onSyncConflictClear?.();
      setCommitFlow(null);
      if (leaveGuard?.stage === 'commit' && leaveGuard.pending) {
        const pending = leaveGuard.pending;
        setLeaveGuard(null);
        queueMicrotask(() => proceedAssemblyAction(pending));
      }
      return;
    }
    setCommitFlow({
      stage: 'error',
      draft,
      result: prior,
      error: result.error || 'Overwrite failed',
    });
  };

  /** Save/commit refused for parts without a vault path — reuse Add to Repo. */
  const runAddStrayToRepo = async (strayParts, { fromLeave = false } = {}) => {
    const list = Array.isArray(strayParts) ? strayParts.filter((p) => p?.id) : [];
    if (!list.length || !onAddToRepo) return;
    if (fromLeave) {
      setCommitFlow(null);
      setLeaveGuard((prev) => (prev ? { ...prev, stage: 'busy', error: '' } : prev));
    } else {
      setCommitFlow((prev) => (prev
        ? { ...prev, stage: 'busy', error: '', result: prev.result }
        : prev));
    }
    let last = null;
    for (const part of list) {
      last = (await onAddToRepo(part.id)) || { status: 'error', error: 'Add to Repo failed' };
      if (last.status === 'error') {
        const error = last.error || 'Add to Repo failed';
        if (fromLeave) {
          setLeaveGuard((prev) => (prev
            ? { ...prev, stage: 'ask', error, code: 'no_repo_path', stray: list }
            : prev));
          setCommitFlow(null);
        } else {
          setCommitFlow((prev) => (prev
            ? { ...prev, stage: 'error', error, result: { ...(prev.result || {}), code: 'no_repo_path', stray: list } }
            : prev));
        }
        return;
      }
    }
    const names = list.map((p) => p.name || p.id).join(', ');
    const done = {
      status: 'committed',
      files: list.map((p) => p.id),
      addedNames: names,
    };
    // Clear any leave-guard dead-end; keep pending New/Existing if present.
    setLeaveGuard((prev) => {
      if (!prev) return prev;
      if (fromLeave || prev.code === 'no_repo_path') {
        return { pending: prev.pending, stage: 'ask', error: '', code: null, stray: null };
      }
      return prev;
    });
    setCommitFlow({ stage: 'done', draft: '', result: done, error: '' });
  };

  const openConflict = (path, kind, name) => {
    if (source !== 'git' || !path) return;
    setConflictFlow({ path, kind, name: name || path, stage: 'choose', error: '', result: null });
  };

  const closeConflict = () => setConflictFlow(null);

  // Popup buttons and the behind toast share this call.
  const dispatchBehind = async (action, path, kind) => (
    (await onBehindChoice?.({
      action,
      path,
      kind,
    })) || { status: 'error', error: 'Action unavailable' }
  );

  const runConflict = async (action) => {
    if (!conflictFlow) return;
    setConflictFlow({ ...conflictFlow, stage: 'busy', error: '' });
    const result = await dispatchBehind(action, conflictFlow.path, conflictFlow.kind);
    if (result.status === 'error') {
      setConflictFlow({ ...conflictFlow, stage: 'error', error: result.error || 'Failed', result });
    } else {
      setConflictFlow({ ...conflictFlow, stage: 'done', result, error: '' });
    }
  };

  behindApiRef.current.openBehindConflict = (path, kind, name) => {
    openConflict(path, kind, name);
  };
  behindApiRef.current.keepBehind = (path, kind) => dispatchBehind('keep', path, kind);

  useEffect(() => {
    if (commitFlow?.stage === 'message') commitInputRef.current?.focus();
  }, [commitFlow?.stage]);
  const shell = placement === 'mobile'
    ? 'flex h-full w-full flex-col bg-chrome-background text-chrome-text'
    : 'flex h-full w-72 shrink-0 flex-col border-r border-white/10 bg-chrome-background text-chrome-text';
  const ribbonName = typeof assemblyName === 'string' ? assemblyName.trim() : '';

  useEffect(() => {
    if (pendingDelete) cancelBtnRef.current?.focus();
  }, [pendingDelete]);

  const askDeletePart = (partId, name) => {
    setPendingDelete({ id: partId, name: name || 'this part', step: 'choose' });
  };

  const cancelDeletePart = () => {
    if (partListDeleteAction('cancel') !== 'keep') return;
    setPendingDelete(null);
  };

  const confirmDeletePart = (choice = 'assembly') => {
    const pending = pendingDelete;
    if (!pending?.id) return;
    if (choice === 'repo' && !partCanDeleteFromRepo(source, pending.id)) return;
    const next = partDeleteChoice(pending.step, choice);
    if (next.step === 'confirm-repo') {
      setPendingDelete({ ...pending, step: 'confirm-repo' });
      return;
    }
    setPendingDelete(null);
    if ((next.action !== 'drop' && next.action !== 'drop-repo')) return;
    onDeletePart?.(pending.id, { fromRepo: next.action === 'drop-repo' });
  };

  const subtitles = partListSubtitles(rows);

  const renderPartRow = (row, index) => {
          const selected = row.id === activeId;
          const status = row.error ? 'error' : row.missing ? 'missing' : 'ok';
          const subtitle = subtitles.get(row.id) || '';
          return (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              data-part-row={row.id}
              data-part-selected={selected ? 'true' : 'false'}
              data-part-status={status}
              data-part-dirty={row.dirty ? 'true' : 'false'}
              data-part-sync={row.syncFailed ? 'failed' : row.pending ? 'sending' : row.dirty ? 'dirty' : 'clean'}
              data-part-behind={behindSet.has(row.id) ? 'true' : 'false'}
              draggable={renamingId !== row.id}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', String(index));
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('text/plain'));
                if (Number.isInteger(from) && from !== index) onReorder?.(from, index);
              }}
              onClick={() => onSelect?.(row.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(row.id);
                }
                if (event.key === 'F2' && onRenamePart) {
                  event.preventDefault();
                  setRenamingId(row.id);
                }
              }}
              className={`relative flex w-full cursor-pointer items-center gap-2 border-b border-white/5 px-2 py-2 text-left ${
                row.error ? 'bg-red-950/55 ring-1 ring-inset ring-red-500/80' : ''
              } ${selected && !row.error ? 'bg-blue-950/50' : ''} ${
                !selected && !row.error ? 'hover:bg-white/5' : ''
              }`}
            >
              {selected && (
                <span
                  data-part-selected-bar=""
                  className="absolute bottom-1 left-0 top-1 w-1 rounded-full bg-blue-500"
                />
              )}
              <GripVertical
                size={14}
                className="shrink-0 text-gray-500"
                data-part-drag=""
                aria-hidden="true"
              />
              <PartThumbnail
                mesh={row.mesh}
                partId={row.id}
                script={scripts?.[row.id]}
                visible={row.visible !== false}
              />
              <div className="min-w-0 flex-1">
                <RowPartName
                  id={row.id}
                  name={row.name}
                  onRename={onRenamePart}
                  editing={renamingId === row.id}
                  setEditing={(on) => setRenamingId(on ? row.id : null)}
                />
                {meshBadge(row) ? (
                  <span
                    data-part-mesh-local=""
                    data-part-mesh-vault={gitSession.githubConnected ? 'connected' : 'offline'}
                    title={localMeshBadgeTitle(gitSession.githubConnected)}
                    className="mt-0.5 inline-flex rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] font-medium text-amber-200"
                  >
                    local only
                  </span>
                ) : null}
                {(subtitle || behindSet.has(row.id)) ? (
                <div className="flex items-center gap-1 truncate text-[10px] text-gray-500">
                  {subtitle ? (
                    <span className="truncate" data-part-subtitle="">{subtitle}</span>
                  ) : null}
                  {behindSet.has(row.id) ? (
                    <button
                      type="button"
                      data-part-behind=""
                      title="Remote changed this part — click for Reload / Keep mine / Check in mine"
                      aria-label="Part behind remote"
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-1 ring-amber-200/80"
                      onClick={(event) => {
                        event.stopPropagation();
                        openConflict(row.id, 'part', row.name);
                      }}
                    />
                  ) : null}
                </div>
                ) : null}
                {row.external ? (
                  <div className="mt-1" data-part-external="">
                    <p className="text-[10px] font-medium text-amber-300">Caution: external part!</p>
                    {onCopyPartToAssembly ? (
                      <button
                        type="button"
                        data-part-copy-to-assembly=""
                        className="mt-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-amber-100 hover:bg-white/15"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCopyPartToAssembly(row.id);
                        }}
                      >
                        Copy to this assembly
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {(row.action === 'add-to-repo' || row.action === 'find-in-repo' || row.action === 'upload') && (
                  <button
                    type="button"
                    data-part-missing={row.action || 'add-to-repo'}
                    data-part-add-to-repo={row.action === 'add-to-repo' || row.action === 'find-in-repo' ? '' : undefined}
                    className="mt-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-sky-200 hover:bg-white/15"
                    onClick={(event) => {
                      event.stopPropagation();
                      offerResolve(row.id);
                    }}
                  >
                    {row.action === 'add-to-repo' || row.action === 'find-in-repo' ? 'Add to Repo' : 'Upload'}
                  </button>
                )}
                {row.error && (
                  <div className="mt-0.5 text-[10px] font-medium text-red-300" data-part-error="">
                    Script failed
                  </div>
                )}
              </div>
              {source === 'git' ? (
                row.syncFailed ? (
                  <span
                    data-part-sync-failed={row.id}
                    data-part-save={row.id}
                    title="Sync failed"
                    aria-label="Sync failed"
                    className="relative shrink-0 rounded-full p-1.5 text-red-400"
                  >
                    <Save size={16} />
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                ) : row.pending ? (
                  <span
                    data-part-pending={row.id}
                    data-part-save={row.id}
                    aria-label="Creating…"
                    title="Creating…"
                    className="relative shrink-0 rounded-full p-1.5 text-sky-300"
                  >
                    <Loader2 size={16} className="animate-spin" data-part-pending-spinner="" />
                  </span>
                ) : (
                  <button
                    type="button"
                    data-part-save={row.id}
                    data-part-dirty={row.dirty ? 'true' : 'false'}
                    aria-label={row.dirty ? 'Save part to repo' : 'Part in sync'}
                    title={row.dirty ? 'Save part to repo' : 'In sync with repo'}
                    disabled={!row.dirty || !onAddToRepo}
                    className="relative shrink-0 rounded-full p-1.5 text-gray-300 hover:bg-white/10 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                    onPointerDown={(event) => event.stopPropagation()}
                    onDragStart={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!row.dirty || !onAddToRepo) return;
                      void onAddToRepo(row.id);
                    }}
                  >
                    <Save size={16} />
                    {row.dirty ? (
                      <span
                        data-part-dirty=""
                        title="Unsaved / not on repo"
                        className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                      />
                    ) : null}
                  </button>
                )
              ) : null}
              <span
                className="shrink-0"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  data-part-order={row.id}
                  aria-label={`Order ${row.name || 'part'}`}
                  title={row.missing || row.error ? 'This part cannot be ordered' : 'Order'}
                  disabled={!!(row.missing || row.error)}
                  className="rounded-full p-1.5 text-green-400 hover:bg-white/10 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (row.missing || row.error) return;
                    cartChrome?.orderPart?.(row.id);
                  }}
                >
                  <Truck size={16} />
                </button>
              </span>
              <button
                type="button"
                data-part-edit-script={row.id}
                aria-label={`Edit script for ${row.name || 'part'}`}
                title="Edit script"
                className="shrink-0 rounded-full p-1.5 text-blue-400 hover:bg-white/10"
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onEditScript?.(row.id);
                }}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                data-part-visibility={row.id}
                aria-pressed={row.visible}
                aria-label={row.visible ? 'Hide part' : 'Show part'}
                className="shrink-0 rounded-full p-1.5 text-gray-300 hover:bg-white/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisible?.(row.id);
                }}
              >
                {row.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                type="button"
                data-part-delete={row.id}
                aria-label="Delete part"
                title="Delete part"
                className="shrink-0 rounded-full p-1.5 text-chrome-secondary hover:bg-white/10 hover:text-red-300"
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  askDeletePart(row.id, row.name);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
  };

  return (
    <aside className={shell} data-parts-feed="" data-parts-source={source} data-parts-open-target={openTarget}>
      <div
        data-ribbon-bg="editor"
        data-parts-feed-ribbon=""
        className="relative z-30 flex w-full items-center border-b border-chrome-border/60 bg-chrome-surface px-1 py-0.5 shrink-0"
      >
        <div className="relative z-10 flex shrink-0 items-center gap-0.5 sm:gap-1" data-parts-feed-toolbar="">
          <div className="relative" ref={folderMenuRef} data-part-open-menu="">
            <button
              type="button"
              className={STRIP_BTN}
              data-assembly-load=""
              title={source === 'git' ? 'Open part or assembly' : 'Part or assembly'}
              aria-label={source === 'git' ? 'Open part or assembly' : 'Part or assembly'}
              aria-expanded={folderMenuOpen ? 'true' : 'false'}
              aria-haspopup="menu"
              onClick={() => {
                setPlusMenuOpen(false);
                setFolderMenuOpen((open) => !open);
              }}
            >
              <FolderOpen size={STRIP_ICON} />
            </button>
            {folderMenuOpen && (
              <div
                data-part-open-dropdown=""
                role="menu"
                className="absolute left-0 top-full z-50 mt-1 min-w-[8.5rem] rounded-md border border-gray-600 bg-chrome-surface py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-part-open-action="part"
                  data-ui-action="data-part-open-action-part"
                  data-git-open-part-action={source === 'git' ? '' : undefined}
                  data-part-open-local={source === 'git' ? undefined : 'part'}
                  className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
                  onClick={() => {
                    setFolderMenuOpen(false);
                    // Vault when GitHub is connected. Reauth asks to reconnect
                    // instead of the local name dialog. Signed out stays local.
                    if (openTarget === 'reconnect') showReconnectOpen();
                    else if (openTarget === 'vault') void startOpenPart();
                    else if (openTarget !== 'wait') startNewPart();
                  }}
                >
                  Part
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-part-open-action="assembly"
                  data-ui-action="data-part-open-action-assembly"
                  data-assembly-add-existing=""
                  className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
                  onClick={() => requestAssemblyAction('existing')}
                >
                  Assembly
                </button>
              </div>
            )}
          </div>
          <div className="relative" ref={plusMenuRef} data-part-add-menu="">
            <button
              type="button"
              className={STRIP_BTN}
              data-part-add=""
              title="New part or assembly"
              aria-label="New part or assembly"
              aria-expanded={plusMenuOpen ? 'true' : 'false'}
              aria-haspopup="menu"
              onClick={() => {
                setFolderMenuOpen(false);
                setPlusMenuOpen((open) => !open);
              }}
            >
              <Plus size={STRIP_ICON} />
            </button>
            {plusMenuOpen && (
              <div
                data-part-add-dropdown=""
                role="menu"
                className="absolute left-0 top-full z-50 mt-1 min-w-[8.5rem] rounded-md border border-gray-600 bg-chrome-surface py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-part-add-action="part"
                  data-part-add-kind="part"
                  data-ui-action="data-part-add-kind-part"
                  className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    startNewPart();
                  }}
                >
                  Part
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-part-add-action="assembly"
                  data-part-add-kind="assembly"
                  data-ui-action="data-part-add-kind-assembly"
                  className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
                  onClick={() => requestAssemblyAction('new')}
                >
                  Assembly
                </button>
              </div>
            )}
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept=".stl,.obj,.3mf,.step,.stp"
            className="hidden"
            data-part-upload-input=""
            data-script-upload-input=""
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onUpload?.(file);
            }}
          />
          <button
            type="button"
            className={`${STRIP_BTN} disabled:opacity-50`}
            data-part-upload=""
            data-script-upload=""
            title="Upload model (STL, OBJ, 3MF, STEP)"
            aria-label="Upload model"
            disabled={isUploading}
            onClick={() => uploadRef.current?.click()}
          >
            {isUploading ? (
              <Loader2 size={STRIP_ICON} className="animate-spin" />
            ) : (
              <Upload size={STRIP_ICON} />
            )}
          </button>
          <button
            type="button"
            className={`${STRIP_BTN} disabled:opacity-50`}
            data-part-download=""
            data-script-download=""
            title="Download the selected part as 3MF"
            aria-label="Download part"
            disabled={isDownloading}
            onClick={() => onDownload?.()}
          >
            {isDownloading ? (
              <Loader2 size={STRIP_ICON} className="animate-spin" />
            ) : (
              <Download size={STRIP_ICON} />
            )}
          </button>
        </div>
        <div
          className="relative z-10 flex min-w-0 flex-1 items-center justify-center px-1"
          data-parts-ribbon-center=""
        >
          {ribbonName ? (
            <RibbonAssemblyName
              name={ribbonName}
              branch={source === 'git' ? (currentBranch || 'main') : null}
              onRename={onRenameAssembly}
              onBranchClick={source === 'git' ? () => { void openBranchPane(); } : null}
              behind={!!assemblyBehind}
              onBehindClick={() => openConflict(assemblyPath || '', 'assembly', ribbonName)}
            />
          ) : null}
        </div>
        <div
          data-parts-ribbon-end=""
          className="relative z-10 flex shrink-0 items-center"
        >
          {source === 'git' && (
            <button
              type="button"
              className={`relative ${STRIP_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
              data-ui-action="data-git-save"
              data-git-commit=""
              data-git-save=""
              data-git-dirty={sourceDirty ? 'true' : 'false'}
              disabled={!canCommit}
              title={canCommit ? `Save (commit) to ${currentBranch || 'main'}` : 'Nothing to save'}
              aria-label="Save"
              onClick={startCommit}
            >
              <Save size={STRIP_ICON} />
              {sourceDirty ? (
                <span
                  data-git-dirty-badge=""
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                  title="Uncommitted changes"
                />
              ) : null}
            </button>
          )}
          <div className={STRIP_DIVIDER} />
          {/* G6 Move-to-Git kept available off-strip (not a mode toggle). */}
          <button
            type="button"
            className="sr-only"
            data-ui-action="data-git-move-open"
            data-git-move-open=""
            tabIndex={-1}
            aria-hidden="true"
            onClick={startMoveToGit}
          >
            Create repo
          </button>
          {/* Vault Connect kept off-strip: Sign in with GitHub (profile) is the
              visible path; this stays for tests / token reconnect without a second icon. */}
          <button
            type="button"
            className="sr-only"
            data-git-connect=""
            data-git-adapter={githubConnected ? 'real' : 'mock'}
            data-git-connected={githubConnected ? 'true' : 'false'}
            tabIndex={-1}
            aria-hidden="true"
            disabled={!githubConnected && !githubConnectReady}
            onClick={() => {
              if (githubConnected) onGitDisconnect?.();
              else if (githubConnectReady) onGitConnect?.();
            }}
          >
            {githubConnected ? 'Disconnect GitHub' : 'Connect GitHub'}
          </button>
          {/* Mobile only. Desktop uses the CAD viewer profile chip. */}
          {isMobile && (
            <div data-parts-profile-chip="" className="flex shrink-0 items-center pl-0.5">
              <ProfileChip variant="inline" onAccount={onAccount} onSignedOut={onSignedOut} onClearLocalCadData={onClearLocalCadData} vaultName={profileVaultName} />
            </div>
          )}
        </div>

        <input
          ref={loadRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-assembly-file=""
          onChange={onLoadPicked}
        />
        <input
          ref={resolveRef}
          type="file"
          accept=".js,.txt"
          className="hidden"
          data-part-file=""
          onChange={onResolvePicked}
        />
      </div>
      {renameNotice ? (
        <div
          data-rename-toast=""
          role="alert"
          className="mx-2 mt-2 rounded-md border border-red-400/70 bg-red-950/80 px-2 py-2 text-xs text-red-50"
        >
          <p data-rename-toast-message="">{renameNotice.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-rename-retry=""
              className="rounded-md bg-white/15 px-2 py-1 text-[11px] font-semibold hover:bg-white/25"
              onClick={() => onRenameRetry?.(renameNotice)}
            >Retry</button>
            <button
              type="button"
              data-rename-revert=""
              className="rounded-md bg-white/15 px-2 py-1 text-[11px] font-semibold hover:bg-white/25"
              onClick={() => onRenameRevert?.(renameNotice)}
            >Revert</button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-16" data-parts-rows="">
        {layoutPartFeed(rows, groups).map((item) => {
          if (item.kind === 'group') {
            const gid = item.group.id;
            const open = collapsedGroups[gid] !== true;
            return (
              <PartGroupBlock
                key={gid}
                group={item.group}
                open={open}
                count={item.parts.length}
                menuOpen={menuGroupId === gid}
                editing={renamingGroupId === gid}
                onToggle={() => setCollapsedGroups((prev) => ({ ...prev, [gid]: !prev[gid] }))}
                onOpenMenu={() => { setMenuGroupId(gid); }}
                onCloseMenu={() => setMenuGroupId((cur) => (cur === gid ? null : cur))}
                onStartRename={() => { setRenamingGroupId(gid); setMenuGroupId(null); }}
                onRename={(groupId, next) => {
                  setRenamingGroupId(null);
                  if (next && next !== item.group.name) onRenameGroup?.(groupId, next);
                }}
                onAction={(action) => {
                  setMenuGroupId(null);
                  if (action === 'rename') {
                    setRenamingGroupId(gid);
                    return;
                  }
                  if (action === 'ungroup') onUngroup?.(gid);
                  else if (action === 'copy-all') onCopyGroup?.(gid);
                  else if (action === 'remove') setPendingRemoveGroup({ id: gid, name: item.group.name });
                }}
              >
                {item.parts.map(({ row, index }) => renderPartRow(row, index))}
              </PartGroupBlock>
            );
          }
          return renderPartRow(item.row, item.index);
        })}
              </div>

      {openPicker && typeof document !== 'undefined' && openPicker.kind === 'reconnect' && (
        <VaultPickerDialog
          title="Reconnect GitHub"
          labelledBy="git-reconnect-title"
          dataAttr="reconnect"
          onClose={closePicker}
          footer={(
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closePicker} data-git-dialog-cancel="">
                Cancel
              </button>
              <button
                type="button"
                data-open-reconnect=""
                className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-gray-950 disabled:opacity-60"
                disabled={gitSession.reconnecting}
                onClick={() => {
                  if (gitSession.offerReconnect) gitSession.reconnectInteractive();
                  else void gitSession.reconnect();
                }}
              >
                {gitSession.reconnecting ? 'Reconnecting…' : 'Reconnect'}
              </button>
            </div>
          )}
        >
          <p className="text-xs text-gray-300" data-open-reconnect-copy="">
            Open uses your GitHub repo. Reconnect to browse it. Local files stay closed while this account is signed in.
          </p>
        </VaultPickerDialog>
      )}

      {openPicker && typeof document !== 'undefined' && (openPicker.kind === 'open-assembly' || openPicker.kind === 'open-part') && (
        <VaultPickerDialog
          title={openPicker.kind === 'open-part' ? 'Open part' : 'Open assembly'}
          labelledBy="git-open-title"
          dataAttr={openPicker.kind}
          onClose={closePicker}
          footer={(
            <div className="mt-4 flex justify-end">
              <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closePicker} data-git-dialog-cancel="">
                Cancel
              </button>
            </div>
          )}
        >
          {(() => {
            const isPart = openPicker.kind === 'open-part';
            const openQuery = String(openPicker.query || '').trim();
            const asmHits = isPart ? [] : filterVaultOpenIndex({ assemblies: openPicker.assemblies, parts: [] }, openPicker.query).assemblies;
            const partRows = isPart
              ? vaultOpenPartRows(openPicker.parts, { currentAssembly: assemblyName, inDoc: rows.map((row) => row.id) })
              : [];
            // filterVaultOpenIndex (PR #224) filters this list; filterVaultPartItems
            // is the same haystack on a bare part array (source / "loose" included).
            const partHits = isPart
              ? filterVaultPartItems(
                filterVaultOpenIndex({ assemblies: [], parts: partRows }, openPicker.query).parts,
                openPicker.query,
              )
              : [];
            const partGroups = isPart
              ? groupVaultOpenPartRows(partHits, { currentAssembly: assemblyName })
              : [];
            const hitCount = isPart ? partGroups.reduce((n, g) => n + g.parts.length, 0) : asmHits.length;
            const openEmptyFilter = !openPicker.loading && !openPicker.error && openQuery && hitCount === 0;
            return (
              <>
                {!openPicker.loading && !openPicker.error && (
                  <input
                    type="search"
                    data-git-open-search=""
                    data-git-open-search-kind={isPart ? 'part' : 'assembly'}
                    value={openPicker.query || ''}
                    onChange={(e) => setOpenPicker({ ...openPicker, query: e.target.value })}
                    placeholder={isPart ? 'Search parts…' : 'Search assemblies…'}
                    aria-label={isPart ? 'Search parts' : 'Search assemblies'}
                    className={`mb-3 ${PARTS_TEXT_INPUT_CLASS}`}
                    style={PARTS_TEXT_INPUT_STYLE}
                    autoFocus
                  />
                )}
                {openPicker.loading && <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Loading…</p>}
                {openPicker.error && !openPicker.loading && (
                  <p className="text-xs text-amber-300" data-git-dialog-empty="">{openPicker.error}</p>
                )}
                {openEmptyFilter && (
                  <p className="text-xs text-amber-300" data-git-open-search-empty="">No matches.</p>
                )}
                {!openPicker.loading && !isPart && asmHits.length > 0 && (
                  <div data-git-open-assemblies="" data-git-open-list="">
                    <AssemblyOpenList
                      items={asmHits}
                      current={assemblyName}
                      onOpen={askOpenAssemblyChoice}
                      onDelete={(name) => { void askDeleteAssembly(name); }}
                    />
                  </div>
                )}
                {!openPicker.loading && isPart && partGroups.length > 0 && (
                  <div className="max-h-72 overflow-y-auto" data-git-open-parts="">
                    {partGroups.map((group) => (
                      <div key={group.key} className="mb-2" data-git-open-group={group.label} data-git-open-group-current={group.current ? 'true' : undefined}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          {group.label}
                          {group.current ? ' · this assembly' : ''}
                        </p>
                        <ul className="space-y-1" data-git-open-part-list="">
                          {group.parts.map((item) => (
                            <li key={item.path}>
                              <button
                                type="button"
                                data-git-open-part={item.path}
                                data-git-open-kind="part"
                                data-git-open-part-source={item.source}
                                data-git-open-part-foreign={item.foreign ? 'true' : undefined}
                                title={item.path}
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
                                onClick={() => { void runOpenPart(item.path); }}
                              >
                                <span className="block truncate">
                                  {item.name}
                                  {item.sameName ? <span className="ml-1 text-chrome-secondary">· {item.source}</span> : null}
                                </span>
                                <span className="text-[10px] text-gray-500">
                                  {item.inDoc ? 'in this assembly' : item.foreign ? `links from ${item.source}` : 'opens by reference'}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </VaultPickerDialog>
      )}
      {deleteAssembly && typeof document !== 'undefined' && (
        <DeleteAssemblyDialog
          assemblyName={deleteAssembly.name}
          partCount={deleteAssembly.partCount}
          referenced={deleteAssembly.referenced}
          typed={deleteAssembly.typed}
          loading={deleteAssembly.loading}
          busy={deleteAssembly.busy}
          busyAction={deleteAssembly.busyAction || ''}
          error={deleteAssembly.error}
          onTyped={(value) => setDeleteAssembly((prev) => (prev ? { ...prev, typed: value } : prev))}
          onKeep={() => { void runDeleteAssembly('keep'); }}
          onDrop={() => { void runDeleteAssembly('drop'); }}
          onClose={closeDeleteAssembly}
        />
      )}
      {openPicker && typeof document !== 'undefined' && openPicker.kind === 'open-choice' && (
        <OpenAssemblyChoiceDialog
          assemblyName={openPicker.assemblyName}
          loading={!!openPicker.loading}
          error={openPicker.error || ''}
          onClose={closePicker}
          onInsert={() => { void runInsertAssemblyParts(openPicker.assemblyName); }}
          onOpen={() => { void runOpenAssembly(openPicker.assemblyName); }}
        />
      )}
      {openPicker && typeof document !== 'undefined' && openPicker.kind === 'new-part' && (
        <VaultPickerDialog
          title="New part"
          labelledBy="git-new-part-title"
          dataAttr="new-part"
          onClose={closePicker}
          footer={(
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closePicker} data-git-dialog-cancel="">
                Cancel
              </button>
              <button
                type="button"
                data-git-new-part-confirm=""
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                onClick={() => {
                  const name = (openPicker.draft || '').trim();
                  closePicker();
                  onAddPart?.(name);
                }}
              >
                Create
              </button>
            </div>
          )}
        >
          <p className="mb-2 text-[11px] text-chrome-secondary">
            Part name
          </p>
          <input
            ref={pathInputRef}
            data-git-new-part-name=""
            value={openPicker.draft || ''}
            onChange={(e) => setOpenPicker({ ...openPicker, draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const name = (openPicker.draft || '').trim();
                closePicker();
                onAddPart?.(name);
              }
            }}
            className={PARTS_TEXT_INPUT_CLASS}
            style={PARTS_TEXT_INPUT_STYLE}
            placeholder="Bracket"
          />
        </VaultPickerDialog>
      )}
      {commitFlow && typeof document !== 'undefined' && (
        <VaultPickerDialog
          title={(
            commitFlow.stage === 'ask-force'
            || (commitFlow.result?.syncHold && (commitFlow.stage === 'busy' || commitFlow.stage === 'error'))
          ) ? 'Conflict with main' : 'Save to repo'}
          labelledBy="git-commit-title"
          dataAttr="commit"
          onClose={commitFlow.stage === 'busy' ? undefined : closeCommit}
          footer={(
            <div className="mt-4 flex justify-end gap-2" data-git-commit-stage={commitFlow.stage}>
              {commitFlow.stage === 'message' && (
                <>
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeCommit} data-git-dialog-cancel="">
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-ui-action="data-git-commit-confirm"
                    data-git-commit-confirm=""
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                    onClick={runCommit}
                  >
                    Save
                  </button>
                </>
              )}
              {commitFlow.stage === 'ask-force' && (
                <>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                    onClick={closeCommit}
                    data-git-keep-branch=""
                    data-git-conflict-stay=""
                  >
                    Stay on branch
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs text-chrome-text hover:bg-white/10 border border-gray-600"
                    data-git-conflict-open-github=""
                    onClick={openConflictOnGithub}
                  >
                    Open on GitHub
                  </button>
                  <button
                    type="button"
                    data-ui-action="data-git-conflict-overwrite"
                    data-git-force-merge=""
                    data-git-conflict-overwrite=""
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                    onClick={runForceMerge}
                  >
                    Overwrite main
                  </button>
                </>
              )}
              {(commitFlow.stage === 'done' || commitFlow.stage === 'error') && (
                <>
                  {commitFlow.stage === 'error'
                    && commitFlow.result?.code === 'no_repo_path'
                    && (commitFlow.result?.stray || []).length > 0
                    && onAddToRepo && (
                    <button
                      type="button"
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                      data-ui-action="data-git-commit-add-to-repo"
                      data-git-commit-add-to-repo=""
                      onClick={() => { void runAddStrayToRepo(commitFlow.result.stray); }}
                    >
                      Add to Repo
                    </button>
                  )}
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeCommit} data-git-dialog-cancel="">
                    Close
                  </button>
                </>
              )}
            </div>
          )}
        >
          {commitFlow.stage === 'message' && (
            <>
              <p className="mb-2 text-[11px] text-chrome-secondary">
                Saving commits changed parts and the assembly to the repo.
              </p>
              <input
                ref={commitInputRef}
                data-git-commit-message=""
                value={commitFlow.draft || ''}
                onChange={(e) => setCommitFlow({ ...commitFlow, draft: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runCommit();
                  }
                }}
                className={PARTS_TEXT_INPUT_CLASS}
                style={PARTS_TEXT_INPUT_STYLE}
                placeholder="Enter a commit message"
              />
            </>
          )}
          {commitFlow.stage === 'busy' && <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Committing…</p>}
          {commitFlow.stage === 'ask-force' && (
            <div
              data-git-force-merge-ask=""
              data-git-conflict-popup=""
              data-git-branch={commitFlow.result?.branch || ''}
            >
              <p className="text-xs text-gray-300">
                {commitFlow.result?.syncHold
                  ? `Nothing was written on ${commitFlow.result?.branch || 'this branch'}. Your local changes stay queued.`
                  : (
                    <>
                      {'Your changes were committed to '}
                      <span className="font-mono text-chrome-text">{commitFlow.result?.branch}</span>
                      {` (from base ${String(commitFlow.result?.baseSha || '').slice(0, 7)}).`}
                    </>
                  )}
              </p>
              <p className="mt-2 text-xs text-amber-300" data-git-force-merge-warning="" data-git-conflict-warning="">
                {commitFlow.result?.warning || 'Overwrite main replaces tip-side edits in these files; other remote files stay.'}
              </p>
            </div>
          )}
          {commitFlow.stage === 'done' && (
            <p className="text-xs text-gray-300" data-git-commit-done={commitFlow.result?.status || ''}>
              {commitFlow.result?.status === 'clean'
                ? 'Nothing to commit.'
                : commitFlow.result?.status === 'queued'
                  ? 'Saved locally. It will sync when you are back online.'
                  : commitFlow.result?.addedNames
                    ? `Added ${commitFlow.result.addedNames} to the repo.`
                    : `Committed ${(commitFlow.result?.files || []).length} file(s) to ${commitFlow.result?.branch || 'main'} (${String(commitFlow.result?.sha || '').slice(0, 7)}).`}
            </p>
          )}
          {commitFlow.stage === 'error' && (
            <p className="text-xs text-amber-300" data-git-commit-error="">{commitFlow.error}</p>
          )}
        </VaultPickerDialog>
      )}
      {conflictFlow && typeof document !== 'undefined' && (
        <VaultPickerDialog
          title={conflictFlow.kind === 'assembly' ? 'Assembly behind remote' : 'Part behind remote'}
          labelledBy="git-behind-title"
          dataAttr="behind"
          onClose={conflictFlow.stage === 'busy' ? undefined : closeConflict}
          footer={(
            <div className="mt-4 flex flex-wrap justify-end gap-2" data-git-behind-stage={conflictFlow.stage}>
              {conflictFlow.stage === 'choose' && (
                <>
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeConflict} data-git-dialog-cancel="">
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-ui-action="data-git-behind-reload"
                    data-git-behind-reload=""
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                    onClick={() => runConflict('reload')}
                  >
                    Reload
                  </button>
                  <button
                    type="button"
                    data-ui-action="data-git-behind-keep"
                    data-git-behind-keep=""
                    className="rounded-md px-3 py-1.5 text-xs text-chrome-text hover:bg-white/10 border border-gray-600"
                    onClick={() => runConflict('keep')}
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    data-ui-action="data-git-behind-branch"
                    data-git-behind-branch=""
                    className="rounded-md px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/40 border border-amber-500/50"
                    onClick={() => runConflict('branch')}
                  >
                    Check in mine to a branch
                  </button>
                </>
              )}
              {(conflictFlow.stage === 'done' || conflictFlow.stage === 'error') && (
                <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeConflict} data-git-dialog-cancel="">
                  Close
                </button>
              )}
            </div>
          )}
        >
          {conflictFlow.stage === 'choose' && (
            <div data-git-behind-ask="" data-git-behind-path={conflictFlow.path} data-git-behind-kind={conflictFlow.kind}>
              <p className="text-xs text-gray-300">
                {'Remote changed '}
                <span className="font-medium text-chrome-text">{conflictFlow.name}</span>
                {'. Reload takes the remote version, Keep mine keeps yours, or Check in mine parks yours on a new branch (base auto-detected).'}
              </p>
              <p className="mt-2 truncate font-mono text-[10px] text-gray-500" title={conflictFlow.path}>{conflictFlow.path}</p>
            </div>
          )}
          {conflictFlow.stage === 'busy' && <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Working…</p>}
          {conflictFlow.stage === 'done' && (
            <p className="text-xs text-gray-300" data-git-behind-done={conflictFlow.result?.status || ''}>
              {conflictFlow.result?.status === 'reloaded' && 'Reloaded from remote.'}
              {conflictFlow.result?.status === 'kept' && 'Keeping your version. Marker cleared.'}
              {conflictFlow.result?.status === 'branched' && (
                <>
                  {'Parked on '}
                  <span className="font-mono">{conflictFlow.result?.branch}</span>
                  {'. Your working copy is unchanged; marker cleared.'}
                </>
              )}
              {!['reloaded', 'kept', 'branched'].includes(conflictFlow.result?.status) && 'Done.'}
            </p>
          )}
          {conflictFlow.stage === 'error' && (
            <p className="text-xs text-amber-300" data-git-behind-error="">{conflictFlow.error}</p>
          )}
        </VaultPickerDialog>
      )}

      {leaveGuard && leaveGuard.stage === 'ask' && typeof document !== 'undefined' && (
        <VaultPickerDialog
          title="Save current assembly?"
          labelledBy="assembly-leave-title"
          dataAttr="assembly-leave"
          onClose={() => setLeaveGuard(null)}
          footer={(
            <div className="mt-4 flex flex-wrap justify-end gap-2" data-assembly-leave-stage="ask">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                data-assembly-leave-cancel=""
                onClick={() => setLeaveGuard(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
                data-assembly-leave-discard=""
                onClick={runLeaveDiscard}
              >
                Discard
              </button>
              {leaveGuard.code === 'no_repo_path'
                && (leaveGuard.stray || []).length > 0
                && onAddToRepo ? (
                <button
                  type="button"
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                  data-assembly-leave-add-to-repo=""
                  onClick={() => { void runAddStrayToRepo(leaveGuard.stray, { fromLeave: true }); }}
                >
                  Add to Repo
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                  data-assembly-leave-save=""
                  onClick={() => { void runLeaveSave(); }}
                >
                  Save
                </button>
              )}
            </div>
          )}
        >
          <div data-assembly-leave-ask="" data-assembly-leave-pending={leaveGuard.pending}>
            <p className="text-xs text-gray-300">
              {source === 'git'
                ? 'Save commits this assembly to the repo before continuing.'
                : 'Save keeps this assembly in local storage before continuing.'}
            </p>
            {leaveGuard.error ? (
              <p className="mt-2 text-xs text-amber-300" data-assembly-leave-error="">{leaveGuard.error}</p>
            ) : null}
          </div>
        </VaultPickerDialog>
      )}
      {leaveGuard && leaveGuard.stage === 'busy' && typeof document !== 'undefined' && (
        <VaultPickerDialog
          title="Saving…"
          labelledBy="assembly-leave-busy-title"
          dataAttr="assembly-leave"
          onClose={undefined}
        >
          <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Saving…</p>
        </VaultPickerDialog>
      )}

      {branchFlow && (
        branchFlow.stage === 'confirm'
        || branchFlow.stage === 'busy'
        || branchFlow.stage === 'error'
        || branchFlow.stage === 'pane'
        || branchFlow.stage === 'create'
        || branchFlow.stage === 'delete-confirm'
        || branchFlow.stage === 'merge-conflict'
      ) && typeof document !== 'undefined' && (
        <VaultPickerDialog
          title={
            branchFlow.stage === 'confirm' ? 'Switch branch?'
              : branchFlow.stage === 'create' ? 'Create branch'
                : branchFlow.stage === 'delete-confirm' ? 'Delete branch'
                  : branchFlow.stage === 'merge-conflict' ? 'Cannot squash merge'
                    : 'Branches'
          }
          labelledBy="git-branch-title"
          dataAttr="branch"
          onClose={branchFlow.stage === 'busy' ? undefined : closeBranches}
          headerRight={branchFlow.stage === 'pane' ? (
            <button
              type="button"
              data-ui-action="data-git-branch-action-create"
              data-git-branch-action="create"
              className="shrink-0 rounded p-1 text-blue-400 hover:bg-white/10"
              title="Create branch"
              aria-label="Create branch"
              onClick={startCreateBranch}
            >
              <Plus size={16} />
            </button>
          ) : null}
          footer={(
            <div className="mt-4 flex flex-wrap justify-end gap-2" data-git-branch-stage={branchFlow.stage}>
              {branchFlow.stage === 'confirm' && (
                <>
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeBranches} data-git-branch-cancel="">
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                    data-ui-action="data-git-branch-confirm"
                    data-git-branch-confirm=""
                    onClick={() => runSwitchBranch(branchFlow.pending)}
                  >
                    Switch anyway
                  </button>
                </>
              )}
              {branchFlow.stage === 'create' && (
                <>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                    onClick={() => { void refreshBranchPane(); }}
                    data-git-branch-cancel=""
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                    data-ui-action="data-git-branch-create-confirm"
                    data-git-branch-create-confirm=""
                    onClick={() => { void runCreateBranch(); }}
                  >
                    Create
                  </button>
                </>
              )}
              {branchFlow.stage === 'delete-confirm' && (
                <>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                    onClick={() => { void refreshBranchPane(); }}
                    data-git-branch-cancel=""
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                    data-ui-action="data-git-branch-delete-confirm"
                    data-git-branch-delete-confirm=""
                    onClick={() => { void runDeleteBranch(branchFlow.pending); }}
                  >
                    Delete
                  </button>
                </>
              )}
              {branchFlow.stage === 'merge-conflict' && (
                <>
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeBranches} data-git-branch-cancel="">
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                    data-git-branch-resolve-github=""
                    onClick={resolveMergeOnGithub}
                  >
                    Resolve on Git
                  </button>
                </>
              )}
              {(branchFlow.stage === 'pane' || branchFlow.stage === 'error') && (
                <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeBranches} data-git-dialog-cancel="">
                  Close
                </button>
              )}
            </div>
          )}
        >
          {branchFlow.stage === 'confirm' && (
            <p className="text-xs text-gray-300" data-git-branch-dirty-warn="">
              Uncommitted changes will be lost when switching to
              {' '}
              <span className="font-mono text-chrome-text">{branchFlow.pending}</span>
              .
            </p>
          )}
          {branchFlow.stage === 'busy' && (
            <p className="text-xs text-chrome-secondary" data-git-branch-switching="">Working…</p>
          )}
          {branchFlow.stage === 'error' && (
            <p className="text-xs text-amber-300" data-git-branch-error="">{branchFlow.error}</p>
          )}
          {branchFlow.stage === 'create' && (
            <>
              <p className="mb-2 text-[11px] text-chrome-secondary">
                {'New branch from '}
                <span className="font-mono text-gray-200">{currentBranch || 'main'}</span>
                .
              </p>
              <input
                ref={branchCreateInputRef}
                data-git-branch-create-name=""
                value={branchFlow.draft || ''}
                onChange={(e) => setBranchFlow({ ...branchFlow, draft: e.target.value, error: '' })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runCreateBranch();
                  }
                }}
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={PARTS_TEXT_INPUT_CLASS}
                style={PARTS_TEXT_INPUT_STYLE}
                placeholder="feature/my-change"
              />
              {branchFlow.error ? (
                <p className="mt-2 text-xs text-amber-300" data-git-branch-create-error="">{branchFlow.error}</p>
              ) : null}
            </>
          )}
          {branchFlow.stage === 'delete-confirm' && (
            <p className="text-xs text-gray-300" data-git-branch-delete-warn="">
              {'Delete branch '}
              <span className="font-mono text-chrome-text">{branchFlow.pending}</span>
              {'? This cannot be undone from SurfCAD.'}
            </p>
          )}
          {branchFlow.stage === 'merge-conflict' && (
            <p className="text-xs text-gray-300" data-git-branch-merge-conflict="">
              {'This branch has diverged from '}
              <span className="font-mono text-chrome-text">main</span>
              {'. Resolve the merge on GitHub, then switch back to main.'}
            </p>
          )}
          {branchFlow.stage === 'pane' && (
            <div data-git-branch-pane="">
              {(currentBranch || 'main') !== 'main' ? (
                <div className="mb-2 flex items-center gap-2" data-git-branch-pane-toolbar="">
                  <button
                    type="button"
                    data-git-branch-action="merge"
                    className="rounded-md bg-blue-600/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                    onClick={() => { void startMergeFromPane(); }}
                  >
                    Merge
                  </button>
                </div>
              ) : null}
              {branchFlow.loading && (
                <p className="text-xs text-chrome-secondary" data-git-branch-loading="">Loading…</p>
              )}
              {branchFlow.error && !branchFlow.loading && (
                <p className="text-xs text-amber-300" data-git-branch-list-error="">{branchFlow.error}</p>
              )}
              {!branchFlow.loading && (branchFlow.items || []).length > 0 && (
                <ul className="max-h-56 space-y-1 overflow-y-auto" data-git-branch-dialog-list="">
                  {(branchFlow.items || []).map((b) => {
                    const current = !!b.current || b.name === currentBranch;
                    const creating = !!b.pending;
                    const canDelete = b.name !== 'main' && !current && !creating;
                    return (
                      <li key={b.name} className="flex items-center gap-1" data-git-branch-pending={creating ? 'true' : undefined}>
                        <button
                          type="button"
                          data-git-branch-row={b.name}
                          data-git-branch-current={current ? 'true' : 'false'}
                          disabled={current || creating}
                          className={`flex min-w-0 flex-1 items-center justify-between rounded px-2 py-1.5 text-left text-xs ${
                            current
                              ? 'bg-blue-600/20 text-blue-200'
                              : 'text-chrome-text hover:bg-white/10'
                          } disabled:cursor-default`}
                          onClick={() => requestSwitchBranch(b.name)}
                        >
                          <span className="truncate font-mono">{b.name}</span>
                          {creating ? (
                            <Loader2 size={14} className="shrink-0 animate-spin text-sky-300" data-git-branch-pending-spinner="" />
                          ) : current ? (
                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-blue-300" data-git-branch-marker="">
                              current
                            </span>
                          ) : null}
                        </button>
                        {canDelete ? (
                          <button
                            type="button"
                            data-git-branch-action="delete"
                            data-git-branch-delete-row={b.name}
                            title={`Delete ${b.name}`}
                            aria-label={`Delete branch ${b.name}`}
                            className="shrink-0 rounded p-1 text-gray-500 hover:bg-red-500/15 hover:text-red-300"
                            onClick={() => requestDeleteBranch(b.name)}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <span className="w-6 shrink-0 text-center text-[9px] text-gray-600" title={creating ? 'creating' : 'protected'}>·</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </VaultPickerDialog>
      )}

      {moveFlow && typeof document !== 'undefined' && (
        <VaultPickerDialog
          title={moveFlow.stage === 'done' ? 'Repo ready' : 'Create repo'}
          labelledBy="git-move-title"
          dataAttr="move-to-git"
          onClose={moveFlow.stage === 'busy' ? undefined : closeMove}
          footer={(
            <div className="mt-4 flex flex-wrap justify-end gap-2" data-git-move-stage={moveFlow.stage} data-git-vault-create-stage={moveFlow.stage}>
              {moveFlow.stage === 'form' && (
                <>
                  <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10" onClick={closeMove} data-git-dialog-cancel="">
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                    data-git-move-confirm=""
                    data-git-vault-save=""
                    disabled={!moveVaultClean}
                    onClick={runMoveToGit}
                  >
                    Save
                  </button>
                </>
              )}
              {moveFlow.stage === 'done' && (
                <button type="button" className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500" onClick={closeMove} data-git-move-close="">
                  Done
                </button>
              )}
            </div>
          )}
        >
          {moveFlow.stage === 'form' && (
            <div className="space-y-3" data-git-vault-create="">
              <label className="block text-[11px] text-chrome-secondary" htmlFor="git-move-vault-name">
                Repo
              </label>
              <input
                id="git-move-vault-name"
                data-git-move-vault-name=""
                data-git-vault-name=""
                className={`${PARTS_TEXT_INPUT_CLASS} font-mono`}
                style={PARTS_TEXT_INPUT_STYLE}
                value={moveFlow.vaultName}
                autoFocus
                spellCheck={false}
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  const vaultName = event.target.value;
                  setMoveFlow((prev) => ({ ...prev, vaultName, error: '' }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && moveVaultClean) {
                    event.preventDefault();
                    void runMoveToGit();
                  }
                }}
              />
              {moveFlow.error && <p className="text-xs text-amber-300" data-git-move-error="">{moveFlow.error}</p>}
            </div>
          )}
          {moveFlow.stage === 'busy' && (
            <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Working…</p>
          )}
          {moveFlow.stage === 'done' && (
            <p className="text-xs text-gray-300" data-git-move-done={moveFlow.result?.vault?.repo?.name || ''}>
              {`${moveFlow.result?.files?.length || 0} files saved to repo ${moveFlow.result?.vault?.repo?.name || ''}/${moveFlow.result?.vault?.defaultBranch || 'main'}.`}
            </p>
          )}
        </VaultPickerDialog>
      )}

      {pendingRemoveGroup && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center surface-scrim p-4"
          data-part-group-remove-dialog=""
          role="dialog"
          aria-modal="true"
          aria-labelledby="part-group-remove-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingRemoveGroup(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setPendingRemoveGroup(null);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg surface-glass border border-chrome-border p-4 shadow-xl">
            <h2 id="part-group-remove-title" className="text-sm font-semibold text-chrome-text">
              Remove group
            </h2>
            <p className="mt-2 text-xs text-gray-300">
              {`Remove ${pendingRemoveGroup.name} from this assembly? Its parts leave this assembly. Linked parts stay in the repo; they are only unlinked.`}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                data-part-group-remove-cancel=""
                className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                onClick={() => setPendingRemoveGroup(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                data-part-group-remove-confirm=""
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                onClick={() => {
                  const pending = pendingRemoveGroup;
                  setPendingRemoveGroup(null);
                  if (pending?.id) onRemoveGroup?.(pending.id);
                }}
              >
                Remove group
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {pendingDelete && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center surface-scrim p-4"
          data-part-delete-dialog=""
          data-part-delete-step={pendingDelete.step === 'confirm-repo' ? 'repo' : 'choose'}
          role="dialog"
          aria-modal="true"
          aria-labelledby="part-delete-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelDeletePart();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelDeletePart();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg surface-glass border border-chrome-border p-4 shadow-xl">
            <h2 id="part-delete-title" className="text-sm font-semibold text-chrome-text">
              Delete part
            </h2>
            {pendingDelete.step === 'confirm-repo' ? (
              <>
                <p className="mt-2 text-xs text-gray-300" data-part-delete-repo-message="">
                  {partRepoDeleteConfirmCopy(pendingDelete.id)}
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <button
                    ref={cancelBtnRef}
                    type="button"
                    data-part-delete-cancel=""
                    className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                    onClick={cancelDeletePart}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-part-delete-repo-commit=""
                    className="rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                    onClick={() => confirmDeletePart('repo')}
                  >
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-gray-300">
                  {partCanDeleteFromRepo(source, pendingDelete.id)
                    ? `Remove ${pendingDelete.name} from this assembly only, or also delete its file from the repo.`
                    : `Remove ${pendingDelete.name} from this assembly?`}
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    ref={cancelBtnRef}
                    type="button"
                    data-part-delete-cancel=""
                    className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                    onClick={cancelDeletePart}
                  >
                    Cancel
                  </button>
                  <div className="flex flex-col gap-[14px]" data-part-delete-actions="">
                    <button
                      type="button"
                      data-part-delete-confirm=""
                      data-part-delete-scope="assembly"
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                      onClick={() => confirmDeletePart('assembly')}
                    >
                      Delete from assembly
                    </button>
                    {partCanDeleteFromRepo(source, pendingDelete.id) && (
                      <button
                        type="button"
                        data-part-delete-confirm-repo=""
                        data-part-delete-scope="repo"
                        className="rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                        onClick={() => confirmDeletePart('repo')}
                      >
                        Delete from assembly & repo
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </aside>
  );
});

export default PartFeed;
