/**
 * The open assembly on another branch.
 *
 * A v2 assembly is read by its id (`assemblies/<id>.surf.json`). A branch cut
 * before that file existed (a part checked in to a side branch from an
 * older base, or a branch made before the assembly was saved) has no such
 * file, and the switch used to stop with the raw id. This looks the
 * assembly up by name on that branch first, and otherwise says in words
 * which assemblies the branch does have.
 */
import { listV2Assemblies } from './v2VaultRead.js';

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Where `name` lives on `branch`.
 * @returns {Promise<{ id: string } | { missing: true, available: string[] }>}
 */
export async function findAssemblyOnBranch(adapter, repo, { name, branch = 'main' } = {}) {
  const rows = await listV2Assemblies(adapter, repo, branch);
  const hit = rows.find((row) => sameName(row.name, name));
  if (hit) return { id: hit.id };
  return { missing: true, available: rows.map((row) => row.name) };
}

/** Branches pane copy for an assembly the branch does not have. Names, never ids. */
export function assemblyMissingOnBranchCopy(name, branch, available = []) {
  const who = String(name || '').trim() || 'This assembly';
  const where = String(branch || '').trim() || 'that branch';
  const list = (Array.isArray(available) ? available : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!list.length) return `${who} is not on ${where}, and that branch has no assemblies. Stay here, or pick another branch.`;
  return `${who} is not on ${where}. That branch has ${list.join(', ')}. Stay here, or open one of those.`;
}

/** The error the switch throws when the assembly is not on the branch. */
export function assemblyMissingOnBranchError(name, branch, available) {
  const err = new Error(assemblyMissingOnBranchCopy(name, branch, available));
  err.code = 'assembly_missing_on_branch';
  err.available = Array.isArray(available) ? available.slice() : [];
  return err;
}
