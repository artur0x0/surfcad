/**
 * Assembly-open overlay.
 *
 * The spinner stays hidden for `showDelayMs` (150) so a fast open does not
 * flash. It clears on success, failure, and cancel. Silence longer than
 * `safetyMs` clears a stuck open and reports a failure the shell shows as
 * the error toast with Retry.
 *
 * The label is the display name of the assembly being opened: its
 * `.surf.json` name, or the store copy of that file. A missing name is
 * "Untitled assembly". A surf id is never shown. The panel is the viewport
 * ground, not a preview of the assembly that was already open.
 *
 * Tests delay or fail an open with globalThis.__ASSEMBLY_OPEN_DELAY_MS__
 * and globalThis.__ASSEMBLY_OPEN_FAIL__ (string message, or true).
 */
import { assemblyIdPath } from './git/idPaths.js';
import { isSurfId, isV2SurfId } from './git/surfId.js';
import { assemblyFilePathCandidates } from './git/vaultLayout.js';

export const ASSEMBLY_OPEN_SHOW_MS = 150;
export const ASSEMBLY_OPEN_SAFETY_MS = 45000;
export const UNTITLED_ASSEMBLY_NAME = 'Untitled assembly';

function asSurfObject(surf) {
  if (surf == null || surf === '') return null;
  if (typeof surf === 'string') {
    try {
      const parsed = JSON.parse(surf);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  if (typeof surf === 'object' && !Array.isArray(surf)) return surf;
  return null;
}

/** A display name. Blank and surf ids are not names. */
function labelFrom(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!name || isSurfId(name)) return '';
  return name;
}

function surfMatchesTarget(surf, targetId) {
  if (!surf) return false;
  const surfId = typeof surf.id === 'string' ? surf.id.trim() : '';
  return !targetId || !surfId || surfId === targetId;
}

/**
 * Display name of the assembly being opened.
 *
 * A `.surf.json` object or text (`surf`) wins, then the store's copy
 * (`storedSurf` / `storedName`), then `doc` when that document is the
 * assembly being opened. A document with a different id — the one already
 * on screen — is ignored. A bare `name` is used only when this open is not
 * by id and no surf was given. No usable name is "Untitled assembly".
 */
export function resolveAssemblyOpenName(source) {
  const input = typeof source === 'string'
    ? { name: source }
    : (source && typeof source === 'object' ? source : {});
  const targetId = typeof input.id === 'string' ? input.id.trim() : '';
  const surfGiven = input.surf != null && input.surf !== '';
  const surf = asSurfObject(input.surf);
  if (surfGiven && surf && surfMatchesTarget(surf, targetId)) {
    return labelFrom(surf.name) || UNTITLED_ASSEMBLY_NAME;
  }
  const storedGiven = input.storedSurf != null && input.storedSurf !== '';
  const stored = asSurfObject(input.storedSurf);
  if (!surfGiven && storedGiven && stored && surfMatchesTarget(stored, targetId)) {
    return labelFrom(stored.name) || UNTITLED_ASSEMBLY_NAME;
  }
  const storedName = labelFrom(input.storedName);
  if (!surfGiven && storedName) return storedName;
  const doc = input.doc && typeof input.doc === 'object' && !Array.isArray(input.doc)
    ? input.doc
    : null;
  if (doc) {
    const docId = typeof doc.id === 'string' ? doc.id.trim() : '';
    const docOk = !targetId || !docId || docId === targetId;
    if (docOk) {
      const fromDoc = labelFrom(doc.name);
      if (fromDoc) return fromDoc;
    }
  }
  if (!targetId && !surfGiven) {
    const given = labelFrom(input.name);
    if (given) return given;
  }
  return UNTITLED_ASSEMBLY_NAME;
}

/**
 * Resolve the name, reading `.surf.json` first when `readSurf` is set.
 * `readStoredSurf` runs only when that read returns nothing.
 */
export async function lookupAssemblyOpenName(source = {}) {
  const input = typeof source === 'string' ? { name: source } : { ...(source || {}) };
  if ((input.surf == null || input.surf === '') && typeof input.readSurf === 'function') {
    input.surf = await input.readSurf();
  }
  if ((input.storedSurf == null || input.storedSurf === '') && typeof input.readStoredSurf === 'function') {
    input.storedSurf = await input.readStoredSurf();
  }
  return resolveAssemblyOpenName(input);
}

/**
 * `.surf.json` text of the assembly being opened.
 * v2 reads `assemblies/<id>.surf.json` on `branch`. v1 reads the folder's
 * meta file. A missing file falls back to `storedSurf` (the store copy of
 * that same assembly). Never reads some other assembly.
 */
export async function readVaultAssemblySurf(adapter, repo, {
  id = '',
  folder = '',
  branch = 'main',
  storedSurf = null,
} = {}) {
  const targetId = typeof id === 'string' ? id.trim() : '';
  if (isV2SurfId(targetId)) {
    const file = await adapter.readFile(repo, assemblyIdPath(targetId), branch);
    if (file?.content != null && file.content !== '') return file.content;
    return storedSurf ?? null;
  }
  const folderName = typeof folder === 'string' ? folder.trim() : '';
  if (folderName && !isSurfId(folderName)) {
    for (const path of assemblyFilePathCandidates(folderName)) {
      const file = await adapter.readFile(repo, path, branch);
      if (file?.content != null && file.content !== '') return file.content;
    }
  }
  return storedSurf ?? null;
}

export function assemblyOpenLabel(name, progress) {
  const raw = resolveAssemblyOpenName(
    progress && (progress.surf != null || progress.doc || progress.id)
      ? { name, id: progress.id, surf: progress.surf, doc: progress.doc }
      : name,
  );
  const label = `Opening ${raw}…`;
  const index = Number(progress?.index);
  const total = Number(progress?.total);
  const detail = (
    Number.isFinite(index) && Number.isFinite(total) && total > 0 && index > 0
  ) ? `part ${Math.min(Math.trunc(index), Math.trunc(total))} of ${Math.trunc(total)}` : '';
  return { label, detail };
}

export function readAssemblyOpenTestDelayMs() {
  try {
    const ms = Number(globalThis.__ASSEMBLY_OPEN_DELAY_MS__);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  } catch {
    return 0;
  }
}

/**
 * Extra pause after the document is in hand, before the worker build.
 * Goldens and the mobile screenshot set globalThis.__ASSEMBLY_OPEN_HOLD_MS__.
 * No-op in normal use.
 */
export async function applyAssemblyOpenHold() {
  let ms = 0;
  try { ms = Number(globalThis.__ASSEMBLY_OPEN_HOLD_MS__); } catch { ms = 0; }
  if (Number.isFinite(ms) && ms > 0) {
    await new Promise((resolve) => { setTimeout(resolve, ms); });
  }
}

/** Artificial delay / forced failure for goldens. No-op in normal use. */
export async function applyAssemblyOpenTestHooks() {
  const ms = readAssemblyOpenTestDelayMs();
  if (ms > 0) {
    await new Promise((resolve) => { setTimeout(resolve, ms); });
  }
  let fail = null;
  try { fail = globalThis.__ASSEMBLY_OPEN_FAIL__; } catch { fail = null; }
  if (fail) {
    const message = typeof fail === 'string' && fail.trim()
      ? fail.trim()
      : 'Could not open assembly';
    const err = new Error(message);
    err.assemblyOpen = true;
    throw err;
  }
}

function failureText(name, err, reason) {
  if (reason === 'timeout') {
    return `Could not open ${resolveAssemblyOpenName(name)}`;
  }
  if (err?.message) return String(err.message);
  return 'Could not open assembly';
}

function acceptProgressName(current, next) {
  const resolved = resolveAssemblyOpenName({
    name: next.name,
    id: next.id,
    surf: next.surf,
    storedSurf: next.storedSurf,
    storedName: next.storedName,
    doc: next.doc,
  });
  // A part tick that only carries an id (or no name) must not wipe the
  // name already resolved from this assembly's surf.json. An authoritative
  // read of that file may replace it, including with Untitled assembly.
  if (!next.authoritative
    && resolved === UNTITLED_ASSEMBLY_NAME
    && current
    && current !== UNTITLED_ASSEMBLY_NAME) {
    return current;
  }
  return resolved;
}

export function createAssemblyOpenController({
  showDelayMs = ASSEMBLY_OPEN_SHOW_MS,
  safetyMs = ASSEMBLY_OPEN_SAFETY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = null,
  onBegin = null,
  onFailure = null,
  onRecover = null,
} = {}) {
  let generation = 0;
  let visible = false;
  let snapshot = null;
  let showTimer = null;
  let safetyTimer = null;
  const timedOut = new Set();

  function emit() {
    if (typeof onChange !== 'function') return;
    if (!snapshot || !visible) {
      onChange(null);
      return;
    }
    onChange({
      visible: true,
      generation: snapshot.generation,
      name: snapshot.name,
      index: snapshot.index,
      total: snapshot.total,
    });
  }

  function clearTimers() {
    if (showTimer != null) clearTimer(showTimer);
    if (safetyTimer != null) clearTimer(safetyTimer);
    showTimer = null;
    safetyTimer = null;
  }

  function hide() {
    clearTimers();
    visible = false;
    snapshot = null;
    emit();
  }

  function armSafety(gen) {
    if (safetyTimer != null) clearTimer(safetyTimer);
    safetyTimer = setTimer(() => {
      if (gen !== generation || !snapshot) return;
      const failed = snapshot;
      timedOut.add(gen);
      generation += 1;
      hide();
      onFailure?.({
        generation: gen,
        reason: 'timeout',
        name: failed.name,
        message: failureText(failed.name, null, 'timeout'),
        retry: failed.retry || null,
      });
    }, safetyMs);
  }

  function begin({
    name = '',
    id = '',
    surf = null,
    storedSurf = null,
    storedName = '',
    doc = null,
    total = 0,
    retry = null,
  } = {}) {
    const gen = ++generation;
    clearTimers();
    visible = false;
    snapshot = {
      generation: gen,
      name: resolveAssemblyOpenName({ name, id, surf, storedSurf, storedName, doc }),
      index: 0,
      total: Number(total) || 0,
      retry: typeof retry === 'function' ? retry : null,
    };
    onBegin?.();
    emit();
    showTimer = setTimer(() => {
      if (gen !== generation || !snapshot) return;
      visible = true;
      emit();
    }, showDelayMs);
    armSafety(gen);
    return gen;
  }

  function isCurrent(gen) {
    return gen === generation && !!snapshot;
  }

  function progress(gen, next = {}) {
    if (gen !== generation || !snapshot) return;
    const hasName = typeof next.name === 'string'
      || next.surf != null
      || next.storedSurf != null
      || next.doc != null;
    if (hasName) snapshot.name = acceptProgressName(snapshot.name, next);
    if (Number.isFinite(Number(next.index))) snapshot.index = Number(next.index);
    if (Number.isFinite(Number(next.total))) snapshot.total = Number(next.total);
    armSafety(gen);
    if (visible) emit();
  }

  /** Success or cancel. False when a newer open or the safety timer won. */
  function finish(gen) {
    if (gen !== generation) return false;
    generation += 1;
    hide();
    return true;
  }

  /** Failure while this open is still current. False if already settled. */
  function fail(gen, err) {
    if (gen !== generation || !snapshot) return false;
    const failed = snapshot;
    generation += 1;
    hide();
    onFailure?.({
      generation: gen,
      reason: 'error',
      name: failed.name,
      message: failureText(failed.name, err, 'error'),
      retry: failed.retry || null,
    });
    return true;
  }

  /**
   * A load that finished after the safety timer. Clears that timer's toast
   * so a late success does not leave a stuck failure.
   */
  function acknowledgeLate(gen) {
    if (!timedOut.has(gen)) return false;
    timedOut.delete(gen);
    onRecover?.(gen);
    return true;
  }

  function isOpen() {
    return !!snapshot;
  }

  return {
    begin, progress, finish, fail, isCurrent, acknowledgeLate, isOpen,
  };
}

/**
 * One open: show-delay, progress, first-build wait inside `load`, then clear.
 * `load` receives `{ progress, signal }`. Throw to fail. Return to succeed.
 * A stale `signal()` means a newer open replaced this one — return without
 * writing.
 */
export async function runTrackedAssemblyOpen(ctrl, {
  name = '',
  id = '',
  surf = null,
  storedSurf = null,
  storedName = '',
  doc = null,
  total = 0,
  retry = null,
  load,
} = {}) {
  const gen = ctrl.begin({ name, id, surf, storedSurf, storedName, doc, total, retry });
  try {
    await applyAssemblyOpenTestHooks();
    if (!ctrl.isCurrent(gen)) return undefined;
    const value = await load({
      progress: (update) => ctrl.progress(gen, update),
      signal: () => ctrl.isCurrent(gen),
    });
    if (!ctrl.finish(gen)) ctrl.acknowledgeLate(gen);
    return value;
  } catch (err) {
    ctrl.fail(gen, err);
    throw err;
  }
}
