/**
 * Live tab bridge for a browser agent (Playwright, Claude-in-Chrome).
 *
 * The object sits on `window.surfcad` in the page, on the main thread.
 * The worker lockdown replaces `fetch` and the other host globals, so an
 * agent cannot drive the open tab from inside the sandbox.
 *
 * The stable entry is `call(name, argsJson)`. It resolves to a JSON
 * envelope `{ v, ok, result?, error? }`. Command names are snake_case.
 * Convenience methods are thin wrappers over that dispatcher.
 *
 * A call that changes the script is one undo step on the active part, the
 * same stack as the editor Undo button. `run` of the text `set_script`
 * just wrote does not add a second step, so Undo once removes that edit.
 * `run` of a buffer that is not yet the head (a typed edit that has not
 * committed) is that one step. Both calls write the editor and wait until
 * the viewport has run the script.
 *
 * On in dev. Elsewhere, the page URL `?agent=1` or localStorage
 * `surfcadAgent` = `1` opts in. Flag off, nothing is installed.
 *
 * Command bodies live in `src/agent/commands/`. This file owns the envelope,
 * the queue, and the one-undo mutate. `list_commands` is appended on v1.
 */

import { v1Registry } from '../agent/commands/index.js';
import { formatAgentErrors, scrubPublishedError } from '../agent/state/formatErrors.js';
import { explainReservedHelperError } from '../agent/state/reservedHelpers.js';
import { createPickSessions } from '../agent/pick/session.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { emptyPartHistory, pushPartHistory } from './partHistory.js';
import { bytesAfterHeaderLine, headerLineEnding } from './git/surfId.js';
import { wrapRawScript } from './wrapRawScript.js';
import { withAgentDrivenChange } from '../agent/agentFeaturePopupGate.js';

export const AGENT_STORAGE_KEY = 'surfcadAgent';

/** Envelope `v` and `window.surfcad.version`. Additive changes stay on this number. */
export const AGENT_BRIDGE_VERSION = 1;

/**
 * Command names, in the order an MCP tool list would publish them.
 * Snake case, stable. A new name may be appended on v1. Renaming one bumps the version.
 * The array is the registry's public order, including `list_commands`.
 */
export const AGENT_COMMANDS = v1Registry.names;

const EMPTY_STATUS = Object.freeze({
  partId: '',
  partName: '',
  script: '',
  runState: 'not_run_yet',
  volume: null,
  bbox: null,
  featureCount: 0,
  bodyCount: null,
});

/**
 * @param {{ dev?: boolean, location?: { search?: string } | null, localStorage?: { getItem?: (key: string) => string | null } | null }} [env]
 */
function isProdSurfCadHost(loc) {
  try {
    const hostname = loc && typeof loc.hostname === 'string' ? loc.hostname : '';
    return hostname === 'surfcad.com' || hostname === 'www.surfcad.com';
  } catch {
    return false;
  }
}

export function agentBridgeEnabled(env = {}) {
  if (env.dev === true) return true;
  const loc = Object.prototype.hasOwnProperty.call(env, 'location')
    ? env.location
    : (typeof location !== 'undefined' ? location : null);
  const store = Object.prototype.hasOwnProperty.call(env, 'localStorage')
    ? env.localStorage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (isProdSurfCadHost(loc)) return true;
  let query = false;
  try {
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    query = new URLSearchParams(search).get('agent') === '1';
  } catch {
    query = false;
  }
  let stored = false;
  try {
    stored = !!(store && typeof store.getItem === 'function' && store.getItem(AGENT_STORAGE_KEY) === '1');
  } catch {
    stored = false;
  }
  return query || stored;
}

/** Plain `{ min, max }` arrays, or null when the box is missing or non-finite. */
export function cloneAgentBbox(bbox) {
  if (!bbox || bbox.min == null || bbox.max == null) return null;
  const min = [Number(bbox.min[0]), Number(bbox.min[1]), Number(bbox.min[2])];
  const max = [Number(bbox.max[0]), Number(bbox.max[1]), Number(bbox.max[2])];
  if (![...min, ...max].every((n) => Number.isFinite(n))) return null;
  return { min, max };
}

export function agentFeatureCount(script) {
  return parseFeatureMarkers(typeof script === 'string' ? script : '').length;
}

/** Copy the stack so a later seed wipe cannot mutate the snapshot. */
export function cloneAgentHistory(history) {
  const base = history && Array.isArray(history.commits) ? history : emptyPartHistory();
  const head = Number.isInteger(base.head) ? base.head : -1;
  return { commits: base.commits.slice(), head };
}

/**
 * One undo step when `code` differs from the head. The same text is not a
 * second step (`pushPartHistory`).
 */
export function commitAgentStep(history, code, message) {
  return pushPartHistory(cloneAgentHistory(history), code, message);
}

function errorMessages(errors) {
  if (typeof errors === 'string') return errors ? [errors] : [];
  if (!Array.isArray(errors)) return [];
  const out = [];
  for (const item of errors) {
    if (typeof item === 'string' && item) out.push(explainReservedHelperError(item));
    else if (item && typeof item.message === 'string' && item.message) out.push(explainReservedHelperError(item.message));
  }
  return out;
}

function statusFrom(outcome, script, extras = {}) {
  const text = typeof script === 'string' ? script : '';
  const ok = outcome?.ok === true;
  const volume = Number(outcome?.volume);
  let runState = extras.runState;
  if (runState == null) runState = ok ? 'ok' : 'failed';
  return {
    partId: extras.partId != null ? String(extras.partId) : '',
    partName: typeof outcome?.partName === 'string'
      ? outcome.partName
      : (extras.partName || ''),
    script: text,
    runState,
    volume: ok && Number.isFinite(volume) ? volume : null,
    bbox: ok ? cloneAgentBbox(outcome?.bbox) : null,
    featureCount: agentFeatureCount(text),
    bodyCount: statusBodyCount(outcome, extras),
  };
}

function statusBodyCount(outcome, extras) {
  if (extras.bodyCount != null) return extras.bodyCount;
  if (outcome && outcome.bodyCount != null) return outcome.bodyCount;
  return null;
}

function copyStatus(status) {
  const src = status || EMPTY_STATUS;
  return {
    partId: src.partId || '',
    partName: src.partName || '',
    script: typeof src.script === 'string' ? src.script : '',
    runState: src.runState || 'not_run_yet',
    volume: src.volume == null ? null : src.volume,
    bbox: src.bbox ? { min: src.bbox.min.slice(), max: src.bbox.max.slice() } : null,
    featureCount: src.featureCount || 0,
    bodyCount: src.bodyCount == null ? null : src.bodyCount,
  };
}

function pass(result) {
  return { v: AGENT_BRIDGE_VERSION, ok: true, result };
}

/** `details` is optional structured context (H9 pick errors). Additive on v1. */
function fail(code, message, details) {
  const error = { code, message };
  if (details !== undefined && isJsonValue(details)) error.details = JSON.parse(JSON.stringify(details));
  return { v: AGENT_BRIDGE_VERSION, ok: false, error };
}

function bridgeError(error) {
  const err = new Error(error?.message || 'Agent bridge failed');
  err.code = error?.code || 'internal';
  return err;
}

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

/**
 * `argsJson` is a JSON string (what an MCP relay sends) or a plain object.
 * The object path is cloned through JSON so a typed array cannot leak through.
 */
function parseArgs(argsJson) {
  if (argsJson == null || argsJson === '') return { ok: true, args: {} };
  if (typeof argsJson === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      return { ok: false, code: 'bad_json', message: 'args are not valid JSON' };
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 'bad_args', message: 'args must be a JSON object' };
    }
    return { ok: true, args: parsed };
  }
  if (!isJsonValue(argsJson) || Array.isArray(argsJson)) {
    return { ok: false, code: 'bad_args', message: 'args are not a JSON object' };
  }
  return { ok: true, args: JSON.parse(JSON.stringify(argsJson)) };
}

/**
 * @param {{
 *   resolve?: () => Record<string, unknown> | null | undefined,
 *   getScript?: () => string,
 *   setEditor?: (src: string) => void,
 *   readHistory?: () => { commits: unknown[], head: number },
 *   writeHistory?: (history: { commits: unknown[], head: number }) => void,
 *   execute?: (src: string) => Promise<{ ok?: boolean, errors?: unknown, volume?: number, bbox?: object, partName?: string }>,
 *   screenshot?: () => string | Promise<string>,
 * } | null} hostSource
 *
 * When `resolve` is set, every command reads handlers from `resolve()` at call
 * time so App / Viewport can register readers on `agentHostRef` after mount.
 */
export function createSurfcadBridge(hostSource) {
  function getHost() {
    if (hostSource && typeof hostSource.resolve === 'function') {
      const current = hostSource.resolve();
      return current && typeof current === 'object' ? current : {};
    }
    return hostSource && typeof hostSource === 'object' ? hostSource : {};
  }

  function hostFn(name) {
    const fn = getHost()[name];
    return typeof fn === 'function' ? fn : null;
  }
  let chain = Promise.resolve();
  let lastErrors = [];
  let lastStructuredErrors = [];
  let lastRunOk = true;
  let heldFailurePartId = '';
  let lastStatus = copyStatus(EMPTY_STATUS);
  let lastStatusPartId = '';
  const pickSessions = createPickSessions();

  function refreshStatusForActivePart() {
    const read = hostFn('readActivePartStatus');
    if (!read) return;
    const snap = read();
    if (!snap || typeof snap !== 'object') return;
    const id = snap.partId || '';
    // A recovered mesh still looks like a good run to the parts list. Keep
    // the failed status until a later successful run clears it.
    if (!lastRunOk && heldFailurePartId && id === heldFailurePartId && snap.runState !== 'failed') {
      lastStatus = { ...copyStatus(snap), runState: 'failed', volume: null, bbox: null };
      lastStatusPartId = id;
      return;
    }
    lastStatus = copyStatus(snap);
    lastStatusPartId = id;
  }

  /**
   * Failure recorded for the run that just finished.
   * When the host passes `runFailure` (including null), that snapshot wins
   * over `readRunFailure`, which can still be the previous render.
   */
  function resolveFeatureFailure(outcome) {
    if (outcome && Object.prototype.hasOwnProperty.call(outcome, 'runFailure')) {
      const row = outcome.runFailure;
      return row && typeof row === 'object' ? row : null;
    }
    const readRunFailure = hostFn('readRunFailure');
    const row = readRunFailure ? readRunFailure() : null;
    return row && typeof row === 'object' ? row : null;
  }

  function isRecordedFailure(failure) {
    if (!failure || typeof failure !== 'object') return false;
    if (failure.id) return true;
    return typeof failure.message === 'string' && !!failure.message;
  }

  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
  }

  function remember(outcome, script) {
    const text = typeof script === 'string' ? script : '';
    const featureFailure = resolveFeatureFailure(outcome);
    const recorded = isRecordedFailure(featureFailure) ? featureFailure : null;
    const uiMessage = explainReservedHelperError(
      typeof recorded?.message === 'string' ? recorded.message : '',
    );
    let errors = errorMessages(outcome?.errors);
    if (uiMessage && !errors.includes(uiMessage)) errors = [uiMessage, ...errors];
    errors = errors.map((row) => scrubPublishedError(row)).filter(Boolean);
    // A recovered mesh is still a failed feature. `outcome.ok` alone is not
    // enough — the viewport keeps that solid and returns ok.
    const ok = outcome?.ok === true && !recorded;
    if (ok) errors = [];
    else if (!errors.length) {
      const preview = formatAgentErrors({
        messages: [],
        script: text,
        runFailure: recorded,
      });
      errors = preview.length ? [preview[0].message] : ['Script failed'];
    }
    lastErrors = errors.slice();
    lastRunOk = ok;
    lastStructuredErrors = ok ? [] : formatAgentErrors({
      messages: lastErrors,
      script: text,
      runFailure: recorded,
    });
    const activeId = hostFn('readParts')?.()?.activeId ?? '';
    lastStatusPartId = activeId != null ? String(activeId) : '';
    heldFailurePartId = ok ? '' : lastStatusPartId;
    lastStatus = statusFrom({ ...outcome, ok }, text, { partId: lastStatusPartId });
    const result = {
      ok,
      errors: lastErrors.slice(),
      failures: lastStructuredErrors.slice(),
      status: copyStatus(lastStatus),
    };
    if (Array.isArray(outcome?.droppedPaints)) {
      result.droppedPaints = JSON.parse(JSON.stringify(outcome.droppedPaints));
    }
    return result;
  }

  /**
   * Write `text`, run it, and record exactly one undo step when it differs
   * from the head. The history snapshot is taken before `execute`, because
   * the first real run seeds an assembly and replaces the stack.
   */
  /** Re-run the current script and refresh cached status/errors (no undo step). */
  async function syncStatusFromRun() {
    const execute = hostFn('execute');
    const getScript = hostFn('getScript');
    if (!execute || !getScript) return copyStatus(lastStatus);
    const text = getScript();
    try {
      const outcome = await execute(text);
      return remember(outcome, text);
    } catch (err) {
      return remember(failedExecute(err), text);
    }
  }

  function normalizeAgentScript(text) {
    const raw = typeof text === 'string' ? text : '';
    const readSurf = hostFn('readActivePartSurfId');
    const surfId = readSurf ? readSurf() : null;
    if (!surfId) return raw;
    const prefix = `// @surf-id ${surfId}`;
    const afterPrefix = raw.length > prefix.length ? raw[prefix.length] : '';
    if (raw === prefix || (raw.startsWith(prefix) && /[ \t\r\n]/.test(afterPrefix))) return raw;
    const ending = headerLineEnding(raw);
    if (ending != null) return `${prefix}${ending}${bytesAfterHeaderLine(raw)}`;
    const sep = raw.length && !raw.startsWith('\n') && !raw.startsWith('\r') ? '\n' : '';
    return `${prefix}${sep}${raw}`;
  }

  async function mutate(text, message) {
    const normalized = normalizeAgentScript(text);
    const readHistory = hostFn('readHistory');
    const setEditor = hostFn('setEditor');
    const execute = hostFn('execute');
    const writeHistory = hostFn('writeHistory');
    const before = cloneAgentHistory(readHistory ? readHistory() : emptyPartHistory());
    // Header first (prefix, not mint regex), then one Code wrap around the body.
    const source = wrapRawScript(normalized);
    if (setEditor) setEditor(source);
    let outcome;
    try {
      outcome = execute ? await execute(source) : failedExecute(new Error('execute missing'));
    } catch (err) {
      outcome = failedExecute(err);
    }
    if (writeHistory) writeHistory(commitAgentStep(before, source, message));
    return remember(outcome, source);
  }

  function failedExecute(err) {
    return {
      ok: false,
      errors: [String(err?.message || err)],
      volume: null,
      bbox: null,
      partName: '',
    };
  }

  /**
   * Handlers the command bodies call. Session state (last run, the queue,
   * one-undo mutate) stays here. The host methods are the ones App and
   * Viewport published.
   */
  const ctx = {
    getScript: () => (hostFn('getScript')?.() ?? ''),
    setEditor: (src) => { hostFn('setEditor')?.(src); },
    readHistory: () => (hostFn('readHistory')?.() ?? emptyPartHistory()),
    writeHistory: (history) => { hostFn('writeHistory')?.(history); },
    execute: (src) => {
      const run = hostFn('execute');
      return run ? run(src) : Promise.resolve(failedExecute(new Error('execute missing')));
    },
    screenshot: (opts) => hostFn('screenshot')?.(opts),
    mutate,
    remember,
    syncStatusFromRun,
    readStatus: () => {
      const activeId = ctx.readParts()?.activeId ?? '';
      const activeKey = activeId != null ? String(activeId) : '';
      if (activeKey !== lastStatusPartId) refreshStatusForActivePart();
      return copyStatus(lastStatus);
    },
    readErrors: () => lastErrors.slice(),
    readStructuredErrors: () => {
      const custom = hostFn('readStructuredErrors');
      if (custom) return custom();
      // Stored rows from the last finished run. Do not re-read a ref that
      // the next render has not caught up with — that produced "Feature failed".
      if (lastRunOk) return [];
      return lastStructuredErrors.slice();
    },
    readFeatureTree: () => (hostFn('readFeatureTree')?.() ?? {
      features: [],
      rollbackAnchor: null,
      activeChipId: null,
    }),
    readHelperEdgeContext: () => {
      const read = hostFn('readHelperEdgeContext');
      const list = read ? read() : null;
      return Array.isArray(list) ? list : [];
    },
    readSelection: () => (hostFn('readSelection')?.() ?? {
      activePartId: null,
      cadPartId: null,
      cadPartHighlighted: false,
      face: null,
      edges: [],
      contour: { armedId: null, planeId: null },
    }),
    readMode: () => (hostFn('readMode')?.() ?? {
      app: 'cad',
      viewport: 'idle',
      contour: null,
      fillet: null,
      featureEdit: null,
      sheetMetal: null,
    }),
    readDirty: () => (hostFn('readDirty')?.() ?? {
      workspaceDirty: false,
      assemblyDirty: false,
      renamePending: false,
      legacyCleanup: false,
      partIds: [],
      unsaved: false,
      editedSinceLoad: [],
    }),
    readToasts: () => (hostFn('readToasts')?.() ?? { toasts: [] }),
    readParts: () => (hostFn('readParts')?.() ?? {
      activeId: null,
      assemblyName: '',
      parts: [],
    }),
    readCamera: () => (hostFn('readCamera')?.() ?? {
      position: null,
      quaternion: null,
      target: null,
      zoom: null,
      fov: null,
    }),
    listFaces: (args) => hostFn('listFaces')?.(args),
    listEdges: (args) => hostFn('listEdges')?.(args),
    listFeatureEdges: (args) => hostFn('listFeatureEdges')?.(args),
    prepareHelperInsert: (payload) => hostFn('prepareHelperInsert')?.(payload),
    openFeature: (args) => hostFn('openFeature')?.(args),
    activateFeature: (args) => hostFn('activateFeature')?.(args),
    editFeature: (args) => hostFn('editFeature')?.(args),
    prepareFeatureConfirm: () => hostFn('prepareFeatureConfirm')?.(),
    prepareFeatureDelete: (args) => hostFn('prepareFeatureDelete')?.(args),
    dismissFeatureConfirmSession: () => { hostFn('dismissFeatureConfirmSession')?.(); },
    cancelFeature: () => hostFn('cancelFeature')?.(),
    deleteFeature: (args) => hostFn('deleteFeature')?.(args),
    rollbackTo: (args) => hostFn('rollbackTo')?.(args),
    prepareContourMutate: (payload, meta) => hostFn('prepareContourMutate')?.(payload, meta),
    applyContourMutateExtras: (prep) => { hostFn('applyContourMutateExtras')?.(prep); },
    prepareHoleMutate: (payload) => hostFn('prepareHoleMutate')?.(payload),
    applyHoleMutateExtras: (prep) => { hostFn('applyHoleMutateExtras')?.(prep); },
    finishHoleCommit: () => { hostFn('finishHoleCommit')?.(); },
    finishContourCommit: (args) => { hostFn('finishContourCommit')?.(args); },
    sketchBegin: (args) => hostFn('sketchBegin')?.(args),
    sketchAcceptPlane: (args) => hostFn('sketchAcceptPlane')?.(args),
    sketchAdd: (args) => hostFn('sketchAdd')?.(args),
    sketchCancel: () => hostFn('sketchCancel')?.(),
    prepareSketchCommit: () => hostFn('prepareSketchCommit')?.(),
    prepareSketchDimension: (args) => hostFn('prepareSketchDimension')?.(args),
    prepareSketchConstrain: (args) => hostFn('prepareSketchConstrain')?.(args),
    finishSketchGesture: () => { hostFn('finishSketchGesture')?.(); },
    holeOpen: () => hostFn('holeOpen')?.(),
    holeSetParams: (args) => hostFn('holeSetParams')?.(args),
    holeBeginCentres: () => hostFn('holeBeginCentres')?.(),
    holeCancel: () => hostFn('holeCancel')?.(),
    prepareHoleCommit: () => hostFn('prepareHoleCommit')?.(),
    planeSet: (args) => hostFn('planeSet')?.(args),
    workplaneSelect: (args) => hostFn('workplaneSelect')?.(args),
    setActiveWorkplane: (args) => hostFn('setActiveWorkplane')?.(args),
    listSketchEntities: () => hostFn('listSketchEntities')?.(),
    agentCreateAssembly: (args) => hostFn('agentCreateAssembly')?.(args),
    agentCreatePart: (args) => hostFn('agentCreatePart')?.(args),
    agentGetPartTransform: (args) => hostFn('agentGetPartTransform')?.(args),
    agentSetPartTransform: (args) => hostFn('agentSetPartTransform')?.(args),
    agentOpenAssembly: (args) => hostFn('agentOpenAssembly')?.(args),
    agentOpenPart: (args) => hostFn('agentOpenPart')?.(args),
    agentInsertPart: (args) => hostFn('agentInsertPart')?.(args),
    agentListAssemblies: (args) => hostFn('agentListAssemblies')?.(args),
    agentDeletePart: (args) => hostFn('agentDeletePart')?.(args),
    agentDeleteAssembly: (args) => hostFn('agentDeleteAssembly')?.(args),
    agentRenameAssembly: (args) => hostFn('agentRenameAssembly')?.(args),
    agentExportPart: (args) => hostFn('agentExportPart')?.(args),
    agentGitMoveToRepo: (args) => hostFn('agentGitMoveToRepo')?.(args),
    agentGitSave: (args) => hostFn('agentGitSave')?.(args),
    agentGitUpgradeVault: (args) => hostFn('agentGitUpgradeVault')?.(args),
    agentGitAddToRepo: (args) => hostFn('agentGitAddToRepo')?.(args),
    agentGitBehindResolve: (args) => hostFn('agentGitBehindResolve')?.(args),
    agentGitBranchCreate: (args) => hostFn('agentGitBranchCreate')?.(args),
    agentGitBranchSwitch: (args) => hostFn('agentGitBranchSwitch')?.(args),
    agentGitBranchDelete: (args) => hostFn('agentGitBranchDelete')?.(args),
    agentGitForceOverwrite: (args) => hostFn('agentGitForceOverwrite')?.(args),
    agentGitListBranches: (args) => hostFn('agentGitListBranches')?.(args),
    readAgentGitAdapterKind: () => hostFn('readAgentGitAdapterKind')?.() ?? null,
    readAgentGitRealOptIn: () => hostFn('readAgentGitRealOptIn')?.() === true,
    readAgentGitSessionDenied: () => hostFn('readAgentGitSessionDenied')?.() === true,
    readAgentGitWriteTarget: () => hostFn('readAgentGitWriteTarget')?.() ?? { repo: 'your repo', branch: 'main' },
    promptAgentGitWriteConsent: (args) => hostFn('promptAgentGitWriteConsent')?.(args) ?? 'unavailable',
    readAgentPartRename: (partId) => hostFn('readAgentPartRename')?.(partId) ?? { known: false, writesGit: false },
    agentRenamePart: (args) => hostFn('agentRenamePart')?.(args),
    jointOpen: () => hostFn('jointOpen')?.(),
    jointSetParams: (args) => hostFn('jointSetParams')?.(args),
    jointApplyPicks: (args) => hostFn('jointApplyPicks')?.(args),
    prepareJointCommit: () => hostFn('prepareJointCommit')?.(),
    finishJointCommit: () => { hostFn('finishJointCommit')?.(); },
    jointCancel: () => hostFn('jointCancel')?.(),
    jointSelect: (args) => hostFn('jointSelect')?.(args),
    jointEdit: (args) => hostFn('jointEdit')?.(args),
    sheetOpen: () => hostFn('sheetOpen')?.(),
    sheetStart: (args) => hostFn('sheetStart')?.(args),
    sheetSetTool: (args) => hostFn('sheetSetTool')?.(args),
    sheetSetParams: (args) => hostFn('sheetSetParams')?.(args),
    sheetApplyPicks: (args) => hostFn('sheetApplyPicks')?.(args),
    sheetCancel: () => hostFn('sheetCancel')?.(),
    sheetExit: () => hostFn('sheetExit')?.(),
    sheetCheck: () => hostFn('sheetCheck')?.(),
    sheetRefold: () => hostFn('sheetRefold')?.(),
    sheetBeginHole: () => hostFn('sheetBeginHole')?.(),
    sheetEdit: (args) => hostFn('sheetEdit')?.(args),
    prepareSheetCommit: () => hostFn('prepareSheetCommit')?.(),
    finishSheetCommit: (prepared) => { hostFn('finishSheetCommit')?.(prepared); },
    prepareSheetDone: () => hostFn('prepareSheetDone')?.(),
    finishSheetDone: (prepared) => { hostFn('finishSheetDone')?.(prepared); },
    prepareSheetMutate: (prepared) => hostFn('prepareSheetMutate')?.(prepared),
    paintOpen: () => hostFn('paintOpen')?.(),
    paintClose: () => hostFn('paintClose')?.(),
    paintCancel: () => hostFn('paintCancel')?.(),
    paintSetColor: (args) => hostFn('paintSetColor')?.(args),
    paintFaces: (args) => hostFn('paintFaces')?.(args),
    paintPart: () => hostFn('paintPart')?.(),
    paintUndo: () => hostFn('paintUndo')?.(),
    paintClear: () => hostFn('paintClear')?.(),
    paintConfirm: () => hostFn('paintConfirm')?.(),
    paintState: () => hostFn('paintState')?.(),
    measureOpen: () => hostFn('measureOpen')?.(),
    measureClose: () => hostFn('measureClose')?.(),
    measureSetUnit: (args) => hostFn('measureSetUnit')?.(args),
    measurePick: (args) => hostFn('measurePick')?.(args),
    measureClear: () => hostFn('measureClear')?.(),
    measureState: () => hostFn('measureState')?.(),
    crossSectionToggle: (args) => hostFn('crossSectionToggle')?.(args),
    crossSectionExpand: (args) => hostFn('crossSectionExpand')?.(args),
    crossSectionPlane: (args) => hostFn('crossSectionPlane')?.(args),
    crossSectionOffset: (args) => hostFn('crossSectionOffset')?.(args),
    crossSectionState: () => hostFn('crossSectionState')?.(),
    cadSelectAll: () => hostFn('cadSelectAll')?.(),
    agentPrompt: (args) => hostFn('agentPrompt')?.(args),
    sketchDeleteEntity: (args) => hostFn('sketchDeleteEntity')?.(args),
    feaOpen: () => hostFn('feaOpen')?.(),
    feaClose: () => hostFn('feaClose')?.(),
    feaSetMaterial: (args) => hostFn('feaSetMaterial')?.(args),
    feaSetTarget: (args) => hostFn('feaSetTarget')?.(args),
    feaSetFixture: (args) => hostFn('feaSetFixture')?.(args),
    feaSetForce: (args) => hostFn('feaSetForce')?.(args),
    feaSetPressureLoad: (args) => hostFn('feaSetPressureLoad')?.(args),
    feaRemoveFixture: (args) => hostFn('feaRemoveFixture')?.(args),
    feaRemoveLoad: (args) => hostFn('feaRemoveLoad')?.(args),
    feaRun: () => hostFn('feaRun')?.(),
    feaCancel: () => hostFn('feaCancel')?.(),
    feaBackToSetup: () => hostFn('feaBackToSetup')?.(),
    feaState: (args) => hostFn('feaState')?.(args),
    feaResults: (args) => hostFn('feaResults')?.(args),
    feaPick: (args) => hostFn('feaPick')?.(args),
    agentUndo: () => hostFn('agentUndo')?.(),
    agentRedo: () => hostFn('agentRedo')?.(),
    agentHistory: () => hostFn('agentHistory')?.(),
    slotOpen: (args) => hostFn('slotOpen')?.(args),
    slotAssignContour: (args) => hostFn('slotAssignContour')?.(args),
    slotSetParams: (args) => hostFn('slotSetParams')?.(args),
    slotCancel: () => hostFn('slotCancel')?.(),
    prepareSlotCommit: () => hostFn('prepareSlotCommit')?.(),
    clearSelection: () => { hostFn('clearSelection')?.(); },
    selectFaces: (args) => hostFn('selectFaces')?.(args),
    selectEdges: (args) => hostFn('selectEdges')?.(args),
    selectParts: (args) => hostFn('selectParts')?.(args),
    setActivePart: (partId) => {
      const out = hostFn('setActivePart')?.(partId);
      refreshStatusForActivePart();
      return out;
    },
    setPartVisible: (args) => hostFn('setPartVisible')?.(args),
    setCamera: (args) => hostFn('setCamera')?.(args),
    fitCamera: () => hostFn('fitCamera')?.(),
    zoomToSelection: () => hostFn('zoomToSelection')?.(),
    pickSessions,
    pickInfo: () => hostFn('pickInfo')?.(),
    pickEnter: (args) => hostFn('pickEnter')?.(args),
    pickResolve: (args) => hostFn('pickResolve')?.(args),
    pickRead: () => hostFn('pickRead')?.(),
    pickWrite: (args) => hostFn('pickWrite')?.(args),
    pickParams: (args) => hostFn('pickParams')?.(args),
    pickAccept: () => hostFn('pickAccept')?.(),
    pickExit: () => hostFn('pickExit')?.(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cloneHistory: cloneAgentHistory,
    failedExecute,
    listCommands: () => v1Registry.catalog(),
    readAgentVisible: () => {
      const read = hostFn('readAgentVisible');
      if (read) return read();
      return { enabled: false };
    },
    setAgentVisible: (patch) => {
      const apply = hostFn('setAgentVisible');
      if (!apply) return { enabled: false };
      return apply(patch);
    },
  };

  function readVisibleCueState() {
    const read = hostFn('readAgentVisible');
    const opts = read ? read() : { enabled: false };
    const host = getHost();
    const director = host && host.agentVisibleDirector && typeof host.agentVisibleDirector === 'object'
      ? host.agentVisibleDirector
      : null;
    return { opts, director };
  }

  async function runWithVisibleCue(name, args, command, runBody) {
    const { opts, director } = readVisibleCueState();
    const shouldCue = opts?.enabled === true && director;
    if (shouldCue && typeof director.before === 'function') {
      await director.before({ name, args, command });
    }
    let out;
    try {
      out = toEnvelope(await withAgentDrivenChange(runBody));
    } catch (err) {
      out = fail('internal', String(err?.message || err));
    }
    if (shouldCue && typeof director.after === 'function') {
      await director.after({ name, args, command, envelope: out });
    }
    return out;
  }

  function toEnvelope(out) {
    if (out && out.error) return fail(out.error.code, out.error.message, out.error.details);
    return pass(out ? out.result : undefined);
  }

  /**
   * Stable dispatcher. `argsJson` is a JSON string or a plain JSON object.
   * Resolves to `{ v, ok, result? , error? }`. A script that fails to build
   * is still `ok: true`: the CAD outcome is `result.ok` / `result.errors`.
   * Envelope `ok: false` means the command itself was refused.
   * Reads (`get_script`, `status`, `errors`, `list_commands`, and the H2
   * state readers) do not wait
   * for a queued mutation. `set_script`, `run`, `screenshot`, `undo`, and `redo` do.
   */
  function call(name, argsJson) {
    if (typeof name !== 'string' || !AGENT_COMMANDS.includes(name)) {
      const label = typeof name === 'string' ? name : typeof name;
      return Promise.resolve(fail('unknown_command', `Unknown command: ${label}`));
    }
    const parsed = parseArgs(argsJson);
    if (!parsed.ok) return Promise.resolve(fail(parsed.code, parsed.message));
    const args = parsed.args;
    const command = v1Registry.get(name);

    if (typeof command.checkArgs === 'function') {
      const refused = command.checkArgs(args);
      if (refused) return Promise.resolve(fail(refused.code, refused.message, refused.details));
    }

    if (command.immediate) {
      return runWithVisibleCue(name, args, command, () => Promise.resolve(command.run(ctx, args)));
    }

    return enqueue(() => runWithVisibleCue(name, args, command, () => command.run(ctx, args)));
  }

  async function unwrap(envPromise) {
    const env = await envPromise;
    if (!env.ok) throw bridgeError(env.error);
    return env.result;
  }

  return {
    version: AGENT_BRIDGE_VERSION,
    commands: AGENT_COMMANDS,
    call,

    getScript() {
      return unwrap(call('get_script')).then((result) => result.source);
    },
    setScript(source, partId) {
      return unwrap(call('set_script', { source, part_id: partId }));
    },
    run() {
      return unwrap(call('run'));
    },
    status() {
      return unwrap(call('status'));
    },
    errors() {
      return unwrap(call('errors')).then((result) => result.errors);
    },
    screenshot() {
      return unwrap(call('screenshot', { format: 'png' })).then((result) => result.dataUrl);
    },
    undo() {
      return unwrap(call('undo'));
    },
    redo() {
      return unwrap(call('redo'));
    },
    syncStatusFromRun() {
      return syncStatusFromRun();
    },
    listCommands() {
      return unwrap(call('list_commands')).then((result) => result.commands);
    },
  };
}
