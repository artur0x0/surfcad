/**
 * clearLocalCadData — wipe device CAD caches without touching the remote repo.
 *
 * Clears:
 *   - surfcad / editorDraft (+ localStorage surfcad_editor_draft fallback)
 *   - surfcad-assembly (document + part scripts)
 *   - surfcad-sync (outbox + kv)
 *   - SurfDB model cache (+ in-memory Manifold import cache)
 *   - surfcad-assets (mesh bytes keyed by git blob sha)
 *   - surfcad-part-thumbs (part-row thumbnail bitmaps)
 *   - OAuth editor hand-off localStorage (surfcad_editor) so a reload cannot
 *     resurrect the previous buffer
 *
 * Kept: GitHub sessionStorage token (`surfcad.github.token`), the auth
 * session, the `surfcad-scs` catalog, checkout / game-wins settings, and
 * the signed-in cart (`surfcad_cart:<user id>`, `surfcad_cart_uploaded:<user id>`).
 * Does not delete the GitHub account or vault repo, and does not fetch.
 */
import { clearEditorDraft } from './editorDraft.js';
import { clearAssemblyStore } from './assemblyStore.js';
import { clearAssetCache } from './git/assetCache.js';
import { clearSyncStore } from './git/syncStore.js';
import { clearModelCache } from './importModel.js';
import { clearEditorState } from './editorStorage.js';
import { clearPartThumbnails } from './partThumbnailStore.js';

export async function clearLocalCadData() {
  const results = {
    editorDraft: false,
    assembly: false,
    modelCache: false,
    editorHandOff: false,
  };

  try {
    await clearEditorDraft();
    results.editorDraft = true;
  } catch (err) {
    console.warn('[ClearLocalCad] editorDraft:', err);
  }

  try {
    results.assembly = await clearAssemblyStore();
  } catch (err) {
    console.warn('[ClearLocalCad] assembly:', err);
  }

  try {
    await clearSyncStore();
    results.sync = true;
  } catch (err) {
    console.warn('[ClearLocalCad] sync:', err);
  }

  try {
    await clearAssetCache();
    results.assets = true;
  } catch (err) {
    console.warn('[ClearLocalCad] assets:', err);
  }

  try {
    await clearModelCache();
    results.modelCache = true;
  } catch (err) {
    console.warn('[ClearLocalCad] modelCache:', err);
  }

  try {
    await clearPartThumbnails();
    results.thumbs = true;
  } catch (err) {
    console.warn('[ClearLocalCad] thumbs:', err);
  }

  try {
    clearEditorState();
    results.editorHandOff = true;
  } catch (err) {
    console.warn('[ClearLocalCad] editorHandOff:', err);
  }

  return results;
}

export default { clearLocalCadData };
