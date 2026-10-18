/**
 * Parts-list subtitle.
 *
 * A row whose id is already a repo path shows that path. Nested legacy
 * `assemblies/<Name>/parts/<Part>.js` rows show the part name, not a
 * `parts/<Part>.js` path. Any other id (a bare local key, or a legacy
 * `local:` key) shows the path Add to Repo would write: `parts/<Name>.js`,
 * with `Name (2)` when that path is taken. Nothing is shown when a path
 * cannot be derived. The subtitle is not the sync flag — Add to Repo is.
 */
import { sharedPathForMove } from './gitDeleteAssembly.js';
import { partRepoPath } from './partIdentity.js';
import { isVaultPartPath, parseVaultPath, vaultSegment } from './vaultLayout.js';

function nameBase(part) {
  return vaultSegment(String(part?.name || '').replace(/\.js$/i, '')) || 'Part';
}

/**
 * id → subtitle for one feed, in row order. Repo paths are reserved first
 * so an unsynced name does not pretend to be a file that is already a row.
 */
export function partListSubtitles(parts) {
  const taken = new Set();
  for (const part of parts || []) {
    const id = String(part?.id || '');
    const path = partRepoPath(part);
    if (isVaultPartPath(id)) taken.add(id);
    if (path) taken.add(path);
  }
  const out = new Map();
  for (const part of parts || []) {
    const id = String(part?.id || '');
    if (!id) continue;
    const path = partRepoPath(part);
    const info = path ? parseVaultPath(path) : null;
    if (info?.kind === 'assembly-part' && info.legacy) {
      out.set(id, String(part?.name || info.part || ''));
      continue;
    }
    if (isVaultPartPath(id)) {
      out.set(id, id);
      continue;
    }
    try {
      out.set(id, sharedPathForMove(nameBase(part), taken));
    } catch {
      out.set(id, '');
    }
  }
  return out;
}
