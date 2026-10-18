/**
 * G4: Pull / conflicts in Git mode.
 *
 * After Open (and again on window focus), compare the baseline head to main.
 * When main has moved, the working copy is **behind**: a yellow toast offers
 * Get latest / Keep mine, and every part (and the assembly) that main changed
 * gets a marker. Get latest opens the same marker dialog (Reload / Keep mine /
 * Check in mine to a branch). Keep mine calls that dialog's keep handler.
 * Check-in base is auto-detected, same as G3.
 *
 * Mock adapter only; nothing here talks to the network.
 */
import { putAsset } from './assetCache.js';
import { isBinaryContent } from './binaryContent.js';
import { GitAdapterError, assertGithubAdapter, fileWrite } from './githubAdapterInterface.js';
import { readVaultAsset } from './githubAdapter.js';
import { detectCommitBase, commitBranchName, freeBranchName, prepareAssemblySurfWrite } from './gitCommit.js';
import { captureBaseline } from './gitBaseline.js';
import { openVaultAssembly } from './gitWorkspace.js';
import { stringifySurfJson } from './surfJson.js';
import { assetPathForScript, parseVaultPath, vaultSegment } from './vaultLayout.js';

function assemblyTextIgnoringActive(text) {
  const obj = JSON.parse(text);
  obj.activeId = null;
  return JSON.stringify(obj);
}

/**
 * Prefer the exact remote `.surf.json` bytes so a serializeAssembly reorder
 * does not false-dirty Get latest. After identity collapse those bytes may
 * not JSON-equal the working copy; keep the WC stringify in that case.
 */
function overlayRemoteAssemblyText(baselineNext, remoteText, doc) {
  if (typeof remoteText !== 'string') return baselineNext;
  const wc = stringifySurfJson({ ...doc, source: 'git' }, { validate: false });
  let assemblyText = remoteText;
  try {
    if (assemblyTextIgnoringActive(wc) !== assemblyTextIgnoringActive(remoteText)) {
      assemblyText = wc;
    }
  } catch {
    assemblyText = wc;
  }
  baselineNext.assemblyText = assemblyText;
  return baselineNext;
}

/**
 * Paths in our document that main changed since the baseline head.
 * `files` is the compare-from-mergeBase-to-head list.
 */
export function behindPathsFromFiles(files, { assemblyPath = null, partIds = [] } = {}) {
  const want = new Set((partIds || []).map(String));
  const meshOwners = new Map();
  for (const id of want) {
    const mesh = assetPathForScript(id);
    if (mesh) meshOwners.set(mesh, id);
  }
  const asm = assemblyPath || null;
  const partIdsOut = [];
  let assemblyBehind = false;
  const relevant = [];
  for (const f of files || []) {
    const path = f?.path;
    if (!path) continue;
    if (asm && path === asm) {
      assemblyBehind = true;
      relevant.push(f);
    } else if (want.has(path)) {
      partIdsOut.push(path);
      relevant.push(f);
    } else if (meshOwners.has(path)) {
      const id = meshOwners.get(path);
      if (!partIdsOut.includes(id)) partIdsOut.push(id);
      relevant.push(f);
    }
  }
  partIdsOut.sort();
  return { assemblyBehind, partIds: partIdsOut, files: relevant };
}

/**
 * Compare baseline head → main. When main is ahead we are behind.
 * -> {
 *   status: 'identical'|'behind'|'ahead'|'diverged'|'unknown',
 *   behindBy, aheadBy, remoteSha, baseSha, assemblyPath,
 *   files,           // all files main changed since merge base
 *   assemblyBehind, partIds, remoteFiles  // only paths in this document
 * }
 */
export async function checkRemoteBehind(adapter, repo, {
  branch = 'main',
  baselineSha = null,
  assemblyPath = null,
  partIds = [],
} = {}) {
  assertGithubAdapter(adapter);
  const main = await adapter.getBranch(repo, branch);
  const remoteSha = main?.sha || null;
  if (!baselineSha || !remoteSha) {
    return {
      status: 'unknown',
      behindBy: 0,
      aheadBy: 0,
      remoteSha,
      baseSha: remoteSha,
      assemblyPath: assemblyPath || null,
      files: [],
      assemblyBehind: false,
      partIds: [],
      remoteFiles: [],
    };
  }
  if (baselineSha === remoteSha) {
    return {
      status: 'identical',
      behindBy: 0,
      aheadBy: 0,
      remoteSha,
      baseSha: baselineSha,
      assemblyPath: assemblyPath || null,
      files: [],
      assemblyBehind: false,
      partIds: [],
      remoteFiles: [],
    };
  }
  let cmp;
  try {
    cmp = await adapter.compare(repo, baselineSha, remoteSha);
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'not_found') {
      return {
        status: 'unknown',
        behindBy: 0,
        aheadBy: 0,
        remoteSha,
        baseSha: remoteSha,
        assemblyPath: assemblyPath || null,
        files: [],
        assemblyBehind: false,
        partIds: [],
        remoteFiles: [],
      };
    }
    throw err;
  }
  // compare(baseline → remote): aheadBy = commits on remote we lack = behindBy for us.
  const behindBy = cmp.aheadBy || 0;
  const aheadBy = cmp.behindBy || 0;
  let status = 'identical';
  if (behindBy && aheadBy) status = 'diverged';
  else if (behindBy) status = 'behind';
  else if (aheadBy) status = 'ahead';
  const scoped = behindPathsFromFiles(cmp.files, { assemblyPath, partIds });
  return {
    status,
    behindBy,
    aheadBy,
    remoteSha,
    baseSha: cmp.mergeBaseSha || baselineSha,
    assemblyPath: assemblyPath || null,
    files: cmp.files || [],
    assemblyBehind: scoped.assemblyBehind,
    partIds: scoped.partIds,
    remoteFiles: scoped.files,
  };
}

/** Toast copy when the working copy is behind main. */
export function behindToastMessage({ behindBy = 0 } = {}) {
  const n = behindBy || 0;
  return `Remote is ahead (${n} new commit${n === 1 ? '' : 's'}). Get latest, Keep mine, or Check in mine to a branch.`;
}

/**
 * The file the behind toast acts on. The assembly when that file moved,
 * otherwise the first marked part. Null when nothing in this document moved.
 */
export function behindToastTarget(check, resolvedPaths = [], {
  assemblyName = '',
  parts = [],
} = {}) {
  const markers = remainingBehindMarkers(check, resolvedPaths);
  if (markers.assemblyBehind && check?.assemblyPath) {
    const name = String(assemblyName || '').trim() || check.assemblyPath;
    return { path: check.assemblyPath, kind: 'assembly', name };
  }
  const id = markers.partIds[0];
  if (!id) return null;
  const part = (parts || []).find((row) => row && row.id === id);
  return { path: id, kind: 'part', name: part?.name || id };
}

/** Get latest: open the Parts-list conflict dialog for that same file. */
export function openBehindToastTarget(feed, target) {
  if (!target?.path || typeof feed?.openBehindConflict !== 'function') return false;
  feed.openBehindConflict(target.path, target.kind, target.name);
  return true;
}

/**
 * Keep mine: the dialog's keep handler (`keepBehind` → action `keep`).
 * The caller dismisses the toast after this returns.
 */
export async function keepBehindToastTarget(feed, target) {
  if (!target?.path || typeof feed?.keepBehind !== 'function') {
    return { status: 'error', error: 'Action unavailable' };
  }
  return feed.keepBehind(target.path, target.kind);
}

/**
 * Markers still showing after the user Reloaded / Kept / Checked-in some paths.
 * `resolvedPaths` holds the assembly path and/or part ids already handled.
 */
export function remainingBehindMarkers(check, resolvedPaths = []) {
  const done = new Set(resolvedPaths || []);
  const asm = check?.assemblyPath || null;
  const partIds = (check?.partIds || []).filter((id) => !done.has(id));
  const assemblyBehind = !!(asm && check?.assemblyBehind && !done.has(asm));
  return {
    assemblyBehind,
    partIds,
    any: assemblyBehind || partIds.length > 0,
  };
}

/**
 * Reload one path from remote into the working copy and refresh that path
 * in the baseline. baseline.headSha is left alone — the caller advances it
 * with `advanceBaselineHead` once every remaining marker was Reloaded.
 *
 * -> {
 *   kind: 'part'|'assembly',
 *   path,
 *   content,
 *   doc?,       // new assembly doc when kind=assembly
 *   scripts,    // updated scripts map (part reload only changes one entry)
 *   baseline,
 * }
 */
export async function reloadFromRemote(adapter, repo, {
  path,
  kind, // 'part' | 'assembly'
  branch = 'main',
  scripts,
  baseline,
  pathIndex = {},
  knownAssemblyId = null,
  assemblyIdIndex = {},
} = {}) {
  assertGithubAdapter(adapter);
  if (!path || !baseline) throw new Error('Nothing to reload');
  if (kind === 'assembly') {
    const info = parseVaultPath(path);
    const name = info?.assembly || vaultSegment(baseline.assemblyName);
    if (!name) throw new Error(`Cannot reload assembly: ${path}`);
    const opened = await openVaultAssembly(adapter, repo, name, {
      branch,
      headSha: baseline.headSha,
      pathIndex,
      knownAssemblyId,
      assemblyIdIndex,
    });
    const nextDoc = opened.doc;
    // Keep unsaved local scripts. Get latest of the assembly file must not
    // overwrite part bodies the user has edited but not Saved.
    const nextScripts = { ...(scripts || {}) };
    const baselineNext = captureBaseline({
      assemblyPath: opened.assemblyPath || path,
      assemblyName: vaultSegment(nextDoc?.name) || baseline.assemblyName,
      doc: nextDoc,
      scripts: nextScripts,
      assets: opened.baseline?.assets || baseline.assets,
      branch: baseline.branch || branch,
      headSha: baseline.headSha,
    });
    // Exact remote bytes so dirty clears even if serializeAssembly reorders.
    overlayRemoteAssemblyText(
      baselineNext,
      opened.rawAssemblyText ?? opened.baseline?.assemblyText,
      nextDoc,
    );
    return {
      kind: 'assembly',
      path: opened.assemblyPath || path,
      content: opened.rawAssemblyText ?? baselineNext.assemblyText,
      doc: nextDoc,
      scripts: nextScripts,
      baseline: baselineNext,
      vaultLayout: opened.vaultLayout,
    };
  }
  const file = await adapter.readFile(repo, path, branch);
  if (!file) throw new Error(`Missing on remote: ${path}`);
  const content = file.content ?? '';
  const nextScripts = { ...(scripts || {}), [path]: content };
  const mesh = assetPathForScript(path);
  const asset = mesh ? await cacheRemoteAsset(adapter, repo, mesh, branch) : null;
  const nextAssets = { ...(baseline.assets || {}) };
  if (mesh) {
    if (asset?.sha) nextAssets[mesh] = asset.sha;
    else delete nextAssets[mesh];
  }
  const baselineNext = {
    ...baseline,
    scripts: { ...(baseline.scripts || {}), [path]: content },
    assets: nextAssets,
    partIds: baseline.partIds?.includes(path)
      ? baseline.partIds
      : [...(baseline.partIds || []), path],
  };
  return {
    kind: 'part',
    path,
    content,
    asset,
    scripts: nextScripts,
    baseline: baselineNext,
  };
}

/** Blob-read a mesh and store it in the asset cache. Null when the path is absent. */
async function cacheRemoteAsset(adapter, repo, meshPath, branch) {
  if (typeof adapter?.readBlob !== 'function') return null;
  const got = await readVaultAsset(adapter, repo, meshPath, branch);
  if (!(got?.bytes instanceof Uint8Array)) return null;
  let sha = got.sha;
  try { sha = await putAsset(got.bytes); } catch { /* keep the tree sha */ }
  return { path: meshPath, sha, bytes: got.bytes };
}

/**
 * After every remaining behind marker was resolved via Reload, advance the
 * baseline head to remoteSha so a later focus check is clean. Keep mine /
 * check-in leave headSha alone so G3 still sees a moved main on Commit.
 */
export function advanceBaselineHead(baseline, remoteSha) {
  if (!baseline || !remoteSha) return baseline;
  return { ...baseline, headSha: remoteSha };
}

/**
 * Park my version of one path on a side branch cut from the auto-detected
 * base (same naming as G3). Main and the working-copy baseline are untouched.
 * -> { status: 'branched', branch, sha, path, baseSha, mainSha, behindBy }
 */
export async function checkInMineToBranch(adapter, repo, {
  doc,
  scripts,
  baseline,
  path,
  kind, // 'part' | 'assembly'
  message = '',
  assets = null,
  now = new Date(),
} = {}) {
  assertGithubAdapter(adapter);
  if (!path || !baseline || !doc) throw new Error('Nothing to check in');
  const branch = baseline.branch || 'main';
  let assemblyWrite = null;
  if (kind === 'assembly') {
    assemblyWrite = await prepareAssemblySurfWrite(adapter, repo, {
      doc,
      scripts: scripts || {},
      branch,
    });
  }
  const base = await detectCommitBase(adapter, repo, {
    branch,
    baselineSha: baseline.headSha,
  });
  const sideName = await freeBranchName(adapter, repo, commitBranchName(doc.name, now));
  await adapter.createBranch(repo, sideName, base.baseSha);
  const msg = String(message || '').trim()
    || `Keep mine: ${path.split('/').pop() || path}`;
  const files = [];
  if (kind === 'assembly') {
    files.push(...(assemblyWrite?.files || []));
  } else {
    files.push(fileWrite(path, scripts?.[path] ?? ''));
    const mesh = assetPathForScript(path);
    const meshBytes = mesh && assets ? (assets[mesh] ?? assets[path]) : null;
    if (mesh && isBinaryContent(meshBytes)) files.push(fileWrite(mesh, meshBytes));
  }
  const side = await adapter.commitFiles(repo, {
    branch: sideName,
    message: msg,
    files,
    baseSha: base.baseSha,
  });
  return {
    status: 'branched',
    branch: sideName,
    sha: side.sha,
    path,
    baseSha: base.baseSha,
    mainSha: base.mainSha,
    behindBy: base.behindBy,
  };
}
